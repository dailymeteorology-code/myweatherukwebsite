/* Model Data viewer API: AWS model fields on two display grids: the UKV's own 2 km grid (UKV,
   and everything live and observed) and an 8 km grid from the US east coast to the Volga and
   from Svalbard to the Sahara (the global models and their ensembles, 26 Oct 2026).

   The Python side (tools/modeldata/mdata) does the fetching and gridding; this module
   serves what it makes, runs its jobs (low priority, two at a time) and keeps the run
   catalogue fresh.

     GET /api/modeldata/catalog                         models, runs, steps, variables
     GET /api/modeldata/static/:file                    basemap.png, lines.json, cities.json, grid.json (UK grid)
     GET /api/modeldata/static/eu/:file                 the same for the wide grid
     GET /api/modeldata/frames/:model/:run/:var/status  starts the job if needed; progress
     GET /api/modeldata/frames/:model/:run/:var/:step   one gzip frame (uint8 grid + JSON header)

   It also keeps the UKV "point cubes" the Location page reads (mdata/point.py, read by
   server/locationWeather.js): the frames of POINT_VARS are queued as ordinary background jobs,
   and once they are all made the cube is assembled.
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
export const MODELDATA_DIR = DATA;
const STATIC_FILES = new Set(['basemap.png', 'basemap_light.png', 'sat_day.jpg', 'night_lights.png', 'lines.json', 'cities.json', 'grid.json', 'roads.json', 'roads.bin']);
const MODELS = new Set(['ukv', 'mo_global', 'ifs', 'aifs', 'gfs', 'gefs_mean', 'gefs_aer']);
const ENS_MODELS = new Set(['ecmwf_ens', 'aifs_ens', 'gefs']);
/* each model's grid (mdata/common.py MODEL_GRID): its frames are kept apart, per grid */
export const gridOf = (model) => (model === 'ukv' ? 'uk' : 'eu');
const GRIDS = new Set(['uk', 'eu']);
const RUN_RE = /^\d{8}T\d{4}Z$/;
const VAR_RE = /^[a-z0-9_]{2,20}$/;
const MAX_USER_JOBS = 3;               // what someone is waiting for
const MAX_PREFETCH_JOBS = 1;           // background warming, never in the way
/* downloads in flight per job: someone waiting gets the line; the warming leaves room for them */
const THREADS = (p) => (p === true ? '8' : '16');
const MAX_POINT_JOBS = 3;              // the Location page's UKV frames: their own lane, not behind the warming,
                                        // three at a time so a new run is ready in minutes, not an hour
const LIMIT = (p) => (p === 'point' ? MAX_POINT_JOBS : p ? MAX_PREFETCH_JOBS : MAX_USER_JOBS);

const running = new Map();            // key -> { child, prefetch }
const queue = [];                     // [{key, args, prefetch, rank, seq}]
let seq = 0;
/* the order jobs start in, within a lane: someone waiting first, then the Location page's, then the
   warming, newest run first, the much-used layers before the rest, and Met Office Global (whole-globe
   files, ~7 MB a field a step) after the other models */
function rankOf(model, run, v, prefetch) {
  const lane = prefetch === true ? 2 : prefetch === 'point' ? 1 : 0;
  const tier = PREFETCH.includes(v) ? 0 : 1;
  const heavy = model === 'mo_global' ? 1 : 0;
  return [lane, tier, heavy, -tagMs(run)];
}
const before = (a, b) => {
  for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
  return a.seq - b.seq;
};
let catalogBusy = false;

function python(args, onExit, extraEnv = {}) {
  const py = resolveEnsPython();
  const env = { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8', ...extraEnv };
  const child = spawn(py.cmd, ['-m', ...args], { cwd: TOOL, env, windowsHide: true });
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not fatal */ }
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  child.on('exit', (code) => onExit?.(code, err));
  child.on('error', (e) => onExit?.(1, String(e)));
  return child;
}

const runIso = (tag) => `${tag.slice(0, 4)}-${tag.slice(4, 6)}-${tag.slice(6, 8)}T${tag.slice(9, 11)}:${tag.slice(11, 13)}Z`;
const framesRoot = (model) => path.join(DATA, gridOf(model) === 'uk' ? 'frames' : `frames_${gridOf(model)}`);
const frameDir = (model, run, v) => (ENS_MODELS.has(model) ? path.join(framesRoot(model), 'ens', model, run, v) : path.join(framesRoot(model), model, run, v));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
/* The frames sit on an external hard drive that can take most of a second a file when it is busy;
   where files are read in bulk (every catalogue refresh reads ~30 status files) they are read
   without holding up the site (a bulk synchronous read froze it for 2 s on 12 Nov 2026). */
const readJsonAsync = async (f) => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch { return null; } };

function pump() {
  const count = (p) => [...running.values()].filter((r) => r.prefetch === p).length;
  queue.sort(before);
  for (let i = 0; i < queue.length;) {
    const job = queue[i];
    if (running.has(job.key)) { queue.splice(i, 1); continue; }
    if (count(job.prefetch) >= LIMIT(job.prefetch)) { i++; continue; }
    queue.splice(i, 1);
    const child = python([ENS_MODELS.has(job.args[0]) ? 'mdata.ens' : 'mdata.job', ...job.args], (code, err) => {
      running.delete(job.key);
      if (code) console.warn(`[modeldata] job ${job.key} failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
      pump();
    }, { MDATA_GRID: gridOf(job.args[0]), MDATA_THREADS: THREADS(job.prefetch) });
    running.set(job.key, { child, prefetch: job.prefetch });
  }
}

/* `known`: the frames' status.json when the caller has already read it (null for none) */
function ensureJob(model, run, v, prefetch = false, first = null, known = undefined) {
  const key = `${model}/${run}/${v}`;
  if (running.has(key)) return;
  const queued = queue.find((q) => q.key === key);
  if (queued) {
    if (!prefetch && queued.prefetch) {                 // someone is now waiting for it
      queued.prefetch = false;
      queued.rank = rankOf(model, run, v, false);
      if (first != null) queued.args = [model, runIso(run), v, String(first)];
      pump();
    } else if (prefetch === 'point' && queued.prefetch === true) {
      queued.prefetch = 'point';                        // the Location page needs it: into its own lane
      queued.rank = rankOf(model, run, v, 'point');
      pump();
    }
    return;
  }
  const st = known !== undefined ? known : readJson(path.join(frameDir(model, run, v), 'status.json'));
  if (st?.state === 'complete' && !grown(model, run, st)) return;
  queue.push({ key, args: [model, runIso(run), v, ...(first != null ? [String(first)] : [])], prefetch, rank: rankOf(model, run, v, prefetch), seq: seq++ });
  pump();
}

/* variables whose frames are complete, with the steps they were complete for: the warming checks
   hundreds every catalogue refresh, and need read no file while a run has not grown */
const settled = new Map();
const stepsNow = (model, run) => {
  const m = [...(catalogNow()?.models || []), ...(catalogNow()?.ensembles || [])].find((x) => x.id === model);
  return m?.runs?.find((x) => x.run.replace(/[-:]/g, '').slice(0, 13) + 'Z' === run)?.steps.length ?? null;
};
/** ensureJob, reading the status file in the background first. */
async function ensureJobAsync(model, run, v, prefetch = false, first = null) {
  const key = `${model}/${run}/${v}`;
  if (running.has(key) || queue.some((q) => q.key === key)) return ensureJob(model, run, v, prefetch, first);
  const now = stepsNow(model, run);
  if (now != null && settled.get(key) >= now) return undefined;
  const st = await readJsonAsync(path.join(frameDir(model, run, v), 'status.json'));
  if (st?.state === 'complete' && !grown(model, run, st)) settled.set(key, st.steps?.length ?? 0);
  return ensureJob(model, run, v, prefetch, first, st);
}

/* has the run published more steps since this variable's frames were made? (a run reaches AWS
   step by step, so the first job of a fresh run is partial; it is topped up as steps arrive) */
let catCache = { at: 0, cat: null };
let catLoading = false;
function catalogNow() {
  if (Date.now() - catCache.at > 30000 && !catLoading) {
    if (!catCache.cat) catCache = { at: Date.now(), cat: readJson(path.join(DATA, 'catalog.json')) };   // the first time: wait for it
    else {                                                                                                // after that: refreshed in the background
      catLoading = true;
      readJsonAsync(path.join(DATA, 'catalog.json')).then((cat) => { if (cat) catCache = { at: Date.now(), cat }; }).finally(() => { catLoading = false; });
    }
  }
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
  const runs = m.runs.filter((r) => !r.kept);                      // a run kept only for its reach is never the default
  const most = Math.max(0, ...runs.map((r) => r.steps.length));
  return runs.find((r) => r.steps.length >= 0.6 * most) || runs[0] || m.runs[0];
}

/* Warmed in the background (one job at a time) for each model's default run: these much-used layers
   as the run's steps reach AWS, and every other layer of the run as soon as it is fully published
   (catalog.complete), so a layer is there before anyone asks. A new default run takes over the
   queue; one that is no longer the default is dropped from it. */
const PREFETCH = ['precip_rate', 'precip_total', 't2', 'gust10', 'mslp', 'refc', 'cape_mu'];

/* Two lanes, each one job at a time: 'fast' (radar, lightning, the current-conditions analysis)
   and 'sat' (satellite imagery). Satellite catch-up after the PC has slept is long, and in one job
   it held the radar and "right now" on the night before for half an hour. */
const liveBusy = { fast: false, sat: false };
function refreshLive(lane) {
  if (liveBusy[lane]) return;
  liveBusy[lane] = true;
  python(['mdata.live', 'update', lane], (code, err) => {
    liveBusy[lane] = false;
    if (code) console.warn(`[modeldata] live ${lane} update failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
  });
}

function refreshCatalog() {
  if (catalogBusy) return;
  catalogBusy = true;
  python(['mdata.catalog'], async (code, err) => {
    catalogBusy = false;
    if (code) { console.warn(`[modeldata] catalogue failed: ${err.slice(-300)}`); return; }
    try {
      const cat = await readJsonAsync(path.join(DATA, 'catalog.json'));
      if (cat) catCache = { at: Date.now(), cat };
      const warm = [];
      for (const m of cat?.models || []) {
        const r = m.runs?.length ? defaultRun(m) : null;
        if (!r) continue;
        const tag = r.run.replace(/[-:]/g, '').replace(/\+0000$/, 'Z').slice(0, 13) + 'Z';
        const first = PREFETCH.filter((x) => m.variables?.includes(x));
        const rest = r.complete ? (m.variables || []).filter((x) => !first.includes(x)) : [];
        for (const v of [...first, ...rest]) warm.push([m.id, tag, v]);
      }
      const wanted = new Set(warm.map(([mid, tag, v]) => `${mid}/${tag}/${v}`));
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].prefetch === true && !wanted.has(queue[i].key)) queue.splice(i, 1);
      for (const [mid, tag, v] of warm) await ensureJobAsync(mid, tag, v, true);
      await refreshPoint(cat);
    } catch (e) {
      console.warn(`[modeldata] after the catalogue: ${e.message}`);
    }
  });
}

/* ── point cubes for the Location page ───────────────────────────────────── */
export const POINT_DIR = path.join(DATA, 'point');
/* must match mdata/point.py POINT_VARS */
const POINT_VARS = ['t2', 'td2', 'rh2', 'tskin', 'wind10', 'gust10', 'wdir10', 'mslp', 'precip_rate', 'precip_step',
  'snow_rate', 'snow_step', 'hail_rate', 'tcc', 'lcc', 'mcc', 'hcc', 'cloud_base', 'vis', 'fog', 'cape_mu', 'lightning',
  'frz', 'snow_swe', 'sw_down', 'uv_down'];
const runTag = (iso) => iso.replace(/[-:]/g, '').slice(0, 13) + 'Z';
const tagMs = (t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13));
export function builtCubes() {
  try { return fs.readdirSync(POINT_DIR).filter((t) => RUN_RE.test(t) && fs.existsSync(path.join(POINT_DIR, t, 'manifest.json'))).sort(); } catch { return []; }
}
async function builtCubesAsync() {
  try {
    const names = (await fs.promises.readdir(POINT_DIR)).filter((t) => RUN_RE.test(t));
    const have = await Promise.all(names.map((t) => fs.promises.access(path.join(POINT_DIR, t, 'manifest.json')).then(() => true, () => false)));
    return names.filter((_, i) => have[i]).sort();
  } catch { return []; }
}

/* Which UKV runs to cube: the newest that reaches T+120 (03Z and 15Z), and the newest that reaches
   T+54 once it is three hours newer than both that and every cube already built. A place's first two
   days then come from a run at most about six hours old (every long run, in practice). */
function pointTargets(cat, built) {
  const m = cat?.models?.find((x) => x.id === 'ukv');
  if (!m?.runs?.length) return [];
  const top = (r) => Math.max(...r.steps);
  const long = m.runs.find((r) => top(r) >= 120);
  const short = m.runs.find((r) => top(r) >= 54);
  const ref = Math.max(built.length ? tagMs(built[built.length - 1]) : 0, long ? tagMs(runTag(long.run)) : 0);
  const out = long ? [long] : [];
  if (short && short !== long && tagMs(runTag(short.run)) - ref >= 3 * 3600e3) out.unshift(short);
  return out;
}

let pointBusy = false;
async function refreshPoint(cat) {
  for (const r of pointTargets(cat, await builtCubesAsync())) {
    const tag = runTag(r.run);
    const man = await readJsonAsync(path.join(POINT_DIR, tag, 'manifest.json'));
    /* a built cube's run: its precipitation type too, for the radar's next hours on the home and
       Location pages (made from frames the cube already needed, so quick) */
    if (man) await ensureJobAsync('ukv', tag, 'ptype', true);
    if (man && man.steps.length >= r.steps.length) continue;            // built, and the run has not grown since
    const sts = await Promise.all(POINT_VARS.map((v) => readJsonAsync(path.join(frameDir('ukv', tag, v), 'status.json'))));
    const ready = sts.every((st) => st?.state === 'complete' && !grown('ukv', tag, st));
    if (!ready) { POINT_VARS.forEach((v, i) => ensureJob('ukv', tag, v, 'point', null, sts[i])); continue; }
    if (pointBusy) return;
    pointBusy = true;
    python(['mdata.point', 'cube', runIso(tag)], (code, err) => {
      pointBusy = false;
      if (code) console.warn(`[modeldata] point cube ${tag} failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
    });
    return;                                                              // one cube at a time
  }
}

export function mountModelData(app) {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(path.join(DATA, 'static', 'sat_day.jpg'))) python(['mdata.static'], (c, e) => c && console.warn(`[modeldata] static build failed: ${e.slice(-300)}`));
  if (!fs.existsSync(path.join(DATA, 'static', 'eu', 'sat_day.jpg'))) {
    python(['mdata.static'], (c, e) => c && console.warn(`[modeldata] wide static build failed: ${e.slice(-300)}`), { MDATA_GRID: 'eu' });
  }
  refreshCatalog();
  setInterval(refreshCatalog, 3 * 60 * 1000).unref();      // new runs and new steps within ~3 min of reaching AWS
  refreshLive('fast');
  setInterval(() => refreshLive('fast'), 60 * 1000).unref();       // radar, lightning, right now: within a minute of reaching AWS
  refreshLive('sat');
  setInterval(() => refreshLive('sat'), 3 * 60 * 1000).unref();    // satellite imagery

  app.get('/api/modeldata/catalog', (req, res) => {
    const f = path.join(DATA, 'catalog.json');
    if (!fs.existsSync(f)) return res.status(503).json({ error: 'catalogue is being built, try again in a minute' });
    res.set('Cache-Control', 'no-cache');
    res.sendFile(f);
  });

  app.get(['/api/modeldata/static/:file', '/api/modeldata/static/:grid/:file'], (req, res) => {
    const { grid, file } = req.params;
    if (!STATIC_FILES.has(file) || (grid && !GRIDS.has(grid))) return res.status(404).end();
    const f = path.join(DATA, 'static', ...(grid && grid !== 'uk' ? [grid] : []), file);
    if (!fs.existsSync(f)) return res.status(503).json({ error: 'map layers are being built' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(f);
  });

  const valid = (p) => (MODELS.has(p.model) || ENS_MODELS.has(p.model)) && RUN_RE.test(p.run) && VAR_RE.test(p.v);

  app.get('/api/modeldata/frames/:model/:run/:v/status', async (req, res) => {
    if (!valid(req.params)) return res.status(400).json({ error: 'bad request' });
    const { model, run, v } = req.params;
    const st = await readJsonAsync(path.join(frameDir(model, run, v), 'status.json'));
    const key = `${model}/${run}/${v}`;
    const first = /^\d{1,3}$/.test(String(req.query.first || '')) ? Number(req.query.first) : null;
    if (!st || (!running.has(key) && (st.state !== 'complete' || grown(model, run, st)))) ensureJob(model, run, v, false, first, st);
    else if (first != null && st.state !== 'complete' && ENS_MODELS.has(model)) {
      /* a running ensemble job builds around where the viewer is now */
      fs.promises.writeFile(path.join(frameDir(model, run, v), 'focus.json'), JSON.stringify({ step: first })).catch(() => {});
    }
    res.set('Cache-Control', 'no-cache');
    res.json(st ? { ...st, queued: queue.some((q) => q.key === key) } : { state: 'queued', done: [], missing: [] });
  });

  /* live layers: satellite images, radar frames, lightning */
  const LIVE_PRODUCTS = new Set(['sat_ir', 'sat_vis', 'sat_geo', 'sat_true', 'sat_fog', 'sat_wv', 'sat_airmass', 'sat_conv', 'sat_cth', 'radar',
    'now_t2', 'now_td2', 'now_rh2', 'now_wind10', 'now_wdir10', 'now_gust10', 'now_mslp', 'now_windchill', 'now_feels', 'now_tcc', 'now_wx',
    'now_ptype', 'radar_type']);

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
