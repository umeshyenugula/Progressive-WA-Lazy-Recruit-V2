/**
 * api.js — Offline-first data layer for Club Recruitment
 * Local source of truth: IndexedDB
 */

const API_BASE = localStorage.getItem('crm_api_base') || 'http://127.0.0.1:8000/api';

function redirectToLogin() {
  const p = window.location.pathname;
  window.location.href = (p.includes('/admin/') || p.includes('/superadmin/'))
    ? '../index.html'
    : 'index.html';
}

function getToken() { return sessionStorage.getItem('crm_token') || null; }
function getUser() {
  try { return JSON.parse(sessionStorage.getItem('crm_user')); } catch { return null; }
}
function saveSession(token, user) {
  sessionStorage.setItem('crm_token', token);
  sessionStorage.setItem('crm_user', JSON.stringify(user));
}
function clearSession() { sessionStorage.clear(); }

const DB_NAME = 'crm_offline_v1';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_CANDIDATES = 'candidates';
const STORE_DOMAINS = 'domains';
const STORE_QUESTIONS = 'questions';
const STORE_EVALUATIONS = 'evaluations';
const AUTO_SYNC_INTERVAL_MS = 60000;
const AUTO_SYNC_KEY = 'crm_auto_sync_enabled';
const FULLSCREEN_ACK_KEY = 'crm_fullscreen_ack_v1';

let autoSyncTimer = null;
let autoSyncInFlight = false;
let autoRefreshInFlight = false;
let autoMaintenanceInFlight = false;

function isAutoSyncEnabled() {
  return localStorage.getItem(AUTO_SYNC_KEY) !== '0';
}

function setAutoSyncEnabled(enabled) {
  localStorage.setItem(AUTO_SYNC_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent('crm:auto-sync-setting-changed', { detail: { enabled: !!enabled } }));
}

function shouldUseOfflineMode() {
  const user = getUser();
  return !!user && user.role !== 'superadmin';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_CANDIDATES)) db.createObjectStore(STORE_CANDIDATES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_DOMAINS)) db.createObjectStore(STORE_DOMAINS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) db.createObjectStore(STORE_QUESTIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_EVALUATIONS)) db.createObjectStore(STORE_EVALUATIONS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txReadAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function txGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function txPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function txPutMany(storeName, values) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const s = tx.objectStore(storeName);
    (values || []).forEach(v => s.put(v));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function txDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function txClear(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function nowIso() { return new Date().toISOString(); }
function setUnsyncedState(flag) {
  window.__crmHasUnsyncedChanges = !!flag;
  window.dispatchEvent(new CustomEvent('crm:sync-state-changed', { detail: { hasUnsynced: !!flag } }));
}

async function refreshUnsyncedState() {
  try {
    setUnsyncedState(await hasUnsyncedData());
  } catch {}
}

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function offlineReadyKey(userId) { return `offline_ready_${userId}`; }

function emitSetup(msg, step = 0, total = 0) {
  window.dispatchEvent(new CustomEvent('crm:offline-setup-progress', { detail: { message: msg, step, total } }));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!shouldUseOfflineMode()) return;
  try {
    const p = window.location.pathname;
    const swPath = (p.includes('/admin/') || p.includes('/superadmin/')) ? '../sw.js' : 'sw.js';
    await navigator.serviceWorker.register(swPath);
  } catch {}
}

async function disableOfflineRuntime() {
  stopAutoSyncLoop();

  if (document.getElementById('offline-indicator')) {
    document.getElementById('offline-indicator').remove();
  }
  if (document.getElementById('crm-fullscreen-gate')) {
    document.getElementById('crm-fullscreen-gate').remove();
  }

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    } catch {}
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch {}
  }
}

async function apiFetchRemote(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { cache: 'no-store', ...options, headers });
  } catch {
    throw new Error('Network unavailable');
  }

  if (res.status === 401) {
    if (token) {
      clearSession();
      redirectToLogin();
      throw new Error('Session expired');
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const err = await res.json();
      msg = err.detail || JSON.stringify(err);
    } catch {}
    throw new Error(msg);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  if (ct.includes('spreadsheetml')) return res.blob();
  return res.text();
}

function apiFetchRemoteWithProgress(endpoint, options = {}, onProgress) {
  const token = getToken();
  const method = options.method || 'POST';
  const body = options.body ?? null;
  const headers = { ...(options.headers || {}) };
  const isFormData = body instanceof FormData;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE}${endpoint}`, true);
    xhr.responseType = 'text';

    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    Object.entries(headers).forEach(([key, value]) => {
      if (String(key).toLowerCase() === 'content-type' && isFormData) return;
      xhr.setRequestHeader(key, value);
    });
    if (!isFormData && body != null && !Object.keys(headers).some(key => String(key).toLowerCase() === 'content-type')) {
      xhr.setRequestHeader('Content-Type', 'application/json');
    }

    let seenLength = 0;
    let buffered = '';
    let finalResult = null;

    function emitLine(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (typeof onProgress === 'function') {
        onProgress(payload);
      }
      if (payload?.type === 'done') {
        finalResult = payload.result ?? payload;
      }
    }

    function flushBuffer(force = false) {
      const currentText = xhr.responseText || '';
      if (currentText.length > seenLength) {
        buffered += currentText.slice(seenLength);
        seenLength = currentText.length;
      }

      const parts = buffered.split(/\r?\n/);
      buffered = force ? '' : (parts.pop() ?? '');
      parts.forEach(emitLine);

      if (force) {
        emitLine(buffered);
        buffered = '';
      }
    }

    xhr.upload.onprogress = event => {
      if (typeof onProgress !== 'function') return;
      if (!event.lengthComputable) {
        onProgress({ phase: 'uploading', loaded: event.loaded, total: null, percent: null });
        return;
      }
      const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
      onProgress({ phase: 'uploading', loaded: event.loaded, total: event.total, percent });
    };

    xhr.onprogress = () => {
      flushBuffer(false);
    };

    xhr.onload = () => {
      flushBuffer(true);

      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok) {
        let msg = `Error ${xhr.status}`;
        try {
          const err = JSON.parse(xhr.responseText || '{}');
          msg = err.detail || JSON.stringify(err);
        } catch {
          msg = xhr.responseText || msg;
        }
        if (xhr.status === 401) {
          if (token) {
            clearSession();
            redirectToLogin();
            reject(new Error('Session expired'));
            return;
          }
          reject(new Error('Unauthorized'));
          return;
        }
        reject(new Error(msg));
        return;
      }

      if (finalResult != null) {
        resolve(finalResult);
        return;
      }
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(xhr.responseText || 'null'));
        } catch (err) {
          reject(err);
        }
        return;
      }
      resolve(xhr.responseText);
    };

    xhr.onerror = () => reject(new Error('Network unavailable'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));

    try {
      xhr.send(body);
    } catch (err) {
      reject(err);
    }
  });
}

async function isOfflineReady() {
  if (!shouldUseOfflineMode()) return false;
  const user = getUser();
  if (!user) return false;
  const rec = await txGet(STORE_META, offlineReadyKey(user.id));
  return !!(rec && rec.value === true);
}

async function setOfflineReady(value) {
  if (!shouldUseOfflineMode()) return;
  const user = getUser();
  if (!user) return;
  await txPut(STORE_META, { key: offlineReadyKey(user.id), value: !!value, updated_at: nowIso() });
}

async function snapshotRemoteData() {
  const user = getUser();
  const domains = await apiFetchRemote('/domains/');
  const questionsPairs = await Promise.all(domains.map(d =>
    apiFetchRemote(`/domains/${d.id}/criteria`).then(list => [d.id, list]).catch(() => [d.id, []])
  ));
  const candidates = await apiFetchRemote('/candidates/');

  // Fetch full evaluation records (with users/domains joins) explicitly
  // so admin names/emails survive refresh/login cycles even if list payload
  // is partial in some deployments.
  const evalPairs = await Promise.all((candidates || []).map(c =>
    apiFetchRemote(`/evaluations/candidate/${c.id}`)
      .then(list => [c.id, list || []])
      .catch(() => [c.id, []])
  ));
  const evaluationsByCandidate = Object.fromEntries(evalPairs);

  let admins = [];
  if (user?.role === 'superadmin') {
    try { admins = await apiFetchRemote('/admins/'); } catch { admins = []; }
  }
  return { candidates, domains, questionsPairs, admins, evaluationsByCandidate };
}

function normalizeCandidate(raw) {
  return {
    ...raw,
    candidate_domains: raw.candidate_domains || [],
    evaluations: raw.evaluations || [],
    synced: true,
    dirty: false,
    updated_at: raw.updated_at || raw.created_at || nowIso(),
  };
}

function normalizeEvaluation(raw) {
  return {
    ...raw,
    users: raw.users || null,
    synced: true,
    dirty: false,
    updated_at: raw.updated_at || raw.created_at || nowIso(),
  };
}

function evaluationIdentity(rec) {
  if (!rec) return '';
  if (rec.candidate_id && rec.domain_id && rec.admin_id) {
    return `${rec.candidate_id}|${rec.domain_id}|${rec.admin_id}`;
  }
  return String(rec.id || '');
}

function sameId(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function mergeByIdKeepingDirty(localRows, remoteRows) {
  const out = new Map((remoteRows || []).map(r => [String(r.id), r]));
  (localRows || []).forEach(l => {
    if (l?.dirty === true || l?.synced === false) {
      out.set(String(l.id), l);
    }
  });
  return [...out.values()];
}

function mergeEvaluationsKeepingDirty(localRows, remoteRows) {
  const out = new Map((remoteRows || []).map(r => [evaluationIdentity(r), r]));
  (localRows || []).forEach(l => {
    const key = evaluationIdentity(l);
    const remote = out.get(key);
    const localTs = Date.parse(l?.updated_at || '') || 0;
    const remoteTs = Date.parse(remote?.updated_at || '') || 0;
    const remoteHasUsers = !!(remote?.users && (remote.users.full_name || remote.users.email));
    const localHasUsers = !!(l?.users && (l.users.full_name || l.users.email));

    // Preserve evaluator identity metadata if newer remote omitted it.
    if (remote && !remoteHasUsers && localHasUsers) {
      out.set(key, { ...remote, users: l.users });
    }

    // Keep local record if pending, if remote counterpart is missing,
    // or if local timestamp is newer than remote snapshot.
    if (l?.dirty === true || l?.synced === false || !remote || localTs > remoteTs) {
      out.set(key, l);
    }
  });
  return [...out.values()];
}

async function persistRemoteSnapshot(snapshot) {
  const [localCandidates, localEvaluations] = await Promise.all([
    txReadAll(STORE_CANDIDATES),
    txReadAll(STORE_EVALUATIONS),
  ]);

  const allCandidates = (snapshot.candidates || []).map(normalizeCandidate);

  // Use map keyed by identity to avoid duplicate rows from embedded + explicit feeds.
  const remoteEvalMap = new Map();

  // 1) Embedded evals from /candidates list (may be partial in some deployments)
  for (const c of allCandidates) {
    for (const e of (c.evaluations || [])) {
      const normalized = normalizeEvaluation({
        ...e,
        candidate_id: e.candidate_id || c.id,
      });
      remoteEvalMap.set(evaluationIdentity(normalized), normalized);
    }
  }

  // 2) Explicit evals from /evaluations/candidate/{id} (full joined records)
  const explicitByCandidate = snapshot.evaluationsByCandidate || {};
  for (const [candidateId, evList] of Object.entries(explicitByCandidate)) {
    for (const e of (evList || [])) {
      const normalized = normalizeEvaluation({
        ...e,
        candidate_id: e.candidate_id || candidateId,
      });
      const key = evaluationIdentity(normalized);
      const existing = remoteEvalMap.get(key);

      // Prefer explicit record when it carries richer relation fields.
      const explicitHasUsers = !!(normalized?.users && (normalized.users.full_name || normalized.users.email));
      const existingHasUsers = !!(existing?.users && (existing.users.full_name || existing.users.email));
      if (!existing || explicitHasUsers || !existingHasUsers) {
        remoteEvalMap.set(key, normalized);
      }
    }
  }

  const remoteEvaluations = [...remoteEvalMap.values()];

  const mergedCandidates = mergeByIdKeepingDirty(localCandidates, allCandidates);
  const mergedEvaluations = mergeEvaluationsKeepingDirty(localEvaluations, remoteEvaluations);

  await Promise.all([
    txClear(STORE_DOMAINS),
    txClear(STORE_QUESTIONS),
  ]);

  await txPutMany(STORE_CANDIDATES, mergedCandidates);
  await txPutMany(STORE_DOMAINS, snapshot.domains || []);

  const qRows = [];
  (snapshot.questionsPairs || []).forEach(([domainId, list]) => {
    (list || []).forEach(q => qRows.push({ ...q, domain_id: q.domain_id || domainId }));
  });
  await txPutMany(STORE_QUESTIONS, qRows);
  await txPutMany(STORE_EVALUATIONS, mergedEvaluations);

  await txPut(STORE_META, { key: 'admins_cache', value: snapshot.admins || [], updated_at: nowIso() });
  await txPut(STORE_META, { key: 'cache_last_refresh', value: nowIso(), updated_at: nowIso() });
}

async function prepareOfflineMode() {
  if (!shouldUseOfflineMode()) return { skipped: true };
  if (!navigator.onLine) throw new Error('Internet is required for first-time offline setup.');
  emitSetup('Preparing Offline Mode... Downloading Data', 1, 4);
  await registerServiceWorker();
  emitSetup('Downloading candidates, domains, and questions...', 2, 4);
  const snapshot = await snapshotRemoteData();
  emitSetup('Saving data securely in local storage...', 3, 4);
  await persistRemoteSnapshot(snapshot);
  await setOfflineReady(true);
  await refreshUnsyncedState();
  emitSetup('Offline setup complete', 4, 4);
}

async function refreshLocalCacheFromServer() {
  if (!shouldUseOfflineMode()) {
    const [candidates, domains] = await Promise.all([
      apiFetchRemote('/candidates/'),
      apiFetchRemote('/domains/'),
    ]);
    return { candidates: (candidates || []).length, domains: (domains || []).length, evaluations: 0, remoteOnly: true };
  }
  if (!navigator.onLine) throw new Error('Refresh requires internet connection.');
  if (!getUser() || !getToken()) throw new Error('Please login first.');

  await registerServiceWorker();
  if (navigator.serviceWorker?.getRegistration) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.update) await reg.update();
    } catch {}
  }

  const snapshot = await snapshotRemoteData();
  await persistRemoteSnapshot(snapshot);
  await refreshUnsyncedState();

  const evalCount = (snapshot.candidates || []).reduce(
    (sum, c) => sum + ((snapshot.evaluationsByCandidate?.[c.id] || c.evaluations || []).length),
    0,
  );

  return {
    candidates: (snapshot.candidates || []).length,
    domains: (snapshot.domains || []).length,
    evaluations: evalCount,
  };
}

function installNetworkIndicator() {
  if (!shouldUseOfflineMode()) return;
  if (document.getElementById('offline-indicator')) return;
  const bar = document.createElement('div');
  bar.id = 'offline-indicator';
  bar.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:#f59e0b;box-shadow:0 8px 24px rgba(0,0,0,.15);display:none;';
  bar.textContent = 'Offline Mode';
  document.body.appendChild(bar);

  function update() {
    const offline = !navigator.onLine;
    bar.style.display = offline ? 'block' : 'none';
    document.querySelectorAll('.js-network-required').forEach(btn => {
      btn.disabled = offline;
      if (offline) btn.title = 'Unavailable while offline';
      else btn.title = '';
    });
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function isProtectedAppPage() {
  const p = String(window.location.pathname || '').toLowerCase();
  return p.includes('/admin/') || p.includes('/superadmin/');
}

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

function isFullscreenAcknowledged() {
  return localStorage.getItem(FULLSCREEN_ACK_KEY) === '1';
}

function setFullscreenAcknowledged(value) {
  if (value) localStorage.setItem(FULLSCREEN_ACK_KEY, '1');
  else localStorage.removeItem(FULLSCREEN_ACK_KEY);
}

async function requestFullscreenSafe() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!fn) throw new Error('Fullscreen API not supported');
  return fn.call(el);
}

function installFullscreenGate() {
  if (!isProtectedAppPage() || !shouldUseOfflineMode()) return;
  if (document.getElementById('crm-fullscreen-gate')) return;
  if (isFullscreenAcknowledged()) return;

  if (isFullscreenActive()) {
    setFullscreenAcknowledged(true);
    return;
  }

  const gate = document.createElement('div');
  gate.id = 'crm-fullscreen-gate';
  gate.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(255,255,255,.92);z-index:100001;';
  gate.innerHTML = `
    <div style="width:min(380px,92vw);background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px 20px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,.1);">
      <h3 style="margin:0 0 8px;font-family:var(--font-body);font-size:1.02rem;font-weight:700;color:#111827;">Fullscreen Required</h3>
      <p style="margin:0 0 14px;color:#6b7280;font-size:.88rem;">Enter fullscreen mode to continue.</p>
      <button id="crm-btn-enter-fullscreen" class="btn btn-primary" style="width:100%;justify-content:center;">Enter Fullscreen</button>
      <p id="crm-fullscreen-error" style="margin:10px 0 0;color:#b91c1c;font-size:.8rem;display:none;">Could not enter fullscreen. Try again or press F11.</p>
    </div>
  `;
  document.body.appendChild(gate);

  const btn = document.getElementById('crm-btn-enter-fullscreen');
  const err = document.getElementById('crm-fullscreen-error');

  const updateGate = () => {
    gate.style.display = isFullscreenActive() ? 'none' : 'flex';
  };

  btn.addEventListener('click', async () => {
    err.style.display = 'none';
    try {
      await requestFullscreenSafe();
      setFullscreenAcknowledged(true);
      updateGate();
    } catch {
      err.style.display = 'block';
      updateGate();
    }
  });

  document.addEventListener('fullscreenchange', updateGate);
  document.addEventListener('webkitfullscreenchange', updateGate);
  document.addEventListener('msfullscreenchange', updateGate);
  updateGate();
}

async function hasUnsyncedData() {
  const [cs, es] = await Promise.all([txReadAll(STORE_CANDIDATES), txReadAll(STORE_EVALUATIONS)]);
  return cs.some(c => c.synced === false) || es.some(e => e.synced === false);
}

async function tryAutoSync(reason = 'interval') {
  if (!shouldUseOfflineMode()) return;
  if (autoSyncInFlight) return;
  if (!isAutoSyncEnabled()) return;
  if (!navigator.onLine) return;
  if (!getUser() || !getToken()) return;

  const pending = await hasUnsyncedData();
  if (!pending) return;

  autoSyncInFlight = true;
  try {
    await syncUnsyncedToServer();
  } catch {
    // Silent retry on next tick/online event.
  } finally {
    autoSyncInFlight = false;
    window.dispatchEvent(new CustomEvent('crm:auto-sync-attempt', { detail: { reason, at: nowIso() } }));
  }
}

async function tryAutoRefresh(reason = 'interval') {
  if (!shouldUseOfflineMode()) return;
  if (autoRefreshInFlight) return;
  if (!isAutoSyncEnabled()) return;
  if (!navigator.onLine) return;
  if (!getUser() || !getToken()) return;

  autoRefreshInFlight = true;
  try {
    await refreshLocalCacheFromServer();
  } catch {
    // Silent retry on next tick/online event.
  } finally {
    autoRefreshInFlight = false;
    window.dispatchEvent(new CustomEvent('crm:auto-refresh-attempt', { detail: { reason, at: nowIso() } }));
  }
}

async function runAutoMaintenanceTick(reason = 'interval') {
  if (autoMaintenanceInFlight) return;
  autoMaintenanceInFlight = true;
  try {
    await tryAutoSync(reason);
    await tryAutoRefresh(reason);
  } finally {
    autoMaintenanceInFlight = false;
  }
}

function startAutoSyncLoop() {
  if (!isProtectedAppPage() || !shouldUseOfflineMode()) return;
  if (autoSyncTimer) return;

  autoSyncTimer = window.setInterval(() => {
    runAutoMaintenanceTick('interval');
  }, AUTO_SYNC_INTERVAL_MS);

  window.addEventListener('online', () => runAutoMaintenanceTick('online'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runAutoMaintenanceTick('visible');
  });

  setTimeout(() => { runAutoMaintenanceTick('startup'); }, 1200);
}

function stopAutoSyncLoop() {
  if (!autoSyncTimer) return;
  window.clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

function setAutoSyncRuntime(enabled) {
  setAutoSyncEnabled(enabled);
  if (enabled) {
    startAutoSyncLoop();
    runAutoMaintenanceTick('toggle-on');
  } else {
    stopAutoSyncLoop();
  }
  return { enabled: !!enabled };
}

async function getLocalSyncStats() {
  if (!shouldUseOfflineMode()) {
    return { pending: 0, uploaded: 0, lastSyncAt: null };
  }
  const [candidates, evaluations, meta] = await Promise.all([
    txReadAll(STORE_CANDIDATES),
    txReadAll(STORE_EVALUATIONS),
    txReadAll(STORE_META),
  ]);

  const pending = [...candidates, ...evaluations].filter(row => row.synced === false || row.dirty === true).length;
  const uploaded = [...candidates, ...evaluations].filter(row => row.synced === true && row.dirty !== true).length;
  const metaMap = Object.fromEntries((meta || []).map(row => [row.key, row.value]));

  return {
    pending,
    uploaded,
    lastSyncAt: metaMap.last_sync_at || metaMap.cache_last_refresh || null,
  };
}

function inferEditType(row) {
  const created = Date.parse(row?.created_at || '');
  const updated = Date.parse(row?.updated_at || '');
  if (Number.isFinite(created) && Number.isFinite(updated)) {
    return Math.abs(updated - created) <= 5000 ? 'create' : 'update';
  }
  return 'update';
}

async function getPendingUploadPreview() {
  const [candidates, evaluations, user] = await Promise.all([
    txReadAll(STORE_CANDIDATES),
    txReadAll(STORE_EVALUATIONS),
    Promise.resolve(getUser()),
  ]);

  const isPendingSync = row => row.synced === false || row.dirty === true;
  const pendingParticipants = candidates.filter(isPendingSync);
  const pendingEvaluations = evaluations.filter(isPendingSync);

  const rows = [];

  pendingParticipants.forEach(c => {
    const payload = {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone || null,
      roll_number: c.roll_number || null,
      branch: c.branch || null,
      section: c.section || null,
      year: c.year || null,
      skills: c.skills || null,
      experience: c.experience || null,
      status: c.status || 'pending',
      extra_data: c.extra_data || {},
      created_by: c.created_by || user?.id || null,
      updated_at: c.updated_at || nowIso(),
      candidate_domains: (c.candidate_domains || []).map(cd => cd.domain_id),
    };
    rows.push({
      entity: 'participant',
      edit_type: inferEditType(c),
      id: c.id,
      updated_at: payload.updated_at,
      payload,
    });
  });

  pendingEvaluations.forEach(e => {
    const payload = {
      id: e.id,
      candidate_id: e.candidate_id,
      domain_id: e.domain_id,
      admin_id: e.admin_id,
      round_number: e.round_number || 1,
      scores: e.scores || {},
      total_score: e.total_score || 0,
      remarks: e.remarks || null,
      updated_at: e.updated_at || nowIso(),
    };
    rows.push({
      entity: 'evaluation',
      edit_type: inferEditType(e),
      id: e.id,
      updated_at: payload.updated_at,
      payload,
    });
  });

  rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  return {
    total: rows.length,
    participants: pendingParticipants.length,
    evaluations: pendingEvaluations.length,
    rows,
  };
}

function installUnsyncedGuard() {
  window.addEventListener('beforeunload', (e) => {
    if (window.__crmHasUnsyncedChanges) {
      e.preventDefault();
      e.returnValue = 'Unsynced data may be lost. Are you sure?';
    }
  });
}

async function rebuildCandidateView(candidate) {
  const [evals, domains] = await Promise.all([txReadAll(STORE_EVALUATIONS), txReadAll(STORE_DOMAINS)]);
  const dmap = Object.fromEntries((domains || []).map(d => [d.id, d]));
  const cEvals = evals.filter(e => sameId(e.candidate_id, candidate.id));
  const cDomains = (candidate.candidate_domains || []).map(cd => ({
    domain_id: cd.domain_id,
    domains: dmap[cd.domain_id] ? { id: dmap[cd.domain_id].id, name: dmap[cd.domain_id].name } : null,
  }));
  return { ...candidate, candidate_domains: cDomains, evaluations: cEvals };
}

async function syncUnsyncedToServer() {
  if (!navigator.onLine) throw new Error('No internet connection.');

  const [candidates, evaluations, user] = await Promise.all([
    txReadAll(STORE_CANDIDATES),
    txReadAll(STORE_EVALUATIONS),
    Promise.resolve(getUser()),
  ]);

  const isPendingSync = row => row.synced === false || row.dirty === true;

  const unsyncedParticipants = candidates.filter(isPendingSync).map(c => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone || null,
    roll_number: c.roll_number || null,
    branch: c.branch || null,
    section: c.section || null,
    year: c.year || null,
    skills: c.skills || null,
    experience: c.experience || null,
    status: c.status || 'pending',
    extra_data: c.extra_data || {},
    created_by: c.created_by || user?.id || null,
    updated_at: c.updated_at || nowIso(),
    candidate_domains: (c.candidate_domains || []).map(cd => cd.domain_id),
  }));

  const unsyncedEvals = evaluations.filter(isPendingSync).map(e => ({
    id: e.id,
    candidate_id: e.candidate_id,
    domain_id: e.domain_id,
    admin_id: e.admin_id,
    round_number: e.round_number || 1,
    scores: e.scores || {},
    total_score: e.total_score || 0,
    remarks: e.remarks || null,
    updated_at: e.updated_at || nowIso(),
  }));

  if (!unsyncedParticipants.length && !unsyncedEvals.length) {
    return { participants: { uploaded: 0 }, evaluations: { uploaded: 0 } };
  }

  const result = await apiFetchRemote('/sync/upload', {
    method: 'POST',
    body: JSON.stringify({ participants: unsyncedParticipants, evaluations: unsyncedEvals }),
  });

  const participantErrorIds = new Set((result.participants?.errors || []).map(e => e.id));
  const participantSkippedIds = new Set((result.participants?.skipped_ids || []).map(String));
  for (const c of candidates) {
    if (isPendingSync(c) && !participantErrorIds.has(c.id) && !participantSkippedIds.has(String(c.id))) {
      c.synced = true;
      c.dirty = false;
      await txPut(STORE_CANDIDATES, c);
    }
  }

  const evalErrorIds = new Set((result.evaluations?.errors || []).map(e => e.id));
  const evalSkippedIds = new Set((result.evaluations?.skipped_ids || []).map(String));
  for (const e of evaluations) {
    if (isPendingSync(e) && !evalErrorIds.has(e.id) && !evalSkippedIds.has(String(e.id))) {
      e.synced = true;
      e.dirty = false;
      await txPut(STORE_EVALUATIONS, e);
    }
  }

  await txPut(STORE_META, { key: 'last_sync_at', value: nowIso(), updated_at: nowIso() });
  await refreshUnsyncedState();

  return result;
}

async function exportUnsyncedBackup() {
  const [candidates, evaluations] = await Promise.all([txReadAll(STORE_CANDIDATES), txReadAll(STORE_EVALUATIONS)]);
  const isPendingSync = row => row.synced === false || row.dirty === true;
  const unsyncedCandidates = candidates.filter(isPendingSync);
  const unsyncedEvaluations = evaluations.filter(isPendingSync);
  const backupCandidates = candidates;
  const backupEvaluations = evaluations;

  const escXml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const row = (cells) => `<Row>${cells.map(v => `<Cell><Data ss:Type="String">${escXml(v)}</Data></Cell>`).join('')}</Row>`;

  const participantHeader = ['id', 'type', 'name', 'email', 'phone', 'roll_number', 'branch', 'section', 'year', 'skills', 'experience', 'status', 'extra_data', 'candidate_domains', 'updated_at'];
  const participantRows = [row(participantHeader)].concat(
    backupCandidates.map(c => row([
      c.id,
      'participant',
      c.name,
      c.email,
      c.phone || '',
      c.roll_number || '',
      c.branch || '',
      c.section || '',
      c.year || '',
      c.skills || '',
      c.experience || '',
      c.status || 'pending',
      JSON.stringify(c.extra_data || {}),
      (c.candidate_domains || []).map(cd => cd.domain_id).join(','),
      c.updated_at || nowIso(),
    ]))
  ).join('');

  const evalHeader = ['id', 'type', 'candidate_id', 'domain_id', 'admin_id', 'round_number', 'scores', 'overall_rating', 'final_general_remarks', 'total_score', 'remarks', 'updated_at'];
  const evalRows = [row(evalHeader)].concat(
    backupEvaluations.map(e => row([
      e.id,
      'evaluation',
      e.candidate_id,
      e.domain_id,
      e.admin_id,
      String(e.round_number || 1),
      JSON.stringify(e.scores || {}),
      String(e.scores?.overall_rating ?? ''),
      String(e.scores?.final_general_remarks ?? ''),
      String(e.total_score || 0),
      e.remarks || '',
      e.updated_at || nowIso(),
    ]))
  ).join('');

  const workbook = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Participants"><Table>${participantRows}</Table></Worksheet>
 <Worksheet ss:Name="Evaluations"><Table>${evalRows}</Table></Worksheet>
</Workbook>`;

  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel' });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (typeof downloadBlob === 'function') downloadBlob(blob, `offline-backup-${ts}.xls`);
  return {
    participants: backupCandidates.length,
    evaluations: backupEvaluations.length,
    pendingParticipants: unsyncedCandidates.length,
    pendingEvaluations: unsyncedEvaluations.length,
  };
}

async function buildCandidateListFromLocal(params = {}) {
  let candidates = await txReadAll(STORE_CANDIDATES);
  const rebuilt = [];
  for (const c of candidates) rebuilt.push(await rebuildCandidateView(c));

  const status = params.status || '';
  const domainId = params.domain_id || '';
  const search = (params.search || '').toLowerCase();

  if (status) rebuilt.splice(0, rebuilt.length, ...rebuilt.filter(c => c.status === status));
  if (domainId) rebuilt.splice(0, rebuilt.length, ...rebuilt.filter(c => (c.candidate_domains || []).some(cd => cd.domain_id === domainId)));
  if (search) {
    rebuilt.splice(0, rebuilt.length, ...rebuilt.filter(c =>
      `${c.name || ''} ${c.email || ''} ${c.roll_number || ''}`.toLowerCase().includes(search)
    ));
  }

  return rebuilt.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

async function updateCandidateLocal(id, updater) {
  const current = await txGet(STORE_CANDIDATES, id);
  if (!current) throw new Error('Candidate not found');
  const next = updater({ ...current });
  next.updated_at = nowIso();
  next.synced = false;
  next.dirty = true;
  await txPut(STORE_CANDIDATES, next);
  setUnsyncedState(true);
  return rebuildCandidateView(next);
}

const Auth = {
  async login(email, password) {
    clearSession();
    const data = await apiFetchRemote('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveSession(data.access_token, data.user);
    if (shouldUseOfflineMode()) {
      const ready = await isOfflineReady();
      if (!ready) {
        await prepareOfflineMode();
      } else if (navigator.onLine) {
        // Refresh local cache at login while preserving unsynced local edits.
        await prepareOfflineMode();
      }
      await refreshUnsyncedState();
    } else {
      await refreshLocalCacheFromServer().catch(() => null);
    }
    return data.user;
  },
  async logout() {
    const notify = (msg, type = 'info', dur) => {
      if (typeof window.toast === 'function') window.toast(msg, type, dur);
    };

    try {
      const pendingBefore = await hasUnsyncedData();
      if (pendingBefore) {
        // Always create a local backup before any upload attempt during logout.
        try {
          const bk = await exportUnsyncedBackup();
          notify(
            `Backup downloaded before logout (${bk.pendingParticipants || 0} participant changes, ${bk.pendingEvaluations || 0} evaluation changes).`,
            'info',
            5000,
          );
        } catch (backupErr) {
          throw new Error(`Could not create backup before logout: ${backupErr?.message || 'Unknown error'}`);
        }

        if (!navigator.onLine) {
          throw new Error('You are offline. Unsaved local changes must be uploaded before logout.');
        }

        const syncResult = await syncUnsyncedToServer();
        await refreshUnsyncedState();
        const pendingAfter = await hasUnsyncedData();
        const syncErrors = (syncResult?.participants?.errors || []).length + (syncResult?.evaluations?.errors || []).length;

        if (pendingAfter || syncErrors > 0) {
          throw new Error('Upload is incomplete. Please resolve sync issues and keep the downloaded backup file safe before logout.');
        }

        if (navigator.onLine) {
          try { await refreshLocalCacheFromServer(); } catch {}
        }
      }

      clearSession();
      redirectToLogin();
      return { ok: true };
    } catch (err) {
      notify(err?.message || 'Logout blocked due to unsaved changes.', 'warning', 8000);
      return { ok: false, error: err?.message || 'Logout blocked' };
    }
  },
};

const Candidates = {
  async list(params = {}) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote('/candidates/', {
        method: 'GET',
      }).then(data => data || []);
    }
    return buildCandidateListFromLocal(params);
  },

  async get(id) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/candidates/${id}`);
    }
    const c = await txGet(STORE_CANDIDATES, id);
    if (!c) throw new Error('Candidate not found');
    return rebuildCandidateView(c);
  },

  async create(data) {
    if (!shouldUseOfflineMode()) {
      const payload = {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        roll_number: data.roll_number || null,
        branch: data.branch || null,
        section: data.section || null,
        year: data.year || null,
        skills: data.skills || null,
        experience: data.experience || null,
        status: 'pending',
        extra_data: data.extra_data || {},
        domain_ids: data.domain_ids || [],
      };
      return apiFetchRemote('/candidates/', { method: 'POST', body: JSON.stringify(payload) });
    }

    const user = getUser();
    const record = {
      id: uuid(),
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      roll_number: data.roll_number || null,
      branch: data.branch || null,
      section: data.section || null,
      year: data.year || null,
      skills: data.skills || null,
      experience: data.experience || null,
      status: 'pending',
      extra_data: data.extra_data || {},
      created_by: user?.id || null,
      created_at: nowIso(),
      updated_at: nowIso(),
      synced: false,
      dirty: true,
      candidate_domains: (data.domain_ids || []).map(did => ({ domain_id: did })),
    };
    await txPut(STORE_CANDIDATES, record);
    setUnsyncedState(true);
    return rebuildCandidateView(record);
  },

  async update(id, data) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    }
    return updateCandidateLocal(id, c => ({ ...c, ...data }));
  },

  async addDomain(candidateId, domainId) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/candidates/${candidateId}/domains/${domainId}`, { method: 'POST' });
    }
    return updateCandidateLocal(candidateId, c => {
      const has = (c.candidate_domains || []).some(cd => cd.domain_id === domainId);
      if (!has) c.candidate_domains = [...(c.candidate_domains || []), { domain_id: domainId }];
      return c;
    });
  },

  async removeDomain(candidateId, domainId) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/candidates/${candidateId}/domains/${domainId}`, { method: 'DELETE' });
    }
    return updateCandidateLocal(candidateId, c => {
      c.candidate_domains = (c.candidate_domains || []).filter(cd => cd.domain_id !== domainId);
      return c;
    });
  },

  async assign(candidateIds, domainId) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote('/candidates/assign', {
        method: 'POST',
        body: JSON.stringify({ candidate_ids: candidateIds, domain_id: domainId }),
      });
    }
    for (const cid of candidateIds) {
      await Candidates.addDomain(cid, domainId);
    }
    return { assigned: candidateIds.length };
  },

  async bulkStatus(candidateIds, status) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote('/candidates/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ candidate_ids: candidateIds, status }),
      });
    }
    for (const cid of candidateIds) {
      await Candidates.update(cid, { status });
    }
    return { updated: candidateIds.length, status };
  },

  async exportShortlisted() {
    if (navigator.onLine) {
      return apiFetchRemote('/candidates/export/shortlisted');
    }
    const rows = (await Candidates.list()).filter(c => ['shortlisted', 'selected'].includes(c.status));
    const header = 'Name,Email,Phone,Roll Number,Branch,Section,Year,Skills,Experience,Status\n';
    const lines = rows.map(c => [
      c.name, c.email, c.phone || '', c.roll_number || '', c.branch || '', c.section || '', c.year || '', c.skills || '', c.experience || '', c.status,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    return new Blob([header + lines], { type: 'text/csv' });
  },

  invalidateCache() { },
};

const Evaluations = {
  async submit(data) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote('/evaluations/', { method: 'POST', body: JSON.stringify(data) });
    }
    const user = getUser();
    const existing = (await txReadAll(STORE_EVALUATIONS)).find(e =>
      sameId(e.candidate_id, data.candidate_id) && sameId(e.domain_id, data.domain_id) && sameId(e.admin_id, user.id)
    );

    const overall = Number(data.overall_rating ?? data.scores?.overall_rating ?? 0);
    const rec = {
      id: existing?.id || uuid(),
      candidate_id: data.candidate_id,
      domain_id: data.domain_id,
      admin_id: user.id,
      round_number: data.round_number || 1,
      scores: { ...(data.scores || {}), overall_rating: overall, final_general_remarks: data.final_general_remarks || '' },
      total_score: overall,
      remarks: data.remarks || null,
      updated_at: nowIso(),
      created_at: existing?.created_at || nowIso(),
      synced: false,
      dirty: true,
    };
    await txPut(STORE_EVALUATIONS, rec);
    setUnsyncedState(true);
    return rec;
  },

  async submitMulti(candidateId, evaluationsList) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote('/evaluations/multi', {
        method: 'POST',
        body: JSON.stringify({ candidate_id: candidateId, evaluations: evaluationsList }),
      });
    }
    let saved = 0;
    const errors = [];
    for (const ev of evaluationsList) {
      try {
        await Evaluations.submit({ ...ev, candidate_id: candidateId });
        saved += 1;
      } catch (e) {
        errors.push({ domain_id: ev.domain_id, error: e.message });
      }
    }
    return { saved, errors };
  },

  async forCandidate(cid) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/evaluations/candidate/${cid}`);
    }
    const evals = await txReadAll(STORE_EVALUATIONS);
    return evals.filter(e => sameId(e.candidate_id, cid));
  },

  async update(evalId, data) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/evaluations/${evalId}`, { method: 'PATCH', body: JSON.stringify(data) });
    }
    const ex = await txGet(STORE_EVALUATIONS, evalId);
    if (!ex) throw new Error('Evaluation not found');
    const mergedScores = { ...(ex.scores || {}), ...(data.scores || {}) };
    if (data.overall_rating != null) mergedScores.overall_rating = Number(data.overall_rating);
    const next = {
      ...ex,
      scores: mergedScores,
      remarks: data.remarks ?? ex.remarks,
      total_score: Number(mergedScores.overall_rating ?? ex.total_score ?? 0),
      updated_at: nowIso(),
      synced: false,
      dirty: true,
    };
    await txPut(STORE_EVALUATIONS, next);
    setUnsyncedState(true);
    return next;
  },
};

const Admins = {
  async list() {
    if (navigator.onLine) {
      const list = await apiFetchRemote('/admins/');
      await txPut(STORE_META, { key: 'admins_cache', value: list, updated_at: nowIso() });
      return list;
    }
    const cached = await txGet(STORE_META, 'admins_cache');
    return cached?.value || [];
  },
  async create(data) { return apiFetchRemote('/admins/', { method: 'POST', body: JSON.stringify(data) }); },
  async assignDomains(adminId, domainIds) {
    return apiFetchRemote(`/admins/${adminId}/assign-domains`, { method: 'POST', body: JSON.stringify({ admin_ids: domainIds }) });
  },
  async toggle(id) { return apiFetchRemote(`/admins/${id}/toggle`, { method: 'PATCH' }); },
  async delete(id) { return apiFetchRemote(`/admins/${id}`, { method: 'DELETE' }); },
};

const Domains = {
  async list() {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote('/domains/');
    }
    const local = await txReadAll(STORE_DOMAINS);
    if (local.length) return local;
    if (!navigator.onLine) return [];
    const remote = await apiFetchRemote('/domains/');
    await txPutMany(STORE_DOMAINS, remote);
    return remote;
  },
  async create(data) {
    const res = await apiFetchRemote('/domains/', { method: 'POST', body: JSON.stringify(data) });
    await txPut(STORE_DOMAINS, res);
    return res;
  },
  async update(id, data) {
    const res = await apiFetchRemote(`/domains/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    await txPut(STORE_DOMAINS, res);
    return res;
  },
  async assignAdmins(domainId, adminIds) {
    return apiFetchRemote(`/admins/domains/${domainId}/assign`, { method: 'POST', body: JSON.stringify({ admin_ids: adminIds }) });
  },
  async delete(id) {
    const res = await apiFetchRemote(`/domains/${id}`, { method: 'DELETE' });
    await txDelete(STORE_DOMAINS, id);
    return res;
  },
  async criteria(domainId) {
    if (!shouldUseOfflineMode()) {
      return apiFetchRemote(`/domains/${domainId}/criteria`);
    }
    const all = await txReadAll(STORE_QUESTIONS);
    return all.filter(q => q.domain_id === domainId);
  },
  async createCriteria(d) {
    const res = await apiFetchRemote('/domains/criteria', { method: 'POST', body: JSON.stringify(d) });
    await txPut(STORE_QUESTIONS, res);
    return res;
  },
  async deleteCriteria(id) {
    const res = await apiFetchRemote(`/domains/criteria/${id}`, { method: 'DELETE' });
    await txDelete(STORE_QUESTIONS, id);
    return res;
  },
};

const Upload = {
  async excel(file, domainIds = [], onProgress) {
    if (!navigator.onLine) throw new Error('Upload requires internet connection.');
    const fd = new FormData();
    fd.append('file', file);
    if (domainIds.length) fd.append('domain_ids', domainIds.join(','));
    return apiFetchRemoteWithProgress('/upload/excel', { method: 'POST', body: fd }, onProgress);
  },

  async importRecovery(file, onProgress) {
    if (!navigator.onLine) throw new Error('Recovery import requires internet connection.');
    const fd = new FormData();
    fd.append('file', file);
    return apiFetchRemoteWithProgress('/upload/recovery/import', { method: 'POST', body: fd }, onProgress);
  },
};

window.OfflineApp = {
  prepareOfflineMode,
  refreshLocalCacheFromServer,
  syncUnsyncedToServer,
  exportUnsyncedBackup,
  hasUnsyncedData,
  isOfflineReady,
  getLocalSyncStats,
  getPendingUploadPreview,
  isAutoSyncEnabled,
  setAutoSyncEnabled: setAutoSyncRuntime,
};

window.Auth = Auth;
window.Candidates = Candidates;
window.Evaluations = Evaluations;
window.Domains = Domains;
window.Admins = Admins;
window.Upload = Upload;

(async function initOfflineRuntime() {
  const user = getUser();
  if (user && user.role === 'superadmin') {
    await disableOfflineRuntime();
    return;
  }

  if (!user) return;

  await registerServiceWorker();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installNetworkIndicator();
      installUnsyncedGuard();
      installFullscreenGate();
      startAutoSyncLoop();
    });
  } else {
    installNetworkIndicator();
    installUnsyncedGuard();
    installFullscreenGate();
    startAutoSyncLoop();
  }

  if (user && getToken()) {
    await refreshUnsyncedState();
    const ready = await isOfflineReady();
    if (!ready && navigator.onLine) {
      try { await prepareOfflineMode(); } catch {}
    }
  }
})();
