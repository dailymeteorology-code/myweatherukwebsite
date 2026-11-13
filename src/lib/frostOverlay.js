/* TCM FROST over any Model Data layer: a run's snow risk, and the snow it expects to fall, drawn as
   outlook areas like the thunderstorm overlay's (Severe hatched), for the London day on show, the
   24 hours to the time on show, or the whole run.

   The run's frames come through Model Data's own frame route (model 'frost', on the UK 2 km grid).
   Each level is traced on a 4 km copy of its yes/no field (a 2 x 2 block counts if any of its cells
   does, so nothing is lost), lightly smoothed, and put on whichever display grid the page is on. */
import { contours } from 'd3-contour';
import { loadFrame } from '@/lib/modelViewer';
import { projection } from '@/lib/modelGrids';
import { SNOW_RISK_LEVELS, SNOW_AMOUNT_LEVELS } from '@/lib/frostKey';

const H = 3600e3;
const londonDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
/* the instant London's day starts: at 00:00 UTC London is on that midnight's own offset */
const londonMidnight = (day) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return t - Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' })) * H;
};
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** The TCM FROST runs on the site (the last 48 hours), newest first:
    [{ tag, run, created, leads, days, members, sources, engine }]. */
export async function frostRuns() {
  const r = await fetch('/api/frost/runs', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`TCM FROST: ${r.status}`);
  return (await r.json()).runs || [];
}
/** "06Z Fri 13 Nov" */
export function frostRunName(r) {
  const t = new Date(r.run);
  return `${String(t.getUTCHours()).padStart(2, '0')}Z ${t.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })}`;
}

const validOf = (run, L) => Date.parse(run.run) + L * H;
/* the run's lead nearest a time, if one is within `tol` ms */
function leadNear(run, ms, tol) {
  let best = null, gap = Infinity;
  for (const L of run.leads) { const g = Math.abs(validOf(run, L) - ms); if (g <= tol && g < gap) { best = L; gap = g; } }
  return best;
}
/* the London days the run covers to their end (the day it starts on from its start) */
function runDays(run) {
  const out = [];
  const last = validOf(run, run.leads[run.leads.length - 1]);
  for (let d = londonDay(Date.parse(run.run) + H); ; d = nextDay(d)) {
    const end = londonMidnight(nextDay(d));
    if (end > last + 1.5 * H) break;
    const L = leadNear(run, end, 1.5 * H);
    if (L != null) out.push({ day: d, L, partFrom: londonMidnight(d) < Date.parse(run.run) ? Date.parse(run.run) : null });
  }
  return out;
}

/** What a span is made of, key by key: 'day' -> each London day the run covers (the 24 h to its end),
    '24h' -> each lead (the 24 h to it), 'run' -> the whole run. Each: { key, risk: [leads], amount: lead, note }. */
export function snowSpans(run, span) {
  if (!run?.leads?.length) return [];
  if (span === 'run') {
    const last = run.leads[run.leads.length - 1];
    return [{ key: 'run', risk: [...new Set([...runDays(run).map((d) => d.L), last])], amount: last, amountVar: 'snow_expected', note: 'the whole run' }];
  }
  if (span === '24h') {
    return run.leads.map((L) => ({ key: `l${L}`, risk: [L], amount: L, amountVar: 'snow_24h', note: L < 24 ? 'since the run began' : 'the 24 h to the time' }));
  }
  return runDays(run).map((d) => ({ key: `d${d.day}`, day: d.day, risk: [d.L], amount: d.L, amountVar: 'snow_24h', note: d.partFrom ? 'from the run’s start' : 'the whole day' }));
}
/** The span key for a time on the map, or null where the run has nothing for it. */
export function snowKeyAt(run, span, ms) {
  if (!run?.leads?.length || !Number.isFinite(ms)) return null;
  if (span === 'run') return 'run';
  if (span === '24h') { const L = leadNear(run, ms, 3 * H); return L == null ? null : `l${L}`; }
  return `d${londonDay(ms)}`;
}

/* ── the frames, and the fields traced from them ── */
const FRAMES = new Map();
function frostFrame(run, v, L) {
  const k = `${run.tag}|${v}|${L}`;
  if (!FRAMES.has(k)) {
    const p = loadFrame('frost', run.tag, v, L);
    FRAMES.set(k, p);
    p.catch(() => FRAMES.delete(k));
    while (FRAMES.size > 12) FRAMES.delete(FRAMES.keys().next().value);
  }
  return FRAMES.get(k);
}
/* a frame at 4 km: the largest value of each 2 x 2 block (no data counts as none) */
function halfMax(f, into) {
  const nx = f.head.nx, ny = f.head.ny, w = nx >> 1, h = ny >> 1, t = f.table, q = f.q;
  const out = into || new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * nx, r1 = r0 + nx;
    for (let x = 0; x < w; x++) {
      const c = 2 * x;
      let m = out[y * w + x];
      const a = t[q[r0 + c]], b = t[q[r0 + c + 1]], d = t[q[r1 + c]], e = t[q[r1 + c + 1]];
      if (a > m) m = a;
      if (b > m) m = b;
      if (d > m) m = d;
      if (e > m) m = e;
      out[y * w + x] = m;
    }
  }
  return { a: out, w, h };
}
/* a yes/no field, grown by `grow` cells and then box-blurred by `r`, ready to trace at 0.5 */
function maskOf(a, w, h, thr, grow, r) {
  let m = new Float64Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = a[i] >= thr ? 1 : 0;
  if (grow) {
    const g = new Float64Array(m.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        for (let dy = -grow; dy <= grow; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -grow; dx <= grow; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) g[yy * w + xx] = 1; }
        }
      }
    }
    m = g;
  }
  if (!r) return m;
  const t = new Float64Array(m.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x < w + r; x++) {
      const add = x + r, sub = x - r - 1;
      if (add >= 0 && add < w) s += m[y * w + add];
      if (sub >= 0 && sub < w) s -= m[y * w + sub];
      if (x >= 0 && x < w) t[y * w + x] = s / n;
    }
  }
  const o = new Float64Array(m.length);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y < h + r; y++) {
      const add = y + r, sub = y - r - 1;
      if (add >= 0 && add < h) s += t[add * w + x];
      if (sub >= 0 && sub < h) s -= t[sub * w + x];
      if (y >= 0 && y < h) o[y * w + x] = s / n;
    }
  }
  return o;
}
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); };
/* Douglas-Peucker: fewer points, the same shape to within `tol` cells */
function simplify(ring, tol) {
  if (ring.length < 8 || !tol) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = ring[i0], [bx, by] = ring[i1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let far = -1, fd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      /* a closed ring starts and ends on one point: there the distance is to that point, not to a line */
      const d = len < 1e-9 ? Math.hypot(ring[i][0] - ax, ring[i][1] - ay) : Math.abs((ring[i][0] - ax) * dy - (ring[i][1] - ay) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([i0, far], [far, i1]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const LOOKS = {
  smooth: { grow: 1, blur: 2, tol: 0.7, minArea: 10 },           // the outlook graphics' look
  detailed: { grow: 0, blur: 1, tol: 0.35, minArea: 2 },          // closer to the model's own field
};
/* where a field is at least `thr`, as rings on the display grid */
function trace(F, thr, look, toDisplay) {
  const lk = LOOKS[look] || LOOKS.smooth;
  const m = maskOf(F.a, F.w, F.h, thr, lk.grow, lk.blur);
  const mp = contours().size([F.w, F.h]).smooth(true).contour(m, 0.5);
  const rings = [];
  for (const poly of mp.coordinates) {
    if (!poly[0] || ringArea(poly[0]) < lk.minArea) continue;
    poly.forEach((ring, k) => {
      if (ring.length < 4 || (k && ringArea(ring) < lk.minArea)) return;   // a speck of a hole
      const s = simplify(ring, lk.tol);
      if (s.length >= 4) rings.push(s.map(([x, y]) => toDisplay(2 * x, 2 * y)));
    });
  }
  return rings;
}
/* the UK grid's cells on the display grid: the same grid, or through lon/lat to the wide one */
function displayOf(grid) {
  if (!grid || grid === 'uk') return (gx, gy) => [gx, gy];
  const a = projection('uk'), b = projection(grid);
  return (gx, gy) => { const [lon, lat] = a.fromGrid(gx, gy); return b.toGrid(lon, lat); };
}
const peakOf = (F) => { let p = 0; for (let i = 0; i < F.a.length; i++) if (F.a[i] > p) p = F.a[i]; return p; };

/** One span's overlay: { areas, peakRisk, peakCm, note } (areas lowest first, as drawRisk takes
    them), or null when the run has no frames for it. `show`: 'risk', 'amount' or 'both' (the risk
    filled, the amounts as labelled white lines). */
export async function snowOverlay(run, spec, { show = 'risk', look = 'smooth', grid = 'uk' } = {}) {
  const toDisplay = displayOf(grid);
  const areas = [];
  let peakRisk = 0, peakCm = 0;
  try {
    if (show !== 'amount') {
      let R = null;
      for (const L of spec.risk) R = halfMax(await frostFrame(run, 'snow_risk', L), R?.a);
      peakRisk = peakOf(R);
      for (const lv of SNOW_RISK_LEVELS) {
        if (lv.level > peakRisk) break;
        const rings = trace(R, lv.level - 0.5, look, toDisplay);
        if (rings.length) areas.push({ colour: lv.colour, rings, hatch: lv.level === 4, level: lv.level });
      }
    }
    const A = halfMax(await frostFrame(run, spec.amountVar, spec.amount));
    peakCm = peakOf(A);
    if (show !== 'risk') {
      SNOW_AMOUNT_LEVELS.forEach((b, k) => {
        if (b.cm > peakCm) return;
        const rings = trace(A, b.cm, look, toDisplay);
        if (!rings.length) return;
        areas.push(show === 'both' ? { colour: '#ffffff', rings, line: true, label: b.name, labelAt: 'enws'[k] } : { colour: b.colour, rings, cm: b.cm });
      });
    }
  } catch {
    return null;                                                    // a frame missing: nothing for this span
  }
  return { areas, peakRisk, peakCm, note: spec.note };
}
