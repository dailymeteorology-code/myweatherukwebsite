/**
 * Gazetteer: turning a warning polygon into named places.
 *
 * Built from GeoNames (geonames.org, CC BY 4.0) — every place with a
 * population over 15,000, with its country, first-level region (state,
 * province, nation, region) and second-level area (county, district,
 * département). See data/geo/build-gazetteer.mjs.
 *
 * This is what the warning descriptions, the voice announcements, the
 * geographical filters and the exposure estimate all read from. Nothing here
 * invents a place: if no town of that size is inside or near a warning, the
 * description says the area is sparsely populated or at sea.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm, pointInGeo, geoBBox, compass8, bearingDeg } from './geometry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAZ_PATH = path.join(here, '..', 'data', 'geo', 'gazetteer.json');

let gaz = null;
const CELL = 1; // spatial-hash cell, degrees

function load() {
  if (gaz) return gaz;
  const raw = JSON.parse(fs.readFileSync(GAZ_PATH, 'utf8'));
  const hash = new Map();
  const places = raw.cities.map(([name, lat, lon, cc, admin1, admin2, pop, tz]) => ({
    name, lat, lon, cc, admin1, admin2, pop, tz,
    country: raw.countries[cc]?.name || cc,
    continent: raw.countries[cc]?.continent || 'Unknown',
  }));
  for (const p of places) {
    const k = `${Math.floor(p.lat / CELL)},${Math.floor(p.lon / CELL)}`;
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(p);
  }
  gaz = { places, hash, countries: raw.countries, source: raw.source };
  return gaz;
}

function near(lat, lon, radiusDeg) {
  const g = load();
  const out = [];
  const r = Math.ceil(radiusDeg / CELL);
  const ci = Math.floor(lat / CELL); const cj = Math.floor(lon / CELL);
  for (let i = ci - r; i <= ci + r; i += 1) for (let j = cj - r; j <= cj + r; j += 1) {
    const list = g.hash.get(`${i},${j}`);
    if (list) out.push(...list);
  }
  return out;
}

/** Places (pop > 15k) inside a GeoJSON geometry, largest first. */
export function placesIn(geom) {
  if (!geom) return [];
  const [w, s, e, n] = geoBBox(geom);
  const g = load();
  const out = [];
  for (let i = Math.floor(s / CELL); i <= Math.floor(n / CELL); i += 1) {
    for (let j = Math.floor(w / CELL); j <= Math.floor(e / CELL); j += 1) {
      const list = g.hash.get(`${i},${j}`);
      if (!list) continue;
      for (const p of list) if (p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n && pointInGeo(p.lon, p.lat, geom)) out.push(p);
    }
  }
  return out.sort((a, b) => b.pop - a.pop);
}

/** Nearest place within maxKm, or null. */
export function nearestPlace(lat, lon, maxKm = 80) {
  const cand = near(lat, lon, Math.ceil(maxKm / 111) + 1);
  let best = null; let bestD = Infinity;
  for (const p of cand) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestD && d <= maxKm) { best = p; bestD = d; }
  }
  return best ? { ...best, distanceKm: bestD } : null;
}

/** The most populous place within maxKm — a better anchor than the nearest hamlet. */
export function anchorPlace(lat, lon, maxKm = 120) {
  const cand = near(lat, lon, Math.ceil(maxKm / 111) + 1);
  let best = null; let score = -Infinity;
  for (const p of cand) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d > maxKm) continue;
    const s = Math.log10(p.pop + 1) - d / 40; // prefer big AND close
    if (s > score) { best = { ...p, distanceKm: d }; score = s; }
  }
  return best;
}

/**
 * Everything the warning record needs about where it is.
 *   geom        current warning area
 *   trackGeom   union-ish of the forecast positions (places the storm will reach)
 */
export function describeGeography(geom, centroid, trackGeoms = []) {
  const inside = placesIn(geom);
  const ahead = [];
  const seen = new Set(inside.map((p) => p.name + p.cc));
  for (const tg of trackGeoms) for (const p of placesIn(tg)) {
    const k = p.name + p.cc;
    if (!seen.has(k)) { seen.add(k); ahead.push(p); }
  }
  const [clat, clon] = centroid;
  const anchor = anchorPlace(clat, clon) || nearestPlace(clat, clon, 400);
  const all = [...inside, ...ahead];
  const byCountry = new Map();
  for (const p of all.length ? all : anchor ? [anchor] : []) {
    if (!byCountry.has(p.cc)) byCountry.set(p.cc, { cc: p.cc, country: p.country, continent: p.continent, admin1: new Set(), admin2: new Set() });
    const c = byCountry.get(p.cc);
    if (p.admin1) c.admin1.add(p.admin1);
    if (p.admin2) c.admin2.add(p.admin2);
  }
  const countries = [...byCountry.values()].map((c) => ({ ...c, admin1: [...c.admin1], admin2: [...c.admin2] }));
  const population = inside.reduce((s, p) => s + p.pop, 0);
  const populationAhead = ahead.reduce((s, p) => s + p.pop, 0);

  let anchorPhrase = null;
  if (!anchor) {
    // Open ocean, hundreds of km from any town: say where, in coordinates,
    // rather than inventing a nearby place.
    const ns = clat >= 0 ? 'N' : 'S'; const ew = clon >= 0 ? 'E' : 'W';
    anchorPhrase = `near ${Math.abs(clat).toFixed(1)}°${ns} ${Math.abs(clon).toFixed(1)}°${ew}`;
  } else {
    if (anchor.distanceKm < 10) anchorPhrase = `near ${anchor.name}`;
    else anchorPhrase = `about ${Math.round(anchor.distanceKm / 5) * 5} km ${compass8(bearingDeg(anchor.lat, anchor.lon, clat, clon))} of ${anchor.name}`;
  }
  return {
    places: inside.slice(0, 12).map(slim),
    placesAhead: ahead.slice(0, 12).map(slim),
    anchor: anchor ? slim(anchor) : null,
    anchorPhrase,
    countries,
    continents: [...new Set(countries.map((c) => c.continent))],
    population, populationAhead,
    overLand: inside.length > 0 || (anchor && anchor.distanceKm < 25),
  };
}

function slim(p) {
  return { name: p.name, cc: p.cc, country: p.country, continent: p.continent, admin1: p.admin1, admin2: p.admin2, pop: p.pop, lat: p.lat, lon: p.lon, tz: p.tz, ...(p.distanceKm != null ? { distanceKm: Math.round(p.distanceKm) } : {}) };
}

/** Facets for the Issued Warnings filters — built from the actual records. */
export function gazetteerSource() { return load().source; }
export function countryName(cc) { return load().countries[cc]?.name || cc; }
export function continentOf(cc) { return load().countries[cc]?.continent || 'Unknown'; }

/** Search places by name prefix, for the home-location and area filters. */
export function searchPlaces(q, limit = 10) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return [];
  return load().places
    .filter((p) => p.name.toLowerCase().startsWith(s))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, limit)
    .map(slim);
}
