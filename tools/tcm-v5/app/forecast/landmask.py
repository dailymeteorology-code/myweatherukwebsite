"""Which cells of the TCM grid are land.

The outlook names the regions a risk sits over, and the region boxes are
lon/lat rectangles: "eastern England" reaches 2.0 E and "south-east England"
reaches 52.2 N, so both contain large areas of the North Sea and the Channel.
Ranking regions by the fraction of the BOX above a threshold therefore let a
convective area sitting offshore name a land region whose land was quiet --
which is how the outlook came to describe the wrong parts of the country.

THE MASK COMES FROM THE MET OFFICE
----------------------------------
The UKV order publishes a land-sea mask, on the TCM grid exactly:

    GRIB discipline 2 / category 0 / number 0, shortName "lsm",
    parameter "ground_land-cover", canonical name `land_cover`

It is discipline 2 -- LAND SURFACE -- which is why it does not turn up when
searching the discipline-0 meteorological tables, and the Met Office names
the parameter "land-cover", which reads like a vegetation classification. It
is a land-sea mask, and on the UKV grid it is binary: every cell is wholly
land or wholly sea.

WHY THIS MODULE USED TO INFER IT INSTEAD
----------------------------------------
It was believed no mask existed, so one was derived from the data: land has
a diurnal temperature cycle and sea effectively does not, so a cell whose
25-hour screen-temperature range reached 3 K was called land.

That inference works, and measured against the Met Office mask on the
2026-09-01 00Z grid it agrees on 94.3% of the domain:

    Met Office        81,379 land cells   27.99%
    inference         96,384 land cells   33.15%

    15,817 cells the inference calls LAND that are SEA
       812 cells the inference calls SEA that are LAND

The residual error is one-sided and it lands in the worst possible place.
The over-classified cells sit a median 24 km offshore and reach 288 km out,
so a convective area over water can still fall inside what the mask believes
is land -- which is precisely the failure this module was written to
prevent. Every spot check on open water (North Sea, Channel, Irish Sea,
Atlantic) is right; it is the near-coastal band and scattered offshore
patches that are not.

There was also a latent problem in the accumulation. To stop an overcast day
misclassifying land as sea, the range was accumulated as a per-cell MAXIMUM
across every cycle ever seen, persisted, and documented as never allowed to
shrink. A quantity that can only grow, tested against a fixed threshold,
tends towards marking everything as land. It had not yet done so -- with
three cycles stored, the ratchet and a fresh recomputation give the same
96,384 cells -- but the design has no mechanism that would ever stop it.

The inference survives as a FALLBACK for a grid with no ingested mask, with
two changes. It is recomputed from the cycles currently stored rather than
ratcheted across all time, which removes the unbounded growth. And every
path that uses it logs a warning and reports `source: "diurnal_inference"`,
so an inferred mask is never mistaken for a measured one.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

#: Canonical name of the Met Office land-sea mask in the ingest store.
MASK_PARAMETER = "land_cover"

#: Land fraction at or above which a cell counts as land. The field is a
#: 0-1 fraction and binary in practice, so 0.5 is the only defensible cut.
LAND_FRACTION_THRESHOLD = 0.5

#: Diurnal range separating land from sea in the FALLBACK. Midway between the
#: land minimum (3.67 K) and the sea maximum (2.30 K) measured on real UKV
#: data on the 2026-08-29 12Z cycle.
LAND_DIURNAL_RANGE_K = 3.0

#: Hours needed to see a full diurnal cycle.
CYCLE_HOURS = 25

#: A UK-domain mask outside these land fractions is not a UK-domain mask.
#: The real value is 0.28. The bounds are wide enough to accept any
#: plausible domain change and narrow enough to catch a saturated or
#: inverted mask, which is what both failure modes look like.
MIN_LAND_FRACTION = 0.02
MAX_LAND_FRACTION = 0.90

_cache: np.ndarray | None = None
_source: str = "none"


def _paths() -> tuple[Path, Path]:
    from ..config import get_settings

    root = get_settings().data_root
    return root / "landmask.npy", root / "landmask.json"


# --------------------------------------------------------------------------
# The authoritative mask
# --------------------------------------------------------------------------

def _validate(land: np.ndarray) -> str | None:
    """Why this mask cannot be trusted, or None if it can."""
    if land.ndim != 2:
        return f"the mask is {land.ndim}-dimensional, not a grid"
    fraction = float(land.mean())
    if fraction > MAX_LAND_FRACTION:
        return (
            f"{fraction:.0%} of the domain is land. No UK domain is, and "
            f"this is what both a saturated inference and an inverted mask "
            f"look like"
        )
    if fraction < MIN_LAND_FRACTION:
        return (
            f"only {fraction:.1%} of the domain is land, which is too "
            f"little for a domain containing Great Britain and Ireland"
        )
    return None


def _from_grib(model_id: str = "ukv") -> np.ndarray | None:
    """The Met Office land-sea mask from the ingest store.

    Static, so any stored run will do. Searched newest first only because a
    recent run is the likeliest to be complete, not because the value
    changes between them.
    """
    from ..pipeline.ingest import load_field, stored_runs

    try:
        runs = list(reversed(stored_runs(model_id)))
    except Exception:
        log.exception("could not list stored runs for the land mask")
        return None

    for run in runs:
        for hour in (0, 6, 12, 18, 24, 30, 36, 42, 48, 54):
            try:
                field = load_field(model_id, run, MASK_PARAMETER, hour)
            except Exception:
                continue
            if field is None:
                continue
            values = np.asarray(field.values, dtype="float64")
            land = values >= LAND_FRACTION_THRESHOLD
            problem = _validate(land)
            if problem is not None:
                log.error(
                    "the stored %s from %s T+%d is unusable: %s",
                    MASK_PARAMETER, run, hour, problem,
                )
                continue
            log.info(
                "land mask from the Met Office %s field (%s T+%d): "
                "%d land cells, %.1f%% of the domain",
                MASK_PARAMETER, run.strftime("%Y-%m-%d %HZ"), hour,
                int(land.sum()), 100 * land.mean(),
            )
            return land
    return None


# --------------------------------------------------------------------------
# The fallback
# --------------------------------------------------------------------------

def _from_diurnal_range(model_id: str = "ukv") -> np.ndarray | None:
    """Infer land from the screen-temperature diurnal range.

    Only reached when no ingested mask exists. Unlike the version this
    replaces, the maximum is taken over the cycles CURRENTLY STORED rather
    than accumulated into a persisted file across all time. That is the
    whole of the saturation fix: the old ratchet could only ever grow and
    eventually crossed the threshold everywhere, and bounding it to the
    cycles on disk keeps the reasoning -- cloud delays recognition rather
    than reversing it -- without letting the error compound forever.
    """
    from ..pipeline.ingest import load_field, stored_runs

    best: np.ndarray | None = None
    cycles = 0
    for run in stored_runs(model_id):
        hours = [
            h for h in range(0, 60)
            if load_field(model_id, run, "temperature_2m", h) is not None
        ]
        if len(hours) < CYCLE_HOURS:
            continue
        stack = np.stack([
            load_field(model_id, run, "temperature_2m", h).values
            for h in hours[:CYCLE_HOURS]
        ])
        span = np.nanmax(stack, axis=0) - np.nanmin(stack, axis=0)
        best = span if best is None else np.maximum(best, span)
        cycles += 1

    if best is None:
        return None

    land = best >= LAND_DIURNAL_RANGE_K
    problem = _validate(land)
    if problem is not None:
        log.error(
            "the diurnal land-mask inference produced an unusable mask "
            "from %d cycle(s): %s", cycles, problem,
        )
        return None
    # States what this function did, not why it was called: it cannot know
    # whether the measured mask was unavailable or simply not asked for.
    # `refresh` and `land_mask` log the reason at the point they choose it.
    log.warning(
        "land mask INFERRED from the screen-temperature diurnal range over "
        "%d cycle(s): %d land cells, %.1f%%. This over-classifies coastal "
        "water as land and is a fallback for the measured Met Office mask",
        cycles, int(land.sum()), 100 * land.mean(),
    )
    return land


# --------------------------------------------------------------------------
# Public interface
# --------------------------------------------------------------------------

def refresh(model_id: str = "ukv") -> dict:
    """Rebuild the land mask and persist a description of it.

    Safe to call after every ingest. Prefers the Met Office mask and falls
    back to inference only when that field has never been ingested, which is
    reported rather than hidden.
    """
    global _cache, _source

    land = _from_grib(model_id)
    source = "metoffice_land_sea_mask"
    if land is None:
        log.warning(
            "no stored %s field for %s: falling back to inferring the land "
            "mask from the diurnal temperature range",
            MASK_PARAMETER, model_id,
        )
        land = _from_diurnal_range(model_id)
        source = "diurnal_inference"

    if land is None:
        _cache, _source = None, "none"
        return {
            "ok": False,
            "reason": (
                f"neither a stored {MASK_PARAMETER} field nor a cycle with "
                f"{CYCLE_HOURS} hours of screen temperature is available, so "
                f"no land mask could be built"
            ),
        }

    _cache, _source = land, source
    report = {
        "ok": True,
        "source": source,
        "authoritative": source == "metoffice_land_sea_mask",
        "land_cells": int(land.sum()),
        "land_fraction": round(float(land.mean()), 4),
        "shape": list(land.shape),
        "updated": datetime.now(timezone.utc).isoformat(),
        "method": (
            "the Met Office UKV land-sea mask (GRIB 2/0/0, parameter "
            "ground_land-cover), on the TCM grid with no resampling"
            if source == "metoffice_land_sea_mask" else
            "INFERRED from the per-cell maximum 25-hour screen-temperature "
            "range across the cycles currently stored. A fallback: the "
            "measured mask is preferred whenever it has been ingested"
        ),
    }
    if source != "metoffice_land_sea_mask":
        report["warning"] = (
            f"this mask is inferred, not measured. Ingest the "
            f"{MASK_PARAMETER} field to replace it"
        )

    npy, meta_path = _paths()
    try:
        npy.parent.mkdir(parents=True, exist_ok=True)
        np.save(npy, land)
        meta_path.write_text(json.dumps(report, indent=1), encoding="utf-8")
    except OSError:
        log.exception("could not persist the land mask")

    log.info(
        "land mask: %d cells (%.1f%%) from %s",
        report["land_cells"], report["land_fraction"] * 100, source,
    )
    return report


def land_mask() -> np.ndarray | None:
    """The boolean land mask, or None if none could be built.

    None is a real answer and callers must handle it: falling back to a mask
    of all-True would silently restore the sea-inflated behaviour this module
    exists to remove, so the caller says the coverage is box-based instead.
    """
    global _cache, _source
    if _cache is not None:
        return _cache

    land = _from_grib()
    if land is not None:
        _cache, _source = land, "metoffice_land_sea_mask"
        return _cache

    # A persisted mask, but only if it is a BOOLEAN one this version wrote.
    # The previous version stored the accumulated diurnal RANGE in the same
    # file and thresholded it on read; loading that here would silently
    # resurrect the saturated mask this change exists to remove.
    npy, meta_path = _paths()
    if npy.exists():
        try:
            stored = np.load(npy)
        except (OSError, ValueError):
            log.exception("could not read the persisted land mask")
            stored = None
        if stored is not None:
            if stored.dtype == bool:
                problem = _validate(stored)
                if problem is None:
                    # The sidecar records which source produced it, so a
                    # persisted mask does not lose the distinction between
                    # measured and inferred just by being read from disk.
                    recorded = "persisted"
                    try:
                        recorded = json.loads(
                            meta_path.read_text("utf-8")
                        ).get("source", "persisted")
                    except (OSError, json.JSONDecodeError, AttributeError):
                        pass
                    _cache, _source = stored, recorded
                    return _cache
                log.error("the persisted land mask is unusable: %s", problem)
            else:
                log.warning(
                    "ignoring %s: it holds %s, not a boolean mask, so it is "
                    "the accumulated diurnal range written by the previous "
                    "version of this module. That accumulation saturated and "
                    "must not be reloaded",
                    npy.name, stored.dtype,
                )

    land = _from_diurnal_range()
    if land is not None:
        _cache, _source = land, "diurnal_inference"
    return land


def source() -> str:
    """Where the current mask came from. "none" when there is none."""
    if _cache is None:
        land_mask()
    return _source


def is_authoritative() -> bool:
    """True only when the mask is the Met Office one, not an inference."""
    return source() == "metoffice_land_sea_mask"


def status() -> dict:
    _, meta_path = _paths()
    live = {"source": source(), "authoritative": is_authoritative()}
    if not meta_path.exists():
        return {
            "available": _cache is not None,
            "reason": "no persisted description; call refresh()",
            **live,
        }
    try:
        return {
            "available": True,
            **json.loads(meta_path.read_text("utf-8")),
            **live,
        }
    except (OSError, json.JSONDecodeError) as exc:
        return {"available": False, "reason": str(exc), **live}


def _reset_cache() -> None:
    """For tests, and after an ingest."""
    global _cache, _source
    _cache = None
    _source = "none"
