/* Place search for the Location page: type-ahead that finds a town from its first few letters.

   Three sources, asked together and merged:
     • a local list of 4,668 UK and Irish places (OpenStreetMap, with population; regions from
       postcodes.io, built by data/geo/build-places.mjs) — instant, and it knows which places
       are big, so "duns" offers Dunstable before Duns Tew
     • postcodes.io place search — every Ordnance Survey settlement in Great Britain, matched on
       the start of the name; and postcodes, whole ("LU6 1AA"), outward ("LU6") or partial
     • Open-Meteo's geocoder as a backstop, mostly for small Irish places
   Matching ignores case and accents, treats "St" and "Saint" alike, matches the start of the
   name or of any word in it ("keynes" finds Milton Keynes), and forgives a typo or two in
   longer words. Ranked by how well the name matches, then what kind of place it is, then its
   population. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UA = { 'user-agent': 'MyWeatherUK-selfhost/1.0', accept: 'application/json' };
const COVERED = new Set(['GB', 'IE', 'IM', 'JE', 'GG']);

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’'.,]/g, '').replace(/[-–/]/g, ' ').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();

const LOCAL = (() => {
  try {
    const { rows } = JSON.parse(fs.readFileSync(path.join(here, 'data', 'geo', 'places-uk-ie.json'), 'utf8'));
    return rows.map(([name, lat, lon, kind, pop, cc, region]) => ({ name, lat, lon, kind, pop, cc, region, n: norm(name) }));
  } catch { return []; }
})();

const KIND = { city: 30, town: 22, village: 12, suburb: 6, hamlet: 4, postcode: 40, other: 2 };

/* optimal string alignment distance (Damerau-Levenshtein without repeated edits) */
function osa(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
/* how well a name matches what was typed: 0 (not at all) to 100 (exactly) */
function matchScore(q, n) {
  if (n === q) return 90;                                                  // a big town that starts so can still outrank a hamlet
  if (n.startsWith(q)) return 82 - Math.min(8, (n.length - q.length) * 0.15);
  if (n.split(' ').some((w, i) => i > 0 && w.startsWith(q))) return 62;
  if (q.length >= 4) {                                                     // a typo: well below any true match
    const d = osa(q, n.slice(0, q.length));
    if (d <= (q.length >= 7 ? 2 : 1)) return 34 - d * 8;
  }
  return 0;
}
/* what people call places that no gazetteer spells that way */
const ALIAS = { brum: 'birmingham', bham: 'birmingham', mcr: 'manchester', 'mk': 'milton keynes', ldn: 'london', edi: 'edinburgh', 'the big smoke': 'london' };
const rank = (p, m) => m + (KIND[p.kind] ?? 2) + Math.log10((p.pop || 0) + 1) * 5;

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
const OS_KIND = { City: 'city', Town: 'town', Village: 'village', Hamlet: 'hamlet', 'Suburban Area': 'suburb', 'Other Settlement': 'hamlet' };
const osRegion = (r) => [r.county_unitary || r.district_borough, r.country].filter(Boolean).join(', ');

async function fromOS(q) {
  const j = await getJson(`https://api.postcodes.io/places?q=${encodeURIComponent(q)}&limit=60`);
  return (j.result || []).filter((r) => OS_KIND[r.local_type]).map((r) => ({
    name: r.name_1, lat: r.latitude, lon: r.longitude, kind: OS_KIND[r.local_type], pop: 0, cc: 'GB', region: osRegion(r),
  }));
}
async function fromOpenMeteo(q) {
  const name = q.replace(/\b\w/g, (c) => c.toUpperCase());                // its index is case-sensitive in practice
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=20&language=en&format=json`);
  return (j.results || []).filter((r) => COVERED.has(r.country_code)).map((r) => ({
    name: r.name, lat: r.latitude, lon: r.longitude, pop: r.population || 0, cc: r.country_code,
    kind: r.feature_code === 'PPLC' || (r.population || 0) > 100000 ? 'city' : (r.population || 0) > 5000 ? 'town' : 'village',
    region: [r.admin2 && r.admin2 !== r.name ? r.admin2 : null, r.admin1 || r.country].filter(Boolean).join(', '),
  }));
}

/* postcodes: whole, outward code only, or partly typed */
const PC_FULL = /^([a-z]{1,2}\d[a-z\d]?)\s*(\d[a-z]{2})$/i;
const PC_OUT = /^[a-z]{1,2}\d[a-z\d]?$/i;
const PC_PART = /^[a-z]{1,2}\d[a-z\d]?\s+\d[a-z]?$/i;
async function postcodes(raw) {
  const q = raw.trim().toUpperCase();
  const first = (v) => (Array.isArray(v) ? v[0] : v);                     // a postcode has one district, an outcode a list
  const one = (r, label) => ({ name: label, lat: r.latitude, lon: r.longitude, kind: 'postcode', pop: 0, cc: 'GB',
    region: [first(r.admin_district), first(r.country)].filter(Boolean).join(', '), score: 140 });
  const full = PC_FULL.exec(q);
  if (full) {
    const j = await getJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(`${full[1]} ${full[2]}`)}`).catch(() => null);
    return j?.result ? [one(j.result, j.result.postcode)] : [];
  }
  if (PC_OUT.test(q)) {
    const j = await getJson(`https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`).catch(() => null);
    return j?.result ? [{ ...one(j.result, j.result.outcode), region: (j.result.admin_district || []).slice(0, 2).join(', ') }] : [];
  }
  if (PC_PART.test(q)) {
    const a = await getJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete?limit=8`).catch(() => null);
    if (!a?.result?.length) return [];
    const b = await getJson('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postcodes: a.result }) }).catch(() => null);
    return (b?.result || []).filter((x) => x.result).map((x, i) => ({ ...one(x.result, x.result.postcode), score: 140 - i }));
  }
  return [];
}

const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));
const cache = new Map();

/** Suggestions for what has been typed: [{ name, region, kind, cc, lat, lon }], best first. */
export async function searchPlaces(raw, limit = 8) {
  const typed = norm(raw);
  const q = ALIAS[typed] || typed;
  if (q.length < 2) return [];
  const key = `${q}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.list;

  const local = [];
  for (const p of LOCAL) {
    const m = matchScore(q, p.n);
    if (m) local.push({ ...p, score: rank(p, m) + 3 });                     // the local list knows sizes: it wins ties
  }
  const remote = await Promise.allSettled([
    q.length >= 3 ? fromOS(q) : Promise.resolve([]),
    q.length >= 3 ? fromOpenMeteo(q) : Promise.resolve([]),
    /\d/.test(q) ? postcodes(raw) : Promise.resolve([]),
  ]);
  const [os, om, pc] = remote.map((r) => (r.status === 'fulfilled' ? r.value : []));
  const scored = [...os, ...om].map((p) => ({ ...p, score: rank(p, matchScore(q, norm(p.name))) })).filter((p) => p.score > (KIND[p.kind] ?? 2) + 1);

  /* one entry per place: the same name within 5 km is the same place (keep the richer one) */
  const out = [];
  for (const p of [...pc, ...local, ...scored].sort((a, b) => b.score - a.score)) {
    const twin = out.find((o) => o.kind !== 'postcode' && p.kind !== 'postcode' && norm(o.name) === norm(p.name) && km(o, p) < 5);
    if (twin) { if (!twin.region && p.region) twin.region = p.region; continue; }
    out.push({ name: p.name, region: p.region || '', kind: p.kind, cc: p.cc, lat: +(+p.lat).toFixed(4), lon: +(+p.lon).toFixed(4), score: p.score });
    if (out.length >= limit) break;
  }
  const list = out.map(({ score, ...p }) => p);
  cache.set(key, { at: Date.now(), list });
  if (cache.size > 600) cache.delete(cache.keys().next().value);
  return list;
}
