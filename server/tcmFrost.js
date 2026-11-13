/**
 * TCM FROST on the site: MyWeatherUK's snow model (tools/tcm-frost), which runs on GitHub's servers
 * every six hours and publishes each run as a Release asset (tcm-frost). This mirrors the runs of
 * the last 48 h onto D:, and serves them:
 *
 *   GET /api/frost/runs                          the runs on hand, newest first
 *   GET /api/frost/point?lat=&lon=[&run=TAG]     a place's whole forecast: chance, risk and
 *                                                snow expected, period by period, and each day
 *
 * Model Data shows the runs as a model of its own ('frost': server/modelData.js reads the frames
 * from here), and the Location page shows a place's snow risk (frostSnowAt).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { releaseAssets } from './githubReleases.js';

export const FROST_DATA = process.env.FROST_DATA || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/frost' : path.join(process.cwd(), 'server', 'data', 'frost'));
export const FROST_RUNS = path.join(FROST_DATA, 'runs');
const KEEP_H = 48;
const TAG_RE = /^\d{8}T\d{4}Z$/;
const ASSET_RE = /^frost-(\d{10})\.tar\.gz$/;
const RISK_NAMES = ['None', 'Low', 'Moderate', 'High', 'Severe'];

const tagMs = (t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13));
const readJson = async (f) => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch { return null; } };

/* ── the runs on hand ── */
let runsCache = { at: 0, list: [] };
export async function frostRuns() {
  if (Date.now() - runsCache.at < 30000) return runsCache.list;
  let names = [];
  try { names = await fs.promises.readdir(FROST_RUNS); } catch { /* none yet */ }
  const list = [];
  for (const n of names.filter((x) => TAG_RE.test(x)).sort().reverse()) {
    const m = await readJson(path.join(FROST_RUNS, n, 'manifest.json'));
    if (m) list.push({ tag: n, run: m.run, created: m.created, engine: m.engine, members: m.members, sources: m.sources, days: m.days, leads: m.leads });
  }
  runsCache = { at: Date.now(), list };
  return list;
}

/* ── the mirror ── */
async function fetchTo(url, file) {
  const ac = new AbortController();
  let stall = setTimeout(() => ac.abort(new Error('stalled')), 90000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'MyWeatherUK-FROST' }, signal: ac.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const { pipeline } = await import('node:stream/promises');
    const { Readable, Transform } = await import('node:stream');
    const tick = new Transform({ transform(chunk, _e, cb) { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error('stalled')), 90000); cb(null, chunk); } });
    await pipeline(Readable.fromWeb(r.body), tick, fs.createWriteStream(file + '.part'), { signal: ac.signal });
    await fs.promises.rename(file + '.part', file);
  } finally {
    clearTimeout(stall);
    await fs.promises.rm(file + '.part', { force: true }).catch(() => {});
  }
}
const untar = (tgz, dir) => new Promise((ok) => {
  const p = spawn('tar', ['-xzf', tgz, '-C', dir], { windowsHide: true });
  p.on('exit', (code) => ok(code));
  p.on('error', () => ok(1));
});
const stampOf = (a) => `${a.size}|${a.updated_at || ''}`;

let syncing = null;
export const syncFrost = () => { if (!syncing) syncing = syncOnce().finally(() => { syncing = null; }); return syncing; };
async function syncOnce() {
  const got = [];
  try {
    await fs.promises.mkdir(FROST_RUNS, { recursive: true });
    const dl = path.join(FROST_DATA, '_dl');
    await fs.promises.rm(dl, { recursive: true, force: true });
    const cut = Date.now() - KEEP_H * 3600e3;
    const assets = (await releaseAssets('tcm-frost'))
      .map((a) => ({ a, m: ASSET_RE.exec(a.name) })).filter((x) => x.m)
      .map(({ a, m }) => ({ a, tag: `${m[1].slice(0, 8)}T${m[1].slice(8, 10)}00Z` }))
      .filter((x) => tagMs(x.tag) >= cut)
      .sort((x, y) => y.tag.localeCompare(x.tag));                          // newest first
    for (const { a, tag } of assets) {
      const dir = path.join(FROST_RUNS, tag);
      let stamp = null;
      try { stamp = await fs.promises.readFile(path.join(dir, '.release-asset'), 'utf8'); } catch { /* not here */ }
      if (stamp === stampOf(a)) continue;
      const tgz = path.join(dl, a.name);
      await fetchTo(a.browser_download_url, tgz);
      const tmp = path.join(dl, `x-${tag}`);
      await fs.promises.mkdir(tmp, { recursive: true });
      const code = await untar(tgz, tmp);
      if (code === 0 && fs.existsSync(path.join(tmp, tag, 'manifest.json'))) {
        /* the first runs (engine 1.0.0) called the expected snow 'snow_acc' */
        const old = path.join(tmp, tag, 'snow_acc');
        if (fs.existsSync(old) && !fs.existsSync(path.join(tmp, tag, 'snow_expected'))) await fs.promises.rename(old, path.join(tmp, tag, 'snow_expected'));
        await fs.promises.rm(dir, { recursive: true, force: true });
        await fs.promises.rename(path.join(tmp, tag), dir);
        await fs.promises.writeFile(path.join(dir, '.release-asset'), stampOf(a));
        got.push(tag);
        points.delete(tag);
      }
      await fs.promises.rm(tmp, { recursive: true, force: true });
      await fs.promises.rm(tgz, { force: true });
    }
    /* runs older than 48 h go (local test runs too) */
    for (const n of (await fs.promises.readdir(FROST_RUNS)).filter((x) => TAG_RE.test(x))) {
      if (tagMs(n) < cut) { await fs.promises.rm(path.join(FROST_RUNS, n), { recursive: true, force: true }); points.delete(n); }
    }
    if (got.length) { runsCache.at = 0; console.log(`[frost] mirrored ${got.join(', ')}`); }
  } catch (e) {
    console.warn(`[frost] sync: ${e.message}`);
  }
}

/* ── a place's forecast, from the run's point cube (read once, kept) ── */
const points = new Map();                                 // tag -> Promise<cube>
function loadPoint(tag) {
  if (!points.has(tag)) {
    points.set(tag, (async () => {
      const raw = await new Promise((ok, no) => fs.readFile(path.join(FROST_RUNS, tag, '_point.bin'), (e, b) => (e ? no(e) : zlib.gunzip(b, (e2, r) => (e2 ? no(e2) : ok(r))))));
      const n = raw.readUInt32LE(0);
      const head = JSON.parse(raw.subarray(4, 4 + n).toString('utf8'));
      let o = 4 + n;
      const idx = new Uint32Array(raw.buffer.slice(raw.byteOffset + o, raw.byteOffset + o + head.cells * 4)); o += head.cells * 4;
      const L = head.leads.length, Dn = head.days.length;
      const series = raw.subarray(o, o + head.cells * L * 3); o += head.cells * L * 3;
      const days = raw.subarray(o, o + head.cells * Dn * 6);
      const at = new Map();
      for (let i = 0; i < idx.length; i++) at.set(idx[i], i);
      return { head, at, series, days };
    })().catch((e) => { points.delete(tag); throw e; }));
    while (points.size > 4) points.delete(points.keys().next().value);
  }
  return points.get(tag);
}
/* bytes back to values, as the frames encode them */
const decode = ({ lo, hi, scale }, q) => (q === 255 ? null : scale === 'sqrt' ? (Math.sqrt(lo) + (q / 254) * (Math.sqrt(hi) - Math.sqrt(lo))) ** 2 : lo + (q / 254) * (hi - lo));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/* the grid (Model Data's 'uk'): Lambert azimuthal equal-area on WGS84, centred 54.9N 2.5W */
const DEG = Math.PI / 180;
const A = 6378137, FL = 1 / 298.257223563, E2 = FL * (2 - FL), E = Math.sqrt(E2);
const qf = (s) => (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
const QP = qf(1), RQ = A * Math.sqrt(QP / 2);
const PHI1 = 54.9 * DEG, LAM0 = -2.5 * DEG;
const B1 = Math.asin(qf(Math.sin(PHI1)) / QP);
const DD = (A * Math.cos(PHI1) / Math.sqrt(1 - E2 * Math.sin(PHI1) ** 2)) / (RQ * Math.cos(B1));
function cellIndex(lat, lon) {
  const b = Math.asin(qf(Math.sin(lat * DEG)) / QP);
  const dl = lon * DEG - LAM0;
  const bb = RQ * Math.sqrt(2 / (1 + Math.sin(B1) * Math.sin(b) + Math.cos(B1) * Math.cos(b) * Math.cos(dl)));
  const x = bb * DD * Math.cos(b) * Math.sin(dl), y = (bb / DD) * (Math.cos(B1) * Math.sin(b) - Math.sin(B1) * Math.cos(b) * Math.cos(dl));
  const col = Math.round((x + 1158000) / 2000), row = Math.round((902000 - y) / 2000);
  return row >= 0 && row < 970 && col >= 0 && col < 1042 ? row * 1042 + col : -1;
}

/** A place's snow forecast from a run (the newest by default); null where it has none. */
export async function frostPoint(lat, lon, tag = null) {
  const runs = await frostRuns();
  const run = tag ? runs.find((r) => r.tag === tag) : runs[0];
  if (!run) return null;
  const P = await loadPoint(run.tag);
  let k = cellIndex(lat, lon);
  let i = P.at.get(k);
  if (i == null && k >= 0) {                              // a coastal place just off the land cells: the nearest land within 4 km
    for (const d of [1, -1, 1042, -1042, 1043, -1043, 1041, -1041, 2, -2, 2084, -2084]) { i = P.at.get(k + d); if (i != null) break; }
  }
  if (i == null) return null;
  const { head, series, days } = P;
  const L = head.leads.length, Dn = head.days.length;
  const steps = head.leads.map((lead, j) => {
    const o = (i * L + j) * 3;
    return { lead, valid: head.valid[j], acc_cm: r1(decode(head.enc.snow_expected || head.enc.snow_acc, series[o])), chance: series[o + 1], risk: series[o + 2] };
  });
  const dayList = head.days.map((date, j) => {
    const o = (i * Dn + j) * 6;
    return { date, cm: r1(decode(head.enc.snow_24h, days[o])), p0: days[o + 1], p1: days[o + 2], p5: days[o + 3], p10: days[o + 4], risk: days[o + 5], riskName: RISK_NAMES[days[o + 5]] };
  });
  return { run: run.run, tag: run.tag, created: run.created, members: run.members, engine: run.engine, steps, days: dayList };
}

export function mountTcmFrost(app) {
  fs.mkdirSync(FROST_RUNS, { recursive: true });
  setTimeout(syncFrost, 30e3).unref?.();
  setInterval(syncFrost, 10 * 60e3).unref?.();
  app.get('/api/frost/runs', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ runs: await frostRuns() });
  });
  app.get('/api/frost/point', async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon' });
    const tag = TAG_RE.test(String(req.query.run || '')) ? String(req.query.run) : null;
    try {
      const p = await frostPoint(lat, lon, tag);
      res.set('Cache-Control', 'no-cache');
      return p ? res.json(p) : res.status(404).json({ error: 'no TCM FROST forecast here yet' });
    } catch (e) {
      return res.status(503).json({ error: `TCM FROST: ${e.message}` });
    }
  });
}
