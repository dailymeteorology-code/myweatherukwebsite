/* Per-hazard, per-level human-readable descriptions used by the RiskKey
   hover tooltip. Extracted from WeatherPatterns.jsx. */
export const RISK_DESCRIPTIONS = {
  thunderstorm: {
    'No Risk':  'Atmosphere stable and capped — no energy for thunderstorms. Any cloud will be flat and stratiform. Outdoor plans unaffected.',
    'Very Low': 'Just enough instability for an isolated, brief thunderstorm during the warmest afternoon hours. A single rumble possible but not guaranteed.',
    'Low':      'Thunderstorms expected, most likely afternoon or ahead of a front. Disorganised and short-lived. Small hail <2 cm and gusty winds possible.',
    'Marginal': 'Genuine severe storm threat. Clusters can persist for hours. Frequent lightning, hail 2–3 cm, sudden flooding and gusts to 60 mph.',
    'Moderate': 'Significant organised severe weather expected. Long-lived squall lines likely. Large hail 3–5 cm, gusts 60–80 mph, significant flash flooding.',
    'High':     'Exceptionally rare and dangerous storm event. Violent supercells possible. Giant hail ≥5 cm, gusts 80–100 mph, credible tornado threat.',
    'Severe':   'Catastrophic, life-threatening convective event. Violent supercells and squall lines simultaneously. Take cover immediately.',
  },
  hail: {
    'No Risk':  'No hail-producing instability. Atmosphere lacks the CAPE and steep lapse rates needed for significant updrafts.',
    'Very Low': 'Marginal instability and a borderline freezing level may allow a few small hailstones (<1 cm) in any isolated shower.',
    'Low':      'Sufficient CAPE and a low freezing level for hail up to 1–2 cm in stronger cells. Brief crop damage possible in isolated areas.',
    'Marginal': 'Meaningful large-hail threat. CAPE and lapse rates support hail 2–4 cm. Vehicle damage and crop losses possible.',
    'Moderate': 'Organised supercell or multicell storms capable of hail 4–6 cm. Significant property damage in affected corridors.',
    'High':     'Extreme large-hail event. Hail 6–10 cm likely along storm tracks. Severe structural damage and serious injury risk.',
    'Severe':   'Catastrophic hail event — unprecedented for the UK/EU. Giant hailstones >10 cm. Roof penetration and life-threatening injury risk.',
  },
  tornado: {
    'No Risk':  'Low-level shear and the thermodynamic profile are entirely unfavourable for tornado development.',
    'Very Low': 'Very marginal environment. A brief, weak landspout (T0–T1) is theoretically possible but highly unlikely.',
    'Low':      'A weak tornado environment exists. An isolated weak tornado (T1–T2) cannot be ruled out near stronger cells.',
    'Marginal': 'Genuine, if marginal, tornado risk. Organised storms could produce T2–T3 tornadoes. Damage to trees and outbuildings possible.',
    'Moderate': 'Significant tornado threat. Supercell-capable environment. T3–T5 tornadoes possible with major structural damage along any track.',
    'High':     'Rare and dangerous tornado outbreak. Multiple significant tornadoes (T4–T6) possible. Widespread severe damage and risk to life.',
    'Severe':   'Unprecedented violent tornado event. T6+ tornadoes possible with long damage tracks. Seek immediate underground shelter.',
  },
  lightning: {
    'No Risk':  'Atmosphere stable with no convective development expected. No lightning risk.',
    'Very Low': 'A very isolated storm may produce a few cloud-to-ground strokes during peak heating. Probability low.',
    'Low':      'Thunderstorms with frequent lightning expected in isolated areas. Yellow warning plausible. Seek shelter if thunder is heard.',
    'Marginal': 'Frequent, intense lightning from organised convection. Multiple strikes per minute within storm cores.',
    'Moderate': 'Very frequent lightning from long-lived clusters or squall lines. Power disruption, wildfires and fatality risk are elevated.',
    'High':     'Extreme lightning event. Positive cloud-to-ground strikes likely. Infrastructure damage and serious risk to life.',
    'Severe':   'Catastrophic lightning environment — effectively unprecedented. Continuous activity across a broad area.',
  },
};