/**
 * Builds server/data/scenarios/regions.geo.json — the 15 forecasting regions
 * used by the Weather Scenarios page, made from real boundaries.
 *
 *   node server/scenarios/build/build-regions.mjs
 *
 * Source: ONS Open Geography Portal — Local Authority Districts (December
 * 2024) Boundaries UK BUC, and the LAD→Region (England) lookup, December
 * 2024. Contains OS data © Crown copyright and database right 2024; Open
 * Government Licence v3.0.
 *
 * England's nine statistical regions are used as published (London
 * separately). Wales and Northern Ireland are whole nations. Scotland has no
 * official four-way split, so its 32 council areas are grouped below into
 * Southern, Central (incl. Tayside and Fife), Northern/Highlands and the
 * Islands; the grouping is ours and is labelled as such on the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../data/scenarios/regions.geo.json');
const ARC = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services';
const LAD = `${ARC}/Local_Authority_Districts_December_2024_Boundaries_UK_BUC/FeatureServer/0/query`;
const LU = `${ARC}/LAD24_RGN24_EN_LU/FeatureServer/0/query`;

const ENGLAND = {
  E12000001: 'north-east-england', E12000002: 'north-west-england', E12000003: 'yorkshire-humber',
  E12000004: 'east-midlands', E12000005: 'west-midlands', E12000006: 'east-of-england',
  E12000007: 'london', E12000008: 'south-east-england', E12000009: 'south-west-england',
};
const SCOTLAND = {
  'scottish-islands': ['Na h-Eileanan Siar', 'Orkney Islands', 'Shetland Islands'],
  'northern-scotland': ['Highland', 'Moray', 'Aberdeenshire', 'Aberdeen City', 'Argyll and Bute'],
  'southern-scotland': ['Dumfries and Galloway', 'Scottish Borders', 'South Ayrshire', 'East Ayrshire', 'North Ayrshire', 'South Lanarkshire'],
  // everything else in Scotland → central-scotland
};

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function all(base, params) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', f: params.f, resultOffset: offset, resultRecordCount: 1000, ...params });
    const j = await getJson(`${base}?${q}`);
    out.push(...j.features);
    if (!(j.exceededTransferLimit || j.properties?.exceededTransferLimit)) break;
  }
  return out;
}

// Douglas–Peucker on a ring (degrees), keeping closure.
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = 0;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = ring[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0 && bd > tol * tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : null;
}
const r3 = (v) => Math.round(v * 1000) / 1000;

const lookup = new Map((await all(LU, { f: 'json', returnGeometry: false })).map((f) => [f.attributes.LAD24CD, f.attributes.RGN24CD]));
const lads = await all(LAD, { f: 'geojson', outSR: 4326, geometryPrecision: 4 });

const features = [];
for (const f of lads) {
  const code = f.properties.LAD24CD, name = f.properties.LAD24NM;
  let region;
  if (code.startsWith('E')) region = ENGLAND[lookup.get(code)];
  else if (code.startsWith('W')) region = 'wales';
  else if (code.startsWith('N')) region = 'northern-ireland';
  else if (code.startsWith('S')) region = Object.keys(SCOTLAND).find((k) => SCOTLAND[k].includes(name)) || 'central-scotland';
  if (!region) throw new Error(`no region for ${code} ${name}`);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const coords = [];
  for (const poly of polys) {
    const rings = poly.map((ring) => simplify(ring, 0.01)).filter(Boolean).map((ring) => ring.map(([x, y]) => [r3(x), r3(y)]));
    if (rings.length) coords.push(rings);
  }
  if (!coords.length) continue;
  features.push({ type: 'Feature', properties: { region, lad: code, name }, geometry: { type: 'MultiPolygon', coordinates: coords } });
}
const geo = {
  type: 'FeatureCollection',
  attribution: 'Source: Office for National Statistics licensed under the Open Government Licence v.3.0. Contains OS data © Crown copyright and database right 2024.',
  note: 'Local authority districts (Dec 2024, ultra-generalised), coloured by forecasting region. Scottish grouping is MyWeatherUK\'s own.',
  features,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(geo));
const counts = {}; for (const f of features) counts[f.properties.region] = (counts[f.properties.region] || 0) + 1;
console.log(features.length, 'districts', (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB', counts);
