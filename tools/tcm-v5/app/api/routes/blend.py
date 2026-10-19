"""Blend and ensemble endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...blend import service
from ...blend.explain import why_it_changed, why_this_blend
from ...derived.ensemble import PERCENTILES
from ...grid import tcm_grid

router = APIRouter(tags=["blend"])


def _cell(lon: float, lat: float) -> tuple[int, int]:
    from pyproj import Transformer

    g = tcm_grid()
    tf = Transformer.from_crs("EPSG:4326", g.projection, always_xy=True)
    x, y = tf.transform(lon, lat)
    col = int(round((x - g.x0) / g.spacing_m - 0.5))
    row = int(round((y - g.y0) / g.spacing_m - 0.5))
    if not (0 <= row < g.ny and 0 <= col < g.nx):
        raise HTTPException(400, "point is outside the TCM grid")
    return row, col


def _num(v) -> float | None:
    return None if v is None or not np.isfinite(v) else float(v)


@router.get("/blend/parameters")
def blendable() -> dict:
    """Which parameters can be blended, and from how many models."""
    mapping = service.blendable_parameters()
    return {
        "parameters": [
            {
                "parameter": p,
                "models": models,
                "model_count": len(models),
                "is_multi_model": len(models) > 1,
            }
            for p, models in mapping.items()
        ],
        "note": (
            "A parameter offered by a single model is a passthrough, not a "
            "multi-model consensus, and is labelled as such."
        ),
    }


@router.get("/blend/{parameter}/{forecast_hour}")
def blend_parameter(parameter: str, forecast_hour: int) -> dict:
    try:
        result = service.blend_parameter(parameter, forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from None

    values = result.values
    finite = np.isfinite(values)
    return {
        **result.to_dict(),
        "stats": {
            "min": _num(np.nanmin(values)) if finite.any() else None,
            "max": _num(np.nanmax(values)) if finite.any() else None,
            "mean": _num(np.nanmean(values)) if finite.any() else None,
            "coverage_percent": round(float(finite.mean()) * 100, 1),
        },
        "units": result.meta.units,
    }


@router.get("/blend/{parameter}/{forecast_hour}/why")
def blend_why(parameter: str, forecast_hour: int) -> dict:
    """The TCM ADAPTIVE BLEND panel: weights and the reasoning behind them."""
    try:
        result = service.blend_parameter(parameter, forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return why_this_blend(result)


@router.get("/blend/{parameter}/{forecast_hour}/changed-from/{other_hour}")
def blend_changed(parameter: str, forecast_hour: int, other_hour: int) -> dict:
    """Why the blend differs between two lead times of the same parameter."""
    try:
        current = service.blend_parameter(parameter, forecast_hour)
        previous = service.blend_parameter(parameter, other_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return why_it_changed(current, previous)


@router.get("/blend/{parameter}/{forecast_hour}/point")
def blend_point(
    parameter: str, forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
) -> dict:
    """Blended value at a point, with the local weights that produced it.

    Weights here are the LOCAL ones, not the grid-mean shown in the panel:
    the blend varies geographically, so a point in Cornwall and a point in
    Shetland can be built from different mixtures.
    """
    try:
        result = service.blend_parameter(parameter, forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    row, col = _cell(lon, lat)
    local = []
    for c in result.contributions:
        if not c.eligible or c.weight_field is None:
            continue
        w = c.weight_field[row, col]
        if np.isfinite(w):
            local.append({
                "model": c.model_id,
                "weight_percent": round(float(w) * 100, 1),
            })
    local.sort(key=lambda d: d["weight_percent"], reverse=True)

    return {
        "parameter": parameter,
        "lon": lon, "lat": lat, "row": row, "col": col,
        "value": _num(result.values[row, col]),
        "units": result.meta.units,
        "valid_time": result.valid_time.isoformat(),
        "local_blend": local,
        "confidence": result.confidence.value,
        "main_uncertainty": result.main_uncertainty,
        "effective_resolution_m": result.meta.effective_resolution_m,
    }


# --- ensemble -------------------------------------------------------------

@router.get("/ensemble/{model_id}/{parameter}/{forecast_hour}")
def ensemble(model_id: str, parameter: str, forecast_hour: int) -> dict:
    try:
        summary = service.ensemble_summary(model_id, parameter, forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from None

    stats = {}
    for p in PERCENTILES:
        v = summary.percentiles[p].values
        stats[f"P{p}"] = {
            "min": _num(np.nanmin(v)),
            "mean": _num(np.nanmean(v)),
            "max": _num(np.nanmax(v)),
        }
    return {
        **summary.summary_dict(),
        "percentile_stats": stats,
        "mean_spread": _num(np.nanmean(summary.spread)),
        "mean_iqr": _num(np.nanmean(summary.iqr)),
    }


@router.get("/ensemble/{model_id}/{parameter}/{forecast_hour}/point")
def ensemble_point(
    model_id: str, parameter: str, forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
) -> dict:
    """P10 / P50 / P90 at a point, with the small-ensemble caveat attached."""
    try:
        summary = service.ensemble_summary(model_id, parameter, forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from None

    row, col = _cell(lon, lat)
    return {
        "model": model_id,
        "parameter": parameter,
        "lon": lon, "lat": lat,
        "valid_time": summary.valid_time.isoformat(),
        "forecast_hour": forecast_hour,
        "n_members": summary.n_members,
        "members": list(summary.members),
        "percentiles": {
            f"P{p}": _num(summary.percentiles[p].values[row, col])
            for p in PERCENTILES
        },
        "spread": _num(summary.spread[row, col]),
        "iqr": _num(summary.iqr[row, col]),
        "reliability": summary.reliability.value,
        "reliability_caveat": summary.reliability.caveat(summary.n_members),
        "tails_are_meaningful": summary.reliability.tails_are_meaningful,
        "spatially_coherent": False,
        "note": (
            "Percentiles are computed independently at each grid cell. The "
            "P90 map is not a scenario any single member produced."
        ),
    }


@router.get("/clusters/{model_id}/{parameter}/{forecast_hour}")
def clusters(model_id: str, parameter: str, forecast_hour: int) -> dict:
    """Scenario clusters -- groups of whole members, unlike percentiles."""
    from ...forecast import service

    try:
        return service.scenario_clusters(
            parameter, forecast_hour, model_id
        ).to_dict()
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
