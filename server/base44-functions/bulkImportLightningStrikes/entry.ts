import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { strikes, region = 'global' } = body;

    if (!Array.isArray(strikes) || !strikes.length) {
      return Response.json({ error: 'No strikes provided' }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    
    // Create LightningArchive record with all strikes for universal access
    const archiveRecord = {
      date: today,
      region: region,
      captured_at: Date.now(),
      strike_count: strikes.length,
      uk_count: strikes.filter(s => s.lat >= 49.5 && s.lat <= 61.0 && s.lon >= -10.8 && s.lon <= 2.5).length,
      eu_count: strikes.filter(s => s.lat >= 34.0 && s.lat <= 72.0 && s.lon >= -25.0 && s.lon <= 45.0).length,
      peak_hour: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      strikes: strikes.map(s => ({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp })).slice(0, 100000),
    };

    await base44.asServiceRole.entities.LightningArchive.create(archiveRecord);

    // Also save individual strikes to LightningStrike entity for analytics
    const strikeChunks = [];
    for (let i = 0; i < strikes.length; i += 1000) {
      strikeChunks.push(strikes.slice(i, i + 1000).map(s => ({
        lat: s.lat,
        lon: s.lon,
        time: s.time,
        amp: s.amp,
        dedup_key: `${s.time}_${s.lat}_${s.lon}`,
      })));
    }

    let imported = 0;
    for (const chunk of strikeChunks) {
      try {
        await base44.asServiceRole.entities.LightningStrike.bulkCreate(chunk);
        imported += chunk.length;
      } catch (e) {
        console.warn('[bulkImportLightningStrikes] chunk failed:', e?.message);
      }
    }

    return Response.json({
      success: true,
      archived: archiveRecord.strike_count,
      imported,
      message: `Imported ${imported}/${strikes.length} strikes`,
    });
  } catch (error) {
    console.error('[bulkImportLightningStrikes]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});