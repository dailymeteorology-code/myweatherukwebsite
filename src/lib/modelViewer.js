/* Model Data viewer engine: frames, colour scales, contours, the drawn scene and exports.

   Every model arrives on ONE display grid: the Met Office UKV grid (Lambert equal-area,
   1042 x 970 cells of exactly 2 km). UKV is drawn cell for cell; coarser models arrive as
   blocks of their own cells (nearest neighbour on the server), so nothing looks finer than
   the model really is. "Native grid" draws each cell as a hard-edged square; "Smooth"
   only blends neighbouring pixels on screen. */
import { contours as d3contours } from 'd3-contour';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export const API = '/api/modeldata';
/* bump when frames are re-made differently (v2: coarse models smooth, not blocks) */
export const FRAME_V = 2;
export const NX = 1042;
export const NY = 970;

export const REGIONS = {
  uk: { label: 'UK & Ireland', box: [273, 98, 756, 741] },
  england: { label: 'England & Wales', box: [457, 392, 738, 730] },
  scotland: { label: 'Scotland', box: [402, 112, 641, 468] },
  ireland: { label: 'Ireland', box: [294, 403, 491, 650] },
  south: { label: 'Southern England', box: [457, 575, 738, 730] },
  north: { label: 'Northern England', box: [536, 394, 673, 557] },
  wales: { label: 'Wales', box: [478, 527, 580, 652] },
  europe: { label: 'North-west Europe', box: [212, 86, 1024, 946] },
};

/* ── colour scales (our own) ──────────────────────────────────────────────── */
const RAIN = [[0.1, '#a9d8f7', 150], [0.5, '#5aa7e8', 200], [1, '#2f6fd4', 215], [2, '#1d9f8e', 225], [4, '#6cc04a', 230],
  [8, '#efd23a', 235], [16, '#f08b2c', 240], [32, '#dc3a3a', 245], [64, '#a52284', 250], [100, '#f2e6ff', 255]];
const TOTAL = [[1, '#a9d8f7', 140], [2, '#5aa7e8', 190], [5, '#2f6fd4', 210], [10, '#1d9f8e', 220], [15, '#6cc04a', 228],
  [20, '#efd23a', 235], [30, '#f08b2c', 240], [50, '#dc3a3a', 245], [75, '#a52284', 250], [100, '#5b2a86', 250], [200, '#f2e6ff', 255]];
const TEMP = [[-25, '#2b1450'], [-15, '#3b2a8f'], [-8, '#3d5fd0'], [-3, '#3d93d8'], [0, '#7fd0e6'], [3, '#9fdfc6'],
  [6, '#b9e59a'], [10, '#e4e581'], [14, '#f4c45e'], [18, '#f19a48'], [22, '#e6683a'], [26, '#d03b34'], [30, '#a3163c'],
  [35, '#6b0b33'], [42, '#f5d0e6']].map(([v, c]) => [v, c, 205]);
const WIND = [[5, '#1f4e79', 0], [10, '#2a8c99', 150], [20, '#3fb07a', 185], [30, '#a6cf3e', 200], [40, '#f2cf3a', 215],
  [50, '#f29233', 225], [60, '#e2523a', 235], [70, '#c2245a', 240], [85, '#8b2fb8', 245], [100, '#e9d7ff', 250]];
const CLOUD = [[5, '#ffffff', 0], [25, '#e9eef5', 70], [50, '#f4f7fb', 130], [75, '#fbfcfe', 185], [100, '#ffffff', 225]];
const CAPE = [[50, '#fff3b0', 0], [100, '#fff3b0', 140], [300, '#ffd166', 185], [600, '#f4a261', 205], [1000, '#e76f51', 220],
  [1500, '#d62828', 232], [2500, '#9d0208', 242], [4000, '#6a1b9a', 250]];
const PCT_DRY = [[0, '#8c5a2b', 200], [30, '#c99b54', 190], [60, '#9fce8a', 170], [80, '#4fa3c7', 190], [100, '#2a5fa8', 210]];
const SNOW = [[0.1, '#dfe9f5', 120], [1, '#c3d3f2', 180], [3, '#9fb0ea', 210], [6, '#8a7fe0', 225], [12, '#a35ad2', 235],
  [25, '#e05cb4', 245], [50, '#ffffff', 255]];
const HEIGHT = [[0, '#5b2a86', 210], [300, '#3d5fd0', 200], [600, '#3d93d8', 190], [1000, '#6cc04a', 185],
  [1500, '#efd23a', 190], [2200, '#f08b2c', 200], [3000, '#dc3a3a', 210], [4000, '#f2e6ff', 220]];
const VIS = [[0.2, '#ffffff', 235], [1, '#e3e6ea', 200], [3, '#b8bec6', 150], [6, '#8a929c', 90], [10, '#6b737c', 0]];
const RAD = [[0, '#0b1a2b', 0], [50, '#2a3a5c', 140], [200, '#7a4d8c', 180], [400, '#d9643a', 205], [700, '#f2c43a', 225], [1000, '#fff6c2', 240]];
const JET = [[60, '#5aa7e8', 0], [80, '#5aa7e8', 150], [100, '#2f6fd4', 190], [120, '#1d9f8e', 210], [140, '#efd23a', 225],
  [160, '#f08b2c', 235], [180, '#dc3a3a', 245], [210, '#a52284', 250], [250, '#f2e6ff', 255]];
const DIVERGE = (lo, hi) => [[lo, '#2b4fb3', 210], [lo / 2, '#5aa7e8', 170], [0, '#e8edf2', 40], [hi / 2, '#f08b2c', 190], [hi, '#c2245a', 220]];

const SCALES = {
  precip_rate: { stops: RAIN, floor: 0.1, discrete: true, ticks: [0.1, 0.5, 1, 2, 4, 8, 16, 32, 64] },
  rain_rate: { stops: RAIN, floor: 0.1, discrete: true, ticks: [0.1, 0.5, 1, 2, 4, 8, 16, 32, 64] },
  conv_rain: { stops: RAIN, floor: 0.1, discrete: true, ticks: [0.1, 0.5, 1, 2, 4, 8, 16, 32, 64] },
  precip_1h: { stops: RAIN, floor: 0.1, discrete: true, ticks: [0.1, 0.5, 1, 2, 4, 8, 16, 32, 64] },
  precip_total: { stops: TOTAL, floor: 1, discrete: true, ticks: [1, 2, 5, 10, 15, 20, 30, 50, 75, 100], contours: [5, 10, 20, 30, 50, 100], label: true },
  hail_rate: { stops: RAIN, floor: 0.05, discrete: true, ticks: [0.1, 0.5, 1, 2, 4, 8, 16] },
  refc: { stops: [[5, '#7fd3f5', 150], [15, '#3d8fe0', 200], [20, '#21a67a', 215], [30, '#9fcf3a', 225], [35, '#efd23a', 230],
    [40, '#f08b2c', 238], [50, '#dc3a3a', 245], [60, '#a52284', 250], [70, '#f2e6ff', 255]], floor: 5, discrete: true, ticks: [5, 15, 20, 30, 35, 40, 50, 60, 70] },
  snow_rate: { stops: SNOW, floor: 0.1, discrete: true, ticks: [0.1, 1, 3, 6, 12, 25] },
  snow_1h: { stops: SNOW, floor: 0.1, discrete: true, ticks: [0.1, 1, 3, 6, 12, 25] },
  snow_total: { stops: SNOW, floor: 0.1, discrete: true, ticks: [0.1, 1, 3, 6, 12, 25, 50] },
  snow_swe: { stops: SNOW, floor: 0.5, discrete: true, ticks: [1, 3, 6, 12, 25, 50] },
  snow_depth: { stops: SNOW, floor: 0.5, discrete: true, ticks: [1, 3, 6, 12, 25, 50] },
  t2: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22, 26, 30], zero: true },
  t2max: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22, 26, 30], zero: true },
  t2min: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22, 26, 30], zero: true },
  td2: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22] },
  tskin: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22, 26, 30], zero: true },
  feels: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22, 26, 30], zero: true },
  t850: { stops: TEMP.map(([v, c, a]) => [v * 0.8 - 4, c, a]), ticks: [-20, -12, -6, -2, 0, 4, 8, 12, 16], zero: true },
  t500: { stops: TEMP.map(([v, c, a]) => [v * 1.1 - 32, c, a]), ticks: [-50, -42, -36, -30, -26, -20, -14] },
  wbpt850: { stops: TEMP.map(([v, c, a]) => [v * 0.7 + 2, c, a]), ticks: [-6, -2, 0, 2, 6, 10, 14, 18, 22] },
  rh2: { stops: PCT_DRY, ticks: [0, 20, 40, 60, 80, 100] },
  rh700: { stops: PCT_DRY, ticks: [0, 20, 40, 60, 80, 100] },
  wind10: { stops: WIND, floor: 5, ticks: [10, 20, 30, 40, 50, 60, 70, 85, 100] },
  gust10: { stops: WIND, floor: 5, ticks: [10, 20, 30, 40, 50, 60, 70, 85, 100] },
  gust_max: { stops: WIND, floor: 5, ticks: [10, 20, 30, 40, 50, 60, 70, 85, 100] },
  wind100: { stops: WIND, floor: 5, ticks: [10, 20, 30, 40, 50, 60, 70, 85, 100] },
  wind850: { stops: JET.map(([v, c, a]) => [v * 0.6, c, a]), ticks: [36, 48, 60, 72, 84, 96, 108, 126] },
  wind500: { stops: JET.map(([v, c, a]) => [v * 0.8, c, a]), ticks: [48, 64, 80, 96, 112, 128, 144, 168] },
  wind250: { stops: JET, ticks: [80, 100, 120, 140, 160, 180, 210, 250] },
  mslp: { stops: [[960, '#5b2a86', 150], [985, '#2f6fd4', 130], [1000, '#1d9f8e', 105], [1013, '#2a3a5c', 40], [1025, '#efd23a', 105], [1040, '#f08b2c', 140]],
    ticks: [960, 980, 1000, 1013, 1025, 1040], contours: 'every4', label: true, line: 'rgba(236,243,250,0.82)' },
  z500: { stops: [[500, '#5b2a86', 170], [520, '#3d5fd0', 160], [540, '#3d93d8', 150], [552, '#6cc04a', 150], [564, '#efd23a', 160], [576, '#f08b2c', 170], [588, '#dc3a3a', 180]],
    ticks: [504, 516, 528, 540, 552, 564, 576, 588], contours: 'every6', label: true, line: 'rgba(236,243,250,0.82)' },
  tcc: { stops: CLOUD, floor: 5, ticks: [10, 25, 50, 75, 100] },
  lcc: { stops: CLOUD, floor: 5, ticks: [10, 25, 50, 75, 100] },
  mcc: { stops: CLOUD, floor: 5, ticks: [10, 25, 50, 75, 100] },
  hcc: { stops: CLOUD, floor: 5, ticks: [10, 25, 50, 75, 100] },
  cloud_1000ft: { stops: CLOUD, floor: 5, ticks: [10, 25, 50, 75, 100] },
  fog: { stops: CLOUD, floor: 5, ticks: [10, 25, 50, 75, 100] },
  cloud_base: { stops: [[0, '#ffffff', 230], [150, '#e3e6ea', 200], [300, '#b8c4d6', 170], [600, '#8aa0c0', 140], [1200, '#5a7aa8', 100], [2500, '#3d5fd0', 60], [5000, '#2a3a5c', 0]],
    ticks: [0, 150, 300, 600, 1200, 2500] },
  vis: { stops: VIS, ticks: [0.2, 1, 3, 6, 10] },
  cape_mu: { stops: CAPE, floor: 50, ticks: [100, 300, 600, 1000, 1500, 2500, 4000] },
  cape_sb: { stops: CAPE, floor: 50, ticks: [100, 300, 600, 1000, 1500, 2500, 4000] },
  cape_ml: { stops: CAPE, floor: 50, ticks: [100, 300, 600, 1000, 1500, 2500, 4000] },
  cin_sb: { stops: [[-500, '#2a1f6b', 220], [-200, '#3d5fd0', 200], [-100, '#5aa7e8', 170], [-50, '#a9d8f7', 130], [-10, '#e8edf2', 0]], ticks: [-500, -200, -100, -50, -10] },
  cin_mu: { stops: [[-500, '#2a1f6b', 220], [-200, '#3d5fd0', 200], [-100, '#5aa7e8', 170], [-50, '#a9d8f7', 130], [-10, '#e8edf2', 0]], ticks: [-500, -200, -100, -50, -10] },
  li: { stops: [[-10, '#6a1b9a', 240], [-6, '#d62828', 230], [-3, '#f4a261', 210], [-1, '#ffd166', 170], [1, '#a9d8f7', 60], [5, '#2f6fd4', 120], [12, '#1f2f5c', 160]], ticks: [-8, -6, -3, -1, 0, 2, 5, 10] },
  srh3: { stops: [[50, '#a9d8f7', 0], [100, '#a9d8f7', 150], [200, '#efd23a', 200], [300, '#f08b2c', 220], [450, '#dc3a3a', 235], [600, '#a52284', 250]], ticks: [100, 200, 300, 450, 600] },
  lightning: { stops: [[0.005, '#fde68a', 160], [0.05, '#fbbf24', 210], [0.2, '#f97316', 230], [0.5, '#dc2626', 240], [1, '#a21caf', 250], [3, '#ffffff', 255]], floor: 0.005, discrete: true, ticks: [0.005, 0.05, 0.2, 0.5, 1, 3] },
  pw: { stops: [[5, '#8c5a2b', 170], [12, '#c99b54', 160], [18, '#9fce8a', 170], [25, '#4fa3c7', 190], [32, '#2f6fd4', 210], [40, '#5b2a86', 225], [50, '#e05cb4', 240]], ticks: [5, 12, 18, 25, 32, 40, 50] },
  frz: { stops: HEIGHT, ticks: [0, 300, 600, 1000, 1500, 2200, 3000, 4000] },
  wbfz: { stops: HEIGHT, ticks: [0, 300, 600, 1000, 1500, 2200, 3000, 4000] },
  trop_p: { stops: [[120, '#dc3a3a', 200], [200, '#f08b2c', 190], [280, '#efd23a', 180], [350, '#6cc04a', 180], [420, '#3d93d8', 190], [500, '#5b2a86', 210]], ticks: [150, 200, 250, 300, 350, 400, 450] },
  sw_down: { stops: RAD, ticks: [50, 200, 400, 700, 1000] },
  lw_down: { stops: [[200, '#1f2f5c', 180], [260, '#3d5fd0', 170], [300, '#5aa7e8', 160], [340, '#efd23a', 180], [380, '#f08b2c', 200], [420, '#dc3a3a', 220]], ticks: [220, 260, 300, 340, 380, 420] },
  uv_down: { stops: RAD.map(([v, c, a]) => [v / 15, c, a]), ticks: [3, 13, 27, 47, 67] },
  shf: { stops: DIVERGE(-150, 450), ticks: [-150, -75, 0, 150, 300, 450] },
  /* chance (%) from an ensemble: quiet below 5 %, warm from 50 % */
  prob: { stops: [[5, '#8fd0f5', 140], [10, '#56acec', 175], [20, '#2f80d8', 195], [30, '#1f9f8a', 205], [40, '#7cc243', 212],
    [50, '#efd23a', 222], [60, '#f3a43a', 230], [70, '#ea6a32', 236], [80, '#d93838', 242], [90, '#a3247e', 248]],
  floor: 5, discrete: true, ticks: [5, 10, 20, 30, 40, 50, 60, 70, 80, 90], contours: [20, 50, 80], label: true, line: 'rgba(236,243,250,0.85)', pct: true },
};
export const scaleFor = (key) => SCALES[key] || { stops: TEMP, ticks: [] };

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function colourAt(sc, v) {
  if (v == null || Number.isNaN(v)) return null;
  if (sc.floor != null && v < sc.floor) return null;
  const s = sc.stops;
  if (v <= s[0][0]) return [...hex(s[0][1]), s[0][2] ?? 210];
  for (let i = 0; i < s.length - 1; i++) {
    const [a, ca, aa = 210] = s[i];
    const [b, cb, ab = 210] = s[i + 1];
    if (v < b) {
      if (sc.discrete) return [...hex(ca), aa];
      const t = (v - a) / (b - a);
      const A = hex(ca), B = hex(cb);
      return [0, 1, 2].map((k) => Math.round(A[k] + t * (B[k] - A[k]))).concat(Math.round(aa + t * (ab - aa)));
    }
  }
  const l = s[s.length - 1];
  return [...hex(l[1]), l[2] ?? 210];
}

/* ── frames ──────────────────────────────────────────────────────────────── */
export function decodeTable(h) {
  const f = h.scale === 'sqrt' ? Math.sqrt : (v) => v;
  const fi = h.scale === 'sqrt' ? (v) => v * v : (v) => v;
  const flo = h.scale === 'sqrt' ? Math.sqrt(Math.max(h.lo, 0)) : h.lo;
  const fhi = f(h.hi);
  const t = new Float32Array(256);
  for (let q = 0; q < 255; q++) t[q] = fi(flo + (q / 254) * (fhi - flo));
  t[255] = NaN;
  return t;
}

export async function loadFrame(model, runTag, v, step, signal) {
  const r = await fetch(`${API}/frames/${model}/${runTag}/${v}/${step}?v=${FRAME_V}`, { signal });
  if (!r.ok) throw new Error(`frame ${step}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const q = new Uint8Array(buf, 4 + n, head.nx * head.ny * (head.members || 1));
  return { head, q, table: decodeTable(head) };
}

export const runTag = (iso) => iso.replace(/[-:]/g, '').slice(0, 13) + 'Z';

/* the chance (0-100 %) that the value is past a threshold, from every ensemble member:
   members are compared in their encoded bytes, so this takes a millisecond or two */
const PROB_TABLE = (() => { const t = new Float32Array(256); for (let q = 0; q < 255; q++) t[q] = (q / 254) * 100; t[255] = NaN; return t; })();
const probCache = new WeakMap();
export function probFrame(ef, thr, dir) {
  const key = `${thr}|${dir}`;
  const c = probCache.get(ef);
  if (c && c.key === key) return c.f;
  const { nx, ny, members } = ef.head;
  const n = nx * ny, t = ef.table;
  let qa = 255, qb = -1;                                 // members >= thr (above) / <= thr (below)
  for (let q = 0; q < 255; q++) {
    if (qa === 255 && t[q] >= thr - 1e-6) qa = q;
    if (t[q] <= thr + 1e-6) qb = q;
  }
  const cnt = new Uint16Array(n), seen = new Uint16Array(n);
  for (let m = 0; m < members; m++) {
    const o = m * n;
    for (let i = 0; i < n; i++) {
      const v = ef.q[o + i];
      if (v === 255) continue;
      seen[i]++;
      if (dir === 'below' ? v <= qb : v >= qa) cnt[i]++;
    }
  }
  const q = new Uint8Array(n);
  for (let i = 0; i < n; i++) q[i] = seen[i] ? Math.round((cnt[i] / seen[i]) * 254) : 255;
  const f = { head: ef.head, q, table: PROB_TABLE, nx, ny, k: ef.head.k || 8, prob: true };
  probCache.set(ef, { key, f });
  return f;
}

/* the frame's colours as an NX x NY canvas (one pixel per grid cell) */
export function frameCanvas(frame, varKey, cache) {
  if (cache?.has(frame)) return cache.get(frame);
  if (frame.nx) return coarseCanvas(frame, varKey, cache);
  const sc = scaleFor(varKey);
  const lut = new Uint8ClampedArray(256 * 4);
  for (let q = 0; q < 256; q++) {
    const c = colourAt(sc, frame.table[q]);
    if (c) lut.set(c, q * 4);
  }
  const cv = document.createElement('canvas');
  cv.width = NX; cv.height = NY;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(NX, NY);
  const d = new Uint32Array(img.data.buffer);
  const l32 = new Uint32Array(lut.buffer);
  const q = frame.q;
  for (let i = 0; i < q.length; i++) d[i] = l32[q[i]];
  ctx.putImageData(img, 0, 0);
  if (cache) {
    cache.set(frame, cv);
    if (cache.size > 14) cache.delete(cache.keys().next().value);
  }
  return cv;
}

const UP = 4;
function coarseCanvas(frame, varKey, cache) {
  const sc = scaleFor(varKey);
  const { nx, ny } = frame;
  const W = nx * UP, H = ny * UP;
  const lut = [];
  for (let v = 0; v <= 1000; v++) lut.push(colourAt(sc, v / 10) || [0, 0, 0, 0]);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data, q = frame.q, t = frame.table;
  const val = (i, j) => { const v = t[q[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]]; return Number.isNaN(v) ? 0 : v; };
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / UP - 0.5, j0 = Math.floor(fy), ty = fy - j0;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / UP - 0.5, i0 = Math.floor(fx), tx = fx - i0;
      const v = (val(i0, j0) * (1 - tx) + val(i0 + 1, j0) * tx) * (1 - ty) + (val(i0, j0 + 1) * (1 - tx) + val(i0 + 1, j0 + 1) * tx) * ty;
      const c = lut[Math.max(0, Math.min(1000, Math.round(v * 10)))];
      const p = (y * W + x) * 4;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = c[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.dataK = (frame.k || 8) / UP;                       // display cells per canvas pixel
  if (cache) {
    cache.set(frame, cv);
    if (cache.size > 14) cache.delete(cache.keys().next().value);
  }
  return cv;
}

/* contour lines (grid coordinates), on a lightly smoothed half-resolution field */
export function frameContours(frame, varKey, resKm, cache) {
  const sc = scaleFor(varKey);
  if (!sc.contours) return null;
  if (cache?.has(frame)) return cache.get(frame);
  if (frame.nx) {                                       // coarse (probability) grid: contour it directly
    const { nx, ny } = frame, K = frame.k || 8;
    let vals = new Float64Array(nx * ny);
    for (let i = 0; i < vals.length; i++) { const v = frame.table[frame.q[i]]; vals[i] = Number.isNaN(v) ? 0 : v; }
    vals = boxBlur(vals, nx, ny, 1);
    const line = sc.line || 'rgba(8,14,24,0.8)';
    const out = d3contours().size([nx, ny]).smooth(true).thresholds(sc.contours)(Array.from(vals))
      .map((c) => ({ value: c.value, rings: c.coordinates.flatMap((p) => p).filter((r) => r.length >= 8).map((r) => r.map(([x, y]) => [x * K, y * K])), line, pct: !!sc.pct }));
    if (cache) cache.set(frame, out);
    return out;
  }
  const S = 2, w = Math.floor(NX / S), h = Math.floor(NY / S);
  let vals = new Float64Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = frame.table[frame.q[(y * S) * NX + x * S]];
      vals[y * w + x] = Number.isNaN(v) ? -9999 : v;
      if (!Number.isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  const r = Math.max(1, Math.round((resKm || 2) / (2 * S)));        // smooth over about one model cell
  vals = boxBlur(vals, w, h, r);
  let th = sc.contours;
  if (th === 'every4') th = range(Math.ceil(lo / 4) * 4, hi, 4);
  if (th === 'every6') th = range(Math.ceil(lo / 6) * 6, hi, 6);
  const gen = d3contours().size([w, h]).smooth(true).thresholds(th);
  /* rings shorter than ~25 points are 2 km speckle: drawn, they bury the map in tiny loops */
  const line = sc.line || 'rgba(8,14,24,0.8)';
  const out = gen(Array.from(vals)).map((c) => ({ value: c.value, rings: c.coordinates.flatMap((poly) => poly).filter((ring) => ring.length >= 25).map((ring) => ring.map(([x, y]) => [x * S, y * S])), line }));
  if (cache) {
    cache.set(frame, out);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
  }
  return out;
}

const range = (a, b, s) => { const o = []; for (let v = a; v <= b; v += s) o.push(v); return o; };

function boxBlur(a, w, h, r) {
  const t = new Float64Array(a.length), o = new Float64Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w && a[y * w + xx] > -9000) { s += a[y * w + xx]; n++; } }
      t[y * w + x] = n ? s / n : -9999;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h && t[yy * w + x] > -9000) { s += t[yy * w + x]; n++; } }
      o[y * w + x] = n ? s / n : -9999;
    }
  }
  return o;
}

/* ── map styles ──────────────────────────────────────────────────────────── */
/* realtime = the motion-graphics look: NASA Blue Marble by day, NASA Black Marble city lights
   (sodium gold) by night, lit by the real sun for each frame's valid time, with the blue hour
   and golden hour around the terminator. */
export const MAP_STYLES = {
  dark: { label: 'Dark', base: 'basemap.png', glass: 'dark', coast: 'rgba(226,236,248,0.62)', border: 'rgba(226,236,248,0.42)', text: '#f2f6fb', halo: 'rgba(6,10,18,0.8)', bg: '#0e1b2a' },
  light: { label: 'Light', base: 'basemap_light.png', glass: 'light', coast: 'rgba(38,52,68,0.6)', border: 'rgba(38,52,68,0.42)', text: '#17202b', halo: 'rgba(255,255,255,0.85)', bg: '#c9d9e7' },
  satellite: { label: 'Satellite', base: 'sat_day.jpg', glass: 'dark', coast: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.4)', text: '#ffffff', halo: 'rgba(0,0,0,0.75)', bg: '#06111f' },
  realtime: { label: 'Real-time', base: null, glass: 'dark', coast: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.35)', text: '#ffffff', halo: 'rgba(0,0,0,0.75)', bg: '#050a14' },
};

const DEG = Math.PI / 180;
export function sunAt(utcMs) {                      // NOAA solar position (as the motion graphics' core/sun.ts)
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * DEG;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * DEG;
  const eqTime = (4 / DEG) * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const d = new Date(utcMs);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const subLon = ((-(utcMin - 720 + eqTime) / 4 + 540) % 360) - 180;
  return { dec: decl, subLon };
}

/* lon/lat of the basemap pixels (spherical inverse of the grid's LAEA: plenty for sunlight) */
const LAT0 = 54.9 * DEG, LON0 = -2.5 * DEG, R = 6371007.2;
function invLaea(x, y) {
  const rho = Math.hypot(x, y);
  if (rho < 1e-6) return [LON0 / DEG, LAT0 / DEG];
  const c = 2 * Math.asin(Math.min(1, rho / (2 * R)));
  const lat = Math.asin(Math.cos(c) * Math.sin(LAT0) + (y * Math.sin(c) * Math.cos(LAT0)) / rho);
  const lon = LON0 + Math.atan2(x * Math.sin(c), rho * Math.cos(LAT0) * Math.cos(c) - y * Math.sin(LAT0) * Math.sin(c));
  return [lon / DEG, lat / DEG];
}
const BW = NX * 2, BH = NY * 2, CS = 16;            // basemap pixels; sun sampled every 16 px
let COARSE = null;
function coarseLonLat() {
  if (COARSE) return COARSE;
  const cw = Math.ceil(BW / CS) + 1, ch = Math.ceil(BH / CS) + 1;
  const lon = new Float32Array(cw * ch), lat = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const x = -1159000 + (i * CS) * 1000, y = 903000 - (j * CS) * 1000;
      const [lo, la] = invLaea(x, y);
      lon[j * cw + i] = lo; lat[j * cw + i] = la;
    }
  }
  COARSE = { cw, ch, lon, lat };
  return COARSE;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pixCache = {};
function pixelsOf(img) {
  if (pixCache[img.src]) return pixCache[img.src];
  const c = document.createElement('canvas');
  c.width = BW; c.height = BH;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, BW, BH);
  return (pixCache[img.src] = x.getImageData(0, 0, BW, BH).data);
}

/* look-up tables: light by sun elevation (-20..40 deg in 0.1 deg steps) and the sodium-gold
   city glow by Black Marble radiance */
const EN = 601;
let LUTS = null;
function luts() {
  if (LUTS) return LUTS;
  const E = new Float32Array(EN * 7);
  for (let i = 0; i < EN; i++) {
    const e = -20 + i / 10;
    const gold = sstep(12, 1, e) * sstep(-3, 1, e);
    E.set([sstep(-7, 2, e), 0.6 + 0.4 * sstep(0, 28, e), gold, sstep(-12, -4, e) * sstep(3, -4, e), 1 - sstep(-8, -1, e),
      1 + 0.1 * gold, 1 - 0.07 * gold], i * 7);
  }
  const C = new Float32Array(256 * 4);
  for (let n = 0; n < 256; n++) {
    const city = Math.pow(Math.min(1, Math.max(0, (n / 255 - 0.085) / 0.915)), 1.45);
    const ci = Math.min(1.35, city * 1.5), core = sstep(0.75, 1.35, ci);
    C.set([255 * ci, (148 + 78 * core) * ci, (51 + 115 * core) * ci, 0], n * 4);
  }
  return (LUTS = { E, C });
}

/* the real-time basemap for one instant (cached per 10 minutes) */
const rtCache = new Map();
export function realtimeBasemap(day, night, utcMs) {
  const key = Math.round(utcMs / 600000);
  if (rtCache.has(key)) return rtCache.get(key);
  const D = pixelsOf(day), N = pixelsOf(night);
  const { cw, ch, lon, lat } = coarseLonLat();
  const sun = sunAt(utcMs);
  const el = new Float32Array(cw * ch);
  const sd = Math.sin(sun.dec), cd = Math.cos(sun.dec);
  for (let k = 0; k < el.length; k++) {
    const phi = lat[k] * DEG, H = (lon[k] - sun.subLon) * DEG;
    el[k] = Math.asin(Math.sin(phi) * sd + Math.cos(phi) * cd * Math.cos(H)) / DEG;
  }
  const { E, C } = luts();
  const out = document.createElement('canvas');
  out.width = BW; out.height = BH;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(BW, BH);
  const o = img.data;
  for (let y = 0; y < BH; y++) {
    const fy = y / CS, j0 = Math.min(ch - 2, Math.floor(fy)), ty = fy - j0;
    for (let x = 0; x < BW; x++) {
      const fx = x / CS, i0 = Math.min(cw - 2, Math.floor(fx)), tx = fx - i0;
      const k = j0 * cw + i0;
      const e = (el[k] * (1 - tx) + el[k + 1] * tx) * (1 - ty) + (el[k + cw] * (1 - tx) + el[k + cw + 1] * tx) * ty;
      const q = Math.max(0, Math.min(EN - 1, Math.round((e + 20) * 10))) * 7;
      const dayF = E[q], sunI = E[q + 1], dark = E[q + 4];
      const p = (y * BW + x) * 4;
      const n = N[p], c = n * 4;
      const moon = Math.min(1, n / 85);
      const nr = 7 + 12 * moon, ng = 11 + 14 * moon, nb = 22 + 18 * moon;
      const dr = D[p] * sunI * E[q + 5], dg = D[p + 1] * sunI * E[q + 6], db = D[p + 2] * sunI * (1 - 0.22 * E[q + 2]);
      const bl = E[q + 3];
      o[p] = nr + (dr - nr) * dayF + 12.8 * bl + C[c] * dark;
      o[p + 1] = ng + (dg - ng) * dayF + 13.2 * bl + C[c + 1] * dark;
      o[p + 2] = nb + (db - nb) * dayF + 30.8 * bl + C[c + 2] * dark;
      o[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rtCache.set(key, out);
  if (rtCache.size > 8) rtCache.delete(rtCache.keys().next().value);
  return out;
}

/* ── the scene: one renderer for the screen preview and every export ───────── */
export const fmtValue = (v, unit) => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(1);
  return `${s}${unit ? ` ${unit}` : ''}`;
};
const timeFmt = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', ...opts });
export const FONT = '"Inter", -apple-system, "SF Pro Display", "Segoe UI", system-ui, sans-serif';

/* rect = the graphic's frame on this canvas; view = { cx, cy, s }: the grid point at the
   frame's centre and canvas px per grid cell. Everything else scales with the frame
   (u = 1 at a 1080 px short side), so a PNG at any size is the preview, enlarged. */
export function drawScene(ctx, rect, view, L, opts = {}) {
  const { cx, cy, s } = view;
  const u = Math.min(rect.w, rect.h) / 1080;
  const ox = rect.x + rect.w / 2, oy = rect.y + rect.h / 2;
  const X = (gx) => (gx - cx) * s + ox;
  const Y = (gy) => (gy - cy) * s + oy;
  const st = MAP_STYLES[L.style] || MAP_STYLES.dark;
  const clip = opts.clip || rect;
  ctx.save();
  ctx.beginPath();
  if (opts.round) roundRect(ctx, clip.x, clip.y, clip.w, clip.h, opts.round); else ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  ctx.fillStyle = st.bg;
  ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (L.basemap) ctx.drawImage(L.basemap, X(0), Y(0), NX * s, NY * s);
  if (L.data) {
    const dk = L.data.dataK;
    ctx.imageSmoothingEnabled = dk ? true : !!L.smooth;
    ctx.drawImage(L.data, X(0), Y(0), dk ? L.data.width * dk * s : NX * s, dk ? L.data.height * dk * s : NY * s);
    ctx.imageSmoothingEnabled = true;
  }
  if (L.contours) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.7 * u;
    for (const c of L.contours) {
      ctx.beginPath();
      for (const ring of c.rings) ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.strokeStyle = L.style === 'light' && c.line.startsWith('rgba(236') ? 'rgba(30,42,58,0.7)' : c.line;
      ctx.stroke();
    }
  }
  if (L.lines) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(X(0), Y(0), NX * s, NY * s);                // the model domain only
    ctx.clip();
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = st.coast;
    strokeLines(ctx, L.lines.coast, X, Y);
    ctx.setLineDash([6 * u, 4 * u]);
    ctx.strokeStyle = st.border;
    strokeLines(ctx, L.lines.border, X, Y);
    ctx.setLineDash([]);
    ctx.restore();
  }
  edgeFade(ctx, X(0), Y(0), NX * s, NY * s, 36 * s, st.bg);
  if (L.contours && L.contourLabels) drawContourLabels(ctx, L.contours, X, Y, rect, u, st);
  if (L.cities) drawCities(ctx, L.cities, X, Y, rect, s / u, u, st, L.chrome ? 150 * u : 0);
  if (L.star) {
    /* the highest value in view, kept clear of the title card and the key */
    const top = L.chrome ? 150 * u : 20 * u, bot = L.chrome ? 104 * u : 20 * u;
    const m = frameMax(L.star.frame, (rect.x + 20 * u - ox) / s + cx, (rect.y + top - oy) / s + cy,
      (rect.x + rect.w - 20 * u - ox) / s + cx, (rect.y + rect.h - bot - oy) / s + cy);
    if (m) drawStar(ctx, X(m.gx), Y(m.gy), u, st, `${fmtValue(m.v, L.star.unit)}`, rect);
  }
  if (L.chrome) drawChrome(ctx, rect, u, L.chrome, st);
  ctx.restore();
}

/* the domain's edge melts into the background instead of ending in a hard line */
function edgeFade(ctx, x, y, w, h, f, bg) {
  const c = hex(bg);
  const solid = `rgba(${c[0]},${c[1]},${c[2]},1)`, clear = `rgba(${c[0]},${c[1]},${c[2]},0)`;
  const band = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, solid);
    g.addColorStop(1, clear);
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  };
  band(x, 0, x + f, 0, x, y, f, h);
  band(x + w, 0, x + w - f, 0, x + w - f, y, f, h);
  band(0, y, 0, y + f, x, y, w, f);
  band(0, y + h, 0, y + h - f, x, y + h - f, w, f);
}

function strokeLines(ctx, lines, X, Y) {
  ctx.beginPath();
  for (const l of lines || []) {
    ctx.moveTo(X(l[0]), Y(l[1]));
    for (let i = 2; i < l.length; i += 2) ctx.lineTo(X(l[i]), Y(l[i + 1]));
  }
  ctx.stroke();
}

/* where the field peaks inside a grid box: the highest value, and among equal highs the
   cell nearest their middle (so a flat-topped maximum gets its star in the middle of it) */
const maxCache = new WeakMap();
export function frameMax(frame, gx0, gy0, gx1, gy1) {
  const K = frame.nx ? frame.k || 8 : 1, W = frame.nx || NX, Hh = frame.ny || NY;
  const x0 = Math.max(0, Math.floor(gx0 / K)), x1 = Math.min(W - 1, Math.ceil(gx1 / K) - 1);
  const y0 = Math.max(0, Math.floor(gy0 / K)), y1 = Math.min(Hh - 1, Math.ceil(gy1 / K) - 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const k = `${x0},${y0},${x1},${y1}`;
  const c = maxCache.get(frame);
  if (c && c.k === k) return c.m;
  const q = frame.q;
  let best = -1, n = 0, sx = 0, sy = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * W;
    for (let x = x0; x <= x1; x++) {
      const v = q[row + x];
      if (v === 255 || v < best) continue;
      if (v > best) { best = v; n = 0; sx = 0; sy = 0; }
      n++; sx += x; sy += y;
    }
  }
  let m = null;
  if (best > 0) {
    const mx = sx / n, my = sy / n;
    let bd = Infinity, bx = 0, by = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (q[y * W + x] !== best) continue;
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < bd) { bd = d; bx = x; by = y; }
      }
    }
    m = { gx: (bx + 0.5) * K, gy: (by + 0.5) * K, v: frame.table[best] };
  }
  maxCache.set(frame, { k, m });
  return m;
}

function drawStar(ctx, x, y, u, st, label, R) {
  const r = 17 * u, ri = r * 0.45;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? ri : r;
    i ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.shadowColor = 'rgba(255,200,40,0.85)';
  ctx.shadowBlur = 16 * u;
  const g = ctx.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, '#fff6c9');
  g.addColorStop(0.55, '#ffd23f');
  g.addColorStop(1, '#f5a300');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.2 * u;
  ctx.strokeStyle = 'rgba(40,24,0,0.85)';
  ctx.stroke();
  ctx.restore();
  // value capsule beside the star (flips left near the right edge)
  ctx.font = `800 ${16 * u}px ${FONT}`;
  const tw = ctx.measureText(label).width;
  const w = tw + 22 * u, h = 30 * u;
  const right = x + r + 8 * u + w < R.x + R.w - 10 * u;
  const bx = right ? x + r + 8 * u : x - r - 8 * u - w, by = y - h / 2;
  glassPanel(ctx, bx, by, w, h, h / 2, u, st.glass);
  ctx.fillStyle = st.glass === 'light' ? '#111820' : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, bx + 11 * u, by + h / 2 + 1 * u);
}

function haloText(ctx, t, x, y, st, w) {
  ctx.lineWidth = w;
  ctx.strokeStyle = st.halo;
  ctx.strokeText(t, x, y);
  ctx.fillStyle = st.text;
  ctx.fillText(t, x, y);
}

function drawContourLabels(ctx, contours, X, Y, R, u, st) {
  ctx.font = `700 ${15 * u}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const placed = [];
  for (const c of contours) {
    for (const ring of c.rings) {
      if (ring.length < 30) continue;
      for (let i = 10; i < ring.length; i += 140) {
        const x = X(ring[i][0]), y = Y(ring[i][1]);
        if (x < R.x + 40 * u || y < R.y + 170 * u || x > R.x + R.w - 40 * u || y > R.y + R.h - 140 * u) continue;
        if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 110 * u)) continue;
        placed.push([x, y]);
        haloText(ctx, (Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(0)) + (c.pct ? '%' : ''), x, y, st, 4 * u);
      }
    }
  }
}

function drawCities(ctx, cities, X, Y, R, cellPx, u, st, footer) {
  const maxRank = cellPx > 3.2 ? 3 : cellPx > 1.5 ? 2 : 1;
  ctx.font = `600 ${19 * u}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const c of cities) {
    if (c.rank > maxRank) continue;
    const x = X(c.x), y = Y(c.y);
    if (x < R.x + 10 * u || y < R.y + 170 * u || x > R.x + R.w - 120 * u || y > R.y + R.h - footer) continue;
    ctx.beginPath();
    ctx.arc(x, y, 4 * u, 0, Math.PI * 2);
    ctx.fillStyle = st.text;
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = st.halo;
    ctx.stroke();
    haloText(ctx, c.name, x + 9 * u, y, st, 5 * u);
  }
}

/* frosted glass inside a canvas: the scene under the panel, blurred, then a tint, a top
   highlight and a hairline edge (Safari without canvas filters gets a stronger tint) */
const FILTER_OK = typeof document !== 'undefined' && 'filter' in (document.createElement('canvas').getContext('2d') || {});
function glassPanel(ctx, x, y, w, h, r, u, theme) {
  const light = theme === 'light';
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (FILTER_OK) {
    ctx.filter = `blur(${Math.round(18 * u)}px) saturate(160%)`;
    ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
    ctx.filter = 'none';
  }
  ctx.fillStyle = light ? `rgba(255,255,255,${FILTER_OK ? 0.5 : 0.78})` : `rgba(14,20,32,${FILTER_OK ? 0.42 : 0.72})`;
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.save();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  const e = ctx.createLinearGradient(0, y, 0, y + h);
  e.addColorStop(0, light ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.42)');
  e.addColorStop(1, light ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)');
  ctx.strokeStyle = e;
  ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.stroke();
  ctx.restore();
}

/* the graphic's furniture: a title card, a logo capsule and a compact key */
function drawChrome(ctx, R, u, C, st) {
  const light = st.glass === 'light';
  const ink = light ? '#111820' : '#ffffff';
  const sub = light ? 'rgba(17,24,32,0.62)' : 'rgba(255,255,255,0.7)';
  const accent = light ? '#0a6fd1' : '#7cc8ff';
  const pad = 26 * u;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // title card
  const day = timeFmt(C.valid, { weekday: 'short', day: 'numeric', month: 'short' });
  const hour = timeFmt(C.valid, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  ctx.font = `800 ${34 * u}px ${FONT}`;
  const dw = ctx.measureText(day + ' ').width;
  ctx.font = `400 ${34 * u}px ${FONT}`;
  const hw = ctx.measureText(hour).width;
  ctx.font = `600 ${14 * u}px ${FONT}`;
  const meta = `${C.model} · run ${C.runLabel} · T+${C.step}`;
  const mw = ctx.measureText(meta).width;
  ctx.font = `800 ${13 * u}px ${FONT}`;
  const vlab = C.variable.toUpperCase();
  const vw = ctx.measureText(vlab).width + 1.2 * u * vlab.length;
  const tw = Math.min(R.w - 2 * pad - 70 * u, Math.max(dw + hw, mw, vw) + 40 * u);
  const th = 112 * u;
  glassPanel(ctx, R.x + pad, R.y + pad, tw, th, 24 * u, u, st.glass);
  let x = R.x + pad + 20 * u;
  ctx.fillStyle = accent;
  ctx.font = `800 ${13 * u}px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${1.2 * u}px`;
  ctx.fillText(vlab, x, R.y + pad + 30 * u);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = ink;
  ctx.font = `800 ${34 * u}px ${FONT}`;
  ctx.fillText(day, x, R.y + pad + 70 * u);
  ctx.font = `400 ${34 * u}px ${FONT}`;
  ctx.fillStyle = sub;
  ctx.fillText(hour, x + dw, R.y + pad + 70 * u);
  ctx.fillStyle = sub;
  ctx.font = `600 ${14 * u}px ${FONT}`;
  ctx.fillText(meta, x, R.y + pad + 96 * u);
  // logo capsule, top right
  if (C.logo) {
    const d = 58 * u, lx = R.x + R.w - pad - d, ly = R.y + pad;
    glassPanel(ctx, lx, ly, d, d, d / 2, u, st.glass);
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx + d / 2, ly + d / 2, d / 2 - 6 * u, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(C.logo, lx + 6 * u, ly + 6 * u, d - 12 * u, d - 12 * u);
    ctx.restore();
  }
  // key: one slim capsule along the foot
  const sc = C.scale;
  const ticks = sc.ticks || [];
  const kh = 64 * u, kw = Math.min(R.w - 2 * pad, Math.max(420 * u, ticks.length * 70 * u + 40 * u));
  const kx = R.x + pad, ky = R.y + R.h - pad - kh;
  glassPanel(ctx, kx, ky, kw, kh, 22 * u, u, st.glass);
  ctx.font = `700 ${12.5 * u}px ${FONT}`;
  ctx.fillStyle = sub;
  const unitTxt = C.unit || '';
  ctx.fillText(`${C.variable}${unitTxt ? ` · ${unitTxt}` : ''}`, kx + 18 * u, ky + 22 * u);
  ctx.textAlign = 'right';
  ctx.fillText(C.credit, kx + kw - 18 * u, ky + 22 * u);
  ctx.textAlign = 'left';
  if (ticks.length > 1) {
    const bx = kx + 18 * u, bw = kw - 36 * u, by = ky + 31 * u, bh = 9 * u, n = ticks.length;
    const seg = bw / n;
    ctx.save();
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.clip();
    if (sc.discrete) {
      for (let i = 0; i < n; i++) {
        const c = colourAt({ ...sc, floor: null }, ticks[i]) || [80, 90, 100, 255];
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(bx + i * seg, by, seg + 0.5, bh);
      }
    } else {
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      for (let i = 0; i <= 24; i++) {
        const f = i / 24, pos = f * n - 0.5, k = Math.max(0, Math.min(n - 1, Math.floor(pos)));
        const t = Math.max(0, Math.min(1, pos - k));
        const v = k + 1 < n ? ticks[k] + t * (ticks[k + 1] - ticks[k]) : ticks[n - 1];
        const c = colourAt({ ...sc, floor: null }, v) || [80, 90, 100, 255];
        g.addColorStop(f, `rgb(${c[0]},${c[1]},${c[2]})`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw, bh);
    }
    ctx.restore();
    ctx.fillStyle = ink;
    ctx.font = `600 ${12.5 * u}px ${FONT}`;
    ctx.textAlign = sc.discrete ? 'left' : 'center';
    for (let i = 0; i < n; i++) {
      const tx = sc.discrete ? bx + i * seg + 1 * u : bx + (i + 0.5) * seg;
      ctx.fillText(String(ticks[i]), tx, by + bh + 16 * u);
    }
    ctx.textAlign = 'left';
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ── exports ─────────────────────────────────────────────────────────────── */
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* render(i, ctx, W, H) draws frame i; one shared palette (sampled from several frames) keeps
   colours steady through the loop */
export async function makeGif({ count, W, H, delayMs, render, onProgress, cancelled }) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const sampleIdx = [...new Set([0, Math.floor(count / 4), Math.floor(count / 2), Math.floor((3 * count) / 4), count - 1])];
  const parts = [];
  for (const i of sampleIdx) {
    await render(i, ctx, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const step = 4 * 7;
    const sub = new Uint8ClampedArray(Math.ceil(d.length / step) * 4);
    for (let k = 0, j = 0; k < d.length; k += step, j += 4) { sub[j] = d[k]; sub[j + 1] = d[k + 1]; sub[j + 2] = d[k + 2]; sub[j + 3] = 255; }
    parts.push(sub);
  }
  const all = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const palette = quantize(all, 256);
  const gif = GIFEncoder();
  for (let i = 0; i < count; i++) {
    if (cancelled?.()) return null;
    await render(i, ctx, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette: i === 0 ? palette : undefined, delay: delayMs, repeat: 0 });
    onProgress?.((i + 1) / count);
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
