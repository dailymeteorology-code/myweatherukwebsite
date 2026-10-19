"""The specialist engine contract.

Every engine declares what it consumes, produces one `EngineResult`, and is
independently testable. The registry builds a dependency graph from those
declarations and refuses to run a cyclic one.

WHAT THE DEPENDENCY RULES ARE FOR
---------------------------------
Two rules are enforced structurally rather than left to discipline:

**No cycles.** The lightning engine may consume the updraft engine; the
thermodynamic engine may not consume lightning. `topological_order` raises on
a cycle rather than looping or silently picking an order.

**No overwriting.** An engine receives its dependencies' results read-only
and returns its own. Nothing can reach into `EngineSet` and replace another
engine's score, so a hazard engine cannot quietly become the thunderstorm
forecast.

The one thing this module deliberately does NOT do is combine engine outputs.
There is no master score, no average, no weighting. `run_all` returns every
result side by side and stops.
"""
from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field as dc_field
from typing import Iterable

from ..parameters.engine import DerivedParameters
from .result import (
    EngineResult, EngineSet, EngineStatus, ScoreKind, insufficient, invalid,
)

log = logging.getLogger(__name__)

#: Bumped when any engine's logic changes, so stored results can never be
#: confused with results from different maths.
STAGE5_VERSION = "1.0"

#: No engine may report less uncertainty than this. Every engine rests on
#: transfer anchors that are judgements, on one model's profile, and on
#: parcel theory; claiming zero uncertainty would deny all of it.
IRREDUCIBLE_UNCERTAINTY = 0.1


@dataclass(slots=True)
class EngineContext:
    """Everything an engine may read.

    Deliberately a single object: an engine that needed something not in here
    would have to declare it, rather than reaching into global state.
    """

    #: Stage 4 output for this point, model, member and valid time.
    parameters: DerivedParameters
    #: Shared features, computed once per context. Populated by the pipeline.
    features: dict = dc_field(default_factory=dict)
    #: Results of engines that have already run, read-only by convention.
    results: EngineSet = dc_field(default_factory=EngineSet)
    #: Local solar hour at the point, for diurnal reasoning. None when the
    #: valid time or longitude is unknown -- never guessed.
    local_hour: float | None = None
    #: Terrain elevation, m. None when the model did not publish it.
    elevation: float | None = None

    def diagnostic(self, name: str):
        """A Stage 4 diagnostic, whatever its status."""
        return self.parameters.get(name)

    def value(self, name: str, default: float | None = None) -> float | None:
        """The scalar value of a Stage 4 diagnostic, or `default`.

        Returns `default` for anything not AVAILABLE/DEGRADED/PARTIAL, so an
        unavailable diagnostic can never be read as a number.
        """
        return self.parameters.value(name, default)

    def has(self, *names: str) -> bool:
        return all(self.parameters.get(n).status.has_value for n in names)

    def missing(self, *names: str) -> tuple[str, ...]:
        return tuple(
            n for n in names if not self.parameters.get(n).status.has_value
        )

    def feature(self, name: str, default=None):
        return self.features.get(name, default)

    def result(self, engine: str) -> EngineResult | None:
        return self.results.get(engine)


class Engine(ABC):
    """One specialist forecasting engine."""

    #: Unique, stable, snake_case.
    name: str = ""
    #: Bump when the engine's logic changes.
    version: str = "1.0"
    #: Bump when its transfers or thresholds change but the logic does not.
    config_version: str = "1.0"
    #: What the engine's `score` means.
    score_kind: ScoreKind = ScoreKind.UNCALIBRATED_PROBABILITY
    #: Stage 4 diagnostics this engine reads. Declared, for the correlation
    #: metadata the later aggregation layer needs.
    consumes_diagnostics: tuple[str, ...] = ()
    #: Other engines this engine reads. Drives the dependency graph.
    consumes_engines: tuple[str, ...] = ()
    #: One sentence: what physical question does this answer?
    question: str = ""

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if getattr(cls, "name", "") and not cls.__doc__:
            raise TypeError(
                f"engine {cls.name!r} has no docstring. Section 59 of the "
                f"stage brief makes the scientific audit mandatory: physical "
                f"question, inputs, mechanism, limitations, data "
                f"requirements, uncertainty, validation."
            )

    @abstractmethod
    def evaluate(self, context: EngineContext) -> EngineResult:
        """Produce this engine's result. Must not mutate the context."""

    # -- helpers available to every engine ---------------------------------

    def _result(self, **kwargs) -> EngineResult:
        """Build a result pre-filled with this engine's identity.

        Also floors uncertainty at `IRREDUCIBLE_UNCERTAINTY`. Every engine
        here rests on transfer functions whose anchors are judgements, on a
        single model's profile, and on parcel theory. A reported uncertainty
        of exactly zero would claim none of that matters, which is never
        true, and a completeness-driven formula reaches zero whenever every
        input happens to be present.
        """
        kwargs.setdefault("engine", self.name)
        kwargs.setdefault("version", self.version)
        kwargs.setdefault("config_version", self.config_version)
        kwargs.setdefault("score_kind", self.score_kind)
        kwargs.setdefault("input_diagnostics", self.consumes_diagnostics)
        kwargs.setdefault("input_engines", self.consumes_engines)
        uncertainty = kwargs.get("uncertainty")
        if uncertainty is not None:
            kwargs["uncertainty"] = round(
                min(1.0, max(IRREDUCIBLE_UNCERTAINTY, float(uncertainty))), 3
            )
        return EngineResult(**kwargs)

    def _insufficient(self, reason: str, missing=()) -> EngineResult:
        return insufficient(
            self.name, self.version, reason, score_kind=self.score_kind,
            input_diagnostics=self.consumes_diagnostics,
            input_engines=self.consumes_engines, missing=tuple(missing),
        )

    def _stamp(self, result: EngineResult, context: EngineContext) -> EngineResult:
        """Attach the model/run/member/location the result belongs to."""
        meta = context.parameters
        result.model = meta.model
        result.run = meta.run
        result.valid_time = meta.valid_time
        result.forecast_hour = meta.forecast_hour
        result.member = meta.member
        result.latitude = meta.latitude
        result.longitude = meta.longitude
        return result

    def describe(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "config_version": self.config_version,
            "score_kind": self.score_kind.value,
            "question": self.question,
            "consumes_diagnostics": list(self.consumes_diagnostics),
            "consumes_engines": list(self.consumes_engines),
            "audit": (self.__doc__ or "").strip(),
        }


# ---------------------------------------------------------------------------
# Registry and ordering
# ---------------------------------------------------------------------------

REGISTRY: dict[str, Engine] = {}


def register(engine: Engine) -> Engine:
    if not engine.name:
        raise ValueError(f"{type(engine).__name__} has no name")
    if engine.name in REGISTRY:
        raise ValueError(f"duplicate engine {engine.name!r}")
    REGISTRY[engine.name] = engine
    return engine


def dependency_graph() -> dict[str, tuple[str, ...]]:
    return {name: e.consumes_engines for name, e in REGISTRY.items()}


def topological_order(engines: Iterable[str] | None = None) -> list[str]:
    """Engine names in an order that satisfies every dependency.

    Raises on a cycle. A cycle means the architecture has gone wrong -- a
    hazard engine feeding back into an environmental one -- and running in
    some arbitrary order would hide that.
    """
    names = list(engines) if engines is not None else list(REGISTRY)
    unknown = [n for n in names if n not in REGISTRY]
    if unknown:
        raise ValueError(f"unknown engines: {unknown}")

    ordered: list[str] = []
    state: dict[str, int] = {}          # 0 = visiting, 1 = done

    def visit(node: str, path: tuple[str, ...]) -> None:
        mark = state.get(node)
        if mark == 1:
            return
        if mark == 0:
            cycle = " -> ".join(path + (node,))
            raise ValueError(
                f"circular engine dependency: {cycle}. An environmental "
                f"engine must never consume a hazard engine."
            )
        state[node] = 0
        for dependency in REGISTRY[node].consumes_engines:
            if dependency not in REGISTRY:
                raise ValueError(
                    f"{node} depends on unregistered engine {dependency!r}"
                )
            visit(dependency, path + (node,))
        state[node] = 1
        ordered.append(node)

    for name in names:
        visit(name, ())
    return ordered


@dataclass(slots=True)
class RunReport:
    """What happened during one pipeline run, for observability."""

    durations_ms: dict[str, float] = dc_field(default_factory=dict)
    failures: dict[str, str] = dc_field(default_factory=dict)
    degraded: list[str] = dc_field(default_factory=list)
    insufficient: list[str] = dc_field(default_factory=list)

    @property
    def total_ms(self) -> float:
        return round(sum(self.durations_ms.values()), 3)

    def to_dict(self) -> dict:
        return {
            "total_ms": self.total_ms,
            "slowest": sorted(
                self.durations_ms.items(), key=lambda kv: -kv[1]
            )[:5],
            "failures": dict(self.failures),
            "degraded": list(self.degraded),
            "insufficient": list(self.insufficient),
        }


def run_all(
    context: EngineContext, *, engines: Iterable[str] | None = None,
    report: RunReport | None = None,
) -> EngineSet:
    """Run every engine in dependency order, isolating failures.

    One engine raising must not lose the other eleven. A failure becomes an
    INVALID result carrying the exception text -- never a silent zero, and
    never a crash that takes down the forecast.

    This returns the results SIDE BY SIDE. It does not combine, average or
    weight them: that is the next stage's work, and doing any of it here
    would create exactly the hidden master score the brief forbids.
    """
    order = topological_order(engines)
    report = report if report is not None else RunReport()

    for name in order:
        engine = REGISTRY[name]
        started = time.perf_counter()
        try:
            result = engine.evaluate(context)
            if result is None:
                raise RuntimeError("engine returned None")
            engine._stamp(result, context)
        except Exception as exc:                       # noqa: BLE001
            log.exception("engine %s raised", name)
            result = invalid(
                name, engine.version,
                f"the engine raised {type(exc).__name__}: {exc}",
                score_kind=engine.score_kind,
            )
            report.failures[name] = f"{type(exc).__name__}: {exc}"
        elapsed = (time.perf_counter() - started) * 1000.0
        report.durations_ms[name] = round(elapsed, 3)

        if result.status is EngineStatus.DEGRADED:
            report.degraded.append(name)
        elif result.status is EngineStatus.INSUFFICIENT_DATA:
            report.insufficient.append(name)

        context.results.add(result)

    if report.failures:
        log.warning(
            "%d of %d engines failed: %s",
            len(report.failures), len(order), sorted(report.failures),
        )
    return context.results
