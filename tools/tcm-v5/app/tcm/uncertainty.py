"""Confidence and uncertainty -- separately, and separately from probability.

THREE QUANTITIES, THREE MEANINGS
---------------------------------
    probability   how likely the event is
    confidence    how much the forecast PROCESS can be trusted here
    uncertainty   how much the answer could move given what is not known

Section 41 requires them to remain mathematically distinct, and the reason
is that all three combinations occur:

    68% with high confidence     a well-observed, well-modelled setup
    68% with low confidence      the same number from a profile missing its
                                 mid-levels, one model, no forcing data
    5% with high confidence      confidently benign -- which is a genuinely
                                 useful forecast, not an absence of one

Folding confidence into the probability destroys the second and third, and
the second is exactly the case a forecaster most needs to see.

`confidence` is NOT `1 - uncertainty`. They move for different reasons:
confidence falls when the machinery is compromised (missing models, degraded
data, no verification history), uncertainty rises when the atmosphere itself
is unresolved (ensemble spread, model disagreement, an ambiguous regime).
A tightly-agreeing set of models running on excellent data in a genuinely
marginal setup has high confidence and high uncertainty at once.

EPISTEMIC AND ALEATORIC
-----------------------
Section 40 asks for the distinction where the architecture supports it:

    epistemic   what better data or a longer record would reduce -- missing
                models, absent forcing fields, no verification history
    aleatoric   what it would not -- convective initiation is genuinely
                chaotic, and no amount of history makes a marginal
                sea-breeze day certain

They are reported apart because the remedies differ entirely: epistemic
uncertainty is a reason to improve the system, aleatoric uncertainty is a
reason to communicate the forecast differently.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field as dc_field

import numpy as np

from ..skill.weights import WeightSet
from .aggregate import Aggregation
from .probability import CalibrationStatus
from .stages import SourceForecast

#: No forecast process is ever perfectly trustworthy. A confidence of 1.0
#: would claim the machinery cannot be wrong, which is never true.
MAX_CONFIDENCE = 0.9

#: Nor is any convective forecast ever free of uncertainty.
MIN_UNCERTAINTY = 0.1


@dataclass(slots=True)
class Confidence:
    """How much the forecast process can be trusted here."""

    value: float
    #: Named components, each in [0, 1], higher meaning better.
    components: dict[str, float] = dc_field(default_factory=dict)
    #: Plain-language reasons confidence is not higher.
    limiting: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "value": round(self.value, 4),
            "components": {
                k: round(v, 4) for k, v in self.components.items()
            },
            "limiting_factors": list(self.limiting),
            "meaning": (
                "how much the forecast PROCESS can be trusted here. NOT the "
                "probability of a thunderstorm, and NOT 1 - uncertainty"
            ),
        }


@dataclass(slots=True)
class Uncertainty:
    """How much the answer could move, in components."""

    value: float
    epistemic: float
    aleatoric: float
    components: dict[str, float] = dc_field(default_factory=dict)
    drivers: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "value": round(self.value, 4),
            "epistemic": round(self.epistemic, 4),
            "aleatoric": round(self.aleatoric, 4),
            "components": {
                k: round(v, 4) for k, v in self.components.items()
            },
            "drivers": list(self.drivers),
            "meaning": {
                "epistemic": (
                    "reducible: better data, more models, a longer "
                    "verification record would shrink it"
                ),
                "aleatoric": (
                    "irreducible: convective initiation is chaotic, and no "
                    "amount of history makes a marginal day certain"
                ),
            },
        }


def assess_confidence(
    forecasts: list[SourceForecast],
    aggregation: Aggregation,
    weights: WeightSet | None,
    *,
    calibration: CalibrationStatus,
    lead_hours: float | None = None,
) -> Confidence:
    """Confidence in the forecast process.

    Components are combined by their MINIMUM, not their mean. Confidence is
    limited by the weakest link: a forecast built on excellent models with
    no verification history behind them is not two-thirds trustworthy, it is
    as trustworthy as its least trustworthy part. A mean would let strong
    components hide a fatal one.
    """
    components: dict[str, float] = {}
    limiting: list[str] = []

    # -- how much of the model field contributed --------------------------
    n_systems = len(aggregation.systems)
    n_excluded = len(aggregation.excluded)
    total = n_systems + n_excluded
    coverage = n_systems / total if total else 0.0
    components["model_coverage"] = coverage
    if n_excluded:
        limiting.append(
            f"{n_excluded} of {total} model system(s) excluded: "
            + "; ".join(
                f"{k} ({v[:60]})" for k, v in
                list(aggregation.excluded.items())[:2]
            )
        )

    # -- engine completeness ------------------------------------------------
    engine_confidences = [
        value
        for forecast in forecasts
        for value in forecast.engine_confidence.values()
    ]
    engine = float(np.mean(engine_confidences)) if engine_confidences else 0.3
    components["engine_confidence"] = engine
    if engine < 0.5:
        limiting.append(
            f"the specialist engines report mean confidence {engine:.2f}, "
            f"usually because inputs were missing or interpolated"
        )

    # -- verification history behind the weights ---------------------------
    if weights is None:
        history = 0.3
        limiting.append(
            "no Stage 6 weighting was supplied, so the models were treated "
            "as equally reliable without evidence"
        )
    else:
        eligible = weights.eligible
        if not eligible:
            history = 0.1
            limiting.append("no model was eligible under Stage 6")
        else:
            cold = sum(1 for w in eligible if w.cold_start)
            samples = [w.sample_size for w in eligible]
            median_sample = float(np.median(samples)) if samples else 0.0
            # Rises from 0 with no history towards 1 with a substantial one.
            history = float(median_sample / (median_sample + 100.0))
            if cold == len(eligible):
                limiting.append(
                    "every contributing model is cold-started: no "
                    "verification history exists, so the weights are priors "
                    "rather than learned"
                )
            elif cold:
                limiting.append(
                    f"{cold} of {len(eligible)} models are cold-started"
                )
    components["verification_history"] = history

    # -- calibration --------------------------------------------------------
    calibration_confidence = {
        CalibrationStatus.CALIBRATED: 1.0,
        CalibrationStatus.PROVISIONAL: 0.5,
        CalibrationStatus.UNCALIBRATED: 0.25,
    }[calibration]
    components["calibration"] = calibration_confidence
    if calibration is not CalibrationStatus.CALIBRATED:
        limiting.append(
            f"probabilities are {calibration.value}: they have not been "
            f"verified against observed frequencies and must not be "
            f"presented to a user as probabilities"
        )

    # -- lead time -----------------------------------------------------------
    if lead_hours is not None:
        # Convective placement skill decays with lead. Falls from 1 in the
        # nowcast range towards a floor at multi-day range.
        lead = float(max(0.2, math.exp(-lead_hours / 48.0)))
        components["lead_time"] = lead
        if lead_hours > 36:
            limiting.append(
                f"T+{lead_hours:.0f}: convective placement is not skilful at "
                f"this range, whatever the environment says"
            )

    value = min(MAX_CONFIDENCE, min(components.values()))
    return Confidence(
        value=value, components=components, limiting=tuple(limiting)
    )


def assess_uncertainty(
    forecasts: list[SourceForecast],
    aggregation: Aggregation,
    *,
    regime_ambiguity: float | None = None,
    calibration: CalibrationStatus = CalibrationStatus.UNCALIBRATED,
) -> Uncertainty:
    """Uncertainty in the answer, split into what is and is not reducible.

    Components combine in quadrature within each class, because they are
    largely independent sources; the two classes are then reported both
    separately and combined.
    """
    components: dict[str, float] = {}
    drivers: list[str] = []

    # -- aleatoric: the atmosphere's own ------------------------------------
    within = aggregation.within_model
    if within is not None:
        # Ensemble spread is one model's honest statement about how
        # unresolved the outcome is. Scaled so that a spread of 0.25 in
        # probability -- very large -- approaches 1.
        aleatoric_ensemble = min(1.0, within / 0.25)
        components["ensemble_spread"] = aleatoric_ensemble
        if within > 0.12:
            drivers.append(
                f"large ensemble spread ({within:.2f}): the members disagree "
                f"about the outcome, which is the atmosphere being genuinely "
                f"unresolved rather than a data problem"
            )
    else:
        aleatoric_ensemble = 0.5
        components["ensemble_spread"] = aleatoric_ensemble
        drivers.append(
            "no ensemble contributed, so within-model uncertainty is unknown "
            "rather than low"
        )

    # A probability near 0.5 is the atmosphere itself being marginal. This
    # is irreducible: it is what the forecast is saying.
    marginality = 0.0
    if aggregation.probability is not None:
        marginality = float(1.0 - 2.0 * abs(aggregation.probability - 0.5))
    components["marginality"] = marginality

    aleatoric = float(np.sqrt(
        (aleatoric_ensemble ** 2 + marginality ** 2) / 2.0
    ))

    # -- epistemic: what better data would fix ------------------------------
    between = aggregation.between_model
    if between is not None:
        model_disagreement = min(1.0, between / 0.25)
        components["model_disagreement"] = model_disagreement
        if between > 0.12:
            drivers.append(
                f"the model systems disagree ({between:.2f} spread). Unlike "
                f"ensemble spread this is partly reducible -- it reflects "
                f"which models were available and how they were weighted"
            )
    else:
        model_disagreement = 0.6
        components["model_disagreement"] = model_disagreement
        drivers.append(
            "only one model system contributed, so inter-model uncertainty "
            "could not be measured. That is not agreement"
        )

    missing = 0.0
    if aggregation.excluded:
        missing = min(
            1.0, len(aggregation.excluded)
            / max(1, len(aggregation.systems) + len(aggregation.excluded))
        )
        components["missing_models"] = missing

    ambiguity = float(regime_ambiguity or 0.0)
    if ambiguity:
        components["regime_ambiguity"] = ambiguity
        if ambiguity > 0.3:
            drivers.append(
                "the regime is ambiguous: several convective regimes score "
                "similarly, and their interpretations differ"
            )

    calibration_uncertainty = {
        CalibrationStatus.CALIBRATED: 0.1,
        CalibrationStatus.PROVISIONAL: 0.4,
        CalibrationStatus.UNCALIBRATED: 0.7,
    }[calibration]
    components["calibration"] = calibration_uncertainty
    if calibration is not CalibrationStatus.CALIBRATED:
        drivers.append(
            "the probability is uncalibrated, so its distance from the true "
            "frequency is unknown"
        )

    epistemic_parts = [
        model_disagreement, missing, ambiguity, calibration_uncertainty
    ]
    epistemic = float(np.sqrt(
        sum(p ** 2 for p in epistemic_parts) / len(epistemic_parts)
    ))

    combined = float(np.sqrt((epistemic ** 2 + aleatoric ** 2) / 2.0))
    return Uncertainty(
        value=max(MIN_UNCERTAINTY, min(1.0, combined)),
        epistemic=max(0.0, min(1.0, epistemic)),
        aleatoric=max(0.0, min(1.0, aleatoric)),
        components=components, drivers=tuple(drivers),
    )
