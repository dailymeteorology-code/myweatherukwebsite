"""UK spatial, terrain, coastal and mesoscale intelligence.

Stage 8. Physical quantities on the TCM grid -- metres per second of
orographic ascent, kelvin of land-sea contrast, per-second convergence,
metres to the coast -- with no forecast probability anywhere in them.

Section 61: this layer FEEDS the specialist engines, the model weighting and
the final probability. It does not produce a competing answer of its own,
and `/api/spatial/contract` says so on every response.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...spatial import ablation as spatial_ablation
from ...spatial import intelligence as SI
from ...spatial import integrate as spatial_integrate
from ...spatial import regional as spatial_regional
from ...spatial import static as spatial_static

router = APIRouter(tags=["spatial"])

#: Fields Stage 8 reads. Each missing one disables what needs it, with a
#: stated reason, rather than being replaced by an assumption.
INPUT_FIELDS = (
    "u_wind_10m", "v_wind_10m", "temperature_2m",
    "wet_bulb_potential_temperature_850", "boundary_layer_height",
    "cape_surface", "cin",
)


@router.get("/spatial")
def contract() -> dict:
    """What Stage 8 produces, and what it refuses to produce."""
    from ...spatial import terrain as T
    from ...spatial import neighbourhood as N

    return {
        "stage": 8,
        "processing_version": spatial_static.PROCESSING_VERSION,
        "purpose": (
            "makes TCM understand that a 2 km cell is not an isolated "
            "point: terrain forcing, coastal forcing, mesoscale boundaries, "
            "neighbourhood structure and geographic context"
        ),
        "guarantees": [
            "every feature is a PHYSICAL QUANTITY in a stated unit; there "
            "is no scoring machinery in this stage at all",
            "no regional multipliers: regions are analysis contexts and "
            "stratification keys, and carry no number that could adjust a "
            "forecast",
            "unavailable is None with a reason, never zero -- a zero would "
            "tell the initiation engine there is no forcing anywhere",
            "every feature carries its quality, its lineage and its "
            "provenance including the spatial scale it was computed at",
            "observational inputs are marked as such and refused in a "
            "historical forecast reconstruction",
            "outflow detection is UNAVAILABLE, because model precipitation "
            "is not evidence of a cold pool",
        ],
        "scales_m": {**T.SCALES, "event": N.SCALE_EVENT_M},
        "feeds": {
            "stage_5": (
                "convergence, frontogenesis, moisture flux convergence and "
                "terrain-forced vertical velocity -- the forcing the "
                "initiation engine was written to consume and a point "
                "evaluation cannot supply"
            ),
            "stage_6": "a geographic stratification key, and nothing else",
            "stage_7": "spatial structure for provenance and verification",
        },
        "terrain_source": (
            "the Met Office UKV model's own orography at its native 2 km, "
            "not a survey DEM: peaks are smoothed (Ben Nevis reads ~800 m). "
            "It is what the model's own wind field actually flowed over, "
            "which is what the flow diagnostics need"
        ),
        "input_fields": list(INPUT_FIELDS),
    }


@router.get("/spatial/geography")
def geography(model_id: str = Query("ukv")) -> dict:
    """The static layer: terrain and land-sea, and its quality control."""
    try:
        geo = spatial_static.load(model_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return {
        **geo.describe(),
        "validation": spatial_static.validate(geo) or ["clean"],
    }


@router.get("/spatial/regions")
def regions(model_id: str = Query("ukv")) -> dict:
    """Regional analysis contexts. Geography only -- section 77."""
    from ...grid import grid_lonlat, tcm_grid
    from ...spatial import coast as C
    from ...spatial import terrain as T

    try:
        geo = spatial_static.load(model_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    contexts = spatial_regional.contexts(
        geo, T.geometry(geo), C.analyse(geo), grid_lonlat(tcm_grid())
    )
    return spatial_regional.describe(contexts)


def _build(model_id: str, forecast_hour: int, run: str | None):
    """Load the fields and run the Stage 8 chain."""
    from ...grid import grid_lonlat, tcm_grid
    from ...pipeline.ingest import load_field, stored_runs

    runs = stored_runs(model_id)
    if not runs:
        raise HTTPException(404, f"no stored runs for {model_id}")
    try:
        cycle = (
            datetime.fromisoformat(run.replace("Z", "+00:00")) if run
            else runs[-1]
        )
    except ValueError:
        raise HTTPException(400, f"could not parse run {run!r}") from None

    try:
        geo = spatial_static.load(model_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    def field(name: str):
        stored = load_field(model_id, cycle, name, forecast_hour)
        return stored.values if stored is not None else None

    u, v = field("u_wind_10m"), field("v_wind_10m")
    if u is None or v is None:
        raise HTTPException(
            404,
            f"{model_id} has no 10 m wind stored for "
            f"{cycle:%Y-%m-%d %HZ} T+{forecast_hour}. Every terrain-flow "
            f"and boundary diagnostic needs it, so nothing can be computed",
        )

    valid_time = cycle.replace(tzinfo=timezone.utc)
    from datetime import timedelta
    valid_time = valid_time + timedelta(hours=forecast_hour)

    # Hours since sunrise, needed for inland penetration. Left as None
    # outside daylight rather than assumed: a sea-breeze front has not
    # travelled for six hours at midnight.
    from ...engines.features import local_solar_hour
    solar = local_solar_hour(valid_time, -2.0)
    hours_since_sunrise = solar - 6.0 if 6.0 <= solar <= 20.0 else None

    inputs = SI.AtmosphericInputs(
        u=u, v=v, temperature=field("temperature_2m"),
        theta_e=field("wet_bulb_potential_temperature_850"),
        boundary_layer_depth=field("boundary_layer_height"),
        cape=field("cape_surface"), cin=field("cin"),
        wind_level="10m", hours_since_sunrise=hours_since_sunrise,
    )
    si = SI.build(
        geo, inputs, model=model_id, run=cycle, valid_time=valid_time,
        lonlat=grid_lonlat(tcm_grid()),
    )
    return si, cycle


@router.get("/spatial/{model_id}/{forecast_hour}")
def spatial_summary(
    model_id: str, forecast_hour: int,
    run: str | None = Query(None),
    objects: bool = Query(False, description="include detected structures"),
) -> dict:
    """The whole spatial layer for one model at one lead time."""
    si, _ = _build(model_id, forecast_hour, run)
    out = si.describe()
    out["features_detail"] = {
        name: feature.summary()
        for name, feature in sorted(si.features.items())
    }
    if objects:
        out["detected"] = [
            o.to_dict() for o in sorted(
                si.spatial_objects, key=lambda o: o.length_m, reverse=True
            )[:50]
        ]
    return out


@router.get("/spatial/{model_id}/{forecast_hour}/point")
def spatial_point(
    model_id: str, forecast_hour: int,
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    run: str | None = Query(None),
) -> dict:
    """Every spatial feature at one point, plus what it hands downstream."""
    from ...grid import grid_lonlat, tcm_grid

    si, cycle = _build(model_id, forecast_hour, run)
    lons, lats = grid_lonlat(tcm_grid())
    distance = (lons - lon) ** 2 + (lats - lat) ** 2
    iy, ix = np.unravel_index(int(np.argmin(distance)), distance.shape)

    forcing = spatial_integrate.stage5_forcing(si, int(iy), int(ix))
    return {
        "model": model_id,
        "run": cycle.isoformat(),
        "forecast_hour": forecast_hour,
        "location": {
            "requested": {"lon": lon, "lat": lat},
            "grid_cell": {
                "row": int(iy), "col": int(ix),
                "lon": round(float(lons[iy, ix]), 4),
                "lat": round(float(lats[iy, ix]), 4),
            },
        },
        "features": {
            name: {
                "value": (
                    None if value is None else float(f"{value:.6g}")
                ),
                "unit": si.features[name].unit,
                "quality": si.features[name].quality.value,
            }
            for name, value in sorted(si.at(int(iy), int(ix)).items())
        },
        "unavailable": si.unavailable(),
        "stage5_forcing": {
            "values": {
                k: (None if v is None else float(f"{v:.6g}"))
                for k, v in forcing.values.items()
            },
            "reasons": {k: v for k, v in forcing.reasons.items() if v},
            "note": (
                "these are the horizontal-field quantities a point "
                "evaluation cannot produce. Without them the initiation "
                "engine has no forcing and caps itself"
            ),
        },
        "stage6_context": spatial_integrate.stage6_context(si, lon, lat),
        "stage7_context": spatial_integrate.stage7_context(
            si, int(iy), int(ix)
        ),
    }


@router.get("/spatial/{model_id}/{forecast_hour}/leakage")
def leakage(
    model_id: str, forecast_hour: int,
    run: str | None = Query(None),
    historical: bool = Query(True),
) -> dict:
    """Step 14: confirm no feature uses information from after the forecast."""
    si, _ = _build(model_id, forecast_hour, run)
    return spatial_ablation.leakage_audit(si, historical=historical)


@router.get("/spatial/skill-value")
def skill_value() -> dict:
    """Section 75's does-it-help question, answered honestly."""
    return spatial_ablation.skill_comparison()
