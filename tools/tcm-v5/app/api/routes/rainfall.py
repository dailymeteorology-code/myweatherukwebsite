"""Precipitation accumulation endpoints, including rolling 24-hour rainfall."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ...forecast import service
from ...forecast.precipitation import ROLLING_WINDOW_H, STANDARD_WINDOWS

router = APIRouter(tags=["rainfall"])


@router.get("/rainfall/windows")
def windows() -> dict:
    return {
        "windows_hours": list(STANDARD_WINDOWS),
        "rolling_window_hours": ROLLING_WINDOW_H,
        "note": (
            "An accumulation is the SUM of hourly fields, never their mean. "
            "A window missing hours is returned with `complete: false` and a "
            "warning rather than being silently under-reported."
        ),
    }


@router.get("/rainfall/{forecast_hour}")
def accumulation(
    forecast_hour: int,
    window: int = Query(ROLLING_WINDOW_H, ge=1, le=48),
) -> dict:
    try:
        return service.rainfall_accumulation(forecast_hour, window).to_dict()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/rainfall/rolling/series")
def rolling_series(
    window: int = Query(ROLLING_WINDOW_H, ge=1, le=48),
) -> dict:
    """Every lead time with a COMPLETE rolling window, for animation.

    Partial windows are excluded deliberately: an animation mixing complete
    and partial totals shows rainfall appearing to fall and then vanish as
    hours drop out of the store.
    """
    series = service.rolling_rainfall_series(window)
    return {
        "window_hours": window,
        "count": len(series),
        "frames": [a.to_dict() for a in series],
        "note": (
            "Only complete windows are listed. If this is empty, no lead "
            "time has all the hourly fields its window needs."
        ),
    }


@router.get("/render/rolling24/{forecast_hour}.png")
def render_rolling(forecast_hour: int, window: int = Query(ROLLING_WINDOW_H)):
    from ...grid import Field
    from ...render.raster import render

    try:
        accumulated = service.rainfall_accumulation(forecast_hour, window)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    image = render(Field(accumulated.values, accumulated.meta), "rainfall")
    headers = {
        **image.headers(),
        "X-TCM-Accumulation-Complete": str(accumulated.complete).lower(),
        "X-TCM-Hours-Present": f"{accumulated.hours_present}/{accumulated.hours_required}",
    }
    return Response(content=image.png, media_type="image/png", headers=headers)
