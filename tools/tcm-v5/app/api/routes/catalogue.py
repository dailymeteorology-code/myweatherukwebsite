"""Catalogue endpoints: what models exist, what they really are, what we hold.

Every model response carries the honest resolution fields. A client that
renders `resolution_label` cannot accidentally print "2 km" next to a 25 km
ECMWF field, because the label is computed in `registry.py` from the
delivered resolution, not chosen by the caller.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from ...grid import tcm_grid
from ...params import PARAMS
from ...pipeline.ingest import stored_inventory, stored_runs
from ...providers import base as providers
from ...registry import MODELS, UK_IRELAND, get as get_model

router = APIRouter(tags=["catalogue"])


def _model_payload(m) -> dict:
    return {
        "id": m.id,
        "display_name": m.display_name,
        "centre": m.centre.value,
        "provider": m.provider,
        "resolution": {
            "model_native_m": m.model_native_resolution_m,
            "delivered_m": m.delivered_resolution_m,
            "label": m.resolution_label,
            "degraded_by_feed": m.resolution_is_degraded,
        },
        "grid": m.grid,
        "projection": m.projection,
        "domain": {
            "lon_min": m.domain.lon_min, "lat_min": m.domain.lat_min,
            "lon_max": m.domain.lon_max, "lat_max": m.domain.lat_max,
            "note": m.domain.note,
            "covers_uk_ireland": m.domain.covers_uk_ireland(),
        },
        "cycles_utc": list(m.cycles_utc),
        "max_forecast_hour": m.max_forecast_hour,
        "forecast_step_hours": m.forecast_step_hours,
        "ensemble": {
            "is_ensemble": m.is_ensemble,
            "members": m.n_members,
            "has_control": m.has_control,
        },
        "strengths": [g.value for g in m.strengths],
        "parameters": list(m.parameters),
        "notes": m.notes,
    }


@router.get("/models")
def list_models() -> dict:
    return {
        "models": [_model_payload(m) for m in MODELS.values()],
        "count": len(MODELS),
    }


@router.get("/models/{model_id}")
def get_model_detail(model_id: str) -> dict:
    try:
        return _model_payload(get_model(model_id))
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None


@router.get("/models/{model_id}/availability")
async def availability(model_id: str) -> dict:
    """Live probe of what the provider can supply right now."""
    try:
        model = get_model(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None

    try:
        adapter = providers.get(model.provider)
    except KeyError as exc:
        raise HTTPException(501, str(exc)) from None

    try:
        avail = await adapter.availability(model)
    except providers.DataUnavailable as exc:
        return {
            "model": model.id, "available": False, "reason": exc.detail,
            "runs": [], "parameters": [],
        }
    except providers.ProviderError as exc:
        raise HTTPException(502, exc.detail) from None

    missing = sorted(set(model.parameters) - set(avail.parameters))
    return {
        "model": model.id,
        "available": True,
        "runs": [r.isoformat() for r in avail.runs],
        "latest_run": avail.runs[-1].isoformat() if avail.runs else None,
        "parameters": list(avail.parameters),
        "missing_parameters": missing,
        "max_forecast_hour": avail.max_forecast_hour,
        "detail": avail.detail,
    }


@router.get("/models/{model_id}/runs")
def runs(model_id: str) -> dict:
    try:
        get_model(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    return {
        "model": model_id,
        "runs": [r.isoformat() for r in stored_runs(model_id)],
    }


@router.get("/models/{model_id}/runs/{run}/inventory")
def inventory(model_id: str, run: str) -> dict:
    """Exactly what is on disk for a cycle, parameter by parameter."""
    try:
        when = datetime.fromisoformat(run.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "run must be ISO-8601, e.g. 2026-08-28T12:00:00Z")
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    inv = stored_inventory(model_id, when)
    return {
        "model": model_id,
        "run": when.isoformat(),
        "parameters": inv,
        "parameter_count": len(inv),
        "field_count": sum(len(v) for v in inv.values()),
    }


@router.get("/parameters")
def parameters(group: str | None = Query(None)) -> dict:
    items = [
        {
            "name": p.name, "units": p.units, "group": p.group.value,
            "description": p.description, "accumulation": p.accumulation,
            "regrid_method": p.regrid_method,
        }
        for p in PARAMS.values()
        if group is None or p.group.value == group
    ]
    return {"parameters": items, "count": len(items)}


@router.get("/grid")
def grid() -> dict:
    g = tcm_grid()
    return {
        "name": g.name,
        "projection": g.projection,
        "nx": g.nx, "ny": g.ny,
        "spacing_m": g.spacing_m,
        "x0": g.x0, "y0": g.y0,
        "n_points": g.n_points,
        "region": {
            "lon_min": UK_IRELAND.lon_min, "lat_min": UK_IRELAND.lat_min,
            "lon_max": UK_IRELAND.lon_max, "lat_max": UK_IRELAND.lat_max,
        },
        "note": (
            "The TCM analysis grid is the UKV native mesh, so UKV is never "
            "resampled. Coarser models are upsampled onto it and report their "
            "true effective resolution via field metadata."
        ),
    }
