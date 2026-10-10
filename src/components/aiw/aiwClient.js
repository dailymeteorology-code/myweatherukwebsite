/**
 * Shared client code for the AI lightning warning system: severity styling,
 * API calls and the live-update hook. Every AI-warning component imports its
 * colours and labels from here, so the map, cards, detail panel, voice
 * transcript and history all present severity identically.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, AlertOctagon, Siren } from 'lucide-react';

/* ── severity identity ────────────────────────────────────────────────── */

/**
 * The site's own AI warning levels. Colours are fixed by spec. Each level also
 * has its own ICON, its own LABEL and a LEVEL NUMBER, so severity is never
 * conveyed by colour alone (colour-blind users, greyscale printouts, screen
 * readers). Text colour is chosen for contrast on each fill: dark ink on
 * yellow and amber (white on #FFD600 is ~1.5:1), white on red.
 */
export const SEV = {
  yellow: { key: 'yellow', label: 'Yellow', level: 1, name: 'Elevated lightning risk', color: '#FFD600', ink: '#1F1A00', inkOnGlass: '#8A6D00', Icon: AlertTriangle },
  amber:  { key: 'amber',  label: 'Amber',  level: 2, name: 'High lightning risk',     color: '#FF9800', ink: '#1F1200', inkOnGlass: '#B05E00', Icon: AlertOctagon },
  red:    { key: 'red',    label: 'Red',    level: 3, name: 'Extreme or imminent lightning danger', color: '#F44336', ink: '#FFFFFF', inkOnGlass: '#C62828', Icon: Siren },
};
export const SEV_ORDER = ['red', 'amber', 'yellow'];
export const sevRank = (s) => SEV[s]?.level || 0;

/** Readable text colour for a severity on the site's glass, per theme. */
export const sevText = (s, light) => (light ? SEV[s]?.inkOnGlass : SEV[s]?.color) || 'inherit';

/* ── API ──────────────────────────────────────────────────────────────── */

const TOKEN_KEY = 'base44_access_token';
function authHeaders() {
  try { const t = localStorage.getItem(TOKEN_KEY); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

export async function aiwGet(path, params) {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]))}` : '';
  const res = await fetch(`/api/aiw${path}${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export async function aiwSend(method, path, body) {
  const res = await fetch(`/api/aiw${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

/* ── formatting ───────────────────────────────────────────────────────── */

/** Local time AT THE WARNING (its own time zone), with the zone name. */
export function fmtAt(ms, tz, withDate = false) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: tz || undefined,
      ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    });
  } catch { return new Date(ms).toISOString().slice(11, 16); }
}

export function fmtRemaining(min) {
  if (min == null) return '';
  if (min < 60) return `${min} min left`;
  return `${Math.floor(min / 60)} h ${min % 60} min left`;
}

export function fmtAgo(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export const STATUS_LABEL = {
  active: 'Active', expired: 'Expired', cancelled: 'Cancelled', upcoming: 'Upcoming',
  issued: 'Issued', updated: 'Updated', escalated: 'Escalated', downgraded: 'Downgraded',
  extended: 'Extended', shortened: 'Shortened', merged: 'Merged',
};

/* ── live data ────────────────────────────────────────────────────────── */

/**
 * Active warnings for the map, kept current by the server's event stream
 * (Server-Sent Events). If the stream drops — a proxy, a sleeping laptop —
 * it falls back to polling with backoff until the stream reconnects.
 */
export function useAiwLive({ includeTest = false } = {}) {
  const [active, setActive] = useState([]);
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState(null);
  const listeners = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([aiwGet('/active', includeTest ? { includeTest: 1 } : null), aiwGet('/status')]);
      setActive(a.items || []);
      setStatus(s);
    } catch { /* keep the last good data; the status pill shows the problem */ }
  }, [includeTest]);

  useEffect(() => {
    let es = null; let poll = null; let backoff = 15000; let stopped = false;
    refresh();
    const startPolling = () => {
      if (poll) return;
      const tick = async () => { if (stopped) return; await refresh(); backoff = Math.min(120000, backoff * 1.5); poll = setTimeout(tick, backoff); };
      poll = setTimeout(tick, backoff);
    };
    const stopPolling = () => { clearTimeout(poll); poll = null; backoff = 15000; };
    try {
      es = new EventSource('/api/aiw/stream');
      es.onopen = () => { setConnected(true); stopPolling(); };
      es.onerror = () => { setConnected(false); startPolling(); };
      es.onmessage = (ev) => {
        let msg = null; try { msg = JSON.parse(ev.data); } catch { return; }
        setLastEventAt(Date.now());
        if (msg.type === 'cycle' || msg.type === 'status') refresh();
        for (const fn of listeners.current) { try { fn(msg); } catch { /* ignore */ } }
      };
    } catch { startPolling(); }
    // Even with the stream up, re-read occasionally so the countdowns and any
    // missed message self-correct.
    const safety = setInterval(refresh, 120000);
    return () => { stopped = true; es?.close(); stopPolling(); clearInterval(safety); };
  }, [refresh]);

  const subscribe = useCallback((fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); }, []);
  return { active, status, connected, lastEventAt, refresh, subscribe };
}

/* ── tiny preview of a polygon, for warning cards ─────────────────────── */

/** SVG path for a GeoJSON polygon fitted into a w x h box. */
export function polygonPreviewPath(geom, w = 64, h = 44, pad = 4) {
  if (!geom) return null;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let W = 180; let S = 90; let E = -180; let N = -90;
  for (const p of polys) for (const [lon, lat] of p[0]) { if (lon < W) W = lon; if (lon > E) E = lon; if (lat < S) S = lat; if (lat > N) N = lat; }
  const midLat = (S + N) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const sx = (E - W) * kx || 1e-6; const sy = (N - S) || 1e-6;
  const sc = Math.min((w - 2 * pad) / sx, (h - 2 * pad) / sy);
  const ox = (w - sx * sc) / 2; const oy = (h - sy * sc) / 2;
  return polys.map((p) => p[0].map(([lon, lat], i) => `${i ? 'L' : 'M'}${(ox + (lon - W) * kx * sc).toFixed(1)},${(oy + (N - lat) * sc).toFixed(1)}`).join('') + 'Z').join('');
}
