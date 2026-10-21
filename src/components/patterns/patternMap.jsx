/* The Weather Patterns map: one scenario's mean pressure chart for one day.

   Everything is drawn here, as vector SVG, from two grids the server sends:
     • land  — ECMWF's land-sea mask at 0.25°, contoured at one half into coastlines (the grid is
               edged with sea first, so every coast closes into a shape that can be filled);
     • msl   — the scenario's mean sea-level pressure at 1°, upsampled four times and contoured
               every 4 hPa into isobars.
   Contours are traced with marching squares; the pieces are joined by the grid edge they cross
   (so they meet exactly), then drawn as smooth curves. The projection is equirectangular with
   true scale at 56°N, which keeps the UK's shape for a map this size. */
import React, { useMemo } from 'react';

export const MAP_W = 560, MAP_H = 500;
const VIEW = { lon0: -26, lon1: 22, lat0: 44, lat1: 68 };
const KX = MAP_W / (VIEW.lon1 - VIEW.lon0), KY = MAP_H / (VIEW.lat1 - VIEW.lat0);
export const project = (lon, lat) => [(lon - VIEW.lon0) * KX, (VIEW.lat1 - lat) * KY];

/* ── contouring ─────────────────────────────────────────────────────────── */

/* the segments each marching-squares case draws, as pairs of cell edges:
   0 bottom (a→b), 1 right (b→c), 2 top (d→c), 3 left (a→d); corners a bottom-left, b bottom-right,
   c top-right, d top-left. Cases 5 and 10 (saddles) are settled by the cell's centre. */
const CASES = {
  1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
  9: [[0, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
};

/** Lines of `f` (row-major, row 0 south) at `level`, in grid coordinates [i, j], each with a flag
 *  saying whether it closes on itself. */
export function contour(f, nx, ny, level) {
  const pos = new Map();
  const segs = [];
  const at = (i, j) => f[j * nx + i];
  const t = (p, q) => (level - p) / (q - p || 1e-9);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      let pairs = CASES[code];
      if (!pairs) {
        const centre = (a + b + c + d) / 4 >= level;
        pairs = code === 5 ? (centre ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]]) : (centre ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]);
      }
      const ids = [(j * nx + i) * 2, ((j * nx + i + 1) * 2) + 1, ((j + 1) * nx + i) * 2, (j * nx + i) * 2 + 1];
      const pts = [[i + t(a, b), j], [i + 1, j + t(b, c)], [i + t(d, c), j + 1], [i, j + t(a, d)]];
      for (const [p, q] of pairs) {
        if (!pos.has(ids[p])) pos.set(ids[p], pts[p]);
        if (!pos.has(ids[q])) pos.set(ids[q], pts[q]);
        segs.push([ids[p], ids[q]]);
      }
    }
  }
  const touch = new Map();
  segs.forEach(([p, q], k) => {
    for (const e of [p, q]) {
      const l = touch.get(e);
      if (l) l.push(k); else touch.set(e, [k]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const chain = [segs[k][0], segs[k][1]];
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? chain[chain.length - 1] : chain[0];
        const nxt = (touch.get(tip) || []).find((m) => !used[m]);
        if (nxt === undefined) break;
        used[nxt] = 1;
        const other = segs[nxt][0] === tip ? segs[nxt][1] : segs[nxt][0];
        if (forward) chain.push(other); else chain.unshift(other);
      }
    }
    const closed = chain.length > 3 && chain[0] === chain[chain.length - 1];
    if (closed) chain.pop();
    lines.push({ pts: chain.map((e) => pos.get(e)), closed });
  }
  return lines;
}

/** A smooth path through points (Catmull-Rom as cubic Béziers), closed or open. */
export function smooth(P, closed) {
  const n = P.length;
  if (n < 2) return '';
  const p = (k) => (closed ? P[(k + n) % n] : P[Math.max(0, Math.min(n - 1, k))]);
  const f = (v) => v.toFixed(1);
  let d = `M${f(P[0][0])} ${f(P[0][1])}`;
  const last = closed ? n : n - 1;
  for (let k = 0; k < last; k++) {
    const p0 = p(k - 1), p1 = p(k), p2 = p(k + 1), p3 = p(k + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

function upsample(vals, nx, ny, k) {
  const NX = (nx - 1) * k + 1, NY = (ny - 1) * k + 1;
  const out = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    const fy = j / k, j0 = Math.min(ny - 2, Math.floor(fy)), v = fy - j0;
    for (let i = 0; i < NX; i++) {
      const fx = i / k, i0 = Math.min(nx - 2, Math.floor(fx)), u = fx - i0, a = j0 * nx + i0;
      out[j * NX + i] = (vals[a] * (1 - u) + vals[a + 1] * u) * (1 - v) + (vals[a + nx] * (1 - u) + vals[a + nx + 1] * u) * v;
    }
  }
  return { out, NX, NY };
}

/* ── land ───────────────────────────────────────────────────────────────── */

/** Coastlines from the land-sea mask, projected: one even-odd path (lakes become holes). */
export function buildLand(land) {
  if (!land?.rows) return null;
  const nx = land.nx + 2, ny = land.ny + 2;
  const f = new Float32Array(nx * ny);                 // an edge of sea all round closes every coast
  land.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) f[(j + 1) * nx + i + 1] = row.charCodeAt(i) - 48;
  });
  const toPx = ([i, j]) => project(land.lon0 + (i - 1) * land.d, land.lat0 + (j - 1) * land.d);
  let d = '';
  for (const line of contour(f, nx, ny, 4.5)) {
    if (line.pts.length < 4) continue;
    const P = line.pts.map(toPx);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < -20 || x0 > MAP_W + 20 || y1 < -20 || y0 > MAP_H + 20) continue;
    d += smooth(P, true);
  }
  return d;
}

/* ── isobars ────────────────────────────────────────────────────────────── */

/** Isobars every 4 hPa, each labelled once, the labels kept clear of the highs' and lows' letters (`avoid`). */
export function buildIsobars(msl, grid, avoid = []) {
  const K = 4;
  const { out, NX, NY } = upsample(msl, grid.nx, grid.ny, K);
  const step = grid.d / K;
  const toPx = ([i, j]) => project(grid.lon0 + i * step, grid.lat0 + j * step);
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const lines = [], labels = [];
  for (let p = Math.ceil(lo / 4) * 4; p <= hi; p += 4) {
    for (const line of contour(out, NX, NY, p)) {
      if (line.pts.length < 5) continue;
      const P = line.pts.map(toPx);
      lines.push({ p, d: smooth(P, line.closed), major: p % 20 === 0 });
      // one label per line: its on-map point nearest a column a little left of centre
      const on = P.filter(([x, y]) => x > 26 && x < MAP_W - 26 && y > 20 && y < MAP_H - 20
        && !avoid.some((c) => Math.abs(c.x - x) < 30 && y > c.y - 34 && y < c.y + 32));
      if (on.length > 10) {
        const target = MAP_W * 0.36;
        const pick = on.reduce((b, q) => (Math.abs(q[0] - target) < Math.abs(b[0] - target) ? q : b), on[0]);
        if (!labels.some((l) => Math.hypot(l.x - pick[0], l.y - pick[1]) < 46)) labels.push({ x: pick[0], y: pick[1], p });
      }
    }
  }
  return { lines, labels };
}

/* ── the map ────────────────────────────────────────────────────────────── */

export default function PatternMap({ landPath, msl, grid, centres, uid, children }) {
  const marks = useMemo(() => (centres || []).map((c) => {
    const [x, y] = project(c.lon, c.lat);
    return { ...c, x, y };
  }).filter((c) => c.x > 18 && c.x < MAP_W - 18 && c.y > 22 && c.y < MAP_H - 22), [centres]);
  const iso = useMemo(() => (msl && grid ? buildIsobars(msl, grid, marks) : null), [msl, grid, marks]);
  const clip = `wp-clip-${uid}`;
  return (
    <svg className="wp-map-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice" role="img"
      aria-label="Mean sea-level pressure chart">
      <defs><clipPath id={clip}><rect width={MAP_W} height={MAP_H} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <rect className="wp-sea" width={MAP_W} height={MAP_H} />
        {landPath && <path className="wp-land" d={landPath} fillRule="evenodd" />}
        {iso && (
          <g className="wp-iso" key={msl?.[0] + ':' + msl?.[msl.length - 1]}>
            {iso.lines.map((l, i) => <path key={i} d={l.d} className={l.major ? 'wp-iso-major' : undefined} />)}
            {iso.labels.map((l, i) => <text key={i} x={l.x} y={l.y} className="wp-iso-label">{l.p}</text>)}
          </g>
        )}
        {marks.map((c, i) => (
          <g key={i} className={c.t === 'H' ? 'wp-high' : 'wp-low'} transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`}>
            <text className="wp-centre" y="-4">{c.t}</text>
            <text className="wp-centre-p" y="20">{c.p}</text>
          </g>
        ))}
        {children}
      </g>
    </svg>
  );
}
