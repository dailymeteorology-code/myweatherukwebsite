/* Location forecast page.

   NOTE ON THE FILE NAME: this used to live at src/pages/LocationWeather.jsx.
   The Base44 builder preview kept serving a long-stale cached copy of that
   module — it showed "Met Office API error: 403", a message that no longer
   exists anywhere in this codebase — while the published site ran the current
   code correctly. Moving the implementation to a new module URL means the old
   cached file is never requested again. The route key stays "LocationWeather"
   in pages.config.js, so every existing link keeps working. */
import { useState, useCallback, useEffect, useRef } from "react";
import { base44 } from '@/api/base44Client';
import LocationSearchBox from "@/components/location/LocationSearchBox";
import LocationLanding from "@/components/location/LocationLanding";
import HourlyStrip from "@/components/location/HourlyStrip";
import PrecipOutlook from "@/components/location/PrecipOutlook";
import LocationRadar from "@/components/location/LocationRadar";
import { currentUser, loadRecent, rememberSearch, forgetSearch, clearRecent } from '@/lib/locationHistory';
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Wind, Droplets, Eye, Gauge, Sun, ArrowLeft, AlertTriangle } from "lucide-react";
import LocationWarnings from "@/components/location/LocationWarnings";
import { fetchAllWarningsForPoint, warningsOnDay, topSeverity, severityColour } from "@/lib/locationWarnings";
import { weatherIcons } from "@/components/WeatherIcons";
import { WEATHER_CODES, precipKind } from "@/lib/metOfficeWeatherCodes";
import { CloudyIcon } from "@/components/icons/CloudIcons";
import WeatherScene from "@/components/weather/WeatherScene";
import WeatherParticles from "@/components/weather/WeatherParticles";
import { SKY_CONFIGS } from "@/components/weather/skyConfigs";

/* Met Office significantWeatherCode -> description + a key from the shared icon
   library (components/WeatherIcons.jsx).

   THE `icon` VALUES MUST MATCH THE LIBRARY EXACTLY, including capitalisation.
   They previously did not: the library is keyed 'Sunny', 'Partly Cloudy',
   'Rain Shower' while this table asked for 'sunny', 'partly cloudy',
   'light rain shower'. weatherIcons[key] came back undefined every single time,
   so WeatherIcon fell through to its CloudyIcon default and EVERY forecast on
   the page — sunny, snow, thunder alike — drew the same grey cloud. All 19 keys
   missed. The dev-only check below now shouts if that ever regresses.

   Met Office encodes day and night in the code itself: within a shower family
   the even code is night and the odd one is day (9 night / 10 day, 13/14,
   16/17, and so on). The old table collapsed each pair onto one icon and threw
   that away; the library carries proper night variants, so the pairs are now
   mapped separately and a 2am shower gets a moon rather than a sun. */

/* Catch a broken key at load time instead of shipping grey clouds.

   The original failure was invisible: a missing key silently became a cloud, so
   the page looked plausible and stayed wrong. Anything referenced here that the
   library does not define now shouts in the console during development. */
if (import.meta.env?.DEV) {
  const bad = Object.entries(WEATHER_CODES)
    .filter(([, v]) => !weatherIcons[v.icon])
    .map(([code, v]) => `${code}:"${v.icon}"`);
  if (bad.length) {
    console.error(
      `[LocationForecast] ${bad.length} weather code(s) point at icons missing from ` +
      `WeatherIcons.jsx and will render as a plain cloud: ${bad.join(', ')}`,
    );
  }
}

/* Which calendar day an instant belongs to, in UK terms.

   THIS IS NOT `iso.slice(0, 10)`. The Met Office stamps every hour in UTC and
   the page renders every clock time in Europe/London. From late March to late
   October those differ by an hour, so slicing the UTC date filed 23:00 UTC —
   which is midnight tonight — under TODAY, and left tomorrow missing its first
   hour. The strip showed an hour labelled 00:00 sitting at the end of today,
   and each day's max and min were taken over the wrong twenty-four hours. */
const UK_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});
function ukDate(when) {
  return UK_DAY.format(when instanceof Date ? when : new Date(when));
}

function degToCompass(deg) {
  if (deg == null) return "";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

/* Seven days out of two feeds.

   DataHub's HOURLY product only runs about 48 hours ahead. The day list used to
   be derived from it alone, so asking for seven days could never produce more
   than the two or three the hourly feed happened to cover. The DAILY product
   runs the full week, so the days come from there and the hourly detail is
   attached to whichever of them it reaches — the rest are honest about having
   no hour-by-hour breakdown rather than showing an empty chart. */
function transformMetOfficeData(apiData, dailyApiData, threeHourlyApiData, locationName, serverForecast) {
  const feature = apiData.features?.[0];
  if (!feature) throw new Error("No forecast data returned from Met Office");
  const timeSeries = feature.properties.timeSeries || [];
  const detectedName = feature.properties.location?.name || locationName;

  /* THE THREE-HOURLY PRODUCT USES DIFFERENT PARAMETER NAMES.
     It has no `screenTemperature`, no `windGustSpeed10m` and no
     `feelsLikeTemperature` — it publishes `maxScreenAirTemp` /
     `minScreenAirTemp`, `max10mWindGust`, `feelsLikeTemp` and a three-hour
     `totalPrecipAmount` instead. Everything below was written against the
     hourly names, so on days three onwards every temperature, gust and
     rain-rate came back null: the strip drew no curve, no numbers, and the day's
     max/min fell through to whatever the daily feed happened to carry. The
     entries are renamed onto the hourly shape here, once, so the rest of the
     transform stays name-agnostic. */
  const threeSeries = (threeHourlyApiData?.features?.[0]?.properties?.timeSeries || []).map(h => ({
    ...h,
    screenTemperature: h.screenTemperature
      ?? (h.maxScreenAirTemp != null && h.minScreenAirTemp != null
        ? (h.maxScreenAirTemp + h.minScreenAirTemp) / 2
        : (h.maxScreenAirTemp ?? h.minScreenAirTemp ?? null)),
    feelsLikeTemperature: h.feelsLikeTemperature ?? h.feelsLikeTemp ?? null,
    windGustSpeed10m: h.windGustSpeed10m ?? h.max10mWindGust ?? null,
    // Amount over the three hours -> a comparable mm/h rate.
    precipitationRate: h.precipitationRate
      ?? (h.totalPrecipAmount != null ? Math.round((h.totalPrecipAmount / 3) * 10) / 10 : null),
  }));

  /* Group each feed separately, on the UK calendar day rather than the UTC one
     (see ukDate), then choose per day.

     CHOOSING MATTERS. The hourly feed stops partway through a day — typically
     mid-afternoon on the third day. An earlier version let whichever feed
     reached a day first claim it outright, so that day was locked to hourly and
     every three-hourly entry after the cut-off was thrown away: the forecast
     simply ended at four in the afternoon and the rest of the day vanished.

     Each day now goes to whichever feed reaches FURTHEST into it. Today and
     tomorrow keep their hourly detail; the day hourly abandons halfway falls
     back to three-hourly, which covers all of it. One step per day, never a
     mixture — equal-width columns holding unequal time gaps would misread as a
     temperature curve. */
  const groupBy = (series) => {
    const out = {};
    series.forEach((h) => {
      const date = ukDate(h.time);
      (out[date] = out[date] || []).push(h);
    });
    return out;
  };
  const hourlyByDate = groupBy(timeSeries);
  const threeByDate = groupBy(threeSeries);

  const lastMs = (list) => (list?.length ? new Date(list[list.length - 1].time).getTime() : -Infinity);

  const byDate = {};
  const stepByDate = {};
  for (const date of new Set([...Object.keys(hourlyByDate), ...Object.keys(threeByDate)])) {
    const hourly = hourlyByDate[date];
    const three = threeByDate[date];
    const useHourly = lastMs(hourly) >= lastMs(three);
    byDate[date] = useHourly ? hourly : three;
    stepByDate[date] = useHourly ? 1 : 3;
  }

  const mph = (ms) => (ms != null ? Math.round(ms * 2.237) : null);

  const mapHours = (hours) => hours.map(h => {
    const hInfo = WEATHER_CODES[h.significantWeatherCode] || { desc: "Unknown", icon: "Cloudy" };
    return {
      time: h.time,
      iconKey: hInfo.icon,
      desc: hInfo.desc,
      temp: h.screenTemperature != null ? Math.round(h.screenTemperature) : null,
      rainChance: h.probOfPrecipitation ?? 0,
      windSpeed: mph(h.windSpeed10m),
      windGust: mph(h.windGustSpeed10m),
      windDirection: degToCompass(h.windDirectionFrom10m),
      // Degrees as well as the compass point: the arrow needs to be rotated,
      // and re-deriving an angle from "SSW" would throw away precision.
      windDirectionDeg: h.windDirectionFrom10m ?? null,
      humidity: h.screenRelativeHumidity != null ? Math.round(h.screenRelativeHumidity) : null,
      visibility: h.visibility,
      precipKind: precipKind(h.significantWeatherCode),
      // mm/h where the product provides it — the intensity, as distinct from
      // the chance, for the three-hour outlook.
      precipRate: h.precipitationRate ?? null,
    };
  });

  const dailySeries = dailyApiData?.features?.[0]?.properties?.timeSeries || [];


  /* Today in local terms. The daily feed can still carry yesterday, and without
     this filter it would take a slot in the seven — and, worse, sit at index 0
     where the page treats it as today. */
  const todayStr = ukDate(new Date());

  /* Day source, best first:
       1. the raw daily feed — a full week
       2. the server's own parsed day list — also from the daily feed, and the
          only option when an older backend is answering without rawDaily
       3. grouping the hourly feed — last resort, and only ever two or three
          days, because that is all the hourly product covers */
  let source;
  if (dailySeries.length) {
    source = dailySeries
      .map(d => ({ date: ukDate(d.time), daily: d }))
      .filter(d => d.date >= todayStr)
      .slice(0, 7);
  } else if (Array.isArray(serverForecast) && serverForecast.length) {
    source = serverForecast
      .filter(d => (d.date || '') >= todayStr)
      .slice(0, 7)
      .map(d => ({ date: d.date, daily: null, server: d }));
  } else {
    source = Object.keys(byDate).filter(d => d >= todayStr).slice(0, 7).map(date => ({ date, daily: null }));
  }

  const forecast = source.map(({ date, daily, server }) => {
    const hours = byDate[date] || [];
    const hourly = mapHours(hours);
    const stepHours = stepByDate[date] || 1;

    // Prefer the daily product's own max/min; fall back to the hours we hold.
    const temps = hours.map(h => h.screenTemperature).filter(t => t != null);
    const maxTemp = daily?.dayMaxScreenTemperature != null
      ? Math.round(daily.dayMaxScreenTemperature)
      : (server?.temperature?.max ?? (temps.length ? Math.round(Math.max(...temps)) : null));
    const minTemp = daily?.nightMinScreenTemperature != null
      ? Math.round(daily.nightMinScreenTemperature)
      : (server?.temperature?.min ?? (temps.length ? Math.round(Math.min(...temps)) : null));

    const midHour = hours[Math.floor(hours.length / 2)] || hours[0] || {};
    const code = daily?.daySignificantWeatherCode ?? midHour.significantWeatherCode;
    // "Cloudy", capitalised: the fallback has to be a real library key too, or
    // an unrecognised code silently loses both its symbol and its background.
    const codeInfo = WEATHER_CODES[code] || { desc: "Unknown", icon: "Cloudy" };

    const rainChance = daily?.dayProbabilityOfPrecipitation
      ?? (hours.length ? Math.max(...hours.map(h => h.probOfPrecipitation ?? 0)) : null);

    const firstHour = hours[0] || {};
    return {
      date,
      description: codeInfo.desc,
      iconKey: codeInfo.icon,
      temperature: { min: minTemp, max: maxTemp },
      feelsLike: firstHour.feelsLikeTemperature != null ? Math.round(firstHour.feelsLikeTemperature) : null,
      windSpeed: mph(daily?.midday10MWindSpeed ?? firstHour.windSpeed10m),
      windGust: mph(daily?.midday10MWindGust ?? firstHour.windGustSpeed10m),
      windDirection: degToCompass(daily?.midday10MWindDirection ?? firstHour.windDirectionFrom10m),
      rainChance,
      humidity: daily?.middayRelativeHumidity != null
        ? Math.round(daily.middayRelativeHumidity)
        : (firstHour.screenRelativeHumidity != null ? Math.round(firstHour.screenRelativeHumidity) : null),
      visibility: daily?.middayVisibility ?? firstHour.visibility,
      pressure: daily?.middayMslp != null ? Math.round(daily.middayMslp / 100)
        : (firstHour.mslp != null ? Math.round(firstHour.mslp / 100) : null),
      uvIndex: daily?.maxUvIndex ?? firstHour.uvIndex,
      hourly,
      // 1 or 3. The strip says which so a three-hourly day is not read as an
      // hourly one with most of its hours missing.
      stepHours,
    };
  });

  /* CURRENT CONDITIONS.

     The big number used to read `feelsLike` off the first hour of the day — so
     it was the wrong quantity taken at the wrong time, and at three in the
     afternoon it showed how midnight had felt. It is now the actual screen
     temperature from the hour the reader is actually in: the latest hour that
     has already started, since an hour stamped 14:00 covers 14:00 to 15:00. */
  const allHours = mapHours(timeSeries);
  const nowMs = Date.now();
  const started = allHours.filter(h => h.time && new Date(h.time).getTime() <= nowMs);
  const currentHour = started.length ? started[started.length - 1] : allHours[0] || null;

  const rawCurrent = currentHour
    ? timeSeries.find(h => h.time === currentHour.time)
    : null;

  const current = currentHour && {
    ...currentHour,
    feelsLike: rawCurrent?.feelsLikeTemperature != null
      ? Math.round(rawCurrent.feelsLikeTemperature) : null,
    pressure: rawCurrent?.mslp != null ? Math.round(rawCurrent.mslp / 100) : null,
  };

  const coords = apiData.features?.[0]?.geometry?.coordinates;
  return {
    location: {
      name: detectedName,
      lat: Array.isArray(coords) ? coords[1] : null,
      lon: Array.isArray(coords) ? coords[0] : null,
    },
    forecast,
    current,
  };
}

// ─── Background gradients by weather category ────────────────────────────────
/* Which of the four sky phases to draw.

   Taken from the LOCATION's own clock, not the browser's: the point of this
   page is somewhere that may not be where the reader is sitting. Only the first
   forecast day tracks the real hour — a Thursday three days out has no "now",
   so it is drawn at midday rather than inheriting tonight's darkness.

   Night is largely academic for the gradient because the icon key already
   carries it ("Clear Night" is night in every phase), but sunrise and sunset
   only exist here. */
function phaseFor(iconKey = "", isToday = true) {
  if (/ Night$/.test(iconKey)) return "night";
  if (!isToday) return "day";
  const h = new Date().getHours();
  if (h < 5 || h >= 21) return "night";
  if (h < 8) return "sunrise";
  if (h >= 18) return "sunset";
  return "day";
}

/** The shared sky config for an icon key, falling back to plain cloud. */
function skyFor(iconKey) {
  return SKY_CONFIGS[iconKey] || SKY_CONFIGS["Cloudy"];
}

// ─── Weather icon renderer ────────────────────────────────────────────────────
function WeatherIcon({ iconKey, className = "w-10 h-10" }) {
  const Icon = weatherIcons[iconKey] || CloudyIcon;
  return <span className="wx-symbol" style={{ display: "inline-flex" }}><Icon className={className} /></span>;
}

// ─── Helper utils ─────────────────────────────────────────────────────────────
function getVisLabel(m) {
  if (!m) return "—";
  if (m >= 40000) return "Excellent";
  if (m >= 10000) return "Good";
  if (m >= 4000)  return "Moderate";
  if (m >= 1000)  return "Poor";
  return "Very Poor";
}
function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}
function formatDay(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function formatFullDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// Stat pill component
function StatPill({ icon: Icon, label, value, sub }) {
  return (
    <div className="wx-chip flex flex-col items-center rounded-2xl px-3 py-3 min-w-[72px]">
      <Icon className="w-4 h-4 mb-1 opacity-70" />
      <span className="text-xs opacity-60 mb-0.5">{label}</span>
      <span className="font-semibold text-sm">{value}</span>
      {sub && <span className="text-xs opacity-50">{sub}</span>}
    </div>
  );
}

export default function LocationForecast() {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [unit, setUnit] = useState("C");
  // Set when a search resolves outside the UK, which opens the dialog below.
  const [outsideUK, setOutsideUK] = useState(null);

  // Recent searches are per signed-in reader; signed-out visitors persist
  // nothing. authChecked keeps the "sign in to remember" line from flashing at
  // somebody who is in fact signed in.
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [recent, setRecent] = useState([]);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  // Met Office warnings whose actual polygon contains this point.
  const [warnings, setWarnings] = useState([]);

  /* fetchWeather reads the user through a ref rather than closing over the
     state. Depending on it would change fetchWeather's identity the moment auth
     resolved, and the ?location= effect below lists fetchWeather as a
     dependency — so a shared link would fetch its forecast twice. */
  const userRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await currentUser();
      if (cancelled) return;
      setUser(me);
      userRef.current = me;
      setAuthChecked(true);
      if (me) {
        const list = await loadRecent(me);
        if (!cancelled) setRecent(list);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toF = c => Math.round(c * 9 / 5 + 32);
  const temp = c => (c == null ? "—" : unit === "C" ? `${Math.round(c)}°C` : `${toF(c)}°F`);
  const tempNum = c => (c == null ? "—" : unit === "C" ? Math.round(c) : toF(c));

  /* Everything Met Office goes through the backend function, so the API key
     exists only as a server environment variable and the browser never sees
     it. Geocoding is server-side too, so the UK check cannot be skipped. */
  const fetchWeather = useCallback(async (input) => {
    /* Accepts either a typed string or a chosen place. A place carries
       coordinates, and those are sent instead of the name: the suggestion list
       and the server's geocoder are different gazetteers, and there are seven
       UK villages called Dunston — resolving by name afterwards would be a coin
       toss between them. */
    const place = typeof input === 'string' ? { name: input } : (input || {});
    const name = (place.name || '').trim();
    const hasCoords = Number.isFinite(place.lat) && Number.isFinite(place.lon);
    if (!name && !hasCoords) return;

    setLoading(true);
    setError(null);
    setOutsideUK(null);
    setData(null);
    setSelectedDay(0);
    setGeoError('');
    /* One handler for both outcomes, because the SDK REJECTS on any non-2xx:
       the function's own JSON body (carrying `code` and a readable message)
       arrives on the thrown error, not on the resolved value. */
    const applyResult = (res) => {
      if (res?.code === 'OUTSIDE_UK') {
        setOutsideUK({ query: name, country: res.resolvedCountry, name: res.resolvedName });
        return;
      }
      if (res?.code === 'NO_API_KEY') {
        setError('The Met Office API key is not configured on the server. An admin needs to set MET_OFFICE_DATAHUB_API_KEY.');
        return;
      }
      if (res?.error) { setError(res.error); return; }
      if (!res?.rawHourly) { setError('No forecast data returned. Please try again shortly.'); return; }

      const resolvedName = res?.location?.name || name;
      setData(transformMetOfficeData(res.rawHourly, res.rawDaily, res.rawThreeHourly, resolvedName, res.forecast));

      // Only a search that actually produced a forecast is worth offering again.
      rememberSearch(userRef.current, {
        name: resolvedName,
        region: place.region || '',
        lat: place.lat ?? res?.location?.latitude ?? null,
        lon: place.lon ?? res?.location?.longitude ?? null,
      }).then((list) => { if (list) setRecent(list); });
    };

    try {
      const payload = hasCoords
        ? { location: name || undefined, latitude: place.lat, longitude: place.lon }
        : { location: name };
      const res = await base44.functions.invoke('getMetOfficeLocationWeather', payload);
      // The SDK resolves to an Axios-style response — the JSON body lives in .data.
      applyResult(res?.data ?? res);
    } catch (err) {
      const body = err?.response?.data ?? err?.data ?? null;
      if (body && (body.code || body.error)) applyResult(body);
      else setError(err?.message || 'Could not load the forecast. Please try again shortly.');
    }
    setLoading(false);
  }, []);

  /* Geolocation goes straight to coordinates, so there is no name to look up
     and nothing to spell wrong. The UK check still happens server-side. */
  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setGeoError('This browser cannot share a location.'); return; }
    setLocating(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        fetchWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setGeoError('Location unavailable — permission was declined or the request timed out.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [fetchWeather]);

  // Auto-fetch from URL param
  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search);
    const loc = params.get("location");
    if (loc) {
      setQuery(loc);
      fetchWeather(loc);
    }
  }, [routerLocation.search, fetchWeather]);

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchWeather(query);
  };

  /* Warnings follow the searched point. Cleared first so a new town never shows
     the previous one's warnings while its own are still loading. */
  const lat = data?.location?.lat;
  const lon = data?.location?.lon;
  useEffect(() => {
    let cancelled = false;
    setWarnings([]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    fetchAllWarningsForPoint(lat, lon).then(list => { if (!cancelled) setWarnings(list); });
    return () => { cancelled = true; };
  }, [lat, lon]);

  const forecast = data?.forecast ?? [];
  const locationName = data?.location?.name ?? "";
  const selectedDayData = forecast[selectedDay];
  const dayWarnings = warningsOnDay(warnings, selectedDayData?.date, ukDate);
  const current = data?.current;
  /* The live sky behind the whole page: same scene renderer and same gradient
     table the backgrounds library previews, so what was approved there is what
     ships here. It follows the SELECTED day, so scrubbing through the week
     changes the weather behind the numbers. */
  /* On the today tab the sky follows the CURRENT hour, not the day summary —
     the same `(selectedDay === 0 && current?.iconKey) || ...` the day header
     below already uses. A day summary never carries a " Night" suffix, so at
     half past seven in the evening the scene was reading "Sunny Intervals" at
     the sunset phase and drawing a low sun with rays, forty minutes after the
     sun had set and directly under a chip reading "Clear night". */
  const skyKey = (selectedDay === 0 && current?.iconKey) || selectedDayData?.iconKey || 'Cloudy';
  const sky = skyFor(skyKey);
  const skyPhase = phaseFor(skyKey, selectedDay === 0);
  const skyGradient = sky?.[skyPhase] || sky?.day;

  return (
    <div className="relative min-h-screen text-white font-sans">

      {/* Fixed so the sky stays put while the forecast scrolls over it — a
          background that scrolls away reads as a banner image. Pointer events
          off so it can never intercept a tap meant for the content. */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <WeatherScene name={skyKey} gradient={skyGradient} phase={skyPhase} />
        {sky?.particles && (
          <WeatherParticles type={sky.particles} count={sky.count} speed={sky.speed} />
        )}
        {/* Legibility wash. White text over a bright noon sky or a snow scene
            fails contrast badly; this darkens the sky without flattening it. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-black/45" />
      </div>

      <div className="relative">

      {/* Outside-the-UK dialog. The Met Office site-specific product only covers
          the UK, so a search for Paris has no forecast to show. */}
      <AnimatePresence>
        {outsideUK && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOutsideUK(null)}
            role="dialog" aria-modal="true" aria-labelledby="outside-uk-title"
          >
            <motion.div
              initial={{ scale: 0.92, y: 14 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/15 shadow-2xl p-6 text-center"
            >
              <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-400/15 border border-amber-400/40 flex items-center justify-center">
                <span className="text-2xl" aria-hidden="true">🇬🇧</span>
              </div>
              <h2 id="outside-uk-title" className="text-lg font-bold mb-2">
                Only towns and cities in the UK are available
              </h2>
              <p className="text-sm text-white/70 leading-relaxed">
                {outsideUK.country
                  ? <>&ldquo;{outsideUK.query}&rdquo; is in <b className="text-white/90">{outsideUK.country}</b>. This forecast uses Met Office UK data, so only UK locations can be shown.</>
                  : <>&ldquo;{outsideUK.query}&rdquo; is outside the UK. This forecast uses Met Office UK data, so only UK locations can be shown.</>}
              </p>
              <button
                onClick={() => setOutsideUK(null)}
                className="mt-5 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 font-semibold transition-colors"
                autoFocus
              >
                Search somewhere else
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Atmospheric orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Header */}
      <div className="relative z-10 bg-black/20 backdrop-blur-md border-b border-white/10 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="text-lg font-bold">Location Weather</h1>

            {/* Current conditions, top right. Stays put while you scrub
                through the week, so "what is it doing right now" never leaves
                the screen — the big figure below follows the selected day. */}
            {current && locationName && (
              <div className="ml-auto flex items-center gap-2 rounded-xl bg-white/10 border border-white/15 px-2.5 py-1.5">
                <WeatherIcon iconKey={current.iconKey} className="w-8 h-8 flex-shrink-0" />
                <div className="leading-tight text-right">
                  <div className="text-base font-bold">{temp(current.temp)}</div>
                  <div className="text-[10px] text-white/55 max-w-[110px] truncate" title={`${current.desc} at ${locationName}`}>
                    {current.desc}
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* The search bar only appears once there is something on screen to
              search past — on the landing state it lives in the hero instead,
              where it is the whole point rather than a strip along the top. */}
          {(data || loading || error || outsideUK) && (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <LocationSearchBox
                value={query}
                onChange={setQuery}
                onSearch={fetchWeather}
                loading={loading}
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="bg-white/20 hover:bg-white/30 disabled:bg-white/5 disabled:text-white/30 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors backdrop-blur-sm border border-white/20"
              >
                {loading ? "..." : "Search"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-6">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/20 border border-red-400/40 rounded-2xl p-4 text-red-200 mb-4"
          >
            ⚠️ {error}
          </motion.div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-14 h-14 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-white/60 text-lg">Fetching forecast...</p>
          </div>
        )}

        {!loading && !data && !error && (
          <LocationLanding
            query={query}
            onQueryChange={setQuery}
            onSearch={(place) => { if (place?.name) setQuery(place.name); fetchWeather(place); }}
            loading={loading}
            recent={recent}
            onForget={async (r) => { const list = await forgetSearch(user, r); if (list) setRecent(list); }}
            onClearAll={async () => { const list = await clearRecent(user); if (list) setRecent(list); }}
            user={user}
            authChecked={authChecked}
            onUseMyLocation={useMyLocation}
            locating={locating}
            geoError={geoError}
          />
        )}

        {!loading && data && forecast.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

            {/* ── MAIN CARD ── */}
            <motion.div
              layout
              className="wx-glass rounded-3xl overflow-hidden cursor-pointer select-none"
            >
              {/* Day selector tabs */}
              <div className="flex gap-1 p-3 overflow-x-auto border-b border-white/10" onClick={e => e.stopPropagation()}>
                {forecast.map((day, idx) => {
                  // Highest severity in force on that day, so the sign's colour
                  // is the worst thing expected rather than the first found.
                  const daySev = topSeverity(warningsOnDay(warnings, day.date, ukDate));
                  return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(idx)}
                    className={`relative flex-shrink-0 rounded-xl px-3 py-2 text-center transition-all min-w-[72px] border ${
                      selectedDay === idx
                        ? "bg-white/25 border-white/40 text-white"
                        : "bg-white/5 border-white/10 text-white/60 hover:bg-white/15"
                    }`}
                    style={daySev ? { borderColor: `${severityColour(daySev)}aa` } : undefined}
                    title={daySev ? `${daySev} weather warning` : undefined}
                  >
                    {daySev && (
                      <AlertTriangle
                        className="absolute top-1 right-1 w-3.5 h-3.5"
                        style={{ color: severityColour(daySev) }}
                        aria-label={`${daySev} weather warning`}
                      />
                    )}
                    <div className="text-[11px] font-medium">{formatDay(day.date)}</div>
                    <div className="flex justify-center my-1">
                      <WeatherIcon iconKey={day.iconKey} className="w-8 h-8" />
                    </div>
                    <div className="text-[11px]">
                      <span className="font-semibold">{tempNum(day.temperature?.max)}°</span>
                      <span className="opacity-40 mx-0.5">/</span>
                      <span className="text-blue-200">{tempNum(day.temperature?.min)}°</span>
                    </div>
                  </button>
                  );
                })}
              </div>

              {/* ── Hourly ──
                  Directly under the day selector and always on show. It used to
                  sit behind a "show hourly forecast" toggle below the day's
                  stats, which put the most useful thing on the page two
                  interactions and a scroll away from the day you had just
                  picked. */}
              <div className="border-b border-white/10 px-4 py-3" onClick={e => e.stopPropagation()}>
                {/* Warnings first — above the hourly detail, because a warning
                    outranks everything else on the page. */}
                <LocationWarnings warnings={dayWarnings} />

                <h3 className="text-sm font-semibold text-white/70 mb-3 uppercase tracking-wide">
                  {formatFullDate(selectedDayData?.date)} — Hour by hour
                </h3>
                {selectedDayData?.hourly?.length > 0 ? (
                  <>
                    {/* Only meaningful for today, and only when something is
                        actually expected — the panel hides itself otherwise. */}
                    {selectedDay === 0 && (
                      <PrecipOutlook hours={selectedDayData.hourly} formatTime={formatTime} />
                    )}
                    <HourlyStrip
                      hours={selectedDayData.hourly}
                      unit={unit}
                      formatTime={formatTime}
                      icon={WeatherIcon}
                      stepHours={selectedDayData.stepHours || 1}
                      warnings={dayWarnings}
                      /* Only today has a past to grey out. On any later day every
                         hour is still to come, so the cut-off is pinned before
                         the first of them. */
                      now={selectedDay === 0 ? undefined : 0}
                    />
                  </>
                ) : (
                  /* Days beyond the hourly product's ~48-hour reach have a daily
                     forecast but no hour-by-hour breakdown. Say which it is
                     rather than showing an empty chart. */
                  <p className="text-white/40 text-sm text-center py-4">
                    The Met Office publishes hour-by-hour detail about two days ahead.
                    This day only has its daily summary so far.
                  </p>
                )}
              </div>

              {/* Current conditions */}
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {/* On today, show what it is doing NOW rather than the
                        day's overall character. */}
                    <WeatherIcon
                      iconKey={(selectedDay === 0 && current?.iconKey) || selectedDayData?.iconKey}
                      className="w-16 h-16 flex-shrink-0" />
                    <div>
                      <p className="text-2xl font-bold leading-tight">{locationName}</p>
                      <p className="text-white/60 text-sm">
                        {(selectedDay === 0 && current?.desc) || selectedDayData?.description}
                      </p>
                      <p className="text-white/40 text-xs mt-0.5">{formatFullDate(selectedDayData?.date)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {/* The actual temperature at the current hour. This used to
                        read feelsLike off the FIRST hour of the day, which is
                        both the wrong quantity and the wrong time — at 3pm it
                        reported how midnight had felt. */}
                    <div className="text-5xl font-thin">
                      {selectedDay === 0 && current?.temp != null
                        ? temp(current.temp)
                        : temp(selectedDayData?.temperature?.max)}
                    </div>
                    {selectedDay === 0 && current?.feelsLike != null && (
                      <div className="text-white/60 text-sm">Feels {temp(current.feelsLike)}</div>
                    )}
                    {/* High first, then low — the way a forecast is read out. */}
                    <div className="text-white/60 text-sm">
                      <span className="font-semibold">{tempNum(selectedDayData?.temperature?.max)}°</span>
                      <span className="opacity-40 mx-1">–</span>
                      <span className="text-blue-200">{tempNum(selectedDayData?.temperature?.min)}°</span>
                    </div>
                    <div className="flex gap-1 mt-1 justify-end">
                      <button onClick={e => { e.stopPropagation(); setUnit("C"); }} className={`px-2 py-0.5 rounded text-xs font-medium ${unit === "C" ? "bg-white/30" : "bg-white/10 hover:bg-white/20"}`}>°C</button>
                      <button onClick={e => { e.stopPropagation(); setUnit("F"); }} className={`px-2 py-0.5 rounded text-xs font-medium ${unit === "F" ? "bg-white/30" : "bg-white/10 hover:bg-white/20"}`}>°F</button>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <StatPill icon={Wind} label="Wind" value={`${selectedDayData?.windSpeed ?? "—"} mph`} sub={selectedDayData?.windDirection} />
                  <StatPill icon={Wind} label="Gusts" value={`${selectedDayData?.windGust ?? "—"} mph`} />
                  <StatPill icon={Droplets} label="Rain%" value={`${selectedDayData?.rainChance ?? "—"}%`} />
                  {selectedDayData?.humidity != null && (
                    <StatPill icon={Droplets} label="Humid" value={`${selectedDayData.humidity}%`} />
                  )}
                  {selectedDayData?.visibility != null && (
                    <StatPill icon={Eye} label="Vis" value={getVisLabel(selectedDayData.visibility)} />
                  )}
                  {selectedDayData?.pressure != null && (
                    <StatPill icon={Gauge} label="Pressure" value={`${selectedDayData.pressure}`} sub="hPa" />
                  )}
                  {selectedDayData?.uvIndex != null && (
                    <StatPill icon={Sun} label="UV" value={selectedDayData.uvIndex} />
                  )}
                </div>

              </div>

              {/* Radar for the searched point, not the whole country. */}
              <LocationRadar lat={data?.location?.lat} lon={data?.location?.lon} name={locationName} />
            </motion.div>

            {/* ── DAILY SUMMARY ── */}
            <div className="wx-glass rounded-3xl p-4">
              <h2 className="font-semibold text-white/70 mb-3 text-xs uppercase tracking-widest">
                {forecast.length}-Day Forecast
              </h2>
              <div className="space-y-1">
                {forecast.map((day, idx) => {
                  const precipBar = Math.min(100, day.rainChance ?? 0);
                  return (
                    <button
                      key={idx}
                      onClick={() => { setSelectedDay(idx); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className={`w-full flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors ${selectedDay === idx ? "bg-white/15" : "hover:bg-white/10"}`}
                    >
                      <div className="w-16 text-sm text-white/70 text-left flex-shrink-0">{formatDay(day.date)}</div>
                      <div className="flex-shrink-0">
                        <WeatherIcon iconKey={day.iconKey} className="w-8 h-8" />
                      </div>
                      <div className="text-xs text-white/40 w-24 flex-shrink-0 truncate text-left hidden sm:block">{day.description}</div>
                      <div className="flex-1 bg-white/10 rounded-full h-1.5">
                        <div className="bg-blue-400 h-1.5 rounded-full" style={{ width: `${precipBar}%` }} />
                      </div>
                      <div className="text-xs text-blue-300 w-8 text-right flex-shrink-0">{day.rainChance ?? 0}%</div>
                      <div className="text-sm w-20 text-right flex-shrink-0">
                        <span className="text-blue-300">{tempNum(day.temperature?.min)}°</span>
                        <span className="text-white/30 mx-1">–</span>
                        <span className="text-white font-semibold">{tempNum(day.temperature?.max)}°</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-center text-white/30 text-xs pb-2">
              Powered by Met Office DataHub · Data updated hourly
            </p>
          </motion.div>
        )}
      </div>
      </div>
    </div>
  );
}