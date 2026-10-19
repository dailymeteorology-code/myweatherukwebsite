"""TCM convective risk endpoints."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...forecast import service
from ...grid import tcm_grid

router = APIRouter(tags=["risk"])


# Declared BEFORE /risk/{forecast_hour}: FastAPI matches routes in order, and
# the parameterised one would otherwise swallow "peak" and fail to parse it as
# an integer.
@router.get("/risk/peak")
def risk_peak(forecast_hour: int | None = None, day: str | None = None) -> dict:
    """The highest-risk point, for the map's marker."""
    if forecast_hour is None and day is None:
        raise HTTPException(400, "pass either forecast_hour or day")
    try:
        return service.peak_point(forecast_hour=forecast_hour, day=day)
    except (LookupError, ValueError) as exc:
        raise HTTPException(404, str(exc)) from None


@router.get("/risk/{forecast_hour}")
def risk(forecast_hour: int) -> dict:
    """Convective risk for one lead time, with its ingredient audit."""
    try:
        result = service.convective_risk(forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return result.to_dict()


@router.get("/risk/{forecast_hour}/point")
def risk_point(
    forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
) -> dict:
    """Convective risk at a location."""
    from pyproj import Transformer

    try:
        result = service.convective_risk(forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    g = tcm_grid()
    tf = Transformer.from_crs("EPSG:4326", g.projection, always_xy=True)
    x, y = tf.transform(lon, lat)
    col = int(round((x - g.x0) / g.spacing_m - 0.5))
    row = int(round((y - g.y0) / g.spacing_m - 0.5))
    if not (0 <= row < g.ny and 0 <= col < g.nx):
        raise HTTPException(400, "point is outside the TCM grid")

    def at(a):
        if a is None:
            return None
        v = a[row, col]
        return None if not np.isfinite(v) else float(v)

    index = at(result.thunderstorm_risk_index)
    from ...forecast.risk import RiskLevel

    return {
        "lon": lon, "lat": lat,
        "forecast_hour": forecast_hour,
        "valid_time": result.valid_time.isoformat(),
        "thunderstorm_risk_index": index,
        "level": RiskLevel.from_index(index or 0.0).value,
        "hail_index": at(result.hail_index),
        "heavy_rain_index": at(result.heavy_rain_index),
        "lightning_probability_percent": (
            None if result.lightning_probability is None
            else round((at(result.lightning_probability) or 0.0) * 100, 1)
        ),
        "regime": result.regime.regime.value,
        "missing_ingredients": result.missing_ingredients,
        "completeness": round(result.completeness, 2),
        "index_is_calibrated": False,
    }


@router.get("/risk")
def risk_timeline(
    hours: str | None = Query(None, description="comma-separated lead times"),
) -> dict:
    """Peak risk across the forecast, for the timeline strip."""
    wanted = (
        [int(h) for h in hours.split(",")] if hours
        else service.available_hours()
    )
    out = []
    for fh in wanted:
        try:
            result = service.convective_risk(fh)
        except (LookupError, ValueError):
            continue
        out.append({
            "forecast_hour": fh,
            "valid_time": result.valid_time.isoformat(),
            "peak_index": round(result.peak_index, 1),
            "level": result.level.value,
            "regime": result.regime.regime.value,
            "completeness": round(result.completeness, 2),
        })
    return {
        "timeline": out,
        "count": len(out),
        "index_is_calibrated": False,
    }


@router.get("/risk-days")
def risk_days() -> dict:
    """Day-level risk, each with the hours behind it."""
    days = service.daily_risk()
    return {
        "days": days,
        "count": len(days),
        "index_is_calibrated": False,
        "note": (
            "Each day is summarised by its most SEVERE hour, not its highest "
            "index: the index saturates, so maxima cannot rank anything."
        ),
    }


@router.get("/render/day/{day}.png")
def render_day(day: str, style: str = "detailed"):
    """Whole-day risk map: the maximum across 00:00-23:59 UTC."""
    from fastapi.responses import Response

    from ...grid import Field
    from ...render.raster import render

    try:
        built = service.day_risk_field(day)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    # Metadata comes from whichever ingredient the day actually has; see
    # render.field_meta_for.
    from .render import field_meta_for

    meta = field_meta_for(built["hours"][0])
    if meta is None:
        raise HTTPException(404, "no field metadata for this day")

    # Cached like every other raster: the whole-day image is the largest one
    # the site draws (a max over up to 24 lead times) and is requested on
    # every page load.
    from ...forecast.cache import RENDER
    from ...pipeline.ingest import stored_runs

    runs = stored_runs("ukv")
    from .render import _styled

    values = _styled(built["values"], style)
    image = RENDER.get_or_compute(
        runs[-1] if runs else None, ("day", day, style),
        lambda: render(Field(values, meta), "risk"),
    )
    return Response(
        content=image.png, media_type="image/png",
        headers={
            **image.headers(),
            "X-TCM-Day": day,
            "X-TCM-Hours": ",".join(str(h) for h in built["hours"]),
            "Cache-Control": "public, max-age=600",
        },
    )
