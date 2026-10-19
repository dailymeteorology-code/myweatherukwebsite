"""Assemble the convective risk from what is in the field store.

Ingredients are drawn from whichever model actually supplies them, blended
where more than one does. That is the point of the platform: instability comes
from UKV at 2 km, the explicit lightning signal comes from the MOGREPS-UK
ensemble, and neither model is asked for something it does not have.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from ..blend import service as blend_service
from ..grid import Field
from ..pipeline.ingest import load_field, stored_members, stored_runs
from ..registry import MODELS
from .risk import ConvectiveRisk, assess

log = logging.getLogger(__name__)

#: How many forecast days the site publishes. MOGREPS-UK reaches T+96, which
#: can spill a fifth partial day into the timeline; a day built from a handful
#: of its hours is not comparable to a full one, so the horizon is fixed here.
FORECAST_DAYS = 4

#: Ingredient -> the models that may supply it, best first.
INGREDIENT_SOURCES: dict[str, tuple[str, ...]] = {
    # Instability and the cap come from UKV at 2 km.
    "cape_mixed_layer": ("ukv",),
    "cape_surface": ("ukv",),
    "cape_most_unstable": ("ukv",),
    # All three CIN parcels are now confirmed (see app/grib/decode.py) and
    # all three are used: inhibition is parcel-specific in a way instability
    # is not, and scoring only the surface parcel called elevated convection
    # impossible whenever the surface was capped.
    "cin": ("ukv", "icon_eu", "ukmo_global"),
    "cin_mixed_layer": ("ukv",),
    "cin_most_unstable": ("ukv",),
    # UKV lightning is deterministic 2 km; MOGREPS gives the ensemble median.
    "lightning_flash_density_1h": ("ukv", "mogreps_uk"),
    # Precipitation is in the MOGREPS order, not the UKV one.
    "precip_rate": ("ukv", "mogreps_uk"),
    "hail_fall_rate": ("ukv",),
    "precip_rate_max_1h": ("ukv", "mogreps_uk"),
    "precip_accum_1h": ("ukv", "mogreps_uk"),
    "hail_fall_rate_max_1h": ("ukv",),
    # UKV ships hail as a rate, MOGREPS-UK as an hourly accumulation.
    "hail_accum_1h": ("mogreps_uk", "ukv"),
    "freezing_level_height": ("ukv", "icon_eu"),
    # UKV first: it carries both at 2 km, and listing only MOGREPS meant
    # they read as MISSING whenever the MOGREPS order did not include them.
    "dewpoint_2m": ("ukv", "mogreps_uk", "icon_eu"),
    # Not a risk ingredient, but the damaging-wind hazard needs it: the
    # dewpoint DEPRESSION is what says how much evaporative cooling is
    # available to drive a downdraught.
    "temperature_2m": ("ukv", "mogreps_uk", "icon_eu"),
    "total_cloud_cover": ("ukv", "mogreps_uk", "icon_eu"),
    "wind_speed_10m": ("mogreps_uk", "ukv", "icon_eu"),
    # Derived on demand; no provider serves them.
    "shear_bulk_0_6km": (),
    "lapse_rate_850_500": (),
}


#: A new cycle must reach this fraction of the previous cycle's coverage
#: before it is used. Below it, the older complete cycle keeps being served.
RUN_READY_FRACTION = 0.8


#: How long a resolved "latest run" stands before it is recomputed.
#:
#: `_latest_run` walks the run directory TWICE (see `_run_coverage`), and it
#: is called once per ingredient per lead time -- 18 x 84 = 1512 times to
#: build one set of day summaries, each doing two full directory walks over
#: every parameter and every stored lead time. That was millions of stat
#: calls per warm, and it dominated the rebuild: the phase is compute-shaped
#: but was actually filesystem-bound.
#:
#: What it answers changes only when an ingest writes, and the scheduler
#: warms AFTER ingesting, so a short memo is safe. It is cleared explicitly
#: at the start of a warm so a rebuild never reads a pre-ingest answer.
_LATEST_RUN_TTL_SECONDS = 30.0
_latest_run_memo: dict[str, tuple[float, "datetime | None"]] = {}


def clear_run_cache() -> None:
    """Forget resolved runs. Call after an ingest writes new fields."""
    _latest_run_memo.clear()


def _latest_run(model_id: str) -> datetime | None:
    """The newest run that is COMPLETE ENOUGH to serve, memoised briefly."""
    import time

    now = time.monotonic()
    hit = _latest_run_memo.get(model_id)
    if hit is not None and (now - hit[0]) < _LATEST_RUN_TTL_SECONDS:
        return hit[1]
    value = _latest_run_uncached(model_id)
    _latest_run_memo[model_id] = (now, value)
    return value


def _latest_run_uncached(model_id: str) -> datetime | None:
    """The newest run that is COMPLETE ENOUGH to serve.

    Not simply the newest on disk. An ingest writes fields one at a time, so
    the moment the first field of a new cycle lands, "newest" points at a
    cycle with almost nothing in it -- and the whole site switches to it,
    replacing a complete forecast with three empty days until the download
    finishes. Seen live: a catch-up run flipped the site to a 00Z cycle at
    T+18 of 55 and every day past the first read "NONE".

    A new cycle is therefore only adopted once it covers at least
    RUN_READY_FRACTION of what the previous one covers. The comparison is on
    lead-time count, which is cheap and needs no knowledge of the parameters.
    """
    runs = stored_runs(model_id)
    if not runs:
        return None
    if len(runs) == 1:
        return runs[0]

    newest, previous = runs[-1], runs[-2]
    new_hours = _run_coverage(model_id, newest)
    old_hours = _run_coverage(model_id, previous)

    if old_hours and new_hours < old_hours * RUN_READY_FRACTION:
        log.debug(
            "%s: %s has %d lead times against %d in %s; still serving the "
            "older cycle", model_id, f"{newest:%Y-%m-%d %HZ}", new_hours,
            old_hours, f"{previous:%Y-%m-%d %HZ}",
        )
        return previous
    return newest


def _run_coverage(model_id: str, run: datetime) -> int:
    """How many distinct lead times a stored run holds."""
    from ..pipeline.ingest import stored_inventory

    inventory = stored_inventory(model_id, run)
    hours: set[int] = set()
    for lead_times in inventory.values():
        hours.update(lead_times)
    return len(hours)


def gather_ingredient(
    name: str, forecast_hour: int,
    runs: dict[str, datetime] | None = None,
) -> Field | None:
    """The best available field for one ingredient.

    For an ensemble source the median is used, so the risk index is built on
    the central solution while the member spread drives the probability
    separately. Ingredients no provider serves -- shear, lapse rate -- are
    computed on demand from whatever inputs are stored.
    """
    from ..derived.diagnostics import DERIVED

    for model_id in INGREDIENT_SOURCES.get(name, ()):
        model = MODELS.get(model_id)
        if model is None or name not in model.parameters:
            continue
        run = (runs or {}).get(model_id) or _latest_run(model_id)
        if run is None:
            continue
        field = _ensemble_collapse(model, run, name, forecast_hour)
        if field is not None:
            return field
        item = blend_service.load_model_input(model, run, name, forecast_hour)
        if item is not None:
            return item.field

    if name in DERIVED:
        return derive_ingredient(name, forecast_hour, runs)
    return None


def _ensemble_collapse(
    model, run: datetime, name: str, forecast_hour: int,
) -> Field | None:
    """Collapse an ensemble using the statistic THIS ingredient requires.

    Returns None when the default (median) applies, so the ordinary blend
    path handles it and this stays a narrow exception rather than a second
    implementation of ensemble loading.

    See `IngredientSpec.ensemble_statistic` for why an intermittent field
    cannot use a median.
    """
    import dataclasses

    import numpy as np

    from ..meta import MemberKind
    from .ingredients import BY_NAME

    spec = BY_NAME.get(name)
    if spec is None or spec.ensemble_statistic == "median":
        return None
    if not model.is_ensemble:
        return None

    members = blend_service.members_on_disk(model, run, name, forecast_hour)
    if not members:
        return None
    if spec.ensemble_statistic != "mean":
        raise ValueError(
            f"{name} asks for ensemble statistic "
            f"{spec.ensemble_statistic!r}, which is not implemented"
        )

    stack = np.stack([m.values for m in members])
    values = np.nanmean(stack, axis=0)
    meta = dataclasses.replace(
        members[0].meta,
        member=None,
        member_kind=MemberKind.ENSEMBLE_STAT,
        extra={
            **members[0].meta.extra,
            "ensemble_statistic": "mean",
            "ensemble_members": len(members),
            "statistic_reason": (
                "mean, not median: a per-cell median of an intermittent "
                "field returns zero unless members agree on location"
            ),
        },
    )
    return Field(values.astype("float32"), meta)


def derive_ingredient(
    name: str, forecast_hour: int,
    runs: dict[str, datetime] | None = None,
) -> Field | None:
    """Compute a derived diagnostic, or return None if inputs are missing.

    Returns None rather than raising: a missing shear field is a declared
    gap in the risk assessment, not an error. The risk engine reports it in
    `missing_ingredients` and says what the absence costs.
    """
    from ..derived.diagnostics import derive, requirements

    inputs: dict[str, Field] = {}
    for parameter in requirements(name):
        field = _best_field(parameter, forecast_hour, runs)
        if field is None:
            log.debug(
                "cannot derive %s at T+%d: %s unavailable",
                name, forecast_hour, parameter,
            )
            return None
        inputs[parameter] = field

    try:
        return derive(name, inputs)
    except (LookupError, ValueError) as exc:
        log.info("could not derive %s at T+%d: %s", name, forecast_hour, exc)
        return None


def _best_field(
    parameter: str, forecast_hour: int,
    runs: dict[str, datetime] | None = None,
) -> Field | None:
    """The finest-resolution stored field for a parameter, from any model."""
    candidates: list[Field] = []
    for model in MODELS.values():
        if parameter not in model.parameters:
            continue
        run = (runs or {}).get(model.id) or _latest_run(model.id)
        if run is None:
            continue
        item = blend_service.load_model_input(
            model, run, parameter, forecast_hour
        )
        if item is not None:
            candidates.append(item.field)
    if not candidates:
        return None
    return min(candidates, key=lambda f: f.meta.effective_resolution_m)


def gather_members(
    name: str, forecast_hour: int, model_id: str = "mogreps_uk",
    runs: dict[str, datetime] | None = None,
) -> list[Field]:
    """Every stored ensemble member of one parameter."""
    model = MODELS.get(model_id)
    if model is None or not model.is_ensemble:
        return []
    run = (runs or {}).get(model_id) or _latest_run(model_id)
    if run is None:
        return []
    return blend_service.members_on_disk(model, run, name, forecast_hour)


def convective_risk(
    forecast_hour: int, runs: dict[str, datetime] | None = None,
) -> ConvectiveRisk:
    """The TCM convective risk for one lead time, cached per run."""
    from .cache import RISK

    run = (runs or {}).get("ukv") or _latest_run("ukv")
    return RISK.get_or_compute(
        run, ("risk", forecast_hour),
        lambda: _convective_risk_uncached(forecast_hour, runs),
    )


def _convective_risk_uncached(
    forecast_hour: int, runs: dict[str, datetime] | None = None,
) -> ConvectiveRisk:
    fields: dict[str, Field | None] = {
        name: gather_ingredient(name, forecast_hour, runs)
        for name in INGREDIENT_SOURCES
    }
    if not any(f is not None for f in fields.values()):
        raise LookupError(
            f"no ingredients stored for T+{forecast_hour}; ingest a cycle first"
        )

    members = gather_members(
        "lightning_flash_density_1h", forecast_hour, runs=runs
    )

    reference = next(f for f in fields.values() if f is not None)
    valid_time = reference.meta.run + timedelta(hours=forecast_hour)

    return assess(
        fields=fields,
        forecast_hour=forecast_hour,
        valid_time=valid_time,
        lightning_members=members or None,
    )


def available_hours(model_id: str | None = None) -> list[int]:
    """Lead times with any stored ingredient, for the risk timeline.

    With no model named this is the UNION across every provisioned model, not
    just UKV. UKV is the finest input but the shortest: its order runs to
    T+54, while MOGREPS-UK reaches T+96. Timing the whole site off UKV
    silently truncated the forecast to three days even though a fourth day of
    ensemble data was on disk.

    Past the end of the UKV order the ingredient set genuinely narrows -- no
    CAPE, no CIN -- so those hours are scored on the ensemble's explicit
    lightning field plus precipitation and the surface modifiers. That is a
    weaker forecast, and `completeness` reports it rather than hiding it.
    """
    from ..pipeline.ingest import stored_inventory

    model_ids = (
        [model_id] if model_id
        else [m.id for m in MODELS.values() if m.is_provisioned]
    )
    hours: set[int] = set()
    for mid in model_ids:
        run = _latest_run(mid)
        if run is None:
            continue
        for parameter, lead_times in stored_inventory(mid, run).items():
            if parameter in INGREDIENT_SOURCES:
                hours.update(lead_times)
    return sorted(hours)


# --- lightning products ---------------------------------------------------

def lightning_products(
    forecast_hour: int, runs: dict[str, datetime] | None = None,
):
    """The three lightning layers for one lead time, cached per run."""
    from .cache import LIGHTNING

    run = (runs or {}).get("ukv") or _latest_run("ukv")
    return LIGHTNING.get_or_compute(
        run, ("lightning", forecast_hour),
        lambda: _lightning_products_uncached(forecast_hour, runs),
    )


def _lightning_products_uncached(
    forecast_hour: int, runs: dict[str, datetime] | None = None,
):
    """Assembled separately and never merged: UKV deterministic, the TCM
    ensemble probability, and observed strikes.
    """
    from .lightning import (
        LightningKind,
        LightningProducts,
        observed_layer,
        tcm_layer,
        ukv_layer,
    )

    ukv_field = None
    model = MODELS.get("ukv")
    if model is not None and "lightning_flash_density_1h" in model.parameters:
        run = (runs or {}).get("ukv") or _latest_run("ukv")
        if run is not None:
            item = blend_service.load_model_input(
                model, run, "lightning_flash_density_1h", forecast_hour
            )
            ukv_field = item.field if item else None

    members = gather_members(
        "lightning_flash_density_1h", forecast_hour, runs=runs
    )

    return LightningProducts(
        forecast_hour=forecast_hour,
        layers={
            LightningKind.UKV_PREDICTED.value: ukv_layer(ukv_field),
            LightningKind.TCM_PREDICTED.value: tcm_layer(members),
            LightningKind.OBSERVED.value: observed_layer(),
        },
    )


def generate_outlook(
    hours: list[int] | None = None,
    runs: dict[str, datetime] | None = None,
):
    """The automatic outlook for the current cycle, cached per run.

    Uncached this cost 22 seconds on every page load, because it walks every
    lead time and re-derives regions and hazards for each. It is a pure
    function of the run and the lead times asked for, so both are in the key.
    """
    from .cache import RISK

    run = (runs or {}).get("ukv") or _latest_run("ukv")
    key = ("outlook", tuple(hours) if hours else None)
    return RISK.get_or_compute(
        run, key, lambda: _generate_outlook_uncached(hours, runs)
    )


def _generate_outlook_uncached(
    hours: list[int] | None = None,
    runs: dict[str, datetime] | None = None,
):
    from .outlook import generate

    wanted = hours or available_hours()
    if not wanted:
        raise LookupError("no stored diagnostics; ingest a cycle first")

    risks = []
    for fh in wanted:
        try:
            risks.append(convective_risk(fh, runs))
        except (LookupError, ValueError):
            continue
    if not risks:
        raise LookupError("no lead time had enough ingredients for a risk")

    # Use the outlook's own peak rule, so the lightning fetched is for the
    # hour the text actually describes.
    from .outlook import select_peak

    peak, _ = select_peak(risks)
    return generate(risks, lightning_products(peak.forecast_hour, runs))


def daily_risk(runs: dict[str, datetime] | None = None) -> list[dict]:
    """Risk summarised per forecast day, cached per run.

    The per-hour risks are cached individually, but ASSEMBLING them was not:
    ranking ~80 lead times, computing severity and resolving region coverage
    for every day cost 20 seconds on each page load even with every
    underlying risk already warm. It is a pure function of the run, so it is
    cached like everything else derived from one.
    """
    from .cache import RISK

    run = (runs or {}).get("ukv") or _latest_run("ukv")
    return RISK.get_or_compute(
        run, ("daily_risk",), lambda: _daily_risk_uncached(runs)
    )


def _daily_risk_uncached(runs: dict[str, datetime] | None = None) -> list[dict]:
    """Risk summarised per forecast day, with the hours behind each day.

    A day is summarised by its most SEVERE hour, not its highest index. The
    index saturates, so on an unstable spell every day and every hour reports
    the same maximum and the ranking carries no information; severity
    (magnitude x coverage) keeps discriminating. See ConvectiveRisk.severity.
    """
    from .outlook import AREA_THRESHOLD
    from .regions import regions_above

    hours = available_hours()
    if not hours:
        return []

    # Stop once a FIFTH day appears.
    #
    # Only the first FORECAST_DAYS days survive the slice below, but every
    # available hour used to be scored first and the surplus thrown away.
    # The union of lead times now reaches T+168 (UKMO Global), so that was
    # 169 hours computed to publish four days -- and the discarded ones were
    # the LONG leads, which are the slowest, because gathering an ingredient
    # walks every model in INGREDIENT_SOURCES before giving up.
    #
    # `hours` is ascending, so valid_time is ascending, so once an hour
    # belongs to a fifth distinct date nothing after it can contribute to the
    # first four either. Breaking there is not an approximation: the output
    # is identical, it is simply reached without the wasted work.
    by_day: dict[str, list] = {}
    for fh in hours:
        try:
            risk = convective_risk(fh, runs)
        except (LookupError, ValueError):
            continue
        day = risk.valid_time.strftime("%Y-%m-%d")
        if day not in by_day and len(by_day) >= FORECAST_DAYS:
            break
        by_day.setdefault(day, []).append(risk)

    days = []
    for day in sorted(by_day)[:FORECAST_DAYS]:
        entries = sorted(by_day[day], key=lambda r: r.forecast_hour)
        peak = max(entries, key=lambda r: r.severity)
        active = [r for r in entries if r.area_fraction > 0]
        days.append({
            "date": day,
            "label": peak.valid_time.strftime("%a %d %b"),
            "peak_forecast_hour": peak.forecast_hour,
            "peak_valid_time": peak.valid_time.isoformat(),
            "level": peak.level.value,
            "peak_index": round(peak.peak_index, 1),
            "severity": round(peak.severity, 2),
            "area_percent": round(peak.area_fraction * 100, 1),
            "regime": peak.regime.regime.value,
            "areas": regions_above(
                peak.thunderstorm_risk_index, AREA_THRESHOLD
            )[:3],
            "completeness": round(peak.completeness, 2),
            "ingredients_used": sorted(
                i.name for i in peak.ingredients if i.available
            ),
            "ingredients_missing": sorted(peak.missing_ingredients),
            "active_from": (
                active[0].valid_time.isoformat() if active else None
            ),
            "active_to": (
                active[-1].valid_time.isoformat() if active else None
            ),
            "hours": [
                {
                    "forecast_hour": r.forecast_hour,
                    "valid_time": r.valid_time.isoformat(),
                    "hour_label": r.valid_time.strftime("%H%MZ"),
                    "level": r.level.value,
                    "peak_index": round(r.peak_index, 1),
                    "severity": round(r.severity, 2),
                    "area_percent": round(r.area_fraction * 100, 1),
                }
                for r in entries
            ],
        })
    return days


#: Fields every hazard might want, beyond the risk ingredients.
HAZARD_FIELDS = (
    "hail_fall_rate", "hail_fall_rate_max_1h", "hail_accum_1h",
    "cape_most_unstable", "cape_mixed_layer", "freezing_level_height",
    "precip_rate", "precip_rate_max_1h",
    "temperature_2m", "dewpoint_2m", "wind_speed_10m",
    "shear_bulk_0_6km",
)


def hazard(name: str, forecast_hour: int, runs=None):
    """One hazard's field for a lead time, or the reason there isn't one."""
    from .hazards import assess

    fields = {
        item: gather_ingredient(item, forecast_hour, runs)
        for item in HAZARD_FIELDS
    }
    return assess(name, fields)


def hazards_at(forecast_hour: int, runs=None) -> dict:
    """Every hazard at a lead time, available or not."""
    from .hazards import HAZARDS

    return {
        name: hazard(name, forecast_hour, runs) for name in HAZARDS
    }


def outlook_polygons(day: str | None = None, forecast_hour: int | None = None,
                     runs=None) -> dict:
    """SPC-style categorical polygons for a day or a single lead time."""
    from .cache import RISK
    from .polygons import build

    if day is None and forecast_hour is None:
        raise ValueError("outlook_polygons needs either a day or a lead time")

    run = (runs or {}).get("ukv") or _latest_run("ukv")

    def make() -> dict:
        if day is not None:
            built = day_risk_field(day, runs)
            summary = next(
                (d for d in daily_risk(runs) if d["date"] == day), None
            )
            return build(
                built["values"],
                label=(summary or {}).get("label", day),
                valid_time=f"{day} 00:00-23:59Z",
            )
        risk = convective_risk(forecast_hour, runs)
        return build(
            risk.thunderstorm_risk_index,
            label=risk.valid_time.strftime("%a %d %b %H%MZ"),
            valid_time=risk.valid_time.isoformat(),
        )

    return RISK.get_or_compute(run, ("polygons", day, forecast_hour), make)


def peak_point(forecast_hour: int | None = None, day: str | None = None,
               runs=None) -> dict:
    """Where the highest risk sits, as a point the map can mark.

    Restricted to the forecast area (UK and Ireland land), for the same
    reason the headline is: the domain maximum is routinely a cell in the
    middle of the North Sea, and a star dropped there tells the reader
    nothing about the forecast they came for.
    """
    import numpy as np

    from ..grid import grid_lonlat, tcm_grid
    from .regions import forecast_area, region_masks

    if day is not None:
        built = day_risk_field(day, runs)
        values, label = built["values"], day
        hour = built["hours"][0]
    elif forecast_hour is not None:
        risk = convective_risk(forecast_hour, runs)
        values = risk.thunderstorm_risk_index
        label = risk.valid_time.isoformat()
        hour = forecast_hour
    else:
        raise ValueError("peak_point needs either a forecast hour or a day")

    area = forecast_area()
    scoped = values if area is None or area.shape != values.shape else np.where(
        area, values, -np.inf
    )
    finite = scoped[np.isfinite(scoped)]
    if finite.size == 0 or not np.isfinite(np.nanmax(scoped)):
        return {"available": False, "reason": "no risk field for this step"}

    index = np.unravel_index(np.nanargmax(scoped), scoped.shape)
    lon, lat = grid_lonlat(tcm_grid())
    value = float(scoped[index])

    named = None
    for name, mask in region_masks().items():
        if mask.shape == scoped.shape and mask[index]:
            named = name
            break

    from .risk import RiskLevel

    return {
        "available": True,
        "lat": round(float(lat[index]), 4),
        "lon": round(float(lon[index]), 4),
        "index": round(value, 1),
        "level": RiskLevel.from_index(value).value,
        "region": named,
        "forecast_hour": hour,
        "valid_time": label,
        "scope": (
            "UK and Ireland land" if area is not None else "whole domain"
        ),
        "note": (
            "The single highest-scoring cell. It is a ranking maximum, not a "
            "prediction that a storm will form on this exact point."
        ),
    }


def _layers_available(forecast_hour: int, runs=None) -> set[str]:
    """Which animation layers can actually be drawn at a lead time."""
    have: set[str] = set()
    try:
        convective_risk(forecast_hour, runs)
        have.add("risk")
    except (LookupError, ValueError):
        return have

    products = lightning_products(forecast_hour, runs)
    if products.layers["tcm_predicted"].available:
        have.add("tcm_lightning")
    if products.layers["ukv_predicted"].available:
        have.add("ukv_lightning")

    if gather_ingredient("precip_rate_max_1h", forecast_hour, runs) is not None:
        have.add("precipitation")

    # The rolling window was never listed here, so every frame of the rolling
    # 24 h animation was reported as "layers unavailable" and the mode
    # produced zero frames while the endpoint that draws it worked fine.
    #
    # A window is drawable when ANY hour in it is stored -- `accumulate`
    # already reports how complete the window is and refuses to present a
    # partial sum as a full 24 hours, so availability does not need to demand
    # all 24.
    if any(
        gather_ingredient("precip_accum_1h", hour, runs) is not None
        for hour in range(max(forecast_hour - 23, 0), forecast_hour + 1)
    ):
        have.add("rolling_24h")
    return have


def build_animation(
    mode: str = "risk",
    day: str | None = None,
    frame_ms: int | None = None,
    runs=None,
):
    """Plan an animation over the stored forecast."""
    from .animation import DEFAULT_FRAME_MS, AnimationMode, plan

    try:
        selected = AnimationMode(mode)
    except ValueError:
        raise ValueError(
            f"unknown animation mode {mode!r}; "
            f"choose from {[m.value for m in AnimationMode]}"
        ) from None

    hours = available_hours()
    if not hours:
        raise LookupError("no stored diagnostics; ingest a cycle first")

    risks: dict[int, object] = {}
    layers: dict[int, set[str]] = {}
    for fh in hours:
        try:
            risk = convective_risk(fh, runs)
        except (LookupError, ValueError):
            continue
        if day and risk.valid_time.strftime("%Y-%m-%d") != day:
            continue
        risks[fh] = risk
        layers[fh] = _layers_available(fh, runs)

    return plan(
        selected, sorted(risks), risks, layers, day=day,
        frame_ms=frame_ms or DEFAULT_FRAME_MS,
    )


def studio_export(
    step_deg: float | None = None, runs=None, include_steps: bool = False,
):
    """A TCM run in the Thunderstorm Graphic Studio's payload shape."""
    from ..export.studio import EXPORT_STEP_DEG, build

    hours = available_hours()
    if not hours:
        raise LookupError("no stored diagnostics; ingest a cycle first")

    risks, lightning = {}, {}
    for fh in hours:
        try:
            risks[fh] = convective_risk(fh, runs)
        except (LookupError, ValueError):
            continue
        try:
            lightning[fh] = lightning_products(fh, runs)
        except (LookupError, ValueError):
            pass

    return build(
        risks, lightning, step_deg or EXPORT_STEP_DEG,
        include_steps=include_steps,
    )


def hourly_rainfall(
    forecast_hour: int, window_hours: int = 24, runs=None,
) -> dict:
    """Stored hourly rainfall fields covering an accumulation window."""
    fields = {}
    for hour in range(max(forecast_hour - window_hours + 1, 0),
                      forecast_hour + 1):
        field = gather_ingredient("precip_accum_1h", hour, runs)
        if field is not None:
            fields[hour] = field
    return fields


def rainfall_accumulation(
    forecast_hour: int, window_hours: int = 24, runs=None,
):
    """Rainfall accumulated over a window ending at `forecast_hour`."""
    from .precipitation import accumulate

    fields = hourly_rainfall(forecast_hour, window_hours, runs)
    if not fields:
        raise LookupError(
            f"no hourly rainfall stored for the {window_hours}h window "
            f"ending at T+{forecast_hour}"
        )
    return accumulate(fields, forecast_hour, window_hours)


def rolling_rainfall_series(window_hours: int = 24, runs=None):
    """The rolling accumulation at every lead time that supports it."""
    from .precipitation import rolling_series

    hours = sorted({
        h for h in range(0, 129)
        if gather_ingredient("precip_accum_1h", h, runs) is not None
    })
    if not hours:
        return []
    fields = {h: gather_ingredient("precip_accum_1h", h, runs) for h in hours}
    return rolling_series(fields, window_hours)


def scenario_clusters(
    parameter: str, forecast_hour: int, model_id: str = "mogreps_uk", runs=None,
):
    """Coherent scenario clusters from an ensemble's whole members."""
    from ..derived.clusters import cluster

    members = gather_members(parameter, forecast_hour, model_id, runs)
    if not members:
        raise LookupError(
            f"no stored {model_id} members for {parameter} at "
            f"T+{forecast_hour}"
        )
    return cluster(members)

def day_risk_field(day: str, runs=None):
    """Whole-day thunderstorm risk: the maximum over 00:00-23:59 UTC.

    A day card should answer "is there a thunderstorm risk today", which is
    not the risk at any one hour. The day field is the per-cell MAXIMUM
    across every hour of that calendar day, so a cell counts as at risk if it
    is at risk at any point in the day -- the same way a human forecaster
    draws a day-1 outlook.

    Maximum, not mean: averaging would dilute a sharp three-hour convective
    window across a quiet 24 hours and erase exactly the event the outlook
    exists to show.
    """
    import numpy as np

    from .cache import RISK

    run = (runs or {}).get("ukv") or _latest_run("ukv")

    def build():
        # Stop once a fifth day appears, exactly as `daily_risk` does.
        #
        # This scanned every available lead time and kept the ones landing on
        # `day`. With the union now reaching T+168 that is 169 risk
        # computations per day, and `warm_products` draws four days -- 676
        # computations to produce four images, of which ~84 were useful.
        #
        # Valid time cannot be derived from the lead time alone (it comes
        # from the contributing field's own run, which differs per model), so
        # the risk still has to be built to know its day. But `convective_risk`
        # is cached per run, and `daily_risk` has already built exactly these
        # hours, so the bounded loop reads the cache rather than recomputing.
        #
        # A day beyond the published window is not in the bounded set, so it
        # falls back to the full scan rather than silently reporting no data.
        def scan(bounded: bool):
            found, seen = [], set()
            for fh in available_hours():
                try:
                    risk = convective_risk(fh, runs)
                except (LookupError, ValueError):
                    continue
                stamp = risk.valid_time.strftime("%Y-%m-%d")
                if bounded and stamp not in seen and len(seen) >= FORECAST_DAYS:
                    break
                seen.add(stamp)
                if stamp == day:
                    found.append(risk)
            return found

        hours = scan(bounded=True) or scan(bounded=False)
        if not hours:
            raise LookupError(f"no diagnostics stored for {day}")

        stack = np.stack([r.thunderstorm_risk_index for r in hours])
        with np.errstate(invalid="ignore"):
            field = np.nanmax(stack, axis=0).astype("float32")
        return {
            "day": day,
            "values": field,
            "hours": [r.forecast_hour for r in hours],
            "valid_from": min(r.valid_time for r in hours),
            "valid_to": max(r.valid_time for r in hours),
            "meta": hours[0],
        }

    return RISK.get_or_compute(run, ("day_risk", day), build)
