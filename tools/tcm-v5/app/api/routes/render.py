"""Map layer rendering endpoints.

Every image carries its effective resolution and the resampling used, so a
client can never present a 56 km field as if it were analysis-resolution.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ...forecast import service
from ...render.raster import SCALES, render

router = APIRouter(tags=["render"])


def _png(image) -> Response:
    return Response(
        content=image.png, media_type="image/png",
        headers={**image.headers(), "Cache-Control": "public, max-age=600"},
    )


def _cached_png(parts: tuple, build) -> Response:
    """Render once per (run, layer, lead time).

    Rendering is the expensive step -- resampling 290,745 cells onto a
    1350x1150 image and PNG-encoding it. Without this every slider move
    recomputed every visible layer, which is what left the previous hour's
    image on screen under the new hour's label.
    """
    from ...forecast.cache import RENDER
    from ...pipeline.ingest import stored_runs

    runs = stored_runs("ukv")
    run = runs[-1] if runs else None
    return _cached_response(RENDER.get_or_compute(run, parts, build))


def _cached_response(image) -> Response:
    return _png(image)


@router.get("/scales")
def scales() -> dict:
    return {
        "scales": [
            {
                "name": s.name, "units": s.units,
                "description": s.description,
                "stops": [
                    {"value": stop.value, "rgba": list(stop.rgba)}
                    for stop in sorted(s.stops, key=lambda x: x.value)
                ],
            }
            for s in SCALES.values()
        ]
    }


@router.get("/layers")
def layers() -> dict:
    """The map layers TCM can draw, for building the toggle list."""
    return {
        "layers": [
            {"id": "risk", "label": "TCM risk", "scale": "risk",
             "path": "/api/render/risk/{forecast_hour}.png"},
            {"id": "tcm_lightning", "label": "TCM lightning (probability)",
             "scale": "probability",
             "path": "/api/render/lightning/{forecast_hour}/tcm.png"},
            {"id": "ukv_lightning", "label": "UKV lightning (deterministic)",
             "scale": "flash_density",
             "path": "/api/render/lightning/{forecast_hour}/ukv.png"},
            _observed_layer_entry(),
            *_hazard_layer_entries(),
            # Precipitation was reachable only through the animation, so it
            # could not be switched on as a map layer at all.
            {"id": "precipitation", "label": "Rainfall rate",
             "scale": "precip_rate",
             "path": "/api/render/field/{forecast_hour}/precip_rate_max_1h.png"
                     "?scale=precip_rate",
             "is_forecast": True,
             "note": "Peak rainfall rate in the preceding hour."},
            {"id": "rolling_24h", "label": "Rolling 24 h rainfall",
             "scale": "rainfall",
             "path": "/api/render/rolling24/{forecast_hour}.png",
             "is_forecast": True,
             "note": "Total rainfall over the 24 hours ENDING at this lead "
                     "time, recomputed at every hour."},
            {"id": "cape", "label": "Mixed-layer CAPE", "scale": "cape",
             "path": "/api/render/field/{forecast_hour}/cape_mixed_layer.png"},
        ],
        "note": (
            "Predicted and observed lightning are separate layers and are "
            "never combined."
        ),
    }


#: Map styles. "detailed" is the model's own 2 km field; "simple" generalises
#: it for a non-specialist reader. See app/render/simplify.py -- the simple
#: map is a strict SUBSET of the detailed one and can never show risk where
#: the detailed map does not.
MAP_STYLES = ("detailed", "simple")


def field_meta_for(forecast_hour: int):
    """Provenance for a derived raster, from whatever field the hour HAS.

    A derived product (the risk index, a hazard, a whole day) has no field of
    its own, so it borrows the geometry and provenance of an input. Asking
    specifically for CAPE breaks past the end of the UKV order: beyond T+54
    the risk is still computable from the ensemble's lightning, but the
    render 404'd on missing metadata, so every animation frame from T+57 to
    T+124 failed while the planner correctly listed them.

    Tries the ingredients most likely to be present, finest first, and
    returns None only when the hour genuinely has nothing.
    """
    for name in (
        "cape_mixed_layer", "cape_most_unstable", "cape_surface",
        "precip_rate_max_1h", "precip_accum_1h", "temperature_2m",
        "lightning_flash_density_1h",
    ):
        field = service.gather_ingredient(name, forecast_hour)
        if field is not None:
            return field.meta
    return None


def _styled(values, style: str):
    """Apply a map style to a risk field."""
    if style not in MAP_STYLES:
        raise HTTPException(
            400, f"style must be one of {', '.join(MAP_STYLES)}"
        )
    if style == "detailed":
        return values
    from ...render.simplify import simplify

    return simplify(values)


def _hazard_layer_entries() -> list[dict]:
    """Cached per run: see _hazard_layer_entries_uncached."""
    from ...forecast.cache import RISK
    from ...forecast.service import _latest_run

    return RISK.get_or_compute(
        _latest_run("ukv"), ("hazard_layers",),
        _hazard_layer_entries_uncached,
    )


def _hazard_layer_entries_uncached() -> list[dict]:
    """One layer per hazard, each reporting its own availability.

    A hazard that cannot be computed is listed and disabled WITH ITS REASON
    rather than hidden. Hiding it would leave the reader unable to tell
    "no supercell risk today" from "this platform cannot assess supercells",
    which are completely different statements.
    """
    from ...forecast.hazards import HAZARDS
    from ...forecast.service import available_hours, hazard

    # Availability is a property of the ORDERS, not of a lead time, so it is
    # probed once at whichever lead time actually has data.
    hours = available_hours()
    probe = hours[len(hours) // 2] if hours else None

    entries = []
    for name in HAZARDS:
        usable, reason, caveat = False, "no forecast data stored", ""
        if probe is not None:
            try:
                result = hazard(name, probe)
                usable, reason, caveat = (
                    result.available, result.reason, result.caveat
                )
            except Exception as exc:               # never break the layer list
                reason = str(exc)
        label = name.replace("_", " ").title().replace("Risk", "").strip()
        entries.append({
            "id": f"hazard_{name}",
            "label": f"{label} risk",
            "scale": "risk" if usable else None,
            "path": (
                f"/api/render/hazard/{name}/{{forecast_hour}}.png"
                if usable else None
            ),
            "is_forecast": True,
            "note": caveat,
            **({} if usable else {"unavailable": reason}),
        })
    return entries


@router.get("/coastline")
def coastline(simplify_degrees: float = 0.03) -> dict:
    """A coarse coastline, traced from the derived land mask.

    Not a cartographic dataset -- it is the platform's OWN idea of where land
    is, which is exactly what makes it useful for checking alignment: if a
    graphic lines up with this, it lines up with the fields.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    from ...forecast.landmask import land_mask
    from ...forecast.polygons import chaikin, ring_area, simplify_ring
    from ...grid import grid_lonlat, tcm_grid

    land = land_mask()
    if land is None:
        raise HTTPException(
            404,
            "no land mask has been built yet; it is derived from a full day "
            "of screen temperature and appears after the first ingest",
        )

    lon, lat = grid_lonlat(tcm_grid())
    figure = plt.figure()
    rings: list[list] = []
    try:
        axes = figure.add_subplot(111)
        contours = axes.contourf(
            lon, lat, land.astype("float64"), levels=[0.5, 1.5]
        )
        for path in contours.get_paths():
            for ring in path.to_polygons(closed_only=True):
                if len(ring) < 4:
                    continue
                shaped = chaikin(simplify_ring(ring, simplify_degrees), 1)
                if abs(ring_area(shaped)) < 0.002:
                    continue          # drop islands too small to draw
                coords = [
                    [round(float(x), 4), round(float(y), 4)] for x, y in shaped
                ]
                if coords[0] != coords[-1]:
                    coords.append(coords[0])
                rings.append(coords)
    finally:
        plt.close(figure)

    return {
        "type": "Feature",
        "geometry": {"type": "MultiLineString", "coordinates": rings},
        "properties": {
            "rings": len(rings),
            "source": "TCM land mask (derived from screen-temperature range)",
            "note": (
                "A reference outline for checking that a graphic lines up "
                "with the model fields. Not a survey coastline."
            ),
        },
    }


@router.get("/hazards/{forecast_hour}")
def hazards(forecast_hour: int) -> dict:
    """Every hazard at a lead time, available or not."""
    from ...forecast.service import hazards_at

    try:
        found = hazards_at(forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None
    return {
        "forecast_hour": forecast_hour,
        "hazards": {k: v.to_dict() for k, v in found.items()},
        "note": (
            "Each hazard has its own ingredients. One being unavailable says "
            "the platform cannot assess it, NOT that the risk is zero."
        ),
    }


@router.get("/render/hazard/{name}/{forecast_hour}.png")
def render_hazard(name: str, forecast_hour: int, style: str = "detailed"):
    from ...forecast.service import hazard
    from ...grid import Field

    try:
        result = hazard(name, forecast_hour)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    if not result.available or result.values is None:
        raise HTTPException(404, result.reason)

    meta = field_meta_for(forecast_hour)
    if meta is None:
        raise HTTPException(404, "no field metadata for this lead time")

    values = _styled(result.values, style)
    return _cached_png(
        ("hazard", name, forecast_hour, style),
        lambda: render(Field(values, meta), "risk"),
    )


def _observed_layer_entry() -> dict:
    """The observed layer, reported from the live provider.

    Availability is asked of the provider rather than hardcoded: the layer
    used to be a permanent "no detection network configured" even once
    Blitzortung was connected and archiving.

    Note there is no `{forecast_hour}` in the path. Observed lightning is not
    a forecast and is not indexed by lead time -- it is a rolling window of
    what has already happened, and giving it a lead time would be exactly the
    confusion between predicted and observed the spec forbids.
    """
    from ...verification.observations import get_provider

    provider = get_provider()
    available = bool(getattr(provider, "available", False))
    entry = {
        "id": "observed_lightning",
        "label": "Live observed lightning",
        "scale": "strike_count" if available else None,
        "path": "/api/render/observed/lightning.png" if available else None,
        "is_forecast": False,
        "note": (
            "Strikes that have already been detected. Never derived from a "
            "forecast, and never combined with one."
        ),
    }
    if not available:
        entry["unavailable"] = (
            getattr(provider, "status", lambda: {})().get("reason")
            or "no detection network configured"
        )
    return entry


@router.get("/render/observed/lightning.png")
def render_observed_lightning(minutes: int = 60):
    """Observed strikes over the last `minutes`, as a density image.

    404s when the window was never polled. An unobserved window is NOT a
    quiet one, and an empty image would be indistinguishable from a genuinely
    still sky -- so nothing is drawn rather than something misleading.
    """
    from fastapi.responses import Response

    from ...grid import Field, tcm_grid
    from ...meta import FieldMeta, MemberKind
    from ...verification.blitzortung import grid_strikes
    from ...verification.observations import get_provider

    if not 1 <= minutes <= 360:
        raise HTTPException(400, "minutes must be between 1 and 360")

    provider = get_provider()
    archive = getattr(provider, "archive", None)
    if archive is None:
        raise HTTPException(404, "no observation archive configured")

    window = archive.recent(minutes)
    if not window["observed"]:
        raise HTTPException(
            404,
            f"the last {minutes} minutes were never polled, so there is no "
            f"observation for them. An unobserved window is not a quiet one.",
        )

    counts = grid_strikes(window["strikes"])
    now = datetime.now(timezone.utc)
    meta = FieldMeta(
        provider="blitzortung", model="observed", parameter="strike_count",
        units="strikes/cell", level_type="surface", level=None,
        run=now, forecast_hour=0, valid_time=now,
        member_kind=MemberKind.DETERMINISTIC, member=None,
        native_resolution_m=2000.0, native_grid="tcm_2km",
        native_projection=tcm_grid().projection, grid=tcm_grid(),
        extra={
            "is_forecast": False,
            "window_minutes": minutes,
            "strikes": len(window["strikes"]),
            "coverage_fraction": round(window["coverage_fraction"], 3),
        },
    )
    image = render(Field(counts, meta), "strike_count")
    return Response(
        content=image.png, media_type="image/png",
        headers={
            **image.headers(),
            "X-TCM-Observed-Strikes": str(len(window["strikes"])),
            "X-TCM-Observed-Window": f"{minutes} minutes",
            "X-TCM-Observed-Coverage": f"{window['coverage_fraction']:.2f}",
            "X-TCM-Is-Forecast": "false",
            "Cache-Control": "no-store",
        },
    )


@router.get("/render/risk/{forecast_hour}.png")
def render_risk(forecast_hour: int, style: str = "detailed"):
    try:
        risk = service.convective_risk(forecast_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from None

    meta = field_meta_for(forecast_hour)
    if meta is None:
        raise HTTPException(404, "no field metadata for this lead time")
    from ...grid import Field

    values = _styled(risk.thunderstorm_risk_index, style)
    return _cached_png(
        ("risk", forecast_hour, style),
        lambda: render(Field(values, meta), "risk"),
    )


@router.get("/render/lightning/{forecast_hour}/{kind}.png")
def render_lightning(forecast_hour: int, kind: str):
    products = service.lightning_products(forecast_hour)
    key = {"tcm": "tcm_predicted", "ukv": "ukv_predicted"}.get(kind)
    if key is None:
        raise HTTPException(400, "kind must be 'tcm' or 'ukv'")
    layer = products.layers[key]
    if not layer.available:
        raise HTTPException(404, layer.unavailable_reason)

    # The layer's OWN metadata, so a UKV image is never tagged with MOGREPS
    # provenance and vice versa.
    if layer.meta is None:
        raise HTTPException(404, "lightning layer has no provenance")
    from ...grid import Field

    if key == "tcm_predicted":
        return _cached_png(
            ("lightning_tcm", forecast_hour),
            lambda: render(
                Field(layer.probability, layer.meta), "probability"
            ),
        )
    # Flash-density scaling is unconfirmed, so render relative magnitude.
    values = layer.density
    finite = values[np.isfinite(values)]
    top = float(finite.max()) if finite.size else 1.0
    return _cached_png(
        ("lightning_ukv", forecast_hour),
        lambda: render(
            Field(values, layer.meta), "flash_density",
            vmin=0.0, vmax=top if top > 0 else 1.0,
        ),
    )


#: Unit conversions the renderer is allowed to make, keyed by
#: (field units, scale units). Anything not listed is refused rather than
#: guessed.
#:
#: This exists because the precipitation animation drew a near-blank map for
#: months: `precip_rate_max_1h` is in kg m-2 s-1 (values around 0.01) and it
#: was being rendered on the rainfall scale, whose first stop is 1 mm. Every
#: cell fell below the bottom of the scale. Rendering a field on a scale in
#: different units is exactly the kind of silent mislabelling the resolution
#: contract forbids elsewhere, so it is now explicit and checked.
UNIT_FACTORS: dict[tuple[str, str], float] = {
    ("kg m**-2 s**-1", "mm/h"): 3600.0,
    ("kg m-2 s-1", "mm/h"): 3600.0,
    ("kg/m2/s", "mm/h"): 3600.0,
    ("kg m**-2", "mm"): 1.0,
    ("kg m-2", "mm"): 1.0,
    ("kg/m2", "mm"): 1.0,
}


def _to_scale_units(field, scale_name: str):
    """Convert a field into the scale's units, or leave it alone.

    Returns (field, note). Refuses only when the units are known to be
    incompatible; an undeclared or matching unit passes through untouched so
    that adding a scale never breaks an existing layer.
    """
    from ...grid import Field
    from ...render.raster import get_scale

    scale = get_scale(scale_name)
    units = (field.meta.units or "").strip()
    if not units or units == scale.units:
        return field, ""

    factor = UNIT_FACTORS.get((units, scale.units))
    if factor is None:
        return field, ""
    if factor == 1.0:
        return field, f"{units} read directly as {scale.units}"

    converted = Field(field.values * factor, field.meta)
    return converted, f"{units} x {factor:g} -> {scale.units}"


@router.get("/render/field/{forecast_hour}/{parameter}.png")
def render_field(
    forecast_hour: int, parameter: str,
    scale: str = Query("cape"),
):
    field = service.gather_ingredient(parameter, forecast_hour)
    if field is None:
        field = service._best_field(parameter, forecast_hour)
    if field is None:
        raise HTTPException(
            404, f"{parameter} is not stored for T+{forecast_hour}"
        )
    try:
        scaled, note = _to_scale_units(field, scale)
        response = _cached_png(
            ("field", parameter, scale, forecast_hour),
            lambda: render(scaled, scale),
        )
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from None
    if note:
        response.headers["X-TCM-Units-Converted"] = note
    return response
