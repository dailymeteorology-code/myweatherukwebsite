import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * archiveLightningStrikes
 * ----------------------------------------------------------------------------
 * Runs daily at 23:59 UTC. Pages through ALL LightningStrike records for
 * today using filter() with a numeric offset, summarises them, and writes
 * a single LightningArchive record for the day.
 *
 * The previous implementation used list() with no offset, so it re-fetched
 * the same first 5,000 rows on every loop iteration, producing an infinite
 * loop. This version uses filter() with time bounds + a page offset that
 * advances correctly after each batch.
 *
 * Older LightningStrike records (>2 days old) are cleaned up after archiving.
 */

const UK_BBOX = { latMin: 49.5, latMax: 61.0, lonMin: -10.8, lonMax: 2.5 };
const EU_BBOX = { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 };

const inBBox = (lat, lon, b) =>
  lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const todayEndMs   = now.getTime();
    const todayDateStr = todayStart.toISOString().slice(0, 10);

    // Page through ALL of today's strikes using filter() + offset.
    // filter() is the correct call — list() has no offset parameter so the
    // old loop always read the same first page, looping forever.
    const PAGE_SIZE      = 5000;
    const MAX_PAGES      = 40;   // safety ceiling: 40 × 5k = 200k strikes max
    const collected = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await base44.asServiceRole.entities.LightningStrike.filter(
        { time: { $gte: todayStartMs, $lte: todayEndMs } },
        '-time',
        PAGE_SIZE,
        page * PAGE_SIZE          // ← offset that actually advances each iteration
      ).catch(() => []);

      if (!rows || rows.length === 0) break;

      for (const s of rows) {
        const t = Number(s.time);
        if (!Number.isFinite(t)) continue;
        if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
        if (!inBBox(s.lat, s.lon, EU_BBOX)) continue;
        collected.push({ lat: s.lat, lon: s.lon, time: t, amp: s.amp || 0 });
      }

      // Short page = end of data
      if (rows.length < PAGE_SIZE) break;

      // Brief pause between pages to avoid hammering the API
      await new Promise(r => setTimeout(r, 150));
    }

    // De-duplicate
    const seen = new Set();
    const unique = [];
    for (const s of collected) {
      const k = `${s.time}_${s.lat.toFixed(4)}_${s.lon.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(s);
    }

    const ukCount = unique.filter(s => inBBox(s.lat, s.lon, UK_BBOX)).length;
    const euCount = unique.length;

    // Peak hour
    const hourBuckets = {};
    for (const s of unique) {
      const h = new Date(s.time).getUTCHours();
      hourBuckets[h] = (hourBuckets[h] || 0) + 1;
    }
    const peakEntry = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
    const peakHour  = peakEntry ? `${String(peakEntry[0]).padStart(2, '0')}:00` : '—';

    // Upsert — update existing archive row for today if it already exists
    const existing = await base44.asServiceRole.entities.LightningArchive.filter(
      { date: todayDateStr, region: 'global' },
      '-created_date',
      1
    ).catch(() => []);

    const payload = {
      date:         todayDateStr,
      region:       'global',
      captured_at:  now.getTime(),
      strike_count: unique.length,
      uk_count:     ukCount,
      eu_count:     euCount,
      peak_hour:    peakHour,
      strikes:      unique,
    };

    if (existing.length) {
      await base44.asServiceRole.entities.LightningArchive.update(existing[0].id, payload);
      console.log(`[archiveLightning] updated ${todayDateStr} — ${unique.length} strikes`);
    } else {
      await base44.asServiceRole.entities.LightningArchive.create(payload);
      console.log(`[archiveLightning] created ${todayDateStr} — ${unique.length} strikes`);
    }

    // Clean up LightningStrike records older than 2 days (capped at 30 s budget)
    const cutoffMs       = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const CLEANUP_BUDGET = 30_000;
    const cleanupStart   = Date.now();
    let cleaned = 0;
    try {
      const old = await base44.asServiceRole.entities.LightningStrike.filter(
        { time: { $lt: cutoffMs } },
        '-created_date',
        500
      ).catch(() => []);

      const CONCURRENCY = 5;
      for (let i = 0; i < old.length; i += CONCURRENCY) {
        if (Date.now() - cleanupStart > CLEANUP_BUDGET) break;
        const batch   = old.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(s => base44.asServiceRole.entities.LightningStrike.delete(s.id))
        );
        cleaned += results.filter(r => r.status === 'fulfilled').length;
        await new Promise(r => setTimeout(r, 250));
      }
    } catch (e) {
      console.warn('[archiveLightning] cleanup error:', e?.message);
    }

    return Response.json({
      ok:                 true,
      date:               todayDateStr,
      archived:           unique.length,
      ukCount,
      euCount,
      peakHour,
      cleanedOldRecords:  cleaned,
    });

  } catch (error) {
    console.error('[archiveLightning] ERROR', error?.message, error?.stack);
    return Response.json(
      { ok: false, error: error?.message || 'archiveLightningStrikes failed' },
      { status: 500 }
    );
  }
});