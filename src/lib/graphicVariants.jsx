/**
 * Variants of the outlook studio (SnowOutlookGraphicTool): one studio, one look —
 * the Thunderstorm Outlook's glass header, timeline, key, drawing, hazards and export —
 * with each graphic only changing what it means.
 *
 * Every variant keeps the SAME level ids ('Very Low' … 'High', 'Conditional Severe',
 * 'Severe'); only the labels, ranges and colours differ. All drawing, timeline, save and
 * export logic keys on those ids, so it works unchanged for every variant.
 */
import { Snowflake, Wind, CloudDrizzle, CloudLightning, AlertTriangle, ThermometerSnowflake,
  Waves, TreePine, Car, PlugZap, Layers, Gauge } from 'lucide-react';
import { SNOW_BACKGROUNDS } from '@/lib/snowBackgrounds';

const fillOf = (hex, a) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};
// [id, short, range, colour, fill alpha]
const lv = (rows) => rows.map(([id, short, range, color, a]) => ({ id, short, range, color, fill: fillOf(color, a), border: color }));

const SNOW_HAZARDS = [
  { id: 'heavysnow',    label: 'Heavy Snow',           Icon: Snowflake,            color: '#e0f2fe', hatched: false },
  { id: 'blizzard',     label: 'Blizzards / Drifting', Icon: Wind,                 color: '#93c5fd', hatched: false },
  { id: 'ice',          label: 'Ice',                  Icon: ThermometerSnowflake, color: '#67e8f9', hatched: false },
  { id: 'freezingrain', label: 'Freezing Rain',        Icon: CloudDrizzle,         color: '#a5f3fc', hatched: false },
  { id: 'thundersnow',  label: 'Thundersnow',          Icon: CloudLightning,       color: '#facc15', hatched: false },
  { id: 'severe',       label: 'Severe',               Icon: AlertTriangle,        color: '#a5b4fc', hatched: true  },
];

const WIND_HAZARDS = [
  { id: 'gusts',     label: 'Damaging Gusts',     Icon: Wind,          color: '#fde68a', hatched: false },
  { id: 'gales',     label: 'Coastal Gales',      Icon: Gauge,         color: '#fdba74', hatched: false },
  { id: 'waves',     label: 'Large Waves',        Icon: Waves,         color: '#7dd3fc', hatched: false },
  { id: 'trees',     label: 'Falling Trees',      Icon: TreePine,      color: '#86efac', hatched: false },
  { id: 'travel',    label: 'Travel Disruption',  Icon: Car,           color: '#c4b5fd', hatched: false },
  { id: 'power',     label: 'Power Cuts',         Icon: PlugZap,       color: '#fca5a5', hatched: false },
  { id: 'severe',    label: 'Severe',             Icon: AlertTriangle, color: '#f9a8d4', hatched: true  },
];

export const WIND_BACKGROUNDS = [
  { id: 'coast', label: 'Coastal gale', url: '/uploads/wind-bg-coast.webp', credit: '' },
];

/* What each graphic takes from the models. `overlay`: the UKV field drawn under the drawing
   (studio/ModelOverlay), in the key's colours from each `mins`. `guide`: how "From the models"
   builds areas (studio/ModelGuidePanel), contoured at `mins` (one per level, lowest first). */
const pct = (v) => `${Math.round(v * 100)}%`;
const cm = (v) => (v < 1 ? `${Math.round(v * 10) / 10} cm` : `${Math.round(v)} cm`);
const mph = (v) => `${Math.round(v)} mph`;
const SNOWFALL_OVERLAY = { v: 'snow_rate', scale: 1, mins: [0.1, 0.3, 0.6, 1, 2, 4], label: 'UKV snowfall', note: 'Met Office UKV 2 km snowfall rate (cm an hour at 10:1) from the AWS open data.' };
const CHANCE_GUIDE = (threshold, title) => ({
  kind: 'chance', threshold, title, fmt: pct, mins: [0.05, 0.12, 0.22, 0.35, 0.5, 0.65],
  note: `The share of the 100 ECMWF ENS and AIFS ENS members giving ${threshold} cm or more of snow in 24 hours, the highest within about 15 miles.`,
});

export const GRAPHIC_VARIANTS = {
  chance: {
    title: 'Snow Chance', Icon: Snowflake, tool: 'snow', file: 'snow-chance', auto: true,
    footer: 'Risk of snow settling within a 15 mile radius', keyNote: 'SVRE = SEVERE SNOW RISK',
    backgrounds: SNOW_BACKGROUNDS, hazards: SNOW_HAZARDS,
    levels: lv([
      ['Very Low', 'FLRY', '5-11%', '#e2e8f0', 0.32], ['Low', 'LGHT', '12-21%', '#bae6fd', 0.38],
      ['Marginal', 'MRGL', '22-34%', '#7dd3fc', 0.42], ['Slight', 'SLGT', '35-49%', '#38bdf8', 0.45],
      ['Moderate', 'MDT', '50-64%', '#818cf8', 0.48], ['High', 'HIGH', '65-100%', '#e879f9', 0.50],
    ]),
    severe: { short: 'SVRE', range: 'SVR SNOW' },
    radar: true,
    overlay: SNOWFALL_OVERLAY,
    guide: CHANCE_GUIDE(1, 'Chance of settling snow.'),
  },
  accumulation: {
    title: 'Snow Accumulation', Icon: Layers, tool: 'snowacc', file: 'snow-accumulation', auto: false,
    footer: 'Expected depth of lying snow', keyNote: 'SVRE = EXCEPTIONAL SNOWFALL',
    backgrounds: SNOW_BACKGROUNDS, hazards: SNOW_HAZARDS,
    levels: lv([
      ['Very Low', 'DUST', '<1 cm', '#cfe8ff', 0.34], ['Low', '1-2', '1-2 cm', '#93c5fd', 0.40],
      ['Marginal', '2-5', '2-5 cm', '#60a5fa', 0.44], ['Slight', '5-10', '5-10 cm', '#6366f1', 0.46],
      ['Moderate', '10-20', '10-20 cm', '#9333ea', 0.48], ['High', '20+', '20+ cm', '#d946ef', 0.50],
    ]),
    severe: { short: 'SVRE', range: '30+ CM' },
    radar: true,
    overlay: { v: 'snow_swe', scale: 1, mins: [0.3, 1, 2, 5, 10, 20], label: 'UKV lying snow', note: 'Met Office UKV 2 km lying snow (its water content, shown as depth at 10:1) from the AWS open data.' },
    guide: {
      kind: 'amount', title: 'Snowfall.', fmt: cm, mins: [0.3, 1, 2, 5, 10, 20],
      note: 'The ECMWF ENS median (50 members, 16 km), or the UKV 2 km for the next two to five days.',
      sources: [['ens', 'ECMWF ENS median'], ['ukv', 'UKV 2 km']],
    },
  },
  risk: {
    title: 'Snow Risk', Icon: AlertTriangle, tool: 'snowrisk', file: 'snow-risk', auto: false,
    footer: 'Risk of disruption from snow and ice', keyNote: 'SVRE = SEVERE DISRUPTION LIKELY',
    backgrounds: SNOW_BACKGROUNDS, hazards: SNOW_HAZARDS,
    levels: lv([
      ['Very Low', 'V LOW', 'Isolated', '#e2e8f0', 0.32], ['Low', 'LOW', 'Wintry mix', '#bae6fd', 0.38],
      ['Marginal', 'MRGL', 'Falling snow', '#7dd3fc', 0.42], ['Slight', 'SLGT', 'Some settling', '#38bdf8', 0.45],
      ['Moderate', 'MOD', 'Disruptive', '#818cf8', 0.48], ['High', 'HIGH', 'Significant', '#e879f9', 0.50],
    ]),
    severe: { short: 'SVRE', range: 'SEVERE' },
    radar: true,
    overlay: SNOWFALL_OVERLAY,
    guide: CHANCE_GUIDE(5, 'Chance of disruptive snow.'),
  },
  wind: {
    title: 'Wind', Icon: Wind, tool: 'wind', file: 'wind', auto: false,
    footer: 'Peak gusts within a 15 mile radius', keyNote: 'SVRE = SEVERE / DAMAGING WINDS',
    backgrounds: WIND_BACKGROUNDS, hazards: WIND_HAZARDS,
    levels: lv([
      ['Very Low', '40-50', '40-50 mph', '#fef08a', 0.34], ['Low', '50-60', '50-60 mph', '#fde047', 0.40],
      ['Marginal', '60-70', '60-70 mph', '#fb923c', 0.44], ['Slight', '70-80', '70-80 mph', '#ef4444', 0.46],
      ['Moderate', '80-90', '80-90 mph', '#be123c', 0.48], ['High', '90+', '90+ mph', '#a21caf', 0.50],
    ]),
    severe: { short: 'SVRE', range: 'SVR WIND' },
    radar: false,
    overlay: { v: 'gust_max', scale: 1, mins: [40, 50, 60, 70, 80, 90], label: 'UKV gusts', note: 'Met Office UKV 2 km strongest gust in the hour (mph) from the AWS open data.' },
    guide: {
      kind: 'gust', title: 'Gusts.', fmt: mph, mins: [40, 50, 60, 70, 80, 90],
      note: 'The UKV 2 km strongest gust in each hour, or the ECMWF ENS median of each 6-hour maximum.',
      sources: [['ukv', 'UKV 2 km'], ['ens', 'ECMWF ENS median']],
    },
  },
};

export const variantOf = (id) => GRAPHIC_VARIANTS[id] || GRAPHIC_VARIANTS.chance;
