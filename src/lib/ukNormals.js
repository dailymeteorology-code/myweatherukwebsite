/* ════════════════════════════════════════════════════════════════════════════
   ukNormals — hardcoded UK monthly averages.

   These are baked in deliberately: the graphic must never fetch anything except
   the single month the user asked for. No 30-year build, no baseline cache, no
   server job.

   ─── PROVENANCE AND ACCURACY ───────────────────────────────────────────────
   TEMPERATURE and SUNSHINE below are the user-supplied figures, and they were
   checked against the Met Office National Climate Information Centre areal
   series (HadUK-Grid, 1991-2020, UK). They agree to a mean absolute difference
   of 0.1 °C and 2.0 hours respectively — i.e. they ARE the official numbers.

   RAINFALL was checked the same way and does not agree: mean absolute
   difference 23.7 mm, annual total 879 mm against the UK's 1163 mm. The list is
   internally inconsistent — November (123) and December (127) match the UK
   series exactly, while January-October sit far below it, and July/August
   (45/43 mm) are drier than any Met Office region including East Anglia. Baked
   in unchanged, August would read ~180% of average every year.

   So RAIN_SOURCE selects which rainfall series is used. It defaults to the
   official Met Office UK figures; flip it to 'user' to use the supplied list.
   ════════════════════════════════════════════════════════════════════════════ */

export const NORMALS_PERIOD = '1991–2020';

/** 'metoffice' (verified UK series) or 'user' (the supplied list). */
export const RAIN_SOURCE = 'metoffice';

const RAIN_METOFFICE = [121.5, 96.2, 85.1, 71.7, 71.0, 77.2, 82.5, 93.8, 90.9, 122.5, 123.3, 127.2];
const RAIN_USER      = [99, 81, 78, 59, 52, 52, 45, 43, 53, 67, 123, 127];

/* Jan..Dec. rain mm, temp °C, sun hours.

   tmax / tmin / rainDays / airFrost were computed the same way as the rainfall
   series above — averaging every year 1991-2020 of the Met Office areal series
   (Tmax, Tmin, Raindays1mm, AirFrost). All four had a complete 30-year record,
   so these are full normals with no gaps. Spot-check: UK July = 19.6 °C max /
   11.0 °C min / 12.3 rain days / 0 frost days.

   rainDays counts days with at least 1 mm, which is the Met Office definition
   and the one the tool reproduces by counting daily precipitation_sum >= 1. */
export const UK_NORMALS = {
  rain: RAIN_SOURCE === 'user' ? RAIN_USER : RAIN_METOFFICE,
  temp: [4.0, 4.1, 5.5, 7.6, 10.4, 13.3, 15.3, 15.1, 12.9, 9.7, 6.5, 4.2],
  sun:  [47, 70, 110, 151, 192, 181, 173, 159, 125, 93, 58, 43],
  tmax: [6.7, 7.2, 9.2, 12.0, 15.1, 17.7, 19.6, 19.3, 16.9, 13.1, 9.4, 7.0],
  tmin: [1.2, 1.1, 2.2, 3.8, 6.3, 9.1, 11.0, 11.0, 9.0, 6.4, 3.6, 1.4],
  rainDays: [15.4, 13.2, 12.7, 11.6, 11.2, 11.5, 12.3, 12.9, 12.1, 14.8, 15.8, 15.6],
  airFrost: [11.3, 10.7, 7.8, 4.0, 1.2, 0.1, 0, 0, 0.1, 1.6, 5.5, 10.9],
};

/* Cloud: the supplied figures are CLOUDY HOURS split into daylight and night,
   which is a different quantity from mean cloud cover. Converted here to the
   share of the month's hours that were cloudy, which is the closest comparable
   figure, but note it still is not the same metric as ERA5's areal cloud_cover
   fraction — so it is reported as context rather than used for an anomaly. */
const CLOUD_HOURS = [
  { day: 213, night: 484 }, { day: 210, night: 392 }, { day: 258, night: 376 },
  { day: 266, night: 303 }, { day: 293, night: 259 }, { day: 319, night: 220 },
  { day: 325, night: 246 }, { day: 293, night: 292 }, { day: 255, night: 340 },
  { day: 236, night: 415 }, { day: 207, night: 455 }, { day: 198, night: 503 },
];
const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const CLOUD_NORMALS = CLOUD_HOURS.map((c, i) => ({
  ...c,
  totalHours: c.day + c.night,
  pctOfMonth: +(100 * (c.day + c.night) / (DAYS_IN_MONTH[i] * 24)).toFixed(1),
}));

/* ── Wind and pressure normals ───────────────────────────────────────────
   Computed once from ERA5, 1991-2020, over six UK land points (Devon, Midlands,
   Cumbria, Highlands, mid-Wales, Northern Ireland). Pressure and prevailing wind
   are both spatially smooth over an area this size, so a handful of points gives
   a solid national normal in one request — no per-grid-point series needed, and
   nothing is fetched at runtime.

   Directions are circular (vector) means of the daily dominant direction, never
   an arithmetic mean of angles. `steadiness` is the resultant length: 1 = every
   day from the same quarter, near 0 = no prevailing direction. It bottoms out in
   April/May (0.15 / 0.10 — the classic variable spring) and peaks in midwinter
   and high summer.

   These confirm the supplied qualitative list: pressure peaks in May/June and
   bottoms out in November, and the prevailing wind is SW/WSW every month. The
   one disagreement is September, supplied as "Low" but measuring 1014.7 hPa —
   above the annual mean. The descriptors below follow the measured values. */
export const PRESSURE_NORMALS_HPA = [
  1012.7, 1013.7, 1014.2, 1013.7, 1015.5, 1015.5,
  1014.4, 1014.0, 1014.7, 1011.8, 1010.5, 1012.3,
];

export const WIND_NORMALS = [
  { deg: 220, cardinal: 'SW',  steadiness: 0.43 },
  { deg: 228, cardinal: 'SW',  steadiness: 0.39 },
  { deg: 230, cardinal: 'SW',  steadiness: 0.30 },
  { deg: 225, cardinal: 'SW',  steadiness: 0.15 },
  { deg: 237, cardinal: 'WSW', steadiness: 0.10 },
  { deg: 249, cardinal: 'WSW', steadiness: 0.26 },
  { deg: 244, cardinal: 'WSW', steadiness: 0.41 },
  { deg: 240, cardinal: 'WSW', steadiness: 0.41 },
  { deg: 229, cardinal: 'SW',  steadiness: 0.30 },
  { deg: 213, cardinal: 'SSW', steadiness: 0.31 },
  { deg: 224, cardinal: 'SW',  steadiness: 0.38 },
  { deg: 221, cardinal: 'SW',  steadiness: 0.41 },
];

/* Mean 10 m wind speed, mph, from the same six-point ERA5 sample as the
   pressure and direction normals above. Windiest in January (10.4) and calmest
   in July (7.8) — the expected UK seasonal cycle, which is a useful sanity
   check that the sample is behaving. */
export const WIND_SPEED_NORMALS_MPH = [
  10.4, 10.2, 9.7, 8.8, 8.5, 8.0,
  7.8, 7.9, 8.4, 9.4, 9.5, 9.9,
];

/** Back-compat single figure — the year-round UK prevailing wind. */
export const WIND_NORMAL = { deg: 231, cardinal: 'SW' };

/** Pressure character, Jan..Dec, derived from PRESSURE_NORMALS_HPA. */
export const PRESSURE_NORMALS = PRESSURE_NORMALS_HPA.map((p) => {
  const mean = 1013.6;                     // annual mean of the twelve values
  if (p >= mean + 0.7) return 'High';
  if (p <= mean - 1.0) return 'Low';
  return 'Neutral / volatile';
});

/* ── ERA5 -> observation calibration ───────────────────────────────────────
   The month plotted on the map is ERA5 reanalysis; the normals above are
   surface observations. For temperature, rainfall and rain days the two are
   measuring the same quantity and can be compared directly (temperature agrees
   closely: ERA5 - observed = -0.1 °C over 2024, land points only).

   SUNSHINE and CLOUD cannot be. ERA5 sunshine_duration is a radiation-threshold
   calculation while the observed normal is the WMO bright-sunshine standard,
   and ERA5 cloud_cover_mean is an areal cloud fraction while the normal below
   is the share of the month's hours that were cloudy. Different quantities, not
   the same one scaled.

   A single divisor (ERA5_CALIBRATION.sun = 1.85) used to sit here to hide the
   sunshine gap. It came from one year of sampling whose ratio ranged 174-196%
   month to month, so it was wrong in every month by a different amount — it is
   what made a 149%-of-average July report 114%. It has been removed. Those two
   variables now measure their own 1991-2020 normal from ERA5, so both sides of
   the ratio come from one source: see lib/era5Normals.js. */

/**
 * Observational normal for a variable, or null where no comparable one exists.
 *
 * `cloud` deliberately returns null: the cloudy-hours figure above is not the
 * same quantity as ERA5's areal cloud fraction, and returning it here is what
 * gave the cloud map a standing offset. lib/era5Normals.js supplies the
 * comparable figure; CLOUD_NORMALS stays exported as printed context.
 */
export function normalFor(varId, month /* 1-12 */) {
  if (varId === 'cloud') return null;
  if (varId === 'pressure') return PRESSURE_NORMALS_HPA[month - 1] ?? null;
  if (varId === 'wind') return WIND_NORMALS[month - 1]?.deg ?? null;
  if (varId === 'windSpeed') return WIND_SPEED_NORMALS_MPH[month - 1] ?? null;
  return UK_NORMALS[varId]?.[month - 1] ?? null;
}

/* ── Day-of-year normals ────────────────────────────────────────────────
   Comparing a single day against a normal needs a normal for THAT day, not for
   its whole month — otherwise 1 March and 31 March get the same reference even
   though the real climate has moved a long way between them. These interpolate
   between adjacent monthly values, anchored at each month's mid-point.

   The unit conversion matters and is easy to get wrong. Temperature, cloud and
   pressure normals are already daily means, so they interpolate directly. But
   rainfall, sunshine and rain-days normals are monthly TOTALS — comparing one
   day's 4 mm against a monthly 82.5 mm would report a 95% deficit every single
   day. Those are converted to a per-day rate first. */

const MONTH_LEN = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day-of-year (0-based) of each month's mid-point. */
const MONTH_MID = (() => {
  const mids = []; let cum = 0;
  for (let m = 0; m < 12; m++) { mids.push(cum + MONTH_LEN[m] / 2); cum += MONTH_LEN[m]; }
  return mids;
})();
const YEAR_LEN = MONTH_LEN.reduce((a, b) => a + b, 0);

/** Normals that are monthly totals rather than daily means. */
const TOTAL_VARS = new Set(['rain', 'sun', 'rainDays', 'airFrost']);

/**
 * Normal for a single calendar day, interpolated between monthly values.
 * Returns the same unit the day's measurement is in: a daily mean for
 * temperature/cloud/pressure, a per-day rate for rainfall/sunshine.
 */
export function dayNormal(varId, date, monthlyOverride = null) {
  const d = date instanceof Date ? date : new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
             - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;

  /* Monthly value in the day's own units. `monthlyOverride` carries the twelve
     ERA5-measured figures for variables with no comparable observational normal
     (sunshine, cloud); without it those fall through to null and the forecast
     map would render nothing with no explanation. */
  const at = (m) => {
    const v = monthlyOverride ? (monthlyOverride[m] ?? null) : normalFor(varId, m + 1);
    if (v == null) return null;
    return TOTAL_VARS.has(varId) ? v / MONTH_LEN[m] : v;
  };

  // Bracketing months, wrapping across the year boundary in both directions.
  let lo = 11, hi = 0;
  for (let m = 0; m < 12; m++) if (MONTH_MID[m] <= doy) lo = m;
  hi = (lo + 1) % 12;
  let a = MONTH_MID[lo], b = MONTH_MID[hi];
  if (doy < MONTH_MID[0]) { lo = 11; hi = 0; a = MONTH_MID[11] - YEAR_LEN; b = MONTH_MID[0]; }
  else if (b < a) b += YEAR_LEN;

  const v0 = at(lo), v1 = at(hi);
  if (v0 == null || v1 == null) return null;
  const t = b === a ? 0 : (doy - a) / (b - a);
  return v0 + (v1 - v0) * t;
}

/** Smallest signed angle from a to b, in degrees (-180..180]. */
export function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}


