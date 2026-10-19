"""What the current forecasts say about each other.

AGREEMENT IS NOT SKILL
----------------------
Five models can agree and all be wrong; one can disagree and be right.
Section 57. So nothing here feeds back into historical skill, and agreement
never raises a model's weight for being near the consensus. What it does is
describe the STRUCTURE of the current disagreement, which the later
aggregation stage needs and which a single standard deviation cannot express.

THE FOUR STRUCTURES, WHICH ARE NOT THE SAME SITUATION
------------------------------------------------------
    consensus     models cluster tightly. Confidence in the central value is
                  high -- though they may of course all be wrong together
    unimodal      models spread continuously around one solution. Genuine
                  uncertainty about magnitude
    multimodal    models cluster into two or more separate solutions. This
                  is NOT high uncertainty about one number; it is two
                  plausible scenarios, and averaging them produces a value
                  no model forecast and that may be physically impossible
    outlier       one model sits far from an otherwise agreed group

Section 32 is explicit that an outlier must not automatically suppress the
forecast. It may be wrong. It may equally be the only model resolving a
mesoscale feature the others miss -- which for convection over these islands
is a routine occurrence, not an edge case. So the outlier is IDENTIFIED and
reported, never removed.

ENSEMBLE MEMBERS ARE NOT MODELS
--------------------------------
Section 51. Members of one ensemble describe one system's uncertainty. They
are summarised into that system's spread and contribute ONE opinion to the
inter-model comparison, and `identity.effective_independent_count` does the
same arithmetic for the weighting engine.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field as dc_field
from enum import Enum

import numpy as np

from .identity import ModelIdentity, effective_independent_count


class Structure(str, Enum):
    CONSENSUS = "consensus"
    UNIMODAL_SPREAD = "unimodal_spread"
    MULTIMODAL = "multimodal"
    OUTLIER = "outlier"
    #: Too few forecasts to say anything about structure.
    INSUFFICIENT = "insufficient"


#: A model this many robust scale units from the median is an outlier.
#: 3.0 on the median-absolute-deviation scale is the conventional robust
#: equivalent of three standard deviations, and MAD is used rather than the
#: standard deviation precisely because one outlier inflates the latter and
#: hides itself.
OUTLIER_THRESHOLD = 3.0

#: Below this coefficient of variation the models are agreeing.
CONSENSUS_CV = 0.15

#: How many times the WITHIN-GROUP spread the gap between groups must
#: exceed for the split to be real.
#:
#: Measured against the within-group spread, not the overall spread. The
#: overall spread is inflated BY the bimodality it is being used to detect:
#: for forecasts of 200/220/250 against 1800/1820/1850 — two groups as
#: cleanly separated as anything ever gets — the median absolute deviation
#: sits in the empty middle and the gap scores only 1.3 overall spreads,
#: below any sensible threshold. Against the within-group spread the same
#: split scores over 60.
MULTIMODAL_SEPARATION = 3.0


@dataclass(slots=True)
class Agreement:
    """The structure of current inter-model disagreement."""

    variable: str
    structure: Structure
    n_forecasts: int
    n_systems: int
    effective_independent: float

    mean: float | None = None
    median: float | None = None
    spread: float | None = None            # standard deviation
    robust_spread: float | None = None     # MAD, scaled to be comparable
    iqr: float | None = None
    coefficient_of_variation: float | None = None

    #: Models sitting far from the group, with their distance in robust
    #: scale units. Identified, never removed.
    outliers: dict[str, float] = dc_field(default_factory=dict)
    #: For a multimodal split: the groups, as model keys.
    clusters: list[dict] = dc_field(default_factory=list)
    #: Per-system ensemble spread, where members were supplied.
    ensemble_spread: dict[str, float] = dc_field(default_factory=dict)
    values: dict[str, float] = dc_field(default_factory=dict)
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "variable": self.variable,
            "structure": self.structure.value,
            "n_forecasts": self.n_forecasts,
            "n_systems": self.n_systems,
            "effective_independent": self.effective_independent,
            "mean": _round(self.mean),
            "median": _round(self.median),
            "spread": _round(self.spread),
            "robust_spread": _round(self.robust_spread),
            "iqr": _round(self.iqr),
            "coefficient_of_variation": _round(
                self.coefficient_of_variation, 4
            ),
            "outliers": {k: round(v, 2) for k, v in self.outliers.items()},
            "clusters": self.clusters,
            "ensemble_spread": {
                k: _round(v) for k, v in self.ensemble_spread.items()
            },
            "values": {k: _round(v) for k, v in self.values.items()},
            "notes": list(self.notes),
            "interpretation": _interpretation(self.structure),
        }


def _round(value, digits: int = 4):
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return round(f, digits) if math.isfinite(f) else None


def _interpretation(structure: Structure) -> str:
    return {
        Structure.CONSENSUS: (
            "models cluster tightly. High confidence in the central value -- "
            "though agreement is not correctness and they may be wrong "
            "together"
        ),
        Structure.UNIMODAL_SPREAD: (
            "models spread continuously around one solution: genuine "
            "uncertainty about magnitude, not about which scenario"
        ),
        Structure.MULTIMODAL: (
            "models split into separate solutions. These are competing "
            "SCENARIOS; averaging them produces a value no model forecast "
            "and possibly one that is physically impossible"
        ),
        Structure.OUTLIER: (
            "one model sits far from an otherwise agreed group. It is "
            "identified, NOT removed: it may be wrong, or it may be the only "
            "model resolving a feature the others miss"
        ),
        Structure.INSUFFICIENT: "too few forecasts to describe a structure",
    }[structure]


def assess(
    variable: str,
    forecasts: dict[ModelIdentity, float],
    *,
    ensemble_members: dict[str, list[float]] | None = None,
) -> Agreement:
    """Describe the structure of disagreement among current forecasts.

    `forecasts` is one value per SYSTEM. Ensemble members belong in
    `ensemble_members`, keyed by system, and are summarised as that system's
    spread rather than counted as separate models.
    """
    identities = list(forecasts)
    values = np.array(
        [forecasts[i] for i in identities], dtype="float64"
    )
    ok = np.isfinite(values)
    identities = [i for i, keep in zip(identities, ok) if keep]
    values = values[ok]

    effective, _ = effective_independent_count(identities)
    ensemble_spread = {}
    if ensemble_members:
        for system, members in ensemble_members.items():
            member_values = np.asarray(members, dtype="float64")
            member_values = member_values[np.isfinite(member_values)]
            if member_values.size >= 2:
                ensemble_spread[system] = float(np.std(member_values, ddof=1))

    if values.size < 2:
        return Agreement(
            variable=variable, structure=Structure.INSUFFICIENT,
            n_forecasts=int(values.size), n_systems=len(identities),
            effective_independent=effective,
            mean=float(values[0]) if values.size else None,
            median=float(values[0]) if values.size else None,
            ensemble_spread=ensemble_spread,
            values={i.key: float(v) for i, v in zip(identities, values)},
            notes=(
                "a single forecast cannot disagree with anything; this is "
                "not consensus",
            ),
        )

    mean = float(np.mean(values))
    median = float(np.median(values))
    spread = float(np.std(values, ddof=1))
    iqr = float(np.percentile(values, 75) - np.percentile(values, 25))

    # MAD, scaled by 1.4826 so it estimates the same quantity as the
    # standard deviation for normal data. Robust: one wild model inflates
    # the standard deviation enough to hide itself, and does not affect this.
    mad = float(np.median(np.abs(values - median))) * 1.4826
    scale = mad if mad > 1e-12 else spread

    denominator = abs(mean) if abs(mean) > 1e-9 else None
    cv = spread / denominator if denominator else None

    outliers = {}
    if scale > 1e-12:
        for identity, value in zip(identities, values):
            distance = abs(value - median) / scale
            if distance > OUTLIER_THRESHOLD:
                outliers[identity.key] = float(distance)

    clusters = _cluster(identities, values, scale)
    structure, notes = _classify(
        values, cv, outliers, clusters, scale, spread
    )

    return Agreement(
        variable=variable, structure=structure, n_forecasts=int(values.size),
        n_systems=len(identities), effective_independent=effective,
        mean=mean, median=median, spread=spread, robust_spread=mad, iqr=iqr,
        coefficient_of_variation=cv, outliers=outliers, clusters=clusters,
        ensemble_spread=ensemble_spread,
        values={i.key: float(v) for i, v in zip(identities, values)},
        notes=notes,
    )


def _cluster(identities, values, scale) -> list[dict]:
    """Find groups by the largest gap in the sorted values.

    Deliberately simple: with at most a dozen forecasts, a one-dimensional
    split at the largest gap is transparent and reproducible, where k-means
    would introduce initialisation randomness for no gain. Section 83 wants
    reproducibility above sophistication.
    """
    if values.size < 4 or scale <= 1e-12:
        return []
    order = np.argsort(values)
    sorted_values = values[order]
    gaps = np.diff(sorted_values)
    if gaps.size == 0:
        return []
    largest = int(np.argmax(gaps))

    left = order[: largest + 1]
    right = order[largest + 1:]
    if min(left.size, right.size) < 2:
        # A group of one is an outlier, not a scenario.
        return []

    # Compare the gap with how tightly each candidate group holds together,
    # NOT with the overall spread -- which the bimodality itself inflates.
    within = max(
        float(np.std(values[left])), float(np.std(values[right])),
        scale * 1e-3, 1e-12,
    )
    if gaps[largest] / within < MULTIMODAL_SEPARATION:
        return []
    return [
        {
            "members": sorted(identities[i].key for i in group),
            "mean": round(float(np.mean(values[group])), 4),
            "n": int(group.size),
        }
        for group in (left, right)
    ]


def _classify(values, cv, outliers, clusters, scale, spread):
    notes: list[str] = []
    if clusters:
        notes.append(
            f"the forecasts separate into {len(clusters)} groups; these are "
            f"scenarios, and their mean is not a forecast"
        )
        return Structure.MULTIMODAL, tuple(notes)
    if outliers:
        notes.append(
            f"{len(outliers)} model(s) more than {OUTLIER_THRESHOLD} robust "
            f"scale units from the median. Identified, not removed"
        )
        return Structure.OUTLIER, tuple(notes)
    if cv is not None and cv < CONSENSUS_CV:
        notes.append(
            "close agreement. Note that agreement is not correctness: "
            "models sharing physics or assimilation agree partly because "
            "they are related"
        )
        return Structure.CONSENSUS, tuple(notes)
    if cv is None and spread < 1e-6:
        return Structure.CONSENSUS, ("all forecasts are identical",)
    return Structure.UNIMODAL_SPREAD, tuple(notes)


@dataclass(slots=True)
class RunConsistency:
    """How much a model changed between successive runs.

    Section 35: run-to-run change is INFORMATION, not proof of error. A model
    that jumps may have assimilated new observations and improved. So this
    measures and reports, and nothing here converts instability into a
    penalty.
    """

    model: str
    variable: str
    change: float | None
    previous: float | None
    current: float | None
    #: Change relative to the typical inter-model spread. Above about 1 the
    #: model has moved by more than the models disagree by.
    relative_change: float | None = None

    def to_dict(self) -> dict:
        return {
            "model": self.model, "variable": self.variable,
            "previous": _round(self.previous),
            "current": _round(self.current),
            "change": _round(self.change),
            "relative_change": _round(self.relative_change, 3),
            "note": (
                "run-to-run change is information, not error. A model may "
                "have changed because new observations entered its "
                "assimilation, which is an improvement"
            ),
        }


def run_consistency(
    model: str, variable: str, previous: float | None, current: float | None,
    *, inter_model_spread: float | None = None,
) -> RunConsistency:
    if previous is None or current is None \
            or not math.isfinite(previous) or not math.isfinite(current):
        return RunConsistency(model, variable, None, previous, current)
    change = current - previous
    relative = (
        abs(change) / inter_model_spread
        if inter_model_spread and inter_model_spread > 1e-9 else None
    )
    return RunConsistency(model, variable, change, previous, current, relative)
