"""The final TCM V5 probabilistic forecast.

Stage 7. Produces P(thunderstorm) with separate confidence, uncertainty and
hazard probabilities, traceable back through every stage that built it.

These probabilities are UNCALIBRATED during development and the routes say
so on every response. Section 33 requires every public probability to pass
through calibration; `publishable` is False until one has been fitted and
verified, and nothing here formats around that.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...engines import pipeline as engine_pipeline
from ...skill import identity as ident
from ...tcm import evaluate as tcm_evaluate
from ...tcm import forecast as tcm_forecast
from ...tcm.aggregate import Pooling

router = APIRouter(tags=["tcm"])


@router.get("/tcm")
def contract() -> dict:
    """What TCM forecasts, how, and what it refuses to do."""
    return tcm_forecast.describe()


@router.get("/tcm/event")
def event() -> dict:
    """The operational definition of the forecast target."""
    from ...tcm import event as tcm_event
    return tcm_event.to_dict()


@router.get("/tcm/{model_id}/{forecast_hour}")
def forecast_at_point(
    model_id: str,
    forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    run: str | None = Query(None, description="ISO cycle; omit for latest"),
    members: str | None = Query(
        None, description="comma-separated member numbers, for an ensemble"
    ),
    sources: bool = Query(False, description="include per-source detail"),
    pooling: str = Query("linear"),
) -> dict:
    """The final forecast at one point.

    `model_id` may be repeated in a future gridded route; for now one model
    (optionally with members) is evaluated, which is enough to exercise the
    whole chain and honest about what is available.
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
            404, f"{model_id} has no stored run {cycle.isoformat()}"
        )

    try:
        chosen = Pooling(pooling)
    except ValueError:
        raise HTTPException(
            400, f"pooling must be one of {[p.value for p in Pooling]}"
        ) from None

    member_list: list[int | None] = [None]
    if members:
        try:
            member_list = [int(m) for m in members.split(",") if m.strip()]
        except ValueError:
            raise HTTPException(400, "members must be integers") from None

    results: dict[tuple[str, int | None], object] = {}
    valid_time = None
    latitude = longitude = None
    elevation = None

    for member in member_list:
        try:
            cube = build_profile(
                model_id, cycle, forecast_hour, member=member
            )
        except (LookupError, ValueError) as exc:
            raise HTTPException(404, str(exc)) from None
        if not cube.usable:
            continue

        variable = next(
            iter(list(cube.pressure.values()) + list(cube.height.values())),
            None,
        )
        if variable is None or variable.values.ndim < 3:
            continue

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
        latitude = float(lats[iy, ix])
        longitude = float(lons[iy, ix])

        point = point_profile(
            cube, int(iy), int(ix),
            latitude=latitude, longitude=longitude,
        )
        valid_time = point.metadata.valid_time
        terrain = cube.surface.get("terrain_height")
        if terrain is not None:
            try:
                value = float(np.asarray(terrain)[iy, ix])
                elevation = value if np.isfinite(value) else None
            except (IndexError, TypeError, ValueError):
                elevation = None

        results[(model_id, member)] = engine_pipeline.run_for_profile(
            point, elevation=elevation
        ).results

    if not results or valid_time is None:
        return {
            "error": (
                "no usable profile, so no forecast could be produced. This "
                "is an inability to forecast, NOT a forecast of no "
                "thunderstorms"
            ),
            "model": model_id,
            "run": cycle.isoformat(),
        }

    forecast = tcm_forecast.produce(
        results, run=cycle, valid_time=valid_time,
        forecast_hour=forecast_hour,
        identities={model_id: ident.identify(model_id)},
        latitude=latitude, longitude=longitude,
        pooling=chosen, output_grid_spacing_m=2000.0,
    )
    return forecast.to_dict(include_sources=sources)


@router.get("/tcm/{model_id}/{forecast_hour}/ablation")
def ablation(
    model_id: str,
    forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    run: str | None = Query(None),
) -> dict:
    """Remove each engine in turn and report what moved.

    The hazard rows are the architectural check: removing a hazard engine
    must leave P(thunderstorm) exactly unchanged, or a hazard is feeding
    back into storm occurrence.
    """
    from ...grid import grid_lonlat
    from ...pipeline.ingest import stored_runs
    from ...profiles.build import build_profile, point_profile
    from .profiles import _grid_of

    runs = stored_runs(model_id)
    if not runs:
        raise HTTPException(404, f"no stored runs for {model_id}")
    cycle = (
        datetime.fromisoformat(run.replace("Z", "+00:00")) if run
        else runs[-1]
    )
    try:
        cube = build_profile(model_id, cycle, forecast_hour)
    except (LookupError, ValueError) as exc:
        raise HTTPException(404, str(exc)) from None
    if not cube.usable:
        raise HTTPException(404, "no usable profile")

    lons, lats = grid_lonlat(_grid_of(model_id, cycle, forecast_hour, None))
    distance = (lons - lon) ** 2 + (lats - lat) ** 2
    iy, ix = np.unravel_index(int(np.argmin(distance)), distance.shape)
    point = point_profile(
        cube, int(iy), int(ix),
        latitude=float(lats[iy, ix]), longitude=float(lons[iy, ix]),
    )
    results = {
        (model_id, None): engine_pipeline.run_for_profile(point).results
    }
    return tcm_evaluate.ablation_report(
        results, run=cycle, valid_time=point.metadata.valid_time,
        forecast_hour=forecast_hour,
        identities={model_id: ident.identify(model_id)},
        latitude=float(lats[iy, ix]), longitude=float(lons[iy, ix]),
    )
