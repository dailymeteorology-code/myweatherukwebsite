"""Per-hazard risk fields: hail, damaging wind, supercell, tornado.

The thunderstorm index answers "will there be a storm". These answer "what
kind", which is a different question with different ingredients, and they are
kept separate for that reason: a day can be near-certain for storms and still
carry no hail risk at all.

Each hazard declares exactly what it needs. Where an ingredient is missing the
hazard reports itself UNAVAILABLE, with the reason and the fix, rather than
scoring on whatever happens to be present. That matters more here than
anywhere else in the platform, because two of these four hazards are defined
by wind shear:

  * A **supercell** is a storm with a rotating updraught, and rotation comes
    from deep-layer shear. Without shear there is no supercell diagnosis --
    only an instability field wearing the word "supercell", which would be
    worse than showing nothing.
  * A **tornado** additionally needs low-level shear and a low cloud base.
    The cloud base is computable here; the shear is not.

Neither can be honestly produced from the current orders, so neither is. Both
say what to add to the DataHub order to switch them on: 500 hPa wind speed
and direction, which is a single change in the portal.

Hail and damaging wind ARE supportable, and both are built primarily on the
model's own explicit fields rather than on proxies.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from typing import Callable

import numpy as np

from .risk import ramp

#: 500 hPa winds would enable the two shear-dependent hazards. Named once so
#: the message is identical everywhere it appears.
SHEAR_FIX = (
    "add 500 hPa wind speed and direction to the UKV order in the DataHub "
    "portal; the platform derives bulk shear from them automatically"
)


@dataclass(slots=True)
class HazardResult:
    """One hazard's field, or the reason there isn't one."""

    name: str
    label: str
    values: np.ndarray | None
    available: bool
    reason: str = ""
    used: list[str] = dc_field(default_factory=list)
    missing: list[str] = dc_field(default_factory=list)
    caveat: str = ""

    @property
    def peak(self) -> float:
        if self.values is None:
            return 0.0
        finite = self.values[np.isfinite(self.values)]
        return float(finite.max()) if finite.size else 0.0

    def to_dict(self) -> dict:
        return {
            "hazard": self.name,
            "label": self.label,
            "available": self.available,
            "reason": self.reason,
            "peak": round(self.peak, 1),
            "ingredients_used": self.used,
            "ingredients_missing": self.missing,
            "caveat": self.caveat,
            "index_is_calibrated": False,
        }


def _get(fields: dict, name: str) -> np.ndarray | None:
    item = fields.get(name)
    return None if item is None else item.values


def _first(fields: dict, *names: str) -> tuple[np.ndarray | None, str | None]:
    """The first of these fields that exists, with the name it came from.

    NOT `a or b`: an ndarray has no truth value, and writing the fallback
    that way raises "the truth value of an array is ambiguous" as soon as the
    first field is present.
    """
    for name in names:
        values = _get(fields, name)
        if values is not None:
            return values, name
    return None, None


def _unavailable(name, label, reason, missing, caveat="") -> HazardResult:
    return HazardResult(
        name=name, label=label, values=None, available=False,
        reason=reason, missing=list(missing), caveat=caveat,
    )


# --- hail -----------------------------------------------------------------

def hail(fields: dict) -> HazardResult:
    """Hail reaching the ground.

    Built on the model's OWN hail field where there is one -- UKV forecasts a
    hail fall rate and MOGREPS-UK an hourly hail accumulation -- rather than
    on a proxy. Instability and the freezing level then modulate it: a low
    freezing level lets hail survive the fall, and deep instability is what
    grows it in the first place.
    """
    rate, rate_name = _first(
        fields, "hail_fall_rate_max_1h", "hail_fall_rate"
    )
    accum = _get(fields, "hail_accum_1h")
    if rate is None and accum is None:
        return _unavailable(
            "hail", "Hail risk",
            "no hail field in any current order",
            ["hail_fall_rate_max_1h", "hail_accum_1h"],
        )

    used, parts = [], []
    if rate is not None:
        used.append(rate_name)
        parts.append(ramp(rate, 1e-6, 1e-3))
    if accum is not None:
        used.append("hail_accum_1h")
        parts.append(ramp(accum, 1e-4, 1e-1))
    # Either field alone establishes hail; they are the same statement from
    # two models, so the stronger one wins rather than being averaged down.
    produced = np.nanmax(np.stack(parts), axis=0)

    missing = []
    modifiers = []

    cape, cape_name = _first(fields, "cape_most_unstable", "cape_mixed_layer")
    if cape is not None:
        used.append(cape_name)
        modifiers.append(ramp(cape, 300.0, 2000.0))
    else:
        missing.append("cape_most_unstable")

    freezing = _get(fields, "freezing_level_height")
    if freezing is not None:
        used.append("freezing_level_height")
        # Inverted: a LOW freezing level means less melting on the way down.
        modifiers.append(ramp(-freezing, -3600.0, -2200.0))
    else:
        missing.append("freezing_level_height")

    shape = np.mean(np.stack(modifiers), axis=0) if modifiers else None
    index = produced * (0.55 + 0.45 * shape) if shape is not None else produced

    return HazardResult(
        name="hail", label="Hail risk",
        values=np.clip(index * 100.0, 0, 100).astype("float32"),
        available=True, used=used, missing=missing,
        caveat=(
            "Scaled from the model's own hail field, whose absolute units the "
            "Met Office does not document. Read it as a ranking, not as a "
            "stone size or a depth."
        ),
    )


# --- damaging convective wind ---------------------------------------------

def strong_wind(fields: dict) -> HazardResult:
    """Damaging gusts from convective downdraughts.

    NOT the same as a windy day. The synoptic wind field is already available
    on its own; this is about the gust a storm produces when rain-cooled air
    descends, so it is built from the three things that drive a downdraught:

      * heavy precipitation, which is the mass that comes down;
      * a DRY sub-cloud layer, because evaporating rain into dry air is what
        cools and accelerates it -- the 2 m dewpoint depression is a direct
        measure of this and is the ingredient a plain wind field lacks;
      * instability, which sets how vigorous the circulation is.

    The ambient 10 m wind is added last and weakly: it contributes to the
    gust a storm delivers, but a gale with no convection is not this hazard.
    """
    rain, rain_name = _first(fields, "precip_rate_max_1h", "precip_rate")
    if rain is None:
        return _unavailable(
            "strong_wind", "Strong wind risk",
            "no precipitation rate in any current order",
            ["precip_rate_max_1h", "precip_rate"],
            caveat="A downdraught needs falling precipitation to drive it.",
        )

    used = [rain_name]
    missing: list[str] = []
    downdraught = [ramp(rain, 0.00055, 0.0055)]

    temp = _get(fields, "temperature_2m")
    dew = _get(fields, "dewpoint_2m")
    if temp is not None and dew is not None:
        used += ["temperature_2m", "dewpoint_2m"]
        # Dewpoint depression: how much evaporative cooling is available.
        # 2 K is saturated and useless; 12 K is a strongly mixed dry boundary
        # layer of the kind that produces UK downbursts.
        downdraught.append(ramp(temp - dew, 2.0, 12.0))
    else:
        missing += [n for n, v in
                    (("temperature_2m", temp), ("dewpoint_2m", dew)) if v is None]

    cape, cape_name = _first(fields, "cape_most_unstable", "cape_mixed_layer")
    if cape is not None:
        used.append(cape_name)
        downdraught.append(ramp(cape, 200.0, 1800.0))
    else:
        missing.append("cape_most_unstable")

    # Every term must be present for a gust: no rain, no dry air or no
    # instability each individually rules it out. A product, not a mean.
    index = np.prod(np.stack(downdraught), axis=0)

    ambient = _get(fields, "wind_speed_10m")
    if ambient is not None:
        used.append("wind_speed_10m")
        index = index * (0.75 + 0.25 * ramp(ambient, 4.0, 18.0))
    else:
        missing.append("wind_speed_10m")

    return HazardResult(
        name="strong_wind", label="Strong wind risk",
        values=np.clip(index * 100.0, 0, 100).astype("float32"),
        available=True, used=used, missing=missing,
        caveat=(
            "Convective gusts only. This is not the synoptic wind field, and "
            "it says nothing about gales in a deep low. Downdraught strength "
            "is inferred from surface moisture rather than from a sounding, "
            "so it is a ranking and not a gust speed."
        ),
    )


# --- supercell ------------------------------------------------------------

def supercell(fields: dict) -> HazardResult:
    """Rotating storms. Needs deep-layer shear, which no order supplies."""
    shear = _get(fields, "shear_bulk_0_6km")
    cape, cape_name = _first(fields, "cape_most_unstable", "cape_mixed_layer")

    if shear is None:
        return _unavailable(
            "supercell", "Supercell risk",
            "needs deep-layer wind shear, which no current order supplies. "
            "To enable: " + SHEAR_FIX,
            ["shear_bulk_0_6km"],
            caveat=(
                "A supercell is defined by a rotating updraught, and rotation "
                "comes from shear. Scoring this on instability alone would "
                "label ordinary showers as supercells."
            ),
        )
    if cape is None:
        return _unavailable(
            "supercell", "Supercell risk",
            "no instability field available", ["cape_most_unstable"],
        )

    # Shear AND instability, multiplied: either one alone produces no
    # supercell, which an average would not express.
    index = ramp(cape, 300.0, 2000.0) * ramp(shear, 10.0, 25.0)
    return HazardResult(
        name="supercell", label="Supercell risk",
        values=np.clip(index * 100.0, 0, 100).astype("float32"),
        available=True,
        used=["cape_most_unstable", "shear_bulk_0_6km"],
        caveat=(
            "Bulk shear here is a PROXY computed between 10 m and 500 hPa, "
            "not a hodograph. It separates sheared from unsheared regimes; it "
            "does not resolve storm-relative helicity."
        ),
    )


# --- tornado --------------------------------------------------------------

def lifted_condensation_level(temp_k: np.ndarray, dew_k: np.ndarray) -> np.ndarray:
    """Approximate cloud-base height in metres above ground.

    Espy's rule: roughly 125 m of ascent per kelvin of dewpoint depression.
    Crude, but it is a real, computable ingredient -- and a low cloud base is
    one of the few tornado ingredients the current orders actually support.
    """
    return np.clip(125.0 * (temp_k - dew_k), 0.0, 6000.0)


def tornado(fields: dict) -> HazardResult:
    """Tornadoes. Needs low-level shear, which no order supplies.

    A cloud base low enough to matter IS computable from screen temperature
    and dewpoint, and is reported as an available ingredient so the gap is
    precisely one field rather than a vague absence.
    """
    shear = _get(fields, "shear_bulk_0_6km")
    temp = _get(fields, "temperature_2m")
    dew = _get(fields, "dewpoint_2m")
    cape, cape_name = _first(fields, "cape_most_unstable", "cape_mixed_layer")

    have = [n for n, v in (("temperature_2m", temp), ("dewpoint_2m", dew),
                           ("cape_most_unstable", cape)) if v is not None]

    if shear is None:
        return _unavailable(
            "tornado", "Tornado risk",
            "needs low-level wind shear, which no current order supplies. "
            "To enable: " + SHEAR_FIX,
            ["shear_bulk_0_6km"],
            caveat=(
                "Cloud base is computable from screen temperature and dewpoint "
                "and is already available; shear is the only missing piece. "
                "UK tornadoes are mostly non-supercell, forming on convergence "
                "lines, so even with shear this would remain a low-confidence "
                "hazard that a 2 km model cannot resolve directly."
            ),
        )
    if not all(v is not None for v in (temp, dew, cape)):
        return _unavailable(
            "tornado", "Tornado risk", "missing surface fields",
            [n for n in ("temperature_2m", "dewpoint_2m", "cape_most_unstable")
             if n not in have],
        )

    lcl = lifted_condensation_level(temp, dew)
    index = (
        ramp(cape, 200.0, 1500.0)
        * ramp(shear, 10.0, 22.0)
        * ramp(-lcl, -1500.0, -700.0)      # inverted: a LOWER base is worse
    )
    return HazardResult(
        name="tornado", label="Tornado risk",
        values=np.clip(index * 100.0, 0, 100).astype("float32"),
        available=True,
        used=["cape_most_unstable", "shear_bulk_0_6km",
              "temperature_2m", "dewpoint_2m"],
        caveat=(
            "Low confidence by nature. UK tornadoes are usually non-supercell "
            "and form on convergence lines a 2 km model does not resolve; this "
            "shows where the environment would support one, not where one will "
            "occur."
        ),
    )


#: Every hazard, in the order the UI lists them.
HAZARDS: dict[str, Callable[[dict], HazardResult]] = {
    "hail": hail,
    "strong_wind": strong_wind,
    "supercell": supercell,
    "tornado": tornado,
}


def assess(name: str, fields: dict) -> HazardResult:
    if name not in HAZARDS:
        raise KeyError(
            f"unknown hazard {name!r}; expected one of {', '.join(HAZARDS)}"
        )
    return HAZARDS[name](fields)
