/**
 * Live week-ahead scenarios from three deterministic global models:
 * ECMWF IFS, NOAA GFS and the Met Office global model (UKMO 10 km), via the
 * Open-Meteo forecast API (one request, 225 grid points around the UK,
 * 48–62°N, 14°W–7°E).
 *
 * Daily variables: max/min temperature, precipitation total, max 10 m wind
 * speed (mph), dominant wind direction, plus mean sea-level pressure (needed
 * for the isobars, highs and lows and the flow over the UK).
 *
 * Each model's run is one scenario. Likelihood is based on agreement: the
 * 7-day mean pressure patterns are compared pairwise (RMS difference over
 * the grid). A model whose week agrees closely with the other two is more
 * likely; an outlier is less likely. Weights are 1 + Σ agreement with each
 * other model, where agreement = max(0, 1 − RMS/8 hPa), then normalised and
 * rounded to sum to 100. This is a consensus measure, not a calibrated
 * probability, and the graphic says so.
 */

export const MODELS = [
  { id: 'ecmwf_ifs', name: 'ECMWF', full: 'ECMWF IFS' },
  { id: 'ncep_gfs_global', name: 'GFS', full: 'NOAA GFS' },
  { id: 'ukmo_global_deterministic_10km', name: 'UKMO', full: 'Met Office global 10 km' },
];
export const LATS = Array.from({ length: 15 }, (_, i) => 48 + i);
export const LONS = Array.from({ length: 15 }, (_, i) => -14 + i * 1.5);
const VARS = ['pressure_msl_mean', 'precipitation_sum', 'temperature_2m_max', 'temperature_2m_min', 'wind_speed_10m_max', 'wind_direction_10m_dominant'];
const DAYS = 7;
export const AGREE_SCALE = 8; // hPa RMS difference at which agreement reaches zero

export const CITIES = [
  ['London', 51.51, -0.13], ['Norwich', 52.63, 1.3], ['Plymouth', 50.38, -4.14], ['Cardiff', 51.48, -3.18],
  ['Birmingham', 52.49, -1.89], ['Manchester', 53.48, -2.24], ['Newcastle', 54.98, -1.61], ['Belfast', 54.6, -5.93],
  ['Glasgow', 55.86, -4.25], ['Edinburgh', 55.95, -3.19], ['Aberdeen', 57.15, -2.09], ['Inverness', 57.48, -4.22],
];

/** One request for the whole grid and all three models. */
export async function fetchModels({ log = console.log } = {}) {
  const lat = []; const lon = [];
  for (const la of LATS) for (const lo of LONS) { lat.push(la); lon.push(lo); }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${VARS.join(',')}&models=${MODELS.map((m) => m.id).join(',')}&timezone=Europe%2FLondon&wind_speed_unit=mph&forecast_days=8`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    log(`Fetching ECMWF, GFS and UKMO for ${lat.length} points${attempt ? ` (retry ${attempt})` : ''}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'MyWeatherUK live scenarios' } });
    const j = await res.json().catch(() => ({ error: true, reason: `HTTP ${res.status}` }));
    if (Array.isArray(j)) return j;
    log(`  Open-Meteo: ${j.reason}`);
    await new Promise((r) => setTimeout(r, 70_000));
  }
  throw new Error('Open-Meteo request failed repeatedly');
}

function bilinear(field, lat, lon) {
  const fi = Math.max(0, Math.min(LATS.length - 1.0001, lat - LATS[0])); const fj = Math.max(0, Math.min(LONS.length - 1.0001, (lon - LONS[0]) / 1.5));
  const i0 = Math.floor(fi); const j0 = Math.floor(fj); const ti = fi - i0; const tj = fj - j0;
  const v = (i, j) => field[i * LONS.length + j];
  return (1 - ti) * ((1 - tj) * v(i0, j0) + tj * v(i0, j0 + 1)) + ti * ((1 - tj) * v(i0 + 1, j0) + tj * v(i0 + 1, j0 + 1));
}
export function roundTo100(ps) {
  const raw = ps.map((p) => p * 100); const fl = raw.map(Math.floor);
  const rem = 100 - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < rem; k += 1) fl[order[k][1]] += 1;
  return fl;
}
const COMPASS = ['northerly', 'north-easterly', 'easterly', 'south-easterly', 'southerly', 'south-westerly', 'westerly', 'north-westerly'];
const r1 = (x) => Math.round(x * 10) / 10;
const mean = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

export function buildScenarios(locs, { climate = null, issued = new Date() } = {}) {
  const time = locs[0].daily.time.slice(1, DAYS + 1);
  const monthIdx = new Date(`${time[3]}T12:00:00Z`).getUTCMonth();
  const climTmax = climate?.series?.UK?.vars?.Tmax?.months?.[monthIdx];
  const climTmin = climate?.series?.UK?.vars?.Tmin?.months?.[monthIdx];

  const models = MODELS.map((m) => {
    // field(v, d) → value per grid point for day d (1-based in the API arrays)
    const get = (v, d) => locs.map((loc) => loc.daily[`${v}_${m.id}`]?.[d + 1] ?? null);
    const days = Array.from({ length: DAYS }, (_, d) => d).filter((d) => get('pressure_msl_mean', d).every((x) => x != null));
    if (days.length < 4) return null;
    const avgField = (v) => locs.map((_, p) => mean(days.map((d) => get(v, d)[p])));
    const sumField = (v) => locs.map((_, p) => days.reduce((s, d) => s + (get(v, d)[p] || 0), 0));
    return { ...m, days, get, mslp: avgField('pressure_msl_mean'), rain: sumField('precipitation_sum') };
  }).filter(Boolean);
  if (models.length < 2) throw new Error('Fewer than two models returned usable data');

  // Pairwise agreement of 7-day mean pressure patterns.
  const rms = (a, b) => Math.sqrt(mean(a.map((x, i) => (x - b[i]) ** 2)));
  const agreement = models.map((a) => models.map((b) => (a === b ? null : Math.max(0, 1 - rms(a.mslp, b.mslp) / AGREE_SCALE))));
  const pairRms = models.map((a) => models.map((b) => (a === b ? null : r1(rms(a.mslp, b.mslp)))));
  const weights = agreement.map((row) => 1 + row.reduce((s, x) => s + (x || 0), 0));
  const tot = weights.reduce((a, b) => a + b, 0);
  const pct = roundTo100(weights.map((w) => w / tot));

  const scenarios = models.map((m, mi) => {
    const city = (field) => CITIES.map(([n, la, lo]) => [n, bilinear(field, la, lo)]);
    const daily = time.map((date, d) => {
      if (!m.days.includes(d)) return { date, missing: true };
      const tmax = city(m.get('temperature_2m_max', d)); const tmin = city(m.get('temperature_2m_min', d));
      const pr = city(m.get('precipitation_sum', d)); const ws = city(m.get('wind_speed_10m_max', d));
      // vector-mean dominant direction across cities
      const dirs = CITIES.map(([, la, lo]) => bilinear(m.get('wind_direction_10m_dominant', d).map((x) => x ?? 0), la, lo));
      const u = mean(dirs.map((a) => Math.sin(a * Math.PI / 180))); const v = mean(dirs.map((a) => Math.cos(a * Math.PI / 180)));
      return {
        date, tmax: r1(mean(tmax.map((x) => x[1]))), tmin: r1(mean(tmin.map((x) => x[1]))), rain: r1(mean(pr.map((x) => x[1]))),
        wind: Math.round(Math.max(...ws.map((x) => x[1]))), dir: Math.round((Math.atan2(u, v) * 180 / Math.PI + 360) % 360),
      };
    });
    const ok = daily.filter((d) => !d.missing);
    const cityRain = city(m.rain);
    const windMax = CITIES.map(([n, la, lo]) => [n, Math.max(...m.days.map((d) => bilinear(m.get('wind_speed_10m_max', d), la, lo)))]);
    const wettest = [...cityRain].sort((a, b) => b[1] - a[1])[0];
    const windiest = [...windMax].sort((a, b) => b[1] - a[1])[0];
    const c = [54.5, -3]; const h = 1.5;
    const dpdy = (bilinear(m.mslp, c[0] + h, c[1]) - bilinear(m.mslp, c[0] - h, c[1])) / (2 * h * 111);
    const dpdx = (bilinear(m.mslp, c[0], c[1] + h) - bilinear(m.mslp, c[0], c[1] - h)) / (2 * h * 111 * Math.cos(c[0] * Math.PI / 180));
    const strength = Math.hypot(dpdx, dpdy) * 1000;
    const fromDeg = (Math.atan2(dpdy, -dpdx) * 180 / Math.PI + 360) % 360; // from geostrophic u=-dp/dy, v=dp/dx
    const flow = strength < 2 ? 'slack' : COMPASS[Math.round(fromDeg / 45) % 8];
    const tmaxW = mean(ok.map((d) => d.tmax)); const tminW = mean(ok.map((d) => d.tmin));
    const centres = [];
    for (let i = 0; i < LATS.length; i += 1) for (let k = 0; k < LONS.length; k += 1) {
      const val = m.mslp[i * LONS.length + k]; let isMax = true; let isMin = true;
      for (let di = -2; di <= 2; di += 1) for (let dk = -2; dk <= 2; dk += 1) {
        if (!di && !dk) continue; const ii = i + di; const kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= LATS.length || kk >= LONS.length) continue;
        const o = m.mslp[ii * LONS.length + kk]; if (o >= val) isMax = false; if (o <= val) isMin = false;
      }
      if (isMax && val >= 1012) centres.push({ type: 'H', lat: LATS[i], lon: LONS[k], hPa: Math.round(val) });
      if (isMin && val <= 1012) centres.push({ type: 'L', lat: LATS[i], lon: LONS[k], hPa: Math.round(val) });
    }
    const s = {
      model: m.name, modelFull: m.full, probability: pct[mi], weight: weights[mi],
      agreement: models.map((o, oi) => (oi === mi ? null : { model: o.name, pct: Math.round(agreement[mi][oi] * 100), rms: pairRms[mi][oi] })).filter(Boolean),
      daysAvailable: m.days.length,
      mslp: m.mslp.map(r1), rain: m.rain.map(r1), daily, centres,
      week: {
        tmax: r1(tmaxW), tmin: r1(tminW), rain: r1(mean(cityRain.map((x) => x[1]))),
        wettest: { city: wettest[0], mm: Math.round(wettest[1]) }, windiest: { city: windiest[0], mph: Math.round(windiest[1]) },
        pressure: Math.round(mean(CITIES.map(([, la, lo]) => bilinear(m.mslp, la, lo)))), flow, flowStrength: r1(strength),
        tmaxAnom: climTmax != null ? r1(tmaxW - climTmax) : null, tminAnom: climTmin != null ? r1(tminW - climTmin) : null,
      },
    };
    return Object.assign(s, describe(s));
  });

  scenarios.sort((a, b) => b.weight - a.weight);
  const ranks = ['Most likely', 'Less likely', 'Least likely'];
  scenarios.forEach((s, i) => { s.rank = ranks[i]; });
  return {
    issued: issued.toISOString(), validFrom: time[0], validTo: time[time.length - 1], days: time,
    grid: { lats: LATS, lons: LONS }, cities: CITIES.map(([n, la, lo]) => ({ name: n, lat: la, lon: lo })),
    models: models.map((m) => ({ name: m.name, full: m.full, days: m.days.length })),
    climateMonth: monthIdx,
    method: `Each scenario is one model's forecast. Likelihood reflects agreement: 7-day mean pressure patterns are compared between models (RMS difference; zero agreement at ${AGREE_SCALE} hPa), so the model the others support most ranks highest. A consensus measure, not a calibrated probability.`,
    scenarios,
  };
}

function describe(s) {
  const w = s.week;
  const press = w.pressure >= 1022 ? 'high' : w.pressure >= 1014 ? 'fairly high' : w.pressure >= 1006 ? 'low' : 'very low';
  const rain = w.rain < 4 ? 'mostly dry' : w.rain < 12 ? 'some rain at times' : w.rain < 30 ? 'unsettled with rain' : 'very wet';
  const temp = w.tmaxAnom == null ? '' : w.tmaxAnom >= 2 ? 'warm for the time of year' : w.tmaxAnom >= 0.8 ? 'mild' : w.tmaxAnom <= -2 ? 'cold for the time of year' : w.tmaxAnom <= -0.8 ? 'rather cool' : 'near-average temperatures';
  const wind = w.windiest.mph >= 45 ? 'stormy' : w.windiest.mph >= 32 ? 'windy' : '';
  const atlantic = ['westerly', 'south-westerly', 'north-westerly'].includes(w.flow);
  const lead = press === 'high' ? (w.rain >= 12 ? 'High pressure, fronts on the edge' : 'High pressure in charge')
    : press === 'fairly high' ? (w.rain >= 12 ? (atlantic ? 'Atlantic ' + w.flow.replace(/y$/, 'ies') : 'Weak fronts and troughs') : 'High pressure nearby')
      : press === 'low' ? (atlantic ? 'Atlantic lows' : 'Low pressure') : 'Deep low pressure';
  const flowTxt = w.flow === 'slack' ? 'Light, slack winds' : `A ${w.flow} flow`;
  return {
    headline: `${lead}: ${rain}${wind ? `, ${wind}` : ''}`,
    summary: `${flowTxt} with ${press} pressure (≈${w.pressure} hPa). ${rain.charAt(0).toUpperCase() + rain.slice(1)}, ${temp}. Wettest: ${w.wettest.city} ≈${w.wettest.mm} mm; strongest winds ≈${w.windiest.mph} mph near ${w.windiest.city}.`,
  };
}
