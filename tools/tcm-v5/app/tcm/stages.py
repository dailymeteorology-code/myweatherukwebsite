"""Stage A (environment) and Stage B (realisation), per NWP source.

THE TWO-STAGE STRUCTURE
-----------------------
    P(thunderstorm) = P(environment supports deep convection)
                      x P(storm realised | environment supports it)

Section 4. The two questions are genuinely different and the British
atmosphere separates them constantly: most of the CAPE that appears over
these islands in a summer never produces a storm, because nothing lifts a
parcel to its LFC. A system that cannot express "excellent environment, no
trigger" will forecast storms on every warm afternoon.

Section 19 makes the requirement explicit: high instability with weak forcing
must come out differently from high instability with strong forcing, and
moderate instability with strong forcing must be able to beat both. That
falls out of the structure rather than needing a rule.

WHAT EACH STAGE MAY CONSUME -- AND WHAT IT MAY NOT
---------------------------------------------------
    Stage A    thermodynamic, updraft, entrainment      environmental
    Stage B    convective_initiation                    realisation

`FORBIDDEN_ENGINES` lists the six hazard engines, and both stages raise if
one appears in their inputs. This is section 32 and section 72 enforced
structurally rather than by convention: a hail forecast must never make
convection itself more likely, and the cleanest way to guarantee that is to
make the pathway impossible to write.

CORRELATED ENGINES
------------------
Stage A's three engines all read CAPE. They are combined by geometric mean,
which does not compound shared evidence, and the overlap is computed from
their own declared inputs and reported. Section 73.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

from ..engines.base import REGISTRY
from ..engines.result import EngineSet, ScoreKind
from .probability import (
    CalibrationStatus, Combination, Link, combine_correlated,
)

log = logging.getLogger(__name__)

#: Engines Stage A may read. Environmental only.
STAGE_A_ENGINES: tuple[str, ...] = (
    "thermodynamic", "updraft", "entrainment",
)

#: Engines Stage B may read.
STAGE_B_ENGINES: tuple[str, ...] = ("convective_initiation",)

#: Engines NEITHER stage may read, at any point, for any reason.
#: A hazard cannot make its own precondition more likely.
FORBIDDEN_ENGINES: frozenset[str] = frozenset({
    "lightning", "hail", "severe_wind", "downburst",
    "tornado_environment", "heavy_rainfall",
})

#: Engines whose score runs the WRONG way -- high means unfavourable.
INVERTED: frozenset[str] = frozenset({"entrainment"})


LINK_ENVIRONMENT = Link(
    name="environment",
    meaning=(
        "P(the atmosphere can support deep moist convection here, given a "
        "trigger). NOT P(a storm occurs) -- this is the environment's "
        "capability, and most capable environments over the UK produce "
        "nothing"
    ),
    low=0.2, low_probability=0.05,
    high=0.8, high_probability=0.85,
)

LINK_REALISATION = Link(
    name="realisation",
    meaning=(
        "P(convection actually initiates and deepens into a thunderstorm | "
        "the environment supports it). This is where the trigger lives, and "
        "where a capable-but-untriggered atmosphere is separated from a "
        "storm"
    ),
    low=0.15, low_probability=0.03,
    high=0.7, high_probability=0.55,
)


def _check_no_hazards(names) -> None:
    intruders = FORBIDDEN_ENGINES & set(names)
    if intruders:
        raise ValueError(
            f"hazard engine(s) {sorted(intruders)} reached a thunderstorm "
            f"stage. A hazard cannot make convection itself more likely: "
            f"section 32 forbids the pathway and section 72 tests for it"
        )


_check_no_hazards(STAGE_A_ENGINES)
_check_no_hazards(STAGE_B_ENGINES)


@dataclass(slots=True)
class StageResult:
    """One stage's potential and the probability it maps to."""

    stage: str
    #: Combined potential across the stage's engines, in [0, 1].
    potential: float | None
    #: The potential passed through this stage's link.
    probability: float | None
    link: Link
    combination: Combination | None = None
    reason: str = ""
    #: Engines that could not contribute.
    missing: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.probability is not None

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "potential": (
                round(self.potential, 4) if self.potential is not None
                else None
            ),
            "probability": (
                round(self.probability, 5) if self.probability is not None
                else None
            ),
            "link": self.link.to_dict(),
            "combination": (
                self.combination.to_dict() if self.combination else None
            ),
            "missing_engines": list(self.missing),
            "reason": self.reason,
        }


def _engine_potential(results: EngineSet, name: str) -> float | None:
    """One engine's score, oriented so that HIGH always means favourable."""
    result = results.get(name)
    if result is None or not result.status.has_score or result.score is None:
        return None
    score = float(result.score)
    if name in INVERTED:
        # Entrainment scores high for STRONG dilution, which is
        # unfavourable. Flipping it here, once, is why every other module
        # can assume high means favourable.
        return 1.0 - score
    return score


def assess_environment(results: EngineSet) -> StageResult:
    """Stage A: can this atmosphere support deep moist convection?"""
    _check_no_hazards(STAGE_A_ENGINES)
    values = {name: _engine_potential(results, name)
              for name in STAGE_A_ENGINES}
    inputs = {
        name: REGISTRY[name].consumes_diagnostics
        for name in STAGE_A_ENGINES if name in REGISTRY
    }
    combination = combine_correlated(values, inputs, minimum=2)
    if combination is None:
        return StageResult(
            stage="environment", potential=None, probability=None,
            link=LINK_ENVIRONMENT,
            missing=tuple(n for n, v in values.items() if v is None),
            reason=(
                "fewer than two environmental engines produced a score, so "
                "the atmosphere's capability cannot be assessed"
            ),
        )
    return StageResult(
        stage="environment", potential=combination.value,
        probability=LINK_ENVIRONMENT(combination.value),
        link=LINK_ENVIRONMENT, combination=combination,
        missing=combination.missing,
    )


def assess_realisation(results: EngineSet) -> StageResult:
    """Stage B: given a supportive environment, will a storm actually form?

    Reads the initiation engine, which already carries the crucial honesty:
    where no forcing information exists it caps itself and reports
    LOW_CONFIDENCE. That cap propagates here rather than being undone, so a
    high-CAPE, no-trigger environment cannot produce a confident storm
    forecast.
    """
    _check_no_hazards(STAGE_B_ENGINES)
    values = {name: _engine_potential(results, name)
              for name in STAGE_B_ENGINES}
    inputs = {
        name: REGISTRY[name].consumes_diagnostics
        for name in STAGE_B_ENGINES if name in REGISTRY
    }
    combination = combine_correlated(values, inputs, minimum=1)
    if combination is None:
        return StageResult(
            stage="realisation", potential=None, probability=None,
            link=LINK_REALISATION,
            missing=tuple(n for n, v in values.items() if v is None),
            reason=(
                "the initiation engine produced no score, so whether a "
                "storm is realised cannot be assessed. Note this is NOT the "
                "same as a low probability"
            ),
        )
    return StageResult(
        stage="realisation", potential=combination.value,
        probability=LINK_REALISATION(combination.value),
        link=LINK_REALISATION, combination=combination,
        missing=combination.missing,
    )


@dataclass(slots=True)
class SourceForecast:
    """One NWP source's thunderstorm forecast.

    Built per model and per ensemble member BEFORE any aggregation, so the
    hierarchy stays auditable (sections 8 and 9) and it remains possible to
    ask which model forecast what.
    """

    model: str
    member: int | None
    environment: StageResult
    realisation: StageResult
    #: P(thunderstorm) for this source. UNCALIBRATED.
    probability: float | None
    calibration: CalibrationStatus = CalibrationStatus.UNCALIBRATED
    #: P(hazard | thunderstorm) from the Stage 5 hazard engines. Conditional
    #: only -- these never touch `probability`.
    hazard_conditionals: dict[str, float] = dc_field(default_factory=dict)
    #: Regime affinities, kept as a distribution rather than a label.
    regime: dict[str, float] = dc_field(default_factory=dict)
    #: Engine-reported confidence, carried forward for the confidence model.
    engine_confidence: dict[str, float] = dc_field(default_factory=dict)
    reason: str = ""
    flags: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.probability is not None

    @property
    def is_member(self) -> bool:
        return self.member is not None

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "member": self.member,
            "probability": (
                round(self.probability, 5) if self.probability is not None
                else None
            ),
            "calibration": self.calibration.value,
            "environment": self.environment.to_dict(),
            "realisation": self.realisation.to_dict(),
            "hazard_conditionals": {
                k: round(v, 5) for k, v in self.hazard_conditionals.items()
            },
            "regime": {k: round(v, 4) for k, v in self.regime.items()},
            "reason": self.reason,
            "flags": list(self.flags),
        }


def forecast_source(
    results: EngineSet, *, model: str, member: int | None = None,
) -> SourceForecast:
    """Build one source's thunderstorm forecast from its Stage 5 output.

    The two stage probabilities are multiplied, which section 5 permits
    ONLY because each has been constructed as a probability with a stated
    conditional meaning by its `Link`. Multiplying the raw potentials would
    be meaningless.
    """
    environment = assess_environment(results)
    realisation = assess_realisation(results)

    flags: list[str] = []
    probability = None
    reason = ""

    if environment.available and realisation.available:
        probability = environment.probability * realisation.probability
    elif not environment.available:
        reason = environment.reason
    else:
        reason = realisation.reason

    # -- hazard conditionals, kept strictly separate ----------------------
    hazard_conditionals: dict[str, float] = {}
    for name in FORBIDDEN_ENGINES:
        result = results.get(name)
        if result is None or not result.status.has_score:
            continue
        conditional = result.extra.get("conditional_score")
        if conditional is not None:
            hazard_conditionals[name] = float(conditional)
        # Significant hail lives inside the hail engine's extra, computed
        # from its OWN ingredient list including organisation rather than
        # as a fraction of the hail score. Lifted out here so Stage 7 sees
        # it alongside the others.
        if name == "hail":
            significant = result.extra.get("significant_hail", {})
            value = significant.get("conditional_score")
            if value is not None:
                hazard_conditionals["severe_hail"] = float(value)

    regime: dict[str, float] = {}
    regime_result = results.get("weather_regime")
    if regime_result is not None and regime_result.status.has_score:
        regime = dict(regime_result.classes)

    confidence = {
        result.engine: float(result.confidence)
        for result in results
        if result.confidence is not None
    }

    initiation = results.get("convective_initiation")
    if initiation is not None and initiation.extra.get("forcing_available") \
            is False:
        flags.append(
            "no forcing data reached the initiation engine, so its score is "
            "capped and this probability is a statement about capability "
            "rather than a forecast that convection will begin"
        )

    return SourceForecast(
        model=model, member=member,
        environment=environment, realisation=realisation,
        probability=probability,
        hazard_conditionals=hazard_conditionals,
        regime=regime, engine_confidence=confidence,
        reason=reason, flags=tuple(flags),
    )


def describe_structure() -> dict:
    """The stage contract, for the API and for audit."""
    return {
        "structure": (
            "P(thunderstorm) = P(environment supports deep convection) "
            "x P(storm realised | environment supports it)"
        ),
        "why_multiplication_is_legitimate": (
            "each factor is constructed as a probability with a stated "
            "conditional meaning by its Link. Multiplying the raw Stage 5 "
            "potentials instead would produce a number with no "
            "probabilistic meaning, which section 5 forbids"
        ),
        "stage_a_engines": list(STAGE_A_ENGINES),
        "stage_b_engines": list(STAGE_B_ENGINES),
        "forbidden_engines": sorted(FORBIDDEN_ENGINES),
        "forbidden_reason": (
            "hazard engines may never influence the thunderstorm "
            "probability. A hail forecast cannot make convection itself "
            "more likely, and both stages raise if one appears in their "
            "inputs rather than relying on convention"
        ),
        "inverted_engines": sorted(INVERTED),
        "links": {
            "environment": LINK_ENVIRONMENT.to_dict(),
            "realisation": LINK_REALISATION.to_dict(),
        },
    }
