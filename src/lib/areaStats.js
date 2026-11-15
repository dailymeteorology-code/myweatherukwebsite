/* The numbers for an area on Model Data's map (15 Nov 2026, at the user's request: a county's
   stats when it is outlined, and an area of your own): which of the grid's cells lie inside an
   outline, and the highest, lowest and average of a frame over them. Every number is a cell's own
   value from the frame (never smoothed or blended), with the cell it came from, so the card can
   say where. */
import { GRIDS } from '@/lib/modelGrids';

/** The cells (j * nx + i) whose centres lie inside an outline (rings in grid coordinates, even-odd
    so lakes and enclaves are left out), by scanlines. An area too small to hold a cell's centre
    (a small county on the 10 km map) gets the cell nearest its middle. */
export function maskCells(rings, grid) {
  const g = GRIDS[grid];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0, n = 0;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    sx += x; sy += y; n++;
  }
  if (!n) return [];
  const i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(g.nx - 1, Math.ceil(x1));
  const j0 = Math.max(0, Math.floor(y0)), j1 = Math.min(g.ny - 1, Math.ceil(y1));
  const out = [];
  for (let j = j0; j <= j1; j++) {
    const xs = [];
    for (const r of rings) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, ya] = r[a], [xb, yb] = r[b];
        if ((ya > j) !== (yb > j)) xs.push(xa + ((j - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(i0, Math.ceil(xs[k])); i <= Math.min(i1, Math.floor(xs[k + 1])); i++) out.push(j * g.nx + i);
    }
  }
  if (!out.length) {
    const i = Math.round(sx / n), j = Math.round(sy / n);
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) out.push(j * g.nx + i);
  }
  return out;
}

/** A frame's value in one display cell (frames on the display grid, or coarse ones: every k-th cell). */
function cellValue(f, c, nx) {
  if (!f.nx) return f.table[f.q[c]];
  const K = f.k || 1, i = Math.floor((c % nx) / K), j = Math.floor(Math.floor(c / nx) / K);
  return i < f.nx && j < f.ny ? f.table[f.q[j * f.nx + i]] : NaN;
}

/** Highest, lowest and average of a frame over the cells, with where the extremes are, and the share
    of the cells at or above `wet` (for rain and snow: how much of the area has any). */
export function areaStats(f, cells, grid, wet = null) {
  if (!f?.q || !cells?.length) return null;
  const nx = GRIDS[grid].nx;
  let min = Infinity, max = -Infinity, sum = 0, n = 0, imin = -1, imax = -1, nwet = 0;
  for (const c of cells) {
    const v = cellValue(f, c, nx);
    if (!Number.isFinite(v)) continue;
    n++; sum += v;
    if (v < min) { min = v; imin = c; }
    if (v > max) { max = v; imax = c; }
    if (wet != null && v >= wet) nwet++;
  }
  if (!n) return null;
  return { min, max, mean: sum / n, n, wetShare: wet != null ? nwet / n : null,
    at: (c) => ({ gx: c % nx, gy: Math.floor(c / nx) }), imin, imax };
}

/** The share of the cells in each kind of precipitation (the typed rate's codes: 1 + 63 x kind + level). */
export function typedShares(f, cells, grid) {
  if (!f?.q || !cells?.length) return null;
  const nx = GRIDS[grid].nx, count = [0, 0, 0, 0];
  let n = 0;
  for (const c of cells) {
    const v = cellValue(f, c, nx);
    if (!Number.isFinite(v)) continue;
    n++;
    if (v >= 1) count[Math.min(3, Math.floor((v - 1) / 63))]++;
  }
  return n ? count.map((k) => k / n) : null;
}
