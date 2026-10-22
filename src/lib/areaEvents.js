/* Which imported area comes first, second, third… for the TCM NOVA and model imports.

   The frames through the import's span, coarsened to about 8 km (or the ensemble's own 16 km),
   are cut into EVENTS for each level: places past the level's threshold that join up across the
   map (blobs within `link` cells count as one) and from one frame to the next (a blob that
   overlaps, or comes within `link` of, one in the frame before carries on that event). A storm
   crossing the country is one event; showers that die out at noon and new ones that night over
   the same hills are two.

   Each contoured area is then matched with the events inside it:
   - one event: the area takes its first and last times;
   - two or more (the same SLGT in the morning and again at night, or two storms the day's peak
     joins into one outline): the area is cut into one per event, contoured from the same smoothed
     field weighted towards that event's own footprint, each with its own times;
   - none: it stays untimed.
   Grids are row-major nx × ny in contour (d3) coordinates, cell i spanning [i, i + 1]; the frames
   sit on that grid coarsened c times (w × h cells). */
import { contours } from 'd3-contour';

/** Block maximum of a field (NaN-aware) onto a w × h grid of f × f blocks. */
export function coarsenMax(data, nx, ny, f, w = Math.ceil(nx / f), h = Math.ceil(ny / f)) {
  const out = new Float32Array(w * h).fill(NaN);
  for (let j = 0; j < ny; j++) {
    const cj = (j / f) | 0;
    if (cj >= h) break;
    for (let i = 0; i < nx; i++) {
      const ci = (i / f) | 0, v = data[j * nx + i];
      if (ci >= w || !(v === v)) continue;
      const k = cj * w + ci;
      if (!(out[k] >= v)) out[k] = v;
    }
  }
  return out;
}

/* chessboard dilation of a 0/1 grid by r cells */
function dilate(on, w, h, r) {
  if (r < 1) return on;
  const a = new Uint8Array(on.length), b = new Uint8Array(on.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on[y * w + x]) continue;
    for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) a[y * w + k] = 1;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    if (!a[y * w + x]) continue;
    for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) b[k * w + x] = 1;
  }
  return b;
}
/* 8-connected labels (1..n) of a 0/1 grid */
function label(on, w, h) {
  const lab = new Int32Array(on.length), stack = [];
  let n = 0;
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || lab[s]) continue;
    lab[s] = ++n; stack.push(s);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (on[q] && !lab[q]) { lab[q] = n; stack.push(q); }
      }
    }
  }
  return { lab, n };
}

/** The events of one threshold: [{ from, to (ms), fp (w × h 0/1), cells }], earliest first.
    `mask` (w × h): only places inside it count. */
export function detectEvents(frames, w, h, thr, { link = 3, mask = null, minCells = 2 } = {}) {
  const parent = [], t0 = [], t1 = [], cellsOf = [];
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { parent[b] = a; t0[a] = Math.min(t0[a], t0[b]); t1[a] = Math.max(t1[a], t1[b]); } };
  let prev = null, prevBase = 0;
  for (const fr of [...frames].sort((a, b) => a.t - b.t)) {
    const on = new Uint8Array(w * h);
    for (let k = 0; k < on.length; k++) on[k] = fr.data[k] >= thr && (!mask || mask[k]) ? 1 : 0;
    const { lab, n } = label(dilate(on, w, h, link), w, h);
    const base = parent.length;
    for (let q = 0; q < n; q++) { parent.push(base + q); t0.push(fr.t); t1.push(fr.t); cellsOf.push([]); }
    for (let k = 0; k < on.length; k++) {
      if (!on[k]) continue;
      const g = base + lab[k] - 1;
      cellsOf[g].push(k);
      if (prev && prev[k]) union(prevBase + prev[k] - 1, g);
    }
    prev = lab; prevBase = base;
  }
  const byRoot = new Map();
  cellsOf.forEach((cells, g) => {
    if (!cells.length) return;
    const r = find(g);
    let ev = byRoot.get(r);
    if (!ev) byRoot.set(r, (ev = { from: t0[r], to: t1[r], fp: new Uint8Array(w * h), cells: 0 }));
    for (const k of cells) if (!ev.fp[k]) { ev.fp[k] = 1; ev.cells++; }
  });
  return [...byRoot.values()].filter((e) => e.cells >= minCells).sort((a, b) => a.from - b.from || a.to - b.to);
}

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); };
const centroid = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };

/* an event's footprint, widened a cell and softened: about 1 over it, falling to 0 a cell or two out */
function weightOf(ev, w, h) {
  if (ev.wt) return ev.wt;
  const grown = dilate(ev.fp, w, h, 1);
  let a = Float32Array.from(grown);
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        s += a[Y * w + X]; c++;
      }
      o[y * w + x] = s / c;
    }
    a = o;
  }
  for (let k = 0; k < a.length; k++) if (ev.fp[k]) a[k] = 1;
  ev.wt = a;
  return a;
}

/** One contoured ring (contour coordinates) matched with the events: [{ ring, from?, to? }], the
    ring itself or its pieces. `v`: the smoothed field it was contoured from (nx × ny), `thr` its
    level, `minArea` the smallest piece kept (cells). */
export function timeRing(ring, events, { v, nx, ny, c, w, h, thr, minArea }) {
  if (!events?.length) return [{ ring }];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  /* the coarse cells inside the ring, and how many of them each event has */
  const hit = new Map();
  let n = 0;
  for (let cj = Math.max(0, Math.floor(y0 / c)); cj <= Math.min(h - 1, Math.floor(y1 / c)); cj++) {
    for (let ci = Math.max(0, Math.floor(x0 / c)); ci <= Math.min(w - 1, Math.floor(x1 / c)); ci++) {
      if (!inRing((ci + 0.5) * c, (cj + 0.5) * c, ring)) continue;
      n++;
      events.forEach((e, ei) => { if (e.fp[cj * w + ci]) hit.set(ei, (hit.get(ei) || 0) + 1); });
    }
  }
  if (!n) {   // smaller than a coarse cell: the one under its middle
    const [cx, cy] = centroid(ring), k = Math.min(h - 1, Math.max(0, Math.floor(cy / c))) * w + Math.min(w - 1, Math.max(0, Math.floor(cx / c)));
    events.forEach((e, ei) => { if (e.fp[k]) hit.set(ei, 1); });
    n = 1;
  }
  const hits = [...hit.entries()].filter(([, m]) => m >= Math.max(1, 0.12 * n)).map(([ei]) => events[ei]);
  if (!hits.length) return [{ ring }];
  if (hits.length === 1) return [{ ring, from: hits[0].from, to: hits[0].to }];

  /* cut: the field over the ring's box, weighted to each event in turn */
  const pad = 2 * c;
  const bx = Math.max(0, Math.floor(x0) - pad), by = Math.max(0, Math.floor(y0) - pad);
  const bw = Math.min(nx, Math.ceil(x1) + pad) - bx, bh = Math.min(ny, Math.ceil(y1) + pad) - by;
  const gen = contours().size([bw, bh]).smooth(true);
  const vals = new Float64Array(bw * bh);
  const pieces = [];
  for (const e of hits) {
    const wt = weightOf(e, w, h);
    for (let y = 0; y < bh; y++) {
      const v0 = (by + y + 0.5) / c - 0.5, j0 = Math.max(0, Math.min(h - 1, Math.floor(v0))), j1 = Math.min(h - 1, j0 + 1), fy = Math.max(0, Math.min(1, v0 - j0));
      for (let x = 0; x < bw; x++) {
        const u0 = (bx + x + 0.5) / c - 0.5, i0 = Math.max(0, Math.min(w - 1, Math.floor(u0))), i1 = Math.min(w - 1, i0 + 1), fx = Math.max(0, Math.min(1, u0 - i0));
        const wgt = (wt[j0 * w + i0] * (1 - fx) + wt[j0 * w + i1] * fx) * (1 - fy) + (wt[j1 * w + i0] * (1 - fx) + wt[j1 * w + i1] * fx) * fy;
        const val = v[(by + y) * nx + bx + x];
        vals[y * bw + x] = val > 0 ? val * wgt : val;
      }
    }
    for (const poly of gen.contour(vals, thr).coordinates) {
      const outer = poly[0];
      if (!outer || outer.length < 4 || ringArea(outer) < minArea) continue;
      const moved = outer.map(([x, y]) => [x + bx, y + by]);
      const [cx, cy] = centroid(moved);
      if (inRing(cx, cy, ring)) pieces.push({ ring: moved, from: e.from, to: e.to });
    }
  }
  if (pieces.length) return pieces;
  return [{ ring, from: Math.min(...hits.map((e) => e.from)), to: Math.max(...hits.map((e) => e.to)) }];
}
