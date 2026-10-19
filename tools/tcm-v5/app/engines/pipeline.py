"""Running the specialist engines.

This module builds the context, runs every engine in dependency order, and
returns the results SIDE BY SIDE.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
There is no combination step. No master score, no average of the engines, no
weighted blend, no final thunderstorm risk. Those belong to the aggregation
and calibration stages, which need model skill, ensemble spread and verified
calibration -- none of which exists yet.

A test asserts that nothing in this package produces a field whose name
suggests an overall risk, because the easiest way to undo the whole
architecture would be to quietly add one here.

ENSEMBLE MEMBERS
----------------
`run_member` handles ONE member. Members are never averaged inside an engine
and never combined here: `run_members` returns a list of per-member result
sets so a later stage can compute probabilities, spread and scenario
clusters from whole members rather than from pre-averaged mush.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from typing import Iterable

import numpy as np

from ..parameters.engine import DerivedParameters
from ..parameters import engine as stage4
from ..profiles.schema import Profile
from .base import EngineContext, RunReport, STAGE5_VERSION, run_all
from .features import build_features, local_solar_hour
from .result import EngineSet

log = logging.getLogger(__name__)

#: Field names that would indicate the aggregation boundary has been
#: crossed. Checked by a test, not merely documented.
FORBIDDEN_OUTPUT_NAMES = (
    "overall_risk", "total_risk", "master_score", "final_probability",
    "combined_score", "thunderstorm_risk", "tcm_risk", "aggregate",
)


@dataclass(slots=True)
class SpecialistForecast:
    """Every specialist engine's result for one profile."""

    model: str
    run: datetime
    valid_time: datetime
    forecast_hour: int
    member: int | None
    latitude: float | None
    longitude: float | None
    stage5_version: str
    results: EngineSet
    report: RunReport
    #: The shared features, for traceability.
    features: dict = dc_field(default_factory=dict)
    parameters_summary: dict = dc_field(default_factory=dict)

    @property
    def is_ensemble_member(self) -> bool:
        return self.member is not None

    @property
    def identity(self) -> tuple:
        """Cache and storage key.

        Includes the Stage 5 version so results from different engine logic
        can never be served as though they were current, and includes the
        member so members never collide.
        """
        return (
            self.model, self.run, self.forecast_hour, self.member,
            self.latitude, self.longitude, self.stage5_version,
        )

    def to_dict(self, *, include_features: bool = False) -> dict:
        out = {
            "stage5_version": self.stage5_version,
            "context": {
                "model": self.model,
                "run": self.run.isoformat(),
                "valid_time": self.valid_time.isoformat(),
                "forecast_hour": self.forecast_hour,
                "member": self.member,
                "latitude": self.latitude,
                "longitude": self.longitude,
            },
            "summary": self.results.summary(),
            "engines": self.results.to_dict(),
            "observability": self.report.to_dict(),
            "parameters": self.parameters_summary,
            "note": (
                "specialist engine outputs, side by side and deliberately "
                "NOT combined. Aggregation, model weighting and calibration "
                "are later stages"
            ),
        }
        if include_features:
            out["features"] = self.features
        return out


class _AsForcing:
    """Adapts a plain {name: value} mapping to the PointForcing interface.

    Stage 5 must not import Stage 8 types to accept forcing from it -- the
    dependency runs the other way, and a later stage supplying an earlier
    one is exactly the kind of coupling that makes an ablation impossible.
    """

    def __init__(self, values: dict[str, float]) -> None:
        self._values = values

    def as_overrides(self) -> dict[str, float]:
        return {
            k: v for k, v in self._values.items()
            if v is not None and np.isfinite(v)
        }


def run_for_parameters(
    parameters: DerivedParameters, *,
    elevation: float | None = None,
    engines: Iterable[str] | None = None,
    forcing: dict[str, float] | None = None,
) -> SpecialistForecast:
    """Run the specialist engines on one Stage 4 result.

    `forcing` carries the horizontal-field quantities a point evaluation
    cannot produce -- convergence, frontogenesis, moisture flux convergence,
    vertical velocity -- supplied by the Stage 8 spatial engine. It only
    ever FILLS features that are unavailable; a value the profile produced
    itself is never overwritten, so the two paths cannot silently disagree.

    Without it the initiation engine has no forcing and caps itself at
    `NO_FORCING_CEILING`, which is the correct behaviour for a lone column
    and the reason this argument exists.
    """
    features = build_features(parameters, elevation=elevation)
    if forcing:
        from ..spatial.integrate import apply_to_features
        _, filled = apply_to_features(features.items, _AsForcing(forcing))
        if filled:
            log.info("stage 8 supplied forcing: %s", ", ".join(filled))
    context = EngineContext(
        parameters=parameters,
        features={"set": features},
        local_hour=local_solar_hour(
            parameters.valid_time, parameters.longitude
        ),
        elevation=elevation,
    )
    report = RunReport()
    results = run_all(context, engines=engines, report=report)

    log.info(
        "stage 5: %s T+%s member=%s -> %s in %.1f ms",
        parameters.model, parameters.forecast_hour, parameters.member,
        results.summary()["by_status"], report.total_ms,
    )

    return SpecialistForecast(
        model=parameters.model, run=parameters.run,
        valid_time=parameters.valid_time,
        forecast_hour=parameters.forecast_hour, member=parameters.member,
        latitude=parameters.latitude, longitude=parameters.longitude,
        stage5_version=STAGE5_VERSION, results=results, report=report,
        features=features.to_dict(),
        parameters_summary=parameters.summary(),
    )


def run_for_profile(
    profile: Profile, *, elevation: float | None = None,
    engines: Iterable[str] | None = None,
    forcing: dict[str, float] | None = None,
) -> SpecialistForecast:
    """Stage 4 then Stage 5, for one profile."""
    parameters = stage4.compute(profile)
    return run_for_parameters(
        parameters, elevation=elevation, engines=engines, forcing=forcing
    )


def run_members(
    profiles: Iterable[Profile], *, elevation: float | None = None,
) -> list[SpecialistForecast]:
    """One forecast per ensemble member, kept separate.

    Members are NOT averaged, here or inside any engine. Averaging profiles
    before the engines would destroy exactly what an ensemble is for: the
    mean of a capped member and an uncapped one is a profile neither member
    produced, and its initiation answer belongs to no physical scenario.
    """
    return [
        run_for_profile(profile, elevation=elevation) for profile in profiles
    ]


def engine_catalogue() -> dict:
    """Every registered engine, its contract and its dependencies."""
    from .base import REGISTRY, dependency_graph, topological_order

    return {
        "stage5_version": STAGE5_VERSION,
        "count": len(REGISTRY),
        "execution_order": topological_order(),
        "dependencies": {
            name: list(deps) for name, deps in dependency_graph().items()
        },
        "engines": {
            name: engine.describe() for name, engine in REGISTRY.items()
        },
        "aggregation": {
            "implemented": False,
            "reason": (
                "combining these outputs requires model skill, ensemble "
                "spread and verified calibration, which are later stages. "
                "No master score exists and none should be added here"
            ),
        },
    }
