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
import { FROST_RUNS } from './tcmFrost.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..', 'tools', 'modeldata');
const DATA = process.env.MODELDATA_DIR || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/modeldata' : path.join(HERE, 'data', 'modeldata'));
export const MODELDATA_DIR = DATA;
const STATIC_FILES = new Set(['basemap.png', 'basemap_light.png', 'sat_day.jpg', 'night_lights.png', 'lines.json', 'cities.json', 'grid.json', 'roads.json', 'roads.bin']);
/* DWD ICON-EU (15 Nov 2026) twice: 'icon' on the UKV's 2 km grid, 'icon_europe' on the wide one;
   both read the same DWD files (mdata/models.py ICON keeps each on D: once fetched) */
const MODELS = new Set(['ukv', 'mo_global', 'ifs', 'aifs', 'gfs', 'gefs_mean', 'gefs_aer', 'frost', 'icon', 'icon_europe', 'mix',
  'aigfs', 'gdps', 'meps',               // 15 Nov 2026: NOAA AIGFS, ECCC GDPS, MET Norway MEPS (mdata/models_more.py)
  'arpege', 'arome',                     // Météo-France ARPEGE (wide grid) and AROME (the UK's 2 km grid): mdata/mf.py
  'ecmwf_ensm', 'aifs_ensm']);           // the ensembles' means in Forecast mode, from the Chances view's members (mdata/ensmean.py)
/* ICON's files are each the whole of Europe (~1 MB a field a step), so every layer of a run is
   ~5 GB: only the much-used layers are warmed for it; the rest are made when someone opens them */
const WARM_FIRST_ONLY = new Set(['icon', 'icon_europe', 'aigfs', 'gdps', 'meps', 'arpege', 'arome']);   // the new models too: the wide grid is bigger now
/* MWUK Mix (mdata/mix.py) is made from the UKV's and ICON's own frames when someone opens it: never warmed, so it
   never adds downloads of its own in the background */
const NO_WARM = new Set(['mix', 'aifs_ensm']);   // the AIFS ensemble mean: 50 members a field, made only when opened
/* models warmed with only these layers (15 Nov 2026, "faster ECMWF ENS"): the ECMWF ENS mean's
   temperature and pressure, whose 50 members each (~1.5 GB a field a run) are fetched in the
   background as each run lands, so its first open is not a five-minute wait (the Chances view
   shares them) */
const WARM_ONLY = { ecmwf_ensm: ['t2', 'mslp'] };
/* TCM FROST, MyWeatherUK's snow model: its runs come from its own mirror (server/tcmFrost.js),
   already made, on the 2 km grid; nothing is ever fetched for it here */
const MIRRORED = new Set(['frost']);
const ENS_MODELS = new Set(['ecmwf_ens', 'aifs_ens', 'gefs']);
/* each model's grid (mdata/common.py MODEL_GRID): its frames are kept apart, per grid */
export const gridOf = (model) => (model === 'ukv' || model === 'frost' || model === 'icon' || model === 'mix' || model === 'arome' ? 'uk' : 'eu');
const GRIDS = new Set(['uk', 'eu']);
const RUN_RE = /^\d{8}T\d{4}Z$/;
const VAR_RE = /^[a-z0-9_]{2,20}$/;
const MAX_USER_JOBS = 3;               // what someone is waiting for
const MAX_PREFETCH_JOBS = 1;           // background warming, never in the way
/* downloads in flight per job: someone waiting gets the line; the warming and the Location page's
   catching up leave room for them (15 Nov 2026: three Location jobs and the warming, 16 downloads
   each, shared the 6 MB/s wireless link with the layer someone had asked for, and its first frame
   took 40-55 s) */
const THREADS = (p) => (p === true ? '4' : p === 'point' ? '6' : '16');
/* while anyone waits for a layer, the background jobs pause before each download (mdata/job.py
   wait_turn), so the one being waited for has the whole connection; this file says so */
const BUSY_FILE = path.join(DATA, '.user-busy');
let busyNow = null;
function markBusy() {
  const busy = queue.some((q) => !q.prefetch) || [...running.values()].some((r) => !r.prefetch);
  if (busy === busyNow) return;
  busyNow = busy;
  (busy ? fs.promises.writeFile(BUSY_FILE, String(Date.now())) : fs.promises.rm(BUSY_FILE, { force: true })).catch(() => {});
}
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

/* \`urgent\`: someone is waiting for it, so it runs at the computer's normal priority; everything
   else (the warming, the catalogue, the Location page's catching up) below it, so on a busy machine
   the layer being waited for is not starved (15 Nov 2026: at 100 % CPU a waited-for job took 16-32 s
   to its first frame, 5 s on its own) */
function python(args, onExit, extraEnv = {}, urgent = false) {
  const py = resolveEnsPython();
  const env = { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8', ...extraEnv };
  const child = spawn(py.cmd, ['-m', ...args], { cwd: TOOL, env, windowsHide: true });
  if (!urgent) try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not fatal */ }
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  child.on('exit', (code) => onExit?.(code, err));
  child.on('error', (e) => onExit?.(1, String(e)));
  return child;
}

const runIso = (tag) => `${tag.slice(0, 4)}-${tag.slice(4, 6)}-${tag.slice(6, 8)}T${tag.slice(9, 11)}:${tag.slice(11, 13)}Z`;
const framesRoot = (model) => path.join(DATA, gridOf(model) === 'uk' ? 'frames' : `frames_${gridOf(model)}`);
const frameDir = (model, run, v) => (model === 'frost' ? path.join(FROST_RUNS, run, v)
  : ENS_MODELS.has(model) ? path.join(framesRoot(model), 'ens', model, run, v) : path.join(framesRoot(model), model, run, v));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
/* The frames sit on an external hard drive that can take most of a second a file when it is busy;
   where files are read in bulk (every catalogue refresh reads ~30 status files) they are read
   without holding up the site (a bulk synchronous read froze it for 2 s on 12 Nov 2026). */
const readJsonAsync = async (f) => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch { return null; } };

/* Frames kept in memory (16 Nov 2026). While the warming catches up after the PC has been off, that
   drive took 0.3-1 s a frame: a run's 77 frames came in 30-90 s the first time anyone opened them, and
   in about a second once in memory. Every frame sent is kept, and the much-used layers (PREFETCH) are
   read in the moment a job finishes them, while Windows still has them in its file cache, so the first
   person to open one gets it from memory too. Up to 900 MB, least recently used out first; a layer's
   frames are forgotten whenever a job starts making it again. */
const HOT_MAX = 900e6;
const hot = new Map();                                // frame file -> its bytes, least recently used first
let hotBytes = 0;
function hotGet(f) {
  const b = hot.get(f);
  if (b) { hot.delete(f); hot.set(f, b); }
  return b;
}
function hotPut(f, b) {
  const old = hot.get(f);
  if (old) { hot.delete(f); hotBytes -= old.length; }
  hot.set(f, b);
  hotBytes += b.length;
  while (hotBytes > HOT_MAX && hot.size > 1) { const [k, v] = hot.entries().next().value; hot.delete(k); hotBytes -= v.length; }
}
function hotForget(dir) {
  const within = dir + path.sep;
  for (const [k, v] of hot) if (k.startsWith(within)) { hot.delete(k); hotBytes -= v.length; }
}
async function hotLoad(dir) {
  const st = await readJsonAsync(path.join(dir, 'status.json'));
  for (const s of st?.done || []) {
    const f = path.join(dir, `${s}.bin`);
    if (hot.has(f)) continue;
    try { hotPut(f, await fs.promises.readFile(f)); } catch { /* not there after all */ }
  }
}

function pump() {
  const count = (p) => [...running.values()].filter((r) => r.prefetch === p).length;
  queue.sort(before);
  /* no new background job starts while someone is waiting for a layer */
  const waiting = queue.some((q) => !q.prefetch && !running.has(q.key)) || [...running.values()].some((r) => !r.prefetch);
  for (let i = 0; i < queue.length;) {
    const job = queue[i];
    if (running.has(job.key)) { queue.splice(i, 1); continue; }
    if (count(job.prefetch) >= LIMIT(job.prefetch) || (job.prefetch && waiting)) { i++; continue; }
    queue.splice(i, 1);
    const entry = { child: null, prefetch: job.prefetch, killed: false };
    const [jm, jr, jv] = job.key.split('/');
    hotForget(frameDir(jm, jr, jv));                                       // its frames may be made anew
    entry.child = python([ENS_MODELS.has(job.args[0]) ? 'mdata.ens' : 'mdata.job', ...job.args], (code, err) => {
      if (running.get(job.key) === entry) running.delete(job.key);          // not the job started again in its place
      if (code && !entry.killed) console.warn(`[modeldata] job ${job.key} failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
      if (!code && PREFETCH.includes(jv)) hotLoad(frameDir(jm, jr, jv)).catch(() => {});   // much-used: into memory now
      pump();
    }, { MDATA_GRID: gridOf(job.args[0]), MDATA_THREADS: THREADS(job.prefetch), MDATA_LANE: job.prefetch ? 'background' : 'user' }, !job.prefetch);
    running.set(job.key, entry);
  }
  markBusy();
}

/* `known`: the frames' status.json when the caller has already read it (null for none) */
function ensureJob(model, run, v, prefetch = false, first = null, known = undefined) {
  if (MIRRORED.has(model)) return;
  const key = `${model}/${run}/${v}`;
  const r = running.get(key);
  if (r) {
    /* someone now waits for what the background is making: it is started again as theirs (the
       frames it has made are kept; its downloads would otherwise give way to its own waiting) */
    if (!prefetch && r.prefetch && !r.killed) {
      r.killed = true;
      try { r.child.kill(); } catch { /* gone already */ }
      running.delete(key);
      queue.push({ key, args: [model, runIso(run), v, ...(first != null ? [String(first)] : [])], prefetch: false, rank: rankOf(model, run, v, false), seq: seq++ });
      pump();
    }
    return;
  }
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

/* When each run first showed up (15 Nov 2026, the next-run countdown): learned run by run as the
   catalogue lists them, so the page can say when the next run is due. Runs listed the first time the
   record is made are marked unknown (0), not "now", so they never skew how late runs usually land. */
const ARRIVALS_FILE = path.join(DATA, 'run_arrivals.json');
let arrivals = readJson(ARRIVALS_FILE) || {};
function noteArrivals(cat) {
  const now = Date.now();
  let changed = false;
  for (const m of [...(cat?.models || []), ...(cat?.ensembles || [])]) {
    const first = !arrivals[m.id];
    const seen = (arrivals[m.id] ||= {});
    for (const r of m.runs || []) if (seen[r.run] == null) { seen[r.run] = first ? 0 : now; changed = true; }
    const keys = Object.keys(seen).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) { delete seen[k]; changed = true; }
  }
  if (changed) fs.promises.writeFile(ARRIVALS_FILE, JSON.stringify(arrivals)).catch(() => {});
}
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
/* each model's next run: when it starts (its usual spacing after the last) and, once two arrivals
   have been seen, when it usually lands */
function nextRuns() {
  const out = {};
  for (const [id, seen] of Object.entries(arrivals)) {
    const runs = Object.keys(seen).sort();
    const times = runs.map((r) => Date.parse(r));
    const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0);
    const every = median(gaps);
    if (!every) continue;
    const late = runs.filter((r) => seen[r] > 0).map((r) => seen[r] - Date.parse(r)).filter((x) => x > 0);
    const latency = late.length >= 2 ? median(late) : null;
    const next = times[times.length - 1] + every;
    out[id] = { next: new Date(next).toISOString(), every_h: every / 3600e3, due: latency != null ? new Date(next + latency).toISOString() : null,
      latency_min: latency != null ? Math.round(latency / 60e3) : null, seen: late.length };
  }
  return out;
}

/* Météo-France's files have no index: each new ARPEGE and AROME run's files are walked in the
   background as soon as they are listed (mdata/mf.py prewalk), one run at a time, so the first
   layer opened (ARPEGE's upper air took about 90 s) finds them ready (15 Nov 2026) */
const prewalked = new Set();
let prewalkBusy = false;
function prewalkMF(cat) {
  if (prewalkBusy) return;
  for (const id of ['arpege', 'arome']) {
    const m = cat?.models?.find((x) => x.id === id);
    const r = m?.runs?.[0];
    const k = r && `${id}/${r.run}/${r.steps?.length}`;            // walked again as a run's later files arrive
    if (!r || prewalked.has(k)) continue;
    prewalkBusy = true;
    prewalked.add(k);
    python(['mdata.mf', 'prewalk', id, r.run], (code, err) => {
      prewalkBusy = false;
      if (code) { prewalked.delete(k); console.warn(`[modeldata] ${id} prewalk failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`); }
    }, { MDATA_GRID: id === 'arome' ? 'uk' : 'eu', MDATA_LANE: 'background' });
    return;
  }
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
      noteArrivals(cat);
      const warm = [];
      for (const m of cat?.models || []) {
        if (MIRRORED.has(m.id) || NO_WARM.has(m.id)) continue;
        const r = m.runs?.length ? defaultRun(m) : null;
        if (!r) continue;
        const tag = r.run.replace(/[-:]/g, '').replace(/\+0000$/, 'Z').slice(0, 13) + 'Z';
        const first = (WARM_ONLY[m.id] || PREFETCH).filter((x) => m.variables?.includes(x));
        const rest = r.complete && !WARM_FIRST_ONLY.has(m.id) && !WARM_ONLY[m.id] ? (m.variables || []).filter((x) => !first.includes(x)) : [];
        for (const v of [...first, ...rest]) warm.push([m.id, tag, v]);
      }
      const wanted = new Set(warm.map(([mid, tag, v]) => `${mid}/${tag}/${v}`));
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].prefetch === true && !wanted.has(queue[i].key)) queue.splice(i, 1);
      for (const [mid, tag, v] of warm) await ensureJobAsync(mid, tag, v, true);
      prewalkMF(cat);
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

/* ── version 2 (15 Nov 2026, mdata/point.py cube2) ─────────────────────────────────────────────
   The Location page's hours from the UKV, its days from the MWUK Mix (the UKV and DWD ICON-EU), and the
   days beyond the Mix from the Met Office Global: each a cube a place is read from in one go. The
   frames each needs are queued in the 'point' lane, then its cube is built, one at a time. The Mix's
   step amounts are made by point.py from the UKV's and ICON's own (ICON's come with the Mix's rates),
   and the Global's few fields and steps (from T+90) are read by point.py itself. */
export const POINT2_DIR = path.join(DATA, 'point2');
const POINT2_VARS = {
  ukv: [...POINT_VARS, 'snow_cond'],
  mix: ['t2', 'td2', 'rh2', 'tskin', 'wind10', 'gust10', 'wdir10', 'mslp', 'precip_rate', 'snow_rate', 'tcc', 'lcc',
    'mcc', 'hcc', 'vis', 'sw_down', 'snow_cond'],
  mo_global: [],
};
const MOG_FROM = 90;                                                     // mdata/point.py SPECS.mo_global.from_lead
async function built2(model) {
  try {
    const dir = path.join(POINT2_DIR, model);
    const names = (await fs.promises.readdir(dir)).filter((t) => RUN_RE.test(t)).sort();
    const mans = await Promise.all(names.map((t) => readJsonAsync(path.join(dir, t, 'manifest.json'))));
    return names.map((t, i) => ({ tag: t, man: mans[i] })).filter((x) => x.man);
  } catch { return []; }
}
/* The runs to cube: the newest long one (the UKV's 03Z and 15Z to T+120, the Mix's pairs of those to
   T+114 or more, the Global's 00Z and 12Z to T+168) and, for the UKV and the Mix, the newest shorter
   one once it is three hours newer than that and than every cube built (topped up as it grows). A
   place's first two days then come from a run at most about six hours old. */
function targets2(cat, model, built) {
  const m = cat?.models?.find((x) => x.id === model);
  if (!m?.runs?.length) return [];
  const top = (r) => Math.max(...r.steps);
  const need = model === 'mix' ? 114 : model === 'mo_global' ? 168 : 120;
  const long = m.runs.find((r) => top(r) >= need && (model !== 'mo_global' || r.complete));
  if (model === 'mo_global') return long ? [long] : [];
  const short = m.runs.find((r) => top(r) >= 54 && !r.kept);
  const ref = Math.max(built.length ? tagMs(built[built.length - 1].tag) : 0, long ? tagMs(runTag(long.run)) : 0);
  const out = long ? [long] : [];
  if (short && short !== long && (tagMs(runTag(short.run)) - ref >= 3 * 3600e3 || built.some((x) => x.tag === runTag(short.run)))) out.unshift(short);
  return out;
}
/* the version 1 cubes, once the page reads version 2: gone (each 0.5-1.2 GB) */
async function pruneLegacy() {
  if ((await built2('ukv')).length < 2) return;
  for (const t of await builtCubesAsync()) await fs.promises.rm(path.join(POINT_DIR, t), { recursive: true, force: true }).catch(() => {});
}

let pointBusy = false;
async function refreshPoint(cat) {
  for (const model of ['ukv', 'mix', 'mo_global']) {
    const built = await built2(model);
    for (const r of targets2(cat, model, built)) {
      const tag = runTag(r.run);
      const have = built.find((x) => x.tag === tag)?.man;
      /* a built UKV cube's run: its precipitation type too, for the radar's next hours on the home and
         Location pages (made from frames the cube already needed, so quick) */
      if (model === 'ukv' && have) await ensureJobAsync('ukv', tag, 'ptype', true);
      const want = model === 'mo_global' ? r.steps.filter((h) => h >= MOG_FROM).length : r.steps.length;
      if (have && have.steps.length >= want) continue;                   // built, and the run has not grown since
      /* the Mix's step amounts are made from its UKV run's own (the same run, the same tag): those too */
      const need = [...POINT2_VARS[model].map((v) => [model, v]), ...(model === 'mix' ? [['ukv', 'precip_step'], ['ukv', 'snow_step']] : [])];
      const sts = await Promise.all(need.map(([m, v]) => readJsonAsync(path.join(frameDir(m, tag, v), 'status.json'))));
      const ready = sts.every((st, i) => st?.state === 'complete' && !grown(need[i][0], tag, st));
      if (!ready) { need.forEach(([m, v], i) => ensureJob(m, tag, v, 'point', null, sts[i])); continue; }
      if (pointBusy) return;
      pointBusy = true;
      python(['mdata.point', 'cube2', model, runIso(tag)], (code, err) => {
        pointBusy = false;
        if (code) console.warn(`[modeldata] point cube ${model} ${tag} failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
        else if (model === 'ukv') pruneLegacy().catch(() => {});
      }, { MDATA_GRID: gridOf(model), MDATA_THREADS: '6', MDATA_LANE: 'background' });
      return;                                                              // one cube at a time
    }
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

  /* Long range (15 Nov 2026): the stratospheric polar vortex and the MJO (mdata/longrange.py), made
     again every 6 hours; what does not change (past days, a GEFS run already read) is kept, not fetched */
  let longBusy = false;
  const refreshLong = () => {
    if (longBusy) return;
    longBusy = true;
    python(['mdata.longrange'], (code, err) => {
      longBusy = false;
      if (code) console.warn(`[modeldata] long range failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
    }, { MDATA_GRID: 'eu', MDATA_LANE: 'background' });
  };
  setTimeout(refreshLong, 90 * 1000).unref();
  setInterval(refreshLong, 6 * 3600 * 1000).unref();
  /* each model's next run and when it usually lands (the countdown beside the run) */
  app.get('/api/modeldata/nextruns', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(nextRuns());
  });

  app.get('/api/modeldata/longrange', (req, res) => {
    const f = path.join(DATA, 'longrange.json');
    if (!fs.existsSync(f)) { refreshLong(); return res.status(503).json({ error: 'the long-range charts are being made, try again in a few minutes' }); }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(f);
  });

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
  /* A frame file as it is (gzip), opened without waiting on the disk (16 Nov 2026). Each frame used to
     be checked with existsSync first: on the busy D: drive that held the whole server up, so a run's
     frames came out ~0.6 s apart and every other request waited behind them. The headers that let a
     browser keep it go out only once the file has opened, so a missing frame is never kept as missing. */
  const IMMUTABLE = 'public, max-age=86400, immutable';
  const sendGz = (res, f) => {
    const s = fs.createReadStream(f);
    s.once('open', () => { res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': IMMUTABLE }); s.pipe(res); });
    s.once('error', (e) => { if (!res.headersSent) res.status(e.code === 'ENOENT' ? 404 : 500).end(); else res.destroy(e); });
  };
  app.get('/api/modeldata/live/:product/:time', (req, res) => {
    const { product, time } = req.params;
    const m = /^(\d{8}T\d{4})\.(jpg|png|bin)$/.exec(time);
    if (!LIVE_PRODUCTS.has(product) || !m) return res.status(400).end();
    const f = path.join(DATA, 'live', product, time);
    if (m[2] === 'bin') return sendGz(res, f);
    res.sendFile(f, { headers: { 'Cache-Control': IMMUTABLE } }, (e) => { if (e && !res.headersSent) res.status(404).end(); });
  });

  app.get('/api/modeldata/frames/:model/:run/:v/:step', (req, res) => {
    if (!valid(req.params) || !/^\d{1,3}$/.test(req.params.step)) return res.status(400).end();
    const { model, run, v, step } = req.params;
    const f = path.join(frameDir(model, run, v), `${step}.bin`);
    const send = (b) => { res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': IMMUTABLE }); res.end(b); };
    const b = hotGet(f);                                                   // kept in memory (hotPut)
    if (b) return send(b);
    fs.promises.readFile(f).then((buf) => { hotPut(f, buf); send(buf); }, (e) => res.status(e.code === 'ENOENT' ? 404 : 500).end());
  });
}
