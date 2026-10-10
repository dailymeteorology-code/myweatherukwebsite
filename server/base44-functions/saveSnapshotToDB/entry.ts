import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * saveSnapshotToDB
 * Save a forced admin snapshot (or whole-day snapshot) to the LightningArchive
 * entity so it's visible to ALL users via the Historical Lightning panel.
 *
 * Body params:
 *   snapshotAt  — epoch ms of the snapshot time (default: now)
 *   isWholeDay  — if true, fetches ALL of today's DB strikes (ignores local strikes)
 *   region      — 'uk' | 'europe' | 'global' (default: 'global')
 *   strikes     — optional array of {lat,lon,time,amp} from client (used when isWholeDay=false)
 */

const UK_BBOX = { latMin: 49.5, latMax: 61.0, lonMin: -10.8, lonMax: 2.5 };
const EU_BBOX = { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 };
const inBBox = (lat, lon, b) =>
  lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;

const PAGE_SIZE = 5000;
const MAX_PAGES = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Admin only
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const snapshotAt  = Number(body.snapshotAt) || Date.now();
    const isWholeDay  = !!body.isWholeDay;
    const region      = body.region || 'global';
    const clientStrikes = Array.isArray(body.strikes) ? body.strikes : [];

    const snapDate = new Date(snapshotAt);
    const dateStr  = snapDate.toISOString().slice(0, 10);

    let strikes = [];

    if (isWholeDay) {
      // Fetch every strike from DB for today
      const dayStart = new Date(dateStr + 'T00:00:00Z').getTime();
      const dayEnd   = dayStart + 24 * 3600_000;

      const collected = [];
      for (let p = 0; p < MAX_PAGES; p++) {
        const page = await base44.asServiceRole.entities.LightningStrike.filter(
          { time: { $gte: dayStart, $lt: dayEnd } },
          '-time',
          PAGE_SIZE,
          p * PAGE_SIZE
        ).catch(() => []);

        if (!page || !page.length) break;
        for (const s of page) {
          if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
          collected.push({ lat: s.lat, lon: s.lon, time: Number(s.time), amp: s.amp || 0 });
        }
        if (page.length < PAGE_SIZE) break;
      }

      // Dedup
      const seen = new Set();
      for (const s of collected) {
        const k = `${s.time}_${s.lat.toFixed(4)}_${s.lon.toFixed(4)}`;
        if (!seen.has(k)) { seen.add(k); strikes.push(s); }
      }

      console.log(`[saveSnapshotToDB] whole-day fetch: ${strikes.length} strikes for ${dateStr}`);
    } else {
      // Use client-provided strikes, dedup
      const seen = new Set();
      for (const s of clientStrikes) {
        if (typeof s.lat !== 'number' || typeof s.lon !== 'number' || !s.time) continue;
        const k = `${s.time}_${(s.lat).toFixed(4)}_${(s.lon).toFixed(4)}`;
        if (!seen.has(k)) { seen.add(k); strikes.push({ lat: s.lat, lon: s.lon, time: Number(s.time), amp: s.amp || 0 }); }
      }
      console.log(`[saveSnapshotToDB] client-provided: ${strikes.length} strikes for ${dateStr}`);
    }

    // Compute stats
    const ukCount  = strikes.filter(s => inBBox(s.lat, s.lon, UK_BBOX)).length;
    const euCount  = strikes.filter(s => inBBox(s.lat, s.lon, EU_BBOX)).length;
    const hourBuckets = {};
    for (const s of strikes) {
      const h = new Date(s.time).getUTCHours();
      hourBuckets[h] = (hourBuckets[h] || 0) + 1;
    }
    const peakEntry = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
    const peakHour  = peakEntry ? `${String(peakEntry[0]).padStart(2, '0')}:00` : '—';

    // Build a unique archive_key: date + FORCED + HH:MM
    const timeLabel = snapDate.toISOString().slice(11, 16);
    const archiveKey = isWholeDay
      ? `${dateStr}_WHOLEDAY`
      : `${dateStr}_FORCED_${timeLabel.replace(':', '')}`;

    // Check if this key already exists
    const existing = await base44.asServiceRole.entities.LightningArchive.filter(
      { date: archiveKey },
      '-created_date',
      1
    ).catch(() => []);

    const payload = {
      date: archiveKey,
      region: region,
      captured_at: snapshotAt,
      strike_count: strikes.length,
      uk_count: ukCount,
      eu_count: euCount,
      peak_hour: peakHour,
      strikes: strikes,
    };

    let savedId;
    if (existing.length) {
      await base44.asServiceRole.entities.LightningArchive.update(existing[0].id, payload);
      savedId = existing[0].id;
      console.log(`[saveSnapshotToDB] updated ${archiveKey} (${strikes.length} strikes)`);
    } else {
      const created = await base44.asServiceRole.entities.LightningArchive.create(payload);
      savedId = created?.id;
      console.log(`[saveSnapshotToDB] created ${archiveKey} (${strikes.length} strikes)`);
    }

    return Response.json({
      ok: true,
      archiveKey,
      strikeCount: strikes.length,
      ukCount,
      euCount,
      peakHour,
      id: savedId,
    });
  } catch (error) {
    console.error('[saveSnapshotToDB]', error?.message, error?.stack);
    return Response.json(
      { ok: false, error: error?.message || 'Failed to save snapshot' },
      { status: 500 }
    );
  }
});