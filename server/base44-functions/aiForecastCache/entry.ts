// Shared server-side cache for the TCM AI fallback forecast.
// POST { action:'load', key }                  → { found, payload? }
// POST { action:'save', key, payload }         → { ok }
//
// Backed by the existing RiskGridCache entity (cache_key field acts as the
// unique key per (region, runISO) for ai-fallback). Anyone can read & write —
// the cache contains only generated forecast data, no sensitive info.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_AGE_MS = 12 * 3600_000; // AI forecasts expire after 12h

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (req.method !== 'POST') {
      return Response.json({ error: 'method not allowed' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, key, payload } = body || {};
    if (!key) return Response.json({ ok: false, error: 'missing key' }, { status: 400 });

    if (action === 'load') {
      const rows = await base44.asServiceRole.entities.RiskGridCache.filter({ cache_key: key }, '-created_date', 1);
      const row = rows?.[0];
      if (!row?.grid_data) return Response.json({ found: false });

      const builtAt = row.grid_data?.builtAt ?? new Date(row.generated_at).getTime();
      if (!builtAt || Date.now() - builtAt > MAX_AGE_MS) {
        return Response.json({ found: false, expired: true });
      }
      return Response.json({ found: true, payload: row.grid_data });
    }

    if (action === 'save') {
      // Only authenticated users may write to the shared cache.
      try {
        await base44.auth.me();
      } catch {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      if (!payload) return Response.json({ ok: false, error: 'missing payload' }, { status: 400 });
      const existing = await base44.asServiceRole.entities.RiskGridCache.filter({ cache_key: key }, '-created_date', 1);
      const record = {
        cache_key: key,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + MAX_AGE_MS).toISOString(),
        model_run: payload?.source || 'ai-fallback',
        grid_data: payload,
      };
      if (existing?.[0]?.id) {
        await base44.asServiceRole.entities.RiskGridCache.update(existing[0].id, record);
      } else {
        await base44.asServiceRole.entities.RiskGridCache.create(record);
      }
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[aiForecastCache]', e?.message);
    return Response.json({ error: e?.message }, { status: 500 });
  }
});