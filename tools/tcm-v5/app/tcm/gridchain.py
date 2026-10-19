"""Stages 4 to 7 over the whole grid, producing a probability FIELD.

Until now the probability chain ran point by point. `production/points.py`
explains why -- Stage 4's parcel ascent was vectorised but nothing else was,
so a full pass was 53 hours and the forecast was a set of declared points
instead of a field.

`parameters/gridparams.py` closed the expensive end of that: Stage 4 is 99.2%
of the per-cell cost and it now runs gridded. This module joins the rest of
the chain to it.

WHAT IS STILL PER CELL, AND WHY THAT IS AFFORDABLE
---------------------------------------------------
Stage 5 (3.8 ms) and Stage 7 (1.3 ms) still run one cell at a time. They are
kept scalar deliberately rather than for lack of effort: between them they
are 0.8% of the original per-cell cost, and they are the part of the platform
whose correctness rests on the transfer/composition architecture and its
no-hidden-weights guarantees. Rewriting 3,000 lines of carefully audited
engine code as array arithmetic to save a fraction of the time would trade
the platform's most valuable property for its least pressing problem.

They will be vectorised when they are the bottleneck. Today Stage 4 was.

PARALLELISM IS PROCESSES, NOT THREADS
--------------------------------------
`workers` spreads the cells over processes. It has to be processes: Stages 5
and 7 are pure Python -- dataclass construction, dict lookups, transfer
evaluation -- so the GIL would serialise threads completely. Cells are
independent, nothing reads its neighbour, so the split is exact rather than
approximate, and a test asserts the parallel and serial fields are identical.

Bands of rows rather than individual cells: a task per cell would spend more
time in the queue than in the forecast. The gridded parameters are handed to
each worker ONCE through an initialiser, because passing them per task would
pickle about 70 MB every time.

What this does NOT parallelise is Stage 4, which is single-threaded numpy and
therefore a floor on how fast a cycle can get.

STRIDE IS DECLARED, NEVER ASSUMED
----------------------------------
`stride` evaluates every Nth cell in each direction. It exists because the
model's EFFECTIVE resolution is 5-7 grid lengths (Skamarock 2004; Ricard et
al. 2013), so a probability field sampled every 3 cells carries essentially
the information a 2 km field does -- but that is an argument to be made
explicitly, not a saving to take quietly. The stride used travels on the
result, is reported by `describe()`, and any interpolation back to 2 km says
so. A stride of 1 is a genuine per-cell forecast.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from ..parameters.gridparams import GriddedParameters, compute_grid
from ..profiles.schema import Profile

log = logging.getLogger(__name__)

GRID_CHAIN_VERSION = "1.0"


@dataclass(slots=True)
class GridForecast:
    """The probability field, with everything needed to distrust it."""

    model: str
    run: datetime
    valid_time: datetime
    forecast_hour: int
    shape: tuple[int, int]
    stride: int

    probability: np.ndarray
    raw_probability: np.ndarray
    confidence: np.ndarray
    uncertainty: np.ndarray
    hazards: dict[str, np.ndarray] = dc_field(default_factory=dict)

    #: Cells the chain was attempted at, and cells it produced an answer for.
    attempted: int = 0
    produced: int = 0
    failed: int = 0
    seconds: float = 0.0
    calibration: str = "uncalibrated"
    issues: list[str] = dc_field(default_factory=list)
    version: str = GRID_CHAIN_VERSION

    @property
    def coverage(self) -> float:
        return float(np.isfinite(self.probability).mean())

    def describe(self) -> dict:
        return {
            "model": self.model,
            "valid_time": self.valid_time.isoformat(),
            "forecast_hour": self.forecast_hour,
            "shape": list(self.shape),
            "stride": self.stride,
            "grid_spacing_m": 2000.0 * self.stride,
            "cells_attempted": self.attempted,
            "cells_with_a_forecast": self.produced,
            "cells_failed": self.failed,
            "coverage": round(self.coverage, 4),
            "seconds": round(self.seconds, 1),
            "calibration": self.calibration,
            "hazards": sorted(self.hazards),
            "version": self.version,
            "limitation": (
                "this is a FIELD, not a set of points -- but it is "
                f"evaluated every {self.stride} grid cell(s), i.e. every "
                f"{2.0 * self.stride:.0f} km, and the probabilities are "
                f"{self.calibration}"
            ),
        }


#: Worker state, set once per process by `_init_worker`. A module global
#: because the alternative -- passing the gridded parameters with every task
#: -- would pickle about 70 MB per chunk instead of once per worker.
_WORKER: dict = {}


def _init_worker(parameters, lons, lats, model_id, spatial) -> None:
    from ..skill import identity as ident

    _WORKER.update(
        parameters=parameters, lons=lons, lats=lats, model_id=model_id,
        spatial=spatial, identities={model_id: ident.identify(model_id)},
    )


def _forecast_rows(task):
    """One horizontal band, in a worker process.

    Returns plain arrays rather than forecast objects: a `TCMForecast` per
    cell would be tens of thousands of objects to pickle back, and the parent
    only ever reads the numbers off them.
    """
    rows, stride, usable = task
    parameters = _WORKER["parameters"]
    lons, lats = _WORKER["lons"], _WORKER["lats"]
    nx = parameters.shape[1]
    out = _blank_band(len(rows), nx)
    produced = failed = attempted = 0
    for k, iy in enumerate(rows):
        for ix in range(0, nx, stride):
            if not usable[k, ix]:
                continue
            attempted += 1
            values = _forecast_cell(int(iy), int(ix), parameters, lons, lats,
                                    stride)
            if values is None:
                failed += 1
                continue
            probability, raw, confidence, uncertainty, hazards, calibration = \
                values
            produced += 1
            out["probability"][k, ix] = probability
            out["raw_probability"][k, ix] = raw
            out["confidence"][k, ix] = confidence
            out["uncertainty"][k, ix] = uncertainty
            out["calibration"] = calibration
            for name, value in hazards.items():
                field = out["hazards"].get(name)
                if field is None:
                    field = out["hazards"].setdefault(
                        name, np.full((len(rows), nx), np.nan)
                    )
                field[k, ix] = value
    out["counts"] = (attempted, produced, failed)
    return rows[0], out


def _blank_band(ny: int, nx: int) -> dict:
    blank = lambda: np.full((ny, nx), np.nan)          # noqa: E731
    return {
        "probability": blank(), "raw_probability": blank(),
        "confidence": blank(), "uncertainty": blank(),
        "hazards": {}, "calibration": "uncalibrated", "counts": (0, 0, 0),
    }


def _forecast_cell(iy, ix, parameters, lons, lats, stride):
    """Stages 5 to 7 for one cell. None when it could not be evaluated."""
    from ..engines import pipeline as engine_pipeline
    from ..spatial import integrate as spatial_integrate
    from . import forecast as tcm_forecast

    spatial = _WORKER.get("spatial")
    model_id = _WORKER.get("model_id", "ukv")
    try:
        params = parameters.at(iy, ix, latitude=float(lats[iy, ix]),
                               longitude=float(lons[iy, ix]))
        forcing = elevation = None
        if spatial is not None:
            supplied = spatial_integrate.stage5_forcing(spatial, iy, ix)
            forcing = supplied.as_overrides()
            elevation = supplied.context.get("elevation")
        specialist = engine_pipeline.run_for_parameters(
            params, elevation=elevation, forcing=forcing
        )
        forecast = tcm_forecast.produce(
            {(model_id, None): specialist.results},
            run=parameters.run, valid_time=parameters.valid_time,
            forecast_hour=parameters.forecast_hour,
            identities=_WORKER["identities"],
            latitude=float(lats[iy, ix]), longitude=float(lons[iy, ix]),
            output_grid_spacing_m=2000.0 * stride,
        )
    except Exception:                                  # noqa: BLE001
        return None
    if forecast.probability is None:
        return None
    hazards = {
        name: hazard.probability
        for name, hazard in (forecast.hazards or {}).items()
        if hazard.probability is not None
    }
    return (
        forecast.probability,
        forecast.raw_probability if forecast.raw_probability is not None
        else np.nan,
        forecast.confidence.value if forecast.confidence is not None
        else np.nan,
        forecast.uncertainty.value if forecast.uncertainty is not None
        else np.nan,
        hazards,
        getattr(forecast.calibration, "value", forecast.calibration),
    )


def run_grid(
    cube: Profile, *, spatial=None, model_id: str = "ukv", stride: int = 1,
    parameters: GriddedParameters | None = None,
    progress_every: int = 20000, workers: int = 1,
) -> GridForecast | None:
    """Run Stages 4 to 7 for every (strided) cell of one forecast hour.

    `workers` > 1 spreads the cells across processes. They are completely
    independent -- no cell reads another -- so this is exact, and a test
    asserts the parallel and serial fields are identical. Threads would not
    do: Stage 5 and Stage 7 are pure Python and the GIL would serialise them.
    """
    from ..engines import pipeline as engine_pipeline
    from ..grid import grid_lonlat, tcm_grid
    from ..skill import identity as ident
    from ..spatial import integrate as spatial_integrate
    from . import forecast as tcm_forecast

    started = time.perf_counter()
    if parameters is None:
        parameters = compute_grid(cube)
    if parameters is None:
        log.info("no usable gridded column; no field forecast")
        return None

    ny, nx = parameters.shape
    lons, lats = grid_lonlat(tcm_grid())
    empty = lambda: np.full((ny, nx), np.nan)          # noqa: E731
    out = GridForecast(
        model=parameters.model, run=parameters.run,
        valid_time=parameters.valid_time,
        forecast_hour=parameters.forecast_hour,
        shape=(ny, nx), stride=stride,
        probability=empty(), raw_probability=empty(),
        confidence=empty(), uncertainty=empty(),
        issues=list(parameters.issues),
    )

    identities = {model_id: ident.identify(model_id)}
    # A cell with no column at all is not a forecast of zero. Those are
    # skipped and left NaN rather than filled, which is the same rule the
    # scalar path follows.
    mucape = parameters.value("mucape")
    if mucape is None:
        out.issues.append(
            "the gridded parameters carry no most-unstable CAPE, so there is "
            "no basis for deciding which cells have a column to forecast from"
        )
        out.seconds = time.perf_counter() - started
        return out
    usable = np.isfinite(mucape)
    if not np.any(usable):
        out.issues.append("no cell had a usable parcel ascent")
        out.seconds = time.perf_counter() - started
        return out

    if workers > 1:
        _run_parallel(out, parameters, lons, lats, model_id, spatial,
                      stride, usable, workers)
        out.seconds = time.perf_counter() - started
        log.info(
            "grid chain: %d/%d cells forecast in %.0f s on %d workers",
            out.produced, out.attempted, out.seconds, workers,
        )
        return out

    attempted = produced = failed = 0
    for iy in range(0, ny, stride):
        for ix in range(0, nx, stride):
            if not usable[iy, ix]:
                continue
            attempted += 1
            try:
                params = parameters.at(
                    iy, ix, latitude=float(lats[iy, ix]),
                    longitude=float(lons[iy, ix]),
                )
                forcing = None
                elevation = None
                if spatial is not None:
                    supplied = spatial_integrate.stage5_forcing(
                        spatial, int(iy), int(ix)
                    )
                    forcing = supplied.as_overrides()
                    elevation = supplied.context.get("elevation")

                specialist = engine_pipeline.run_for_parameters(
                    params, elevation=elevation, forcing=forcing
                )
                forecast = tcm_forecast.produce(
                    {(model_id, None): specialist.results},
                    run=parameters.run, valid_time=parameters.valid_time,
                    forecast_hour=parameters.forecast_hour,
                    identities=identities,
                    latitude=float(lats[iy, ix]),
                    longitude=float(lons[iy, ix]),
                    output_grid_spacing_m=2000.0 * stride,
                )
            except Exception as exc:               # noqa: BLE001
                failed += 1
                if failed <= 5:
                    log.warning("cell (%d,%d) failed: %r", iy, ix, exc)
                continue

            if forecast.probability is None:
                continue
            produced += 1
            out.probability[iy, ix] = forecast.probability
            if forecast.raw_probability is not None:
                out.raw_probability[iy, ix] = forecast.raw_probability
            if forecast.confidence is not None:
                out.confidence[iy, ix] = forecast.confidence.value
            if forecast.uncertainty is not None:
                out.uncertainty[iy, ix] = forecast.uncertainty.value
            # `.value`, not the enum: `str, Enum` members format as
            # "CalibrationStatus.UNCALIBRATED" rather than "uncalibrated",
            # which then appears verbatim in the product limitation text.
            out.calibration = getattr(
                forecast.calibration, "value", forecast.calibration
            )
            for name, hazard in (forecast.hazards or {}).items():
                if hazard.probability is None:
                    continue
                field = out.hazards.get(name)
                if field is None:
                    field = out.hazards.setdefault(name, empty())
                field[iy, ix] = hazard.probability

            if progress_every and attempted % progress_every == 0:
                elapsed = time.perf_counter() - started
                log.info("grid chain: %d cells in %.0f s (%.1f ms/cell)",
                         attempted, elapsed, 1000 * elapsed / attempted)

    out.attempted, out.produced, out.failed = attempted, produced, failed
    out.seconds = time.perf_counter() - started
    log.info(
        "grid chain: %d/%d cells forecast in %.0f s (%.1f ms/cell), "
        "%d failed", produced, attempted, out.seconds,
        1000 * out.seconds / max(attempted, 1), failed,
    )
    return out


def _run_parallel(out, parameters, lons, lats, model_id, spatial, stride,
                  usable, workers) -> None:
    """Spread the cells over processes and reassemble the bands.

    Bands rather than individual cells: a task per cell would spend more time
    in the queue than in the forecast.
    """
    from concurrent.futures import ProcessPoolExecutor

    ny = parameters.shape[0]
    rows = list(range(0, ny, stride))
    # Enough bands to keep every worker busy to the end, without making them
    # so small that the per-task overhead shows.
    band = max(1, len(rows) // (workers * 4))
    tasks = []
    for start in range(0, len(rows), band):
        chunk = rows[start:start + band]
        tasks.append((chunk, stride, usable[chunk]))

    attempted = produced = failed = 0
    with ProcessPoolExecutor(
        max_workers=workers, initializer=_init_worker,
        initargs=(parameters, lons, lats, model_id, spatial),
    ) as pool:
        for first_row, band_out in pool.map(_forecast_rows, tasks):
            chunk = [r for r in rows if r >= first_row][:band_out[
                "probability"].shape[0]]
            for k, iy in enumerate(chunk):
                out.probability[iy] = band_out["probability"][k]
                out.raw_probability[iy] = band_out["raw_probability"][k]
                out.confidence[iy] = band_out["confidence"][k]
                out.uncertainty[iy] = band_out["uncertainty"][k]
                for name, values in band_out["hazards"].items():
                    field = out.hazards.get(name)
                    if field is None:
                        field = out.hazards.setdefault(
                            name, np.full(parameters.shape, np.nan)
                        )
                    field[iy] = values[k]
            a, p, f = band_out["counts"]
            attempted += a
            produced += p
            failed += f
            out.calibration = band_out["calibration"]
    out.attempted, out.produced, out.failed = attempted, produced, failed
