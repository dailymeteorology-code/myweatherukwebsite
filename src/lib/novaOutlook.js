/* TCM NOVA for the thunderstorm graphic: the newest Main Run turned into what the graphic is
   made of. Its thunderstorm probability becomes editable risk areas (contoured at the graphic's
   own key, so an area marked SLGT 22-34% really is 22-34% in NOVA), its 3-hourly frames fill the
   timeline, and its hazard probabilities give the Hazards card its percentages.

   NOVA's fields sit on a 2 km British National Grid (row 0 = south) and come from /api/nova
   (admin only, like the NOVA page): zlib-compressed float16, or int8. Everything here is the
   peak over a whole London day (the run's day summaries) or over the timeline's window (the
   frames inside it), inside the graphic's map view when it is zoomed to a region. */
import { contours } from 'd3-contour';

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

function f16(u) {
  const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
const FIELDS = new Map();
/** One field: a day summary ({ day }) or one frame ({ lead }), decoded to Float32Array. */
export function novaField(m, { day, lead }, name) {
  const url = day != null ? `/api/nova/main/runs/${m.run_id}/day/${day}/${name}` : `/api/nova/main/runs/${m.run_id}/frame/${lead}/${name}`;
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

/* ~6 km smoothing, the way NOVA's page draws its levels: a NaN-aware box blur, twice */
function smooth(data, grid) {
  const { nx, ny } = grid, r = Math.max(1, Math.round(3000 / grid.dx_m));
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

/** Contours a probability field (0..1) at each level's threshold: [{ id, rings: [[[lat, lon]]] }],
    lowest level first. Outside the mask counts as zero, so areas close at the view's edge. */
export function contourLevels(data, grid, levels, mask = null) {
  const v = new Float64Array(data.length);
  const sm = smooth(data, grid);
  for (let i = 0; i < v.length; i++) v[i] = (mask && !mask[i]) || !(sm[i] === sm[i]) ? 0 : sm[i];
  const gen = contours().size([grid.nx, grid.ny]).smooth(true);
  const out = [];
  for (const lv of levels) {
    const mp = gen.contour(v, lv.min);
    const rings = [];
    for (const poly of mp.coordinates) {
      const outer = poly[0];
      if (!outer || outer.length < 4 || ringArea(outer) < 30) continue;   // under ~120 km²: speckle, not an outlook area
      rings.push(simplify(outer, 0.55).map(([x, y]) => fromBNG(grid.x0 + x * grid.dx_m, grid.y0 + y * grid.dx_m)));
    }
    if (rings.length) out.push({ id: lv.id, rings });
  }
  return out;
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

/** The peak of a field over several frames, cell by cell. */
export async function framesPeak(m, frames, name) {
  const all = await Promise.all(frames.map((f) => novaField(m, { lead: f.lead }, name)));
  const out = new Float32Array(all[0].length).fill(NaN);
  for (const a of all) for (let i = 0; i < a.length; i++) { const x = a[i]; if (x === x && !(x <= out[i])) out[i] = x; }
  return out;
}
