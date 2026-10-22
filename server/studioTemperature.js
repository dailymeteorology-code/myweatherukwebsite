/* The Graphic Studio's temperature map, at about 250 m.

   The temperature is the site's own: the Met Office UKV 2 km model from AWS, either the
   "right now" analysis (the UKV corrected by the airports' reports, mdata/now.py, every 15
   minutes) or a UKV forecast hour. Nothing comes from Open-Meteo.

   2 km cannot show a valley or a hilltop, so the field is refined with terrain: each output pixel
   takes the 2 km value and adds the local lapse rate times the difference between the real ground
   (Copernicus DEM GLO-90 at ~250 m, tools/studio/build_dem.py) and the smooth ground the model
   sees. The lapse rate is not a textbook constant: it is measured from the 2 km field itself,
   temperature against height within ~16 km, so a cold night's inversion (colder valleys, milder
   slopes) refines the right way round, and flat country, where it cannot be measured, falls back
   to the standard 6.5 °C per km.

   GET /api/studio/temperature/sources   the analysis times, and the UKV hours with their run/step
   GET /api/studio/temperature/field     ?src=now&time=…  or  ?src=ukv&tag=…&step=…
                                         &lonMin&lonMax&latMin&latMax (a Web Mercator box) &w&h
                                         &terrain=1 → gzip: [u32 n][n bytes JSON head][int16 °C×100
                                         per pixel, row 0 = north; -32768 = outside the model] */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { requireAdmin } from './auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MD = process.env.MODELDATA_DIR || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/modeldata' : path.join(HERE, 'data', 'modeldata'));
const STUDIO = process.env.STUDIO_DATA || (fs.existsSync('D:/') ? 'D:/MyWeatherUK-data/studio' : path.join(HERE, 'data', 'studio'));
const GRID = { nx: 1042, ny: 970, dx: 2000, x0: -1158000, yTop: 902000 };     // the 2 km display grid
const STD_LAPSE = -0.0065;                                                    // °C per metre
const TAG_RE = /^\d{8}T\d{4}Z$/;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* ── the grid's Lambert azimuthal equal-area projection (WGS84), as lib/ukRadar ─────────────── */
const D = Math.PI / 180;
const A = 6378137, FL = 1 / 298.257223563, E2 = FL * (2 - FL), E = Math.sqrt(E2);
const qf = (s) => (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
const QP = qf(1), RQ = A * Math.sqrt(QP / 2);
const PHI1 = 54.9 * D, LAM0 = -2.5 * D;
const B1 = Math.asin(qf(Math.sin(PHI1)) / QP);
const DD = (A * Math.cos(PHI1) / Math.sqrt(1 - E2 * Math.sin(PHI1) ** 2)) / (RQ * Math.cos(B1));
const SB1 = Math.sin(B1), CB1 = Math.cos(B1);
function laea(lon, lat) {
  const b = Math.asin(qf(Math.sin(lat * D)) / QP);
  const dl = lon * D - LAM0, sb = Math.sin(b), cb = Math.cos(b), cdl = Math.cos(dl);
  const bb = RQ * Math.sqrt(2 / (1 + SB1 * sb + CB1 * cb * cdl));
  return [bb * DD * cb * Math.sin(dl), (bb / DD) * (CB1 * sb - SB1 * cb * cdl)];
}
const E4 = E2 * E2, E6 = E4 * E2;
function laeaInverse(x, y) {
  const rho = Math.hypot(x / DD, DD * y);
  if (rho < 1e-9) return [LAM0 / D, PHI1 / D];
  const ce = 2 * Math.asin(rho / (2 * RQ));
  const b = Math.asin(Math.cos(ce) * SB1 + (DD * y * Math.sin(ce) * CB1) / rho);
  const lam = LAM0 + Math.atan2(x * Math.sin(ce), DD * rho * CB1 * Math.cos(ce) - DD * DD * y * SB1 * Math.sin(ce));
  const phi = b + (E2 / 3 + (31 * E4) / 180 + (517 * E6) / 5040) * Math.sin(2 * b)
    + ((23 * E4) / 360 + (251 * E6) / 3780) * Math.sin(4 * b) + ((761 * E6) / 45360) * Math.sin(6 * b);
  return [lam / D, phi / D];
}

/* ── the ground ─────────────────────────────────────────────────────────────────────────────── */
let DEM = null;
const i16 = (f) => { const b = fs.readFileSync(f); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
function dem() {
  if (DEM) return DEM;
  const meta = readJson(path.join(STUDIO, 'dem-250m.json'));
  if (!meta) return null;
  const fine = i16(path.join(STUDIO, 'dem-250m.i16')), smooth = i16(path.join(STUDIO, 'dem-250m-ukv.i16'));
  const at = (arr, lon, lat) => {
    const fy = (meta.lat0 - lat) / meta.dlat, fx = (lon - meta.lon0) / meta.dlon;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= meta.nx - 1 || j >= meta.ny - 1) return 0;
    const tx = fx - i, ty = fy - j, k = j * meta.nx + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - ty) + (arr[k + meta.nx] * (1 - tx) + arr[k + meta.nx + 1] * tx) * ty;
  };
  /* the smooth ground at each 2 km cell, for measuring the lapse rate */
  const zd = new Float32Array(GRID.nx * GRID.ny);
  for (let j = 0; j < GRID.ny; j++) {
    for (let i = 0; i < GRID.nx; i++) {
      const [lon, lat] = laeaInverse(GRID.x0 + i * GRID.dx, GRID.yTop - j * GRID.dx);
      zd[j * GRID.nx + i] = at(smooth, lon, lat);
    }
  }
  DEM = { meta, fine, smooth, at, zd };
  return DEM;
}

/* ── a temperature frame and its lapse rates ────────────────────────────────────────────────── */
const FRAMES = new Map();
function frame(file) {
  if (FRAMES.has(file)) return FRAMES.get(file);
  if (!fs.existsSync(file)) return null;
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const n = buf.readUInt32LE(0);
  const head = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
  const q = buf.subarray(4 + n, 4 + n + GRID.nx * GRID.ny);
  const lo = head.lo, hi = head.hi, sq = head.scale === 'sqrt';
  const a = sq ? Math.sqrt(Math.max(lo, 0)) : lo, b = sq ? Math.sqrt(hi) : hi;
  const t = new Float32Array(q.length);
  for (let k = 0; k < q.length; k++) { const v = q[k]; t[k] = v === 255 ? NaN : (sq ? (a + (v / 254) * (b - a)) ** 2 : a + (v / 254) * (b - a)); }
  const f = { head, t, lapse: null };
  FRAMES.set(file, f);
  while (FRAMES.size > 6) FRAMES.delete(FRAMES.keys().next().value);
  return f;
}

/* temperature against height, by least squares, within R cells of each land cell; where the
   ground hardly varies the slope means nothing, so it leans on the standard rate */
function lapseOf(f, zd) {
  if (f.lapse) return f.lapse;
  const { nx, ny } = GRID, R = 8, W = nx + 1;
  const S = [0, 1, 2, 3, 4].map(() => new Float64Array(W * (ny + 1)));    // n, Σz, Σt, Σzz, Σzt (integral images)
  for (let j = 0; j < ny; j++) {
    let r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, z = zd[k], t = f.t[k];
      if (z > 2 && t === t) { r0 += 1; r1 += z; r2 += t; r3 += z * z; r4 += z * t; }
      const o = (j + 1) * W + i + 1, u = j * W + i + 1;
      S[0][o] = S[0][u] + r0; S[1][o] = S[1][u] + r1; S[2][o] = S[2][u] + r2; S[3][o] = S[3][u] + r3; S[4][o] = S[4][u] + r4;
    }
  }
  const box = (s, i0, j0, i1, j1) => s[j1 * W + i1] - s[j0 * W + i1] - s[j1 * W + i0] + s[j0 * W + i0];
  const out = new Float32Array(nx * ny).fill(STD_LAPSE);
  for (let j = 0; j < ny; j++) {
    const j0 = Math.max(0, j - R), j1 = Math.min(ny, j + R + 1);
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - R), i1 = Math.min(nx, i + R + 1);
      const n = box(S[0], i0, j0, i1, j1);
      if (n < 12) continue;
      const sz = box(S[1], i0, j0, i1, j1), st = box(S[2], i0, j0, i1, j1), szz = box(S[3], i0, j0, i1, j1), szt = box(S[4], i0, j0, i1, j1);
      const varz = szz / n - (sz / n) ** 2;
      if (!(varz > 1)) continue;
      const slope = Math.max(-0.012, Math.min(0.01, (szt / n - (sz / n) * (st / n)) / varz));
      const w = varz / (varz + 60 * 60);                     // ~60 m of relief to trust it
      out[j * nx + i] = w * slope + (1 - w) * STD_LAPSE;
    }
  }
  f.lapse = out;
  return out;
}

/* ── the field for a box ────────────────────────────────────────────────────────────────────── */
function render(f, box, W, H, terrain) {
  const G = terrain ? dem() : null;
  const lapse = G ? lapseOf(f, G.zd) : null;
  const out = new Int16Array(W * H);
  const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
  const yt = my(box.latMax), yb = my(box.latMin);
  const lons = new Float64Array(W);
  for (let px = 0; px < W; px++) lons[px] = box.lonMin + ((px + 0.5) / W) * (box.lonMax - box.lonMin);
  const { nx, ny } = GRID;
  for (let py = 0; py < H; py++) {
    const lat = Math.atan(Math.sinh(yt - ((py + 0.5) / H) * (yt - yb))) / D;
    for (let px = 0; px < W; px++) {
      const lon = lons[px];
      const [x, y] = laea(lon, lat);
      const fx = (x - GRID.x0) / GRID.dx, fy = (GRID.yTop - y) / GRID.dx;
      const i = Math.floor(fx), j = Math.floor(fy);
      const o = py * W + px;
      if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) { out[o] = -32768; continue; }
      const tx = fx - i, ty = fy - j, k = j * nx + i;
      const a = f.t[k], b = f.t[k + 1], c = f.t[k + nx], d = f.t[k + nx + 1];
      let t;
      if (a === a && b === b && c === c && d === d) t = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      else { const near = f.t[Math.round(fy) * nx + Math.round(fx)]; t = near; }
      if (!(t === t)) { out[o] = -32768; continue; }
      if (G) {
        const zf = G.at(G.fine, lon, lat);
        if (zf !== 0) {
          const zs = G.at(G.smooth, lon, lat);
          const g = (lapse[k] * (1 - tx) + lapse[k + 1] * tx) * (1 - ty) + (lapse[k + nx] * (1 - tx) + lapse[k + nx + 1] * tx) * ty;
          t += g * (zf - zs);
        }
      }
      out[o] = Math.round(t * 100);
    }
  }
  return out;
}

export function mountStudioTemperature(app) {
  /* a studio tool, and each field is real work: admins only */
  app.use('/api/studio/temperature', requireAdmin);
  app.get('/api/studio/temperature/sources', (req, res) => {
    const live = readJson(path.join(MD, 'live', 'catalog.json'));
    const now = (live?.products?.now_t2?.times || []).slice(-48).reverse();
    /* every UKV hour from now on, from the newest run that has it (T+54 hourly, T+120 3-hourly) */
    const cat = readJson(path.join(MD, 'catalog.json'));
    const ukv = (cat?.models || []).find((m) => m.id === 'ukv');
    const hours = new Map();
    const since = Date.now() - 3 * 3600e3;
    for (const r of [...(ukv?.runs || [])].sort((a, b) => Date.parse(b.run) - Date.parse(a.run))) {
      const t0 = Date.parse(r.run);
      if (!(ukv?.variables || []).includes('t2')) break;
      for (const s of r.steps) {
        const v = t0 + s * 3600e3;
        if (v < since || hours.has(v)) continue;
        hours.set(v, { valid: new Date(v).toISOString(), tag: r.run.replace(/[-:]/g, '').slice(0, 13) + 'Z', step: s, run: r.run });
      }
    }
    res.set('Cache-Control', 'no-cache');
    res.json({ now, ukv: [...hours.values()].sort((a, b) => Date.parse(a.valid) - Date.parse(b.valid)), terrain: !!readJson(path.join(STUDIO, 'dem-250m.json')) });
  });

  app.get('/api/studio/temperature/field', (req, res) => {
    const q = req.query;
    const box = { lonMin: +q.lonMin, lonMax: +q.lonMax, latMin: +q.latMin, latMax: +q.latMax };
    const W = Math.round(+q.w), H = Math.round(+q.h);
    if (![box.lonMin, box.lonMax, box.latMin, box.latMax].every(Number.isFinite) || box.lonMax <= box.lonMin || box.latMax <= box.latMin
      || box.latMin < -80 || box.latMax > 80 || !(W >= 16 && H >= 16 && W <= 3000 && H <= 3000 && W * H <= 6e6)) return res.status(400).json({ error: 'bad box or size' });
    let file, head;
    if (q.src === 'ukv') {
      if (!TAG_RE.test(q.tag || '') || !/^\d{1,3}$/.test(q.step || '')) return res.status(400).json({ error: 'bad run' });
      file = path.join(MD, 'frames', 'ukv', q.tag, 't2', `${Number(q.step)}.bin`);
    } else {
      const live = readJson(path.join(MD, 'live', 'catalog.json'));
      const times = live?.products?.now_t2?.times || [];
      const t = q.time && times.includes(q.time) ? q.time : times[times.length - 1];
      if (!t) return res.status(503).json({ error: 'the analysis is starting' });
      file = path.join(MD, 'live', 'now_t2', `${t.replace(/[-:]/g, '').slice(0, 13)}.bin`);
    }
    try {
      const f = frame(file);
      if (!f) return res.status(409).json({ error: 'that field is not built yet' });
      head = f.head;
      const terrain = q.terrain !== '0' && !!dem();
      const data = render(f, box, W, H, terrain);
      const h = Buffer.from(JSON.stringify({ valid: head.valid, run: head.run || null, step: head.step ?? null, src: q.src === 'ukv' ? 'ukv' : 'now', stations: head.stations || null, terrain, w: W, h: H }), 'utf8');
      const len = Buffer.alloc(4); len.writeUInt32LE(h.length, 0);
      const body = zlib.gzipSync(Buffer.concat([len, h, Buffer.from(data.buffer)]), { level: 3 });
      res.set({ 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (e) {
      console.error('[studio temperature]', e.message);
      res.status(500).json({ error: 'the field could not be made' });
    }
  });
}
