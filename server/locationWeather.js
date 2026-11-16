/* Location Weather API: one place's weather from the Met Office UKV 2 km model on AWS.

   The forecast is read from the point cubes server/modelData.js keeps (mdata/point.py): each
   cube holds a whole UKV run restacked so a place's forecast is one small read per variable.
   The freshest cube gives the first two days and the newest T+120 cube the rest. Current
   conditions are the 15-minute UKV + METAR analysis (mdata/now.py), "today so far" is the
   observed day it keeps, and the radar is the Met Office composite from the AWS bucket.

     GET /api/location/forecast?lat=&lon=[&name=]  or  ?q=     everything the page shows, with the
                                                                radar nowcast minute by minute for 90 minutes
     GET /api/location/search?q=                                place suggestions as you type (server/placeSearch.js)
     GET /api/location/now?p=lat,lon|lat,lon…                   now at up to 12 places (the landing cards)
     GET /api/location/radar?lat=&lon=                          past radar times, next hours' UKV rain
     GET /api/location/radar/frame?src=radar&t=YYYYmmddTHHMM&lat=&lon=
     GET /api/location/radar/frame?src=ukv&run=YYYYmmddTHHMMZ&h=N&lat=&lon=
                                                                a 400 km crop round the place, gzip
     GET /api/location/lightning?lat=&lon=                      strikes within 60 km in the last hour
     GET /api/location/storm?lat=&lon=                          the nearest heavy cell coming this way (radar), and
                                                                the storm environment now (CAPE, shear: AIW's GFS)
     GET /api/location/changes?lat=&lon=                        the newest UKV run against the one before, here
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODELDATA_DIR, POINT_DIR, builtCubes } from './modelData.js';
import { geocode, reverseName } from './functions/getMetOfficeLocationWeather.js';
import { searchPlaces } from './placeSearch.js';
import { novaThunderAt } from './novaPoint.js';
import { frostPoint } from './tcmFrost.js';
import { haversineKm, bearingDeg, kmPerDegLon } from './aiw/geometry.js';
import { envPeek } from './aiw/env.js';
import { mountOutside } from './location/outside.js';

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
/* the radar loops alone ask for ~40 frames (the rain and its type, past and next hours), and the
   page's own ~25 (now, today so far, the newest scans) are kept warm beside them */
const FRAME_CACHE = 80;
function parseFrame(raw) {
  const n = raw.readUInt32LE(0);
  const head = JSON.parse(raw.subarray(4, 4 + n).toString('utf8'));
  const dec = decoder(head);
  const lut = Float32Array.from({ length: 256 }, (_, q) => (q === 255 ? NaN : dec(q)));
  return { head, q: raw.subarray(4 + n, 4 + n + head.nx * head.ny), nx: head.nx, ny: head.ny, dx: 2000 * (head.k ?? 1), dec, lut };
}
function keep(key, f) {
  frameCache.set(key, f);
  while (frameCache.size > FRAME_CACHE) frameCache.delete(frameCache.keys().next().value);
  return f;
}
function frameAt(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}|${st.mtimeMs}`;
  const hit = frameCache.get(key);
  if (hit) { frameCache.delete(key); frameCache.set(key, hit); return hit; }
  try { return keep(key, parseFrame(zlib.gunzipSync(fs.readFileSync(file)))); } catch { return null; }
}
/* The same without holding up the site: the frames are on an external drive that can take most of a
   second a file when busy, and a page's radar loop asks for dozens of them at once. */
const gunzip = (buf) => new Promise((ok, no) => zlib.gunzip(buf, (e, r) => (e ? no(e) : ok(r))));
async function frameAtAsync(file) {
  let st;
  try { st = await fs.promises.stat(file); } catch { return null; }
  const key = `${file}|${st.mtimeMs}`;
  const hit = frameCache.get(key);
  if (hit) { frameCache.delete(key); frameCache.set(key, hit); return hit; }
  try { return keep(key, parseFrame(await gunzip(await fs.promises.readFile(file)))); } catch { return null; }
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
/* Cloud is the sky over the place, not one 2 km cell: cloud at 1-2 km is seen tens of km away,
   and the UKV's single cell flicks between 0 and 100 % from hour to hour (Dunstable, 22 Oct
   2026: 54, 21, 48, 0, 100 % from 14:00). So cloud is the mean within 8 km. */
const NB_SKY = disc(4), SKY_VARS = new Set(['tcc', 'lcc', 'mcc', 'hcc']);

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
    const rows = Object.fromEntries(vars.filter((v) => m.vars[v] && !SKY_VARS.has(v)).map((v) => [v, readRows(c, v, [centre])[0]]));
    const sky = Object.fromEntries(vars.filter((v) => m.vars[v] && SKY_VARS.has(v)).map((v) => [v, readRows(c, v, NB_SKY.map(([a, b]) => cell(a, b)))]));
    const skyMean = (v, i) => {
      let s = 0, n = 0;
      for (const b of sky[v]) { const x = c.dec[v](b[i]); if (x != null) { s += x; n++; } }
      return n ? s / n : null;
    };
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
      for (const v of vars) out.v[v].push(rows[v] ? r2(c.dec[v](rows[v][i])) : sky[v] ? r2(skyMean(v, i)) : null);
      out.p_rain.push(rainNb.length ? chance(rainNb, c.dec.precip_step, 0.1, i) : null);
      out.p_thunder.push(boltNb.length ? chance(boltNb, c.dec.lightning, 0.01, i) : null);
    });
  }
  const [x, y] = laea(lon, lat);
  return { ...out, runs, units: Object.fromEntries(vars.map((v) => [v, pm.vars[v].unit])), cell: { row, col, offset_km: Math.round(Math.hypot(x - (EDGE_X + (col + 0.5) * 2000), y - (EDGE_Y - (row + 0.5) * 2000)) / 100) / 10 } };
}

/* ── version 2 cubes (mdata/point.py cube2, 15 Nov 2026): a place in one read a cube ──────────────
   A place's first load used to read ~500 scattered rows of the cubes above (a row a variable, and
   50-200 cells round it for its chances and its sky): 1.6-2.6 s on the external drive. A v2 cube
   keeps each cell's whole forecast as one block, [var][step], with the chances and the sky already
   worked out, so a place is one small read from each cube, and none of it holds up the site.
     ukv        the hours (as above, plus the snow conditions index)
     mix        the days: the MWUK Mix of the UKV and DWD ICON-EU (mdata/mix.py)
     mo_global  the days beyond the Mix: the Met Office Global, from T+90 */
const POINT2 = path.join(MODELDATA_DIR, 'point2');
const readJsonAsync = async (f) => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch { return null; } };
/* the Lambert azimuthal equal-area grid of a cube (the UKV's, or the global models' wide one) */
const projs = new Map();
function projOf(g) {
  const key = `${g.lat0},${g.lon0}`;
  if (!projs.has(key)) {
    const p1 = g.lat0 * D, l0 = g.lon0 * D;
    const b1 = Math.asin(qf(Math.sin(p1)) / QP);
    const dd = (A * Math.cos(p1) / Math.sqrt(1 - E2 * Math.sin(p1) ** 2)) / (RQ * Math.cos(b1));
    projs.set(key, (lon, lat) => {
      const b = Math.asin(qf(Math.sin(lat * D)) / QP);
      const dl = lon * D - l0;
      const bb = RQ * Math.sqrt(2 / (1 + Math.sin(b1) * Math.sin(b) + Math.cos(b1) * Math.cos(b) * Math.cos(dl)));
      return [bb * dd * Math.cos(b) * Math.sin(dl), (bb / dd) * (Math.cos(b1) * Math.sin(b) - Math.sin(b1) * Math.cos(b) * Math.cos(dl))];
    });
  }
  return projs.get(key);
}
/* (row, col) of the grid cell a place is in, and how far the cell's centre is (km) */
function cellIn(g, lon, lat) {
  const [x, y] = projOf(g)(lon, lat);
  const row = Math.round((g.y_top + g.dx / 2 - y) / g.dx - 0.5), col = Math.round((x - (g.x0 - g.dx / 2)) / g.dx - 0.5);
  return { row, col, km: Math.round(Math.hypot(x - (g.x0 + col * g.dx), y - (g.y_top - row * g.dx)) / 100) / 10 };
}
const lutOf = (e) => { const dec = decoder(e); return Float32Array.from({ length: 256 }, (_, q) => (q === 255 ? NaN : dec(q))); };
const lists2 = new Map();                                                    // model -> { at, list }
function cubeOf(model, tag, man) {
  const runMs = Date.parse(man.run);
  const steps = man.steps;
  return {
    model, tag, man, runMs, steps, dir: path.join(POINT2, model, tag),
    lut: Object.fromEntries(Object.entries(man.vars).map(([v, e]) => [v, lutOf(e)])),
    idx: Object.fromEntries(man.order.map((v, i) => [v, i])),
    width: man.order.length * steps.length,
    start: runMs + steps[0] * 3600e3, end: runMs + steps[steps.length - 1] * 3600e3, top: Math.max(...steps),
    key: `${model}:${tag}:${man.built}`,
  };
}
/** The v2 cubes of a model, newest run first (the listing is looked at again every 20 s at most). */
async function cubes2(model, fresh = false) {
  const hit = lists2.get(model);
  if (hit && !fresh && Date.now() - hit.at < 20e3) return hit.list;
  let names = [];
  try { names = (await fs.promises.readdir(path.join(POINT2, model))).filter((t) => RUN_RE.test(t)).sort().reverse(); } catch { /* none yet */ }
  const list = [];
  for (const tag of names) {
    const man = await readJsonAsync(path.join(POINT2, model, tag, 'manifest.json'));
    if (man?.version !== 2 || !man.steps?.length) continue;
    const old = hit?.list.find((c) => c.tag === tag && c.man.built === man.built);
    list.push(old || cubeOf(model, tag, man));
  }
  lists2.set(model, { at: Date.now(), list });
  return list;
}
/* one cell's block of a cube ([var][step] bytes), or null outside it; a cube rebuilt since it was
   listed (its size no longer matches) is listed again */
async function readBlock(c, row, col) {
  const m = c.man;
  if (row < m.r0 || col < m.c0 || row >= m.r0 + m.nr || col >= m.c0 + m.nc) return null;
  const k = (row - m.r0) * m.nc + (col - m.c0);
  const fh = await fs.promises.open(path.join(c.dir, 'cube.u8'), 'r');
  try {
    const st = await fh.stat();
    if (st.size !== m.nr * m.nc * c.width) { lists2.delete(c.model); return null; }
    const buf = Buffer.alloc(c.width);
    const { bytesRead } = await fh.read(buf, 0, c.width, k * c.width);
    return bytesRead === c.width ? buf : null;
  } finally {
    await fh.close();
  }
}
/* A forecast from layers of cubes: [{ c, keep(t) }], the first the most wanted. Each step a layer
   keeps becomes one time; `span` is the hours its amounts cover. The chances come out of `v`. */
async function layered(layers, lat, lon) {
  const vars = [...new Set(layers.flatMap(({ c }) => c.man.order))];
  const blocks = await Promise.all(layers.map(({ c }) => { const at = cellIn(c.man.grid, lon, lat); return readBlock(c, at.row, at.col).catch(() => null); }));
  const rows = [], runs = [];
  layers.forEach(({ c, keep }, j) => {
    const b = blocks[j];
    if (!b) return;
    const S = c.steps.length, ri = runs.length;
    runs.push({ model: c.model, tag: c.tag, run: c.man.run, built: c.man.built, top: c.top, ...(c.man.pair ? { pair: c.man.pair } : {}) });
    c.steps.forEach((h, i) => {
      const t = c.runMs + h * 3600e3;
      if (!keep(t)) return;
      const vals = vars.map((v) => {
        const k = c.idx[v];
        if (k == null) return null;
        const x = c.lut[v][b[k * S + i]];
        return Number.isNaN(x) ? null : r2(x);
      });
      rows.push({ t, ri, span: c.man.spans ? c.man.spans[i] : i ? h - c.steps[i - 1] : null, vals });
    });
  });
  rows.sort((a, b) => a.t - b.t);
  const v = Object.fromEntries(vars.map((x, k) => [x, rows.map((r) => r.vals[k])]));
  const { p_rain: pr, p_thunder: pt, ...rest } = v;
  const units = {};
  for (const { c } of layers) for (const [x, e] of Object.entries(c.man.vars)) units[x] ??= e.unit;
  return {
    times: rows.map((r) => r.t), src: rows.map((r) => r.ri), span: rows.map((r) => r.span), v: rest,
    p_rain: pr || rows.map(() => null), p_thunder: pt || rows.map(() => null), runs, units,
  };
}
/** The hours (UKV, as forecastAt above, from the v2 cubes): null when there are none yet. */
async function hoursAt(lat, lon) {
  const list = await cubes2('ukv');
  if (!list.length) return null;
  const primary = list[0];
  const at = cellIn(primary.man.grid, lon, lat);
  const m = primary.man;
  if (at.row < m.r0 || at.col < m.c0 || at.row >= m.r0 + m.nr || at.col >= m.c0 + m.nc) return { error: 'outside' };
  const long = list.find((c) => c.top >= 120);
  const prev = list.find((c) => c !== primary && c.runMs < primary.runMs);
  const layers = [{ c: primary, keep: () => true }];
  if (prev && prev === long) layers.push({ c: prev, keep: (t) => t < primary.start || t > primary.end });   // one run both ways
  else {
    if (prev) layers.push({ c: prev, keep: (t) => t < primary.start });
    if (long && long !== primary) layers.push({ c: long, keep: (t) => t > primary.end });
  }
  const out = await layered(layers, lat, lon);
  if (!out.times.length) return null;
  return { ...out, cell: { row: at.row, col: at.col, offset_km: at.km } };
}
/** The days: the freshest MWUK Mix, the newest long one (T+114) round and beyond it, then the Met Office
    Global. With no Mix yet, the UKV stands in for it (runs[].model says which). */
async function outlookAt(lat, lon) {
  let mix = await cubes2('mix');
  if (!mix.length) mix = await cubes2('ukv');
  const mog = await cubes2('mo_global');
  const fresh = mix[0], long = mix.find((c) => c.top >= 100);
  const layers = [];
  if (fresh) layers.push({ c: fresh, keep: () => true });
  if (long && long !== fresh) layers.push({ c: long, keep: (t) => t < fresh.start || t > fresh.end });
  const end = Math.max(fresh?.end ?? 0, long?.end ?? 0);
  if (mog[0]) layers.push({ c: mog[0], keep: (t) => t > end });
  if (!layers.length) return null;
  const out = await layered(layers, lat, lon);
  return out.times.length ? out : null;
}
/* Each cell's hours and days, kept until a cube is rebuilt: a place opened again (or a neighbour in
   the same 2 km cell) is answered without touching the drive. */
const pointCache = new Map();
async function pointAt(lat, lon) {
  const [u, x, g] = await Promise.all([cubes2('ukv'), cubes2('mix'), cubes2('mo_global')]);
  if (!u.length) return null;
  const at = cellIn(u[0].man.grid, lon, lat);
  const key = `${at.row},${at.col}|${[...u, ...x, ...g].map((c) => c.key).join(',')}`;
  let hit = pointCache.get(key);
  if (!hit) {
    hit = (async () => ({ fc: await hoursAt(lat, lon), ol: await outlookAt(lat, lon).catch(() => null) }))();
    pointCache.set(key, hit);
    hit.catch(() => pointCache.delete(key));
    while (pointCache.size > 400) pointCache.delete(pointCache.keys().next().value);
  }
  const { fc, ol } = await hit;
  if (!fc) return null;
  /* each answer gets its own copy: anchoring to now changes the numbers */
  const out = { fc: structuredClone(fc), ol: ol ? structuredClone(ol) : null };
  if (!out.fc.error) out.fc.cell = { ...out.fc.cell, offset_km: at.km };
  return out;
}

/* ── the next hour and a half, minute by minute: the radar carried forward ──────
   The Met Office composite comes every 15 minutes and reaches AWS 10 minutes after its time, so
   the newest scan is 10 to 25 minutes old: read as "now" it lags a downpour by that much (21 Oct
   2026: a road flooding while the page still said "Rain"). Instead the rain is followed. The last
   three scans round the place are matched (at 4 km over 240 km, then at 2 km) to find how far the
   rain moved in each 15 minutes, and the newest scan is carried on by that motion: the rain at
   the place at any minute is what the scan holds upwind of it, by the motion times the time
   since the scan. A position is less certain the further it is carried, so the read is a
   Gaussian round that point that widens with the lead, giving the expected rate (mm/h) and the
   chance of rain (the weighted share of the read that is raining). */
const NC_MINUTES = 90, NC_MAX_LEAD = 120, NC_MAX_AGE = 45;                    // minutes
const NC_WET = Math.round((Math.sqrt(0.1) / Math.sqrt(128)) * 254);          // 0.1 mm/h in the radar's square-root steps
const radarFile = (t) => path.join(LIVE, 'radar', `${stampOf(t)}.bin`);

/* the square round (row, col), `half` 1 km cells each way, as k x k blocks: each block's mean in
   the radar's own square-root steps (so one downpour does not drown the pattern), NaN off the radar */
function blocks(f, row, col, half, k) {
  const n = Math.floor((2 * half + 1) / k);
  const r0 = row - Math.floor((n * k) / 2), c0 = col - Math.floor((n * k) / 2);
  const g = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0, m = 0;
      for (let a = 0; a < k; a++) {
        const r = r0 + i * k + a;
        if (r < 0 || r >= f.ny) continue;
        const o = r * f.nx;
        for (let b = 0; b < k; b++) {
          const c = c0 + j * k + b;
          if (c < 0 || c >= f.nx) continue;
          const q = f.q[o + c];
          if (q !== 255) { s += q; m++; }
        }
      }
      g[i * n + j] = m ? s / m : NaN;
    }
  }
  return { g, n };
}
/* how well the newer grid matches the older one moved by (dy, dx) blocks: the correlation */
function corr(A, B, n, dy, dx) {
  let N = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = Math.max(0, dy); i < Math.min(n, n + dy); i++) {
    for (let j = Math.max(0, dx); j < Math.min(n, n + dx); j++) {
      const a = A[i * n + j], b = B[(i - dy) * n + (j - dx)];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      N++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
  }
  if (N < n * n * 0.25) return -1;
  const va = saa - (sa * sa) / N, vb = sbb - (sb * sb) / N;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / N) / Math.sqrt(va * vb) : -1;
}
/* the best shift within `reach` of (cy, cx), to a fraction of a block (a parabola through the peak) */
function bestShift(A, B, n, reach, cy = 0, cx = 0) {
  const w = 2 * reach + 1, R = new Float32Array(w * w);
  let bi = 0;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { R[y * w + x] = corr(A, B, n, cy - reach + y, cx - reach + x); if (R[y * w + x] > R[bi]) bi = y * w + x; }
  const by = Math.floor(bi / w), bx = bi % w, c = R[bi];
  const vertex = (m, p) => { const d = m - 2 * c + p; return m > -1 && p > -1 && d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d)) : 0; };
  const fy = by > 0 && by < w - 1 ? vertex(R[(by - 1) * w + bx], R[(by + 1) * w + bx]) : 0;
  const fx = bx > 0 && bx < w - 1 ? vertex(R[by * w + bx - 1], R[by * w + bx + 1]) : 0;
  return { r: c, dy: cy - reach + by + fy, dx: cx - reach + bx + fx };
}
/* how the rain moved between two scans round a cell, in 1 km cells a minute (rows run south) */
function motionBetween(fNew, fOld, row, col, minutes) {
  const A4 = blocks(fNew, row, col, 120, 4), B4 = blocks(fOld, row, col, 120, 4);
  let wet = 0;
  for (const v of A4.g) if (v >= NC_WET) wet++;
  if (wet < A4.n * A4.n * 0.004) return null;                                // too little rain round here to follow
  const coarse = bestShift(A4.g, B4.g, A4.n, Math.ceil((9 * minutes) / 15));   // up to 36 km in 15 minutes
  if (coarse.r < 0.3) return null;
  const A2 = blocks(fNew, row, col, 80, 2), B2 = blocks(fOld, row, col, 80, 2);
  const fine = bestShift(A2.g, B2.g, A2.n, 2, Math.round(coarse.dy * 2), Math.round(coarse.dx * 2));
  const m = fine.r >= coarse.r - 0.05 ? { r: fine.r, dy: fine.dy * 2, dx: fine.dx * 2 } : { r: coarse.r, dy: coarse.dy * 4, dx: coarse.dx * 4 };
  return { r: m.r, vr: m.dy / minutes, vc: m.dx / minutes };
}
const motionCache = new Map();
/* the motion round a cell from the newest scans: both pairs, the newer counting double */
function motionAt(times, row, col) {
  const key = `${times.at(-1)}|${Math.round(row / 40)}|${Math.round(col / 40)}`;
  if (motionCache.has(key)) return motionCache.get(key);
  const fs3 = times.slice(-3).reverse().map((t) => ({ t: Date.parse(t), f: frameAt(radarFile(t)) }));
  const pairs = [];
  for (let k = 0; k + 1 < fs3.length; k++) {
    const [a, b] = [fs3[k], fs3[k + 1]];
    const min = (a.t - b.t) / 60e3;
    if (!a.f || !b.f || min <= 0 || min > 30) continue;
    const m = motionBetween(a.f, b.f, row, col, min);
    if (m) pairs.push({ ...m, w: m.r * (k ? 1 : 2) });
  }
  const W = pairs.reduce((s, p) => s + p.w, 0);
  const mv = W ? { vr: pairs.reduce((s, p) => s + p.vr * p.w, 0) / W, vc: pairs.reduce((s, p) => s + p.vc * p.w, 0) / W, r: Math.max(...pairs.map((p) => p.r)) } : null;
  motionCache.set(key, mv);
  while (motionCache.size > 400) motionCache.delete(motionCache.keys().next().value);
  return mv;
}
/* the live products' indexes (radar, now_ptype), re-read in the background (warmLive) rather than on
   every page: the drive can take most of a second for a file when it is busy */
const liveIdx = new Map();
function liveIndex(name) {
  const hit = liveIdx.get(name);
  if (hit && Date.now() - hit.at < 90e3) return hit.v;
  const v = readJson(path.join(LIVE, name, 'index.json'));
  liveIdx.set(name, { at: Date.now(), v });
  return v;
}
/* the newest analysed precipitation type at or before a radar scan, within half an hour of it */
function typedNear(scanMs) {
  const times = liveIndex('now_ptype')?.times || [];
  for (let i = times.length - 1; i >= 0; i--) {
    const t = Date.parse(times[i]);
    if (t > scanMs + 60e3) continue;
    if (scanMs - t > 30 * 60e3) break;
    const f = frameAt(path.join(LIVE, 'now_ptype', `${stampOf(times[i])}.bin`));
    return f ? { ...f, valid: times[i] } : null;
  }
  return null;
}
function nowcastAt(lat, lon) {
  const times = liveIndex('radar')?.times || [];
  const t0 = times.at(-1);
  if (!t0 || Date.now() - Date.parse(t0) > NC_MAX_AGE * 60e3) return null;
  const f = frameAt(radarFile(t0));
  if (!f) return null;
  const [row, col] = cellOf(lon, lat, f.dx);
  if (row < 0 || col < 0 || row >= f.ny || col >= f.nx || f.q[row * f.nx + col] === 255) return null;
  const mv = motionAt(times, row, col);
  const vr = mv?.vr ?? 0, vc = mv?.vc ?? 0;
  const start = Math.floor(Date.now() / 60e3) * 60e3, scan = Date.parse(t0);
  const rate = [], chance = [], kind = [];
  /* what is falling, carried with the rain: the current-conditions analysis' type (mdata/now.py
     now_ptype, 2 km: 0 rain, 1 sleet, 2 snow, 3 ice) where the rain over the place will have come from */
  const typed = typedNear(scan);
  const kindAt = (sr, sc) => {
    if (!typed) return null;
    const r2k = Math.floor(((sr + 0.5) * f.dx) / typed.dx), c2k = Math.floor(((sc + 0.5) * f.dx) / typed.dx);
    const n = [0, 0, 0, 0];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = r2k + dr, c = c2k + dc;
        if (r < 0 || c < 0 || r >= typed.ny || c >= typed.nx) continue;
        const q = typed.q[r * typed.nx + c];
        if (q >= 1 && q <= 252) n[Math.floor((q - 1) / 63)] += dr || dc ? 1 : 3;     // the cell itself counts most
      }
    }
    const best = n.indexOf(Math.max(...n));
    return n[best] > 0 ? best : null;
  };
  for (let m = 0; m <= NC_MINUTES; m++) {
    const lead = (start + m * 60e3 - scan) / 60e3;
    if (lead > NC_MAX_LEAD) break;
    /* where the rain over the place at this minute is in the scan, and how sure that is: a
       Gaussian of 0.7 km at the scan, about 3 km an hour on (wider when the motion is unknown) */
    const sr = row - vr * lead, sc = col - vc * lead;
    const sig = 0.7 + (mv ? 0.035 : 0.06) * lead, reach = Math.ceil(sig * 2);
    let sw = 0, sv = 0, swet = 0;
    for (let r = Math.floor(sr) - reach; r <= Math.ceil(sr) + reach; r++) {
      if (r < 0 || r >= f.ny) continue;
      for (let c = Math.floor(sc) - reach; c <= Math.ceil(sc) + reach; c++) {
        if (c < 0 || c >= f.nx) continue;
        const v = f.lut[f.q[r * f.nx + c]];
        if (Number.isNaN(v)) continue;
        const d2 = (r - sr) ** 2 + (c - sc) ** 2;
        if (d2 > 4 * sig * sig) continue;
        const w = Math.exp(-d2 / (2 * sig * sig));
        sw += w; sv += w * v; if (v >= 0.1) swet += w;
      }
    }
    rate.push(sw ? r2(sv / sw) : null);
    chance.push(sw ? Math.round((swet / sw) * 100) : null);
    kind.push(sw && sv / sw >= 0.05 ? kindAt(sr, sc) : null);
  }
  /* the motion for the page's words: speed and the compass direction it is heading */
  const kmh = mv ? Math.hypot(vr, vc) * 60 * (f.dx / 1000) : null;
  return {
    scan: t0, start: new Date(start).toISOString(), step: 1, rate, chance, kind, typed: typed?.valid ?? null,
    motion: mv ? { kmh: Math.round(kmh), towards: Math.round(((Math.atan2(vc, -vr) * 180) / Math.PI + 360) % 360) } : null,
  };
}

const tryNowcast = (lat, lon) => { try { return nowcastAt(lat, lon); } catch { return null; } };   // never costs the page its forecast

/* ── now and today so far ──────────────────────────────────────────────────── */
const NOW_VARS = ['t2', 'td2', 'rh2', 'wind10', 'wdir10', 'gust10', 'mslp', 'feels', 'windchill', 'tcc'];
const stampOf = (iso) => iso.replace(/[-:]/g, '').slice(0, 13);              // 2026-10-20T17:15 -> 20261020T1715
let liveCat = { at: 0, v: null };
const liveCatalog = () => {
  if (Date.now() - liveCat.at > 90e3) liveCat = { at: Date.now(), v: readJson(path.join(LIVE, 'catalog.json')) };
  return liveCat.v;
};
/* Kept warm in the background, so a page never waits on the drive for them: the newest analysis,
   radar scans and type, and today's observed frames, re-read every 30 s (cached while unchanged). */
async function warmLive() {
  try {
    const cat = await readJsonAsync(path.join(LIVE, 'catalog.json'));
    if (cat) liveCat = { at: Date.now(), v: cat };
    for (const name of ['radar', 'now_ptype']) {
      const v = await readJsonAsync(path.join(LIVE, name, 'index.json'));
      if (v) liveIdx.set(name, { at: Date.now(), v });
    }
    for (const v of NOW_VARS) {
      const t = cat?.products?.[`now_${v}`]?.times?.at(-1);
      if (t) await frameAtAsync(path.join(LIVE, `now_${v}`, `${stampOf(t)}.bin`));
    }
    for (const t of (liveIdx.get('radar')?.v?.times || []).slice(-3)) await frameAtAsync(radarFile(t));
    const pt = liveIdx.get('now_ptype')?.v?.times?.at(-1);
    if (pt) await frameAtAsync(path.join(LIVE, 'now_ptype', `${stampOf(pt)}.bin`));
    const day = londonDay();
    for (const f of OBS_FIELDS) await frameAtAsync(path.join(OBS, day, `${f}.bin`));
    await Promise.all(['ukv', 'mix', 'mo_global'].map((m) => cubes2(m, true)));
    await frostPoint(52.5, -1.5).catch(() => null);             // a new TCM FROST run's point cube, inflated before anyone asks
  } catch { /* the next round */ }
}
function nowAt(lat, lon, nc = tryNowcast(lat, lon)) {
  const cat = liveCatalog();
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
  /* Only what is current counts as "now". After the PC had slept, the page showed last night's
     analysis as this morning's weather ("cloudy" in heavy rain): an analysis over 90 minutes old is
     dropped, so the page uses the forecast hour, and so is a radar scan over 45 minutes old. */
  const age = (t) => Date.now() - Date.parse(t);
  if (valid && age(valid) > 90 * 60e3) { for (const k of Object.keys(out)) delete out[k]; valid = null; }
  /* is it raining there now: the radar carried forward to this minute (above), or failing that
     the newest scan at the place */
  if (nc?.rate[0] != null) {
    out.radar = nc.rate[0]; out.radar_valid = nc.start; out.radar_scan = nc.scan;
  } else {
    const rt = liveIndex('radar')?.times?.at(-1);
    if (rt && age(rt) <= NC_MAX_AGE * 60e3) {
      const rain = sample(frameAt(radarFile(rt)), lon, lat);
      if (rain != null) { out.radar = r2(rain); out.radar_valid = rt; out.radar_scan = rt; }
    }
  }
  if (valid) return { valid, ...out };
  return out.radar != null ? out : null;
}
/* ── the forecast held to what is observed now ─────────────────────────────────
   A model run starts the hours ahead with its own error at the start of them. At 18:00 on 22 Oct
   2026 the UKV had Dunstable cloudless an hour before its front's cloud arrived, while that cloud
   was already overhead. So the analysis' difference from the forecast at the analysis time is
   carried into the hours after it, fading with the lead: cloud (a timing error) within about two
   hours, wind three, temperature five, dew point six, pressure twelve. [e-folding hours, the
   largest difference believed]. The past hours are left as forecast. */
const ANCHOR = { tcc: [2, 100], wind10: [3, 15], gust10: [3, 20], t2: [5, 5], td2: [6, 5], mslp: [12, 6] };
const rhOf = (t, td) => Math.min(100, 100 * Math.exp((17.625 * td) / (243.04 + td) - (17.625 * t) / (243.04 + t)));
function anchorToNow(fc, now) {
  const t0 = now?.valid ? Date.parse(now.valid) : NaN;
  const T = fc.times;
  const k = T.findIndex((t) => t >= t0);
  if (!Number.isFinite(t0) || k < 0 || (k === 0 && T[0] !== t0)) return null;
  const at0 = (arr) => {
    if (T[k] === t0) return arr[k];
    const a = arr[k - 1], b = arr[k];
    return a == null || b == null ? null : a + (b - a) * ((t0 - T[k - 1]) / (T[k] - T[k - 1]));
  };
  const deltas = {};
  const before = { tcc: fc.v.tcc?.slice() };
  for (const [v, [tau, lim]] of Object.entries(ANCHOR)) {
    const arr = fc.v[v], ob = now[v];
    if (!arr || ob == null) continue;
    const f0 = at0(arr);
    if (f0 == null) continue;
    const d = Math.max(-lim, Math.min(lim, ob - f0));
    deltas[v] = r2(d);
    for (let i = k; i < T.length; i++) {
      if (T[i] > t0 && arr[i] != null) arr[i] = r2(arr[i] + d * Math.exp(-(T[i] - t0) / (tau * 3600e3)));
    }
  }
  /* keep the hours consistent: cloud 0-100 with its layers following it (cloud added has no known
     height, so it counts as middle cloud; cloud taken away comes off every layer alike), winds
     and gusts, dew point under the temperature, and the humidity from the two */
  const V = fc.v;
  for (let i = k; i < T.length; i++) {
    if (T[i] <= t0) continue;
    if (V.tcc?.[i] != null) {
      const was = before.tcc[i], c = Math.max(0, Math.min(100, V.tcc[i]));
      V.tcc[i] = r2(c);
      if (was != null && c > was && V.mcc) V.mcc[i] = r2(Math.min(100, (V.mcc[i] ?? 0) + (c - was)));
      else if (was > 0 && c < was) for (const L of ['lcc', 'mcc', 'hcc']) if (V[L]?.[i] != null) V[L][i] = r2(V[L][i] * (c / was));
    }
    if (V.wind10?.[i] != null) V.wind10[i] = Math.max(0, V.wind10[i]);
    if (V.gust10?.[i] != null) V.gust10[i] = Math.max(V.gust10[i], V.wind10?.[i] ?? 0);
    if (V.td2?.[i] != null && V.t2?.[i] != null) {
      V.td2[i] = Math.min(V.td2[i], V.t2[i]);
      if (V.rh2) V.rh2[i] = r2(rhOf(V.t2[i], V.td2[i]));
    }
  }
  return { valid: now.valid, deltas, efold_h: Object.fromEntries(Object.entries(ANCHOR).map(([v, [tau]]) => [v, tau])) };
}

const OBS_FIELDS = ['t2_max', 't2_min', 'precip_total', 'gust10_max', 'wind10_max', 'rain_rate_max', 'feels_min', 'feels_max', 'rh2_min', 'td2_max'];
const londonDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/* a day's observed extremes at the place (today's so far, by default; yesterday's whole day for
   "warmer than yesterday", Phase E) */
function observedAt(lat, lon, day = londonDay()) {
  const sum = readJson(path.join(OBS, day, 'summary.json'));
  if (!sum) return null;
  const out = { day, updated: sum.updated, analyses: sum.analyses, expected: sum.expected };
  for (const f of OBS_FIELDS) out[f] = r2(sample(frameAt(path.join(OBS, day, `${f}.bin`)), lon, lat));
  return out;
}

/* ── radar ─────────────────────────────────────────────────────────────────── */
const HALF_KM = 200;                                                         // a place's crop reaches 200 km each way
/* the home page's UK-wide radar: the UK and Ireland, at 2 km (1 km radar coarsened) */
const UK_VIEW = { lat: 54.8, lon: -4.0, halfKm: 700, km: 2 };
async function radarIndex() {
  const radar = liveIndex('radar')?.times || [];
  const past = radar.slice(-12);                                             // the last three hours, every 15 min
  /* which of them have their precipitation type (mdata/now.py now_ptype) */
  const typed = new Set(liveIndex('now_ptype')?.times || []);
  /* the next hours: the freshest UKV cube's run (version 2, else version 1) */
  const c = (await cubes2('ukv'))[0] || cubes()[0];
  const future = [];
  if (c) {
    const st = await readJsonAsync(path.join(FRAMES, 'ukv', c.tag, 'precip_rate', 'status.json'));
    const done = new Set(st?.done || []);
    const types = new Set((await readJsonAsync(path.join(FRAMES, 'ukv', c.tag, 'ptype', 'status.json')))?.done || []);
    const from = past.length ? Date.parse(past[past.length - 1]) : Date.now();
    for (const h of c.man.steps) {
      const t = c.runMs + h * 3600e3;
      if (t > from && t <= from + 9 * 3600e3 && done.has(h)) future.push({ run: c.tag, h, valid: new Date(t).toISOString(), typed: types.has(h) });
    }
  }
  return { past, pastTyped: past.filter((t) => typed.has(t)), future };
}
/* A square of a frame round a point, optionally coarsened: each `step` x `step` block keeps its
   strongest value (so a small heavy shower survives), and 255 (no data) only where all of it is. */
function cropFrame(f, lat, lon, halfKm = HALF_KM, step = 1) {
  if (!f) return null;
  const half = Math.round((halfKm * 1000) / f.dx);
  const [row, col] = cellOf(lon, lat, f.dx);
  const r0 = Math.max(0, row - half), c0 = Math.max(0, col - half);
  const r1 = Math.min(f.ny, row + half + 1), c1 = Math.min(f.nx, col + half + 1);
  if (r1 <= r0 || c1 <= c0) return null;
  const nx = Math.floor((c1 - c0) / step), ny = Math.floor((r1 - r0) / step);
  const body = Buffer.alloc(nx * ny);
  if (step === 1) {
    for (let r = 0; r < ny; r++) f.q.copy(body, r * nx, (r0 + r) * f.nx + c0, (r0 + r) * f.nx + c0 + nx);
  } else {
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        let best = -1;
        for (let dr = 0; dr < step; dr++) {
          const o = (r0 + r * step + dr) * f.nx + c0 + c * step;
          for (let dc = 0; dc < step; dc++) { const v = f.q[o + dc]; if (v !== 255 && v > best) best = v; }
        }
        body[r * nx + c] = best < 0 ? 255 : best;
      }
    }
  }
  const dx = f.dx * step;
  const head = Buffer.from(JSON.stringify({
    valid: f.head.valid, lo: f.head.lo, hi: f.head.hi, scale: f.head.scale || 'lin', dx, nx, ny,
    /* centre of the crop's first (north-west) cell, a coarsened cell being the middle of its block */
    x0: EDGE_X + c0 * f.dx + dx / 2, y0: EDGE_Y - r0 * f.dx - dx / 2,
  }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length);
  return zlib.gzipSync(Buffer.concat([len, head, body]), { level: 5 });
}

/* ── storm tools (Location Weather, 15 Nov 2026) ─────────────────────────────────────────────────── */

/* The nearest heavy cell coming this way: from the newest radar scan and the rain's own motion round
   the place (motionAt, as the nowcast), walk upwind from the place up to 150 km, across a band 8 km
   either side; the first cell of heavy rain (4 mm/h and over, the page's "heavy") is the one coming.
   It arrives at its distance over the motion's speed, less the scan's age. One local motion and no
   growth or decay, so an estimate for the next hour or two. */
const HEAVY = 4;
function stormArrival(lat, lon) {
  const times = liveIndex('radar')?.times || [];
  const t0 = times.at(-1);
  if (!t0 || Date.now() - Date.parse(t0) > NC_MAX_AGE * 60e3) return null;
  const f = frameAt(radarFile(t0));
  if (!f) return null;
  const [row, col] = cellOf(lon, lat, f.dx);
  if (row < 0 || col < 0 || row >= f.ny || col >= f.nx || f.q[row * f.nx + col] === 255) return null;
  const at = (r, c) => { const R = Math.round(r), C = Math.round(c); return R < 0 || C < 0 || R >= f.ny || C >= f.nx ? NaN : f.lut[f.q[R * f.nx + C]]; };
  const scan = Date.parse(t0), ageMin = (Date.now() - scan) / 60e3;
  const here = at(row, col);
  const mv = motionAt(times, row, col);
  const speed = mv ? Math.hypot(mv.vr, mv.vc) : 0;                     // km a minute (1 km cells)
  if (!mv || speed < 0.05) return { scan: t0, motion: null, here: Number.isNaN(here) ? null : r2(here), cell: null };
  const ur = -mv.vr / speed, uc = -mv.vc / speed;                      // upwind, rows running south
  let hit = null;
  for (let d = 0; d <= 150 && !hit; d++) {
    let best = null;
    for (let s = -8; s <= 8; s++) {
      const v = at(row + ur * d - uc * s, col + uc * d + ur * s);
      if (v >= HEAVY && (!best || v > best.v)) best = { v, s };
    }
    if (best) hit = { km: d, rate: best.v };
  }
  /* compass bearings: where the rain comes from, and where it goes */
  const from = Math.round(((Math.atan2(uc, -ur) * 180) / Math.PI + 360) % 360);
  return {
    scan: t0, here: Number.isNaN(here) ? null : r2(here),
    motion: { kmh: Math.round(speed * 60), from, towards: (from + 180) % 360 },
    cell: hit ? { km: hit.km, rate: r2(hit.rate), etaMin: Math.round(hit.km / speed - ageMin) } : null,
  };
}

/* Lightning near a place: every strike in the last hour within 60 km (the Met Office over the UK and
   Ireland, Blitzortung beyond: server/lightning), as [minutes ago, km, bearing]. The last hour is
   collected once every 30 s for every place, then cut to each. */
let ltgHour = { at: 0, strikes: [] };
function strikesNear(lightning, lat, lon, km = 60) {
  const now = Date.now();
  if (now - ltgHour.at > 30e3) {
    try { ltgHour = { at: now, strikes: lightning.collect(now - 3600e3, now + 60e3, 'uk', 'mo', 400000).strikes || [] }; } catch { ltgHour = { at: now, strikes: [] }; }
  }
  const s = ltgHour.strikes, dLat = km / 111.32 + 0.02, dLon = km / kmPerDegLon(lat) + 0.02;
  const out = [];
  for (let i = 0; i + 2 < s.length; i += 4) {
    const la = s[i + 1], lo = s[i + 2];
    if (Math.abs(la - lat) > dLat || Math.abs(lo - lon) > dLon) continue;
    const d = haversineKm(lat, lon, la, lo);
    if (d > km) continue;
    out.push([Math.round((now - s[i]) / 6e3) / 10, Math.round(d * 10) / 10, Math.round(bearingDeg(lat, lon, la, lo))]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return { now, km, strikes: out.slice(0, 1500), total: out.length };
}

/* What changed: the newest UKV run here against the one before it, over the hours both still cover
   from now (the first time rain or snow comes, each day's high and low, the rain, the strongest gust).
   The page puts it in words. */
async function changesAt(lat, lon) {
  const list = await cubes2('ukv');
  if (list.length < 2) return null;
  const [cur, prev] = list;
  const [a, b] = await Promise.all([layered([{ c: cur, keep: () => true }], lat, lon), layered([{ c: prev, keep: () => true }], lat, lon)]);
  if (!a?.times?.length || !b?.times?.length) return null;
  const now = Date.now(), end = Math.min(cur.end, prev.end);
  const series = (x) => x.times.map((t, i) => ({ t, t2: x.v.t2?.[i] ?? null, precip: x.v.precip_step?.[i] ?? null, snow: x.v.snow_step?.[i] ?? null, gust: x.v.gust10?.[i] ?? null, span: x.span[i] }))
    .filter((h) => h.t > now && h.t <= end);
  return { cur: { run: cur.man.run, tag: cur.tag }, prev: { run: prev.man.run, tag: prev.tag }, end, now: series(a), before: series(b) };
}

/* JSON, gzipped when the browser takes it (a forecast is ~60 kB, ~12 kB gzipped: on a phone's
   connection most of the wait was the download) */
const gzipAsync = (buf) => new Promise((ok, no) => zlib.gzip(buf, { level: 6 }, (e, r) => (e ? no(e) : ok(r))));
async function sendJson(req, res, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Vary', 'Accept-Encoding');
  if (body.length > 1400 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    try {
      const gz = await gzipAsync(body);
      res.set('Content-Encoding', 'gzip');
      return res.end(gz);
    } catch { /* plain, below */ }
  }
  return res.end(body);
}

/* `lightning`: the lightning archive (server/lightning, index.js), for the strikes near a place */
export function mountLocationWeather(app, { lightning = null } = {}) {
  /* floods, health alerts, air quality, the tide and the normals (location/outside.js, Phase E) */
  mountOutside(app);
  const point = (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { res.status(400).json({ error: 'lat and lon are needed' }); return null; }
    return { lat, lon };
  };
  app.get('/api/location/lightning', (req, res) => {
    const p = point(req, res);
    if (!p) return undefined;
    if (!lightning) return res.status(503).json({ error: 'The lightning archive is not running' });
    res.set('Cache-Control', 'no-cache');
    return sendJson(req, res, strikesNear(lightning, p.lat, p.lon));
  });
  app.get('/api/location/storm', (req, res) => {
    const p = point(req, res);
    if (!p) return undefined;
    let cell = null, env = null;
    try { cell = stormArrival(p.lat, p.lon); } catch { cell = null; }
    try { env = envPeek(p.lat, p.lon); } catch { env = null; }
    res.set('Cache-Control', 'no-cache');
    return sendJson(req, res, { radar: cell, env });
  });
  app.get('/api/location/changes', async (req, res) => {
    const p = point(req, res);
    if (!p) return undefined;
    try {
      const out = await changesAt(p.lat, p.lon);
      res.set('Cache-Control', 'public, max-age=300');
      return sendJson(req, res, out || { none: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  });

  /* inflate each new NOVA run's frames before anyone asks (the first place after a run costs ~1 s) */
  const warm = () => { try { novaThunderAt(52.5, -1.5); } catch { /* no NOVA yet */ } };
  setTimeout(warm, 5e3).unref?.();
  setInterval(warm, 5 * 60e3).unref?.();
  setTimeout(warmLive, 3e3).unref?.();
  setInterval(warmLive, 30e3).unref?.();

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
    /* the hours and days from the v2 cubes, at once with TCM FROST's snow; the v1 cubes while there
       are no v2 ones yet */
    const frostP = frostPoint(lat, lon).catch(() => null);                    // TCM FROST's snow: never costs the page its forecast
    let fc, outlook = null;
    try {
      const pt = await pointAt(lat, lon);
      if (pt?.fc) { fc = pt.fc; outlook = pt.ol; } else fc = forecastAt(lat, lon);
    } catch {
      try { fc = forecastAt(lat, lon); } catch { fc = { error: 'read' }; }
    }
    if (fc.error === 'outside') return res.json({ code: 'OUTSIDE_UK', resolvedName: name });
    if (fc.error) return res.status(503).json({ error: 'The Met Office UKV forecast is being prepared. Try again in a few minutes.' });
    const nc = tryNowcast(lat, lon);                                         // null: the newest scan and the hourly forecast
    const now = nowAt(lat, lon, nc);
    try { fc.anchor = anchorToNow(fc, now); } catch { fc.anchor = null; }
    if (outlook) { try { outlook.anchor = anchorToNow(outlook, now); } catch { outlook.anchor = null; } }
    let nova = null;
    try { nova = novaThunderAt(lat, lon); } catch { nova = null; }           // likewise
    const frost = await frostP;
    res.set('Cache-Control', 'no-cache');
    return sendJson(req, res, { location: { name, lat, lon, country }, forecast: fc, outlook, now, nowcast: nc, nova, frost, observed: observedAt(lat, lon), yesterday: observedAt(lat, lon, londonDay(new Date(Date.now() - 864e5))), generated: new Date().toISOString() });
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

  app.get('/api/location/radar', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    try { res.json(await radarIndex()); } catch { res.json({ past: [], pastTyped: [], future: [] }); }
  });

  /* kind=type: the precipitation type at the same time (2 km ECMWF codes): the analysis's for the
     radar (now_ptype), the UKV's own for its rain (ptype) */
  app.get('/api/location/radar/frame', async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (req.query.scope !== 'uk' && (!Number.isFinite(lat) || !Number.isFinite(lon))) return res.status(400).end();
    const type = req.query.kind === 'type';
    let file;
    if (req.query.src === 'radar' && /^\d{8}T\d{4}$/.test(String(req.query.t))) file = path.join(LIVE, type ? 'now_ptype' : 'radar', `${req.query.t}.bin`);
    else if (req.query.src === 'ukv' && RUN_RE.test(String(req.query.run)) && /^\d{1,3}$/.test(String(req.query.h))) {
      file = path.join(FRAMES, 'ukv', String(req.query.run), type ? 'ptype' : 'precip_rate', `${req.query.h}.bin`);
    } else return res.status(400).end();
    const uk = req.query.scope === 'uk';
    const f = await frameAtAsync(file);
    const body = uk
      ? cropFrame(f, UK_VIEW.lat, UK_VIEW.lon, UK_VIEW.halfKm, Math.max(1, Math.round((UK_VIEW.km * 1000) / (f?.dx || 2000))))
      : cropFrame(f, lat, lon);
    if (!body) return res.status(404).end();
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400, immutable' });
    res.end(body);
  });
}
