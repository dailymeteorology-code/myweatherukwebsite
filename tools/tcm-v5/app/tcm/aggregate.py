"""Ensemble and multi-model aggregation.

TWO LEVELS, NOT ONE
-------------------
Section 12: ensemble members belong to one model system and are not
independent votes. So aggregation is hierarchical:

    members  ->  system distribution      (within-model uncertainty)
    systems  ->  multi-model probability  (between-model uncertainty)

Thirty MOGREPS members contribute ONE system-level probability plus a
spread. Flattening them into thirty votes alongside three deterministic
models would let one centre outvote the rest thirty to three.

HOW MEMBERS BECOME A SYSTEM PROBABILITY
----------------------------------------
By AVERAGING THEIR PROBABILITIES, not by counting how many exceed a
threshold.

Counting is the familiar operational form -- "20 of 30 members support
thunderstorms, so 67%" -- and section 11 warns about it directly: it needs a
threshold, and turning a threshold into an event probability requires that
the threshold have been validated. It also throws away information, since a
member at 0.49 and one at 0.01 count identically.

Under exchangeability the mean of the members' probabilities IS the
system's predictive probability, with no threshold and no discarded
information. The member fraction is still reported, with its threshold
stated, because forecasters read it and because it is a useful diagnostic
of distribution shape.

HOW SYSTEMS COMBINE
-------------------
Linear pooling -- a weighted mean of probabilities -- by default.

The alternative, logarithmic pooling (a weighted geometric mean of odds), is
sharper and is the right form when the sources are independent evidence
about one truth. NWP models are not that. They share observations,
assimilation heritage and physics, and section 49 says so explicitly; log
pooling on correlated sources produces overconfidence, which for a
probability forecast is the worst failure mode there is.

Linear pooling also does the right thing with scenarios (section 16): the
mixture of a 5% model and a 70% model is genuinely bimodal evidence, and
linear pooling keeps the resulting probability between them rather than
sharpening towards one.

Both are implemented and `evaluate.py` scores them against each other, as
Stage 6 did with its reliability maps. The default is the conservative one
until evidence says otherwise.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field as dc_field
from enum import Enum

import numpy as np

from ..skill.identity import ModelIdentity, effective_independent_count
from ..skill.weights import WeightSet
from .stages import SourceForecast

log = logging.getLogger(__name__)

#: Percentiles reported for every ensemble distribution.
PERCENTILES = (10, 25, 50, 75, 90)

#: Threshold used for the reported member fraction. Explicit and
#: DIAGNOSTIC: the system probability does not depend on it.
MEMBER_SUPPORT_THRESHOLD = 0.30


class Pooling(str, Enum):
    """How system probabilities combine."""

    #: Weighted mean of probabilities. Treats models as alternative
    #: scenarios; cannot become more confident than its most confident
    #: input. The default.
    LINEAR = "linear"
    #: Weighted geometric mean of odds. Treats models as independent
    #: evidence and sharpens accordingly -- which is wrong for correlated
    #: NWP and produces overconfidence.
    LOGARITHMIC = "logarithmic"


@dataclass(slots=True)
class SystemDistribution:
    """One model system's forecast, including its ensemble spread."""

    model: str
    identity: ModelIdentity | None
    #: The system's probability: the mean over members, or the single
    #: deterministic value.
    probability: float
    n_members: int
    #: Full member distribution, preserved rather than summarised away.
    members: tuple[float, ...] = ()
    percentiles: dict[int, float] = dc_field(default_factory=dict)
    spread: float | None = None
    iqr: float | None = None
    #: Fraction of members above MEMBER_SUPPORT_THRESHOLD. Diagnostic only.
    member_fraction: float | None = None
    #: True when the member distribution is far from Gaussian, so mean and
    #: spread do not describe it. Section 10.
    non_gaussian: bool = False
    notes: tuple[str, ...] = ()

    @property
    def is_ensemble(self) -> bool:
        return self.n_members > 1

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "probability": round(self.probability, 5),
            "n_members": self.n_members,
            "percentiles": {
                str(k): round(v, 5) for k, v in self.percentiles.items()
            },
            "spread": round(self.spread, 5) if self.spread is not None
            else None,
            "iqr": round(self.iqr, 5) if self.iqr is not None else None,
            "member_fraction_above_threshold": (
                round(self.member_fraction, 4)
                if self.member_fraction is not None else None
            ),
            "member_threshold": MEMBER_SUPPORT_THRESHOLD,
            "non_gaussian": self.non_gaussian,
            "members": [round(m, 5) for m in self.members],
            "notes": list(self.notes),
            "member_note": (
                "the system probability is the MEAN of member probabilities, "
                "not the fraction above a threshold. The fraction is "
                "reported as a diagnostic and its threshold is stated"
            ),
        }


def summarise_members(
    model: str, forecasts: list[SourceForecast],
    *, identity: ModelIdentity | None = None,
) -> SystemDistribution | None:
    """Collapse one system's members into a distribution."""
    values = [
        f.probability for f in forecasts
        if f.probability is not None and math.isfinite(f.probability)
    ]
    if not values:
        return None

    array = np.array(values, dtype="float64")
    notes: list[str] = []

    if array.size == 1:
        return SystemDistribution(
            model=model, identity=identity, probability=float(array[0]),
            n_members=1, members=(float(array[0]),),
        )

    percentiles = {
        p: float(np.percentile(array, p)) for p in PERCENTILES
    }
    spread = float(np.std(array, ddof=1))
    iqr = float(percentiles[75] - percentiles[25])
    mean = float(np.mean(array))
    median = percentiles[50]

    # Mean far from median, or a wide spread relative to the range, means
    # mean-and-spread do not describe this distribution. Section 10.
    non_gaussian = False
    if spread > 1e-9:
        skew_proxy = abs(mean - median) / spread
        if skew_proxy > 0.4:
            non_gaussian = True
            notes.append(
                f"the member distribution is skewed (mean {mean:.3f} against "
                f"median {median:.3f}); mean and spread do not describe it "
                f"and the percentiles should be used"
            )
    if array.size >= 4:
        gaps = np.diff(np.sort(array))
        if gaps.size and gaps.max() > 3.0 * max(np.median(gaps), 1e-9):
            non_gaussian = True
            notes.append(
                "the members separate into groups rather than spreading "
                "around one value; this is a scenario split, not spread"
            )

    return SystemDistribution(
        model=model, identity=identity, probability=mean,
        n_members=int(array.size), members=tuple(float(v) for v in array),
        percentiles=percentiles, spread=spread, iqr=iqr,
        member_fraction=float(
            np.count_nonzero(array >= MEMBER_SUPPORT_THRESHOLD) / array.size
        ),
        non_gaussian=non_gaussian, notes=tuple(notes),
    )


@dataclass(slots=True)
class Aggregation:
    """The multi-model result and everything behind it."""

    #: The raw multi-model probability. UNCALIBRATED.
    probability: float | None
    pooling: Pooling
    systems: dict[str, SystemDistribution] = dc_field(default_factory=dict)
    #: Weight actually applied to each system.
    applied_weights: dict[str, float] = dc_field(default_factory=dict)
    #: Systems that contributed nothing, and why.
    excluded: dict[str, str] = dc_field(default_factory=dict)

    # -- uncertainty, kept in its components (section 17) -----------------
    within_model: float | None = None      # mean ensemble spread
    between_model: float | None = None     # inter-system spread
    effective_independent: float = 0.0
    reason: str = ""
    notes: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.probability is not None

    def to_dict(self) -> dict:
        return {
            "probability": (
                round(self.probability, 5) if self.probability is not None
                else None
            ),
            "pooling": self.pooling.value,
            "pooling_note": (
                "linear pooling: a weighted MEAN of probabilities. Models "
                "share observations, assimilation and physics, so treating "
                "them as independent evidence (logarithmic pooling) would "
                "produce overconfidence -- the worst failure mode a "
                "probability forecast has"
            ),
            "systems": {k: v.to_dict() for k, v in self.systems.items()},
            "applied_weights": {
                k: round(v, 4) for k, v in self.applied_weights.items()
            },
            "excluded": dict(self.excluded),
            "uncertainty_components": {
                "within_model_spread": (
                    round(self.within_model, 5)
                    if self.within_model is not None else None
                ),
                "between_model_spread": (
                    round(self.between_model, 5)
                    if self.between_model is not None else None
                ),
                "note": (
                    "kept separate. Ensemble spread and inter-model "
                    "disagreement are different uncertainties with different "
                    "remedies, and collapsing them loses that"
                ),
            },
            "effective_independent_systems": round(
                self.effective_independent, 3
            ),
            "reason": self.reason,
            "notes": list(self.notes),
        }


def _weight_for(model: str, weights: WeightSet, identities: dict):
    """Find the Stage 6 weight for a platform model id.

    Matching is by IDENTITY KEY first, because a platform id and an
    identity's model name are not the same string -- "ecmwf" identifies a
    model whose `.model` is "ifs". Matching on the model name alone missed
    it entirely.
    """
    identity = identities.get(model)
    if identity is not None:
        found = weights.weights.get(identity.key)
        if found is not None:
            return found
        for candidate in weights.weights.values():
            if candidate.model.system_key == identity.system_key:
                return candidate
    found = weights.weights.get(model)
    if found is not None:
        return found
    return next(
        (w for w in weights.weights.values() if w.model.model == model),
        None,
    )


def aggregate(
    forecasts: list[SourceForecast],
    weights: WeightSet | None,
    *,
    identities: dict[str, ModelIdentity] | None = None,
    pooling: Pooling = Pooling.LINEAR,
) -> Aggregation:
    """Combine per-source forecasts into one multi-model probability.

    `weights` come from Stage 6 and are used AS WEIGHTS -- section 14. They
    are not multiplied into the probability as though they were themselves
    probabilities or confidences.
    """
    identities = identities or {}

    # -- level 1: members to systems --------------------------------------
    by_model: dict[str, list[SourceForecast]] = {}
    for forecast in forecasts:
        by_model.setdefault(forecast.model, []).append(forecast)

    systems: dict[str, SystemDistribution] = {}
    excluded: dict[str, str] = {}
    for model, group in by_model.items():
        distribution = summarise_members(
            model, group, identity=identities.get(model)
        )
        if distribution is None:
            excluded[model] = (
                group[0].reason or "no member produced a usable probability"
            )
            continue
        systems[model] = distribution

    if not systems:
        return Aggregation(
            probability=None, pooling=pooling, excluded=excluded,
            reason=(
                "no model system produced a usable thunderstorm probability. "
                "This is NOT a forecast of zero -- it is an inability to "
                "forecast, and must not be presented as 0%"
            ),
        )

    # -- level 2: systems to one probability -------------------------------
    applied: dict[str, float] = {}
    notes_early: list[str] = []
    for model in systems:
        if weights is None:
            applied[model] = 1.0
            continue
        entry = _weight_for(model, weights, identities)
        if entry is None:
            # Do NOT silently give it full weight. Matching on the identity's
            # `.model` alone did exactly that: the platform id "ecmwf" maps to
            # an identity whose model is "ifs", the lookup missed, and an
            # INELIGIBLE model was carried at full weight. A source Stage 6
            # never assessed is excluded and said so.
            excluded[model] = (
                "no Stage 6 weight could be matched to this source, so it "
                "was not assessed for eligibility and is not used"
            )
            applied[model] = 0.0
            notes_early.append(
                f"{model} had no matching Stage 6 weight and was excluded "
                f"rather than assumed reliable"
            )
        elif not entry.eligible:
            excluded[model] = entry.exclusion or "ineligible in Stage 6"
            applied[model] = 0.0
        else:
            applied[model] = float(entry.weight)

    contributing = {
        model: applied[model] for model in systems if applied.get(model, 0) > 0
    }
    notes: list[str] = list(notes_early)
    if not contributing:
        # Every system was ruled ineligible. Falling back to equal weights
        # would silently override Stage 6's judgement, so it does not
        # happen; the aggregation declines instead.
        return Aggregation(
            probability=None, pooling=pooling, systems=systems,
            excluded=excluded,
            reason=(
                "every model system was ruled ineligible by Stage 6. "
                "Re-weighting them equally would override that judgement "
                "silently, so no probability is produced"
            ),
        )

    total = sum(contributing.values())
    normalised = {k: v / total for k, v in contributing.items()}
    probabilities = np.array(
        [systems[k].probability for k in normalised], dtype="float64"
    )
    weight_array = np.array(list(normalised.values()), dtype="float64")

    if pooling is Pooling.LINEAR:
        probability = float(np.sum(weight_array * probabilities))
    else:
        odds = probabilities / np.clip(1.0 - probabilities, 1e-9, None)
        log_odds = float(np.sum(weight_array * np.log(np.clip(odds, 1e-12,
                                                              None))))
        probability = float(1.0 / (1.0 + math.exp(-log_odds)))
        notes.append(
            "logarithmic pooling treats the models as independent evidence. "
            "They are not, and this will be overconfident"
        )

    # -- uncertainty components, kept apart -------------------------------
    spreads = [
        s.spread for s in systems.values()
        if s.spread is not None and s.is_ensemble
    ]
    within = float(np.mean(spreads)) if spreads else None
    between = (
        float(np.std(probabilities, ddof=1))
        if probabilities.size > 1 else None
    )

    effective, _ = effective_independent_count([
        identities[m] for m in normalised if m in identities
    ]) if identities else (float(len(normalised)), {})

    if len(normalised) == 1:
        notes.append(
            "one model system contributed. There is no inter-model "
            "uncertainty to measure, which is not the same as agreement"
        )

    return Aggregation(
        probability=probability, pooling=pooling, systems=systems,
        applied_weights=normalised, excluded=excluded,
        within_model=within, between_model=between,
        effective_independent=effective, notes=tuple(notes),
    )


@dataclass(slots=True)
class Scenario:
    """A distinct forecast solution, preserved rather than averaged away."""

    label: str
    members: tuple[str, ...]
    probability: float
    share: float

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "sources": list(self.members),
            "probability": round(self.probability, 5),
            "share_of_sources": round(self.share, 4),
        }


def scenarios(aggregation: Aggregation) -> list[Scenario]:
    """Distinct solutions among the contributing systems.

    Section 16: where models produce genuinely different solutions, the
    mixture of them is not a forecast either model made, and averaging can
    produce a middle value that is physically impossible. The split is
    detected by the same within-group criterion Stage 6 uses -- comparing
    the gap between groups with how tightly each group holds together,
    because the overall spread is inflated by the split itself.
    """
    if len(aggregation.systems) < 4:
        return []
    labels = list(aggregation.systems)
    values = np.array(
        [aggregation.systems[k].probability for k in labels], dtype="float64"
    )
    order = np.argsort(values)
    sorted_values = values[order]
    gaps = np.diff(sorted_values)
    if gaps.size == 0:
        return []

    largest = int(np.argmax(gaps))
    left, right = order[: largest + 1], order[largest + 1:]
    if min(left.size, right.size) < 2:
        return []

    within = max(
        float(np.std(values[left])), float(np.std(values[right])), 1e-9
    )
    if gaps[largest] / within < 3.0:
        return []

    total = values.size
    return [
        Scenario(
            label=label,
            members=tuple(sorted(labels[i] for i in group)),
            probability=float(np.mean(values[group])),
            share=float(group.size / total),
        )
        for label, group in (("lower", left), ("higher", right))
    ]
