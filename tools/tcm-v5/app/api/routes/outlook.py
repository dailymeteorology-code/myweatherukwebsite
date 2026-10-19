"""Automatic outlook endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...forecast import service

router = APIRouter(tags=["outlook"])


@router.get("/outlook")
def outlook(
    hours: str | None = Query(None, description="comma-separated lead times"),
) -> dict:
    """The automatic outlook for the current cycle.

    `audit` pairs every sentence with the diagnostics that justify it.
    """
    wanted = [int(h) for h in hours.split(",")] if hours else None
    try:
        return service.generate_outlook(wanted).to_dict()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/outlook/polygons")
def outlook_polygons(
    day: str | None = Query(None, description="YYYY-MM-DD"),
    forecast_hour: int | None = Query(None),
) -> dict:
    """Categorical outlook areas as GeoJSON, in the style of an SPC Day 1.

    Nested polygons over UK and Ireland land only. A category the field
    reaches in scattered cells but not over a drawable area is reported under
    `categories_too_small_to_draw` rather than drawn.
    """
    if day is None and forecast_hour is None:
        raise HTTPException(400, "pass either day or forecast_hour")
    try:
        return service.outlook_polygons(day=day, forecast_hour=forecast_hour)
    except (LookupError, ValueError) as exc:
        raise HTTPException(404, str(exc)) from None


@router.get("/outlook/plain")
def outlook_plain(hours: str | None = Query(None)) -> dict:
    """The same outlook, in everyday language.

    Built from the detailed outlook's own evidence, so it cannot state
    anything the detailed version does not.
    """
    from ...forecast.plain import simplify

    wanted = [int(h) for h in hours.split(",")] if hours else None
    try:
        generated = service.generate_outlook(wanted)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return {
        **simplify(generated),
        "issued_at": generated.issued_at.isoformat(),
    }


@router.get("/outlook/text")
def outlook_text(
    hours: str | None = Query(None),
) -> dict:
    wanted = [int(h) for h in hours.split(",")] if hours else None
    try:
        generated = service.generate_outlook(wanted)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return {"text": generated.text(), "issued_at": generated.issued_at.isoformat()}
