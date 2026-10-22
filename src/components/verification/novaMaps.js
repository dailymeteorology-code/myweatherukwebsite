/* The TCM NOVA maps for the Verification pages: an archived field, read from /api/tcm-archive,
   drawn as an image over the UK & Ireland in Web Mercator (the projection of the Leaflet maps it
   sits on), and the value at a point. A field is float16, zlib-compressed, on the British National
   Grid, row 0 = south. */

/* the session goes with every archive request: an admin also gets runs under a day old */
export const authHeaders = () => {
  try { const t = localStorage.getItem('base44_access_token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
};
export async function archiveJson(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/* ── fields ── */
const HALF = (() => {
  const t = new Float32Array(65536);
  for (let u = 0; u < 65536; u += 1) {
    const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
    t[u] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return t;
})();
const fieldCache = new Map();
/** One archived field (a frame's, or a whole day's) as a Float32Array; the last few are kept. */
export function fetchField(url) {
  if (fieldCache.has(url)) return fieldCache.get(url);
  const p = (async () => {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw new Error(`${r.status}`);
    const dtype = r.headers.get('X-Nova-Dtype');
    const buf = await new Response(r.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    if (dtype === 'int8') return Float32Array.from(new Int8Array(buf));
    const u = new Uint16Array(buf), out = new Float32Array(u.length);
    for (let i = 0; i < u.length; i += 1) out[i] = HALF[u[i]];
    return out;
  })();
  p.catch(() => fieldCache.delete(url));
  fieldCache.set(url, p);
  if (fieldCache.size > 24) fieldCache.delete(fieldCache.keys().next().value);
  return p;
}

/* ── where things are ── */
/* WGS84 lat/lon to British National Grid metres (OS transverse Mercator on Airy 1830, no datum
   shift: about 100 m out, far inside a 1.5–2 km cell) */
export function toBNG(lat, lon) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717, phi0 = 49 * Math.PI / 180, lam0 = -2 * Math.PI / 180;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const nu = a * F0 / Math.sqrt(1 - e2 * s * s), rho = a * F0 * (1 - e2) / (1 - e2 * s * s) ** 1.5, eta2 = nu / rho - 1;
  const d = phi - phi0, p = phi + phi0;
  const M = b * F0 * ((1 + n + 1.25 * n ** 2 + 1.25 * n ** 3) * d - (3 * n + 3 * n ** 2 + 2.625 * n ** 3) * Math.sin(d) * Math.cos(p)
    + (1.875 * n ** 2 + 1.875 * n ** 3) * Math.sin(2 * d) * Math.cos(2 * p) - (35 / 24) * n ** 3 * Math.sin(3 * d) * Math.cos(3 * p));
  const L = lam - lam0;
  const N = M - 100000 + nu / 2 * s * c * L ** 2 + nu / 24 * s * c ** 3 * (5 - t * t + 9 * eta2) * L ** 4 + nu / 720 * s * c ** 5 * (61 - 58 * t * t + t ** 4) * L ** 6;
  const E = 400000 + nu * c * L + nu / 6 * c ** 3 * (nu / rho - t * t) * L ** 3 + nu / 120 * c ** 5 * (5 - 18 * t * t + t ** 4 + 14 * eta2 - 58 * t * t * eta2) * L ** 5;
  return [E, N];
}

/** The field's value at a point (nearest cell), or null off the grid. */
export function valueAt(data, grid, lat, lon) {
  const [x, y] = toBNG(lat, lon);
  const i = Math.floor((x - grid.x0) / grid.dx_m), j = Math.floor((y - grid.y0) / grid.dx_m);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return null;
  const v = data[j * grid.nx + i];
  return Number.isFinite(v) ? v : null;
}

/** The box the field images cover: [[south, west], [north, east]]. */
export const MAP_BOUNDS = [[49.5, -11.6], [61.2, 2.4]];
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
/* each image pixel's BNG position, worked out once per image size */
const pixelCache = new Map();
function pixelsBNG(w, h) {
  const key = `${w}x${h}`;
  if (pixelCache.has(key)) return pixelCache.get(key);
  const [[s, west], [n, east]] = MAP_BOUNDS;
  const y0 = merc(s), y1 = merc(n);
  const xs = new Float64Array(w * h), ys = new Float64Array(w * h);
  for (let j = 0; j < h; j += 1) {
    const lat = (2 * Math.atan(Math.exp(y1 - ((j + 0.5) / h) * (y1 - y0))) - Math.PI / 2) * 180 / Math.PI;
    for (let i = 0; i < w; i += 1) {
      const [x, y] = toBNG(lat, west + ((i + 0.5) / w) * (east - west));
      xs[j * w + i] = x; ys[j * w + i] = y;
    }
  }
  const out = { xs, ys };
  pixelCache.set(key, out);
  return out;
}

/* ── how a field is coloured ── */
/** The TCM risk levels, on a probability. */
export const LEVELS = [
  { key: 'TSTM', label: 'General thunder', p: 0.02, rgb: [56, 189, 248] },
  { key: 'MRGL', label: 'Marginal', p: 0.05, rgb: [34, 197, 94] },
  { key: 'SLGT', label: 'Slight', p: 0.15, rgb: [234, 179, 8] },
  { key: 'ENH', label: 'Enhanced', p: 0.3, rgb: [249, 115, 22] },
  { key: 'MDT', label: 'Moderate', p: 0.45, rgb: [239, 68, 68] },
  { key: 'HIGH', label: 'High', p: 0.6, rgb: [168, 85, 247] },
];
export const levelOf = (p) => { let L = null; for (const x of LEVELS) if (p >= x.p) L = x; return L; };
export const levelColour = (L, a = 1) => (L ? `rgba(${L.rgb.join(',')},${a})` : 'rgba(148,163,184,1)');

const PROB = [[0.02, [56, 189, 248, 0]], [0.05, [56, 189, 248, 95]], [0.15, [74, 222, 128, 135]], [0.3, [250, 204, 21, 155]],
  [0.45, [249, 115, 22, 168]], [0.6, [239, 68, 68, 176]], [0.75, [219, 39, 119, 182]], [0.9, [192, 38, 211, 186]]];
const FLASH = [[0.005, [250, 204, 21, 0]], [0.02, [250, 204, 21, 170]], [0.1, [249, 115, 22, 200]], [0.5, [220, 38, 38, 220]], [2, [168, 85, 247, 235]]];
/** Every field the archive keeps: its name, unit and colours. `risk` fields can be drawn as levels. */
export const FIELDS = {
  p_thunder: { label: 'Thunderstorms', long: 'Thunderstorm probability', pct: true, stops: PROB, risk: true },
  p_lightning: { label: 'Lightning', long: 'Lightning probability', pct: true, stops: PROB, risk: true },
  p_hail: { label: 'Hail', long: 'Hail of 2 cm or more', pct: true, stops: PROB, risk: true },
  p_hail_sig: { label: 'Large hail', long: 'Hail of 4 cm or more', pct: true, stops: PROB, risk: true },
  p_wind_damaging: { label: 'Damaging gusts', long: 'Damaging gust probability', pct: true, stops: PROB, risk: true },
  p_downburst: { label: 'Downbursts', long: 'Downburst probability', pct: true, stops: PROB, risk: true },
  p_tornado_env: { label: 'Tornado environment', long: 'Tornado-environment probability', pct: true, stops: PROB, risk: true },
  p_heavy_rain: { label: 'Heavy rain', long: 'Heavy rain probability', pct: true, stops: PROB, risk: true },
  p_severe: { label: 'Severe (any)', long: 'Severe-weather probability', pct: true, stops: PROB, risk: true },
  p_initiation: { label: 'Initiation', long: 'Storm initiation probability', pct: true, stops: PROB, risk: true },
  p_rain: { label: 'Rain', long: 'Rain of 1 mm/h or more', pct: true, stops: PROB, risk: true },
  flash_density: { label: 'Flash density', long: 'Lightning flash density', unit: '/km²/h', stops: FLASH },
  lightning_jump: { label: 'Lightning jump', long: 'Lightning jump (rising flash rate)', unit: '/km²/h', stops: FLASH },
  precip: { label: 'Rain rate', long: 'Precipitation rate', unit: 'mm/h', stops: [[0.1, [147, 197, 253, 0]], [0.3, [96, 165, 250, 170]], [1, [37, 99, 235, 200]], [4, [250, 204, 21, 210]], [10, [249, 115, 22, 220]], [25, [220, 38, 38, 230]], [50, [168, 85, 247, 235]]] },
  precip_accum: { label: 'Rain total', long: 'Accumulated precipitation', unit: 'mm', stops: [[0.5, [147, 197, 253, 0]], [2, [96, 165, 250, 160]], [10, [37, 99, 235, 195]], [25, [250, 204, 21, 205]], [50, [239, 68, 68, 220]], [100, [168, 85, 247, 230]]] },
  mu_cape: { label: 'CAPE', long: 'Most-unstable CAPE', unit: 'J/kg', stops: [[50, [254, 240, 138, 0]], [150, [254, 240, 138, 150]], [400, [251, 191, 36, 180]], [800, [249, 115, 22, 200]], [1500, [220, 38, 38, 215]], [2500, [168, 85, 247, 230]]] },
  shear_0_6km: { label: 'Shear', long: '0–6 km bulk shear', unit: 'kt', mul: 1.944, stops: [[10, [203, 213, 225, 0]], [20, [125, 211, 252, 150]], [30, [74, 222, 128, 175]], [40, [250, 204, 21, 195]], [50, [249, 115, 22, 210]], [60, [220, 38, 38, 225]]] },
  gust_max: { label: 'Gusts', long: 'Maximum gust', unit: 'mph', mul: 2.237, stops: [[25, [148, 163, 184, 0]], [35, [125, 211, 252, 150]], [45, [250, 204, 21, 190]], [58, [249, 115, 22, 210]], [70, [220, 38, 38, 225]]] },
  uncertainty: { label: 'Uncertainty', long: 'Forecast uncertainty', pct: true, stops: [[0.1, [74, 222, 128, 0]], [0.3, [250, 204, 21, 120]], [0.5, [249, 115, 22, 170]], [0.7, [220, 38, 38, 210]]] },
  confidence: { label: 'Confidence', long: 'Forecast confidence', pct: true, stops: [[0, [239, 68, 68, 140]], [0.4, [250, 204, 21, 110]], [0.7, [74, 222, 128, 90]], [1, [74, 222, 128, 0]]] },
};
export const valueText = (v, f) => (v == null ? '—' : f.pct ? `${Math.round(v * 100)}%` : `${(v * (f.mul || 1)).toFixed(v * (f.mul || 1) >= 10 ? 0 : 1)} ${f.unit}`);

function rampAt(stops, v) {
  if (!(v >= stops[0][0])) return null;
  for (let k = stops.length - 1; k >= 0; k -= 1) {
    if (v >= stops[k][0]) {
      if (k === stops.length - 1) return stops[k][1];
      const [a, ca] = stops[k], [b, cb] = stops[k + 1], t = (v - a) / (b - a);
      return ca.map((c, i) => c + (cb[i] - c) * t);
    }
  }
  return null;
}

/** The field as a canvas over MAP_BOUNDS, `w` x `h`. As `levels`, a probability is drawn in the
    TCM risk levels with a darker edge where one meets a lower one, like a drawn outlook. */
export function renderField(data, grid, field, { w = 760, h = 1000, levels = false } = {}) {
  const { xs, ys } = pixelsBNG(w, h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const mul = field.pct ? 1 : (field.mul || 1);
  const lv = levels ? new Int8Array(w * h).fill(-1) : null;
  for (let k = 0; k < xs.length; k += 1) {
    const fx = (xs[k] - grid.x0) / grid.dx_m - 0.5, fy = (ys[k] - grid.y0) / grid.dx_m - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= grid.nx - 1 || iy >= grid.ny - 1) continue;
    const tx = fx - ix, ty = fy - iy, i0 = iy * grid.nx + ix, i1 = i0 + grid.nx;
    const a = data[i0], b = data[i0 + 1], c = data[i1], d = data[i1 + 1];
    const v = Number.isFinite(a + b + c + d) ? ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * mul : data[Math.round(fy) * grid.nx + Math.round(fx)] * mul;
    if (lv) {
      for (let q = 0; q < LEVELS.length && v >= LEVELS[q].p; q += 1) lv[k] = q;
      continue;
    }
    const col = rampAt(field.stops, v);
    if (!col) continue;
    px[k * 4] = col[0]; px[k * 4 + 1] = col[1]; px[k * 4 + 2] = col[2]; px[k * 4 + 3] = col[3];
  }
  if (lv) {
    for (let k = 0; k < lv.length; k += 1) {
      const q = lv[k];
      if (q < 0) continue;
      const i = k % w;
      const edge = (i > 0 && lv[k - 1] < q) || (i < w - 1 && lv[k + 1] < q) || (k >= w && lv[k - w] < q) || (k + w < lv.length && lv[k + w] < q);
      const [r, g, b] = LEVELS[q].rgb, f = edge ? 0.62 : 1;
      px[k * 4] = r * f; px[k * 4 + 1] = g * f; px[k * 4 + 2] = b * f; px[k * 4 + 3] = edge ? 235 : 150 + q * 6;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* ── time ── */
export const london = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', ...opts });
export const hhmm = (iso) => london(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dayLong = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayShort = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Strikes from the lightning archive (Met Office over the UK & Ireland) between two times, as [t, lat, lon]. */
export async function fetchStrikes(from, to) {
  const q = typeof from === 'string' ? `day=${from}` : `from=${from}&to=${to}`;
  const r = await fetch(`/api/lightning/strikes?${q}&uk=mo&region=uk`);
  if (!r.ok) throw new Error(`${r.status}`);
  const j = await r.json();
  const out = [];
  for (let k = 0; k < j.strikes.length; k += 4) out.push([j.strikes[k], j.strikes[k + 1], j.strikes[k + 2]]);
  return { strikes: out, total: j.total, thinned: j.thinned };
}
