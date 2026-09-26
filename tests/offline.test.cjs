const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const scope = 'https://example.test/gym-workout-tracker/';
const currentCache = 'gym-tracker-shell:%2Fgym-workout-tracker%2F:2026.09.26.1';
const shellPaths = ['index.html', 'pwa.js', 'manifest.webmanifest', 'vendor/chart.umd.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

function worker({seed = {}, offline = false, failPath = '', failCacheWrites = false, failCacheOpen = false} = {}) {
  const stores = new Map(Object.entries(seed).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const handlers = {};
  const calls = {fetch: [], delete: [], skipped: 0, claimed: 0, messages: []};
  const key = input => typeof input === 'string' ? input : input.url;
  const network = async input => {
    const url = key(input);
    calls.fetch.push({url, cache: input.cache});
    if (offline) throw new TypeError('Offline');
    return new Response(`file:${new URL(url).pathname}`, {status: url.endsWith(failPath) && failPath ? 404 : 200});
  };
  const cacheStorage = {
    keys: async () => [...stores.keys()],
    delete: async name => {calls.delete.push(name); return stores.delete(name);},
    open: async name => {
      if (failCacheOpen) throw new Error('Cache Storage unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async request => entries.get(key(request))?.clone(),
        put: async (request, response) => {
          if (failCacheWrites) throw new Error('Storage full');
          entries.set(key(request), response.clone());
        },
        // Cache.addAll writes atomically after all responses pass validation.
        addAll: async requests => {
          const responses = await Promise.all(requests.map(network));
          if (responses.some(response => !response.ok)) throw new TypeError('Failed to cache a file');
          if (failCacheWrites) throw new Error('Storage full');
          requests.forEach((request, i) => entries.set(key(request), responses[i]));
        },
      };
    },
  };
  const clients = [scope, `${scope}index.html?v=old`, 'https://example.test/unrelated/'].map(url => ({url, postMessage: data => calls.messages.push({url, data})}));
  const context = vm.createContext({URL, Request, Response, console, caches: cacheStorage, fetch: network, self: {
    registration: {scope},
    addEventListener: (name, callback) => {handlers[name] = callback;},
    skipWaiting: async () => {calls.skipped++;},
    clients: {claim: async () => {calls.claimed++;}, matchAll: async () => clients},
  }});
  vm.runInContext(source, context);
  const dispatch = async (type, details = {}) => {
    const pending = [];
    let response;
    handlers[type]({...details, waitUntil: promise => pending.push(promise), respondWith: promise => {response = promise;}});
    await Promise.all(pending);
    return response ? await response : undefined;
  };
  return {calls, stores, dispatch, setOffline: value => {offline = value;}, clients};
}

function request(pathname = '', options = {}) {
  return {url: new URL(pathname, scope).href, method: 'GET', mode: 'navigate', headers: new Headers(), ...options};
}

test('installation caches the entire shell with network revalidation and waits for user activation', async () => {
  const w = worker();
  await w.dispatch('install');
  assert.deepEqual([...w.stores.get(currentCache).keys()], shellPaths.map(file => scope + file));
  assert.ok(w.calls.fetch.every(call => call.cache === 'reload'));
  assert.equal(w.calls.skipped, 0);
  assert.equal(w.calls.claimed, 0);
});

test('a missing shell file aborts installation, retaining the previous release and unrelated caches', async () => {
  const oldCache = currentCache.replace('2026.09.26.1', '2026.09.20.1');
  const w = worker({failPath: 'icons/icon-512.png', seed: {[oldCache]: {}, 'other-app': {}}});
  await assert.rejects(w.dispatch('install'));
  assert.ok(!w.stores.has(currentCache));
  assert.ok(w.stores.has(oldCache));
  assert.ok(w.stores.has('other-app'));
  assert.equal(w.calls.skipped, 0);
});

test('failed reinstall cannot delete an already working cache of this release', async () => {
  const w = worker({offline: true, seed: {[currentCache]: {[scope + 'index.html']: new Response('existing app')}}});
  await assert.rejects(w.dispatch('install'));
  assert.equal(await w.stores.get(currentCache).get(scope + 'index.html').text(), 'existing app');
  assert.deepEqual(w.calls.delete, []);
});

test('offline root, index and older cache-busting links open the installed app', async () => {
  const w = worker();
  await w.dispatch('install');
  w.setOffline(true);
  const initialFetches = w.calls.fetch.length;
  for (const url of ['', '?v=c41635c', 'index.html', 'index.html?v=ea91dee']) {
    const response = await w.dispatch('fetch', {request: request(url)});
    assert.equal(await response.text(), 'file:/gym-workout-tracker/index.html');
  }
  assert.equal(w.calls.fetch.length, initialFetches);
});

test('charts, scripts, manifest and icons remain available offline including versioned asset requests', async () => {
  const w = worker();
  await w.dispatch('install');
  w.setOffline(true);
  for (const file of shellPaths.slice(1)) {
    const response = await w.dispatch('fetch', {request: request(file + '?v=2026.09.26.1', {mode: 'cors'})});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'file:/gym-workout-tracker/' + file);
  }
});

test('worker leaves third parties, other apps, unknown routes, backup files and non-GET requests alone', async () => {
  const w = worker();
  const cases = [
    request('https://cdn.example.test/chart.js'),
    request('/another-app/index.html'),
    request('/gym-workout-tracker-other/index.html'),
    request('backup.json', {mode: 'cors'}),
    request('settings'),
    request('index.html', {method: 'POST'}),
    request('vendor/chart.umd.min.js', {headers: new Headers({range: 'bytes=0-50'})}),
  ];
  for (const input of cases) assert.equal(await w.dispatch('fetch', {request: input}), undefined);
  assert.equal(w.calls.fetch.length, 0);
});

test('activation cleans only older versions of this app scope and reports readiness without reloading tabs', async () => {
  const oldCache = currentCache.replace('2026.09.26.1', '2026.09.20.1');
  const otherScope = currentCache.replace('%2Fgym-workout-tracker%2F', '%2Fother%2F');
  const w = worker({seed: {[oldCache]: {}, [otherScope]: {}, 'unrelated-cache': {}}});
  await w.dispatch('install');
  await w.dispatch('activate');
  assert.deepEqual(w.calls.delete, [oldCache]);
  assert.equal(w.calls.claimed, 1);
  assert.ok(w.stores.has(currentCache));
  assert.ok(w.stores.has(otherScope));
  assert.ok(w.stores.has('unrelated-cache'));
  assert.equal(w.calls.messages.length, 2);
  assert.ok(w.calls.messages.every(({data}) => data.type === 'OFFLINE_READY' && data.ready === true && data.version === '2026.09.26.1'));
});

test('status uses the supplied message port and detects missing shell files', async () => {
  const w = worker();
  await w.dispatch('install');
  const replies = [];
  const message = {source: w.clients[0], data: {type: 'GET_OFFLINE_STATUS'}, ports: [{postMessage: data => replies.push(data)}]};
  await w.dispatch('message', message);
  assert.equal(replies[0].ready, true);
  assert.equal(replies[0].version, '2026.09.26.1');
  w.stores.get(currentCache).delete(scope + 'vendor/chart.umd.min.js');
  await w.dispatch('message', message);
  assert.equal(replies[1].ready, false);
  assert.equal(w.calls.messages.length, 0);
});

test('only an explicit update request from an app entry client activates a waiting worker', async () => {
  const w = worker();
  await w.dispatch('install');
  for (const source of [null, {url: 'https://foreign.example/'}, {url: 'https://example.test/unrelated/'}]) {
    await w.dispatch('message', {source, data: {type: 'ACTIVATE_UPDATE'}});
  }
  await w.dispatch('message', {source: w.clients[0], data: {type: 'SOMETHING_ELSE'}});
  assert.equal(w.calls.skipped, 0);
  await w.dispatch('message', {source: w.clients[0], data: {type: 'ACTIVATE_UPDATE'}});
  assert.equal(w.calls.skipped, 1);
});

test('an evicted asset is recovered online and cached for the next offline opening', async () => {
  const w = worker();
  await w.dispatch('install');
  w.stores.get(currentCache).delete(scope + 'pwa.js');
  const online = await w.dispatch('fetch', {request: request('pwa.js', {mode: 'cors'})});
  assert.equal(online.status, 200);
  w.setOffline(true);
  const offline = await w.dispatch('fetch', {request: request('pwa.js', {mode: 'cors'})});
  assert.equal(await offline.text(), 'file:/gym-workout-tracker/pwa.js');
});

test('cache write failure still permits online use and does not claim complete offline availability', async () => {
  const w = worker({failCacheWrites: true});
  const response = await w.dispatch('fetch', {request: request('pwa.js', {mode: 'cors'})});
  assert.equal(response.status, 200);
  await w.dispatch('message', {source: w.clients[0], data: {type: 'GET_OFFLINE_STATUS'}});
  assert.equal(w.calls.messages[0].data.ready, false);
});

test('unavailable Cache Storage still permits online navigation and reports offline support unavailable', async () => {
  const w = worker({failCacheOpen: true});
  const response = await w.dispatch('fetch', {request: request('index.html')});
  assert.equal(response.status, 200);
  await w.dispatch('message', {source: w.clients[0], data: {type: 'GET_OFFLINE_STATUS'}});
  assert.equal(w.calls.messages[0].data.ready, false);
});

test('a failed network asset response is never saved into the app shell', async () => {
  const w = worker({failPath: 'pwa.js'});
  const response = await w.dispatch('fetch', {request: request('pwa.js', {mode: 'cors'})});
  assert.equal(response.status, 404);
  assert.ok(!w.stores.get(currentCache).has(scope + 'pwa.js'));
});
