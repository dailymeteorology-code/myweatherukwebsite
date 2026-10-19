"""The TCM convective risk engine.

This is the product the platform exists to make: a thunderstorm forecast for
the UK and Ireland built from ingredients, not from one model's opinion.

Two distinctions run through the whole module and are deliberately visible in
the output rather than buried:

**An index is not a probability.** `thunderstorm_risk_index` combines
instability, an explicit convective signal, precipitation intensity and hail
into a 0-100 score. It is a ranking, not a calibrated likelihood, and it says
so until the training archive can calibrate it (see `app/training/`). Where a
genuine probability IS available -- the fraction of ensemble members
forecasting lightning -- it is reported separately and labelled as such.

**Missing ingredients are declared, not silently omitted.** A convective
forecast without convective inhibition cannot assess whether a cap will hold,
and one without deep-layer shear cannot assess storm organisation. Both are
currently absent from the Met Office orders, so every risk result carries
`missing_ingredients` and a `completeness` fraction. A risk index computed
from four ingredients out of seven is a weaker statement than one computed
from all seven, and the caller is told which it has.

Thresholds are UK and Ireland values throughout. 500 J/kg of mixed-layer CAPE
is a significant day on these islands; using US or continental scales here
would call almost every British summer day "negligible".
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np

from ..derived.ensemble import EnsembleSummary, Reliability
from ..grid import Field
from ..training.regime import ConvectiveRegime, RegimeDiagnosis, classify

log = logging.getLogger(__name__)


from .ingredients import BY_NAME, INGREDIENTS, Role, names as ingredient_names

# --- UK-scaled ingredient thresholds --------------------------------------
# Lower bound = the value below which the ingredient contributes nothing.
# Upper bound = the value at which it contributes fully. Between them the
# contribution ramps linearly.
#
# These are RE-EXPORTS of the ingredient table, never independent values.
# They were duplicated literals, and when the CAPE ramp was re-anchored from
# 1200 to 2000 J/kg the copy here silently disagreed with the spec the engine
# actually scores on.
CAPE_LOW = BY_NAME["cape_mixed_layer"].low
CAPE_FULL = BY_NAME["cape_mixed_layer"].high
PRECIP_RATE_LOW = BY_NAME["precip_rate_max_1h"].low * 3600.0   # mm/h
PRECIP_RATE_FULL = BY_NAME["precip_rate_max_1h"].high * 3600.0
HAIL_RATE_LOW = BY_NAME["hail_fall_rate_max_1h"].low
HAIL_RATE_FULL = BY_NAME["hail_fall_rate_max_1h"].high
#: Any non-zero forecast flash density is a convective signal; the upper bound
#: is deliberately low because the Met Office field's absolute scaling is
#: unconfirmed (see app/params.py). Only the RANKING is relied on here.
FLASH_LOW, FLASH_FULL = 1e-8, 1e-5

#: A member counts as "forecasting lightning" above this flash density.
FLASH_MEMBER_THRESHOLD = 1e-8

#: Index at or above which a cell counts as notably at risk. Shared with the
#: outlook so "area at risk" means the same thing everywhere.
AREA_THRESHOLD = 20.0


#: The CANONICAL TCM risk scale, taken from the existing platform's
#: `components/tcm/riskConfig.jsx`, which is the single source of truth shared
#: by the live outlook map, the archive renderers, the graphics studio and the
#: verification backend.
#:
#: Adopting it here is not cosmetic. That file's header records what happened
#: when two scales existed: every component reading the wrong one "banded
#: identical scores one level lower than the published outlook -- the archive
#: silently contradicted the live forecast, and verification statistics were
#: computed against bands the UI never showed." TCM V5 previously had a third,
#: coarser scale of its own, so a score of 25 was "low" here and "Marginal"
#: there. If a band is ever recalibrated it must change in BOTH places.
RISK_BANDS: tuple[tuple[str, int, str], ...] = (
    ("none", 0, "No Risk"),
    ("very_low", 5, "Very Low"),
    ("low", 12, "Low"),
    ("marginal", 22, "Marginal"),
    ("slight", 35, "Slight"),
    ("moderate", 50, "Moderate"),
    ("high", 65, "High"),
    ("severe", 80, "Severe"),
)


class RiskLevel(str, Enum):
    NONE = "none"
    VERY_LOW = "very_low"
    LOW = "low"
    MARGINAL = "marginal"
    SLIGHT = "slight"
    MODERATE = "moderate"
    HIGH = "high"
    SEVERE = "severe"

    @property
    def minimum_score(self) -> int:
        return dict((b[0], b[1]) for b in RISK_BANDS)[self.value]

    @property
    def display_name(self) -> str:
        """The band name the rest of the platform uses, e.g. "Marginal"."""
        return dict((b[0], b[2]) for b in RISK_BANDS)[self.value]

    @classmethod
    def from_index(cls, index: float) -> "RiskLevel":
        chosen = cls.NONE
        for key, minimum, _ in RISK_BANDS:
            if index >= minimum:
                chosen = cls(key)
        return chosen


#: How much of the potential a fully capped parcel loses. Not 1.0: a cap can
#: be broken by strong forcing, and a model's CIN is a point value that says
#: nothing about the convergence line running through the cell.
CAP_SUPPRESSION = 0.7

#: What convective potential alone contributes before any intensity signal.
#: See the index formula for why it is not 0.45.
POTENTIAL_FLOOR = 0.25


def ramp(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """Linear 0..1 ramp between two thresholds, NaN-safe."""
    with np.errstate(invalid="ignore"):
        scaled = (values - low) / (high - low)
    return np.clip(np.nan_to_num(scaled, nan=0.0), 0.0, 1.0)


@dataclass(slots=True)
class Ingredient:
    """One physical input to the risk calculation."""

    name: str
    description: str
    available: bool
    values: np.ndarray | None = None
    source_model: str = ""
    #: Why it matters, and what its absence costs.
    role: str = ""

    def score(self, low: float, high: float) -> np.ndarray | None:
        if not self.available or self.values is None:
            return None
        return ramp(self.values, low, high)


@dataclass(slots=True)
class ConvectiveRisk:
    """The TCM convective forecast for one lead time."""

    forecast_hour: int
    valid_time: datetime
    regime: RegimeDiagnosis

    #: 0-100 ranking index. NOT a calibrated probability.
    thunderstorm_risk_index: np.ndarray
    #: Genuine ensemble probability, or None when no ensemble is available.
    lightning_probability: np.ndarray | None
    hail_index: np.ndarray | None
    heavy_rain_index: np.ndarray | None

    ingredients: list[Ingredient]
    missing_ingredients: list[str]
    ensemble_members: int
    ensemble_reliability: Reliability | None

    def _headline_values(self) -> "np.ndarray":
        """The cells the SUMMARY describes: land, when a land mask exists.

        The full field is still rendered -- convection over the sea is real
        and moves ashore -- but it must not set the headline for a UK and
        Ireland forecast. On the 2026-08-29 12Z cycle the domain maximum at
        03:00Z sat at 56.37N 2.81E, in the middle of the North Sea, and
        reported "severe" while the model forecast flashes over 0.11% of
        land. The peak, the level and the coverage are land statistics; the
        map is not.
        """
        values = self.thunderstorm_risk_index
        from .regions import forecast_area

        area = forecast_area()
        if area is not None and area.shape == values.shape:
            values = values[area]
        return values[np.isfinite(values)]

    @property
    def headline_is_land_only(self) -> bool:
        from .regions import forecast_area

        area = forecast_area()
        return (
            area is not None
            and area.shape == self.thunderstorm_risk_index.shape
        )

    @property
    def completeness(self) -> float:
        available = sum(1 for i in self.ingredients if i.available)
        return available / len(self.ingredients) if self.ingredients else 0.0

    @property
    def peak_index(self) -> float:
        finite = self._headline_values()
        return float(finite.max()) if finite.size else 0.0

    @property
    def level(self) -> RiskLevel:
        return RiskLevel.from_index(self.peak_index)

    @property
    def area_fraction(self) -> float:
        """Fraction of the LAND area above the notable-risk threshold."""
        finite = self._headline_values()
        if finite.size == 0:
            return 0.0
        return float((finite >= AREA_THRESHOLD).mean())

    @property
    def severity(self) -> float:
        """How big the event is, combining magnitude AND coverage.

        `peak_index` alone is the wrong thing to rank lead times or regions
        by, because the index SATURATES. The CAPE ramp caps at CAPE_FULL, so
        on any hour with 1200 J/kg somewhere the potential term is 1.0; if no
        precipitation field is available the intensity term is 0, and every
        such hour computes exactly 50.0. Observed live: all thirteen lead
        times in a cycle tied at 50.0, so "the peak" was simply whichever hour
        came first in the list -- which put the headline on 0600Z when the
        convection was an afternoon event.

        Severity does not saturate: it multiplies the mean intensity of the
        at-risk cells by their coverage, so a day with a quarter of the
        country active outranks one with a single hot cell.
        """
        finite = self._headline_values()
        if finite.size == 0:
            return 0.0
        active = finite[finite >= AREA_THRESHOLD]
        if active.size == 0:
            # Nothing notable: fall back to magnitude so quiet hours still
            # order sensibly among themselves.
            return float(finite.max()) / 1000.0
        coverage = active.size / finite.size
        return float(active.mean() * coverage)

    def probability_resolution(self) -> str | None:
        """The granularity an N-member ensemble can express."""
        if not self.ensemble_members:
            return None
        step = 100.0 / self.ensemble_members
        return (
            f"{step:.0f}% steps: with {self.ensemble_members} members the "
            f"probability can only take the values "
            + ", ".join(
                f"{i * step:.0f}%" for i in range(self.ensemble_members + 1)
            )
        )

    def to_dict(self) -> dict:
        def stats(a):
            if a is None:
                return None
            finite = a[np.isfinite(a)]
            if finite.size == 0:
                return None
            return {
                "max": float(finite.max()),
                "mean": float(finite.mean()),
                "area_fraction_above_20": float((finite > 20).mean()),
            }

        return {
            "forecast_hour": self.forecast_hour,
            "valid_time": self.valid_time.isoformat(),
            "regime": self.regime.to_dict(),
            "thunderstorm_risk_index": stats(self.thunderstorm_risk_index),
            "peak_index": round(self.peak_index, 1),
            "severity": round(self.severity, 2),
            "area_fraction": round(self.area_fraction, 4),
            "headline_area": (
                "UK and Ireland land only" if self.headline_is_land_only
                else "whole domain (no land mask built)"
            ),
            "level": self.level.value,
            "hail_index": stats(self.hail_index),
            "heavy_rain_index": stats(self.heavy_rain_index),
            "lightning_probability": (
                None if self.lightning_probability is None else {
                    "max_percent": round(
                        float(np.nanmax(self.lightning_probability) * 100), 1
                    ),
                    "members": self.ensemble_members,
                    "resolution": self.probability_resolution(),
                    "reliability": (
                        self.ensemble_reliability.value
                        if self.ensemble_reliability else None
                    ),
                }
            ),
            "ingredients": [
                {
                    "name": i.name, "available": i.available,
                    "source": i.source_model, "role": i.role,
                }
                for i in self.ingredients
            ],
            "missing_ingredients": self.missing_ingredients,
            "completeness": round(self.completeness, 2),
            "index_is_calibrated": False,
            "note": (
                "thunderstorm_risk_index is a 0-100 ranking built from the "
                "ingredients listed, NOT a calibrated probability. Where a "
                "true probability exists it is reported separately as "
                "lightning_probability, which is the fraction of ensemble "
                "members forecasting lightning."
            ),
        }


# --- ingredient assembly --------------------------------------------------



#: Kept for the audit payload: what each ingredient is for.
INGREDIENT_ROLES = {i.name: i.why for i in INGREDIENTS}


def build_ingredients(fields: dict[str, "Field | None"]) -> list[Ingredient]:
    """Wrap available fields as ingredients, declaring what is absent."""
    out = []
    for spec in INGREDIENTS:
        field = fields.get(spec.name)
        out.append(Ingredient(
            name=spec.name,
            description=spec.why,
            available=field is not None,
            values=None if field is None else field.values,
            source_model="" if field is None else field.meta.model,
            role=spec.why,
        ))
    return out


#: The Met Office CIN fields use -1000 as "no value", not as a 1000 J/kg cap.
#: Verified on the 2026-08-29 12Z cycle: real CIN never goes below -214, and
#: EVERY cell at -1000 has CAPE of exactly 0 -- there is no parcel, so there
#: is no inhibition to report. Scored literally it reads as a total cap.
#: Harmless while it only ever coincides with zero CAPE, but it must not be
#: left to chance, and it corrupts any statistic taken over the field.
CIN_SENTINEL = -999.0


def _ramp_spec(values, spec) -> "np.ndarray":
    """Score one ingredient 0..1 using its own thresholds and direction."""
    if spec.role is Role.INHIBITION:
        values = np.where(values <= CIN_SENTINEL, np.nan, values)
    if spec.inverted:
        # low..high runs downwards, e.g. CIN -25 -> -150 or cloud 95% -> 40%.
        return ramp(-values, -spec.low, -spec.high)
    return ramp(values, spec.low, spec.high)


#: How each role combines the evidence it has. This is the difference
#: between asking "do all my indicators agree?" and asking the question the
#: role actually poses.
#:
#: POTENTIAL  -> MAX. The role establishes whether convection is possible at
#:               all, and any ONE sufficient signal establishes it. Averaging
#:               was badly wrong here: with a CAPE family at weight 1.0 and
#:               lightning at 1.4, a cell with 1200 J/kg and no forecast
#:               flashes scored (1.0*1.0 + 0*1.4)/2.4 = 0.42 -- a 58% cut for
#:               the absence of a second, rarer signal. Every ordinary
#:               thundery day was being suppressed by the lightning field
#:               being zero over most of the grid.
#: INHIBITION -> MIN. The cap that matters is the weakest one: convection
#:               goes if ANY parcel can rise, so the least-inhibited parcel
#:               governs. A mean let a firmly capped surface veto an
#:               uncapped elevated parcel.
#: INTENSITY  -> MAX. "How bad if it happens" is set by the worst indicator.
#:               Averaging let a day with no hail drag down a day with
#:               torrential rain, purely because hail is zero on most days.
#: MODIFIER   -> weighted MEAN. Modifiers genuinely blend: shear, moisture
#:               and lapse rate each sharpen the picture and none alone
#:               establishes anything.
#: Combining rules, applied ACROSS distinct evidence within a role.
#: "or" is the noisy-OR 1 - prod(1 - x): it never decreases when another
#: indicator is added (so an absent signal cannot subtract), and it does
#: increase when two indicators corroborate (which a plain maximum will not).
#: A plain maximum said hail on top of torrential rain made a storm no worse.
_ROLE_COMBINE = {
    Role.POTENTIAL: "or",
    Role.INHIBITION: "min",
    Role.INTENSITY: "or",
    Role.MODIFIER: "mean",
}

#: Within a FAMILY the rule is different, because a family is one question
#: asked several ways rather than several pieces of evidence. Three CAPE
#: parcels each at 0.5 must not noisy-OR to 0.875; the answer is the best
#: parcel, 0.5.
_FAMILY_COMBINE = {
    Role.POTENTIAL: "max",
    Role.INHIBITION: "min",
    Role.INTENSITY: "max",
    Role.MODIFIER: "mean",
}


def _combine(stack: "np.ndarray", how: str) -> "np.ndarray":
    if how == "max":
        return np.nanmax(stack, axis=0)
    if how == "min":
        return np.nanmin(stack, axis=0)
    if how == "or":
        return 1.0 - np.prod(1.0 - np.clip(stack, 0.0, 1.0), axis=0)
    return np.nanmean(stack, axis=0)


def _daylight_for(valid_time: datetime, shape) -> "np.ndarray | None":
    """Daylight weighting for the grid, or None if it cannot be built."""
    from .solar import daylight_weight

    try:
        weight = daylight_weight(valid_time)
    except Exception:            # a synthetic grid in a test, say
        return None
    return weight if weight.shape == shape else None


def _parcel_potential(
    arrays: dict[str, "np.ndarray"], used: list[str]
) -> "np.ndarray | None":
    """Instability gated by the cap ON THE SAME PARCEL, best parcel wins.

    CAPE and CIN only mean anything as a pair, for one parcel. Scoring them
    as two independent roles produced both failure modes at once:

      * combining the CIN parcels by "least capped" made most-unstable CIN
        (mean -34 J/kg) the cap applied to every parcel, which removed
        essentially all inhibition and left no hour below "moderate";
      * combining them by mean let a firmly capped surface (-95 J/kg) veto
        an uncapped elevated parcel, suppressing exactly the overnight
        convection the most-unstable parcel exists to find.

    So each parcel is gated by its own cap, and the parcel most likely to go
    wins. A parcel with no CIN field is left ungated rather than assumed
    uncapped or assumed capped.
    """
    by_parcel: dict[str, dict[Role, tuple]] = {}
    for spec in INGREDIENTS:
        if not spec.parcel or spec.name not in arrays:
            continue
        by_parcel.setdefault(spec.parcel, {})[spec.role] = (
            spec, _ramp_spec(arrays[spec.name], spec)
        )

    gated, weights = [], []
    for parts in by_parcel.values():
        if Role.POTENTIAL not in parts:
            continue
        cape_spec, cape = parts[Role.POTENTIAL]
        used.append(cape_spec.name)
        value = cape
        if Role.INHIBITION in parts:
            cin_spec, cin = parts[Role.INHIBITION]
            used.append(cin_spec.name)
            value = value * (1.0 - CAP_SUPPRESSION * cin)
        gated.append(value)
        weights.append(cape_spec.weight)

    if not gated:
        return None
    top = max(weights)
    return np.nanmax(
        np.stack([g * (w / top) for g, w in zip(gated, weights)]), axis=0
    )


def _merge_potential(parcel, other):
    """Instability and an explicit flash forecast are separate evidence."""
    parts = [p for p in (parcel, other) if p is not None]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return _combine(np.stack(parts), "or")


def _role_score(
    role: Role, arrays: dict[str, "np.ndarray"], used: list[str],
    skip_parcels: bool = False, daylight: "np.ndarray | None" = None,
) -> "np.ndarray | None":
    """Combine the ingredients present for one role.

    Ingredients sharing a `family` are alternative measures of one question
    (the three CAPE parcels, the three CIN parcels) and are collapsed first
    by the role's rule, so having three CAPE fields rather than one does not
    by itself change instability's influence.

    Under MAX and MIN the weights act as CEILINGS rather than proportions:
    each ingredient is scaled by its weight relative to the strongest in the
    role, so the best-evidenced signal can reach 1.0 and a weaker proxy
    tops out below it. That keeps "an explicit flash forecast is stronger
    evidence than an instability proxy" true without letting the proxy's
    absence subtract from the signal that IS present.
    """
    members: list[tuple] = []
    families: dict[str, list] = {}

    for spec in INGREDIENTS:
        if spec.role is not role or spec.name not in arrays:
            continue
        if skip_parcels and spec.parcel:
            continue          # handled by _parcel_potential
        ramped = _ramp_spec(arrays[spec.name], spec)
        used.append(spec.name)
        if spec.family:
            families.setdefault(spec.family, []).append((spec, ramped))
        else:
            members.append((spec, ramped))

    how = _ROLE_COMBINE.get(role, "mean")
    within = _FAMILY_COMBINE.get(role, "mean")

    for group in families.values():
        value = _combine(np.stack([r for _, r in group]), within)
        # The family speaks with its strongest member's weight.
        members.append((max(group, key=lambda m: m[0].weight)[0], value))

    if not members:
        return None

    if how == "mean":
        # Weights can vary per CELL: a daylight-only ingredient carries its
        # full weight in sunshine and none at night, so after dark it drops
        # out of the average and the rest renormalise around it.
        weighted, total = None, None
        for spec, value in members:
            w = np.full_like(value, spec.weight, dtype="float32")
            if spec.daylight_only and daylight is not None:
                w = w * daylight
            weighted = value * w if weighted is None else weighted + value * w
            total = w if total is None else total + w
        with np.errstate(invalid="ignore", divide="ignore"):
            out = np.where(total > 0, weighted / np.where(total > 0, total, 1.0), 0.0)
        return out

    top = max(spec.weight for spec, _ in members)
    scaled = np.stack([value * (spec.weight / top) for spec, value in members])
    return _combine(scaled, how)


def assess(
    fields: dict[str, Field | None],
    forecast_hour: int,
    valid_time: datetime,
    lightning_members: list[Field] | None = None,
    ensemble: EnsembleSummary | None = None,
) -> ConvectiveRisk:
    """Compute the TCM convective risk from whatever ingredients exist.

    The index is a weighted combination of the ingredient scores that are
    actually present, renormalised by the weight available. That means a
    forecast missing shear and CIN produces a defensible index from what it
    has, rather than either refusing to answer or silently pretending the
    missing ingredients were neutral.
    """
    ingredients = build_ingredients(fields)
    by_name = {i.name: i for i in ingredients}
    missing = [i.name for i in ingredients if not i.available]

    arrays = {
        name: item.values for name, item in by_name.items()
        if item.available and item.values is not None
    }
    if not arrays:
        raise ValueError("no ingredients available; cannot assess risk")

    used: list[str] = []
    # Parcel-paired instability, then any OTHER potential evidence (the
    # explicit lightning forecast), which is independent of the parcels.
    parcel_potential = _parcel_potential(arrays, used)
    other_potential = _role_score(
        Role.POTENTIAL, arrays, used, skip_parcels=True
    )
    potential = _merge_potential(parcel_potential, other_potential)
    inhibition = _role_score(Role.INHIBITION, arrays, [])
    intensity = _role_score(Role.INTENSITY, arrays, used)
    daylight = _daylight_for(valid_time, next(iter(arrays.values())).shape)
    modifier = _role_score(Role.MODIFIER, arrays, used, daylight=daylight)

    if potential is None:
        raise ValueError(
            "convective risk needs at least one POTENTIAL ingredient "
            "(instability or a forecast lightning signal); none is available"
        )

    # --- the convective gate ----------------------------------------------
    #
    # Heavy rain is not a thunderstorm. Intensity and modifiers SCALE
    # convective potential; they never create it. Where nothing says
    # convection is possible the index is near zero however hard it rains.
    #
    # Inhibition is the one term that can SUPPRESS: a strong cap holds
    # convection down whatever the instability, which is exactly what the
    # engine could not represent while CIN was missing from the orders.
    # Inhibition has ALREADY been applied, per parcel, inside
    # _parcel_potential. Applying the role score again here would cap the
    # same air twice.
    score = potential

    shape_terms = [t for t in (intensity, modifier) if t is not None]
    if shape_terms:
        shaping = sum(shape_terms) / len(shape_terms)
    else:
        shaping = np.zeros_like(score)

    # The floor is what convective POTENTIAL alone is worth when nothing is
    # yet happening. At 0.45 an unstable cell reached "moderate" with no
    # rain, no hail and no forecast flash, which is what let a whole quiet
    # airmass read as an outbreak. At 0.25 instability alone tops out in
    # "slight" and the intensity signals decide the rest.
    index = score * (POTENTIAL_FLOOR
                     + (1.0 - POTENTIAL_FLOOR) * shaping) * 100.0
    index = np.clip(index, 0.0, 100.0).astype("float32")

    hail = (
        _ramp_spec(arrays["hail_fall_rate_max_1h"],
                   BY_NAME["hail_fall_rate_max_1h"])
        if "hail_fall_rate_max_1h" in arrays else None
    )
    precip_key = next(
        (k for k in ("precip_rate_max_1h", "precip_accum_1h", "precip_rate")
         if k in arrays), None
    )
    precip = (
        _ramp_spec(arrays[precip_key], BY_NAME[precip_key])
        if precip_key else None
    )

    # --- genuine ensemble probability -------------------------------------
    lightning_probability = None
    n_members = 0
    reliability = None
    if lightning_members:
        stack = np.stack([f.values for f in lightning_members])
        n_members = stack.shape[0]
        with np.errstate(invalid="ignore"):
            lightning_probability = np.nanmean(
                (stack > FLASH_MEMBER_THRESHOLD).astype("float32"), axis=0
            )
        reliability = Reliability.for_members(n_members)
    elif ensemble is not None:
        n_members = ensemble.n_members
        reliability = ensemble.reliability

    # --- regime -----------------------------------------------------------
    cape_values = arrays.get("cape_mixed_layer")
    if cape_values is None:
        cape_values = arrays.get("cape_surface")
    shear_values = arrays.get("shear_bulk_0_6km")
    freezing = arrays.get("freezing_level_height")
    regime = classify(cape_values, shear=shear_values, freezing_level=freezing)

    return ConvectiveRisk(
        forecast_hour=forecast_hour,
        valid_time=valid_time,
        regime=regime,
        thunderstorm_risk_index=index,
        lightning_probability=lightning_probability,
        hail_index=None if hail is None else (hail * 100).astype("float32"),
        heavy_rain_index=(
            None if precip is None else (precip * 100).astype("float32")
        ),
        ingredients=ingredients,
        missing_ingredients=missing,
        ensemble_members=n_members,
        ensemble_reliability=reliability,
    )
