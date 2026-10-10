/* RISK_META + RISK_PALETTES + helpers for risk-level colours and labels.
   Extracted from pages/WeatherPatterns.jsx to keep that file under the
   line-count limit. */

export const RISK_META = [
  {
    level: 'No Risk',
    color: '#64748b',
    fill: 'rgba(100,116,139,0.18)',
    border: 'rgba(100,116,139,0.55)',
    description:
      'The atmosphere is stable and firmly capped — there is simply no energy available for thunderstorms to form. Any cloud around will be the flat, grey stratiform type associated with fronts or overnight radiative cooling, producing at most light rain or drizzle. You can confidently plan outdoor activities without any concern about lightning or thunder.',
  },
  {
    level: 'Very Low',
    color: '#16a34a',
    fill: 'rgba(22,163,74,0.20)',
    border: 'rgba(22,163,74,0.65)',
    description:
      'There is just enough atmospheric instability for an isolated thunderstorm to briefly flicker into life, most likely during the warmest part of the afternoon inland. Storms will be short-lived and disorganised. A single rumble of thunder is possible but far from guaranteed. No disruption is expected.',
  },
  {
    level: 'Low',
    color: '#15803d',
    fill: 'rgba(21,128,61,0.22)',
    border: 'rgba(21,128,61,0.65)',
    description:
      'Thunderstorms are expected to develop, most likely during the afternoon or ahead of an approaching weather front. Storms will remain disorganised and relatively short-lived. Small hail below 2 cm and gusty winds within the storm are possible. Flash flooding is a low-end concern. A yellow weather warning may be issued.',
  },
  {
    level: 'Marginal',
    color: '#ca8a04',
    fill: 'rgba(202,138,4,0.22)',
    border: 'rgba(202,138,4,0.65)',
    description:
      'A genuine severe weather threat exists. Storms can organise into clusters and persist for several hours. Hazards include frequent intense lightning, hail up to 2–3 cm, sudden flooding from very heavy rainfall, and gusts up to 60 mph. A Met Office yellow warning is likely. Actively monitor radar and reconsider prolonged outdoor plans.',
  },
  {
    level: 'Moderate',
    color: '#ea580c',
    fill: 'rgba(234,88,12,0.22)',
    border: 'rgba(234,88,12,0.70)',
    description:
      'A significant and well-organised severe weather event is expected. Long-lived squall lines or clusters are likely. Hazards include very frequent lightning, large hail 3–5 cm, destructive gusts 60–80 mph, and significant flash flooding. A Met Office amber or yellow warning will be in force. Avoid unnecessary travel during peak risk.',
  },
  {
    level: 'High',
    color: '#dc2626',
    fill: 'rgba(220,38,38,0.22)',
    border: 'rgba(220,38,38,0.70)',
    description:
      'An exceptionally rare and dangerous storm event is forecast. Violent, long-lived supercells are possible. Giant hail ≥5 cm, extreme gusts 80–100 mph, life-threatening flash flooding and a credible tornado threat are all on the table. A Met Office red or amber warning will be in force. Treat as a major civil emergency.',
  },
  {
    level: 'Severe',
    color: '#000000',
    fill: 'rgba(20,20,20,0.30)',
    border: 'rgba(255,255,255,0.45)',
    description:
      'A catastrophic, life-threatening convective event is underway or imminent — effectively unprecedented for the UK. Violent supercells and squall lines simultaneously, devastating hail, hurricane-force gusts, multiple significant tornadoes and catastrophic flash flooding. A Met Office red warning will be in force. This is a genuine threat to life — take cover immediately.',
  },
];
export const RISK_INDEX = Object.fromEntries(RISK_META.map((r, i) => [r.level, i]));