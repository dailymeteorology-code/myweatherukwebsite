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
import { spawn } from 'node:child_process';
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
  hyper: { module: 'nova.hyper.run', everyMinutes: 60, timeoutMin: 50 },
};
const SAFE_ID = /^(main|hyper)-\d{8}T\d{4}Z$/;
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
  const args = ['-m', PRODUCTS[product].module, '--init', localIso];
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

export function mountTcmNova(app, { schedule = process.env.NOVA_SCHEDULE !== 'off' } = {}) {
  const prod = (req, res) => {
    const p = req.params.product;
    if (!PRODUCTS[p]) { res.status(400).json({ error: 'product must be "main" or "hyper"' }); return null; }
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
      ...st, product: p, running: running[p] || null,
      next_cycle_utc: (p === 'main' ? nextMainCycle() : nextHyperCycle())?.toISOString(),
    });
  });

  app.get('/api/nova/terrain/:grid', (req, res) => {
    if (!/^gb(2km|1p5km)$/.test(req.params.grid)) return res.status(404).end();
    res.json(readJson(path.join(DATA, 'terrain', `${req.params.grid}-terrain-1.0.0.json`)) || {});
  });

  if (schedule) {
    scheduleLoop('main', nextMainCycle);
    scheduleLoop('hyper', nextHyperCycle);
    console.log(`[nova] scheduler armed: main next ${nextMainCycle()?.toISOString()}, hyper next ${nextHyperCycle()?.toISOString()} (data ${DATA})`);
  }
}
