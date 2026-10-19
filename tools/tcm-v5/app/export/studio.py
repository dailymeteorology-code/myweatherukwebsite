"""Export a TCM V5 run in the shape the Thunderstorm Graphic Studio loads.

The studio and the live outlook map already consume a specific payload, built
by `lib/tcmForecastCache.js` and contoured by `lib/tcmOutlookLayers.js` in the
existing platform. Rather than change the studio, TCM V5 emits that shape, so
the tool can draw a V3 run with no modification:

    {
      grid: [ { lat, lon, perDay: [ { scores: {...} } ], perStep: [...] } ],
      run, builtAt, gridStep, bbox, maxDay, daysAvailable, summary, source
    }

Three details of that contract are load-bearing and easy to get wrong:

  * **Scores are integers on the canonical 0-100 scale** with the bands in
    `riskConfig.jsx`. TCM V5 uses that same scale (see `RISK_BANDS`), so no
    rebanding happens on export -- which is the point, because a second scale
    is exactly what made the archive contradict the live forecast before.

  * **The studio is a 3-hourly, 4-day product**: `HOURS_PER_STEP = 3`,
    `STEPS_PER_DAY = 8`, `TOTAL_STEPS = 32`. TCM's own 4-day horizon lines up,
    but lead times that are not on a 3-hourly boundary have no slot and are
    dropped rather than nudged into a neighbouring step.

  * **The grid is lat/lon**, at a step the studio can detect (its
    `KNOWN_GRID_STEPS` are 0.25 to 3.0 degrees). The analysis grid is 2 km
    LAEA, so exporting means sampling. That is a real loss of resolution and
    is recorded in the payload rather than glossed over.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

from ..registry import UK_IRELAND

log = logging.getLogger(__name__)

#: Studio timeline layout, from riskConfig.jsx.
HOURS_PER_STEP = 3
STEPS_PER_DAY = 8
TOTAL_STEPS = 32

#: Export mesh in degrees. Must be one of the studio's KNOWN_GRID_STEPS so its
#: `detectGridStep` recognises it.
EXPORT_STEP_DEG = 0.25

#: Hazard keys the studio's score accessors read.
HAZARDS = ("thunderstorm", "hail", "tornado", "lightning")
SUB_HAZARDS = ("hail", "tornado", "supercell", "strongWinds", "flashFlood")


def export_grid_points(step_deg: float = EXPORT_STEP_DEG):
    """Lon/lat of every export node, and its (row, col) on that mesh."""
    lons = np.arange(
        UK_IRELAND.lon_min, UK_IRELAND.lon_max + step_deg / 2, step_deg
    )
    lats = np.arange(
        UK_IRELAND.lat_min, UK_IRELAND.lat_max + step_deg / 2, step_deg
    )
    return lons, lats


def _sample(values: np.ndarray, lons: np.ndarray, lats: np.ndarray):
    """Sample a TCM-grid field at lon/lat nodes, nearest cell.

    Everything the risk engine produces lives on the TCM analysis grid by
    construction -- every ingredient is regridded onto it during ingest -- so
    the grid is taken from `tcm_grid()` rather than from any one field.
    """
    from pyproj import Transformer

    from ..grid import tcm_grid

    grid = tcm_grid()
    lon2, lat2 = np.meshgrid(lons, lats)
    tf = Transformer.from_crs("EPSG:4326", grid.projection, always_xy=True)
    x, y = tf.transform(lon2, lat2)
    col = np.round((x - grid.x0) / grid.spacing_m - 0.5).astype(int)
    row = np.round((y - grid.y0) / grid.spacing_m - 0.5).astype(int)

    inside = (
        (row >= 0) & (row < grid.ny) & (col >= 0) & (col < grid.nx)
    )
    out = np.full(lon2.shape, np.nan, dtype="float32")
    out[inside] = values[row[inside], col[inside]]
    return out


def _score(value) -> int:
    """Round to the integer 0-100 the studio expects."""
    if value is None or not np.isfinite(value):
        return 0
    return int(max(0, min(100, round(float(value)))))


@dataclass(slots=True)
class StudioExport:
    payload: dict
    dropped_hours: list[int]
    step_deg: float

    def to_dict(self) -> dict:
        return self.payload


def build(
    risks_by_hour: dict,
    lightning_by_hour: dict | None = None,
    step_deg: float = EXPORT_STEP_DEG,
    source: str = "tcm-v3",
    include_steps: bool = False,
) -> StudioExport:
    """Assemble the studio payload from TCM diagnostics.

    `risks_by_hour` maps lead time to a `ConvectiveRisk`. Only lead times on a
    3-hourly boundary can occupy a studio step; the rest are reported in
    `dropped_hours` rather than being snapped to a neighbouring slot, which
    would place one hour's risk under another hour's label.
    """
    if not risks_by_hour:
        raise ValueError("no risk diagnostics to export")

    lightning_by_hour = lightning_by_hour or {}
    lons, lats = export_grid_points(step_deg)

    usable = sorted(h for h in risks_by_hour if h % HOURS_PER_STEP == 0)
    dropped = sorted(h for h in risks_by_hour if h % HOURS_PER_STEP)
    if dropped:
        log.info(
            "studio export: %d lead times are not on a %dh boundary and have "
            "no step: %s", len(dropped), HOURS_PER_STEP, dropped,
        )
    if not usable:
        raise ValueError(
            f"no lead time falls on a {HOURS_PER_STEP}-hourly studio step"
        )

    reference = risks_by_hour[usable[0]]
    run = reference.valid_time - __import__("datetime").timedelta(
        hours=reference.forecast_hour
    )

    # step index -> sampled arrays
    per_step: dict[int, dict[str, np.ndarray]] = {}
    for hour in usable:
        step = hour // HOURS_PER_STEP
        if step >= TOTAL_STEPS:
            continue
        risk = risks_by_hour[hour]
        sampled: dict[str, np.ndarray] = {
            "thunderstorm": _sample(risk.thunderstorm_risk_index, lons, lats),
        }
        if risk.hail_index is not None:
            sampled["hail"] = _sample(risk.hail_index, lons, lats)

        products = lightning_by_hour.get(hour)
        layer = products.layers.get("tcm_predicted") if products else None
        if layer is not None and layer.available and layer.probability is not None:
            sampled["lightning"] = _sample(layer.probability * 100.0, lons, lats)
        per_step[step] = sampled

    if not per_step:
        raise ValueError("no lead time could be sampled onto the export grid")

    max_step = max(per_step)
    days_available = min(max_step // STEPS_PER_DAY + 1, 4)

    grid = []
    for j, lat in enumerate(lats):
        for i, lon in enumerate(lons):
            steps = []
            for step in range(TOTAL_STEPS):
                sampled = per_step.get(step)
                if sampled is None:
                    steps.append(None)
                    continue
                steps.append({
                    "scores": _scores_at(sampled, j, i),
                })
            per_day = _collapse_to_days(steps)
            if not any(
                d["scores"]["thunderstorm"] or d["scores"]["lightning"]
                for d in per_day
            ):
                # Nodes with no risk on any day carry no information for the
                # studio and bloat the payload; the contour builder treats a
                # missing node and a zero node identically.
                continue
            node = {
                "lat": round(float(lat), 3),
                "lon": round(float(lon), 3),
                "perDay": per_day,
            }
            if include_steps:
                # The animated-step layers read perStep, but it is ~14 deep
                # score objects per node and dominates the payload. The
                # studio's own `slimGridForDB` strips it before persisting
                # for exactly this reason, and its step accessor already
                # falls back to perDay when it is absent.
                node["perStep"] = [s for s in steps if s is not None]
            grid.append(node)

    payload = {
        "grid": grid,
        "cellCount": len(grid),
        "run": run.astimezone(timezone.utc).isoformat(),
        "builtAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "gridStep": step_deg,
        "fineGridStep": step_deg,
        "maxDay": days_available - 1,
        "daysAvailable": days_available,
        "runStartMs": int(run.timestamp() * 1000),
        "bbox": {
            "latMin": UK_IRELAND.lat_min, "latMax": UK_IRELAND.lat_max,
            "lonMin": UK_IRELAND.lon_min, "lonMax": UK_IRELAND.lon_max,
        },
        "source": source,
        "includesPerStep": include_steps,
        "models": sorted({
            i.source_model for r in risks_by_hour.values()
            for i in r.ingredients if i.available and i.source_model
        }),
        "summary": {
            "steps_populated": sorted(per_step),
            "hours_exported": usable,
            "hours_dropped": dropped,
            "analysis_resolution_m": 2000.0,
            "export_resolution_deg": step_deg,
            "resolution_note": (
                "Scores are sampled from the 2 km TCM analysis grid onto a "
                f"{step_deg} degree lon/lat mesh (~{step_deg * 111:.0f} km) "
                "because that is what the studio's contour builder reads. "
                "The exported product is therefore coarser than the analysis."
            ),
            "scale": "canonical TCM 0-100 (riskConfig.jsx bands)",
            "index_is_calibrated": False,
        },
    }
    return StudioExport(payload=payload, dropped_hours=dropped, step_deg=step_deg)


def _scores_at(sampled: dict[str, np.ndarray], j: int, i: int) -> dict:
    thunder = _score(sampled.get("thunderstorm", np.array([[0]]))[j, i]
                     if "thunderstorm" in sampled else 0)
    hail = _score(sampled["hail"][j, i]) if "hail" in sampled else 0
    lightning = (
        _score(sampled["lightning"][j, i]) if "lightning" in sampled else 0
    )
    return {
        "thunderstorm": thunder,
        "hail": hail,
        # TCM does not produce a tornado score; exporting a fabricated one
        # would put a hazard on the graphic that no model supports.
        "tornado": 0,
        "lightning": lightning,
        "sub": {
            "hail": hail, "tornado": 0, "supercell": 0,
            "strongWinds": 0, "flashFlood": 0,
        },
    }


def _collapse_to_days(steps: list[dict | None]) -> list[dict]:
    """Day score = the maximum across that day's steps, per hazard."""
    days = []
    for day in range(4):
        window = steps[day * STEPS_PER_DAY:(day + 1) * STEPS_PER_DAY]
        present = [s for s in window if s]
        if not present:
            days.append({"scores": _empty_scores()})
            continue
        scores = {
            hazard: max(s["scores"].get(hazard, 0) for s in present)
            for hazard in HAZARDS
        }
        scores["sub"] = {
            key: max(s["scores"]["sub"].get(key, 0) for s in present)
            for key in SUB_HAZARDS
        }
        days.append({"scores": scores})
    return days


def _empty_scores() -> dict:
    return {
        "thunderstorm": 0, "hail": 0, "tornado": 0, "lightning": 0,
        "sub": {k: 0 for k in SUB_HAZARDS},
    }
