"""Export endpoints for downstream tools."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...forecast import service

router = APIRouter(tags=["export"])


@router.get("/export/studio")
def studio(
    step_deg: float | None = Query(None, ge=0.25, le=3.0),
    include_steps: bool = Query(
        False, description="include perStep (large); perDay only by default"
    ),
) -> dict:
    """A TCM run in the Thunderstorm Graphic Studio's payload shape.

    Matches `lib/tcmForecastCache.js` so the existing tool can draw a V3 run
    unmodified. Scores use the canonical `riskConfig.jsx` bands.
    """
    try:
        return service.studio_export(
            step_deg, include_steps=include_steps
        ).to_dict()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
