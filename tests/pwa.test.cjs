const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../pwa.js'), 'utf8');

function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  target.emit = async (type, event = {}) => {
    for (const listener of listeners.get(type) || []) await listener(event);
  };
  return target;
}

function serviceWorker() {
  return events({state: 'installing', messages: [], postMessage(data, ports) {this.messages.push({data, ports});}});
}

function client({controlled = true, supported = true, secure = true, registerFails = false, waiting = false, installing = false, guard = ''} = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, events({hidden: true, disabled: false, textContent: '', open: false, scrollIntoView() {}, querySelector: () => ({focus() {}})}));
    return elements.get(id);
  };
  const timers = new Map();
  let timerId = 0;
  const channels = [];
  class MessageChannel {
    constructor() {
      this.port1 = {closed: false, close() {this.closed = true;}};
      this.port2 = {postMessage: data => {if (!this.port1.closed) this.port1.onmessage?.({data});}};
      channels.push(this);
    }
  }
  const calls = {register: [], reload: 0, storage: 0, update: 0};
  const registration = events({waiting: waiting ? serviceWorker() : null, installing: installing ? serviceWorker() : null, update: async () => {calls.update++;}});
  const sw = events({controller: controlled ? serviceWorker() : null, register: async (url, options) => {
    calls.register.push({url, options});
    if (registerFails) throw new Error('Registration unavailable');
    return registration;
  }});
  const navigator = {onLine: true, ...(supported ? {serviceWorker: sw} : {})};
  const window = events({isSecureContext: secure, matchMedia: () => ({matches: false}), gymUpdateBlockReason: () => guard, location: {reload() {calls.reload++;}}});
  const context = vm.createContext({navigator, window, document: {getElementById: element}, MessageChannel, console, showTab() {},
    setTimeout: callback => {timers.set(++timerId, callback); return timerId;},
    clearTimeout: id => timers.delete(id),
  });
  Object.defineProperty(context, 'localStorage', {get() {calls.storage++; throw new Error('PWA UI must not access workout storage');}});
  vm.runInContext(source, context);
  return {element, calls, sw, registration, channels, window, navigator, timers,
    flush: () => new Promise(resolve => setImmediate(resolve)),
    setGuard: value => {guard = value;},
    reply: (index, data = {type: 'OFFLINE_STATUS', ready: true, version: '2026.09.26.1'}) => channels[index].port2.postMessage(data),
  };
}

test('registration is relative to the GitHub Pages project path and bypasses the script HTTP cache', async () => {
  const a = client(); await a.flush();
  assert.equal(a.calls.register[0].url, './sw.js');
  assert.equal(a.calls.register[0].options.scope, './');
  assert.equal(a.calls.register[0].options.updateViaCache, 'none');
  assert.equal(a.calls.storage, 0);
});

test('successful registration without a controller cannot claim offline readiness', async () => {
  const a = client({controlled: false}); await a.flush();
  assert.equal(a.channels.length, 0);
  assert.match(a.element('offline-status').textContent, /not ready/);
  await a.sw.emit('message', {data: {type: 'OFFLINE_READY', ready: true}});
  assert.match(a.element('offline-status').textContent, /not ready/);
});

test('offline readiness requires an affirmative acknowledgement from the controlling worker', async () => {
  const a = client(); await a.flush();
  assert.equal(a.sw.controller.messages[0].data.type, 'GET_OFFLINE_STATUS');
  assert.notEqual(a.element('offline-status').textContent, 'Offline ready');
  a.reply(0, {type: 'OFFLINE_STATUS', ready: false});
  assert.match(a.element('offline-status').textContent, /not ready/);
  await a.window.emit('online'); a.reply(1);
  assert.equal(a.element('offline-status').textContent, 'Offline ready');
  a.navigator.onLine = false; await a.window.emit('offline');
  assert.equal(a.element('offline-status').textContent, 'Offline · ready to log');
});

test('an old controller acknowledgement cannot mark a replacement controller ready', async () => {
  const a = client(); await a.flush();
  a.sw.controller = serviceWorker();
  await a.sw.emit('controllerchange');
  a.reply(0);
  assert.notEqual(a.element('offline-status').textContent, 'Offline ready');
  a.reply(1);
  assert.equal(a.element('offline-status').textContent, 'Offline ready');
  assert.equal(a.calls.reload, 0);
});

test('a controller change caused by another tab never reloads this tab', async () => {
  const a = client({waiting: true}); await a.flush();
  a.sw.controller = serviceWorker();
  await a.sw.emit('controllerchange');
  assert.equal(a.calls.reload, 0);
  assert.equal(a.registration.waiting.messages.length, 0);
  assert.equal(a.calls.storage, 0);
});

test('draft, pending restore, or unavailable data safety checks block update activation', async () => {
  const a = client({waiting: true}); await a.flush();
  for (const reason of ['Finish your active workout before updating.', 'Review or cancel your backup restore first.']) {
    a.setGuard(reason);
    await a.element('apply-update').emit('click');
    assert.equal(a.element('update-message').textContent, reason);
  }
  delete a.window.gymUpdateBlockReason;
  await a.element('apply-update').emit('click');
  assert.match(a.element('update-message').textContent, /saving your workout/);
  assert.equal(a.registration.waiting.messages.length, 0);
  assert.equal(a.calls.reload, 0);
  assert.equal(a.element('apply-update').disabled, false);
});

test('explicit update activates the waiting worker and reloads only after controller change with a clear safety guard', async () => {
  const a = client({waiting: true}); await a.flush();
  await a.element('apply-update').emit('click');
  assert.equal(a.registration.waiting.messages[0].data.type, 'ACTIVATE_UPDATE');
  assert.equal(a.calls.reload, 0);
  assert.equal(a.element('apply-update').disabled, true);
  a.sw.controller = serviceWorker();
  await a.sw.emit('controllerchange');
  assert.equal(a.calls.reload, 1);
  assert.equal(a.calls.storage, 0);
});

test('work started while activation is pending prevents a reload even after the new worker takes control', async () => {
  const a = client({waiting: true}); await a.flush();
  await a.element('apply-update').emit('click');
  a.setGuard('Finish your active workout before updating.');
  a.sw.controller = serviceWorker();
  await a.sw.emit('controllerchange');
  assert.equal(a.calls.reload, 0);
  assert.equal(a.element('apply-update').disabled, false);
  assert.match(a.element('update-message').textContent, /Finish your active workout/);
  assert.match(a.element('update-message').textContent, /Reopen/);
});

test('unsupported browsers and insecure origins skip registration without accessing workout storage', async () => {
  for (const options of [{supported: false}, {secure: false}]) {
    const a = client(options); await a.flush();
    assert.equal(a.calls.register.length, 0);
    assert.equal(a.calls.storage, 0);
    assert.equal(a.element('check-update').disabled, true);
    assert.match(a.element('offline-status').textContent, /HTTPS or localhost/);
  }
});

test('registration failure explains retry while leaving workout data alone', async () => {
  const a = client({registerFails: true}); await a.flush();
  assert.equal(a.calls.storage, 0);
  assert.equal(a.calls.reload, 0);
  assert.match(a.element('check-update-message').textContent, /could not finish/);
  assert.match(a.element('check-update-message').textContent, /data is unchanged/);
});

test('an installation already underway when registration resolves still reveals the waiting update', async () => {
  const a = client({installing: true}); await a.flush();
  assert.equal(a.element('app-update').hidden, true);
  a.registration.waiting = a.registration.installing;
  a.registration.installing.state = 'installed';
  await a.registration.installing.emit('statechange');
  assert.equal(a.element('app-update').hidden, false);
});

test('first installation never offers an update for its brief waiting state', async () => {
  const a = client({controlled:false, installing:true}); await a.flush();
  a.registration.waiting = a.registration.installing;
  a.registration.installing.state = 'installed';
  await a.registration.installing.emit('statechange');
  assert.equal(a.element('app-update').hidden, true);
  a.registration.waiting = null; a.sw.controller = serviceWorker();
  await a.sw.emit('controllerchange');
  assert.equal(a.element('app-update').hidden, true);
  assert.equal(a.calls.reload, 0);
});
test('another tab activating an update clears the obsolete update banner', async () => {
  const a = client({waiting:true}); await a.flush();
  assert.equal(a.element('app-update').hidden, false);
  a.registration.waiting = null; a.sw.controller = serviceWorker();
  await a.sw.emit('controllerchange');
  assert.equal(a.element('app-update').hidden, true);
  assert.equal(a.calls.reload, 0);
});
