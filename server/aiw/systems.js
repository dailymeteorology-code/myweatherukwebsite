/**
 * Storm SYSTEMS: one warning per threat, not one per cell.
 *
 * Lightning clusters into cells a few kilometres across, but a thunderstorm
 * complex is many cells at once. Warning each cell separately produced stacks
 * of near-identical overlapping warnings — the same towns named three times,
 * three "+30 min forecast" labels on top of each other, three voices. Here,
 * cells whose warning areas (or 30-minute forecast areas) touch are grouped
 * into a system, their probability rasters are combined (cell-wise maximum)
 * on one shared grid, and the system is assessed and warned as one.
 *
 * Cells that are genuinely separate — their risk areas do not meet — remain
 * separate warnings.
 */
import { makeGrid, fieldToGeoJSON, geoBBox, KM_PER_DEG_LAT, kmPerDegLon } from './geometry.js';
import { LEADS, GRID_RES_KM } from './nowcast.js';

/** Bounding box (lon/lat) of everything a cell's forecast might touch. */
function reachBox(item, level) {
  const near = new Float32Array(item.fields.grid.nx * item.fields.grid.ny);
  for (const L of LEADS) { const p = item.probs[L]; for (let i = 0; i < p.length; i += 1) if (p[i] > near[i]) near[i] = p[i]; }
  const g = fieldToGeoJSON(near, item.fields.grid, level, { minAreaKm2: 1, smooth: 0, tolKm: 2 });
  return g ? geoBBox(g) : null;
}

const boxesTouch = (a, b, padDeg = 0.05) => a && b
  && a[0] - padDeg <= b[2] && b[0] - padDeg <= a[2] && a[1] - padDeg <= b[3] && b[1] - padDeg <= a[3];

/**
 * Group per-cell items { track, probs, fields, motion, trend, env } into
 * systems. Returns [{ members: [item…] }].
 */
export function groupSystems(items, level) {
  const boxes = items.map((it) => reachBox(it, level));
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (boxesTouch(boxes[i], boxes[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  return [...groups.values()].map((members) => ({ members }));
}

/** Sample a member raster at a lat/lon (nearest cell), 0 outside its grid. */
function sampler(grid) {
  return (lat, lon) => {
    const x = (lon - grid.centreLon) * grid.kx;
    const y = (lat - grid.centreLat) * KM_PER_DEG_LAT;
    const i = Math.floor((x - grid.x0) / grid.res);
    const j = Math.floor((y - grid.y0) / grid.res);
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return -1;
    return j * grid.nx + i;
  };
}

/**
 * Combine a multi-cell system into one item with the same shape assess()
 * expects. The primary member — the one already under a warning, else the
 * most active — lends its track identity so an existing warning carries on.
 */
export function mergeSystem(members, existingTrackIds) {
  if (members.length === 1) return { item: members[0], absorbed: [] };
  const primary = members.find((m) => existingTrackIds.has(m.track.id))
    || members.reduce((a, b) => (b.track.n10 > a.track.n10 ? b : a));

  // Shared grid covering every member grid.
  let w = 180; let s = 90; let e = -180; let n = -90;
  for (const m of members) {
    const g = m.fields.grid;
    const [lat0, lon0] = g.toLatLon(g.x0, g.y0);
    const [lat1, lon1] = g.toLatLon(g.x0 + g.nx * g.res, g.y0 + g.ny * g.res);
    w = Math.min(w, lon0); e = Math.max(e, lon1); s = Math.min(s, lat0); n = Math.max(n, lat1);
  }
  const cLat = (s + n) / 2; const cLon = (w + e) / 2;
  const halfW = Math.min(420, ((e - w) * kmPerDegLon(cLat)) / 2);
  const halfH = Math.min(420, ((n - s) * KM_PER_DEG_LAT) / 2);
  const grid = makeGrid(cLat, cLon, halfW, halfH, GRID_RES_KM);
  const N = grid.nx * grid.ny;

  // Precompute, per member, which member cell each system cell maps to.
  const maps = members.map((m) => {
    const at = sampler(m.fields.grid);
    const idx = new Int32Array(N);
    for (let j = 0; j < grid.ny; j += 1) for (let i = 0; i < grid.nx; i += 1) {
      const [x, y] = grid.cellCentre(i, j);
      const [lat, lon] = grid.toLatLon(x, y);
      idx[j * grid.nx + i] = at(lat, lon);
    }
    return idx;
  });
  const combine = (get) => {
    const out = new Float32Array(N);
    members.forEach((m, k) => {
      const src = get(m); const idx = maps[k];
      for (let c = 0; c < N; c += 1) { const q = idx[c]; if (q >= 0 && src[q] > out[c]) out[c] = src[q]; }
    });
    return out;
  };
  const probs = {};
  for (const L of LEADS) probs[L] = combine((m) => m.probs[L]);
  const now10 = combine((m) => m.fields.now10);

  // System statistics: strikes add up; motion is the strike-weighted mean.
  let W = 0; let vx = 0; let vy = 0; let latest = 0; let previous = 0; let lat = 0; let lon = 0;
  for (const m of members) {
    const wt = Math.max(1, m.track.n10);
    W += wt; vx += wt * m.motion.vx; vy += wt * m.motion.vy; lat += wt * m.track.lat; lon += wt * m.track.lon;
    latest += m.trend.latest10; previous += m.trend.previous10;
  }
  vx /= W; vy /= W;
  const spread = Math.max(...members.map((m) => Math.hypot(m.motion.vx - vx, m.motion.vy - vy) * 60), primary.motion.spreadKmh || 0);
  const track = Object.assign(primary.track, {
    lat: lat / W, lon: lon / W,
    n10: members.reduce((t, m) => t + m.track.n10, 0),
    cycles: Math.max(...members.map((m) => m.track.cycles)),
    systemCells: members.length,
  });
  return {
    item: {
      track,
      probs,
      fields: { grid, now10 },
      motion: { vx, vy, speedKmh: Math.hypot(vx, vy) * 60, sources: [...new Set(members.flatMap((m) => m.motion.sources))], spreadKmh: spread },
      trend: { latest10: latest, previous10: previous, logRatio: Math.log((latest + 1) / (previous + 1)) },
      env: primary.env,
      coverage: primary.coverage,
    },
    absorbed: members.filter((m) => m !== primary).map((m) => m.track),
  };
}
