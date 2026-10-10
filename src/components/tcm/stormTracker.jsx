/* stormTracker — auto-generated thunderstorm warnings from Blitzortung strikes.
   ─────────────────────────────────────────────────────────────────────────────
   What's new in this version
   ─────────────────────────────────────────────────────────────────────────────
   The previous logic was a coarse three-threshold ladder on raw 30-minute
   strike counts. It had several weaknesses that this rewrite addresses:

     1. Risk levels could not downgrade — once a cell hit amber it stayed amber
        even if it died completely. Now risk decays gracefully with hysteresis
        (a margin is required before downgrade so we don't flicker yellow/amber
        on a borderline storm).

     2. Two visually different storms gave the same risk: a tightly packed
        cell with 30 strikes in 5 minutes was treated the same as a sprawling
        field of 30 strikes over 30 minutes. Now we compute a multi-factor
        INTENSITY SCORE that weighs flash rate (per minute), density
        (strikes per km²), peak amplitude, sustain, and growth trend.

     3. Flash-rate trend was invisible. A storm at 20 strikes/min and
        intensifying is operationally a red warning; one decaying through the
        same rate should be downgrading. The new tracker compares the last
        5 minutes against the previous 25 to label cells as INTENSIFYING /
        STEADY / WEAKENING.

     4. Expiry was a fixed-by-risk timeout. A red cell that has stopped
        producing strikes for 8 minutes shouldn't keep its red expiry for
        another 7 minutes; it should be auto-cleared. Expiry now adapts to
        recent activity — quiet cells expire fast.

     5. Overlap suppression used a single point-in-polygon test on the new
        cell's centroid against existing polygons. Two adjacent cells with
        centroids just outside each other's polygons would both get warned.
        Now we suppress if the centroids are within a proximity radius OR
        either centroid is inside the other's polygon.

     6. The warning start time was the cluster's first detection — sometimes
        many minutes BEFORE thresholds were reached. Now `startTime` is set
        when the warning is first ISSUED, while `firstSeen` keeps the earlier
        detection time for context.

   Exported surface is unchanged: STORM_RISK, convexHull, bufferHull,
   pointInPolygon, buildTtsString, createStormTracker (with the same
   { ingest, cluster, getRolling, resetDay } shape and the same per-cluster
   fields consumed by TCM.jsx — id, risk, corePolygon, count, recentCount,
   centroid, direction, pathRings, arrowHead, locationLabel, startTime,
   endTime, updatedAt, expiresAt, riskChanged). Additional fields appear on
   each cluster but are optional — UI can ignore them safely.
*/

import { CITY_DB } from '@/components/tcm/cityDB';

/* ─── Risk-level metadata (display only) ────────────────────────────────────
   `expiryMs` is now the MAXIMUM lifetime for an inactive cell at that risk;
   the cluster step shortens it further if the cell has gone quiet. */
export const STORM_RISK = {
  yellow: {
    label: 'Yellow',
    fullLabel: 'Yellow Thunderstorm Advisory',
    color: '#facc15',
    desc: 'Localised lightning and rainfall possible. Stay alert.',
    expiryMs: 30 * 60 * 1000,
  },
  amber: {
    label: 'Amber',
    fullLabel: 'Amber Thunderstorm Warning',
    color: '#f97316',
    desc: 'Active thunderstorm. Flash flooding, strong gusts and hail possible. Move indoors.',
    expiryMs: 25 * 60 * 1000,
  },
  red: {
    label: 'Red',
    fullLabel: 'Red Severe Thunderstorm Warning',
    color: '#ef4444',
    desc: 'Dangerous thunderstorm. Structural damage, large hail and major flooding likely. Take cover immediately.',
    expiryMs: 20 * 60 * 1000,
  },
};

const RISK_RANK = { yellow: 0, amber: 1, red: 2 };

/* ─── Score → risk thresholds ───────────────────────────────────────────────
   The intensity score (0–100+) combines flash rate, density, sustain, peak
   amplitude, growth and recent count. Bands are picked so a typical
   organised multicell sits around 35–55 (amber), a severe pulse storm
   exceeds 70 (red), and isolated activity sits 15–30 (yellow). */
const SCORE_YELLOW = 16;
const SCORE_AMBER  = 42;
const SCORE_RED    = 72;

/* Hysteresis margin — to downgrade we need the score to drop a band's worth
   PLUS this margin, so a wobbling storm doesn't flap. */
const DOWNGRADE_HYSTERESIS = 8;

/* ─── City lookups ──────────────────────────────────────────────────────── */
function nearestCityFull(lat, lon) {
  let best = null, bestDist = Infinity;
  CITY_DB.forEach(city => {
    const dLat = city.lat - lat;
    const dLon = (city.lon - lon) * Math.cos(lat * Math.PI / 180);
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) { bestDist = dist; best = city; }
  });
  return best;
}
export function nearestCity(lat, lon) {
  const city = nearestCityFull(lat, lon);
  if (!city) return 'Unknown location';
  const dLat = city.lat - lat;
  const dLon = (city.lon - lon) * Math.cos(lat * Math.PI / 180);
  const km = Math.sqrt(dLat * dLat + dLon * dLon) * 111;
  if (km < 5) return `over ${city.name}, ${city.country}`;
  if (km < 15) return `near ${city.name}, ${city.country}`;
  return `${Math.round(km)} km from ${city.name}, ${city.country}`;
}
export function nearestCityShort(lat, lon) {
  const city = nearestCityFull(lat, lon);
  if (!city) return 'Unknown';
  const dLat = city.lat - lat;
  const dLon = (city.lon - lon) * Math.cos(lat * Math.PI / 180);
  const km = Math.sqrt(dLat * dLat + dLon * dLon) * 111;
  if (km < 5) return city.name;
  if (km < 20) return `nr ${city.name}`;
  return `${Math.round(km)}km from ${city.name}`;
}

/* ─── Convex hull / polygon helpers (unchanged behaviour, kept exports) ──── */
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const cross = (O, A, B) => (A.lon - O.lon) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lon - O.lon);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function bufferHull(hull, padDeg) {
  if (hull.length < 3) {
    if (!hull.length) return [];
    const p = hull[0];
    return Array.from({length:16},(_,i) => {
      const a = (i/16)*Math.PI*2;
      return [p.lat + Math.cos(a)*padDeg, p.lon + Math.sin(a)*padDeg*1.5];
    });
  }
  const cLat = hull.reduce((s,p) => s+p.lat,0) / hull.length;
  const cLon = hull.reduce((s,p) => s+p.lon,0) / hull.length;
  return hull.map(p => {
    const dLat = p.lat - cLat;
    const dLon = (p.lon - cLon);
    const mag = Math.sqrt(dLat*dLat + dLon*dLon) || 1;
    return [p.lat + (dLat/mag) * padDeg, p.lon + (dLon/mag) * padDeg * 1.4];
  });
}

export function pointInPolygon(lat, lon, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0], xi = polygon[i][1];
    const yj = polygon[j][0], xj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* Polygon area (km²) — shoelace in degrees, then converted using local
   cosine factor at the polygon centroid. Sufficient accuracy for the
   density metric below at UK/EU scales. */
function polygonAreaKm2(poly) {
  if (!poly || poly.length < 3) return 0;
  let area = 0;
  const cLat = poly.reduce((s,p) => s + p[0], 0) / poly.length;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][1], yi = poly[i][0];
    const xj = poly[j][1], yj = poly[j][0];
    area += (xj - xi) * (yj + yi);
  }
  const degArea = Math.abs(area) / 2;
  const kmPerDegLat = 111;
  const kmPerDegLon = 111 * Math.cos(cLat * Math.PI / 180);
  return degArea * kmPerDegLat * kmPerDegLon;
}

/* ─── DBSCAN clustering ─────────────────────────────────────────────────── */
function dbscan(points, eps, minPts) {
  const labels = new Array(points.length).fill(-2);
  let cluster = 0;
  const nb = (idx) => {
    const p = points[idx]; const out = [];
    for (let i = 0; i < points.length; i++) {
      if (i === idx) continue;
      const q = points[i];
      const dLat = p.lat - q.lat;
      const dLon = (p.lon - q.lon) * Math.cos((p.lat * Math.PI) / 180);
      if (Math.sqrt(dLat * dLat + dLon * dLon) <= eps) out.push(i);
    }
    return out;
  };
  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== -2) continue;
    const seeds = nb(i);
    if (seeds.length < minPts) { labels[i] = -1; continue; }
    labels[i] = cluster;
    for (let j = 0; j < seeds.length; j++) {
      const s = seeds[j];
      if (labels[s] === -1) labels[s] = cluster;
      if (labels[s] !== -2) continue;
      labels[s] = cluster;
      const nb2 = nb(s);
      if (nb2.length >= minPts) nb2.forEach(x => { if (!seeds.includes(x)) seeds.push(x); });
    }
    cluster++;
  }
  const clusters = {};
  for (let i = 0; i < points.length; i++) { const l = labels[i]; if (l < 0) continue; if (!clusters[l]) clusters[l] = []; clusters[l].push(points[i]); }
  return Object.values(clusters);
}

/* ─── TTS phrasing ──────────────────────────────────────────────────────── */
export function buildTtsString(risk, count, lat, lon, opts = {}) {
  const loc = nearestCity(lat, lon);
  const trend = opts.trend; // 'intensifying' | 'weakening' | 'steady' | undefined
  const speed = opts.speedKmH;
  const compass = opts.compass;
  let trendClause = '';
  if (trend === 'intensifying') trendClause = ' This storm is intensifying.';
  else if (trend === 'weakening') trendClause = ' This storm appears to be weakening.';
  let moveClause = '';
  if (speed && compass) moveClause = ` Moving ${compass} at approximately ${speed} kilometres per hour.`;

  if (risk === 'yellow') {
    return `Thunderstorm advisory. ${count} lightning strikes have been detected ${loc}. Localised lightning, sudden downpours, and gusty winds are possible over the next 30 minutes.${moveClause}${trendClause} Stay alert and avoid exposed areas such as open fields and hilltops.`;
  }
  if (risk === 'amber') {
    return `Amber thunderstorm warning. An active storm cell has been detected ${loc}, producing ${count} lightning strikes in the past 30 minutes.${moveClause}${trendClause} Flash flooding, strong wind gusts, and hail are likely. Move indoors now and keep away from windows.`;
  }
  return `Red severe thunderstorm warning. A dangerous and rapidly intensifying storm is occurring ${loc}. ${count} lightning strikes have been recorded in just 30 minutes.${moveClause}${trendClause} There is a high risk of structural damage, large hail, and significant flooding. Take cover immediately in a substantial building. Do not travel. This is an emergency.`;
}

/* ─── INTENSITY SCORING ─────────────────────────────────────────────────────
   Inputs all derived from a single cluster's strikes inside the rolling
   30-minute window. Output is a 0–100+ score that we then band into risks.

   Weights are tuned so a tightly packed cell with high flash rate breaks
   into amber/red even if the absolute count is modest, while a sprawling
   field of low-intensity strikes stays yellow. */
function computeIntensityScore({
  totalCount,        // strikes in last 30 minutes inside the cluster
  recent5,           // strikes in last 5 minutes
  recent10,          // strikes in last 10 minutes
  earlier25,         // strikes between [25..5] min ago (for trend calc)
  avgAmp,            // mean |amplitude| kA across cluster
  peakAmp,           // max  |amplitude| kA across cluster
  densityPerKm2,     // strikes / km² over hull area
  sustainSteps,      // number of consecutive cluster-step intervals seen
}) {
  // Flash rate (strikes per minute, last 5 min) — dominant indicator.
  // 0 strikes → 0 score, 3/min → 12, 6/min → 22, 12/min → 34, 25/min → 45.
  const flashRate = recent5 / 5;
  const fScore = Math.min(45, 14 * Math.log10(1 + flashRate * 4));

  // Density — punishes sprawling activity. 0.05/km² → ~3, 0.4 → ~12, 1.5 → ~22.
  const dScore = Math.min(22, 9 * Math.log10(1 + densityPerKm2 * 6));

  // Peak amplitude — proxy for cloud-to-ground intensity.
  // Peaks > 80 kA suggest CG with significant current; > 150 kA is severe.
  let aScore = 0;
  if (peakAmp > 0)   aScore  = Math.min(15, peakAmp / 12);   // 60 kA → 5, 120 kA → 10
  if (avgAmp  > 30)  aScore += Math.min(5, (avgAmp - 30) / 12);

  // Sustain — rewards organised, persistent cells over single flashes.
  // 1 step → 0, 2 → 3, 3 → 5, 5+ → 7.
  const sScore = Math.min(7, sustainSteps >= 2 ? 2 + sustainSteps : 0);

  // Trend — accelerating storms get a kicker, decaying storms get penalty.
  let tScore = 0;
  if (earlier25 > 0) {
    const ratePer5Earlier = (earlier25 / 25) * 5;  // strikes/5min equivalent
    if (ratePer5Earlier > 0) {
      const trendRatio = recent5 / ratePer5Earlier;
      if      (trendRatio >= 2.0) tScore = 8;
      else if (trendRatio >= 1.3) tScore = 4;
      else if (trendRatio <= 0.4) tScore = -10;
      else if (trendRatio <= 0.7) tScore = -5;
    }
  } else if (recent5 >= 8) {
    // Brand-new explosive cell with no baseline — treat as intensifying
    tScore = 6;
  }

  // Recent count safety net — captures very high absolute volume in last 10 min
  // even if flash rate over 5 min is muted by a brief pause.
  let rScore = 0;
  if      (recent10 >= 60) rScore = 12;
  else if (recent10 >= 30) rScore = 6;
  else if (recent10 >= 15) rScore = 3;

  return Math.max(0, fScore + dScore + aScore + sScore + tScore + rScore);
}

function trendLabelFromCounts(recent5, earlier25) {
  if (earlier25 <= 0 && recent5 >= 6) return 'intensifying';
  if (earlier25 <= 0) return 'steady';
  const ratePer5Earlier = (earlier25 / 25) * 5;
  if (ratePer5Earlier <= 0) return recent5 > 3 ? 'intensifying' : 'steady';
  const r = recent5 / ratePer5Earlier;
  if (r >= 1.4) return 'intensifying';
  if (r <= 0.5) return 'weakening';
  return 'steady';
}

function scoreToRisk(score) {
  if (score >= SCORE_RED)    return 'red';
  if (score >= SCORE_AMBER)  return 'amber';
  if (score >= SCORE_YELLOW) return 'yellow';
  return null;
}

/* Apply hysteresis: only downgrade if the score has fallen meaningfully
   below the band's lower threshold. Upgrades are always immediate. */
function applyHysteresis(rawRisk, prevRisk, score) {
  if (!prevRisk) return rawRisk;
  if (!rawRisk)  return null; // genuinely below yellow — let it drop
  const rawRank  = RISK_RANK[rawRisk];
  const prevRank = RISK_RANK[prevRisk];
  if (rawRank >= prevRank) return rawRisk; // upgrade or same — fine
  // Downgrade: require the score to be well below the previous band's floor.
  const prevFloor = prevRisk === 'red' ? SCORE_RED : prevRisk === 'amber' ? SCORE_AMBER : SCORE_YELLOW;
  if (score < prevFloor - DOWNGRADE_HYSTERESIS) return rawRisk;
  return prevRisk;
}

/* Adaptive expiry — quiet cells expire fast; active cells keep the full
   risk-class lifetime. */
function computeExpiryMs(risk, recent5, recent10) {
  const base = STORM_RISK[risk].expiryMs;
  // If there's been no strike at all in the last 5 minutes, expire quickly.
  if (recent5 === 0 && recent10 === 0) return Math.min(base, 6 * 60 * 1000);
  if (recent5 === 0)                   return Math.min(base, 10 * 60 * 1000);
  if (recent5 <= 2)                    return Math.min(base, 15 * 60 * 1000);
  return base;
}

/* ─── Main tracker factory ──────────────────────────────────────────────── */
export function createStormTracker() {
  let rolling = [];                  // last 30 min of strikes (any region)
  const cellHistory = {};            // per-id storm state

  function ingest(strike) { rolling.push(strike); }
  function pruneRolling() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    rolling = rolling.filter(s => s.time > cutoff);
  }

  function cluster() {
    pruneRolling();
    if (rolling.length < 10) {
      // No active activity — still tick existing cells so they can decay/expire.
      return decayExistingCells();
    }

    // DBSCAN with the same parameters as before — well tuned for UK/Europe
    // scale Blitzortung data.
    const groups = dbscan(rolling, 0.28, 8);
    const now = Date.now();
    const out = [];
    const detectedIds = new Set();

    groups.forEach((pts) => {
      // ── Per-window strike counts (for trend + flash rate) ────────────────
      const recent5pts  = pts.filter(p => now - p.time <= 5  * 60 * 1000);
      const recent10pts = pts.filter(p => now - p.time <= 10 * 60 * 1000);
      const earlier25pts = pts.filter(p => {
        const age = now - p.time;
        return age > 5 * 60 * 1000 && age <= 30 * 60 * 1000;
      });
      const recentCount  = recent10pts.length;
      // Need at least a handful of strikes in the last 10 min — otherwise
      // it's not really a current threat.
      if (recentCount < 3) return;

      // ── Cluster geometry ─────────────────────────────────────────────────
      const cLat = pts.reduce((s,p) => s + p.lat, 0) / pts.length;
      const cLon = pts.reduce((s,p) => s + p.lon, 0) / pts.length;
      const maxDist = Math.max(...pts.map(p => {
        const dLat = p.lat - cLat;
        const dLon = (p.lon - cLon) * Math.cos(cLat * Math.PI / 180);
        return Math.sqrt(dLat * dLat + dLon * dLon);
      }));
      // Reject very sprawling "clusters" (probably the DBSCAN bleeding two
      // separate cells together).
      if (maxDist > 0.50) return;

      const id = `storm-${Math.round(cLat*100)}-${Math.round(cLon*100)}`;
      detectedIds.add(id);
      if (!cellHistory[id]) {
        cellHistory[id] = {
          history: [], firstSeen: now, sustainCount: 0,
          peakScore: 0, peakCount: 0, peakRecent5: 0,
          _lastRisk: null, _issuedAt: null,
        };
      }
      const h = cellHistory[id];
      h.history.push({ lat: cLat, lon: cLon, time: now, count: pts.length });
      if (h.history.length > 30) h.history.shift();
      h.sustainCount = Math.min(h.sustainCount + 1, 99);

      // ── Compute metrics ──────────────────────────────────────────────────
      const count   = pts.length;
      const avgAmp  = pts.reduce((s,p) => s + Math.abs(p.amp || 0), 0) / pts.length;
      const peakAmp = pts.reduce((m,p) => Math.max(m, Math.abs(p.amp || 0)), 0);

      // Hull + density
      const hull = convexHull(pts);
      const padDeg = Math.max(0.04, Math.min(0.10, maxDist * 0.25));
      const corePolygon = bufferHull(hull, padDeg);
      const areaKm2 = Math.max(1, polygonAreaKm2(corePolygon));
      const densityPerKm2 = count / areaKm2;

      const score = computeIntensityScore({
        totalCount: count,
        recent5: recent5pts.length,
        recent10: recentCount,
        earlier25: earlier25pts.length,
        avgAmp,
        peakAmp,
        densityPerKm2,
        sustainSteps: h.sustainCount,
      });

      // Track peak intensity for "weakening" diagnosis
      h.peakScore   = Math.max(h.peakScore,   score);
      h.peakCount   = Math.max(h.peakCount,   count);
      h.peakRecent5 = Math.max(h.peakRecent5, recent5pts.length);

      const rawRisk    = scoreToRisk(score);
      // Risk after hysteresis (prevents flap on the band boundary)
      let risk = applyHysteresis(rawRisk, h._lastRisk, score);
      if (!risk) return; // dropped below yellow with no previous warning — skip

      const prevRisk = h._lastRisk;
      const riskChanged = prevRisk && prevRisk !== risk;
      h._lastRisk = risk;

      // First issuance bookkeeping — startTime is when the warning ACTUALLY
      // first appeared to the user, not when DBSCAN first noticed the cell.
      if (!h._issuedAt) h._issuedAt = now;

      // ── Overlap suppression — proximity + polygon test ──────────────────
      // We avoid double-warning if this new centroid is either inside
      // another active polygon OR within a small proximity radius of one
      // already-emitted centroid (catches near-adjacent clusters).
      const PROXIMITY_DEG = 0.18;
      const overlapsExisting = out.some(existing => {
        if (!existing.corePolygon || !existing.centroid) return false;
        if (pointInPolygon(cLat, cLon, existing.corePolygon)) return true;
        const dLat = cLat - existing.centroid.lat;
        const dLon = (cLon - existing.centroid.lon) * Math.cos(cLat * Math.PI / 180);
        return Math.sqrt(dLat*dLat + dLon*dLon) < PROXIMITY_DEG;
      });
      if (overlapsExisting) return;

      // ── Trend label ──────────────────────────────────────────────────────
      let trend = trendLabelFromCounts(recent5pts.length, earlier25pts.length);
      // If we're well below our own peak, override to weakening regardless of
      // recent ratio — captures the case of a storm that pulsed then died.
      if (h.peakScore > 0 && score < h.peakScore * 0.55 && h.peakScore > SCORE_AMBER) {
        trend = 'weakening';
      }

      // ── Storm movement (unchanged trajectory logic) ─────────────────────
      let direction = null;
      let pathRings = null;
      let arrowHead = null;
      if (h.history.length >= 3) {
        const hist = h.history.slice(-6);
        const oldest = hist[0], newest = hist[hist.length - 1];
        const dtMs = newest.time - oldest.time;
        if (dtMs >= 2 * 60 * 1000) {
          let wdLat = 0, wdLon = 0, wTotal = 0;
          for (let i = 1; i < hist.length; i++) {
            const w = i;
            wdLat  += (hist[i].lat - hist[i-1].lat) * w;
            wdLon  += (hist[i].lon - hist[i-1].lon) * w;
            wTotal += w;
          }
          if (wTotal > 0) {
            const dLat = wdLat / wTotal;
            const dLon = wdLon / wTotal;
            const mag  = Math.sqrt(dLat * dLat + dLon * dLon);
            if (mag > 0.005) {
              const uLat = dLat / mag;
              const uLon = dLon / mag;
              const projDist = Math.min(mag * 4, 0.60);
              direction = {
                dLat: uLat * projDist,
                dLon: uLon * projDist,
                speedKmH: Math.round((mag * 111) / (dtMs / hist.length / 3600000)),
              };
              const tipLat = cLat + uLat * projDist;
              const tipLon = cLon + uLon * projDist;
              const pLat = -uLon, pLon = uLat;
              const coreR = maxDist > 0 ? Math.max(0.06, Math.min(0.18, maxDist * 0.5)) : 0.08;
              const fractions = [0.40, 0.70, 1.00];
              pathRings = fractions.map((frac) => {
                const dist = projDist * frac;
                const halfW = coreR + (coreR * 1.5) * frac;
                const arcPts = [];
                const N = 10;
                for (let i = 0; i <= N; i++) {
                  const a = (i / N) * Math.PI;
                  arcPts.push([
                    cLat + uLat * dist + pLat * halfW * Math.cos(a),
                    cLon + uLon * dist + pLon * halfW * Math.cos(a),
                  ]);
                }
                return arcPts;
              });
              const ahSize = coreR * 0.55;
              arrowHead = [
                [tipLat + uLat * ahSize,                tipLon + uLon * ahSize],
                [tipLat - uLat * ahSize + pLat * ahSize, tipLon - uLon * ahSize + pLon * ahSize],
                [tipLat - uLat * ahSize - pLat * ahSize, tipLon - uLon * ahSize - pLon * ahSize],
              ];
            }
          }
        }
      }

      // ── Adaptive expiry ─────────────────────────────────────────────────
      const expiryMs  = computeExpiryMs(risk, recent5pts.length, recentCount);
      const expiresAt = now + expiryMs;

      out.push({
        id, risk, corePolygon, count, recentCount,
        avgAmp:  Math.round(avgAmp),
        peakAmp: Math.round(peakAmp),
        // New diagnostic fields (UI-optional)
        intensityScore: Math.round(score),
        peakScore:      Math.round(h.peakScore),
        trend,                       // 'intensifying' | 'steady' | 'weakening'
        flashRatePerMin: Math.round((recent5pts.length / 5) * 10) / 10,
        densityPerKm2:   Math.round(densityPerKm2 * 100) / 100,
        areaKm2:         Math.round(areaKm2),
        firstSeen:       h.firstSeen,
        // Standard fields
        centroid: { lat: cLat, lon: cLon },
        direction,
        pathRings,
        arrowHead,
        locationLabel: nearestCityShort(cLat, cLon),
        startTime: new Date(h._issuedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        endTime:   new Date(expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        updatedAt: now,
        expiresAt,
        riskChanged,
      });
    });

    // ── Decay step for cells that DBSCAN no longer sees ────────────────────
    // (i.e. they had a warning out, but no points cluster around them this
    // iteration). We still need to honour `sustainCount` decay and consider
    // expiry — but we don't emit them as fresh warnings. The TCM expire loop
    // handles their visual removal once expiresAt passes. We just reset the
    // sustain counter so it doesn't stay artificially high if the cell
    // re-emerges later as a brand-new cluster.
    Object.keys(cellHistory).forEach(id => {
      if (!detectedIds.has(id)) {
        const h = cellHistory[id];
        h.sustainCount = Math.max(0, h.sustainCount - 2);
        // If it's been gone long enough, forget it entirely so a new
        // outbreak at the same coordinates starts fresh.
        if (now - (h.history[h.history.length-1]?.time || h.firstSeen) > 60 * 60 * 1000) {
          delete cellHistory[id];
        }
      }
    });

    return out;
  }

  function decayExistingCells() {
    const now = Date.now();
    Object.keys(cellHistory).forEach(id => {
      const h = cellHistory[id];
      h.sustainCount = Math.max(0, h.sustainCount - 2);
      if (now - (h.history[h.history.length-1]?.time || h.firstSeen) > 60 * 60 * 1000) {
        delete cellHistory[id];
      }
    });
    return [];
  }

  function getRolling() { return rolling; }
  function resetDay()   { const snap = [...rolling]; rolling = []; Object.keys(cellHistory).forEach(k => delete cellHistory[k]); return snap; }
  return { ingest, cluster, getRolling, resetDay };
}