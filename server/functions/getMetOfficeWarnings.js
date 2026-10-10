/**
 * Node port of the Base44 edge function `getMetOfficeWarnings`.
 *
 * The Base44 original scraped the Met Office accessible-warnings page and sent
 * the stripped text to an LLM to turn into JSON. That needed an LLM key and
 * could hallucinate a warning. This port parses the same page deterministically
 * and falls back to the Met Office RSS feed, so it needs no API key at all.
 *
 * Everything downstream is unchanged: warnings come back as
 *   { type, severity, regions[], description, validFrom, validTo, impacts }
 * and are merged into the single CachedWarnings record the way they were before
 * (fresh warnings first, then recently-expired ones for up to five days).
 */

import fetchNswwsWarnings, { hasNswwsKey } from './nswws.js';

/* ── refresh schedule ───────────────────────────────────────────────────────
 * Warnings refresh on the clock — never because someone opened the page.
 * Everyone therefore sees the same set, and the countdown on the page means
 * the same thing to every visitor.
 */
export const SLOT_MINUTES = 10;

/** The start of the slot `d` falls in.
 *
 *  Floored to the nearest multiple, rather than the old two-branch test that
 *  only ever produced :00 or :30. That was correct for a half-hour slot and
 *  silently wrong for any other length — at ten minutes it would have snapped
 *  everything from :10 to :59 onto :10. Works for any divisor of 60 now. */
export function slotStart(d = new Date()) {
  const s = new Date(d);
  s.setMinutes(Math.floor(s.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES, 0, 0);
  return s;
}

/** The next slot boundary strictly after `d`. */
export function nextSlot(d = new Date()) {
  const n = slotStart(d);
  n.setMinutes(n.getMinutes() + SLOT_MINUTES, 0, 0);
  return n;
}

const ACCESSIBLE_URL =
  'https://www.metoffice.gov.uk/weather/warnings-and-advice/accessible-uk-warnings';
const RSS_URL = 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK';
const MAP_URL = 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsMaps/UK';
const UA = 'Mozilla/5.0 (compatible; MyWeatherUK-selfhost/1.0)';

const KNOWN_TYPES = [
  'Rain', 'Wind', 'Snow', 'Ice', 'Thunderstorm', 'Thunderstorms',
  'Fog', 'Flood', 'Extreme Heat', 'Heat', 'Lightning',
];

/* ── small HTML helpers ─────────────────────────────────────────────────── */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
};

function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (ENTITIES[code] !== undefined) return ENTITIES[code];
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

const stripTags = (html) =>
  decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Pull the inner HTML of the first element carrying `className`. */
function sliceByClass(html, className) {
  const open = new RegExp(`<([a-z0-9]+)[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i');
  const m = open.exec(html);
  if (!m) return null;
  const tag = m[1];
  // Walk nested same-name tags so we stop at the matching close tag.
  const scanner = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
  scanner.lastIndex = m.index + m[0].length;
  let depth = 1;
  let hit;
  while ((hit = scanner.exec(html))) {
    depth += hit[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(m.index + m[0].length, hit.index);
  }
  return html.slice(m.index + m[0].length);
}

/** All inner-HTML chunks for elements carrying `className`. */
function allByClass(html, className) {
  const out = [];
  let rest = html;
  for (let guard = 0; guard < 200; guard += 1) {
    const chunk = sliceByClass(rest, className);
    if (chunk === null) break;
    out.push(chunk);
    const at = rest.indexOf(chunk);
    rest = rest.slice(at + chunk.length);
  }
  return out;
}

/* ── field extraction ───────────────────────────────────────────────────── */

function severityFrom(text) {
  const m = /\b(yellow|amber|red)\b/i.exec(text || '');
  if (!m) return 'Yellow';
  return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
}

const canonicalType = (t) => (t === 'Heat' ? 'Extreme Heat' : t);
// "extreme heat" must win over the bare "heat" entry, so always test longest first.
const TYPES_BY_LENGTH = [...KNOWN_TYPES].sort((a, b) => b.length - a.length);

function typeFrom(text) {
  const raw = String(text || '');

  // Prefer the type the Met Office names in the headline: "…warning of rain…".
  // Scanning the whole string would misread a rain warning whose description
  // mentions flooding as a Flood warning.
  const named = /warning\s+of\s+([a-z ]+?)(?:\s+affecting\b|[.,]|$)/i.exec(raw);
  if (named) {
    const phrase = named[1].trim().toLowerCase();
    for (const t of TYPES_BY_LENGTH) {
      if (phrase.includes(t.toLowerCase())) return canonicalType(t);
    }
  }

  const hay = raw.toLowerCase();
  for (const t of TYPES_BY_LENGTH) {
    if (hay.includes(t.toLowerCase())) return canonicalType(t);
  }
  return 'Other';
}

/**
 * Met Office period strings look like:
 *   "from 1500 on Thu 4 Sep to 2100 on Thu 4 Sep"
 *   "Thursday 04 September 15:00 – Friday 05 September 03:00"
 * Return ISO timestamps, or nulls when the shape is not recognised — the app
 * treats a null validFrom/validTo as "currently active" rather than crashing.
 */
function parsePeriod(text, now = new Date()) {
  const s = decodeEntities(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return { validFrom: null, validTo: null };

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Grab every "<time> on <day> <month>" / "<day> <month> <time>" occurrence.
  const stamps = [];
  const re = new RegExp(
    '(?:(\\d{1,2})[:.]?(\\d{2})\\s*(?:on\\s+)?)?' +          // optional leading HH:MM
    '(?:[A-Za-z]{3,9}\\s+)?' +                                // optional weekday
    '(\\d{1,2})\\s+([A-Za-z]{3,9})' +                         // day + month
    '(?:\\s+(?:at\\s+)?(\\d{1,2})[:.]?(\\d{2}))?',            // optional trailing HH:MM
    'g'
  );
  let m;
  while ((m = re.exec(s))) {
    const month = MONTHS[String(m[4]).slice(0, 3).toLowerCase()];
    if (month === undefined) continue;
    const day = Number(m[3]);
    const hh = Number(m[1] ?? m[5] ?? 0);
    const mm = Number(m[2] ?? m[6] ?? 0);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;

    // The page omits the year. Assume the nearest one: a date more than ~6
    // months behind "now" belongs to next year (December warning read in
    // January, and vice versa).
    let year = now.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, day, hh, mm));
    const sixMonths = 182 * 24 * 3600 * 1000;
    if (d.getTime() - now.getTime() < -sixMonths) d = new Date(Date.UTC(++year, month, day, hh, mm));
    else if (d.getTime() - now.getTime() > sixMonths) d = new Date(Date.UTC(--year, month, day, hh, mm));
    stamps.push(d.toISOString());
  }

  if (!stamps.length) return { validFrom: null, validTo: null };
  return { validFrom: stamps[0], validTo: stamps[1] ?? null };
}

/**
 * Regions read out of a headline such as
 * "Yellow warning of rain affecting South West England and Wales".
 * Anchored on the full "warning of … affecting …" shape so a stray "affecting"
 * in ordinary prose is not mistaken for the region list.
 */
function regionsFrom(text) {
  const m = /warning\s+of\s+.+?\s+affecting\s+(.+?)(?:\s*[.–—-]\s*$|$)/i.exec(
    String(text || '').trim()
  );
  if (!m) return [];
  return m[1]
    .split(/\s*(?:,|\band\b|&)\s*/i)
    .map((r) => r.trim())
    .filter(Boolean);
}

/* ── source 1: the accessible warnings page ─────────────────────────────── */

function parseAccessiblePage(html, now) {
  const content = sliceByClass(html, 'warnings-content');
  if (content === null) return null;                 // markup changed — try RSS
  if (/no\s+warnings?\s+in\s+force/i.test(stripTags(content))) return [];

  // Each warning is a header block followed by its headline/period/description.
  const headers = [...content.matchAll(
    /<[a-z0-9]+[^>]*class="[^"]*\bheader-title\b[^"]*"[^>]*>/gi
  )];
  if (!headers.length) return null;

  const warnings = [];
  for (let i = 0; i < headers.length; i += 1) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : content.length;
    const block = content.slice(start, end);

    const sevClass = /class="[^"]*\b(YELLOW|AMBER|RED)\b[^"]*"/i.exec(headers[i][0]);
    const headline = stripTags(sliceByClass(block, 'warning-headline') ?? '');
    const period = stripTags(sliceByClass(block, 'warning-period') ?? '');
    const description = stripTags(sliceByClass(block, 'warning-description') ?? '');
    const headerText = stripTags(block.slice(0, block.indexOf('>') + 1) + headline);

    const { validFrom, validTo } = parsePeriod(period, now);
    warnings.push({
      type: typeFrom(`${headerText} ${headline} ${description}`),
      severity: sevClass
        ? sevClass[1][0] + sevClass[1].slice(1).toLowerCase()
        : severityFrom(`${headerText} ${headline}`),
      regions: regionsFrom(headline),
      description: description || headline,
      validFrom,
      validTo,
      impacts: description && headline && description !== headline ? description : '',
    });
  }
  return warnings;
}

/* ── source 2: the RSS feed ─────────────────────────────────────────────── */

function parseRss(xml, now) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items.map(([, item]) => {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(item);
      return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '';
    };
    const title = stripTags(pick('title'));
    const description = stripTags(pick('description'));
    const { validFrom, validTo } = parsePeriod(description || title, now);
    return {
      type: typeFrom(`${title} ${description}`),
      severity: severityFrom(title),
      regions: regionsFrom(title),
      description: description || title,
      validFrom,
      validTo,
      impacts: '',
    };
  });
}

/* ── fetching ───────────────────────────────────────────────────────────── */

async function get(url, accept) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: accept },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

/** Stable key used to dedupe a warning across refreshes. */
function warningKey(w) {
  const regions = Array.isArray(w.regions) ? w.regions.join(',') : (w.region || '');
  return `${w.type}|${w.severity}|${regions}|${w.validFrom}|${w.validTo}`;
}

/* ── the permanent archive ───────────────────────────────────────────────────
 *
 * CachedWarnings is ONE ROW, overwritten on every refresh, and its five-day
 * tail is only there so the "past warnings" panel is not empty. Nothing in the
 * site had ever kept a warning after that — so there was no history to show,
 * at any depth, and the day-by-day archive had nothing to read.
 *
 * This writes one durable row per distinct warning, keyed the same way the
 * de-duplication above keys them, and never deletes. A warning seen across
 * several refreshes updates in place rather than piling up duplicates.
 *
 * WHAT IT CANNOT DO IS GO BACKWARDS. The archive starts the first time this
 * runs; warnings issued before that were never stored by anything, and neither
 * MeteoAlarm nor the Met Office publish a historical warnings feed we can
 * reach, so there is nothing to backfill from. It accumulates from here.
 */
const UK_TZ = 'Europe/London';

/** Every UK calendar day a warning is in force, as YYYY-MM-DD. */
function daysCovered(validFrom, validTo) {
  const from = new Date(validFrom);
  const to = new Date(validTo || validFrom);
  if (Number.isNaN(from.getTime())) return [];
  const end = Number.isNaN(to.getTime()) ? from : to;
  // UK local date, so a warning running 23:00–02:00 counts on both days the
  // reader would call them — not on whatever UTC happened to be at the time.
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', {
    timeZone: UK_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const out = [];
  const cur = new Date(from);
  // Guard against a malformed period claiming to run for years.
  for (let i = 0; i <= 40 && cur <= end; i += 1) {
    out.push(fmt(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  const last = fmt(end);
  if (!out.includes(last)) out.push(last);
  return out;
}

function archiveWarnings(db, warnings, nowIso) {
  if (!Array.isArray(warnings) || !warnings.length) return 0;
  let existing = [];
  try { existing = db.list('WarningArchive') || []; } catch { return 0; }
  const byKey = new Map(existing.map((r) => [r.warning_key, r]));

  let written = 0;
  for (const w of warnings) {
    if (!w?.validFrom) continue;
    const key = warningKey(w);
    const days = daysCovered(w.validFrom, w.validTo);
    const prev = byKey.get(key);
    if (prev) {
      // Seen before: just refresh the sighting window and any new days.
      const mergedDays = Array.from(new Set([...(prev.days || []), ...days])).sort();
      if (mergedDays.length !== (prev.days || []).length || prev.last_seen !== nowIso) {
        try { db.update('WarningArchive', prev.id, { last_seen: nowIso, days: mergedDays }); written += 1; } catch { /* keep going */ }
      }
      continue;
    }
    try {
      db.create('WarningArchive', {
        warning_key: key,
        type: w.type || 'Unknown',
        severity: w.severity || 'yellow',
        regions: Array.isArray(w.regions) ? w.regions : (w.region ? [w.region] : []),
        description: w.description || '',
        impacts: w.impacts || '',
        valid_from: w.validFrom,
        valid_to: w.validTo || null,
        days,
        first_seen: nowIso,
        last_seen: nowIso,
      });
      written += 1;
    } catch { /* one bad row must not stop the rest */ }
  }
  return written;
}

/**
 * Fetch, parse and cache. `db` is injected so this stays a plain function that
 * the HTTP route and the CLI refresh script can both call.
 */
export default async function getMetOfficeWarnings(db) {
  const now = new Date();
  let fresh = null;
  let source = 'none';
  let issuedAt = null;

  /* The official NSWWS API first — it is the authoritative feed, gives exact
   * valid-from/to times, proper region lists and the Met Office's own issue
   * time, and cannot be broken by a redesign of the public website. The page
   * scraper below stays as the fallback for when the key is absent or the API
   * is unreachable. */
  if (hasNswwsKey()) {
    try {
      const result = await fetchNswwsWarnings();
      fresh = result.warnings;
      issuedAt = result.issuedAt;
      source = 'nswws-api';
    } catch (err) {
      console.warn('[getMetOfficeWarnings] NSWWS API failed:', err.message);
    }
  }

  if (fresh === null) {
    try {
      fresh = parseAccessiblePage(
        await get(ACCESSIBLE_URL, 'text/html,application/xhtml+xml'),
        now
      );
      if (fresh !== null) source = 'accessible-page';
    } catch (err) {
      console.warn('[getMetOfficeWarnings] accessible page failed:', err.message);
    }
  }

  if (fresh === null) {
    // Either the fetch failed or the page markup moved. RSS is the backstop.
    fresh = parseRss(await get(RSS_URL, 'application/rss+xml, application/xml'), now);
    source = 'rss';
  }

  const fetchedAt = now.toISOString();
  const existing = db.list('CachedWarnings')[0] || null;
  const previous = Array.isArray(existing?.all_warnings) ? existing.all_warnings : [];

  // Keep recently-expired warnings (up to five days) so the "past warnings"
  // panel still has something to show once the Met Office drops them.
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const freshKeys = new Set(fresh.map(warningKey));
  const historical = previous.filter((w) => {
    if (freshKeys.has(warningKey(w))) return false;
    const validTo = w.validTo ? new Date(w.validTo) : null;
    if (!validTo || Number.isNaN(validTo.getTime())) return false;
    if (validTo >= now) return false;
    if (validTo < fiveDaysAgo) return false;
    return true;
  });

  const all_warnings = [...fresh, ...historical];
  const record = {
    all_warnings,
    fetched_at: fetchedAt,
    map_url: MAP_URL,
    source,
    /* When the Met Office actually issued this set, as opposed to when we
     * polled for it. Only NSWWS reports it; the scraper cannot know. */
    issued_at: issuedAt,
    /* The clock slot this refresh belongs to, so the page can show the same
     * "last updated" to everyone regardless of when they loaded it. */
    slot_at: slotStart(now).toISOString(),
    next_at: nextSlot(now).toISOString(),
  };

  const saved = existing
    ? db.update('CachedWarnings', existing.id, record)
    : db.create('CachedWarnings', record);

  /* Everything this refresh saw goes to the permanent archive — the fresh set
     and the recently-expired tail alike, since the tail is the only record of
     warnings that ended between two polls. */
  const archived = archiveWarnings(db, all_warnings, fetchedAt);

  console.log(
    `[getMetOfficeWarnings] ${fresh.length} in force (+${historical.length} recent) via ${source}`
    + (archived ? ` — ${archived} archived` : '')
  );
  return { ok: true, source, count: fresh.length, archived, record: saved };
}

export { parseAccessiblePage, parseRss, parsePeriod, regionsFrom, typeFrom, severityFrom };
