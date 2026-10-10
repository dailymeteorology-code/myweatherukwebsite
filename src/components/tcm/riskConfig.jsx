// ─────────────────────────────────────────────────────────────────────────────
// riskConfig — SINGLE SOURCE OF TRUTH for TCM risk bands, colours and helpers.
//
// CANONICAL RISK SCALE (0–100 hazard score → band):
//
//   No Risk    0–4      Slight    35–49
//   Very Low   5–11     Moderate  50–64
//   Low       12–21     High      65–79
//   Marginal  22–34     Severe    80–100
//
// This is the ONE scale used across the entire TCM:
//   • the risk engine's score calibration     (lib/tcmEngineScores.js)
//   • the live outlook map                    (pages/WeatherPatterns.jsx)
//   • the contour thresholds                  (lib/tcmOutlookLayers.js)
//   • the archive renderers                   (ArchiveMapPanel, TCMArchive)
//   • the backend verification job            (verifyDailyForecast/entry.ts)
//
// WHY THIS MATTERS: this file previously carried a second, different scale
// (8/16/28/42/56/70/84) while the live map, geometry engine and verification
// backend all used 5/12/22/35/50/65/80. Every component reading from here
// (archive map, PDF export, graphics tool, day cards, timing panel) banded
// identical scores one level lower than the published outlook — the archive
// silently contradicted the live forecast, and verification statistics were
// computed against bands the UI never showed. One scale now lives here. If a
// band is ever recalibrated, change it HERE and in verifyDailyForecast
// together — nowhere else.
//
// ALSO FIXED HERE: RISK_COLOR / RISK_FILL / RISK_BORDER are called throughout
// the app as (level, riskType) — e.g. RISK_COLOR('Marginal', 'thunderstorm')
// in ArchiveSummaryCard, DiurnalTimingSection and TCMArchive — but were
// defined as (riskType, level). Every call therefore missed the palette and
// silently rendered the transparent "No Risk" entry or a fallback grey. The
// helpers now take (level, riskType) to match every live call site, and
// getPalette() detects and corrects a swapped argument order defensively
// (a band name can never collide with a hazard key, so this is unambiguous).
//
// NEW EXPORTS: fmtRange() and descFor() — OutlookLegend.jsx has imported both
// from this module since it was extracted, but they never existed here.
// ─────────────────────────────────────────────────────────────────────────────

import { RISK_DESCRIPTIONS } from '@/components/tcm/riskDescriptions';

// ── Time-step layout of a TCM run: 3-hourly steps across a 4-day outlook ──
export const HOURS_PER_STEP = 3;
export const STEPS_PER_DAY  = 8;
export const TOTAL_STEPS    = 32;

// Bumped when the cached-run payload shape changes so stale caches self-evict.
export const RUN_CACHE_VERSION = 'v20_utc_runs';

// ── Canonical risk bands (ascending score order) ─────────────────────────────
export const RISK_META = [
  { level: 'No Risk',  min: 0,  short: 'NONE' },
  { level: 'Very Low', min: 5,  short: 'VLOW' },
  { level: 'Low',      min: 12, short: 'LOW'  },
  { level: 'Marginal', min: 22, short: 'MARG' },
  { level: 'Slight',   min: 35, short: 'SLT'  },
  { level: 'Moderate', min: 50, short: 'MOD'  },
  { level: 'High',     min: 65, short: 'HIGH' },
  { level: 'Severe',   min: 80, short: 'SVR'  },
];

// Derived lookups — always derived from RISK_META so nothing can drift.
export const RISK_INDEX = Object.fromEntries(RISK_META.map((r, i) => [r.level, i]));
export const MIN_SCORE_PER_LEVEL = Object.fromEntries(RISK_META.map(r => [r.level, r.min]));

// Every band above "No Risk", ascending — the drawable levels.
export const ORDERED_LEVELS = RISK_META.slice(1).map(r => r.level);

// Bands rendered as filled contour layers. "Severe" is intentionally excluded:
// it is drawn as a hatched overlay on top of the colour stack, not as a fill.
export const CONTOUR_LEVELS = ['Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High'];

// [lo, hi] inclusive score range per band, e.g. LEVEL_RANGE.Marginal → [22, 34].
export const LEVEL_RANGE = {};
for (let i = 1; i < RISK_META.length; i++) {
  const next = RISK_META[i + 1];
  LEVEL_RANGE[RISK_META[i].level] = [RISK_META[i].min, next ? next.min - 1 : 100];
}

export function scoreToLevel(score) {
  for (let i = RISK_META.length - 1; i >= 0; i--) {
    if (score >= RISK_META[i].min) return RISK_META[i].level;
  }
  return 'No Risk';
}

// "(22–34)" display string for a band — used by map keys and legends.
export function fmtRange(level) {
  const range = LEVEL_RANGE[level];
  return range ? `(${range[0]}–${range[1]})` : '';
}

// Hazard-specific plain-English description for a band.
export function descFor(riskType, level) {
  const bank = RISK_DESCRIPTIONS[riskType] || RISK_DESCRIPTIONS.thunderstorm;
  return bank?.[level] ?? '';
}

// ── Per-hazard colour palettes, indexed by band (0 = No Risk … 7 = Severe) ──
// Colour values are the site's established design language — unchanged.
const _PAL_BY_INDEX = {
  thunderstorm: [
    { fill: 'transparent',             border: 'transparent', text: 'transparent', color: 'transparent' },
    { fill: 'rgba(34,139,87,0.40)',    border: '#22884f',     text: '#0f5132',     color: '#22884f' },
    { fill: 'rgba(34,170,82,0.50)',    border: '#22aa52',     text: '#14532d',     color: '#22aa52' },
    { fill: 'rgba(202,138,4,0.58)',    border: '#a3760a',     text: '#3f2d05',     color: '#a3760a' },
    { fill: 'rgba(234,88,12,0.62)',    border: '#c2410c',     text: '#431407',     color: '#c2410c' },
    { fill: 'rgba(220,38,38,0.66)',    border: '#b91c1c',     text: '#ffffff',     color: '#b91c1c' },
    { fill: 'rgba(126,34,206,0.70)',   border: '#6b21a8',     text: '#ffffff',     color: '#6b21a8' },
    { fill: 'rgba(0,0,0,0.62)',        border: '#000000',     text: '#ffffff',     color: '#312e81' },
  ],
  hail: [
    { fill: 'transparent',             border: 'transparent', text: 'transparent', color: 'transparent' },
    { fill: 'rgba(165,243,252,0.42)',  border: '#22d3ee',     text: '#155e75',     color: '#22d3ee' },
    { fill: 'rgba(34,211,238,0.52)',   border: '#0891b2',     text: '#155e75',     color: '#0891b2' },
    { fill: 'rgba(8,145,178,0.58)',    border: '#0e7490',     text: '#083344',     color: '#0e7490' },
    { fill: 'rgba(14,165,233,0.62)',   border: '#0284c7',     text: '#082f49',     color: '#0284c7' },
    { fill: 'rgba(37,99,235,0.66)',    border: '#1d4ed8',     text: '#ffffff',     color: '#1d4ed8' },
    { fill: 'rgba(67,56,202,0.70)',    border: '#3730a3',     text: '#ffffff',     color: '#3730a3' },
    { fill: 'rgba(15,23,42,0.62)',     border: '#0f172a',     text: '#ffffff',     color: '#0f172a' },
  ],
  tornado: [
    { fill: 'transparent',             border: 'transparent', text: 'transparent', color: 'transparent' },
    { fill: 'rgba(253,224,71,0.40)',   border: '#eab308',     text: '#713f12',     color: '#eab308' },
    { fill: 'rgba(245,158,11,0.50)',   border: '#d97706',     text: '#78350f',     color: '#d97706' },
    { fill: 'rgba(217,119,6,0.58)',    border: '#b45309',     text: '#451a03',     color: '#b45309' },
    { fill: 'rgba(234,88,12,0.62)',    border: '#c2410c',     text: '#7c2d12',     color: '#c2410c' },
    { fill: 'rgba(220,38,38,0.66)',    border: '#b91c1c',     text: '#ffffff',     color: '#b91c1c' },
    { fill: 'rgba(159,18,57,0.70)',    border: '#881337',     text: '#ffffff',     color: '#881337' },
    { fill: 'rgba(0,0,0,0.62)',        border: '#000000',     text: '#ffffff',     color: '#000000' },
  ],
  lightning: [
    { fill: 'transparent',             border: 'transparent', text: 'transparent', color: 'transparent' },
    { fill: 'rgba(233,213,255,0.50)',  border: '#c084fc',     text: '#581c87',     color: '#c084fc' },
    { fill: 'rgba(192,132,252,0.55)',  border: '#a855f7',     text: '#581c87',     color: '#a855f7' },
    { fill: 'rgba(168,85,247,0.60)',   border: '#9333ea',     text: '#3b0764',     color: '#9333ea' },
    { fill: 'rgba(147,51,234,0.65)',   border: '#7e22ce',     text: '#ffffff',     color: '#7e22ce' },
    { fill: 'rgba(217,70,239,0.66)',   border: '#c026d3',     text: '#ffffff',     color: '#c026d3' },
    { fill: 'rgba(107,33,168,0.70)',   border: '#581c87',     text: '#ffffff',     color: '#581c87' },
    { fill: 'rgba(30,27,75,0.62)',     border: '#1e1b4b',     text: '#ffffff',     color: '#1e1b4b' },
  ],
};

// RISK_PALETTES[riskType][levelName] → { fill, border, text, color }
export const RISK_PALETTES = {};
for (const [type, arr] of Object.entries(_PAL_BY_INDEX)) {
  RISK_PALETTES[type] = {};
  arr.forEach((entry, i) => {
    const levelName = RISK_META[i]?.level;
    if (levelName) RISK_PALETTES[type][levelName] = entry;
  });
}

// getPalette(riskType, level) → palette entry.
// Defensive to swapped arguments: some call sites historically passed
// (level, riskType). A band name is never a hazard key, so detection is exact.
export function getPalette(riskType, level) {
  if (RISK_INDEX[riskType] != null && RISK_INDEX[level] == null) {
    const swap = riskType; riskType = level; level = swap;
  }
  const pal = _PAL_BY_INDEX[riskType] ?? _PAL_BY_INDEX.thunderstorm;
  return pal[RISK_INDEX[level] ?? 0] ?? pal[0];
}

// Fill opacity per band for grid/heat rendering.
export const LEVEL_OPACITY = {
  'Very Low': 0.55,
  'Low': 0.62,
  'Marginal': 0.68,
  'Slight': 0.72,
  'Moderate': 0.76,
  'High': 0.82,
  'Severe': 0.88,
};

// Colour helpers — (level, riskType), matching every call site in the app.
// riskType defaults to the thunderstorm palette (the general-outlook colours).
export const RISK_FILL   = (level, riskType = 'thunderstorm') => getPalette(riskType, level).fill;
export const RISK_BORDER = (level, riskType = 'thunderstorm') => getPalette(riskType, level).border;
export const RISK_COLOR  = (level, riskType = 'thunderstorm') => {
  const p = getPalette(riskType, level);
  return p.color || p.border;
};