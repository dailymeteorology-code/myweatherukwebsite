const BO_SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws8.blitzortung.org',
];
const GEO_BOUNDS = { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 };
const MAX_BUFFER = 5000;

function inBounds(lat, lon) {
  return lat >= GEO_BOUNDS.latMin && lat <= GEO_BOUNDS.latMax &&
         lon >= GEO_BOUNDS.lonMin && lon <= GEO_BOUNDS.lonMax;
}

let ws = null;
let serverIdx = 0;
let buffer = []; // strikes collected while no tab is focused

function connect() {
  const url = BO_SERVERS[serverIdx % BO_SERVERS.length];
  serverIdx++;
  try { ws = new WebSocket(url); } catch (_) { setTimeout(connect, 5000); return; }

  ws.onopen = () => { try { ws.send(JSON.stringify({ a: 111 })); } catch (_) {} };

  ws.onmessage = async (evt) => {
    try {
      let parsed = null;
      try { parsed = JSON.parse(evt.data); } catch (_) {}
      if (!parsed) return;

      const raw = parsed.strikes || (parsed.lat !== undefined ? [parsed] : null);
      if (!raw) return;

      const nowMs = Date.now();
      const newStrikes = [];

      raw.forEach(s => {
        let timeMs = s.time
          ? (s.time > 1e12 ? Math.floor(s.time / 1e6) : s.time * 1000)
          : nowMs;
        let lat = Math.abs(s.lat) > 90  ? s.lat / 1e7 : s.lat;
        let lon = Math.abs(s.lon) > 180 ? s.lon / 1e7 : s.lon;
        if (isNaN(lat) || isNaN(lon) || !inBounds(lat, lon)) return;
        newStrikes.push({ lat, lon, time: timeMs, amp: s.mamp || 0 });
      });

      if (!newStrikes.length) return;

      // Check if any tab is visible
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hasVisible = clients.some(c => c.visibilityState === 'visible');

      if (hasVisible) {
        // Send directly to open tabs
        clients.forEach(c => c.postMessage({ type: 'NEW_STRIKES', strikes: newStrikes }));
      } else {
        // Buffer for when tab reopens
        buffer.push(...newStrikes);
        if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
      }
    } catch (_) {}
  };

  ws.onclose = () => setTimeout(connect, 5000);
  ws.onerror = () => { try { ws.close(); } catch (_) {} setTimeout(connect, 5000); };
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); connect(); });

self.addEventListener('message', async (event) => {
  if (event.data?.type === 'PING') {
    // Keep SW alive
  }
  if (event.data?.type === 'GET_BUFFERED_STRIKES') {
    if (buffer.length) {
      event.source.postMessage({ type: 'NEW_STRIKES', strikes: [...buffer] });
      buffer = [];
    }
  }
});
