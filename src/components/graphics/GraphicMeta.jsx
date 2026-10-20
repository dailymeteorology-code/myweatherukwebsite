import React from 'react';
import { RISK_COLOR, RISK_FILL, RISK_BORDER, RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';

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

/** Risks stored as a named band. Order matters: it is the reading order. */
const BAND_RISKS = [
  { key: 'tornado_risk', label: 'Tornado' },
  { key: 'hail_risk', label: 'Hail' },
  { key: 'flash_flood_risk', label: 'Flash flooding' },
  { key: 'strong_winds_risk', label: 'Strong winds' },
  { key: 'supercell_risk', label: 'Supercells' },
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

/** A band value can be stored as a level name or as a 0–100 score. */
function bandOf(value) {
  if (value == null || value === '' || value === 'No Risk') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    let level = RISK_META[0].level;
    for (const r of RISK_META) if (value >= r.min) level = r.level;
    return level === 'No Risk' ? null : level;
  }
  return null;
}

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

/** Thunderstorm risk detail — bands first, then any measured values. */
export function ThunderstormRisks({ data, className = '' }) {
  if (!data || typeof data !== 'object') return null;

  const bands = BAND_RISKS.map(({ key, label }) => ({ label, level: bandOf(data[key]) })).filter(
    (r) => r.level
  );
  const measured = MEASURED.map(({ key, label, unit }) => {
    const v = data[key];
    if (v == null || v === '') return null;
    return { label, value: unit ? `${v}${unit}` : String(v) };
  }).filter(Boolean);

  if (!bands.length && !measured.length) return null;

  /* Each risk is the hazard's name on glass and its level in a solid pill of the level's colour.
     It used to be the level's colour on a fill of the same colour, which left "Moderate" (red on
     red) unreadable; the pill's text is white or near-black, whichever the colour can carry. */
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {bands.map(({ label, level }) => {
        const c = RISK_COLOR(level, 'thunderstorm');
        return (
          <span
            key={label}
            title={`${label}: ${level}`}
            className="inline-flex items-center gap-1.5 rounded-full py-[2px] pl-2 pr-[3px] text-[10px] font-semibold whitespace-nowrap"
            style={{
              color: 'var(--ink-1, rgba(255,255,255,0.9))',
              background: 'var(--glass-fill-strong, rgba(255,255,255,0.10))',
              border: `1px solid ${RISK_BORDER(level, 'thunderstorm')}`,
            }}
          >
            {label}
            <span className="rounded-full px-1.5 font-bold" style={{ background: c, color: inkOn(c) }}>{level}</span>
          </span>
        );
      })}
      {measured.map(({ label, value }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-medium whitespace-nowrap"
          /* the page's glass tokens where it has them (the home page, light or dark), white on dark elsewhere */
          style={{
            color: 'var(--ink-1, rgba(255,255,255,0.85))',
            background: 'var(--glass-fill-strong, rgba(255,255,255,0.10))',
            border: '1px solid var(--glass-hairline, rgba(255,255,255,0.15))',
          }}
        >
          {label}
          <span className="font-bold">{value}</span>
        </span>
      ))}
    </div>
  );
}

export default { ConditionChips, ThunderstormRisks, RISK_LEVELS };
