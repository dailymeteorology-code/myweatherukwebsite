import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Save batch of lightning strikes to DB (server-side dedup)
// Only trusted relay callers (x-relay-secret header) may write.
Deno.serve(async (req) => {
  try {
    const secret = req.headers.get('x-relay-secret');
    if (!secret || secret !== Deno.env.get('LIGHTNING_RELAY_SECRET')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const strikes = Array.isArray(body?.strikes) ? body.strikes : [];

    if (!strikes.length) {
      return Response.json({ ok: true, saved: 0, skipped: 0 });
    }

    // Build dedup keys & filter invalid records
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const valid = strikes
      .filter(s =>
        typeof s.lat === 'number' && typeof s.lon === 'number' &&
        typeof s.time === 'number' && s.time >= todayStartMs
      )
      .map(s => ({
        lat: Math.round(s.lat * 10000) / 10000,
        lon: Math.round(s.lon * 10000) / 10000,
        time: Math.floor(s.time),
        amp: s.amp || 0,
        dedup_key: `${Math.floor(s.time)}_${(Math.round(s.lat * 10000) / 10000).toFixed(4)}_${(Math.round(s.lon * 10000) / 10000).toFixed(4)}`
      }));

    if (!valid.length) {
      return Response.json({ ok: true, saved: 0, skipped: strikes.length });
    }

    // De-dupe against existing records in DB. CHUNK the $in lookup: a single
    // $in with hundreds/thousands of keys can be rejected or silently truncated
    // by the query engine — if it throws, the whole request fails and NOTHING is
    // saved (strikes silently lost). Chunks of 200, run in parallel, are safe.
    const keys = valid.map(v => v.dedup_key);
    const keyChunks = [];
    for (let i = 0; i < keys.length; i += 200) keyChunks.push(keys.slice(i, i + 200));
    const existingKeys = new Set();
    const existingResults = await Promise.all(keyChunks.map(chunk =>
      base44.asServiceRole.entities.LightningStrike.filter(
        { dedup_key: { $in: chunk } },
        '-time',
        chunk.length
      ).catch((e) => { console.error('[saveLightningStrikes] dedup chunk failed:', e?.message); return []; })
    ));
    for (const res of existingResults) for (const e of res) existingKeys.add(e.dedup_key);
    const toInsert = valid.filter(v => !existingKeys.has(v.dedup_key));

    if (!toInsert.length) {
      return Response.json({ ok: true, saved: 0, skipped: valid.length, alreadyExisted: existingKeys.size });
    }

    // Insert in batches of 500, in parallel, each guarded so one failed batch
    // doesn't abort the rest.
    const insertBatches = [];
    for (let i = 0; i < toInsert.length; i += 500) insertBatches.push(toInsert.slice(i, i + 500));
    let savedCount = 0;
    await Promise.all(insertBatches.map(b =>
      base44.asServiceRole.entities.LightningStrike.bulkCreate(b)
        .then(() => { savedCount += b.length; })
        .catch((e) => { console.error('[saveLightningStrikes] bulkCreate batch failed:', e?.message); })
    ));

    console.log(`[saveLightningStrikes] saved ${savedCount} new strikes (${existingKeys.size} already existed)`);

    return Response.json({
      ok: true,
      saved: savedCount,
      skipped: valid.length - savedCount,
      total: valid.length
    });
  } catch (error) {
    console.error('[saveLightningStrikes]', error?.message, error?.stack);
    return Response.json(
      { ok: false, error: error?.message || 'Failed to save strikes' },
      { status: 500 }
    );
  }
});