/**
 * Met Office DataHub — grid forecast proxy for TCM engine.
 * Accepts POST body: { points: [{lat, lon}, ...] }
 * Returns hourly arrays per point, shaped for featuresFromHourly().
 *
 * Uses MET_OFFICE_DATAHUB_API_KEY secret.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DATAHUB_BASE = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly';
const CONCURRENCY = 8;

async function fetchPoint(lat, lon, apiKey) {
  const url = `${DATAHUB_BASE}?datasource=BD1&latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&excludeParameterMetadata=true`;
  try {
    const res = await fetch(url, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn(`[metoffice-grid] ${lat.toFixed(2)},${lon.toFixed(2)} HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[metoffice-grid] ${lat.toFixed(2)},${lon.toFixed(2)} error: ${e?.message}`);
    return null;
  }
}

function parsePoint(json) {
  if (!json) return null;
  const ts = json?.features?.[0]?.properties?.timeSeries;
  if (!Array.isArray(ts) || !ts.length) return null;

  const out = {
    times:          [],
    temperature_2m: [],
    dewpoint_2m:    [],
    wind_speed_10m: [],
    wind_gusts_10m: [],
    precipitation:  [],
    humidity:       [],
  };

  for (const step of ts) {
    out.times.push(step.time ?? null);
    out.temperature_2m.push(step.screenTemperature ?? null);
    out.dewpoint_2m.push(step.screenDewPointTemperature ?? null);
    out.wind_speed_10m.push(step.windSpeed10m ?? null);
    out.wind_gusts_10m.push(step.windGustSpeed10m ?? null);
    out.precipitation.push(step.precipitationRate ?? step.totalPrecipAmount ?? null);
    out.humidity.push(step.screenRelativeHumidity ?? null);
  }

  return out;
}

async function pMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

Deno.serve(async (req) => {
  try {
    const apiKey = Deno.env.get('MET_OFFICE_DATAHUB_API_KEY');
    if (!apiKey) {
      console.error('[metoffice-grid] MET_OFFICE_DATAHUB_API_KEY not set');
      return Response.json({ ok: false, error: 'API key not configured' }, { status: 500 });
    }

    const body = await req.json().catch(() => null);
    if (!body?.points?.length) {
      return Response.json({ ok: false, error: 'body.points array required' }, { status: 400 });
    }

    const points = body.points.slice(0, 300);
    console.log(`[metoffice-grid] fetching ${points.length} points`);

    const rawResults = await pMap(points, async ({ lat, lon }) => {
      const raw = await fetchPoint(lat, lon, apiKey);
      const hourly = parsePoint(raw);
      if (!hourly) return null;
      return { lat, lon, hourly };
    }, CONCURRENCY);

    const results = rawResults.filter(Boolean);
    console.log(`[metoffice-grid] got ${results.length}/${points.length} valid`);

    return Response.json({ ok: true, results });
  } catch (e) {
    console.error('[metoffice-grid] error:', e?.message || e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});