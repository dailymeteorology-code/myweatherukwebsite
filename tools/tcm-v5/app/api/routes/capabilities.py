"""What each model can actually deliver right now.

Stage 2. This is the availability API the later forecasting stages will ask
before requesting anything, and it is deliberately separate from
`/api/models`: that route reports what a model IS, from the registry, while
this one reports what it is CURRENTLY SERVING, from the provider.

The two can disagree, and when they do this route is the truthful one.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from ...catalogue import service
from ...catalogue.capabilities import available

router = APIRouter(tags=["capabilities"])


@router.get("/capabilities")
async def capabilities(refresh: bool = Query(False)) -> dict:
    """Every provisioned model and what it is serving."""
    caps = await service.all_capabilities(refresh=refresh)
    return {
        "models": {k: v.to_dict() for k, v in caps.items()},
        "note": (
            "Discovered from each provider's own catalogue, not declared. "
            "A model listed in /api/models but absent here is registered "
            "and not currently obtainable."
        ),
    }


@router.get("/capabilities/{model_id}")
async def model_capability(model_id: str, refresh: bool = Query(False)) -> dict:
    cap = await service.capability(model_id, refresh=refresh)
    return cap.to_dict()


@router.get("/capabilities/{model_id}/{canonical}")
async def field_availability(
    model_id: str,
    canonical: str,
    forecast_hour: int | None = Query(None),
    member: int | None = Query(None),
) -> dict:
    """Can this exact field be requested?

    Always answers with a reason, so a downstream 'missing' can be explained
    without re-deriving why.
    """
    cap = await service.capability(model_id)
    verdict = available(cap, canonical, forecast_hour, member)
    field = cap.fields.get(canonical)
    return {
        "model": model_id,
        "parameter": canonical,
        "forecast_hour": forecast_hour,
        "member": member,
        "available": verdict.available,
        "reason": verdict.reason or None,
        "served_hours": list(field.forecast_hours) if field else [],
        "members": list(field.members) if field else [],
        "level_type": field.level_type.value if field else None,
        "level": field.level if field else None,
        "units": field.units if field else None,
        "native": {
            "surface": field.native_surface,
            "parameter": field.native_parameter,
            "level": field.native_level,
        } if field else None,
    }
