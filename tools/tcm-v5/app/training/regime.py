"""Convective regime classification for the UK and Ireland.

Training the blend on "which model was best" is nearly useless averaged over
a year: UKV may be excellent in a slack summer airmass and mediocre in a
sheared autumn trough, and one mean skill number hides both. So skill is
learned PER REGIME, and this module decides which regime a forecast hour is
in.

The regimes are chosen for UK and Irish convection specifically, not copied
from a continental scheme:

  QUIESCENT           little or no instability. Most of the British year.
  AIRMASS             modest CAPE, weak shear -- slow-moving summer showers,
                      the classic "sun, then a heavy shower" day. Placement
                      is nearly unforecastable; models differ wildly.
  ORGANISED           CAPE with real deep-layer shear -- lines, multicells,
                      the occasional supercell. Shear makes storms more
                      predictable in motion, less so in initiation.
  PLUME               high instability under a warm mid-level plume with a
                      high freezing level -- the elevated, often overnight
                      Spanish-plume events that produce the UK's biggest
                      lightning counts and hail.
  FRONTAL             strong synoptic forcing with limited instability --
                      convection embedded in a front or trough.

Classification uses only fields TCM actually holds, and returns UNKNOWN
rather than guessing when the ingredients are missing. A regime asserted from
absent data would poison the training set it feeds.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np


class ConvectiveRegime(str, Enum):
    UNKNOWN = "unknown"
    QUIESCENT = "quiescent"
    AIRMASS = "airmass"
    ORGANISED = "organised"
    PLUME = "plume"
    FRONTAL = "frontal"

    @property
    def description(self) -> str:
        return {
            ConvectiveRegime.UNKNOWN: (
                "ingredients unavailable -- not classified"
            ),
            ConvectiveRegime.QUIESCENT: "little or no convective instability",
            ConvectiveRegime.AIRMASS: (
                "modest instability with weak shear; slow-moving showers, "
                "placement poorly constrained"
            ),
            ConvectiveRegime.ORGANISED: (
                "instability with deep-layer shear; organised multicell or "
                "supercell potential"
            ),
            ConvectiveRegime.PLUME: (
                "high instability beneath a warm mid-level plume; elevated "
                "and often overnight storms, high lightning and hail risk"
            ),
            ConvectiveRegime.FRONTAL: (
                "strong synoptic forcing with limited instability; convection "
                "embedded in a front or trough"
            ),
        }[self]


# Thresholds tuned for UK and Irish values, which are far lower than the
# continental or US figures usually quoted. 500 J/kg of MLCAPE is a
# significant day here.
CAPE_QUIESCENT = 100.0      # J/kg -- below this nothing convective happens
CAPE_MODERATE = 400.0
CAPE_HIGH = 900.0
SHEAR_ORGANISED = 15.0      # m/s bulk 0-6 km equivalent
SHEAR_STRONG = 20.0
FREEZING_LEVEL_PLUME = 3200.0   # m -- a high freezing level for these islands
LAPSE_RATE_STEEP = 6.5      # K/km between 850 and 500 hPa


@dataclass(frozen=True, slots=True)
class RegimeDiagnosis:
    regime: ConvectiveRegime
    #: Fraction of the analysis area in each regime, for a mixed situation.
    fractions: dict[str, float]
    #: The ingredients that were actually available.
    ingredients: tuple[str, ...]
    missing: tuple[str, ...]

    @property
    def is_mixed(self) -> bool:
        """True when no single regime covers most of the area."""
        top = max(self.fractions.values(), default=0.0)
        return top < 0.6

    def to_dict(self) -> dict:
        return {
            "regime": self.regime.value,
            "description": self.regime.description,
            "fractions": {k: round(v, 3) for k, v in self.fractions.items()},
            "is_mixed": self.is_mixed,
            "ingredients_used": list(self.ingredients),
            "ingredients_missing": list(self.missing),
        }


def classify_cells(
    cape: np.ndarray,
    shear: np.ndarray | None = None,
    freezing_level: np.ndarray | None = None,
    lapse_rate: np.ndarray | None = None,
) -> np.ndarray:
    """Per-cell regime, as an array of ConvectiveRegime values.

    Order matters: PLUME is tested before ORGANISED because a high-CAPE,
    high-freezing-level plume event is a distinct forecasting problem even
    when it is also sheared.
    """
    out = np.full(cape.shape, ConvectiveRegime.UNKNOWN.value, dtype=object)
    finite = np.isfinite(cape)

    quiescent = finite & (cape < CAPE_QUIESCENT)
    out[quiescent] = ConvectiveRegime.QUIESCENT.value

    convective = finite & (cape >= CAPE_QUIESCENT)

    plume = np.zeros_like(convective)
    if freezing_level is not None:
        plume = (
            convective
            & (cape >= CAPE_HIGH)
            & np.isfinite(freezing_level)
            & (freezing_level >= FREEZING_LEVEL_PLUME)
        )
    if lapse_rate is not None:
        # Steep mid-level lapse rates with real instability are the other
        # plume signature, and can occur below the freezing-level threshold.
        steep = np.isfinite(lapse_rate) & (lapse_rate >= LAPSE_RATE_STEEP)
        plume = plume | (convective & (cape >= CAPE_MODERATE) & steep)
    out[plume] = ConvectiveRegime.PLUME.value

    remaining = convective & ~plume
    if shear is not None:
        sheared = np.isfinite(shear) & (shear >= SHEAR_ORGANISED)
        organised = remaining & sheared & (cape >= CAPE_MODERATE)
        out[organised] = ConvectiveRegime.ORGANISED.value

        # Strong shear but little instability is a forcing-driven situation.
        frontal = remaining & sheared & (cape < CAPE_MODERATE)
        out[frontal] = ConvectiveRegime.FRONTAL.value

        airmass = remaining & ~sheared
        out[airmass] = ConvectiveRegime.AIRMASS.value
    else:
        # Without shear the best we can say is instability yes or no.
        out[remaining] = ConvectiveRegime.AIRMASS.value

    return out


def classify(
    cape: np.ndarray | None,
    shear: np.ndarray | None = None,
    freezing_level: np.ndarray | None = None,
    lapse_rate: np.ndarray | None = None,
) -> RegimeDiagnosis:
    """Dominant regime over the analysis area.

    Returns UNKNOWN when instability is unavailable: a regime label invented
    without CAPE would be a fabricated training label.
    """
    ingredients, missing = [], []
    for name, array in (
        ("cape", cape), ("shear", shear),
        ("freezing_level", freezing_level), ("lapse_rate", lapse_rate),
    ):
        (ingredients if array is not None else missing).append(name)

    if cape is None:
        return RegimeDiagnosis(
            ConvectiveRegime.UNKNOWN, {}, tuple(ingredients), tuple(missing)
        )

    cells = classify_cells(cape, shear, freezing_level, lapse_rate)
    flat = cells.ravel()
    known = flat[flat != ConvectiveRegime.UNKNOWN.value]
    if known.size == 0:
        return RegimeDiagnosis(
            ConvectiveRegime.UNKNOWN, {}, tuple(ingredients), tuple(missing)
        )

    labels, counts = np.unique(known, return_counts=True)
    fractions = {
        str(label): float(count / known.size)
        for label, count in zip(labels, counts)
    }

    # The dominant regime is the most common CONVECTIVE one where any exists,
    # because a quiescent majority should not hide an active corner of the
    # country -- which is exactly where a thunderstorm forecast matters.
    convective = {
        k: v for k, v in fractions.items()
        if k != ConvectiveRegime.QUIESCENT.value
    }
    if convective and max(convective.values()) >= 0.05:
        dominant = max(convective, key=convective.get)
    else:
        dominant = max(fractions, key=fractions.get)

    return RegimeDiagnosis(
        regime=ConvectiveRegime(dominant),
        fractions=fractions,
        ingredients=tuple(ingredients),
        missing=tuple(missing),
    )


def bulk_shear(
    wind_speed_10m: np.ndarray,
    wind_direction_10m: np.ndarray,
    wind_speed_500: np.ndarray,
    wind_direction_500: np.ndarray,
) -> np.ndarray:
    """Vector wind difference between 10 m and 500 hPa, in m/s.

    A proxy for 0-6 km bulk shear: 500 hPa is near 5.5 km in these airmasses.
    It is a proxy, not the real thing, and is labelled as such wherever it is
    surfaced -- the true quantity needs winds on many levels, which the
    current feeds do not provide.
    """
    def components(speed, direction):
        # Meteorological direction is where the wind comes FROM.
        radians = np.deg2rad(direction)
        return -speed * np.sin(radians), -speed * np.cos(radians)

    u_low, v_low = components(wind_speed_10m, wind_direction_10m)
    u_high, v_high = components(wind_speed_500, wind_direction_500)
    return np.hypot(u_high - u_low, v_high - v_low)


def lapse_rate_850_500(
    temperature_850: np.ndarray, temperature_500: np.ndarray
) -> np.ndarray:
    """Mid-level lapse rate in K/km.

    Uses a standard-atmosphere thickness of about 4.1 km between the 850 and
    500 hPa surfaces. That is an approximation; the exact thickness varies
    with the temperature of the layer itself.
    """
    THICKNESS_KM = 4.1
    return (temperature_850 - temperature_500) / THICKNESS_KM
