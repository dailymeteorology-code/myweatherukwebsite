/**
 * Build data/geo/places-uk-ie.json: the UK and Ireland places the Location search ranks locally.
 *
 * Source: the motion graphics' OpenStreetMap places (cities, towns, villages, hamlets, suburbs,
 * with population where OSM has it; © OpenStreetMap contributors, ODbL), each given its council
 * area and country once, here, by postcodes.io's bulk reverse lookup (Ordnance Survey and ONS
 * data, OGL), so the search never has to look a region up while someone types.
 *
 *   node server/data/geo/build-places.mjs [path/to/places.json]
 *
 * Rows: [name, lat, lon, kind, population, country code, region]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || path.resolve(here, '..', '..', '..', '..', 'mwuk-graphics', 'assets', 'basemap', 'places.json');
const places = JSON.parse(fs.readFileSync(src, 'utf8'))
  .filter((p) => ['GB', 'IE', 'IM', 'JE', 'GG'].includes(p.cc) && ['city', 'town', 'village', 'hamlet', 'suburb'].includes(p.kind));

const region = new Map();
const gb = places.filter((p) => p.cc === 'GB');
for (let i = 0; i < gb.length; i += 100) {
  const batch = gb.slice(i, i + 100);
  const res = await fetch('https://api.postcodes.io/postcodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'MyWeatherUK-selfhost/1.0' },
    body: JSON.stringify({ geolocations: batch.map((p) => ({ longitude: p.lon, latitude: p.lat, radius: 2000, limit: 1 })) }),
  }).then((r) => r.json());
  res.result.forEach((r, k) => {
    const hit = r.result?.[0];
    if (hit) region.set(batch[k], [hit.admin_district || hit.admin_county, hit.country].filter(Boolean).join(', '));
  });
  process.stdout.write(`\r${Math.min(i + 100, gb.length)} / ${gb.length}`);
}
const CC = { IE: 'Ireland', IM: 'Isle of Man', JE: 'Jersey', GG: 'Guernsey' };
const rows = places.map((p) => [p.name, +p.lat.toFixed(4), +p.lon.toFixed(4), p.kind, p.pop || 0, p.cc, region.get(p) || CC[p.cc] || '']);
fs.writeFileSync(path.join(here, 'places-uk-ie.json'), JSON.stringify({
  source: 'OpenStreetMap places (© OpenStreetMap contributors, ODbL); regions from postcodes.io (OS/ONS, OGL)',
  builtAt: new Date().toISOString(),
  rows,
}));
console.log(`\n${rows.length} places, ${region.size} with a region`);
