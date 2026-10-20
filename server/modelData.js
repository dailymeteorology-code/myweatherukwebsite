/* Model Data viewer API: AWS model fields on the UKV 2 km display grid.

   The Python side (tools/modeldata/mdata) does the fetching and gridding; this module
   serves what it makes, runs its jobs (low priority, two at a time) and keeps the run
   catalogue fresh.

     GET /api/modeldata/catalog                         models, runs, steps, variables
     GET /api/modeldata/static/:file                    basemap.png, lines.json, cities.json, grid.json
     GET /api/modeldata/frames/:model/:run/:var/status  starts the job if needed; progress
     GET /api/modeldata/frames/:model/:run/:var/:step   one gzip frame (uint8 grid + JSON header)
*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveEnsPython } from './pastFuture/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..', 'tools', 'modeldata');
const DATA = process.env.MODELDATA_DIR || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/modeldata' : path.join(HERE, 'data', 'modeldata'));
const STATIC_FILES = new Set(['basemap.png', 'basemap_light.png', 'sat_day.jpg', 'night_lights.png', 'lines.json', 'cities.json', 'grid.json', 'roads.json', 'roads.bin']);
const MODELS = new Set(['ukv', 'mo_global', 'ifs', 'aifs', 'gfs', 'gefs_mean', 'gefs_aer']);
const ENS_MODELS = new Set(['ecmwf_ens', 'aifs_ens', 'gefs']);
const RUN_RE = /^\d{8}T\d{4}Z$/;
const VAR_RE = /^[a-z0-9_]{2,20}$/;
const MAX_USER_JOBS = 3;               // what someone is waiting for
const MAX_PREFETCH_JOBS = 1;           // background warming, never in the way

const running = new Map();            // key -> { child, prefetch }
const queue = [];                     // [{key, args, prefetch}]
let catalogBusy = false;

function python(args, onExit) {
  const py = resolveEnsPython();
  const env = { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8' };
  const child = spawn(py.cmd, ['-m', ...args], { cwd: TOOL, env, windowsHide: true });
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not fatal */ }
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  child.on('exit', (code) => onExit?.(code, err));
  child.on('error', (e) => onExit?.(1, String(e)));
  return child;
}

const runIso = (tag) => `${tag.slice(0, 4)}-${tag.slice(4, 6)}-${tag.slice(6, 8)}T${tag.slice(9, 11)}:${tag.slice(11, 13)}Z`;
const frameDir = (model, run, v) => (ENS_MODELS.has(model) ? path.join(DATA, 'frames', 'ens', model, run, v) : path.join(DATA, 'frames', model, run, v));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function pump() {
  const count = (p) => [...running.values()].filter((r) => r.prefetch === p).length;
  for (let i = 0; i < queue.length;) {
    const job = queue[i];
    if (running.has(job.key)) { queue.splice(i, 1); continue; }
    if (count(job.prefetch) >= (job.prefetch ? MAX_PREFETCH_JOBS : MAX_USER_JOBS)) { i++; continue; }
    queue.splice(i, 1);
    const child = python([ENS_MODELS.has(job.args[0]) ? 'mdata.ens' : 'mdata.job', ...job.args], (code, err) => {
      running.delete(job.key);
      if (code) console.warn(`[modeldata] job ${job.key} failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
      pump();
    });
    running.set(job.key, { child, prefetch: job.prefetch });
  }
}

function ensureJob(model, run, v, prefetch = false, first = null) {
  const key = `${model}/${run}/${v}`;
  if (running.has(key)) return;
  const queued = queue.find((q) => q.key === key);
  if (queued) {
    if (!prefetch && queued.prefetch) {                 // someone is now waiting for it
      queued.prefetch = false;
      if (first != null) queued.args = [model, runIso(run), v, String(first)];
      pump();
    }
    return;
  }
  const st = readJson(path.join(frameDir(model, run, v), 'status.json'));
  if (st?.state === 'complete' && !grown(model, run, st)) return;
  queue.push({ key, args: [model, runIso(run), v, ...(first != null ? [String(first)] : [])], prefetch });
  pump();
}

/* has the run published more steps since this variable's frames were made? (a run reaches AWS
   step by step, so the first job of a fresh run is partial; it is topped up as steps arrive) */
let catCache = { at: 0, cat: null };
function catalogNow() {
  if (Date.now() - catCache.at > 30000) catCache = { at: Date.now(), cat: readJson(path.join(DATA, 'catalog.json')) };
  return catCache.cat;
}
function grown(model, run, st) {
  const cat = catalogNow();
  const m = [...(cat?.models || []), ...(cat?.ensembles || [])].find((x) => x.id === model);
  const r = m?.runs?.find((x) => x.run.replace(/[-:]/g, '').slice(0, 13) + 'Z' === run);
  return !!r && Array.isArray(st.steps) && r.steps.length > st.steps.length;
}

/* the run the page opens on: the newest run that reaches most of the way (UKV runs every
   hour, but only some go beyond T+12) */
export function defaultRun(m) {
  const most = Math.max(0, ...m.runs.map((r) => r.steps.length));
  return m.runs.find((r) => r.steps.length >= 0.6 * most) || m.runs[0];
}

/* warmed in the background (one job at a time) for each model's default run, most-used first */
const PREFETCH = ['precip_rate', 'precip_total', 't2', 'gust10', 'mslp', 'refc', 'cape_mu'];
/* Met Office Global files are whole-globe downloads (~7 MB a field a step): warm only the top three */
const PREFETCH_LIMIT = { mo_global: 3, gefs_mean: 2 };

let liveBusy = false;
function refreshLive() {
  if (liveBusy) return;
  liveBusy = true;
  python(['mdata.live', 'update'], (code, err) => {
    liveBusy = false;
    if (code) console.warn(`[modeldata] live update failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
  });
}

function refreshCatalog() {
  if (catalogBusy) return;
  catalogBusy = true;
  python(['mdata.catalog'], (code, err) => {
    catalogBusy = false;
    if (code) { console.warn(`[modeldata] catalogue failed: ${err.slice(-300)}`); return; }
    const cat = readJson(path.join(DATA, 'catalog.json'));
    for (const m of cat?.models || []) {
      const r = m.runs?.length ? defaultRun(m) : null;
      if (!r) continue;
      const tag = r.run.replace(/[-:]/g, '').replace(/\+0000$/, 'Z').slice(0, 13) + 'Z';
      for (const v of PREFETCH.filter((x) => m.variables?.includes(x)).slice(0, PREFETCH_LIMIT[m.id] ?? 99)) ensureJob(m.id, tag, v, true);
    }
  });
}

export function mountModelData(app) {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(path.join(DATA, 'static', 'sat_day.jpg'))) python(['mdata.static'], (c, e) => c && console.warn(`[modeldata] static build failed: ${e.slice(-300)}`));
  refreshCatalog();
  setInterval(refreshCatalog, 3 * 60 * 1000).unref();      // new runs and new steps within ~3 min of reaching AWS
  refreshLive();
  setInterval(refreshLive, 2 * 60 * 1000).unref();         // satellite, radar, lightning

  app.get('/api/modeldata/catalog', (req, res) => {
    const f = path.join(DATA, 'catalog.json');
    if (!fs.existsSync(f)) return res.status(503).json({ error: 'catalogue is being built, try again in a minute' });
    res.set('Cache-Control', 'no-cache');
    res.sendFile(f);
  });

  app.get('/api/modeldata/static/:file', (req, res) => {
    if (!STATIC_FILES.has(req.params.file)) return res.status(404).end();
    const f = path.join(DATA, 'static', req.params.file);
    if (!fs.existsSync(f)) return res.status(503).json({ error: 'map layers are being built' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(f);
  });

  const valid = (p) => (MODELS.has(p.model) || ENS_MODELS.has(p.model)) && RUN_RE.test(p.run) && VAR_RE.test(p.v);

  app.get('/api/modeldata/frames/:model/:run/:v/status', (req, res) => {
    if (!valid(req.params)) return res.status(400).json({ error: 'bad request' });
    const { model, run, v } = req.params;
    const st = readJson(path.join(frameDir(model, run, v), 'status.json'));
    const key = `${model}/${run}/${v}`;
    const first = /^\d{1,3}$/.test(String(req.query.first || '')) ? Number(req.query.first) : null;
    if (!st || (!running.has(key) && (st.state !== 'complete' || grown(model, run, st)))) ensureJob(model, run, v, false, first);
    else if (first != null && st.state !== 'complete' && ENS_MODELS.has(model)) {
      /* a running ensemble job builds around where the viewer is now */
      fs.promises.writeFile(path.join(frameDir(model, run, v), 'focus.json'), JSON.stringify({ step: first })).catch(() => {});
    }
    res.set('Cache-Control', 'no-cache');
    res.json(st ? { ...st, queued: queue.some((q) => q.key === key) } : { state: 'queued', done: [], missing: [] });
  });

  /* live layers: satellite images, radar frames, lightning */
  const LIVE_PRODUCTS = new Set(['sat_ir', 'sat_vis', 'sat_geo', 'sat_true', 'sat_fog', 'sat_wv', 'sat_airmass', 'sat_conv', 'sat_cth', 'radar',
    'now_t2', 'now_td2', 'now_rh2', 'now_wind10', 'now_wdir10', 'now_gust10', 'now_mslp', 'now_windchill', 'now_feels', 'now_tcc', 'now_wx']);

  /* observed days (mdata/now.py): each day's extremes, rainfall total and lightning, kept for good */
  const OBS_DIR = path.join(DATA, 'observed');
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const OBS_FILE_RE = /^(t2_max|t2_min|td2_max|td2_min|rh2_max|rh2_min|wind10_max|gust10_max|mslp_max|mslp_min|windchill_min|feels_max|feels_min|precip_total|rain_rate_max)\.bin$/;
  app.get('/api/modeldata/observed/days', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(readJson(path.join(OBS_DIR, 'days.json')) || { days: [] });
  });
  app.get('/api/modeldata/observed/:day/:file', (req, res) => {
    const { day, file } = req.params;
    if (!DAY_RE.test(day)) return res.status(400).end();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const cache = day < today ? 'public, max-age=3600' : 'no-cache';           // today's keep changing
    if (file === 'summary.json' || file === 'strikes.json') {
      const f = path.join(OBS_DIR, day, file);
      if (!fs.existsSync(f)) return res.status(404).end();
      res.set('Cache-Control', cache);
      return res.sendFile(f);
    }
    if (!OBS_FILE_RE.test(file)) return res.status(400).end();
    const f = path.join(OBS_DIR, day, file);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': cache });
    fs.createReadStream(f).pipe(res);
  });
  app.get('/api/modeldata/live/catalog', (req, res) => {
    const f = path.join(DATA, 'live', 'catalog.json');
    if (!fs.existsSync(f)) return res.status(503).json({ error: 'live layers are starting' });
    res.set('Cache-Control', 'no-cache');
    res.sendFile(f);
  });
  app.get('/api/modeldata/live/lightning', (req, res) => {
    const f = path.join(DATA, 'live', 'lightning.json');
    if (!fs.existsSync(f)) return res.json({ strikes: [] });
    res.set('Cache-Control', 'no-cache');
    res.sendFile(f);
  });
  app.get('/api/modeldata/live/:product/:time', (req, res) => {
    const { product, time } = req.params;
    const m = /^(\d{8}T\d{4})\.(jpg|png|bin)$/.exec(time);
    if (!LIVE_PRODUCTS.has(product) || !m) return res.status(400).end();
    const f = path.join(DATA, 'live', product, time);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    if (m[2] === 'bin') { res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip' }); return fs.createReadStream(f).pipe(res); }
    res.sendFile(f);
  });

  app.get('/api/modeldata/frames/:model/:run/:v/:step', (req, res) => {
    if (!valid(req.params) || !/^\d{1,3}$/.test(req.params.step)) return res.status(400).end();
    const { model, run, v, step } = req.params;
    const f = path.join(frameDir(model, run, v), `${step}.bin`);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400, immutable' });
    fs.createReadStream(f).pipe(res);
  });
}
