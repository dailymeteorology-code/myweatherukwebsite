// Admin-only — pings each data source and reports latency/status.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function ping(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
    return { name, ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, status: 0, ms: Date.now() - t0, error: String(e?.message || e) };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') return Response.json({ ok: false, error: 'admin only' }, { status: 403 });

    const moKey = Deno.env.get('MET_OFFICE_DATAHUB_API_KEY') || Deno.env.get('MET_OFFICE_ATMOSPHERIC_KEY') || '';

    const results = await Promise.all([
      ping('Open-Meteo Forecast', 'https://api.open-meteo.com/v1/forecast?latitude=52&longitude=0&hourly=cape&forecast_days=1'),
      ping('Open-Meteo Historical', 'https://archive-api.open-meteo.com/v1/archive?latitude=52&longitude=0&start_date=2024-01-01&end_date=2024-01-01&daily=temperature_2m_max'),
      ping('ECMWF Open Data', 'https://data.ecmwf.int/forecasts/'),
      ping('Met Office DataHub', 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly?latitude=52&longitude=0', {
        headers: moKey ? { 'apikey': moKey, accept: 'application/json' } : { accept: 'application/json' },
      }),
      ping('Country Outlines CDN', 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'),
    ]);

    return Response.json({ ok: true, checkedAt: new Date().toISOString(), results });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});