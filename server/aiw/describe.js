/**
 * Warning text — descriptions, titles and spoken announcements.
 *
 * Generated from the forecasting engine's STRUCTURED output only: the
 * severity it decided, the strike rate it measured, the motion it estimated,
 * the places the gazetteer found inside the polygons, and the times it
 * computed. A language model is deliberately not in this loop. A template
 * cannot invent a town, an intensity or a time that is not in the data, and
 * it cannot make a warning sound more serious than the engine judged it to be;
 * the prompt requires both guarantees, and an LLM can give neither.
 *
 * Each sentence is chosen from the facts, so two warnings read differently
 * whenever their storms differ.
 */
import { compass8 } from './geometry.js';

const TITLE = { yellow: 'Yellow lightning warning', amber: 'Amber lightning warning', red: 'Red lightning warning' };

/** "A", "A and B", "A, B and C" */
export function listJoin(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

export function fmtTime(ms, tz) {
  try {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || 'UTC', hour12: false });
  } catch { return new Date(ms).toISOString().slice(11, 16); }
}

/** Human description of where — preferring named places inside the area. */
export function areaPhrase(geo, max = 3) {
  const names = (geo.places || []).slice(0, max).map((p) => p.name);
  if (names.length) {
    const regions = [...new Set((geo.places || []).slice(0, 6).map((p) => p.admin2 || p.admin1).filter(Boolean))].slice(0, 2);
    return `${listJoin(names)}${regions.length ? ` (${listJoin(regions)})` : ''}`;
  }
  if (geo.anchorPhrase) return geo.overLand ? `a sparsely populated area ${geo.anchorPhrase}` : `an area at sea ${geo.anchorPhrase}`;
  return 'the warning area';
}

/** Short region label for titles and filters: "Bedfordshire, England, United Kingdom". */
export function regionLabel(geo) {
  const p = (geo.places || [])[0] || geo.anchor;
  // Open sea far from any town: name it by position rather than 'Unnamed'.
  if (!p) return `Sea area ${(geo.anchorPhrase || '').replace(/^near /, 'near ')}`.trim();
  return [p.admin2 && p.admin2 !== p.name ? p.admin2 : null, p.admin1, p.country].filter(Boolean).join(', ');
}

function phaseSentence(f) {
  const rate = f.ratePerMin;
  const rateTxt = rate >= 1 ? `about ${Math.round(rate)} strike${Math.round(rate) === 1 ? '' : 's'} a minute` : 'occasional strikes';
  switch (f.phase) {
    case 'developing': return `A thunderstorm is developing, with lightning activity beginning to increase (${rateTxt} in the last ten minutes).`;
    case 'intensifying': return `A thunderstorm is intensifying, with lightning increasing quickly — ${rateTxt} in the last ten minutes, up from ${Math.round(f.previousRatePerMin * 10) / 10} a minute before that.`;
    case 'weakening': return `Lightning activity is easing (${rateTxt} in the last ten minutes, down from ${Math.round(f.previousRatePerMin * 10) / 10}), but the storm is still producing strikes.`;
    default:
      if (f.severity === 'red') return `An intense thunderstorm is producing concentrated lightning — ${rateTxt}, with the heaviest activity in its core.`;
      if (f.severity === 'amber') return `Frequent lightning is being detected — ${rateTxt} over the last ten minutes.`;
      return `Thunderstorms are producing lightning — ${rateTxt} over the last ten minutes.`;
  }
}

function motionSentence(f) {
  if (!f.motion || f.motion.speedKmh < 5) return 'The storm is almost stationary, so the risk is likely to persist over the same area.';
  const dir = compass8(f.motion.towardDeg);
  const ahead = (f.geo.placesAhead || []).slice(0, 3).map((p) => p.name);
  const base = `It is moving ${dir}wards at around ${Math.round(f.motion.speedKmh / 5) * 5} km/h`;
  if (ahead.length) return `${base}, and is forecast to reach ${listJoin(ahead)} within the next 30 minutes.`;
  return `${base}.`;
}

function impactSentence(f) {
  if (f.severity === 'red') return 'Lightning is a serious and immediate danger to anyone outdoors. Move indoors to a substantial building or a hard-topped vehicle now, and follow official local safety guidance.';
  if (f.severity === 'amber') return 'Lightning poses a real risk to anyone outdoors, on open ground, on the water or near tall isolated objects. Seek suitable shelter if the storm approaches your location.';
  return 'There is a risk of lightning for people outdoors. If you hear thunder, you are close enough to be struck — move indoors.';
}

function uncertaintySentence(f) {
  const bits = [];
  if (f.confidence === 'low') bits.push('Forecast confidence is low');
  else if (f.confidence === 'medium') bits.push('Forecast confidence is moderate');
  else bits.push('Forecast confidence is high');
  if (f.coverage === 'partial') bits.push('lightning detection in this region is incomplete, so activity may be under-reported');
  if (!f.modelTrained) bits.push('this warning uses the baseline forecast while the trained model is not yet validated');
  return `${listJoin(bits)}.`;
}

/**
 * The full description. `f` is the structured fact sheet the warning engine
 * assembles each cycle (see warnings.js buildFacts).
 */
export function describe(f) {
  const where = areaPhrase(f.geo);
  const until = fmtTime(f.expiresAt, f.tz);
  const parts = [
    phaseSentence(f),
    `The warning covers ${where}.`,
    motionSentence(f),
    f.peakAt && f.peakAt > f.issuedAt + 3 * 60e3
      ? `The greatest risk is expected around ${fmtTime(f.peakAt, f.tz)}.`
      : null,
    impactSentence(f),
    `The warning is valid until ${until} (${f.tzLabel}), and will be updated as the storm develops.`,
    uncertaintySentence(f),
  ];
  return parts.filter(Boolean).join(' ');
}

export function shortSummary(f) {
  const where = areaPhrase(f.geo, 2);
  const dir = f.motion && f.motion.speedKmh >= 5 ? `, moving ${compass8(f.motion.towardDeg)}` : '';
  return `${f.ratePerMin >= 1 ? `${Math.round(f.ratePerMin)} strikes/min` : 'Lightning'} near ${where}${dir}.`;
}

export function title(f) {
  return `${TITLE[f.severity]} — ${regionLabel(f.geo)}`;
}

/* ── spoken announcements ─────────────────────────────────────────────── */

function spokenWhere(geo) {
  const names = (geo.places || []).slice(0, 2).map((p) => p.name);
  const region = [...new Set((geo.places || []).map((p) => p.admin2 || p.admin1).filter(Boolean))].slice(0, 2);
  if (region.length && names.length) return `parts of ${listJoin(region)}, including ${listJoin(names)}`;
  if (names.length) return listJoin(names);
  if (geo.anchorPhrase) return `an area ${geo.anchorPhrase}`;
  return 'the affected area';
}

/**
 * Announcement text for a lifecycle event.
 *   kind: issued | escalated | downgraded | updated | cancelled
 */
export function announcementText(kind, f, prevSeverity) {
  const sev = f.severity[0].toUpperCase() + f.severity.slice(1);
  const where = spokenWhere(f.geo);
  const until = `valid until ${fmtTime(f.expiresAt, f.tz)}`;
  const test = f.isTest ? 'This is a test. ' : '';
  switch (kind) {
    case 'issued':
      if (f.severity === 'red') return `${test}Red lightning warning issued for ${where}. Dangerous lightning activity is imminent. Seek suitable shelter now and follow official local safety guidance. This warning is ${until}.`;
      return `${test}${sev} lightning warning issued for ${where}. ${f.phase === 'intensifying' ? 'Thunderstorm activity is increasing. ' : ''}This warning is ${until}.`;
    case 'escalated':
      return `${test}Lightning warning upgraded from ${prevSeverity} to ${f.severity} for ${where}.${f.severity === 'red' ? ' Seek suitable shelter now.' : ''} This warning is ${until}.`;
    case 'downgraded':
      return `${test}Lightning warning for ${where} lowered to ${f.severity}. It is ${until}.`;
    case 'updated':
      return `${test}Update to the ${f.severity} lightning warning for ${where}. It is now ${until}.`;
    default:
      return `${test}${sev} lightning warning for ${where}.`;
  }
}

export { TITLE };
