"""Derived meteorological parameters.

Stage 4. Exposes the parameter engine for inspection: the registry of what
every quantity means, and the full derived set at a point with the status,
method, inputs and quality flags of each value.

Nothing here forecasts. There is no risk, no probability and no hazard
likelihood -- those belong to later stages. These routes report what the
atmosphere looks like, and a route that quietly returned a probability would
put forecasting logic in the diagnostic layer, which is the boundary this
stage exists to hold.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...parameters import engine, registry

router = APIRouter(tags=["parameters"])


@router.get("/parameters/registry")
def parameter_registry(category: str | None = Query(None)) -> dict:
    """Every derived parameter: definition, units, sign convention, inputs,
    limitations and scientific references."""
    entries = registry.to_dict()
    if category:
        try:
            wanted = registry.Category(category)
        except ValueError:
            raise HTTPException(
                400,
                f"unknown category {category!r}; expected one of "
                f"{[c.value for c in registry.Category]}",
            ) from None
        entries = {
            name: spec for name, spec in entries.items()
            if spec["category"] == wanted.value
        }
    return {
        "count": len(entries),
        "categories": [c.value for c in registry.Category],
        "parameters": entries,
    }


@router.get("/parameters/registry/{name}")
def parameter_definition(name: str) -> dict:
    spec = registry.get(name)
    if spec is None:
        raise HTTPException(404, f"no registered parameter {name!r}")
    return spec.to_dict()


@router.get("/parameters/dependencies")
def dependencies() -> dict:
    """What each parameter is computed from.

    The expensive shared nodes are `parcel_ascent` -- one lift serving CAPE,
    CIN, LCL, LFC, EL, the lifted index and the cloud depths -- and
    `storm_motion_right`, serving every storm-relative quantity. The engine
    computes each once per column.
    """
    return {
        "dependencies": {
            name: list(deps)
            for name, deps in registry.dependency_graph().items()
        }
    }


@router.get("/parameters/{model_id}/{forecast_hour}")
def parameters_at_point(
    model_id: str,
    forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    member: int | None = Query(None),
    run: str | None = Query(None, description="ISO cycle; omit for the latest"),
    profiles: bool = Query(
        False, description="include the full lifted-parcel profiles"
    ),
) -> dict:
    """Every derived parameter at one point.

    Each value carries its status, the method that produced it, the fields
    and levels it used, and any quality flags. A parameter that could not be
    calculated is reported as unavailable WITH A REASON -- never as zero.
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
            "error": "no usable profile could be built, so no parameter is "
                     "calculable",
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

    # Nearest cell, used as it is. No horizontal interpolation: the profile
    # engine does not do it and the parameter engine must not invent it.
    distance = (lons - lon) ** 2 + (lats - lat) ** 2
    iy, ix = np.unravel_index(int(np.argmin(distance)), distance.shape)

    point = point_profile(
        cube, int(iy), int(ix),
        latitude=float(lats[iy, ix]), longitude=float(lons[iy, ix]),
    )
    derived = engine.compute(point)
    out = derived.to_dict(include_ascents=profiles)
    out["profile_quality"] = point.quality()
    return out
