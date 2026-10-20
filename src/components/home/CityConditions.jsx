import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useBlitzortung from '@/components/tcm/useBlitzortung';
import { classify, condLabel, sunElevation } from '@/lib/ukvLocation';
import { LightningBanner, BandHeading, CityCard } from '@/components/home/CityConditionsUI';

/**
 * "Around the World": the weather right now in fifteen cities, in three bands, with live global
 * lightning above them.
 *
 * Every number is the Met Office's:
 *   UK cities      the 15-minute UKV analysis (corrected by station reports) and the radar at each
 *                  city, from this site's own server in one request (/api/location/now), the same
 *                  numbers as Location Weather's "Right now"
 *   everywhere     the Met Office global model through DataHub site-specific, on the site's key,
 *   else           fetched by the server a few times a day and shared by every visitor
 *                  (/api/world-conditions); never Open-Meteo
 *
 * Each card is the Location page's own live sky (clouds, sun or moon, rain, snow, hail, fog and
 * lightning on a canvas, for that city's weather and the sun's height there now) under its Apple-
 * style symbol, so the home page and Location Weather draw weather the same way.
 */

const CITY_GROUPS = [
  {
    id: 'uk',
    label: 'UK & Ireland',
    cities: [
      { id: 'london', name: 'London', lat: 51.5074, lon: -0.1278, tz: 'Europe/London', src: 'ukv' },
      { id: 'cardiff', name: 'Cardiff', lat: 51.4816, lon: -3.1791, tz: 'Europe/London', src: 'ukv' },
      { id: 'edinburgh', name: 'Edinburgh', lat: 55.9533, lon: -3.1883, tz: 'Europe/London', src: 'ukv' },
      { id: 'belfast', name: 'Belfast', lat: 54.5973, lon: -5.9301, tz: 'Europe/London', src: 'ukv' },
      { id: 'dublin', name: 'Dublin', lat: 53.3498, lon: -6.2603, tz: 'Europe/Dublin', src: 'mo' },
    ],
  },
  {
    id: 'eu',
    label: 'Europe',
    cities: [
      { id: 'paris', name: 'Paris', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris', src: 'mo' },
      { id: 'berlin', name: 'Berlin', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin', src: 'mo' },
      { id: 'madrid', name: 'Madrid', lat: 40.4168, lon: -3.7038, tz: 'Europe/Madrid', src: 'mo' },
      { id: 'rome', name: 'Rome', lat: 41.9028, lon: 12.4964, tz: 'Europe/Rome', src: 'mo' },
      { id: 'amsterdam', name: 'Amsterdam', lat: 52.3676, lon: 4.9041, tz: 'Europe/Amsterdam', src: 'mo' },
    ],
  },
  {
    id: 'world',
    label: 'Rest of the world',
    cities: [
      { id: 'newyork', name: 'New York', lat: 40.7128, lon: -74.006, tz: 'America/New_York', src: 'mo' },
      { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo', src: 'mo' },
      { id: 'sydney', name: 'Sydney', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney', src: 'mo' },
      { id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai', src: 'mo' },
      { id: 'capetown', name: 'Cape Town', lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg', src: 'mo' },
    ],
  },
];
const ALL_CITIES = CITY_GROUPS.flatMap((g) => g.cities.map((c) => ({ ...c, group: g.id })));
const UKV_CITIES = ALL_CITIES.filter((c) => c.src === 'ukv');
/* Location Weather runs on the UKV, which covers the UK and Ireland: those cards open it */
const OPENS_FORECAST = new Set(['uk']);

const REFRESH_MS = 10 * 60 * 1000;

/* A Met Office significantWeatherCode as the condition the symbols and skies are drawn for. The
   code already says day or night where it matters; the sky takes that from the sun instead. */
function moCond(code) {
  switch (Number(code)) {
    case -1: case 11: return 'drizzle';
    case 0: case 1: return 'clear';
    case 2: case 3: return 'partly';
    case 5: return 'mist';
    case 6: return 'fog';
    case 7: return 'cloudy';
    case 8: return 'overcast';
    case 9: case 10: return 'showers';
    case 12: return 'lightRain';
    case 13: case 14: return 'heavyShowers';
    case 15: return 'heavyRain';
    case 16: case 17: case 18: return 'sleet';
    case 19: case 20: case 21: return 'hail';
    case 22: case 23: return 'snowShowers';
    case 24: return 'snow';
    case 25: case 26: case 27: return 'heavySnow';
    case 28: case 29: case 30: return 'thunder';
    default: return 'cloudy';
  }
}
/* the sky's cloud cover for a condition (DataHub's site-specific series has no cloud amount) */
const CLOUD = { clear: 5, mostlyClear: 25, partly: 50, cloudy: 82, overcast: 100, mist: 90, fog: 95, drizzle: 92, showers: 70, heavyShowers: 75, thunder: 85 };

const clock = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const CLOCKS = Object.fromEntries(ALL_CITIES.map((c) => [c.id, clock(c.tz)]));

/* ── live lightning ─────────────────────────────────────────────────────── */

/* Inclusive bands: Europe contains the UK and Ireland, and World contains
   everything — which is how people read "UK / Europe / World" without being
   told. The world box is the whole planet, so the feed is unfiltered. */
const BANDS = [
  { id: 'uk', label: 'UK & Ireland', latMin: 49.5, latMax: 61, lonMin: -11, lonMax: 2 },
  { id: 'eu', label: 'Europe', latMin: 34, latMax: 72, lonMin: -25, lonMax: 45 },
  { id: 'world', label: 'World', latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 },
];
const WORLD_BBOX = { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };

const inBand = (s, b) =>
  s.lat >= b.latMin && s.lat <= b.latMax && s.lon >= b.lonMin && s.lon <= b.lonMax;

const TOTALS_KEY = 'mwuk_lightning_totals';

function loadTotals() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const saved = JSON.parse(localStorage.getItem(TOTALS_KEY) || 'null');
    if (saved && saved.date === today) return saved.totals;
  } catch {
    /* unreadable or blocked — start from zero */
  }
  return { uk: 0, eu: 0, world: 0 };
}

function saveTotals(totals) {
  try {
    localStorage.setItem(
      TOTALS_KEY,
      JSON.stringify({ date: new Date().toISOString().slice(0, 10), totals })
    );
  } catch {
    /* storage full or blocked — the live windows still work */
  }
}

/**
 * Live lightning worldwide, from Blitzortung.
 *
 * Global strike rates run to thousands per minute, so nothing here calls
 * setState per strike — that would re-render the page continuously. Strikes
 * land in refs, and the display is flushed on a timer. For the same reason the
 * rolling buffer holds only the last hour and only timestamps + band flags;
 * today's running totals are plain counters, persisted so a reload does not
 * reset them to zero.
 *
 * This intentionally does not write to the shared `tcm_today_strikes` store the
 * TCM pages use — that one is UK-scoped, and filling it with worldwide strikes
 * would corrupt their view.
 */
function useLightning() {
  const recentRef = useRef([]); // { t, bands: [ids] } for the last hour
  const totalsRef = useRef(loadTotals());
  const dirtyRef = useRef(false);
  const [stats, setStats] = useState(() => ({
    uk: { fifteen: 0, hour: 0, today: totalsRef.current.uk },
    eu: { fifteen: 0, hour: 0, today: totalsRef.current.eu },
    world: { fifteen: 0, hour: 0, today: totalsRef.current.world },
  }));
  const [status, setStatus] = useState('connecting');
  const [lastStrikeAt, setLastStrikeAt] = useState(null);

  const onStrike = useCallback((s) => {
    if (!Number.isFinite(s?.lat) || !Number.isFinite(s?.lon)) return;
    const bands = BANDS.filter((b) => inBand(s, b)).map((b) => b.id);
    if (!bands.length) return;
    recentRef.current.push({ t: s.time || Date.now(), bands });
    for (const id of bands) totalsRef.current[id] += 1;
    dirtyRef.current = true;
  }, []);

  useBlitzortung({ enabled: true, bbox: WORLD_BBOX, onStrike, onStatus: setStatus });

  // One flush a second: the windows stay honest as time passes, and a burst of
  // strikes costs one render rather than hundreds.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const hourAgo = now - 3600_000;
      const fifteenAgo = now - 900_000;
      recentRef.current = recentRef.current.filter((r) => r.t >= hourAgo);

      const next = {};
      for (const b of BANDS) {
        const mine = recentRef.current.filter((r) => r.bands.includes(b.id));
        next[b.id] = {
          fifteen: mine.filter((r) => r.t >= fifteenAgo).length,
          hour: mine.length,
          today: totalsRef.current[b.id],
        };
      }
      setStats(next);

      if (dirtyRef.current) {
        dirtyRef.current = false;
        saveTotals(totalsRef.current);
        setLastStrikeAt(new Date());
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const live = status === 'live' || status === 'connected' || status === 'open';
  return { stats, live, lastStrikeAt };
}

/* ── the cities ─────────────────────────────────────────────────────────── */

export default function CityConditions() {
  const [readings, setReadings] = useState({});   // id -> { current, cond, rate, cloud, valid } | { error }
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tick, setTick] = useState(() => Date.now());   // each city's clock and sun, once a minute
  const lightning = useLightning();

  const load = useCallback(async () => {
    const [ukv, world] = await Promise.all([
      fetch(`/api/location/now?p=${UKV_CITIES.map((c) => `${c.lat},${c.lon}`).join('|')}`, { signal: AbortSignal.timeout(20000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/world-conditions', { signal: AbortSignal.timeout(30000) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setReadings((prev) => {
      const next = { ...prev };
      UKV_CITIES.forEach((c, i) => {
        const n = ukv?.places?.[i];
        if (!n || n.t2 == null) { if (!next[c.id]?.current) next[c.id] = { error: true }; return; }
        const cond = classify({ tcc: n.tcc, precipRate: n.radar ?? 0, span: 0 });
        next[c.id] = {
          current: { temperature_2m: n.t2, apparent_temperature: n.feels ?? n.t2, relative_humidity_2m: n.rh2, wind_speed_10m: n.wind10, wind_direction_10m: n.wdir10 },
          cond, rate: n.radar ?? 0, cloud: n.tcc ?? CLOUD[cond] ?? 90, valid: n.valid,
        };
      });
      for (const w of world?.cities || []) {
        if (!w.ok) { if (!next[w.id]?.current) next[w.id] = { error: true }; continue; }
        const cond = moCond(w.code);
        next[w.id] = {
          current: { temperature_2m: w.temp, apparent_temperature: w.feels ?? w.temp, relative_humidity_2m: w.rh, wind_speed_10m: w.wind, wind_direction_10m: w.wdir },
          cond, rate: w.rate ?? 0, cloud: CLOUD[cond] ?? 90, valid: w.valid,
        };
      }
      if (!world) for (const c of ALL_CITIES) if (c.src === 'mo' && !next[c.id]?.current) next[c.id] = { error: true };
      return next;
    });
    if (ukv || world) setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const t = setInterval(() => setTick(Date.now()), 60_000);
    return () => { clearInterval(id); clearInterval(t); };
  }, [load]);

  /* what each card shows: the reading, plus the city's own clock and sun right now */
  const cities = useMemo(() => ALL_CITIES.map((c) => {
    const r = readings[c.id] || {};
    const sun = sunElevation(tick, c.lat, c.lon);
    const localTime = CLOCKS[c.id].format(new Date(tick));
    const day = sun > -0.833;
    return {
      ...c, ...r, sun, day, localTime,
      morning: Number(localTime.slice(0, 2)) < 12,
      desc: r.cond ? condLabel(r.cond, day) : null,
      href: OPENS_FORECAST.has(c.group) ? `/LocationWeather?lat=${c.lat}&lon=${c.lon}&name=${encodeURIComponent(c.name)}` : null,
    };
  }), [readings, tick]);

  const byGroup = useMemo(() => {
    const map = {};
    for (const c of cities) (map[c.group] = map[c.group] || []).push(c);
    return map;
  }, [cities]);

  return (
    <div>
      <LightningBanner
        stats={lightning.stats}
        live={lightning.live}
        lastStrikeAt={lightning.lastStrikeAt}
        bands={BANDS}
      />

      {CITY_GROUPS.map((group, gi) => {
        const list = byGroup[group.id] || [];
        // Marked on the card, so a glance across a band finds the hot one.
        const warmest = list.reduce(
          (best, c) =>
            c.current?.temperature_2m != null &&
            (!best || c.current.temperature_2m > best.current.temperature_2m)
              ? c
              : best,
          null
        );
        return (
          <div key={group.id} className={gi ? 'mt-7' : ''}>
            <BandHeading group={group} cities={list} />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-3.5">
              {list.map((city, i) => (
                <CityCard key={city.id} city={city} index={i} bandId={group.id} isWarmest={warmest?.id === city.id} />
              ))}
            </div>
          </div>
        );
      })}

      {updatedAt && (
        <p className="mt-4 text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
          Right now · UK: Met Office UKV analysis · elsewhere: Met Office global model · updated{' '}
          {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          <span className="mx-1.5 opacity-40">·</span>
          lightning © Blitzortung, live
        </p>
      )}
    </div>
  );
}
