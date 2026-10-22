/* Key words in a graphic's description, coloured by what they mean, automatically.

   A forecaster used to pick each colour by hand in the description editor. Now the words that
   carry a forecast stand out on their own, each in the colour it already has on the site:
   - Met Office warnings in their own colour: a yellow, amber or red warning;
   - risk levels in the Thunderstorm graphic's key colours, as the graphic prints them (TSTM,
     MRGL, SLGT, ENH, MDT, HIGH, SVRE, and "slight risk", "moderate risk"...);
   - named storms ("Storm Austen");
   - amounts in the colour of what they measure: wind (mph, knots), rain (mm), snow (cm), and
     temperatures warm or freezing enough to matter;
   - the weather itself: thunderstorms, lightning, hail, tornadoes, flooding, heavy rain, rain and
     showers, snow, ice and frost, wind and gales, heat, fog, cold, sunshine, and the
     danger words ("danger to life", "disruption").

   Words the forecaster coloured themselves keep that colour: a word given White in the editor
   is left plain. Links are left alone. The colours go through cleanHtml's paint, so the page's
   light and dark themes adjust them as they do the editor's own (richTextCss). */
import { paint } from '@/lib/cleanHtml';
import { GRAPHIC_RISK_LEVELS } from '@/components/graphics/GraphicMeta';

const C = {
  red: '#ef4444', amber: '#f59e0b', yellow: '#facc15', storm: '#d946ef',
  thunder: '#a855f7', lightning: '#facc15', hail: '#22d3ee', tornado: '#f97316', flood: '#6366f1',
  heavyRain: '#3b82f6', rain: '#38bdf8', snow: '#7dd3fc', ice: '#5eead4', wind: '#14b8a6',
  heat: '#f97316', hot: '#ef4444', fog: '#94a3b8', cold: '#0ea5e9', sun: '#fbbf24', danger: '#dc2626',
};
/* the Thunderstorm graphic's own key, by the label it prints */
const RISK = Object.fromEntries(GRAPHIC_RISK_LEVELS.filter((l) => l.short !== 'COND SVRE').map((l) => [l.short, l.color]));
const RISK_WORD = { marginal: 'MRGL', slight: 'SLGT', enhanced: 'ENH', moderate: 'MDT', high: 'HIGH', severe: 'SVRE' };
const RANGE = String.raw`(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?`;

/* [pattern, colour (or a function of the match), what it is]: earlier rules win where two match
   the same words, so the longer, more telling phrases come first */
const RULES = [
  [/\b(red|amber|yellow)\s+(?:(?:met\s+office|weather|national|severe|thunderstorm|thunder|rain|wind|snow|ice|snow\s+and\s+ice|fog|heat|extreme\s+heat)\s+){0,3}(?:warnings?|alerts?)\b/gi, (m) => C[m[1].toLowerCase()], 'Warning'],
  [/\b(marginal|slight|enhanced|moderate|high|severe)\s+risk\b/gi, (m) => RISK[RISK_WORD[m[1].toLowerCase()]], 'Risk level'],
  [/\b(TSTM|MRGL|SLGT|ENH|MDT|HIGH|SVRE)\b/g, (m) => RISK[m[1]], 'Risk level'],
  [/\bStorm\s+[A-Z][a-z]+\b/g, C.storm, 'Named storm'],
  [new RegExp(String.raw`\b\d+(?:\.\d+)?${RANGE}\s*(?:mph|km/h|kph|knots|kts?)\b`, 'gi'), C.wind, 'Wind'],
  [new RegExp(String.raw`\b\d+(?:\.\d+)?${RANGE}\s*mm(?:\s*(?:/|an|per)\s*(?:hr|hour|h))?\b`, 'gi'), C.heavyRain, 'Rain'],
  [new RegExp(String.raw`\b\d+(?:\.\d+)?${RANGE}\s*cm\b`, 'gi'), C.snow, 'Snow'],
  /* a temperature or a range of them ("-3°C", "minus 5 degrees", "28-31°C"): hot from 25, very
     hot from 30, cold at freezing; anything between stays plain */
  [/(?<![\w.])((?:-|−|minus\s+)?\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*((?:-|−|minus\s+)?\d+(?:\.\d+)?))?\s*(?:°\s*[CF]?|degrees(?:\s+celsius)?)/gi, (m) => {
    const num = (s) => parseFloat(s.replace('−', '-').replace(/minus\s+/i, '-'));
    const a = num(m[1]), b = m[2] ? num(m[2]) : a, hi = Math.max(a, b), lo = Math.min(a, b);
    return hi >= 30 ? C.hot : hi >= 25 ? C.heat : lo <= 0 ? C.cold : null;
  }, 'Temperature'],
  [/\b(?:danger\s+to\s+life|life[-\s]threatening|power\s+cuts?|travel\s+disruption|disruption|disruptive|dangerous)\b/gi, C.danger, 'Impact'],
  [/\b(?:tornado(?:es|s)?|funnel\s+clouds?|waterspouts?)\b/gi, C.tornado, 'Tornadoes'],
  [/\b(?:large\s+|giant\s+)?hail(?:stones?|storms?)?\b/gi, C.hail, 'Hail'],
  [/\blightning\b/gi, C.lightning, 'Lightning'],
  [/\b(?:severe\s+)?(?:thunderstorms?|thunder(?:y|snow)?(?:\s+showers?)?|supercells?|storms?(?![-\s]force))\b/gi, C.thunder, 'Thunderstorms'],
  [/\b(?:flash\s+flood(?:ing|s)?|flood(?:ing|s|ed)?|surface\s+water)\b/gi, C.flood, 'Flooding'],
  [/\b(?:torrential(?:\s+rain)?|heavy\s+(?:rain|showers?|downpours?)|downpours?|cloudbursts?|persistent\s+rain)\b/gi, C.heavyRain, 'Heavy rain'],
  [/\b(?:rain(?:fall|y)?|showers?|showery|drizzle)\b/gi, C.rain, 'Rain'],
  [/\b(?:snow(?:fall|y|\s+showers?)?|sleet|blizzards?|wintry(?:\s+showers?)?|snowstorms?)\b/gi, C.snow, 'Snow'],
  [/\b(?:black\s+ice|ice|icy|frost(?:y)?|freezing(?:\s+fog|\s+rain)?|sub[-\s]zero)\b/gi, C.ice, 'Ice and frost'],
  [/\b(?:severe\s+gales?|gales?|gusts?|gusty|storm[-\s]force|strong\s+winds?|damaging\s+winds?|windy|winds?)\b/gi, C.wind, 'Wind'],
  [/\b(?:heat\s*waves?|extreme\s+heat|heat|hot|humid|muggy|scorching)\b/gi, C.heat, 'Heat'],
  [/\b(?:fog(?:gy)?|mist(?:y)?|low\s+visibility)\b/gi, C.fog, 'Fog'],
  [/\b(?:cold\s+snap|cold\s+spell|arctic|polar|cold|chilly|wind\s+chill)\b/gi, C.cold, 'Cold'],
  [/\b(?:sunshine|sunny(?:\s+spells)?|clear\s+skies|settled|dry)\b/gi, C.sun, 'Sunshine'],
];

/** Every key-word match in a text: [{ start, end, text, colour, kind }], in order, none overlapping. */
export function keywordMatches(text) {
  const hits = [];
  RULES.forEach(([re, colour, kind], rank) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0]) { re.lastIndex++; continue; }
      const c = typeof colour === 'function' ? colour(m) : colour;
      if (c) hits.push({ start: m.index, end: m.index + m[0].length, text: m[0], colour: c, kind, rank });
    }
  });
  /* the earlier rule (then the longer match) keeps contested words */
  hits.sort((a, b) => a.rank - b.rank || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && h.end > k.start)) kept.push(h);
  return kept.sort((a, b) => a.start - b.start);
}

/** The key words found, one of each (as written the first time), for the editor's list. */
export function keywordsIn(text) {
  const seen = new Map();
  for (const h of keywordMatches(text || '')) {
    const k = h.text.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(k)) seen.set(k, h);
  }
  return [...seen.values()];
}

/** Description HTML (already through cleanHtml) with its key words coloured. */
export function autoColour(html) {
  if (!html || typeof DOMParser === 'undefined') return html || '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('[data-c], a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue;
    const hits = keywordMatches(text);
    if (!hits.length) continue;
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (const h of hits) {
      if (h.start > at) frag.append(text.slice(at, h.start));
      const span = doc.createElement('span');
      paint(span, h.colour);
      span.setAttribute('data-kw', '');
      span.textContent = h.text;
      frag.append(span);
      at = h.end;
    }
    if (at < text.length) frag.append(text.slice(at));
    node.replaceWith(frag);
  }
  return doc.body.innerHTML;
}
