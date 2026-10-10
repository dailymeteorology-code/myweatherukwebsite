/**
 * Builds server/data/scenarios/climate-1991-2020.json from the Met Office
 * HadUK-Grid areal series (UK, countries and climate districts).
 *
 *   node server/scenarios/build/build-climate.mjs
 *
 * Every number on the Weather Scenarios page that describes "a typical
 * <month>" comes from here: the mean of the monthly values for 1991–2020
 * inclusive, computed from the published series — nothing typed in by hand.
 * Source: Met Office National Climate Information Centre, HadUK-Grid areal
 * series (Open Government Licence). Files list the date they were updated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../data/scenarios/climate-1991-2020.json');
const BASE = 'https://www.metoffice.gov.uk/pub/data/weather/uk/climate/datasets';

export const SERIES = {
  UK: 'United Kingdom', England: 'England', Wales: 'Wales', Scotland: 'Scotland', Northern_Ireland: 'Northern Ireland',
  England_SE_and_Central_S: 'England SE & central S', England_SW_and_S_Wales: 'England SW & S Wales',
  East_Anglia: 'East Anglia', Midlands: 'Midlands', England_E_and_NE: 'England E & NE',
  England_NW_and_N_Wales: 'England NW & N Wales', Scotland_N: 'Scotland N', Scotland_E: 'Scotland E', Scotland_W: 'Scotland W',
};
const VARS = {
  Tmean: { label: 'Mean temperature', unit: '°C', dp: 1 },
  Tmax: { label: 'Mean daily maximum', unit: '°C', dp: 1 },
  Tmin: { label: 'Mean daily minimum', unit: '°C', dp: 1 },
  Rainfall: { label: 'Rainfall', unit: 'mm', dp: 0 },
  Raindays1mm: { label: 'Days with ≥1 mm rain', unit: 'days', dp: 1 },
  Sunshine: { label: 'Sunshine', unit: 'hours', dp: 0 },
  AirFrost: { label: 'Days of air frost', unit: 'days', dp: 1 },
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parse(text) {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^year\s+jan/.test(l));
  const updated = (lines.find((l) => /^Last updated/i.test(l)) || '').replace(/^Last updated\s*/i, '').trim();
  const rows = [];
  for (const l of lines.slice(hi + 1)) {
    const p = l.trim().split(/\s+/);
    if (!/^\d{4}$/.test(p[0])) continue;
    rows.push({ year: +p[0], m: p.slice(1, 13).map((v) => (v === '---' || v === '' ? null : +v)) });
  }
  return { updated, rows };
}

async function get(url) {
  for (let i = 0; i < 3; i += 1) {
    const r = await fetch(url, { headers: { 'User-Agent': 'MyWeatherUK climate builder' } });
    if (r.ok) return r.text();
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${url}`);
}

const out = {
  period: '1991–2020',
  source: 'Met Office HadUK-Grid areal series (National Climate Information Centre), Open Government Licence v3.0',
  sourceUrl: 'https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-and-regional-series',
  method: 'Arithmetic mean of each calendar month over 1991–2020 inclusive; a value is published only if all 30 years are present.',
  builtAt: new Date().toISOString(),
  variables: VARS, series: {},
};
for (const [key, name] of Object.entries(SERIES)) {
  out.series[key] = { name, vars: {} };
  for (const [v, meta] of Object.entries(VARS)) {
    const url = `${BASE}/${v}/date/${key}.txt`;
    const { updated, rows } = parse(await get(url));
    const span = rows.filter((r) => r.year >= 1991 && r.year <= 2020);
    const months = MONTHS.map((_, i) => {
      const vals = span.map((r) => r.m[i]).filter((x) => x != null);
      if (vals.length !== 30) return null;
      const f = 10 ** meta.dp;
      return Math.round((vals.reduce((a, b) => a + b, 0) / 30) * f) / f;
    });
    out.series[key].vars[v] = { months, url, updated };
    process.stdout.write('.');
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nwrote ${OUT}`);
