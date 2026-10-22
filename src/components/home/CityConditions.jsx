import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { classify, condLabel, sunElevation, windyOf } from '@/lib/ukvLocation';
import { LightningBanner, BandHeading, CityCard } from '@/components/home/CityConditionsUI';

/**
 * "Around the World": the weather right now in fifteen cities, in three bands, with live
 * lightning above them (the UK and Ireland, Europe and the world).
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
const CLOUD = { clear: 5, mostlyClear: 25, partly: 50, mostlyCloudy: 72, cloudy: 88, overcast: 100, mist: 90, fog: 95, drizzle: 92, showers: 70, heavyShowers: 75, thunder: 85 };

const clock = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const CLOCKS = Object.fromEntries(ALL_CITIES.map((c) => [c.id, clock(c.tz)]));

/* ── live lightning ─────────────────────────────────────────────────────── */

/* Inclusive bands: Europe contains the UK and Ireland, and World contains
   everything — which is how people read "UK / Europe / World" without being
   told. `region` is the server's name for the same box (server/lightning). */
const BANDS = [
  { id: 'uk', label: 'UK & Ireland', region: 'uk' },
  { id: 'eu', label: 'Europe', region: 'europe' },
  { id: 'world', label: 'World', region: 'world' },
];
const LIGHTNING_MS = 20 * 1000;

/**
 * Live lightning, from this site's own round-the-clock archive (/api/lightning/summary): the
 * Met Office's network over the UK and Ireland, Blitzortung everywhere else, captured by the
 * server and, while it is off, by the cloud capture.
 *
 * It used to open its own Blitzortung connection in every visitor's browser and count what that
 * one socket heard while the tab was open: a fraction of the strikes (about a quarter of the
 * world's, the evening it was replaced), and a "today" that really meant "since you opened the
 * page", different on every device. The server's counts are the whole day and the same for
 * everyone, and the page no longer handles thousands of strikes a minute to show nine numbers.
 */
function useLightning() {
  const [state, setState] = useState({ stats: null, live: false, lastStrikeAt: null });
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;      // nobody looking: skip the poll
      try {
        const r = await fetch('/api/lightning/summary', { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (stop) return;
        const stats = {};
        for (const b of BANDS) {
          const g = j.regions?.[b.region] || {};
          stats[b.id] = { fifteen: g.last15 ?? 0, hour: g.lastHour ?? 0, today: g.today ?? 0 };
        }
        const newest = j.regions?.world?.newest;
        const live = j.feeds?.blitzortung?.status === 'live' || j.feeds?.metoffice?.status === 'live';
        setState({ stats, live, lastStrikeAt: newest ? new Date(newest) : null });
      } catch {
        if (!stop) setState((s) => ({ ...s, live: false }));
      }
    };
    load();
    const id = setInterval(load, LIGHTNING_MS);
    document.addEventListener('visibilitychange', load);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', load); };
  }, []);
  return state;
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
        const wx = { tcc: n.tcc, precipRate: n.radar ?? 0, span: 0, wind: n.wind10, gust: n.gust10, t2: n.t2 };
        const cond = classify(wx);
        next[c.id] = {
          windy: windyOf(wx),
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
      desc: r.cond ? condLabel(r.cond, day, r.windy) : null,
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
          lightning: Met Office (UK & Ireland), Blitzortung elsewhere
        </p>
      )}
    </div>
  );
}
