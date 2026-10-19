"""Field endpoints: metadata, provenance, and values.

`/fields/.../meta` is deliberately separate from `/fields/.../values`, and the
metadata route is cheap. A client should be able to discover that a field is
25 km ECMWF upsampled onto a 2 km mesh WITHOUT downloading 290,745 floats.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ...pipeline.ingest import load_field

router = APIRouter(tags=["fields"])


def _parse_run(run: str) -> datetime:
    try:
        when = datetime.fromisoformat(run.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "run must be ISO-8601") from None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _load(model_id, run, parameter, forecast_hour, member):
    f = load_field(model_id, _parse_run(run), parameter, forecast_hour, member)
    if f is None:
        raise HTTPException(
            404,
            f"{model_id}/{parameter} T+{forecast_hour} for run {run} is not "
            "in the store; ingest it first",
        )
    return f


@router.get("/fields/{model_id}/{run}/{parameter}/{forecast_hour}/meta")
def field_meta(
    model_id: str, run: str, parameter: str, forecast_hour: int,
    member: int | None = Query(None),
) -> dict:
    f = _load(model_id, run, parameter, forecast_hour, member)
    values = f.values
    finite = np.isfinite(values)
    stats = {
        "min": float(np.nanmin(values)) if finite.any() else None,
        "max": float(np.nanmax(values)) if finite.any() else None,
        "mean": float(np.nanmean(values)) if finite.any() else None,
        "finite_fraction": float(finite.mean()),
    }
    return {"meta": f.meta.to_dict(), "stats": stats, "shape": list(values.shape)}


@router.get("/fields/{model_id}/{run}/{parameter}/{forecast_hour}/values")
def field_values(
    model_id: str, run: str, parameter: str, forecast_hour: int,
    member: int | None = Query(None),
    fmt: str = Query("npy", pattern="^(npy|json)$"),
):
    """Raw values. `npy` is the efficient path; `json` is for debugging."""
    f = _load(model_id, run, parameter, forecast_hour, member)
    if fmt == "json":
        return {
            "meta": f.meta.to_dict(),
            "shape": list(f.values.shape),
            "values": np.where(
                np.isfinite(f.values), f.values, None
            ).tolist(),
        }
    import io

    buf = io.BytesIO()
    np.save(buf, f.values.astype("float32"))
    return Response(
        content=buf.getvalue(),
        media_type="application/octet-stream",
        headers={
            "X-TCM-Model": f.meta.model,
            "X-TCM-Parameter": f.meta.parameter,
            "X-TCM-Resolution": f.meta.resolution_label,
            "X-TCM-Effective-Resolution-M": str(f.meta.effective_resolution_m),
            "X-TCM-Regridded": str(f.meta.regridded).lower(),
            "X-TCM-Upsampled": str(f.meta.is_upsampled).lower(),
        },
    )


@router.get("/fields/{model_id}/{run}/{parameter}/{forecast_hour}/point")
def field_point(
    model_id: str, run: str, parameter: str, forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    member: int | None = Query(None),
) -> dict:
    """Value at a location, with the provenance that produced it."""
    from pyproj import Transformer

    f = _load(model_id, run, parameter, forecast_hour, member)
    g = f.meta.grid
    tf = Transformer.from_crs("EPSG:4326", g.projection, always_xy=True)
    x, y = tf.transform(lon, lat)
    col = int(round((x - g.x0) / g.spacing_m - 0.5))
    row = int(round((y - g.y0) / g.spacing_m - 0.5))
    if not (0 <= row < g.ny and 0 <= col < g.nx):
        raise HTTPException(400, "point is outside the TCM grid")
    value = f.values[row, col]
    return {
        "lon": lon, "lat": lat, "row": row, "col": col,
        "value": None if not np.isfinite(value) else float(value),
        "units": f.meta.units,
        "valid_time": f.meta.valid_time.isoformat(),
        "resolution_label": f.meta.resolution_label,
        "effective_resolution_m": f.meta.effective_resolution_m,
        "source": {
            "provider": f.meta.provider,
            "model": f.meta.model,
            "source_uri": f.meta.source_uri,
        },
    }
