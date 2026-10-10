/**
 * Weather Scenarios API.
 *
 * Public
 *   GET /api/scenarios/catalogue         light index (gzip, ETag)
 *   GET /api/scenarios/item/:id          one full record
 *   GET /api/scenarios/regions.geo.json  region boundaries (gzip)
 *   GET /api/scenarios/tables            the normalised relationship tables
 *
 * Admin (existing auth, role 'admin'; every write audited)
 *   GET    /api/scenarios/admin/overview           validation report, edits, audit, link check
 *   GET    /api/scenarios/admin/record/:id         raw editable record (incl. unpublished)
 *   POST   /api/scenarios/admin/scenario           add a new scenario (id must be new)
 *   PUT    /api/scenarios/admin/scenario/:id       replace a scenario record
 *   DELETE /api/scenarios/admin/scenario/:id       drop an override (reverts to base)
 *   POST   /api/scenarios/admin/status/:id         { published, verified }
 *   PUT    /api/scenarios/admin/event/:id          add/replace a historical event (null deletes)
 *   PUT    /api/scenarios/admin/source/:id         add/correct a source record
 *   POST   /api/scenarios/admin/check-links        re-check every source URL
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { requireAdmin } from '../auth.js';
import {
  catalogue, invalidate, lightPayload, fullRecord, loadOverrides, saveOverrides,
  validateScenario, validateEvent, validateSource, BASE_SCENARIOS, buildCatalogue,
} from './store.js';
import { checkLinks } from './links.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const GEO = path.resolve(here, '../data/scenarios/regions.geo.json');

function sendGzipJson(req, res, { json, gz, etag }, maxAge = 300) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  res.setHeader('Vary', 'Accept-Encoding');
  if (etag) {
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
  }
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(gz);
  }
  return res.end(json);
}

let geoCache = null;
function geoPayload() {
  if (!geoCache) {
    const json = fs.readFileSync(GEO, 'utf8');
    geoCache = { json, gz: zlib.gzipSync(json, { level: 9 }), etag: `"geo-${fs.statSync(GEO).mtimeMs}"` };
  }
  return geoCache;
}

function audit(o, req, action, target, detail) {
  o.audit.push({ at: new Date().toISOString(), by: req.user?.email || 'unknown', action, target, detail: detail || null });
  o.audit = o.audit.slice(-500);
}

export function mountScenarios(app) {
  const r = express.Router();
  r.get('/catalogue', (req, res) => sendGzipJson(req, res, lightPayload()));
  r.get('/item/:id', (req, res) => {
    const rec = fullRecord(req.params.id);
    if (!rec) return res.status(404).json({ error: 'No such scenario' });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(rec);
  });
  r.get('/regions.geo.json', (req, res) => sendGzipJson(req, res, geoPayload(), 86400));
  r.get('/tables', (req, res) => {
    const c = catalogue();
    res.json({ version: c.version, ...c.tables, events: c.events.length, sources: c.sources.length });
  });

  /* ── admin ── */
  const admin = express.Router();
  admin.use(requireAdmin);
  admin.use(express.json({ limit: '256kb' }));

  admin.get('/overview', (req, res) => {
    const o = loadOverrides();
    const all = buildCatalogue({ overrides: o, includeUnpublished: true });
    res.json({
      version: all.version, problems: all.problems,
      counts: { scenarios: all.scenarios.length, events: all.events.length, sources: all.sources.length, base: BASE_SCENARIOS.length },
      scenarios: all.scenarios.map((s) => ({ id: s.id, name: s.name, cat: s.cat, origin: s.origin, published: s.published, verifiedAt: s.verifiedAt, verifiedBy: s.verifiedBy, sources: (s.sources || []).length })),
      edits: { scenarios: Object.keys(o.scenarios), events: Object.keys(o.events), sources: Object.keys(o.sources) },
      audit: o.audit.slice(-100).reverse(),
      linkCheck: o.linkCheck,
    });
  });

  admin.get('/record/:id', (req, res) => {
    const o = loadOverrides();
    const rec = o.scenarios[req.params.id] || BASE_SCENARIOS.find((s) => s.id === req.params.id);
    if (!rec) return res.status(404).json({ error: 'No such scenario' });
    const { origin, published, verifiedAt, verifiedBy, ...clean } = rec;
    res.json({ record: clean, status: o.status[req.params.id] || { published: true }, edited: !!o.scenarios[req.params.id] });
  });

  const ctxFor = (o, extraId) => {
    const c = buildCatalogue({ overrides: o, includeUnpublished: true });
    const ids = new Set([...BASE_SCENARIOS.map((s) => s.id), ...Object.keys(o.scenarios)]);
    if (extraId) ids.add(extraId);
    return { scenarioIds: ids, sourceIds: new Set(c.sources.map((s) => s.id)) };
  };

  function saveScenario(req, res, isNew) {
    const o = loadOverrides();
    const rec = req.body?.record;
    const id = isNew ? rec?.id : req.params.id;
    if (!rec || typeof rec !== 'object') return res.status(400).json({ error: 'Body must be { record: {...} }' });
    if (!isNew && rec.id !== id) return res.status(400).json({ error: 'Record id must match the URL; change ids by adding a new record.' });
    const exists = BASE_SCENARIOS.some((s) => s.id === id) || o.scenarios[id];
    if (isNew && exists) return res.status(409).json({ error: `A scenario with id "${id}" already exists.` });
    if (!isNew && !exists) return res.status(404).json({ error: 'No such scenario' });
    const errors = validateScenario(rec, ctxFor(o, id));
    if (errors.length) return res.status(422).json({ error: 'Validation failed', errors });
    o.scenarios[id] = rec;
    if (isNew) o.status[id] = { published: false };
    audit(o, req, isNew ? 'add-scenario' : 'edit-scenario', id);
    saveOverrides(o); invalidate();
    res.json({ ok: true, id, published: o.status[id]?.published !== false });
  }
  admin.post('/scenario', (req, res) => saveScenario(req, res, true));
  admin.put('/scenario/:id', (req, res) => saveScenario(req, res, false));
  admin.delete('/scenario/:id', (req, res) => {
    const o = loadOverrides();
    if (!o.scenarios[req.params.id]) return res.status(404).json({ error: 'No edit to revert' });
    delete o.scenarios[req.params.id];
    if (!BASE_SCENARIOS.some((s) => s.id === req.params.id)) delete o.status[req.params.id];
    audit(o, req, 'revert-scenario', req.params.id);
    saveOverrides(o); invalidate();
    res.json({ ok: true });
  });

  admin.post('/status/:id', (req, res) => {
    const o = loadOverrides();
    const id = req.params.id;
    if (!BASE_SCENARIOS.some((s) => s.id === id) && !o.scenarios[id]) return res.status(404).json({ error: 'No such scenario' });
    const st = { ...(o.status[id] || { published: true }) };
    if (typeof req.body?.published === 'boolean') st.published = req.body.published;
    if (req.body?.verified === true) { st.verifiedAt = new Date().toISOString(); st.verifiedBy = req.user?.email || null; }
    o.status[id] = st;
    audit(o, req, 'status', id, st);
    saveOverrides(o); invalidate();
    res.json({ ok: true, status: st });
  });

  admin.put('/event/:id', (req, res) => {
    const o = loadOverrides();
    const id = req.params.id;
    const ev = req.body?.event;
    if (ev === null) { o.events[id] = null; audit(o, req, 'delete-event', id); saveOverrides(o); invalidate(); return res.json({ ok: true }); }
    if (!ev || ev.id !== id) return res.status(400).json({ error: 'Body must be { event: {...} } with a matching id' });
    const errors = validateEvent(ev, ctxFor(o));
    if (errors.length) return res.status(422).json({ error: 'Validation failed', errors });
    o.events[id] = ev;
    audit(o, req, 'save-event', id);
    saveOverrides(o); invalidate();
    res.json({ ok: true });
  });

  admin.put('/source/:id', (req, res) => {
    const o = loadOverrides();
    const src = req.body?.source;
    if (!src || src.id !== req.params.id) return res.status(400).json({ error: 'Body must be { source: {...} } with a matching id' });
    const errors = validateSource(src);
    if (errors.length) return res.status(422).json({ error: 'Validation failed', errors });
    o.sources[src.id] = { title: src.title, url: src.url, publisher: src.publisher || '', kind: src.kind || 'other' };
    audit(o, req, 'save-source', src.id);
    saveOverrides(o); invalidate();
    res.json({ ok: true });
  });

  let linkJob = null;
  admin.post('/check-links', (req, res) => {
    if (linkJob) return res.status(202).json({ running: true });
    const c = catalogue();
    linkJob = checkLinks(c.sources).then((result) => {
      const o = loadOverrides();
      o.linkCheck = result;
      audit(o, req, 'check-links', null, { ok: result.ok, failed: result.failed.length });
      saveOverrides(o);
    }).catch(() => {}).finally(() => { linkJob = null; });
    res.status(202).json({ started: true });
  });

  r.use('/admin', admin);
  app.use('/api/scenarios', r);
}
