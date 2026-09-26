/* Installation and offline UI. Workout storage belongs entirely to index.html. */
(() => {
  'use strict';
  const VERSION = '2026.09.26.1';
  const el = id => document.getElementById(id);
  let registration, installPrompt, offlineReady = false, applyingUpdate = false, updateTimer;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  el('app-version').textContent = `App version ${VERSION}`;
  if (standalone) {
    el('install-context').textContent = 'You are using the installed app. If your Safari history is missing here, follow the backup transfer steps below.';
    el('open-install-guide').textContent = 'Offline & transfer help';
  }
  el('open-install-guide').addEventListener('click', () => {
    showTab('data');
    el('install-guide').open = true;
    el('install-guide').scrollIntoView({block:'start', behavior:'smooth'});
    el('install-guide').querySelector('summary').focus();
  });
  function renderStatus() {
    el('offline-status').textContent = offlineReady
      ? (navigator.onLine ? 'Offline ready' : 'Offline · ready to log')
      : (navigator.onLine ? 'Offline access not ready — open help to retry' : 'Connect to set up offline access');
  }
  function checkOfflineStatus() {
    const worker = navigator.serviceWorker?.controller;
    offlineReady = false;
    if (!worker) { renderStatus(); return; }
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); renderStatus(); }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      if (worker !== navigator.serviceWorker.controller) return;
      offlineReady = event.data?.type === 'OFFLINE_STATUS' && event.data.ready === true;
      renderStatus();
    };
    worker.postMessage({type:'GET_OFFLINE_STATUS'}, [channel.port2]);
  }
  function showWaitingUpdate() {
    el('app-update').hidden = !navigator.serviceWorker.controller || !registration?.waiting;
  }
  function updateBlockReason() {
    return typeof window.gymUpdateBlockReason === 'function'
      ? window.gymUpdateBlockReason()
      : 'Reload the app after saving your workout to update safely.';
  }
  el('apply-update').addEventListener('click', () => {
    if (applyingUpdate || !registration?.waiting) return;
    const reason = updateBlockReason();
    el('update-message').textContent = reason;
    if (reason) return;
    applyingUpdate = true;
    el('apply-update').disabled = true;
    el('update-message').textContent = 'Updating…';
    updateTimer = setTimeout(() => {
      applyingUpdate = false;
      el('apply-update').disabled = false;
      el('update-message').textContent = 'Update has not finished. Try again when connected.';
    }, 10000);
    registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
  });
  window.addEventListener('online', checkOfflineStatus);
  window.addEventListener('offline', renderStatus);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    el('install-app').hidden = standalone;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    el('install-app').hidden = true;
    el('install-message').textContent = 'App added. Open it from its icon and check your workout history.';
  });
  el('install-app').addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    el('install-app').hidden = true;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { el('install-message').textContent = 'Use your browser menu to add the app to your Home Screen.'; }
  });
  async function setupOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      el('offline-status').textContent = 'Offline setup requires HTTPS or localhost';
      el('check-update-message').textContent = 'Open the GitHub Pages website in Safari or another browser that supports offline apps.';
      el('check-update').disabled = true;
      return;
    }
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
      showWaitingUpdate();
      const watchInstalling = installing => {
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') showWaitingUpdate();
          if (installing.state === 'redundant') renderStatus();
        });
      };
      registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
      // Registration may resolve after updatefound has already fired.
      watchInstalling(registration.installing);
      checkOfflineStatus();
    } catch {
      renderStatus();
      el('check-update-message').textContent = 'Offline setup could not finish. Connect and tap Check for updates to retry. Your workout data is unchanged.';
    }
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      checkOfflineStatus();
      showWaitingUpdate();
      if (!applyingUpdate) return; // An update in another tab must never interrupt this workout.
      applyingUpdate = false;
      clearTimeout(updateTimer);
      el('apply-update').disabled = false;
      const reason = updateBlockReason();
      if (!reason) window.location.reload();
      else {
        el('app-update').hidden = false;
        el('update-message').textContent = `${reason} Reopen the app afterwards to use the update.`;
      }
    });
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'OFFLINE_READY') checkOfflineStatus();
    });
  }
  el('check-update').addEventListener('click', async () => {
    el('check-update').disabled = true;
    el('check-update-message').textContent = 'Checking…';
    try {
      if (!registration) await setupOffline();
      if (!registration) return;
      await registration.update();
      showWaitingUpdate();
      checkOfflineStatus();
      el('check-update-message').textContent = registration.waiting ? 'A new version is ready. Use Update app above.'
        : registration.installing ? 'Downloading the app for offline use…' : 'Update check complete.';
    } catch { el('check-update-message').textContent = 'Could not check for updates. Try again when connected.'; }
    finally { el('check-update').disabled = false; }
  });
  setupOffline();
})();
