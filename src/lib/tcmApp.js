/* The TCM tab's data (17 Nov 2026, the app redesign: "the map should be the centre of the whole thing ... make the
   load time of the data as fast as possible"). Two models, each in one small download:

     TCM V3     the newest published run as one 0.5° grid of scores (RiskGridCache "tcm_uk_latest", ~380 KB),
                three days of thunderstorm, hail, tornado and lightning risk. The old page fetched every run ever
                kept (about 15 MB, twice, and again every minute) before it drew a thing.
     TCM NOVA   the newest Main Run's manifest (~290 KB) and then one field at a time (~200 KB, deflated float16)
                on the British National Grid at 2 km: a whole day's summary, or a 3-hourly frame.

   Each is drawn once into a picture over the map: per pixel, the field at that place (bilinear), banded into the
   outlook's levels with a darker edge where a level meets a lower one, the way a forecaster's outlook looks. */
import { base44 } from '@/api/base44Client';

/* ── the outlook levels both models share ─────────────────────────────────────────────────────── */
export const LEVELS = [
  { code: 'TSTM', name: 'General thunderstorms', rgb: [125, 211, 252] },
  { code: 'MRGL', name: 'Marginal', rgb: [74, 222, 128] },
  { code: 'SLGT', name: 'Slight', rgb: [250, 204, 21] },
  { code: 'ENH', name: 'Enhanced', rgb: [251, 146, 60] },
  { code: 'MDT', name: 'Moderate', rgb: [239, 68, 68] },
  { code: 'HIGH', name: 'High', rgb: [192, 38, 211] },
];
/* V3's scores (0-100) and NOVA's probabilities (0-1) where each level starts */
export const V3_STARTS = [5, 12, 22, 35, 50, 65];
export const NOVA_STARTS = [0.02, 0.05, 0.15, 0.3, 0.45, 0.6];
export const levelOf = (v, starts) => { let q = -1; for (let i = 0; i < starts.length; i++) if (v >= starts[i]) q = i; return q; };

/* ── map pictures: a box in Web Mercator ──────────────────────────────────────────────────────── */
const D = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
const latOfMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D;
/** The picture's pixels as lat/lon (row by row from the north), for a box [[latS, lonW], [latN, lonE]] W wide. */
function pixelsOf(box, W) {
  const [[latS, lonW], [latN, lonE]] = box;
  const yt = mercY(latN), yb = mercY(latS);
  const H = Math.round((W * (yt - yb)) / ((lonE - lonW) * D));
  return { W, H, lat: (py) => latOfMercY(yt - ((py + 0.5) / H) * (yt - yb)), lon: (px) => lonW + ((px + 0.5) / W) * (lonE - lonW) };
}

/* The outlook: paint levels (Int8 per pixel, -1 none) as flat colours with a dark stroke two pixels wide where a
   level meets a lower one, as a forecaster draws it. `fade` (0-1 per pixel) softens the field out towards the edge
   of the model's area, so it has no hard box. */
export const STYLES = [
  { id: 'outlook', name: 'Outlook', note: 'Risk levels with their outlines' },
  { id: 'hires', name: 'High resolution', note: 'Every grid cell, a smooth scale' },
];
function paintLevels(lv, W, H, alpha = 150, fade = null) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const lower = (k, q) => lv[k] < q;
  for (let k = 0; k < lv.length; k++) {
    const q = lv[k];
    if (q < 0) continue;
    const i = k % W;
    let edge = false;
    for (let d = 1; d <= 2 && !edge; d++) {
      edge = (i >= d && lower(k - d, q)) || (i < W - d && lower(k + d, q)) || (k >= W * d && lower(k - W * d, q)) || (k + W * d < lv.length && lower(k + W * d, q));
    }
    const c = LEVELS[Math.min(q, LEVELS.length - 1)].rgb, f = edge ? 0.55 : 1;
    px[k * 4] = c[0] * f; px[k * 4 + 1] = c[1] * f; px[k * 4 + 2] = c[2] * f; px[k * 4 + 3] = (edge ? 240 : alpha) * (fade ? fade[k] : 1);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
/* High resolution: the value itself on a smooth scale (from the NOVA page's own: sky blue through green, yellow,
   orange and red to purple, more opaque as it rises), the levels' starts at the same places */
const RAMP = [[0, [56, 189, 248, 0]], [1, [56, 189, 248, 100]], [2, [74, 222, 128, 140]], [3, [250, 204, 21, 160]],
  [4, [249, 115, 22, 175]], [5, [239, 68, 68, 185]], [6, [192, 38, 211, 195]]];
function rampAt(t) {                                       // t: 0 at the first level's start, 1 per level after
  if (!(t > 0)) return null;
  if (t >= 6) return RAMP[6][1];
  const k = Math.floor(t), u = t - k, a = RAMP[k][1], b = RAMP[k + 1][1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
}
/* a value as a position on the ramp: 0 below the first level, k + fraction between level k and k + 1 */
function rampPos(v, starts) {
  if (!(v >= starts[0] * 0.5)) return 0;
  if (v < starts[0]) return (v / starts[0] - 0.5) * 2 * 0.999;          // fading in below the first level
  for (let k = 0; k < starts.length - 1; k++) if (v < starts[k + 1]) return 1 + k + (v - starts[k]) / (starts[k + 1] - starts[k]);
  return 6;
}
function paintRamp(vals, starts, W, H, fade = null) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const px = img.data;
  for (let k = 0; k < vals.length; k++) {
    const c = rampAt(rampPos(vals[k], starts));
    if (!c) continue;
    px[k * 4] = c[0]; px[k * 4 + 1] = c[1]; px[k * 4 + 2] = c[2]; px[k * 4 + 3] = c[3] * (fade ? fade[k] : 1);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
const toUrl = (cv) => new Promise((ok) => cv.toBlob((b) => ok(b ? URL.createObjectURL(b) : cv.toDataURL()), 'image/png'));

/* ── TCM V3 ───────────────────────────────────────────────────────────────────────────────────── */
export const V3_HAZARDS = [
  { id: 'thunderstorm', name: 'Thunderstorms' },
  { id: 'lightning', name: 'Lightning' },
  { id: 'hail', name: 'Hail' },
  { id: 'tornado', name: 'Tornado' },
];

/** The newest V3 run: { run, builtAt, runStartMs, days, grid, box, at(lat, lon, day, hazard) } */
export async function loadV3() {
  const rows = await base44.entities.RiskGridCache.filter({ cache_key: 'tcm_uk_latest' }, '-generated_at', 1);
  const g = rows?.[0]?.grid_data;
  if (!g?.grid?.length) throw new Error('No TCM V3 run has been published yet');
  const step = g.gridStep || 0.5;
  const lats = g.grid.map((p) => p.lat), lons = g.grid.map((p) => p.lon);
  const lat0 = Math.min(...lats), lon0 = Math.min(...lons);
  const ny = Math.round((Math.max(...lats) - lat0) / step) + 1, nx = Math.round((Math.max(...lons) - lon0) / step) + 1;
  const index = new Map(g.grid.map((p) => [Math.round((p.lat - lat0) / step) * nx + Math.round((p.lon - lon0) / step), p]));
  const nDays = Math.max(1, g.daysAvailable || g.grid[0]?.perDay?.length || 1);
  const runStartMs = g.runStartMs || Date.parse(g.run) || Date.now();
  /* each day's field for a hazard, a Float32Array on the regular grid (no point: 0) */
  const fields = new Map();
  const field = (day, hazard) => {
    const key = `${day}|${hazard}`;
    if (fields.has(key)) return fields.get(key);
    const out = new Float32Array(nx * ny);
    for (const [k, p] of index) out[k] = Number(p.perDay?.[day]?.scores?.[hazard]) || 0;
    fields.set(key, out);
    return out;
  };
  const sample = (arr, lat, lon) => {
    const fx = (lon - lon0) / step, fy = (lat - lat0) / step;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= nx - 1 || iy >= ny - 1) return 0;
    const tx = fx - ix, ty = fy - iy, i0 = iy * nx + ix;
    return (arr[i0] * (1 - tx) + arr[i0 + 1] * tx) * (1 - ty) + (arr[i0 + nx] * (1 - tx) + arr[i0 + nx + 1] * tx) * ty;
  };
  const box = [[lat0, lon0], [lat0 + (ny - 1) * step, lon0 + (nx - 1) * step]];
  const days = Array.from({ length: nDays }, (_, d) => {
    const t = new Date(runStartMs); t.setUTCHours(0, 0, 0, 0); t.setUTCDate(t.getUTCDate() + d);
    return { i: d, date: t.toISOString().slice(0, 10), ms: t.getTime() };
  });
  return {
    run: g.run, builtAt: g.builtAt, runStartMs, days, box, summary: g.summary || [],
    at: (lat, lon, day, hazard) => sample(field(day, hazard), lat, lon),
    /** the day's picture for a hazard, in a style: { url, box, max: { v, lat, lon } } */
    async picture(day, hazard, style = 'outlook', W = 640) {
      const arr = field(day, hazard), P = pixelsOf(box, W);
      const n = P.W * P.H, fade = new Float32Array(n), vals = new Float32Array(n);
      let max = { v: -1, lat: 0, lon: 0 };
      for (let py = 0; py < P.H; py++) {
        const lat = P.lat(py), fy = (lat - lat0) / step;
        for (let px = 0; px < P.W; px++) {
          const lon = P.lon(px), fx = (lon - lon0) / step, k = py * P.W + px;
          const v = sample(arr, lat, lon);
          vals[k] = v;
          fade[k] = Math.max(0, Math.min(1, Math.min(fx, fy, nx - 1 - fx, ny - 1 - fy) / 1.2));
          if (v > max.v && fade[k] > 0.5) max = { v, lat, lon };
        }
      }
      let cv;
      if (style === 'hires') cv = paintRamp(vals, V3_STARTS, P.W, P.H, fade);
      else { const lv = new Int8Array(n); for (let k = 0; k < n; k++) lv[k] = levelOf(vals[k], V3_STARTS); cv = paintLevels(lv, P.W, P.H, 150, fade); }
      return { url: await toUrl(cv), box, max };
    },
  };
}

/* ── TCM NOVA ─────────────────────────────────────────────────────────────────────────────────── */
export const NOVA_HAZARDS = [
  { id: 'p_thunder', name: 'Thunderstorms' },
  { id: 'p_lightning', name: 'Lightning' },
  { id: 'p_hail', name: 'Hail (2 cm+)' },
  { id: 'p_wind_damaging', name: 'Damaging gusts' },
  { id: 'p_heavy_rain', name: 'Heavy rain' },
  { id: 'p_supercell', name: 'Supercells' },
  { id: 'p_tornado_env', name: 'Tornado set-up' },
  { id: 'p_severe', name: 'Any severe' },
];
const authHeaders = () => { try { const t = localStorage.getItem('base44_access_token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; } };
const novaGet = (url) => fetch(url, { headers: authHeaders() });

/** The newest NOVA run of a product ('main' or 'hyper'): its manifest. Throws { locked } when only admins may see it. */
export async function loadNova(product = 'main') {
  const r = await novaGet(`/api/nova/${product}/latest`);
  if (r.status === 401 || r.status === 403) { const e = new Error('TCM NOVA is not open yet'); e.locked = true; throw e; }
  if (!r.ok) throw new Error(`No ${product === 'hyper' ? 'Hyper-Short' : 'Main'} run yet`);
  return r.json();
}

function f16(u) {
  const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
/** One field of a run (a frame at `lead` minutes, or a whole day's summary): Float32Array, row 0 = south. */
export async function novaField(product, runId, field, { lead = null, day = null } = {}) {
  const r = await novaGet(day ? `/api/nova/${product}/runs/${runId}/day/${day}/${field}` : `/api/nova/${product}/runs/${runId}/frame/${lead}/${field}`);
  if (!r.ok) throw new Error(`${field}: ${r.status}`);
  const dtype = r.headers.get('X-Nova-Dtype');
  const buf = await new Response(r.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  if (dtype === 'int8') return Float32Array.from(new Int8Array(buf));
  const u = new Uint16Array(buf), out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = f16(u[i]);
  return out;
}

/* WGS84 lat/lon -> British National Grid (transverse Mercator on Airy 1830, no datum shift: ~100 m off, far below
   the 2 km cells) */
export function toBNG(lat, lon) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717, lat0 = 49 * D, lon0 = -2 * D;
  const N0 = -100000, E0 = 400000, e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
  const p = lat * D, l = lon * D;
  const sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sp * sp), rho = (a * F0 * (1 - e2)) / (1 - e2 * sp * sp) ** 1.5, eta2 = nu / rho - 1;
  const dp = p - lat0, sp2 = p + lat0;
  const M = b * F0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dp - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dp) * Math.cos(sp2)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp2) - (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp2));
  const I = M + N0, II = (nu / 2) * sp * cp, III = (nu / 24) * sp * cp ** 3 * (5 - tp * tp + 9 * eta2), IIIA = (nu / 720) * sp * cp ** 5 * (61 - 58 * tp * tp + tp ** 4);
  const IV = nu * cp, V = (nu / 6) * cp ** 3 * (nu / rho - tp * tp), VI = (nu / 120) * cp ** 5 * (5 - 18 * tp * tp + tp ** 4 + 14 * eta2 - 58 * tp * tp * eta2);
  const dl = l - lon0;
  return [E0 + IV * dl + V * dl ** 3 + VI * dl ** 5, I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6];
}

export const NOVA_BOX = [[49.5, -11.6], [61.2, 2.4]];
/* each picture pixel's place on the grid, worked out once per grid */
const gridPixels = new Map();
function novaPixels(grid, W) {
  const key = `${grid.x0}|${grid.y0}|${grid.dx_m}|${W}`;
  if (gridPixels.has(key)) return gridPixels.get(key);
  const P = pixelsOf(NOVA_BOX, W);
  const fx = new Float32Array(P.W * P.H), fy = new Float32Array(P.W * P.H);
  for (let py = 0; py < P.H; py++) {
    const lat = P.lat(py);
    for (let px = 0; px < P.W; px++) {
      const [x, y] = toBNG(lat, P.lon(px));
      fx[py * P.W + px] = (x - grid.x0) / grid.dx_m - 0.5; fy[py * P.W + px] = (y - grid.y0) / grid.dx_m - 0.5;
    }
  }
  const out = { P, fx, fy };
  gridPixels.set(key, out);
  return out;
}
/** A NOVA field at a place (bilinear; NaN where it has no data). */
export function novaAt(data, grid, lat, lon) {
  const [x, y] = toBNG(lat, lon);
  const fx = (x - grid.x0) / grid.dx_m - 0.5, fy = (y - grid.y0) / grid.dx_m - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix >= grid.nx - 1 || iy >= grid.ny - 1) return NaN;
  const tx = fx - ix, ty = fy - iy, i0 = iy * grid.nx + ix, i1 = i0 + grid.nx;
  const a = data[i0], b = data[i0 + 1], c = data[i1], d = data[i1 + 1];
  if (!Number.isFinite(a + b + c + d)) return data[Math.round(fy) * grid.nx + Math.round(fx)];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
/* a box blur of radius r cells, NaN kept out of it (one pass across, one down) */
function smooth(data, nx, ny, r) {
  const tmp = new Float32Array(data.length), out = new Float32Array(data.length);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) { const xx = x + d; if (xx < 0 || xx >= nx) continue; const v = data[y * nx + xx]; if (Number.isFinite(v)) { s += v; n++; } }
      tmp[y * nx + x] = n ? s / n : NaN;
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy < 0 || yy >= ny) continue; const v = tmp[yy * nx + x]; if (Number.isFinite(v)) { s += v; n++; } }
      out[y * nx + x] = n ? s / n : NaN;
    }
  }
  return out;
}
/** A NOVA probability field in a style: the outlook's levels lightly smoothed (the 2 km cells' speckle is not a
    forecast), or high resolution, every cell on a smooth scale. { url, box, max: { v, lat, lon } } */
export async function novaPicture(raw, grid, style = 'outlook', W = 760) {
  const hires = style === 'hires';
  const data = hires ? raw : smooth(raw, grid.nx, grid.ny, 2);
  const { P, fx, fy } = novaPixels(grid, hires ? 1000 : W);
  const lv = new Int8Array(P.W * P.H).fill(-1), fade = new Float32Array(P.W * P.H), vals = new Float32Array(P.W * P.H).fill(NaN);
  let max = { v: -1, lat: 0, lon: 0 };
  for (let k = 0; k < lv.length; k++) {
    fade[k] = Math.max(0, Math.min(1, Math.min(fx[k], fy[k], grid.nx - 1 - fx[k], grid.ny - 1 - fy[k]) / 4));
    const ix = Math.floor(fx[k]), iy = Math.floor(fy[k]);
    if (ix < 0 || iy < 0 || ix >= grid.nx - 1 || iy >= grid.ny - 1) continue;
    const tx = fx[k] - ix, ty = fy[k] - iy, i0 = iy * grid.nx + ix, i1 = i0 + grid.nx;
    const a = data[i0], b = data[i0 + 1], c = data[i1], d = data[i1 + 1];
    const v = Number.isFinite(a + b + c + d) ? (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty : data[Math.round(fy[k]) * grid.nx + Math.round(fx[k])];
    if (!Number.isFinite(v)) continue;
    vals[k] = v;
    lv[k] = levelOf(v, NOVA_STARTS);
    if (v > max.v && fade[k] > 0.5) max = { v, k };
  }
  if (max.k != null) { const py = Math.floor(max.k / P.W), px = max.k % P.W; max = { v: max.v, lat: P.lat(py), lon: P.lon(px) }; }
  const cv = hires ? paintRamp(vals, NOVA_STARTS, P.W, P.H, fade) : paintLevels(lv, P.W, P.H, 150, fade);
  return { url: await toUrl(cv), box: NOVA_BOX, max };
}
