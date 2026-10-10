/**
 * Weather Scenarios — pure query logic (no React, no fetch).
 *
 * Kept dependency-free so the server test suite can import it directly and
 * check that filtering, search, the matrix and the month/season summaries
 * all derive from the same scenario records the page shows.
 */

export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const FREQ_RANK = { C: 4, P: 3, U: 2, R: 1, '-': 0 };
export const SEV_RANK = { low: 1, moderate: 2, high: 3, 'very-high': 4 };

/* Familiar words → the terms used in the records. Each entry expands a
   query word into extra words to look for, so people do not need to know the
   technical name ("beast from the east" finds easterly snow, "twister" finds
   tornadoes). Aliases on the records themselves do most of the work; this
   covers everyday vocabulary that spans many records. */
export const SYNONYMS = {
  beast: ['easterly', 'continental', 'siberian'],
  twister: ['tornado'], tornadoes: ['tornado'], whirlwind: ['tornado'],
  heatwave: ['heat', 'hot'], 'heat wave': ['heat'], scorcher: ['heat', 'hot'], hot: ['heat'],
  thunder: ['thunderstorm', 'lightning', 'convective'], thunderstorms: ['thunderstorm'], storms: ['storm'],
  lightning: ['thunderstorm', 'lightning'],
  snow: ['snow', 'blizzard', 'sleet'], blizzard: ['blizzard', 'snow', 'drift'],
  ice: ['ice', 'icy', 'glaze', 'freezing'], icy: ['ice'], 'black ice': ['ice'],
  flood: ['flood', 'flooding'], floods: ['flood'], flooding: ['flood'],
  rain: ['rain', 'rainfall', 'downpour'], downpour: ['rain', 'convective'], deluge: ['rain', 'flood'],
  drought: ['drought', 'dry'], dry: ['dry', 'drought'],
  wind: ['wind', 'gale', 'gust', 'storm'], gale: ['gale', 'wind'], gales: ['gale'], windy: ['wind'], windstorm: ['storm', 'wind'],
  fog: ['fog', 'mist', 'haar', 'visibility'], mist: ['fog'], haar: ['fog', 'sea fog'],
  frost: ['frost', 'freezing'], frosty: ['frost'],
  'cold snap': ['cold', 'northerly', 'easterly'], cold: ['cold', 'freezing', 'frost'], freezing: ['freezing', 'frost', 'ice'],
  'jet stream': ['jet'], jet: ['jet'], block: ['block', 'blocking'], blocking: ['block'], 'blocking high': ['block', 'anticyclone'],
  anticyclone: ['high pressure', 'anticyclone'], 'high pressure': ['anticyclone', 'high'],
  'low pressure': ['depression', 'low', 'cyclone'], depression: ['low', 'depression'],
  hail: ['hail', 'graupel'], hailstorm: ['hail'],
  hurricane: ['ex-tropical', 'hurricane', 'tropical'],
  'atmospheric river': ['atmospheric river', 'moisture'],
  supercell: ['supercell', 'rotating'], supercells: ['supercell'],
  'heavy rain': ['rain', 'flood', 'downpour'], muggy: ['humid', 'humidity'], humid: ['humid'],
  mild: ['mild', 'warm'], warm: ['warm', 'mild'], sunny: ['sunshine', 'anticyclone'], sunshine: ['sunshine'],
  surge: ['surge', 'coastal'], waves: ['wave', 'coastal'],
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Expand a free-text query into weighted terms. */
export function expandQuery(q) {
  const text = norm(q).trim();
  if (!text) return [];
  const words = text.split(/[^a-z0-9-]+/).filter((w) => w.length > 1);
  const terms = [{ t: text, w: 3 }];
  for (const w of words) terms.push({ t: w, w: 1.5 });
  for (const [k, extra] of Object.entries(SYNONYMS)) {
    if (text === k || text.includes(k)) for (const e of extra) terms.push({ t: e, w: 1 });
  }
  const seen = new Set();
  return terms.filter((x) => (seen.has(x.t) ? false : seen.add(x.t)));
}

/** Score one scenario against expanded terms (0 = no match). */
export function scoreScenario(s, terms) {
  if (!terms.length) return 1;
  const name = norm(s.name);
  const aka = (s.aka || []).map(norm);
  const q = s.q || norm([s.name, ...(s.aka || []), s.summary].join(' '));
  let score = 0;
  let wordHits = 0;
  const words = terms.filter((t) => t.w === 1.5);
  for (const { t, w } of terms) {
    if (name === t) score += 20 * w;
    else if (name.includes(t)) score += 8 * w;
    if (aka.some((a) => a === t)) score += 12 * w;
    else if (aka.some((a) => a.includes(t))) score += 5 * w;
    if (q.includes(t)) { score += 2 * w; if (w === 1.5) wordHits += 1; }
  }
  // Multi-word queries: require most words to appear somewhere, unless the
  // whole phrase or a synonym matched the name/aliases strongly.
  if (words.length > 1 && wordHits < Math.ceil(words.length * 0.6) && score < 20) return 0;
  return score;
}

/**
 * Apply all filters. Every filter is optional; multiple values within one
 * filter are OR, different filters are AND (e.g. thunder AND July AND
 * South East England).
 */
export function filterScenarios(scenarios, f = {}) {
  const terms = expandQuery(f.q);
  const minFreq = f.minFreq ? FREQ_RANK[f.minFreq] : 1;
  const months = (f.months || []).map((m) => (typeof m === 'number' ? m : MONTH_KEYS.indexOf(m))).filter((m) => m >= 0);
  const out = [];
  for (const s of scenarios) {
    if (f.categories?.length && !f.categories.some((c) => c === s.cat || (s.also || []).includes(c))) continue;
    if (f.kinds?.length && !f.kinds.includes(s.kind)) continue;
    if (f.severity?.length && !f.severity.includes(s.sev)) continue;
    if (f.temps?.length && !f.temps.includes(s.temp)) continue;
    if (f.precip?.length && !f.precip.some((p) => (s.precip || []).includes(p))) continue;
    if (f.circulation?.length && !f.circulation.some((c) => (s.circ || []).includes(c) || (s.circ || []).includes('any'))) continue;
    if (months.length) {
      if (!months.some((m) => FREQ_RANK[s.months[m]] >= minFreq)) continue;
    } else if (f.minFreq && !Object.values(s.months).some((c) => FREQ_RANK[c] >= minFreq)) continue;
    if (f.seasons?.length) {
      const sm = f.seasons.flatMap((id) => SEASON_MONTHS[id] || []);
      if (!sm.some((m) => FREQ_RANK[s.months[m]] >= Math.max(minFreq, 1))) continue;
    }
    if (f.regions?.length) {
      const need = f.regionMin || 2;
      if (!f.regions.some((r) => (s.regions?.[r] || 0) >= need)) continue;
    }
    const score = scoreScenario(s, terms);
    if (!score) continue;
    out.push({ s, score });
  }
  return out;
}

export const SEASON_MONTHS = { winter: [11, 0, 1], spring: [2, 3, 4], summer: [5, 6, 7], autumn: [8, 9, 10] };

export function sortResults(results, sort = 'relevance', ctx = {}) {
  const m = ctx.month != null ? ctx.month : null;
  const byName = (a, b) => a.s.name.localeCompare(b.s.name);
  const cmp = {
    relevance: (a, b) => b.score - a.score || (m != null ? FREQ_RANK[b.s.months[m]] - FREQ_RANK[a.s.months[m]] : 0) || byName(a, b),
    name: byName,
    severity: (a, b) => SEV_RANK[b.s.sev] - SEV_RANK[a.s.sev] || byName(a, b),
    frequency: (a, b) => (m != null
      ? FREQ_RANK[b.s.months[m]] - FREQ_RANK[a.s.months[m]]
      : maxFreq(b.s) - maxFreq(a.s) || monthsActive(b.s) - monthsActive(a.s)) || byName(a, b),
    category: (a, b) => (ctx.catOrder ? ctx.catOrder.indexOf(a.s.cat) - ctx.catOrder.indexOf(b.s.cat) : a.s.cat.localeCompare(b.s.cat)) || byName(a, b),
  }[sort] || ((a, b) => b.score - a.score);
  return [...results].sort(cmp);
}
const maxFreq = (s) => Math.max(...[...s.months].map((c) => FREQ_RANK[c]));
const monthsActive = (s) => [...s.months].filter((c) => FREQ_RANK[c] >= 2).length;

/** All scenarios relevant to month m (index), grouped by frequency label. */
export function monthCatalogue(scenarios, m) {
  const groups = { C: [], P: [], U: [], R: [] };
  for (const s of scenarios) {
    const code = s.months[m];
    if (groups[code]) groups[code].push(s);
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || a.name.localeCompare(b.name));
  return groups;
}

/** Summary counts for a month, computed from the records. */
export function monthStats(scenarios, m) {
  const g = monthCatalogue(scenarios, m);
  const relevant = g.C.length + g.P.length + g.U.length + g.R.length;
  const cats = {};
  for (const s of [...g.C, ...g.P, ...g.U, ...g.R]) cats[s.cat] = (cats[s.cat] || 0) + 1;
  const hazards = [...g.C, ...g.P].filter((s) => SEV_RANK[s.sev] >= 3 && (s.kind === 'hazard' || s.kind === 'scenario'));
  return { relevant, common: g.C.length, plausible: g.P.length, uncommon: g.U.length, rare: g.R.length, cats, hazards };
}

/** What changes between two months: scenarios that become more or less typical. */
export function monthDelta(scenarios, from, to) {
  const rising = [];
  const falling = [];
  for (const s of scenarios) {
    const a = FREQ_RANK[s.months[from]];
    const b = FREQ_RANK[s.months[to]];
    if (b - a >= 2 || (a < 3 && b >= 3)) rising.push(s);
    else if (a - b >= 2 || (a >= 3 && b < 3)) falling.push(s);
  }
  const bySev = (x, y) => SEV_RANK[y.sev] - SEV_RANK[x.sev] || x.name.localeCompare(y.name);
  return { rising: rising.sort(bySev), falling: falling.sort(bySev) };
}

/** A season summary composed from its constituent months (never authored
    separately, so it cannot contradict the monthly catalogue). */
export function seasonSummary(scenarios, seasonId) {
  const ms = SEASON_MONTHS[seasonId];
  const rows = [];
  for (const s of scenarios) {
    const codes = ms.map((m) => s.months[m]);
    const best = Math.max(...codes.map((c) => FREQ_RANK[c]));
    if (best >= 1) rows.push({ s, codes, best });
  }
  rows.sort((a, b) => b.best - a.best || SEV_RANK[b.s.sev] - SEV_RANK[a.s.sev] || a.s.name.localeCompare(b.s.name));
  const common = rows.filter((r) => r.best === 4);
  const hazards = rows.filter((r) => r.best >= 3 && SEV_RANK[r.s.sev] >= 3);
  const rare = rows.filter((r) => r.best <= 2 && SEV_RANK[r.s.sev] >= 3);
  return { rows, common, hazards, rare };
}

/** Matrix rows for the annual calendar. */
export function matrixRows(scenarios) {
  return scenarios.map((s) => ({ id: s.id, name: s.name, cat: s.cat, codes: [...s.months] }));
}

/** Side-by-side comparison derived from the records themselves. */
export function compareScenarios(records) {
  const fields = [
    ['Kind', (r) => r.kind], ['Category', (r) => r.cat], ['Severity', (r) => r.sev], ['Temperature', (r) => r.temp],
    ['Precipitation', (r) => (r.precip || []).join(', ')], ['Circulation', (r) => (r.circ || []).join(', ')],
  ];
  const diffs = fields.map(([label, get]) => {
    const vals = records.map(get);
    return { label, values: vals, differs: new Set(vals).size > 1 };
  });
  const monthOverlap = MONTH_KEYS.map((_, m) => records.map((r) => r.months[m]));
  const sharedRegions = records.length
    ? Object.keys(records[0].regions || {}).filter((rg) => records.every((r) => (r.regions?.[rg] || 0) >= 2))
    : [];
  return { diffs, monthOverlap, sharedRegions };
}

/** Events filtered by year range, month, category and region. */
export function filterEvents(events, f = {}, regionGroups = {}) {
  return events.filter((e) => {
    const y = +e.start.slice(0, 4);
    if (f.from && y < f.from) return false;
    if (f.to && y > f.to) return false;
    if (f.month != null && f.month !== '') {
      const sm = +e.start.slice(5, 7) - 1;
      const em = +e.end.slice(5, 7) - 1;
      const span = e.start.slice(0, 7) === e.end.slice(0, 7) ? [sm] : spanMonths(e.start, e.end);
      if (!span.includes(+f.month) && sm !== +f.month && em !== +f.month) return false;
    }
    if (f.category && !(e.categories || []).includes(f.category)) return false;
    if (f.region) {
      const ids = (e.regions || []).flatMap((r) => regionGroups[r] || [r]);
      if (!ids.includes(f.region)) return false;
    }
    if (f.scenario && !(e.scenarios || []).includes(f.scenario)) return false;
    return true;
  });
}
function spanMonths(start, end) {
  const out = [];
  let y = +start.slice(0, 4); let m = +start.slice(5, 7) - 1;
  const ey = +end.slice(0, 4); const em = +end.slice(5, 7) - 1;
  for (let i = 0; i < 24 && (y < ey || (y === ey && m <= em)); i += 1) {
    out.push(m); m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/** Library-wide headline numbers, always computed from the records. */
export function overviewStats(scenarios, events, month) {
  const cats = {};
  for (const s of scenarios) cats[s.cat] = (cats[s.cat] || 0) + 1;
  const m = monthStats(scenarios, month);
  return { total: scenarios.length, events: events.length, cats, month: m };
}
