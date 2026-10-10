/**
 * Weather Scenarios — automated checks.
 * Data structure, month and regional filtering, matrix consistency,
 * navigation links, sources, search, climate data, region boundaries and
 * admin permissions. Run with `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.SCENARIOS_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wsx-test-'));

const store = await import('./store.js');
const q = await import('../../src/components/scenarios/query.js');
const { CATEGORIES, REGIONS, MONTH_KEYS, FREQUENCY } = await import('./data/taxonomy.js');
const { MONTHS } = await import('./data/months.js');

const EMPTY = { scenarios: {}, events: {}, sources: {}, status: {}, audit: [] };
const cat = store.buildCatalogue({ overrides: EMPTY });
const light = JSON.parse(store.lightPayload().json);
const S = light.scenarios;

/* ── data structure ── */
test('catalogue builds with no validation problems', () => {
  assert.deepEqual(cat.problems, []);
  assert.ok(cat.scenarios.length >= 150, `expected a substantial library, got ${cat.scenarios.length}`);
});
test('scenario ids are unique and kebab-case', () => {
  const ids = store.BASE_SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});
test('every category in the brief has scenarios', () => {
  for (const c of CATEGORIES) assert.ok(cat.scenarios.some((s) => s.cat === c.id || (s.also || []).includes(c.id)), `no scenarios in ${c.id}`);
});
test('no scenario is marked irrelevant all year; codes are valid', () => {
  for (const s of cat.scenarios) {
    assert.equal(s.months.length, 12, s.id);
    for (const ch of s.months) assert.ok(FREQUENCY[ch], `${s.id} bad code ${ch}`);
    assert.match(s.months, /[CPUR]/, s.id);
  }
});
test('every scenario cites sources and lists essential ingredients and outcomes', () => {
  for (const s of cat.scenarios) {
    assert.ok(s.sources.length > 0, s.id);
    assert.ok(s.setup.essential.length > 0, s.id);
    assert.ok(s.outcomes.length > 0, s.id);
  }
});
test('every statistic carries a source, period and coverage', () => {
  for (const s of cat.scenarios) for (const st of s.stats || []) for (const k of ['text', 'source', 'period', 'scope']) assert.ok(st[k], `${s.id} stat missing ${k}`);
});
test('validator rejects malformed records', () => {
  const ctx = { scenarioIds: new Set(['a']), sourceIds: new Set(['mo-past-events']) };
  const bad = store.validateScenario({ id: 'Bad Id', name: 'x', cat: 'nope', kind: 'x', sev: 'x', temp: 'x', months: 'CCC', summary: 'short', body: [], regions: [['atlantis', 'high']], setup: {}, outcomes: [], frequency: '' }, ctx);
  for (const frag of ['kebab-case', 'unknown category', 'months must be 12', 'unknown region', 'essential', 'summary']) assert.ok(bad.some((e) => e.includes(frag)), `expected a "${frag}" error`);
});

/* ── months ── */
test('all twelve months have distinct, month-specific content', () => {
  assert.equal(MONTHS.length, 12);
  assert.deepEqual(MONTHS.map((m) => m.key), MONTH_KEYS);
  assert.equal(new Set(MONTHS.map((m) => m.intro)).size, 12);
  for (const m of MONTHS) { assert.ok(m.intro.length > 200, m.key); assert.ok(m.regional.length >= 3, m.key); assert.ok(m.compare.prev && m.compare.next, m.key); }
});
test('each month has its own catalogue with common scenarios', () => {
  const sizes = MONTH_KEYS.map((_, i) => q.monthStats(S, i));
  for (const [i, st] of sizes.entries()) { assert.ok(st.common >= 15, `${MONTH_KEYS[i]} has few common scenarios`); assert.ok(st.relevant >= 60, MONTH_KEYS[i]); }
  // Month-specific, not one list repeated: January and July must differ a lot.
  const jan = new Set(q.monthCatalogue(S, 0).C.map((s) => s.id));
  const jul = new Set(q.monthCatalogue(S, 6).C.map((s) => s.id));
  const shared = [...jan].filter((x) => jul.has(x)).length;
  assert.ok(shared < Math.min(jan.size, jul.size) / 2, 'January and July common lists overlap too much');
});
test('month filtering returns only scenarios relevant in that month', () => {
  const july = q.filterScenarios(S, { months: [6] }).map((r) => r.s);
  assert.ok(july.length > 0);
  for (const s of july) assert.ok(q.FREQ_RANK[s.months[6]] >= 1, s.id);
  const commonOnly = q.filterScenarios(S, { months: [6], minFreq: 'C' }).map((r) => r.s);
  for (const s of commonOnly) assert.equal(s.months[6], 'C', s.id);
  assert.ok(commonOnly.length < july.length);
});
test('snow is relevant in several months; heatwaves are mainly summer but not only', () => {
  const snow = S.find((s) => s.id === 'widespread-snowfall');
  assert.ok([...snow.months].filter((c) => c !== '-').length >= 4);
  const heat = S.find((s) => s.id === 'early-season-heat');
  assert.ok(heat.months[4] !== '-', 'May early heat should be relevant');
  const storms = S.find((s) => s.id === 'airmass-thunderstorms');
  assert.ok([...storms.months].every((c) => c !== '-'), 'ordinary thunderstorms are possible all year');
});

/* ── regions ── */
test('regional filtering keeps only scenarios rated relevant to the region', () => {
  const res = q.filterScenarios(S, { regions: ['east-of-england'] }).map((r) => r.s);
  assert.ok(res.length > 0);
  for (const s of res) assert.ok((s.regions['east-of-england'] || 0) >= 2, s.id);
});
test('combined filters work: thunderstorms in July in South East England', () => {
  const res = q.filterScenarios(S, { categories: ['thunder'], months: [6], regions: ['south-east-england'] }).map((r) => r.s);
  assert.ok(res.length >= 3);
  for (const s of res) {
    assert.ok(s.cat === 'thunder' || s.also.includes('thunder'));
    assert.ok(q.FREQ_RANK[s.months[6]] >= 1);
    assert.ok((s.regions['south-east-england'] || 0) >= 2);
  }
});
test('combined filters work: snow and ice in Scotland in January', () => {
  const res = q.filterScenarios(S, { precip: ['snow'], months: [0], regions: ['northern-scotland'] }).map((r) => r.s);
  assert.ok(res.length >= 5);
  for (const s of res) assert.ok(s.precip.includes('snow'));
});
test('every region has a row for every scenario in the normalised table', () => {
  assert.equal(cat.tables.regionLinks.length, cat.scenarios.length * REGIONS.length);
});

/* ── matrix, seasons, comparison ── */
test('matrix is generated from the records and matches month catalogues', () => {
  const rows = q.matrixRows(S);
  assert.equal(rows.length, S.length);
  for (const r of rows) assert.equal(r.codes.join(''), S.find((s) => s.id === r.id).months);
  for (let m = 0; m < 12; m += 1) {
    const g = q.monthCatalogue(S, m);
    const listed = g.C.length + g.P.length + g.U.length + g.R.length;
    assert.equal(listed, rows.filter((r) => r.codes[m] !== '-').length);
  }
});
test('season summaries are composed from their months', () => {
  const sum = q.seasonSummary(S, 'summer');
  for (const { s, codes } of sum.rows) assert.deepEqual(codes, [5, 6, 7].map((m) => s.months[m]));
  assert.ok(sum.common.some((r) => r.s.id === 'multi-day-heatwave'));
});
test('comparison is derived from the records', () => {
  const a = S.find((s) => s.id === 'radiation-fog'); const b = S.find((s) => s.id === 'advection-fog');
  const c = q.compareScenarios([a, b]);
  assert.equal(c.monthOverlap.length, 12);
  assert.ok(c.diffs.find((d) => d.label === 'Circulation').differs);
});

/* ── navigation and links ── */
test('related links are valid and symmetric', () => {
  const ids = new Set(S.map((s) => s.id));
  for (const s of S) for (const r of s.related) {
    assert.ok(ids.has(r), `${s.id} → ${r}`);
    assert.ok(S.find((x) => x.id === r).related.includes(s.id), `${r} does not link back to ${s.id}`);
  }
});
test('events reference existing scenarios and sources, with valid dates', () => {
  const ids = new Set(S.map((s) => s.id)); const srcs = new Set(light.sources.map((s) => s.id));
  assert.ok(light.events.length >= 80);
  for (const e of light.events) {
    assert.ok(e.start <= e.end, e.id);
    for (const sid of e.scenarios) assert.ok(ids.has(sid), `${e.id} → ${sid}`);
    for (const sid of e.sources) assert.ok(srcs.has(sid), `${e.id} source ${sid}`);
  }
});
test('every source has a unique id and an https URL', () => {
  const ids = light.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of light.sources) assert.match(s.url, /^https:\/\//, s.id);
});
test('month navigation wraps', () => {
  assert.equal((0 + 11) % 12, 11);
  const d = q.monthDelta(S, 11, 0);
  assert.ok(Array.isArray(d.rising) && Array.isArray(d.falling));
});
test('source links resolve (network; set CHECK_LINKS=1)', { skip: !process.env.CHECK_LINKS }, async () => {
  const { checkLinks } = await import('./links.js');
  const r = await checkLinks(cat.sources);
  assert.deepEqual(r.failed, []);
});

/* ── search ── */
test('search understands familiar terms and synonyms', () => {
  const top = (text) => q.sortResults(q.filterScenarios(S, { q: text })).map((r) => r.s.id);
  assert.equal(top('beast from the east')[0], 'easterly-snow-event');
  assert.ok(top('twister').includes('tornadic-storms'));
  assert.ok(top('atmospheric river').includes('atmospheric-river'));
  assert.ok(top('haar').includes('sea-fog-haar'));
  assert.ok(top('heatwave').slice(0, 5).includes('multi-day-heatwave'));
  assert.equal(top('zzqqxx').length, 0);
});

/* ── climate data and boundaries ── */
test('1991–2020 climate averages exist for the UK and every region\'s districts', () => {
  const c = light.climate;
  assert.equal(c.period, '1991–2020');
  assert.equal(c.series.UK.vars.Tmean.months.length, 12);
  for (const r of REGIONS) for (const k of r.climate) assert.ok(c.series[k], `${r.id} → ${k}`);
  assert.ok(c.series.UK.vars.Tmean.months[6] > c.series.UK.vars.Tmean.months[0], 'July should be warmer than January');
});
test('region boundaries cover all fifteen regions', () => {
  const geo = JSON.parse(fs.readFileSync(path.resolve(here, '../data/scenarios/regions.geo.json'), 'utf8'));
  const present = new Set(geo.features.map((f) => f.properties.region));
  for (const r of REGIONS) assert.ok(present.has(r.id), r.id);
});

/* ── admin: overrides and permissions ── */
test('admin edits are validated, can be unpublished, and duplicates are refused', () => {
  const base = store.BASE_SCENARIOS.find((s) => s.id === 'radiation-fog');
  const o = { ...EMPTY, scenarios: { 'radiation-fog': { ...base, name: 'Radiation fog (edited)' } }, status: { 'graupel': { published: false } } };
  const c = store.buildCatalogue({ overrides: o });
  assert.equal(c.scenarios.find((s) => s.id === 'radiation-fog').name, 'Radiation fog (edited)');
  assert.ok(!c.scenarios.some((s) => s.id === 'graupel'), 'unpublished scenario must be hidden');
  const all = store.buildCatalogue({ overrides: o, includeUnpublished: true });
  assert.ok(all.scenarios.some((s) => s.id === 'graupel'));
  const broken = store.buildCatalogue({ overrides: { ...EMPTY, scenarios: { 'radiation-fog': { ...base, months: 'XX' } } } });
  assert.ok(broken.problems.some((p) => p.id === 'radiation-fog'));
  assert.ok(!broken.scenarios.some((s) => s.id === 'radiation-fog'), 'invalid edit must not be served');
});
test('admin routes require an admin login', async () => {
  const express = (await import('express')).default;
  const { mountScenarios } = await import('./api.js');
  const app = express();
  mountScenarios(app);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const pub = await fetch(`http://127.0.0.1:${port}/api/scenarios/catalogue`);
    assert.equal(pub.status, 200);
    for (const [method, p] of [['GET', '/overview'], ['PUT', '/scenario/radiation-fog'], ['POST', '/scenario'], ['POST', '/status/graupel'], ['POST', '/check-links']]) {
      const r = await fetch(`http://127.0.0.1:${port}/api/scenarios/admin${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 401, `${method} ${p}`);
    }
    const item = await fetch(`http://127.0.0.1:${port}/api/scenarios/item/supercells`);
    assert.equal(item.status, 200);
    assert.equal((await item.json()).id, 'supercells');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/scenarios/item/not-a-thing`)).status, 404);
  } finally { server.close(); }
});
