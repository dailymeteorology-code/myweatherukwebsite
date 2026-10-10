/**
 * Lightning nowcasting: storm cells, tracks, motion and probability fields.
 *
 *   A. CELLS      Strikes from the last 15 minutes are clustered (DBSCAN on a
 *                 spatial hash, eps = 12 km) into lightning-producing cells.
 *   B. TRACKING   Each cycle's cells are matched to the previous cycle's tracks
 *                 by predicted position, so a storm keeps one identity — and so
 *                 one warning — for its whole life. Splits and merges are
 *                 recorded rather than spawning duplicate storms.
 *   C. MOTION     Velocity comes from up to three independent estimates,
 *                 blended by how much each can be trusted:
 *                   - least-squares fit to the track's centroid history;
 *                   - cross-correlation of the cell's strike pattern between
 *                     the previous and latest 10 minutes (a small optical-flow
 *                     search, ±40 km);
 *                   - the 700 hPa steering wind from the model atmosphere,
 *                     used as a weak prior for a cell too young to have a
 *                     history.
 *   D. FIELDS     For each lead time (5…30 min) the cell's recent strikes are
 *                 advected along the motion vector and spread with a kernel
 *                 that WIDENS with lead time — the positional uncertainty of
 *                 the forecast. The resulting densities are the model's
 *                 features; model.js turns them into probabilities.
 *
 * All rasters are local to one cell (see geometry.makeGrid) and computed by
 * splat-and-blur, so cost is independent of how many strikes a storm has.
 */
import { makeGrid, haversineKm, kmPerDegLon, KM_PER_DEG_LAT } from './geometry.js';

export const LEADS = [5, 10, 15, 20, 25, 30];
export const GRID_RES_KM = 2;
/** Radius within which a strike counts as "lightning at this point". */
export const HIT_RADIUS_KM = 8;

/* ── A. clustering ────────────────────────────────────────────────────── */

export function clusterStrikes(strikes, { epsKm = 12, minPts = 4 } = {}) {
  const cellDeg = epsKm / 111;
  const hash = new Map();
  const key = (i, j) => `${i},${j}`;
  strikes.forEach((s, idx) => {
    const k = key(Math.floor(s.lat / cellDeg), Math.floor(s.lon / (cellDeg / Math.max(0.2, Math.cos(s.lat * Math.PI / 180)))));
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(idx);
  });
  const neighbours = (idx) => {
    const s = strikes[idx];
    const cdLon = cellDeg / Math.max(0.2, Math.cos(s.lat * Math.PI / 180));
    const i0 = Math.floor(s.lat / cellDeg); const j0 = Math.floor(s.lon / cdLon);
    const out = [];
    for (let i = i0 - 1; i <= i0 + 1; i += 1) for (let j = j0 - 1; j <= j0 + 1; j += 1) {
      const list = hash.get(key(i, j));
      if (!list) continue;
      for (const o of list) {
        const t = strikes[o];
        const dy = (t.lat - s.lat) * KM_PER_DEG_LAT;
        const dx = (t.lon - s.lon) * kmPerDegLon(s.lat);
        if (dx * dx + dy * dy <= epsKm * epsKm) out.push(o);
      }
    }
    return out;
  };
  const label = new Int32Array(strikes.length).fill(-1); // -1 unvisited, -2 noise
  let c = 0;
  for (let i = 0; i < strikes.length; i += 1) {
    if (label[i] !== -1) continue;
    const nb = neighbours(i);
    if (nb.length < minPts) { label[i] = -2; continue; }
    label[i] = c;
    const queue = nb.filter((n) => n !== i);
    while (queue.length) {
      const q = queue.pop();
      if (label[q] === -2) label[q] = c;
      if (label[q] !== -1) continue;
      label[q] = c;
      const nb2 = neighbours(q);
      if (nb2.length >= minPts) for (const n of nb2) if (label[n] < 0) queue.push(n);
    }
    c += 1;
  }
  const clusters = Array.from({ length: c }, () => []);
  for (let i = 0; i < strikes.length; i += 1) if (label[i] >= 0) clusters[label[i]].push(strikes[i]);
  return clusters;
}

/** Summary statistics of one cluster at time `now`. */
export function summariseCluster(members, now) {
  let sw = 0; let la = 0; let lo = 0; let n10 = 0; let n5 = 0;
  for (const s of members) {
    const age = (now - s.time) / 60e3;
    const w = Math.exp(-age / 6); // recent strikes define where the cell IS
    sw += w; la += w * s.lat; lo += w * s.lon;
    if (age <= 10) n10 += 1;
    if (age <= 5) n5 += 1;
  }
  const lat = la / sw; const lon = lo / sw;
  let maxD = 0;
  for (const s of members) maxD = Math.max(maxD, haversineKm(lat, lon, s.lat, s.lon));
  return { lat, lon, count15: members.length, n10, n5, radiusKm: Math.max(5, maxD) };
}

/* ── C. motion: cross-correlation of strike patterns ──────────────────── */

/**
 * Estimate displacement (km per minute) between the cell's strikes in
 * [now-20, now-10] and [now-10, now] by searching shifts on a 2 km grid for
 * the best overlap of the two density images. Returns null if either window
 * is too sparse to say anything.
 */
export function crossCorrelationMotion(strikes, centre, now) {
  const early = strikes.filter((s) => s.time >= now - 20 * 60e3 && s.time < now - 10 * 60e3);
  const late = strikes.filter((s) => s.time >= now - 10 * 60e3);
  if (early.length < 8 || late.length < 8) return null;
  const res = 2; const half = 70;
  const grid = makeGrid(centre.lat, centre.lon, half, half, res);
  const img = (list) => {
    const f = new Float32Array(grid.nx * grid.ny);
    splat(f, grid, list.map((s) => grid.toXY(s.lat, s.lon)), 1);
    blur(f, grid.nx, grid.ny, 4 / res);
    return f;
  };
  const A = img(early); const B = img(late);
  const maxShift = Math.round(40 / res);
  let best = -Infinity; let bx = 0; let by = 0;
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      let s = 0;
      for (let j = Math.max(0, -dy); j < Math.min(grid.ny, grid.ny - dy); j += 2) {
        const rowA = j * grid.nx; const rowB = (j + dy) * grid.nx;
        for (let i = Math.max(0, -dx); i < Math.min(grid.nx, grid.nx - dx); i += 2) s += A[rowA + i] * B[rowB + i + dx];
      }
      if (s > best) { best = s; bx = dx; by = dy; }
    }
  }
  if (best <= 0) return null;
  // Displacement over the 10 minutes between window midpoints.
  return { vx: (bx * res) / 10, vy: (by * res) / 10, source: 'cross-correlation' };
}

/** Least-squares velocity (km/min) from a track's centroid history. */
export function historyMotion(history) {
  const pts = history.slice(-8);
  if (pts.length < 3) return null;
  const t0 = pts[pts.length - 1].t;
  const lat0 = pts[pts.length - 1].lat;
  const kx = kmPerDegLon(lat0);
  let st = 0; let sx = 0; let sy = 0; let stt = 0; let stx = 0; let sty = 0;
  for (const p of pts) {
    const t = (p.t - t0) / 60e3;
    const x = (p.lon - pts[pts.length - 1].lon) * kx; const y = (p.lat - lat0) * KM_PER_DEG_LAT;
    st += t; sx += x; sy += y; stt += t * t; stx += t * x; sty += t * y;
  }
  const n = pts.length;
  const den = n * stt - st * st;
  if (Math.abs(den) < 1e-6) return null;
  const vx = (n * stx - st * sx) / den; const vy = (n * sty - st * sy) / den;
  // Residual spread is the honest measure of how steady the motion is.
  let r = 0;
  const bx = (sx - vx * st) / n; const by = (sy - vy * st) / n;
  for (const p of pts) {
    const t = (p.t - t0) / 60e3;
    const x = (p.lon - pts[pts.length - 1].lon) * kx; const y = (p.lat - lat0) * KM_PER_DEG_LAT;
    r += (x - (bx + vx * t)) ** 2 + (y - (by + vy * t)) ** 2;
  }
  return { vx, vy, rmsKm: Math.sqrt(r / n), source: 'track-history' };
}

/** Blend the estimates. Weights reflect how much each is worth at this point in a track's life. */
export function blendMotion({ hist, xcorr, steering }) {
  const parts = [];
  if (hist) parts.push([hist, hist.rmsKm < 6 ? 3 : 1.5]);
  if (xcorr) parts.push([xcorr, 2]);
  if (steering) parts.push([steering, parts.length ? 0.5 : 1]);
  if (!parts.length) return { vx: 0, vy: 0, speedKmh: 0, sources: [], spreadKmh: null };
  let W = 0; let vx = 0; let vy = 0;
  for (const [m, w] of parts) { vx += w * m.vx; vy += w * m.vy; W += w; }
  vx /= W; vy /= W;
  // Cap at a physically sensible 120 km/h: faster than that is a mismatched
  // track, not a storm.
  const sp = Math.hypot(vx, vy) * 60;
  if (sp > 120) { vx *= 120 / sp; vy *= 120 / sp; }
  let spread = 0;
  for (const [m] of parts) spread = Math.max(spread, Math.hypot(m.vx - vx, m.vy - vy) * 60);
  return { vx, vy, speedKmh: Math.min(sp, 120), sources: parts.map(([m]) => m.source), spreadKmh: parts.length > 1 ? spread : null };
}

/* ── B. tracking ──────────────────────────────────────────────────────── */

/**
 * Match this cycle's cells to existing tracks. Mutates `tracks` (a Map of
 * id -> track). Returns { tracks, born, died, merged, split }.
 */
export function updateTracks(tracks, cells, now, nextId) {
  const live = [...tracks.values()].filter((t) => !t.dead);
  const pairs = [];
  for (const t of live) {
    const dtMin = (now - t.lastSeen) / 60e3;
    const pLat = t.lat + (t.vy * dtMin) / KM_PER_DEG_LAT;
    const pLon = t.lon + (t.vx * dtMin) / kmPerDegLon(t.lat);
    const gate = 18 + Math.hypot(t.vx, t.vy) * dtMin * 0.6 + (t.radiusKm || 10) * 0.5;
    cells.forEach((c, ci) => {
      const d = haversineKm(pLat, pLon, c.lat, c.lon);
      if (d <= gate + c.radiusKm * 0.5) pairs.push({ t, ci, d });
    });
  }
  pairs.sort((a, b) => a.d - b.d);
  const cellTaken = new Map(); // ci -> track
  const trackTaken = new Set();
  const merged = [];
  for (const p of pairs) {
    if (trackTaken.has(p.t.id)) continue;
    if (cellTaken.has(p.ci)) {
      // A second track wants a cell already claimed: the two storms merged.
      merged.push({ into: cellTaken.get(p.ci).id, from: p.t.id });
      trackTaken.add(p.t.id);
      continue;
    }
    cellTaken.set(p.ci, p.t);
    trackTaken.add(p.t.id);
  }
  const born = []; const split = [];
  cells.forEach((c, ci) => {
    let t = cellTaken.get(ci);
    if (!t) {
      // Unclaimed cell close to a matched track: a split from that storm.
      let parent = null; let pd = Infinity;
      for (const [cj, tr] of cellTaken) {
        const d = haversineKm(cells[cj].lat, cells[cj].lon, c.lat, c.lon);
        if (d < 45 && d < pd) { parent = tr; pd = d; }
      }
      t = { id: nextId(), born: now, history: [], vx: 0, vy: 0, cycles: 0, parentId: parent?.id || null };
      tracks.set(t.id, t);
      (parent ? split : born).push(t.id);
    }
    t.lat = c.lat; t.lon = c.lon; t.radiusKm = c.radiusKm;
    t.n10 = c.n10; t.n5 = c.n5; t.count15 = c.count15;
    t.members = c.members;
    t.lastSeen = now; t.cycles += 1; t.dead = false;
    t.history.push({ t: now, lat: c.lat, lon: c.lon, n10: c.n10 });
    if (t.history.length > 40) t.history.shift();
  });
  const died = [];
  for (const t of live) {
    if (!trackTaken.has(t.id) && now - t.lastSeen > 6 * 60e3) { t.dead = true; died.push(t.id); }
  }
  for (const m of merged) { const t = tracks.get(m.from); if (t) { t.dead = true; t.mergedInto = m.into; } }
  // Forget long-dead tracks.
  for (const [id, t] of tracks) if (t.dead && now - t.lastSeen > 60 * 60e3) tracks.delete(id);
  return { born, died, merged, split };
}

/* ── D. fields ────────────────────────────────────────────────────────── */

function splat(f, grid, xy, w) {
  const { nx, ny, res, x0, y0 } = grid;
  for (const [x, y] of xy) {
    const gx = (x - x0) / res - 0.5; const gy = (y - y0) / res - 0.5;
    const i = Math.floor(gx); const j = Math.floor(gy);
    const fx = gx - i; const fy = gy - j;
    for (let dj = 0; dj <= 1; dj += 1) for (let di = 0; di <= 1; di += 1) {
      const ii = i + di; const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      f[jj * nx + ii] += w * (di ? fx : 1 - fx) * (dj ? fy : 1 - fy);
    }
  }
}

function boxPass(src, dst, nx, ny, r, horizontal) {
  const norm = 1 / (2 * r + 1);
  if (horizontal) {
    for (let y = 0; y < ny; y += 1) {
      const row = y * nx; let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += src[row + Math.min(nx - 1, Math.max(0, i))];
      for (let x = 0; x < nx; x += 1) {
        dst[row + x] = acc * norm;
        acc += src[row + Math.min(nx - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
  } else {
    for (let x = 0; x < nx; x += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += src[Math.min(ny - 1, Math.max(0, i)) * nx + x];
      for (let y = 0; y < ny; y += 1) {
        dst[y * nx + x] = acc * norm;
        acc += src[Math.min(ny - 1, y + r + 1) * nx + x] - src[Math.max(0, y - r) * nx + x];
      }
    }
  }
}

/** Gaussian blur (sigma in cells) by three box passes; preserves total mass. */
export function blur(f, nx, ny, sigma) {
  if (sigma < 0.5) return f;
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2 + 0.25));
  const tmp = new Float32Array(f.length);
  for (let k = 0; k < 3; k += 1) { boxPass(f, tmp, nx, ny, r, true); boxPass(tmp, f, nx, ny, r, false); }
  return f;
}

/**
 * Kernel width for a lead time: the base smoothing plus forecast position
 * error growing with lead (and with how unsure we are of the motion).
 */
export function sigmaForLead(leadMin, baseKm, motionUncKmh = 15) {
  const posErr = (motionUncKmh / 60) * leadMin + 0.15 * leadMin; // km
  return Math.sqrt(baseKm * baseKm + posErr * posErr);
}

/**
 * The per-lead feature rasters for one track. Densities are strikes per
 * 100 km² — an absolute unit, so a feature means the same thing for a small
 * shower and a squall line, and the same in training as in production.
 */
export function buildFields(track, strikes, now, motion, { motionUncKmh = 15 } = {}) {
  const reach = Math.hypot(motion.vx, motion.vy) * 30;
  /* Margin for the 30-minute travel PLUS the widest forecast kernel (~3 sigma)
     PLUS the uncertainty corridor. Too small and a forecast area runs off the
     edge of the grid and is clipped into a straight line. */
  const half = Math.min(320, track.radiusKm + reach + 90);
  const grid = makeGrid(track.lat, track.lon, half, half, GRID_RES_KM);
  const n = grid.nx * grid.ny;
  const s10 = []; const s30 = [];
  for (const s of strikes) {
    const age = now - s.time;
    if (age < 0) continue;
    const xy = grid.toXY(s.lat, s.lon);
    if (Math.abs(xy[0]) > half + 30 || Math.abs(xy[1]) > half + 30) continue;
    if (age <= 10 * 60e3) s10.push(xy);
    if (age <= 30 * 60e3) s30.push(xy);
  }
  const cellArea100 = (GRID_RES_KM * GRID_RES_KM) / 100;
  const leads = {};
  for (const L of LEADS) {
    const dx = motion.vx * L; const dy = motion.vy * L;
    const d10 = new Float32Array(n); const d30 = new Float32Array(n);
    splat(d10, grid, s10.map(([x, y]) => [x + dx, y + dy]), 1 / cellArea100);
    splat(d30, grid, s30.map(([x, y]) => [x + dx, y + dy]), 1 / cellArea100 / 3);
    blur(d10, grid.nx, grid.ny, sigmaForLead(L, 5, motionUncKmh) / GRID_RES_KM);
    blur(d30, grid.nx, grid.ny, sigmaForLead(L, 9, motionUncKmh) / GRID_RES_KM);
    leads[L] = { d10, d30 };
  }
  // "Now": observed activity, no advection, light smoothing.
  const now10 = new Float32Array(n);
  splat(now10, grid, s10, 1 / cellArea100);
  blur(now10, grid.nx, grid.ny, 5 / GRID_RES_KM);
  return { grid, leads, now10 };
}

/**
 * Ground truth for training and verification: 1 where at least one strike
 * fell within HIT_RADIUS_KM of the grid point during [from, to).
 */
export function observedHits(grid, strikes, fromMs, toMs) {
  const f = new Float32Array(grid.nx * grid.ny);
  const r = Math.ceil(HIT_RADIUS_KM / grid.res);
  for (const s of strikes) {
    if (s.time < fromMs || s.time >= toMs) continue;
    const [x, y] = grid.toXY(s.lat, s.lon);
    const ci = Math.floor((x - grid.x0) / grid.res); const cj = Math.floor((y - grid.y0) / grid.res);
    for (let j = cj - r; j <= cj + r; j += 1) {
      if (j < 0 || j >= grid.ny) continue;
      for (let i = ci - r; i <= ci + r; i += 1) {
        if (i < 0 || i >= grid.nx) continue;
        const [cx, cy] = grid.cellCentre(i, j);
        if ((cx - x) ** 2 + (cy - y) ** 2 <= HIT_RADIUS_KM * HIT_RADIUS_KM) f[j * grid.nx + i] = 1;
      }
    }
  }
  return f;
}

/** Strike rate trend: log ratio of the latest 10 minutes to the 10 before. */
export function trendOf(strikes, track, now) {
  let a = 0; let b = 0;
  const R = track.radiusKm + 15;
  for (const s of strikes) {
    const age = now - s.time;
    if (age > 20 * 60e3 || age < 0) continue;
    if (haversineKm(track.lat, track.lon, s.lat, s.lon) > R) continue;
    if (age <= 10 * 60e3) a += 1; else b += 1;
  }
  return { latest10: a, previous10: b, logRatio: Math.log((a + 1) / (b + 1)) };
}
