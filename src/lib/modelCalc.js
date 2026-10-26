/* Model Data's heavy sums: contour lines, isobars, and the highs and lows. Each is a plain
   function of a frame's values ({ q, table } with the grid's size), so the page can run it in a
   worker, off the main thread and ahead of playback (lib/modelViewer's *Async helpers), and an
   export can run it directly. Loaded as a worker, this module answers { id, kind, args } with
   { id, out }. */
import { contours as d3contours } from 'd3-contour';

export function boxBlur(a, w, h, r) {
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

export const range = (a, b, s) => { const o = []; for (let v = a; v <= b; v += s) o.push(v); return o; };

/* every S-th value of a W x H field (missing as -9999), with its lowest and highest */
function halve(q, table, W, H, S) {
  const w = Math.floor(W / S), h = Math.floor(H / S);
  const vals = new Float64Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = table[q[(y * S) * W + x * S]];
      vals[y * w + x] = Number.isNaN(v) ? -9999 : v;
      if (!Number.isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  return { vals, w, h, lo, hi };
}

/** A layer's contour lines (grid coordinates), on a lightly smoothed half-resolution field; a
    coarse (probability) grid of nx x ny cells, K display cells each, is contoured directly.
    a = { q, table, W, H, coarse: { nx, ny, K } | null, thresholds (or 'every4' / 'every6'),
    resKm, line, pct } */
export function calcContours(a) {
  const { q, table, line, pct } = a;
  if (a.coarse) {
    const { nx, ny, K } = a.coarse;
    let vals = new Float64Array(nx * ny);
    for (let i = 0; i < vals.length; i++) { const v = table[q[i]]; vals[i] = Number.isNaN(v) ? 0 : v; }
    vals = boxBlur(vals, nx, ny, 1);
    return d3contours().size([nx, ny]).smooth(true).thresholds(a.thresholds)(Array.from(vals))
      .map((c) => ({ value: c.value, rings: c.coordinates.flatMap((p) => p).filter((r) => r.length >= 8).map((r) => r.map(([x, y]) => [x * K, y * K])), line, pct: !!pct }));
  }
  const S = 2;
  const f = halve(q, table, a.W, a.H, S);
  const r = Math.max(1, Math.round((a.resKm || 2) / (2 * S)));        // smooth over about one model cell
  const vals = boxBlur(f.vals, f.w, f.h, r);
  let th = a.thresholds;
  if (th === 'every4') th = range(Math.ceil(f.lo / 4) * 4, f.hi, 4);
  if (th === 'every6') th = range(Math.ceil(f.lo / 6) * 6, f.hi, 6);
  /* rings shorter than ~25 points are 2 km speckle: drawn, they bury the map in tiny loops */
  return d3contours().size([f.w, f.h]).smooth(true).thresholds(th)(Array.from(vals))
    .map((c) => ({ value: c.value, rings: c.coordinates.flatMap((poly) => poly).filter((ring) => ring.length >= 25).map((ring) => ring.map(([x, y]) => [x * S, y * S])), line }));
}

/** Isobars every `every` hPa (grid coordinates), on a field of ~8 km or coarser: pressure is smooth,
    and the UKV's 2 km grid at 4 km cost four times as much for the same lines.
    a = { q, table, W, H, every, resKm, dx } */
export function calcIsobars(a) {
  const S = Math.max(2, Math.round(8000 / a.dx));
  const f = halve(a.q, a.table, a.W, a.H, S);
  if (!(f.hi > f.lo)) return null;
  const cellKm = (a.dx / 1000) * S;
  const vals = boxBlur(f.vals, f.w, f.h, Math.max(1, Math.round(Math.max(a.resKm || 2, 2 * cellKm) / (2 * cellKm))));
  const th = range(Math.ceil(f.lo / a.every) * a.every, f.hi, a.every);
  return d3contours().size([f.w, f.h]).smooth(true).thresholds(th)(Array.from(vals))
    .map((c) => ({ value: c.value, rings: c.coordinates.flatMap((p) => p).filter((r) => r.length >= 12).map((r) => r.map(([x, y]) => [x * S, y * S])) }));
}

/** The lows and highs: [{ gx, gy, kind: 'L' | 'H', p }]. A centre is the lowest (highest) point
    within about 600 km on a smoothed ~40 km copy, standing out from its surroundings by 1.5 hPa
    or more; its place and pressure are then read from the full field around it.
    a = { q, table, W, H, dx } */
export function calcCentres(a) {
  const { q, table, W, H } = a;
  const S = Math.max(1, Math.round(40 / (a.dx / 1000)));
  const w = Math.floor(W / S), h = Math.floor(H / S);
  let v = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = table[q[Math.min(H - 1, y * S + (S >> 1)) * W + Math.min(W - 1, x * S + (S >> 1))]];
      v[y * w + x] = Number.isNaN(t) ? -9999 : t;
    }
  }
  v = boxBlur(v, w, h, 1);
  const R = Math.max(3, Math.round(600 / ((S * a.dx) / 1000)));          // ~600 km in coarse cells
  const out = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, c = v[i];
      if (c < -9000) continue;
      let isMin = true, isMax = true, sum = 0, n = 0;
      for (let dy = -R; dy <= R && (isMin || isMax); dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx, val = v[j];
          if (val < -9000 || j === i) continue;
          if (val < c || (val === c && j < i)) isMin = false;
          if (val > c || (val === c && j < i)) isMax = false;
          sum += val; n++;
        }
      }
      if (!n || !(isMin || isMax)) continue;
      const mean = sum / n, prom = isMin ? mean - c : c - mean;
      if (prom < 1.5) continue;
      /* the exact place and value from the full field near it */
      let best = null;
      for (let yy = Math.max(0, (y - 1) * S); yy < Math.min(H, (y + 2) * S); yy++) {
        for (let xx = Math.max(0, (x - 1) * S); xx < Math.min(W, (x + 2) * S); xx++) {
          const t = table[q[yy * W + xx]];
          if (Number.isNaN(t)) continue;
          if (!best || (isMin ? t < best.p : t > best.p)) best = { gx: xx + 0.5, gy: yy + 0.5, p: t };
        }
      }
      if (best) out.push({ ...best, kind: isMin ? 'L' : 'H', prom });
    }
  }
  return out.sort((a2, b) => b.prom - a2.prom).slice(0, 16);
}

export const CALC = { contours: calcContours, isobars: calcIsobars, centres: calcCentres };

/* as a worker: one sum per message (lib/modelViewer keeps the queue and a few of these busy) */
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {   // eslint-disable-line no-undef
  self.onmessage = (e) => {
    const { id, kind, args } = e.data;
    let out = null;
    try { out = CALC[kind](args); } catch { out = null; }
    self.postMessage({ id, out });
  };
}
