/**
 * ECMWF ensemble scenarios on the scenario maps: isobars of each scenario's mean
 * pressure, its highs and lows, and a plain-English reading of its UK weather type.
 *
 * The server clusters the 50 members (server/pastFuture/ens_scenarios.py) and sends each
 * cluster's mean MSLP on a 0.5° grid. Here that grid is upsampled bilinearly to 0.125°,
 * contoured every 4 hPa with marching squares, the segments are chained into lines and
 * drawn as smooth curves in the map's own projection (scnProject), so they line up with
 * the coastline and with anything drawn on top.
 */
import React from 'react';
import { scnProject, SCN_VIEW_W, SCN_VIEW_H } from './NWEuropeMap';

const LWT_DIR = {
  N: 'northerly', NE: 'north-easterly', E: 'easterly', SE: 'south-easterly',
  S: 'southerly', SW: 'south-westerly', W: 'westerly', NW: 'north-westerly',
};
const DIR_FEEL = {
  N: 'cold, showery', NE: 'cold, dry', E: 'cold, dry', SE: 'mild, dry', S: 'warm, humid',
  SW: 'mild, wet', W: 'mild, changeable', NW: 'cool, showery',
};

/** Plain-English summary of a Jenkinson-Collison weather type. */
export function describeLwt(lwt) {
  if (!lwt) return null;
  const wind = lwt.F < 10 ? 'light winds' : lwt.F < 20 ? 'breezy' : lwt.F < 30 ? 'windy' : 'gales possible';
  const t = lwt.type;
  let head, feel;
  if (t === 'U') { head = 'Slack pressure'; feel = 'light and variable winds'; }
  else if (t === 'A') { head = 'High pressure'; feel = 'settled and mostly dry'; }
  else if (t === 'C') { head = 'Low pressure'; feel = 'unsettled, rain and showers'; }
  else if (t.length > 1 && (t[0] === 'A' || t[0] === 'C') && LWT_DIR[t.slice(1)]) {
    const d = t.slice(1);
    head = `${t[0] === 'A' ? 'High pressure' : 'Low pressure'}, ${LWT_DIR[d]}`;
    feel = t[0] === 'A' ? `mostly dry, ${DIR_FEEL[d].split(', ')[0]}` : `unsettled, ${DIR_FEEL[d]}`;
  } else {
    head = `${LWT_DIR[t] ? LWT_DIR[t][0].toUpperCase() + LWT_DIR[t].slice(1) : t} flow`;
    feel = DIR_FEEL[t] || '';
  }
  return { head, feel, wind, line: `${head} · ${feel}${t === 'U' ? '' : ` · ${wind}`}` };
}

function upsample(vals, nx, ny, k) {
  const NX = (nx - 1) * k + 1, NY = (ny - 1) * k + 1, out = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const fx = i / k, fy = j / k, i0 = Math.min(nx - 2, Math.floor(fx)), j0 = Math.min(ny - 2, Math.floor(fy));
    const u = fx - i0, v = fy - j0, a = j0 * nx + i0;
    out[j * NX + i] = (vals[a] * (1 - u) + vals[a + 1] * u) * (1 - v) + (vals[a + nx] * (1 - u) + vals[a + nx + 1] * u) * v;
  }
  return { out, NX, NY };
}

/** Marching squares at one level, segments chained into polylines (grid index space). */
function contourLines(f, nx, ny, lv) {
  const segs = [];
  const at = (i, j) => f[j * nx + i];
  const t = (a, b) => (lv - a) / (b - a || 1e-9);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    const idx = (a >= lv ? 1 : 0) | (b >= lv ? 2 : 0) | (c >= lv ? 4 : 0) | (d >= lv ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const e = [[i + t(a, b), j], [i + 1, j + t(b, c)], [i + t(d, c), j + 1], [i, j + t(a, d)]];
    const T = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]],
      8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[0, 3]] };
    for (const [p, q] of T[idx]) segs.push([e[p], e[q]]);
  }
  // chain: join segments that share endpoints
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const ends = new Map();
  segs.forEach((s, n) => { for (const p of s) { const k = key(p); (ends.get(k) || ends.set(k, []).get(k)).push(n); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const line = [segs[n][0], segs[n][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line[line.length - 1] : line[0];
        const nxt = (ends.get(key(tip)) || []).find((m) => !used[m]);
        if (nxt == null) break;
        used[nxt] = 1;
        const s = segs[nxt], other = key(s[0]) === key(tip) ? s[1] : s[0];
        if (dir) line.push(other); else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

function smoothPath(P) {
  if (P.length < 3) return `M${P.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}`;
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Everything the map layer needs for one cluster, in SCN_VIEW pixels. */
export function buildEnsembleOverlay(cluster, grid) {
  const K = 4;
  const { out, NX, NY } = upsample(cluster.msl, grid.nx, grid.ny, K);
  const step = grid.d / K;
  const toPx = ([gi, gj]) => scnProject(grid.lon0 + gi * step, grid.lat0 + gj * step);
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const isobars = [], labels = [];
  for (let p = Math.ceil(lo / 4) * 4; p <= hi; p += 4) {
    for (const line of contourLines(out, NX, NY, p)) {
      if (line.length < 6) continue;
      const P = line.map(toPx);
      isobars.push({ p, d: smoothPath(P), bold: p % 20 === 0 || p === 1012 });
      // one label per line, at the point nearest the left third of the map that is on-screen
      const on = P.filter(([x, y]) => x > 24 && x < SCN_VIEW_W - 24 && y > 18 && y < SCN_VIEW_H - 18);
      if (on.length > 8) {
        const pick = on.reduce((b, q) => (Math.abs(q[0] - SCN_VIEW_W * 0.3) < Math.abs(b[0] - SCN_VIEW_W * 0.3) ? q : b), on[0]);
        if (!labels.some((l) => Math.hypot(l.x - pick[0], l.y - pick[1]) < 34)) labels.push({ x: pick[0], y: pick[1], p });
      }
    }
  }
  const centres = (cluster.centres || []).map((c) => {
    const [x, y] = scnProject(c.lon, c.lat);
    return { ...c, x, y };
  }).filter((c) => c.x > 10 && c.x < SCN_VIEW_W - 10 && c.y > 10 && c.y < SCN_VIEW_H - 10);
  return { isobars, labels, centres, lwt: cluster.lwt, summary: describeLwt(cluster.lwt), members: cluster.n };
}

export function EnsembleLayer({ auto }) {
  if (!auto) return null;
  return (
    <svg viewBox={`0 0 ${SCN_VIEW_W} ${SCN_VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {auto.isobars.map((l, i) => (
          <path key={i} d={l.d} stroke={l.bold ? 'rgba(255,255,255,0.92)' : 'rgba(226,232,240,0.72)'} strokeWidth={l.bold ? 1.7 : 1.05} />
        ))}
      </g>
      <g fontFamily="'DM Mono','SFMono-Regular',monospace" fontSize="8.5" fontWeight="700" textAnchor="middle">
        {auto.labels.map((l, i) => (
          <g key={i}>
            <rect x={l.x - 13} y={l.y - 6.5} width="26" height="13" rx="4" fill="rgba(10,20,40,0.85)" />
            <text x={l.x} y={l.y + 3} fill="#e2e8f0">{l.p}</text>
          </g>
        ))}
      </g>
      <g fontFamily="Inter, system-ui, sans-serif" textAnchor="middle">
        {auto.centres.map((c, i) => (
          <g key={i}>
            <text x={c.x} y={c.y + 9} fontSize="28" fontWeight="900" fill={c.t === 'H' ? '#60a5fa' : '#f87171'}
              stroke="rgba(5,10,25,0.85)" strokeWidth="3" paintOrder="stroke">{c.t}</text>
            <text x={c.x} y={c.y + 23} fontSize="9.5" fontWeight="800" fill="#f8fafc"
              stroke="rgba(5,10,25,0.85)" strokeWidth="2.5" paintOrder="stroke">{c.p}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
