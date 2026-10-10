// ─────────────────────────────────────────────────────────────────────────────
// TCM FORECAST CACHE — persistence for model runs and admin-drawn outlooks.
//
// Two layers, each with a clear job:
//   • localStorage — per-browser instant read cache (auto-prunes after 7 days).
//   • RiskGridCache entity — the shared, permanent source of truth across all
//     devices. Model runs and admin-drawn outlooks live here under distinct key
//     prefixes; both are public-read / admin-write via RLS and never expire
//     (expiresAt is set ~100 years ahead).
//
// This rewrite removes the duplication that had crept in: the "look up by
// cache_key → update or create → (optionally) verify it landed" dance was
// hand-inlined in FOUR places (the three run keys, and each drawn-outlook
// sentinel). It now lives once in upsertCacheKey(). The persisted grid shape and
// every localStorage / DB key format are UNCHANGED, so the archive, the
// verification backend, and cross-device loads all keep working exactly as
// before. bbox is now also persisted, so a cross-device "Continue" can re-fetch
// the extended day range instead of falling back to a full re-run.
// ─────────────────────────────────────────────────────────────────────────────

import { base44 } from '@/api/base44Client';

const CACHE_PREFIX  = 'tcm_forecast_v4';
const LATEST_PREFIX = 'tcm_forecast_v4_latest';
const DAILY_PREFIX  = 'tcm_daily_v4';                 // keyed by "YYYY-MM-DD_<region>"
const DRAWN_LS_KEY  = (region) => `tcm_drawn_outlooks_${region}`;
const MAX_AGE_MS    = 7 * 86400_000;

// The four scheduled UTC run hours (mirrors tcmFetchPolicy.js).
export const DAILY_RUN_HOURS = [0, 6, 12, 18];

const keyFor    = (region, runISO) => `${CACHE_PREFIX}_${region}_${runISO}`;
const latestKey = (region) => `${LATEST_PREFIX}_${region}`;
const dailyKey  = (region, isoDate) => `${DAILY_PREFIX}_${isoDate}_${region}`;

// ─────────────────────────────────────────────────────────────────────────────
// localStorage run cache
// ─────────────────────────────────────────────────────────────────────────────
function readFresh(rawKey) {
  try {
    const raw = localStorage.getItem(rawKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.builtAt || Date.now() - parsed.builtAt > MAX_AGE_MS) {
      localStorage.removeItem(rawKey);
      return null;
    }
    return parsed;
  } catch { return null; }
}

export function loadRunFromCache(region, run) {
  return readFresh(keyFor(region, run.toISOString()));
}
export function loadLatestRunFromCache(region) {
  return readFresh(latestKey(region));
}

export function loadDailyRunsFromCache(region, isoDate) {
  try {
    const k = dailyKey(region, isoDate);
    const raw = localStorage.getItem(k);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const cutoff = Date.now() - MAX_AGE_MS;
    let changed = false;
    for (const h of DAILY_RUN_HOURS) {
      if (parsed[h] && parsed[h].builtAt < cutoff) { delete parsed[h]; changed = true; }
    }
    if (changed) {
      if (Object.keys(parsed).length === 0) { localStorage.removeItem(k); return {}; }
      localStorage.setItem(k, JSON.stringify(parsed));
    }
    return parsed;
  } catch { return {}; }
}

export function saveRunToCache(region, run, payload) {
  // Strip the in-memory-only fields before persisting: _rawById (the "continue
  // available" marker) and _realGrid (legacy) must never hit the LS quota.
  const { _rawById, _realGrid, ...slim } = payload || {};
  const stamped = { ...slim, builtAt: payload?.builtAt || Date.now(), run: run.toISOString() };
  const write = () => {
    localStorage.setItem(keyFor(region, run.toISOString()), JSON.stringify(stamped));
    localStorage.setItem(latestKey(region), JSON.stringify(stamped));
    _saveToDailyArchive(region, run, stamped);
  };
  try { write(); }
  catch { pruneOldForecastRuns(); try { write(); } catch {} }
}

function _saveToDailyArchive(region, run, stamped) {
  try {
    const runHour = run.getUTCHours();
    if (!DAILY_RUN_HOURS.includes(runHour)) return;
    const k = dailyKey(region, run.toISOString().slice(0, 10));
    let existing = {};
    try { const raw = localStorage.getItem(k); if (raw) existing = JSON.parse(raw); } catch {}
    existing[runHour] = stamped;
    localStorage.setItem(k, JSON.stringify(existing));
  } catch {}
}

export function pruneOldForecastRuns() {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      const isForecast = k.startsWith(`${CACHE_PREFIX}_`) || k.startsWith(`${LATEST_PREFIX}_`);
      const isDaily = k.startsWith(`${DAILY_PREFIX}_`);
      if (!isForecast && !isDaily) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || '{}');
        if (isDaily) {
          const oldest = Math.min(...Object.values(parsed).map(e => e?.builtAt || Infinity));
          if (oldest < cutoff) localStorage.removeItem(k);
        } else if (!parsed?.builtAt || parsed.builtAt < cutoff) {
          localStorage.removeItem(k);
        }
      } catch { localStorage.removeItem(k); }
    }
  } catch {}
}

export function listSavedRuns(region) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${CACHE_PREFIX}_${region}_`) || k.includes('_latest')) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || '{}');
        if (!parsed?.builtAt || !parsed?.grid?.length) continue;
        out.push({ key: k, runISO: parsed.run || null, builtAt: parsed.builtAt, region, gridPoints: parsed.grid.length });
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.builtAt - a.builtAt);
}

export function deleteRunFromCache(cacheKey) {
  try { localStorage.removeItem(cacheKey); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// RiskGridCache (DB) — shared, permanent store.
//   Model runs:     tcm_<region>_<YYYY-MM-DDTHH>Z  (+ _latest pointer + archive)
//   Admin outlooks: tcm_drawn_<region>_<isoDate>_<ts>  (+ _latest pointer)
// ─────────────────────────────────────────────────────────────────────────────
// In-memory "latest run" cache. localStorage is BLOCKED inside the Base44
// sandboxed iframe, so the LS fast-paths below silently miss and EVERY region /
// run switch pays a full DB round-trip (a big grid_data row). This module-level
// Map survives the iframe, so re-loading a region — e.g. flipping UK⇄France and
// back, or a prefetched region — is instant instead of a fresh network fetch.
const _latestMem = new Map();          // region -> { payload, at }
const MEM_TTL_MS = 6 * 60_000;         // re-check the DB for a newer run after 6 min
export function getLatestFromMem(region) {
  const e = _latestMem.get(region);
  return (e && Date.now() - e.at < MEM_TTL_MS && e.payload?.grid?.length) ? e.payload : null;
}
export function setLatestInMem(region, payload) {
  if (payload?.grid?.length) _latestMem.set(region, { payload, at: Date.now() });
}

const dbCacheKey  = (region, run) => `tcm_${region}_${run.toISOString().slice(0, 13)}Z`;
const dbLatestKey = (region) => `tcm_${region}_latest`;
const dbDrawnKey  = (region, isoDate, ts) => `tcm_drawn_${region}_${isoDate}_${ts}`;
const NEVER = () => new Date(Date.now() + 100 * 365 * 86400_000).toISOString();

// The ONE upsert primitive. Looks up the row by cache_key, updates it if present
// else creates it, and retries an update if a concurrent create lost a race.
// With verify:true it re-reads and THROWS if nothing persisted — turning the
// silent no-ops (duplicate key, RLS denial, transient backend error) that used
// to report false success into real, surfaced failures.
async function upsertCacheKey(cacheKey, record, { verify = false } = {}) {
  const row = { ...record, cache_key: cacheKey };
  let writeErr = null;
  let existingId = null;
  try {
    const existing = await base44.entities.RiskGridCache.filter({ cache_key: cacheKey }, '-generated_at', 1);
    existingId = existing?.[0]?.id ?? null;
  } catch (e) { /* lookup failure isn't fatal; the write below is authoritative */ }

  if (existingId) {
    try { await base44.entities.RiskGridCache.update(existingId, row); } catch (e) { writeErr = e; }
  } else {
    try {
      await base44.entities.RiskGridCache.create(row);
    } catch (e) {
      const again = await base44.entities.RiskGridCache.filter({ cache_key: cacheKey }, '-generated_at', 1).catch(() => []);
      if (again?.[0]?.id) { try { await base44.entities.RiskGridCache.update(again[0].id, row); } catch (e2) { writeErr = e2; } }
      else writeErr = e;
    }
  }

  if (verify) {
    let confirmed = false;
    try {
      const after = await base44.entities.RiskGridCache.filter({ cache_key: cacheKey }, '-generated_at', 1);
      confirmed = !!after?.[0]?.id;
    } catch (e) { if (!writeErr) writeErr = e; }
    if (!confirmed) throw new Error(`DB write for "${cacheKey}" did not persist (${writeErr?.message || 'no row after write'})`);
  } else if (writeErr) {
    console.warn(`[tcmForecastCache] upsert ${cacheKey} failed:`, writeErr?.message);
  }
}

// ── Grid slimming for cross-device publishing ────────────────────────────────
// The in-memory grid carries perStep (~32 deep score objects) AND perDay per
// point — a UK run serialises to tens of MB, which silently overflowed the row
// limit and was the whole reason runs "didn't save". We persist only the exact
// day-level fields the published outlook renderer reads, as integers, then guard
// the size (drop coordinate precision, then thin) so the write reliably lands.
const ri = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 0);
function slimDayScores(s) {
  if (!s || typeof s !== 'object') return { thunderstorm: 0, hail: 0, tornado: 0, lightning: 0 };
  const sub = s.sub || {};
  const out = {
    thunderstorm: ri(s.thunderstorm), hail: ri(s.hail), tornado: ri(s.tornado), lightning: ri(s.lightning),
    sub: { hail: ri(sub.hail), tornado: ri(sub.tornado), supercell: ri(sub.supercell), strongWinds: ri(sub.strongWinds), flashFlood: ri(sub.flashFlood) },
  };
  const gust = s.metrics?.gust;
  if (typeof gust === 'number' && isFinite(gust)) out.metrics = { gust: ri(gust) };
  return out;
}
const rt1 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);
function slimDayTemp(t) {
  if (!t || typeof t !== 'object') return undefined;
  const max = rt1(t.max), min = rt1(t.min);
  return (max == null && min == null) ? undefined : { max, min };
}
function slimGridForDB(grid, daysToKeep, coordDp = 3) {
  const m = coordDp === 3 ? 1000 : 100;
  return grid.map(p => ({
    lat: Math.round(p.lat * m) / m,
    lon: Math.round(p.lon * m) / m,
    perDay: (Array.isArray(p.perDay) ? p.perDay.slice(0, daysToKeep) : []).map(d => {
      const out = { scores: slimDayScores(d?.scores) };
      const temp = slimDayTemp(d?.temp);
      if (temp) out.temp = temp;   // keep the daily max/min temperature for the temperature maps
      return out;
    }),
  }));
}
const bytesOf = (g) => { try { return JSON.stringify({ grid: g }).length; } catch { return Infinity; } };

/**
 * Persist a TCM run payload to RiskGridCache under three keys (per-hour pointer,
 * _latest pointer, and an immutable archive snapshot). Throws if any key fails.
 */
export async function saveTCMRunToDB(region, run, payload) {
  if (!payload?.grid?.length) throw new Error('Refusing to save empty payload to DB');

  const builtAt = payload.builtAt || Date.now();
  const generatedAt = new Date(builtAt).toISOString();
  const sourceLabel = payload.source || 'open-meteo';
  const modelRun = `${run.toISOString().slice(0, 13)}Z (${sourceLabel})`;

  // Publish the real (un-densified) nodes at their real step so the renderer
  // interpolates at the right scale. (_realGrid is legacy; the current pipeline's
  // `grid` already IS the compact real-node grid.)
  const sourceGrid = (Array.isArray(payload._realGrid) && payload._realGrid.length) ? payload._realGrid : payload.grid;
  const publishStep = (Array.isArray(payload._realGrid) && payload._realGrid.length)
    ? (payload.gridStep ?? null)
    : (payload.fineGridStep ?? payload.gridStep ?? null);
  const daysToKeep = Math.max(1, Math.min(4,
    typeof payload.daysAvailable === 'number' ? payload.daysAvailable
      : typeof payload.maxDay === 'number' ? payload.maxDay + 1 : 4));

  // Adaptive size guard: full precision → 2 dp coords → thin by stride.
  const SIZE_TARGET = 900 * 1024;
  let grid = slimGridForDB(sourceGrid, daysToKeep, 3);
  if (bytesOf(grid) > SIZE_TARGET) grid = slimGridForDB(sourceGrid, daysToKeep, 2);
  if (bytesOf(grid) > SIZE_TARGET) {
    const base = slimGridForDB(sourceGrid, daysToKeep, 2);
    for (let stride = 2; stride <= 4 && bytesOf(grid) > SIZE_TARGET; stride++) {
      grid = base.filter((_, i) => i % stride === 0);
    }
    console.warn(`[saveTCMRunToDB] thinned to ${grid.length} pts to fit DB row limit`);
  }

  const persistedPayload = {
    grid,
    summary: payload.summary,
    source: sourceLabel,
    builtAt,
    cellCount: grid.length,
    models: payload.models ?? null,
    run: run.toISOString(),
    region,
    gridStep: publishStep,
    fineGridStep: payload.fineGridStep ?? null,
    realNodes: !(Array.isArray(payload._realGrid) && payload._realGrid.length) ? true : true,
    perStepStripped: true,
    maxDay: typeof payload.maxDay === 'number' ? payload.maxDay : 3,
    daysAvailable: payload.daysAvailable ?? 4,
    runStartMs: payload.runStartMs ?? null,
    bbox: payload.bbox ?? null,   // lets a cross-device Continue re-fetch
  };
  try {
    console.info(`[saveTCMRunToDB] slimmed payload ≈ ${(JSON.stringify(persistedPayload).length / 1024).toFixed(0)} KB (${grid.length} pts)`);
  } catch {}

  const record = {
    generated_at: generatedAt,
    expires_at: NEVER(),
    model_run: modelRun,
    grid_data: persistedPayload,
    diagnostics: { points: payload.grid.length, region, run: run.toISOString(), source: sourceLabel },
  };

  const keys = [dbCacheKey(region, run), dbLatestKey(region), `tcm_${region}_archive_${builtAt}`];
  const results = await Promise.allSettled(keys.map(k => upsertCacheKey(k, record, { verify: true })));
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length) {
    throw new Error(`saveTCMRunToDB: ${failures.length}/${keys.length} keys failed — ${failures.map(f => f.reason?.message || String(f.reason)).join('; ')}`);
  }
  setLatestInMem(region, persistedPayload);   // warm the in-memory cache so a switch-away-and-back is instant
  return { ok: true, keys, points: payload.grid.length };
}

/** List all admin-saved model runs for a region, newest first. */
export async function listRunsFromDB(region) {
  try {
    const rows = await base44.entities.RiskGridCache.list('-generated_at', 200);
    if (!Array.isArray(rows)) return [];
    const all = rows.filter(r =>
      r.cache_key?.startsWith(`tcm_${region}_`) &&
      !r.cache_key.endsWith('_latest') &&
      !r.cache_key.startsWith('tcm_drawn_'));
    // Prefer the immutable archive snapshots (each run once, incl. overridden).
    const archived = all.filter(r => r.cache_key.startsWith(`tcm_${region}_archive_`));
    const source = archived.length ? archived : all.filter(r => !r.cache_key.startsWith(`tcm_${region}_archive_`));
    return source.map(r => ({
      id: r.id,
      cacheKey: r.cache_key,
      runISO: r.grid_data?.run || null,
      generatedAt: r.generated_at,
      points: r.diagnostics?.points || r.grid_data?.grid?.length || 0,
      source: r.grid_data?.source || 'open-meteo',
      modelRun: r.model_run || r.cache_key,
    }));
  } catch { return []; }
}

export async function loadRunByKeyFromDB(cacheKey) {
  try {
    const rows = await base44.entities.RiskGridCache.filter({ cache_key: cacheKey }, '-generated_at', 1);
    return rows?.[0]?.grid_data?.grid?.length ? rows[0].grid_data : null;
  } catch { return null; }
}

export async function loadLatestTCMFromDB(region) {
  // Fast path 1: in-memory cache (works even where localStorage is blocked).
  const mem = getLatestFromMem(region);
  if (mem) return mem;
  // Fast path 2: LS cache (avoids a DB round-trip for returning users).
  try {
    const raw = localStorage.getItem(latestKey(region));
    if (raw) { const p = JSON.parse(raw); if (p?.grid?.length) { setLatestInMem(region, p); return p; } }
  } catch {}
  try {
    const rows = await Promise.race([
      base44.entities.RiskGridCache.filter({ cache_key: dbLatestKey(region) }, '-generated_at', 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 7000)),
    ]);
    const payload = rows?.[0]?.grid_data;
    if (!payload?.grid?.length) return null;
    setLatestInMem(region, payload);
    try { localStorage.setItem(latestKey(region), JSON.stringify({ ...payload, builtAt: payload.builtAt || Date.now() })); } catch {}
    return payload;
  } catch { return null; }
}

// Direct DB read of the region's latest published run — NO localStorage fast
// path. Used for a background freshness check so a returning user who already
// has an older run cached still picks up a newer admin-published run.
export async function loadLatestTCMFromDBFresh(region) {
  try {
    const rows = await Promise.race([
      base44.entities.RiskGridCache.filter({ cache_key: dbLatestKey(region) }, '-generated_at', 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 7000)),
    ]);
    const payload = rows?.[0]?.grid_data;
    if (payload?.grid?.length) { setLatestInMem(region, payload); return payload; }
    return null;
  } catch { return null; }
}

export async function loadTCMRunFromDB(region, run) {
  try {
    const rows = await base44.entities.RiskGridCache.filter({ cache_key: dbCacheKey(region, run) }, '-generated_at', 1);
    return rows?.[0]?.grid_data?.grid?.length ? rows[0].grid_data : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-drawn outlooks — localStorage fast-cache + RiskGridCache source of truth.
// ─────────────────────────────────────────────────────────────────────────────
function _loadDrawnFromLS(region) {
  try { const raw = localStorage.getItem(DRAWN_LS_KEY(region)); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function _saveDrawnToLS(region, records) {
  try { localStorage.setItem(DRAWN_LS_KEY(region), JSON.stringify(records)); } catch {}
}
function _drawnEntry(cacheKey, isoDate, drawnData, generatedAt, id = null) {
  return {
    id, cacheKey, isoDate, generatedAt,
    shapes: drawnData.shapes || [], label: drawnData.label || '',
    createdAt: drawnData.createdAt || Date.now(),
    forecastType: drawnData.forecastType || 'initial',
    data: { ...drawnData, type: 'admin_drawn_outlook', region: drawnData.region, isoDate },
  };
}

export async function saveAdminDrawnOutlook(region, isoDate, drawnData) {
  const ts = drawnData.createdAt || Date.now();
  const key = dbDrawnKey(region, isoDate, ts);
  const generatedAt = new Date().toISOString();
  const gridData = { ...drawnData, type: 'admin_drawn_outlook', region, isoDate, createdAt: ts };
  const record = {
    generated_at: generatedAt, expires_at: NEVER(),
    model_run: `Admin drawn outlook — ${isoDate} (${region})`,
    grid_data: gridData,
    diagnostics: { type: 'drawn_outlook', region, isoDate, shapes: drawnData.shapes?.length || 0 },
  };

  let dbId = null;
  try {
    const created = await base44.entities.RiskGridCache.create({ ...record, cache_key: key });
    dbId = created?.id ?? null;
  } catch (e) { console.warn('[saveAdminDrawnOutlook] DB save failed:', e?.message); }
  // Latest sentinel so first-time visitors (empty LS) can still load it.
  await upsertCacheKey(`tcm_drawn_${region}_latest`, { ...record, model_run: `Admin drawn outlook — latest (${region})` });

  const entry = { ..._drawnEntry(key, isoDate, drawnData, generatedAt, dbId), createdAt: ts, data: gridData };
  _saveDrawnToLS(region, [entry, ...(_loadDrawnFromLS(region) || [])]);
  return entry;
}

export async function listAdminDrawnOutlooks(region) {
  const lsCached = _loadDrawnFromLS(region);
  try {
    const rows = await base44.entities.RiskGridCache.list('-generated_at', 200);
    if (Array.isArray(rows)) {
      const dbRows = rows
        .filter(r => r.cache_key?.startsWith(`tcm_drawn_${region}_`) && !r.cache_key.endsWith('_latest'))
        .map(r => ({
          id: r.id, cacheKey: r.cache_key,
          isoDate: r.grid_data?.isoDate || r.cache_key.split('_')[3],
          generatedAt: r.generated_at,
          shapes: r.grid_data?.shapes || [], label: r.grid_data?.label || '',
          createdAt: r.grid_data?.createdAt || 0,
          forecastType: r.grid_data?.forecastType || 'initial',
          data: r.grid_data,
        }));
      _saveDrawnToLS(region, dbRows);
      return dbRows;
    }
  } catch { /* DB unavailable — fall back to LS */ }
  return lsCached ?? [];
}

export async function loadAdminDrawnOutlooksForDate(region, isoDate) {
  try {
    const rows = await base44.entities.RiskGridCache.list('-generated_at', 200);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(r => r.cache_key?.startsWith(`tcm_drawn_${region}_${isoDate}`))
      .map(r => r.grid_data)
      .filter(Boolean);
  } catch { return []; }
}

export async function deleteAdminDrawnOutlook(id, cacheKey, region) {
  if (region) {
    const existing = _loadDrawnFromLS(region) || [];
    _saveDrawnToLS(region, existing.filter(r => r.id !== id && r.cacheKey !== cacheKey));
  }
  try { if (id) await base44.entities.RiskGridCache.delete(id); } catch {}
}

export async function updateAdminDrawnOutlook(id, region, isoDate, drawnData) {
  const generatedAt = new Date().toISOString();
  const gridData = { ...drawnData, type: 'admin_drawn_outlook', region, isoDate, updatedAt: generatedAt };
  const record = {
    generated_at: generatedAt, expires_at: NEVER(),
    model_run: `Admin drawn outlook — ${isoDate} (${region}) [updated]`,
    grid_data: gridData,
    diagnostics: { type: 'drawn_outlook', region, isoDate, shapes: drawnData.shapes?.length || 0 },
  };

  const cacheKey = id ? undefined : dbDrawnKey(region, isoDate, drawnData.createdAt || Date.now());
  let updatedId = id;
  try {
    if (id) await base44.entities.RiskGridCache.update(id, record);
    else { const created = await base44.entities.RiskGridCache.create({ ...record, cache_key: cacheKey }); updatedId = created?.id ?? null; }
  } catch (e) { console.warn('[updateAdminDrawnOutlook] DB update failed:', e?.message); }
  await upsertCacheKey(`tcm_drawn_${region}_latest`, { ...record, model_run: `Admin drawn outlook — latest (${region})` });

  const entry = { ..._drawnEntry(cacheKey, isoDate, drawnData, generatedAt, updatedId), data: gridData };
  const lsAll = _loadDrawnFromLS(region) || [];
  _saveDrawnToLS(region, lsAll.map(r =>
    (r.id === id || (cacheKey && r.cacheKey === cacheKey)) ? { ...r, ...entry } : r));
  return entry;
}

export async function loadLatestAdminOutlookFromDB(region) {
  try {
    const latestK = `tcm_drawn_${region}_latest`;
    const rows = await Promise.race([
      base44.entities.RiskGridCache.filter({ cache_key: latestK }, '-generated_at', 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 7000)),
    ]);
    const gd = rows?.[0]?.grid_data;
    if (!gd?.shapes?.length) return null;
    const entry = { ..._drawnEntry(latestK, gd.isoDate || '', gd, rows[0].generated_at, rows[0].id), createdAt: gd.createdAt || 0, data: gd };
    try {
      const existing = JSON.parse(localStorage.getItem(DRAWN_LS_KEY(region)) || '[]');
      if (!Array.isArray(existing) || !existing.some(e => e.cacheKey === latestK)) {
        localStorage.setItem(DRAWN_LS_KEY(region), JSON.stringify([entry, ...existing]));
      }
    } catch {}
    return entry;
  } catch { return null; }
}
