"""Does the whole chain earn its complexity?

Section 62 requires the full system to be compared against progressively
simpler baselines, and section 71 requires each component to be removed in
turn to see whether it contributes anything measurable. Section 71 also
states the consequence plainly: complexity that does not provide measurable
benefit should not be retained.

THE BASELINES, IN INCREASING SOPHISTICATION
--------------------------------------------
    climatology     the base rate, forecast everywhere and always. Any
                    system that cannot beat this is worthless
    persistence     whatever happened last hour
    equal_models    the full engine chain, models weighted equally --
                    isolates what Stage 6 contributes
    full            Stage 6 adaptive weights

Comparing `full` against `equal_models` is the only way to know whether the
weighting stage pays for itself, and comparing both against `climatology` is
the only way to know whether any of it does.

WHY NEIGHBOURHOOD VERIFICATION
-------------------------------
Section 64. Scoring a 2 km probability against exact cell coincidence
punishes a storm displaced by one cell exactly as hard as a storm displaced
by a thousand kilometres. For convection that measures the placement of a
chaotic system on a fine grid and rewards forecasting nothing. Both exact
and neighbourhood scores are reported, and they usually differ a great deal.

THE HAZARD ABLATION IS THE IMPORTANT ONE
-----------------------------------------
Section 72: run the forecast with and without the hail engine and confirm
P(thunderstorm) does not move. In this architecture it CANNOT move, because
`stages.py` raises if a hazard engine reaches either thunderstorm stage. The
test verifies that the guarantee is real rather than intended.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from ..skill import metrics as mx
from ..skill.weights import WeightSet
from .aggregate import Pooling
from .probability import (
    CalibrationStatus, Calibrator, fit_calibrator, reliability_diagram,
)
from . import forecast as fc

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Outcome:
    """One forecast and what actually happened."""

    probability: float
    observed: bool
    valid_time: datetime
    latitude: float
    longitude: float
    regime: str = ""
    lead_hours: float = 0.0
    #: True when the event occurred anywhere within the neighbourhood
    #: radius, even if not in this exact cell.
    observed_nearby: bool | None = None


@dataclass(slots=True)
class Scores:
    """How one scheme performed."""

    name: str
    outcomes: list[Outcome] = dc_field(default_factory=list)

    def _arrays(self, *, neighbourhood: bool = False):
        p = np.array([o.probability for o in self.outcomes], dtype="float64")
        if neighbourhood:
            y = np.array([
                float(
                    o.observed_nearby
                    if o.observed_nearby is not None else o.observed
                )
                for o in self.outcomes
            ])
        else:
            y = np.array([float(o.observed) for o in self.outcomes])
        return p, y

    def evaluate(self, *, neighbourhood: bool = False) -> dict:
        if not self.outcomes:
            return {"available": False, "reason": "no outcomes"}
        p, y = self._arrays(neighbourhood=neighbourhood)
        base_rate = float(np.mean(y))

        brier = mx.brier_score(p, y)
        # Brier skill score against climatology. The reference is the base
        # rate forecast everywhere, which is the only fair zero point for a
        # rare event: raw Brier looks excellent for anything rare.
        climatology = float(np.mean((base_rate - y) ** 2))
        bss = (
            1.0 - brier.value / climatology
            if brier.available and climatology > 0 else None
        )

        table = mx.contingency(p, y, 0.5)
        return {
            "available": True,
            "n": len(self.outcomes),
            "base_rate": round(base_rate, 5),
            "brier": (
                round(brier.value, 6) if brier.available else None
            ),
            "brier_skill_score": (
                round(bss, 4) if bss is not None else None
            ),
            "reliability": brier.extra.get("reliability"),
            "resolution": brier.extra.get("resolution"),
            "roc_auc": _value(mx.roc_auc(p, y)),
            "pod": _value(mx.probability_of_detection(table)),
            "far": _value(mx.false_alarm_ratio(table)),
            "csi": _value(mx.critical_success_index(table)),
            "sharpness": round(float(np.var(p)), 5),
            "verification": (
                "neighbourhood" if neighbourhood else "exact cell"
            ),
        }

    def by_regime(self) -> dict:
        groups: dict[str, list[Outcome]] = {}
        for outcome in self.outcomes:
            groups.setdefault(outcome.regime or "unclassified", []).append(
                outcome
            )
        return {
            regime: {
                **Scores(regime, items).evaluate(),
                # Section 68: a handful of severe events proves nothing.
                "sufficient": len(items) >= 50,
            }
            for regime, items in sorted(groups.items())
        }

    def to_dict(self) -> dict:
        return {
            "scheme": self.name,
            "exact": self.evaluate(),
            "neighbourhood": self.evaluate(neighbourhood=True),
            "by_regime": self.by_regime(),
        }


def _value(result: mx.MetricResult):
    return round(result.value, 5) if result.available else None


@dataclass(slots=True)
class Comparison:
    """The baseline ladder and what each rung buys."""

    schemes: dict[str, Scores] = dc_field(default_factory=dict)
    baseline: str = "climatology"

    def gain(self, scheme: str, over: str | None = None) -> dict:
        over = over or self.baseline
        target = self.schemes.get(scheme)
        reference = self.schemes.get(over)
        if target is None or reference is None:
            return {"available": False, "reason": "scheme not evaluated"}
        a = target.evaluate()
        b = reference.evaluate()
        if not a["available"] or not b["available"] or not a["brier"]:
            return {"available": False, "reason": "no usable scores"}
        if b["brier"] in (None, 0):
            return {"available": False, "reason": "reference has no Brier"}

        relative = 1.0 - a["brier"] / b["brier"]
        n = a["n"]
        return {
            "available": True,
            "scheme": scheme, "over": over,
            "brier": a["brier"], "reference_brier": b["brier"],
            "relative_improvement": round(relative, 4),
            "n": n,
            "verdict": _verdict(relative, n, scheme, over),
        }

    def to_dict(self) -> dict:
        ladder = ["climatology", "persistence", "equal_models", "full"]
        present = [s for s in ladder if s in self.schemes]
        rungs = {}
        for a, b in zip(present, present[1:]):
            rungs[f"{b}_over_{a}"] = self.gain(b, a)
        return {
            "schemes": {k: v.to_dict() for k, v in self.schemes.items()},
            "ladder": rungs,
            "note": (
                "each rung isolates what one layer contributes. If "
                "full_over_equal_models is not positive, Stage 6's adaptive "
                "weighting is not paying for itself"
            ),
        }


def _verdict(relative: float, n: int, scheme: str, over: str) -> str:
    if n < 200:
        return (
            f"INSUFFICIENT EVIDENCE: {n} cases cannot support a decision "
            f"about {scheme} either way"
        )
    if relative <= 0:
        return (
            f"NO BENEFIT: {scheme} is no better than {over}. Section 71 -- "
            f"complexity without measurable benefit should not be retained"
        )
    if relative < 0.02:
        return (
            f"MARGINAL: {relative:.1%} better than {over}, which is unlikely "
            f"to justify the added complexity on its own"
        )
    return f"IMPROVEMENT: {relative:.1%} lower Brier score than {over}"


# ---------------------------------------------------------------------------
# Ablation
# ---------------------------------------------------------------------------

#: Components removable one at a time, and what removing each tests.
ABLATIONS: dict[str, str] = {
    "weather_regime": "does regime awareness change the forecast?",
    "entrainment": "does dilution assessment change the forecast?",
    "convective_initiation": (
        "does the realisation stage contribute, or is the environment "
        "carrying everything?"
    ),
    "storm_organisation": "does organisation affect the base probability?",
    "updraft": "does updraught potential contribute?",
    # Section 72: this one MUST show no change.
    "hail": "does a HAZARD engine leak into the thunderstorm probability?",
    "lightning": "does a HAZARD engine leak into the thunderstorm probability?",
}


def ablate(
    engine_results: dict, *, removed: str, **kwargs
) -> fc.TCMForecast:
    """Produce a forecast with one engine's result withheld."""
    stripped = {}
    for key, results in engine_results.items():
        from ..engines.result import EngineSet
        copy = EngineSet()
        for result in results:
            if result.engine != removed:
                copy.add(result)
        stripped[key] = copy
    return fc.produce(stripped, **kwargs)


def ablation_report(engine_results: dict, **kwargs) -> dict:
    """Remove each component in turn and report what moved.

    The hazard rows are the architectural test: removing the hail or
    lightning engine must leave P(thunderstorm) EXACTLY unchanged. Any
    movement means a hazard is feeding back into storm occurrence, which
    sections 25 and 32 forbid.
    """
    baseline = fc.produce(engine_results, **kwargs)
    rows: dict[str, dict] = {}
    hazard_engines = {
        "hail", "lightning", "severe_wind", "downburst",
        "tornado_environment", "heavy_rainfall",
    }

    for engine, question in ABLATIONS.items():
        try:
            without = ablate(engine_results, removed=engine, **kwargs)
        except Exception as exc:                       # noqa: BLE001
            rows[engine] = {"error": f"{type(exc).__name__}: {exc}"}
            continue

        before = baseline.probability
        after = without.probability
        if before is None or after is None:
            change = None
        else:
            change = float(after - before)

        row = {
            "question": question,
            "probability_with": (
                round(before, 5) if before is not None else None
            ),
            "probability_without": (
                round(after, 5) if after is not None else None
            ),
            "change": round(change, 6) if change is not None else None,
            "is_hazard_engine": engine in hazard_engines,
        }
        if engine in hazard_engines:
            leaked = change is not None and abs(change) > 1e-12
            row["contamination"] = leaked
            row["verdict"] = (
                "CONTAMINATION: removing a hazard engine changed the "
                "thunderstorm probability. Sections 25 and 32 forbid this "
                "pathway"
                if leaked else
                "clean: the thunderstorm probability is unchanged, as the "
                "architecture requires"
            )
        elif after is None:
            row["verdict"] = (
                "ESSENTIAL: without this engine no probability can be "
                "produced at all"
            )
        elif change is not None and abs(change) < 1e-9:
            # Not the same as contributing nothing. Some engines feed the
            # hazard conditionals or another engine's internals rather than
            # the thunderstorm stages, and are supposed to leave this
            # number alone.
            feeds_stages = engine in {
                "thermodynamic", "updraft", "entrainment",
                "convective_initiation",
            }
            row["verdict"] = (
                "NO CONTRIBUTION to P(thunderstorm) despite feeding a "
                "thunderstorm stage -- section 71 says such complexity "
                "should not be retained"
                if feeds_stages else
                "no effect on P(thunderstorm), which is correct: this "
                "engine feeds the hazard conditionals or another engine's "
                "internals, not the thunderstorm stages. Its contribution "
                "must be judged on those outputs instead"
            )
        else:
            row["verdict"] = "contributes"
        rows[engine] = row

    return {
        "baseline_probability": (
            round(baseline.probability, 5)
            if baseline.probability is not None else None
        ),
        "ablations": rows,
        "hazard_contamination": any(
            r.get("contamination") for r in rows.values()
        ),
    }


# ---------------------------------------------------------------------------
# Calibration workflow
# ---------------------------------------------------------------------------

def fit_with_temporal_split(
    outcomes: list[Outcome], *, method: str = "logistic",
    train_fraction: float = 0.6, now: datetime | None = None,
) -> tuple[Calibrator, dict]:
    """Fit a calibrator on the earlier part and test on the later part.

    Sections 34 and 35: the calibration data must be independent of the fit,
    and the split must be TEMPORAL. A random split lets a future weather
    regime influence past forecasts and puts adjacent hours of one outbreak
    on both sides, which for convection makes the test set nearly a copy of
    the training set.
    """
    ordered = sorted(outcomes, key=lambda o: o.valid_time)
    if len(ordered) < 50:
        return (
            Calibrator(
                method="identity",
                notes=(
                    f"only {len(ordered)} cases; too few to calibrate. The "
                    f"forecast stays UNCALIBRATED rather than being fitted "
                    f"to noise",
                ),
            ),
            {"available": False, "reason": "too few cases"},
        )

    cut = int(len(ordered) * train_fraction)
    train, test = ordered[:cut], ordered[cut:]

    calibrator = fit_calibrator(
        np.array([o.probability for o in train]),
        np.array([float(o.observed) for o in train]),
        method=method, now=now,
    )

    raw_test = np.array([o.probability for o in test])
    observed_test = np.array([float(o.observed) for o in test])
    calibrated_test = calibrator(raw_test)

    return calibrator, {
        "available": True,
        "split": "temporal",
        "train_n": len(train), "test_n": len(test),
        "train_period": [
            train[0].valid_time.isoformat(), train[-1].valid_time.isoformat()
        ],
        "test_period": [
            test[0].valid_time.isoformat(), test[-1].valid_time.isoformat()
        ],
        "before": reliability_diagram(raw_test, observed_test),
        "after": reliability_diagram(calibrated_test, observed_test),
        "calibrator": calibrator.to_dict(),
        "note": (
            "the split is temporal, not random. A random split lets a future "
            "regime influence past forecasts and puts adjacent hours of one "
            "outbreak on both sides"
        ),
    }


def confidence_is_informative(outcomes: list[Outcome],
                              confidences: list[float]) -> dict:
    """Does high confidence actually go with better forecasts?

    Section 69: confidence must not be assumed useful merely because it
    exists. Cases are split at the median confidence and scored separately;
    if the high-confidence half is not more reliable, the confidence model
    is decoration.
    """
    if len(outcomes) != len(confidences) or len(outcomes) < 100:
        return {
            "available": False,
            "reason": f"need at least 100 paired cases, got {len(outcomes)}",
        }
    values = np.array(confidences, dtype="float64")
    median = float(np.median(values))
    high = [o for o, c in zip(outcomes, confidences) if c >= median]
    low = [o for o, c in zip(outcomes, confidences) if c < median]

    high_scores = Scores("high_confidence", high).evaluate()
    low_scores = Scores("low_confidence", low).evaluate()
    informative = (
        high_scores.get("brier") is not None
        and low_scores.get("brier") is not None
        and high_scores["brier"] < low_scores["brier"]
    )
    return {
        "available": True,
        "median_confidence": round(median, 4),
        "high_confidence": high_scores,
        "low_confidence": low_scores,
        "informative": informative,
        "verdict": (
            "confidence is informative: the high-confidence half verifies "
            "better" if informative else
            "confidence is NOT informative: the high-confidence half does "
            "not verify better, so the confidence model is decoration and "
            "should be reworked or removed"
        ),
    }
