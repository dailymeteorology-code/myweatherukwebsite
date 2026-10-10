// impactedLocations.js
// Derives the list of impacted cities/regions for a given day & risk type by
// matching grid points (with non-trivial risk scores) to the nearest entries
// in CITY_DB. Used by the Day Overview UI and the PDF export.

import { CITY_DB } from '@/components/tcm/cityDB';

// Haversine-lite (km, planar approx — fine for impact grouping)
function distKm(a, b) {
  const dLat = (a.lat - b.lat) * 111;
  const dLon = (a.lon - b.lon) * 111 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Build a ranked list of impacted locations for a given riskType/day.
 *
 * @param {Array}  grid       — TCM grid points with .perDay[].scores
 * @param {string} riskType   — 'thunderstorm' | 'hail' | 'tornado' | 'lightning'
 * @param {number} dayIdx     — 0..3
 * @param {Object} opts
 *        getRiskScore  — accessor (pt, riskType, dayIdx) => number
 *        region        — 'uk' | 'eu'  (limits city pool)
 *        threshold     — min score to count (default 22 = Marginal+)
 *        maxRadiusKm   — only cities within this radius of an active grid point
 *        maxResults    — cap (default 12)
 * @returns {Array<{name, country, score}>}
 */
export function buildImpactedLocations(grid, riskType, dayIdx, opts = {}) {
  const {
    getRiskScore,
    region = 'uk',
    threshold = 18,   // Marginal+ (was 22) → catches Low risk too so towns get listed
    maxRadiusKm = 75, // wider radius so smaller towns get matched
    maxResults = 60,  // far more locations — all major towns + cities
  } = opts;

  if (!grid?.length || typeof getRiskScore !== 'function') return [];

  // 1. Find grid points exceeding threshold
  const hot = [];
  for (const p of grid) {
    const s = getRiskScore(p, riskType, dayIdx);
    if (s >= threshold) hot.push({ lat: p.lat, lon: p.lon, score: s });
  }
  if (!hot.length) return [];

  // 2. Filter city pool by region
  const ukCountries = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland']);
  const cities = CITY_DB.filter(c => region === 'uk' ? ukCountries.has(c.country) : true);

  // 3. For each city, find the nearest hot grid point and assign its score
  const impacted = [];
  for (const city of cities) {
    let best = null;
    for (const h of hot) {
      const d = distKm(city, h);
      if (d <= maxRadiusKm && (!best || h.score > best.score)) {
        best = { ...h, dist: d };
      }
    }
    if (best) {
      impacted.push({ name: city.name, country: city.country, score: best.score });
    }
  }

  // 4. Rank by score desc, dedupe by name, cap
  impacted.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const item of impacted) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
    if (out.length >= maxResults) break;
  }
  return out;
}

/**
 * Group impacted locations into broader regions for narrative prose.
 * Returns a short list like ['southern England', 'east Wales', 'central France'].
 */
export function groupImpactedRegions(locations) {
  if (!locations?.length) return [];
  const buckets = new Map();
  for (const loc of locations) {
    // simple coarse grouping by country
    const key = loc.country;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(loc.name);
  }
  return [...buckets.entries()].map(([country, names]) => ({
    country,
    cities: names.slice(0, 4),
  }));
}