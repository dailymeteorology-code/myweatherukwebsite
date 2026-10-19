"""The adaptive weighting engine.

WHAT A WEIGHT IS
----------------
The relative expected usefulness of a source for one forecasting task under
current conditions. Section 6 is emphatic about what it is NOT:

    NOT a probability that the model is correct
    NOT a confidence score
    NOT an absolute measure of model quality

`UKV 0.42` means UKV should carry about 42% of the influence for THIS task at
THIS place and time, relative to the other eligible sources. It says nothing
about whether UKV is right, and nothing about whether the forecast is
trustworthy — all models can be confidently weighted and collectively wrong.
`ModelWeight.confidence` is therefore a separate field and the distinction is
asserted by a test.

HOW WEIGHTS ARE BUILT — AND WHY NOT BY A WEIGHTED SUM
------------------------------------------------------
Section 36 warns against combining the inputs with an arbitrary weighted sum.
The inputs are not commensurable anyway: eligibility is a gate, suitability
is a fitness fraction, and skill is an earned statistic. They compose as:

    eligible?                       hard gate -> excluded, with a reason
    reliability = f(historical skill)   earned, hierarchically shrunk
    fitness     = reliability x suitability
                                    conditional: a model must be BOTH able to
                                    do the task AND good at it. A product is
                                    the correct form for a conjunction, not a
                                    choice of coefficients
    diversity                       family members share the family's voice
    normalise                       over eligible models only

There is no free coefficient anywhere in that chain. The only tunable numbers
in the whole of Stage 6 are `store.SHRINKAGE_N` — which has a plain meaning
and is reported on every estimate — and `MAX_WEIGHT_RATIO` below, which is
justified from what NWP skill differences actually look like.

AGREEMENT DOES NOT RAISE A WEIGHT
----------------------------------
Section 57. Sitting near the consensus is not evidence of skill; models agree
partly because they share physics and assimilation. Current agreement is
passed through to the output as CONTEXT for the aggregation stage and is
never used to adjust a weight.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field as dc_field
from enum import Enum
from datetime import datetime

import numpy as np

from . import store as skill_store
from .agreement import Agreement
from .eligibility import Eligibility
from .identity import Family, ModelIdentity, effective_independent_count
from .metrics import Direction, ForecastKind
from .store import SkillContext, SkillEstimate, SkillStore
from .verification import lead_band_of, season_of

log = logging.getLogger(__name__)

#: Version of the weighting logic. Stored with every weight so a historical
#: weight can be reproduced by the code that made it (section 82).
WEIGHTING_VERSION = "1.0"
FEATURE_SET_VERSION = "1.0"

#: The most the strongest eligible model may outweigh the weakest.
#:
#: Justified, not arbitrary. Operational NWP models over the UK differ in
#: skill by factors of order two -- one may have 20% lower MAE than another
#: for a given variable and lead. Differences of order 100 do not occur
#: between operational centres; a ratio that large is an estimation artefact,
#: usually a tiny sample that shrinkage has not fully absorbed. Bounding the
#: ratio prevents a pathological estimate from silencing a model, which
#: section 46 requires, without asserting any particular floor value.
MAX_WEIGHT_RATIO = 20.0

#: Reliability given to a model with no usable history anywhere in its
#: hierarchy. The MEDIAN of the models that do have history -- not the
#: maximum (which would reward having no record) and not zero (which would
#: make a new model unable to ever earn one). Section 80.
COLD_START_QUANTILE = 0.5


@dataclass(slots=True)
class ModelWeight:
    """One model's weight for one task, with everything behind it."""

    model: ModelIdentity
    eligible: bool
    #: Final normalised weight. Sums to 1 across eligible models.
    weight: float
    #: Weight before normalisation and diversity adjustment.
    raw_reliability: float | None
    #: Historical skill, transformed onto [0, 1].
    historical_reliability: float | None
    #: Task fitness from the eligibility assessment.
    suitability: float
    #: Spread of plausible weights, from skill uncertainty and sample size.
    uncertainty: float
    #: Cases behind the historical estimate.
    sample_size: int
    #: How much of the skill estimate was borrowed from broader contexts.
    borrowed_fraction: float
    #: Contribution factor from family redundancy, in (0, 1].
    diversity_factor: float = 1.0
    #: Plain-language reasons, most important first.
    reasons: tuple[str, ...] = ()
    #: Why it is ineligible, when it is.
    exclusion: str = ""
    #: The skill context actually used.
    context: dict = dc_field(default_factory=dict)
    cold_start: bool = False

    def to_dict(self) -> dict:
        return {
            "model": self.model.key,
            "family": self.model.family.value,
            "eligible": self.eligible,
            "weight": round(self.weight, 4),
            "weight_uncertainty": round(self.uncertainty, 4),
            "raw_reliability": (
                round(self.raw_reliability, 4)
                if self.raw_reliability is not None else None
            ),
            "historical_reliability": (
                round(self.historical_reliability, 4)
                if self.historical_reliability is not None else None
            ),
            "suitability": round(self.suitability, 4),
            "diversity_factor": round(self.diversity_factor, 4),
            "sample_size": self.sample_size,
            "borrowed_fraction": round(self.borrowed_fraction, 4),
            "cold_start": self.cold_start,
            "reasons": list(self.reasons),
            "exclusion": self.exclusion or None,
            "context": self.context,
        }


@dataclass(slots=True)
class WeightSet:
    """Every model's weight for one task, place and time."""

    task: str
    variable: str
    valid_time: datetime
    as_of: datetime
    latitude: float | None
    longitude: float | None
    regime: str
    weights: dict[str, ModelWeight] = dc_field(default_factory=dict)
    #: Current inter-model structure. CONTEXT ONLY -- never used to set a
    #: weight, because agreement is not skill.
    agreement: dict | None = None
    effective_independent: float = 0.0
    diagnostics: dict = dc_field(default_factory=dict)
    weighting_version: str = WEIGHTING_VERSION
    feature_set_version: str = FEATURE_SET_VERSION

    @property
    def eligible(self) -> list[ModelWeight]:
        return [w for w in self.weights.values() if w.eligible]

    @property
    def total(self) -> float:
        return sum(w.weight for w in self.weights.values())

    def to_dict(self) -> dict:
        return {
            "task": self.task,
            "variable": self.variable,
            "valid_time": self.valid_time.isoformat(),
            "as_of": self.as_of.isoformat(),
            "location": (
                {"latitude": self.latitude, "longitude": self.longitude}
                if self.latitude is not None else None
            ),
            "regime": self.regime or None,
            "weights": {
                k: w.to_dict() for k, w in sorted(
                    self.weights.items(), key=lambda kv: -kv[1].weight
                )
            },
            "sum_of_weights": round(self.total, 6),
            "effective_independent_models": self.effective_independent,
            "agreement": self.agreement,
            "diagnostics": self.diagnostics,
            "versions": {
                "weighting": self.weighting_version,
                "feature_set": self.feature_set_version,
                "shrinkage_n": skill_store.SHRINKAGE_N,
            },
            "what_a_weight_means": (
                "relative expected usefulness of this source for this task "
                "under current conditions. NOT a probability that the model "
                "is correct, and NOT forecast confidence -- all models can "
                "be confidently weighted and collectively wrong"
            ),
        }


class ReliabilityMap(str, Enum):
    """How a verification statistic becomes a weight.

    Offered as alternatives rather than decided here, because section 37
    requires comparing methods and section 36 says the functional form
    should be settled by testing. `backtest.walk_forward` scores them
    against each other and against the equal-weight baseline.
    """

    #: reference / (reference + error). Bounded, scale-free, conservative.
    #: Cannot go negative and needs no clipping, but it is FLAT: a model
    #: with half the error of another gets only about 1.5x its weight.
    RELATIVE = "relative"
    #: 1 / error. Weight proportional to accuracy.
    INVERSE_ERROR = "inverse_error"
    #: 1 / error^2 -- inverse-variance weighting.
    #:
    #: This is not a tuning choice. For unbiased estimators with independent
    #: errors, weighting by inverse variance is the MINIMUM-VARIANCE linear
    #: combination; it is a theorem, not a preference. The default for that
    #: reason, and because the backtest confirms it: on synthetic models
    #: with known error spreads the RELATIVE map was beaten by simply
    #: picking the single best model, which means it was not differentiating
    #: enough to be worth the machinery.
    #:
    #: Its assumptions are real and are checked: errors must be roughly
    #: unbiased and independent. The diversity factor handles the shared
    #: lineage that breaks independence, and bias is tracked separately
    #: because section 27 forbids folding it into a weight.
    PRECISION = "precision"


DEFAULT_MAP = ReliabilityMap.PRECISION


def reliability_from_skill(
    estimate: SkillEstimate, direction: Direction,
    *, reference: float | None = None,
    mapping: ReliabilityMap = DEFAULT_MAP,
) -> tuple[float | None, str]:
    """Turn a verification statistic into a reliability on [0, 1].

    `reference` is the multi-model median error for the task, so reliability
    is always relative to the field actually available rather than to an
    absolute standard that would vary by variable and be meaningless across
    them.

    Returns the value and a plain-language description for the explanation.
    """
    if not estimate.available:
        return None, "no usable historical skill"

    value = float(estimate.value)
    if direction is Direction.LOWER_IS_BETTER:
        if reference is None or reference <= 0:
            return None, "no reference error to compare against"
        # A floor at a small fraction of the reference keeps the inverse
        # maps finite when a model's estimated error is near zero, which
        # happens with tiny samples before shrinkage has absorbed them.
        safe = max(value, reference * 1e-3)
        if mapping is ReliabilityMap.PRECISION:
            reliability = (reference / safe) ** 2
        elif mapping is ReliabilityMap.INVERSE_ERROR:
            reliability = reference / safe
        else:
            reliability = reference / (reference + safe)
        if value < reference * 0.8:
            description = "clearly lower error than the other models here"
        elif value < reference * 1.05:
            description = "error comparable with the other models"
        else:
            description = "higher error than the other models here"
    elif direction is Direction.HIGHER_IS_BETTER:
        # Already a skill score on [0, 1]; a precision map would need a
        # variance, which a skill score does not carry.
        reliability = min(1.0, max(0.0, value))
        description = (
            "strong verified performance" if reliability > 0.6
            else "modest verified performance"
        )
    else:
        # ZERO_IS_BEST (bias). Magnitude only, and note that bias is not
        # skill -- section 27 forbids turning it automatically into a
        # penalty, so this route is used only when explicitly requested.
        if reference is None or reference <= 0:
            return None, "no reference bias to compare against"
        reliability = reference / (reference + abs(value))
        description = "smaller systematic bias than the other models"

    return round(float(reliability), 6), description


def compute(
    task: str,
    variable: str,
    candidates: list[Eligibility],
    store: SkillStore,
    *,
    as_of: datetime,
    valid_time: datetime,
    latitude: float | None = None,
    longitude: float | None = None,
    regime: str = "",
    lead_hours: float | None = None,
    metric: str = "mae",
    kind: ForecastKind = ForecastKind.CONTINUOUS,
    direction: Direction = Direction.LOWER_IS_BETTER,
    mapping: ReliabilityMap = DEFAULT_MAP,
    agreement: Agreement | None = None,
    window_days: int | None = None,
    use_spatial_kernel: bool = True,
) -> WeightSet:
    """Weights for one task at one place and time.

    `as_of` is required and is passed straight through to every skill query,
    so no weight can be built from verification that did not exist when the
    forecast was issued.
    """
    result = WeightSet(
        task=task, variable=variable, valid_time=valid_time, as_of=as_of,
        latitude=latitude, longitude=longitude, regime=regime,
    )

    # -- historical skill for every candidate ------------------------------
    estimates: dict[str, SkillEstimate] = {}
    for candidate in candidates:
        context = SkillContext(
            model=candidate.model.key, variable=variable,
            region=(
                skill_store.region_of(latitude, longitude)
                if latitude is not None and longitude is not None else ""
            ),
            lead_band=(
                lead_band_of(lead_hours) if lead_hours is not None else None
            ),
            season=season_of(valid_time),
            regime=regime,
        )
        if use_spatial_kernel and latitude is not None \
                and longitude is not None:
            estimate = store.local_estimate(
                context, as_of, latitude, longitude,
                metric=metric, window_days=window_days,
            )
        else:
            estimate = store.estimate(
                context, as_of, metric=metric, kind=kind,
                window_days=window_days,
            )
        estimates[candidate.model.key] = estimate

    # -- the reference the reliability map is relative to -------------------
    usable = [
        e.value for e in estimates.values()
        if e.available and e.reliable
    ]
    reference = float(np.median(usable)) if usable else None

    # -- reliability per model ---------------------------------------------
    reliabilities: dict[str, float | None] = {}
    descriptions: dict[str, str] = {}
    for key, estimate in estimates.items():
        value, description = reliability_from_skill(
            estimate, direction, reference=reference, mapping=mapping
        )
        reliabilities[key] = value
        descriptions[key] = description

    # -- cold start ---------------------------------------------------------
    known = [v for v in reliabilities.values() if v is not None]
    cold_value = (
        float(np.quantile(known, COLD_START_QUANTILE)) if known else 0.5
    )
    cold_started = set()
    for key, value in reliabilities.items():
        if value is None:
            reliabilities[key] = cold_value
            cold_started.add(key)
            descriptions[key] = (
                "no verification history; given the median reliability of "
                "the models that have one, with high uncertainty"
            )

    # -- diversity ----------------------------------------------------------
    eligible_identities = [c.model for c in candidates if c.eligible]
    effective, diversity_detail = effective_independent_count(
        eligible_identities
    )
    result.effective_independent = effective
    diversity_factors = _diversity_factors(eligible_identities)

    # -- assemble ------------------------------------------------------------
    raw: dict[str, float] = {}
    for candidate in candidates:
        key = candidate.model.key
        estimate = estimates[key]
        reliability = reliabilities[key]

        if not candidate.eligible:
            result.weights[key] = ModelWeight(
                model=candidate.model, eligible=False, weight=0.0,
                raw_reliability=None,
                historical_reliability=reliability,
                suitability=candidate.suitability, uncertainty=0.0,
                sample_size=estimate.n,
                borrowed_fraction=estimate.borrowed_fraction,
                exclusion=candidate.blocking,
                reasons=(
                    f"excluded: {candidate.blocking}",
                ),
                context=estimate.context.to_dict(),
                cold_start=key in cold_started,
            )
            continue

        # A conjunction: the model must be BOTH able to do the task and
        # good at it. A product expresses that; a sum would let high skill
        # compensate for a missing variable.
        fitness = reliability * candidate.suitability
        diversity = diversity_factors.get(key, 1.0)
        raw[key] = max(fitness * diversity, 0.0)

        result.weights[key] = ModelWeight(
            model=candidate.model, eligible=True, weight=0.0,
            raw_reliability=fitness,
            historical_reliability=reliability,
            suitability=candidate.suitability,
            uncertainty=0.0, sample_size=estimate.n,
            borrowed_fraction=estimate.borrowed_fraction,
            diversity_factor=diversity,
            reasons=_reasons(
                candidate, estimate, descriptions[key], diversity,
                key in cold_started,
            ),
            context=estimate.context.to_dict(),
            cold_start=key in cold_started,
        )

    _normalise(result, raw)
    _attach_uncertainty(result, estimates)

    if agreement is not None:
        result.agreement = agreement.to_dict()
        result.agreement["used_for_weighting"] = False
        result.agreement["why_not"] = (
            "agreement is not skill. Models agree partly because they share "
            "physics and assimilation, and five agreeing models can all be "
            "wrong. It is passed to the aggregation stage as context"
        )

    result.diagnostics = {
        "reference_metric": (
            round(reference, 6) if reference is not None else None
        ),
        "reference_meaning": (
            f"median {metric} across models with usable history; "
            f"reliability is relative to the field actually available"
        ),
        "metric": metric,
        "direction": direction.value,
        "cold_start_models": sorted(cold_started),
        "diversity": diversity_detail,
        "max_weight_ratio": MAX_WEIGHT_RATIO,
        "reliability_map": mapping.value,
        "spatial_method": (
            "gaussian kernel" if use_spatial_kernel else "region key"
        ),
    }
    return result


def _diversity_factors(identities: list[ModelIdentity]) -> dict[str, float]:
    """Per-model factor discounting shared lineage.

    Within a family the k-th model contributes 1/k, matching
    `identity.effective_independent_count`. Ordering is by model key so the
    result is reproducible (section 83) rather than depending on dictionary
    order.
    """
    by_family: dict[Family, list[ModelIdentity]] = {}
    for identity in identities:
        by_family.setdefault(identity.family, []).append(identity)

    factors: dict[str, float] = {}
    for family, members in by_family.items():
        if family is Family.UNKNOWN or len(members) == 1:
            for identity in members:
                factors[identity.key] = 1.0
            continue
        for rank, identity in enumerate(
            sorted(members, key=lambda m: m.key), start=1
        ):
            factors[identity.key] = 1.0 / rank
    return factors


def _normalise(result: WeightSet, raw: dict[str, float]) -> None:
    """Normalise over eligible models, bounding the spread.

    The bound is applied BEFORE normalisation, on the raw reliabilities, so
    that clamping one model does not silently redistribute weight in a way
    that depends on how many models happen to be present.
    """
    if not raw:
        return
    values = np.array(list(raw.values()), dtype="float64")
    positive = values[values > 0]
    if positive.size == 0:
        share = 1.0 / len(raw)
        for key in raw:
            result.weights[key].weight = share
            result.weights[key].reasons += (
                "no model has usable reliability; weights are equal",
            )
        return

    floor = float(positive.max()) / MAX_WEIGHT_RATIO
    bounded = {k: max(v, floor) for k, v in raw.items()}
    total = sum(bounded.values())
    for key, value in bounded.items():
        result.weights[key].weight = value / total
        if raw[key] < floor:
            result.weights[key].reasons += (
                f"weight floored: its reliability estimate would give a "
                f"share more than {MAX_WEIGHT_RATIO:.0f}x below the leader, "
                f"which is beyond the range real NWP skill differences span "
                f"and indicates an estimation artefact",
            )


def _attach_uncertainty(
    result: WeightSet, estimates: dict[str, SkillEstimate]
) -> None:
    """Uncertainty in each weight, from the evidence behind it.

    Three sources, and they are combined in quadrature because they are
    independent: sampling error in the skill estimate, the fraction of the
    estimate that was borrowed from a broader context, and whether the model
    is cold-started.
    """
    for key, weight in result.weights.items():
        if not weight.eligible:
            continue
        estimate = estimates[key]

        sampling = 1.0 / math.sqrt(max(estimate.effective_n, 1.0))
        borrowed = float(estimate.borrowed_fraction) * 0.5
        cold = 0.5 if weight.cold_start else 0.0
        combined = math.sqrt(sampling ** 2 + borrowed ** 2 + cold ** 2)

        # Expressed as a spread on the weight itself, so it is comparable
        # with the weight and can be read as +/-.
        weight.uncertainty = round(
            min(weight.weight, weight.weight * combined), 4
        )


def _reasons(
    candidate: Eligibility, estimate: SkillEstimate, description: str,
    diversity: float, cold_start: bool,
) -> tuple[str, ...]:
    """Plain-language explanation, most important first.

    Section 55: only reasons actually supported by the inputs. Nothing here
    is generated from a template that could be true; each line is emitted
    only when the condition that justifies it holds.
    """
    out: list[str] = [description]

    if cold_start:
        out.append(
            "no verification record yet, so this weight is a prior and will "
            "move as evidence accumulates"
        )
    elif estimate.n >= 200:
        out.append(f"based on {estimate.n} verified cases")
    elif estimate.n > 0:
        out.append(
            f"only {estimate.n} verified case(s) at this exact context, so "
            f"{estimate.borrowed_fraction:.0%} of the estimate is borrowed "
            f"from broader conditions"
        )

    if candidate.suitability < 0.99:
        out.append(
            f"task suitability {candidate.suitability:.2f}: "
            + (candidate.notes[0] if candidate.notes else "partial inputs")
        )

    if diversity < 0.99:
        out.append(
            f"shares lineage with another contributing model, so its "
            f"independent contribution is discounted to {diversity:.2f}"
        )

    for note in candidate.notes[1:]:
        out.append(note)

    return tuple(out)


def equal_weights(
    candidates: list[Eligibility], task: str, variable: str,
    valid_time: datetime, as_of: datetime,
) -> WeightSet:
    """The baseline every adaptive scheme must beat.

    Section 38 and 72: an adaptive system is an improvement only if it
    demonstrably outperforms something simple. This is that something.
    """
    result = WeightSet(
        task=task, variable=variable, valid_time=valid_time, as_of=as_of,
        latitude=None, longitude=None, regime="",
    )
    eligible = [c for c in candidates if c.eligible]
    share = 1.0 / len(eligible) if eligible else 0.0
    for candidate in candidates:
        result.weights[candidate.model.key] = ModelWeight(
            model=candidate.model, eligible=candidate.eligible,
            weight=share if candidate.eligible else 0.0,
            raw_reliability=None, historical_reliability=None,
            suitability=candidate.suitability, uncertainty=0.0,
            sample_size=0, borrowed_fraction=1.0,
            exclusion=candidate.blocking,
            reasons=("equal-weight baseline",),
        )
    result.diagnostics = {"method": "equal_weight_baseline"}
    return result


def smooth(
    previous: WeightSet | None, current: WeightSet, *,
    max_change: float = 0.15,
) -> WeightSet:
    """Limit how far a weight may move between consecutive forecasts.

    Section 45. A weight that jumps hour to hour produces visibly noisy
    forecasts for no meteorological reason. But the same section warns
    against smoothing away genuine regime transitions, so the limit is
    RELAXED when the regime has changed: a real change of atmospheric state
    is exactly when weights should be allowed to move.
    """
    if previous is None:
        return current

    regime_changed = previous.regime != current.regime
    limit = 1.0 if regime_changed else max_change

    for key, weight in current.weights.items():
        old = previous.weights.get(key)
        if old is None or not weight.eligible or not old.eligible:
            continue
        change = weight.weight - old.weight
        if abs(change) > limit:
            weight.weight = old.weight + math.copysign(limit, change)
            weight.reasons += (
                f"change limited to {limit:.2f} per step to avoid noisy "
                f"weight oscillation",
            )

    total = sum(w.weight for w in current.weights.values() if w.eligible)
    if total > 0:
        for weight in current.weights.values():
            if weight.eligible:
                weight.weight /= total

    current.diagnostics["smoothing"] = {
        "applied": not regime_changed,
        "max_change": limit,
        "regime_changed": regime_changed,
        "note": (
            "smoothing is suspended across a regime change: a real change of "
            "atmospheric state is precisely when weights should move"
        ),
    }
    return current
