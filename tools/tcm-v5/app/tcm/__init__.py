"""Stage 7: the final probabilistic TCM forecast.

    NWP -> profiles -> derived meteorology -> specialist engines
        -> model reliability -> aggregation -> calibration -> P(thunderstorm)

    event         what "a thunderstorm" means, defined before anything is
                  forecast and matched to the verification
    probability   links, correlation-aware combination, calibration
    stages        Stage A (environment) and Stage B (realisation), per source
    aggregate     members -> systems -> multi-model, using Stage 6 weights
    hazards       conditional hazard probabilities, one-way
    uncertainty   confidence and uncertainty, separately
    forecast      the TCMForecast object and its integrity checks
    evaluate      baselines, ablation, calibration workflow

WHAT THIS STAGE WILL NOT DO
---------------------------
    rainfall is never a thunderstorm proxy
    hazard engines cannot raise P(thunderstorm) -- the stages raise if one
        appears in their inputs
    ensemble members are not independent model votes
    probability, confidence and uncertainty are three separate fields
    unavailable is None with a reason, never 0%
    uncalibrated output is marked unpublishable and stays that way
    a 2 km grid does not imply 2 km skill
"""
from . import (                                             # noqa: F401
    aggregate, evaluate, event, forecast, hazards, probability, stages,
    uncertainty,
)
from .aggregate import Aggregation, Pooling, Scenario
from .event import HAZARDS, THUNDERSTORM, ThunderstormEvent
from .forecast import TCMForecast, TCM_VERSION, describe, produce
from .hazards import HazardProbability
from .probability import CalibrationStatus, Calibrator, fit_calibrator
from .stages import SourceForecast, StageResult, forecast_source
from .uncertainty import Confidence, Uncertainty

__all__ = [
    "Aggregation", "CalibrationStatus", "Calibrator", "Confidence",
    "HAZARDS", "HazardProbability", "Pooling", "Scenario", "SourceForecast",
    "StageResult", "TCMForecast", "TCM_VERSION", "THUNDERSTORM",
    "ThunderstormEvent", "Uncertainty", "describe", "fit_calibrator",
    "forecast_source", "produce",
]
