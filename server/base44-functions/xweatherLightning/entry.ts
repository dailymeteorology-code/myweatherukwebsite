import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CLIENT_ID     = Deno.env.get('XWEATHER_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('XWEATHER_CLIENT_SECRET');

const RELAY_SECRET = Deno.env.get('LIGHTNING_RELAY_SECRET');

Deno.serve(async (req) => {
  try {
    // Require relay secret to prevent unauthenticated quota consumption
    if (RELAY_SECRET && req.headers.get('x-relay-secret') !== RELAY_SECRET) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { action = 'search', params = {} } = await req.json().catch(() => ({}));

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return Response.json({ success: false, error: 'XWeather credentials not configured' }, { status: 500 });
    }

    // XWeather Lightning API: https://data.api.xweather.com/lightning/{action}
    // Supported actions: search, closest, within, route, affects
    const ALLOWED_ACTIONS = new Set(['search', 'closest', 'within', 'route', 'affects']);
    if (!ALLOWED_ACTIONS.has(action)) {
      return Response.json({ success: false, error: 'invalid action' }, { status: 400 });
    }

    const qs = new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    // Merge all params into query string (p, radius, from, to, limit, fields, etc.)
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    });

    const url = `https://data.api.xweather.com/lightning/${action}?${qs}`;
    console.log('XWeather request:', action, 'params:', JSON.stringify(params));

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('XWeather API error:', res.status, JSON.stringify(data));
      return Response.json({ success: false, error: data?.error?.description || `HTTP ${res.status}`, raw: data }, { status: res.status });
    }

    console.log('XWeather response success:', data?.success, 'count:', Array.isArray(data?.response) ? data.response.length : 'n/a');
    return Response.json(data);

  } catch (error) {
    console.error('XWeather lightning error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});