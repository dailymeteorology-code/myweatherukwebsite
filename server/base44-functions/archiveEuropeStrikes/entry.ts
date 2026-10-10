import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { strikes, capturedAt } = body;

    if (!Array.isArray(strikes) || !strikes.length) {
      return Response.json({ error: 'No strikes provided' }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const archiveRecord = {
      date: today,
      region: 'europe',
      captured_at: capturedAt || Date.now(),
      strike_count: strikes.length,
      eu_count: strikes.length,
      uk_count: 0,
      peak_hour: new Date(capturedAt || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      strikes: strikes.map(s => ({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp })),
    };

    // Save to LightningArchive so all users load it
    await base44.asServiceRole.entities.LightningArchive.create(archiveRecord);

    return Response.json({
      success: true,
      message: `Archived ${strikes.length} Europe lightning strikes`,
      record_id: archiveRecord.date,
    });
  } catch (error) {
    console.error('[archiveEuropeStrikes]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});