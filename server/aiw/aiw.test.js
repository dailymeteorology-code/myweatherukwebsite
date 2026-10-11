/**
 * Tests for the AI lightning warning system.  Run: npm test
 *
 * Every test uses an isolated, throwaway data directory and in-memory state,
 * so nothing here can touch real warnings or the strike archive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.AIW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-test-'));

const { _setStateForTests, getState } = await import('./store.js');
const { decide, reconcile, computeExpiry, issueTestWarning, tickTests } = await import('./warnings.js');
const { DEFAULT_CONFIG } = await import('./config.js');
const { fieldToGeoJSON, isValidGeometry, geoAreaKm2, makeGrid, pointInGeo, geoCentroid } = await import('./geometry.js');
const { normaliseStrike, createIngest, coverageAt } = await import('./ingest.js');
const { fitLogistic, createScorer } = await import('./model.js');
const { clusterStrikes, updateTracks, summariseCluster, historyMotion } = await import('./nowcast.js');
const { describe: describeText, announcementText } = await import('./describe.js');

const cfg = structuredClone(DEFAULT_CONFIG);

/* A synthetic storm-shaped polygon around a point, in GeoJSON. */
function blob(lat, lon, rKm = 20) {
  const ring = [];
  for (let i = 0; i <= 32; i += 1) {
    const t = (i / 32) * 2 * Math.PI;
    ring.push([+(lon + (rKm * Math.cos(t)) / (111.32 * Math.cos(lat * Math.PI / 180))).toFixed(5), +(lat + (rKm * Math.sin(t)) / 111.32).toFixed(5)]);
  }
  ring[ring.length - 1] = ring[0];
  return { type: 'Polygon', coordinates: [ring] };
}

/* An assessment as warnings.assess() would produce it, with chosen evidence. */
function assessment({ lat = 52.0, lon = -0.4, rate = 3, peakP = 0.8, density = 2, pop = 300000, popAhead = 0, ttp = null, trend = 0, confidence = 'high', coverage = 'good' } = {}) {
  const geometry = blob(lat, lon, 20);
  const geo = {
    places: [{ name: 'Luton', cc: 'GB', country: 'United Kingdom', continent: 'Europe', admin1: 'England', admin2: 'Luton', pop, lat, lon, tz: 'Europe/London' }],
    placesAhead: popAhead ? [{ name: 'Stevenage', cc: 'GB', country: 'United Kingdom', continent: 'Europe', admin1: 'England', admin2: 'Hertfordshire', pop: popAhead, lat: lat + 0.1, lon: lon + 0.2, tz: 'Europe/London' }] : [],
    anchor: null, anchorPhrase: 'near Luton',
    countries: [{ cc: 'GB', country: 'United Kingdom', continent: 'Europe', admin1: ['England'], admin2: ['Luton'] }],
    continents: ['Europe'], population: pop, populationAhead: popAhead, overLand: true,
  };
  return {
    ok: true, geometry, areaKm2: geoAreaKm2(geometry), centroid: [lat, lon],
    forecast: [5, 10, 15, 20, 25, 30].map((L) => ({ lead: L, validAt: 0, geometry: blob(lat, lon + L * 0.01, 22), centroid: [lat, lon + L * 0.01] })),
    corridor: null, peakP, peakLead: 5, peakAt: Date.now() + 5 * 60e3, peakDensity100: density,
    ratePerMin: rate, previousRatePerMin: rate, trendLogRatio: trend, strikes10: Math.round(rate * 10), phase: 'steady',
    motion: { speedKmh: 30, towardDeg: 90, vx: 0.5, vy: 0, sources: ['track-history'], spreadKmh: 5 },
    track: { points: [], bearingDeg: 90 },
    geo, exposedPopulation: pop, populationAhead: popAhead, timeToPopMin: ttp,
    confidence, confidenceReasons: [], coverage,
  };
}

function freshState() { _setStateForTests({ config: null }); }

function cycle(tracks, items, now, opts = {}) {
  return reconcile({
    assessed: items, tracks, now, feedOk: opts.feedOk ?? true,
    modelInfo: { version: 'test', kind: 'baseline', trained: false }, dataQuality: { feed: opts.feedOk === false ? 'stale' : 'live' },
    paused: !!opts.paused,
  });
}

/* ── decision criteria ────────────────────────────────────────────────── */

test('decide: no warning below yellow criteria', () => {
  assert.equal(decide(assessment({ rate: 0.5, peakP: 0.3 }), cfg).level, null);
});

test('decide: yellow, amber, red from the evidence', () => {
  assert.equal(decide(assessment({ rate: 1.5, peakP: 0.6 }), cfg).level, 'yellow');
  assert.equal(decide(assessment({ rate: 8, peakP: 0.8 }), cfg).level, 'amber');
  assert.equal(decide(assessment({ rate: 30, peakP: 0.95, density: 10 }), cfg).level, 'red');
});

test('decide: approaching a populated area raises to amber', () => {
  const a = assessment({ rate: 2.5, peakP: 0.6, pop: 0, popAhead: 400000, ttp: 15 });
  assert.equal(decide(a, cfg).level, 'amber');
});

test('decide: red criteria with low confidence is held at amber, and says why', () => {
  const d = decide(assessment({ rate: 30, peakP: 0.95, density: 10, confidence: 'low' }), cfg);
  assert.equal(d.level, 'amber');
  assert.ok(d.reasons.some((r) => r.includes('held at amber')));
});

test('decide: partial coverage caps the level', () => {
  const d = decide(assessment({ rate: 30, peakP: 0.95, density: 10, coverage: 'partial' }), cfg);
  assert.equal(d.level, 'amber');
});

/* ── lifecycle ────────────────────────────────────────────────────────── */

test('issue only after the storm persists, then one warning per storm (no duplicates)', () => {
  freshState();
  const tracks = new Map();
  const track = { id: 'T1', cycles: 1, lastSeen: 0 };
  tracks.set('T1', track);
  let now = Date.parse('2026-07-01T12:00:00Z');
  for (let i = 0; i < 6; i += 1) {
    track.cycles = i + 1; track.lastSeen = now;
    cycle(tracks, [{ track, a: assessment({ rate: 3, peakP: 0.8 }) }], now);
    now += 60e3;
  }
  const s = getState();
  const issued = s.warnings.filter((w) => !w.isTest);
  assert.equal(issued.length, 1, 'exactly one warning for one storm');
  assert.equal(s.events.filter((e) => e.type === 'issued').length, 1);
  assert.ok(issued[0].issuedAt >= Date.parse('2026-07-01T12:02:00Z'), 'not issued before minCyclesToIssue');
});

test('a re-identified storm (new track id, same place) updates the existing warning', () => {
  freshState();
  const tracks = new Map();
  let now = Date.parse('2026-07-01T12:00:00Z');
  const t1 = { id: 'A', cycles: 5, lastSeen: now };
  tracks.set('A', t1);
  cycle(tracks, [{ track: t1, a: assessment() }], now);
  assert.equal(getState().warnings.length, 1);
  now += 60e3;
  t1.dead = true;
  const t2 = { id: 'B', cycles: 5, lastSeen: now };
  tracks.set('B', t2);
  cycle(tracks, [{ track: t2, a: assessment() }], now);
  const ws = getState().warnings;
  assert.equal(ws.length, 1, 'no duplicate warning');
  assert.equal(ws[0].trackId, 'B');
});

test('escalation needs consecutive cycles, and is announced once', () => {
  freshState();
  const tracks = new Map();
  let now = Date.parse('2026-07-01T12:00:00Z');
  const t = { id: 'E', cycles: 5, lastSeen: now };
  tracks.set('E', t);
  cycle(tracks, [{ track: t, a: assessment({ rate: 1.5, peakP: 0.6 }) }], now);
  assert.equal(getState().warnings[0].severity, 'yellow');
  now += 60e3; t.lastSeen = now;
  cycle(tracks, [{ track: t, a: assessment({ rate: 8, peakP: 0.8 }) }], now);
  assert.equal(getState().warnings[0].severity, 'yellow', 'one cycle is not enough to escalate');
  now += 60e3; t.lastSeen = now;
  cycle(tracks, [{ track: t, a: assessment({ rate: 8, peakP: 0.8 }) }], now);
  assert.equal(getState().warnings[0].severity, 'amber');
  for (let i = 0; i < 3; i += 1) { now += 60e3; t.lastSeen = now; cycle(tracks, [{ track: t, a: assessment({ rate: 8, peakP: 0.8 }) }], now); }
  const ann = getState().announcements;
  assert.equal(ann.filter((a) => a.kind === 'escalated').length, 1, 'escalation announced exactly once');
  assert.equal(new Set(ann.map((a) => a.id)).size, ann.length, 'announcement ids are unique');
});

test('downgrade needs downgradeCycles below the exit threshold (no flicker)', () => {
  freshState();
  const tracks = new Map();
  let now = Date.parse('2026-07-01T12:00:00Z');
  const t = { id: 'D', cycles: 5, lastSeen: now };
  tracks.set('D', t);
  cycle(tracks, [{ track: t, a: assessment({ rate: 8, peakP: 0.8 }) }], now);
  assert.equal(getState().warnings[0].severity, 'amber');
  // Alternating weak/strong never satisfies the consecutive requirement.
  for (let i = 0; i < 8; i += 1) {
    now += 60e3; t.lastSeen = now;
    cycle(tracks, [{ track: t, a: assessment({ rate: i % 2 ? 8 : 1.5, peakP: 0.7 }) }], now);
  }
  assert.equal(getState().warnings[0].severity, 'amber', 'did not flicker');
  for (let i = 0; i < cfg.downgradeCycles; i += 1) {
    now += 60e3; t.lastSeen = now;
    cycle(tracks, [{ track: t, a: assessment({ rate: 1.5, peakP: 0.6 }) }], now);
  }
  assert.equal(getState().warnings[0].severity, 'yellow');
});

test('expiry: warning expires on its clock and is never extended while the feed is down', () => {
  freshState();
  const tracks = new Map();
  let now = Date.parse('2026-07-01T12:00:00Z');
  const t = { id: 'X', cycles: 5, lastSeen: now };
  tracks.set('X', t);
  cycle(tracks, [{ track: t, a: assessment() }], now);
  const w = getState().warnings[0];
  const exp = w.expiresAt;
  // Feed goes down: storm still "assessed" but nothing may extend the warning.
  for (let i = 0; i < 5; i += 1) {
    now += 60e3; t.lastSeen = now;
    cycle(tracks, [{ track: t, a: assessment({ rate: 10 }) }], now, { feedOk: false });
  }
  assert.ok(w.expiresAt <= exp, 'not extended while data is stale');
  assert.equal(w.dataStale, true);
  now = exp + 1000;
  cycle(tracks, [], now, { feedOk: false });
  assert.equal(w.status, 'expired');
  assert.ok(/feed was unavailable/.test(w.endReason));
});

test('outage: no warnings are issued while the feed is down', () => {
  freshState();
  const tracks = new Map();
  const now = Date.parse('2026-07-01T12:00:00Z');
  const t = { id: 'O', cycles: 9, lastSeen: now };
  tracks.set('O', t);
  cycle(tracks, [{ track: t, a: assessment({ rate: 30, peakP: 0.95, density: 10 }) }], now, { feedOk: false });
  assert.equal(getState().warnings.length, 0);
});

test('paused issuance issues nothing', () => {
  freshState();
  const tracks = new Map();
  const now = Date.parse('2026-07-01T12:00:00Z');
  const t = { id: 'P', cycles: 9, lastSeen: now };
  tracks.set('P', t);
  cycle(tracks, [{ track: t, a: assessment() }], now, { paused: true });
  assert.equal(getState().warnings.length, 0);
});

test('a quiet storm is cancelled with a reason', () => {
  freshState();
  const tracks = new Map();
  let now = Date.parse('2026-07-01T12:00:00Z');
  const t = { id: 'Q', cycles: 5, lastSeen: now };
  tracks.set('Q', t);
  cycle(tracks, [{ track: t, a: assessment() }], now);
  now += (cfg.quietCancelMin + 1) * 60e3;
  cycle(tracks, [], now);
  const w = getState().warnings[0];
  assert.equal(w.status, 'cancelled');
  assert.ok(/no lightning/.test(w.endReason));
});

test('expiry duration depends on the storm, within bounds', () => {
  const now = Date.now();
  const fastSmall = computeExpiry({ ...assessment({ rate: 2 }), areaKm2: 300, motion: { speedKmh: 70 }, trendLogRatio: 0 }, now, now, cfg);
  const bigSlow = computeExpiry({ ...assessment({ rate: 25 }), areaKm2: 4000, motion: { speedKmh: 10 }, trendLogRatio: 0.2 }, now, now, cfg);
  assert.ok(bigSlow.expiresAt > fastSmall.expiresAt, 'a large slow storm gets a longer warning');
  for (const e of [fastSmall, bigSlow]) {
    assert.ok(e.expiresAt - now >= cfg.minDurationMin * 60e3 - 60e3);
    assert.ok(e.expiresAt - now <= cfg.maxDurationMin * 60e3 + 60e3);
  }
});

/* ── test warnings cannot be mistaken for real ones ───────────────────── */

test('test warnings are labelled everywhere and expire on their own clock', () => {
  freshState();
  const now = Date.parse('2026-07-01T12:00:00Z');
  const w = issueTestWarning({ lat: 51.88, lon: -0.42, severity: 'amber', durationMin: 10 }, 'tester', now);
  assert.ok(w.id.startsWith('TEST-'));
  assert.equal(w.isTest, true);
  assert.ok(w.title.startsWith('TEST'));
  assert.ok(w.description.includes('THIS IS A TEST'));
  const a = getState().announcements.at(-1);
  assert.equal(a.isTest, true);
  assert.ok(a.text.startsWith('This is a test.'));
  tickTests(now + 11 * 60e3);
  assert.equal(w.status, 'expired');
});

/* ── geometry ─────────────────────────────────────────────────────────── */

test('forecast geometry: a probability blob becomes a valid, correctly-sized, correctly-placed polygon', () => {
  const grid = makeGrid(52, -1, 60, 60, 2);
  const f = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j += 1) for (let i = 0; i < grid.nx; i += 1) {
    const [x, y] = grid.cellCentre(i, j);
    f[j * grid.nx + i] = Math.exp(-((x - 10) ** 2 + y ** 2) / (2 * 15 * 15));
  }
  const g = fieldToGeoJSON(f, grid, 0.4);
  assert.ok(isValidGeometry(g));
  // 0.4 isoline of a Gaussian: r = sigma * sqrt(-2 ln 0.4) ≈ 20.3 km
  const expected = Math.PI * (15 * Math.sqrt(-2 * Math.log(0.4))) ** 2;
  const area = geoAreaKm2(g);
  assert.ok(Math.abs(area - expected) / expected < 0.08, `area ${area.toFixed(0)} vs ${expected.toFixed(0)}`);
  const [clat, clon] = geoCentroid(g);
  const eastKm = (clon + 1) * 111.32 * Math.cos(52 * Math.PI / 180);
  assert.ok(Math.abs(eastKm - 10) < 2, 'centred where the blob is');
  assert.ok(Math.abs(clat - 52) < 0.03);
  assert.ok(pointInGeo(-1 + 10 / (111.32 * Math.cos(52 * Math.PI / 180)), 52, g));
});

test('two separate blobs make a MultiPolygon, not one merged area', () => {
  const grid = makeGrid(40, 10, 80, 40, 2);
  const f = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j += 1) for (let i = 0; i < grid.nx; i += 1) {
    const [x, y] = grid.cellCentre(i, j);
    f[j * grid.nx + i] = Math.exp(-((x - 40) ** 2 + y ** 2) / 200) + Math.exp(-((x + 40) ** 2 + y ** 2) / 200);
  }
  const g = fieldToGeoJSON(f, grid, 0.4, { minAreaKm2: 5 });
  assert.equal(g.type, 'MultiPolygon');
  assert.equal(g.coordinates.length, 2);
});

test('invalid geometry is rejected', () => {
  assert.equal(isValidGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] }), false);
  assert.equal(isValidGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), false, 'unclosed ring');
  assert.equal(isValidGeometry({ type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]] }), false, 'out of range');
});

/* ── ingestion & validation ───────────────────────────────────────────── */

test('strike validation: units normalised, garbage and impossible times rejected', () => {
  const now = Date.parse('2026-07-01T12:00:00Z');
  const ns = normaliseStrike({ lat: 51.5, lon: -0.1, time: now * 1e6 }, 'x', now);
  assert.equal(ns.time, now);
  assert.equal(normaliseStrike({ lat: 'a', lon: 0, time: now }, 'x', now), null);
  assert.equal(normaliseStrike({ lat: 95, lon: 0, time: now }, 'x', now), null);
  assert.equal(normaliseStrike({ lat: 51, lon: 0, time: now + 3600e3 }, 'x', now), null, 'future');
  assert.equal(normaliseStrike({ lat: 51, lon: 0, time: now - 24 * 3600e3 }, 'x', now), null, 'stale');
  const scaled = normaliseStrike({ lat: 515000000, lon: -1000000, time: now }, 'x', now);
  assert.ok(Math.abs(scaled.lat - 51.5) < 1e-9);
});

test('ingest de-duplicates the same strike from several sockets', () => {
  const ing = createIngest({ providers: [], archive: false });
  const t = Date.now();
  const s = { time: t, lat: 50.1234, lon: 8.4321 };
  ing.inject([s, { ...s }, { ...s, time: t + 200 }]);
  assert.equal(ing.window(t - 1000).length, 1);
});

test('ingest de-duplicates across a second boundary, but keeps a later strike at the same spot', () => {
  const ing = createIngest({ providers: [], archive: false });
  const t = Math.floor(Date.now() / 1000) * 1000 - 100;   // t and t + 200 ms sit in different seconds
  const s = { time: t, lat: 50.1234, lon: 8.4321 };
  // t + 500 / t + 700 straddle a half second, where the old rounded key split them.
  ing.inject([s, { ...s, time: t + 200 }, { ...s, time: t - 200 }, { ...s, time: t + 500 }, { ...s, time: t + 700 }]);
  assert.equal(ing.window(t - 5000).length, 1);
  ing.inject([{ ...s, time: t + 5000 }]);
  assert.equal(ing.window(t - 5000).length, 2);
});

test('coverage: good / partial / none', () => {
  assert.equal(coverageAt(52, -1).quality, 'good');
  assert.equal(coverageAt(-25, 135).quality, 'partial');
  assert.equal(coverageAt(-60, -100).quality, 'none');
});

/* ── nowcast primitives ───────────────────────────────────────────────── */

test('clustering separates storms and tracking keeps identity as a storm moves', () => {
  const now = Date.parse('2026-07-01T12:00:00Z');
  const mk = (lat, lon, n) => Array.from({ length: n }, (_, i) => ({ time: now - (i % 10) * 60e3, lat: lat + (i % 5) * 0.01, lon: lon + (i % 7) * 0.01 }));
  const strikes = [...mk(50, 8, 30), ...mk(51, 10, 30)];
  const clusters = clusterStrikes(strikes);
  assert.equal(clusters.length, 2);
  const tracks = new Map();
  let seq = 0;
  const id = () => `t${seq++}`;
  updateTracks(tracks, clusters.map((m) => ({ ...summariseCluster(m, now), members: m })), now, id);
  const moved = [...mk(50, 8.08, 30), ...mk(51, 10.08, 30)].map((s) => ({ ...s, time: s.time + 60e3 }));
  updateTracks(tracks, clusterStrikes(moved).map((m) => ({ ...summariseCluster(m, now + 60e3), members: m })), now + 60e3, id);
  assert.equal([...tracks.values()].filter((t) => !t.dead).length, 2, 'same two storms, no new ids');
});

test('history motion recovers a steady eastward motion', () => {
  const t0 = Date.parse('2026-07-01T12:00:00Z');
  const hist = Array.from({ length: 6 }, (_, i) => ({ t: t0 + i * 60e3, lat: 50, lon: 8 + (i * 0.5) / (111.32 * Math.cos(50 * Math.PI / 180)) }));
  const m = historyMotion(hist);
  assert.ok(Math.abs(m.vx - 0.5) < 0.02 && Math.abs(m.vy) < 0.02, JSON.stringify(m));
});

/* ── model & metrics ──────────────────────────────────────────────────── */

test('logistic regression recovers known coefficients', () => {
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const X = []; const y = []; const w = [];
  for (let i = 0; i < 6000; i += 1) {
    const x1 = rnd() * 4 - 2;
    const p = 1 / (1 + Math.exp(-(-0.5 + 2 * x1)));
    X.push([1, x1]); y.push(rnd() < p ? 1 : 0); w.push(1);
  }
  const b = fitLogistic(X, y, w, { l2: 1e-6 });
  assert.ok(Math.abs(b[0] + 0.5) < 0.15 && Math.abs(b[1] - 2) < 0.2, b.join(','));
});

test('verification scores match hand-computed values', () => {
  const sc = createScorer(0.5);
  sc.add(0.9, 1); sc.add(0.8, 0); sc.add(0.2, 1); sc.add(0.1, 0);
  const r = sc.result();
  assert.equal(r.pod, 0.5); assert.equal(r.far, 0.5); assert.ok(Math.abs(r.csi - 1 / 3) < 1e-9);
  assert.ok(Math.abs(r.brier - (0.01 + 0.64 + 0.64 + 0.01) / 4) < 1e-9);
});

/* ── text: never claims more than the data ────────────────────────────── */

test('descriptions use the real places and times, and red says to seek shelter', () => {
  const a = assessment({ rate: 30 });
  const f = { severity: 'red', phase: 'steady', ratePerMin: 30, previousRatePerMin: 30, motion: a.motion, geo: a.geo, issuedAt: Date.parse('2026-07-01T12:00:00Z'), expiresAt: Date.parse('2026-07-01T13:30:00Z'), confidence: 'high', coverage: 'good', modelTrained: false, tz: 'Europe/London', tzLabel: 'BST' };
  const d = describeText(f);
  assert.ok(d.includes('Luton'));
  assert.ok(d.includes('14:30'), 'local time');
  assert.ok(/indoors/.test(d));
  assert.ok(/baseline/.test(d), 'admits an untrained model');
  assert.ok(announcementText('issued', f).startsWith('Red lightning warning issued for'));
});

/* ── storm systems: one warning per threat ───────────────────────────── */

test('touching cells merge into one system; separate cells stay separate', async () => {
  const { groupSystems, mergeSystem } = await import('./systems.js');
  const { LEADS } = await import('./nowcast.js');
  const cell = (id, lat, lon, n10) => {
    const grid = makeGrid(lat, lon, 60, 60, 2);
    const N = grid.nx * grid.ny;
    const blobF = () => {
      const f = new Float32Array(N);
      for (let j = 0; j < grid.ny; j += 1) for (let i = 0; i < grid.nx; i += 1) {
        const [x, y] = grid.cellCentre(i, j);
        f[j * grid.nx + i] = Math.exp(-(x * x + y * y) / (2 * 14 * 14));
      }
      return f;
    };
    const probs = Object.fromEntries(LEADS.map((L) => [L, blobF()]));
    return {
      track: { id, lat, lon, n10, cycles: 4 }, probs, fields: { grid, now10: blobF() },
      motion: { vx: 0.3, vy: 0, speedKmh: 18, sources: ['track-history'], spreadKmh: 2 },
      trend: { latest10: n10, previous10: n10, logRatio: 0 }, env: null, coverage: { quality: 'good' },
    };
  };
  const kmLon = 1 / (111.32 * Math.cos(38 * Math.PI / 180));
  const a = cell('A', 38, 16, 40);
  const b = cell('B', 38, 16 + 25 * kmLon, 15);   // 25 km away: risk areas overlap
  const c = cell('C', 38, 16 + 400 * kmLon, 30);  // 400 km away: separate storm
  const systems = groupSystems([a, b, c], 0.2);
  assert.equal(systems.length, 2);
  const big = systems.find((s) => s.members.length === 2);
  const { item, absorbed } = mergeSystem(big.members, new Set(['B']));
  assert.equal(item.track.id, 'B', 'the cell already under a warning keeps it');
  assert.equal(absorbed.length, 1);
  assert.equal(item.trend.latest10, 55, 'strikes add up across the system');
  const g = fieldToGeoJSON(item.probs[5], item.fields.grid, 0.4);
  assert.ok(isValidGeometry(g));
  assert.equal(g.type, 'Polygon', 'one merged warning area, not two');
});

test('overlapping active warnings are merged into one, keeping the more severe', () => {
  freshState();
  const tracks = new Map();
  const now = Date.parse('2026-07-01T12:00:00Z');
  const t1 = { id: 'M1', cycles: 5, lastSeen: now };
  const t2 = { id: 'M2', cycles: 5, lastSeen: now };
  tracks.set('M1', t1); tracks.set('M2', t2);
  // Two storms assessed in the same cycle whose areas overlap (as legacy
  // warnings could): only one may survive.
  cycle(tracks, [
    { track: t1, a: assessment({ lat: 52.0, lon: -0.40, rate: 1.5, peakP: 0.6 }) },
    { track: t2, a: assessment({ lat: 52.0, lon: -0.25, rate: 8, peakP: 0.8 }) },
  ], now);
  const act = getState().warnings.filter((w) => w.status === 'active');
  assert.equal(act.length, 1, 'no overlapping warnings left active');
  assert.equal(act[0].severity, 'amber', 'the more severe one survives');
  assert.ok(getState().events.some((e) => e.type === 'merged'));
});
