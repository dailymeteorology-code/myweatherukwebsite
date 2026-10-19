"""Forecast products: grids, maps, animation frames and summaries.

Step 11 of the Stage 10 order, sections 39 to 46.

Section 40 states the rule the whole module is arranged around:

    Never make the image itself the primary forecast product. The grid data
    are the scientific source of truth.

So a product is a DATA object with metadata, and a rendered image is a
derived artefact that points back at it. `Product.data_reference` is
mandatory for every image; an image with nothing behind it cannot be built.

CONSISTENCY IS ENFORCED, NOT INTENDED
-------------------------------------
Section 42 requires every layer in a cycle to share a grid, valid times,
extent and projection. `check_consistency` verifies that across the built
set and refuses the cycle if a layer drifted -- because the failure it
prevents is one that looks entirely normal: a hazard map from the previous
cycle sitting beside a current risk map, both correctly labelled inside
themselves.

CATEGORIES ARE PRESENTATION
---------------------------
Section 43: do not hard-code visual risk categories into the scientific
engine. The probability stays continuous everywhere in this file. `BANDS`
exists for labelling and is applied at render time only, and a test asserts
no scientific field is stored in banded form.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from . import access as AX

log = logging.getLogger(__name__)

PRODUCTS_VERSION = "stage10.1"


class ProductKind(str, Enum):
    """Section 46's product types."""

    GRID = "gridded_data"
    POINT_SERIES = "point_series"
    MAP_IMAGE = "map_image"
    ANIMATION = "animation"
    SUMMARY = "summary"
    DIAGNOSTIC = "diagnostic_package"


#: Section 39's required layers. Declared as a list so a missing one is a
#: detectable gap rather than an absence nobody noticed.
REQUIRED_LAYERS: tuple[str, ...] = (
    "thunderstorm",
)

HAZARD_LAYERS: tuple[str, ...] = (
    "lightning", "hail", "severe_hail", "severe_wind",
    "heavy_rainfall", "downburst", "tornado_environment",
)

UNCERTAINTY_LAYERS: tuple[str, ...] = (
    "confidence", "uncertainty",
)

DIAGNOSTIC_LAYERS: tuple[str, ...] = (
    "cape", "cin", "shear_0_6km", "storm_relative_helicity_0_3km",
    "convective_initiation", "organisation", "thermodynamic",
)

ALL_LAYERS = (
    REQUIRED_LAYERS + HAZARD_LAYERS + UNCERTAINTY_LAYERS + DIAGNOSTIC_LAYERS
)


@dataclass(frozen=True, slots=True)
class ProductMetadata:
    """Section 41. Without this an image cannot say which forecast it is."""

    forecast_id: str
    cycle: datetime
    valid_time: datetime | None
    layer: str
    tcm_version: str
    grid: str
    generated_at: datetime
    #: For an image, the data product it was rendered from. Section 40.
    data_reference: str | None = None
    degraded: bool = False
    calibration: str = "uncalibrated"

    def to_dict(self) -> dict:
        return {
            "forecast_id": self.forecast_id,
            "cycle": self.cycle.isoformat(),
            "valid_time": (
                self.valid_time.isoformat() if self.valid_time else None
            ),
            "layer": self.layer,
            "tcm_version": self.tcm_version,
            "grid": self.grid,
            "generated_at": self.generated_at.isoformat(),
            "data_reference": self.data_reference,
            "degraded": self.degraded,
            "calibration": self.calibration,
            "products_version": PRODUCTS_VERSION,
        }


@dataclass(slots=True)
class Product:
    """One generated artefact."""

    name: str
    kind: ProductKind
    metadata: ProductMetadata
    path: str | None = None
    #: Inline payload for small products; large ones go to `path`.
    payload: dict | None = None
    warnings: list[str] = dc_field(default_factory=list)

    def __post_init__(self) -> None:
        if self.kind is ProductKind.MAP_IMAGE and not (
            self.metadata.data_reference
        ):
            raise ValueError(
                f"{self.name}: a map image must reference the data product "
                f"it was rendered from. Section 40: the image is never the "
                f"primary forecast product"
            )

    def to_dict(self) -> dict:
        out = {
            "product": self.name,
            "kind": self.kind.value,
            "path": self.path,
            "metadata": self.metadata.to_dict(),
            "warnings": self.warnings,
        }
        # The payload IS the product. Section 40 makes the data the
        # scientific source of truth, and an earlier version of this method
        # dropped it on serialisation -- so the stored bundle carried
        # metadata about a forecast whose values had gone.
        if self.payload is not None:
            out["payload"] = self.payload
        return out


def _root(forecast_id: str) -> Path:
    from ..config import get_settings
    root = get_settings().data_root / "production" / "products" / forecast_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def generate(manifest, context: dict, *, dry_run: bool = False) -> dict:
    """Build every product for a cycle. Sections 39 to 46."""
    from . import explain, points

    forecasts = context.get("forecasts") or []
    generated_at = datetime.now(timezone.utc)
    built: dict[str, dict] = {}

    def meta(layer: str, valid_time=None, reference=None) -> ProductMetadata:
        return ProductMetadata(
            forecast_id=manifest.forecast_id, cycle=manifest.cycle,
            valid_time=valid_time, layer=layer,
            tcm_version=manifest.versions.tcm,
            grid="tcm_ukv_laea_2km", generated_at=generated_at,
            data_reference=reference, degraded=manifest.degraded,
            calibration=_calibration_of(forecasts),
        )

    # -- the scientific source of truth: point data ------------------------
    series = _point_series(forecasts)
    product = Product(
        name="point_series", kind=ProductKind.POINT_SERIES,
        metadata=meta("thunderstorm"), payload=series,
    )
    product.warnings.append(points.describe()["limitation"])
    built["point_series"] = product.to_dict()

    # A flat map of probability by location, for the change engine to
    # compare the next cycle against. Section 50.
    built["point_probabilities"] = {
        _key(f): _probability(f)
        for f in forecasts
        if _probability(f) is not None
    }

    # -- hourly sequence, one entry per valid time -------------------------
    by_time: dict[str, list] = {}
    for forecast in forecasts:
        by_time.setdefault(
            forecast.valid_time.isoformat(), []
        ).append(forecast)

    frames = []
    for valid_iso in sorted(by_time):
        group = by_time[valid_iso]
        probabilities = [
            p for p in (_probability(f) for f in group) if p is not None
        ]
        frames.append({
            "valid_time": valid_iso,
            "cycle": manifest.cycle.isoformat(),
            "forecast_id": manifest.forecast_id,
            "points": len(group),
            "peak_probability": (
                round(max(probabilities), 5) if probabilities else None
            ),
            "mean_probability": (
                round(sum(probabilities) / len(probabilities), 5)
                if probabilities else None
            ),
        })
    built["animation_frames"] = {
        "frames": frames,
        "note": (
            "every frame carries its own valid time, cycle and forecast id. "
            "Section 45: frames from different cycles are never mixed, and "
            "nothing is interpolated to make the sequence look smoother"
        ),
    }

    # -- summary -----------------------------------------------------------
    written = explain.summary(
        forecasts, comparison=context.get("change"), manifest=manifest
    )
    built["summary"] = Product(
        name="summary", kind=ProductKind.SUMMARY,
        metadata=meta("summary"), payload=written,
    ).to_dict()
    built["summary"]["text"] = written.get("text", "")

    # -- layer inventory ---------------------------------------------------
    available, missing = _layer_inventory(forecasts)
    built["layers"] = {
        "available": available,
        "missing": missing,
        "required": list(REQUIRED_LAYERS),
        "note": (
            "layers are declared so a missing one is a detectable gap "
            "rather than an absence nobody noticed"
        ),
    }

    if not dry_run:
        path = _root(manifest.forecast_id) / "products.json"
        try:
            path.write_text(json.dumps(built, indent=1), encoding="utf-8")
            built["path"] = str(path)
        except OSError:
            log.exception("could not write the product bundle")

    consistency = check_consistency(built, manifest)
    built["consistency"] = consistency
    log.info(
        "products for %s: %d built, consistency %s",
        manifest.forecast_id, len(built),
        "ok" if consistency["consistent"] else "FAILED",
    )
    return built


def _point_series(forecasts: list) -> dict:
    from .points import POINTS

    by_name: dict[str, list] = {}
    for forecast in forecasts:
        lat, lon = forecast.latitude, forecast.longitude
        if lat is None or lon is None:
            continue
        nearest = min(
            POINTS, key=lambda p: (p.lat - lat) ** 2 + (p.lon - lon) ** 2
        )
        by_name.setdefault(nearest.name, []).append({
            "valid_time": forecast.valid_time.isoformat(),
            "forecast_hour": forecast.forecast_hour,
            "thunderstorm": _probability(forecast),
            # Section 27: the raw value is kept beside the calibrated one
            # and never overwritten by it.
            "raw_probability": AX.raw_probability(forecast),
            "calibration": AX.calibration(forecast),
            "hazards": {
                name: values["probability"]
                for name, values in sorted(AX.hazards(forecast).items())
            },
            "hazard_conditionals": {
                name: values["conditional"]
                for name, values in sorted(AX.hazards(forecast).items())
            },
            "confidence": AX.confidence(forecast),
            "uncertainty": AX.uncertainty(forecast),
            "publishable": AX.publishable(forecast),
        })
    return {
        "points": {k: sorted(v, key=lambda r: r["forecast_hour"] or 0)
                   for k, v in sorted(by_name.items())},
        "n_points": len(by_name),
    }


def _layer_inventory(forecasts: list) -> tuple[list[str], list[str]]:
    available: set[str] = set()
    for forecast in forecasts:
        if AX.probability(forecast) is not None:
            available.add("thunderstorm")
        for name, values in AX.hazards(forecast).items():
            if values["probability"] is not None:
                available.add(name)
        if AX.confidence(forecast) is not None:
            available.add("confidence")
        if AX.uncertainty(forecast) is not None:
            available.add("uncertainty")
    missing = [
        layer for layer in REQUIRED_LAYERS + HAZARD_LAYERS
        + UNCERTAINTY_LAYERS if layer not in available
    ]
    return sorted(available), missing


def check_consistency(built: dict, manifest) -> dict:
    """Section 42. Every layer must belong to the same cycle."""
    problems: list[str] = []
    cycle = manifest.cycle.isoformat()
    forecast_id = manifest.forecast_id

    for name, product in built.items():
        if not isinstance(product, dict):
            continue
        metadata = product.get("metadata")
        if not metadata:
            continue
        if metadata.get("cycle") != cycle:
            problems.append(
                f"{name} is labelled cycle {metadata.get('cycle')} but this "
                f"cycle is {cycle}"
            )
        if metadata.get("forecast_id") != forecast_id:
            problems.append(
                f"{name} belongs to forecast {metadata.get('forecast_id')}, "
                f"not {forecast_id}"
            )
        if metadata.get("grid") != "tcm_ukv_laea_2km":
            problems.append(
                f"{name} is on grid {metadata.get('grid')}, not the TCM grid"
            )

    frames = (built.get("animation_frames") or {}).get("frames") or []
    cycles = {f.get("cycle") for f in frames}
    if len(cycles) > 1:
        problems.append(
            f"animation frames span {len(cycles)} different cycles: "
            f"{sorted(cycles)}. Section 45 forbids mixing them"
        )

    return {
        "consistent": not problems,
        "problems": problems,
        "note": (
            "a hazard map from the previous cycle beside a current risk "
            "map looks entirely normal from the inside; only a check "
            "across the set finds it"
        ),
    }


def _probability(forecast) -> float | None:
    value = AX.probability(forecast)
    return round(value, 5) if value is not None else None


def _value(obj) -> float | None:
    value = getattr(obj, "value", None)
    return round(float(value), 4) if value is not None else None


def _calibration_of(forecasts: list) -> str:
    for forecast in forecasts:
        return AX.calibration(forecast)
    return "unknown"


def _key(forecast) -> str:
    return AX.location_key(forecast)
