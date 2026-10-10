import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SKY_CONFIGS } from '@/components/weather/skyConfigs';
import { WEATHER_CODES } from '@/lib/metOfficeWeatherCodes';
import { weatherIcons } from '@/components/WeatherIcons';
import { CloudyIcon } from '@/components/icons/CloudIcons';
import useBlitzortung from '@/components/tcm/useBlitzortung';
import { LightningBanner, BandHeading, CityCard } from '@/components/home/CityConditionsUI';

/**
 * "Around the World" — current conditions for fifteen cities, in three bands,
 * with live global lightning above them.
 *
 * Deliberately *current* only: temperature, what it feels like, wind and
 * humidity for the hour that city is in. The day-by-day breakdown lives on the
 * Location Weather page, and every card deep-links straight to it.
 *
 * Each card draws the site's own animated sky — WeatherScene paints the
 * sun/moon, cloud banks, fog and lightning over the gradient, WeatherParticles
 * adds rain or snow on a canvas. Both size to their container, which is why the
 * full-page scene works unchanged inside a card. The phase (day / night /
 * sunrise / sunset) comes from each city's OWN clock, so Tokyo is dark while
 * London is bright.
 *
 * All fifteen come from one request: Open-Meteo takes a comma-separated
 * coordinate list and answers in order. `ukmo_seamless` is the Met Office's own
 * model — its global component covers the whole world, so every card on the
 * page shares one stated source.
 */

const CITY_GROUPS = [
  {
    id: 'uk',
    label: 'UK & Ireland',
    cities: [
      { name: 'London', lat: 51.5074, lon: -0.1278 },
      { name: 'Cardiff', lat: 51.4816, lon: -3.1791 },
      { name: 'Edinburgh', lat: 55.9533, lon: -3.1883 },
      { name: 'Belfast', lat: 54.5973, lon: -5.9301 },
      { name: 'Dublin', lat: 53.3498, lon: -6.2603 },
    ],
  },
  {
    id: 'eu',
    label: 'Europe',
    cities: [
      { name: 'Paris', lat: 48.8566, lon: 2.3522 },
      { name: 'Berlin', lat: 52.52, lon: 13.405 },
      { name: 'Madrid', lat: 40.4168, lon: -3.7038 },
      { name: 'Rome', lat: 41.9028, lon: 12.4964 },
      { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
    ],
  },
  {
    id: 'world',
    label: 'Rest of the world',
    cities: [
      { name: 'New York', lat: 40.7128, lon: -74.006 },
      { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
      { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
      { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
      { name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
    ],
  },
];

const ALL_CITIES = CITY_GROUPS.flatMap((g) => g.cities.map((c) => ({ ...c, group: g.id })));

const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'is_day',
];

const REFRESH_MS = 10 * 60 * 1000;

/**
 * WMO code -> Met Office significantWeatherCode, so the site's own icon and sky
 * tables can be reused as-is. Mirrors the mapping in
 * server/functions/getMetOfficeLocationWeather.js — keep the two in step.
 */
function wmoToMetOffice(wmo, isDay) {
  const d = (day, night) => (isDay ? day : night);
  switch (wmo) {
    case 0:
    case 1:
      return d(1, 0);
    case 2:
      return d(3, 2);
    case 3:
      return 8;
    case 45:
    case 48:
      return 6;
    case 51:
    case 53:
      return 11;
    case 55:
    case 61:
    case 63:
      return 12;
    case 56:
    case 57:
    case 66:
    case 67:
      return 18;
    case 65:
      return 15;
    case 71:
    case 73:
    case 77:
      return 24;
    case 75:
      return 27;
    case 80:
    case 81:
      return d(10, 9);
    case 82:
      return d(14, 13);
    case 85:
      return d(23, 22);
    case 86:
      return d(26, 25);
    case 95:
    case 96:
    case 99:
      return d(29, 28);
    default:
      return 7;
  }
}

/**
 * Which of the four sky phases to draw, from the CITY's clock rather than the
 * reader's — `localTime` is that city's own wall clock, straight from the API.
 */
function phaseFor(iconKey, isDay, localTime) {
  if (/ Night$/.test(iconKey) || !isDay) return 'night';
  const hour = Number(String(localTime || '').slice(11, 13));
  if (!Number.isFinite(hour)) return 'day';
  if (hour < 8) return 'sunrise';
  if (hour >= 18) return 'sunset';
  return 'day';
}

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

/** Everything a card needs to draw itself, derived once per city. */
function decorate(city) {
  const isDay = city.current?.is_day === 1;
  /* A card fed from DataHub already carries a Met Office significantWeatherCode
     and must not be translated again — WMO 12 is "distant thunderstorm", Met
     Office 12 is "light rain", so running the mapping twice does not fail
     loudly, it just quietly shows the wrong weather. */
  const moCode = !city.current ? 7
    : city.current.metOfficeCode ? (city.current.weather_code ?? 7)
      : wmoToMetOffice(city.current.weather_code, isDay);
  const info = WEATHER_CODES[moCode] || { desc: 'Unknown', icon: 'Cloudy' };

  /* THE MET OFFICE CODE SET HAS NO NIGHT CODE FOR CONTINUOUS PRECIPITATION.
     Showers do — 10 is a day shower and 9 is the same shower at night — but
     drizzle, rain, sleet, snow and hail are each a single code used around the
     clock. Taken literally that put a midday sun on Cardiff at half past
     seven in the evening, and on every other raining city after dark. The
     icon set already carries the night variants; nothing was choosing them. */
  const nightKey = `${info.icon} Night`;
  const iconKey = !isDay && weatherIcons[nightKey] ? nightKey : info.icon;
  const sky = SKY_CONFIGS[iconKey] || SKY_CONFIGS.Cloudy;
  const phase = phaseFor(iconKey, isDay, city.localTime);
  return {
    sky,
    iconKey,
    phase,
    gradient: sky?.[phase] || sky?.day,
    Icon: weatherIcons[iconKey] || CloudyIcon,
    desc: info.desc,
  };
}

export default function CityConditions() {
  const [cities, setCities] = useState(() => ALL_CITIES.map((c) => ({ ...c, current: null })));
  const [updatedAt, setUpdatedAt] = useState(null);
  const lightning = useLightning();

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      latitude: ALL_CITIES.map((c) => c.lat).join(','),
      longitude: ALL_CITIES.map((c) => c.lon).join(','),
      current: CURRENT_FIELDS.join(','),
      // The site formats wind itself (mph or km/h), and fmtWind takes mph.
      wind_speed_unit: 'mph',
      // Each city answers on its own clock, so the sky phase is right for
      // Tokyo at midnight as well as London at noon.
      timezone: 'auto',
      models: 'ukmo_seamless',
    });

    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // One coordinate returns an object, several return an array — in the
      // order the coordinates were sent.
      const points = Array.isArray(body) ? body : [body];
      const next = ALL_CITIES.map((c, i) => ({
        ...c,
        current: points[i]?.current || null,
        localTime: points[i]?.current?.time || null,
      }));
      setCities(next);
      setUpdatedAt(new Date());

      /* ── Met Office overlay, for the cities DataHub covers ────────────────
         Open-Meteo answers all fifteen cities in one keyless request, which is
         why it draws the row. DataHub site-specific is a call per point and
         needs a key, so it runs server-side, only over the UK group, and only
         when the allowance has been budgeted for it — see
         server/ukCityConditions.js. When it is off, or a point comes back
         empty, the Open-Meteo value already on screen stands.

         Deliberately after setCities: the row paints on the first source and
         the Met Office numbers replace them a moment later, rather than the
         whole row waiting on the slower of the two. */
      const ukIdx = ALL_CITIES.map((c, i) => [c, i]).filter(([c]) => c.group === 'uk');
      if (ukIdx.length) {
        try {
          const mo = await fetch('/api/uk-city-conditions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ points: ukIdx.map(([c]) => ({ lat: c.lat, lon: c.lon })) }),
            signal: AbortSignal.timeout(15000),
          }).then((r) => (r.ok ? r.json() : null));

          if (mo?.enabled && Array.isArray(mo.results)) {
            const merged = next.slice();
            ukIdx.forEach(([, idx], n) => {
              const cur = mo.results[n];
              if (!cur) return;
              merged[idx] = {
                ...merged[idx],
                /* Two fields stay Open-Meteo's. The local clock, because
                   DataHub stamps UTC and the card uses this to pick the sky
                   phase, which has to be the city's own time. And `is_day`,
                   which DataHub does not publish at all — without carrying it
                   over, every UK card would resolve to a night icon and a
                   night sky at noon. Everything else is Met Office. */
                current: {
                  ...cur,
                  time: merged[idx].current?.time ?? cur.time,
                  is_day: merged[idx].current?.is_day,
                },
                localTime: merged[idx].localTime,
              };
            });
            setCities(merged);
          }
        } catch {
          // An overlay that does not arrive costs provenance, not the row.
        }
      }
    } catch (err) {
      // Keep whatever is already on screen; only a first failure shows the
      // "Unavailable" state, so a dropped refresh does not blank the row.
      setCities((prev) =>
        prev.map((c) => (c.current ? c : { ...c, error: err.message || 'failed' }))
      );
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

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
                <CityCard
                  key={city.name}
                  city={city}
                  index={i}
                  bandId={group.id}
                  isWarmest={warmest?.name === city.name}
                  {...decorate(city)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {updatedAt && (
        <p className="mt-4 text-[10.5px] text-slate-400 dark:text-slate-500">
          Current conditions · Met Office (UKMO) via Open-Meteo · updated{' '}
          {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          <span className="mx-1.5 opacity-40">·</span>
          lightning © Blitzortung, live
        </p>
      )}
    </div>
  );
}
