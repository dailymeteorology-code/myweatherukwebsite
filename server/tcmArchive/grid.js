/* The NOVA grids, read on the server: a stored field (zlib-compressed float16, row 0 = south) as
   numbers, and a strike's lat/lon as a cell of the British National Grid the runs are made on. */
import zlib from 'node:zlib';

function half(u) {
  const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
/* every float16 value, once */
const HALF = (() => { const t = new Float32Array(65536); for (let u = 0; u < 65536; u += 1) t[u] = half(u); return t; })();

/** A stored field file as a Float32Array. */
export function decodeField(buf, dtype = 'float16') {
  const raw = zlib.inflateSync(buf);
  if (dtype === 'int8') return Float32Array.from(new Int8Array(raw.buffer, raw.byteOffset, raw.length));
  const out = new Float32Array(raw.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = HALF[raw[2 * i] | (raw[2 * i + 1] << 8)];
  return out;
}

/* WGS84 lat/lon to British National Grid metres: the OS transverse Mercator on the Airy 1830
   ellipsoid without the datum shift, about 100 m out, well inside a 1.5–2 km cell. */
const A = 6377563.396, B = 6356256.909, F0 = 0.9996012717, PHI0 = 49 * Math.PI / 180, LAM0 = -2 * Math.PI / 180;
const N0 = -100000, E0 = 400000, E2 = 1 - (B * B) / (A * A), NN = (A - B) / (A + B);
export function toBNG(lat, lon) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const nu = A * F0 / Math.sqrt(1 - E2 * s * s);
  const rho = A * F0 * (1 - E2) / (1 - E2 * s * s) ** 1.5;
  const eta2 = nu / rho - 1;
  const d = phi - PHI0, p = phi + PHI0;
  const M = B * F0 * ((1 + NN + 1.25 * NN ** 2 + 1.25 * NN ** 3) * d
    - (3 * NN + 3 * NN ** 2 + 2.625 * NN ** 3) * Math.sin(d) * Math.cos(p)
    + (1.875 * NN ** 2 + 1.875 * NN ** 3) * Math.sin(2 * d) * Math.cos(2 * p)
    - (35 / 24) * NN ** 3 * Math.sin(3 * d) * Math.cos(3 * p));
  const I = M + N0;
  const II = nu / 2 * s * c;
  const III = nu / 24 * s * c ** 3 * (5 - t * t + 9 * eta2);
  const IIIA = nu / 720 * s * c ** 5 * (61 - 58 * t * t + t ** 4);
  const IV = nu * c;
  const V = nu / 6 * c ** 3 * (nu / rho - t * t);
  const VI = nu / 120 * c ** 5 * (5 - 18 * t * t + t ** 4 + 14 * eta2 - 58 * t * t * eta2);
  const L = lam - LAM0;
  return [E0 + IV * L + V * L ** 3 + VI * L ** 5, I + II * L ** 2 + III * L ** 4 + IIIA * L ** 6];
}

/** The cell index a lat/lon falls in on `grid` (a manifest's grid), or -1 off the grid. */
export function cellOf(grid, lat, lon) {
  const [x, y] = toBNG(lat, lon);
  const i = Math.floor((x - grid.x0) / grid.dx_m), j = Math.floor((y - grid.y0) / grid.dx_m);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return -1;
  return j * grid.nx + i;
}
