/**
 * Live scenarios: likelihood maths and output shape, on synthetic model data
 * (no network). Two models that agree must outrank an outlier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarios, roundTo100, LATS, LONS, MODELS } from './ensemble.mjs';

function fakeLocs(pressureFor) {
  const locs = [];
  for (const la of LATS) for (const lo of LONS) {
    const daily = { time: Array.from({ length: 8 }, (_, d) => `2026-10-${String(10 + d).padStart(2, '0')}`) };
    for (const m of MODELS) {
      const p = pressureFor(m.id, la, lo);
      daily[`pressure_msl_mean_${m.id}`] = Array(8).fill(p);
      daily[`precipitation_sum_${m.id}`] = Array(8).fill(m.id.startsWith('ukmo') ? 5 : 1);
      daily[`temperature_2m_max_${m.id}`] = Array(8).fill(14);
      daily[`temperature_2m_min_${m.id}`] = Array(8).fill(7);
      daily[`wind_speed_10m_max_${m.id}`] = Array(8).fill(20);
      daily[`wind_direction_10m_dominant_${m.id}`] = Array(8).fill(250);
    }
    locs.push({ daily });
  }
  return locs;
}

test('percentages always sum to 100', () => {
  for (const ps of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.25, 0.25], [0.371, 0.333, 0.296]]) assert.equal(roundTo100(ps).reduce((a, b) => a + b, 0), 100);
});

test('the outlier model ranks least likely; the agreeing pair rank higher', () => {
  // ECMWF and GFS: high to the south (westerly); UKMO: deep low over the UK.
  const locs = fakeLocs((m, la, lo) => (m.startsWith('ukmo') ? 1000 - 10 * Math.exp(-((la - 55) ** 2 + (lo + 3) ** 2) / 20) : 1010 + (60 - la) * 1.2 + (m === 'ncep_gfs_global' ? 0.5 : 0)));
  const r = buildScenarios(locs, { climate: { series: { UK: { vars: { Tmax: { months: Array(12).fill(14) }, Tmin: { months: Array(12).fill(7) } } } } } });
  assert.equal(r.scenarios.length, 3);
  assert.equal(r.scenarios[2].model, 'UKMO');
  assert.deepEqual(r.scenarios.map((s) => s.rank), ['Most likely', 'Less likely', 'Least likely']);
  assert.equal(r.scenarios.reduce((s, x) => s + x.probability, 0), 100);
  assert.ok(r.scenarios[0].probability >= r.scenarios[2].probability);
  const ec = r.scenarios.find((s) => s.model === 'ECMWF');
  assert.equal(ec.week.flow, 'westerly');
  assert.equal(ec.daily.length, 7);
  assert.ok(r.scenarios.find((s) => s.model === 'UKMO').centres.some((c) => c.type === 'L'));
});
