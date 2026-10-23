/* TCM NOVA for the thunderstorm graphic (and the risk overlay on Model Data): a Main Run or a
   Hyper-Short run turned into what the graphic is made of. Its thunderstorm probability becomes
   editable risk areas (contoured at the graphic's own key, so an area marked SLGT 22-34% really
   is 22-34% in NOVA), its frames fill the timeline, and its hazard probabilities give the Hazards
   card its percentages.

   NOVA's fields sit on a British National Grid (2 km Main Run, 1.5 km Hyper-Short; row 0 =
   south) and come from /api/nova
   (admin only, like the NOVA page): zlib-compressed float16, or int8. Everything here is the
   peak or the average over a whole London day (a day's peak comes straight from the run's day
   summaries), the timeline's window or any span of dates and times (the frames inside it),
   inside the graphic's map view when it is zoomed to a region. */
import { contours } from 'd3-contour';
import { coarsenMax, detectEvents, timeRing } from '@/lib/areaEvents';

const authHeaders = () => {
  try { const t = localStorage.getItem('base44_access_token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
};
async function novaGet(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401 || r.status === 403) throw new Error('TCM NOVA needs an admin session.');
  if (!r.ok) throw new Error(r.status === 404 ? 'No published TCM NOVA run yet.' : `TCM NOVA: ${r.status}`);
  return r;
}

/** The newest published Main Run's manifest: grid, frames (3-hourly, `valid`), days. */
export async function novaLatest() {
  return (await novaGet('/api/nova/main/latest')).json();
}

/** Every Main Run and Hyper-Short run made in the last `hours`, newest first:
    [{ product, run_id, init_utc, horizon_h, frames }]. */
export async function novaRecentRuns(hours = 48) {
  const since = Date.now() - hours * 3600e3;
  const lists = await Promise.all(['main', 'hyper'].map(async (p) => {
    try { return (await (await novaGet(`/api/nova/${p}/runs`)).json()).runs || []; } catch { return []; }
  }));
  return lists.flat().filter((r) => r.status !== 'failed' && Date.parse(r.init_utc) >= since)
    .sort((a, b) => Date.parse(b.init_utc) - Date.parse(a.init_utc));
}

/** One run's manifest (a Main Run's or a Hyper-Short run's), knowing its product. */
export async function novaRun(product, id) {
  return { product, ...(await (await novaGet(`/api/nova/${product}/runs/${id}`)).json()) };
}

/** "Main Run 14Z Thu 23 Oct" / "Hyper-Short 15:30Z Thu 23 Oct" */
export function runName(r) {
  const t = new Date(r.init_utc);
  const hh = String(t.getUTCHours()).padStart(2, '0'), mm = t.getUTCMinutes();
  const at = r.product === 'hyper' ? `${hh}:${String(mm).padStart(2, '0')}Z` : `${hh}Z`;
  return `${r.product === 'hyper' ? 'Hyper-Short' : 'Main Run'} ${at} ${t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

function f16(u) {
  const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
const FIELDS = new Map();
/** One field: a day summary ({ day }) or one frame ({ lead }), decoded to Float32Array. */
export function novaField(m, { day, lead }, name) {
  const prod = m.product === 'hyper' ? 'hyper' : 'main';
  const url = day != null ? `/api/nova/${prod}/runs/${m.run_id}/day/${day}/${name}` : `/api/nova/${prod}/runs/${m.run_id}/frame/${lead}/${name}`;
  if (FIELDS.has(url)) return FIELDS.get(url);
  const p = (async () => {
    const r = await novaGet(url);
    const dtype = r.headers.get('X-Nova-Dtype');
    const buf = await new Response(r.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    if (dtype === 'int8') return Float32Array.from(new Int8Array(buf));
    const u = new Uint16Array(buf), out = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) out[i] = f16(u[i]);
    return out;
  })();
  FIELDS.set(url, p);
  p.catch(() => FIELDS.delete(url));
  while (FIELDS.size > 48) FIELDS.delete(FIELDS.keys().next().value);
  return p;
}

/* ── British National Grid (Airy 1830 transverse Mercator, no datum shift: ~100 m, far
   below the 2 km cells) ─────────────────────────────────────────────────────────────────── */
const A = 6377563.396, B = 6356256.909, F0 = 0.9996012717, LAT0 = 49 * Math.PI / 180, LON0 = -2 * Math.PI / 180;
const N0 = -100000, E0 = 400000, E2 = 1 - (B * B) / (A * A), NN = (A - B) / (A + B);
function meridional(p) {
  const dp = p - LAT0, sp = p + LAT0, n = NN;
  return B * F0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dp - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dp) * Math.cos(sp)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp) - (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp));
}
/** BNG easting/northing (m) -> [lat, lon] (degrees), the OS's inverse. */
export function fromBNG(E, N) {
  let p = LAT0, M = 0;
  do { p = (N - N0 - M) / (A * F0) + p; M = meridional(p); } while (Math.abs(N - N0 - M) >= 0.01);
  const sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const nu = A * F0 / Math.sqrt(1 - E2 * sp * sp), rho = A * F0 * (1 - E2) / (1 - E2 * sp * sp) ** 1.5, eta2 = nu / rho - 1;
  const VII = tp / (2 * rho * nu), VIII = tp / (24 * rho * nu ** 3) * (5 + 3 * tp * tp + eta2 - 9 * tp * tp * eta2), IX = tp / (720 * rho * nu ** 5) * (61 + 90 * tp * tp + 45 * tp ** 4);
  const X = 1 / (cp * nu), XI = 1 / (cp * 6 * nu ** 3) * (nu / rho + 2 * tp * tp), XII = 1 / (cp * 120 * nu ** 5) * (5 + 28 * tp * tp + 24 * tp ** 4);
  const XIIA = 1 / (cp * 5040 * nu ** 7) * (61 + 662 * tp * tp + 1320 * tp ** 4 + 720 * tp ** 6);
  const dE = E - E0;
  const lat = p - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lon = LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

/** 1 for the cells whose centre is inside a lon/lat box (null box: every cell). */
const MASKS = new Map();
export function boxMask(grid, box) {
  const key = box ? `${grid.name}|${box.lonMin}|${box.lonMax}|${box.latMin}|${box.latMax}` : null;
  if (!key) return null;
  if (MASKS.has(key)) return MASKS.get(key);
  const { nx, ny, x0, y0, dx_m: dx } = grid;
  const m = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [lat, lon] = fromBNG(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dx);
      if (lon >= box.lonMin && lon <= box.lonMax && lat >= box.latMin && lat <= box.latMax) m[j * nx + i] = 1;
    }
  }
  MASKS.set(key, m);
  return m;
}

/* NaN-aware box blur of radius r cells, twice (close to a Gaussian) */
function smooth(data, grid, r) {
  if (r < 1) return data;
  const { nx, ny } = grid;
  let a = data;
  for (let pass = 0; pass < 2; pass++) {
    const h = new Float32Array(a.length), out = new Float32Array(a.length);
    for (let y = 0; y < ny; y++) {
      const o = y * nx;
      for (let x = 0; x < nx; x++) {
        let s = 0, c = 0;
        for (let k = Math.max(0, x - r), e = Math.min(nx - 1, x + r); k <= e; k++) { const v = a[o + k]; if (v === v) { s += v; c++; } }
        h[o + x] = c ? s / c : NaN;
      }
    }
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        let s = 0, c = 0;
        for (let k = Math.max(0, y - r), e = Math.min(ny - 1, y + r); k <= e; k++) { const v = h[k * nx + x]; if (v === v) { s += v; c++; } }
        out[y * nx + x] = c ? s / c : NaN;
      }
    }
    a = out;
  }
  return a;
}
/* the highest value within r cells (a square), NaN-aware: spreads each area outwards */
function grow(data, grid, r) {
  if (r < 1) return data;
  const { nx, ny } = grid, h = new Float32Array(data.length), out = new Float32Array(data.length);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let m = NaN;
    for (let k = Math.max(0, x - r), e = Math.min(nx - 1, x + r); k <= e; k++) { const v = data[y * nx + k]; if (v > m || m !== m) m = v; }
    h[y * nx + x] = m;
  }
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
    let m = NaN;
    for (let k = Math.max(0, y - r), e = Math.min(ny - 1, y + r); k <= e; k++) { const v = h[k * nx + x]; if (v > m || m !== m) m = v; }
    out[y * nx + x] = m;
  }
  return out;
}

/** How imported areas are shaped, in km: `grow` spreads each area out first, `blur` smooths the
    field, areas under `minKm2` are dropped and outlines are simplified to about `tolKm`.
    Detailed is NOVA's own look (about 6 km smoothing); Smooth and Broad are what a forecaster
    draws by hand, fewer and rounder areas that cover a little more ground. */
export const SHAPES = {
  detailed: { label: 'Detailed', grow: 0, blur: 8, minKm2: 120, tolKm: 1.1 },
  smooth: { label: 'Smooth', grow: 4, blur: 18, minKm2: 500, tolKm: 2.5 },
  broad: { label: 'Broad', grow: 12, blur: 36, minKm2: 1800, tolKm: 4.5 },
};

/* Douglas-Peucker in grid cells */
function simplify(ring, tol) {
  const n = ring.length;
  if (n <= 4) return ring;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = ring[a], [bx, by] = ring[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol * tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); };

/** Contours a probability field (0..1) at each level's threshold: [{ id, areas: [{ ring: [[lat,
    lon]], from?, to? }] }], lowest level first, shaped by SHAPES[shape]. Outside the mask counts
    as zero, so areas close at the view's edge. With `timing` (timingFrames), each area is matched
    with the run's frames to give its first and last times, and an area two separate spells share
    is cut in two (lib/areaEvents). */
export function contourLevels(data, grid, levels, mask = null, shape = 'detailed', timing = null) {
  const sh = SHAPES[shape] || SHAPES.detailed, km = grid.dx_m / 1000;
  const cells = (k) => Math.round(k / km / 2);          // a radius for a width in km
  const sm = smooth(grow(data, grid, cells(sh.grow)), grid, Math.max(1, cells(sh.blur)));
  const v = new Float64Array(data.length);
  for (let i = 0; i < v.length; i++) v[i] = (mask && !mask[i]) || !(sm[i] === sm[i]) ? 0 : sm[i];
  const gen = contours().size([grid.nx, grid.ny]).smooth(true);
  const minArea = sh.minKm2 / (km * km);
  const out = [];
  for (const lv of levels) {
    const mp = gen.contour(v, lv.min);
    const events = timing && detectEvents(timing.frames, timing.w, timing.h, lv.min, timing.opts);
    const areas = [];
    for (const poly of mp.coordinates) {
      const outer = poly[0];
      if (!outer || outer.length < 4 || ringArea(outer) < minArea) continue;   // speckle, not an outlook area
      const parts = events ? timeRing(outer, events, { v, nx: grid.nx, ny: grid.ny, c: timing.c, w: timing.w, h: timing.h, thr: lv.min, minArea: minArea / 2 }) : [{ ring: outer }];
      for (const p of parts) {
        areas.push({ ring: simplify(p.ring, sh.tolKm / km).map(([x, y]) => fromBNG(grid.x0 + x * grid.dx_m, grid.y0 + y * grid.dx_m)), from: p.from, to: p.to });
      }
    }
    if (areas.length) out.push({ id: lv.id, areas });
  }
  return out;
}

/** A run's frames of a field through a span, coarsened 4 times (8 km) for timing areas: null
    with fewer than two frames, when there is nothing to tell apart. */
export async function timingFrames(m, frames, name, mask = null) {
  if (frames.length < 2) return null;
  const { nx, ny } = m.grid, c = 4, w = Math.ceil(nx / c), h = Math.ceil(ny / c);
  const data = await Promise.all(frames.map(async (f) => ({ t: f.t, data: coarsenMax(await novaField(m, { lead: f.lead }, name), nx, ny, c, w, h) })));
  const cm = mask ? coarsenMax(Float32Array.from(mask), nx, ny, c, w, h).map((x) => (x > 0 ? 1 : 0)) : null;
  const km = (m.grid.dx_m / 1000) * c;
  return { frames: data, c, w, h, opts: { link: Math.max(1, Math.round(24 / km)), mask: cm, minCells: 2 } };
}

/** The highest value of a field inside the mask (or anywhere). */
export function peak(data, mask = null) {
  let best = 0;
  for (let i = 0; i < data.length; i++) { const x = data[i]; if (x > best && (!mask || mask[i])) best = x; }
  return best;
}

/** Frames whose valid time falls in [from, to) ms, or the nearest within 3 h for a short window. */
export function framesIn(m, from, to) {
  const fr = (m.frames || []).filter((f) => f.valid).map((f) => ({ lead: f.lead_min, t: Date.parse(f.valid) }));
  const inside = fr.filter((f) => f.t >= from && f.t < to);
  if (inside.length) return inside;
  const mid = (from + to) / 2;
  const near = fr.reduce((b, f) => (b == null || Math.abs(f.t - mid) < Math.abs(b.t - mid) ? f : b), null);
  return near && Math.abs(near.t - mid) <= 3 * 3600e3 ? [near] : [];
}

/** A field over several frames, cell by cell: the peak ('peak') or the average ('mean'). */
export async function framesStat(m, frames, name, how = 'peak') {
  const all = await Promise.all(frames.map((f) => novaField(m, { lead: f.lead }, name)));
  const n = all[0].length, out = new Float32Array(n).fill(NaN);
  if (how === 'mean') {
    const cnt = new Uint16Array(n);
    for (const a of all) for (let i = 0; i < n; i++) { const x = a[i]; if (x === x) { out[i] = cnt[i] ? out[i] + x : x; cnt[i]++; } }
    for (let i = 0; i < n; i++) if (cnt[i]) out[i] /= cnt[i];
    return out;
  }
  for (const a of all) for (let i = 0; i < n; i++) { const x = a[i]; if (x === x && !(x <= out[i])) out[i] = x; }
  return out;
}

/* ── the risk overlay on Model Data ───────────────────────────────────────────────────────── */

/** The outlook graphics' key: each level's lower bound and colour (TSTM 5 % … HIGH 65 %). */
export const RISK_KEY = [
  { id: 'Very Low', short: 'TSTM', min: 0.05, colour: '#60a5fa' },
  { id: 'Low', short: 'MRGL', min: 0.12, colour: '#86efac' },
  { id: 'Marginal', short: 'SLGT', min: 0.22, colour: '#facc15' },
  { id: 'Slight', short: 'ENH', min: 0.35, colour: '#fb923c' },
  { id: 'Moderate', short: 'MDT', min: 0.5, colour: '#f87171' },
  { id: 'High', short: 'HIGH', min: 0.65, colour: '#a78bfa' },
];

/** 'YYYY-MM-DD' in London for a time (ms). */
export const londonDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
/* the instant London's day starts: at 00:00 UTC London is on that midnight's own offset */
const londonMidnight = (day) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return t - Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false })) * 3600e3;
};
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** A run's thunderstorm risk at the graphic key over a London `day` or a span [from, to) (ms):
    { peak, levels: [{ id, colour, areas: [{ ring: [[lat, lon]] }] }] }, lowest level first, or
    null when the run does not reach that time. A Main Run's day comes from its day summary,
    anything else is the peak of the frames inside. `shape`: 'smooth' (the graphics' look) or
    'detailed' (NOVA's own outlines). */
export async function riskAreas(m, { day, from, to }, shape = 'smooth') {
  const summary = day && (m.days || []).some((d) => d.date === day && d.fields?.includes('p_thunder'));
  let data;
  if (summary) data = await novaField(m, { day }, 'p_thunder');
  else {
    const [a, b] = day ? [londonMidnight(day), londonMidnight(nextDay(day))] : [from, to];
    const inside = (m.frames || []).filter((f) => f.valid && Date.parse(f.valid) >= a && Date.parse(f.valid) < b);
    if (!inside.length) return null;
    data = await framesStat(m, inside.map((f) => ({ lead: f.lead_min, t: Date.parse(f.valid) })), 'p_thunder', 'peak');
  }
  const levels = contourLevels(data, m.grid, RISK_KEY.map(({ id, min }) => ({ id, min })), null, shape);
  return { peak: peak(data), levels: levels.map((l) => ({ ...l, colour: RISK_KEY.find((k) => k.id === l.id).colour })) };
}
