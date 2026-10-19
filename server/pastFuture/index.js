/**
 * Data for the Graphic Studio's "Past & Future" graphics. No Open-Meteo anywhere:
 *
 *   GET /api/pastfuture/climate?var=Tmean     Met Office HadUK-Grid regional monthly series
 *                                             (10 climate districts, 4 nations, UK) + the 37
 *                                             historic stations, full history, so the page can
 *                                             compute any month's 1991-2020 anomaly and rank.
 *   GET /api/pastfuture/likelihood            Met Office DataHub site-specific DAILY forecast
 *                                             for 13 UK places: the Met Office's own
 *                                             probabilities of thunder, heavy rain, snow, hail…
 *   GET /api/pastfuture/ensemble?date=…[&end=…]  ECMWF ENS (50 members) clustered into three
 *                                             synoptic scenarios (ens_scenarios.py), for one
 *                                             day or a run of up to 7, with each scenario's
 *                                             main-low track.
 *
 * Everything is cached in memory; the climate series change once a month, the DataHub
 * calls are rationed (one per place per 3 hours) because they share the free allowance
 * with the Location Weather page.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (MyWeatherUK-selfhost)';
const MO = 'https://www.metoffice.gov.uk/pub/data/weather/uk/climate';

export const CLIMATE_VARS = ['Tmean', 'Tmax', 'Tmin', 'Rainfall', 'Sunshine', 'Raindays1mm', 'AirFrost'];
export const DISTRICTS = ['Scotland_N', 'Scotland_E', 'Scotland_W', 'England_E_and_NE', 'England_NW_and_N_Wales',
  'Midlands', 'East_Anglia', 'England_SW_and_S_Wales', 'England_SE_and_Central_S', 'Northern_Ireland'];
export const NATIONS = ['UK', 'England', 'Wales', 'Scotland', 'Northern_Ireland'];
export const STATIONS = ['aberporth', 'armagh', 'ballypatrick', 'bradford', 'braemar', 'camborne', 'cambridge', 'cardiff',
  'chivenor', 'cwmystwyth', 'dunstaffnage', 'durham', 'eastbourne', 'eskdalemuir', 'heathrow', 'hurn', 'lerwick',
  'leuchars', 'lowestoft', 'manston', 'nairn', 'newtonrigg', 'oxford', 'paisley', 'ringway', 'rossonwye', 'shawbury',
  'sheffield', 'southampton', 'stornoway', 'suttonbonington', 'tiree', 'valley', 'waddington', 'whitby', 'wickairport',
  'yeovilton'];

/* ── parsers (exported for tests) ───────────────────────────────────────── */

/**
 * A regional series file: fixed-width, `year` in 4 columns then 7 columns per month.
 * Columns, not whitespace: a part-filled year still prints its seasonal means after a
 * gap, and splitting on spaces would read those as October-December.
 */
export function parseSeries(text) {
  const lines = text.split(/\r?\n/);
  const h = lines.findIndex((l) => /^year\s+jan\s+feb/.test(l));
  if (h < 0) throw new Error('not a Met Office series file');
  const rows = {};
  for (const l of lines.slice(h + 1)) {
    if (!/^\d{4}/.test(l)) continue;
    const vals = [];
    for (let m = 0; m < 12; m++) {
      const cell = l.slice(4 + 7 * m, 11 + 7 * m).trim();
      const v = parseFloat(cell);
      vals.push(cell === '' || cell === '---' || !Number.isFinite(v) ? null : v);
    }
    rows[+l.slice(0, 4)] = vals;
  }
  const updated = (text.match(/Last updated\s+([^\r\n]+)/) || [])[1] || null;
  return { rows, updated };
}

/** A historic station file: whitespace columns yyyy mm tmax tmin af rain sun, flags * # --- Provisional. */
export function parseStation(text) {
  const loc = [...text.matchAll(/Lat\s*(-?\d+(?:\.\d+)?)\s*,?\s*Lon\s*(-?\d+(?:\.\d+)?)/gi)].pop();
  const name = text.split(/\r?\n/)[0].trim();
  const rows = [];
  for (const l of text.split(/\r?\n/)) {
    const t = l.trim().split(/\s+/);
    if (t.length < 7 || !/^\d{4}$/.test(t[0]) || !/^\d{1,2}$/.test(t[1])) continue;
    const num = (s) => { const v = parseFloat(String(s).replace(/[*#$]/g, '')); return s === '---' || !Number.isFinite(v) ? null : v; };
    rows.push({ y: +t[0], m: +t[1], tmax: num(t[2]), tmin: num(t[3]), af: num(t[4]), rain: num(t[5]), sun: num(t[6]),
      provisional: /Provisional/i.test(l) });
  }
  return { name, lat: loc ? +loc[1] : null, lon: loc ? +loc[2] : null, rows };
}

/* ── fetch + cache ──────────────────────────────────────────────────────── */

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = fn().then((value) => { cache.set(key, { at: Date.now(), value }); return value; })
    .catch((e) => { if (hit?.value) { cache.set(key, hit); return hit.value; } cache.delete(key); throw e; });
  cache.set(key, { ...(hit || {}), pending });
  return pending;
}

async function getText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal });
    const text = await r.text();
    if (!r.ok || /^\s*</.test(text)) throw new Error(`${url}: HTTP ${r.status}`);
    return text;
  } finally { clearTimeout(t); }
}

async function climate(variable) {
  return cached(`climate:${variable}`, 6 * 3600e3, async () => {
    const regions = {};
    let updated = null;
    await Promise.all([...DISTRICTS, ...NATIONS.filter((n) => !DISTRICTS.includes(n))].map(async (r) => {
      const s = parseSeries(await getText(`${MO}/datasets/${variable}/date/${r}.txt`));
      regions[r] = s.rows; updated = updated || s.updated;
    }));
    return { variable, updated, regions };
  });
}

async function stations() {
  return cached('stations', 12 * 3600e3, async () => {
    const out = [];
    // a few at a time: 37 files from one host
    for (let i = 0; i < STATIONS.length; i += 6) {
      const part = await Promise.all(STATIONS.slice(i, i + 6).map(async (id) => {
        try { return { id, ...parseStation(await getText(`${MO}/stationdata/${id}data.txt`)) }; } catch { return null; }
      }));
      out.push(...part.filter((s) => s && s.lat != null));
    }
    return out;
  });
}

/* ── likelihood: DataHub daily probabilities ────────────────────────────── */

export const LIKELIHOOD_PLACES = [
  ['London', 51.507, -0.128], ['Southampton', 50.904, -1.404], ['Plymouth', 50.375, -4.143], ['Cardiff', 51.481, -3.179],
  ['Birmingham', 52.486, -1.89], ['Norwich', 52.63, 1.297], ['Manchester', 53.48, -2.242], ['Leeds', 53.801, -1.549],
  ['Newcastle', 54.978, -1.618], ['Belfast', 54.597, -5.93], ['Glasgow', 55.864, -4.252], ['Edinburgh', 55.953, -3.188],
  ['Aberdeen', 57.149, -2.094], ['Inverness', 57.478, -4.224],
];
const DATAHUB_POINT = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point';
const datahubKey = () => ['MET_OFFICE_SITESPECIFIC_API_KEY', 'MET_OFFICE_DATAHUB_API_KEY'].map((v) => process.env[v]).find(Boolean);

async function placeDaily(name, lat, lon) {
  return cached(`daily:${name}`, 3 * 3600e3, async () => {
    const key = datahubKey();
    if (!key) throw new Error('No Met Office DataHub key in .env');
    const r = await fetch(`${DATAHUB_POINT}/daily?latitude=${lat}&longitude=${lon}&excludeParameterMetadata=true`, {
      headers: { apikey: key, accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`DataHub ${r.status}${r.status === 403 ? ' (daily allowance used up?)' : ''}`);
    const j = await r.json();
    const ts = j.features?.[0]?.properties?.timeSeries || [];
    const days = ts.map((d) => ({
      date: d.time.slice(0, 10),
      tmax: d.dayMaxScreenTemperature, tmaxHi: d.dayUpperBoundMaxTemp, tmaxLo: d.dayLowerBoundMaxTemp,
      tmin: d.nightMinScreenTemperature, tminHi: d.nightUpperBoundMinTemp, tminLo: d.nightLowerBoundMinTemp,
      gust: Math.max(d.midday10MWindGust ?? 0, d.midnight10MWindGust ?? 0),
      p: {
        precip: Math.max(d.dayProbabilityOfPrecipitation ?? 0, d.nightProbabilityOfPrecipitation ?? 0),
        rain: Math.max(d.dayProbabilityOfRain ?? 0, d.nightProbabilityOfRain ?? 0),
        heavyRain: Math.max(d.dayProbabilityOfHeavyRain ?? 0, d.nightProbabilityOfHeavyRain ?? 0),
        snow: Math.max(d.dayProbabilityOfSnow ?? 0, d.nightProbabilityOfSnow ?? 0),
        heavySnow: Math.max(d.dayProbabilityOfHeavySnow ?? 0, d.nightProbabilityOfHeavySnow ?? 0),
        hail: Math.max(d.dayProbabilityOfHail ?? 0, d.nightProbabilityOfHail ?? 0),
        thunder: Math.max(d.dayProbabilityOfSferics ?? 0, d.nightProbabilityOfSferics ?? 0),
      },
    }));
    return { name, lat, lon, modelRunDate: j.features?.[0]?.properties?.modelRunDate || null, days };
  });
}

/* ── ensemble scenarios: Python + ecCodes ───────────────────────────────── */

// A multi-day request caches ~25 MB per forecast step, so the cache lives on the external
// drive when there is one (C: is nearly full); ENS_CACHE overrides. The script prunes old runs.
const ENS_CACHE = process.env.ENS_CACHE
  || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/ens-cache' : path.join(HERE, '..', 'data', 'ens-cache'));

/**
 * Which Python to run, as [command, extra env].
 *
 * The ukv-platform venv was made with a uv-managed Python installed from inside the Claude
 * desktop app, whose MSIX container redirects %APPDATA% writes to its own LocalCache folder.
 * The venv's pyvenv.cfg `home` therefore names C:\Users\…\AppData\Roaming\uv\…, a path that
 * only exists inside that container. The live server is started by Task Scheduler, outside
 * it, so the venv launcher died with "No Python at …" and the scenario tool never loaded.
 * pyvenv.cfg also records the interpreter's REAL path (`executable`), so when `home` is
 * missing we run that interpreter with the venv's site-packages on PYTHONPATH instead.
 */
export function resolveEnsPython({ venv = path.resolve(HERE, '..', '..', '..', 'ukv-platform', '.venv'), exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  if (process.env.ENS_PYTHON) return { cmd: process.env.ENS_PYTHON, env: {} };
  const venvPy = path.join(venv, 'Scripts', 'python.exe');
  const cfgFile = path.join(venv, 'pyvenv.cfg');
  if (!exists(venvPy) || !exists(cfgFile)) return { cmd: 'python', env: {} };
  const cfg = Object.fromEntries(read(cfgFile).split(/\r?\n/).map((l) => l.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  if (!cfg.home || exists(path.join(cfg.home, 'python.exe'))) return { cmd: venvPy, env: {} };
  if (cfg.executable && exists(cfg.executable)) return { cmd: cfg.executable, env: { PYTHONPATH: path.join(venv, 'Lib', 'site-packages') } };
  return { cmd: venvPy, env: {} };   // nothing better: let the launcher report what is missing
}
let ensPy = null;
function runEnsemble(validIso, lastDay) {
  ensPy ||= resolveEnsPython();
  return new Promise((resolve, reject) => {
    const args = [path.join(HERE, 'ens_scenarios.py'), validIso, ENS_CACHE, ...(lastDay ? [lastDay] : [])];
    const p = spawn(ensPy.cmd, args, { windowsHide: true, env: { ...process.env, ...ensPy.env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => p.kill(), 8 * 60e3);
    p.on('error', (e) => { clearTimeout(t); reject(new Error(`could not start Python (${e.message}); set ENS_PYTHON`)); });
    p.on('close', () => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out.trim().split(/\r?\n/).pop());
        if (j.error) reject(new Error(j.error)); else resolve(j);
      } catch { reject(new Error((err || 'ensemble script failed').trim().split(/\r?\n/).pop())); }
    });
  });
}

/* ── routes ─────────────────────────────────────────────────────────────── */

export function mountPastFuture(app) {
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) { res.status(502).json({ error: e.message }); }
  };
  app.get('/api/pastfuture/climate', wrap(async (req) => {
    const v = CLIMATE_VARS.includes(req.query.var) ? req.query.var : 'Tmean';
    const [c, st] = await Promise.all([climate(v), stations().catch(() => [])]);
    return { ...c, stations: st, source: 'Met Office HadUK-Grid regional series and historic station data' };
  }));
  app.get('/api/pastfuture/likelihood', wrap(async () => {
    const places = [];
    const errors = [];
    for (const [n, la, lo] of LIKELIHOOD_PLACES) {
      try { places.push(await placeDaily(n, la, lo)); } catch (e) { errors.push(`${n}: ${e.message}`); }
    }
    if (!places.length) throw new Error(errors[0] || 'no places');
    return { places, errors, source: 'Met Office DataHub site-specific forecast' };
  }));
  app.get('/api/pastfuture/ensemble', wrap(async (req) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const hour = [0, 6, 12, 18].includes(+req.query.hour) ? +req.query.hour : 12;
    const iso = `${date}T${String(hour).padStart(2, '0')}:00:00Z`;
    // Optional last day of a range (inclusive, up to 7 days); absent or equal = one day, as before.
    let end = /^\d{4}-\d{2}-\d{2}$/.test(req.query.end || '') ? req.query.end : null;
    if (end && end <= date) end = null;
    if (end && (Date.parse(end) - Date.parse(date)) / 864e5 > 6) throw new Error('Pick at most 7 days');
    return cached(`ens:${iso}:${end || ''}`, 6 * 3600e3, () => runEnsemble(iso, end));
  }));
}
