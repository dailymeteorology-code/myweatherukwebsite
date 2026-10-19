/* Model Data viewer engine: frames, colour scales, contours, the drawn scene and exports.

   Every model arrives on ONE display grid: the Met Office UKV grid (Lambert equal-area,
   1042 x 970 cells of exactly 2 km). UKV is drawn cell for cell; coarser models arrive as
   blocks of their own cells (nearest neighbour on the server), so nothing looks finer than
   the model really is. "Native grid" draws each cell as a hard-edged square; "Smooth"
   only blends neighbouring pixels on screen. */
import { contours as d3contours } from 'd3-contour';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export const API = '/api/modeldata';
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
  const r = await fetch(`${API}/frames/${model}/${runTag}/${v}/${step}`, { signal });
  if (!r.ok) throw new Error(`frame ${step}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const q = new Uint8Array(buf, 4 + n, head.nx * head.ny);
  return { head, q, table: decodeTable(head) };
}

export const runTag = (iso) => iso.replace(/[-:]/g, '').slice(0, 13) + 'Z';

/* the frame's colours as an NX x NY canvas (one pixel per grid cell) */
export function frameCanvas(frame, varKey, cache) {
  if (cache?.has(frame)) return cache.get(frame);
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

/* contour lines (grid coordinates), on a lightly smoothed half-resolution field */
export function frameContours(frame, varKey, resKm, cache) {
  const sc = scaleFor(varKey);
  if (!sc.contours) return null;
  if (cache?.has(frame)) return cache.get(frame);
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

/* ── the scene ───────────────────────────────────────────────────────────── */
export const fmtValue = (v, unit) => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(1);
  return `${s}${unit ? ` ${unit}` : ''}`;
};

const timeFmt = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', ...opts });

/* view: { cx, cy, s } = grid point at the canvas centre and screen px per grid cell */
export function drawScene(ctx, W, H, view, L) {
  const { cx, cy, s } = view;
  const X = (gx) => (gx - cx) * s + W / 2;
  const Y = (gy) => (gy - cy) * s + H / 2;
  ctx.save();
  ctx.fillStyle = '#0e1b2a';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  if (L.basemap) ctx.drawImage(L.basemap, X(0), Y(0), NX * s, NY * s);
  if (L.data) {
    ctx.imageSmoothingEnabled = !!L.smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(L.data, X(0), Y(0), NX * s, NY * s);
    ctx.imageSmoothingEnabled = true;
  }
  const lw = Math.max(1, Math.min(2.2, s * 0.55)) * (L.pixelRatio || 1);
  if (L.contours) {
    ctx.lineJoin = 'round';
    for (const c of L.contours) {
      ctx.beginPath();
      for (const ring of c.rings) {
        ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      }
      ctx.strokeStyle = c.line;
      ctx.lineWidth = lw * 0.9;
      ctx.stroke();
    }
    if (L.contourLabels) drawContourLabels(ctx, L.contours, X, Y, W, H, lw);
  }
  if (L.lines) {
    ctx.lineWidth = lw * 0.8;
    ctx.strokeStyle = 'rgba(226,236,248,0.62)';
    strokeLines(ctx, L.lines.coast, X, Y);
    ctx.setLineDash([4 * lw, 3 * lw]);
    ctx.strokeStyle = 'rgba(226,236,248,0.45)';
    strokeLines(ctx, L.lines.border, X, Y);
    ctx.setLineDash([]);
  }
  if (L.cities) drawCities(ctx, L.cities, X, Y, W, L.chrome ? H - Math.min(W, H) * 0.13 : H, s, L.pixelRatio || 1);
  if (L.chrome) drawChrome(ctx, W, H, L.chrome);
  ctx.restore();
}

function strokeLines(ctx, lines, X, Y) {
  ctx.beginPath();
  for (const l of lines || []) {
    ctx.moveTo(X(l[0]), Y(l[1]));
    for (let i = 2; i < l.length; i += 2) ctx.lineTo(X(l[i]), Y(l[i + 1]));
  }
  ctx.stroke();
}

function drawContourLabels(ctx, contours, X, Y, W, H, lw) {
  ctx.font = `700 ${Math.round(9.5 * Math.max(1, lw * 0.7))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const placed = [];
  for (const c of contours) {
    for (const ring of c.rings) {
      if (ring.length < 30) continue;
      for (let i = 10; i < ring.length; i += 140) {
        const x = X(ring[i][0]), y = Y(ring[i][1]);
        if (x < 30 || y < 70 || x > W - 30 || y > H - 110) continue;
        if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 70)) continue;
        placed.push([x, y]);
        const t = Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(0);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,14,24,0.9)';
        ctx.strokeText(t, x, y);
        ctx.fillStyle = '#f5f8fc';
        ctx.fillText(t, x, y);
      }
    }
  }
}

function drawCities(ctx, cities, X, Y, W, H, s, pr) {
  const maxRank = s > 2.4 ? 3 : s > 1.2 ? 2 : 1;
  const fs = Math.round(12 * pr);
  ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const c of cities) {
    if (c.rank > maxRank) continue;
    const x = X(c.x), y = Y(c.y);
    if (x < 8 || y < 8 || x > W - 8 || y > H - 8) continue;
    ctx.beginPath();
    ctx.arc(x, y, 2.6 * pr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.2 * pr;
    ctx.strokeStyle = 'rgba(8,14,24,0.9)';
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.lineWidth = 3.2 * pr;
    ctx.strokeStyle = 'rgba(8,14,24,0.78)';
    ctx.strokeText(c.name, x + 6 * pr, y);
    ctx.fillStyle = '#f2f6fb';
    ctx.fillText(c.name, x + 6 * pr, y);
  }
}

/* title block, legend and credit line: our own layout (glass panels, legend along the foot) */
function drawChrome(ctx, W, H, C) {
  const u = Math.min(W, H) / 1080;                          // design unit: 1 at 1080 px
  const pad = 28 * u;
  // top band
  const g = ctx.createLinearGradient(0, 0, 0, 170 * u);
  g.addColorStop(0, 'rgba(6,12,22,0.86)');
  g.addColorStop(1, 'rgba(6,12,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 170 * u);
  let x = pad;
  if (C.logo) {
    const r = 30 * u;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + r, pad + r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(C.logo, x, pad, 2 * r, 2 * r);
    ctx.restore();
    x += 2 * r + 16 * u;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7cc4ff';
  ctx.font = `800 ${15 * u}px Inter, system-ui, sans-serif`;
  ctx.fillText(C.variable.toUpperCase(), x, pad + 16 * u);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${38 * u}px Inter, system-ui, sans-serif`;
  const day = timeFmt(C.valid, { weekday: 'long', day: 'numeric', month: 'long' });
  ctx.fillText(day, x, pad + 56 * u);
  const dw = ctx.measureText(day).width;
  ctx.font = `400 ${38 * u}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#c9d6e6';
  ctx.fillText(` ${timeFmt(C.valid, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`, x + dw, pad + 56 * u);
  // run pill, top right
  ctx.font = `700 ${14 * u}px Inter, system-ui, sans-serif`;
  const runTxt = `${C.model}  ·  ${C.runLabel}  ·  T+${C.step}`;
  const tw = ctx.measureText(runTxt).width;
  const pw = tw + 28 * u, ph = 32 * u, px = W - pad - pw, py = pad;
  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e6eef8';
  ctx.textBaseline = 'middle';
  ctx.fillText(runTxt, px + 14 * u, py + ph / 2 + 1);
  // legend along the foot
  const lh = 92 * u, ly = H - lh - pad * 0.6, lx = pad, lw = W - 2 * pad;
  roundRect(ctx, lx, ly, lw, lh, 18 * u);
  ctx.fillStyle = 'rgba(6,12,22,0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();
  const sc = C.scale;
  const ticks = sc.ticks?.length ? sc.ticks : [];
  const bx = lx + 22 * u, bw = lw - 44 * u - 120 * u, by = ly + 26 * u, bh = 16 * u;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#9fb3c8';
  ctx.font = `700 ${12 * u}px Inter, system-ui, sans-serif`;
  ctx.fillText(C.unit ? `${C.variable} (${C.unit})` : C.variable, bx, ly + 18 * u);
  if (ticks.length > 1) {
    const n = ticks.length;
    const segW = bw / n;
    for (let i = 0; i < n; i++) {
      const v0 = ticks[i], v1 = ticks[i + 1] ?? ticks[i] + (ticks[i] - ticks[i - 1]);
      const c = colourAt({ ...sc, floor: null }, sc.discrete ? v0 : (v0 + v1) / 2) || [60, 70, 80, 255];
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},1)`;
      const r = i === 0 ? 'l' : i === n - 1 ? 'r' : '';
      roundRect(ctx, bx + i * segW + 1, by, segW - 2, bh, r ? 6 * u : 2 * u);
      ctx.fill();
      ctx.fillStyle = '#e6eef8';
      ctx.font = `600 ${13 * u}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(String(v0), bx + i * segW + 2, by + bh + 22 * u);
    }
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${16 * u}px Inter, system-ui, sans-serif`;
  ctx.fillText('MyWeatherUK', lx + lw - 20 * u, ly + 44 * u);
  ctx.fillStyle = '#8aa0b8';
  ctx.font = `500 ${11 * u}px Inter, system-ui, sans-serif`;
  ctx.fillText(C.gridNote, lx + lw - 20 * u, ly + 64 * u);
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, h, r) {
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
