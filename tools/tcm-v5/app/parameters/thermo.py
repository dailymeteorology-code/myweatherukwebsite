"""Shared thermodynamics.

Stage 4. Every parcel calculation, index and moisture diagnostic in the
platform goes through these functions, so they are written once, referenced,
and tested against published values rather than reimplemented per module.

CONVENTIONS, FIXED HERE AND NOWHERE ELSE
----------------------------------------
    temperature   kelvin
    pressure      pascals
    mixing ratio  kg/kg  (Bolton's formulae take g/kg; converted at the call
                          site, never leaked)
    height        metres

REFERENCES
----------
Bolton, D. (1980). The computation of equivalent potential temperature.
    *Monthly Weather Review*, 108, 1046-1053.
    -- saturation vapour pressure (eq. 10), LCL temperature (eq. 15),
       equivalent potential temperature (eq. 39, 43).

Emanuel, K. A. (1994). *Atmospheric Convection*. Oxford University Press.
    -- pseudoadiabatic lapse rate, virtual temperature treatment of buoyancy.

Doswell, C. A. & Rasmussen, E. N. (1994). The effect of neglecting the
    virtual temperature correction on CAPE calculations.
    *Weather and Forecasting*, 9, 625-629.
    -- why buoyancy must use virtual temperature; neglecting it
       underestimates CAPE, typically by 10-30% in moist low levels.

WHY BOLTON RATHER THAN A SIMPLER SATURATION FORMULA
---------------------------------------------------
Bolton's eq. 10 is accurate to 0.3% over -35 to +35 C, which is the whole
range that matters for UK convection. The Clausius-Clapeyron form with a
constant latent heat is several percent out at low temperature, and that
error propagates straight into mixing ratio, into parcel buoyancy, and into
CAPE.
"""
from __future__ import annotations

import numpy as np

# --- constants -------------------------------------------------------------
#: Specific gas constant for dry air, J/(kg K).
R_DRY = 287.04
#: Specific gas constant for water vapour, J/(kg K).
R_VAPOUR = 461.50
#: Ratio of the two. Appears throughout as `epsilon`.
EPSILON = R_DRY / R_VAPOUR                      # 0.62198
#: Specific heat of dry air at constant pressure, J/(kg K).
CP_DRY = 1005.7
#: Standard gravity, m/s^2.
GRAVITY = 9.80665
#: Reference pressure for potential temperature, Pa.
P_REFERENCE = 100_000.0
#: Density of liquid water, kg/m^3 -- for precipitable water in mm.
RHO_WATER = 1000.0

#: Poisson constant, Rd/cp.
KAPPA = R_DRY / CP_DRY                          # 0.2854

ZERO_CELSIUS = 273.15


def latent_heat_vaporisation(temperature: np.ndarray) -> np.ndarray:
    """Latent heat of vaporisation, J/kg, as a function of temperature.

    Linear fit about 0 C. Treating it as constant at 2.501e6 costs about 1%
    at -30 C, which is inside the mixed-phase layer where hail and updraught
    diagnostics are decided, so the dependence is kept.
    """
    return 2.501e6 - 2370.0 * (np.asarray(temperature, dtype="float64") - ZERO_CELSIUS)


def saturation_vapour_pressure(temperature: np.ndarray) -> np.ndarray:
    """Saturation vapour pressure over liquid water, Pa.

    Bolton (1980) eq. 10. Accurate to 0.3% over -35 to +35 C.
    """
    celsius = np.asarray(temperature, dtype="float64") - ZERO_CELSIUS
    return 611.2 * np.exp(17.67 * celsius / (celsius + 243.5))


def saturation_mixing_ratio(
    temperature: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Saturation mixing ratio, kg/kg."""
    es = saturation_vapour_pressure(temperature)
    pressure = np.asarray(pressure, dtype="float64")
    # Guard the pole at e -> p. Above roughly 100 hPa with warm air the
    # denominator can approach zero; returning NaN there is honest, whereas a
    # huge finite number would propagate into CAPE as spurious buoyancy.
    denominator = pressure - es
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denominator > 1.0, EPSILON * es / denominator, np.nan)


def mixing_ratio_from_rh(
    relative_humidity: np.ndarray, temperature: np.ndarray,
    pressure: np.ndarray,
) -> np.ndarray:
    """Mixing ratio, kg/kg, from RH in percent."""
    rh = np.clip(np.asarray(relative_humidity, dtype="float64"), 0.0, None) / 100.0
    es = saturation_vapour_pressure(temperature)
    e = rh * es
    pressure = np.asarray(pressure, dtype="float64")
    denominator = pressure - e
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denominator > 1.0, EPSILON * e / denominator, np.nan)


def vapour_pressure_from_mixing_ratio(
    mixing_ratio: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Partial pressure of water vapour, Pa."""
    w = np.asarray(mixing_ratio, dtype="float64")
    return np.asarray(pressure, dtype="float64") * w / (EPSILON + w)


def dewpoint_from_mixing_ratio(
    mixing_ratio: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Dew-point temperature, K. Inverts Bolton eq. 10."""
    e = vapour_pressure_from_mixing_ratio(mixing_ratio, pressure)
    with np.errstate(divide="ignore", invalid="ignore"):
        ln = np.log(np.where(e > 0, e / 611.2, np.nan))
    return ZERO_CELSIUS + 243.5 * ln / (17.67 - ln)


def dewpoint_from_rh(
    relative_humidity: np.ndarray, temperature: np.ndarray
) -> np.ndarray:
    """Dew-point temperature, K, from RH in percent."""
    rh = np.clip(np.asarray(relative_humidity, dtype="float64"), 1e-6, None) / 100.0
    es = saturation_vapour_pressure(temperature)
    e = rh * es
    with np.errstate(divide="ignore", invalid="ignore"):
        ln = np.log(np.where(e > 0, e / 611.2, np.nan))
    return ZERO_CELSIUS + 243.5 * ln / (17.67 - ln)


def virtual_temperature(
    temperature: np.ndarray, mixing_ratio: np.ndarray
) -> np.ndarray:
    """Virtual temperature, K.

        Tv = T (1 + w/epsilon) / (1 + w)

    The exact form, not the T(1 + 0.61w) linearisation: the two differ by a
    few hundredths of a kelvin in a moist boundary layer, and buoyancy is a
    difference of two temperatures, so a systematic bias in both is not
    self-cancelling.

    Buoyancy MUST use this rather than dry temperature (Doswell & Rasmussen
    1994): neglecting it understates CAPE by 10-30% in the moist low levels
    that matter most for UK convection.
    """
    w = np.asarray(mixing_ratio, dtype="float64")
    return np.asarray(temperature, dtype="float64") * (1.0 + w / EPSILON) / (1.0 + w)


def potential_temperature(
    temperature: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Dry potential temperature, K. theta = T (p0/p)^kappa."""
    return np.asarray(temperature, dtype="float64") * (
        P_REFERENCE / np.asarray(pressure, dtype="float64")
    ) ** KAPPA


def lcl_temperature(
    temperature: np.ndarray, dewpoint: np.ndarray
) -> np.ndarray:
    """Temperature at the lifting condensation level, K.

    Bolton (1980) eq. 15. Accurate to about 0.1 K, and far better than the
    common `T - (T - Td)/8 * z` rules of thumb.
    """
    t = np.asarray(temperature, dtype="float64")
    td = np.asarray(dewpoint, dtype="float64")
    with np.errstate(divide="ignore", invalid="ignore"):
        return 1.0 / (1.0 / (td - 56.0) + np.log(t / td) / 800.0) + 56.0


def lcl_pressure(
    temperature: np.ndarray, dewpoint: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Pressure at the lifting condensation level, Pa.

    Found from the conservation of potential temperature below the LCL:
    theta is constant during dry ascent, so once the LCL TEMPERATURE is known
    (Bolton eq. 15) the pressure follows from Poisson's equation.
    """
    t = np.asarray(temperature, dtype="float64")
    p = np.asarray(pressure, dtype="float64")
    t_lcl = lcl_temperature(t, dewpoint)
    with np.errstate(divide="ignore", invalid="ignore"):
        return p * (t_lcl / t) ** (1.0 / KAPPA)


def equivalent_potential_temperature(
    temperature: np.ndarray, dewpoint: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Equivalent potential temperature, K. Bolton (1980) eq. 24 and 39.

    Bolton's eq. 24 is written with the mixing ratio in GRAMS per kilogram
    and his eq. 39 with it in KILOGRAMS per kilogram. That mismatch is a real
    trap -- feeding g/kg to eq. 39 puts ~128 into the exponential and returns
    1e58 K -- so both forms are spelled out here and each is handed the units
    it actually wants:

        theta_DL = T (1000/(p - e))^0.2854 (T/T_L)^(0.28e-3 r)   eq. 24, r g/kg
        theta_E  = theta_DL exp[(3036/T_L - 1.78) w (1 + 0.448 w)]
                                                        eq. 39, w kg/kg

    Neither unit escapes this function; the signature is Pa and K like
    everything else in the module. Eq. 39 is Bolton's most accurate
    formulation (quoted accuracy 0.02 K), not his cruder eq. 43.

    theta_e is conserved under both dry AND pseudoadiabatic ascent, which
    makes it the right variable for selecting the most-unstable parcel.
    """
    t = np.asarray(temperature, dtype="float64")
    p = np.asarray(pressure, dtype="float64")
    td = np.asarray(dewpoint, dtype="float64")

    w = saturation_mixing_ratio(td, p)           # actual mixing ratio, kg/kg
    r_g = w * 1000.0                             # Bolton's r, g/kg
    e = vapour_pressure_from_mixing_ratio(w, p)
    t_lcl = lcl_temperature(t, td)

    with np.errstate(divide="ignore", invalid="ignore"):
        theta_dl = (
            t
            * (P_REFERENCE / (p - e)) ** KAPPA
            * (t / t_lcl) ** (0.28e-3 * r_g)
        )
        return theta_dl * np.exp(
            (3036.0 / t_lcl - 1.78) * w * (1.0 + 0.448 * w)
        )


def wet_bulb_temperature(
    temperature: np.ndarray, dewpoint: np.ndarray, pressure: np.ndarray,
    iterations: int = 12,
) -> np.ndarray:
    """Wet-bulb temperature, K, by Normand's construction.

    Solves the psychrometric relation

        cp (T - Tw) = Lv (ws(Tw, p) - w)

    by bisection between the dew point and the dry-bulb temperature. Tw lies
    between them by definition, so the bracket is guaranteed and the method
    cannot diverge -- unlike a Newton iteration, which is ill-conditioned in
    very dry air where the derivative approaches zero.

    Wet-bulb zero is NOT dry-bulb zero: in a dry sub-cloud layer the two can
    differ by more than a kilometre, which is exactly the layer that decides
    whether hail survives to the surface.
    """
    t = np.asarray(temperature, dtype="float64")
    td = np.asarray(dewpoint, dtype="float64")
    p = np.asarray(pressure, dtype="float64")
    w = saturation_mixing_ratio(td, p)           # actual mixing ratio

    low = np.minimum(td, t)
    high = np.asarray(t, dtype="float64").copy()
    for _ in range(iterations):
        mid = 0.5 * (low + high)
        ws_mid = saturation_mixing_ratio(mid, p)
        lv = latent_heat_vaporisation(mid)
        # Positive when the guess is too warm.
        residual = CP_DRY * (t - mid) - lv * (ws_mid - w)
        too_warm = residual < 0
        high = np.where(too_warm, mid, high)
        low = np.where(too_warm, low, mid)
    return 0.5 * (low + high)


def moist_lapse_rate_dp(
    temperature: np.ndarray, pressure: np.ndarray
) -> np.ndarray:
    """Pseudoadiabatic dT/dp, K/Pa, for a saturated parcel.

        dT/dp = (Rd T + Lv ws) / (p (cp + Lv^2 ws eps / (Rd T^2)))

    The standard saturated adiabatic lapse rate expressed in pressure
    coordinates (Emanuel 1994). Pseudoadiabatic: condensate is assumed to
    fall out immediately, so the parcel loses its liquid water and the
    process is irreversible.

    That is the right choice here. A reversible ascent retains condensate,
    whose weight reduces buoyancy; operational CAPE, and every value TCM will
    be compared against, is pseudoadiabatic. Mixing the two would make our
    numbers incomparable with everyone else's.
    """
    t = np.asarray(temperature, dtype="float64")
    p = np.asarray(pressure, dtype="float64")
    ws = saturation_mixing_ratio(t, p)
    lv = latent_heat_vaporisation(t)
    numerator = R_DRY * t + lv * ws
    denominator = p * (CP_DRY + (lv * lv * ws * EPSILON) / (R_DRY * t * t))
    with np.errstate(divide="ignore", invalid="ignore"):
        return numerator / denominator


def dry_adiabatic_temperature(
    temperature: float | np.ndarray, pressure_from: float | np.ndarray,
    pressure_to: float | np.ndarray,
) -> np.ndarray:
    """Temperature after dry-adiabatic displacement. Conserves theta."""
    return np.asarray(temperature, dtype="float64") * (
        np.asarray(pressure_to, dtype="float64")
        / np.asarray(pressure_from, dtype="float64")
    ) ** KAPPA


def moist_adiabatic_temperature(
    temperature: float, pressure_from: float, pressure_to: float,
    step_pa: float = 200.0,
) -> float:
    """Integrate the pseudoadiabat from one pressure to another.

    Fourth-order Runge-Kutta on dT/dp. The step defaults to 2 hPa: the
    integrand varies smoothly, and at that resolution the result is stable to
    better than 0.01 K against a 0.5 hPa step, while a 50 hPa step -- the
    spacing of the stored levels -- drifts by several tenths of a kelvin
    through a deep ascent. Integrating on the DATA's spacing would put that
    drift straight into CAPE.
    """
    t = float(temperature)
    p = float(pressure_from)
    target = float(pressure_to)
    if not np.isfinite(t) or not np.isfinite(p) or not np.isfinite(target):
        return float("nan")

    direction = -1.0 if target < p else 1.0
    remaining = abs(target - p)
    while remaining > 1e-9:
        h = direction * min(step_pa, remaining)
        k1 = float(moist_lapse_rate_dp(t, p))
        k2 = float(moist_lapse_rate_dp(t + 0.5 * h * k1, p + 0.5 * h))
        k3 = float(moist_lapse_rate_dp(t + 0.5 * h * k2, p + 0.5 * h))
        k4 = float(moist_lapse_rate_dp(t + h * k3, p + h))
        if not np.isfinite(k1 + k2 + k3 + k4):
            return float("nan")
        t += h * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0
        p += h
        remaining -= abs(h)
    return t


def hypsometric_thickness(
    pressure_bottom: float, pressure_top: float,
    mean_virtual_temperature: float,
) -> float:
    """Layer thickness in metres from the hypsometric equation.

        dz = (Rd Tv_mean / g) ln(p_bottom / p_top)

    Uses VIRTUAL temperature: the relation is exact for it and only
    approximate for dry temperature.
    """
    if not (pressure_bottom > 0 and pressure_top > 0):
        return float("nan")
    return (R_DRY * mean_virtual_temperature / GRAVITY) * np.log(
        pressure_bottom / pressure_top
    )
