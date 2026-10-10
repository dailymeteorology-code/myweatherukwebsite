/**
 * useBlitzortung — React hook that opens a WebSocket to the Blitzortung
 * community lightning network and forwards real strikes inside a bbox.
 *
 * The network uses 3 public WS servers. It sends a small LZW-compressed
 * payload that needs decoding (decoder taken from blitzortung.org's
 * official client snippet).
 */
import { useEffect, useRef } from 'react';

const SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws8.blitzortung.org',
];

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
  } catch { return null; }
}

export default function useBlitzortung({ enabled, bbox, onStrike, onStatus }) {
  const wsRef = useRef(null);
  const svIdxRef = useRef(0);
  const timerRef = useRef(null);
  const pingRef = useRef(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = !enabled;
    if (!enabled) {
      onStatus?.('disabled');
      cleanup();
      return;
    }
    connect();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bbox?.lonMin, bbox?.lonMax, bbox?.latMin, bbox?.latMax]);

  function cleanup() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (pingRef.current)  { clearInterval(pingRef.current); pingRef.current = null; }
    if (wsRef.current)    { try { wsRef.current.close(); } catch {} wsRef.current = null; }
  }

  function inBbox(lat, lon) {
    return lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax;
  }

  function connect() {
    if (stoppedRef.current) return;
    onStatus?.('connecting');
    let ws;
    try {
      ws = new WebSocket(SERVERS[svIdxRef.current++ % SERVERS.length]);
    } catch {
      onStatus?.('error');
      timerRef.current = setTimeout(connect, 6000);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (stoppedRef.current) { ws.close(); return; }
      onStatus?.('live');
      try { ws.send(JSON.stringify({ a: 111 })); } catch {}
      pingRef.current = setInterval(() => {
        if (ws.readyState === 1) { try { ws.send(JSON.stringify({ a: 111 })); } catch {} }
        else clearInterval(pingRef.current);
      }, 25000);
    };

    ws.onmessage = (evt) => {
      if (stoppedRef.current) return;
      let parsed = null;
      try { parsed = JSON.parse(evt.data); } catch {}
      if (!parsed) parsed = blitzortungDecode(evt.data);
      if (!parsed) return;
      const strikes = parsed.strikes || (parsed.lat !== undefined ? [parsed] : null);
      if (!strikes) return;
      const nowMs = Date.now();
      for (const s of strikes) {
        let lat = s.lat, lon = s.lon;
        if (Math.abs(lat) > 90)  lat = lat / 1e7;
        if (Math.abs(lon) > 180) lon = lon / 1e7;
        if (isNaN(lat) || isNaN(lon)) continue;
        if (!inBbox(lat, lon)) continue;
        const timeMs = s.time ? (s.time > 1e12 ? Math.floor(s.time / 1e6) : s.time * 1000) : nowMs;
        onStrike?.({ lat, lon, time: timeMs, amp: s.mamp || 0 });
      }
    };

    ws.onerror = () => {
      onStatus?.('reconnecting');
      if (pingRef.current) clearInterval(pingRef.current);
      if (!stoppedRef.current) timerRef.current = setTimeout(connect, 6000);
    };
    ws.onclose = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (!stoppedRef.current) {
        onStatus?.('reconnecting');
        timerRef.current = setTimeout(connect, 6000);
      }
    };
  }
}