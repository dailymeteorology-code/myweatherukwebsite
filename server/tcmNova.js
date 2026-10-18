/**
 * TCM NOVA — run scheduler and data API.
 *
 * Two products, kept apart end to end (separate directories, routes and jobs):
 *   main   TCM Main Run   2 km, 03/09/15/21 Europe/London, AWS multi-model blend
 *   hyper  TCM Hyper-Short 1.5 km, every hour, 24 h at 30 min, observations only
 *
 * The forecasts are made by the Python package in tools/tcm-nova; this file only
 * starts those jobs on the clock and serves what they have PUBLISHED. Data lives
 * on the external drive (D:/TCM-NOVA/data) unless NOVA_DATA says otherwise.
 *
 * Every data route names its product, and a run id is checked against that
 * product, so a Main Run frame can never be served as Hyper-Short or vice versa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(here, '..', 'tools', 'tcm-nova');
const DATA = process.env.NOVA_DATA
  || (fs.existsSync('D:/') ? 'D:/TCM-NOVA/data' : path.join(here, 'data', 'tcm-nova'));
const PY = process.env.NOVA_PYTHON || (() => {
  const g = path.resolve(here, '..', '..', 'ukv-platform', '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(g) ? g : 'python';
})();

export const PRODUCTS = {
  main: { module: 'nova.main_run', cycles: ['03:00', '09:00', '15:00', '21:00'], timeoutMin: 300 },
  hyper: { module: 'nova.hyper.run', everyMinutes: 60, timeoutMin: 58 },
  /* nightly learning: verify the day just ended, retrain weights, recalibrate, write the report */
  learning: { module: 'nova.learn', cycles: ['00:00'], timeoutMin: 240, noInit: true },
};
const SAFE_ID = /^(main|hyper)-\d{8}T\d{4}Z$/;
const SAFE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_FIELD = /^[a-z0-9_]{1,40}$/;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* ── schedule maths (exported for tests) ──────────────────────────────────── */

/** Wall-clock parts of a UTC instant in Europe/London. */
export function londonParts(d) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t) => Number(f.find((p) => p.type === t).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
}

/** Next Main Run initialisation strictly after `from` (Europe/London cycles, DST-safe:
 *  walk forward minute by minute in 15-minute steps and test the London wall clock). */
export function nextMainCycle(from = new Date(), cycles = PRODUCTS.main.cycles) {
  const want = new Set(cycles);
  let t = new Date(Math.floor(from.getTime() / 900000) * 900000 + 900000);
  for (let i = 0; i < 4 * 24 * 3; i += 1, t = new Date(t.getTime() + 900000)) {
    const p = londonParts(t);
    if (want.has(`${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`)) return t;
  }
  return null;
}

/** Next Hyper-Short initialisation: top of the next London clock hour. */
export function nextHyperCycle(from = new Date()) {
  let t = new Date(Math.floor(from.getTime() / 900000) * 900000 + 900000);
  for (let i = 0; i < 8; i += 1, t = new Date(t.getTime() + 900000)) {
    if (londonParts(t).mi === 0) return t;
  }
  return null;
}

/* ── job runner ───────────────────────────────────────────────────────────── */

const running = {};
function startJob(product, init) {
  if (running[product]) {
    console.warn(`[nova] ${product}: previous job still running — not starting an overlapping one`);
    return false;
  }
  const iso = init.toISOString().slice(0, 16);
  const local = londonParts(init);
  const localIso = `${local.y}-${String(local.mo).padStart(2, '0')}-${String(local.d).padStart(2, '0')}T${String(local.h).padStart(2, '0')}:${String(local.mi).padStart(2, '0')}`;
  const args = PRODUCTS[product].noInit ? ['-m', PRODUCTS[product].module] : ['-m', PRODUCTS[product].module, '--init', localIso];
  const child = spawn(PY, args, { cwd: TOOL, env: { ...process.env, PYTHONPATH: TOOL, NOVA_DATA: DATA }, windowsHide: true });
  running[product] = { pid: child.pid, init: iso, started: new Date().toISOString() };
  const logFile = path.join(DATA, product, 'job.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  out.write(`\n=== ${new Date().toISOString()} ${product} init ${localIso} (London)\n`);
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  const killer = setTimeout(() => child.kill(), PRODUCTS[product].timeoutMin * 60000);
  child.on('exit', (code) => {
    clearTimeout(killer);
    out.end(`=== exit ${code}\n`);
    delete running[product];
    if (code !== 0) console.warn(`[nova] ${product} ${iso} exited ${code}`);
  });
  return true;
}

function scheduleLoop(product, nextFn) {
  const arm = () => {
    const at = nextFn(new Date());
    if (!at) return;
    setTimeout(() => { startJob(product, at); arm(); }, Math.max(1000, at - Date.now()));
  };
  arm();
}

/* ── data access ──────────────────────────────────────────────────────────── */

function listRuns(product) {
  const dir = path.join(DATA, product);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => SAFE_ID.test(n) && n.startsWith(product + '-'))
    .sort().reverse()
    .map((id) => {
      const m = readJson(path.join(dir, id, 'manifest.json'));
      return m && {
        run_id: id, product, status: m.status, init_utc: m.init_utc, init_local: m.init_local,
        horizon_h: m.horizon_h, resolution_m: m.resolution_m, frames: m.frames?.length || 0,
      };
    }).filter(Boolean);
}

function manifest(product, id) {
  if (!SAFE_ID.test(id) || !id.startsWith(product + '-')) return null;
  return readJson(path.join(DATA, product, id, 'manifest.json'));
}

/* ── cloud sync ────────────────────────────────────────────────────────────
   NOVA_MODE=cloud (default): GitHub Actions (.github/workflows/nova.yml) makes every run,
   so they continue with this PC off; this server only mirrors the published results into
   DATA every 10 minutes. NOVA_MODE=local: this PC runs the jobs itself (the old way). */
const REPO = process.env.NOVA_REPO || 'dailymeteorology-code/myweatherukwebsite';
const MODE = process.env.NOVA_MODE || 'cloud';
let syncState = { last: null, error: null, downloaded: [] };

async function releaseAssets(tag) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers: { 'User-Agent': 'MyWeatherUK-NOVA', Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GitHub ${tag}: ${r.status}`);
  return (await r.json()).assets || [];
}

async function fetchTo(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'MyWeatherUK-NOVA' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()));
  fs.renameSync(file + '.part', file);
}

export async function syncFromGitHub() {
  const got = [];
  try {
    for (const product of ['main', 'hyper']) {
      const dir = path.join(DATA, product);
      fs.mkdirSync(dir, { recursive: true });
      for (const a of await releaseAssets(`nova-${product}`)) {
        const m = /^((main|hyper)-\d{8}T\d{4}Z)\.tar\.gz$/.exec(a.name);
        if (!m || fs.existsSync(path.join(dir, m[1], 'manifest.json'))) continue;
        const tgz = path.join(DATA, '_dl', a.name);
        await fetchTo(a.browser_download_url, tgz);
        const x = spawnSync('tar', ['-xzf', tgz, '-C', dir], { windowsHide: true });
        fs.rmSync(tgz, { force: true });
        if (x.status === 0) got.push(m[1]);
      }
      const runs = fs.readdirSync(dir).filter((n) => SAFE_ID.test(n) && fs.existsSync(path.join(dir, n, 'manifest.json'))).sort();
      const newest = runs.reverse().find((n) => ['published', 'degraded'].includes(readJson(path.join(dir, n, 'manifest.json'))?.status));
      if (newest) fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ run_id: newest }));
    }
    for (const a of await releaseAssets('nova-state')) {
      if (a.name.endsWith('.json') && a.name !== 'latest.json') await fetchTo(a.browser_download_url, path.join(DATA, a.name));
      if (a.name === 'reports.tar.gz') {
        const tgz = path.join(DATA, '_dl', a.name);
        await fetchTo(a.browser_download_url, tgz);
        fs.mkdirSync(path.join(DATA, 'learning'), { recursive: true });
        spawnSync('tar', ['-xzf', tgz, '-C', path.join(DATA, 'learning')], { windowsHide: true });
        const days = fs.readdirSync(path.join(DATA, 'learning', 'reports')).filter((f) => f.endsWith('.json')).sort();
        if (days.length) fs.writeFileSync(path.join(DATA, 'learning', 'latest.json'), JSON.stringify({ day: days.at(-1).replace('.json', '') }));
      }
    }
    for (const a of await releaseAssets('nova-lightning')) {
      const f = path.join(DATA, 'lightning', a.name);
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(a.name) && (!fs.existsSync(f) || fs.statSync(f).size !== a.size)) await fetchTo(a.browser_download_url, f);
    }
    syncState = { last: new Date().toISOString(), error: null, downloaded: got };
    if (got.length) console.log(`[nova] synced from GitHub: ${got.join(', ')}`);
  } catch (e) {
    syncState = { ...syncState, last: new Date().toISOString(), error: String(e.message || e) };
    console.warn(`[nova] GitHub sync failed: ${e.message}`);
  }
}

/* ── lightning: every UK & Ireland strike for a UK calendar day ───────────────
   Met Office LEELA keeps 48 h, so the whole of "today" (and yesterday) is always
   available; older days come from the archive the GitHub workflow keeps (see
   .github/workflows/nova.yml) once it has been synced to DATA/lightning. */
const LEELA = 'https://data.consumer-digital.api.metoffice.gov.uk/v1/lightning';
const UKI = { s: 49.0, n: 61.5, w: -11.5, e: 2.5 };
let leelaCache = { at: 0, strikes: [] };

async function leelaStrikes() {
  if (Date.now() - leelaCache.at < 3 * 60000) return leelaCache.strikes;
  const get = async (q) => (await fetch(`${LEELA}?last-minutes=2880${q}`, { headers: { 'User-Agent': 'MyWeatherUK-TCM-NOVA' } })).json();
  const first = await get('');
  let all = first.lightning_strikes || [];
  for (const c of first.chunks || []) {
    try { all = all.concat((await get(`&chunk=${c.chunk}`)).lightning_strikes || []); } catch { /* skip a bad chunk */ }
  }
  const out = [];
  for (const s of all) {
    const [lon, lat] = s.coordinates || [];
    const t = Date.parse(s.strike_time);
    if (Number.isFinite(t) && lat >= UKI.s && lat <= UKI.n && lon >= UKI.w && lon <= UKI.e) out.push([t, +lat.toFixed(4), +lon.toFixed(4)]);
  }
  out.sort((a, b) => a[0] - b[0]);
  leelaCache = { at: Date.now(), strikes: out };
  return out;
}

function londonDayBounds(day) {
  // UTC instants of 00:00 and 24:00 Europe/London for YYYY-MM-DD (DST-safe)
  const guess = Date.parse(`${day}T00:00:00Z`);
  const off = (t) => { const p = londonParts(new Date(t)); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t; };
  const start = guess - off(guess);
  const end = Date.parse(`${day}T00:00:00Z`) + 86400000;
  return [start, end - off(end)];
}

export function mountTcmNova(app, { schedule = process.env.NOVA_SCHEDULE !== 'off' } = {}) {
  app.get('/api/nova/lightning/day', async (req, res) => {
    const p = londonParts(new Date());
    const today = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    const day = SAFE_DAY.test(req.query.date || '') ? req.query.date : today;
    const [t0, t1] = londonDayBounds(day);
    let strikes = [];
    let source = 'Met Office LEELA (48 h feed)';
    if (Date.now() - t0 < 47 * 3600000) {
      try { strikes = (await leelaStrikes()).filter((s) => s[0] >= t0 && s[0] < t1); } catch (e) { source = `LEELA unavailable (${e.message})`; }
    }
    if (!strikes.length) {
      const f = path.join(DATA, 'lightning', `${day}.json`);
      const arch = readJson(f);
      if (arch) { strikes = arch.strikes; source = 'NOVA lightning archive'; }
    }
    res.set('Cache-Control', 'public, max-age=120');
    res.json({ day, from: new Date(t0).toISOString(), to: new Date(t1).toISOString(), source, count: strikes.length,
      fields: ['time_ms', 'lat', 'lon'], strikes });
  });

  /* learning reports — registered before the /:product routes so 'learning' is not read as a product */
  app.get('/api/nova/learning/latest', (req, res) => {
    const l = readJson(path.join(DATA, 'learning', 'latest.json'));
    const r = l && readJson(path.join(DATA, 'learning', 'reports', `${l.day}.json`));
    if (!r) return res.status(404).json({ error: 'no learning report yet', status: readJson(path.join(DATA, 'learning', 'status.json')) });
    res.json(r);
  });
  app.get('/api/nova/learning/days', (req, res) => {
    let files = [];
    try { files = fs.readdirSync(path.join(DATA, 'learning', 'reports')); } catch { /* none yet */ }
    res.json({ days: files.map((f) => f.replace('.json', '')).filter((d) => SAFE_DAY.test(d)).sort().reverse() });
  });
  app.get('/api/nova/learning/report/:day', (req, res) => {
    if (!SAFE_DAY.test(req.params.day)) return res.status(400).end();
    const r = readJson(path.join(DATA, 'learning', 'reports', `${req.params.day}.json`));
    return r ? res.json(r) : res.status(404).json({ error: 'no report for that day' });
  });
  app.get('/api/nova/calibration', (req, res) => {
    res.json({ calibration: readJson(path.join(DATA, 'calibration.json')), skill: readJson(path.join(DATA, 'skill.json')) });
  });

  const prod = (req, res) => {
    const p = req.params.product;
    if (p !== 'main' && p !== 'hyper') { res.status(400).json({ error: 'product must be "main" or "hyper"' }); return null; }
    return p;
  };

  app.get('/api/nova/:product/runs', (req, res) => {
    const p = prod(req, res); if (!p) return;
    res.json({ product: p, runs: listRuns(p) });
  });

  app.get('/api/nova/:product/latest', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const latest = readJson(path.join(DATA, p, 'latest.json'));
    const m = latest && manifest(p, latest.run_id);
    if (!m) return res.status(404).json({ error: `no published ${p} run yet`, status: readJson(path.join(DATA, p, 'status.json')) });
    res.set('Cache-Control', 'no-cache');
    res.json(m);
  });

  app.get('/api/nova/:product/runs/:id', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const m = manifest(p, req.params.id);
    if (!m) return res.status(404).json({ error: 'no such run for this product' });
    res.json(m);
  });

  /* one field of one frame: raw zlib-compressed float16/int8, row 0 = south */
  app.get('/api/nova/:product/runs/:id/frame/:lead/:field', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const { id, lead, field } = req.params;
    const m = manifest(p, id);
    if (!m) return res.status(404).json({ error: 'no such run for this product' });
    const leadMin = Number(lead);
    if (!Number.isInteger(leadMin) || leadMin < 0 || leadMin > m.horizon_h * 60) {
      return res.status(416).json({ error: `lead outside this run's ${m.horizon_h} h horizon` });
    }
    if (!m.frames.some((f) => f.lead_min === leadMin)) return res.status(404).json({ error: 'no frame at that lead' });
    if (!SAFE_FIELD.test(field) || !m.fields[field]) return res.status(404).json({ error: 'unknown field' });
    const file = path.join(DATA, p, id, 'frames', String(leadMin), `${field}.bin`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'field not in this frame' });
    res.set({ 'Content-Type': 'application/octet-stream', 'X-Nova-Dtype': m.fields[field], 'Cache-Control': 'public, max-age=86400, immutable' });
    fs.createReadStream(file).pipe(res);
  });

  app.get('/api/nova/:product/status', (req, res) => {
    const p = prod(req, res); if (!p) return;
    const st = readJson(path.join(DATA, p, 'status.json')) || {};
    res.json({
      ...st, product: p, running: running[p] || null, mode: MODE, sync: syncState,
      next_cycle_utc: (p === 'main' ? nextMainCycle() : nextHyperCycle())?.toISOString(),
    });
  });

  app.get('/api/nova/terrain/:grid', (req, res) => {
    if (!/^gb(2km|1p5km)$/.test(req.params.grid)) return res.status(404).end();
    res.json(readJson(path.join(DATA, 'terrain', `${req.params.grid}-terrain-1.1.0.json`)) || {});
  });

  if (schedule && MODE === 'cloud') {
    syncFromGitHub();
    setInterval(syncFromGitHub, 10 * 60000);
    console.log(`[nova] cloud mode: runs are made by GitHub Actions; mirroring ${REPO} releases into ${DATA} every 10 min`);
  } else if (schedule) {
    scheduleLoop('main', nextMainCycle);
    scheduleLoop('hyper', nextHyperCycle);
    scheduleLoop('learning', (from) => nextMainCycle(from, PRODUCTS.learning.cycles));
    console.log(`[nova] scheduler armed: main next ${nextMainCycle()?.toISOString()}, hyper next ${nextHyperCycle()?.toISOString()}, learning next ${nextMainCycle(new Date(), PRODUCTS.learning.cycles)?.toISOString()} (data ${DATA})`);
  }
}
