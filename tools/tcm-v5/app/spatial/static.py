"""The static geography of the TCM grid: terrain and land-sea.

Step 2 of the Stage 8 order. Everything downstream -- slope, aspect,
orographic lift, distance to coast, sea-breeze potential -- rests on these
two arrays, so they are loaded once, validated hard, and cached.

WHERE THE TERRAIN COMES FROM
----------------------------
The Met Office UKV order publishes both fields as static GRIB2, on the TCM
grid exactly, with no regridding at all:

    2/0/7   "mterh"   Model terrain height    ground_model-terrain-height
    2/0/0   "lsm"     Land-sea mask           ground_land-cover

Section 4 asks for the highest-quality terrain available to the project and
section 5 forbids upsampling coarse terrain and calling it high-resolution.
This is the honest position:

  * It is 2 km NATIVE. The TCM grid IS the UKV grid, so there is no
    interpolation and no invented detail.
  * It is the MODEL's orography, not a survey DEM. Ben Nevis reads 801 m
    against a true 1345 m, and the Cairngorms 1052 m. Peaks are smoothed and
    narrow valleys are absent.

The second point is a limitation for describing the landscape and an
ADVANTAGE for describing the flow. The model's wind field was computed over
this orography, so an orographic-lift diagnostic built from the model's wind
and the model's terrain is internally consistent. Computing model wind
against a survey DEM would attribute ascent to terrain the model never saw.

`TerrainSource` records which of the two a layer is, so a finer DEM can be
dropped in later for the geometric descriptors without silently changing
what the flow diagnostics mean.

THE LAND-SEA MASK IS A FRACTION
-------------------------------
Section 54. `land_cover` is a 0-1 land fraction, not a boolean. Coastal
cells are genuinely mixed and the mask says so; `LAND_THRESHOLD` exists for
the places that need a hard answer, and `land_fraction` stays available for
the places that should not force one.

The platform already had a land mask in `app/forecast/landmask.py`, inferred
from the diurnal temperature range because no mask was thought to be
available. That module now reads this same field, keeping the inference only
as a logged fallback: measured against the Met Office mask the inference
agrees on 94.3% of the domain but calls 15,817 coastal and offshore cells
land, a median 24 km out to sea.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

import numpy as np

from ..grid import GridSpec, tcm_grid
from .feature import Lineage, Provenance, Quality, SpatialFeature

log = logging.getLogger(__name__)

#: Bumped when a change alters the numbers a stored feature would have.
PROCESSING_VERSION = "stage8.1"

#: Land fraction at or above which a cell is treated as land where a binary
#: answer is unavoidable. 0.5 is the only defensible cut for a fraction that
#: means "how much of this cell is land" -- anything else would prefer one
#: surface over the other for no physical reason.
LAND_THRESHOLD = 0.5

#: A cell whose land fraction is strictly between these is genuinely mixed,
#: and section 54 says land-only logic must not be applied to it. The bounds
#: are the fraction itself, not a tuned parameter: below 0.05 there is
#: essentially no land to heat, above 0.95 essentially no water to cool.
MIXED_LOW = 0.05
MIXED_HIGH = 0.95


class TerrainSource(str, Enum):
    """What a terrain layer actually is. Section 5 and section 52."""

    #: The NWP model's own orography, at the model's own resolution.
    MODEL_OROGRAPHY = "model_orography"
    #: A surveyed digital elevation model, independent of any forecast.
    SURVEY_DEM = "survey_dem"


@dataclass(frozen=True, slots=True)
class Geography:
    """The static layer: elevation, land fraction, and the grid they sit on.

    Held together in one object because using an elevation array with the
    wrong land mask, or either with the wrong grid, produces coastlines in
    the sea and mountains in the Channel -- an error that looks like weather
    rather than like a bug.
    """

    elevation: np.ndarray            # metres above sea level
    land_fraction: np.ndarray        # 0-1
    grid: GridSpec
    source: TerrainSource
    model: str
    #: Native resolution of the terrain data, metres. Equal to the grid
    #: spacing only when the terrain was not resampled.
    native_resolution_m: float
    run: datetime | None = None
    notes: str = ""

    def __post_init__(self) -> None:
        if self.elevation.shape != self.grid.shape:
            raise ValueError(
                f"elevation {self.elevation.shape} is not on grid "
                f"{self.grid.name} {self.grid.shape}"
            )
        if self.land_fraction.shape != self.grid.shape:
            raise ValueError(
                f"land fraction {self.land_fraction.shape} is not on grid "
                f"{self.grid.name} {self.grid.shape}"
            )

    # -- derived masks -----------------------------------------------------

    @property
    def is_land(self) -> np.ndarray:
        return self.land_fraction >= LAND_THRESHOLD

    @property
    def is_sea(self) -> np.ndarray:
        return self.land_fraction < LAND_THRESHOLD

    @property
    def is_mixed(self) -> np.ndarray:
        """Cells that are neither cleanly land nor cleanly sea.

        Section 54: land-only temperature logic must not run here, and these
        are exactly the cells where sea breezes and coastal convergence
        happen, so they cannot simply be discarded either.
        """
        return (self.land_fraction > MIXED_LOW) & (
            self.land_fraction < MIXED_HIGH
        )

    @property
    def mask_is_binary(self) -> bool:
        """True when the mask holds only 0 and 1, with no partial cells.

        The UKV mask IS binary: every cell is wholly land or wholly sea, so
        `is_mixed` finds nothing and section 54's mixed-cell caution has no
        cells to act on. That is not the same as there being no sub-grid
        coastal mixing -- a cell whose centre is on land 500 m from the shore
        is thoroughly marine in reality, and the mask cannot say so.

        `distance_to_coast` in `coast.py` is the continuous quantity that
        carries that information, and is what the coastal diagnostics use
        instead of trying to read a gradient out of a step function.
        """
        distinct = np.unique(self.land_fraction[np.isfinite(self.land_fraction)])
        return bool(np.all(np.isin(distinct, (0.0, 1.0))))

    @property
    def spacing_m(self) -> float:
        return self.grid.spacing_m

    @property
    def is_upsampled(self) -> bool:
        """True when the terrain is coarser than the grid it is stored on."""
        return self.native_resolution_m > self.grid.spacing_m + 1.0

    def provenance(self, method: str, *, scale_m: float | None = None,
                   extra: str = "") -> Provenance:
        note = self.notes
        if extra:
            note = f"{note} {extra}".strip()
        return Provenance(
            method=method,
            inputs=("terrain_height", "land_cover"),
            model=self.model, run=self.run, scale_m=scale_m,
            processing_version=PROCESSING_VERSION, notes=note,
        )

    def feature(
        self, name: str, values: np.ndarray, unit: str, method: str, *,
        scale_m: float | None = None, valid: np.ndarray | None = None,
        quality: Quality = Quality.GOOD, reason: str = "",
        flags: tuple[str, ...] = (),
    ) -> SpatialFeature:
        """Wrap a derived static array with this layer's provenance."""
        return SpatialFeature(
            name=name, values=values, unit=unit, quality=quality,
            lineage=Lineage.STATIC,
            provenance=self.provenance(method, scale_m=scale_m),
            reason=reason, valid=valid, flags=flags,
        )

    def describe(self) -> dict:
        land = self.is_land
        return {
            "grid": self.grid.name,
            "shape": list(self.grid.shape),
            "spacing_m": self.grid.spacing_m,
            "terrain_source": self.source.value,
            "native_resolution_m": self.native_resolution_m,
            "is_upsampled": self.is_upsampled,
            "model": self.model,
            "land_cells": int(land.sum()),
            "sea_cells": int((~land).sum()),
            "mixed_cells": int(self.is_mixed.sum()),
            "mask_is_binary": self.mask_is_binary,
            "land_fraction_of_domain": float(land.mean()),
            "elevation_m": {
                "min": float(np.nanmin(self.elevation)),
                "max": float(np.nanmax(self.elevation)),
                "mean_over_land": float(np.nanmean(self.elevation[land]))
                if land.any() else None,
            },
            "notes": self.notes,
        }


# --------------------------------------------------------------------------
# Quality control -- section 58
# --------------------------------------------------------------------------

def validate(geo: Geography) -> list[str]:
    """Everything wrong with a static layer, as plain statements.

    A geometry error here is invisible downstream: gradients still compute,
    boundaries are still detected, and the answers are simply in the wrong
    place. So the checks are deliberately blunt and run at load time.
    """
    problems: list[str] = []
    elev, land = geo.elevation, geo.land_fraction

    if not np.isfinite(elev).all():
        problems.append(
            f"{int((~np.isfinite(elev)).sum())} elevation cells are not finite"
        )
    if not np.isfinite(land).all():
        problems.append(
            f"{int((~np.isfinite(land)).sum())} land-fraction cells are not "
            f"finite"
        )
    if np.nanmin(land) < -1e-6 or np.nanmax(land) > 1.0 + 1e-6:
        problems.append(
            f"land fraction runs {np.nanmin(land):.3f} to "
            f"{np.nanmax(land):.3f}; it must be a 0-1 fraction"
        )
    if np.nanmin(elev) < -500.0:
        problems.append(
            f"minimum elevation {np.nanmin(elev):.0f} m is below any UK land"
        )
    if np.nanmax(elev) > 2000.0:
        problems.append(
            f"maximum elevation {np.nanmax(elev):.0f} m exceeds anything in "
            f"the UK; the terrain field is probably not what it claims"
        )

    # Deep water with mountains on it, or land at a physically odd height,
    # is the signature of a mask and an elevation field that do not belong
    # to the same grid.
    sea = geo.is_sea
    if sea.any():
        high_sea = elev[sea] > 50.0
        if high_sea.any():
            problems.append(
                f"{int(high_sea.sum())} cells are sea but stand above 50 m; "
                f"the mask and the elevation may be misaligned"
            )
    if geo.is_land.any() and float(geo.is_land.mean()) > 0.9:
        problems.append(
            f"{geo.is_land.mean():.0%} of the domain is land, which no UK "
            f"domain is; the mask is probably inverted or saturated"
        )
    return problems


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

_cache: dict[str, Geography] = {}


def load(
    model_id: str = "ukv", run: datetime | None = None, *,
    forecast_hour: int | None = None, refresh: bool = False,
) -> Geography:
    """The static layer for a model, from whatever run has it stored.

    Terrain and the land mask do not change between cycles, so any stored
    copy will do and the result is cached per model. `refresh` forces a
    reload after an ingest.
    """
    if not refresh and model_id in _cache:
        return _cache[model_id]

    from ..pipeline.ingest import load_field, stored_runs

    runs = [run] if run is not None else list(reversed(stored_runs(model_id)))
    if not runs:
        raise LookupError(f"no stored runs for {model_id}")

    hours = [forecast_hour] if forecast_hour is not None else [
        0, 6, 12, 18, 24, 30, 36, 42, 48, 54
    ]
    elevation = land = None
    found_run = None
    for cycle in runs:
        for fh in hours:
            if elevation is None:
                f = load_field(model_id, cycle, "terrain_height", fh)
                if f is not None:
                    elevation, found_run = f.values, cycle
            if land is None:
                f = load_field(model_id, cycle, "land_cover", fh)
                if f is not None:
                    land = f.values
            if elevation is not None and land is not None:
                break
        if elevation is not None and land is not None:
            break

    missing = [
        n for n, v in (("terrain_height", elevation), ("land_cover", land))
        if v is None
    ]
    if missing:
        raise LookupError(
            f"{model_id} has no stored {' or '.join(missing)}. Stage 8 needs "
            f"the static geography; ingest it with "
            f"`ingest_parameter(model, '{missing[0]}', run, hour)`"
        )

    geo = Geography(
        elevation=np.asarray(elevation, dtype="float64"),
        land_fraction=np.clip(np.asarray(land, dtype="float64"), 0.0, 1.0),
        grid=tcm_grid(),
        source=TerrainSource.MODEL_OROGRAPHY,
        model=model_id,
        native_resolution_m=tcm_grid().spacing_m,
        run=found_run,
        notes=(
            "the MODEL's orography at its own 2 km resolution, not a survey "
            "DEM: peaks are smoothed (Ben Nevis reads ~800 m) and narrow "
            "valleys are absent. It is what the model's own wind field "
            "actually flowed over"
        ),
    )

    problems = validate(geo)
    if problems:
        for p in problems:
            log.error("static geography for %s: %s", model_id, p)
        raise ValueError(
            f"the static geography for {model_id} failed validation: "
            + "; ".join(problems)
        )

    _cache[model_id] = geo
    log.info(
        "static geography for %s: %d land cells, %d sea, %d mixed, peak %.0f m",
        model_id, int(geo.is_land.sum()), int(geo.is_sea.sum()),
        int(geo.is_mixed.sum()), float(np.nanmax(geo.elevation)),
    )
    return geo


def clear_cache() -> None:
    _cache.clear()
