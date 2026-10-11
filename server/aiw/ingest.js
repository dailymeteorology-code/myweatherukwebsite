/**
 * Data ingestion for the AI warning system.
 *
 * PROVIDER INTERFACE
 *
 * Every lightning source is an adapter with the same shape:
 *
 *   {
 *     id, name, licence, coverage,          // static metadata
 *     start(onStrikes, onHealth) -> stop    // begin delivering
 *   }
 *
 * onStrikes(batch) receives normalised strikes { time: epochMs, lat, lon,
 * provider }, already validated. onHealth(partial) reports connection state.
 * Swapping or adding a provider (a commercial feed for one region, say) means
 * writing one adapter; nothing downstream changes.
 *
 * The only lightning feed this project has is Blitzortung — a volunteer
 * network, free for non-commercial use, with good detection over Europe and
 * North America and patchier coverage elsewhere. That coverage difference is
 * recorded in COVERAGE below and carried through to every warning.
 *
 * The server holds a rolling in-memory window (enough for the nowcast) and
 * appends everything to the on-disk archive for training and verification.
 */
import { archiveStrikes } from './store.js';

/* ── validation ───────────────────────────────────────────────────────── */

/** Strict schema check. Anything malformed is dropped and counted. */
export function normaliseStrike(raw, provider, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  let lat = Number(raw.lat); let lon = Number(raw.lon);
  // Blitzortung sometimes sends integer 1e-7 degrees (~5e8 for 50°N). Only
  // rescale values that are unmistakably that — a merely out-of-range number
  // like 95 is garbage, and dividing it would silently put it on the equator.
  if (Math.abs(lat) > 1e4) lat /= 1e7;
  if (Math.abs(lon) > 1e4) lon /= 1e7;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let t = Number(raw.time);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t > 1e15) t = Math.floor(t / 1e6);        // ns -> ms
  else if (t < 1e12 && t > 1e9) t *= 1000;      // s  -> ms
  // Reject impossible timestamps rather than trusting them: more than ten
  // minutes in the future, or more than six hours old, is a feed fault.
  if (t > nowMs + 10 * 60e3 || t < nowMs - 6 * 3600e3) return null;
  return { time: t, lat, lon, provider };
}

/* ── coverage ─────────────────────────────────────────────────────────── */

/**
 * Where the lightning feed is good enough to warn from, by Blitzortung's own
 * published detection-efficiency maps. 'good' regions may issue warnings at
 * every severity; 'partial' regions are capped (see config.coverageCaps) and
 * every warning there says so; everywhere else is 'none' — no warnings are
 * issued, and the site says the area is not covered rather than "no warnings".
 */
export const COVERAGE = [
  { id: 'europe',        quality: 'good',    bbox: [-25, 34, 45, 72] },
  { id: 'north-america', quality: 'good',    bbox: [-130, 24, -60, 55] },
  { id: 'oceania',       quality: 'partial', bbox: [110, -48, 180, -10] },
  { id: 'south-america', quality: 'partial', bbox: [-82, -56, -34, 13] },
  { id: 'east-asia',     quality: 'partial', bbox: [100, 18, 146, 46] },
  { id: 'south-africa',  quality: 'partial', bbox: [10, -36, 41, -15] },
  { id: 'central-america', quality: 'partial', bbox: [-118, 7, -60, 24] },
];

export function coverageAt(lat, lon) {
  for (const c of COVERAGE) {
    const [w, s, e, n] = c.bbox;
    if (lon >= w && lon <= e && lat >= s && lat <= n) return c;
  }
  return { id: 'none', quality: 'none' };
}

/* ── Blitzortung adapter ──────────────────────────────────────────────── */

const BLITZ_SERVERS = ['wss://ws1.blitzortung.org', 'wss://ws7.blitzortung.org', 'wss://ws8.blitzortung.org'];

function lzwDecode(raw) {
  try {
    const d = Array.from(raw);
    if (!d.length) return null;
    const e = {};
    let c = d[0]; let f = c;
    const g = [c];
    let o = 256;
    for (let i = 1; i < d.length; i += 1) {
      const code = d[i].charCodeAt(0);
      const a = code < 256 ? d[i] : e[code] !== undefined ? e[code] : f + c;
      g.push(a);
      c = a[0];
      e[o] = f + c;
      o += 1;
      f = a;
    }
    return JSON.parse(g.join(''));
  } catch { return null; }
}

export const blitzortung = {
  id: 'blitzortung',
  name: 'Blitzortung.org',
  licence: 'Blitzortung.org community data — non-commercial use, attribution required',
  start(onStrikes, onHealth) {
    const POOL = 3;
    const SILENT_MS = 25000;
    const sockets = new Set();
    let stopped = false;
    let idx = 0;

    const open = () => {
      if (stopped) return;
      const inUse = new Set([...sockets].map((s) => s._url));
      let url = BLITZ_SERVERS[idx++ % BLITZ_SERVERS.length];
      for (let i = 0; i < BLITZ_SERVERS.length && inUse.has(url); i += 1) url = BLITZ_SERVERS[idx++ % BLITZ_SERVERS.length];
      let ws;
      try { ws = new WebSocket(url); } catch (err) { onHealth({ lastError: String(err.message || err) }); return; }
      ws._url = url; ws._last = Date.now(); ws._opened = Date.now();
      sockets.add(ws);
      ws.onopen = () => { ws._last = Date.now(); try { ws.send('{"a":111}'); } catch { /* ignore */ } };
      ws.onmessage = (ev) => {
        ws._last = Date.now();
        const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = lzwDecode(data); }
        if (!parsed) return;
        const list = parsed.strikes || (parsed.lat !== undefined ? [parsed] : []);
        const now = Date.now();
        const out = [];
        let bad = 0;
        for (const s of list) {
          const n = normaliseStrike(s, 'blitzortung', now);
          if (n) out.push(n); else bad += 1;
        }
        if (out.length) onStrikes(out);
        if (bad) onHealth({ invalidDelta: bad });
      };
      const gone = () => { sockets.delete(ws); };
      ws.onerror = gone;
      ws.onclose = gone;
    };

    const audit = setInterval(() => {
      const now = Date.now();
      for (const ws of [...sockets]) {
        const dead = ws.readyState === 3 || ws.readyState === 2
          || (ws.readyState === 1 && now - ws._last > SILENT_MS)
          || (ws.readyState === 0 && now - ws._opened > SILENT_MS);
        if (dead) { sockets.delete(ws); try { ws.close(); } catch { /* ignore */ } }
      }
      while (sockets.size < POOL) open();
      const live = [...sockets].filter((s) => s.readyState === 1).length;
      onHealth({ sockets: live, socketsTarget: POOL });
    }, 5000);
    audit.unref?.();
    for (let i = 0; i < POOL; i += 1) open();

    return () => {
      stopped = true;
      clearInterval(audit);
      for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
    };
  },
};

/* ── the live window + health ─────────────────────────────────────────── */

/** How much recent history the nowcast needs in memory. */
const WINDOW_MS = 75 * 60e3;

export function createIngest({ providers = [blitzortung], archive = true } = {}) {
  const recent = [];          // sorted-ish by arrival, pruned by time
  const keys = new Set();     // dedup across sockets / providers
  const keyQueue = [];
  const health = {};          // provider id -> health
  const stops = [];

  // Whole-second buckets, and a strike also matches the buckets either side:
  // with rounding alone, two reports of one strike 200 ms apart got different
  // keys whenever they straddled a bucket boundary and were both kept.
  const place = (s) => `${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`;
  const bucket = (s) => Math.floor(s.time / 1000);
  function key(s) { return `${bucket(s)}_${place(s)}`; }
  function seen(s) {
    const b = bucket(s), p = place(s);
    return keys.has(`${b}_${p}`) || keys.has(`${b - 1}_${p}`) || keys.has(`${b + 1}_${p}`);
  }

  function add(batch) {
    const fresh = [];
    for (const s of batch) {
      if (seen(s)) continue;
      const k = key(s);
      keys.add(k); keyQueue.push([k, s.time]);
      recent.push(s); fresh.push(s);
    }
    if (fresh.length && archive) archiveStrikes(fresh);
    return fresh;
  }

  function prune(now = Date.now()) {
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < recent.length && recent[i].time < cutoff) i += 1;
    if (i) recent.splice(0, i);
    // Late arrivals are not perfectly ordered; a cheap second pass keeps the
    // window honest without sorting tens of thousands of entries each minute.
    if (recent.length && recent[0].time < cutoff) {
      const keep = recent.filter((s) => s.time >= cutoff);
      recent.length = 0; recent.push(...keep);
    }
    while (keyQueue.length && keyQueue[0][1] < cutoff) keys.delete(keyQueue.shift()[0]);
  }

  return {
    start() {
      for (const p of providers) {
        health[p.id] = {
          id: p.id, name: p.name, licence: p.licence,
          status: 'connecting', sockets: 0, lastStrikeAt: null, received: 0, invalid: 0, lastError: null,
          startedAt: Date.now(),
        };
        stops.push(p.start(
          (batch) => {
            const h = health[p.id];
            h.lastStrikeAt = Date.now();
            h.received += add(batch).length;
          },
          (partial) => {
            const h = health[p.id];
            if (partial.invalidDelta) h.invalid += partial.invalidDelta;
            if (partial.sockets != null) h.sockets = partial.sockets;
            if (partial.socketsTarget != null) h.socketsTarget = partial.socketsTarget;
            if (partial.lastError) h.lastError = partial.lastError;
          },
        ));
      }
    },
    stop() { for (const s of stops) s(); },
    /** Strikes with time in [from, to). */
    window(fromMs, toMs = Date.now() + 60e3) {
      prune();
      return recent.filter((s) => s.time >= fromMs && s.time < toMs);
    },
    /** Feed status as the engine and the UI see it. */
    status(now = Date.now()) {
      const out = {};
      for (const [id, h] of Object.entries(health)) {
        const age = h.lastStrikeAt ? now - h.lastStrikeAt : null;
        // Worldwide, Blitzortung reports several strikes a second on any day of
        // the year. Two silent minutes means the feed is broken, not that the
        // planet has no thunderstorms.
        const stale = age == null ? now - h.startedAt > 120e3 : age > 120e3;
        out[id] = { ...h, lastStrikeAgeMs: age, status: stale ? 'stale' : h.sockets > 0 ? 'live' : 'connecting' };
      }
      return out;
    },
    /** For tests and the backtest replay. */
    inject(batch) { return add(batch); },
    /** Preload history after a restart WITHOUT re-archiving it. */
    seed(batch) {
      for (const s of batch) {
        if (seen(s)) continue;
        const k = key(s);
        keys.add(k); keyQueue.push([k, s.time]); recent.push(s);
      }
      recent.sort((x, y) => x.time - y.time);
    },
    get size() { return recent.length; },
  };
}
