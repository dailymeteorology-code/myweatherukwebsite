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
const STATIC_FILES = new Set(['basemap.png', 'basemap_light.png', 'sat_day.jpg', 'night_lights.png', 'lines.json', 'cities.json', 'grid.json']);
const MODELS = new Set(['ukv', 'mo_global', 'ifs', 'aifs', 'gfs']);
const RUN_RE = /^\d{8}T\d{4}Z$/;
const VAR_RE = /^[a-z0-9_]{2,20}$/;
const MAX_JOBS = 2;

const running = new Map();            // key -> child
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
const frameDir = (model, run, v) => path.join(DATA, 'frames', model, run, v);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function pump() {
  while (running.size < MAX_JOBS && queue.length) {
    /* what someone is looking at goes before background prefetch */
    const i = Math.max(0, queue.findIndex((q) => !q.prefetch));
    const job = queue.splice(i, 1)[0];
    if (running.has(job.key)) continue;
    const child = python(['mdata.job', ...job.args], (code, err) => {
      running.delete(job.key);
      if (code) console.warn(`[modeldata] job ${job.key} failed: ${err.split('\n').filter(Boolean).slice(-1)[0] || code}`);
      pump();
    });
    running.set(job.key, child);
  }
}

function ensureJob(model, run, v, prefetch = false) {
  const key = `${model}/${run}/${v}`;
  if (running.has(key) || queue.some((q) => q.key === key)) return;
  const st = readJson(path.join(frameDir(model, run, v), 'status.json'));
  if (st?.state === 'complete') return;
  queue.push({ key, args: [model, runIso(run), v], prefetch });
  pump();
}

/* the run the page opens on: the newest run that reaches most of the way (UKV runs every
   hour, but only some go beyond T+12) */
export function defaultRun(m) {
  const most = Math.max(0, ...m.runs.map((r) => r.steps.length));
  return m.runs.find((r) => r.steps.length >= 0.6 * most) || m.runs[0];
}

const PREFETCH = { ukv: ['precip_rate', 'precip_total', 't2', 'gust10', 'mslp'], mo_global: ['precip_rate', 't2'],
  ifs: ['precip_total', 't2'], aifs: ['precip_total'], gfs: ['refc', 't2'] };

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
      for (const v of PREFETCH[m.id] || []) ensureJob(m.id, tag, v, true);
    }
  });
}

export function mountModelData(app) {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(path.join(DATA, 'static', 'sat_day.jpg'))) python(['mdata.static'], (c, e) => c && console.warn(`[modeldata] static build failed: ${e.slice(-300)}`));
  refreshCatalog();
  setInterval(refreshCatalog, 10 * 60 * 1000).unref();

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

  const valid = (p) => MODELS.has(p.model) && RUN_RE.test(p.run) && VAR_RE.test(p.v);

  app.get('/api/modeldata/frames/:model/:run/:v/status', (req, res) => {
    if (!valid(req.params)) return res.status(400).json({ error: 'bad request' });
    const { model, run, v } = req.params;
    const st = readJson(path.join(frameDir(model, run, v), 'status.json'));
    const key = `${model}/${run}/${v}`;
    if (!st || (st.state !== 'complete' && !running.has(key))) ensureJob(model, run, v);
    res.set('Cache-Control', 'no-cache');
    res.json(st ? { ...st, queued: queue.some((q) => q.key === key) } : { state: 'queued', done: [], missing: [] });
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
