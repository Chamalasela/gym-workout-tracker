'use strict';

// Change the release whenever any app-shell file changes. Workout data stays in
// localStorage; this worker only caches the files needed to open the app.
const RELEASE = '2026.09.26.1';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `gym-tracker-shell:${encodeURIComponent(SCOPE.pathname)}:`;
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const SHELL_URLS = [
  'index.html',
  'pwa.js',
  'manifest.webmanifest',
  'vendor/chart.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
].map(path => new URL(path, SCOPE).href);
const INDEX_URL = SHELL_URLS[0];
const SHELL_PATHS = new Map(SHELL_URLS.map(url => [new URL(url).pathname, url]));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const alreadyExists = (await caches.keys()).includes(CACHE_NAME);
    try {
      const cache = await caches.open(CACHE_NAME);
      // addAll fails the installation if even one file is unavailable, so an
      // incomplete release never replaces the working offline version.
      await cache.addAll(SHELL_URLS.map(url => new Request(url, {cache: 'reload'})));
    } catch (error) {
      // A failed reinstallation must not delete an existing working cache.
      if (!alreadyExists) await caches.delete(CACHE_NAME);
      throw error;
    }
    // Updates wait until the app explicitly requests ACTIVATE_UPDATE.
  })());
});

async function offlineStatus() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const responses = await Promise.all(SHELL_URLS.map(url => cache.match(url)));
    return {type: 'OFFLINE_STATUS', version: RELEASE, ready: responses.every(Boolean), scope: SCOPE.href};
  } catch {
    return {type: 'OFFLINE_STATUS', version: RELEASE, ready: false, scope: SCOPE.href};
  }
}

function isAppClient(client) {
  if (!client || !client.url) return false;
  const url = new URL(client.url);
  return url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.href.split('?')[0].split('#')[0] === INDEX_URL);
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
    const status = await offlineStatus();
    const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: false});
    for (const client of clients) {
      if (isAppClient(client)) client.postMessage({...status, type: 'OFFLINE_READY'});
    }
  })());
});

async function cachedFile(request, cacheURL) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheURL);
    if (cached) return cached;
  } catch {
    // Some browser privacy/storage settings can make Cache Storage unavailable.
    return fetch(request);
  }
  // If the browser evicted an individual file, recover it when online.
  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') {
    try { await cache.put(cacheURL, response.clone()); } catch { /* Still allow online use if storage is full. */ }
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  let cacheURL = SHELL_PATHS.get(url.pathname);
  if (request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname)) {
    // Old shared links use ?v=...; every app entry opens the active release.
    cacheURL = INDEX_URL;
  }
  if (cacheURL) event.respondWith(cachedFile(request, cacheURL));
});

self.addEventListener('message', event => {
  if (!isAppClient(event.source)) return;
  if (event.data?.type === 'ACTIVATE_UPDATE') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'GET_OFFLINE_STATUS') {
    event.waitUntil((async () => {
      const status = await offlineStatus();
      if (event.ports?.[0]) event.ports[0].postMessage(status);
      else event.source.postMessage(status);
    })());
  }
});
