/* Open-Meteo UKMO Global Deterministic 10 km — raw model data.

   One place for the variable list and the fetch, so the page stays presentation
   only. The variable order here IS the column order on the page. */

export const MODEL_ID = 'ukmo_global_deterministic_10km';
export const MODEL_LABEL = 'UKMO Global Deterministic 10 km';

export const MODEL_VARIABLES = [
  { key: 'temperature_2m',        label: 'Temp 2m',        unit: '°C',   dp: 1, group: 'Temperature' },
  { key: 'dew_point_2m',          label: 'Dew point 2m',   unit: '°C',   dp: 1, group: 'Temperature' },
  { key: 'precipitation',         label: 'Precipitation',  unit: 'mm',   dp: 1, group: 'Precipitation' },
  { key: 'showers',               label: 'Showers',        unit: 'mm',   dp: 1, group: 'Precipitation' },
  { key: 'rain',                  label: 'Rain',           unit: 'mm',   dp: 1, group: 'Precipitation' },
  { key: 'snowfall',              label: 'Snowfall',       unit: 'cm',   dp: 1, group: 'Precipitation' },
  { key: 'hail',                  label: 'Hail',           unit: 'mm',   dp: 1, group: 'Precipitation' },
  { key: 'weather_code',          label: 'Weather code',   unit: '',     dp: 0, group: 'Conditions' },
  { key: 'visibility',            label: 'Visibility',     unit: 'm',    dp: 0, group: 'Conditions' },
  { key: 'pressure_msl',          label: 'MSLP',           unit: 'hPa',  dp: 1, group: 'Pressure' },
  { key: 'surface_pressure',      label: 'Surface pres.',  unit: 'hPa',  dp: 1, group: 'Pressure' },
  { key: 'cloud_cover',           label: 'Cloud total',    unit: '%',    dp: 0, group: 'Cloud' },
  { key: 'cloud_cover_low',       label: 'Cloud low',      unit: '%',    dp: 0, group: 'Cloud' },
  { key: 'cloud_cover_mid',       label: 'Cloud mid',      unit: '%',    dp: 0, group: 'Cloud' },
  { key: 'cloud_cover_high',      label: 'Cloud high',     unit: '%',    dp: 0, group: 'Cloud' },
  { key: 'cloud_cover_2m',        label: 'Cloud 2m',       unit: '%',    dp: 0, group: 'Cloud' },
  { key: 'wind_speed_10m',        label: 'Wind 10m',       unit: 'mph',  dp: 0, group: 'Wind' },
  { key: 'wind_direction_10m',    label: 'Wind dir 10m',   unit: '°',    dp: 0, group: 'Wind' },
  { key: 'wind_gusts_10m',        label: 'Gusts 10m',      unit: 'mph',  dp: 0, group: 'Wind' },
  { key: 'is_day',                label: 'Is day',         unit: '',     dp: 0, group: 'Conditions' },
  { key: 'cape',                  label: 'CAPE',           unit: 'J/kg', dp: 0, group: 'Convective' },
  { key: 'convective_inhibition', label: 'CIN',            unit: 'J/kg', dp: 0, group: 'Convective' },
];

export const MODEL_GROUPS = ['Temperature', 'Precipitation', 'Conditions', 'Pressure', 'Cloud', 'Wind', 'Convective'];

/** Hourly model data for one point, as returned by Open-Meteo. */
export async function fetchModelData({ latitude, longitude, days = 5 }) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${latitude}&longitude=${longitude}`
    + `&hourly=${MODEL_VARIABLES.map(v => v.key).join(',')}`
    + `&models=${MODEL_ID}`
    + '&timezone=Europe%2FLondon'
    + `&forecast_days=${days}`
    + '&wind_speed_unit=mph';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const json = await res.json();
  if (!json?.hourly?.time?.length) throw new Error('No hourly data returned for this point.');
  return json;
}

/** Group the flat hourly arrays into one row object per hour, split by day. */
export function toDays(hourly) {
  const byDate = new Map();
  hourly.time.forEach((t, i) => {
    const date = t.split('T')[0];
    const row = { time: t, hour: t.split('T')[1]?.slice(0, 5) };
    MODEL_VARIABLES.forEach(v => { row[v.key] = hourly[v.key]?.[i] ?? null; });
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  });
  return [...byDate.entries()].map(([date, rows]) => ({ date, rows }));
}

export function formatValue(value, v) {
  if (value === null || value === undefined) return '—';
  if (v.key === 'is_day') return value ? 'Day' : 'Night';
  return Number(value).toFixed(v.dp);
}