/* TCM FROST's key, one place for every page that shows the snow model: Model Data's snow layers
   and its snow overlay, and the Location page's snow card.

   The risk levels are the engine's own (tools/tcm-frost/frost/config.py RISK_RULES): each is the
   chance, across every forecast blended, of so much snow falling in 24 hours. Any one rule is
   enough. The amount bands are the overlay's outlines of the snow expected to fall. */

export const SNOW_RISK_LEVELS = [
  { level: 1, name: 'Low', short: 'Low', colour: '#a5d8ff', rule: 'a 25% chance of a dusting (0.2 cm)' },
  { level: 2, name: 'Moderate', short: 'Mod', colour: '#4dabf7', rule: 'a 30% chance of 1 cm, or 15% of 2 cm' },
  { level: 3, name: 'High', short: 'High', colour: '#845ef7', rule: 'a 30% chance of 5 cm, or 65% of 2 cm' },
  { level: 4, name: 'Severe', short: 'Severe', colour: '#e64980', rule: 'a 30% chance of 10 cm, or 70% of 5 cm' },
];
export const SNOW_RISK_NAMES = ['None', ...SNOW_RISK_LEVELS.map((l) => l.name)];
/** The level for a risk byte (0-4): null for none. */
export const snowRiskLevel = (v) => (v >= 1 ? SNOW_RISK_LEVELS[Math.min(4, Math.round(v)) - 1] : null);

export const SNOW_AMOUNT_LEVELS = [
  { cm: 1, name: '1 cm', colour: '#9cc9f5' },
  { cm: 5, name: '5 cm', colour: '#5c7cfa' },
  { cm: 10, name: '10 cm', colour: '#be4bdb' },
  { cm: 20, name: '20 cm', colour: '#f783ac' },
];

/** "a dusting", "0.6 cm", "4 cm", "12 cm" */
export const cmText = (cm) => (cm == null ? '—' : cm < 0.2 ? 'none' : cm < 0.5 ? 'a dusting' : cm < 2 ? `${cm.toFixed(1).replace(/\.0$/, '')} cm` : `${Math.round(cm)} cm`);
