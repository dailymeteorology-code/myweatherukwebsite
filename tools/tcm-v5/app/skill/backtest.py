"""Walk-forward backtesting: does adaptive weighting actually help?

Section 71 makes this mandatory and section 72 states the standard plainly:
if adaptive weighting does not beat a simpler baseline, it must not be
deployed merely because it is more sophisticated. This module is what
answers that, and it is built to be able to return "no".

WHAT THE COMBINATION HERE IS, AND IS NOT
-----------------------------------------
Evaluating weights requires combining forecasts with them — otherwise there
is nothing to score. This module therefore does compute a weighted mean.

That is an EVALUATION HARNESS. It is not the Stage 7 aggregation layer, it
produces no forecast product, nothing outside this module calls it, and it
deliberately implements the simplest possible combination so that any
measured improvement is attributable to the WEIGHTS rather than to a clever
combination rule. Section 86 forbids building the final aggregation here, and
scoring a weighting scheme without ever applying it would make section 71
impossible to satisfy.

WALK-FORWARD, NOT SHUFFLED
--------------------------
At each step the weights are built with `as_of` set to the forecast's issue
time, so only verification that existed then can influence them. The skill
store then absorbs that step's outcome and the window moves on.

Randomly shuffling cases into train and test — the default in most ML
tooling — is catastrophic here in two separate ways: it lets tomorrow's
verification set today's weights, and it puts adjacent hours of the same
convective outbreak on both sides of the split, so the test set is nearly a
copy of the training set. `leakage_report()` checks the first explicitly.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta

import numpy as np

from . import metrics as mx
from . import weights as weighting
from .eligibility import Eligibility
from .identity import ModelIdentity
from .metrics import Direction, ForecastKind
from .store import SkillStore, region_of
from .verification import (
    ForecastRecord, ObservationRecord, VerificationPair, lead_band_of,
    season_of,
)

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Case:
    """One forecast opportunity: several models, one truth."""

    valid_time: datetime
    issued_at: datetime
    latitude: float
    longitude: float
    variable: str
    #: One value per model.
    forecasts: dict[ModelIdentity, float]
    observation: ObservationRecord
    regime: str = ""

    @property
    def lead_hours(self) -> float:
        return (self.valid_time - self.issued_at).total_seconds() / 3600.0


@dataclass(slots=True)
class SchemeResult:
    """How one weighting scheme performed."""

    name: str
    errors: list[float] = dc_field(default_factory=list)
    #: Errors labelled by stratum, for the required breakdowns.
    by_regime: dict[str, list[float]] = dc_field(default_factory=dict)
    by_region: dict[str, list[float]] = dc_field(default_factory=dict)
    by_lead: dict[str, list[float]] = dc_field(default_factory=dict)
    by_season: dict[str, list[float]] = dc_field(default_factory=dict)

    def record(self, case: Case, error: float) -> None:
        self.errors.append(error)
        band = lead_band_of(case.lead_hours)
        self.by_regime.setdefault(case.regime or "unclassified", []).append(error)
        self.by_region.setdefault(
            region_of(case.latitude, case.longitude), []
        ).append(error)
        self.by_lead.setdefault(
            f"{band[0]:.0f}-{band[1]:.0f}h", []
        ).append(error)
        self.by_season.setdefault(
            season_of(case.valid_time), []
        ).append(error)

    @property
    def mae(self) -> float | None:
        return float(np.mean(np.abs(self.errors))) if self.errors else None

    @property
    def rmse(self) -> float | None:
        if not self.errors:
            return None
        return float(np.sqrt(np.mean(np.square(self.errors))))

    @property
    def bias(self) -> float | None:
        return float(np.mean(self.errors)) if self.errors else None

    def stratified(self, group: dict[str, list[float]]) -> dict:
        return {
            key: {
                "n": len(values),
                "mae": round(float(np.mean(np.abs(values))), 4),
                # A stratum of a handful of cases cannot support a claim,
                # and section 77 is explicit about rare events.
                "sufficient": len(values) >= 30,
            }
            for key, values in sorted(group.items())
        }

    def to_dict(self) -> dict:
        return {
            "scheme": self.name,
            "n": len(self.errors),
            "mae": round(self.mae, 4) if self.mae is not None else None,
            "rmse": round(self.rmse, 4) if self.rmse is not None else None,
            "bias": round(self.bias, 4) if self.bias is not None else None,
            "by_regime": self.stratified(self.by_regime),
            "by_region": self.stratified(self.by_region),
            "by_lead": self.stratified(self.by_lead),
            "by_season": self.stratified(self.by_season),
        }


@dataclass(slots=True)
class BacktestReport:
    """The comparison, and whether it justifies deploying anything."""

    schemes: dict[str, SchemeResult] = dc_field(default_factory=dict)
    baseline: str = "equal"
    cases: int = 0
    leakage: dict = dc_field(default_factory=dict)
    notes: list[str] = dc_field(default_factory=list)

    def improvement(self, scheme: str) -> dict:
        """Improvement over the baseline, with the honest caveats."""
        target = self.schemes.get(scheme)
        reference = self.schemes.get(self.baseline)
        if target is None or reference is None:
            return {"available": False, "reason": "scheme not evaluated"}
        if target.mae is None or reference.mae is None or reference.mae == 0:
            return {"available": False, "reason": "no usable errors"}

        relative = 1.0 - target.mae / reference.mae

        # A paired test, because the schemes saw the same cases. Without
        # pairing the comparison would be dominated by case-to-case
        # variability rather than by the difference between schemes.
        paired = None
        if len(target.errors) == len(reference.errors) and target.errors:
            differences = np.abs(reference.errors) - np.abs(target.errors)
            spread = float(np.std(differences, ddof=1)) \
                if differences.size > 1 else 0.0
            if spread > 0:
                paired = float(
                    np.mean(differences) / (spread / np.sqrt(differences.size))
                )

        return {
            "available": True,
            "scheme": scheme,
            "baseline": self.baseline,
            "mae": round(target.mae, 4),
            "baseline_mae": round(reference.mae, 4),
            "relative_improvement": round(relative, 4),
            "paired_t": round(paired, 3) if paired is not None else None,
            "n": len(target.errors),
            "verdict": self._verdict(relative, paired, len(target.errors)),
        }

    def _verdict(self, relative, paired, n) -> str:
        if n < 100:
            return (
                f"INSUFFICIENT EVIDENCE: {n} cases cannot support a "
                f"deployment decision either way"
            )
        if relative <= 0:
            return (
                "DO NOT DEPLOY: no better than the baseline. Section 72 -- "
                "sophistication is not a reason to deploy"
            )
        if paired is not None and abs(paired) < 2.0:
            return (
                f"NOT SIGNIFICANT: {relative:.1%} better, but a paired t of "
                f"{paired:.2f} means that is within sampling noise"
            )
        return (
            f"IMPROVEMENT: {relative:.1%} lower MAE than the baseline, "
            f"paired t = {paired:.2f}" if paired is not None
            else f"IMPROVEMENT: {relative:.1%} lower MAE than the baseline"
        )

    def to_dict(self) -> dict:
        return {
            "cases": self.cases,
            "baseline": self.baseline,
            "schemes": {k: v.to_dict() for k, v in self.schemes.items()},
            "comparisons": {
                name: self.improvement(name)
                for name in self.schemes if name != self.baseline
            },
            "leakage_check": self.leakage,
            "notes": self.notes,
            "combination_note": (
                "the weighted mean used to score these schemes is an "
                "EVALUATION HARNESS, not the Stage 7 aggregation layer. It "
                "is deliberately the simplest possible combination so that "
                "any improvement is attributable to the weights"
            ),
        }


def combine(values: dict[str, float], weight_set) -> float | None:
    """Weighted mean. The evaluation harness -- see the module docstring."""
    total = 0.0
    accumulated = 0.0
    for key, value in values.items():
        weight = weight_set.weights.get(key)
        if weight is None or not weight.eligible or weight.weight <= 0:
            continue
        if not np.isfinite(value):
            continue
        accumulated += weight.weight * value
        total += weight.weight
    if total <= 0:
        return None
    return accumulated / total


def walk_forward(
    cases: list[Case],
    eligibility_for,
    *,
    variable: str,
    task: str = "backtest",
    metric: str = "mae",
    direction: Direction = Direction.LOWER_IS_BETTER,
    window_days: int | None = None,
    observation_delay: timedelta = timedelta(hours=1),
) -> BacktestReport:
    """Run every scheme over the cases in time order.

    `eligibility_for(case, model)` supplies the eligibility assessment, so
    the backtest exercises the real gate rather than assuming everything is
    eligible.

    `observation_delay` is how long after the valid time an observation
    becomes usable. It defaults to an hour rather than zero because zero
    would let a forecast be weighted by verification of itself.
    """
    ordered = sorted(cases, key=lambda c: (c.issued_at, c.valid_time))
    store = SkillStore()
    report = BacktestReport()

    # Every reliability map is scored side by side, so the choice of
    # functional form is settled by evidence rather than asserted --
    # sections 36 and 37.
    maps = {
        "adaptive_precision": weighting.ReliabilityMap.PRECISION,
        "adaptive_inverse": weighting.ReliabilityMap.INVERSE_ERROR,
        "adaptive_relative": weighting.ReliabilityMap.RELATIVE,
    }
    for name in ("equal", "best_single", *maps):
        report.schemes[name] = SchemeResult(name)

    earliest_use: list[tuple[datetime, datetime]] = []

    for case in ordered:
        candidates = [
            eligibility_for(case, model) for model in case.forecasts
        ]
        as_of = case.issued_at

        # -- equal-weight baseline -----------------------------------------
        equal = weighting.equal_weights(
            candidates, task, variable, case.valid_time, as_of
        )
        _score(report.schemes["equal"], case, equal)

        # -- adaptive, one run per reliability map --------------------------
        adaptive = None
        for name, mapping in maps.items():
            weighted = weighting.compute(
                task, variable, candidates, store,
                as_of=as_of, valid_time=case.valid_time,
                latitude=case.latitude, longitude=case.longitude,
                regime=case.regime, lead_hours=case.lead_hours,
                metric=metric, direction=direction, mapping=mapping,
                window_days=window_days,
            )
            _score(report.schemes[name], case, weighted)
            if adaptive is None:
                adaptive = weighted

        # -- single best model, by history --------------------------------
        best = max(
            adaptive.eligible, key=lambda w: w.weight, default=None
        ) if adaptive.eligible else None
        if best is not None:
            value = {
                identity.key: v for identity, v in case.forecasts.items()
            }.get(best.model.key)
            if value is not None and np.isfinite(value):
                report.schemes["best_single"].record(
                    case, value - case.observation.value
                )

        # -- the outcome enters the store, dated when it became usable -----
        available = case.valid_time + observation_delay
        observation = ObservationRecord(
            variable=case.observation.variable,
            value=case.observation.value,
            observed_at=case.observation.observed_at,
            available_at=max(case.observation.available_at, available),
            latitude=case.observation.latitude,
            longitude=case.observation.longitude,
            source=case.observation.source,
            quality=case.observation.quality,
            quality_notes=case.observation.quality_notes,
        )
        for identity, value in case.forecasts.items():
            if not np.isfinite(value):
                continue
            store.add(VerificationPair(
                forecast=ForecastRecord(
                    model=identity, variable=variable, value=value,
                    issued_at=case.issued_at, valid_time=case.valid_time,
                    latitude=case.latitude, longitude=case.longitude,
                    regime=case.regime,
                ),
                observation=observation,
                separation_km=0.0, time_offset_minutes=0.0,
            ))
        earliest_use.append((as_of, observation.available_at))

        report.cases += 1

    report.leakage = leakage_report(earliest_use)
    if report.cases < 100:
        report.notes.append(
            f"only {report.cases} cases: too few to support a deployment "
            f"decision, whatever the numbers say"
        )
    return report


def _score(scheme: SchemeResult, case: Case, weight_set) -> None:
    values = {
        identity.key: value for identity, value in case.forecasts.items()
    }
    combined = combine(values, weight_set)
    if combined is not None and np.isfinite(combined):
        scheme.record(case, combined - case.observation.value)


def leakage_report(pairs: list[tuple[datetime, datetime]]) -> dict:
    """Confirm no weight was built from evidence that did not yet exist.

    Checks that every observation added to the store became available AFTER
    the forecast whose weights it could have influenced was issued. Section
    41 requires this to be tested explicitly rather than assumed, because
    nothing fails visibly when it is violated -- the backtest simply looks
    better than the system can ever be.
    """
    violations = [
        (issued.isoformat(), available.isoformat())
        for issued, available in pairs
        if available <= issued
    ]
    return {
        "checked": len(pairs),
        "violations": len(violations),
        "examples": violations[:5],
        "clean": not violations,
        "meaning": (
            "a violation means an observation was usable for weighting at or "
            "before the forecast it would have weighted was issued. That is "
            "future information, and it inflates apparent skill without "
            "anything failing"
        ),
    }


def stress(
    cases: list[Case], eligibility_for, *, variable: str,
) -> dict:
    """Section 78/79: what happens when things go wrong.

    Each scenario is constructed rather than hoped for, and the check is
    that the system produces something explainable rather than that it
    produces a particular number.
    """
    from .eligibility import Ineligible

    store = SkillStore()
    case = cases[0]
    as_of = case.issued_at
    results = {}

    def weights_for(candidates, label):
        weight_set = weighting.compute(
            "stress", variable, candidates, store,
            as_of=as_of, valid_time=case.valid_time,
            latitude=case.latitude, longitude=case.longitude,
        )
        eligible = weight_set.eligible
        return {
            "eligible_models": len(eligible),
            "weights": {
                w.model.key: round(w.weight, 4) for w in eligible
            },
            "sums_to_one": abs(weight_set.total - 1.0) < 1e-6 if eligible
            else None,
            "every_exclusion_explained": all(
                w.exclusion for w in weight_set.weights.values()
                if not w.eligible
            ),
        }

    all_candidates = [eligibility_for(case, m) for m in case.forecasts]
    results["all_available"] = weights_for(all_candidates, "all")

    # One model disappears.
    if len(all_candidates) > 1:
        reduced = [
            Eligibility(
                model=c.model, eligible=False,
                reasons=((Ineligible.UNAVAILABLE, "withheld for stress test"),),
            ) if index == 0 else c
            for index, c in enumerate(all_candidates)
        ]
        results["one_model_missing"] = weights_for(reduced, "one missing")

    # Only one model left.
    single = [all_candidates[0]] + [
        Eligibility(
            model=c.model, eligible=False,
            reasons=((Ineligible.UNAVAILABLE, "withheld for stress test"),),
        )
        for c in all_candidates[1:]
    ]
    results["single_model"] = weights_for(single, "single")

    # No model eligible at all.
    none_eligible = [
        Eligibility(
            model=c.model, eligible=False,
            reasons=((Ineligible.STALE, "all runs stale"),),
        )
        for c in all_candidates
    ]
    results["no_model_eligible"] = weights_for(none_eligible, "none")

    # An entirely new model with no history.
    results["cold_start"] = {
        "note": (
            "a model with no verification receives the median reliability of "
            "those that have some, flagged cold_start with high uncertainty. "
            "Not the maximum, which would reward having no record, and not "
            "zero, which would prevent it ever earning one"
        ),
    }
    return results
