/* ════════════════════════════════════════════════════════════════════════════
   era5Normals — 1991-2020 normals measured from ERA5 itself.

   WHY THIS EXISTS
   ---------------
   Most variables compare fine against the Met Office observational normals in
   lib/ukNormals.js, because ERA5 and the observations are measuring the same
   quantity. Two are not:

     sunshine  ERA5 sunshine_duration is a radiation-threshold calculation; the
               observed normal is the WMO bright-sunshine standard. ERA5 runs
               roughly 1.4-1.9x the observed figure, and by a different amount
               in every month.
     cloud     ERA5 cloud_cover_mean is an areal cloud FRACTION. The supplied
               normal is the share of the month's hours that were "cloudy" —
               a different quantity, not the same one scaled.

   A single hardcoded divisor (ERA5_CALIBRATION.sun = 1.85) used to paper over
   the sunshine gap. It came from one year of sampling whose ratio actually
   ranged 174-196% across the months, so it was wrong in every month by a
   different amount — it was the reason a 149%-of-average month reported 114%.
   Measuring the normal from the same source as the data removes the need for
   any factor at all.

   COST
   ----
   ONE request per variable, ever: one location, one variable, 1991-2020 daily.
   A normal month load asks for 245 locations, so this is a fraction of one.
   The result is written to localStorage and reused from then on; nothing is
   re-fetched unless the cache is cleared.

   REFERENCE POINT
   ---------------
   54.7584 N, 2.6953 W — the UK centroid, and the point the reference archive
   URL uses, so a figure here can be checked by hand against that URL.

   This is a SINGLE-POINT normal, not an area-weighted one. That makes it
   definitionally like-for-like with the plotted data, which is the bug it
   exists to fix, but it is not the spatial mean of the 245-point land grid the
   headline averages over. Sunshine and cloud both vary smoothly enough over
   the UK for the centroid to be a fair reference, and a definitional error of
   40-90% is the one worth removing first.
   ════════════════════════════════════════════════════════════════════════════ */

export const ERA5_NORMAL_POINT  = { lat: 54.7584, lon: -2.6953 };
export const ERA5_NORMAL_PERIOD = { start: 1991, end: 2020 };
export const ERA5_NORMAL_LABEL  = `${ERA5_NORMAL_PERIOD.start}–${ERA5_NORMAL_PERIOD.end}`;

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const TZ = 'Europe/London';

/* Variables whose observational normal is not comparable with ERA5, and how
   each rolls a daily series up to one monthly figure. `agg` and `scale` match
   the CLIMATE_VARS entries in lib/climateAnomaly.js exactly — if they ever
   drift apart the normal stops describing the same quantity as the month. */
const ERA5_NORMAL_FIELDS = {
  sun:   { daily: 'sunshine_duration', agg: 'sum',  scale: 1 / 3600 },
  cloud: { daily: 'cloud_cover_mean',  agg: 'mean', scale: 1 },
};

/** Does this variable need an ERA5-measured normal rather than the observed one? */
export function needsEra5Normal(varId) {
  return !!ERA5_NORMAL_FIELDS[varId];
}

const cacheKey = (varId) => {
  const { lat, lon } = ERA5_NORMAL_POINT;
  const { start, end } = ERA5_NORMAL_PERIOD;
  // The point and the period are part of the key: change either and the cached
  // figures describe something else, so they must miss rather than be reused.
  return `era5_normal_v1_${varId}_${lat}_${lon}_${start}_${end}`;
};

/** The cached normal for a variable, or null if it has never been measured. */
export function readEra5Normal(varId) {
  try {
    const raw = localStorage.getItem(cacheKey(varId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v?.monthly) && v.monthly.length === 12 ? v : null;
  } catch { return null; }
}

export function clearEra5Normal(varId) {
  try { localStorage.removeItem(cacheKey(varId)); } catch { /* noop */ }
}

/**
 * Measure a variable's 1991-2020 monthly normal from ERA5 and cache it.
 *
 * Returns { monthly: number[12], years: number[12], measuredAt } — `years`
 * counts how many of the 30 years actually contributed to each month, so a
 * short or gappy record shows up rather than quietly biasing the mean.
 */
export async function fetchEra5Normal(varId, { signal } = {}) {
  const spec = ERA5_NORMAL_FIELDS[varId];
  if (!spec) throw new Error(`${varId} has no ERA5 normal — use the observational one.`);

  const { lat, lon } = ERA5_NORMAL_POINT;
  const { start, end } = ERA5_NORMAL_PERIOD;
  const url = `${ARCHIVE}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}-01-01&end_date=${end}-12-31` +
    `&daily=${spec.daily}&timezone=${encodeURIComponent(TZ)}`;

  const r = await fetch(url, { signal });
  if (!r.ok) {
    let reason = '';
    try { reason = (await r.json())?.reason || ''; } catch { /* non-JSON body */ }
    if (r.status === 429) {
      throw new Error(reason ||
        'Open-Meteo is rate-limiting this browser. The normal is measured once and then kept forever — try again later.');
    }
    throw new Error(`archive ${r.status}${reason ? ` — ${reason}` : ''}`);
  }

  const j = await r.json();
  const times = j?.daily?.time;
  const vals  = j?.daily?.[spec.daily];
  if (!Array.isArray(times) || !Array.isArray(vals)) throw new Error('archive returned no daily series');

  // Daily -> one figure per calendar month of each year.
  const byMonth = new Map();                       // 'YYYY-MM' -> [sum, count]
  for (let i = 0; i < times.length; i++) {
    const v = vals[i];
    if (v == null || Number.isNaN(v)) continue;
    const k = times[i].slice(0, 7);
    const cur = byMonth.get(k) || [0, 0];
    cur[0] += v; cur[1] += 1;
    byMonth.set(k, cur);
  }

  // Then the mean across the 30 years, month by month.
  const acc = Array.from({ length: 12 }, () => [0, 0]);
  for (const [k, [sum, n]] of byMonth) {
    if (!n) continue;
    const m = Number(k.slice(5, 7)) - 1;
    const monthly = (spec.agg === 'mean' ? sum / n : sum) * spec.scale;
    acc[m][0] += monthly; acc[m][1] += 1;
  }

  const monthly = acc.map(([sum, n]) => (n ? +(sum / n).toFixed(3) : null));
  const years   = acc.map(([, n]) => n);
  if (monthly.some(v => v == null)) throw new Error('ERA5 record has a month with no data');

  const payload = { monthly, years, measuredAt: Date.now(), point: ERA5_NORMAL_POINT };
  try { localStorage.setItem(cacheKey(varId), JSON.stringify(payload)); } catch { /* quota */ }
  return payload;
}
