"""Atmospheric profiles.

Stage 3. These routes expose the profile engine for inspection: what each
model can support, and what a reconstructed profile actually contains at a
point, with the provenance of every level.

Nothing here interprets a profile. No stability, no shear, no risk -- those
belong to Stage 4 and later. A profile route that quietly returned a
diagnostic would put forecasting logic in the data layer, which is exactly
the boundary this stage exists to hold.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from ...catalogue import service as capability_service
from ...profiles.availability import matrix, profile_availability

router = APIRouter(tags=["profiles"])


@router.get("/profiles/availability")
async def availability(refresh: bool = Query(False)) -> dict:
    """The variable-availability matrix, derived from live capabilities."""
    caps = await capability_service.all_capabilities(refresh=refresh)
    return matrix(caps)


@router.get("/profiles/availability/{model_id}")
async def model_availability(model_id: str) -> dict:
    cap = await capability_service.capability(model_id)
    return profile_availability(cap).to_dict()


@router.get("/profiles/{model_id}/{forecast_hour}")
def profile_at_point(
    model_id: str,
    forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    member: int | None = Query(None),
    run: str | None = Query(None, description="ISO cycle; omit for the latest"),
) -> dict:
    """The reconstructed vertical profile at one point.

    Returns structure and provenance: which levels came from the model,
    which were interpolated and from what, and which are unavailable or
    below ground.
    """
    from ...grid import grid_lonlat
    from ...pipeline.ingest import stored_runs
    from ...profiles.build import build_profile, point_profile

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
        cube = build_profile(
            model_id, cycle, forecast_hour, member=member,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(404, str(exc)) from None

    if not cube.usable:
        return {
            "error": "no usable profile could be built",
            "profile": cube.to_dict(),
        }

    # Locate the requested point on whichever grid the fields came in on.
    variable = next(
        iter(list(cube.pressure.values()) + list(cube.height.values())), None
    )
    if variable is None or variable.values.ndim < 3:
        raise HTTPException(404, "profile carries no gridded field to index")

    try:
        lons, lats = grid_lonlat(_grid_of(model_id, cycle, forecast_hour, member))
    except (LookupError, ValueError) as exc:
        raise HTTPException(
            500, f"could not georeference the grid: {exc}"
        ) from None

    import numpy as np
    # Nearest cell by squared degrees. Adequate over this domain and, more
    # to the point, HONEST: the cell is used as it is, and no horizontal
    # interpolation happens inside the vertical engine.
    distance = (lons - lon) ** 2 + (lats - lat) ** 2
    iy, ix = np.unravel_index(int(np.argmin(distance)), distance.shape)

    point = point_profile(cube, int(iy), int(ix),
                          latitude=float(lats[iy, ix]),
                          longitude=float(lons[iy, ix]))
    out = point.to_dict()
    out["values"] = {
        "pressure": {
            name: [
                None if not p.origin.has_value or not np.isfinite(v)
                else round(float(v), 4)
                for v, p in zip(var.values, var.provenance)
            ]
            for name, var in point.pressure.items()
        },
        "height": {
            name: [
                None if not p.origin.has_value or not np.isfinite(v)
                else round(float(v), 4)
                for v, p in zip(var.values, var.provenance)
            ]
            for name, var in point.height.items()
        },
    }
    return out


def _grid_of(model_id: str, run, forecast_hour: int, member: int | None):
    """The grid the stored fields for this model actually use."""
    from ...pipeline.ingest import load_field
    from ...profiles.build import PRESSURE_VARIABLES
    from ...profiles.levels import STANDARD_PRESSURE_LEVELS, VerticalCoordinate, label

    for stem, _ in PRESSURE_VARIABLES:
        for level in STANDARD_PRESSURE_LEVELS:
            name = f"{stem}_{label(level, VerticalCoordinate.ISOBARIC)}"
            field = load_field(model_id, run, name, forecast_hour, member)
            if field is not None and field.meta.grid is not None:
                return field.meta.grid
    raise LookupError("no stored profile field carries a grid")
