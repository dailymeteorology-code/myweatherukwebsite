"""The final TCM forecast: object, orchestration and integrity checks.

This is the end of the scientific chain:

    NWP -> profiles -> derived meteorology -> specialist engines
        -> model reliability -> aggregation -> calibration -> TCMForecast

WHAT THIS OBJECT PROMISES
-------------------------
Every number is traceable. Section 44 sets the standard: a developer must be
able to answer "why was this cell 72%?" without reverse-engineering the
system. So the forecast carries its per-source probabilities, the weights
applied, the stage decomposition, the engines that contributed, the
calibration version and the reasons -- not just the answer.

WHAT IT REFUSES TO DO
---------------------
**Zero is not "don't know".** Section 52. An unavailable probability is
`None` with a reason. A forecast of 0% asserts the event will not happen,
which is a strong claim and almost never the one being made.

**Uncalibrated is not hidden.** Section 33 requires every public probability
to pass through calibration; section 81 permits development output to be
"clearly marked as uncalibrated". `publishable` is False until a calibrator
has actually been fitted and verified, and no amount of downstream
formatting can change that.

**2 km output is not 2 km skill.** Section 45. The grid may be 2 km; the
metadata records the coarsest contributing model, and `effective_resolution_m`
reports that rather than the grid spacing.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from ..engines.base import REGISTRY as ENGINE_REGISTRY, STAGE5_VERSION
from ..engines.result import EngineSet
from ..skill.identity import ModelIdentity
from ..skill.weights import WEIGHTING_VERSION, WeightSet
from . import event as ev
from . import hazards as hz
from . import uncertainty as unc
from .aggregate import Aggregation, Pooling, Scenario, aggregate, scenarios
from .probability import CalibrationStatus, Calibrator
from .stages import SourceForecast, describe_structure, forecast_source

log = logging.getLogger(__name__)

#: Bumped when the aggregation logic changes.
TCM_VERSION = "5.0"
AGGREGATION_VERSION = "1.0"


@dataclass(slots=True)
class Provenance:
    """Everything needed to reproduce and audit one forecast."""

    models_used: tuple[str, ...] = ()
    models_excluded: dict[str, str] = dc_field(default_factory=dict)
    model_weights: dict[str, float] = dc_field(default_factory=dict)
    #: Coarsest contributing model, m. The forecast's real information
    #: content, whatever the output grid spacing is.
    effective_resolution_m: float | None = None
    output_grid_spacing_m: float | None = None
    n_members: dict[str, int] = dc_field(default_factory=dict)
    engine_versions: dict[str, str] = dc_field(default_factory=dict)
    tcm_version: str = TCM_VERSION
    stage5_version: str = STAGE5_VERSION
    stage6_version: str = WEIGHTING_VERSION
    aggregation_version: str = AGGREGATION_VERSION
    calibration_version: str = ""

    def to_dict(self) -> dict:
        payload = {
            "models_used": list(self.models_used),
            "models_excluded": dict(self.models_excluded),
            "model_weights": {
                k: round(v, 4) for k, v in self.model_weights.items()
            },
            "members_per_model": dict(self.n_members),
            "effective_resolution_m": self.effective_resolution_m,
            "output_grid_spacing_m": self.output_grid_spacing_m,
            "engine_versions": dict(self.engine_versions),
            "versions": {
                "tcm": self.tcm_version,
                "stage5_engines": self.stage5_version,
                "stage6_weighting": self.stage6_version,
                "aggregation": self.aggregation_version,
                "calibration": self.calibration_version or None,
            },
        }
        if (
            self.effective_resolution_m and self.output_grid_spacing_m
            and self.effective_resolution_m > self.output_grid_spacing_m * 1.5
        ):
            payload["resolution_warning"] = (
                f"the output grid is {self.output_grid_spacing_m:.0f} m but "
                f"the coarsest contributing model is "
                f"{self.effective_resolution_m:.0f} m. The forecast does NOT "
                f"contain detail at the grid scale and must not be presented "
                f"as though it does"
            )
        return payload


@dataclass(slots=True)
class TCMForecast:
    """One final probabilistic forecast for one point and valid time."""

    valid_time: datetime
    run: datetime
    forecast_hour: int
    latitude: float | None = None
    longitude: float | None = None

    # -- the primary target -------------------------------------------------
    #: P(thunderstorm). None when it could not be computed -- NEVER 0.0 to
    #: mean that.
    probability: float | None = None
    #: The probability before calibration, kept for audit.
    raw_probability: float | None = None
    calibration: CalibrationStatus = CalibrationStatus.UNCALIBRATED
    confidence: unc.Confidence | None = None
    uncertainty: unc.Uncertainty | None = None

    hazards: dict[str, hz.HazardProbability] = dc_field(default_factory=dict)

    # -- diagnostics --------------------------------------------------------
    sources: list[SourceForecast] = dc_field(default_factory=list)
    aggregation: Aggregation | None = None
    scenarios: list[Scenario] = dc_field(default_factory=list)
    regime: dict[str, float] = dc_field(default_factory=dict)
    provenance: Provenance = dc_field(default_factory=Provenance)

    explanation: tuple[str, ...] = ()
    limiting: tuple[str, ...] = ()
    integrity: list[str] = dc_field(default_factory=list)
    reason: str = ""

    @property
    def available(self) -> bool:
        return self.probability is not None

    @property
    def publishable(self) -> bool:
        """Whether this may be shown to a user AS A PROBABILITY."""
        return self.available and self.calibration.publishable

    #: Below this affinity no regime is meaningfully present, and naming
    #: the highest of a set of low scores is misleading -- a stable profile
    #: reported as "surface-based convection" purely because that scored
    #: 0.02 against everything else's 0.01.
    REGIME_PRESENT = 0.35

    @property
    def dominant_regime(self) -> str:
        if not self.regime:
            return ""
        name, affinity = max(self.regime.items(), key=lambda kv: kv[1])
        return name if affinity >= self.REGIME_PRESENT else ""

    def to_dict(self, *, include_sources: bool = False) -> dict:
        payload = {
            "metadata": {
                "run": self.run.isoformat(),
                "valid_time": self.valid_time.isoformat(),
                "forecast_hour": self.forecast_hour,
                "latitude": self.latitude,
                "longitude": self.longitude,
                "event": ev.THUNDERSTORM.to_dict(),
            },
            "thunderstorm": {
                "probability": (
                    round(self.probability, 5)
                    if self.probability is not None else None
                ),
                "raw_probability": (
                    round(self.raw_probability, 5)
                    if self.raw_probability is not None else None
                ),
                "calibration": self.calibration.value,
                "publishable": self.publishable,
                "reason": self.reason,
            },
            "confidence": (
                self.confidence.to_dict() if self.confidence else None
            ),
            "uncertainty": (
                self.uncertainty.to_dict() if self.uncertainty else None
            ),
            "hazards": {
                name: hazard.to_dict()
                for name, hazard in self.hazards.items()
            },
            "diagnostics": {
                "regime": {k: round(v, 4) for k, v in self.regime.items()},
                "dominant_regime": self.dominant_regime or None,
                "aggregation": (
                    self.aggregation.to_dict() if self.aggregation else None
                ),
                "scenarios": [s.to_dict() for s in self.scenarios],
            },
            "explanation": {
                "supporting": list(self.explanation),
                "limiting": list(self.limiting),
            },
            "provenance": self.provenance.to_dict(),
            "integrity": list(self.integrity),
            "note": (
                "probability, confidence and uncertainty are three distinct "
                "quantities. A 68% probability does not mean 68% confidence"
            ),
        }
        if not self.publishable:
            payload["thunderstorm"]["not_publishable_because"] = (
                "no calibration has been fitted against observations, so "
                "this number is structured like a probability but has never "
                "been checked against one. Section 33"
            )
        if include_sources:
            payload["sources"] = [s.to_dict() for s in self.sources]
        return payload


def produce(
    engine_results: dict[tuple[str, int | None], EngineSet],
    *,
    run: datetime,
    valid_time: datetime,
    forecast_hour: int,
    weights: WeightSet | None = None,
    identities: dict[str, ModelIdentity] | None = None,
    calibrator: Calibrator | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    pooling: Pooling = Pooling.LINEAR,
    output_grid_spacing_m: float | None = None,
) -> TCMForecast:
    """Build the final forecast from per-source Stage 5 output.

    `engine_results` is keyed by (model, member) so the hierarchy stays
    intact all the way down: every source gets its own thunderstorm
    probability before anything is combined (sections 8 and 9).
    """
    forecast = TCMForecast(
        valid_time=valid_time, run=run, forecast_hour=forecast_hour,
        latitude=latitude, longitude=longitude,
    )

    # -- step 1: one forecast per source -----------------------------------
    sources = [
        forecast_source(results, model=model, member=member)
        for (model, member), results in sorted(
            engine_results.items(), key=lambda kv: (kv[0][0], kv[0][1] or -1)
        )
    ]
    forecast.sources = sources
    if not sources:
        forecast.reason = (
            "no NWP source produced specialist engine output, so there is "
            "nothing to aggregate. This is an inability to forecast, not a "
            "forecast of no thunderstorms"
        )
        return forecast

    # -- step 2: aggregate --------------------------------------------------
    aggregation = aggregate(
        sources, weights, identities=identities, pooling=pooling
    )
    forecast.aggregation = aggregation
    forecast.scenarios = scenarios(aggregation)
    forecast.raw_probability = aggregation.probability

    if not aggregation.available:
        forecast.reason = aggregation.reason
    else:
        # -- step 3: calibrate ---------------------------------------------
        if calibrator is not None:
            forecast.probability = float(calibrator(aggregation.probability))
            forecast.calibration = calibrator.status
            forecast.provenance.calibration_version = calibrator.version
        else:
            forecast.probability = aggregation.probability
            forecast.calibration = CalibrationStatus.UNCALIBRATED

    # -- step 4: regime, as a distribution ---------------------------------
    forecast.regime = _pooled_regime(sources, aggregation)

    # -- step 5: hazards, conditional and one-way ---------------------------
    forecast.hazards = hz.compute(sources, aggregation)
    severe = hz.severe_hail(sources, aggregation, forecast.hazards)
    forecast.hazards["severe_hail"] = severe

    # -- step 6: confidence and uncertainty, separately ---------------------
    ambiguity = _regime_ambiguity(forecast.regime)
    forecast.confidence = unc.assess_confidence(
        sources, aggregation, weights,
        calibration=forecast.calibration, lead_hours=float(forecast_hour),
    )
    forecast.uncertainty = unc.assess_uncertainty(
        sources, aggregation, regime_ambiguity=ambiguity,
        calibration=forecast.calibration,
    )

    # -- step 7: provenance --------------------------------------------------
    forecast.provenance = _build_provenance(
        sources, aggregation, identities, output_grid_spacing_m,
        forecast.provenance.calibration_version,
    )

    # -- step 8: explain and check ------------------------------------------
    supporting, limiting = _explain(forecast)
    forecast.explanation = supporting
    forecast.limiting = limiting
    forecast.integrity = check_integrity(forecast)
    return forecast


def _pooled_regime(
    sources: list[SourceForecast], aggregation: Aggregation
) -> dict[str, float]:
    """Regime affinities pooled across sources, kept as a DISTRIBUTION.

    Section 20: the regime probability distribution should influence the
    forecast, and a single hard label discards the alternatives. So the
    affinities are pooled and all of them survive.
    """
    weights = aggregation.applied_weights
    totals: dict[str, float] = {}
    applied: dict[str, float] = {}
    for source in sources:
        weight = weights.get(source.model, 0.0)
        if weight <= 0:
            continue
        for regime, affinity in source.regime.items():
            totals[regime] = totals.get(regime, 0.0) + weight * affinity
            applied[regime] = applied.get(regime, 0.0) + weight
    return {
        regime: totals[regime] / applied[regime]
        for regime in totals if applied.get(regime, 0) > 0
    }


def _regime_ambiguity(regime: dict[str, float]) -> float:
    """How unclear the regime is. Several regimes scoring alike is real."""
    if len(regime) < 2:
        return 0.0
    ranked = sorted(regime.values(), reverse=True)
    leader = ranked[0]
    if leader <= 0:
        return 1.0
    close = sum(1 for v in ranked[1:] if leader - v <= 0.15 and v > 0.2)
    return min(1.0, close / 3.0)


def _build_provenance(
    sources, aggregation, identities, grid_spacing, calibration_version
) -> Provenance:
    identities = identities or {}
    members: dict[str, int] = {}
    for source in sources:
        members[source.model] = members.get(source.model, 0) + 1

    resolutions = [
        identities[model].resolution_m
        for model in aggregation.applied_weights
        if model in identities and identities[model].resolution_m is not None
    ]
    return Provenance(
        models_used=tuple(sorted(aggregation.applied_weights)),
        models_excluded=dict(aggregation.excluded),
        model_weights=dict(aggregation.applied_weights),
        effective_resolution_m=max(resolutions) if resolutions else None,
        output_grid_spacing_m=grid_spacing,
        n_members=members,
        engine_versions={
            name: engine.version for name, engine in ENGINE_REGISTRY.items()
        },
        calibration_version=calibration_version,
    )


def _explain(forecast: TCMForecast) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Why the probability is where it is.

    Section 60: only explanations supported by actual diagnostics. Every
    line below is emitted only when the condition that justifies it holds,
    and nothing is generated from a template that could be true.
    """
    supporting: list[str] = []
    limiting: list[str] = []

    aggregation = forecast.aggregation
    if aggregation is None or not aggregation.available:
        return (), (forecast.reason,) if forecast.reason else ()

    # The stage decomposition IS the explanation of the headline number.
    environments = [
        s.environment.probability for s in forecast.sources
        if s.environment.probability is not None
    ]
    realisations = [
        s.realisation.probability for s in forecast.sources
        if s.realisation.probability is not None
    ]
    if environments:
        mean_env = float(np.mean(environments))
        if mean_env > 0.6:
            supporting.append(
                f"the environment supports deep convection "
                f"({mean_env:.0%} across sources)"
            )
        elif mean_env < 0.25:
            limiting.append(
                f"the environment gives limited support for deep convection "
                f"({mean_env:.0%})"
            )
    if realisations:
        mean_real = float(np.mean(realisations))
        if mean_real < 0.25:
            limiting.append(
                f"convection is unlikely to be realised even where the "
                f"environment allows it ({mean_real:.0%}) -- typically a "
                f"cap, a high cloud base, or nothing to lift a parcel"
            )
        elif mean_real > 0.5:
            supporting.append(
                f"a trigger is likely to realise the environment's potential "
                f"({mean_real:.0%})"
            )

    if forecast.dominant_regime:
        supporting.append(
            f"dominant regime: {forecast.dominant_regime.replace('_', ' ')}"
        )

    between = aggregation.between_model
    if between is not None and between < 0.06:
        supporting.append("the model systems agree closely")
    elif between is not None and between > 0.15:
        limiting.append(
            f"the model systems disagree substantially ({between:.2f} "
            f"spread in probability)"
        )

    if forecast.scenarios:
        limiting.append(
            f"{len(forecast.scenarios)} distinct scenarios are present; the "
            f"single probability is a mixture of them and matches neither"
        )

    if aggregation.excluded:
        limiting.append(
            f"{len(aggregation.excluded)} model system(s) contributed "
            f"nothing: " + "; ".join(
                f"{k} ({v[:50]})"
                for k, v in list(aggregation.excluded.items())[:2]
            )
        )

    for source in forecast.sources:
        for flag in source.flags:
            if flag not in limiting:
                limiting.append(flag)
        break

    if forecast.confidence is not None:
        limiting.extend(
            f for f in forecast.confidence.limiting if f not in limiting
        )

    return tuple(supporting), tuple(limiting)


def check_integrity(forecast: TCMForecast) -> list[str]:
    """Automated sanity checks. Integrity, not forecasting (section 56).

    A failure here means a BUG, not an unusual atmosphere, so each is
    reported rather than quietly repaired.
    """
    problems: list[str] = []

    for label, value in (
        ("thunderstorm", forecast.probability),
        ("raw", forecast.raw_probability),
    ):
        if value is None:
            continue
        if not np.isfinite(value):
            problems.append(f"{label} probability is not finite: {value}")
        elif not (0.0 <= value <= 1.0):
            problems.append(
                f"{label} probability {value} is outside [0, 1]. Clipping "
                f"would hide the cause; this needs investigating"
            )

    storm = forecast.probability
    for lesser, greater in ev.nesting_constraints():
        low = forecast.hazards.get(lesser)
        if low is None or low.probability is None:
            continue
        bound = storm if greater == "thunderstorm" else (
            forecast.hazards[greater].probability
            if greater in forecast.hazards else None
        )
        if bound is None:
            continue
        if low.probability > bound + 1e-9:
            problems.append(
                f"P({lesser}) = {low.probability:.4f} exceeds "
                f"P({greater}) = {bound:.4f}, which the conditional "
                f"structure makes impossible"
            )

    if forecast.aggregation is not None and forecast.aggregation.available:
        total = sum(forecast.aggregation.applied_weights.values())
        if abs(total - 1.0) > 1e-6:
            problems.append(
                f"applied model weights sum to {total:.6f}, not 1"
            )

    if forecast.probability is not None and forecast.confidence is not None:
        if abs(forecast.probability - forecast.confidence.value) < 1e-12 \
                and forecast.probability not in (0.0, 1.0):
            problems.append(
                "probability and confidence are identical, which suggests "
                "they have been conflated somewhere"
            )

    if not forecast.available and forecast.probability == 0.0:
        problems.append(
            "an unavailable forecast was represented as 0.0 rather than "
            "None. Section 52"
        )
    return problems


def describe() -> dict:
    """The Stage 7 contract, for the API and for audit."""
    return {
        "tcm_version": TCM_VERSION,
        "aggregation_version": AGGREGATION_VERSION,
        "event": ev.to_dict(),
        "stages": describe_structure(),
        "chain": [
            "NWP data",
            "atmospheric profiles (Stage 3)",
            "derived meteorology (Stage 4)",
            "specialist engines (Stage 5)",
            "model reliability (Stage 6)",
            "per-source thunderstorm probability (Stage 7A/7B)",
            "ensemble aggregation within each system",
            "multi-model aggregation using Stage 6 weights",
            "calibration",
            "final probability, confidence and uncertainty",
        ],
        "guarantees": [
            "rainfall is never used as a thunderstorm proxy",
            "hazard engines cannot influence P(thunderstorm) -- the stages "
            "raise if one appears in their inputs",
            "ensemble members collapse to their system before models are "
            "combined",
            "unavailable is None with a reason, never 0%",
            "probability, confidence and uncertainty are separate fields",
            "uncalibrated output is marked unpublishable and cannot be "
            "formatted into looking otherwise",
        ],
    }
