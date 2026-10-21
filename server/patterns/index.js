/**
 * Weather Patterns: the daily run of engine.py and the API the page reads.
 *
 *   GET  /api/patterns            the issue to show, the run's status and when the next one is due.
 *                                 While a run is going and has finished at least one week, the new
 *                                 issue is shown as it builds (its unfinished week flagged); a run
 *                                 that fails leaves the last good issue in place.
 *        ?issue=<id>              an earlier issue (the last 30 are kept)
 *   GET  /api/patterns/land       the land-sea mask the maps are drawn from
 *   POST /api/patterns/run        admins: start a run now
 *
 * The run starts every day at 12:00 UK time, and on start-up when the last one was missed. The
 * engine writes its files itself (see engine.py); this side only starts it, follows its progress
 * lines and serves the files, gzipped (an issue is a few hundred kB of pressure charts).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireAdmin } from '../auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PATTERNS_DIR || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/patterns' : path.join(HERE, '..', 'data', 'patterns'));
const CACHE = process.env.PATTERNS_CACHE || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/patterns-cache' : path.join(HERE, '..', 'data', 'patterns-cache'));
const RUN_HOUR = 12;                        // UK time
const TIMEOUT = 75 * 60e3;
const ID_RE = /^\d{12}$/;

/* ── Python ─────────────────────────────────────────────────────────────── */

/** The interpreter with numpy and ecCodes: PATTERNS_PYTHON, else the ukv-platform virtualenv, else
 *  `python`. A virtualenv whose base install has moved still works through its base executable. */
function python() {
  if (process.env.PATTERNS_PYTHON) return { cmd: process.env.PATTERNS_PYTHON, env: {} };
  const venv = path.resolve(HERE, '..', '..', '..', 'ukv-platform', '.venv');
  const exe = path.join(venv, 'Scripts', 'python.exe');
  const cfgFile = path.join(venv, 'pyvenv.cfg');
  if (!fs.existsSync(exe) || !fs.existsSync(cfgFile)) return { cmd: 'python', env: {} };
  const cfg = {};
  for (const line of fs.readFileSync(cfgFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
    if (m) cfg[m[1]] = m[2];
  }
  if (!cfg.home || fs.existsSync(path.join(cfg.home, 'python.exe'))) return { cmd: exe, env: {} };
  if (cfg.executable && fs.existsSync(cfg.executable)) return { cmd: cfg.executable, env: { PYTHONPATH: path.join(venv, 'Lib', 'site-packages') } };
  return { cmd: exe, env: {} };
}

/* ── UK time ────────────────────────────────────────────────────────────── */

function ukParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
/** The instant of hh:00 UK time on a UK calendar day (the offset is found by trying both). */
function ukInstant(y, m, d, hh) {
  for (const off of [0, 1]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh - off));
    const p = ukParts(t);
    if (p.h === hh && p.d === d) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, hh));
}
/** The most recent 12:00 UK slot at or before `now`, and the next one after it. */
function slots(now = new Date()) {
  const p = ukParts(now);
  let last = ukInstant(p.y, p.m, p.d, RUN_HOUR);
  if (last > now) {
    const y = new Date(now.getTime() - 86400e3), q = ukParts(y);
    last = ukInstant(q.y, q.m, q.d, RUN_HOUR);
  }
  const n = ukParts(new Date(last.getTime() + 24 * 3600e3));     // midday or so the next day, whatever the clocks did
  return { last, next: ukInstant(n.y, n.m, n.d, RUN_HOUR) };
}

/* ── files ──────────────────────────────────────────────────────────────── */

const cache = new Map();                    // file -> { mtime, json, gz }
function readIssue(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(text);
    const entry = { mtime: st.mtimeMs, json, text };
    cache.set(file, entry);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return entry;
  } catch {
    return null;                            // half-written by another process: try again next time
  }
}
function issueList() {
  try {
    return fs.readdirSync(path.join(DATA, 'issues')).filter((f) => /^\d{12}\.json$/.test(f)).sort().reverse()
      .map((f) => f.slice(0, 12));
  } catch {
    return [];
  }
}

/* ── the run ────────────────────────────────────────────────────────────── */

const status = { running: false, startedAt: null, stage: null, week: null, pct: 0, lastError: null, lastFinished: null, lastSeconds: null };
let timer = null;

function startRun(reason) {
  if (status.running) return false;
  const py = python();
  Object.assign(status, { running: true, startedAt: new Date().toISOString(), stage: 'starting', week: null, pct: 0, lastError: null });
  console.log(`  [patterns] run started (${reason})`);
  fs.mkdirSync(DATA, { recursive: true });
  const p = spawn(py.cmd, [path.join(HERE, 'engine.py'), DATA, CACHE], { windowsHide: true, env: { ...process.env, ...py.env } });
  let buf = '', err = '';
  const t0 = Date.now();
  const kill = setTimeout(() => { status.lastError = 'the run took too long and was stopped'; p.kill(); }, TIMEOUT);
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('@progress ')) {
        try { const j = JSON.parse(line.slice(10)); Object.assign(status, { stage: j.stage, week: j.week ?? status.week, pct: j.pct ?? status.pct }); } catch { /* a torn line */ }
      } else if (line.startsWith('@error ')) {
        try { status.lastError = JSON.parse(line.slice(7)).error; } catch { status.lastError = line.slice(7); }
      }
    }
  });
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  const done = (code) => {
    clearTimeout(kill);
    status.running = false;
    status.lastSeconds = Math.round((Date.now() - t0) / 1000);
    if (code === 0) {
      status.lastFinished = new Date().toISOString();
      status.stage = 'done';
      status.pct = 100;
      console.log(`  [patterns] run finished in ${status.lastSeconds} s`);
    } else {
      status.lastError ||= (err.trim().split(/\r?\n/).pop() || `exit ${code}`);
      console.warn(`  [patterns] run failed: ${status.lastError}`);
      // the half-built issue is not shown once its run has died
      try { fs.renameSync(path.join(DATA, 'building.json'), path.join(DATA, 'failed.json')); } catch { /* none */ }
    }
  };
  p.on('error', (e) => { status.lastError = `could not start Python (${e.message}); set PATTERNS_PYTHON`; done(1); });
  p.on('close', (code) => done(code));
  return true;
}

function schedule() {
  clearTimeout(timer);
  const { next } = slots();
  timer = setTimeout(() => { startRun('12:00 run'); schedule(); }, Math.max(1000, next - Date.now()));
  timer.unref?.();
}

/** On start-up: run soon if the last 12:00 slot has no issue (the server was off at noon). */
function catchUp() {
  const latest = readIssue(path.join(DATA, 'latest.json'))?.json;
  const { last } = slots();
  if (!latest || new Date(latest.issued) < last) {
    const t = setTimeout(() => startRun(latest ? 'missed 12:00 run' : 'first run'), 90e3);
    t.unref?.();
  }
}

/* ── API ────────────────────────────────────────────────────────────────── */

function send(req, res, body) {
  res.set('Cache-Control', 'no-cache');
  res.type('application/json');
  if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    return res.send(zlib.gzipSync(body, { level: 6 }));
  }
  return res.send(body);
}

export function mountPatterns(app) {
  app.get('/api/patterns', (req, res) => {
    const { next } = slots();
    const issues = issueList();
    let entry = null;
    if (req.query.issue) {
      if (!ID_RE.test(String(req.query.issue))) return res.status(400).json({ error: 'bad issue id' });
      entry = readIssue(path.join(DATA, 'issues', `${req.query.issue}.json`));
      if (!entry) return res.status(404).json({ error: 'no such issue' });
    } else {
      const latest = readIssue(path.join(DATA, 'latest.json'));
      const building = status.running ? readIssue(path.join(DATA, 'building.json')) : null;
      entry = building?.json.weeks?.length && (!latest || building.json.issued > latest.json.issued) ? building : latest;
    }
    const meta = JSON.stringify({
      status: { ...status }, next: next.toISOString(), runHour: RUN_HOUR, issues,
    });
    const body = entry ? `{"meta":${meta},"issue":${entry.text}}` : `{"meta":${meta},"issue":null}`;
    return send(req, res, body);
  });

  app.get('/api/patterns/land', (req, res) => {
    const land = readIssue(path.join(DATA, 'land.json'));
    if (!land) return res.status(404).json({ error: 'the map is not ready yet' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('application/json');
    if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
      land.gz ||= zlib.gzipSync(land.text);
      res.set('Content-Encoding', 'gzip');
      res.set('Vary', 'Accept-Encoding');
      return res.send(land.gz);
    }
    return res.send(land.text);
  });

  app.post('/api/patterns/run', requireAdmin, (req, res) => {
    const started = startRun(`admin ${req.user?.email || ''}`.trim());
    res.json({ started, status });
  });

  schedule();
  catchUp();
}
