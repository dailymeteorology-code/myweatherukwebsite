"""Verification endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...verification import service

router = APIRouter(tags=["verification"])


@router.get("/verification/status")
def status() -> dict:
    """What verification can and cannot do right now."""
    return service.status()


@router.get("/verification/consistency")
def consistency(
    parameter: str = Query("cape_mixed_layer"),
    model_id: str = Query("ukv"),
    threshold: float = Query(200.0),
) -> dict:
    """How much the forecast for each valid time changed between cycles."""
    try:
        return service.run_consistency(parameter, model_id, threshold).to_dict()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/observations/poll")
def poll_observations() -> dict:
    """Pull the live strike buffer into the archive.

    The feed is a ~30 second rolling buffer, so this must run continuously
    for the archive to be usable; a single call captures only the moment.
    """
    from ...verification.observations import get_provider

    provider = get_provider()
    if not hasattr(provider, "poll"):
        raise HTTPException(
            400, f"provider {provider.name!r} has nothing to poll"
        )
    return provider.poll()


@router.get("/observations/strikes")
def observed_strikes(
    day: str | None = None,
    minutes: int | None = None,
) -> dict:
    """Individual observed strikes, as points.

    `day` returns a whole UTC day; `minutes` a rolling window ending now.
    Points rather than a gridded density, so each strike can be drawn as its
    own mark.

    The response always carries which hours were actually observed. "Every
    strike today" is a claim about completeness, and this archive is normally
    incomplete -- the feed is live, so an hour nobody polled has NO
    observation rather than zero strikes.
    """
    from datetime import date as date_type

    from ...verification.observations import get_provider

    provider = get_provider()
    archive = getattr(provider, "archive", None)
    if archive is None:
        raise HTTPException(404, "no observation archive configured")

    if day is not None:
        try:
            wanted = date_type.fromisoformat(day)
        except ValueError:
            raise HTTPException(400, "day must be YYYY-MM-DD") from None
        found = archive.strikes_on_day(wanted)
        window = {
            "date": found["date"],
            "hours_observed": found["hours_observed"],
            "hours_missing": found["hours_missing"],
            "complete": found["complete"],
            "coverage_fraction": found["coverage_fraction"],
        }
        strikes = found["strikes"]
    else:
        span = minutes or 60
        if not 1 <= span <= 1440:
            raise HTTPException(400, "minutes must be between 1 and 1440")
        found = archive.recent(span)
        if not found["observed"]:
            raise HTTPException(
                404,
                f"the last {span} minutes were never polled, so there is no "
                f"observation for them. An unobserved window is not a quiet one.",
            )
        window = {
            "window_minutes": span,
            "from": found["from"],
            "to": found["to"],
            "coverage_fraction": round(found["coverage_fraction"], 3),
            "complete": found["coverage_fraction"] >= 0.99,
        }
        strikes = found["strikes"]

    return {
        **window,
        "count": len(strikes),
        "strikes": [
            {
                "lat": round(s.lat, 4),
                "lon": round(s.lon, 4),
                "time": s.when.isoformat(),
                "amplitude": s.amplitude,
            }
            for s in strikes
        ],
        "is_forecast": False,
        "note": (
            "Observed strikes, never derived from a forecast. Hours listed "
            "under hours_missing were not polled and hold no observation -- "
            "they are gaps, not quiet periods."
        ),
    }


@router.get("/observations/status")
def observations_status() -> dict:
    from ...verification.observations import get_provider

    return get_provider().status()
