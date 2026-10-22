/* The models behind the snow and wind graphics, read from the Model Data page's own fields (the
   Met Office, ECMWF and NOAA open data on AWS, built by this server). Nothing here uses Open-Meteo.

   - A chance: the share of ensemble members past a threshold, ECMWF ENS and AIFS ENS together
     (100 members, 16 km), taken as the highest chance within about 15 miles; over several times,
     its peak or its average.
   - An amount: the ensemble median, or the UKV's own 2 km field while the span is in its range.
   - Gusts: the peak or the average over the span's hours (UKV) or 6-hour steps (ECMWF ENS median).

   A field the server has not built for a run yet is queued (the status call does that) and read
   once its step is ready, which for an ensemble can take a few minutes the first time. */
import { contours } from 'd3-contour';
import { API, loadFrame, runTag } from '@/lib/modelViewer';
import { laeaInverse } from '@/lib/ukRadar';
import { SHAPES } from '@/lib/novaOutlook';

export const FINE = { nx: 1042, ny: 970, dx: 2000, x0: -1158000, yTop: 902000 };   // the 2 km display grid
const HOUR = 3600e3;

let catalogAt = 0, catalogP = null;
export function modelCatalog() {
  if (!catalogP || Date.now() - catalogAt > 5 * 60e3) {
    catalogAt = Date.now();
    catalogP = fetch(`${API}/catalog`).then((r) => { if (!r.ok) throw new Error('Model Data is starting up; try again in a minute.'); return r.json(); })
      .catch((e) => { catalogP = null; throw e; });
  }
  return catalogP;
}
const runsOf = (c, id) => [...((c.models || []).find((m) => m.id === id)?.runs || (c.ensembles || []).find((m) => m.id === id)?.runs || [])]
  .sort((a, b) => Date.parse(b.run) - Date.parse(a.run));

/** The newest run of a model holding every one of the valid times (ms): { run, tag, steps } or null. */
export async function runCovering(id, times) {
  const c = await modelCatalog();
  for (const r of runsOf(c, id)) {
    const t0 = Date.parse(r.run);
    const steps = times.map((t) => (t - t0) / HOUR);
    if (steps.every((s) => s >= 0 && r.steps.includes(s))) return { run: r.run, tag: runTag(r.run), steps };
  }
  return null;
}
/** The newest run reaching the end of [from, to], with every step it has inside it. A run that
    starts part-way through (today's) covers the rest of the span. */
export async function runSpanning(id, from, to, minSteps = 1) {
  const c = await modelCatalog();
  for (const r of runsOf(c, id)) {
    const t0 = Date.parse(r.run);
    const last = t0 + Math.max(...r.steps) * HOUR;
    if (last < to - 3 * HOUR) continue;
    const steps = r.steps.filter((s) => t0 + s * HOUR > from && t0 + s * HOUR <= to);
    if (steps.length >= minSteps) return { run: r.run, tag: runTag(r.run), steps };
  }
  return null;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/** One step of a field, waiting for the server to build it if it has to; null if the run has
    no such step (a past-hour maximum has none at T+0). */
export async function waitFrame(model, tag, v, step, { alive = () => true, onStatus } = {}) {
  for (let tries = 0; tries < 90 && alive(); tries++) {
    const st = await fetch(`${API}/frames/${model}/${tag}/${v}/status?first=${step}`).then((r) => r.json()).catch(() => null);
    if (st?.done?.includes(step)) return loadFrame(model, tag, v, step);
    /* built and still not there; a run that has grown since its last build is rebuilt, so wait for that */
    if (st?.missing?.includes(step) || (st?.state === 'complete' && st.steps?.includes(step))) return null;
    if (st?.state === 'failed') throw new Error(`${model} ${v} could not be built`);
    onStatus?.(`Building ${model.toUpperCase().replace('_', ' ')} ${v.replace('_', ' ')}${st?.done?.length ? ` (${st.done.length} steps ready)` : ''}…`);
    await sleep(tries < 10 ? 2500 : 5000);
  }
  if (alive()) throw new Error(`${model} ${v} is taking too long to build; try again shortly`);
  return null;
}

/* ── fields: { nx, ny, k, data: Float32Array } on the display grid (k = 1) or its k-fold
   coarser ensemble grid ─────────────────────────────────────────────────────────────────── */
const decode = (f, m = 0) => {
  const n = f.head.nx * f.head.ny, out = new Float32Array(n), o = m * n;
  for (let i = 0; i < n; i++) { const q = f.q[o + i]; out[i] = q === 255 ? NaN : f.table[q]; }
  return out;
};
const gridOf = (f) => ({ nx: f.head.nx, ny: f.head.ny, k: f.head.k || 1 });

/** Chance (0..1) that the pooled members of the ensembles pass `thr` at each valid time, then
    the peak ('peak') or the average ('mean') of those chances. */
export async function ensChance(ids, v, times, thr, how, opts) {
  let out = null, grid = null, n = 0;
  const used = new Set();
  for (const t of times) {
    let cnt = null, seen = null;
    for (const id of ids) {
      const at = await runCovering(id, [t]);
      if (!at) continue;
      const f = await waitFrame(id, at.tag, v, at.steps[0], opts);
      if (!f) continue;
      const g = gridOf(f), cells = g.nx * g.ny;
      if (!grid) grid = g;
      if (g.nx !== grid.nx || g.ny !== grid.ny) continue;
      if (!cnt) { cnt = new Uint16Array(cells); seen = new Uint16Array(cells); }
      let qa = 255;
      for (let q = 0; q < 255; q++) if (f.table[q] >= thr - 1e-6) { qa = q; break; }
      for (let m = 0; m < (f.head.members || 1); m++) {
        const o = m * cells;
        for (let i = 0; i < cells; i++) { const q = f.q[o + i]; if (q === 255) continue; seen[i]++; if (q >= qa) cnt[i]++; }
      }
      used.add(`${id.replace('_ens', '').toUpperCase()} ENS ${at.run.slice(11, 13)}Z`);
    }
    if (!cnt) continue;
    const ch = new Float32Array(cnt.length);
    for (let i = 0; i < ch.length; i++) ch[i] = seen[i] ? cnt[i] / seen[i] : NaN;
    if (!out) out = ch;
    else for (let i = 0; i < ch.length; i++) out[i] = how === 'mean' ? out[i] + ch[i] : Math.max(out[i], ch[i]);
    n++;
  }
  if (!out) return null;
  if (how === 'mean') for (let i = 0; i < out.length; i++) out[i] /= n;
  return { ...grid, data: out, used: [...used] };
}

/** The member median of an ensemble at several valid times, reduced over the times by `how`
    ('peak', 'mean', or 'last' for an amount ending at the last time). */
export async function ensMedian(id, v, times, how, opts) {
  const at = await runCovering(id, times);
  if (!at) return null;
  let out = null, grid = null, used = 0;
  for (const step of at.steps) {
    const f = await waitFrame(id, at.tag, v, step, opts);
    if (!f) continue;
    grid = gridOf(f);
    used++;
    const n = grid.nx * grid.ny, M = f.head.members || 1, buf = new Float32Array(M), med = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let m = 0; m < M; m++) { const q = f.q[m * n + i]; if (q !== 255) buf[c++] = f.table[q]; }
      if (!c) { med[i] = NaN; continue; }
      const s = buf.subarray(0, c).sort();
      med[i] = c % 2 ? s[(c - 1) / 2] : (s[c / 2 - 1] + s[c / 2]) / 2;
    }
    if (!out || how === 'last') out = med;
    else if (how === 'mean') for (let i = 0; i < n; i++) out[i] += med[i];
    else for (let i = 0; i < n; i++) if (!(out[i] >= med[i])) out[i] = med[i];
  }
  if (!out) return null;
  if (how === 'mean') for (let i = 0; i < out.length; i++) out[i] /= used;
  return { ...grid, data: out, used: [`${id.replace('_ens', '').toUpperCase()} ENS ${at.run.slice(11, 13)}Z median`] };
}

/** A deterministic model's change in an accumulating field over [from, to] (snowfall that fell),
    from the newest run reaching `to`; one that starts part-way through counts from its start. */
export async function detAccum(id, v, from, to, opts) {
  const c = await modelCatalog();
  for (const r of runsOf(c, id)) {
    const t0 = Date.parse(r.run);
    const sEnd = (to - t0) / HOUR, sStart = Math.max(0, (from - t0) / HOUR);
    if (!r.steps.includes(sEnd) || (sStart > 0 && !r.steps.includes(sStart))) continue;
    const tag = runTag(r.run);
    const fEnd = await waitFrame(id, tag, v, sEnd, opts);
    const fStart = sStart > 0 ? await waitFrame(id, tag, v, sStart, opts) : null;
    if (!fEnd || (sStart > 0 && !fStart)) continue;
    const end = decode(fEnd);
    if (fStart) { const st = decode(fStart); for (let i = 0; i < end.length; i++) end[i] = Math.max(0, end[i] - st[i]); }
    return { nx: FINE.nx, ny: FINE.ny, k: 1, data: end, used: [`${id.toUpperCase()} ${r.run.slice(11, 13)}Z`] };
  }
  return null;
}

/** A deterministic model's peak ('peak') or average ('mean') of a field over its steps inside [from, to]. */
export async function detStat(id, v, from, to, how, opts) {
  const at = await runSpanning(id, from, to, 3);
  if (!at) return null;
  let out = null, used = 0;
  for (const step of at.steps) {
    const f = await waitFrame(id, at.tag, v, step, opts);
    if (!f) continue;
    const d = decode(f);
    used++;
    if (!out) out = d;
    else if (how === 'mean') for (let i = 0; i < d.length; i++) out[i] += d[i];
    else for (let i = 0; i < d.length; i++) if (!(out[i] >= d[i])) out[i] = d[i];
  }
  if (!out) return null;
  if (how === 'mean') for (let i = 0; i < out.length; i++) out[i] /= used;
  return { nx: FINE.nx, ny: FINE.ny, k: 1, data: out, used: [`${id.toUpperCase()} ${at.run.slice(11, 13)}Z`] };
}

/* ── shaping and contouring ──────────────────────────────────────────────────────────────── */
/** The highest value within r cells (a square), NaN-aware. */
export function maxWithin(f, r) {
  if (r < 1) return f;
  const { nx, ny, data } = f, h = new Float32Array(data.length), out = new Float32Array(data.length);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let m = NaN;
    for (let k = Math.max(0, x - r); k <= Math.min(nx - 1, x + r); k++) { const v = data[y * nx + k]; if (v > m || m !== m) m = v; }
    h[y * nx + x] = m;
  }
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
    let m = NaN;
    for (let k = Math.max(0, y - r); k <= Math.min(ny - 1, y + r); k++) { const v = h[k * nx + x]; if (v > m || m !== m) m = v; }
    out[y * nx + x] = m;
  }
  return { ...f, data: out };
}
/** A box blur of radius r cells, twice (close to a Gaussian), NaN-aware. */
export function blur(f, r) {
  if (r < 1) return f;
  const { nx, ny } = f;
  let a = f.data;
  for (let pass = 0; pass < 2; pass++) {
    const h = new Float32Array(a.length), out = new Float32Array(a.length);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(nx - 1, x + r); k++) { const v = a[y * nx + k]; if (v === v) { s += v; c++; } }
      h[y * nx + x] = c ? s / c : NaN;
    }
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
      let s = 0, c = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(ny - 1, y + r); k++) { const v = h[k * nx + x]; if (v === v) { s += v; c++; } }
      out[y * nx + x] = c ? s / c : NaN;
    }
    a = out;
  }
  return { ...f, data: a };
}
/** 1 for the cells whose centre is inside a lon/lat box (none: every cell). */
export function boxMaskOf(f, box) {
  if (!box) return null;
  const m = new Uint8Array(f.nx * f.ny), k = f.k || 1;
  for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
    const [lon, lat] = laeaInverse(FINE.x0 + (i * k + (k - 1) / 2) * FINE.dx, FINE.yTop - (j * k + (k - 1) / 2) * FINE.dx);
    if (lon >= box.lonMin && lon <= box.lonMax && lat >= box.latMin && lat <= box.latMax) m[j * f.nx + i] = 1;
  }
  return m;
}

const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); };
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

/** Contours a field at each level's `min`: [{ id, rings: [[[lat, lon]]] }], lowest first, shaped
    like the NOVA import (SHAPES: Detailed, Smooth or Broad). Cells outside the mask count as
    nothing, so the areas close at the view's edge. */
export function contourField(f, levels, mask = null, shape = 'detailed') {
  const sh = SHAPES[shape] || SHAPES.detailed, k = f.k || 1, cellKm = (FINE.dx / 1000) * k;
  const r = (km) => Math.round(km / cellKm / 2);
  let g = f;
  if (r(sh.grow) >= 1) g = maxWithin(g, r(sh.grow));
  if (r(sh.blur) >= 1) g = blur(g, r(sh.blur));
  const { nx, ny } = g;
  const v = new Float64Array(nx * ny);
  for (let i = 0; i < v.length; i++) { const x = g.data[i]; v[i] = (mask && !mask[i]) || !(x === x) ? -1e9 : x; }
  const gen = contours().size([nx, ny]).smooth(true);
  const minCells = Math.max(1.5, sh.minKm2 / (cellKm * cellKm)), tol = Math.max(0.25, sh.tolKm / cellKm);
  const out = [];
  for (const lv of levels) {
    const mp = gen.contour(v, lv.min);
    const rings = [];
    for (const poly of mp.coordinates) {
      const outer = poly[0];
      if (!outer || outer.length < 4 || ringArea(outer) < minCells) continue;
      /* d3 puts cell (i, j) at [i, i+1] x [j, j+1]: its centre is i + 0.5 */
      rings.push(simplify(outer, tol).map(([x, y]) => {
        const [lon, lat] = laeaInverse(FINE.x0 + ((x - 0.5) * k + (k - 1) / 2) * FINE.dx, FINE.yTop - ((y - 0.5) * k + (k - 1) / 2) * FINE.dx);
        return [lat, lon];
      }));
    }
    if (rings.length) out.push({ id: lv.id, rings });
  }
  return out;
}

/** The highest value inside the mask. */
export function peakOf(f, mask = null) {
  let best = 0;
  for (let i = 0; i < f.data.length; i++) { const x = f.data[i]; if (x > best && (!mask || mask[i])) best = x; }
  return best;
}

/** Local midnight at the start of 'YYYY-MM-DD' and the next one (the admin's clock is the UK's). */
export function dayBounds(day) {
  const a = new Date(`${day}T00:00:00`), b = new Date(a); b.setDate(b.getDate() + 1);
  return [a.getTime(), b.getTime()];
}
/** The 6-hourly synoptic time nearest a moment (ensemble steps fall on 00, 06, 12, 18Z). */
export const nearestSynoptic = (ms) => Math.round(ms / (6 * HOUR)) * 6 * HOUR;
