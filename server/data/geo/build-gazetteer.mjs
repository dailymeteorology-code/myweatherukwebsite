/**
 * Build data/geo/gazetteer.json from the GeoNames dumps in ./raw.
 * Source: GeoNames (geonames.org), CC BY 4.0. Re-run after refreshing ./raw.
 *   node server/data/geo/build-gazetteer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const raw = (f) => fs.readFileSync(path.join(here, 'raw', f), 'utf8');

const CONTINENT = { AF: 'Africa', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America', AN: 'Antarctica' };
const countries = {};
for (const line of raw('countryInfo.txt').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const c = line.split('\t');
  countries[c[0]] = { name: c[4], continent: CONTINENT[c[8]] || c[8] };
}
const admin1 = {};
for (const line of raw('admin1CodesASCII.txt').split('\n')) {
  if (!line) continue;
  const c = line.split('\t');
  admin1[c[0]] = c[1];
}
const admin2 = {};
for (const line of raw('admin2Codes.txt').split('\n')) {
  if (!line) continue;
  const c = line.split('\t');
  admin2[c[0]] = c[1];
}
// cities: [name, lat, lon, cc, admin1Name, admin2Name, population, timezone]
const cities = [];
for (const line of raw('cities15000.txt').split('\n')) {
  if (!line) continue;
  const c = line.split('\t');
  const cc = c[8];
  const a1 = admin1[`${cc}.${c[10]}`] || '';
  const a2 = admin2[`${cc}.${c[10]}.${c[11]}`] || '';
  cities.push([c[1], +(+c[4]).toFixed(4), +(+c[5]).toFixed(4), cc, a1, a2, +c[14] || 0, c[17] || '']);
}
fs.writeFileSync(path.join(here, 'gazetteer.json'), JSON.stringify({
  source: 'GeoNames (geonames.org), CC BY 4.0 — cities with population > 15,000',
  builtAt: new Date().toISOString(),
  countries, cities,
}));
console.log('countries', Object.keys(countries).length, 'cities', cities.length);
