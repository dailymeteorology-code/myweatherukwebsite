import React from 'react';
import { RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';

/**
 * What a published graphic says about itself: its weather conditions, the
 * sub-options chosen for them, and — for a thunderstorm graphic — the risk
 * details behind it.
 *
 * This exists because the card the public actually sees on the home page showed
 * none of it. A graphic could be saved with Thunderstorms + Rain, three
 * sub-options and a full set of hail / tornado / wind / flash-flood risks, and
 * a visitor got the image, the title and two lines of description. The editor
 * collected all of it and nothing ever displayed it.
 *
 * Colours come from `tcm/riskConfig` — the same canonical bands the Thunderstorm
 * graphic in the studio uses — rather than a fourth private palette, so a
 * "Moderate" risk is the same colour everywhere on the site.
 */

/** Accents for the weather conditions, matching the forecast cards. */
const CONDITION_ACCENT = {
  Snow: '#7dd3fc',
  Ice: '#67e8f9',
  Thunderstorms: '#c084fc',
  Rain: '#60a5fa',
  Wind: '#2dd4bf',
  Heat: '#fb923c',
  'Daily Risks': '#fbbf24',
};
const DEFAULT_ACCENT = '#94a3b8';

/** The canonical bands, in ascending order — includes Slight. */
export const RISK_LEVELS = RISK_META.map((r) => r.level);

/* ── The graphic risk ladder ────────────────────────────────────────────────
 * Exactly what the Thunderstorm graphic in the studio offers, so a level set on
 * a graphic means and looks the same as one drawn in the studio. Mirrors
 * GRAPHIC_LEVELS in StormOutlookGraphicTool: the canonical bands minus
 * "No Risk", with the studio's own graphic palette, and Conditional Severe
 * sitting between High and Severe.
 *
 * The forecast-graphic form previously carried a separate hand-written ladder
 * with its own colours — Very Low was green there and blue in the studio, and
 * Conditional Severe did not exist at all. Deriving both from RISK_META here
 * means adding a band upstream reaches both places at once.
 */
/* colour, fill, and the SHORT LABEL the studio prints on the graphic. The
   label is not cosmetic: on a storm outlook a band called "Marginal"
   internally is drawn as SLGT, so showing "Marginal" in the form meant the
   forecaster picked one word and published another. */
const GRAPHIC_PALETTE = {
  'Very Low': ['#60a5fa', 'rgba(96,165,250,0.34)', 'TSTM'],
  Low: ['#86efac', 'rgba(134,239,172,0.38)', 'MRGL'],
  Marginal: ['#facc15', 'rgba(250,204,21,0.42)', 'SLGT'],
  Slight: ['#fb923c', 'rgba(249,115,22,0.45)', 'ENH'],
  Moderate: ['#f87171', 'rgba(248,113,113,0.45)', 'MDT'],
  High: ['#a78bfa', 'rgba(167,139,250,0.45)', 'HIGH'],
};

const COND_SEVERE = {
  level: 'Conditional Severe',
  short: 'COND SVRE',
  range: 'COND SVR',
  color: '#0b0f1a',
  fill: 'rgba(200,205,215,0.18)',
};

export const GRAPHIC_RISK_LEVELS = (() => {
  const out = [];
  for (const r of RISK_META) {
    if (r.level === 'No Risk') continue;          // not a state a graphic publishes
    if (r.level === 'Severe') out.push(COND_SEVERE);
    const g = GRAPHIC_PALETTE[r.level];
    const pal = RISK_PALETTES?.thunderstorm?.[r.level] || {};
    let [lo, hi] = LEVEL_RANGE?.[r.level] || [];
    if (r.level === 'High') hi = 100;             // High runs to the top
    out.push({
      level: r.level,
      short: g ? g[2] : r.level === 'Severe' ? 'SVRE' : r.level.toUpperCase(),
      range:
        r.level === 'Severe'
          ? 'SVR TSTMS'
          : lo != null && hi != null
            ? `${lo}-${hi}%`
            : '',
      color: g ? g[0] : pal.color || pal.border || DEFAULT_ACCENT,
      fill: g ? g[1] : pal.fill || 'rgba(148,163,184,0.2)',
    });
  }
  return out;
})();

/** Short label + range by level, for anything that shows the studio's wording. */
export const GRAPHIC_LEVEL_LABEL = Object.fromEntries(
  GRAPHIC_RISK_LEVELS.map((l) => [l.level, { short: l.short, range: l.range }])
);

/** Level names in ladder order, for the form's selector. */
export const GRAPHIC_LEVEL_NAMES = GRAPHIC_RISK_LEVELS.map((l) => l.level);

/** Badge-shaped styling, keyed by level. */
export const GRAPHIC_LEVEL_STYLE = Object.fromEntries(
  GRAPHIC_RISK_LEVELS.map((l) => [
    l.level,
    { dot: l.color, text: l.color, bg: l.fill, border: `${l.color}66` },
  ])
);

/* A level as stored: its name ("Marginal"), or on some older graphics the studio's short label
   ("SLGT"). Either way, the ladder's entry for it. */
const BY_LEVEL = Object.fromEntries(GRAPHIC_RISK_LEVELS.map((l) => [l.level, l]));
const BY_SHORT = Object.fromEntries(GRAPHIC_RISK_LEVELS.map((l) => [l.short, l]));
export const graphicLevel = (v) => (v == null ? null : BY_LEVEL[v] || BY_SHORT[String(v).toUpperCase()] || null);
/** The level name for a stored value (short labels mapped back), or null for none / unknown. */
export const normLevel = (v) => graphicLevel(v)?.level || null;

/** A percentage on the graphic's ladder: 5–11% TSTM … 65–100% HIGH. Severe is drawn as a
    hatch on the graphic, not reached by a percentage, so it is never the answer here. */
export function levelOfPercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  let out = null;
  for (const r of RISK_META) if (r.level !== 'No Risk' && r.level !== 'Severe' && n >= r.min) out = r.level;
  return out;
}

/** How the graphic's key draws a level: a solid chip in its colour, Severe as an indigo hatch,
    Conditional Severe as a grey fill inside a dashed outline. */
export function levelLook(level) {
  const g = graphicLevel(level);
  if (!g) return { background: 'var(--glass-fill-strong, rgba(255,255,255,0.12))', color: 'var(--ink-1, #f8fafc)' };
  if (g.level === 'Severe') {
    return { background: `repeating-linear-gradient(45deg, ${g.color} 0 3px, rgba(49,46,129,0.35) 3px 7px)`, color: '#ffffff', boxShadow: `inset 0 0 0 1.5px ${g.color}` };
  }
  if (g.level === 'Conditional Severe') {
    return { background: 'rgba(200,205,215,0.22)', color: 'var(--ink-1, #f8fafc)', outline: '1.5px dashed var(--ink-2, #94a3b8)', outlineOffset: -1.5 };
  }
  return { background: g.color, color: inkOn(g.color) };
}

/** A risk level exactly as the Thunderstorm graphic prints it: its short label (TSTM, MRGL, SLGT,
    ENH, MDT, HIGH, COND SVRE, SVRE) in its colour, with the full name and range in the tooltip
    and, with `range`, the range beside it. */
export function GraphicLevelPill({ level, range = false, className = '', style }) {
  const g = graphicLevel(level);
  return (
    <span
      className={className}
      title={g ? `${g.level}${g.range ? ` · ${g.range}` : ''}` : String(level)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99,
        fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.45, whiteSpace: 'nowrap',
        ...levelLook(level), ...style,
      }}
    >
      {g ? g.short : String(level)}
      {range && g?.range && <span style={{ fontWeight: 600, opacity: 0.78, letterSpacing: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em' }}>{g.range}</span>}
    </span>
  );
}

/** A button that picks a level, drawn like a row of the graphic's key: the colour swatch, the
    short label and (with `range`) the range. Glass tokens where the page has them. */
export function GraphicLevelChoice({ level, selected, onClick, range = false, small = false }) {
  const g = graphicLevel(level);
  const swatch = { ...levelLook(level) };
  delete swatch.color;                                            // the swatch is only the chip
  const tone = !g ? '#94a3b8' : g.level === 'Conditional Severe' ? 'var(--ink-2, #94a3b8)' : g.level === 'Severe' ? '#6366f1' : g.color;
  return (
    <button
      type="button" onClick={onClick} aria-pressed={!!selected}
      title={g ? `${g.level}${g.range ? ` · ${g.range}` : ''}` : String(level)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: small ? 5 : 7, padding: small ? '3px 9px 3px 6px' : '6px 12px 6px 8px',
        borderRadius: 99, cursor: 'pointer', font: 'inherit', fontSize: small ? 10.5 : 12, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap',
        color: selected ? 'var(--ink-1, #f8fafc)' : 'var(--ink-2, rgba(203,213,225,0.75))',
        background: selected ? `color-mix(in srgb, ${g && g.level !== 'Conditional Severe' ? g.color : '#94a3b8'} 20%, transparent)` : 'var(--glass-fill, rgba(255,255,255,0.04))',
        border: `1px solid ${selected ? tone : 'var(--glass-hairline, rgba(255,255,255,0.1))'}`,
        boxShadow: selected ? `0 0 0 1px ${tone}` : 'none',
        transition: 'background .15s, border-color .15s, box-shadow .15s',
      }}
    >
      <span style={{ width: small ? 16 : 22, height: small ? 8 : 10, borderRadius: 3, flexShrink: 0, ...swatch }} />
      {g ? g.short : String(level)}
      {range && g?.range && (
        <span style={{ fontWeight: 600, opacity: 0.7, letterSpacing: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.88em' }}>{g.range}</span>
      )}
    </button>
  );
}

/* The thunderstorm details a graphic carries (ThunderstormPanel writes them):
   percentages for five hazards, placed on the graphic's ladder; a lowest-to-highest band for
   three more (older graphics stored a single band, or just true); and measured values. */
const PERCENT_RISKS = [
  { key: 'tornado_risk', label: 'Tornado' },
  { key: 'hail_risk', label: 'Hail' },
  { key: 'flash_flood_risk', label: 'Flash flooding' },
  { key: 'strong_winds_risk', label: 'Strong winds' },
  { key: 'supercell_risk', label: 'Supercells' },
];
const RANGE_RISKS = [
  { key: 'high_lightning', label: 'High lightning' },
  { key: 'severe', label: 'Severe' },
  { key: 'heavy_rain', label: 'Heavy rain' },
];

/** Risks stored as a measurement rather than a band. */
const MEASURED = [
  { key: 'hail_diameter_mm', label: 'Hail', unit: 'mm' },
  { key: 'wind_speed_mph', label: 'Gusts', unit: 'mph' },
  { key: 'rain_mm_per_hour', label: 'Rain', unit: 'mm/h' },
  { key: 'tornado_intensity', label: 'Intensity', unit: '' },
];

const asList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);


function Chip({ label, value, color }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold whitespace-nowrap"
      style={{
        color,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
      {value != null && <span className="font-bold">{value}</span>}
    </span>
  );
}

/** Weather conditions and their chosen sub-options. */
export function ConditionChips({ graphic, max = 0, className = '' }) {
  const conditions = graphic?.weather_conditions?.length
    ? asList(graphic.weather_conditions)
    : asList(graphic?.weather_condition);
  const subs = asList(graphic?.condition_subtypes);
  if (!conditions.length && !subs.length) return null;

  const shown = max > 0 ? subs.slice(0, max) : subs;
  const hidden = subs.length - shown.length;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {conditions.map((c) => (
        <Chip key={c} label={c} color={CONDITION_ACCENT[c] || DEFAULT_ACCENT} />
      ))}
      {shown.map((s) => (
        <span
          key={s}
          className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2 py-[2px]
                     text-[10px] font-medium text-white/85 whitespace-nowrap"
        >
          {s}
        </span>
      ))}
      {hidden > 0 && <span className="text-[10px] text-white/50">+{hidden} more</span>}
    </div>
  );
}

/* white or near-black text, whichever reads on a colour (#rgb, #rrggbb or rgb()/rgba()) */
export function inkOn(colour) {
  let r = 0, g = 0, b = 0;
  const s = String(colour || '').trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = s.match(/\d+(\.\d+)?/g);
    if (m) [r, g, b] = m.map(Number);
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#111827' : '#ffffff';
}

/** Thunderstorm risk detail, the way the Thunderstorm graphic words it: each hazard's percentage
    with the graphic's band for it (Hail 40% · ENH), each lowest-to-highest band (High lightning
    TSTM–SLGT), then the measured values. Every stored hazard is shown: the lowest/highest bands
    the editor saves used to be left out, because this read keys the editor no longer writes. */
/** A graphic's thunderstorm details, read the way the graphic words them: `items` are the hazards
    with a chance (`pct`, placed on the ladder) or a band, lowest to highest where it is a range
    (`range`); `measured` are the measured values. Shared by the chips here and the home page's
    "Further info" panel, so the two can never read the same data differently. */
export function readThunderstorm(data) {
  const empty = { items: [], measured: [] };
  if (!data || typeof data !== 'object') return empty;
  const pct = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  const items = [];
  for (const { key, label } of PERCENT_RISKS) {
    const v = data[key];
    const p = pct(v);
    if (p != null) { if (p > 0) items.push({ key, label, pct: Math.round(p), value: `${Math.round(p)}%`, levels: [levelOfPercent(p)].filter(Boolean) }); }
    else if (normLevel(v)) items.push({ key, label, levels: [normLevel(v)] });       // stored as a band
  }
  for (const { key, label } of RANGE_RISKS) {
    const lo = normLevel(data[`${key}_min`]), hi = normLevel(data[`${key}_max`]);
    const single = normLevel(data[key]);
    const levels = [...new Set([lo, hi].filter(Boolean))];
    if (levels.length) items.push({ key, label, levels, range: true });
    else if (single) items.push({ key, label, levels: [single] });
    else if (data[key] === true) items.push({ key, label, levels: [] });                // older graphics: just "yes"
  }
  const measured = MEASURED.map(({ key, label, unit }) => {
    const v = data[key];
    if (v == null || v === '') return null;
    return { key, label, value: unit ? `${v} ${unit}` : String(v) };
  }).filter(Boolean);
  return { items, measured };
}

export function ThunderstormRisks({ data, className = '' }) {
  const { items, measured } = readThunderstorm(data);
  if (!items.length && !measured.length) return null;
  /* on glass: the page's tokens where it has them (light or dark), white on dark elsewhere */
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 4px 3px 10px', borderRadius: 99,
    fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--ink-1, rgba(255,255,255,0.9))',
    background: 'var(--glass-fill-strong, rgba(255,255,255,0.10))', border: '1px solid var(--glass-hairline, rgba(255,255,255,0.15))',
  };
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {items.map(({ label, value, levels, range }) => (
        <span key={label} style={{ ...chip, paddingRight: levels.length ? 4 : 10 }}
          title={`${label}${value ? ` ${value}` : ''}${levels.length ? `: ${levels.map((l) => graphicLevel(l)?.short || l).join(' to ')}` : ''}`}>
          {label}
          {value && <b style={{ fontWeight: 800 }}>{value}</b>}
          {levels.map((l, i) => (
            <React.Fragment key={l}>
              {range && i > 0 && <span style={{ opacity: 0.55, margin: '0 -3px' }}>–</span>}
              <GraphicLevelPill level={l} style={{ fontSize: 10, padding: '1px 7px' }} />
            </React.Fragment>
          ))}
        </span>
      ))}
      {measured.map(({ label, value }) => (
        <span key={label} style={{ ...chip, paddingRight: 10, fontWeight: 500 }}>
          {label}
          <b style={{ fontWeight: 800 }}>{value}</b>
        </span>
      ))}
    </div>
  );
}

export default { ConditionChips, ThunderstormRisks, RISK_LEVELS };
