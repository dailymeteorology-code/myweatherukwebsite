/**
 * The weather right now in the home page's cities outside the UK, from the Met Office's own
 * global model through DataHub site-specific (the key is in .env and never reaches the browser).
 * The UK cities read the UKV analysis instead (/api/location/now).
 *
 * THE QUOTA DECIDES THE SHAPE OF THIS. Site-specific is one call per place, and the allowance is a
 * few hundred calls a day shared with the eclipse tool; spend it and DataHub answers 403 to
 * everything. One `hourly` call returns about 48 hours of steps, so a place is fetched at most
 * every three hours and the card reads the step covering now from the series it already holds:
 * eleven places is about 88 calls a day, however many people open the page. The series are kept
 * on disk, so restarting the server costs nothing. A 401, 403 or 429 stops all calls for an hour,
 * and the series in hand keep serving.
 *
 * GET /api/world-conditions -> { source, cities: [{ id, name, ok, valid, ...the hour }] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODELDATA_DIR } from './modelData.js';

const KEY_VARS = ['MET_OFFICE_SITESPECIFIC_API_KEY', 'MET_OFFICE_DATAHUB_API_KEY'];
const POINT = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly';
const REFRESH_MS = 3 * 3600e3;
const BACKOFF_MS = 3600e3;
const STORE = path.join(path.dirname(MODELDATA_DIR), 'world-conditions.json');

/* The cities, here rather than taken from the request, so no visitor can make the server spend
   the allowance on places of their choosing. The page has the same list, by id. */
export const WORLD_CITIES = [
  { id: 'dublin', name: 'Dublin', lat: 53.3498, lon: -6.2603 },
  { id: 'paris', name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { id: 'berlin', name: 'Berlin', lat: 52.52, lon: 13.405 },
  { id: 'madrid', name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { id: 'rome', name: 'Rome', lat: 41.9028, lon: 12.4964 },
  { id: 'amsterdam', name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { id: 'newyork', name: 'New York', lat: 40.7128, lon: -74.006 },
  { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { id: 'sydney', name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { id: 'dubai', name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { id: 'capetown', name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
];

const apiKey = () => KEY_VARS.map((v) => process.env[v]).find(Boolean) || null;

/* id -> { at, series } */
let held = {};
try { held = JSON.parse(fs.readFileSync(STORE, 'utf8')) || {}; } catch { held = {}; }
let pausedUntil = 0;
let running = null;

function save() {
  const tmp = `${STORE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(held));
    fs.renameSync(tmp, STORE);
  } catch {
    try { fs.writeFileSync(STORE, JSON.stringify(held)); } catch { /* the next refresh tries again */ }
    try { fs.unlinkSync(tmp); } catch { /* gone */ }
  }
}

/* only the fields a card shows: a 48-hour series of these is small enough to keep for every city */
const KEEP = ['time', 'screenTemperature', 'feelsLikeTemperature', 'screenRelativeHumidity', 'windSpeed10m', 'windGustSpeed10m',
  'windDirectionFrom10m', 'significantWeatherCode', 'precipitationRate', 'probOfPrecipitation', 'visibility', 'uvIndex'];

async function fetchCity(key, c) {
  const url = `${POINT}?datasource=BD1&latitude=${c.lat}&longitude=${c.lon}&excludeParameterMetadata=true&includeLocationName=false`;
  const res = await fetch(url, { headers: { apikey: key, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    /* 403 is the allowance, 401 the key; never log the body, it can echo the credential */
    pausedUntil = Date.now() + BACKOFF_MS;
    console.warn(`[world-conditions] DataHub ${res.status}: pausing calls for an hour`);
    return false;
  }
  if (!res.ok) { console.warn(`[world-conditions] ${c.id}: HTTP ${res.status}`); return true; }
  const j = await res.json();
  const series = j?.features?.[0]?.properties?.timeSeries;
  if (Array.isArray(series) && series.length) {
    held[c.id] = { at: Date.now(), series: series.map((s) => Object.fromEntries(KEEP.filter((k) => s[k] != null).map((k) => [k, s[k]]))) };
  }
  return true;
}

/* one refresh at a time, one city at a time, only the stale ones */
function refresh() {
  if (running) return running;
  const key = apiKey();
  if (!key || Date.now() < pausedUntil) return Promise.resolve();
  const stale = WORLD_CITIES.filter((c) => !held[c.id] || Date.now() - held[c.id].at > REFRESH_MS);
  if (!stale.length) return Promise.resolve();
  running = (async () => {
    try {
      for (const c of stale) {
        if (Date.now() < pausedUntil) break;
        try { if (!(await fetchCity(key, c))) break; } catch (e) { console.warn(`[world-conditions] ${c.id}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`); }
      }
      save();
    } finally { running = null; }
  })();
  return running;
}

/* the step covering now: the latest at or before it (steps are on the hour) */
function current(series) {
  const now = Date.now();
  let step = null;
  for (const s of series || []) {
    const t = Date.parse(s.time);
    if (!Number.isFinite(t)) continue;
    if (t <= now) step = s; else break;
  }
  if (!step || now - Date.parse(step.time) > 2 * 3600e3) return null;   // the series has run out
  const mph = (ms) => (ms == null ? null : Math.round(ms * 2.2369362920544 * 10) / 10);
  return {
    valid: step.time,
    temp: step.screenTemperature ?? null,
    feels: step.feelsLikeTemperature ?? null,
    rh: step.screenRelativeHumidity ?? null,
    wind: mph(step.windSpeed10m),
    gust: mph(step.windGustSpeed10m),
    wdir: step.windDirectionFrom10m ?? null,
    code: step.significantWeatherCode ?? null,
    rate: step.precipitationRate ?? 0,
    pop: step.probOfPrecipitation ?? null,
    vis: step.visibility ?? null,
    uv: step.uvIndex ?? null,
  };
}

export async function worldConditions() {
  /* the first visit after a stale spell waits for the refresh (at most a few seconds); later ones
     are answered from what is held while it runs */
  const anyHeld = WORLD_CITIES.some((c) => held[c.id]);
  const job = refresh();
  if (!anyHeld) await job; else job.catch(() => {});
  return {
    source: 'Met Office global model (DataHub site-specific)',
    paused: Date.now() < pausedUntil,
    cities: WORLD_CITIES.map((c) => {
      const now = held[c.id] ? current(held[c.id].series) : null;
      return { id: c.id, name: c.name, ok: !!now, fetched: held[c.id]?.at ? new Date(held[c.id].at).toISOString() : null, ...(now || {}) };
    }),
  };
}

export function mountWorldConditions(app) {
  app.get('/api/world-conditions', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(await worldConditions());
    } catch (err) {
      console.error('[world-conditions]', err.message);
      res.status(502).json({ error: 'unavailable' });
    }
  });
}
