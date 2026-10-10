/**
 * Weather Scenarios — catalogue store.
 *
 * Source of truth: the authored records in server/scenarios/data (committed),
 * plus admin edits in server/data/scenarios-local/overrides.json (not
 * committed — it is live data, and its audit log holds admin emails).
 *
 * The authored format is compact (a 12-letter month string, region groups).
 * `buildCatalogue()` validates everything and normalises it into separate
 * tables, as the brief asks: scenarios, month links, region links,
 * ingredients, impacts, safety, relations, events, event links and sources.
 * The page reads a light index for speed and fetches one full record when a
 * scenario is opened.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIES, KINDS, FREQUENCY, FREQUENCY_NOTES, SEVERITY, TEMPERATURE_REGIMES, PRECIP_TYPES, CIRCULATION,
  SEASONS, MONTH_KEYS, MONTH_NAMES, REGIONS, REGION_GROUPS, RELEVANCE, seasonOfMonth,
} from './data/taxonomy.js';
import { SOURCES } from './data/sources.js';
import { EVENTS } from './data/events.js';
import { MONTHS, SEASON_TEXT } from './data/months.js';
import circulation from './data/scenarios/circulation.js';
import airmass from './data/scenarios/airmass.js';
import winter from './data/scenarios/winter.js';
import spring from './data/scenarios/spring.js';
import summer from './data/scenarios/summer.js';
import autumn from './data/scenarios/autumn.js';
import rain from './data/scenarios/rain.js';
import wind from './data/scenarios/wind.js';
import thunder from './data/scenarios/thunder.js';
import fog from './data/scenarios/fog.js';
import dry from './data/scenarios/dry.js';
import phenomena from './data/scenarios/phenomena.js';
import rare from './data/scenarios/rare.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '../data/scenarios');
const LOCAL_DIR = process.env.SCENARIOS_LOCAL_DIR || path.resolve(here, '../data/scenarios-local');
const OVERRIDES = path.join(LOCAL_DIR, 'overrides.json');

export const BASE_SCENARIOS = [
  ...circulation, ...airmass, ...winter, ...spring, ...summer, ...autumn,
  ...rain, ...wind, ...thunder, ...fog, ...dry, ...phenomena, ...rare,
];

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMPACT_KEYS = ['people', 'transport', 'aviation', 'infrastructure', 'property', 'agriculture', 'rivers', 'coast', 'power'];
const SETUP_KEYS = ['essential', 'favourable', 'pressure', 'airmass', 'jet', 'temperature', 'moisture', 'instability', 'shear', 'fronts', 'orography', 'other'];
const categoryIds = new Set(CATEGORIES.map((c) => c.id));
const regionIds = new Set(REGIONS.map((r) => r.id));

/* ── overrides (admin edits) ─────────────────────────────────────────── */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
/** OneDrive can briefly lock files; write-then-rename with an in-place fallback. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify(data, null, 1);
  const tmp = `${file}.tmp`;
  for (let i = 0; i < 4; i += 1) {
    try { fs.writeFileSync(tmp, body); fs.renameSync(tmp, file); return; } catch { /* retry */ }
  }
  fs.writeFileSync(file, body);
}
export function loadOverrides() {
  const o = readJson(OVERRIDES, null) || {};
  return { scenarios: o.scenarios || {}, events: o.events || {}, sources: o.sources || {}, status: o.status || {}, audit: o.audit || [], linkCheck: o.linkCheck || null };
}
export function saveOverrides(o) { writeJson(OVERRIDES, o); }

/* ── validation ──────────────────────────────────────────────────────── */
function expandRegions(spec) {
  const out = [];
  for (const [ref, level, reason] of spec || []) {
    const ids = REGION_GROUPS[ref] || (regionIds.has(ref) ? [ref] : null);
    if (!ids) { out.push({ error: `unknown region or group "${ref}"` }); continue; }
    for (const id of ids) out.push({ region: id, level, reason: reason || '' });
  }
  return out;
}

/**
 * Validate one scenario record against the taxonomy and the known ids.
 * Returns a list of human-readable problems (empty = valid).
 */
export function validateScenario(s, ctx) {
  const e = [];
  const req = (cond, msg) => { if (!cond) e.push(msg); };
  req(s && typeof s === 'object', 'record must be an object');
  if (!s || typeof s !== 'object') return e;
  req(typeof s.id === 'string' && ID_RE.test(s.id), `id "${s.id}" must be kebab-case`);
  req(typeof s.name === 'string' && s.name.trim().length >= 3, 'name is required');
  req(categoryIds.has(s.cat), `unknown category "${s.cat}"`);
  for (const c of s.also || []) req(categoryIds.has(c), `unknown secondary category "${c}"`);
  req(KINDS[s.kind], `unknown kind "${s.kind}"`);
  req(SEVERITY[s.sev], `unknown severity "${s.sev}"`);
  req(TEMPERATURE_REGIMES[s.temp], `unknown temperature regime "${s.temp}"`);
  for (const p of s.precip || []) req(PRECIP_TYPES[p] || p === 'any', `unknown precipitation type "${p}"`);
  for (const c of s.circ || []) req(CIRCULATION[c], `unknown circulation "${c}"`);
  req(typeof s.months === 'string' && s.months.length === 12, `months must be 12 codes (got "${s.months}")`);
  if (typeof s.months === 'string') {
    for (const ch of s.months) req(FREQUENCY[ch], `bad month code "${ch}"`);
    req(/[CPUR]/.test(s.months), 'at least one month must be relevant');
  }
  for (const k of Object.keys(s.monthNotes || {})) req(MONTH_KEYS.includes(k), `bad monthNotes key "${k}"`);
  req(typeof s.summary === 'string' && s.summary.length >= 40, 'summary is required (40+ chars)');
  req(Array.isArray(s.body) && s.body.length >= 1, 'body (explanation paragraphs) is required');
  const regions = expandRegions(s.regions);
  req(regions.length > 0, 'at least one region row is required');
  for (const r of regions) {
    if (r.error) e.push(r.error);
    else req(RELEVANCE[r.level], `bad relevance "${r.level}" for ${r.region}`);
  }
  req(s.setup && Array.isArray(s.setup.essential) && s.setup.essential.length > 0, 'setup.essential ingredients are required');
  for (const k of Object.keys(s.setup || {})) req(SETUP_KEYS.includes(k), `unknown setup field "${k}"`);
  for (const k of Object.keys(s.impacts || {})) req(IMPACT_KEYS.includes(k), `unknown impact field "${k}"`);
  req(Array.isArray(s.outcomes) && s.outcomes.length > 0, 'outcomes are required');
  req(typeof s.frequency === 'string' && s.frequency.length > 3, 'frequency description is required');
  if (ctx) {
    for (const r of s.related || []) req(ctx.scenarioIds.has(r), `related id "${r}" does not exist`);
    req((s.related || []).every((r) => r !== s.id), 'a scenario cannot relate to itself');
    const srcs = [...(s.sources || []), ...(s.safety || []).map((x) => x[1]), ...(s.stats || []).map((x) => x.source), ...((s.climate && s.climate.sources) || [])];
    for (const sid of srcs) req(ctx.sourceIds.has(sid), `source id "${sid}" does not exist`);
    req((s.sources || []).length > 0, 'at least one source is required');
  }
  for (const st of s.stats || []) req(st.text && st.source && st.period && st.scope, 'every statistic needs text, source, period and scope');
  for (const sig of s.signals || []) req(Array.isArray(sig) && sig.length === 3, 'signals must be [signal, use, limitation]');
  return e;
}

export function validateEvent(ev, ctx) {
  const e = [];
  const req = (cond, msg) => { if (!cond) e.push(msg); };
  req(typeof ev.id === 'string' && ID_RE.test(ev.id), `event id "${ev.id}" must be kebab-case`);
  req(ev.title, 'event title required');
  req(/^\d{4}-\d{2}-\d{2}$/.test(ev.start) && /^\d{4}-\d{2}-\d{2}$/.test(ev.end), 'event start/end must be YYYY-MM-DD');
  req(ev.start <= ev.end, 'event end must not precede start');
  req(ev.summary && ev.summary.length >= 30, 'event summary required');
  req((ev.sources || []).length > 0, 'events must cite at least one source');
  for (const sid of ev.sources || []) req(ctx.sourceIds.has(sid), `event source "${sid}" does not exist`);
  for (const sid of ev.scenarios || []) req(ctx.scenarioIds.has(sid), `event scenario "${sid}" does not exist`);
  for (const r of ev.regions || []) req(REGION_GROUPS[r] || regionIds.has(r), `event region "${r}" unknown`);
  for (const c of ev.categories || []) req(categoryIds.has(c), `event category "${c}" unknown`);
  return e;
}

export function validateSource(src) {
  const e = [];
  if (!src.id || !ID_RE.test(src.id)) e.push(`source id "${src.id}" must be kebab-case`);
  if (!src.title) e.push('source title required');
  if (!/^https:\/\//.test(src.url || '')) e.push('source url must be https');
  return e;
}

/* ── build ───────────────────────────────────────────────────────────── */
let cache = null;

export function buildCatalogue({ overrides = loadOverrides(), includeUnpublished = false } = {}) {
  const problems = [];

  // Sources: base + overrides (admin can correct a link or add a source).
  const sourceMap = new Map(SOURCES.map((s) => [s.id, { ...s }]));
  for (const [id, s] of Object.entries(overrides.sources)) sourceMap.set(id, { ...sourceMap.get(id), ...s, id, edited: true });
  for (const s of sourceMap.values()) for (const p of validateSource(s)) problems.push({ kind: 'source', id: s.id, problem: p });

  // Scenarios: base + overrides; status (published) tracked separately.
  const scenarioMap = new Map();
  const seen = new Set();
  for (const s of BASE_SCENARIOS) {
    if (seen.has(s.id)) problems.push({ kind: 'scenario', id: s.id, problem: 'duplicate scenario id in base data' });
    seen.add(s.id);
    scenarioMap.set(s.id, { ...s, origin: 'base' });
  }
  for (const [id, s] of Object.entries(overrides.scenarios)) {
    scenarioMap.set(id, { ...s, id, origin: scenarioMap.has(id) ? 'edited' : 'added' });
  }
  const ctx = { scenarioIds: new Set(scenarioMap.keys()), sourceIds: new Set(sourceMap.keys()) };

  const valid = [];
  for (const s of scenarioMap.values()) {
    const errs = validateScenario(s, ctx);
    for (const p of errs) problems.push({ kind: 'scenario', id: s.id, problem: p });
    const status = overrides.status[s.id] || {};
    const published = status.published !== false;
    if (!errs.length && (published || includeUnpublished)) valid.push({ ...s, published, verifiedAt: status.verifiedAt || null, verifiedBy: status.verifiedBy || null });
  }
  const validIds = new Set(valid.map((s) => s.id));

  // Events.
  const eventMap = new Map(EVENTS.map((e) => [e.id, { ...e }]));
  for (const [id, ev] of Object.entries(overrides.events)) {
    if (ev === null) eventMap.delete(id); else eventMap.set(id, { ...eventMap.get(id), ...ev, id, edited: true });
  }
  const events = [];
  for (const ev of eventMap.values()) {
    const errs = validateEvent(ev, ctx);
    for (const p of errs) problems.push({ kind: 'event', id: ev.id, problem: p });
    if (!errs.length) events.push({ ...ev, scenarios: (ev.scenarios || []).filter((x) => validIds.has(x)) });
  }
  events.sort((a, b) => a.start.localeCompare(b.start));

  // Normalised relationship tables.
  const tables = { monthLinks: [], regionLinks: [], ingredients: [], impacts: [], safety: [], relations: [], eventLinks: [], frequency: [] };
  for (const s of valid) {
    [...s.months].forEach((code, m) => {
      tables.monthLinks.push({ scenario: s.id, month: MONTH_KEYS[m], code, note: (s.monthNotes || {})[MONTH_KEYS[m]] || null });
    });
    const byRegion = new Map();
    for (const r of expandRegions(s.regions)) {
      const prev = byRegion.get(r.region);
      if (!prev || RELEVANCE[r.level].rank > RELEVANCE[prev.level].rank) byRegion.set(r.region, r);
    }
    for (const id of regionIds) {
      const r = byRegion.get(id);
      tables.regionLinks.push({ scenario: s.id, region: id, level: r ? r.level : 'low', reason: r ? r.reason : '', explicit: !!r });
    }
    for (const kind of ['essential', 'favourable']) for (const text of (s.setup || {})[kind] || []) tables.ingredients.push({ scenario: s.id, kind, text });
    for (const [area, text] of Object.entries(s.impacts || {})) tables.impacts.push({ scenario: s.id, area, text });
    for (const [text, source] of s.safety || []) tables.safety.push({ scenario: s.id, text, source });
    for (const r of s.related || []) if (validIds.has(r)) tables.relations.push({ from: s.id, to: r });
    tables.frequency.push({ scenario: s.id, description: s.frequency, stats: s.stats || [] });
  }
  for (const ev of events) for (const sid of ev.scenarios) tables.eventLinks.push({ event: ev.id, scenario: sid });

  // Symmetric related lists (A→B implies B lists A too) so links never dead-end.
  const relatedMap = new Map(valid.map((s) => [s.id, new Set()]));
  for (const { from, to } of tables.relations) { relatedMap.get(from).add(to); relatedMap.get(to)?.add(from); }
  const eventsByScenario = new Map();
  for (const l of tables.eventLinks) {
    if (!eventsByScenario.has(l.scenario)) eventsByScenario.set(l.scenario, []);
    eventsByScenario.get(l.scenario).push(l.event);
  }

  const climate = readJson(path.join(DATA_DIR, 'climate-1991-2020.json'), null);
  const version = crypto.createHash('sha1').update(JSON.stringify([valid, events, [...sourceMap.values()]])).digest('hex').slice(0, 12);

  return {
    version, builtAt: new Date().toISOString(), problems,
    scenarios: valid, events, sources: [...sourceMap.values()], tables, climate,
    relatedMap, eventsByScenario,
  };
}

export function catalogue() {
  if (!cache) cache = buildCatalogue();
  return cache;
}
export function invalidate() { cache = null; light = null; }

/* ── payloads ────────────────────────────────────────────────────────── */
function searchText(s) {
  return [s.name, ...(s.aka || []), s.summary, s.cat, ...(s.also || []), s.kind, ...(s.setup?.essential || []), ...(s.outcomes || [])]
    .join(' ').toLowerCase().replace(/\s+/g, ' ');
}

let light = null;
/** The light index the page loads first: everything needed for the month
    explorer, library, filters, matrix, map and comparisons-at-a-glance. */
export function lightPayload() {
  if (light) return light;
  const c = catalogue();
  const regionRank = (id) => {
    const out = {};
    for (const r of c.tables.regionLinks) if (r.scenario === id && r.explicit) out[r.region] = RELEVANCE[r.level].rank;
    return out;
  };
  const body = {
    version: c.version,
    taxonomy: {
      categories: CATEGORIES, kinds: KINDS, frequency: FREQUENCY, frequencyNotes: FREQUENCY_NOTES, severity: SEVERITY,
      temperature: TEMPERATURE_REGIMES, precip: PRECIP_TYPES, circulation: CIRCULATION, relevance: RELEVANCE,
      seasons: SEASONS, monthKeys: MONTH_KEYS, monthNames: MONTH_NAMES, regionGroups: REGION_GROUPS,
      regions: REGIONS.map((r) => ({ ...r, climateNames: r.climate.map((k) => c.climate?.series?.[k]?.name || k) })),
    },
    months: MONTHS.map((m, i) => ({ ...m, index: i, name: MONTH_NAMES[i], season: seasonOfMonth(i) })),
    seasonText: SEASON_TEXT,
    climate: c.climate,
    scenarios: c.scenarios.map((s) => ({
      id: s.id, name: s.name, aka: s.aka || [], cat: s.cat, also: s.also || [], kind: s.kind, sev: s.sev, temp: s.temp,
      precip: s.precip || [], circ: s.circ || [], months: s.months, monthNotes: s.monthNotes || {}, summary: s.summary,
      frequency: s.frequency, regions: regionRank(s.id), related: [...(c.relatedMap.get(s.id) || [])],
      events: c.eventsByScenario.get(s.id) || [], diagram: s.diagram || null, origin: s.origin, q: searchText(s),
    })),
    events: c.events.map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, regions: e.regions, categories: e.categories, scenarios: e.scenarios, summary: e.summary, observations: e.observations || [], sources: e.sources })),
    sources: c.sources.map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, url: s.url, kind: s.kind })),
  };
  const json = JSON.stringify(body);
  light = { json, gz: zlib.gzipSync(json, { level: 9 }), etag: `"${c.version}"` };
  return light;
}

/** Everything about one scenario, with its relations resolved. */
export function fullRecord(id) {
  const c = catalogue();
  const s = c.scenarios.find((x) => x.id === id);
  if (!s) return null;
  const sources = new Map(c.sources.map((x) => [x.id, x]));
  const regionRows = c.tables.regionLinks.filter((r) => r.scenario === id);
  return {
    ...s,
    regionRows,
    related: [...(c.relatedMap.get(id) || [])],
    events: c.events.filter((e) => e.scenarios.includes(id)),
    sourceRecords: [...new Set([...(s.sources || []), ...(s.safety || []).map((x) => x[1]), ...(s.stats || []).map((x) => x.source), ...((s.climate && s.climate.sources) || [])])]
      .map((sid) => sources.get(sid)).filter(Boolean),
  };
}
