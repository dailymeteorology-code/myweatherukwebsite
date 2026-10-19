"""Vertical interpolation, chosen per variable rather than once for all.

Stage 3. Interpolation here is a RECONSTRUCTION method, not meteorology: it
fills a level the model did not publish, and records that it did so. It never
decides anything about the weather.

WHY NOT ONE METHOD FOR EVERYTHING
---------------------------------
Different quantities vary differently with height, and a single linear-in-
pressure rule is wrong for most of them:

  temperature       nearly linear in ln(p) through the troposphere, which is
                    why a tephigram's dry adiabats are straight. Linear in p
                    is noticeably wrong across a deep layer.
  geopotential      linear in ln(p) by the hypsometric relation itself.
  wind u, v         interpolated as COMPONENTS. Never as speed and direction:
                    direction is circular, and averaging 350 deg with 10 deg
                    gives 180 -- a wind reversed rather than northerly.
  humidity          NOT interpolated as RH. See below.
  cloud water/ice   sharp vertical gradients and a hard floor at zero.
                    Linear, then clamped: an overshoot below zero is not a
                    dry layer, it is an artefact.
  vertical velocity linear in ln(p), like wind.

HUMIDITY IS THE INTERESTING ONE
-------------------------------
Relative humidity is a RATIO to a saturation value that itself varies
steeply and non-linearly with temperature. Interpolating RH directly between
two levels therefore blends two different denominators, and the error is
largest exactly where it matters -- across a temperature inversion, where the
mid-level saturation value is nowhere near the average of its neighbours.

So RH is converted to mixing ratio using the temperature and pressure at each
source level, the mixing ratio is interpolated (it is conserved under dry
vertical displacement, so it is the physically meaningful quantity to move),
and it is converted back using the temperature at the TARGET level.

That requires temperature at the target level. When it is unavailable the
code falls back to interpolating RH directly and SAYS SO in the provenance,
because a silent fallback would hide a materially worse number.
"""
from __future__ import annotations

import numpy as np

# --- thermodynamic constants ----------------------------------------------
#: Ratio of the gas constants for dry air and water vapour.
EPSILON = 0.622
#: Magnus/Tetens coefficients over liquid water. Valid roughly -45..60 C,
#: which covers every level TCM asks for.
_ES_A = 611.2      # Pa at 0 C
_ES_B = 17.67
_ES_C = 243.5      # K offset, expressed against 273.15


def saturation_vapour_pressure(temperature_k: np.ndarray) -> np.ndarray:
    """Saturation vapour pressure over liquid water, in Pa (Magnus form)."""
    celsius = np.asarray(temperature_k, dtype="float64") - 273.15
    return _ES_A * np.exp(_ES_B * celsius / (celsius + _ES_C))


def rh_to_mixing_ratio(
    rh_percent: np.ndarray, temperature_k: np.ndarray, pressure_pa: float
) -> np.ndarray:
    """Mixing ratio (kg/kg) from relative humidity."""
    es = saturation_vapour_pressure(temperature_k)
    e = np.clip(np.asarray(rh_percent, dtype="float64"), 0.0, None) / 100.0 * es
    # Vapour pressure cannot reach the total pressure; guard the division so
    # a corrupt input produces NaN rather than a negative mixing ratio.
    denominator = pressure_pa - e
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denominator > 0, EPSILON * e / denominator, np.nan)


def mixing_ratio_to_rh(
    w: np.ndarray, temperature_k: np.ndarray, pressure_pa: float
) -> np.ndarray:
    """Relative humidity (%) from mixing ratio."""
    w = np.asarray(w, dtype="float64")
    e = w * pressure_pa / (EPSILON + w)
    es = saturation_vapour_pressure(temperature_k)
    with np.errstate(divide="ignore", invalid="ignore"):
        rh = np.where(es > 0, 100.0 * e / es, np.nan)
    # Supersaturation is physically real in a model field, so it is NOT
    # clipped to 100 here. It is left for quality control to flag; clipping
    # would erase the evidence.
    return rh


def _weights(target: float, a: float, b: float, log: bool) -> tuple[float, float]:
    """Linear weights for `target` between levels a and b."""
    if log:
        ta, tb, tt = np.log(a), np.log(b), np.log(target)
    else:
        ta, tb, tt = a, b, target
    span = tb - ta
    if span == 0:
        return 1.0, 0.0
    frac = (tt - ta) / span
    return 1.0 - frac, frac


# ---------------------------------------------------------------------------
# Per-variable methods
# ---------------------------------------------------------------------------

#: How each canonical variable stem is interpolated, and the documented name
#: of the method recorded in provenance.
METHODS: dict[str, str] = {
    "temperature": "linear_in_log_pressure",
    "wet_bulb_potential_temperature": "linear_in_log_pressure",
    "geopotential_height": "linear_in_log_pressure",
    "u_wind": "linear_in_log_pressure",
    "v_wind": "linear_in_log_pressure",
    "wind_speed": "linear_in_log_pressure",
    "vertical_velocity": "linear_in_log_pressure",
    "relative_humidity": "mixing_ratio_in_log_pressure",
    "cloud_water_mixing_ratio": "linear_clamped_non_negative",
    "cloud_ice_mixing_ratio": "linear_clamped_non_negative",
}

#: Variables that must never be interpolated as a scalar because they are
#: circular. Wind direction is reconstructed from interpolated components.
CIRCULAR = ("wind_direction",)

#: Variables with a hard physical floor at zero.
NON_NEGATIVE = (
    "cloud_water_mixing_ratio", "cloud_ice_mixing_ratio", "wind_speed",
    "relative_humidity",
)


def stem_of(name: str) -> str:
    """Canonical stem of a level-suffixed variable name."""
    for candidate in sorted(METHODS, key=len, reverse=True):
        if name == candidate or name.startswith(candidate + "_"):
            return candidate
    for candidate in CIRCULAR:
        if name.startswith(candidate):
            return candidate
    return name


def method_for(name: str) -> str:
    return METHODS.get(stem_of(name), "linear")


def is_circular(name: str) -> bool:
    return stem_of(name) in CIRCULAR


def interpolate_pressure_level(
    name: str,
    target_hpa: float,
    lower_hpa: float, lower_values: np.ndarray,
    upper_hpa: float, upper_values: np.ndarray,
    *,
    lower_temperature: np.ndarray | None = None,
    upper_temperature: np.ndarray | None = None,
    target_temperature: np.ndarray | None = None,
) -> tuple[np.ndarray, str]:
    """Interpolate one variable to one pressure level.

    Returns the values and the method actually used, which may differ from
    the declared method when a fallback was taken.
    """
    if is_circular(name):
        raise ValueError(
            f"{name} is circular and must not be interpolated directly; "
            "interpolate the u and v components and recompute the direction"
        )

    stem = stem_of(name)
    method = METHODS.get(stem, "linear")

    if method == "mixing_ratio_in_log_pressure":
        have_all = (
            lower_temperature is not None
            and upper_temperature is not None
            and target_temperature is not None
        )
        if have_all:
            w_lower = rh_to_mixing_ratio(
                lower_values, lower_temperature, lower_hpa * 100.0
            )
            w_upper = rh_to_mixing_ratio(
                upper_values, upper_temperature, upper_hpa * 100.0
            )
            a, b = _weights(target_hpa, lower_hpa, upper_hpa, log=True)
            w_target = a * w_lower + b * w_upper
            out = mixing_ratio_to_rh(
                w_target, target_temperature, target_hpa * 100.0
            )
            return np.clip(out, 0.0, None).astype("float32"), method
        # Temperature is missing, so the physically correct route is closed.
        # Fall back, and return the fallback's name so provenance records the
        # weaker method rather than the intended one.
        method = "linear_in_log_pressure_rh_fallback"

    log = "log_pressure" in method or method.startswith("linear_in_log")
    a, b = _weights(target_hpa, lower_hpa, upper_hpa, log=log)
    out = a * np.asarray(lower_values, dtype="float64") \
        + b * np.asarray(upper_values, dtype="float64")

    if stem in NON_NEGATIVE:
        # A linear blend of two small positives can land marginally negative
        # through floating point; more importantly, a sharp cloud gradient
        # can overshoot. Neither is a real negative concentration.
        out = np.clip(out, 0.0, None)

    return out.astype("float32"), method


def interpolate_height_level(
    name: str,
    target_m: float,
    lower_m: float, lower_values: np.ndarray,
    upper_m: float, upper_values: np.ndarray,
) -> tuple[np.ndarray, str]:
    """Interpolate one variable to one height level.

    Height is a geometric coordinate, so the blend is linear in height. There
    is no logarithmic relationship to exploit the way there is in pressure.
    """
    if is_circular(name):
        raise ValueError(
            f"{name} is circular and must not be interpolated directly"
        )
    a, b = _weights(target_m, lower_m, upper_m, log=False)
    out = a * np.asarray(lower_values, dtype="float64") \
        + b * np.asarray(upper_values, dtype="float64")
    if stem_of(name) in NON_NEGATIVE:
        out = np.clip(out, 0.0, None)
    return out.astype("float32"), "linear_in_height"


def wind_direction_from_components(
    u: np.ndarray, v: np.ndarray
) -> np.ndarray:
    """Meteorological direction (degrees FROM) out of u/v components."""
    return (np.degrees(np.arctan2(-np.asarray(u), -np.asarray(v))) + 360.0) % 360.0


def wind_speed_from_components(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    return np.hypot(np.asarray(u), np.asarray(v))
