// ─────────────────────────────────────────────────────────────────────────────
// useTCMData — loads the outlook a user should see (admin-gated, DB-first).
//
// Load order for EVERY user (admin and regular):
//   1. exact-run localStorage cache   — instant, no network
//   2. latest-run localStorage cache  — instant, no network
//   3. RiskGridCache DB (admin's last saved run) — bounded by an 8 s timeout
//   4. "no data" until an admin runs the model
//
// Regular users never trigger a live Open-Meteo fetch; only the admin "Run Model"
// button does (via WeatherPatterns), so everyone sees the most recent admin-
// approved run. The state SETTERS are returned so that path can drive this hook's
// data/loading/progress directly while a manual run is in flight.
//
// Cancellation: each load captures a monotonically increasing token; a load whose
// token is no longer current (a quick region/run switch, or unmount happened
// mid-flight) drops its result instead of landing stale data over the newer one.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import { loadRunFromCache, loadLatestRunFromCache, loadLatestTCMFromDB, loadLatestTCMFromDBFresh, getLatestFromMem } from '@/lib/tcmForecastCache';
import { RUN_CACHE_VERSION } from '@/components/tcm/riskConfig';

const tcmRunCacheKey = (region, run) => `tcm_${RUN_CACHE_VERSION}_${region}_run_${run.toISOString().slice(0, 13)}`;
function loadCachedTCMForRun(region, run) {
  try { const c = localStorage.getItem(tcmRunCacheKey(region, run)); return c ? JSON.parse(c) : null; }
  catch { return null; }
}

export default function useTCMData({ region, run }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [progress, setProgress]   = useState(0);
  const [error, setError]         = useState(null);
  const [dataSource, setDataSource] = useState(null);   // 'cache' | 'db' | null

  const loadToken = useRef(0);
  const runMs = run?.getTime?.();

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    const current = () => loadToken.current === token;

    setError(null);
    setLoading(true);
    setProgress(0);

    const apply = (payload, source) => {
      if (!current()) return;
      setData(payload);
      setDataSource(source);
      setProgress(payload ? 1 : 0);
      setLoading(false);
    };

    // Background freshness: a cached run shows instantly, but we still check the
    // DB for a NEWER admin-published run and swap it in — so every user (even a
    // returning one with an old cache) ends up on the latest published outlook.
    const freshenFromDB = async (haveBuiltAt) => {
      try {
        const fresh = await loadLatestTCMFromDBFresh(region);
        if (!current()) return;
        if (fresh?.grid?.length && (fresh.builtAt || 0) > (haveBuiltAt || 0)) {
          setData(fresh);
          setDataSource('db');
          setProgress(1);
          setLoading(false);
          try { localStorage.setItem(`tcm_forecast_v4_latest_${region}`, JSON.stringify(fresh)); } catch {}
        }
      } catch {}
    };

    // 0. In-memory cache (instant, and — unlike localStorage — works inside the
    //    Base44 sandbox iframe). Makes re-loading / prefetched regions immediate.
    const mem = getLatestFromMem(region);
    if (mem?.grid?.length) { apply(mem, 'cache'); freshenFromDB(mem.builtAt); return; }

    // 1 + 2. localStorage caches (instant), then a background DB freshness check.
    const exact = loadCachedTCMForRun(region, run) || loadRunFromCache(region, run);
    if (exact?.grid?.length) { apply(exact, 'cache'); freshenFromDB(exact.builtAt); return; }
    const latest = loadLatestRunFromCache(region);
    if (latest?.grid?.length) { apply(latest, 'cache'); freshenFromDB(latest.builtAt); return; }

    // 3. DB — bounded so we never hang on a slow/absent backend.
    try {
      const dbPayload = await Promise.race([
        loadLatestTCMFromDB(region),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 8000)),
      ]);
      if (!current()) return;                          // superseded — drop
      if (dbPayload?.grid?.length) return apply(dbPayload, 'db');
    } catch (e) {
      if (!current()) return;
      console.warn('[useTCMData] DB load failed:', e?.message);
    }

    // 4. Nothing available.
    apply(null, null);
  }, [region, runMs]);

  // Run on mount and whenever region/run changes; invalidate the in-flight load
  // on cleanup so its async result can't land after a newer load has started.
  useEffect(() => {
    load();
    return () => { loadToken.current++; };
  }, [load]);

  // Mirror a DB payload into the per-run localStorage cache so the next load of
  // this exact run is instant.
  useEffect(() => {
    if (dataSource === 'db' && data?.grid?.length && run) {
      try {
        const k = tcmRunCacheKey(region, run);
        if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(data));
      } catch {}
    }
  }, [data, dataSource, region, run]);

  return {
    data, setData,
    loading, setLoading,
    progress, setProgress,
    error, setError,
    dataSource,
    retry: load,
  };
}
