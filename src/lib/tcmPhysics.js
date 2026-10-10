// ─────────────────────────────────────────────────────────────────────────────
// TCM PHYSICS ENGINE — parcel theory from the real pressure-level sounding.
//
// The risk engine (engineScores) consumes Open-Meteo's pre-computed cape / cin /
// lifted_index plus lapse-rate & shear proxies. Now that the fetch serves the
// full 850/700/500 hPa profile, we do proper thermodynamics: lift a surface
// parcel along the dry then moist adiabat, find its LCL / LFC / EL, and integrate
// virtual-temperature buoyancy for a SECOND, independent estimate of CAPE / CIN.
// Blended at 35 % with the model's own value this stabilises the instability term
// and unlocks genuinely sounding-derived quantities (LCL/LFC/EL height, cloud
// depth, surface→500 lapse) that the surface proxies can only approximate.
//
// WHAT CHANGED IN THIS REWRITE (vs the previous version):
//
//   1. CIN now includes the SUB-LCL negative area.  The old integrator only
//      accumulated inhibition ABOVE the LCL (its comment said "below LFC" but
//      the `if (aboveLcl)` guard excluded the entire sub-cloud layer).  A
//      surface-based cap — a nocturnal inversion, a stable morning boundary
//      layer, the classic "loaded gun" lid — lives largely BELOW the LCL, so
//      the old cinParcel systematically under-reported the very inhibition it
//      exists to measure.  Buoyancy is now integrated from the surface upward
//      and every negative layer below the LFC counts, which is the textbook
//      definition of CIN.
//
//   2. Truncated-profile EL.  We only fetch temperatures to 500 hPa (~5.6 km),
//      but UK summer storm tops routinely reach 300–200 hPa (~9–12 km).  The old
//      code held the environment constant above the top real level, which zeroed
//      the height increment and pinned the equilibrium level at ~500 hPa — making
//      every deep storm look shallow and starving the lightning flash-rate model
//      (which keys off cloud-top height).  We now extend the environment above the
//      highest real level along a standard mid-latitude upper-tropospheric lapse
//      rate to a nominal tropopause, so a genuinely deep parcel finds a realistic
//      EL.  This is the standard treatment of a truncated sounding and is clearly
//      flagged (elExtrapolated) so downstream code knows the top was synthesised.
//
//   3. Sub-stepped moist adiabat.  The saturated ascent is integrated with
//      internal sub-steps for accuracy instead of a single coarse Euler step per
//      level, removing the small warm bias the old single-step introduced in the
//      mid-troposphere.
//
//   4. Honest CIN.  When no LFC exists (the surface parcel is never buoyant),
//      cinParcel is reported as 0 — there is no realisable convection to inhibit,
//      so a large "cap" figure would be meaningless noise fed into the engine.
//
// All pure functions, no I/O.  Units: T,Td in °C; p in hPa; z in m.
// References: Bolton (1980) for θ_e / LCL; standard pseudo-adiabatic lift.
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ── Constants ────────────────────────────────────────────────────────────────
const Rd = 287.04;       // J/kg/K  gas constant dry air
const Rv = 461.5;        // J/kg/K  gas constant water vapour
const EPS = Rd / Rv;     // 0.622
const Cp = 1005.7;       // J/kg/K  specific heat dry air at const pressure
const Lv0 = 2.501e6;     // J/kg    latent heat of vaporisation at 0 °C
const G = 9.80665;       // m/s²
const KELVIN = 273.15;

// Integration step for the parcel ascent (hPa). 10 hPa trapezoidal integration
// is accurate to a few % for CAPE/CIN — finer buys nothing at a 35 % blend.
const DP = 10;

// Truncated-sounding upper extension: above the highest real level we build a
// synthetic environment along a standard upper-tropospheric lapse rate up to a
// nominal tropopause, so a deep parcel can find its true equilibrium level.
const GAMMA_UPPER_K_PER_KM = 7.0;    // mid-latitude upper-tropo environmental lapse
const TROPOPAUSE_T_C       = -58;    // isothermal floor (approx mid-lat tropopause)
const EXTEND_PRESSURES     = [400, 300, 250, 200, 150];  // hPa, ascending altitude
const EXTEND_IF_TOP_ABOVE  = 320;    // only extend when top real level p > this (hPa)

// ── Thermodynamic helpers ────────────────────────────────────────────────────
// Saturation vapour pressure over water (Bolton 1980), T in °C → hPa.
function esat(Tc) {
  return 6.112 * Math.exp((17.67 * Tc) / (Tc + 243.5));
}
// Mixing ratio (kg/kg) from vapour pressure e (hPa) and pressure p (hPa).
function mixingRatio(e, p) {
  return EPS * e / Math.max(1e-6, p - e);
}
// Temperature-dependent latent heat of vaporisation (J/kg).
function latentHeat(Tc) {
  return Lv0 - 2370 * Tc;
}
// Virtual temperature (K) from T (K) and mixing ratio w (kg/kg).
function virtualT(Tk, w) {
  return Tk * (1 + 0.61 * w);
}
// LCL temperature (K) from surface T,Td (°C) — Bolton (1980) eq. 15.
function lclTempK(Tc, Tdc) {
  const Tk = Tc + KELVIN;
  const Tdk = Tdc + KELVIN;
  return 1 / (1 / (Tdk - 56) + Math.log(Tk / Tdk) / 800) + 56;
}
// Pressure (hPa) at the LCL by Poisson's relation.
function lclPressure(pSfc, Tc, Tlcl_K) {
  return pSfc * Math.pow(Tlcl_K / (Tc + KELVIN), Cp / Rd);
}
// Dry-adiabatic temperature (K) lifting from (p0,T0) to p.
function dryAdiabat(T0_K, p0, p) {
  return T0_K * Math.pow(p / p0, Rd / Cp);
}
// Geopotential height (m) of a level via the hypsometric equation, using the
// mean virtual temperature of the layer below it.
function hypsometricHeight(zBelow, pBelow, pHere, TvBelow_K, TvHere_K) {
  const TvMean = 0.5 * (TvBelow_K + TvHere_K);
  return zBelow + (Rd * TvMean / G) * Math.log(pBelow / pHere);
}

// Saturated (pseudo-adiabatic) ascent from (Tk,p) to pNext, internally
// sub-stepped for accuracy. Returns the parcel temperature (K) at pNext.
function moistAdiabatTo(Tk, p, pNext, substeps = 3) {
  let T = Tk, pc = p;
  const dp = (pNext - p) / substeps;
  for (let i = 0; i < substeps; i++) {
    const Tc = T - KELVIN;
    const ws = mixingRatio(esat(Tc), pc);
    const Lv = latentHeat(Tc);
    const numer = (Rd * T / Cp) + (Lv * ws / Cp);
    const denom = pc * (1 + (Lv * Lv * ws * EPS) / (Cp * Rd * T * T));
    T += (numer / denom) * dp;
    pc += dp;
  }
  return T;
}

// ─────────────────────────────────────────────────────────────────────────────
// parcelAscent — lift a surface parcel and integrate buoyancy.
//
// Input:  sfc = { T, Td, p, z }   (°C, °C, hPa, m)
//         levels = [{ p, T, Td?, z? }, …]  (the available upper levels)
// Output: { capeParcel, cinParcel, lclHeight, lfcHeight, elHeight, lclPressure,
//           cloudDepth, lapseSfc500, elExtrapolated }  — or null if the profile
//         is too sparse (need surface + at least one mid-level temperature).
// ─────────────────────────────────────────────────────────────────────────────
export function parcelAscent(sfc, levels) {
  if (!sfc || sfc.T == null || sfc.Td == null) return null;
  const pSfc = sfc.p != null ? sfc.p : 1013;
  const Tc = sfc.T;
  const Tdc = Math.min(sfc.T, sfc.Td);   // dewpoint can't exceed temperature

  // Build the environmental profile: surface + every real level above it.
  const env = [{ p: pSfc, T: Tc, Td: Tdc, z: sfc.z != null ? sfc.z : 40 }];
  for (const l of levels) {
    if (l && l.p != null && l.T != null && l.p < pSfc - 5) {
      env.push({ p: l.p, T: l.T, Td: l.Td ?? null, z: l.z ?? null });
    }
  }
  if (env.length < 2) return null;
  env.sort((a, b) => b.p - a.p);   // surface first (high p) → top (low p)

  // Fill any missing geopotential heights via hypsometric integration.
  for (let i = 1; i < env.length; i++) {
    if (env[i].z == null) {
      const wBelow = env[i - 1].Td != null ? mixingRatio(esat(env[i - 1].Td), env[i - 1].p) : 0;
      const wHere  = env[i].Td   != null ? mixingRatio(esat(env[i].Td),   env[i].p)   : 0;
      env[i].z = hypsometricHeight(
        env[i - 1].z ?? 40, env[i - 1].p, env[i].p,
        virtualT(env[i - 1].T + KELVIN, wBelow),
        virtualT(env[i].T + KELVIN, wHere),
      );
    }
  }

  // ── Extend a truncated profile above the top real level ────────────────────
  // Only when we lack genuine upper-tropospheric data (top level > ~320 hPa),
  // so a deep parcel can reach a realistic equilibrium level. Synthetic levels
  // follow a standard upper lapse rate to an isothermal tropopause.
  let elExtrapolated = false;
  const topReal = env[env.length - 1];
  if (topReal.p > EXTEND_IF_TOP_ABOVE) {
    let zc = topReal.z, Tc_env = topReal.T, pc = topReal.p;
    for (const pNext of EXTEND_PRESSURES) {
      if (pNext >= pc) continue;
      const dz = (Rd * (Tc_env + KELVIN) / G) * Math.log(pc / pNext);
      const zNext = zc + dz;
      const Tnext = Math.max(TROPOPAUSE_T_C, Tc_env - GAMMA_UPPER_K_PER_KM * (dz / 1000));
      env.push({ p: pNext, T: Tnext, Td: null, z: zNext, synthetic: true });
      pc = pNext; zc = zNext; Tc_env = Tnext;
    }
  }

  // Linear interpolation of an environmental field at pressure p.
  const interpEnv = (p, key) => {
    if (p >= env[0].p) return env[0][key];
    if (p <= env[env.length - 1].p) return env[env.length - 1][key];
    for (let i = 0; i < env.length - 1; i++) {
      const a = env[i], b = env[i + 1];
      if (p <= a.p && p >= b.p) {
        if (a[key] == null || b[key] == null) return a[key] ?? b[key];
        const t = (a.p - p) / (a.p - b.p);
        return a[key] + t * (b[key] - a[key]);
      }
    }
    return null;
  };

  // ── Parcel path setup ──────────────────────────────────────────────────────
  const w0 = mixingRatio(esat(Tdc), pSfc);           // surface mixing ratio (conserved dry)
  const Tlcl_K = lclTempK(Tc, Tdc);
  const pLcl = clamp(lclPressure(pSfc, Tc, Tlcl_K), 100, pSfc);
  const pTop = Math.max(150, env[env.length - 1].p);  // integrate to profile top (≥150 hPa)

  let cape = 0, cin = 0;
  let zLcl = null, zLfc = null, zEl = null;
  let lfcFound = false;
  let prevBuoy = null, prevZ = env[0].z;
  let parcelTk = Tc + KELVIN;
  let aboveLcl = false;

  for (let p = pSfc; p >= pTop; p -= DP) {
    // Parcel temperature at this level.
    let parcelTatP;
    if (p >= pLcl) {
      parcelTatP = dryAdiabat(Tc + KELVIN, pSfc, p);       // below LCL: dry adiabat
    } else {
      if (!aboveLcl) {
        parcelTk = dryAdiabat(Tc + KELVIN, pSfc, pLcl);     // initialise at the LCL
        aboveLcl = true;
        zLcl = interpEnv(pLcl, 'z');
      }
      const pStart = (p + DP <= pLcl) ? (p + DP) : pLcl;    // step from LCL on first crossing
      parcelTk = moistAdiabatTo(parcelTk, pStart, p);
      parcelTatP = parcelTk;
    }

    const envT = interpEnv(p, 'T');
    const envTd = interpEnv(p, 'Td');
    const envZ = interpEnv(p, 'z');
    if (envT == null || envZ == null) continue;

    // Virtual-temperature buoyancy (accurate near the moist surface layer).
    const wParcel = p >= pLcl ? w0 : mixingRatio(esat(parcelTatP - KELVIN), p);
    const wEnv = envTd != null ? mixingRatio(esat(envTd), p) : 0;
    const TvParcel = virtualT(parcelTatP, wParcel);
    const TvEnv = virtualT(envT + KELVIN, wEnv);
    const buoy = G * (TvParcel - TvEnv) / TvEnv;   // m/s²  (>0 = positive buoyancy)

    if (prevBuoy != null) {
      const dz = envZ - prevZ;
      if (dz > 0) {
        const layer = 0.5 * (buoy + prevBuoy) * dz;
        if (buoy > 0) {
          if (!lfcFound) { lfcFound = true; zLfc = envZ; }   // first buoyant level = LFC
          cape += Math.max(0, layer);
          zEl = envZ;                                          // last buoyant level = EL
        } else if (!lfcFound) {
          cin += Math.min(0, layer);                          // sub-LFC inhibition (incl. sub-LCL)
        }
      }
    }
    prevBuoy = buoy; prevZ = envZ;
  }

  // The EL is "extrapolated" only if the parcel remained buoyant into the
  // synthesised upper environment (i.e. EL sits above the top real level).
  if (zEl != null && zEl > topReal.z) elExtrapolated = topReal.p > EXTEND_IF_TOP_ABOVE;

  // Surface→500 hPa lapse rate from the real profile (°C/km).
  const lapseSfc500 = (() => {
    const t500 = interpEnv(500, 'T');
    const z500 = interpEnv(500, 'z');
    if (t500 == null || z500 == null || z500 <= env[0].z + 50) return null;
    return (env[0].T - t500) / ((z500 - env[0].z) / 1000);
  })();

  // No LFC ⇒ no realisable convection ⇒ CIN is not a meaningful figure.
  const haveConvection = lfcFound && cape > 0;

  return {
    capeParcel: Math.round(clamp(cape, 0, 6000)),
    cinParcel: haveConvection ? Math.round(clamp(-cin, 0, 800)) : 0,
    lclHeight: zLcl != null ? Math.round(zLcl) : null,
    lfcHeight: haveConvection && zLfc != null ? Math.round(zLfc) : null,
    elHeight: haveConvection && zEl != null ? Math.round(zEl) : null,
    lclPressure: Math.round(pLcl),
    cloudDepth: (haveConvection && zEl != null && zLcl != null) ? Math.round(zEl - zLcl) : null,
    lapseSfc500: lapseSfc500 != null ? Math.round(lapseSfc500 * 10) / 10 : null,
    elExtrapolated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// soundingPhysics — assemble the level list from the flat `env` object the risk
// engine already builds, run parcelAscent, and return a compact physics block.
// Returns null when the profile is too sparse, so the engine cleanly keeps its
// model-CAPE path.
// ─────────────────────────────────────────────────────────────────────────────
export function soundingPhysics(e) {
  if (!e) return null;
  if (e.t850 == null && e.t700 == null && e.t500 == null) return null;

  const levels = [];
  if (e.t850 != null) levels.push({ p: 850, T: e.t850, Td: e.td850 ?? null, z: e.z850 ?? null });
  if (e.t700 != null) levels.push({ p: 700, T: e.t700, Td: e.td700 ?? null, z: e.z700 ?? null });
  if (e.t500 != null) levels.push({ p: 500, T: e.t500, Td: null,            z: e.z500 ?? null });

  const sfc = {
    T: e.t2m != null ? e.t2m : 10,
    Td: e.td != null ? e.td : 5,
    p: e.surfacePres ?? e.pressureMsl ?? 1013,
    z: e.surfaceHeight ?? 40,
  };
  return parcelAscent(sfc, levels);
}