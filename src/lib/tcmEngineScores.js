// ─────────────────────────────────────────────────────────────────────────────
// TCM RISK ENGINE v7 — ingredients-based, multiplicative, UK & Ireland-calibrated.
//
// The single risk engine for the whole TCM. Given ONE atmospheric environment it
// returns the 0–100 hazard scores (thunderstorm / hail / tornado / lightning +
// sub-hazards), the storm mode, forecast confidence, calibrated thunder
// probability, and a full diagnostics block. Pure function, no I/O.
//
// DESIGN — severe-convective potential is the PRODUCT of the necessary ingredient
// families, each normalised 0→1:
//
//     INSTABILITY × MOISTURE × LIFT/TRIGGER × CAP-RELEASE × (organisation bonus)
//
// If ANY necessary family is ~0 the product is ~0, so a warm-but-capped, dry, or
// untriggered airmass scores near zero even when one ingredient (e.g. modest
// CAPE) is present. This is what stops a lone high-CAPE reading "leaking" a risk
// on an otherwise benign day — the classic UK false-alarm the additive scorers
// produced. Real thermodynamics are used when the pressure-level profile is
// supplied (lapse rates, K-index, Total Totals, bulk shear, storm-relative
// helicity, WBZ, DCAPE, SCP/STP/EHI); clearly-labelled surface proxies substitute
// when a field is absent, with the SAME multiplicative gating either way.
//
// v7 CHANGES vs v6 (physics preserved, magnitudes preserved — this is a cleanup
// and correctness pass, NOT a recalibration, so published forecasts and the
// verification reliability curve stay valid):
//
//   • Storm-relative helicity is now a proper multi-segment hodograph integral
//     over surface→850→700 hPa (0–3 km) with a single, consistently-computed
//     Bunkers right-mover storm motion reused for both SRH and the displayed
//     storm-motion vector. The old code used a one-segment surface→700 proxy AND
//     had its helicity sign inverted (it read negative for a favourable veering
//     hodograph). Scoring uses |SRH| throughout, so magnitudes are a refinement
//     and the displayed SRH now carries the correct sign.
//
//   • Honest diagnostics. `li`, `kIndex` and `totalTotals` report null when the
//     model does not serve the underlying field, instead of fabricating a value
//     (v6 displayed li = 5 − score/18, and showed a 0–100 internal proxy in the
//     kIndex slot). The scoring still falls back to internal proxies — those are
//     clearly labelled and never presented as the named instrument reading.
//
//   • Dead code removed (an always-zero clamp term; an always-true guard).
//
// The 0–100 output bands against the CANONICAL scale defined once in
// components/tcm/riskConfig.jsx (5/12/22/35/50/65/80). Keep the two in step.
// ─────────────────────────────────────────────────────────────────────────────

import { soundingPhysics } from '@/lib/tcmPhysics';

export const MPS_PER_MPH = 0.44704;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const num = (v, fallback = null) => (typeof v === 'number' && isFinite(v) ? v : fallback);

// Ensemble probability-of-exceedance score thresholds (on the 0–100 hazard score).
export const THUNDER_OCCUR_SCORE = 15;
export const SEVERE_SCORE        = 50;
export const SIG_SEVERE_SCORE    = 65;
export const HAIL_OCCUR_SCORE    = 25;
export const TORNADO_OCCUR_SCORE = 15;
export const WIND_OCCUR_SCORE    = 30;

const DEG2RAD = Math.PI / 180;

// WMO weather codes.
const THUNDER_CODES  = new Set([95, 96, 97, 98, 99]);
const SHOWERY_CODES  = new Set([80, 81, 82, 85, 86, 95, 96, 97, 98, 99]);

// ── Shape functions ──────────────────────────────────────────────────────────
// Smooth 0→1 ramp between a (=0) and b (=1) with smoothstep easing — an
// ingredient turns on gradually rather than as a hard step, avoiding band
// speckle at threshold edges.
function ramp(x, a, b) {
  if (b === a) return x >= b ? 1 : 0;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
// Bell/window response: peaks at `peak`, falls to 0 by `lo`/`hi`. For variables
// that are unfavourable when too low AND too high (e.g. WBZ for hail).
function window01(x, lo, peak, hi) {
  if (x <= lo || x >= hi) return 0;
  return x < peak ? ramp(x, lo, peak) : 1 - ramp(x, peak, hi);
}

// ── Meteorology helpers ──────────────────────────────────────────────────────
// Wet-bulb temperature via Stull's empirical formula (°C).
function wetBulbStull(T, RH) {
  if (T == null || RH == null) return null;
  const rh = clamp(RH, 1, 100);
  return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
    + Math.atan(T + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
    - 4.686035;
}

// Wind (speed mph, direction deg — met convention = FROM) → vector components
// (m/s) pointing TOWARD the direction the wind blows.
function windVec(spdMph, dirDeg) {
  if (spdMph == null) return null;
  const d = (dirDeg == null ? 0 : dirDeg) * DEG2RAD;
  const s = spdMph * MPS_PER_MPH;
  return { u: -s * Math.sin(d), v: -s * Math.cos(d) };
}
const vecMag = (a) => Math.hypot(a.u, a.v);
const vecSub = (a, b) => ({ u: a.u - b.u, v: a.v - b.v });

// Bunkers right-mover storm motion (m/s) from the surface and 500 hPa wind
// vectors: the 0–6 km mean wind deviated 7.5 m/s to the right of the shear.
function bunkersRightMover(vSfc, v500) {
  if (!vSfc || !v500) return null;
  const mean = { u: (vSfc.u + v500.u) / 2, v: (vSfc.v + v500.v) / 2 };
  const shear = vecSub(v500, vSfc);
  const shMag = vecMag(shear) || 1e-6;
  const nx = shear.v / shMag, ny = -shear.u / shMag;   // right-of-shear unit normal (NH)
  const D = 7.5;
  return { u: mean.u + D * nx, v: mean.v + D * ny };
}

// Storm-relative helicity (m²/s²) integrated over an ordered list of wind
// vectors (ascending height) relative to the storm motion — the standard
// Davies-Jones discrete form. Positive for a veering (clockwise) hodograph.
function srhOverLayers(vecs, cMotion) {
  if (!cMotion || !vecs || vecs.length < 2) return null;
  let srh = 0;
  for (let n = 0; n < vecs.length - 1; n++) {
    const a = vecSub(vecs[n], cMotion);
    const b = vecSub(vecs[n + 1], cMotion);
    srh += (b.u * a.v - a.u * b.v);
  }
  return srh;
}

// K-Index (°C) from pressure-level temps/dewpoints — Open-Meteo's own docs
// recommend exactly this for thunderstorm potential.
function kIndexReal(T850, T700, T500, Td850, Td700) {
  if ([T850, T700, T500, Td850, Td700].some(v => v == null)) return null;
  return (T850 - T500) + Td850 - (T700 - Td700);
}
// Total Totals Index = (T850 − T500) + (Td850 − T500).
function totalTotals(T850, T500, Td850) {
  if ([T850, T500, Td850].some(v => v == null)) return null;
  return (T850 - T500) + (Td850 - T500);
}
// Environmental lapse rate (°C/km) between two pressure levels using their
// geopotential heights (m). Steeper (more positive) = more unstable.
function lapseRate(Tlow, Thigh, Zlow, Zhigh) {
  if ([Tlow, Thigh, Zlow, Zhigh].some(v => v == null)) return null;
  const dz = (Zhigh - Zlow) / 1000;
  if (dz <= 0) return null;
  return (Tlow - Thigh) / dz;
}

// Wet-Bulb Zero height (m) — the true hail melting level. Linearly interpolates
// the 0 °C wet-bulb crossing over the levels we have.
function wetBulbZeroHeight(levels) {
  const pts = levels.filter(l => l && l.wb != null && l.z != null).sort((a, b) => a.z - b.z);
  if (pts.length < 2) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a.wb >= 0 && b.wb <= 0) || (a.wb <= 0 && b.wb >= 0)) {
      if (a.wb === b.wb) return a.z;
      return a.z + (a.wb / (a.wb - b.wb)) * (b.z - a.z);
    }
  }
  return pts[0].wb <= 0 ? pts[0].z : null;
}

// Downdraft-CAPE estimate (J/kg-scale proxy) for damaging-downburst potential.
function dcapeEstimate(td700, t700, lapse700_500, zBL) {
  if (td700 == null || t700 == null) return 0;
  const dd700 = Math.max(0, t700 - td700);                 // 700 hPa dewpoint depression
  const lr = lapse700_500 != null ? lapse700_500 : 6.5;
  const depthKm = zBL != null ? clamp(zBL / 1000, 0.5, 4) : 2.5;
  return clamp(dd700 * 55 * (lr / 6.5) * (depthKm / 2.5), 0, 2000);
}

// Smooth diurnal heating factor (0→1), raised cosine peaking mid-afternoon;
// widened in summer / narrowed in winter via a day-length proxy.
function diurnalHeating(hrUTC, peakHr = 14.5, dayLen01 = 0.5) {
  const halfWidth = 5 + 3 * clamp01(dayLen01);
  let dh = ((hrUTC - peakHr + 24) % 24);
  if (dh > 12) dh -= 24;
  const x = clamp(dh / halfWidth, -1, 1);
  return Math.abs(dh) >= halfWidth ? 0 : 0.5 * (1 + Math.cos(Math.PI * x));
}
// Continuous diurnal multiplier on the final score (afternoon boost ~1.16,
// gentle overnight reduction, night floor lifted a little in summer).
function diurnalMultiplier(hrUTC, peakHr = 15, dayLen01 = 0.5) {
  const lobe = diurnalHeating(hrUTC, peakHr, dayLen01);
  const nightBase = 0.6 + 0.08 * clamp01(dayLen01);
  return nightBase + (1.16 - nightBase) * lobe;
}
// Physical flash-rate estimate (flashes/min): continental Price–Rind cloud-top
// dependence, scaled by an ice-availability factor and CAPE.
function flashRateEstimate(cape, cloudTopKm, freezeKm) {
  if (cape < 50 || cloudTopKm == null) return 0;
  const H = clamp(cloudTopKm, 4, 16);
  const iceFactor = clamp((H - Math.max(0.5, freezeKm)) / 8, 0.1, 1.3);
  const capeFactor = clamp(ramp(cape, 80, 1500) * 1.2, 0.1, 1.3);
  return clamp(3.44e-5 * Math.pow(H, 4.9) * iceFactor * capeFactor, 0, 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// engineScores(env) — the risk engine.
// ─────────────────────────────────────────────────────────────────────────────
export function engineScores(env) {
  const {
    cape, cin, t2m, td, rh, precip,
    wxCode, cloudLow, cloudMid, cloudHigh, cloudTotal,
    windSpeed10, windSpeed80, windDir10, windDir80, gust,
    freezingLvl, pressureMsl, isDay: _isDayParam,
    dayOfYear, localHour,
    wetBulb, surfaceTemp, surfacePres, gustMean,
    capeMax, capeMean, precipSum, visibility, blHeight, liftedIndex,
    t850, t700, t500, td850, td700,
    rh850, rh700, rh500,
    z850, z700, z500,
    spd850, spd700, spd500, spd300,
    dir850, dir700, dir500, dir300,
    w700, oroLift,
  } = env;

  const hr = ((localHour % 24) + 24) % 24;
  const isDayResolved = (_isDayParam != null) ? (_isDayParam ? 1 : 0) : (hr >= 6 && hr <= 20 ? 1 : 0);

  // ── Surface fields ──────────────────────────────────────────────────────────
  const T    = num(t2m, 10);
  const Td   = num(td, 5);
  const RH   = clamp(num(rh, 60), 1, 100);
  const P    = num(pressureMsl, 1013);
  const sfcP = num(surfacePres, P);
  const pr   = Math.max(0, num(precip, 0));
  const cl   = clamp(num(cloudLow, 0), 0, 100);
  const cm   = clamp(num(cloudMid, 0), 0, 100);
  const ch   = clamp(num(cloudHigh, 0), 0, 100);
  const cloudAll = cloudTotal != null ? clamp(num(cloudTotal, 0), 0, 100) : (cl + cm + ch) / 3;
  const g    = Math.max(0, num(gust, 0));
  const gM   = Math.max(0, num(gustMean, g));
  const flKm = num(freezingLvl, 2500) / 1000;
  const capeModel = Math.max(0, num(cape, 0));
  const cinModel  = Math.abs(num(cin, 0));

  // ── PARCEL PHYSICS ──────────────────────────────────────────────────────────
  // When the pressure-level profile is present we lift a surface parcel for an
  // INDEPENDENT CAPE/CIN plus real LCL/LFC/EL heights. The model's own CAPE stays
  // the anchor (it ingests the full column we can't see); the parcel value is
  // blended in at 35 % to stabilise the instability term and sharpen a boundary-
  // layer plume the coarse ensemble mean washes out. LCL & cloud-depth from the
  // parcel replace the crude dewpoint-depression proxy in the tornado/lightning
  // terms below.
  const physics = soundingPhysics(env);
  const CAPE = (physics && physics.capeParcel != null)
    ? Math.max(0, 0.65 * capeModel + 0.35 * physics.capeParcel)
    : capeModel;
  const CIN = (physics && physics.cinParcel != null)
    ? 0.65 * cinModel + 0.35 * physics.cinParcel
    : cinModel;

  const tdDep = Math.max(0, T - Td);
  const wb    = num(wetBulb, null) ?? wetBulbStull(T, RH) ?? Td;
  const skinT = num(surfaceTemp, T);
  const _vis  = num(visibility, 24000);
  const _capeMax  = capeMax  != null ? Math.max(0, capeMax)  : CAPE;
  const _capeMean = capeMean != null ? Math.max(0, capeMean) : CAPE;
  const _precipSum = precipSum != null ? Math.max(0, precipSum) : pr * 24;
  const blKm = num(blHeight, null) != null ? blHeight / 1000 : null;

  const wxRound   = Math.round(num(wxCode, 0));
  const isThunder = THUNDER_CODES.has(wxRound);
  const isShowery = !isThunder && SHOWERY_CODES.has(wxRound);

  const haveUpper = [t850, t700, t500].every(v => v != null);
  const haveZ     = [z850, z700, z500].every(v => v != null);

  // ── 1. INSTABILITY ──────────────────────────────────────────────────────────
  const lr850_500 = haveUpper && haveZ ? lapseRate(t850, t500, z850, z500) : null;
  const lr700_500 = haveUpper && haveZ ? lapseRate(t700, t500, z700, z500) : null;
  const sfcZ0 = num(env.surfaceHeight, 40);
  const lrSfc850 = (t850 != null && z850 != null && z850 > sfcZ0 + 50)
    ? lapseRate(T, t850, sfcZ0, z850) : null;
  const lowLapseInst = lrSfc850 != null ? ramp(lrSfc850, 6.5, 9.8) : clamp01((T - Td) > 6 ? 0.5 : 0.2);
  const lapseProxy = clamp01((T - (flKm * 6.5 - 25)) / 18);
  const lapseInst = lr700_500 != null
    ? ramp(lr700_500, 5.5, 9.0)
    : lr850_500 != null
      ? ramp(lr850_500, 5.0, 8.0)
      : lapseProxy;

  // Lifted Index: served by Open-Meteo (negative = unstable). When absent the
  // instability TERM falls back to a CAPE ramp — a labelled internal proxy, never
  // surfaced as an "LI" reading (see metrics.li below).
  const LI = num(liftedIndex, null);
  const liInst = LI != null ? ramp(-LI, 0, 8) : ramp(CAPE, 100, 1500);

  // CAPE term — UK-calibrated. <100 J/kg ⇒ essentially no surface-based
  // convection; 300 modest, 800 strong, 1500+ exceptional for the UK.
  const capeInst   = ramp(CAPE, 80, 1600);
  const capeStrong = ramp(CAPE, 500, 2200);   // for hail / supercell weighting

  const KI = haveUpper ? kIndexReal(t850, t700, t500, td850 ?? td, td700) : null;
  const kInst = KI != null ? ramp(KI, 20, 38) : clamp01(
    0.5 * ramp(Td, 6, 16) + 0.5 * ramp(35 - (flKm * 8), 0, 20)
  );
  const TT = haveUpper ? totalTotals(t850, t500, td850 ?? td) : null;
  const ttInst = TT != null ? ramp(TT, 44, 56) : 0;

  const instabilityRaw =
      0.34 * capeInst
    + 0.24 * lapseInst
    + 0.18 * liInst
    + 0.14 * kInst
    + 0.10 * (ttInst || kInst);
  // Hard instability gate — no CAPE, a stable mid-level lapse and a non-negative
  // LI collapses instability (the warm-but-stable SE false-alarm case).
  const noRealInstability =
    CAPE < 60 &&
    (lr700_500 == null || lr700_500 < 6.0) &&
    (LI == null || LI > -0.5);
  const instability = noRealInstability ? instabilityRaw * 0.12 : instabilityRaw;

  // ── 2. MOISTURE ─────────────────────────────────────────────────────────────
  const lowMoist = 0.6 * ramp(Td, 4, 16) + 0.4 * ramp(RH, 45, 90);
  const midRH = num(rh700, null);
  const midMoist = midRH != null ? ramp(midRH, 25, 80) : clamp01(ramp(RH, 40, 85));
  const pwatProxy = clamp01(0.55 * ramp(Td, 4, 17) + 0.25 * ramp(RH, 50, 95) + 0.20 * ramp(1018 - P, 0, 22));
  const moisture = clamp01(0.55 * lowMoist + 0.20 * midMoist + 0.25 * pwatProxy);
  const moistureGate = moisture < 0.16 ? 0.10 : moisture < 0.30 ? 0.45 : moisture < 0.45 ? 0.8 : 1;

  // ── SPANISH PLUME / ELEVATED MIXED LAYER ────────────────────────────────────
  // A steep mid-level lapse (EML advected from Iberia/N Africa) capping a warm,
  // very moist boundary layer under a lid — the UK's signature high-end severe
  // pattern. Recognised explicitly so storms that fire in it are scored as the
  // organised, high-impact events they are.
  const emlLapse = (lr700_500 != null && lr700_500 > 7.3);
  const richBL   = lowMoist > 0.62 && Td > 13;
  const hasLid   = CIN > 35;
  const plumeSeason = (dayOfYear || 200) >= 120 && (dayOfYear || 200) <= 260;
  const spanishPlume = emlLapse && richBL && hasLid && plumeSeason;
  const plumeStrength = spanishPlume
    ? clamp01(0.4 * ramp(lr700_500, 7.3, 8.7) + 0.35 * ramp(Td, 13, 19) + 0.25 * ramp(CAPE, 600, 2200))
    : 0;

  // ── 3. CAP / INHIBITION ─────────────────────────────────────────────────────
  const capRelease = CIN <= 75 ? 1 : clamp(1 - (CIN - 75) / 250, 0.05, 1);
  const capBuildBonus = (CIN >= 25 && CIN <= 90) ? 1.06 : 1.0;   // a modest cap lets CAPE build
  // Convective-temperature cap-break: the day's max CAPE vs current CAPE tells us
  // whether peak heating realises enough instability to breach the lid.
  const capeRealisation = (_capeMax > 50 && CAPE >= 0)
    ? clamp01((_capeMax - CAPE) / Math.max(150, _capeMax))
    : 0;
  const midLapseSteep = (lr700_500 != null ? lr700_500 > 6.3 : lapseInst > 0.5);
  const ascentForcing = (num(w700, null) != null ? ramp(w700, 0.05, 0.5) : clamp01(ramp(1010 - P, 0, 16)));
  const strongAscent = ascentForcing > 0.45;
  // Elevated convection: a parcel from ABOVE the boundary layer is not governed by
  // the surface cap (overnight/elevated MCS, or daytime overrunning on the cool
  // side of a warm front). Strong large-scale ascent over a capped BL qualifies at
  // any hour; night simply makes it the dominant mode.
  const elevatedMode = CIN > 70 && midLapseSteep && (num(rh700, 50) > 55)
    && (strongAscent || ((!_isDayParam || hr >= 20 || hr <= 6) && ascentForcing > 0.35));
  const capBreak = elevatedMode
    ? 0.85
    : (CIN > 60) ? clamp01(0.3 + 0.7 * capeRealisation) : 1.0;

  // ── 4. LIFT / TRIGGER ───────────────────────────────────────────────────────
  const dOY0 = dayOfYear || 200;
  // Day-length proxy (0→1), peaking at the summer solstice — widens the daytime
  // heating window in summer, narrows it in winter (large UK seasonal swing).
  const dayLen01 = clamp01(0.5 - 0.42 * Math.cos((dOY0 - 172) / 365 * 2 * Math.PI));
  const heatLobe = diurnalHeating(hr, 14.5, dayLen01);
  const heatTemp = clamp01((T - 9) / 17);
  const dayFlag = (_isDayParam != null) ? _isDayParam : (heatLobe > 0.02 ? 1 : 0);
  const surfaceHeating = clamp01(0.6 * heatTemp + 0.4 * heatLobe) * (dayFlag ? 1 : 0.35);

  const omega = num(w700, null);
  const synopticAscent = omega != null ? clamp01(ramp(omega, 0.02, 0.6)) : clamp01(ramp(1010 - P, 0, 16));
  const troughLift = clamp01(ramp(1010 - sfcP, 0, 18));

  // Frontal forcing from low-level directional veer (10 m → 850 hPa) with a
  // mid-level moisture rise — a proxy for a front/convergence boundary.
  const veer = (dir850 != null && windDir10 != null)
    ? (((dir850 - windDir10 + 540) % 360) - 180) : null;
  const frontalLift = veer != null
    ? clamp01(ramp(Math.abs(veer), 25, 110)) * clamp01(ramp(midMoist, 0.3, 0.8)) : 0;

  const oroAscent = num(oroLift, null) != null ? clamp01(ramp(oroLift, 0.05, 0.5)) : 0;
  const wxLift = isThunder ? 1.0 : isShowery ? 0.6 : clamp01(ramp(pr, 0.3, 4));

  // Soft-max of triggers: the strongest single lift dominates (storms fire on any
  // one good mechanism), with smaller ones adding a little.
  const triggers = [surfaceHeating, synopticAscent, troughLift, frontalLift, oroAscent, wxLift];
  const triggerMax = Math.max(...triggers);
  const triggerSum = triggers.reduce((a, b) => a + b, 0);
  let liftTrigger = clamp01(triggerMax * 0.8 + (triggerSum - triggerMax) * 0.12);
  if (elevatedMode) liftTrigger = clamp01(Math.max(liftTrigger, 0.45 + 0.45 * synopticAscent));
  const liftGate = liftTrigger < 0.12 ? 0.12 : liftTrigger < 0.25 ? 0.5 : 1;

  // ── 4b. VARIABLE CROSS-CHECKS ───────────────────────────────────────────────
  // Bounded second-order multipliers, each with a clear physical rationale.
  const skinExcess = skinT - T;
  const superHeatMult = dayFlag ? clamp(1 + 0.06 * ramp(skinExcess, 1.5, 7), 1, 1.10) : 1;      // superadiabatic surface layer
  const lowCloudMult  = dayFlag ? clamp(1 - 0.10 * ramp(cl, 55, 95) * (1 - 0.5 * synopticAscent), 0.88, 1) : 1; // low cloud limits heating
  const midHighCloud  = clamp01(((cm + ch) / 2 - 25) / 55);
  const anvilMult     = clamp(1 + 0.05 * midHighCloud * instability * clamp01(moisture / 0.5), 1, 1.06);       // debris/anvil from prior convection
  const stratiformMult = (cloudAll > 85 && CAPE < 120 && pr > 0.2)
    ? clamp(1 - 0.10 * ramp(cloudAll, 85, 100), 0.90, 1) : 1;                                                   // overcast stratiform, not convective
  const visKm = _vis / 1000;
  const visMult = clamp(1 - 0.08 * (1 - ramp(visKm, 3, 12)) + 0.04 * ramp(visKm, 30, 60), 0.92, 1.05);         // haze/fog vs crisp airmass
  const appT = num(env.apparentTemp, T);
  const muggy = appT - T;
  const apparentMult = clamp(1 + 0.05 * ramp(muggy, 0.5, 5) - 0.04 * ramp(-muggy, 1, 6), 0.94, 1.06);          // humid mugginess vs dry
  const varCrossCheck = superHeatMult * lowCloudMult * anvilMult * stratiformMult * visMult * apparentMult;

  // ── 5. KINEMATICS (organisation, not initiation) ────────────────────────────
  const vSfc = windVec(windSpeed10, windDir10);
  const v850 = windVec(spd850, dir850);
  const v700 = windVec(spd700, dir700);
  const v500 = windVec(spd500, dir500);
  const cMotion = bunkersRightMover(vSfc, v500);

  // 0–6 km bulk shear ≈ |V500 − Vsfc|; fall back to a scaled 80 m − 10 m diff.
  const bulkShear6 = (v500 && vSfc)
    ? vecMag(vecSub(v500, vSfc))
    : (windSpeed80 != null && windSpeed10 != null)
      ? Math.abs(windSpeed80 - windSpeed10) * MPS_PER_MPH * 1.6 : null;
  const shear01 = bulkShear6 != null ? ramp(bulkShear6, 7, 22) : 0;

  // 0–1 km shear ≈ |V850 − Vsfc|.
  const lowShear = (v850 && vSfc) ? vecMag(vecSub(v850, vSfc)) : null;
  const lowShear01 = lowShear != null ? ramp(lowShear, 4, 16) : 0;

  // 0–3 km SRH over surface→850→700 (two segments when 850 is available).
  let SRH = null;
  if (cMotion && vSfc && v700) {
    SRH = srhOverLayers(v850 ? [vSfc, v850, v700] : [vSfc, v700], cMotion);
  }
  const srh01 = SRH != null ? ramp(Math.abs(SRH), 50, 300) : 0;
  // 0–1 km SRH over surface→850 (for the significant-tornado composite).
  const SRH1 = (cMotion && vSfc && v850) ? srhOverLayers([vSfc, v850], cMotion) : null;

  // Upper-level divergence proxy: faster 300 hPa flow than 500 hPa supports
  // large-scale ascent / storm venting.
  const upperDiv = (spd300 != null && spd500 != null) ? clamp01(ramp((spd300 - spd500), 10, 60)) : 0;

  // Storm-motion vector for display (reuses the Bunkers right-mover).
  let stormMotionDir = null, stormMotionMph = null;
  if (cMotion) {
    stormMotionMph = Math.round(vecMag(cMotion) / MPS_PER_MPH);
    stormMotionDir = Math.round(((Math.atan2(cMotion.u, cMotion.v) * 180 / Math.PI) + 360) % 360);
  }

  // ── Time-of-day & season modifiers ──────────────────────────────────────────
  const capDelayHr = clamp(ramp(CIN, 40, 160) * 3, 0, 3);   // a strong cap delays initiation
  let diurnal = diurnalMultiplier(hr, 15 + capDelayHr, dayLen01);
  if (_isDayParam === 0) diurnal *= 0.9;
  const nocturnalRebate = (elevatedMode && (hr >= 20 || hr <= 6)) ? 1.15 : 1.0;
  const dayMult = diurnal * nocturnalRebate;

  const dOY = dayOfYear || 200;
  const seasonMult = (dOY >= 135 && dOY <= 245) ? 1.08 : (dOY >= 100 && dOY <= 290) ? 1.0 : 0.88;

  // Cold-air / low-topped convection: steep low-level lapse over a low freezing
  // level with modest CAPE → graupel and thundery showers (a real UK cool-season
  // hazard that doesn't need high dewpoints).
  const coldRegime = flKm < 2.2 && lapseInst > 0.55 && CAPE > 60 && CAPE < 600;
  const coldConv = coldRegime ? 1.25 : 1.0;
  const effMoistureGate = coldRegime ? Math.max(moistureGate, 0.7) : moistureGate;

  // ── Derived profile physics: wet-bulb-zero, cloud top, DCAPE ────────────────
  const wb850 = (t850 != null && rh850 != null) ? wetBulbStull(t850, rh850) : null;
  const wb700 = (t700 != null && rh700 != null) ? wetBulbStull(t700, rh700) : null;
  const wb500 = (t500 != null && rh500 != null) ? wetBulbStull(t500, rh500) : null;
  const sfcZ = num(env.surfaceHeight, 50);
  const wbzM = wetBulbZeroHeight([
    { wb: wb, z: sfcZ }, { wb: wb850, z: z850 }, { wb: wb700, z: z700 }, { wb: wb500, z: z500 },
  ]);
  const wbzKm = wbzM != null ? wbzM / 1000 : flKm;

  const baseTopKm = z500 != null ? z500 / 1000 : 5.6;
  // Real equilibrium-level cloud top from the parcel ascent when available;
  // otherwise the lapse/CAPE proxy.
  const cloudTopKm = (physics && physics.elHeight != null && physics.elHeight > 4000)
    ? clamp(physics.elHeight / 1000, 4, 16)
    : clamp(baseTopKm + 2.5 * lapseInst + 3.0 * capeInst, 4, 16);
  const dcapeJ = dcapeEstimate(td700, t700, lr700_500, num(blHeight, null));

  // ── COMPOSITE THUNDERSTORM POTENTIAL ────────────────────────────────────────
  // The multiplicative backbone. Organisation includes a CAPE×shear coupling
  // (deep shear organises convection far better with ample CAPE to work with),
  // separating a high-CAPE/high-shear severe environment from a high-CAPE/low-
  // shear pulse-storm day.
  const capeShearCoupling = clamp01(capeInst * shear01);
  const organisation = 1
    + 0.32 * shear01
    + 0.18 * srh01
    + 0.15 * upperDiv
    + 0.10 * lowShear01
    + 0.16 * capeShearCoupling
    + 0.16 * plumeStrength * capBreak;

  let ts = 100
    * instability * moisture * liftTrigger * capRelease * capBreak
    * effMoistureGate * liftGate * capBuildBonus
    * dayMult * seasonMult * coldConv * varCrossCheck
    * (0.55 + 0.45 * organisation / 2.07);

  // Observed-storm floors — radar already shows convection, don't under-call.
  if (isThunder)                                        ts = Math.max(ts, 30);
  else if (isShowery && CAPE > 120 && moisture > 0.45)  ts = Math.max(ts, 16);
  else if (isShowery && CAPE > 50  && moisture > 0.35)  ts = Math.max(ts, 9);

  // Convective-contamination guard: huge daily rain totals with tiny CAPE are
  // stratiform, not convective — pull the score down.
  const convContam = (_precipSum > 22 && CAPE < 250) ? Math.min(0.3, (_precipSum - 22) / 90) : 0;
  ts = ts * (1 - convContam);

  // Final physical-necessity ceilings.
  if (CAPE < 100 && !isThunder && liftTrigger < 0.5) ts = Math.min(ts, 16);
  if (moisture < 0.28 && !isThunder)                 ts = Math.min(ts, 18);
  if (shear01 < 0.15 && CAPE < 300 && !isThunder)    ts = Math.min(ts, 42);
  ts = clamp(ts, 0, 100);

  // ── Physical-necessity gate: NO measured instability ⇒ NO convection ────────
  // A thunderstorm cannot exist without buoyant instability. When a run supplies
  // neither meaningful CAPE nor any MEASURED instability — a negative lifted
  // index, or a steep mid-/deep-layer lapse rate from REAL upper-air — there is
  // no physical basis for a storm, so any score here was fabricated from gap-
  // filled proxies (or a spurious weather code) on incomplete data. Force it to
  // No Risk. This is deliberately NOT CAPE-only: a negative LI OR a steep
  // measured lapse rate keeps the risk alive even at low CAPE (elevated / cool-
  // season convection), so genuine multi-ingredient events survive untouched —
  // only genuinely stable, data-starved cells are zeroed. This is what stops
  // partial self-host data (e.g. UKMO surface with no upper-air) false-alarming.
  const noInstabilityBasis =
    CAPE < 30 &&
    (LI == null || LI > 0) &&
    (lr700_500 == null || lr700_500 < 6.5) &&
    (lr850_500 == null || lr850_500 < 6.0);
  if (noInstabilityBasis) ts = 0;

  // ── HAIL ────────────────────────────────────────────────────────────────────
  // CAPE in the growth layer + a WBZ low enough that stones survive descent but
  // high enough for a deep growth layer (best ≈ 2.7 km).
  const hailWBZ = window01(wbzKm, 1.6, 2.7, 4.4);
  let hail = ts > 14
    ? 100 * capeStrong
        * (0.30 + 0.40 * shear01 + 0.20 * kInst + 0.10 * lapseInst)
        * (0.35 + 0.65 * hailWBZ) * capRelease
    : 0;
  if (CAPE < 200) hail = Math.min(hail, 22);
  if (CAPE < 500) hail = Math.min(hail, 55);
  hail = clamp(hail, 0, 100);

  // ── VALIDATED COMPOSITE INDICES (SPC) ───────────────────────────────────────
  const srhAbs = SRH != null ? Math.abs(SRH) : srh01 * 250;
  const ebwd = bulkShear6 != null ? bulkShear6 : shear01 * 20;
  const EHI = (CAPE * srhAbs) / 160000;                    // Energy-Helicity Index
  const ehi01 = ramp(EHI, 0.5, 2.5);
  const ebwdTerm = ebwd < 10 ? 0 : ebwd > 20 ? 1 : (ebwd - 10) / 10;
  const SCP = (CAPE / 1000) * (srhAbs / 50) * ebwdTerm;    // Supercell Composite
  const scp01 = ramp(SCP, 1, 8);
  const srh1 = SRH1 != null ? Math.abs(SRH1) : srhAbs * 0.4;
  const lclM = (physics && physics.lclHeight != null) ? physics.lclHeight : null;
  const lclTerm = lclM != null ? clamp01((2000 - lclM) / 1500) : clamp01((2000 - tdDep * 125) / 1000);
  const STP = (CAPE / 1500) * (srh1 / 150) * ebwdTerm * lclTerm;   // Significant Tornado
  const stp01 = ramp(STP, 0.5, 3);

  // ── TORNADO ─────────────────────────────────────────────────────────────────
  // Instability + low-level shear + SRH + low LCL + a parent storm. UK tornadoes
  // are usually low-CAPE/high-shear or along fronts; the composite indices sharpen
  // the ingredient floor.
  const lclLow = lclM != null ? clamp01((1500 - lclM) / 1500) : clamp01(1 - tdDep / 12);
  const torIngredient = (ts > 22 && (lowShear01 > 0.25 || srh01 > 0.3) && moisture > 0.4)
    ? 100 * (0.18 + 0.5 * capeInst)
        * (0.4 * lowShear01 + 0.4 * srh01 + 0.2 * shear01)
        * (0.5 + 0.5 * lclLow) * (0.6 + 0.4 * frontalLift)
    : 0;
  const torComposite = ts > 22 ? 100 * (0.6 * stp01 + 0.4 * ehi01) : 0;
  let tor = Math.max(torIngredient, torComposite * 0.9);
  if (CAPE < 150 && srh01 < 0.4 && STP < 0.5) tor = Math.min(tor, 18);
  if (lowShear != null && lowShear < 4)       tor = Math.min(tor, 16);
  if (!isThunder && !isShowery)               tor = Math.min(tor, 26);
  tor = clamp(tor, 0, 100);

  // ── LIGHTNING ───────────────────────────────────────────────────────────────
  const ltgWBZ = window01(wbzKm, 1.3, 2.7, 5.2);
  const flashRate = flashRateEstimate(CAPE, cloudTopKm, wbzKm);
  const flashScore = clamp(ramp(flashRate, 0.3, 25) * 100, 0, 100);
  let ltg = ts * (isThunder ? 1.0 : isShowery ? 0.8 : 0.62) * (0.5 + 0.5 * ltgWBZ);
  ltg = Math.max(ltg, flashScore * 0.7);
  if (!isThunder && CAPE < 80) ltg = Math.min(ltg, 14);
  ltg = clamp(ltg, 0, 100);

  // ── FLASH FLOODING ──────────────────────────────────────────────────────────
  const slowMotion = clamp(1 - shear01 * 0.5, 0.4, 1);
  let flashFlood = ts * (0.18 + pwatProxy * 0.7) * slowMotion
                 + Math.max(0, pr - 2) * 6
                 + Math.max(0, _precipSum - 12) * 0.7 * slowMotion;
  flashFlood = clamp(flashFlood, 0, 100);

  // ── DAMAGING WINDS ──────────────────────────────────────────────────────────
  // DCAPE (wet downdraft) + steep low-level lapse (dry microburst) + a dry sub-
  // cloud layer, organised further by deep-layer shear (bow-echo/QLCS gusts).
  const dryDowndraft = clamp01(ramp(tdDep, 6, 18));
  const dcape01 = clamp01(0.55 * ramp(dcapeJ, 450, 1300) + 0.25 * lowLapseInst + 0.20 * dryDowndraft);
  const windOrg = clamp01(0.6 * shear01 + 0.4 * dcape01);
  const gustScore = Math.max(0, (g - 28) * 1.7);
  const gustFloor = gM > 30 ? Math.min(20, (gM - 30) * 0.8) : 0;
  let strongWinds = Math.max(ts * (0.25 + 0.50 * dcape01 + 0.18 * windOrg), gustScore, gustFloor);
  strongWinds = clamp(strongWinds, 0, 100);

  // ── SUPERCELL ───────────────────────────────────────────────────────────────
  let supercell = 0;
  if (ts > 45 && ebwd > 12 && CAPE > 400) {
    const scIngredient = capeStrong * shear01 * (0.5 + 0.5 * srh01) * capRelease;
    supercell = clamp(100 * (0.6 * scp01 + 0.4 * scIngredient), 0, 100);
  }

  // ── STORM MODE ──────────────────────────────────────────────────────────────
  let stormMode = 'None';
  if (ts >= 8) {
    const elevated = CIN > 80 && surfaceHeating < 0.3 && (lr700_500 != null ? lr700_500 > 6.5 : lapseInst > 0.5);
    if (spanishPlume && capBreak > 0.6 && CAPE > 800) stormMode = 'Spanish plume — severe';
    else if (elevated && ebwd > 12) stormMode = 'Elevated / nocturnal';
    else if ((scp01 > 0.4 || (CAPE > 500 && ebwd > 18 && srh01 > 0.25)) && CAPE > 500) stormMode = 'Supercells possible';
    else if (frontalLift > 0.55 && ebwd > 15 && instability > 0.4) stormMode = 'Squall line / QLCS';
    else if (ebwd > 15 && CAPE > 350) stormMode = 'Organised multicells';
    else if (ebwd > 9 && CAPE > 200) stormMode = 'Multicell clusters';
    else if (coldRegime) stormMode = 'Cold-pool showers';
    else stormMode = 'Pulse / single cells';
  }

  // ── FORECAST CONFIDENCE ─────────────────────────────────────────────────────
  // Lower on a sharp gradient (marginal instability / cap where small errors flip
  // the outcome) and when the day's CAPE spread is large; higher when the
  // ingredients are unambiguous or the pattern is well-established.
  const capeSpread = (_capeMax > 0) ? clamp01((_capeMax - _capeMean) / Math.max(200, _capeMax)) : 0.5;
  const marginalInstability = (CAPE > 50 && CAPE < 400) ? 1 : 0;
  const marginalCap = (CIN > 40 && CIN < 120) ? 1 : 0;
  let confidence = 100 * (1 - 0.45 * capeSpread) * (1 - 0.18 * marginalInstability) * (1 - 0.18 * marginalCap);
  if (spanishPlume && plumeStrength > 0.5) confidence = Math.max(confidence, 70);
  if (isThunder) confidence = Math.max(confidence, 85);
  confidence = clamp(Math.round(confidence), 0, 100);

  // Calibrated probability-of-thunder (logistic of the potential index) for the
  // "% within 15 miles" framing — does not alter the band-mapping score.
  const thunderProb = clamp(Math.round(100 / (1 + Math.exp(-(ts - 34) / 11))), 0, 100);

  // ── LIMITING INGREDIENT (the "why") ─────────────────────────────────────────
  const ingredientScores = { instability, moisture, lift: liftTrigger, cap: capRelease * capBreak };
  let limiting = 'none', limMin = 0.55;
  for (const [k, v] of Object.entries(ingredientScores)) {
    if (v < limMin) { limMin = v; limiting = k; }
  }
  const limitingIngredient = ts < 8
    ? (instability < 0.15 ? 'instability' : moisture < 0.2 ? 'moisture' : 'lift')
    : limiting;

  // ── DOMINANT HAZARD ─────────────────────────────────────────────────────────
  const hazardScores = { tornado: tor, hail, wind: strongWinds, flood: flashFlood, lightning: ltg };
  let dominantHazard = 'none', hzMax = 0;
  for (const [k, v] of Object.entries(hazardScores)) {
    if (v > hzMax) { hzMax = v; dominantHazard = k; }
  }
  if (ts < 8) dominantHazard = 'none';

  // Honest LI display: the served model value, or null (never a fabrication).
  const liOut = LI != null ? +LI.toFixed(1) : null;

  return {
    thunderstorm: Math.round(ts),
    hail:         Math.round(hail),
    tornado:      Math.round(tor),
    lightning:    Math.round(ltg),
    stormMode,
    confidence,
    thunderProb,
    limitingIngredient,
    dominantHazard,
    flashRate:    Math.round(flashRate * 10) / 10,
    stormMotionDir,
    stormMotionMph,
    spanishPlume: spanishPlume ? Math.round(plumeStrength * 100) : 0,
    sub: {
      tornado:     Math.round(tor),
      hail:        Math.round(hail),
      flashFlood:  Math.round(flashFlood),
      strongWinds: Math.round(strongWinds),
      supercell:   Math.round(supercell),
    },
    metrics: {
      cape:         Math.round(CAPE),
      cin:          Math.round(CIN),
      temp:         Math.round(T * 10) / 10,
      dewPoint:     Math.round(Td * 10) / 10,
      wetBulb:      Math.round((wb ?? Td) * 10) / 10,
      surfaceTemp:  Math.round((skinT ?? T) * 10) / 10,
      rh:           Math.round(RH),
      precip:       Math.round(pr * 10) / 10,
      rain:         Math.round(pr * 10) / 10,
      cloud:        Math.round(cloudAll),
      cloudLow:     Math.round(cl),
      cloudMid:     Math.round(cm),
      cloudHigh:    Math.round(ch),
      shear:        Math.round((bulkShear6 != null ? bulkShear6 / MPS_PER_MPH : 0)),
      shearMps:     Math.round((bulkShear6 || 0) * 10) / 10,
      lowShearMps:  Math.round((lowShear || 0) * 10) / 10,
      srh:          SRH != null ? Math.round(SRH) : null,
      li:           liOut,
      kIndex:       KI != null ? Math.round(KI) : null,
      totalTotals:  TT != null ? Math.round(TT) : null,
      lapse850_500: lr850_500 != null ? Math.round(lr850_500 * 10) / 10 : null,
      lapse700_500: lr700_500 != null ? Math.round(lr700_500 * 10) / 10 : null,
      lapseLow:     lrSfc850 != null ? Math.round(lrSfc850 * 10) / 10 : null,
      gust:         Math.round(g),
      gustMean:     Math.round(gM ?? g),
      windSpeed:    Math.round(num(windSpeed10, 0)),
      windSpeed80:  Math.round(num(windSpeed80, 0)),
      windDir:      Math.round(num(windDir10, num(windDir80, 0))),
      windDir80:    Math.round(num(windDir80, 0)),
      freezingLvl:  Math.round(num(freezingLvl, 0)),
      blHeight:     blKm != null ? Math.round(blKm * 1000) : null,
      surfPressure: Math.round(P),
      surfacePres:  Math.round(sfcP),
      isDay:        isDayResolved,
      hourUTC:      hr,
      instability:   Math.round(instability   * 100),
      moisture:      Math.round(moisture       * 100),
      liftTrigger:   Math.round(liftTrigger    * 100),
      capRelease:    Math.round(capRelease     * 100),
      organisation:  Math.round((organisation - 1) / 0.91 * 100),
      surfaceHeating:Math.round(surfaceHeating * 100),
      synopticAscent:Math.round(synopticAscent * 100),
      frontalLift:   Math.round(frontalLift    * 100),
      oroAscent:     Math.round(oroAscent      * 100),
      upperDiv:      Math.round(upperDiv       * 100),
      srhNorm:       Math.round(srh01          * 100),
      lapseInst:     Math.round(lapseInst      * 100),
      capeInst:      Math.round(capeInst       * 100),
      kInstNorm:     Math.round(kInst          * 100),
      pwat:          Math.round(pwatProxy      * 100),
      dcape:         Math.round(dcape01        * 100),
      dcapeJ:        Math.round(dcapeJ),
      wbzHeight:     wbzM != null ? Math.round(wbzM) : null,
      cloudTopKm:    Math.round(cloudTopKm * 10) / 10,
      flashRate:     Math.round(flashRate * 10) / 10,
      thunderProb:   thunderProb,
      confidence:    confidence,
      stormMode:     stormMode,
      limitingIngredient: limitingIngredient,
      dominantHazard: dominantHazard,
      stormMotionDir: stormMotionDir,
      stormMotionMph: stormMotionMph,
      spanishPlume:  spanishPlume ? Math.round(plumeStrength * 100) : 0,
      capDelayHr:    Math.round(capDelayHr * 10) / 10,
      ehi:           Math.round(EHI * 100) / 100,
      scp:           Math.round(SCP * 100) / 100,
      stp:           Math.round(STP * 100) / 100,
      superHeatMult: Math.round(superHeatMult * 100),
      lowCloudMult:  Math.round(lowCloudMult  * 100),
      anvilMult:     Math.round(anvilMult     * 100),
      stratiformMult:Math.round(stratiformMult* 100),
      visMult:       Math.round(visMult       * 100),
      apparentMult:  Math.round(apparentMult  * 100),
      varCrossCheck: Math.round(varCrossCheck * 100),
      capeMax:       Math.round(_capeMax),
      capeMean:      Math.round(_capeMean),
      precipSum:     Math.round(_precipSum * 10) / 10,
      visibility:    Math.round(_vis),
      // Physics-engine (parcel-theory) diagnostics.
      capeModel:     Math.round(capeModel),
      capeParcel:    physics?.capeParcel ?? null,
      cinParcel:     physics?.cinParcel ?? null,
      lclHeight:     physics?.lclHeight ?? null,
      lfcHeight:     physics?.lfcHeight ?? null,
      elHeight:      physics?.elHeight ?? null,
      cloudDepth:    physics?.cloudDepth ?? null,
      lapseSfc500:   physics?.lapseSfc500 ?? null,
      physicsEngine: physics != null,
    },
  };
}