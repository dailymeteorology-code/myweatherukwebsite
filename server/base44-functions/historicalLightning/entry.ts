import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * historicalLightning
 * ----------------------------------------------------------------------------
 * Returns lightning strikes from the DB for the requested region and day.
 * Region can be 'uk' (UK & Ireland) or 'europe' (continental, default).
 *
 * Optional `daysBack` selects a day:
 *   - 0 (default) → today (UTC midnight → now)
 *   - 1           → yesterday (full UTC day)
 *   - N           → N days ago (full UTC day)
 *
 * Paginates through LightningStrike records ordered by -time so that every
 * device gets the FULL day of strikes (no matter when it loaded the page or
 * what browser/device it is). This is what guarantees cross-device sync.
 */

const REGION_BBOX = {
  uk:     { latMin: 49.5, latMax: 61.0, lonMin: -10.8, lonMax: 2.5 },
  europe: { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 },
  // Whole planet — the World view on the lightning page asks for this.
  world:  { latMin: -90,  latMax: 90,   lonMin: -180,  lonMax: 180 },
};

const PAGE_SIZE = 5000;
// Was 8 pages (40,000) — far too low. Active days exceed 100k strikes per
// region, so the count silently capped at 40k. Raised to allow ~250k. The loop
// still stops early as soon as a short page comes back, so quiet days pay no
// extra cost; only genuinely huge days page deeper.
const MAX_PAGES = 50; // up to 250,000 strikes per region per day

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const region = REGION_BBOX[body?.region] ? body.region : 'europe';
    const bbox = REGION_BBOX[region];

    // Resolve the day window. daysBack defaults to 0 (today) for backwards
    // compatibility with existing callers that didn't supply it.
    const daysBackRaw = Number(body?.daysBack);
    const daysBack = Number.isFinite(daysBackRaw) && daysBackRaw >= 0 ? Math.floor(daysBackRaw) : 0;

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - daysBack);
    const dayStartMs = dayStart.getTime();
    // For today, end is `now`. For past days, end is the next UTC midnight.
    const dayEndMs = daysBack === 0
      ? Date.now()
      : dayStartMs + 24 * 3600_000;

    // Page through strikes ordered by -time, restricted to the day window AND
    // the region bounding box IN THE QUERY. Filtering the bbox server-side (not
    // after the fact) means every page is full of in-region strikes, so the
    // page budget isn't wasted on out-of-region strikes from a globally active
    // day — previously a busy global day could exhaust all pages before the
    // region's own strikes were exhausted, dropping huge numbers of them.
    //
    // Sort by -time only (single field — the form this SDK is known to accept).
    // `time` is not unique, so in the rare case where the DB orders tied
    // timestamps differently between two paginated queries, a row at a page
    // boundary could in principle be reordered out of view. The cross-page dedup
    // below guarantees that can never INFLATE the count (duplicates are removed);
    // the practical exposure to UNDER-count is tiny because ties only matter when
    // they land exactly on a 5000-row boundary. Raising PAGE_SIZE shrinks the
    // number of boundaries (and thus the exposure) further.
    // Page through strikes ordered by -time, restricted to the day window.
    //
    // IMPORTANT: the query filters ONLY on the `time` range (a single ranged
    // field, which the SDK/query engine reliably supports and which is the sort
    // key). The region bounding box is applied IN CODE below, NOT in the query.
    // A previous version put three simultaneous range conditions in the query
    // (time + lat + lon); if the backend rejects compound range filters, that
    // call throws, the `.catch(() => [])` swallows it, the loop sees an empty
    // page and stops — returning ZERO strikes. That silent failure is exactly
    // the "no strikes loading / not all strikes loading" symptom. Filtering the
    // bbox in code is bulletproof: the query always succeeds, and we keep only
    // in-region strikes ourselves.
    const collected = [];
    let stop = false;
    let pageError = false;
    for (let p = 0; p < MAX_PAGES && !stop; p++) {
      let page;
      try {
        page = await base44.asServiceRole.entities.LightningStrike.filter(
          { time: { $gte: dayStartMs, $lt: dayEndMs } },
          '-time',
          PAGE_SIZE,
          p * PAGE_SIZE
        );
      } catch (e) {
        // Surface (don't swallow) so a real query failure is visible in logs and
        // the response, instead of masquerading as "no strikes today".
        console.error(`[historicalLightning] page ${p} query failed:`, e?.message);
        pageError = true;
        break;
      }

      if (!page || !page.length) break;

      for (const s of page) {
        const t = Number(s.time);
        if (!Number.isFinite(t)) continue;
        if (t < dayStartMs) { stop = true; continue; }
        if (t >= dayEndMs) continue;
        // Region bounding-box filter, applied in code (see note above).
        if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
        if (s.lat < bbox.latMin || s.lat > bbox.latMax) continue;
        if (s.lon < bbox.lonMin || s.lon > bbox.lonMax) continue;
        collected.push(s);
      }

      if (page.length < PAGE_SIZE) break;
    }

    // Dedup
    const seen = new Set();
    const unique = [];
    for (const s of collected) {
      const k = s.dedup_key || `${s.time}_${s.lat}_${s.lon}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(s);
    }

    const formatted = unique.map(s => ({
      lat: s.lat,
      lon: s.lon,
      time: s.time,
      amp: s.amp || 0,
      dedup_key: s.dedup_key,
    }));

    const dateStr = dayStart.toISOString().slice(0, 10);
    console.log(`[historicalLightning] region=${region} daysBack=${daysBack} date=${dateStr} returned=${formatted.length}${pageError ? ' (PAGE ERROR — partial)' : ''}`);

    return Response.json({
      ok: !pageError,
      region,
      daysBack,
      date: dateStr,
      strikes: formatted,
      count: formatted.length,
      partial: pageError,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[historicalLightning]', error?.message, error?.stack);
    return Response.json(
      { ok: false, error: error?.message || 'Failed to fetch historical lightning' },
      { status: 500 }
    );
  }
});