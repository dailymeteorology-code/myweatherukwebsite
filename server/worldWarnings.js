/**
 * Worldwide severe-weather warnings.
 *
 * WHERE THE DATA COMES FROM
 *
 * The index is the WMO's Severe Weather Information Centre, which aggregates
 * the CAP alerts published by national meteorological services worldwide —
 * roughly 1,300 live at any moment across ~40 issuing authorities. That is the
 * only free, official, genuinely global list there is; there is no single API
 * that returns every country's warnings with geometry.
 *
 *     https://severeweather.wmo.int/json/wmo_all.json
 *
 * The index gives event, headline, area description, severity and the valid
 * period, but NOT the warning's shape or its full description. Those live in
 * the individual CAP XML document each row points at.
 *
 * WHY THERE IS A SECOND SOURCE. About 45% of the world's live warnings at any
 * moment are issued by the US National Weather Service, and the NWS publishes
 * all of its active alerts as one GeoJSON document, with geometry and the full
 * description already in it, free and keyless:
 *
 *     https://api.weather.gov/alerts/active
 *
 * Both feeds identify an alert by the same CAP `urn:oid:` identifier, so the
 * NWS document can be folded straight onto the WMO index — 572 of 591 US rows
 * matched on a live sample. One extra request turns nearly half the world's
 * warnings from a line of text into a drawable, readable warning.
 *
 * WHAT THIS CANNOT DO, AND WHY. For the rest of the world the shape has to
 * come from the per-alert CAP, and most of those carry no coordinates at all:
 * on a live sample of 60, seven had a <polygon> and twenty-nine identified
 * their area only by national geocode (US SAME codes, county identifiers and
 * so on) which cannot be turned into a shape without that country's own
 * boundary file. A further 24 of 60 CAP documents 404 — the index outlives the
 * files it points at. So: every warning is LISTED, and a warning is DRAWN when
 * its source gives us something to draw. The UI says which it is rather than
 * quietly showing a partial map.
 *
 * CAP documents are fetched one at a time, on demand, when a warning is opened
 * — not 1,300 up front. Their URLs contain a content hash, so a CAP never
 * changes once published and is cached for the life of the process.
 */

const WMO_INDEX = 'https://severeweather.wmo.int/json/wmo_all.json';
const WMO_CAP_BASE = 'https://severeweather.wmo.int/v2/cap-alerts/';
const NWS_ACTIVE = 'https://api.weather.gov/alerts/active';

/* The NWS asks for a contact address in the User-Agent and throttles requests
   that do not carry one. It is the site's own published address, not a user's. */
const NWS_UA = 'MyWeatherUK/1.0 (https://myweatheruk.com; dailymeteorology@gmail.com)';
const UA = 'MyWeatherUK-selfhost/1.0';

/* The WMO index updates every few minutes; ten matches the refresh cadence the
   rest of the site uses for warnings and keeps us a polite caller. */
const LIST_TTL_MS = 10 * 60 * 1000;
const CAP_MAX = 400;

let listCache = null;      // { at, payload }
/* Full text for the alerts the NWS already gave us, held back out of the list
   response. Shipping 1,100 warning descriptions to the browser was 2 MB on a
   page that shows one description at a time; the detail route serves them from
   here without a second upstream call. */
let detailCache = new Map(); // capURL -> { description, instruction }
let listInflight = null;   // single-flight: a burst of readers makes one call
const capCache = new Map(); // relative capURL -> parsed detail

/* ── CAP severity ─────────────────────────────────────────────────────────
   CAP's own five-level scale. The numbers let the client sort and colour
   without re-deriving an order from strings. */
const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

/** The WMO index encodes severity as `s` on CAP's 1–4 scale. */
function severityFromIndex(item) {
  switch (Number(item?.s)) {
    case 4: return 'Extreme';
    case 3: return 'Severe';
    case 2: return 'Moderate';
    case 1: return 'Minor';
    default: return 'Unknown';
  }
}

/** `us-noaa-nws-en-marine/2026/...` -> `us-noaa-nws-en-marine`. */
function sourceOf(capURL) {
  return String(capURL || '').split('/')[0] || 'unknown';
}

/** The ISO-3166 alpha-2 the WMO uses as the first segment of a source id. */
function countryOf(capURL) {
  const s = sourceOf(capURL);
  const cc = s.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/* The index's timestamps are "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker,
   which `new Date()` reads as LOCAL time — an hour out in British summer, and
   much further out elsewhere. Spell the zone out. */
function isoFromIndex(s) {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s));
  return m ? `${m[1]}T${m[2]}Z` : null;
}

/* ── tiny XML helpers ─────────────────────────────────────────────────────
   A CAP alert is a shallow, well-known document. A regex reader is the right
   size of tool for it and avoids adding an XML parser to the server. */
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => XML_ENTITIES[name.toLowerCase()] ?? m);
}
function tag(xml, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml);
  return m ? decode(m[1]).trim() : null;
}
function tagAll(xml, name) {
  const out = [];
  const re = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(decode(m[1]).trim());
  return out;
}

/**
 * CAP writes a polygon as "lat,lon lat,lon …" — latitude first, and GeoJSON
 * wants longitude first. Getting this backwards puts a Florida tornado in
 * Somalia, so it is worth being explicit about.
 */
function capPolygonToGeoJson(polygons) {
  const rings = [];
  for (const raw of polygons) {
    const ring = raw
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [lat, lon] = pair.split(',').map(Number);
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
      })
      .filter(Boolean);
    if (ring.length >= 4) rings.push([ring]);
  }
  if (!rings.length) return null;
  return rings.length === 1
    ? { type: 'Polygon', coordinates: rings[0] }
    : { type: 'MultiPolygon', coordinates: rings };
}

/** Parse one CAP document into the shape the client renders. */
export function parseCap(xml) {
  // An alert may carry several <info> blocks, one per language. The English
  // one is the one we can show; otherwise take the first.
  const infos = xml.split(/<(?:\w+:)?info>/i).slice(1);
  const pick =
    infos.find((b) => /<(?:\w+:)?language>\s*en/i.test(b)) || infos[0] || xml;

  const polys = tagAll(pick, 'polygon');
  return {
    event: tag(pick, 'event'),
    headline: tag(pick, 'headline'),
    description: tag(pick, 'description'),
    instruction: tag(pick, 'instruction'),
    senderName: tag(pick, 'senderName'),
    severity: tag(pick, 'severity') || 'Unknown',
    urgency: tag(pick, 'urgency'),
    certainty: tag(pick, 'certainty'),
    effective: tag(pick, 'effective'),
    onset: tag(pick, 'onset'),
    expires: tag(pick, 'expires'),
    areaDesc: tagAll(pick, 'areaDesc').join('; ') || null,
    web: tag(pick, 'web'),
    geometry: capPolygonToGeoJson(polys),
  };
}

async function getText(url, headers) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

/** Fold the NWS GeoJSON onto the WMO index, keyed by CAP identifier. */
async function nwsById() {
  const map = new Map();
  try {
    const body = await getText(NWS_ACTIVE, {
      'user-agent': NWS_UA,
      accept: 'application/geo+json',
    });
    const collection = JSON.parse(body);
    for (const f of collection?.features || []) {
      const p = f?.properties;
      if (!p?.id) continue;
      map.set(p.id, {
        description: p.description || null,
        instruction: p.instruction || null,
        senderName: p.senderName || null,
        severity: p.severity || null,
        urgency: p.urgency || null,
        certainty: p.certainty || null,
        effective: p.effective || null,
        onset: p.onset || null,
        expires: p.ends || p.expires || null,
        areaDesc: p.areaDesc || null,
        geometry: f.geometry || null,
      });
    }
  } catch (err) {
    // The list is still worth serving without the US detail folded in.
    console.warn('[world-warnings] NWS active alerts unavailable:', err.message);
  }
  return map;
}

async function buildList() {
  const [indexBody, nws] = await Promise.all([
    getText(WMO_INDEX, { accept: 'application/json' }),
    nwsById(),
  ]);

  const index = JSON.parse(indexBody);
  const items = Array.isArray(index?.items) ? index.items : [];

  const warnings = [];
  const nextDetails = new Map();
  for (const it of items) {
    // A row with no CAP reference cannot be opened or drawn, so it is noise.
    if (!it?.capURL) continue;
    const detail = nws.get(it.id) || null;

    warnings.push({
      id: it.id,
      event: it.event || detail?.event || 'Weather warning',
      headline: it.headline || null,
      areaDesc: detail?.areaDesc || it.areaDesc || null,
      severity: detail?.severity || severityFromIndex(it),
      urgency: detail?.urgency || null,
      certainty: detail?.certainty || null,
      effective: detail?.effective || isoFromIndex(it.effective || it.sent),
      expires: detail?.expires || isoFromIndex(it.expires),
      sender: detail?.senderName || null,
      source: sourceOf(it.capURL),
      country: countryOf(it.capURL),
      capUrl: it.capURL,
      geometry: detail?.geometry || null,
      // True when everything needed to show the warning in full is already
      // here; false means the client must ask for the CAP when it is opened.
      detailed: Boolean(detail?.description),
    });

    if (detail?.description) {
      nextDetails.set(it.capURL, {
        description: detail.description,
        instruction: detail.instruction || null,
      });
    }
  }
  detailCache = nextDetails;

  warnings.sort((a, b) => {
    const s = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (s) return s;
    return String(b.effective || '').localeCompare(String(a.effective || ''));
  });

  const bySeverity = {};
  const byCountry = {};
  for (const w of warnings) {
    bySeverity[w.severity] = (bySeverity[w.severity] || 0) + 1;
    if (w.country) byCountry[w.country] = (byCountry[w.country] || 0) + 1;
  }

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: index?.lastUpdated || null,
    counts: {
      total: warnings.length,
      drawn: warnings.filter((w) => w.geometry).length,
      bySeverity,
      byCountry,
    },
    warnings,
  };
}

/** The whole live list, cached and single-flighted. */
export async function worldWarnings() {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.payload;
  if (listInflight) return listInflight;

  listInflight = (async () => {
    try {
      const payload = await buildList();
      listCache = { at: Date.now(), payload };
      return payload;
    } catch (err) {
      console.warn('[world-warnings] list failed:', err.message);
      // A stale list beats an empty page.
      if (listCache) return { ...listCache.payload, stale: true };
      return { ok: false, error: 'unavailable', warnings: [], counts: { total: 0, drawn: 0 } };
    } finally {
      listInflight = null;
    }
  })();
  return listInflight;
}

/**
 * One alert's full CAP. `capUrl` is the relative path the list carries; it is
 * resolved against the WMO host here so the client can never aim this at an
 * arbitrary URL.
 */
export async function worldWarningDetail(capUrl) {
  const rel = String(capUrl || '').replace(/^\/+/, '');
  // Path traversal and absolute URLs both have to be refused: this value comes
  // from the browser, and the only safe shape is a plain relative CAP path.
  if (!rel || rel.includes('..') || /^[a-z]+:/i.test(rel) || !/^[\w./-]+\.xml$/i.test(rel)) {
    const err = new Error('bad cap path');
    err.status = 400;
    throw err;
  }
  /* Served straight from the list build for anything the NWS already
     described — no second request, and it works even when the WMO's copy of
     the CAP has already been pruned. */
  const known = detailCache.get(rel);
  if (known) {
    const row = listCache?.payload?.warnings?.find((w) => w.capUrl === rel);
    return {
      ok: true,
      capUrl: rel,
      event: row?.event || null,
      headline: row?.headline || null,
      senderName: row?.sender || null,
      severity: row?.severity || 'Unknown',
      urgency: row?.urgency || null,
      certainty: row?.certainty || null,
      effective: row?.effective || null,
      onset: null,
      expires: row?.expires || null,
      areaDesc: row?.areaDesc || null,
      web: null,
      geometry: row?.geometry || null,
      ...known,
    };
  }

  if (capCache.has(rel)) return capCache.get(rel);

  let parsed;
  try {
    parsed = parseCap(await getText(WMO_CAP_BASE + rel, { accept: 'application/xml' }));
  } catch (err) {
    // The WMO index routinely outlives the CAP files it points at, so a 404
    // here is an ordinary outcome, not a fault worth retrying.
    parsed = { ok: false, missing: err.status === 404, error: err.message };
  }
  const payload = { ok: parsed.ok !== false, capUrl: rel, ...parsed };

  if (capCache.size >= CAP_MAX) capCache.delete(capCache.keys().next().value);
  capCache.set(rel, payload);
  return payload;
}

export default worldWarnings;
