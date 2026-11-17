/* The weather warnings, shared by the Hub and the Warnings tab (17 Nov 2026, the iOS-app redesign). The
   helpers and the merging are pages/Home.jsx's own, moved here unchanged. */
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const SEV_RANK = { Yellow: 1, Amber: 2, Red: 3 };
export const SEV_DOT = { Yellow: '#facc15', Amber: '#f59e0b', Red: '#ef4444' };

export function classifyWarnings(allWarnings) {
  const now = new Date();
  const active = [],upcoming = [],past = [];
  for (const w of allWarnings) {
    const from = w.validFrom ? new Date(w.validFrom) : null;
    const to = w.validTo ? new Date(w.validTo) : null;
    if (to && to < now) past.push(w);else
    if (from && from > now) upcoming.push(w);else
    active.push(w);
  }
  return { active, upcoming, past };
}

/**
 * The next scheduled warnings refresh: the next ten-minute slot (SLOT_MINUTES in
 * server/functions/getMetOfficeWarnings.js). This said ":00 or :30", a cadence
 * the server stopped using, so a record without `next_at` counted down to the
 * wrong time.
 *
 * The server fetches on those boundaries and nowhere else — opening the page
 * never triggers a fetch — so this countdown is the same for every visitor.
 * When the cached record carries the server's own `next_at`, that wins; this is
 * only the fallback for a record written before that field existed.
 */
const SLOT_MINUTES = 10;
export function getNextRefreshTime(record) {
  const fromServer = record?.next_at ? new Date(record.next_at) : null;
  if (fromServer && !Number.isNaN(fromServer.getTime()) && fromServer > new Date()) {
    return fromServer;
  }
  const next = new Date();
  next.setSeconds(0, 0);
  next.setMinutes(Math.floor(next.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES + SLOT_MINUTES);
  return next;
}

export function normaliseManualWarning(w) {
  return {
    ...w,
    validFrom: w.valid_from ?? null,
    validTo: w.valid_to ?? null,
    affectedAreas: w.areas ?? [],
    // WarningMap reads `regions` (array) / `region` to draw polygons — manual
    // warnings store their areas under `areas`, so mirror them onto `regions`
    // so the map renders for manual warnings exactly like Met Office ones.
    regions: Array.isArray(w.regions) ? w.regions : (w.areas ?? []),
    isManual: true
  };
}

export function classifyManualWarnings(warnings, now) {
  const active = [],upcoming = [],past = [];
  for (const w of warnings) {
    const from = w.validFrom ? new Date(w.validFrom) : null;
    const to = w.validTo ? new Date(w.validTo) : null;
    if (to && to <= now) past.push(w);else
    if (from && from > now) upcoming.push(w);else
    active.push(w);
  }
  return { active, upcoming, past };
}

/**
 * The warnings, as the home page always put them together: the Met Office's (CachedWarnings, kept fresh by
 * the server and pushed here as it changes) and our own (ManualWarning, published), with a hand-drawn manual
 * warning taking over from the Met Office's of the same type. Used by the Hub (its status line) and the
 * Warnings tab (everything). Moved from pages/Home.jsx unchanged, 17 Nov 2026.
 */
export function useWarnings() {
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState([]);
  const [upcomingWarnings, setUpcomingWarnings] = useState([]);
  const [allWarnings, setAllWarnings] = useState([]);
  const [loadingWarnings, setLoadingWarnings] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nextUpdate, setNextUpdate] = useState(null);
  const [warningsSource, setWarningsSource] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadWarningsFromDB = useCallback(async (retries = 2) => {
    setLoadingWarnings(true);
    try {
      const records = await base44.entities.CachedWarnings.list();
      const record = records?.[0];
      if (record) {
        const all = Array.isArray(record.all_warnings) ? record.all_warnings : [];
        const { active, upcoming } = classifyWarnings(all);
        setWarnings(active); setUpcomingWarnings(upcoming); setAllWarnings(all);
        setLastUpdated(record.fetched_at ? new Date(record.fetched_at) : null);
        setWarningsSource(record.source || null);
      } else {
        setWarnings([]); setUpcomingWarnings([]); setAllWarnings([]);
      }
      setNextUpdate(getNextRefreshTime(record));
      return !!record;
    } catch (error) {
      if (retries > 0) setTimeout(() => loadWarningsFromDB(retries - 1), 1500);
      else { console.error('Error loading warnings:', error); setWarnings([]); setUpcomingWarnings([]); }
    } finally {
      setLoadingWarnings(false);
    }
  }, []);

  const fetchWarnings = useCallback(async (retries = 2) => {
    setRefreshing(true); setLoadingWarnings(true);
    try {
      await base44.functions.invoke('getMetOfficeWarnings', {});
      await loadWarningsFromDB();
    } catch (error) {
      if (retries > 0) setTimeout(() => fetchWarnings(retries - 1), 1500);
      else { console.error('Error fetching:', error); setLoadingWarnings(false); }
    } finally {
      setRefreshing(false);
    }
  }, [loadWarningsFromDB]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await loadWarningsFromDB();
      /* an empty cache (a fresh deployment, or after it was cleared): one background fetch, so the
         warnings load without an admin pressing Refresh (`false` only when the read worked and found
         nothing; a failed read retries on its own) */
      if (!cancelled && found === false) {
        base44.functions.invoke('getMetOfficeWarnings', {})
          .then(() => loadWarningsFromDB())
          .catch((e) => console.warn('[warnings] cold-start fetch failed:', e?.message));
      }
    })();
    const unsub = base44.entities.CachedWarnings.subscribe((event) => {
      if (event.type === 'create' || event.type === 'update') {
        try {
          const all = Array.isArray(event.data?.all_warnings) ? event.data.all_warnings : [];
          const { active, upcoming } = classifyWarnings(all);
          setWarnings(active); setUpcomingWarnings(upcoming); setAllWarnings(all);
          setLastUpdated(event.data?.fetched_at ? new Date(event.data.fetched_at) : new Date());
          setWarningsSource(event.data?.source || null);
          setNextUpdate(getNextRefreshTime(event.data));
        } catch (err) { console.error('Warning update error:', err); }
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [loadWarningsFromDB]);

  const { data: rawManualWarnings = [] } = useQuery({
    queryKey: ['manualWarnings'],
    queryFn: async () => { try { return (await base44.entities.ManualWarning.list('-valid_from')) || []; } catch { return []; } },
    refetchInterval: 30000, retry: 2, retryDelay: 1000,
  });
  const normalisedManual = rawManualWarnings.filter((w) => w.is_published).map(normaliseManualWarning);
  const { active: manualActive, upcoming: manualUpcoming } = classifyManualWarnings(normalisedManual, now);

  /* a manual warning with a hand-drawn area takes over from the Met Office's of the same type */
  const hasDrawnArea = (w) => Array.isArray(w.area_drawing) && w.area_drawing.length > 0;
  const overriddenTypes = new Set(
    [...manualActive, ...manualUpcoming].filter(hasDrawnArea).map((w) => (w.type || '').toLowerCase()));
  const isOverridden = (w) => overriddenTypes.has((w.type || '').toLowerCase());
  const mergedActive = [...warnings.filter((w) => !isOverridden(w)), ...manualActive];
  const mergedUpcoming = [...upcomingWarnings.filter((w) => !isOverridden(w)), ...manualUpcoming];
  const mergedAll = [...allWarnings.filter((w) => !isOverridden(w)), ...normalisedManual];

  /* an admin can delete a manual warning straight from its card */
  const deleteManualWarning = useCallback(async (warning) => {
    if (!warning?.id || !warning?.isManual) return;
    if (!window.confirm(`Delete "${warning.title || warning.type + ' Warning'}"? This cannot be undone.`)) return;
    try {
      await base44.entities.ManualWarning.delete(warning.id);
      queryClient.invalidateQueries({ queryKey: ['manualWarnings'] });
    } catch (e) {
      console.error('Failed to delete warning:', e);
      window.alert('Could not delete the warning. Please try again.');
    }
  }, [queryClient]);

  /* the status line: never counts upcoming warnings as in force; its dot takes the worst in force */
  const worstActive = mergedActive.reduce(
    (worst, w) => ((SEV_RANK[w.severity] || 0) > (SEV_RANK[worst] || 0) ? w.severity : worst), null);
  const statusDot = SEV_DOT[worstActive] || (mergedUpcoming.length ? '#38bdf8' : '#34d399');
  const statusText = mergedActive.length
    ? `${mergedActive.length} warning${mergedActive.length === 1 ? '' : 's'} in force`
      + (mergedUpcoming.length ? ` Â· ${mergedUpcoming.length} upcoming` : '')
    : mergedUpcoming.length
      ? `No warnings in force Â· ${mergedUpcoming.length} upcoming`
      : 'No weather warnings in force';
  /* a red "Wild Fire" manual warning is called out as a nationwide government alert */
  const redWildfire = mergedActive.some(
    (w) => (w.type || '').toLowerCase() === 'wild fire' && (w.severity || '').toLowerCase() === 'red');

  return {
    mergedActive, mergedUpcoming, mergedAll, loadingWarnings, refreshing, lastUpdated, nextUpdate, warningsSource,
    loadWarningsFromDB, fetchWarnings, deleteManualWarning, worstActive, statusDot, statusText, redWildfire, now,
  };
}
