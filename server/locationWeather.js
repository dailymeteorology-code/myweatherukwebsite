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
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODELDATA_DIR, POINT_DIR, builtCubes } from './modelData.js';
import { geocode, reverseName } from './functions/getMetOfficeLocationWeather.js';
import { searchPlaces } from './placeSearch.js';
import { novaThunderAt } from './novaPoint.js';

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
    const dec = decoder(head);
    const lut = Float32Array.from({ length: 256 }, (_, q) => (q === 255 ? NaN : dec(q)));
    f = { head, q: raw.subarray(4 + n, 4 + n + head.nx * head.ny), nx: head.nx, ny: head.ny, dx: 2000 * (head.k ?? 1), dec, lut };
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
function nowcastAt(lat, lon) {
  const times = readJson(path.join(LIVE, 'radar', 'index.json'))?.times || [];
  const t0 = times.at(-1);
  if (!t0 || Date.now() - Date.parse(t0) > NC_MAX_AGE * 60e3) return null;
  const f = frameAt(radarFile(t0));
  if (!f) return null;
  const [row, col] = cellOf(lon, lat, f.dx);
  if (row < 0 || col < 0 || row >= f.ny || col >= f.nx || f.q[row * f.nx + col] === 255) return null;
  const mv = motionAt(times, row, col);
  const vr = mv?.vr ?? 0, vc = mv?.vc ?? 0;
  const start = Math.floor(Date.now() / 60e3) * 60e3, scan = Date.parse(t0);
  const rate = [], chance = [];
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
  }
  /* the motion for the page's words: speed and the compass direction it is heading */
  const kmh = mv ? Math.hypot(vr, vc) * 60 * (f.dx / 1000) : null;
  return {
    scan: t0, start: new Date(start).toISOString(), step: 1, rate, chance,
    motion: mv ? { kmh: Math.round(kmh), towards: Math.round(((Math.atan2(vc, -vr) * 180) / Math.PI + 360) % 360) } : null,
  };
}

const tryNowcast = (lat, lon) => { try { return nowcastAt(lat, lon); } catch { return null; } };   // never costs the page its forecast

/* ── now and today so far ──────────────────────────────────────────────────── */
const NOW_VARS = ['t2', 'td2', 'rh2', 'wind10', 'wdir10', 'gust10', 'mslp', 'feels', 'windchill', 'tcc'];
const stampOf = (iso) => iso.replace(/[-:]/g, '').slice(0, 13);              // 2026-10-20T17:15 -> 20261020T1715
function nowAt(lat, lon, nc = tryNowcast(lat, lon)) {
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
    const rt = readJson(path.join(LIVE, 'radar', 'index.json'))?.times?.at(-1);
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
function observedAt(lat, lon) {
  const day = londonDay();
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
/* A square of a frame round a point, optionally coarsened: each `step` x `step` block keeps its
   strongest value (so a small heavy shower survives), and 255 (no data) only where all of it is. */
function crop(file, lat, lon, halfKm = HALF_KM, step = 1) {
  const f = frameAt(file);
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

export function mountLocationWeather(app) {
  /* inflate each new NOVA run's frames before anyone asks (the first place after a run costs ~1 s) */
  const warm = () => { try { novaThunderAt(52.5, -1.5); } catch { /* no NOVA yet */ } };
  setTimeout(warm, 20e3).unref?.();
  setInterval(warm, 5 * 60e3).unref?.();

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
    const nc = tryNowcast(lat, lon);                                         // null: the newest scan and the hourly forecast
    const now = nowAt(lat, lon, nc);
    try { fc.anchor = anchorToNow(fc, now); } catch { fc.anchor = null; }
    let nova = null;
    try { nova = novaThunderAt(lat, lon); } catch { nova = null; }           // never costs the page its forecast
    res.set('Cache-Control', 'no-cache');
    res.json({ location: { name, lat, lon, country }, forecast: fc, now, nowcast: nc, nova, observed: observedAt(lat, lon), generated: new Date().toISOString() });
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
    if (req.query.scope !== 'uk' && (!Number.isFinite(lat) || !Number.isFinite(lon))) return res.status(400).end();
    let file;
    if (req.query.src === 'radar' && /^\d{8}T\d{4}$/.test(String(req.query.t))) file = path.join(LIVE, 'radar', `${req.query.t}.bin`);
    else if (req.query.src === 'ukv' && RUN_RE.test(String(req.query.run)) && /^\d{1,3}$/.test(String(req.query.h))) {
      file = path.join(FRAMES, 'ukv', String(req.query.run), 'precip_rate', `${req.query.h}.bin`);
    } else return res.status(400).end();
    const uk = req.query.scope === 'uk';
    const body = uk
      ? crop(file, UK_VIEW.lat, UK_VIEW.lon, UK_VIEW.halfKm, Math.max(1, Math.round((UK_VIEW.km * 1000) / (frameAt(file)?.dx || 2000))))
      : crop(file, lat, lon);
    if (!body) return res.status(404).end();
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400, immutable' });
    res.end(body);
  });
}
