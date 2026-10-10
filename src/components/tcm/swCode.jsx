// Service worker code — extracted from pages/TCM.jsx as a string so it can
// be registered as a Blob URL. Provides 24/7 Blitzortung lightning capture
// when no tabs are open.
export const SW_CODE = `
const STORE_KEY = 'tcm_today_strikes';
const IDB_NAME  = 'tcm_strikes_db';
const IDB_STORE = 'strikes';
const CACHE_NAME = 'tcm-bg-strikes-v1';
const BO_DIRECT = ['wss://ws1.blitzortung.org','wss://ws7.blitzortung.org','wss://ws8.blitzortung.org'];
let svIdx = 0;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { autoIncrement: true });
        store.createIndex('time', 'time', { unique: false });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}
async function saveStrikesToIDB(strikes) {
  if (!strikes.length) return;
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rangeReq = store.index('time').openKeyCursor(IDBKeyRange.upperBound(cutoff));
    rangeReq.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
    };
    strikes.forEach(s => store.add({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp || 0 }));
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (_) {}
}
async function persistAllStrikes(strikes) {
  await saveStrikesToIDB(strikes);
  try {
    const cache = await caches.open(CACHE_NAME);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const fresh  = strikes.filter(s => s.time > cutoff);
    await cache.put('/tcm-bg-strikes', new Response(
      JSON.stringify({ strikes: fresh, savedAt: Date.now() }),
      { headers: { 'Content-Type': 'application/json' } }
    ));
  } catch (_) {}
}
function blitzortungDecode(raw) {
  try {
    const d = Array.from(raw);
    if (!d.length) return null;
    const e = {};
    let c = d[0], f = c;
    const g = [c];
    let h = 256, o = h;
    for (let i = 1; i < d.length; i++) {
      const code = d[i].charCodeAt(0);
      let a;
      if (h > code)                   a = d[i];
      else if (e[code] !== undefined) a = e[code];
      else                            a = f + c;
      g.push(a);
      c = a[0];
      e[o] = f + c;
      o++;
      f = a;
    }
    return JSON.parse(g.join(''));
  } catch (_) { return null; }
}
function inEurope(lat, lon) { return lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

let buffer = [];
let lastPersistTs = 0;
function addStrike(s) {
  buffer.push(s);
  const now = Date.now();
  if (buffer.length % 50 === 0 || now - lastPersistTs > 30000) {
    lastPersistTs = now; persistAllStrikes(buffer);
  }
  if (buffer.length > 500000) buffer = buffer.slice(-500000);
}

let bgWs = null, bgRunning = false, bgTimer = null;
function startBgWs() { if (bgRunning) return; bgRunning = true; connectBgWs(); }
function stopBgWs()  { bgRunning = false; clearTimeout(bgTimer); if (bgWs) { try { bgWs.close(); } catch (_) {} bgWs = null; } }
function connectBgWs() {
  if (!bgRunning) return;
  try { bgWs = new WebSocket(BO_DIRECT[svIdx++ % BO_DIRECT.length]); } catch (_) { bgTimer = setTimeout(connectBgWs, 6000); return; }
  let pingIv = null;
  bgWs.onopen = () => {
    if (!bgRunning) { bgWs.close(); return; }
    try { bgWs.send(JSON.stringify({ a: 111 })); } catch (_) {}
    pingIv = setInterval(() => {
      if (bgWs && bgWs.readyState === 1) { try { bgWs.send(JSON.stringify({ a: 111 })); } catch (_) {} }
      else clearInterval(pingIv);
    }, 25000);
  };
  bgWs.onmessage = evt => {
    if (!bgRunning) return;
    try {
      let parsed = null;
      try { parsed = JSON.parse(evt.data); } catch (_) {}
      if (!parsed) parsed = blitzortungDecode(evt.data);
      if (!parsed) return;
      const strikes = parsed.strikes || (parsed.lat !== undefined ? [parsed] : null);
      if (!strikes) return;
      const nowMs = Date.now();
      strikes.forEach(s => {
        // Match connectBlitzortung's precise unit thresholds (ns > 1e15,
        // ms > 1e12, s > 1e9) so ms values aren't mis-divided.
        let timeMs;
        if (!s.time)            timeMs = nowMs;
        else if (s.time > 1e15) timeMs = Math.floor(s.time / 1e6);
        else if (s.time > 1e12) timeMs = s.time;
        else if (s.time > 1e9)  timeMs = s.time * 1000;
        else                    timeMs = nowMs;
        let lat = s.lat, lon = s.lon;
        if (Math.abs(lat) > 90)  lat = lat / 1e7;
        if (Math.abs(lon) > 180) lon = lon / 1e7;
        if (isNaN(lat) || isNaN(lon) || !inEurope(lat, lon)) return;
        addStrike({ lat, lon, time: timeMs, amp: s.mamp || 0 });
      });
    } catch (_) {}
  };
  bgWs.onerror = () => { clearInterval(pingIv); if (bgRunning) bgTimer = setTimeout(connectBgWs, 6000); };
  bgWs.onclose = () => { clearInterval(pingIv); if (bgRunning) bgTimer = setTimeout(connectBgWs, 6000); };
}
async function getClientCount() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clients.length;
}
setInterval(async () => {
  const n = await getClientCount();
  if (n === 0) startBgWs(); else stopBgWs();
}, 15000);
setInterval(() => {
  const now = new Date();
  const dateKey = todayStr();
  if (now.getHours() === 23 && now.getMinutes() === 59) {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) clients.forEach(c => c.postMessage({ type: 'DO_MIDNIGHT_SNAPSHOT' }));
      else caches.open('tcm-snapshot-pending').then(cache =>
        cache.put('/tcm-snapshot-pending', new Response(
          JSON.stringify({ pending: true, date: dateKey, ts: Date.now() }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
      );
    });
  }
}, 60000);
self.addEventListener('message', async event => {
  if (event.data?.type === 'TAB_ACTIVE') {
    stopBgWs();
    const all = [...buffer];
    event.source?.postMessage({ type: 'BUFFERED_STRIKES', strikes: all });
    buffer = [];
    try { const cache = await caches.open(CACHE_NAME); await cache.delete('/tcm-bg-strikes'); } catch (_) {}
  }
  if (event.data?.type === 'TAB_HIDDEN') startBgWs();
  if (event.data?.type === 'NEW_STRIKES') (event.data.strikes || []).forEach(s => addStrike(s));
  if (event.data?.type === 'GET_BUFFERED_STRIKES') {
    const all = [...buffer]; buffer = [];
    try { const cache = await caches.open(CACHE_NAME); await cache.delete('/tcm-bg-strikes'); } catch (_) {}
    event.source?.postMessage({ type: 'BUFFERED_STRIKES', strikes: all });
  }
  if (event.data?.type === 'PING' && buffer.length) persistAllStrikes(buffer);
});
self.addEventListener('activate', async () => {
  self.clients.claim();
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      buffer = (req.result || []).filter(s => s.time > cutoff);
    };
  } catch (_) {}
});
self.addEventListener('install', () => self.skipWaiting());
`;