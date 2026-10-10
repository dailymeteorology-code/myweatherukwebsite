/* stormHazardModel — professional-grade hazard assessment & reasoning layer
   ────────────────────────────────────────────────────────────────────────────
   Turns the raw cluster metrics already produced by stormTracker (intensity
   score, flash rate, density, amplitude, trend, area, motion) into the kind of
   diagnostic output a human storm forecaster would write on a warning:

     • per-hazard probabilities  — hail / damaging wind / flash flood / frequent CG
     • lifecycle stage           — developing / mature / peak / weakening / decaying
     • a plain-English RATIONALE  — *why* the level was issued, in forecaster prose
     • headline impacts list      — bulleted operational impacts
     • area-coverage description  — km², populated places affected, motion swath

   Everything here is derived from the metrics already computed — no new data
   sources. The numbers are calibrated heuristics tuned to Blitzortung lightning
   density at UK/EU scales; they are clearly framed as estimates, not model QPF.
   ────────────────────────────────────────────────────────────────────────────
*/

import { CITY_DB } from '@/components/tcm/cityDB';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ─── Per-hazard probability estimates (0–100%) ──────────────────────────────
   Each hazard blends the indicators that physically precede it. These are
   transparent, monotonic functions — higher intensity / flash rate / amplitude
   push the probability up, capped to sane ceilings for a lightning-only sensor.
*/
export function estimateHazards({
  intensityScore = 0,
  flashRatePerMin = 0,
  densityPerKm2 = 0,
  peakAmp = 0,
  avgAmp = 0,
  recentCount = 0,
  trend = 'steady',
  risk = 'yellow',
}) {
  const trendBoost = trend === 'intensifying' ? 1.18 : trend === 'weakening' ? 0.78 : 1;

  // Large hail — driven by deep, vigorous updraughts. High flash rate + high
  // peak amplitude + tight density are the lightning-proxy fingerprints.
  let hail =
    flashRatePerMin * 2.6 +
    densityPerKm2 * 9 +
    Math.max(0, peakAmp - 60) * 0.18 +
    intensityScore * 0.45;
  hail = clamp(hail * trendBoost, 0, 92);

  // Damaging straight-line wind — favoured by high flash rate (vigorous
  // convection / downbursts) and overall intensity.
  let wind =
    flashRatePerMin * 2.9 +
    intensityScore * 0.55 +
    Math.max(0, recentCount - 20) * 0.25;
  wind = clamp(wind * trendBoost, 0, 90);

  // Flash flooding — favoured by sustained, dense activity (slow-moving /
  // training cells with many strikes over a small area).
  let flood =
    densityPerKm2 * 14 +
    Math.max(0, recentCount - 15) * 0.6 +
    intensityScore * 0.35;
  flood = clamp(flood * (trend === 'weakening' ? 0.9 : 1), 0, 88);

  // Frequent cloud-to-ground lightning — most directly observed of all.
  let frequentCG =
    flashRatePerMin * 6 +
    Math.max(0, avgAmp - 15) * 0.5 +
    intensityScore * 0.4;
  frequentCG = clamp(frequentCG, 0, 98);

  // Floor the headline hazard so a red/amber warning never reads "all low".
  const floor = risk === 'red' ? 45 : risk === 'amber' ? 25 : 8;
  hail = Math.max(hail, floor * 0.7);
  wind = Math.max(wind, floor * 0.75);
  frequentCG = Math.max(frequentCG, floor);

  return {
    hail: Math.round(hail),
    wind: Math.round(wind),
    flood: Math.round(flood),
    frequentCG: Math.round(frequentCG),
  };
}

/* ─── Lifecycle stage ──────────────────────────────────────────────────────── */
export function lifecycleStage({ intensityScore = 0, peakScore = 0, trend = 'steady', recentCount = 0 }) {
  if (recentCount < 4 && trend !== 'intensifying') return { key: 'decaying', label: 'Decaying', color: '#94a3b8' };
  if (trend === 'intensifying' && intensityScore < peakScore * 0.85) return { key: 'developing', label: 'Developing', color: '#38bdf8' };
  if (peakScore > 0 && intensityScore >= peakScore * 0.92) return { key: 'peak', label: 'At peak intensity', color: '#ef4444' };
  if (trend === 'weakening') return { key: 'weakening', label: 'Weakening', color: '#f59e0b' };
  return { key: 'mature', label: 'Mature', color: '#f97316' };
}

/* ─── Convert hazard % to a qualitative word ─────────────────────────────── */
export function hazardWord(pct) {
  if (pct >= 70) return 'Likely';
  if (pct >= 45) return 'Probable';
  if (pct >= 25) return 'Possible';
  if (pct >= 10) return 'Low';
  return 'Unlikely';
}

/* ─── Populated places inside / near the warning polygon ──────────────────────
   Returns up to `max` settlements whose coordinates fall within the core
   polygon, or (if none) the closest few to the centroid. Used for the
   "Area covered" section so the warning names real places, like an official one.
*/
function pointInPoly(lat, lon, poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const hit = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

export function placesInArea(corePolygon, centroid, max = 6) {
  if (!centroid) return [];
  const inside = [];
  if (corePolygon && corePolygon.length >= 3) {
    for (const c of CITY_DB) {
      if (pointInPoly(c.lat, c.lon, corePolygon)) inside.push(c);
      if (inside.length >= max) break;
    }
  }
  if (inside.length >= 1) {
    return inside.slice(0, max).map(c => ({ name: c.name, country: c.country }));
  }
  // Fallback: nearest settlements to the centroid (storm is small / between towns)
  const withDist = CITY_DB.map(c => {
    const dLat = c.lat - centroid.lat;
    const dLon = (c.lon - centroid.lon) * Math.cos(centroid.lat * Math.PI / 180);
    return { ...c, d: dLat * dLat + dLon * dLon };
  }).sort((a, b) => a.d - b.d).slice(0, max);
  return withDist.map(c => ({
    name: c.name, country: c.country,
    km: Math.round(Math.sqrt(c.d) * 111),
  }));
}

/* ─── Motion / swath description ─────────────────────────────────────────── */
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export function motionDescription(direction) {
  if (!direction || !direction.speedKmH || direction.speedKmH < 4) {
    return { compass: null, speedKmH: direction?.speedKmH || 0, text: 'Slow-moving / near-stationary', stationary: true };
  }
  const deg = (Math.atan2(direction.dLon, direction.dLat) * 180 / Math.PI + 360) % 360;
  const compass = COMPASS[Math.round(deg / 22.5) % 16];
  const reachKm = Math.round(direction.speedKmH * 0.5); // 30-min projected reach
  return {
    compass, speedKmH: direction.speedKmH, stationary: false,
    text: `Tracking ${compass} at ${direction.speedKmH} km/h — projected ~${reachKm} km downstream over the next 30 minutes.`,
  };
}

/* ─── The headline RATIONALE — forecaster prose for "why issued" ──────────── */
export function buildRationale(storm, hazards, stage, motion) {
  const risk = storm.risk;
  const fr = storm.flashRatePerMin || 0;
  const dens = storm.densityPerKm2 || 0;
  const area = storm.areaKm2 || 0;
  const peak = storm.peakAmp || 0;
  const score = storm.intensityScore || 0;
  const recent = storm.recentCount || 0;

  const parts = [];

  // Opening: what was detected and the basis for the level.
  const levelWord = risk === 'red' ? 'severe' : risk === 'amber' ? 'active' : 'developing';
  parts.push(
    `An ${levelWord} thunderstorm cell has been identified from a dense cluster of ${storm.count || recent} cloud-to-ground lightning detections, with ${recent} strikes in the last 10 minutes.`
  );

  // Flash rate interpretation — the single most diagnostic indicator.
  if (fr >= 12) {
    parts.push(`The cell is producing an exceptional flash rate of ~${fr.toFixed(1)} strikes per minute, which is characteristic of a vigorous, deep updraught capable of severe hazards.`);
  } else if (fr >= 5) {
    parts.push(`A sustained flash rate of ~${fr.toFixed(1)} strikes per minute indicates an organised, electrically active storm.`);
  } else if (fr > 0) {
    parts.push(`The flash rate of ~${fr.toFixed(1)} strikes per minute indicates localised but persistent convective activity.`);
  }

  // Trend / lifecycle.
  if (stage.key === 'developing' || storm.trend === 'intensifying') {
    parts.push(`Lightning frequency is increasing relative to the previous 25 minutes, so the storm is intensifying and impacts may escalate.`);
  } else if (stage.key === 'weakening' || storm.trend === 'weakening') {
    parts.push(`Activity has eased from its earlier peak, so the storm is weakening, though hazards can persist for a time.`);
  } else if (stage.key === 'peak') {
    parts.push(`The storm is at or near its peak intensity.`);
  }

  // Density / amplitude supporting evidence.
  if (dens >= 0.8) {
    parts.push(`Strikes are tightly concentrated (${dens.toFixed(2)} per km²), pointing to a compact, high-impact core.`);
  }
  if (peak >= 120) {
    parts.push(`Peak return-stroke currents of ~${Math.round(peak)} kA have been recorded, consistent with powerful cloud-to-ground discharges.`);
  }

  // Lead hazard call-out.
  const leadHazard = [
    { k: 'hail', v: hazards.hail, label: 'large hail' },
    { k: 'wind', v: hazards.wind, label: 'damaging wind gusts' },
    { k: 'flood', v: hazards.flood, label: 'surface-water / flash flooding' },
  ].sort((a, b) => b.v - a.v)[0];
  if (leadHazard && leadHazard.v >= 25) {
    parts.push(`The primary concern is ${leadHazard.label} (${hazardWord(leadHazard.v).toLowerCase()}, est. ${leadHazard.v}%).`);
  }

  // Motion clause.
  if (motion.stationary) {
    parts.push(`The cell is slow-moving, raising the risk of locally heavy, repeating rainfall over the same area.`);
  } else {
    parts.push(motion.text);
  }

  return parts.join(' ');
}

/* ─── One-line headline impacts (bulleted in the UI) ─────────────────────── */
export function buildImpacts(storm, hazards) {
  const out = [];
  if (hazards.frequentCG >= 30) out.push('Frequent cloud-to-ground lightning — risk to people outdoors and to power infrastructure.');
  if (hazards.hail >= 25) out.push(`Hail ${hazardWord(hazards.hail).toLowerCase()} — possible damage to vehicles, crops and skylights.`);
  if (hazards.wind >= 25) out.push(`Sudden severe gusts ${hazardWord(hazards.wind).toLowerCase()} — loose objects displaced, difficult driving conditions.`);
  if (hazards.flood >= 25) out.push(`Torrential downpours — fast-onset surface-water flooding of roads and low-lying areas ${hazardWord(hazards.flood).toLowerCase()}.`);
  if (storm.risk === 'red') out.push('Travel disruption and a danger to life are possible where the core tracks.');
  if (!out.length) out.push('Localised disruption from lightning and heavy showers.');
  return out;
}

/* ─── Top-level assembler — one call returns the full professional brief ──── */
export function buildStormBrief(storm) {
  const hazards = estimateHazards(storm);
  const stage = lifecycleStage(storm);
  const motion = motionDescription(storm.direction);
  const places = placesInArea(storm.corePolygon, storm.centroid);
  const rationale = buildRationale(storm, hazards, stage, motion);
  const impacts = buildImpacts(storm, hazards);
  return { hazards, stage, motion, places, rationale, impacts };
}