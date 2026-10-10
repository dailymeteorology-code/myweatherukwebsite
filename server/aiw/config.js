/**
 * Warning decision criteria. Every number the warning engine uses to decide
 * anything lives here, is editable in the admin panel, and is recorded on each
 * warning so a decision can always be traced to the rules in force at the time.
 *
 * The strike-rate thresholds are starting values chosen from the published
 * climatology of thunderstorm flash rates (an ordinary cell produces a few
 * cloud-to-ground strikes a minute, a severe one tens); the training pipeline
 * reports the actual percentiles of cell strike rates in the archive and the
 * admin panel can re-derive them from data (see train.js `deriveThresholds`).
 */
import { getState, saveState } from './store.js';

export const DEFAULT_CONFIG = {
  // Probability contour that defines a warning area: the 0.40 isoline of the
  // model's P(lightning within 8 km) over the next 10 minutes.
  areaProbability: 0.40,
  // A lower isoline for the uncertainty corridor of the 30-minute track.
  corridorProbability: 0.20,
  // Smallest area worth a warning (km²) — smaller is a single flash, not a storm.
  minAreaKm2: 60,
  // A cell must be seen this many cycles (minutes) before a first warning, so
  // one stray cluster of strikes does not trigger an alert.
  minCyclesToIssue: 3,

  // At least a strike a minute, sustained: one isolated cluster of a few
  // flashes is a shower with lightning, not something to warn people about.
  yellow: { minStrikes10: 10, minPeakProbability: 0.5 },
  amber: {
    minStrikesPerMin: 6,          // sustained rate
    minPeakProbability: 0.70,
    // OR an approaching storm reaching a populated area soon
    approachPopulation: 150000, approachMinutes: 20, approachMinStrikesPerMin: 2,
    // OR rapid intensification
    rapidTrendLogRatio: 0.9, rapidMinStrikesPerMin: 3,
  },
  red: {
    minStrikesPerMin: 20,
    minPeakDensity100: 6,         // strikes per 100 km² in 10 min at the core
    minPeakProbability: 0.85,
    minExposedPopulation: 50000,  // OR an exceptional rate regardless:
    exceptionalStrikesPerMin: 40,
    minConfidence: 'medium',
  },

  // Hysteresis: a higher level must be indicated this many consecutive cycles
  // before escalating; a lower level this many before downgrading. Exit
  // thresholds are the entry thresholds times exitFactor.
  escalateCycles: 2,
  downgradeCycles: 4,
  exitFactor: 0.7,

  // Expiry bounds (minutes). The engine computes each warning's own expiry
  // from the predicted duration and transit time; these are only the limits.
  minDurationMin: 30,
  maxDurationMin: 180,
  // A warning whose storm has produced nothing for this long is cancelled.
  quietCancelMin: 15,

  // Coverage: where the lightning network is only partial, warnings are
  // capped at this level.
  partialCoverageCap: 'amber',

  // Announce material updates (area / expiry change) as short spoken updates.
  announceUpdates: true,
};

const LEVEL = { yellow: 1, amber: 2, red: 3 };
export const levelRank = (s) => LEVEL[s] || 0;
export const SEVERITIES = ['yellow', 'amber', 'red'];

export function getConfig() {
  const s = getState();
  return deepMerge(DEFAULT_CONFIG, s.config || {});
}

export function setConfig(patch) {
  const s = getState();
  const merged = deepMerge(getConfig(), patch || {});
  const errs = validateConfig(merged);
  if (errs.length) { const e = new Error(errs.join('; ')); e.status = 400; throw e; }
  s.config = merged;
  saveState({ now: true });
  return merged;
}

export function validateConfig(c) {
  const errs = [];
  const p = (v, name) => { if (!(v > 0 && v < 1)) errs.push(`${name} must be between 0 and 1`); };
  p(c.areaProbability, 'areaProbability'); p(c.corridorProbability, 'corridorProbability');
  if (c.corridorProbability >= c.areaProbability) errs.push('corridorProbability must be below areaProbability');
  if (!(c.minDurationMin >= 10 && c.maxDurationMin <= 720 && c.minDurationMin < c.maxDurationMin)) errs.push('duration bounds invalid');
  if (!(c.amber.minStrikesPerMin < c.red.minStrikesPerMin)) errs.push('amber rate must be below red rate');
  if (!(c.exitFactor > 0.2 && c.exitFactor < 1)) errs.push('exitFactor must be between 0.2 and 1');
  if (!['yellow', 'amber', 'red'].includes(c.partialCoverageCap)) errs.push('partialCoverageCap must be yellow, amber or red');
  return errs;
}

function deepMerge(a, b) {
  if (Array.isArray(a) || typeof a !== 'object' || a === null) return b === undefined ? a : b;
  const out = { ...a };
  for (const k of Object.keys(b || {})) out[k] = k in a ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
