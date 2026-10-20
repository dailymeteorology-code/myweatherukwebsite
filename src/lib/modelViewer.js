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
/* The radar palette of the MyWeatherUK motion graphics (mwuk-graphics RADAR_STEPS), mm/h lower
   bounds, stepped; light drizzle a little translucent, as there. */
const RADAR_STEPS = [
  [0.05, '#B4F0FA'], [0.2, '#96D2FA'], [0.4, '#78B9FA'], [0.6, '#3C96F5'], [0.8, '#1E6EEB'],
  [1, '#483CC8'], [1.2, '#2D1EA5'], [1.4, '#32AD2B'], [1.8, '#46CE3F'], [2.2, '#5ED958'],
  [2.5, '#78E673'], [3, '#95F391'], [3.5, '#AAFDA6'], [4, '#F6FF00'], [5, '#FFBA00'],
  [6, '#FF7000'], [7, '#FF0000'], [8, '#DE0000'], [9, '#BF0000'], [10, '#990000'],
  [12, '#BF5D5D'], [14, '#DEA1A1'], [16, '#F2CFCF'], [20, '#FCE3E3'], [25, '#D6CAE4'],
  [30, '#BAA6D0'], [40, '#9B7EB9'],
];
const RADAR_STOPS = RADAR_STEPS.map(([v, c]) => [v, c, Math.round(255 * (v < 0.2 ? 0.78 : v < 0.6 ? 0.865 : 0.95))]);
const RADAR_KEY = { stops: RADAR_STOPS, floor: 0.05, discrete: true, keySteps: RADAR_STEPS.map(([v]) => v),
  ticks: [0.2, 0.6, 1, 1.4, 2.2, 3, 4, 6, 8, 10, 14, 20, 30] };
/* the same colours for simulated reflectivity: each rain rate as dBZ (Marshall-Palmer, Z = 200 R^1.6) */
const DBZ = (r) => Math.round(10 * Math.log10(200 * r ** 1.6) * 10) / 10;
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
  precip_rate: RADAR_KEY,
  rain_rate: RADAR_KEY,
  conv_rain: RADAR_KEY,
  precip_1h: RADAR_KEY,
  precip_total: { stops: TOTAL, floor: 1, discrete: true, ticks: [1, 2, 5, 10, 15, 20, 30, 50, 75, 100], contours: [5, 10, 20, 30, 50, 100], label: true },
  hail_rate: { stops: RAIN, floor: 0.05, discrete: true, ticks: [0.1, 0.5, 1, 2, 4, 8, 16] },
  refc: { stops: RADAR_STOPS.map(([v, c, a]) => [DBZ(v), c, a]), floor: DBZ(0.05), discrete: true,
    keySteps: RADAR_STEPS.map(([v]) => DBZ(v)), ticks: [0.2, 1, 3, 6, 10, 20, 40].map(DBZ) },
  radar: RADAR_KEY,
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
  windchill: { stops: TEMP, ticks: [-15, -8, -3, 0, 3, 6, 10, 14, 18, 22], zero: true },
  wdir10: { stops: [[0, '#000000', 0], [360, '#000000', 0]], ticks: [] },
  /* weather type: one colour per code (mdata/derived.py WX_NAMES) */
  wx: { stops: [[0, '#f6d860', 70], [1, '#cfdcea', 70], [2, '#aab8c8', 110], [3, '#8995a6', 140], [4, '#d8d2c4', 170], [5, '#a9d8f7', 170],
    [6, '#5aa7e8', 190], [7, '#2f6fd4', 210], [8, '#1d3fa8', 225], [9, '#9a8fe0', 210], [10, '#d9e4f7', 200], [11, '#b9c8f2', 215],
    [12, '#8a7fe0', 230], [13, '#f2a93a', 235], [14, '#e2322e', 240]], discrete: true, keySteps: [...Array(15).keys()],
  ticks: [0, 2, 4, 6, 8, 9, 11, 13], keyLabel: (v) => ['Clear', 'Part cloud', 'Cloudy', 'Overcast', 'Fog', 'Drizzle', 'Lt rain', 'Rain', 'Heavy', 'Sleet', 'Lt snow', 'Snow', 'Hvy snow', 'Thunder', 'Hail'][Math.round(v)] },
  /* sea state */
  swh: { stops: [[0.25, '#cfe8f7', 120], [0.5, '#9fd3ef', 160], [1, '#5aa7e8', 185], [2, '#2f6fd4', 205], [3, '#1d9f8e', 215], [4, '#6cc04a', 222],
    [5, '#efd23a', 230], [6, '#f08b2c', 236], [8, '#dc3a3a', 242], [10, '#a52284', 248], [14, '#f2e6ff', 252]], floor: 0.25, discrete: true,
  ticks: [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 14], contours: [2, 4, 6, 8], label: true, line: 'rgba(236,243,250,0.75)' },
  mwp: { stops: [[2, '#1f2f5c', 150], [5, '#3d5fd0', 170], [8, '#3d93d8', 185], [11, '#6cc04a', 200], [14, '#efd23a', 215], [17, '#f08b2c', 225], [20, '#dc3a3a', 235]], ticks: [3, 5, 8, 11, 14, 17, 20] },
  aod: { stops: [[0.05, '#e9e1c8', 0], [0.1, '#e9d9a8', 110], [0.2, '#e6c27a', 160], [0.4, '#d99a4a', 200], [0.7, '#b8662e', 225], [1.2, '#7a3a1c', 240]], floor: 0.05, ticks: [0.1, 0.2, 0.4, 0.7, 1.2] },
  pm25: { stops: [[5, '#7cc8a0', 0], [10, '#a6cf3e', 140], [20, '#efd23a', 180], [35, '#f08b2c', 205], [55, '#dc3a3a', 225], [100, '#a52284', 240]], floor: 5, ticks: [10, 20, 35, 55, 100] },
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
  if (frame.img) return imageCanvas(frame, varKey, cache);
  if (frame.nx && frame.k < 1) return fineCanvas(frame, varKey, cache);
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

/* a 1 km grid (live radar): every pixel its own colour, no resampling */
function fineCanvas(frame, varKey, cache) {
  const sc = scaleFor(varKey);
  const lut = new Uint32Array(256);
  for (let q = 0; q < 256; q++) {
    const c = colourAt(sc, frame.table[q]);
    if (c) lut[q] = (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  const cv = document.createElement('canvas');
  cv.width = frame.nx; cv.height = frame.ny;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(frame.nx, frame.ny);
  const d = new Uint32Array(img.data.buffer);
  for (let i = 0; i < d.length; i++) d[i] = lut[frame.q[i]];
  ctx.putImageData(img, 0, 0);
  cv.dataK = frame.k;
  if (cache) { cache.set(frame, cv); if (cache.size > 14) cache.delete(cache.keys().next().value); }
  return cv;
}

/* satellite pictures; infrared also as an enhanced cloud-top scale or as clouds over the map */
const IR_ENH = [[150, '#7fd8ff'], [168, '#3a8ff0'], [184, '#2a5bd0'], [196, '#36c26a'], [208, '#f3e23a'], [220, '#f59a2a'], [232, '#e2322e'], [243, '#b0208f'], [252, '#ffffff']];
function irEnhanced(g) {
  if (g < IR_ENH[0][0]) return [g, g, g, 255];
  for (let i = 0; i < IR_ENH.length - 1; i++) {
    const [a, ca] = IR_ENH[i], [b, cb] = IR_ENH[i + 1];
    if (g < b) { const t = (g - a) / (b - a), A = hex(ca), B = hex(cb); return [0, 1, 2].map((k) => Math.round(A[k] + t * (B[k] - A[k]))).concat(255); }
  }
  return [255, 255, 255, 255];
}
function imageCanvas(frame, varKey, cache) {
  const im = frame.img;
  const cv = document.createElement('canvas');
  cv.width = im.naturalWidth || im.width; cv.height = im.naturalHeight || im.height;
  const ctx = cv.getContext('2d', { willReadFrequently: varKey === 'sat_ir_enh' || varKey === 'sat_clouds' });
  ctx.drawImage(im, 0, 0);
  if (varKey === 'sat_ir_enh' || varKey === 'sat_clouds') {
    const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
    const lut = new Uint8ClampedArray(256 * 4);
    for (let g = 0; g < 256; g++) {
      const c = varKey === 'sat_ir_enh' ? irEnhanced(g) : [244, 247, 250, Math.round(240 * (g < 92 ? 0 : g > 205 ? 1 : ((g - 92) / 113) ** 1.15))];
      lut.set(c, g * 4);
    }
    for (let p = 0; p < d.length; p += 4) { const o = d[p] * 4; d[p] = lut[o]; d[p + 1] = lut[o + 1]; d[p + 2] = lut[o + 2]; d[p + 3] = lut[o + 3]; }
    ctx.putImageData(id, 0, 0);
  }
  cv.dataK = frame.k || 0.5;
  if (cache) { cache.set(frame, cv); if (cache.size > 10) cache.delete(cache.keys().next().value); }
  return cv;
}

export async function loadLive(product, iso, ext, signal) {
  const stamp = iso.replace(/[-:]/g, '').slice(0, 13);
  const url = `${API}/live/${product}/${stamp}.${ext}`;
  const valid = new Date(iso).toISOString();
  if (ext === 'bin') return loadBin(url, signal, { valid, live: product });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  return { head: { valid }, img, k: 0.5, live: product };
}

/* a gridded frame file: on the 2 km display grid (k = 1) it is an ordinary frame; on the 1 km
   grid it carries its own size and k */
async function loadBin(url, signal, extra = {}) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const h = { ...head, ...(extra.valid ? { valid: extra.valid } : {}) };
  const f = { head: h, q: new Uint8Array(buf, 4 + n, head.nx * head.ny), table: decodeTable(head), live: extra.live };
  if (head.k && head.k !== 1) Object.assign(f, { nx: head.nx, ny: head.ny, k: head.k });
  return f;
}

/* one observed day's field (mdata/now.py), and its summary */
export const loadObserved = (day, name, signal) => loadBin(`${API}/observed/${day}/${name}.bin`, signal);

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

/* The real-time basemap for one instant (cached per 10 minutes), blended on the GPU:
     out = night·(1 − day) + satellite·sunlight·day + blue-hour + city glow·dark
   The light terms only change slowly across the map (the sun's elevation, sampled every 16 px),
   so each is a tiny canvas the GPU stretches over the map; the per-pixel parts that never
   change (the moonlit night ground and the sodium-gold city glow from Black Marble) are made
   once. It used to be one JavaScript loop over 4 million pixels per time step. */
let RT_STATIC = null;
function rtStatic(night) {
  if (RT_STATIC?.night === night) return RT_STATIC;
  const N = pixelsOf(night);
  const { C } = luts();
  const mk = () => { const c = document.createElement('canvas'); c.width = BW; c.height = BH; return c; };
  const base = mk(), glow = mk();
  const bi = base.getContext('2d').createImageData(BW, BH), gi = glow.getContext('2d').createImageData(BW, BH);
  const b = bi.data, g = gi.data;
  for (let p = 0; p < b.length; p += 4) {
    const n = N[p], moon = Math.min(1, n / 85), c = n * 4;
    b[p] = 7 + 12 * moon; b[p + 1] = 11 + 14 * moon; b[p + 2] = 22 + 18 * moon; b[p + 3] = 255;
    g[p] = C[c]; g[p + 1] = C[c + 1]; g[p + 2] = C[c + 2]; g[p + 3] = 255;
  }
  base.getContext('2d').putImageData(bi, 0, 0);
  glow.getContext('2d').putImageData(gi, 0, 0);
  const tmp = mk();
  return (RT_STATIC = { night, base, glow, tmp });
}
const rtCache = new Map();
export function realtimeBasemap(day, night, utcMs) {
  const key = Math.round(utcMs / 600000);
  if (rtCache.has(key)) return rtCache.get(key);
  const { cw, ch, lon, lat } = coarseLonLat();
  const sun = sunAt(utcMs);
  const sd = Math.sin(sun.dec), cd = Math.cos(sun.dec);
  const { E } = luts();
  // the four light fields at the coarse points
  const small = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d'); return [c, x, x.createImageData(cw, ch)]; };
  const [mulC, mulX, mul] = small(), [dayC, dayX, dayA] = small(), [blueC, blueX, blue] = small(), [darkC, darkX, darkA] = small();
  for (let k = 0; k < cw * ch; k++) {
    const phi = lat[k] * DEG, H = (lon[k] - sun.subLon) * DEG;
    const e = Math.asin(Math.sin(phi) * sd + Math.cos(phi) * cd * Math.cos(H)) / DEG;
    const q = Math.max(0, Math.min(EN - 1, Math.round((e + 20) * 10))) * 7, p = k * 4;
    const sunI = E[q + 1];
    mul.data[p] = Math.min(255, 255 * sunI * E[q + 5]); mul.data[p + 1] = Math.min(255, 255 * sunI * E[q + 6]);
    mul.data[p + 2] = 255 * sunI * (1 - 0.22 * E[q + 2]); mul.data[p + 3] = 255;
    dayA.data[p + 3] = 255 * E[q];
    blue.data[p] = 12.8 * E[q + 3]; blue.data[p + 1] = 13.2 * E[q + 3]; blue.data[p + 2] = 30.8 * E[q + 3]; blue.data[p + 3] = 255;
    darkA.data[p + 3] = 255 * E[q + 4];
  }
  mulX.putImageData(mul, 0, 0); dayX.putImageData(dayA, 0, 0); blueX.putImageData(blue, 0, 0); darkX.putImageData(darkA, 0, 0);
  const S = rtStatic(night);
  const out = document.createElement('canvas');
  out.width = BW; out.height = BH;
  const o = out.getContext('2d'), t = S.tmp.getContext('2d');
  const stretch = (ctx, c) => ctx.drawImage(c, -CS / 2, -CS / 2, cw * CS, ch * CS);      // coarse point k sits at k*CS
  o.imageSmoothingEnabled = true; t.imageSmoothingEnabled = true;
  o.drawImage(S.base, 0, 0);
  t.globalCompositeOperation = 'copy'; t.drawImage(day, 0, 0, BW, BH);
  t.globalCompositeOperation = 'multiply'; stretch(t, mulC);
  t.globalCompositeOperation = 'destination-in'; stretch(t, dayC);
  o.drawImage(S.tmp, 0, 0);                                    // satellite·sunlight over the night, by daylight
  o.globalCompositeOperation = 'lighter'; stretch(o, blueC);   // the blue hour
  t.globalCompositeOperation = 'copy'; t.drawImage(S.glow, 0, 0);
  t.globalCompositeOperation = 'destination-in'; stretch(t, darkC);
  o.drawImage(S.tmp, 0, 0);                                    // city lights, by darkness
  o.globalCompositeOperation = 'source-over'; t.globalCompositeOperation = 'source-over';
  rtCache.set(key, out);
  if (rtCache.size > 8) rtCache.delete(rtCache.keys().next().value);
  return out;
}

/* Smaller copies of a big image (made once, with good downscaling), so drawing it zoomed
   out is a near-1:1 copy instead of a costly 'high quality' shrink of 4 million pixels. */
const pyrCache = new WeakMap();
function pyramid(img) {
  let L = pyrCache.get(img);
  if (L) return L;
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  L = [{ src: img, w: w0 }];
  let prev = img, w = w0, h = h0;
  for (let k = 0; k < 3; k++) {
    w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(prev, 0, 0, w, h);
    L.push({ src: c, w });
    prev = c;
  }
  pyrCache.set(img, L);
  return L;
}
function drawPyramid(ctx, img, x, y, w, h, coarse) {
  const L = pyramid(img), need = coarse ? w / 2 : w;
  let lv = L[0];
  for (const l of L) if (l.w >= need) lv = l;                 // the smallest copy still as wide as drawn
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(lv.src, x, y, w, h);
  ctx.imageSmoothingQuality = 'high';
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
  if (L.basemap) drawPyramid(ctx, L.basemap, X(0), Y(0), NX * s, NY * s, opts.coarse);
  const put = (cv, smoothOn, alpha = 1) => {
    const dk = cv.dataK;
    const w = dk ? cv.width * dk * s : NX * s, h = dk ? cv.height * dk * s : NY * s;
    ctx.imageSmoothingEnabled = dk && dk >= 1 ? true : !!smoothOn;      // coarse grids blend; 1 km and 2 km follow the toggle
    // 'high' quality only where a big grid is shrunk a lot for an export-quality look; else cheap
    ctx.imageSmoothingQuality = !opts.coarse && w < cv.width * 0.6 ? 'medium' : 'low';
    ctx.globalAlpha = alpha;
    ctx.drawImage(cv, X(cv.dataX0 || 0), Y(cv.dataY0 || 0), w, h);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  };
  if (L.overlay) put(L.overlay.canvas, true, L.overlay.alpha ?? 1);   // cloud under the rain
  if (L.data) put(L.data, L.smooth);
  /* the grid box in view (2 km cells), for culling roads, grid and arrows */
  const gx0 = (clip.x - ox) / s + cx, gx1 = (clip.x + clip.w - ox) / s + cx;
  const gy0 = (clip.y - oy) / s + cy, gy1 = (clip.y + clip.h - oy) / s + cy;
  if (L.roads) cachedRoads(ctx, L.roads, clip, view, X, Y, gx0, gy0, gx1, gy1, s / u, u, st, ox, oy, L.interacting);
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
  const box = [Math.max(0, gx0), Math.max(0, gy0), Math.min(gx1, NX), Math.min(gy1, NY)];
  if (L.grid?.frame) drawValueGrid(ctx, L.grid, X, Y, ...box, s, u, st);
  if (L.arrows?.frame) drawArrows(ctx, L.arrows, X, Y, ...box, s, u, st);
  if (L.strikes?.length) drawStrikes(ctx, L.strikes, X, Y, u);
  if (L.contours && L.contourLabels) drawContourLabels(ctx, L.contours, X, Y, rect, u, st);
  if (L.cities) drawCities(ctx, L.cities, X, Y, rect, s / u, u, st, L.chrome ? 150 * u : 0, L.wx);
  if (L.star) {
    /* the highest value in view, kept clear of the title card and the key */
    const top = L.chrome ? 150 * u : 20 * u, bot = L.chrome ? 104 * u : 20 * u;
    const m = L.star.at || frameMax(L.star.frame, (rect.x + 20 * u - ox) / s + cx, (rect.y + top - oy) / s + cy,
      (rect.x + rect.w - 20 * u - ox) / s + cx, (rect.y + rect.h - bot - oy) / s + cy);
    if (m) drawStar(ctx, X(m.gx), Y(m.gy), u, st, `${fmtValue(m.v, L.star.unit)}${m.place ? ` · ${m.place}` : ''}`, rect);
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

/* strikes = [[gx, gy, age minutes]]: the newest as bright crosses, older ones fading dots */
function drawStrikes(ctx, strikes, X, Y, u) {
  ctx.save();
  for (const [gx, gy, age] of strikes) {
    const x = X(gx), y = Y(gy);
    if (age < 5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3 * u; ctx.shadowColor = 'rgba(255,240,150,0.9)'; ctx.shadowBlur = 10 * u;
      const r = 8 * u;
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      ctx.shadowBlur = 0;
      continue;
    }
    const c = age < 15 ? '255,226,60' : age < 30 ? '255,150,40' : '235,70,50';
    ctx.fillStyle = `rgba(${c},${age < 30 ? 0.95 : 0.7})`;
    ctx.beginPath(); ctx.arc(x, y, (age < 15 ? 4.2 : 3.4) * u, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,10,0,0.55)'; ctx.lineWidth = 1.2 * u; ctx.stroke();
  }
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

/* ── roads: the motion graphics' network (OpenStreetMap) and its look — blue motorways with a
   dark casing, warm A roads — gaining detail as you zoom: motorways always, trunk roads from
   about 2x, primary roads close in (mwuk-graphics core/tokens ROADS) ── */
let roadsP = null;
export function loadRoads() {
  if (roadsP) return roadsP;
  roadsP = Promise.all([fetch(`${API}/static/roads.json`).then((r) => r.json()), fetch(`${API}/static/roads.bin`).then((r) => r.arrayBuffer())])
    .then(([idx, buf]) => {
      const out = {};
      for (const [k, e] of Object.entries(idx.classes)) {
        const xy = new Int16Array(buf, e.xy[0], e.xy[1]), off = new Uint32Array(buf, e.off[0], e.off[1]);
        const n = off.length - 1, box = new Float32Array(n * 4), sc = 1 / idx.scale;
        for (let i = 0; i < n; i++) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let p = off[i]; p < off[i + 1]; p++) {
            const x = xy[2 * p] * sc, y = xy[2 * p + 1] * sc;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          box.set([x0, y0, x1, y1], i * 4);
        }
        out[k] = { xy, off, box, sc };
      }
      return out;
    })
    .catch((e) => { roadsP = null; throw e; });
  return roadsP;
}
const ROAD_STYLE = {
  motorway: { color: '#2F63D6', inZ: [0, 0], width: [1.5, 4.6], alpha: 0.95, casing: 1.1 },
  trunk: { color: '#C9A57E', inZ: [2.2, 4.4], width: [0.75, 3.2], alpha: 0.62, casing: 0.8 },
  primary: { color: '#C9A57E', inZ: [7.5, 15], width: [0.75, 2.9], alpha: 0.62, casing: 0 },
};
/* the road layer for one view, kept: playback, toggles and GIF frames redraw the same roads.
   While the map is being dragged or zoomed, the last layer is moved and scaled with it, and the
   roads are drawn afresh once it settles. */
const roadCache = [];
function cachedRoads(ctx, roads, clip, view, X, Y, gx0, gy0, gx1, gy1, z, u, st, ox, oy, interacting) {
  const frameKey = [clip.x, clip.y, clip.w, clip.h, ox, oy, st.glass, ctx.canvas.width].join(',');
  const key = [view.cx, view.cy, view.s, frameKey].join(',');
  let hit = roadCache.find((c) => c.key === key && c.roads === roads);
  if (!hit && interacting) {
    const near = roadCache.find((c) => c.frameKey === frameKey && c.roads === roads);
    if (near) {
      const k = view.s / near.view.s;
      const dx = (clip.x - ox) * k + ox + (near.view.cx - view.cx) * view.s;
      const dy = (clip.y - oy) * k + oy + (near.view.cy - view.cy) * view.s;
      ctx.drawImage(near.cv, dx, dy, near.cv.width * k, near.cv.height * k);
      return;
    }
  }
  if (!hit) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(clip.w)); cv.height = Math.max(1, Math.ceil(clip.h));
    const rc = cv.getContext('2d');
    rc.translate(-clip.x, -clip.y);
    drawRoads(rc, roads, X, Y, gx0, gy0, gx1, gy1, z, u, st);
    hit = { key, frameKey, view: { ...view }, roads, cv };
    roadCache.unshift(hit);
    roadCache.length = Math.min(roadCache.length, 3);
  }
  ctx.drawImage(hit.cv, clip.x, clip.y);
}
function drawRoads(ctx, roads, X, Y, gx0, gy0, gx1, gy1, z, u, st) {
  const light = st.glass === 'light';
  for (const cls of ['primary', 'trunk', 'motorway']) {
    const S = ROAD_STYLE[cls];
    const vis = S.inZ[1] > S.inZ[0] ? Math.min(1, Math.max(0, (z - S.inZ[0]) / (S.inZ[1] - S.inZ[0]))) : 1;
    if (vis <= 0.02) continue;
    // the simplified national set until well zoomed in: canvas strokes tens of thousands of
    // full-detail A-road pieces in seconds (the films draw them on the GPU)
    const set = roads[`${cls}.${z >= (cls === 'motorway' ? 2.2 : cls === 'trunk' ? 14 : 26) ? 'fine' : 'coarse'}`] || roads[`${cls}.fine`];
    if (!set) continue;
    const t = Math.min(1, Math.max(0, Math.log10(z / 2) / 2));   // design width at z = 2 .. 200, as the films
    const w = (S.width[0] + (S.width[1] - S.width[0]) * t) * u;
    const path = new Path2D();
    const { xy, off, box, sc } = set;
    for (let i = 0, n = off.length - 1; i < n; i++) {
      if (box[i * 4 + 2] < gx0 || box[i * 4] > gx1 || box[i * 4 + 3] < gy0 || box[i * 4 + 1] > gy1) continue;
      const a = off[i];
      path.moveTo(X(xy[2 * a] * sc), Y(xy[2 * a + 1] * sc));
      for (let p = a + 1; p < off[i + 1]; p++) path.lineTo(X(xy[2 * p] * sc), Y(xy[2 * p + 1] * sc));
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    if (S.casing) {
      ctx.globalAlpha = vis * (light ? 0.75 : 0.85);
      ctx.strokeStyle = light ? 'rgba(255,255,255,0.9)' : 'rgba(3,7,15,0.55)';
      ctx.lineWidth = w + 2 * S.casing * u;
      ctx.stroke(path);
    }
    ctx.globalAlpha = vis * S.alpha;
    ctx.strokeStyle = S.color;
    ctx.lineWidth = w;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  }
}

/* a frame's value at a grid point (2 km display cells), or NaN */
export function sampleFrame(f, gx, gy) {
  if (!f?.q) return NaN;
  const K = f.nx ? f.k || 1 : 1, W = f.nx || NX, H = f.ny || NY;
  const i = Math.floor(gx / K), j = Math.floor(gy / K);
  if (i < 0 || j < 0 || i >= W || j >= H) return NaN;
  return f.table[f.q[j * W + i]];
}

/* Smoothed radar and rain: the VALUES are interpolated (a light blur, then bicubic-like
   bilinear on a finer grid) and only then coloured, so the stepped palette keeps crisp
   bands with smooth edges instead of blurring one colour into the next. Only the part of
   the grid that has data is upsampled. */
export function smoothCanvas(frame, varKey, cache) {
  if (cache?.has(frame)) return cache.get(frame);
  const sc = scaleFor(varKey);
  const W = frame.nx || NX, H = frame.ny || NY, K = frame.nx ? frame.k || 1 : 1, q = frame.q;
  const lut = new Uint32Array(256);
  for (let v = 0; v < 255; v++) {
    const c = colourAt(sc, frame.table[v]);
    if (c) lut[v] = (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let j = 0; j < H; j++) {
    const row = j * W;
    for (let i = 0; i < W; i++) if (lut[q[row + i]]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  const cv = document.createElement('canvas');
  if (x1 < 0) { cv.width = 1; cv.height = 1; cv.dataK = K; cv.dataX0 = 0; cv.dataY0 = 0; return cv; }
  x0 = Math.max(0, x0 - 3); y0 = Math.max(0, y0 - 3); x1 = Math.min(W - 1, x1 + 3); y1 = Math.min(H - 1, y1 + 3);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, F = K < 1 ? 2 : 3;
  // values in the encoded domain (monotonic in the value; no-data counts as dry), blurred [1 2 1]
  const a = new Float32Array(bw * bh), b = new Float32Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) { const v = q[(y0 + j) * W + x0 + i]; a[j * bw + i] = v === 255 ? 0 : v; }
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const l = a[j * bw + Math.max(0, i - 1)], r = a[j * bw + Math.min(bw - 1, i + 1)];
    b[j * bw + i] = (l + 2 * a[j * bw + i] + r) / 4;
  }
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const u0 = b[Math.max(0, j - 1) * bw + i], d0 = b[Math.min(bh - 1, j + 1) * bw + i];
    a[j * bw + i] = Math.max((u0 + 2 * b[j * bw + i] + d0) / 4, 0.82 * q[(y0 + j) * W + x0 + i] * (q[(y0 + j) * W + x0 + i] !== 255));   // keep cores
  }
  const ow = bw * F, oh = bh * F;
  cv.width = ow; cv.height = oh;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(ow, oh);
  const d = new Uint32Array(img.data.buffer);
  for (let y = 0; y < oh; y++) {
    const fy = (y + 0.5) / F - 0.5, j0 = Math.max(0, Math.min(bh - 1, Math.floor(fy))), j1 = Math.min(bh - 1, j0 + 1), ty = Math.min(1, Math.max(0, fy - j0));
    for (let x = 0; x < ow; x++) {
      const fx = (x + 0.5) / F - 0.5, i0 = Math.max(0, Math.min(bw - 1, Math.floor(fx))), i1 = Math.min(bw - 1, i0 + 1), tx = Math.min(1, Math.max(0, fx - i0));
      const v = (a[j0 * bw + i0] * (1 - tx) + a[j0 * bw + i1] * tx) * (1 - ty) + (a[j1 * bw + i0] * (1 - tx) + a[j1 * bw + i1] * tx) * ty;
      d[y * ow + x] = lut[Math.min(254, Math.round(v))];
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.dataK = K / F; cv.dataX0 = x0 * K; cv.dataY0 = y0 * K;
  if (cache) { cache.set(frame, cv); if (cache.size > 6) cache.delete(cache.keys().next().value); }
  return cv;
}

/* ── a grid of values: thin lines on a lattice tied to the map (it does not swim as you pan),
   each box labelled with the layer's value at its centre, formatted for that layer ── */
const NICE = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100, 200];
export function gridLabel(v, varKey, unit) {
  if (v == null || Number.isNaN(v)) return null;
  const sc = scaleFor(varKey);
  if (varKey === 'wx') return ['Clear', 'Pt cloud', 'Cloudy', 'Dull', 'Fog', 'Drizzle', 'Lt rain', 'Rain', 'Heavy', 'Sleet', 'Lt snow', 'Snow', 'Hvy snow', 'Thunder', 'Hail'][Math.round(v)] ?? null;
  if (varKey === 'mwd' || varKey === 'wdir10') return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(v / 22.5) % 16];
  if (sc.floor != null && v < sc.floor) return null;
  if (unit === '°C') return `${Math.round(v)}°`;
  if (unit === '%' || unit === 'mph' || unit === 'hPa' || unit === 'J/kg' || unit === 'm' || unit === 'dam' || unit === 'W/m²') return String(Math.round(v));
  const a = Math.abs(v);
  return a >= 10 ? String(Math.round(v)) : a >= 1 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(a >= 0.1 ? 1 : 2);
}
function drawValueGrid(ctx, G, X, Y, gx0, gy0, gx1, gy1, s, u, st) {
  const f = G.frame;
  const minCell = f.nx && f.k < 1 ? 0.5 : 1;
  const g = NICE.find((n) => n >= minCell && n * s >= 74 * u) || 200;
  const i0 = Math.floor(gx0 / g), i1 = Math.ceil(gx1 / g), j0 = Math.floor(gy0 / g), j1 = Math.ceil(gy1 / g);
  ctx.save();
  ctx.lineWidth = Math.max(1, 0.8 * u);
  ctx.strokeStyle = st.glass === 'light' ? 'rgba(20,30,44,0.16)' : 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) { ctx.moveTo(X(i * g), Y(j0 * g)); ctx.lineTo(X(i * g), Y(j1 * g)); }
  for (let j = j0; j <= j1; j++) { ctx.moveTo(X(i0 * g), Y(j * g)); ctx.lineTo(X(i1 * g), Y(j * g)); }
  ctx.stroke();
  ctx.font = `700 ${Math.min(17, Math.max(11, g * s / 5.2 / u)) * u}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const cx = (i + 0.5) * g, cy = (j + 0.5) * g;
      const t = gridLabel(sampleFrame(f, cx, cy), G.varKey, G.unit);
      if (t) haloText(ctx, t, X(cx), Y(cy), st, 3.5 * u);
    }
  }
  ctx.restore();
}

/* ── wind arrows (direction the wind blows towards), turned for the grid's convergence ── */
function gridLonLat(gx, gy) { return invLaea(-1159000 + gx * 2000, 903000 - gy * 2000); }
function drawArrows(ctx, A, X, Y, gx0, gy0, gx1, gy1, s, u, st) {
  const f = A.frame;
  const g = NICE.find((n) => n >= 1 && n * s >= 58 * u) || 200;
  const len = Math.min(26, Math.max(15, g * s * 0.42 / u)) * u;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let j = Math.floor(gy0 / g); j <= Math.ceil(gy1 / g); j++) {
    for (let i = Math.floor(gx0 / g); i <= Math.ceil(gx1 / g); i++) {
      const cx = (i + 0.5) * g, cy = (j + 0.5) * g;
      const dir = sampleFrame(f, cx, cy);
      if (!Number.isFinite(dir)) continue;
      const [lon, lat] = gridLonLat(cx, cy);
      const conv = (lon + 2.5) * Math.sin(lat * DEG);
      const b = ((dir + 180 - conv) % 360) * DEG;           // towards, clockwise from map-up
      const dx = Math.sin(b) * len / 2, dy = -Math.cos(b) * len / 2;
      const x = X(cx), y = Y(cy);
      const head = () => {
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy);
        const hb = 0.5, hl = len * 0.38;
        ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx - hl * Math.sin(b - hb), y + dy + hl * Math.cos(b - hb));
        ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx - hl * Math.sin(b + hb), y + dy + hl * Math.cos(b + hb));
      };
      head(); ctx.lineWidth = 4.2 * u; ctx.strokeStyle = st.halo; ctx.stroke();
      head(); ctx.lineWidth = 1.9 * u; ctx.strokeStyle = st.text; ctx.stroke();
    }
  }
  ctx.restore();
}

/* ── weather symbols. Codes are shared with the server (mdata/derived.py WX_NAMES). ── */
export const WX_NAMES = ['Clear', 'Partly cloudy', 'Cloudy', 'Overcast', 'Fog', 'Drizzle', 'Light rain', 'Rain', 'Heavy rain',
  'Sleet', 'Light snow', 'Snow', 'Heavy snow', 'Thunderstorm', 'Hail'];
function sunElev(lon, lat, utcMs) {
  const { dec, subLon } = sunAt(utcMs);
  const H = (lon - subLon) * DEG, la = lat * DEG;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)) / DEG;
}
function cloudShape(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x - r * 0.45, y + r * 0.1, r * 0.42, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(x - r * 0.05, y - r * 0.2, r * 0.52, Math.PI * 1.05, Math.PI * 1.85);
  ctx.arc(x + r * 0.5, y + r * 0.08, r * 0.44, Math.PI * 1.4, Math.PI * 0.5);
  ctx.closePath();
}
export function drawWxIcon(ctx, code, x, y, r, night, u) {
  const sunC = '#ffc93c', moonC = '#e8eefc', cloudC = code >= 5 || code === 3 ? '#c9d2de' : '#f4f7fb';
  const dark = code >= 7 || code === 13;
  ctx.save();
  ctx.lineCap = 'round';
  const orb = (ox, oy, rr) => {
    if (night) {                                     // a crescent: the disc, less a second disc
      ctx.save();
      ctx.beginPath(); ctx.arc(ox, oy, rr, 0, Math.PI * 2); ctx.clip();
      ctx.beginPath(); ctx.rect(ox - 2 * rr, oy - 2 * rr, 4 * rr, 4 * rr);
      ctx.arc(ox + rr * 0.45, oy - rr * 0.3, rr * 0.82, 0, Math.PI * 2, true);
      ctx.fillStyle = moonC; ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = sunC; ctx.lineWidth = 1.6 * u;
      for (let k = 0; k < 8; k++) {
        const t = (k * Math.PI) / 4;
        ctx.beginPath(); ctx.moveTo(ox + Math.cos(t) * rr * 1.25, oy + Math.sin(t) * rr * 1.25); ctx.lineTo(ox + Math.cos(t) * rr * 1.6, oy + Math.sin(t) * rr * 1.6); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(ox, oy, rr, 0, Math.PI * 2); ctx.fillStyle = sunC; ctx.fill();
    }
  };
  const cloud = (cx, cy, rr, col) => {
    cloudShape(ctx, cx, cy, rr);
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 1.1 * u; ctx.strokeStyle = 'rgba(20,30,45,0.35)'; ctx.stroke();
  };
  if (code === 0) orb(x, y, r * 0.55);
  else if (code === 1) { orb(x - r * 0.3, y - r * 0.3, r * 0.42); cloud(x + r * 0.12, y + r * 0.18, r * 0.78, '#f4f7fb'); }
  else if (code === 4) {
    ctx.strokeStyle = '#dfe6ee'; ctx.lineWidth = 2.2 * u;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x - r * 0.75 + (k === 0 ? r * 0.15 : 0), y + k * r * 0.38); ctx.lineTo(x + r * 0.75, y + k * r * 0.38); ctx.stroke(); }
  } else {
    cloud(x, y - r * 0.18, r * 0.95, dark ? '#9aa6b6' : cloudC);
    const by = y + r * 0.55;
    const drops = (n, col, len) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.9 * u;
      for (let k = 0; k < n; k++) { const dx = (k - (n - 1) / 2) * r * 0.42; ctx.beginPath(); ctx.moveTo(x + dx, by); ctx.lineTo(x + dx - r * 0.12, by + len); ctx.stroke(); }
    };
    const flakes = (n) => {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4 * u;
      for (let k = 0; k < n; k++) {
        const fx = x + (k - (n - 1) / 2) * r * 0.48, fy = by + r * 0.22, fr = r * 0.17;
        for (let a = 0; a < 3; a++) { const t = (a * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(fx - Math.cos(t) * fr, fy - Math.sin(t) * fr); ctx.lineTo(fx + Math.cos(t) * fr, fy + Math.sin(t) * fr); ctx.stroke(); }
      }
    };
    if (code === 5) drops(3, '#9fd3ff', r * 0.18);
    else if (code === 6) drops(2, '#5fb4ff', r * 0.32);
    else if (code === 7) drops(3, '#3d9bff', r * 0.38);
    else if (code === 8) drops(4, '#2f7bff', r * 0.46);
    else if (code === 9) { drops(1, '#5fb4ff', r * 0.32); ctx.save(); ctx.translate(r * 0.3, 0); flakes(1); ctx.restore(); }
    else if (code === 10) flakes(2);
    else if (code === 11) flakes(3);
    else if (code === 12) flakes(4);
    else if (code === 13 || code === 14) {
      ctx.beginPath();
      ctx.moveTo(x + r * 0.08, by - r * 0.08); ctx.lineTo(x - r * 0.22, by + r * 0.34); ctx.lineTo(x + r * 0.02, by + r * 0.34); ctx.lineTo(x - r * 0.14, by + r * 0.66);
      ctx.lineTo(x + r * 0.3, by + r * 0.2); ctx.lineTo(x + r * 0.05, by + r * 0.2); ctx.lineTo(x + r * 0.22, by - r * 0.08); ctx.closePath();
      ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 1 * u; ctx.strokeStyle = 'rgba(60,40,0,0.7)'; ctx.stroke();
      if (code === 14) { ctx.fillStyle = '#ffffff'; for (const dx of [-0.42, 0.5]) { ctx.beginPath(); ctx.arc(x + dx * r, by + r * 0.3, r * 0.1, 0, Math.PI * 2); ctx.fill(); } }
    }
  }
  ctx.restore();
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
  /* radar: a lone hot cell (the composite has some, 100+ mm/h with nothing around them) is not
     the heaviest rain; a peak needs at least three of its eight neighbours at half its level */
  const radar = frame.live === 'radar';
  const real = (x, y, v) => {
    if (!radar || x < 1 || y < 1 || x >= W - 1 || y >= Hh - 1) return true;
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const w = q[(y + dy) * W + x + dx];
      if ((dx || dy) && w !== 255 && w >= v * 0.7) k++;          // encoded sqrt: 0.7 ~ half the rate
    }
    return k >= 3;
  };
  let best = -1, n = 0, sx = 0, sy = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * W;
    for (let x = x0; x <= x1; x++) {
      const v = q[row + x];
      if (v === 255 || v < best) continue;
      if (!real(x, y, v)) continue;
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

/* place labels; with `wx` (a weather-type frame and its time) each place gets its symbol
   above the name, the sun or the moon by the real sun at that place */
function drawCities(ctx, cities, X, Y, R, cellPx, u, st, footer, wx) {
  const maxRank = cellPx > 3.2 ? 3 : cellPx > 1.5 ? 2 : 1;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const c of cities) {
    if (c.rank > maxRank) continue;
    const x = X(c.x), y = Y(c.y);
    if (x < R.x + 10 * u || y < R.y + 170 * u || x > R.x + R.w - 120 * u || y > R.y + R.h - footer) continue;
    const code = wx?.frame ? sampleFrame(wx.frame, c.x, c.y) : NaN;
    if (Number.isFinite(code) && code >= 0 && code < WX_NAMES.length) {
      const [lon, lat] = gridLonLat(c.x, c.y);
      const r = 17 * u, ix = x + 4 * u, iy = y - 27 * u;
      ctx.save();
      ctx.beginPath(); ctx.arc(ix, iy, r * 1.08, 0, Math.PI * 2);
      ctx.fillStyle = st.glass === 'light' ? 'rgba(30,48,72,0.55)' : 'rgba(6,12,22,0.48)'; ctx.fill();
      ctx.restore();
      drawWxIcon(ctx, Math.round(code), ix, iy, r * 0.82, sunElev(lon, lat, wx.utcMs) < -0.833, u);
    }
    ctx.font = `600 ${19 * u}px ${FONT}`;
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
  const ink = light ? '#0f1722' : '#ffffff';
  const sub = light ? 'rgba(15,23,34,0.62)' : 'rgba(255,255,255,0.74)';
  const accent = light ? '#0a6fd1' : '#7cc8ff';
  const ukBlue = light ? '#1d6fc0' : '#3f8fdc';          // the "UK" of MyWeatherUK: a darker, light-ish blue
  const pad = 26 * u, gap = 14 * u;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // ── brand: a large logo and the MyWeatherUK wordmark, top right ──
  const bh = 84 * u, logoD = bh - 14 * u;
  ctx.font = `800 ${31 * u}px ${FONT}`;
  const wMy = ctx.measureText('MyWeather').width, wUK = ctx.measureText('UK').width;
  const bw = 7 * u + logoD + 14 * u + wMy + wUK + 26 * u;
  const bx = R.x + R.w - pad - bw, by = R.y + pad;
  glassPanel(ctx, bx, by, bw, bh, bh / 2, u, st.glass);
  if (C.logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx + 7 * u + logoD / 2, by + bh / 2, logoD / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(C.logo, bx + 7 * u, by + 7 * u, logoD, logoD);
    ctx.restore();
  }
  const tx0 = bx + 7 * u + logoD + 14 * u, ty0 = by + bh / 2 + 11 * u;
  ctx.fillStyle = ink;
  ctx.fillText('MyWeather', tx0, ty0);
  ctx.fillStyle = ukBlue;
  ctx.fillText('UK', tx0 + wMy, ty0);

  // ── title card, top left (below the brand when the frame is too narrow for both) ──
  const day = timeFmt(C.valid, { weekday: 'short', day: 'numeric', month: 'short' });
  const hour = timeFmt(C.valid, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const meta = C.metaLine || `${C.model} · run ${C.runLabel} · T+${C.step}`;
  const vlab = C.variable.toUpperCase();
  ctx.font = `800 ${36 * u}px ${FONT}`;
  const dw = ctx.measureText(`${day}  `).width;
  ctx.font = `400 ${36 * u}px ${FONT}`;
  const hw = ctx.measureText(hour).width;
  ctx.font = `600 ${15 * u}px ${FONT}`;
  const mw = ctx.measureText(meta).width;
  ctx.font = `800 ${13 * u}px ${FONT}`;
  const vw = ctx.measureText(vlab).width + 1.4 * u * vlab.length;
  const want = Math.max(dw + hw, mw, vw) + 48 * u;
  const room = R.w - 2 * pad - bw - gap;
  const stacked = room < Math.min(want, 440 * u);
  const tw = Math.min(stacked ? R.w - 2 * pad : room, want);
  const th = 124 * u;
  const tx = R.x + pad, ty = stacked ? by + bh + gap : R.y + pad;
  glassPanel(ctx, tx, ty, tw, th, 26 * u, u, st.glass);
  const x = tx + 24 * u;
  ctx.save();
  ctx.beginPath();
  ctx.rect(tx, ty, tw - 12 * u, th);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.font = `800 ${13 * u}px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${1.4 * u}px`;
  ctx.fillText(vlab, x, ty + 34 * u);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = ink;
  ctx.font = `800 ${36 * u}px ${FONT}`;
  ctx.fillText(day, x, ty + 76 * u);
  ctx.fillStyle = sub;
  ctx.font = `400 ${36 * u}px ${FONT}`;
  ctx.fillText(hour, x + dw, ty + 76 * u);
  ctx.font = `600 ${15 * u}px ${FONT}`;
  ctx.fillText(meta, x, ty + 104 * u);
  ctx.restore();

  // ── key: one slim capsule along the foot ──
  const sc = C.scale || {};
  const ticks = sc.ticks || [];
  const steps = sc.keySteps || ticks;
  const hasBar = steps.length > 1;
  const kh = hasBar ? 70 * u : 44 * u;
  ctx.font = `700 ${13 * u}px ${FONT}`;
  const textW = ctx.measureText(`${C.variable}${C.unit ? ` · ${C.unit}` : ''}`).width + ctx.measureText(C.credit || '').width + 72 * u;
  const kw = Math.min(R.w - 2 * pad, hasBar ? Math.max(480 * u, textW, Math.min(820 * u, steps.length * (sc.keySteps ? 30 : 74) * u + 40 * u)) : textW);
  const kx = R.x + pad, ky = R.y + R.h - pad - kh;
  glassPanel(ctx, kx, ky, kw, kh, 22 * u, u, st.glass);
  ctx.font = `700 ${13 * u}px ${FONT}`;
  ctx.fillStyle = sub;
  ctx.fillText(`${C.variable}${C.unit ? ` · ${C.unit}` : ''}`, kx + 20 * u, ky + (hasBar ? 24 : 27) * u);
  ctx.textAlign = 'right';
  ctx.fillText(C.credit || '', kx + kw - 20 * u, ky + (hasBar ? 24 : 27) * u);
  ctx.textAlign = 'left';
  if (hasBar) {
    const bx2 = kx + 20 * u, bw2 = kw - 40 * u, by2 = ky + 33 * u, bh2 = 10 * u, n = steps.length;
    const seg = bw2 / n;
    ctx.save();
    roundRect(ctx, bx2, by2, bw2, bh2, bh2 / 2);
    ctx.clip();
    if (sc.discrete) {
      for (let i = 0; i < n; i++) {
        const c = colourAt({ ...sc, floor: null }, steps[i]) || [80, 90, 100, 255];
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(bx2 + i * seg, by2, seg + 0.6, bh2);
      }
    } else {
      const g = ctx.createLinearGradient(bx2, 0, bx2 + bw2, 0);
      for (let i = 0; i <= 24; i++) {
        const f = i / 24, pos = f * n - 0.5, k = Math.max(0, Math.min(n - 1, Math.floor(pos)));
        const t = Math.max(0, Math.min(1, pos - k));
        const v = k + 1 < n ? steps[k] + t * (steps[k + 1] - steps[k]) : steps[n - 1];
        const c = colourAt({ ...sc, floor: null }, v) || [80, 90, 100, 255];
        g.addColorStop(f, `rgb(${c[0]},${c[1]},${c[2]})`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(bx2, by2, bw2, bh2);
    }
    ctx.restore();
    // labels: every tick that fits, never overlapping
    ctx.fillStyle = ink;
    ctx.font = `600 ${12.5 * u}px ${FONT}`;
    const labelled = new Set(ticks.map((v) => +v));
    let lastEnd = -Infinity;
    for (let i = 0; i < n; i++) {
      if (sc.keySteps && !labelled.has(+steps[i])) continue;
      const txt = String(sc.keyLabel ? sc.keyLabel(steps[i]) : +(+steps[i]).toFixed(2));
      const w = ctx.measureText(txt).width;
      const cx = sc.discrete ? bx2 + i * seg : bx2 + (i + 0.5) * seg - w / 2;
      if (cx < lastEnd + 6 * u || cx + w > bx2 + bw2 + 4 * u) continue;
      ctx.fillText(txt, cx, by2 + bh2 + 17 * u);
      lastEnd = cx + w;
    }
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
