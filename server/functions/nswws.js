/**
 * Met Office NSWWS — the official National Severe Weather Warning Service feed.
 *
 * This is the authoritative source for UK warnings, and replaces scraping the
 * public warnings page. Two steps, as the Met Office documents them:
 *
 *   1. GET /objects/feed              an Atom document whose `rel="related"`
 *                                     link points at the current snapshot
 *   2. GET that snapshot URL          a GeoJSON FeatureCollection holding the
 *                                     latest version of every issued warning
 *
 * The snapshot UUID changes whenever warnings change, which is why step 1
 * cannot be skipped and the URL must never be cached across refreshes. The
 * feed's own `<updated>` is the Met Office's issue time, so it is returned too
 * — that is a truer "last updated" than when we happened to poll.
 *
 * Auth is the `apikey` header. Note it is NOT `x-api-key` (that returns 401
 * with a misleading "use Bearer" message) and NOT `Authorization: Bearer`.
 *
 * Output is deliberately the same warning shape the page scraper produced —
 * { type, severity, regions[], description, validFrom, validTo, impacts } — so
 * nothing downstream had to change.
 */

const BASE = process.env.MET_OFFICE_NSWWS_BASE
  || 'https://data.hub.api.metoffice.gov.uk/nswws/v1.1';
const FEED_URL = `${BASE}/objects/feed`;
const UA = 'MyWeatherUK-selfhost/1.0';

export function hasNswwsKey() {
  return Boolean(process.env.MET_OFFICE_NSWWS_KEY);
}

async function get(url, accept) {
  const res = await fetch(url, {
    headers: {
      apikey: process.env.MET_OFFICE_NSWWS_KEY || '',
      accept,
      'user-agent': UA,
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const err = new Error(`NSWWS ${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

/** Title-case a SHOUTED enum: THUNDERSTORM -> Thunderstorm, EXTREME_HEAT -> Extreme Heat. */
function pretty(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/** Flatten affectedAreas into the flat region-name list the app renders. */
function regionsFrom(areas) {
  if (!Array.isArray(areas)) return [];
  const names = [];
  for (const area of areas) {
    if (area?.regionName) names.push(area.regionName);
    // Sub-regions are the useful detail for "which part of Scotland".
    for (const sub of area?.subRegions || []) {
      const name = typeof sub === 'string' ? sub : sub?.name || sub?.regionName;
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

/** One GeoJSON feature -> one warning in the app's shape. */
export function featureToWarning(feature) {
  const p = feature?.properties || {};
  const types = Array.isArray(p.weatherType) ? p.weatherType : [p.weatherType].filter(Boolean);

  const expect = Array.isArray(p.whatToExpect) ? p.whatToExpect.filter(Boolean) : [];
  const impacts = expect.length
    ? expect.join(' ')
    : String(p.warningFurtherDetails || '').trim();

  return {
    type: types.length ? types.map(pretty).join(' & ') : 'Weather',
    severity: pretty(p.warningLevel) || 'Yellow',
    regions: regionsFrom(p.affectedAreas),
    description: String(p.warningHeadline || '').trim(),
    validFrom: p.validFromDate || null,
    validTo: p.validToDate || null,
    impacts,
    // Extra detail the scraper could never provide. Ignored by anything that
    // does not know about it, so it costs nothing to carry.
    likelihood: p.warningLikelihood ?? null,
    impactLevel: p.warningImpact ?? null,
    warningId: p.warningId || null,
    warningVersion: p.warningVersion ?? null,
    issuedDate: p.issuedDate || null,
    geometry: feature?.geometry || null,
  };
}

/**
 * Fetch the current warnings. Returns { warnings, issuedAt, snapshotUrl }, or
 * throws — the caller decides whether to fall back to the page scraper.
 */
export default async function fetchNswwsWarnings() {
  if (!hasNswwsKey()) throw new Error('MET_OFFICE_NSWWS_KEY is not set');

  const feed = await get(FEED_URL, 'application/atom+xml');

  // The snapshot link is the one marked rel="related"; the rel="self" link is
  // the feed itself, and picking that back would loop.
  const related = /<link\b[^>]*rel="related"[^>]*>/i.exec(feed);
  const snapshotUrl = related && /href="([^"]+)"/i.exec(related[0])?.[1];
  if (!snapshotUrl) {
    throw new Error('NSWWS feed carried no snapshot link');
  }

  // The Met Office's own issue time, not our poll time.
  const issuedAt = /<updated>([^<]+)<\/updated>/i.exec(feed)?.[1] || null;

  const body = await get(snapshotUrl, 'application/geo+json, application/json');
  let collection;
  try {
    collection = JSON.parse(body);
  } catch {
    throw new Error('NSWWS snapshot was not valid JSON');
  }

  const features = Array.isArray(collection?.features) ? collection.features : [];
  return {
    warnings: features.map(featureToWarning),
    issuedAt,
    snapshotUrl,
  };
}
