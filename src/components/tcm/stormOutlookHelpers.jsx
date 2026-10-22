// The thunderstorm graphic's lightning overlay: the Met Office strikes for the UK and Ireland,
// polled while the overlay is on (useStormLightning). The rest of what this module once held (the
// graphic's map layers, levels and styles) lives in the graphic and studio/ now.
import { useState, useEffect, useMemo, useRef } from 'react';
import { MAP_BBOX } from '@/components/studio/studioGeo';

function strikeTimeMs(t) {
  if (t == null) return NaN;
  if (typeof t === 'string') {
    const n = Number(t);
    if (Number.isFinite(n)) return strikeTimeMs(n);
    const parsed = Date.parse(t);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (t > 1e15) return Math.round(t / 1e6);
  if (t > 1e12) return t;
  return t * 1000;
}

// --- Lightning overlay hook: Met Office lightning -------------------------------
// The strikes are the Met Office's (LEELA, through /api/nova/lightning/day): every UK &
// Ireland strike for a UK calendar day, the same feed as the TCM pages and the site's live
// lightning layer, read on the server and cached there for three minutes. It used to be pieced
// together in the browser from Base44 functions and a Base44 table that the self-hosted site
// does not have, a Blitzortung relay on Render and a live Blitzortung socket, so it loaded
// nothing or only part of the day. Today (from UK midnight) and yesterday are read, so a
// rolling window can reach back past midnight, and both are read again every minute while the
// overlay is on. Used by StormOutlookGraphicTool (the snow and wind graphics have no lightning); the colour, outline
// and window settings stay theirs (saved with the graphic) and are passed in.
const LIGHTNING_POLL_MS = 60_000;
const ukDayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export function useStormLightning({
  lightningWindow, setLightningWindow, windowMinutes, setWindowMinutes,
}) {
  const [showLightning, setShowLightning] = useState(false);
  const [strikes, setStrikes] = useState(null);
  const [loadingStrikes, setLoadingStrikes] = useState(false);
  const [lightningError, setLightningError] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);

  const strikeStoreRef = useRef(new Map());
  const showLightningRef = useRef(false);
  const pollRef = useRef(null);
  const liveDirtyRef = useRef(false);
  const todayStartRef = useRef(null);

  const inUKIreland = (lat, lon) =>
    lon >= MAP_BBOX.lonMin && lon <= MAP_BBOX.lonMax &&
    lat >= MAP_BBOX.latMin && lat <= MAP_BBOX.latMax;

  const addStrike = (lat, lon, rawT) => {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (!inUKIreland(lat, lon)) return false;
    const tMs = strikeTimeMs(rawT);
    if (!Number.isFinite(tMs)) return false;
    const key = `${tMs}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
    if (strikeStoreRef.current.has(key)) return false;
    strikeStoreRef.current.set(key, { lat, lon, t: tMs });
    return true;
  };

  /* today = since UK midnight (the server's day bounds); a window = the last N minutes */
  const flushStrikes = () => {
    const all = Array.from(strikeStoreRef.current.values());
    const nowMs = Date.now();
    if (!lightningWindow) {
      const start = todayStartRef.current ?? new Date(`${ukDayKey(nowMs)}T00:00:00`).getTime();
      setStrikes(all.filter(s => s.t >= start));
      return;
    }
    const startMs = nowMs - windowMinutes * 60_000;
    setStrikes(all.filter(s => s.t >= startMs && s.t <= nowMs));
  };

  /* today's and yesterday's strikes from the Met Office; how many were new */
  const loadMetOffice = async () => {
    const now = Date.now();
    const days = [ukDayKey(now), ukDayKey(now - 86_400_000)];
    const bodies = await Promise.all(days.map(async (d) => {
      const r = await fetch(`/api/nova/lightning/day?date=${d}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`the Met Office lightning feed answered ${r.status}`);
      return r.json();
    }));
    let added = 0;
    for (const b of bodies) {
      if (b.day === days[0] && b.from) todayStartRef.current = Date.parse(b.from);
      for (const [t, lat, lon] of b.strikes || []) if (addStrike(lat, lon, t)) added++;
    }
    if (/unavailable/i.test(bodies[0]?.source || '')) throw new Error('The Met Office lightning feed is not answering right now.');
    return added;
  };

  const stopLightning = () => {
    showLightningRef.current = false;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setLiveStatus(null);
  };

  /* while the overlay is on, new strikes arrive every minute */
  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      if (!showLightningRef.current) return;
      try {
        if (await loadMetOffice()) liveDirtyRef.current = true;
        setLiveStatus('connected');
        setLightningError(null);
      } catch (err) {
        setLiveStatus('unavailable');
        setLightningError(err?.message || 'The Met Office lightning feed is not answering right now.');
      }
    }, LIGHTNING_POLL_MS);
  };

  const load = async () => {
    setLoadingStrikes(true);
    setLightningError(null);
    try {
      await loadMetOffice();
      flushStrikes();
      setLiveStatus('connected');
      if (strikeStoreRef.current.size === 0) setLightningError('No lightning over the UK or Ireland yet today (Met Office). New strikes appear within a few minutes.');
    } catch (err) {
      setLiveStatus('unavailable');
      setLightningError(err?.message || 'Could not load the Met Office lightning.');
    } finally {
      setLoadingStrikes(false);
    }
    startPolling();
  };

  const toggleLightning = async () => {
    if (showLightning) { setShowLightning(false); stopLightning(); return; }
    setShowLightning(true);
    showLightningRef.current = true;
    strikeStoreRef.current = new Map();
    setStrikes([]);
    setLiveStatus('connecting');
    await load();
  };

  const refreshLightning = async () => {
    if (!showLightning || loadingStrikes) return;
    await load();
  };

  useEffect(() => () => stopLightning(), []);

  useEffect(() => {
    if (!showLightning) return;
    flushStrikes();
    const iv = setInterval(() => {
      if (liveDirtyRef.current || lightningWindow) { liveDirtyRef.current = false; flushStrikes(); }
    }, 5_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLightning, lightningWindow, windowMinutes]);

  const lightningStats = useMemo(() => {
    const list = Array.isArray(strikes) ? strikes : [];
    if (!list.length) return { count: 0, peakHour: null, peakCount: 0 };
    const buckets = new Array(24).fill(0);
    for (const s of list) { const h = new Date(s.t ?? s.time).getHours(); if (h >= 0 && h < 24) buckets[h]++; }
    let peakHour = 0, peakCount = -1;
    buckets.forEach((c, h) => { if (c > peakCount) { peakCount = c; peakHour = h; } });
    return { count: list.length, peakHour, peakCount };
  }, [strikes]);

  const tzAbbr = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(new Date());
      return parts.find(p => p.type === 'timeZoneName')?.value || '';
    } catch { return ''; }
  }, []);
  const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

  return {
    showLightning, setShowLightning, strikes, loadingStrikes, lightningError, liveStatus,
    toggleLightning, refreshLightning, lightningStats, fmtHour, tzAbbr, stopLightning,
  };
}
