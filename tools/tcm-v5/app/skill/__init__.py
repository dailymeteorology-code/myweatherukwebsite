"""Stage 6: adaptive NWP model skill, reliability and weighting.

Answers one question: which sources should TCM trust most for THIS variable,
place, lead time, regime and forecast situation — and how sure is it?

It does NOT produce a forecast. There is no combination of specialist engine
outputs here, no thunderstorm probability and no risk map; those belong to
the aggregation and calibration stages. The one place a weighted mean appears
is inside `backtest`, as an evaluation harness, and it is labelled as such.

    identity      who a model is, and which models are NOT independent
    metrics       verification statistics, each matched to a forecast type
    verification  forecast/observation pairing with as-of-time discipline
    store         the skill database and hierarchical shrinkage
    eligibility   whether a model may contribute at all, and why not
    agreement     the structure of current disagreement -- context, not skill
    weights       the weighting engine
    backtest      walk-forward comparison against simpler baselines

The six quantities Stage 6 keeps apart, because they are not interchangeable:

    model skill        what a model has done, verified
    current agreement  what the models say about each other now
    eligibility        whether a model may contribute at all
    model weight       relative expected usefulness for this task
    weight uncertainty how sure we are of that weight
    forecast confidence  NOT computed here -- all models can be confidently
                       weighted and collectively wrong
"""
from . import (                                              # noqa: F401
    agreement, backtest, eligibility, identity, metrics, store, verification,
    weights,
)
from .agreement import Agreement, Structure, assess as assess_agreement
from .eligibility import Eligibility, TaskRequirements, assess as assess_eligibility
from .identity import (
    Family, Kind, ModelIdentity, effective_independent_count, identify,
)
from .metrics import Direction, ForecastKind, MetricResult, SkillScore
from .store import SkillContext, SkillEstimate, SkillStore, context_for
from .verification import (
    ForecastRecord, ObservationRecord, ObservationQuality, ObservationSource,
    SkillQuery, VerificationPair, match,
)
from .weights import ModelWeight, WeightSet, compute as compute_weights

__all__ = [
    "Agreement", "Direction", "Eligibility", "Family", "ForecastKind",
    "ForecastRecord", "Kind", "MetricResult", "ModelIdentity", "ModelWeight",
    "ObservationQuality", "ObservationRecord", "ObservationSource",
    "SkillContext", "SkillEstimate", "SkillQuery", "SkillScore", "SkillStore",
    "Structure", "TaskRequirements", "VerificationPair", "WeightSet",
    "assess_agreement", "assess_eligibility", "compute_weights",
    "context_for", "effective_independent_count", "identify", "match",
]
