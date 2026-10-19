"""Hazard probabilities, conditional on the thunderstorm event.

    P(hazard) = P(thunderstorm) x P(hazard | thunderstorm)

Section 24. The conditional comes from the Stage 5 hazard engines, which
already compute it from their own ingredients rather than by rescaling the
storm probability.

THE ONE-WAY RULE
----------------
Sections 25 and 32: a hazard may never raise P(thunderstorm). An
environment can be exceptionally favourable for large hail without making
convection itself one bit more likely, and a system that lets hail evidence
feed back into storm occurrence will forecast storms because it forecast
hail.

This is enforced structurally rather than by discipline. `stages.py` raises
if a hazard engine reaches either thunderstorm stage, and this module only
ever READS the aggregated storm probability. Section 72's ablation test --
remove the hail engine and check the thunderstorm probability is unchanged
-- is therefore a test of something that cannot fail by construction, which
is the point.

NESTING IS DOCUMENTED, NOT ASSUMED
-----------------------------------
Section 55. `event.py` states each hazard's relationship explicitly, and two
are not what a naive hierarchy would give: downburst is NOT a subset of
severe wind, and the tornado output is an environment rather than an
occurrence. Only the relationships the definitions actually require are
enforced.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

import numpy as np

from . import event as ev
from .aggregate import Aggregation
from .probability import CalibrationStatus
from .stages import SourceForecast

log = logging.getLogger(__name__)


@dataclass(slots=True)
class HazardProbability:
    """One hazard's forecast, with its conditional kept visible."""

    name: str
    #: P(hazard) = P(thunderstorm) x conditional. None when unavailable --
    #: never 0.0 to mean "could not compute".
    probability: float | None
    #: P(hazard | thunderstorm), from the Stage 5 engine. Reported
    #: separately because a low unconditional probability with a high
    #: conditional is a real and dangerous state: few storms expected, but
    #: any that form would be severe.
    conditional: float | None
    #: How many sources contributed a conditional.
    n_sources: int = 0
    #: Spread of the conditional across sources.
    spread: float | None = None
    calibration: CalibrationStatus = CalibrationStatus.UNCALIBRATED
    definition: str = ""
    caveat: str = ""
    reason: str = ""
    flags: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.probability is not None

    def to_dict(self) -> dict:
        return {
            "hazard": self.name,
            "probability": (
                round(self.probability, 5) if self.probability is not None
                else None
            ),
            "conditional_on_thunderstorm": (
                round(self.conditional, 5) if self.conditional is not None
                else None
            ),
            "n_sources": self.n_sources,
            "conditional_spread": (
                round(self.spread, 5) if self.spread is not None else None
            ),
            "calibration": self.calibration.value,
            "definition": self.definition,
            "caveat": self.caveat or None,
            "reason": self.reason,
            "flags": list(self.flags),
        }


def compute(
    forecasts: list[SourceForecast],
    aggregation: Aggregation,
    *, weights: dict[str, float] | None = None,
) -> dict[str, HazardProbability]:
    """Every hazard probability, conditional on the thunderstorm event.

    Conditionals are aggregated across sources with the SAME Stage 6
    weights the thunderstorm probability used, so a model trusted for the
    storm is trusted for its hazards -- rather than a second, unexplained
    weighting appearing here.
    """
    storm = aggregation.probability
    weights = weights or aggregation.applied_weights

    by_model: dict[str, list[SourceForecast]] = {}
    for forecast in forecasts:
        by_model.setdefault(forecast.model, []).append(forecast)

    out: dict[str, HazardProbability] = {}
    for name, definition in ev.HAZARDS.items():
        # severe_hail shares the hail engine but has its OWN conditional,
        # computed from a different ingredient list. Reading the plain hail
        # conditional for it here would make the two identical and then let
        # the nesting check silently clamp the difference away.
        if name == "severe_hail":
            continue
        conditionals: list[float] = []
        applied: list[float] = []
        for model, group in by_model.items():
            values = [
                f.hazard_conditionals[definition.engine]
                for f in group
                if definition.engine in f.hazard_conditionals
            ]
            if not values:
                continue
            conditionals.append(float(np.mean(values)))
            applied.append(float(weights.get(model, 0.0)))

        if not conditionals:
            out[name] = HazardProbability(
                name=name, probability=None, conditional=None,
                definition=definition.definition,
                caveat=definition.caveat,
                reason=(
                    f"the {definition.engine} engine produced no conditional "
                    f"for any source. This is an absence of evidence, not a "
                    f"forecast of no hazard"
                ),
            )
            continue

        array = np.array(conditionals, dtype="float64")
        weight_array = np.array(applied, dtype="float64")
        if weight_array.sum() <= 0:
            weight_array = np.ones_like(array)
        weight_array = weight_array / weight_array.sum()
        conditional = float(np.sum(weight_array * array))

        flags: list[str] = []
        probability = None
        reason = ""
        if storm is None:
            reason = (
                "no thunderstorm probability, so an unconditional hazard "
                "probability cannot be formed. The conditional stands on "
                "its own and is reported"
            )
            flags.append(
                "conditional only: this is P(hazard | thunderstorm), not "
                "P(hazard)"
            )
        else:
            probability = storm * conditional

        if storm is not None and storm < 0.15 and conditional > 0.5:
            flags.append(
                f"few storms expected ({storm:.0%}) but any that form would "
                f"be in a favourable environment for this hazard "
                f"({conditional:.0%} conditional). A low unconditional "
                f"probability here does NOT mean a benign environment"
            )

        out[name] = HazardProbability(
            name=name, probability=probability, conditional=conditional,
            n_sources=len(conditionals),
            spread=(
                float(np.std(array, ddof=1)) if array.size > 1 else None
            ),
            definition=definition.definition,
            caveat=definition.caveat,
            reason=reason, flags=tuple(flags),
        )

    _enforce_nesting(out, storm)
    return out


def _enforce_nesting(
    hazards: dict[str, HazardProbability], storm: float | None
) -> None:
    """Apply only the orderings the event definitions actually require.

    Section 54/56. A violation here is a BUG, not something to quietly
    clamp: the conditional structure makes P(hazard) <= P(thunderstorm)
    arithmetically necessary, so a breach means an input was wrong. It is
    corrected AND flagged, so it cannot pass unnoticed.
    """
    for lesser, greater in ev.nesting_constraints():
        low = hazards.get(lesser)
        if low is None or low.probability is None:
            continue

        if greater == "thunderstorm":
            bound = storm
        else:
            high = hazards.get(greater)
            bound = high.probability if high else None
        if bound is None:
            continue

        if low.probability > bound + 1e-9:
            log.error(
                "nesting violated: P(%s)=%.4f exceeds P(%s)=%.4f",
                lesser, low.probability, greater, bound,
            )
            low.flags = low.flags + (
                f"INTEGRITY: P({lesser}) exceeded P({greater}), which the "
                f"conditional structure makes arithmetically impossible. "
                f"Clamped, and this indicates a bug upstream rather than a "
                f"forecast",
            )
            low.probability = bound


def severe_hail(
    forecasts: list[SourceForecast], aggregation: Aggregation,
    hazards: dict[str, HazardProbability],
) -> HazardProbability:
    """Significant hail, from the hail engine's OWN separate conditional.

    Not a fixed fraction of the hail probability. The Stage 5 hail engine
    computes significant hail from its own ingredient list including storm
    organisation, because large hail needs a sustained updraught that
    ordinary hail does not -- and a fixed fraction would say nothing about
    organisation anywhere.
    """
    values: list[float] = []
    weights: list[float] = []
    applied = aggregation.applied_weights

    by_model: dict[str, list[SourceForecast]] = {}
    for forecast in forecasts:
        by_model.setdefault(forecast.model, []).append(forecast)

    for model, group in by_model.items():
        found = [
            f.hazard_conditionals.get("severe_hail")
            for f in group
            if "severe_hail" in f.hazard_conditionals
        ]
        found = [v for v in found if v is not None]
        if not found:
            continue
        values.append(float(np.mean(found)))
        weights.append(float(applied.get(model, 0.0)))

    definition = ev.HAZARDS["severe_hail"]
    if not values:
        return HazardProbability(
            name="severe_hail", probability=None, conditional=None,
            definition=definition.definition,
            reason=(
                "the hail engine produced no significant-hail conditional; "
                "it needs at least three of glaciated depth, updraught "
                "potential, organisation and wet-bulb zero"
            ),
        )

    array = np.array(values, dtype="float64")
    weight_array = np.array(weights, dtype="float64")
    if weight_array.sum() <= 0:
        weight_array = np.ones_like(array)
    weight_array = weight_array / weight_array.sum()
    conditional = float(np.sum(weight_array * array))

    storm = aggregation.probability
    probability = storm * conditional if storm is not None else None

    result = HazardProbability(
        name="severe_hail", probability=probability, conditional=conditional,
        n_sources=len(values),
        spread=float(np.std(array, ddof=1)) if array.size > 1 else None,
        definition=definition.definition,
        caveat=definition.caveat,
        flags=(
            "computed from the hail engine's own ingredients including storm "
            "organisation, NOT as a fixed fraction of the hail probability",
        ),
    )
    # `result` LAST: a dict literal keeps the final value for a repeated
    # key, so putting it first would let a stale entry shadow it and the
    # clamp would act on the wrong object.
    _enforce_nesting({**hazards, "severe_hail": result}, storm)
    return result
