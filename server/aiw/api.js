/**
 * HTTP API for the AI lightning warning system.
 *
 * Public (read-only, rate-limited):
 *   GET  /api/aiw/status                 feeds, coverage, engine, model, disclaimer
 *   GET  /api/aiw/active                 every active warning, full geometry, for the map
 *   GET  /api/aiw/warnings               the Issued Warnings Centre: filters, facets, paging
 *   GET  /api/aiw/warnings/:id           one warning, with versions, events and verification
 *   GET  /api/aiw/announcements?since=   spoken-announcement events
 *   GET  /api/aiw/stream                 Server-Sent Events: cycle + announcement pushes
 *   GET  /api/aiw/places?q=              place search (home location, area filter)
 *   GET  /api/aiw/check?lat=&lon=        warnings over / heading for a location
 *
 * Admin (existing auth, role 'admin'; every action audited):
 *   GET  /api/aiw/admin/overview
 *   GET  /api/aiw/admin/tracks
 *   PUT  /api/aiw/admin/config
 *   POST /api/aiw/admin/pause            { paused, reason }
 *   POST /api/aiw/admin/warnings/:id/cancel  { reason }
 *   POST /api/aiw/admin/test-warning     { lat, lon, severity, speedKmh, towardDeg, durationMin }
 *   POST /api/aiw/admin/train            { deploy }
 *   POST /api/aiw/admin/models/:version/deploy
 *   POST /api/aiw/admin/models/baseline/deploy
 */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireAdmin } from '../auth.js';
import { getState, saveState, archiveSummary, MODEL_DIR, readJson, AIW_DIR } from './store.js';
import { COVERAGE, coverageAt } from './ingest.js';
import { getConfig, setConfig, DEFAULT_CONFIG, levelRank } from './config.js';
import { allWarnings, findWarning, endWarning, issueTestWarning } from './warnings.js';
import { searchPlaces, gazetteerSource } from './geo.js';
import { pointInGeo, haversineKm } from './geometry.js';
import { deriveThresholds, registerModel } from './train.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DISCLAIMER = 'MyWeatherUK AI lightning warnings are EXPERIMENTAL, generated automatically by a '
  + 'forecasting model from community lightning-detection data. They are not official warnings, are not '
  + 'equivalent to any national weather service’s warning levels, and are not a substitute for official '
  + 'warnings or emergency instructions. A lack of a warning does not mean an area is safe.';

/* ── tiny per-IP rate limiter ─────────────────────────────────────────── */
function rateLimit(perMinute) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60e3).unref?.();
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'x';
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    if (n > perMinute) return res.status(429).json({ error: 'Too many requests — slow down.' });
    next();
  };
}

/* ── shaping ──────────────────────────────────────────────────────────── */

/** Summary for lists: no version history, no verification logs. */
export function summarise(w, now = Date.now()) {
  return {
    id: w.id, isTest: !!w.isTest, status: w.status, state: w.state, severity: w.severity,
    title: w.title, summary: w.summary, description: w.description, areaLabel: w.areaLabel,
    places: (w.places || []).slice(0, 8), countries: w.countries, countryCodes: w.countryCodes,
    continents: w.continents, admin1: w.admin1, admin2: w.admin2,
    issuedAt: w.issuedAt, validFrom: w.validFrom, expiresAt: w.expiresAt, updatedAt: w.updatedAt,
    endedAt: w.endedAt || null, endReason: w.endReason || null,
    remainingMin: w.status === 'active' ? Math.max(0, Math.round((w.expiresAt - now) / 60e3)) : null,
    centroid: w.centroid, areaKm2: w.areaKm2, geometry: w.geometry,
    confidence: w.confidence, coverage: w.coverage, dataStale: !!w.dataStale,
    tz: w.tz, tzLabel: w.tzLabel, model: w.model?.version || null,
  };
}

/** Everything the map needs to draw a warning. */
function forMap(w, now) {
  return {
    ...summarise(w, now),
    forecast: w.forecast, corridor: w.corridor, track: w.track, peakAt: w.peakAt,
    evidence: w.evidence, reasons: w.reasons, confidenceReasons: w.confidenceReasons,
    geography: w.geography,
  };
}

function full(w, now) {
  const s = getState();
  return {
    ...forMap(w, now),
    versions: w.versions || [],
    events: s.events.filter((e) => e.warningId === w.id).length
      ? s.events.filter((e) => e.warningId === w.id)
      : readEventsFor(w.id),
    verification: w.verification || null,
    trackLog: w.trackLog || [],
    dataQuality: w.dataQuality, expiryBasis: w.expiryBasis, relatedTo: w.relatedTo || null,
    predictedExpiresAt: w.predictedExpiresAt, configUsed: w.configUsed || null,
    disclaimer: DISCLAIMER,
  };
}

function readEventsFor(id) {
  const dir = path.join(AIW_DIR, 'warnings');
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.startsWith('events-')); } catch { return out; }
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (line && line.includes(id)) { try { const e = JSON.parse(line); if (e.warningId === id) out.push(e); } catch { /* skip */ } }
    }
  }
  return out;
}

function csvParam(v) {
  if (!v) return [];
  return String(v).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
}

function audit(req, action, detail) {
  const s = getState();
  const entry = { id: crypto.randomUUID(), at: Date.now(), actor: req.user?.email || req.user?.id || 'admin', action, detail };
  s.audit.push(entry);
  if (s.audit.length > 5000) s.audit.splice(0, s.audit.length - 5000);
  try {
    fs.mkdirSync(path.join(AIW_DIR, 'warnings'), { recursive: true });
    fs.appendFileSync(path.join(AIW_DIR, 'warnings', `audit-${new Date().toISOString().slice(0, 7)}.ndjson`), JSON.stringify(entry) + '\n');
  } catch { /* logged in state regardless */ }
  saveState({ now: true });
  return entry;
}

/* ── router ───────────────────────────────────────────────────────────── */

export function createRouter({ engine, ingest }) {
  const r = express.Router();
  const pub = rateLimit(240);
  const clients = new Set();
  let trainJob = null;

  const broadcast = (msg) => {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) { try { res.write(data); } catch { clients.delete(res); } }
  };

  r.get('/status', pub, (req, res) => {
    const s = getState();
    const now = Date.now();
    const feeds = ingest.status(now);
    const info = engine.modelInfo();
    res.json({
      now,
      disclaimer: DISCLAIMER,
      paused: !!s.paused, pausedReason: s.pausedReason || null,
      feeds: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, {
        name: v.name, status: v.status, sockets: v.sockets, lastStrikeAgeMs: v.lastStrikeAgeMs, licence: v.licence,
      }])),
      issuing: !s.paused && Object.values(feeds).some((f) => f.status === 'live'),
      engine: { lastCycleAt: engine.status.lastCycleAt, lastCycleMs: engine.status.lastCycleMs, storms: engine.status.tracksLive, assessed: engine.status.assessed, ok: !engine.status.lastError },
      model: { version: info.version, kind: info.kind, trained: info.trained, validated: info.skillPositive },
      coverage: COVERAGE.map((c) => ({ id: c.id, quality: c.quality, bbox: c.bbox })),
      inputs: {
        lightning: 'Blitzortung.org (live, community network)',
        environment: 'Open-Meteo model atmosphere: CAPE, lifted index, CIN, 700 hPa steering wind, 0–6 km shear, convective precipitation',
        radar: 'not integrated',
        satellite: 'not integrated',
        geography: gazetteerSource(),
      },
      counts: countBySeverity(s.warnings.filter((w) => w.status === 'active' && !w.isTest)),
    });
  });

  r.get('/active', pub, (req, res) => {
    const now = Date.now();
    const includeTest = req.query.includeTest === '1';
    const items = getState().warnings
      .filter((w) => w.status === 'active' && (includeTest || !w.isTest))
      .sort((a, b) => levelRank(b.severity) - levelRank(a.severity))
      .map((w) => forMap(w, now));
    res.json({ now, items });
  });

  r.get('/warnings', pub, (req, res) => {
    const now = Date.now();
    const q = req.query;
    const statuses = csvParam(q.status);
    const sevs = csvParam(q.severity).filter((x) => ['yellow', 'amber', 'red'].includes(x));
    const continents = csvParam(q.continent); const countries = csvParam(q.country);
    const admin1 = csvParam(q.admin1); const admin2 = csvParam(q.admin2);
    const text = String(q.q || '').trim().toLowerCase().slice(0, 80);
    const includeTest = q.includeTest === '1';
    const recent = String(q.recent || '');
    const page = Math.max(1, Math.min(10000, Number(q.page) || 1));
    const pageSize = Math.max(5, Math.min(100, Number(q.pageSize) || 20));
    const sinceMs = Number(q.since) || 0;

    let list = allWarnings().filter((w) => includeTest || !w.isTest);
    // Facets are computed BEFORE the geographical filters so the dropdowns
    // always show every area that has warnings to choose from.
    const facetBase = list.filter((w) => (!statuses.length || statuses.includes(statusOf(w, now)))
      && (!sevs.length || sevs.includes(w.severity)));
    list = facetBase
      .filter((w) => !continents.length || (w.continents || []).some((c) => continents.includes(c)))
      .filter((w) => !countries.length || (w.countryCodes || []).some((c) => countries.includes(c)) || (w.countries || []).some((c) => countries.includes(c)))
      .filter((w) => !admin1.length || (w.admin1 || []).some((c) => admin1.includes(c)))
      .filter((w) => !admin2.length || (w.admin2 || []).some((c) => admin2.includes(c)))
      .filter((w) => !text || [w.title, w.areaLabel, ...(w.places || []), ...(w.countries || []), ...(w.admin1 || []), ...(w.admin2 || []), w.id]
        .some((v) => String(v || '').toLowerCase().includes(text)))
      .filter((w) => !sinceMs || w.issuedAt >= sinceMs)
      .filter((w) => (recent === 'issued' ? now - w.issuedAt < 2 * 3600e3 : recent === 'updated' ? now - (w.updatedAt || 0) < 30 * 60e3 : true));
    if (q.near) {
      const [lat, lon] = String(q.near).split(',').map(Number);
      const km = Math.min(500, Number(q.radiusKm) || 50);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        list = list.filter((w) => (w.geometry && pointInGeo(lon, lat, w.geometry)) || (w.centroid && haversineKm(lat, lon, w.centroid[0], w.centroid[1]) <= km));
      }
    }
    const sort = String(q.sort || 'issued');
    list.sort((a, b) => {
      if (sort === 'severity') return levelRank(b.severity) - levelRank(a.severity) || b.issuedAt - a.issuedAt;
      if (sort === 'expiry') return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.expiresAt - b.expiresAt;
      if (sort === 'updated') return (b.updatedAt || 0) - (a.updatedAt || 0);
      return b.issuedAt - a.issuedAt;
    });
    const total = list.length;
    res.json({
      now, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)),
      items: list.slice((page - 1) * pageSize, page * pageSize).map((w) => summarise(w, now)),
      facets: facets(facetBase),
      counts: countBySeverity(list),
      coverage: COVERAGE.map((c) => ({ id: c.id, quality: c.quality })),
    });
  });

  r.get('/warnings/:id', pub, (req, res) => {
    const id = String(req.params.id).slice(0, 40);
    const w = findWarning(id);
    if (!w) return res.status(404).json({ error: 'No such warning' });
    res.json(full(w, Date.now()));
  });

  r.get('/announcements', pub, (req, res) => {
    const since = Number(req.query.since) || Date.now() - 30 * 60e3;
    const includeTest = req.query.includeTest === '1';
    res.json({ now: Date.now(), items: getState().announcements.filter((a) => a.at > since && (includeTest || !a.isTest)).slice(-100) });
  });

  r.get('/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'hello', now: Date.now() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  });

  r.get('/places', pub, (req, res) => res.json({ items: searchPlaces(req.query.q, 10) }));

  r.get('/check', pub, (req, res) => {
    const lat = Number(req.query.lat); const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'lat/lon required' });
    const now = Date.now();
    const cov = coverageAt(lat, lon);
    const over = []; const approaching = []; const nearby = [];
    for (const w of getState().warnings) {
      if (w.status !== 'active' || w.isTest) continue;
      if (w.geometry && pointInGeo(lon, lat, w.geometry)) { over.push({ ...summarise(w, now), geometry: undefined }); continue; }
      const f = (w.forecast || []).find((fc) => fc.geometry && pointInGeo(lon, lat, fc.geometry));
      if (f) { approaching.push({ ...summarise(w, now), geometry: undefined, arrivesInMin: f.lead }); continue; }
      if (w.centroid && haversineKm(lat, lon, w.centroid[0], w.centroid[1]) < 100) nearby.push({ ...summarise(w, now), geometry: undefined, distanceKm: Math.round(haversineKm(lat, lon, w.centroid[0], w.centroid[1])) });
    }
    res.json({ now, coverage: cov.quality, over, approaching, nearby });
  });

  /* ── admin ── */
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.use(express.json({ limit: '64kb' }));

  admin.get('/overview', (req, res) => {
    const s = getState();
    const models = (s.models || []).slice(-20).reverse();
    const active = s.activeModel ? readJson(path.join(MODEL_DIR, `${s.activeModel}.json`), null) : null;
    const latest = models[0] ? readJson(path.join(MODEL_DIR, `${models[0].version}.json`), null) : null;
    res.json({
      now: Date.now(), paused: !!s.paused, pausedReason: s.pausedReason || null,
      health: s.health, engine: engine.status, model: engine.modelInfo(),
      activeModel: active ? { version: active.version, metrics: active.metrics, data: active.data, gate: active.gate, weights: active.weights, features: active.features } : null,
      latestModel: latest ? { version: latest.version, metrics: latest.metrics, data: latest.data, gate: latest.gate, status: latest.status, cellRatePercentiles: latest.cellRatePercentiles, suggestedThresholds: deriveThresholds(latest) } : null,
      models, archive: archiveSummary(), trainJob,
      config: getConfig(), defaults: DEFAULT_CONFIG,
      audit: s.audit.slice(-100).reverse(),
      announcements: s.announcements.slice(-60).reverse(),
      events: s.events.slice(-150).reverse(),
      active: s.warnings.filter((w) => w.status === 'active').map((w) => ({
        ...summarise(w), geometry: undefined, reasons: w.reasons, evidence: w.evidence, confidenceReasons: w.confidenceReasons,
      })),
      verification: allWarnings().filter((w) => w.verification?.byLead).slice(-50).map((w) => ({ id: w.id, severity: w.severity, issuedAt: w.issuedAt, verification: w.verification })),
    });
  });

  admin.get('/tracks', (req, res) => {
    const now = Date.now();
    res.json({
      now,
      items: [...engine.tracks.values()].filter((t) => !t.dead).map((t) => ({
        id: t.id, lat: t.lat, lon: t.lon, n10: t.n10, cycles: t.cycles, radiusKm: Math.round(t.radiusKm),
        speedKmh: t.motion ? Math.round(t.motion.speedKmh) : null, motionSources: t.motion?.sources || [],
        coverage: t.coverage, lastSeenAgoS: Math.round((now - t.lastSeen) / 1000), hysteresis: t.hyst || null,
        lastAssessment: t.lastAssessment || null,
      })),
    });
  });

  admin.put('/config', (req, res) => {
    try {
      const before = getConfig();
      const next = setConfig(req.body || {});
      audit(req, 'config.update', { before, after: next });
      res.json({ ok: true, config: next });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  admin.post('/pause', (req, res) => {
    const s = getState();
    s.paused = !!req.body?.paused;
    s.pausedReason = s.paused ? String(req.body?.reason || 'paused by administrator').slice(0, 300) : null;
    audit(req, s.paused ? 'issuance.pause' : 'issuance.resume', { reason: s.pausedReason });
    broadcast({ type: 'status', paused: s.paused });
    res.json({ ok: true, paused: s.paused });
  });

  admin.post('/warnings/:id/cancel', (req, res) => {
    const s = getState();
    const w = s.warnings.find((x) => x.id === req.params.id && x.status === 'active');
    if (!w) return res.status(404).json({ error: 'No active warning with that id' });
    const reason = String(req.body?.reason || 'cancelled by administrator').slice(0, 300);
    endWarning(w, 'cancelled', `administrator: ${reason}`, Date.now(), null, req.user?.email || 'admin');
    if (!w.verification) w.verification = { skipped: 'cancelled by administrator' };
    audit(req, 'warning.cancel', { id: w.id, reason });
    broadcast({ type: 'cycle', at: Date.now(), changed: [w.id] });
    res.json({ ok: true });
  });

  admin.post('/test-warning', (req, res) => {
    const b = req.body || {};
    const lat = Number(b.lat); const lon = Number(b.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return res.status(400).json({ error: 'valid lat and lon required' });
    try {
      const w = issueTestWarning({
        lat, lon, severity: b.severity,
        speedKmh: Math.max(0, Math.min(120, Number(b.speedKmh) || 40)),
        towardDeg: ((Number(b.towardDeg) || 60) % 360 + 360) % 360,
        radiusKm: Math.max(5, Math.min(60, Number(b.radiusKm) || 18)),
        durationMin: Math.max(5, Math.min(120, Number(b.durationMin) || 20)),
      }, req.user?.email || 'admin');
      audit(req, 'warning.test-issue', { id: w.id, severity: w.severity, lat, lon });
      broadcast({ type: 'cycle', at: Date.now(), changed: [w.id] });
      res.json({ ok: true, warning: summarise(w) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  function startTraining({ deploy, reason }) {
    if (trainJob?.status === 'running') return null;
    const args = [path.join(here, 'train.js')];
    if (deploy) args.push('--deploy');
    trainJob = { status: 'running', startedAt: Date.now(), log: [], deploy: !!deploy, reason };
    // A separate process: training replays hours of data and must never
    // stall the website or the live warning cycle.
    const child = spawn(process.execPath, args, { cwd: path.join(here, '..', '..'), env: { ...process.env, AIW_SPAWNED: '1' } });
    const onData = (d) => { for (const line of String(d).split('\n')) if (line.trim()) { trainJob.log.push(line); if (trainJob.log.length > 200) trainJob.log.shift(); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('close', (code) => {
      trainJob.status = code === 0 ? 'finished' : 'failed';
      trainJob.endedAt = Date.now();
      // The child wrote only its model file; this process owns the registry.
      let files = [];
      try { files = fs.readdirSync(MODEL_DIR).filter((f) => f.endsWith('.json')); } catch { /* none */ }
      for (const f of files) {
        const rec = readJson(path.join(MODEL_DIR, f), null);
        if (rec?.createdAt >= trainJob.startedAt) { registerModel(rec); trainJob.result = { version: rec.version, status: rec.status, gate: rec.gate }; }
      }
      saveState({ now: true });
      engine.loadModel();
    });
    return trainJob;
  }

  admin.post('/train', (req, res) => {
    const job = startTraining({ deploy: !!req.body?.deploy, reason: 'administrator' });
    if (!job) return res.status(409).json({ error: 'Training already running', trainJob });
    audit(req, 'model.train', { deploy: !!req.body?.deploy });
    res.json({ ok: true, trainJob: job });
  });

  admin.post('/models/:version/deploy', (req, res) => {
    const s = getState();
    const v = String(req.params.version);
    if (v === 'baseline') {
      s.activeModel = null;
    } else {
      const spec = readJson(path.join(MODEL_DIR, `${v}.json`), null);
      if (!spec) return res.status(404).json({ error: 'No such model' });
      if (!spec.gate?.passed && !req.body?.force) {
        return res.status(400).json({ error: `Model did not pass the deployment gate: ${spec.gate?.failures?.join('; ')}. Send force:true to deploy anyway.` });
      }
      s.activeModel = v;
      const entry = (s.models || []).find((m) => m.version === v);
      if (entry) entry.status = 'deployed';
    }
    engine.loadModel();
    audit(req, 'model.deploy', { version: v, forced: !!req.body?.force });
    res.json({ ok: true, active: engine.modelInfo() });
  });

  r.use('/admin', admin);
  return { router: r, broadcast, startTraining, getTrainJob: () => trainJob };
}

function statusOf(w, now) {
  if (w.status === 'active' && w.validFrom > now) return 'upcoming';
  return w.status; // active | expired | cancelled
}

function countBySeverity(list) {
  const c = { yellow: 0, amber: 0, red: 0, total: list.length };
  for (const w of list) if (c[w.severity] != null) c[w.severity] += 1;
  return c;
}

function facets(list) {
  const cont = {}; const country = {}; const a1 = {}; const a2 = {};
  for (const w of list) {
    for (const c of w.continents || []) cont[c] = (cont[c] || 0) + 1;
    (w.countryCodes || []).forEach((cc, i) => {
      const k = cc; country[k] = country[k] || { code: cc, name: w.countries?.[i] || cc, continent: w.continents?.[0] || null, n: 0 };
      country[k].n += 1;
    });
    for (const x of w.admin1 || []) { a1[x] = a1[x] || { name: x, country: w.countryCodes?.[0], n: 0 }; a1[x].n += 1; }
    for (const x of w.admin2 || []) { a2[x] = a2[x] || { name: x, country: w.countryCodes?.[0], admin1: w.admin1?.[0], n: 0 }; a2[x].n += 1; }
  }
  return {
    continents: Object.entries(cont).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    countries: Object.values(country).sort((a, b) => b.n - a.n),
    admin1: Object.values(a1).sort((a, b) => b.n - a.n).slice(0, 300),
    admin2: Object.values(a2).sort((a, b) => b.n - a.n).slice(0, 500),
  };
}
