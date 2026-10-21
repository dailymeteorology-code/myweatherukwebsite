/**
 * Lightning: every strike, kept around the clock, for the Lightning page.
 *
 * Two networks, each used where it is best:
 *   Met Office (LEELA)  the UK & Ireland. Polled every minute. The feed holds 48 hours, so whatever
 *                       happened while this server was off is filled in the moment it starts again,
 *                       and older days come from the TCM NOVA archive (a GitHub workflow collects
 *                       the feed whether or not this machine is on).
 *   Blitzortung         everywhere else, live, through the AI-warnings server's sockets (its intake
 *                       already validates and de-duplicates; when that is switched off this opens
 *                       its own).
 * By default a strike inside the UK & Ireland box comes from the Met Office and one outside it from
 * Blitzortung, so nothing is counted twice; ?uk=bz uses Blitzortung everywhere (it is quicker).
 *
 * Storage: <DATA>/{mo,bz}/YYYY-MM-DD/HH.csv (UTC hour files of "ms,lat,lon", appended every few
 * seconds) on D:, Blitzortung kept 45 days and the Met Office 400. The last 48 hours of both are
 * held in memory in typed arrays (a busy day is a million strikes worldwide).
 *
 * While this PC is off, GitHub keeps listening (.github/workflows/lightning.yml) and stores each
 * day in the `lightning-archive` release. This server logs when it is running (uptime.json); on
 * start-up and every 20 minutes it downloads only the days that cover time it was off and merges them
 * in, a strike heard by both counted once — so the archive has no holes either way.
 *
 *   GET /api/lightning/summary            counts (5 and 15 min, hour, today, 24 h in 15-minute bars) for
 *                                         the UK, Europe and the world, and how each feed is doing
 *   GET /api/lightning/strikes            ?from=&to= (ms) or ?day=YYYY-MM-DD (UK day), &region=
 *                                         uk|europe|world, &uk=mo|bz → [t, lat, lon, src, …]
 *   GET /api/lightning/live?after=<seq>   strikes that have ARRIVED since the cursor (the Met Office
 *                                         sends minutes-old strikes, so this is by arrival, not time)
 *   GET /api/lightning/days?n=30          strike totals per UK day, for the archive picker
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createIngest } from '../aiw/ingest.js';
import { STRIKE_DIR as AIW_STRIKES } from '../aiw/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.LIGHTNING_DIR || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/lightning' : path.join(HERE, '..', 'data', 'lightning'));
const NOVA_DIR = path.join(process.env.NOVA_DATA || (fs.existsSync('D:/') ? 'D:/TCM-NOVA/data' : path.join(HERE, '..', 'data', 'tcm-nova')), 'lightning');
const LEELA = 'https://data.consumer-digital.api.metoffice.gov.uk/v1/lightning';
const UA = 'MyWeatherUK-selfhost/1.0 (lightning)';

/** Where the Met Office is the source (the same box TCM NOVA uses). */
export const UKI = { s: 49.0, n: 61.5, w: -11.5, e: 2.5 };
/** What each view counts and draws. */
export const REGIONS = {
  uk: { s: 48.5, n: 61.8, w: -13.5, e: 4.5 },
  europe: { s: 34, n: 72, w: -25, e: 45 },
  world: { s: -90, n: 90, w: -180, e: 180 },
};
const MEMORY_MS = 48 * 3600e3;
const CLOUD = { repo: 'dailymeteorology-code/myweatherukwebsite', tag: 'lightning-archive' };
const RETAIN_DAYS = { bz: 45, mo: 400 };
const MAX_RETURN = 300000;
const POLL_MS = 60e3;

const inBox = (b, la, lo) => la >= b.s && la <= b.n && lo >= b.w && lo <= b.e;
const inUKI = (la, lo) => inBox(UKI, la, lo);
/** Does this strike belong in the merged picture? src 0 = Blitzortung, 1 = Met Office. */
const keep = (src, la, lo, uk) => (uk === 'bz' ? src === 0 : src === 1 ? inUKI(la, lo) : !inUKI(la, lo));

/* ── UK time ────────────────────────────────────────────────────────────── */

function ukParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
const ukDay = (ms) => { const p = ukParts(new Date(ms)); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
/** UTC instants of 00:00 and 24:00 UK time on a UK calendar day. */
function ukDayBounds(day) {
  const at = (iso) => {
    const guess = Date.parse(`${iso}T00:00:00Z`);
    for (const off of [0, 1]) {
      const t = guess - off * 3600e3;
      const p = ukParts(new Date(t));
      if (p.h === 0 && p.mi === 0) return t;
    }
    return guess;
  };
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  return [at(day), at(next)];
}

/* ── an in-memory column of strikes, in arrival order ───────────────────── */

class Column {
  constructor(cap = 1 << 15) { this._alloc(cap); this.a = 0; this.b = 0; }
  _alloc(cap) {
    const old = this.t ? { t: this.t, la: this.la, lo: this.lo, q: this.q } : null;
    this.t = new Float64Array(cap); this.la = new Float32Array(cap); this.lo = new Float32Array(cap); this.q = new Float64Array(cap);
    if (old) {
      const n = this.b - this.a;
      this.t.set(old.t.subarray(this.a, this.b)); this.la.set(old.la.subarray(this.a, this.b));
      this.lo.set(old.lo.subarray(this.a, this.b)); this.q.set(old.q.subarray(this.a, this.b));
      this.a = 0; this.b = n;
    }
  }
  get size() { return this.b - this.a; }
  push(t, la, lo, q) {
    if (this.b === this.t.length) this._alloc(this.size * 2 > this.t.length ? this.t.length * 2 : this.t.length);
    const i = this.b++;
    this.t[i] = t; this.la[i] = la; this.lo[i] = lo; this.q[i] = q;
  }
  /** Drop strikes from the front older than `cut` (arrival order is close to time order). */
  prune(cut) {
    while (this.a < this.b && this.t[this.a] < cut) this.a += 1;
    if (this.a > this.t.length / 2) this._alloc(this.t.length);
  }
}

/* ── the archive on disk ────────────────────────────────────────────────── */

const SRC = ['bz', 'mo'];
function hourFile(src, ms) {
  const iso = new Date(ms).toISOString();
  return path.join(DATA, SRC[src], iso.slice(0, 10), `${iso.slice(11, 13)}.csv`);
}
function* readHour(src, ms) {
  let text;
  try { text = fs.readFileSync(hourFile(src, ms), 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    const c1 = line.indexOf(','), c2 = line.indexOf(',', c1 + 1);
    const t = +line.slice(0, c1), la = +line.slice(c1 + 1, c2), lo = +line.slice(c2 + 1);
    if (Number.isFinite(t) && Number.isFinite(la) && Number.isFinite(lo)) yield [t, la, lo];
  }
}
/** Strikes from the NOVA archive (Met Office, one file per UK day), when it has the day. */
function novaDay(day) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(NOVA_DIR, `${day}.json`), 'utf8'));
    return Array.isArray(j.strikes) ? j.strikes : [];
  } catch { return []; }
}

export function createLightning({ ingest } = {}) {
  const cols = [new Column(), new Column(1 << 12)];
  const pending = [[], []];
  const moKeys = new Set();
  const moKeyQueue = [];
  let seq = 0;
  const mo = { lastPollAt: null, lastOkAt: null, feedUpdatedAt: null, lastError: null, added: 0, backfilled: 0, polls: 0 };
  let ownIngest = null;
  let summaryCache = new Map();

  const moKey = (t, la, lo) => `${t}|${la}|${lo}`;
  function rememberMo(t, la, lo) {
    const k = moKey(t, la, lo);
    if (moKeys.has(k)) return false;
    moKeys.add(k); moKeyQueue.push([k, t]);
    return true;
  }

  function add(src, t, la, lo, { archive = true } = {}) {
    seq += 1;
    cols[src].push(t, la, lo, seq);
    if (archive) pending[src].push(`${t},${la.toFixed(4)},${lo.toFixed(4)}`, t);
  }
  function groupPending(src) {
    const p = pending[src];
    pending[src] = [];
    const byFile = new Map();
    for (let i = 0; i < p.length; i += 2) {
      const f = hourFile(src, p[i + 1]);
      (byFile.get(f) || byFile.set(f, []).get(f)).push(p[i]);
    }
    return byFile;
  }

  /* archive writes: every few seconds, one append per hour file */
  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (const src of [0, 1]) {
        if (!pending[src].length) continue;
        for (const [f, lines] of groupPending(src)) {
          await fs.promises.mkdir(path.dirname(f), { recursive: true });
          await fs.promises.appendFile(f, `${lines.join('\n')}\n`);
        }
      }
    } catch (e) {
      console.warn(`[lightning] archive write failed: ${e.message}`);
    } finally {
      flushing = false;
    }
  }
  /** On the way out: whatever is still queued, synchronously. */
  function flushSync() {
    for (const src of [0, 1]) {
      for (const [f, lines] of groupPending(src)) {
        try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `${lines.join('\n')}\n`); } catch { /* gone */ }
      }
    }
  }

  /* the last 48 hours back into memory on start-up */
  function restore() {
    const now = Date.now();
    for (const src of [0, 1]) {
      const rows = [];
      for (let h = Math.floor((now - MEMORY_MS) / 3600e3) * 3600e3; h <= now; h += 3600e3) {
        for (const r of readHour(src, h)) if (r[0] >= now - MEMORY_MS) rows.push(r);
      }
      rows.sort((x, y) => x[0] - y[0]);
      for (const [t, la, lo] of rows) {
        if (src === 1 && !rememberMo(t, la, lo)) continue;
        add(src, t, la, lo, { archive: false });
      }
      if (rows.length) console.log(`[lightning] restored ${rows.length} ${SRC[src]} strikes from the last 48 h`);
    }
  }

  /* ── Met Office ── */
  async function getJson(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function pollMetOffice(minutes) {
    mo.lastPollAt = Date.now();
    mo.polls += 1;
    try {
      const q = `?last-minutes=${minutes}`;
      const first = await getJson(`${LEELA}${q}`);
      let all = first.lightning_strikes || [];
      for (const c of first.chunks || []) {
        try { all = all.concat((await getJson(`${LEELA}${q}&chunk=${c.chunk}`)).lightning_strikes || []); } catch { /* one bad chunk */ }
      }
      const fresh = [];
      for (const s of all) {
        const [lo, la] = s.coordinates || [];
        const t = Date.parse(s.strike_time);
        if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
        const lat = +la.toFixed(4), lon = +lo.toFixed(4);
        if (rememberMo(t, lat, lon)) fresh.push([t, lat, lon]);
      }
      fresh.sort((x, y) => x[0] - y[0]);
      for (const [t, la, lo] of fresh) add(1, t, la, lo);
      mo.added += fresh.length;
      if (minutes > 60) mo.backfilled += fresh.length;
      mo.lastOkAt = Date.now();
      mo.feedUpdatedAt = first.last_update ? Date.parse(first.last_update) : mo.feedUpdatedAt;
      mo.lastError = null;
      if (minutes > 60 && fresh.length) console.log(`[lightning] Met Office: ${fresh.length} strikes from the last ${minutes / 60} h added`);
    } catch (e) {
      mo.lastError = e.message;
    }
  }

  /* ── Blitzortung ── */
  function onBlitz(batch) {
    for (const s of batch) add(0, s.time, s.lat, s.lon);
  }

  /* housekeeping: prune memory, the Met Office key set and old archive days */
  function prune() {
    const cut = Date.now() - MEMORY_MS;
    cols[0].prune(cut); cols[1].prune(cut);
    while (moKeyQueue.length && moKeyQueue[0][1] < cut - 3 * 3600e3) moKeys.delete(moKeyQueue.shift()[0]);
  }
  function pruneDisk() {
    for (const src of [0, 1]) {
      const cutoff = new Date(Date.now() - RETAIN_DAYS[SRC[src]] * 86400e3).toISOString().slice(0, 10);
      let days = [];
      try { days = fs.readdirSync(path.join(DATA, SRC[src])); } catch { continue; }
      for (const d of days) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) fs.rmSync(path.join(DATA, SRC[src], d), { recursive: true, force: true });
    }
  }

  /* ── reading ── */

  /** Every kept strike with time in [from, to), as a flat [t, lat, lon, src, …] array. */
  function collect(from, to, region = 'uk', uk = 'mo', max = MAX_RETURN) {
    const box = REGIONS[region] || REGIONS.uk;
    const out = [];
    // memory holds the last 48 hours (restored from the archive on start-up); before that, disk
    const memFrom = Date.now() - MEMORY_MS + 5 * 60e3;
    const push = (t, la, lo, src) => {
      if (t >= from && t < to && inBox(box, la, lo) && keep(src, la, lo, uk)) out.push(t, +la.toFixed(3), +lo.toFixed(3), src);
    };
    // older than memory: the archive (and the NOVA archive for Met Office days this server missed)
    if (from < memFrom) {
      const diskTo = Math.min(to, memFrom);
      for (const src of [0, 1]) {
        if (uk === 'bz' && src === 1) continue;
        const seen = src === 1 ? new Set() : null;
        for (let h = Math.floor(from / 3600e3) * 3600e3; h < diskTo; h += 3600e3) {
          for (const [t, la, lo] of readHour(src, h)) {
            if (t >= diskTo) continue;
            if (seen) { const k = moKey(t, la, lo); if (seen.has(k)) continue; seen.add(k); }
            push(t, la, lo, src);
          }
        }
        if (src === 1) {
          for (let d = ukDay(from); d <= ukDay(diskTo - 1); d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10)) {
            for (const [t, la, lo] of novaDay(d)) {
              if (t >= diskTo) continue;
              const k = moKey(t, +la.toFixed(4), +lo.toFixed(4));
              if (seen.has(k)) continue;
              seen.add(k);
              push(t, la, lo, 1);
            }
          }
        }
      }
    }
    // in memory
    if (to > memFrom) {
      for (const src of [0, 1]) {
        if (uk === 'bz' && src === 1) continue;
        const c = cols[src];
        for (let i = c.a; i < c.b; i += 1) {
          const t = c.t[i];
          if (t >= Math.max(from, memFrom) && t < to) push(t, c.la[i], c.lo[i], src);
        }
      }
    }
    // in time order
    const n = out.length / 4;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i += 1) idx[i] = i;
    idx.sort((x, y) => out[x * 4] - out[y * 4]);
    const step = n > max ? Math.ceil(n / max) : 1;
    const res = new Array(Math.ceil(n / step) * 4);
    let j = 0;
    for (let k = 0; k < n; k += step) {
      const i = idx[k] * 4;
      res[j++] = out[i]; res[j++] = out[i + 1]; res[j++] = out[i + 2]; res[j++] = out[i + 3];
    }
    res.length = j;
    return { strikes: res, total: n, thinned: step > 1 ? step : 0 };
  }

  /** What has arrived since a cursor (by arrival, so late Met Office strikes are not missed). A
   *  cursor from before a restart, or too far back, asks the page to reload its window instead. */
  function since(after, region = 'uk', uk = 'mo') {
    if (!(after > 0) || after > seq) return { seq, strikes: [], reset: true };
    const box = REGIONS[region] || REGIONS.uk;
    const out = [];
    for (const src of [0, 1]) {
      const c = cols[src];
      for (let i = c.b - 1; i >= c.a && c.q[i] > after; i -= 1) {
        const la = c.la[i], lo = c.lo[i];
        if (inBox(box, la, lo) && keep(src, la, lo, uk)) out.push(c.t[i], +la.toFixed(3), +lo.toFixed(3), src);
        if (out.length > 120000) return { seq, strikes: [], reset: true };
      }
    }
    return { seq, strikes: out, reset: false };
  }

  function summary(uk = 'mo') {
    const hit = summaryCache.get(uk);
    if (hit && Date.now() - hit.at < 10e3) return hit.value;
    const now = Date.now();
    const [dayStart] = ukDayBounds(ukDay(now));
    const BIN = 15 * 60e3, nb = 96;
    const binStart = Math.floor(now / BIN) * BIN - (nb - 1) * BIN;     // 96 bars ending with the current quarter-hour
    const regions = {};
    for (const r of Object.keys(REGIONS)) regions[r] = { last5: 0, last15: 0, lastHour: 0, today: 0, last24: 0, bins: new Array(nb).fill(0), newest: null };
    const hoursSeen = new Set();
    for (const src of [0, 1]) {
      const c = cols[src];
      for (let i = c.a; i < c.b; i += 1) {
        const t = c.t[i], la = c.la[i], lo = c.lo[i];
        if (src === 0 && t >= now - 24 * 3600e3) hoursSeen.add(Math.floor(t / 3600e3));
        if (!keep(src, la, lo, uk) || t > now + 60e3) continue;
        for (const r of Object.keys(REGIONS)) {
          if (!inBox(REGIONS[r], la, lo)) continue;
          const g = regions[r];
          if (t >= now - 5 * 60e3) g.last5 += 1;
          if (t >= now - 15 * 60e3) g.last15 += 1;
          if (t >= now - 3600e3) g.lastHour += 1;
          if (t >= dayStart) g.today += 1;
          if (t >= binStart) {
            const b = Math.floor((t - binStart) / BIN);
            if (b < nb) { g.bins[b] += 1; g.last24 += 1; }
          }
          if (g.newest == null || t > g.newest) g.newest = t;
        }
      }
    }
    const bzStatus = ingest?.status?.().blitzortung || ownIngest?.status?.().blitzortung || null;
    const thisHour = Math.floor(now / 3600e3);
    const bzHours = [];
    for (let h = thisHour - 23; h <= thisHour; h += 1) bzHours.push(hoursSeen.has(h) ? 1 : 0);
    const value = {
      now, day: ukDay(now), binStart, binMinutes: 15, uk, regions,
      feeds: {
        metoffice: {
          name: 'Met Office (LEELA)', status: mo.lastOkAt && now - mo.lastOkAt < 5 * 60e3 ? 'live' : mo.lastOkAt ? 'stale' : 'starting',
          lastPollAt: mo.lastPollAt, lastOkAt: mo.lastOkAt, feedUpdatedAt: mo.feedUpdatedAt, lastError: mo.lastError,
          covers: 'UK & Ireland', heldInMemory: cols[1].size,
        },
        blitzortung: {
          name: 'Blitzortung.org', status: bzStatus?.status || 'unknown', sockets: bzStatus?.sockets ?? null,
          lastStrikeAgeMs: bzStatus?.lastStrikeAgeMs ?? null, covers: uk === 'bz' ? 'everywhere' : 'outside the UK & Ireland',
          heldInMemory: cols[0].size,
          // hours of the last 24 with any Blitzortung strike: a gap means neither this server nor
          // the cloud capture was listening
          hours: bzHours,
        },
        cloud: { ...cloud, archive: `github.com/${CLOUD.repo}/releases/tag/${CLOUD.tag}` },
      },
      seq,
    };
    summaryCache.set(uk, { at: now, value });
    return value;
  }

  /* per-day totals, for the archive list. Counting a whole day from disk takes a few hundred
     milliseconds, so complete days are counted one at a time in the background and cached for
     good; until then a day is listed without its totals. Today comes from memory. */
  const DAYS_FILE = path.join(DATA, 'days.json');
  let dayCache = null;
  const dayQueue = [];
  let dayBusy = false;
  function loadDayCache() {
    if (!dayCache) { try { dayCache = JSON.parse(fs.readFileSync(DAYS_FILE, 'utf8')); } catch { dayCache = {}; } }
    return dayCache;
  }
  function queueDay(day, uk) {
    const key = `${day}|${uk}`;
    if (dayQueue.includes(key)) return;
    dayQueue.push(key);
    if (!dayBusy) setTimeout(nextDay, 50);
  }
  function nextDay() {
    const key = dayQueue.shift();
    if (!key) { dayBusy = false; return; }
    dayBusy = true;
    const [day, uk] = key.split('|');
    try { countDay(day, uk); } catch (e) { console.warn(`[lightning] counting ${day} failed: ${e.message}`); }
    setTimeout(nextDay, 400);
  }
  function dayTotals(day, uk = 'mo') {
    const cache = loadDayCache();
    const key = `${day}|${uk}`;
    if (cache[key]) return cache[key];
    const [, t1] = ukDayBounds(day);
    if (t1 >= Date.now() - 2 * 3600e3) return countDay(day, uk);       // today (and just after midnight): live
    queueDay(day, uk);
    return { day, pending: true };
  }
  function countDay(day, uk) {
    const [t0, t1] = ukDayBounds(day);
    const complete = t1 < Date.now() - 2 * 3600e3;
    const totals = { day, uk: 0, europe: 0, world: 0, bzHours: 0 };
    const { strikes } = collect(t0, t1, 'world', uk, Infinity);
    const hours = new Set();
    for (let i = 0; i < strikes.length; i += 4) {
      const la = strikes[i + 1], lo = strikes[i + 2];
      totals.world += 1;
      if (inBox(REGIONS.europe, la, lo)) totals.europe += 1;
      if (inBox(REGIONS.uk, la, lo)) totals.uk += 1;
      if (strikes[i + 3] === 0) hours.add(Math.floor(strikes[i] / 3600e3));
    }
    totals.bzHours = hours.size;
    if (complete) {
      loadDayCache()[`${day}|${uk}`] = totals;
      try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(DAYS_FILE, JSON.stringify(dayCache)); } catch { /* next time */ }
    }
    return totals;
  }
  function availableDays(n = 30) {
    const days = new Set();
    for (const src of SRC) { try { for (const d of fs.readdirSync(path.join(DATA, src))) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days.add(d); } catch { /* none */ } }
    try { for (const f of fs.readdirSync(NOVA_DIR)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) days.add(f.slice(0, 10)); } catch { /* none */ }
    days.add(ukDay(Date.now()));
    return [...days].sort().reverse().slice(0, n);
  }

  /** First start: the Blitzortung strikes the AI-warnings system has already archived (same
   *  format, one file per UTC hour), so the archive opens with the history this server has. */
  function importAiwArchive() {
    const dir = path.join(DATA, 'bz');
    if (fs.existsSync(dir)) return;
    let n = 0;
    try {
      for (const day of fs.readdirSync(AIW_STRIKES)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        fs.mkdirSync(path.join(dir, day), { recursive: true });
        for (const h of fs.readdirSync(path.join(AIW_STRIKES, day))) {
          if (/^\d{2}\.csv$/.test(h)) { fs.copyFileSync(path.join(AIW_STRIKES, day, h), path.join(dir, day, h)); n += 1; }
        }
      }
    } catch { /* nothing to import */ }
    fs.mkdirSync(dir, { recursive: true });
    if (n) console.log(`[lightning] imported ${n} hours of Blitzortung strikes from the AI-warnings archive`);
  }

  /* ── when this server was running, so the gaps can be filled from the cloud ── */
  const UPTIME_FILE = path.join(DATA, 'uptime.json');
  let uptime = [];
  function startUptime() {
    try { uptime = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8')); } catch { uptime = []; }
    const now = Date.now();
    uptime.push([now, now]);
    const beat = () => {
      uptime[uptime.length - 1][1] = Date.now();
      const cut = Date.now() - 50 * 86400e3;
      uptime = uptime.filter((iv) => iv[1] >= cut);
      try { fs.writeFileSync(UPTIME_FILE, JSON.stringify(uptime)); } catch { /* next minute */ }
    };
    beat();
    setInterval(beat, 60e3).unref?.();
  }
  /** The parts of [t0, t1) this server was not running for (a minute's grace either side). */
  function downtime(t0, t1) {
    const ivs = uptime.map(([a, b]) => [a + 60e3, b - 60e3]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const gaps = [];
    let cur = t0;
    for (const [a, b] of ivs) {
      if (b <= cur) continue;
      if (a >= t1) break;
      if (a > cur) gaps.push([cur, Math.min(a, t1)]);
      cur = Math.max(cur, b);
      if (cur >= t1) break;
    }
    if (cur < t1) gaps.push([cur, t1]);
    return gaps;
  }

  /* ── the cloud archive ── */
  const SYNC_FILE = path.join(DATA, 'cloud-sync.json');
  const cloud = { lastCheckAt: null, lastMergeAt: null, lastError: null, merged: 0, filesFetched: 0, latestUpload: null };
  let filled = null;                                         // "bz-YYYY-MM-DD" -> filled up to (ms)
  /** Merge one day's lines into the archive (and memory), skipping strikes already held. */
  function mergeDay(src, day, text) {
    const s = SRC.indexOf(src);
    const fuzzy = s === 0;
    const key = (t, la, lo) => (fuzzy ? `${Math.floor(t / 1000)}|${la.toFixed(3)}|${lo.toFixed(3)}` : moKey(t, +la.toFixed(4), +lo.toFixed(4)));
    const held = new Set();
    const d0 = Date.parse(`${day}T00:00:00Z`);
    for (let h = d0; h < d0 + 86400e3; h += 3600e3) for (const [t, la, lo] of readHour(s, h)) held.add(key(t, la, lo));
    const isHeld = (t, la, lo) => {
      if (!fuzzy) return held.has(key(t, la, lo));
      const sec = Math.floor(t / 1000), tail = `|${la.toFixed(3)}|${lo.toFixed(3)}`;
      return held.has(`${sec}${tail}`) || held.has(`${sec - 1}${tail}`) || held.has(`${sec + 1}${tail}`);
    };
    const memFrom = Date.now() - MEMORY_MS;
    const fresh = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [t, la, lo] = line.split(',').map(Number);
      if (!Number.isFinite(t) || !Number.isFinite(la) || !Number.isFinite(lo) || isHeld(t, la, lo)) continue;
      held.add(key(t, la, lo));
      fresh.push([t, la, lo]);
    }
    fresh.sort((a, b) => a[0] - b[0]);
    for (const [t, la, lo] of fresh) {
      if (t >= memFrom) {
        if (s === 1 && !rememberMo(t, +la.toFixed(4), +lo.toFixed(4))) continue;
        add(s, t, la, lo);                                        // memory + archive
      } else {
        pending[s].push(`${t},${la.toFixed(4)},${lo.toFixed(4)}`, t);   // archive only
      }
    }
    return fresh.length;
  }
  async function syncCloud() {
    cloud.lastCheckAt = Date.now();
    if (!filled) { try { filled = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8')); } catch { filled = {}; } }
    try {
      const assets = [];
      for (let page = 1; page <= 3; page += 1) {
        const rel = await fetch(`https://api.github.com/repos/${CLOUD.repo}/releases/tags/${CLOUD.tag}`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
        if (rel.status === 404) { cloud.lastError = 'no cloud archive yet'; return; }
        if (!rel.ok) throw new Error(`GitHub ${rel.status}`);
        const id = (await rel.json()).id;
        const r = await fetch(`https://api.github.com/repos/${CLOUD.repo}/releases/${id}/assets?per_page=100&page=${page}`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`GitHub ${r.status}`);
        const list = await r.json();
        assets.push(...list);
        if (list.length < 100) break;
      }
      const oldest = new Date(Date.now() - RETAIN_DAYS.bz * 86400e3).toISOString().slice(0, 10);
      for (const a of assets) if (/\.csv\.gz$/.test(a.name)) cloud.latestUpload = Math.max(cloud.latestUpload || 0, Date.parse(a.updated_at));
      for (const a of assets) {
        const m = /^(bz|mo)-(\d{4}-\d{2}-\d{2})\.csv\.gz$/.exec(a.name);
        if (!m || m[2] < oldest) continue;
        const [, src, day] = m;
        const name = `${src}-${day}`;
        const d0 = Date.parse(`${day}T00:00:00Z`);
        const updated = Date.parse(a.updated_at);
        // only where this server was off, after what has already been filled, and only once the
        // cloud copy is newer than the start of the gap
        const gaps = downtime(Math.max(d0, filled[name] || 0), Math.min(d0 + 86400e3, Date.now()));
        if (!gaps.length || updated < gaps[0][0] + 5 * 60e3) continue;
        const buf = Buffer.from(await (await fetch(a.browser_download_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) })).arrayBuffer());
        const n = mergeDay(src, day, zlib.gunzipSync(buf).toString('utf8'));
        cloud.filesFetched += 1;
        cloud.merged += n;
        filled[name] = Math.min(updated, Date.now());
        if (n) {                                            // that day's cached totals are out of date now
          const cache = loadDayCache();
          for (const k of Object.keys(cache)) if (k.startsWith(`${day}|`)) delete cache[k];
          try { fs.writeFileSync(DAYS_FILE, JSON.stringify(cache)); } catch { /* recounted next time */ }
        }
        if (n) { cloud.lastMergeAt = Date.now(); console.log(`[lightning] cloud archive: ${n} ${src === 'bz' ? 'Blitzortung' : 'Met Office'} strikes added for ${day}`); }
      }
      try { fs.writeFileSync(SYNC_FILE, JSON.stringify(filled)); } catch { /* next time */ }
      cloud.lastError = null;
    } catch (e) {
      cloud.lastError = e.message;
    }
  }

  function start() {
    fs.mkdirSync(DATA, { recursive: true });
    startUptime();
    importAiwArchive();
    restore();
    if (ingest?.subscribe) {
      ingest.subscribe(onBlitz);
    } else {
      ownIngest = createIngest({ archive: false });
      ownIngest.subscribe(onBlitz);
      ownIngest.start();
    }
    pollMetOffice(2880);                                     // fill in anything missed while off
    setTimeout(syncCloud, 20e3).unref?.();                  // fill whatever the PC missed
    const timers = [
      setInterval(syncCloud, 20 * 60e3),
      setInterval(() => pollMetOffice(15), POLL_MS),
      setInterval(flush, 4000),
      setInterval(prune, 60e3),
      setInterval(pruneDisk, 6 * 3600e3),
    ];
    for (const t of timers) t.unref?.();
    setTimeout(pruneDisk, 30e3).unref?.();
    process.on('exit', flushSync);
  }

  return { start, collect, since, summary, dayTotals, availableDays, ukDayBounds, flush, get seq() { return seq; } };
}

/* ── HTTP ───────────────────────────────────────────────────────────────── */

function sendJson(req, res, value, maxAge = 0) {
  const body = JSON.stringify(value);
  res.set('Cache-Control', maxAge ? `public, max-age=${maxAge}` : 'no-cache');
  res.type('application/json');
  if (body.length > 2048 && /\bgzip\b/.test(req.get('accept-encoding') || '')) {
    return zlib.gzip(body, { level: 5 }, (err, gz) => {
      if (err) return res.send(body);
      res.set('Content-Encoding', 'gzip');
      res.set('Vary', 'Accept-Encoding');
      return res.send(gz);
    });
  }
  return res.send(body);
}

const REGION_OK = new Set(Object.keys(REGIONS));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mountLightning(app, { ingest } = {}) {
  const L = createLightning({ ingest });
  L.start();
  const opts = (q) => ({ region: REGION_OK.has(q.region) ? q.region : 'uk', uk: q.uk === 'bz' ? 'bz' : 'mo' });

  app.get('/api/lightning/summary', (req, res) => sendJson(req, res, L.summary(opts(req.query).uk)));

  app.get('/api/lightning/strikes', (req, res) => {
    const { region, uk } = opts(req.query);
    let from, to;
    if (DAY_RE.test(req.query.day || '')) [from, to] = L.ukDayBounds(req.query.day);
    else { from = Number(req.query.from); to = Number(req.query.to) || Date.now() + 60e3; }
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return res.status(400).json({ error: 'give from/to in ms, or day=YYYY-MM-DD' });
    if (to - from > 8 * 86400e3) return res.status(400).json({ error: 'at most eight days at a time' });
    const cursor = L.seq;                                    // taken first, so live updates from here miss nothing
    const { strikes, total, thinned } = L.collect(from, to, region, uk);
    const past = to < Date.now() - 3600e3;
    return sendJson(req, res, { from, to, region, uk, seq: cursor, total, thinned, fields: ['time_ms', 'lat', 'lon', 'src'], sources: ['Blitzortung', 'Met Office'], strikes }, past ? 600 : 0);
  });

  app.get('/api/lightning/live', (req, res) => {
    const { region, uk } = opts(req.query);
    const after = Number(req.query.after) || 0;
    sendJson(req, res, L.since(after, region, uk));
  });

  app.get('/api/lightning/days', (req, res) => {
    const n = Math.min(60, Math.max(1, Number(req.query.n) || 30));
    const uk = req.query.uk === 'bz' ? 'bz' : 'mo';
    sendJson(req, res, { days: L.availableDays(n).map((d) => L.dayTotals(d, uk)) }, 60);
  });

  console.log(`[lightning] archive in ${DATA}; Met Office polled every ${POLL_MS / 1000} s, Blitzortung live`);
  return L;
}
