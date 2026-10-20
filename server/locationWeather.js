/* Location Weather API: one place's weather from the Met Office UKV 2 km model on AWS.

   The forecast is read from the point cubes server/modelData.js keeps (mdata/point.py): each
   cube holds a whole UKV run restacked so a place's forecast is one small read per variable.
   The freshest cube gives the first two days and the newest T+120 cube the rest. Current
   conditions are the 15-minute UKV + METAR analysis (mdata/now.py), "today so far" is the
   observed day it keeps, and the radar is the Met Office composite from the AWS bucket.

     GET /api/location/forecast?lat=&lon=[&name=]  or  ?q=     everything the page shows
     GET /api/location/search?q=                                place suggestions as you type (server/placeSearch.js)
     GET /api/location/now?p=lat,lon|lat,lon…                   now at up to 12 places (the landing cards)
     GET /api/location/radar?lat=&lon=                          past radar times, next hours' UKV rain
     GET /api/location/radar/frame?src=radar&t=YYYYmmddTHHMM&lat=&lon=
     GET /api/location/radar/frame?src=ukv&run=YYYYmmddTHHMMZ&h=N&lat=&lon=
                                                                a 400 km crop round the place, gzip
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODELDATA_DIR, POINT_DIR, builtCubes } from './modelData.js';
import { geocode, reverseName } from './functions/getMetOfficeLocationWeather.js';
import { searchPlaces } from './placeSearch.js';

const LIVE = path.join(MODELDATA_DIR, 'live');
const OBS = path.join(MODELDATA_DIR, 'observed');
const FRAMES = path.join(MODELDATA_DIR, 'frames');
/* the UK, the Crown Dependencies and Ireland: the part of the UKV domain the page offers */
const COUNTRIES = new Set(['GB', 'IM', 'JE', 'GG', 'IE']);
const RUN_RE = /^\d{8}T\d{4}Z$/;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* ── the display grid: Lambert azimuthal equal-area on WGS84, centred 54.9N 2.5W ──
   Ellipsoidal, as pyproj does it (src/lib/ukRadar.jsx has the same, checked to 0.1 m). */
const D = Math.PI / 180;
const A = 6378137, FL = 1 / 298.257223563, E2 = FL * (2 - FL), E = Math.sqrt(E2);
const qf = (s) => (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
const QP = qf(1), RQ = A * Math.sqrt(QP / 2);
const PHI1 = 54.9 * D, LAM0 = -2.5 * D;
const B1 = Math.asin(qf(Math.sin(PHI1)) / QP);
const DD = (A * Math.cos(PHI1) / Math.sqrt(1 - E2 * Math.sin(PHI1) ** 2)) / (RQ * Math.cos(B1));
function laea(lon, lat) {
  const b = Math.asin(qf(Math.sin(lat * D)) / QP);
  const dl = lon * D - LAM0;
  const bb = RQ * Math.sqrt(2 / (1 + Math.sin(B1) * Math.sin(b) + Math.cos(B1) * Math.cos(b) * Math.cos(dl)));
  return [bb * DD * Math.cos(b) * Math.sin(dl), (bb / DD) * (Math.cos(B1) * Math.sin(b) - Math.sin(B1) * Math.cos(b) * Math.cos(dl))];
}
/* the grid's outer edge; a cell of size dx is centred dx/2 inside it (2 km frames, 1 km radar) */
const EDGE_X = -1159000, EDGE_Y = 903000;
function cellOf(lon, lat, dx) {
  const [x, y] = laea(lon, lat);
  return [Math.round((EDGE_Y - y) / dx - 0.5), Math.round((x - EDGE_X) / dx - 0.5)];
}

/* a frame's bytes -> value: linear or square-root scale, 255 = no data */
function decoder({ lo, hi, scale }) {
  if (scale === 'sqrt') {
    const a = Math.sqrt(Math.max(lo, 0)), b = Math.sqrt(hi);
    return (q) => (q === 255 ? null : (a + (q / 254) * (b - a)) ** 2);
  }
  return (q) => (q === 255 ? null : lo + (q / 254) * (hi - lo));
}
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/* ── whole frames (now analysis, observed day, radar, UKV rain), decoded once and kept ── */
const frameCache = new Map();
function frameAt(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}|${st.mtimeMs}`;
  const hit = frameCache.get(key);
  if (hit) { frameCache.delete(key); frameCache.set(key, hit); return hit; }
  let f;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(file));
    const n = raw.readUInt32LE(0);
    const head = JSON.parse(raw.subarray(4, 4 + n).toString('utf8'));
    f = { head, q: raw.subarray(4 + n, 4 + n + head.nx * head.ny), nx: head.nx, ny: head.ny, dx: 2000 * (head.k ?? 1), dec: decoder(head) };
  } catch { return null; }
  frameCache.set(key, f);
  while (frameCache.size > 24) frameCache.delete(frameCache.keys().next().value);
  return f;
}
function sample(f, lon, lat) {
  if (!f) return null;
  const [r, c] = cellOf(lon, lat, f.dx);
  return r < 0 || c < 0 || r >= f.ny || c >= f.nx ? null : f.dec(f.q[r * f.nx + c]);
}

/* ── the forecast from the point cubes ─────────────────────────────────────── */
let cubeList = { key: '', list: [] };
function cubes() {
  const tags = builtCubes();
  const key = tags.join(',');
  if (key !== cubeList.key) {
    cubeList = {
      key,
      list: tags.map((tag) => {
        const man = readJson(path.join(POINT_DIR, tag, 'manifest.json'));
        return man && { tag, man, dir: path.join(POINT_DIR, tag), runMs: Date.parse(man.run), dec: Object.fromEntries(Object.entries(man.vars).map(([v, e]) => [v, decoder(e)])) };
      }).filter(Boolean).reverse(),                                     // newest first
    };
  }
  return cubeList.list;
}
/* each listed cell's whole row of one variable */
function readRows(c, v, cells) {
  const n = c.man.steps.length;
  const fd = fs.openSync(path.join(c.dir, `${v}.u8`), 'r');
  try {
    return cells.map((k) => { const b = Buffer.alloc(n, 255); if (k >= 0) fs.readSync(fd, b, 0, n, k * n); return b; });
  } finally { fs.closeSync(fd); }
}
const disc = (R) => {
  const out = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dy, dx]);
  return out;
};
/* the neighbourhoods behind the chances: rain within 10 km, lightning within 16 km of the place */
const NB_RAIN = disc(5), NB_THUNDER = disc(8);

function forecastAt(lat, lon) {
  const list = cubes();
  if (!list.length) return { error: 'warming' };
  const primary = list[0];
  const long = list.find((c) => Math.max(...c.man.steps) >= 120);
  const [row, col] = cellOf(lon, lat, 2000);
  const inCube = (m, r, c) => r >= m.r0 && c >= m.c0 && r < m.r0 + m.nr && c < m.c0 + m.nc;
  if (!inCube(primary.man, row, col)) return { error: 'outside' };
  const tOf = (c, h) => c.runMs + h * 3600e3;
  const pm = primary.man;
  const pStart = tOf(primary, pm.steps[0]), pEnd = tOf(primary, pm.steps[pm.steps.length - 1]);
  /* the freshest run where it reaches, the run before it for today's earlier hours, and the
     newest T+120 run beyond the freshest run's end */
  const prev = list.find((c) => c !== primary && c.runMs < primary.runMs);
  const segs = [];
  if (prev) segs.push([prev, (t) => t < pStart]);
  segs.push([primary, () => true]);
  if (long && long !== primary) segs.push([long, (t) => t > pEnd]);

  const vars = Object.keys(pm.vars);
  const out = { times: [], src: [], span: [], v: Object.fromEntries(vars.map((v) => [v, []])), p_rain: [], p_thunder: [] };
  const runs = [];
  for (const [c, keep] of segs) {
    const m = c.man;
    if (!inCube(m, row, col)) continue;
    const cell = (dy, dx) => (inCube(m, row + dy, col + dx) ? (row + dy - m.r0) * m.nc + (col + dx - m.c0) : -1);
    const centre = cell(0, 0);
    const rows = Object.fromEntries(vars.filter((v) => m.vars[v]).map((v) => [v, readRows(c, v, [centre])[0]]));
    const rainNb = m.vars.precip_step ? readRows(c, 'precip_step', NB_RAIN.map(([a, b]) => cell(a, b))) : [];
    const boltNb = m.vars.lightning ? readRows(c, 'lightning', NB_THUNDER.map(([a, b]) => cell(a, b))) : [];
    const rainSteps = m.vars.precip_step?.steps || [];
    let ri = runs.findIndex((r) => r.tag === c.tag);
    if (ri < 0) { runs.push({ tag: c.tag, run: m.run, built: m.built, top: Math.max(...m.steps) }); ri = runs.length - 1; }
    const chance = (nb, dec, thr, i) => {
      let n = 0, hit = 0;
      for (const b of nb) { const v = dec(b[i]); if (v != null) { n++; if (v >= thr) hit++; } }
      return n ? Math.round((hit / n) * 100) : null;
    };
    m.steps.forEach((h, i) => {
      const t = tOf(c, h);
      if (!keep(t)) return;
      out.times.push(t);
      out.src.push(ri);
      const k = rainSteps.indexOf(h);
      out.span.push(k > 0 ? h - rainSteps[k - 1] : k === 0 ? 0 : null);  // hours the step's rain amount covers
      for (const v of vars) out.v[v].push(rows[v] ? r2(c.dec[v](rows[v][i])) : null);
      out.p_rain.push(rainNb.length ? chance(rainNb, c.dec.precip_step, 0.1, i) : null);
      out.p_thunder.push(boltNb.length ? chance(boltNb, c.dec.lightning, 0.01, i) : null);
    });
  }
  const [x, y] = laea(lon, lat);
  return { ...out, runs, units: Object.fromEntries(vars.map((v) => [v, pm.vars[v].unit])), cell: { row, col, offset_km: Math.round(Math.hypot(x - (EDGE_X + (col + 0.5) * 2000), y - (EDGE_Y - (row + 0.5) * 2000)) / 100) / 10 } };
}

/* ── now and today so far ──────────────────────────────────────────────────── */
const NOW_VARS = ['t2', 'td2', 'rh2', 'wind10', 'wdir10', 'gust10', 'mslp', 'feels', 'windchill', 'tcc'];
const stampOf = (iso) => iso.replace(/[-:]/g, '').slice(0, 13);              // 2026-10-20T17:15 -> 20261020T1715
function nowAt(lat, lon) {
  const cat = readJson(path.join(LIVE, 'catalog.json'));
  const out = {};
  let valid = null;
  for (const v of NOW_VARS) {
    const t = cat?.products?.[`now_${v}`]?.times?.at(-1);
    if (!t) continue;
    const val = sample(frameAt(path.join(LIVE, `now_${v}`, `${stampOf(t)}.bin`)), lon, lat);
    if (val == null) continue;
    out[v] = r2(val);
    valid = valid && valid > t ? valid : t;
  }
  /* is it raining there now: the newest radar frame at the place */
  const rt = readJson(path.join(LIVE, 'radar', 'index.json'))?.times?.at(-1);
  if (rt) {
    const rain = sample(frameAt(path.join(LIVE, 'radar', `${stampOf(rt)}.bin`)), lon, lat);
    if (rain != null) { out.radar = r2(rain); out.radar_valid = rt; }
  }
  return valid ? { valid, ...out } : null;
}
const OBS_FIELDS = ['t2_max', 't2_min', 'precip_total', 'gust10_max', 'wind10_max', 'rain_rate_max', 'feels_min', 'feels_max', 'rh2_min', 'td2_max'];
const londonDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function observedAt(lat, lon) {
  const day = londonDay();
  const sum = readJson(path.join(OBS, day, 'summary.json'));
  if (!sum) return null;
  const out = { day, updated: sum.updated, analyses: sum.analyses, expected: sum.expected };
  for (const f of OBS_FIELDS) out[f] = r2(sample(frameAt(path.join(OBS, day, `${f}.bin`)), lon, lat));
  return out;
}

/* ── radar ─────────────────────────────────────────────────────────────────── */
const HALF_KM = 200;                                                         // the crop reaches 200 km each way
function radarIndex() {
  const radar = readJson(path.join(LIVE, 'radar', 'index.json'))?.times || [];
  const past = radar.slice(-12);                                             // the last three hours, every 15 min
  const list = cubes();
  const future = [];
  if (list.length) {
    const c = list[0];
    const st = readJson(path.join(FRAMES, 'ukv', c.tag, 'precip_rate', 'status.json'));
    const done = new Set(st?.done || []);
    const from = past.length ? Date.parse(past[past.length - 1]) : Date.now();
    for (const h of c.man.steps) {
      const t = c.runMs + h * 3600e3;
      if (t > from && t <= from + 9 * 3600e3 && done.has(h)) future.push({ run: c.tag, h, valid: new Date(t).toISOString() });
    }
  }
  return { past, future };
}
function crop(file, lat, lon) {
  const f = frameAt(file);
  if (!f) return null;
  const half = Math.round((HALF_KM * 1000) / f.dx);
  const [row, col] = cellOf(lon, lat, f.dx);
  const r0 = Math.max(0, row - half), c0 = Math.max(0, col - half);
  const r1 = Math.min(f.ny, row + half + 1), c1 = Math.min(f.nx, col + half + 1);
  if (r1 <= r0 || c1 <= c0) return null;
  const nx = c1 - c0, ny = r1 - r0;
  const body = Buffer.alloc(nx * ny);
  for (let r = 0; r < ny; r++) f.q.copy(body, r * nx, (r0 + r) * f.nx + c0, (r0 + r) * f.nx + c1);
  const head = Buffer.from(JSON.stringify({
    valid: f.head.valid, lo: f.head.lo, hi: f.head.hi, scale: f.head.scale || 'lin', dx: f.dx, nx, ny,
    x0: EDGE_X + (c0 + 0.5) * f.dx, y0: EDGE_Y - (r0 + 0.5) * f.dx,       // centre of the crop's first (north-west) cell
  }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length);
  return zlib.gzipSync(Buffer.concat([len, head, body]), { level: 5 });
}

export function mountLocationWeather(app) {
  app.get('/api/location/forecast', async (req, res) => {
    let lat = Number(req.query.lat), lon = Number(req.query.lon);
    let name = String(req.query.name || '').trim().slice(0, 80);
    const q = String(req.query.q || '').trim().slice(0, 80);
    let country = null;
    try {
      if (!(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
        if (!q) return res.status(400).json({ error: 'Search for a town, city or postcode.' });
        /* typed and entered without picking a suggestion: the best suggestion, the same engine */
        const best = (await searchPlaces(q, 1))[0];
        if (best) {
          lat = best.lat; lon = best.lon; country = best.cc; name = best.name;
        } else {
          const hit = await geocode(q);
          if (!hit) return res.status(404).json({ error: `Could not find "${q}". Try a nearby town or postcode.` });
          lat = hit.latitude; lon = hit.longitude; country = hit.country_code;
          name = hit.name + (hit.admin1 && hit.admin1 !== hit.name ? `, ${hit.admin1}` : '');
        }
      } else if (!name) {
        const r = await reverseName(lat, lon);
        name = r.name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
        country = r.countryCode;
      }
    } catch {
      return res.status(502).json({ error: 'The place search is not answering. Try again in a moment.' });
    }
    if (country && !COUNTRIES.has(country)) return res.json({ code: 'OUTSIDE_UK', resolvedCountry: country, resolvedName: name });
    let fc;
    try { fc = forecastAt(lat, lon); } catch { fc = { error: 'read' }; }
    if (fc.error === 'outside') return res.json({ code: 'OUTSIDE_UK', resolvedName: name });
    if (fc.error) return res.status(503).json({ error: 'The Met Office UKV forecast is being prepared. Try again in a few minutes.' });
    res.set('Cache-Control', 'no-cache');
    res.json({ location: { name, lat, lon, country }, forecast: fc, now: nowAt(lat, lon), observed: observedAt(lat, lon), generated: new Date().toISOString() });
  });

  app.get('/api/location/search', async (req, res) => {
    const q = String(req.query.q || '').slice(0, 60);
    try {
      res.set('Cache-Control', 'public, max-age=3600');
      res.json({ results: await searchPlaces(q, 8) });
    } catch {
      res.json({ results: [] });
    }
  });

  app.get('/api/location/now', (req, res) => {
    const pts = String(req.query.p || '').split('|').slice(0, 12).map((x) => x.split(',').map(Number))
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ places: pts.map(([lat, lon]) => nowAt(lat, lon)) });
  });

  app.get('/api/location/radar', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(radarIndex());
  });

  app.get('/api/location/radar/frame', (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).end();
    let file;
    if (req.query.src === 'radar' && /^\d{8}T\d{4}$/.test(String(req.query.t))) file = path.join(LIVE, 'radar', `${req.query.t}.bin`);
    else if (req.query.src === 'ukv' && RUN_RE.test(String(req.query.run)) && /^\d{1,3}$/.test(String(req.query.h))) {
      file = path.join(FRAMES, 'ukv', String(req.query.run), 'precip_rate', `${req.query.h}.bin`);
    } else return res.status(400).end();
    const body = crop(file, lat, lon);
    if (!body) return res.status(404).end();
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400, immutable' });
    res.end(body);
  });
}
