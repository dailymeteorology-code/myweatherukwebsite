// Met Office Atmospheric Models API — health/status probe.
//
// The Atmospheric Models API serves GRIB2 binary model files (UKV, MOGREPS-UK,
// Global 10km, etc.) which are too large + binary to use directly in a web app.
// This function provides a lightweight wrapper that lists the latest available
// model runs, which:
//   1) Validates the API key works
//   2) Lets the frontend status bar show which models have fresh runs
//
// Used by the data-provider status bar on the TCM pages.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BASE = 'https://data.hub.api.metoffice.gov.uk/atmospheric-models/1.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Public read — no auth required, but tolerate it for app-user calls
    await base44.auth.me().catch(() => null);

    const apiKey = Deno.env.get('MET_OFFICE_ATMOSPHERIC_KEY');
    if (!apiKey) {
      return Response.json({ ok: false, error: 'MET_OFFICE_ATMOSPHERIC_KEY not set' }, { status: 500 });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'runs';

    if (action === 'runs') {
      const res = await fetch(`${BASE}/runs`, {
        headers: { 'accept': 'application/json', 'apikey': apiKey },
        signal: AbortSignal.timeout(12000),
      });
      const text = await res.text();
      if (!res.ok) {
        console.warn(`[metoffice-atmos] HTTP ${res.status}: ${text.slice(0, 200)}`);
        return Response.json({ ok: false, status: res.status, error: text.slice(0, 200) }, { status: 200 });
      }
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
      return Response.json({ ok: true, status: res.status, data });
    }

    if (action === 'orders') {
      const res = await fetch(`${BASE}/orders`, {
        headers: { 'accept': 'application/json', 'apikey': apiKey },
        signal: AbortSignal.timeout(12000),
      });
      const text = await res.text();
      if (!res.ok) {
        return Response.json({ ok: false, status: res.status, error: text.slice(0, 200) }, { status: 200 });
      }
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
      return Response.json({ ok: true, status: res.status, data });
    }

    return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[metoffice-atmos] error', e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});