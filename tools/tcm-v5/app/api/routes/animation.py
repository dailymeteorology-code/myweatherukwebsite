"""Animation endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...forecast import service
from ...forecast.animation import AnimationMode

router = APIRouter(tags=["animation"])


@router.get("/animation/modes")
def modes() -> dict:
    return {
        "modes": [
            {"id": m.value, "label": m.label, "layers": list(m.layers)}
            for m in AnimationMode
        ],
        "default": AnimationMode.RISK.value,
    }


@router.get("/animation")
def animation(
    mode: str = Query("risk"),
    day: str | None = Query(None, description="YYYY-MM-DD, omit for all"),
    frame_ms: int | None = Query(None, ge=80, le=4000),
) -> dict:
    try:
        return service.build_animation(mode, day, frame_ms).to_dict()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/cache/stats")
def cache_stats() -> dict:
    from ...forecast.cache import stats

    return {"caches": stats()}
