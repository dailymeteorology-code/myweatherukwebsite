/**
 * TCM Archive — every TCM NOVA run, kept after the TCM page has moved on.
 *
 * The NOVA mirror (tcmNova.js) keeps about a week of Main Runs and two days of Hyper-Short on
 * D:, and the TCM page shows only the last 24 hours of them. This keeps each published run for
 * good, from the moment it is published, in its own folder on the same drive:
 *
 *   D:/MyWeatherUK-data/tcm-archive/{main,hyper}/<run id>/
 *     manifest.json            the run's manifest, trimmed to the fields kept here
 *     frames/<lead>/<field>.bin, days/<date>/<field>.bin, summary/max_<field>.bin
 *
 * Only the hazard fields (and a few ingredients for the Main Run) are kept: a whole Hyper-Short
 * run is over 500 MB, its hazards about 70 MB. The files are hard links to NOVA's own, so a run
 * costs nothing extra until NOVA deletes its copy, and then only what is kept here. When the
 * drive gets low the oldest Hyper-Short runs go first, then the oldest Main Runs.
 *
 * Runs are listed here once they are a day old (younger ones are on the TCM page). The archive
 * also verifies each finished day: the Main Run's whole-day lightning risk against the strikes
 * the Met Office recorded that day (verify.js).
 *
 * The archive is open to everyone while TCM NOVA's own page stays admin-only, so a visitor only
 * ever gets what is no longer a forecast: runs a day old or more (the ones the TCM page has let
 * go), and of a younger run only its summary of a day that has already ended. Admins get all of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userFromRequest } from '../auth.js';
import { createVerifier } from './verify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NOVA = process.env.NOVA_DATA || (fs.existsSync('D:/') ? 'D:/TCM-NOVA/data' : path.join(here, '..', 'data', 'tcm-nova'));
export const ROOT = process.env.TCM_ARCHIVE || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/tcm-archive' : path.join(here, '..', 'data', 'tcm-archive'));

const PRODUCTS = ['main', 'hyper'];
const SAFE_ID = /^(main|hyper)-\d{8}T\d{4}Z$/;
const SAFE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_MONTH = /^\d{4}-\d{2}$/;
const SAFE_FIELD = /^[a-z0-9_]{1,40}$/;
/** A run is listed in the archive once it is this old; the TCM page shows the younger ones. */
export const ARCHIVE_AGE_MS = 24 * 3600e3;
const PASS_MS = 10 * 60e3;
const MIN_FREE = 120 * 2 ** 30;                 // below this the oldest runs make room

/* what is kept of each product */
export const KEEP = {
  main: ['p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_tornado_env',
    'p_heavy_rain', 'p_severe', 'p_initiation', 'uncertainty', 'confidence', 'flash_density', 'precip', 'precip_accum',
    'mu_cape', 'shear_0_6km', 'gust_max'],
  hyper: ['p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_tornado_env', 'p_heavy_rain',
    'p_severe', 'p_rain', 'precip', 'flash_density', 'lightning_jump'],
};

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

/* ── London calendar days ── */
function londonParts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms));
  const g = (t) => Number(f.find((p) => p.type === t).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
}
export const londonDay = (ms) => { const p = londonParts(ms); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
/** UTC instants of 00:00 and 24:00 London time on a London day. */
export function londonDayBounds(day) {
  const start = (iso) => {
    const guess = Date.parse(`${iso}T00:00:00Z`);
    for (const back of [0, 1, 2]) {
      const t = guess - back * 3600e3;
      const p = londonParts(t);
      if (p.h === 0 && p.mi === 0) return t;
    }
    return guess;
  };
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  return [start(day), start(next)];
}

/* ── the archive on disk ── */

/** What identifies the published version of a source run (a re-run is published under the same id). */
function sourceStamp(dir) {
  try { return fs.readFileSync(path.join(dir, '.release-asset'), 'utf8'); } catch { /* a local run */ }
  try { return `local|${fs.statSync(path.join(dir, 'manifest.json')).mtimeMs}`; } catch { return null; }
}

/** Hard-link `from` to `to` (a copy where links are not possible); false when `from` is missing. */
async function place(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.link(from, to);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    if (e.code === 'EEXIST') return true;
    try { await fs.promises.copyFile(from, to); } catch (e2) { if (e2.code === 'ENOENT') return false; throw e2; }
  }
  return true;
}

/** The run's manifest as the archive keeps it: only the kept fields, and where it came from. */
function trimManifest(m, keep, stamp) {
  return {
    ...m,
    fields: pick(m.fields, keep),
    frames: (m.frames || []).map((f) => ({ ...f, stats: pick(f.stats, keep) })),
    days: (m.days || []).map((d) => ({ ...d, fields: (d.fields || []).filter((x) => keep.includes(x)), stats: pick(d.stats, keep) })),
    archive: { stamp, archived_utc: new Date().toISOString(), fields: keep },
  };
}

async function archiveRun(product, id) {
  const src = path.join(NOVA, product, id);
  const m = readJson(path.join(src, 'manifest.json'));
  if (!m || !['published', 'degraded'].includes(m.status) || m.run_id !== id) return false;
  const stamp = sourceStamp(src);
  if (!stamp) return false;
  const dst = path.join(ROOT, product, id);
  if (readJson(path.join(dst, 'manifest.json'))?.archive?.stamp === stamp) return false;

  const keep = KEEP[product].filter((f) => m.fields?.[f]);
  const tmp = path.join(ROOT, product, `.tmp-${id}`);
  await fs.promises.rm(tmp, { recursive: true, force: true });
  for (const f of m.frames || []) {
    for (const field of keep) await place(path.join(src, 'frames', String(f.lead_min), `${field}.bin`), path.join(tmp, 'frames', String(f.lead_min), `${field}.bin`));
  }
  for (const d of m.days || []) {
    if (!SAFE_DAY.test(d.date)) continue;
    for (const field of (d.fields || []).filter((x) => keep.includes(x))) {
      await place(path.join(src, 'days', d.date, `${field}.bin`), path.join(tmp, 'days', d.date, `${field}.bin`));
    }
  }
  for (const field of keep) await place(path.join(src, 'summary', `max_${field}.bin`), path.join(tmp, 'summary', `max_${field}.bin`));
  /* the mirror swaps a re-published run in whole; if that happened while we were reading, try again next time */
  if (sourceStamp(src) !== stamp) { await fs.promises.rm(tmp, { recursive: true, force: true }); return false; }
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(trimManifest(m, keep, stamp)));
  await fs.promises.rm(dst, { recursive: true, force: true });
  await fs.promises.rename(tmp, dst);
  return true;
}

/* ── the index: one line per archived run, kept in memory ── */
const index = { main: new Map(), hyper: new Map() };

function summarise(m) {
  const peak = (f) => Math.max(0, ...(m.frames || []).map((x) => x.stats?.[f]?.max ?? 0));
  return {
    run_id: m.run_id, product: m.product, status: m.status, engine_version: m.engine_version,
    init_utc: m.init_utc, init_local: m.init_local, horizon_h: m.horizon_h, frames: m.frames?.length || 0,
    resolution_m: m.resolution_m, peak: { p_thunder: peak('p_thunder'), p_lightning: peak('p_lightning') },
    days: (m.days || []).map((d) => ({ date: d.date, complete: d.complete !== false, p_thunder: d.stats?.p_thunder?.max ?? null, p_lightning: d.stats?.p_lightning?.max ?? null, has_lightning: (d.fields || []).includes('p_lightning') })),
  };
}
function indexRun(product, id) {
  const m = readJson(path.join(ROOT, product, id, 'manifest.json'));
  if (m) index[product].set(id, summarise(m)); else index[product].delete(id);
}
function loadIndex() {
  for (const product of PRODUCTS) {
    index[product].clear();
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, product)); } catch { /* nothing yet */ }
    for (const n of names) if (SAFE_ID.test(n) && n.startsWith(`${product}-`)) indexRun(product, n);
  }
}
const isOld = (r, now = Date.now()) => now - Date.parse(r.init_utc) >= ARCHIVE_AGE_MS;
/** The archive's runs of `product`, newest first; `all` includes those still on the TCM page. */
export function archivedRuns(product, { all = false } = {}) {
  const now = Date.now();
  return [...index[product].values()].filter((r) => all || isOld(r, now)).sort((a, b) => b.init_utc.localeCompare(a.init_utc));
}
export const archivedManifest = (product, id) => (SAFE_ID.test(id) && id.startsWith(`${product}-`) && index[product].has(id)
  ? readJson(path.join(ROOT, product, id, 'manifest.json')) : null);

/** The Main Run that forecast `day` a day ahead: the newest initialised before the day began with
    the whole day in it; failing that, the first one made on the day itself. */
export function dayAheadRun(day) {
  const [t0, t1] = londonDayBounds(day);
  const covering = archivedRuns('main', { all: true }).filter((r) => r.days.some((d) => d.date === day && d.has_lightning));
  const before = covering.find((r) => Date.parse(r.init_utc) <= t0 && r.days.find((d) => d.date === day).complete);
  if (before) return { run: before, same_day: false };
  const during = covering.filter((r) => Date.parse(r.init_utc) < t1).sort((a, b) => a.init_utc.localeCompare(b.init_utc))[0];
  return during ? { run: during, same_day: true } : null;
}

/* ── housekeeping ── */
async function makeRoom() {
  let free;
  try { const s = await fs.promises.statfs(ROOT); free = s.bavail * s.bsize; } catch { return; }
  for (const product of ['hyper', 'main']) {
    const oldest = archivedRuns(product, { all: true }).reverse();
    while (free < MIN_FREE && oldest.length > 1) {
      const r = oldest.shift();
      if (Date.now() - Date.parse(r.init_utc) < 30 * 86400e3) break;          // never the last month
      await fs.promises.rm(path.join(ROOT, product, r.run_id), { recursive: true, force: true });
      index[product].delete(r.run_id);
      console.warn(`[tcm-archive] drive low: removed ${r.run_id}`);
      try { const s = await fs.promises.statfs(ROOT); free = s.bavail * s.bsize; } catch { return; }
    }
  }
}

let state = { last: null, error: null, added: 0, running: false };
let passing = null;
async function pass(verifier) {
  state.running = true;
  let added = 0;
  try {
    for (const product of PRODUCTS) {
      fs.mkdirSync(path.join(ROOT, product), { recursive: true });
      let names = [];
      try { names = fs.readdirSync(path.join(NOVA, product)); } catch { continue; }
      for (const id of names.filter((n) => SAFE_ID.test(n) && n.startsWith(`${product}-`)).sort()) {
        if (await archiveRun(product, id)) { indexRun(product, id); added += 1; }
      }
      for (const n of fs.readdirSync(path.join(ROOT, product))) {
        if (n.startsWith('.tmp-')) await fs.promises.rm(path.join(ROOT, product, n), { recursive: true, force: true });
      }
    }
    await makeRoom();
    await verifier.warm();
    state = { last: new Date().toISOString(), error: null, added, running: false };
    if (added) console.log(`[tcm-archive] archived ${added} run${added > 1 ? 's' : ''}`);
  } catch (e) {
    state = { ...state, last: new Date().toISOString(), error: String(e.message || e), running: false };
    console.warn(`[tcm-archive] pass failed: ${e.message}`);
  }
}
const runPass = (verifier) => { if (!passing) passing = pass(verifier).finally(() => { passing = null; }); return passing; };

/* ── HTTP ── */
function sendBin(res, file, dtype) {
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not in the archive' });
  res.set({ 'Content-Type': 'application/octet-stream', 'X-Nova-Dtype': dtype || 'float16', 'Cache-Control': 'private, max-age=86400, immutable' });
  return fs.createReadStream(file).pipe(res);
}

export function mountTcmArchive(app, { lightning, schedule = true } = {}) {
  fs.mkdirSync(ROOT, { recursive: true });
  loadIndex();
  const verifier = createVerifier({ root: ROOT, lightning, dayAheadRun, archivedRuns, archivedManifest, londonDayBounds });
  const isAdmin = (req) => userFromRequest(req)?.role === 'admin';
  /* a run a visitor may open: a day old, or anything for an admin */
  const openTo = (req, m) => !!m && (isOld(m) || isAdmin(req));

  const prod = (req, res) => {
    if (PRODUCTS.includes(req.params.product)) return req.params.product;
    res.status(400).json({ error: 'product must be "main" or "hyper"' });
    return null;
  };

  app.get('/api/tcm-archive/status', async (req, res) => {
    let free = null;
    try { const s = await fs.promises.statfs(ROOT); free = s.bavail * s.bsize; } catch { /* unknown */ }
    const of = (p) => { const r = archivedRuns(p); return { runs: r.length, newest: r[0]?.init_utc || null, oldest: r.at(-1)?.init_utc || null }; };
    res.json({ age_h: ARCHIVE_AGE_MS / 3600e3, main: of('main'), hyper: of('hyper'), free_gb: free == null ? null : Math.round(free / 2 ** 30), pass: state });
  });

  /* each London day of a month: how many runs were made, and how the day-ahead Main Run saw it */
  app.get('/api/tcm-archive/calendar', (req, res) => {
    const month = SAFE_MONTH.test(req.query.month || '') ? req.query.month : londonDay(Date.now()).slice(0, 7);
    const days = new Map();
    for (const p of PRODUCTS) {
      for (const r of archivedRuns(p)) {
        const d = londonDay(Date.parse(r.init_utc));
        if (!d.startsWith(month)) continue;
        if (!days.has(d)) days.set(d, { date: d, main: 0, hyper: 0 });
        days.get(d)[p] += 1;
      }
    }
    for (const d of days.values()) {
      const da = dayAheadRun(d.date);
      const s = da?.run.days.find((x) => x.date === d.date);
      d.outlook = s ? { run_id: da.run.run_id, same_day: da.same_day, p_thunder: s.p_thunder, p_lightning: s.p_lightning } : null;
    }
    const all = new Set();
    for (const p of PRODUCTS) for (const r of archivedRuns(p)) all.add(londonDay(Date.parse(r.init_utc)).slice(0, 7));
    res.json({ month, months: [...all].sort().reverse(), days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  });

  app.get('/api/tcm-archive/:product/runs', (req, res) => {
    const p = prod(req, res); if (!p) return;
    let runs = archivedRuns(p);
    if (SAFE_DAY.test(req.query.date || '')) runs = runs.filter((r) => londonDay(Date.parse(r.init_utc)) === req.query.date);
    else if (SAFE_MONTH.test(req.query.month || '')) runs = runs.filter((r) => londonDay(Date.parse(r.init_utc)).startsWith(req.query.month));
    res.json({ product: p, runs });
  });

  app.get('/api/tcm-archive/:product/runs/:id', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const m = archivedManifest(p, req.params.id);
    return openTo(req, m) ? res.json(m) : res.status(404).json({ error: 'no such run in the archive' });
  });

  app.get('/api/tcm-archive/:product/runs/:id/frame/:lead/:field', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const { id, lead, field } = req.params;
    const m = archivedManifest(p, id);
    if (!openTo(req, m)) return res.status(404).json({ error: 'no such run in the archive' });
    if (!SAFE_FIELD.test(field) || !m.fields[field] || !m.frames.some((f) => String(f.lead_min) === lead)) return res.status(404).json({ error: 'no such field or frame' });
    return sendBin(res, path.join(ROOT, p, id, 'frames', lead, `${field}.bin`), m.fields[field]);
  });

  app.get('/api/tcm-archive/:product/runs/:id/day/:date/:field', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const { id, date, field } = req.params;
    const m = archivedManifest(p, id);
    const d = m?.days?.find((x) => x.date === date);
    if (!d || !SAFE_DAY.test(date) || !SAFE_FIELD.test(field) || !d.fields.includes(field)) return res.status(404).json({ error: 'no such day or field' });
    /* a younger run's day only once that day is over: what it said, not what is still to come */
    if (!openTo(req, m) && londonDayBounds(date)[1] > Date.now()) return res.status(404).json({ error: 'no such day or field' });
    return sendBin(res, path.join(ROOT, p, id, 'days', date, `${field}.bin`), 'float16');
  });

  /* verification: every finished day, and one day in full */
  app.get('/api/tcm-archive/verification', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ days: verifier.list() });
  });
  app.get('/api/tcm-archive/verification/:date', (req, res) => {
    if (!SAFE_DAY.test(req.params.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (londonDayBounds(req.params.date)[1] > Date.now()) return res.status(404).json({ error: 'that day has not finished' });
    const run = SAFE_ID.test(req.query.run || '') ? req.query.run : null;
    const v = verifier.day(req.params.date, run);
    return v ? res.json(v) : res.status(404).json({ error: 'no Main Run in the archive forecast that day' });
  });

  if (schedule) {
    setTimeout(() => runPass(verifier), 20e3);
    setInterval(() => runPass(verifier), PASS_MS);
    console.log(`[tcm-archive] keeping TCM NOVA runs in ${ROOT} (${index.main.size} Main, ${index.hyper.size} Hyper-Short so far)`);
  }
  return { pass: () => runPass(verifier) };
}
