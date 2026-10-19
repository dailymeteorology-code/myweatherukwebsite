"""Specialist convective forecasting engines.

Stage 5. Exposes the twelve engines: their contracts and dependency graph,
their training contracts, and their results at a point.

There is deliberately no combined output. No overall thunderstorm risk, no
master score, no average of the engines. Combining them needs model skill,
ensemble spread and verified calibration, which are later stages, and a
route that quietly returned a single number would undo the entire
architecture.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...engines import engine_catalogue, pipeline, training

router = APIRouter(tags=["engines"])


@router.get("/engines")
def catalogue() -> dict:
    """Every engine: its question, its scientific audit, what it consumes,
    and the order they run in."""
    return engine_catalogue()


@router.get("/engines/dependencies")
def dependencies() -> dict:
    """The dependency graph, and which upstream diagnostics each engine
    reads.

    The second part is what the later aggregation stage needs in order to
    avoid double counting: several engines legitimately read CAPE, so their
    outputs are correlated and must not be summed as independent evidence.
    """
    from ...engines.base import REGISTRY, dependency_graph, topological_order

    shared: dict[str, list[str]] = {}
    for name, engine in REGISTRY.items():
        for diagnostic in engine.consumes_diagnostics:
            shared.setdefault(diagnostic, []).append(name)

    return {
        "execution_order": topological_order(),
        "engine_dependencies": {
            name: list(deps) for name, deps in dependency_graph().items()
        },
        "shared_diagnostics": {
            diagnostic: engines
            for diagnostic, engines in sorted(shared.items())
            if len(engines) > 1
        },
        "correlation_warning": (
            "engines sharing an upstream diagnostic are NOT independent "
            "evidence. The aggregation stage must account for this rather "
            "than summing their outputs"
        ),
    }


@router.get("/engines/training")
def training_contracts() -> dict:
    """What training each engine would require. Nothing is trained."""
    return training.coverage()


@router.get("/engines/training/{engine}")
def training_contract(engine: str) -> dict:
    spec = training.spec_for(engine)
    if spec is None:
        from ...engines.base import REGISTRY
        if engine in REGISTRY:
            return {
                "engine": engine,
                "has_spec": False,
                "reason": training.coverage()["why_some_have_none"],
            }
        raise HTTPException(404, f"no engine {engine!r}")
    return spec.to_dict()


@router.get("/engines/{model_id}/{forecast_hour}")
def engines_at_point(
    model_id: str,
    forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    member: int | None = Query(None),
    run: str | None = Query(None, description="ISO cycle; omit for latest"),
    features: bool = Query(False, description="include the shared features"),
) -> dict:
    """Every specialist engine's result at one point.

    Each carries its score, what kind of score it is, confidence,
    uncertainty, contributing features, explanation and provenance. Results
    are returned SIDE BY SIDE and are not combined.
    """
    from ...grid import grid_lonlat
    from ...pipeline.ingest import stored_runs
    from ...profiles.build import build_profile, point_profile
    from .profiles import _grid_of

    runs = stored_runs(model_id)
    if not runs:
        raise HTTPException(404, f"no stored runs for {model_id}")
    try:
        cycle = (
            datetime.fromisoformat(run.replace("Z", "+00:00")) if run
            else runs[-1]
        )
    except ValueError:
        raise HTTPException(400, f"could not parse run {run!r}") from None
    if cycle not in runs:
        raise HTTPException(
            404,
            f"{model_id} has no stored run {cycle.isoformat()}; "
            f"available: {[r.isoformat() for r in runs]}",
        )

    try:
        cube = build_profile(model_id, cycle, forecast_hour, member=member)
    except (LookupError, ValueError) as exc:
        raise HTTPException(404, str(exc)) from None

    if not cube.usable:
        return {
            "error": "no usable profile, so no engine could run",
            "profile": cube.to_dict(),
        }

    variable = next(
        iter(list(cube.pressure.values()) + list(cube.height.values())), None
    )
    if variable is None or variable.values.ndim < 3:
        raise HTTPException(404, "profile carries no gridded field to index")

    try:
        lons, lats = grid_lonlat(
            _grid_of(model_id, cycle, forecast_hour, member)
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(
            500, f"could not georeference the grid: {exc}"
        ) from None

    distance = (lons - lon) ** 2 + (lats - lat) ** 2
    iy, ix = np.unravel_index(int(np.argmin(distance)), distance.shape)

    point = point_profile(
        cube, int(iy), int(ix),
        latitude=float(lats[iy, ix]), longitude=float(lons[iy, ix]),
    )

    elevation = None
    terrain = cube.surface.get("terrain_height")
    if terrain is not None:
        try:
            value = float(np.asarray(terrain)[iy, ix])
            elevation = value if np.isfinite(value) else None
        except (IndexError, TypeError, ValueError):
            elevation = None

    forecast = pipeline.run_for_profile(point, elevation=elevation)
    return forecast.to_dict(include_features=features)
