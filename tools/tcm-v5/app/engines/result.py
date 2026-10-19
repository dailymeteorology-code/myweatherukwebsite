"""What a specialist engine returns.

One schema for all twelve engines. Duplicating a different result structure
per engine would make the later aggregation layer parse twelve shapes and
would let each engine invent its own meaning for "confidence".

THE THREE THINGS THAT ARE NOT THE SAME
--------------------------------------
    score        how favourable the atmosphere is for this outcome
    confidence   how much the engine trusts its own answer
    uncertainty  how much the inputs could move the answer

They are separate fields and none is derived from another by a fixed rule.
A high score with low confidence is a real and common state: a textbook
severe environment diagnosed from a profile missing its mid-levels. Folding
confidence into the score would erase exactly the case a forecaster most
needs to see.

WHY `ScoreKind` EXISTS
----------------------
Calling something `probability = 0.63` when nothing has verified that 63 out
of 100 such cases produce the event is a lie that survives all the way to a
public forecast. Every score therefore declares what it actually is, and
Stage 5 can only produce the uncalibrated kinds -- `CALIBRATED_PROBABILITY`
is reserved for the later calibration stage and no engine here may claim it.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum
from typing import Any

import numpy as np


class ScoreKind(str, Enum):
    """What the number in `score` actually means."""

    #: A bounded measure of environmental favourability. NOT a frequency.
    #: "This atmosphere is 0.7 of the way to as supportive as it gets."
    POTENTIAL = "potential"
    #: Monotonic in the chance of the outcome, but with no verified mapping
    #: onto observed frequency.
    LIKELIHOOD = "likelihood"
    #: Built to be read as a probability and structured like one, but never
    #: verified against observations. The honest state for Stage 5's event
    #: engines.
    UNCALIBRATED_PROBABILITY = "uncalibrated_probability"
    #: Verified against observed frequencies. RESERVED for the calibration
    #: stage; Stage 5 engines must never emit this.
    CALIBRATED_PROBABILITY = "calibrated_probability"
    #: A set of affinities across named classes, in `classes`.
    CLASS_AFFINITY = "class_affinity"

    @property
    def is_probability(self) -> bool:
        return self in (
            ScoreKind.UNCALIBRATED_PROBABILITY,
            ScoreKind.CALIBRATED_PROBABILITY,
        )


class EngineStatus(str, Enum):
    """Whether the result can be used, and how far."""

    AVAILABLE = "available"
    #: Produced, but an input was missing or weaker than the method wants.
    DEGRADED = "degraded"
    #: Produced, but the engine does not trust it -- ambiguous regime,
    #: contradictory inputs, or a value near a decision boundary.
    LOW_CONFIDENCE = "low_confidence"
    #: Required inputs absent. No score at all.
    INSUFFICIENT_DATA = "insufficient_data"
    #: Inputs present, result not physical, or the code failed.
    INVALID = "invalid"

    @property
    def has_score(self) -> bool:
        return self in (
            EngineStatus.AVAILABLE, EngineStatus.DEGRADED,
            EngineStatus.LOW_CONFIDENCE,
        )


_SEVERITY = {
    EngineStatus.AVAILABLE: 0, EngineStatus.DEGRADED: 1,
    EngineStatus.LOW_CONFIDENCE: 2, EngineStatus.INSUFFICIENT_DATA: 3,
    EngineStatus.INVALID: 4,
}


def worst(*statuses: EngineStatus) -> EngineStatus:
    """The least trustworthy status. Quality never improves by combination."""
    present = [s for s in statuses if s is not None]
    if not present:
        return EngineStatus.INSUFFICIENT_DATA
    return max(present, key=lambda s: _SEVERITY[s])


@dataclass(frozen=True, slots=True)
class Contribution:
    """One feature's part in a result.

    `influence` is how much this factor moved the answer, in [0, 1] -- NOT a
    weight the engine multiplied by. It is read back OUT of the composition
    afterwards, so it describes what happened rather than prescribing it.
    That distinction is the whole reason this is not a weighted-sum system.
    """

    feature: str
    #: The physical value, in the units of the Stage 4 diagnostic.
    value: float | None
    unit: str = ""
    #: The transfer function's output for this value, in [0, 1].
    transformed: float | None = None
    #: How much this factor governed the result, in [0, 1].
    influence: float = 0.0
    #: "supporting", "limiting", or "neutral".
    direction: str = "neutral"
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "feature": self.feature,
            "value": _num(self.value),
            "unit": self.unit,
            "transformed": _num(self.transformed),
            "influence": round(float(self.influence), 4),
            "direction": self.direction,
            "note": self.note,
        }


def _num(value) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return round(f, 6) if np.isfinite(f) else None


@dataclass(slots=True)
class EngineResult:
    """The output of one specialist engine at one point and time."""

    engine: str
    version: str
    #: The headline number, or None when there is none. NEVER 0.0 to mean
    #: "could not compute" -- the same rule Stage 4 enforces.
    score: float | None
    score_kind: ScoreKind
    status: EngineStatus

    #: How much the engine trusts its own answer, [0, 1]. Independent of
    #: `score`: a confident zero is a real and useful result.
    confidence: float | None = None
    #: How much the answer could move given input spread and ambiguity,
    #: [0, 1]. NOT 1 - confidence.
    uncertainty: float | None = None

    #: For CLASS_AFFINITY engines: class name -> affinity in [0, 1]. These
    #: need not sum to 1; overlapping regimes are the point.
    classes: dict[str, float] = dc_field(default_factory=dict)

    contributions: tuple[Contribution, ...] = ()
    quality_flags: tuple[str, ...] = ()
    #: Plain-language reasons the score is where it is.
    explanation: tuple[str, ...] = ()
    #: Why the status is not AVAILABLE. Required when it is not.
    reason: str = ""

    # -- provenance ---------------------------------------------------------
    #: Stage 4 diagnostics consumed. Feeds the later aggregation layer's
    #: correlation accounting -- two engines sharing CAPE are not independent
    #: evidence and must not be summed as though they were.
    input_diagnostics: tuple[str, ...] = ()
    #: Other engines consumed, by name.
    input_engines: tuple[str, ...] = ()
    #: The configuration that produced this, for reproducibility.
    config_version: str = "1.0"

    model: str = ""
    run: datetime | None = None
    valid_time: datetime | None = None
    forecast_hour: int | None = None
    member: int | None = None
    latitude: float | None = None
    longitude: float | None = None

    extra: dict[str, Any] = dc_field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.status.has_score and self.score is None \
                and not self.classes:
            raise ValueError(
                f"{self.engine}: status {self.status.value} promises a score "
                f"but none was supplied"
            )
        if not self.status.has_score and self.score is not None:
            raise ValueError(
                f"{self.engine}: status {self.status.value} must not carry a "
                f"score; a missing result is None, never a number"
            )
        if not self.status.has_score and not self.reason:
            raise ValueError(
                f"{self.engine}: {self.status.value} without a reason"
            )
        if self.score_kind is ScoreKind.CALIBRATED_PROBABILITY:
            raise ValueError(
                f"{self.engine}: no Stage 5 engine may claim a CALIBRATED "
                f"probability. Calibration is verified against observations "
                f"in a later stage, and claiming it here would put an "
                f"unverified number in front of a forecaster as though it "
                f"had been checked."
            )
        if self.score is not None:
            value = float(self.score)
            if self.score_kind.is_probability and not (0.0 <= value <= 1.0):
                raise ValueError(
                    f"{self.engine}: probability {value} outside [0, 1]"
                )

    @property
    def top_contributions(self) -> tuple[Contribution, ...]:
        return tuple(
            sorted(self.contributions, key=lambda c: -c.influence)
        )

    @property
    def limiting_factor(self) -> Contribution | None:
        """The factor holding the score DOWN the most.

        The question a forecaster actually asks of a low number is "what is
        stopping it", and that is not answered by the largest contributor.
        """
        limiting = [c for c in self.contributions if c.direction == "limiting"]
        if not limiting:
            return None
        return min(limiting, key=lambda c: (
            c.transformed if c.transformed is not None else 1.0
        ))

    def to_dict(self) -> dict:
        out: dict[str, Any] = {
            "engine": self.engine,
            "version": self.version,
            "config_version": self.config_version,
            "score": _num(self.score),
            "score_kind": self.score_kind.value,
            "status": self.status.value,
            "confidence": _num(self.confidence),
            "uncertainty": _num(self.uncertainty),
        }
        if self.classes:
            out["classes"] = {
                k: round(float(v), 4) for k, v in sorted(
                    self.classes.items(), key=lambda kv: -kv[1]
                )
            }
        if self.contributions:
            out["contributions"] = [
                c.to_dict() for c in self.top_contributions
            ]
            limiting = self.limiting_factor
            out["limiting_factor"] = limiting.feature if limiting else None
        if self.explanation:
            out["explanation"] = list(self.explanation)
        if self.quality_flags:
            out["quality_flags"] = list(self.quality_flags)
        if self.reason:
            out["reason"] = self.reason
        out["depends_on"] = {
            "diagnostics": list(self.input_diagnostics),
            "engines": list(self.input_engines),
        }
        context = {
            "model": self.model,
            "run": self.run.isoformat() if self.run else None,
            "valid_time": (
                self.valid_time.isoformat() if self.valid_time else None
            ),
            "forecast_hour": self.forecast_hour,
            "member": self.member,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }
        out["context"] = {k: v for k, v in context.items() if v is not None}
        if self.extra:
            out["extra"] = _jsonable(self.extra)
        return out


def insufficient(
    engine: str, version: str, reason: str, *,
    score_kind: ScoreKind = ScoreKind.UNCALIBRATED_PROBABILITY,
    input_diagnostics: tuple[str, ...] = (),
    input_engines: tuple[str, ...] = (),
    missing: tuple[str, ...] = (),
) -> EngineResult:
    """The standard way to decline, with the reason attached.

    Deliberately the shortest path in the package, so returning a justified
    nothing is always easier than inventing a number.
    """
    return EngineResult(
        engine=engine, version=version, score=None, score_kind=score_kind,
        status=EngineStatus.INSUFFICIENT_DATA, reason=reason,
        input_diagnostics=input_diagnostics, input_engines=input_engines,
        quality_flags=(
            (f"missing inputs: {', '.join(missing)}",) if missing else ()
        ),
    )


def invalid(
    engine: str, version: str, reason: str, *,
    score_kind: ScoreKind = ScoreKind.UNCALIBRATED_PROBABILITY,
) -> EngineResult:
    """Inputs were present but the engine failed or produced nonsense."""
    return EngineResult(
        engine=engine, version=version, score=None, score_kind=score_kind,
        status=EngineStatus.INVALID, reason=reason,
    )


def _jsonable(obj):
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        return [_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return f if np.isfinite(f) else None
    return obj


@dataclass(slots=True)
class EngineSet:
    """Every engine's result for one point and time."""

    results: dict[str, EngineResult] = dc_field(default_factory=dict)

    def add(self, result: EngineResult) -> EngineResult:
        self.results[result.engine] = result
        return result

    def get(self, name: str) -> EngineResult | None:
        return self.results.get(name)

    def score(self, name: str, default: float | None = None) -> float | None:
        found = self.results.get(name)
        if found is None or found.score is None:
            return default
        return float(found.score)

    def __contains__(self, name: str) -> bool:
        return name in self.results

    def __iter__(self):
        return iter(self.results.values())

    def __len__(self) -> int:
        return len(self.results)

    def summary(self) -> dict:
        counts: dict[str, int] = {}
        for result in self.results.values():
            counts[result.status.value] = counts.get(result.status.value, 0) + 1
        return {
            "engines": len(self.results),
            "by_status": counts,
            "scored": sum(
                1 for r in self.results.values() if r.score is not None
            ),
        }

    def to_dict(self) -> dict:
        return {name: r.to_dict() for name, r in self.results.items()}
