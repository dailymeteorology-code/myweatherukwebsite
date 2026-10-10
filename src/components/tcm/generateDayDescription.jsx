// generateDayDescription.js
// Produces a deeply unique, meteorologist-grade narrative for each day+risk combination.
// Every paragraph is driven by the actual numeric values so no two days share copy.
// Structure: Fingerprint → Ingredients → Hazards+Timing → Confidence+Outlook

// ─── helpers ────────────────────────────────────────────────────────────────

function descs(level) {
  return ({
    'Very Low': 'very low', 'Low': 'low', 'Marginal': 'marginal',
    'Slight': 'slight', 'Moderate': 'moderate', 'High': 'high', 'Severe': 'severe',
  })[level] ?? (level || '').toLowerCase();
}

// Returns a rich, unique CAPE characterisation based on exact value buckets
function capeProfile(cape) {
  if (cape > 3500) return {
    tier: 'extreme',
    prose: `CAPE is reaching **${cape} J/kg** — a truly exceptional value for this region, the kind of thermodynamic depth more commonly associated with the central US Great Plains than northwest Europe. Updraughts will be explosively vigorous, likely sustaining 40–60 m/s vertical velocities in mature cells`,
  };
  if (cape > 2500) return {
    tier: 'extreme',
    prose: `CAPE is peaking near **${cape} J/kg** — values this extreme are rare for the region and place the setup firmly in the continental severe weather category. Deep, wide updraughts are expected; entrainment won't dilute this much instability`,
  };
  if (cape > 1800) return {
    tier: 'strong-to-extreme',
    prose: `CAPE of approximately **${cape} J/kg** is available in the most unstable pockets — strong-to-extreme by any regional standard. Sufficient to drive and sustain discrete, organised supercell updraughts if shear cooperates`,
  };
  if (cape > 1200) return {
    tier: 'moderate-to-strong',
    prose: `CAPE is peaking near **${cape} J/kg** — a solid moderate-to-strong profile for the region. Convective initiation may require a trigger, but once cells fire the instability will sustain organised updraughts for extended periods`,
  };
  if (cape > 700) return {
    tier: 'moderate',
    prose: `A moderate CAPE environment is in place, peaking near **${cape} J/kg**. Enough to support vigorous shower and thunderstorm development in the presence of adequate lifting mechanisms — multicell organisation is achievable`,
  };
  if (cape > 300) return {
    tier: 'modest',
    prose: `CAPE sits in the modest range, peaking near **${cape} J/kg**. Sufficient for isolated thundery showers and pulse convection, though significant storm organisation will require other factors to compensate`,
  };
  if (cape > 100) return {
    tier: 'limited',
    prose: `CAPE is limited — around **${cape} J/kg**. Only isolated, weakly-electrified showers are really on the table here; deep, sustained updraughts are unlikely without a very focused lifting mechanism`,
  };
  return {
    tier: 'marginal',
    prose: `CAPE is essentially negligible — below 100 J/kg. The thermodynamic profile actively suppresses deep convection and any storm development will be fleeting and shallow`,
  };
}

// Returns shear prose unique to numeric value
function shearProfile(shear) {
  if (shear > 50) return `Deep-layer bulk shear is in the **exceptional range (${shear}+ kt)**, a configuration that virtually mandates discrete supercell structures with persistent rotating mesocyclones. Storm-relative helicity and hodograph curvature will govern whether the tornado threat escalates to significant`;
  if (shear > 40) return `Deep-layer shear of **${shear}+ kt** is remarkably strong — long-lived supercells with well-organised rotation are the expected storm mode. Individual cells will likely remain discrete and intense rather than merging into disorganised clusters`;
  if (shear > 30) return `Deep-layer shear is **strong (${shear}+ kt)**, firmly favouring organised, elongated multicells and supercell structures. Storms initiating in this environment will tend to deviate right of the mean flow and acquire rotation through dynamic tilting`;
  if (shear > 20) return `Deep-layer shear of **~${shear} kt** is supportive of storm organisation. Multicell clusters are the expected dominant mode with supercell potential in any favoured corridor; splitting storms are possible if a discrete cell gains enough updraught depth`;
  if (shear > 12) return `Wind shear is **moderate (~${shear} kt)** — sufficient to give multicell organisation and brief bowing structures, though discrete supercells remain less likely. Storm lifetimes will be longer than typical pulse convection`;
  if (shear > 6)  return `Shear is **modest (~${shear} kt)** — storms will be primarily pulse or weakly-organised multicells with relatively short individual lifetimes. Cell mergers may briefly enhance hazard intensity near squall boundaries`;
  return `Wind shear is **weak throughout the column** — convection will be dominated by single-cell pulse storms. Individual lifetimes measured in tens of minutes; organisation into larger structures is unlikely`;
}

// Builds a unique location sentence avoiding repetitive phrasing
function locationPhrase(locs) {
  if (!locs?.length) return null;
  const top = locs.slice(0, 5).map(l => l.name);
  const countries = [...new Set(locs.map(l => l.country))].slice(0, 2);
  const count = locs.length;

  if (top.length === 1) return `concentrated **around ${top[0]}**`;
  if (top.length === 2) return `centred on **${top[0]}** and **${top[1]}**`;

  const named = [...top.slice(0, 3)];
  const cityStr = named.slice(0, -1).map(n => `**${n}**`).join(', ') + ` and **${named[named.length - 1]}**`;
  const overflow = count - 3;
  const suffix = overflow > 3
    ? `, with ${overflow} further areas at elevated risk`
    : countries.length > 1
      ? ` straddling **${countries.join(' and ')}**`
      : '';
  return `spanning ${cityStr}${suffix}`;
}

// Day offset phrase — varied so repeated calls don't produce identical strings
function dayPhase(idx) {
  return ['today', 'tomorrow', 'in two days\' time', 'on the extended outlook day'][idx] ?? `day ${idx + 1}`;
}

// Timing phrase keyed on risk type and diurnal phase of peak
function timingBlock(dayIdx, score, riskType, cape, peakHour) {
  if (score < 18) return null;

  // Try to reference the actual expected peak if known
  const peakWindow = peakHour != null
    ? `around **${String(peakHour).padStart(2, '0')}:00–${String((peakHour + 3) % 24).padStart(2, '0')}:00 UTC**`
    : riskType === 'lightning'
      ? 'the **mid-afternoon to early evening window (13–20 UTC)**'
      : cape > 1000
        ? 'the **afternoon peak-heating window (13–18 UTC)**'
        : 'the **afternoon and early evening (12–20 UTC)**';

  const decay = riskType === 'tornado'
    ? 'activity should diminish after dark as the low-level jet adjusts and surface heating fades'
    : 'the boundary layer will stabilise rapidly after sunset, accelerating storm decay';

  const morning = score > 50 && dayIdx === 0
    ? ' Morning conditions may appear deceptively quiet — the real threat loads through the afternoon as the boundary layer deepens.'
    : '';

  return `**⏱ Timing:** Convective initiation is most likely during ${peakWindow}.${morning} Through the evening, ${decay}.`;
}

// Confidence block — distinct wording for each score bracket and day horizon
function confidenceBlock(score, dayIdx) {
  const tier = score > 65 ? 'HIGH'
             : score > 45 ? 'MODERATE-TO-HIGH'
             : score > 28 ? 'MODERATE'
             : 'LOW-TO-MODERATE';

  const horizon = {
    0: [
      `Short-range guidance is tightly clustered and the synoptic signal is well-established — confidence in both the risk level and geographic footprint is high`,
      `Mesoscale details (exact initiation points, storm mode) retain typical short-range spread — monitor high-resolution CAM output through the morning`,
    ],
    1: [
      `24-hour guidance is converging on a coherent signal; confidence in the broad risk area is good though initiation timing may shift by 1–2 hours across model suites`,
      `Some inter-model spread remains on the exact thermodynamic profile — a few-hundred J/kg CAPE uncertainty is within expected range for this horizon`,
    ],
    2: [
      `Medium-range uncertainty applies — the overall pattern is captured but the precise risk corridor and storm-mode details will refine significantly in subsequent model runs`,
      `Confidence in the synoptic driver (low/front/trough) is higher than in the mesoscale specifics; treat the risk area as indicative rather than definitive at this range`,
    ],
    3: [
      `Extended-range outlook: significant evolution is expected before the event. Treat as a signal to monitor rather than a firm forecast`,
      `Ensemble spread is wide at this horizon — subsequent runs over the coming 48–72 hours will sharpen both the risk level and geographic focus`,
    ],
  }[Math.min(dayIdx, 3)] ?? ['Extended range; guidance evolves rapidly.'];

  return `**📊 Confidence: ${tier}** — ${horizon[Math.floor(Math.random() * horizon.length)]}.`;
}

// ─── risk-specific paragraph generators ────────────────────────────────────

function thunderstormHazardPara(score, sub, r, level, locPhrase, hailMm, precip, gust) {
  const hazards = [];
  const tor  = sub.tornado    ?? 0;
  const hail = sub.hail       ?? 0;
  const ff   = sub.flashFlood ?? 0;
  const sw   = sub.strongWinds ?? 0;
  const sup  = sub.supercell  ?? 0;

  // Only name hazards that clear meaningful thresholds
  if (sup  > 30) hazards.push({ label: `**supercell storm structures** with organised, long-lived updraughts`, weight: sup  });
  if (tor  > 30) hazards.push({ label: `**isolated tornado potential**`, weight: tor  });
  if (hail > 40) hazards.push({ label: `**large hail to ${hailMm > 0 ? hailMm + ' mm' : '20+ mm'}**`, weight: hail });
  else if (hail > 20) hazards.push({ label: `small-to-moderate hail`, weight: hail });
  if (ff   > 40) hazards.push({ label: `**flash-flood risk from intense rainfall (up to ${precip} mm/h)**`, weight: ff   });
  else if (precip > 20) hazards.push({ label: `locally intense rainfall (${precip} mm/h)`, weight: precip });
  if (sw   > 30 || gust > 45) hazards.push({ label: `**damaging downburst gusts (~${gust || '45+'} mph)**`, weight: sw });
  hazards.push({ label: `frequent cloud-to-ground lightning`, weight: 5 });

  // Sort by severity weight descending
  hazards.sort((a, b) => b.weight - a.weight);
  const hazardStr = hazards.length > 1
    ? hazards.slice(0, -1).map(h => h.label).join(', ') + ', and ' + hazards[hazards.length - 1].label
    : hazards[0].label;

  let para = `**Primary hazards:** The storm environment supports ${hazardStr}. `;
  if (locPhrase) para += `The zone of greatest organised risk is ${locPhrase}. `;

  if (level === 'Severe' || level === 'High') {
    para += `This is a **high-impact convective day requiring proactive action**: confirm your shelter plan now, secure all loose outdoor items, monitor official severe weather warnings continuously. Avoid open ground, isolated trees, hilltops and open water when storms are in the area. Treat every yellow sky and rumble of thunder as a real warning.`;
  } else if (level === 'Moderate') {
    para += `While most locations will see only isolated activity, any storm that does develop will carry the full suite of hazards listed above. Outdoor plans should include an escape route to a solid structure, and anyone working exposed ground should be weather-radar-aware throughout the afternoon.`;
  } else {
    para += `Individual cell variability is significant at this risk level — any given location may experience nothing at all, or a brief but sharp convective event. Local knowledge of drainage patterns and exposed routes is valuable.`;
  }
  return para;
}

function hailHazardPara(score, hailMm, cov, locPhrase) {
  let para = `**Hail is the principal hazard** on this setup. `;
  if (hailMm >= 40) {
    para += `**Very large hail — potentially ${hailMm} mm or greater (approaching or exceeding golf-ball size)** — is achievable within the most vigorous supercell updraughts. At this size hail causes structural damage to vehicles, roof glazing, glasshouses and standing crops in minutes. Assess exposure now.`;
  } else if (hailMm >= 25) {
    para += `**Large hail around ${hailMm} mm** is possible within supercell-style updraughts. Vehicles, polytunnels, mature crops and exposed skylights are directly at risk — the stones are large enough to dent bodywork, shatter glass and strip foliage.`;
  } else if (hailMm >= 15) {
    para += `Hail up to **${hailMm} mm** — marble-to-2p-coin size — is expected in the stronger cores. While not causing structural damage in most cases, this size can strip crops, crack plastic cloches and pose a pain risk to livestock and people caught outdoors.`;
  } else {
    para += `Small hail (pea-to-marble size, up to ~10 mm) is the primary hail mode here. Accumulations in hollows and gutters could cause transient drainage issues, though structural damage is unlikely.`;
  }
  if (locPhrase) para += ` The highest probability zone is ${locPhrase}`;
  para += `, with potential areal coverage near **${cov}%** of the region.`;
  return para;
}

function tornadoHazardPara(score, locPhrase, shear) {
  const genuine = score > 60;
  const moderate = score > 35;

  let para = `**Tornado is the headline concern** on this forecast. `;
  if (genuine) {
    para += `The combination of low-level shear, surface-based helicity and available CAPE is **genuinely conducive to sustained mesocyclone development**. Long-track tornadoes and T3+ intensity events cannot be dismissed — the wind profile alone would support them in any storm that achieves sustained rotation. `;
    para += locPhrase ? `Highest probability is ${locPhrase}. ` : '';
    para += `Have a **basement or interior-room shelter plan active and ready**. If a tornado warning is issued, act immediately — do not attempt to drive out of the path.`;
  } else if (moderate) {
    para += `A credible tornado environment exists — brief to moderately-significant spin-ups (T1–T3) are achievable, particularly embedded within any organised supercell or squall-line bow echo. `;
    para += locPhrase ? `The favoured zone is ${locPhrase}. ` : '';
    para += `Tornadoes in this environment are typically short-track (under 10 km) but can cause significant damage in seconds. Monitor rotating radar signatures closely.`;
  } else {
    para += `The threat is **limited** but non-zero — brief, weak funnel clouds and T0–T1 spin-ups embedded in organised shower clusters are the primary concern. Most events would be sub-minute in duration. `;
    para += `Any rotating storm or hook echo on radar warrants immediate situational awareness regardless of the relatively low headline risk.`;
  }
  return para;
}

function lightningHazardPara(score, cov, locPhrase) {
  const density = score > 65 ? 'extreme'
                : score > 45 ? 'very high'
                : score > 28 ? 'high'
                : 'moderate';
  let para = `**Cloud-to-ground lightning is the primary hazard** on this outlook. `;
  para += `Expected flash density is **${density}** across roughly **${cov}%** of the affected region. `;
  if (locPhrase) para += `The most concentrated CG activity is expected ${locPhrase}. `;
  para += `Lightning at this density level poses an immediate life-safety risk to anyone outdoors: exposed ridgelines, golf courses, open water bodies, construction sites and festival grounds are the highest-risk environments. `;
  para += `The **30-minute rule applies rigorously here**: once thunder is heard, be inside a substantial building or a hard-topped metal vehicle, and remain there until 30 full minutes have passed after the final thunder clap. Do not shelter under trees or in lightweight structures — these are more dangerous than open ground in close-strike scenarios.`;
  return para;
}

// ─── extended outlook paragraph ─────────────────────────────────────────────

function extendedOutlookPara(score, level, riskType, cape, shear, gust, hailMm, precip, run, regionLabel, dayIdx) {
  if (score < 12) return '';

  const m = new Date(run).getMonth();
  const season = m <= 1 || m === 11 ? 'winter'
               : m <= 4             ? 'spring'
               : m <= 7             ? 'summer'
               :                      'autumn';

  // Build a truly unique synoptic narrative from the numbers
  const drivers = [];
  if (cape > 800)  drivers.push(`a **deep reservoir of instability (${cape} J/kg CAPE)** that will reload rapidly through daytime heating`);
  else if (cape > 200) drivers.push(`**modest instability (${cape} J/kg)** concentrated near the surface — sensitive to boundary-layer evolution`);

  if (shear > 25) drivers.push(`**strong deep-layer shear (${shear} kt)** that will vector any initiated cell into organised discrete storm mode`);
  else if (shear > 12) drivers.push(`**moderate wind shear (${shear} kt)** providing storm organisation without the complexities of a full supercell environment`);

  if (gust > 40)  drivers.push(`**strong cold-pool dynamics** capable of generating downdraft-driven gusts near ${gust} mph even from weakly-organised cells`);

  const driverStr = drivers.length > 1
    ? drivers.slice(0, -1).join(', ') + ', and ' + drivers[drivers.length - 1]
    : drivers[0] || 'a subtly-charged airmass with latent instability';

  let para = `📡 **Extended Context:** This ${season} setup is characterised by ${driverStr}. `;

  // Risk-specific narrative flavour — different for every type
  if (riskType === 'thunderstorm') {
    if (score >= 55) {
      para += `Setups of this thermodynamic weight often under-perform on morning soundings but over-deliver once the afternoon mixed layer deepens and surface-based parcels become unrestricted. Storm chasers and weather-aware professionals should treat this as a **primary observation day**. The general public should identify their nearest substantial shelter now, not when anvils are visible on the horizon. `;
    } else if (score >= 35) {
      para += `The afternoon thermodynamic profile has enough depth that any storm initiating in the primary convergence zone will have access to the full instability for at least 2–3 hours. Cell mergers, mesovortex development along bow segments and brief supercell structures are all achievable within that window. `;
    } else {
      para += `Morning conditions may be quiet, even sunny — this is the classic deceptive pre-convective setup. Don't be caught out by a quiet lunchtime. Radar checking from early afternoon is strongly advisable for anyone with outdoor commitments. `;
    }
    if (hailMm >= 20) para += `**Large hail is a well-supported secondary hazard** alongside the lightning threat — vehicles and crops left exposed during the afternoon window carry genuine damage risk. `;
    if (precip > 25)  para += `Rainfall accumulation rates above **${precip} mm/h** are achievable in training multi-cell segments — pre-soaked catchments or urban drainage in the threat zone should be treated as flash-flood-sensitive. `;
  } else if (riskType === 'hail') {
    para += `Hail growth in this environment is enhanced by a **deep supercooled water layer** — stones will accrete efficiently between the −10°C and −40°C levels, translating readily into the large to very-large size categories if updraughts sustain above 120 mb depth. Radar interpretation should focus on strong reflectivity cores above the −20°C level as the primary large-hail indicator. `;
    if (hailMm >= 25) para += `**Agricultural, vehicle and glasshouse exposure should be mitigated now** — damage from a single cell at this hail size can occur in under 5 minutes. `;
  } else if (riskType === 'tornado') {
    para += `UK tornado events are primarily low-topped, boundary-layer-depth features — but today's shear and CAPE combine in a way that supports **both** the surface-based vorticity required for touchdown and the updraught depth needed to maintain a condensation funnel. Any rotating storm or hook echo on radar in the risk corridor should be taken seriously regardless of its apparent intensity from reflectivity alone. `;
    if (score >= 45) para += `**This is one of the stronger regional tornado setups this season** — local emergency management and transport authorities in the risk corridor should be briefed. `;
  } else if (riskType === 'lightning') {
    para += `Lightning-specific risk depends less on CAPE alone than on the **charge-layer depth and storm-relative flow** through the 0–8 km layer — both are supportive today. Flash rates in active cells could peak at **20–60+ strokes per minute** in organised storm cores, overwhelming the typical lightning warning window. Pre-empt, don't react. `;
    if (score >= 50) para += `**Outdoor event organisers, site managers and field workers must have a written lightning action plan and a designated shelter location confirmed in advance of the risk window.** The 30-minute rule is the industry standard — one rule that saves lives. `;
  }

  // Bottom line — unique per level, not templated
  const btl = {
    'Severe':   `🔻 **Bottom line for ${regionLabel}:** treat ${dayPhase(dayIdx)} as a life-safety day. Have your shelter plan active before the convective window opens. Monitor official warnings in real time.`,
    'High':     `🔻 **Bottom line:** a serious, impactful weather day is shaping up. Delays to outdoor work, travel disruption and infrastructure impacts are all credible outcomes. Stay weather-aware from early afternoon.`,
    'Moderate': `🔻 **Bottom line:** an active afternoon is on the cards for at least part of the region — the storms that do fire will be meaningful events, not passing showers. Keep radar close.`,
    'Slight':   `🔻 **Bottom line:** storms are likely somewhere in the region and locally significant impacts are possible. If you're in the risk zone, account for it in your plans.`,
    'Marginal': `🔻 **Bottom line:** most will miss this, but a brief intense cell could catch someone off guard. Worth knowing about, particularly if you're outdoors for extended periods.`,
  }[level] ?? '';

  para += `Stay weather-aware and track the latest model guidance throughout the day. 🌩${btl ? '\n\n' + btl : ''}`;
  return para;
}

// ─── main export ─────────────────────────────────────────────────────────────

export function makeGenerateDayDescription({ RISK_TYPES, scoreToLevel }) {
  return function generateDayDescription(summary, riskType, dayIdx, regionLabel, run, impactedLocations = []) {
    if (!summary) return ['Forecast data is loading — model output is still initialising.'];

    const score = summary[riskType] ?? 0;
    const level = scoreToLevel(score);
    const dayName = dayPhase(dayIdx);

    // Build a real calendar date string
    const runDate = run ? new Date(run) : new Date();
    const eventDate = new Date(runDate);
    eventDate.setDate(eventDate.getDate() + dayIdx);
    const dateStr = eventDate.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

    const riskLabel = RISK_TYPES.find(t => t.id === riskType)?.label ?? riskType;
    const r   = summary.ranges ?? {};
    const sub = summary.sub    ?? {};

    // Pull every metric we want — all used to differentiate descriptions
    const cape    = r.cape?.max   ?? 0;
    const shear   = r.shear?.max  ?? 0;
    const gust    = r.gust?.max   ?? 0;
    const precip  = r.precip?.max ?? 0;
    const hailMm  = r.hailMm?.max ?? 0;
    const cov     = summary.totalCells
      ? Math.round((summary.stormyCells / summary.totalCells) * 100) : 0;

    // Derived profiles
    const cp   = capeProfile(cape);
    const locP = locationPhrase(impactedLocations);

    // ── No Risk ─────────────────────────────────────────────────────────────
    if (level === 'No Risk' || score < 5) {
      const suppressor = cape < 50 ? 'a deeply stable, capped airmass suppresses any upward motion'
        : 'a well-mixed but weakly-forced boundary layer limits convective initiation';
      return [
        `**${dateStr} — ${regionLabel}.** The convective outlook carries **no significant ${riskLabel.toLowerCase()} risk** ${dayName}. ${suppressor.charAt(0).toUpperCase() + suppressor.slice(1)}, and the synoptic pattern lacks the organised ascent needed to overcome this suppression. Any showers that develop will be shallow, brief and non-thundery.`,
        `Outdoor activities, infrastructure and public safety are not expected to be affected by convective weather over the next 24 hours. This is a quiet day by any measure.`,
      ];
    }

    // ── Paragraph 1 — Day fingerprint ────────────────────────────────────────
    // Every level gets a completely different lead sentence + CAPE/shear combo
    const leadMap = {
      'Severe':   `⚠️ **A severe weather day of consequence is developing for ${regionLabel} ${dayName} — this setup demands your full attention.**`,
      'High':     `⚠️ **A genuinely significant ${riskLabel.toLowerCase()} day is on the cards for ${regionLabel} ${dayName}.**`,
      'Moderate': `🌩 **Conditions are coming together for active storm development across ${regionLabel} ${dayName}.**`,
      'Slight':   `🌩 **A real convective signal is present for ${regionLabel} ${dayName} — organised storms are a credible outcome.**`,
      'Marginal': `⛈ **A marginal but watchable ${riskLabel.toLowerCase()} setup for ${regionLabel} ${dayName}.**`,
      'Low':      `🌦 **Low-end convective potential for ${regionLabel} ${dayName} — an isolated rumble of thunder can't be ruled out.**`,
      'Very Low': `🌥 **Very low convective signal across ${regionLabel} ${dayName} — predominantly quiet.**`,
    };

    let para1 = `${leadMap[level] ?? ''} **${dateStr} — ${regionLabel}.** `;
    para1 += `The outlook carries a **${level}** ${riskLabel.toLowerCase()} risk scoring **${score}/100**, with active areas covering approximately **${cov}%** of the region. `;
    para1 += `${cp.prose}. `;
    para1 += `${shearProfile(shear)}.`;
    if (gust > 30) para1 += ` Boundary-layer winds already support gusts near **${gust} mph** in the strongest cells.`;

    // ── Paragraph 2 — Hazard breakdown ───────────────────────────────────────
    let para2 = '';
    if (riskType === 'thunderstorm') {
      para2 = thunderstormHazardPara(score, sub, r, level, locP, hailMm, precip, gust);
    } else if (riskType === 'hail') {
      para2 = hailHazardPara(score, hailMm, cov, locP);
    } else if (riskType === 'tornado') {
      para2 = tornadoHazardPara(score, locP, shear);
    } else if (riskType === 'lightning') {
      para2 = lightningHazardPara(score, cov, locP);
    }

    // ── Paragraph 3 — Timing + confidence ────────────────────────────────────
    const timing     = timingBlock(dayIdx, score, riskType, cape, null);
    const confidence = confidenceBlock(score, dayIdx);
    const para3 = [timing, confidence].filter(Boolean).join('\n\n');

    // ── Paragraph 4 — Extended meteorological outlook ─────────────────────────
    const para4 = extendedOutlookPara(
      score, level, riskType, cape, shear, gust, hailMm, precip,
      runDate, regionLabel, dayIdx,
    );

    return [para1, para2, para3, para4].filter(Boolean);
  };
}