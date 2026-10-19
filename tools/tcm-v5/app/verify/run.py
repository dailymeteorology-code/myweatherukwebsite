"""Running a verification, and recording exactly what was run.

Sections 21, 22, 58, 84 and 98 of the Stage 9 order.

Section 58 requires every verification result to record the observation
dataset version, the algorithm version, the event definition, and the
spatial and temporal matching methods -- because changing any of them
changes what the score means, and two scores computed under different
conditions must not be compared as though nothing had changed.

So `VerificationResult` carries all of it, and `comparable_with` refuses a
comparison between results whose conditions differ, naming the difference.
That is the mechanism section 70 needs to answer "did V5.1 improve on V5.0"
honestly: the question is only answerable when the conditions match.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from . import baselines as B
from . import metrics as M
from .matching import MatchedField, MatchPolicy, effective_sample
from .observations import OBSERVATION_VERSION, QualityControl

log = logging.getLogger(__name__)

VERIFICATION_VERSION = "stage9.1"


@dataclass(frozen=True, slots=True)
class VerificationConditions:
    """Section 58. Everything that changes what a score MEANS."""

    event_definition: str
    observation_dataset: str
    observation_version: str
    verification_version: str
    quality_control: dict
    matching: dict
    #: What was forecast, e.g. "thunderstorm" or "hail".
    target: str

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "event_definition": self.event_definition,
            "observation_dataset": self.observation_dataset,
            "observation_version": self.observation_version,
            "verification_version": self.verification_version,
            "quality_control": self.quality_control,
            "matching": self.matching,
        }

    def differences_from(self, other: "VerificationConditions") -> list[str]:
        out: list[str] = []
        for name in (
            "target", "event_definition", "observation_dataset",
            "observation_version", "verification_version",
        ):
            mine, theirs = getattr(self, name), getattr(other, name)
            if mine != theirs:
                out.append(f"{name}: {theirs!r} vs {mine!r}")
        if self.matching != other.matching:
            out.append("matching method differs")
        if self.quality_control != other.quality_control:
            out.append("observation quality control differs")
        return out


@dataclass(slots=True)
class VerificationResult:
    """Section 98's record, adapted to this architecture."""

    conditions: VerificationConditions
    #: What was verified.
    forecast_source: str
    valid_from: datetime | None
    valid_to: datetime | None
    lead_hours: tuple[int, ...] = ()

    scores: dict[str, M.Score] = dc_field(default_factory=dict)
    skill_vs: dict[str, M.Score] = dc_field(default_factory=dict)
    reliability: dict = dc_field(default_factory=dict)
    sharpness: dict = dc_field(default_factory=dict)
    decomposition: dict = dc_field(default_factory=dict)
    contingencies: list[dict] = dc_field(default_factory=list)
    sample: dict = dc_field(default_factory=dict)
    coverage: dict = dc_field(default_factory=dict)
    baseline_scores: dict[str, M.Score] = dc_field(default_factory=dict)
    warnings: list[str] = dc_field(default_factory=list)

    def comparable_with(self, other: "VerificationResult") -> dict:
        """Section 70. May these two results be compared at all?"""
        differences = self.conditions.differences_from(other.conditions)
        return {
            "comparable": not differences,
            "differences": differences,
            "note": (
                "two verification results computed under different "
                "conditions are not comparable, and a difference between "
                "them is not evidence of a change in skill"
                if differences else
                "conditions match, so the difference between these results "
                "reflects the forecasts rather than the method"
            ),
        }

    def to_dict(self) -> dict:
        return {
            "forecast_source": self.forecast_source,
            "period": {
                "from": (
                    self.valid_from.isoformat() if self.valid_from else None
                ),
                "to": self.valid_to.isoformat() if self.valid_to else None,
                "lead_hours": list(self.lead_hours),
            },
            "conditions": self.conditions.to_dict(),
            "sample": self.sample,
            "observation_coverage": self.coverage,
            "scores": {k: v.to_dict() for k, v in self.scores.items()},
            "skill_vs_baseline": {
                k: v.to_dict() for k, v in self.skill_vs.items()
            },
            "baseline_scores": {
                k: v.to_dict() for k, v in self.baseline_scores.items()
            },
            "reliability": self.reliability,
            "sharpness": self.sharpness,
            "brier_decomposition": self.decomposition,
            "thresholds": self.contingencies,
            "warnings": self.warnings,
        }


def verify(
    fields: list[MatchedField], *, forecast_source: str, target: str,
    event_definition: str, policy: MatchPolicy | None = None,
    qc: QualityControl | None = None,
    climatology: B.Climatology | None = None,
    lead_hours: tuple[int, ...] = (),
    observation_dataset: str = "blitzortung_archive",
) -> VerificationResult:
    """Score a set of matched fields against every baseline.

    Every metric in section 21 that the sample supports, plus the reliability
    and sharpness that section 28 requires be read together, plus the
    effective sample size that section 60 requires them to be read against.
    """
    policy = policy or MatchPolicy()
    qc = qc or QualityControl()
    conditions = VerificationConditions(
        event_definition=event_definition,
        observation_dataset=observation_dataset,
        observation_version=OBSERVATION_VERSION,
        verification_version=VERIFICATION_VERSION,
        quality_control=qc.to_dict(),
        matching=policy.to_dict(),
        target=target,
    )

    usable = [f for f in fields if f.n_usable > 0]
    result = VerificationResult(
        conditions=conditions, forecast_source=forecast_source,
        valid_from=min((f.valid_time for f in usable), default=None),
        valid_to=max((f.valid_time for f in usable), default=None),
        lead_hours=lead_hours,
    )

    if not usable:
        result.warnings.append(
            "no hour had both a forecast and a usable observation, so "
            "nothing could be scored. This is an absence of verification, "
            "not a verification of zero skill"
        )
        return result

    forecast = np.concatenate([f.pairs()[0] for f in usable])
    observed = np.concatenate([f.pairs()[1] for f in usable])

    sample = effective_sample(usable)
    result.sample = sample
    n_effective = sample.get("effective_cells")

    result.coverage = {
        "hours": len(usable),
        "mean_coverage": round(
            float(np.mean([f.coverage for f in usable])), 4
        ),
        "degraded_hours": sum(
            1 for f in usable if f.observation_quality.value != "valid"
        ),
        "total_flashes": sum(f.flash_count for f in usable),
    }

    result.scores["brier_score"] = M.brier_score(
        forecast, observed, target=target, n_effective=n_effective)
    result.scores["roc_auc"] = M.roc_auc(
        forecast, observed, target=target, n_effective=n_effective)
    result.scores["pr_auc"] = M.pr_auc(
        forecast, observed, target=target, n_effective=n_effective)

    result.reliability = M.reliability(forecast, observed, target=target)
    result.sharpness = M.sharpness(forecast, target=target)
    result.decomposition = M.brier_decomposition(
        forecast, observed, target=target)
    result.contingencies = [
        c.to_dict() for c in M.threshold_sweep(forecast, observed)
    ]

    # -- baselines ---------------------------------------------------------
    climatology = climatology or B.climatology_from(usable)
    overlap = B.check_disjoint(
        climatology, result.valid_from, result.valid_to
    )
    if overlap:
        result.warnings.append(overlap)

    baseline_sets = B.build(usable, climatology)
    for name in ("climatology", "always_zero", "persistence"):
        stacked = []
        for field, baseline in zip(usable, baseline_sets):
            stacked.append(baseline.grids[name][field.usable])
        reference = np.concatenate(stacked)
        keep = np.isfinite(reference)
        if not keep.any():
            continue
        result.baseline_scores[name] = M.brier_score(
            reference[keep], observed[keep], target=target,
            n_effective=n_effective,
        )
        result.skill_vs[name] = M.brier_skill_score(
            forecast[keep], observed[keep], reference[keep],
            baseline=name, target=target, n_effective=n_effective,
        )

    _add_interpretation(result)
    log.info(
        "verified %s over %d hours: BS=%s, %d events",
        forecast_source, len(usable),
        result.scores["brier_score"].value, int(observed.sum()),
    )
    return result


def _add_interpretation(result: VerificationResult) -> None:
    """The warnings that stop a number being read as more than it is."""
    brier = result.scores.get("brier_score")
    zero = result.baseline_scores.get("always_zero")

    if brier and zero and brier.available and zero.available:
        if brier.value >= zero.value:
            result.warnings.append(
                f"the forecast's Brier score ({brier.value:.5f}) is no "
                f"better than forecasting no thunderstorms at all "
                f"({zero.value:.5f}). On a domain this quiet that is the "
                f"score to beat, not climatology"
            )

    if brier and brier.n_events < 10:
        result.warnings.append(
            f"only {brier.n_events} observed event cells: every score here "
            f"describes a handful of cases and none of them is a skill "
            f"estimate"
        )

    episodes = result.sample.get("episodes", 0)
    if episodes and episodes < 5:
        result.warnings.append(
            f"the sample contains {episodes} distinct convective "
            f"episode(s). Section 60: many correlated grid cells from one "
            f"outbreak are not many independent forecast cases, and no "
            f"conclusion about skill can rest on this"
        )

    sharp = result.sharpness
    if sharp.get("available") and sharp.get("variance", 0) < 1e-6:
        result.warnings.append(
            "the forecast has almost no variance: it is climatology in "
            "disguise, and its reliability is meaningless as evidence of "
            "quality"
        )

    if result.coverage.get("degraded_hours"):
        result.warnings.append(
            f"{result.coverage['degraded_hours']} of "
            f"{result.coverage['hours']} hours had degraded observation "
            f"coverage. Occurrence is still sound; flash counts undercount"
        )
