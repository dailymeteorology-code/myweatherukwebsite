"""Matching forecasts to observations in space and time.

Step 4 of the Stage 9 order, sections 11, 12, 13, 60, 80 and 93.

Section 11 calls this one of the most important components in the stage, and
the reason is that every way of getting it wrong produces a plausible number
rather than an error. A forecast for 15 UTC scored against 16 UTC
observations still yields a Brier score. It is simply the wrong one.

THE EVENT DEFINITION IS NOT REDEFINED HERE
------------------------------------------
Section 14 requires the verification target to match the event Stage 7
already established, so this module IMPORTS it rather than restating it:

    at least one lightning flash within 10 km of the cell centre during a
    one-hour window

Restating it would create two definitions that could drift apart, and a
verification measuring a different event from the one forecast is worse than
no verification.

THE THREE-VALUED OBSERVED FIELD
-------------------------------
An observed grid is not a boolean. Every cell is one of:

    True     a flash was detected within the radius
    False    no flash, and the hour was observed well enough to say so
    None     the hour was not observed well enough to say anything

The third value is what `observations.py` computes and it must survive to
here. Collapsing it to False is the single mistake that would most inflate
apparent skill, because the domain is quiet almost everywhere almost always.

EVENTS ARE NOT INDEPENDENT SAMPLES
----------------------------------
Section 60. One outbreak covering 40,000 grid cells across four hours is not
160,000 independent forecast cases; it is one outbreak. `effective_sample`
estimates how many independent cases a matched set really contains, from the
spatial correlation length of the observed field, and every metric reports
it alongside the raw count.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone
from enum import Enum

import numpy as np

from .observations import ObsQuality, ObservedHour

log = logging.getLogger(__name__)

MATCHING_VERSION = "stage9.1"


class SpatialMethod(str, Enum):
    """Section 13's methods. The choice must match the forecast task."""

    #: The observation's own cell only. Punishes a storm displaced one cell
    #: as hard as one displaced a thousand kilometres.
    EXACT = "exact_grid"
    #: Event radius around each cell -- the Stage 7 definition.
    NEIGHBOURHOOD = "neighbourhood"
    #: Nearest grid cell to a point observation.
    POINT_TO_GRID = "point_to_grid"


class TemporalMethod(str, Enum):
    """Section 12's definitions."""

    #: The forecast hour exactly. What the Stage 7 event means.
    WINDOW = "valid_hour_window"
    #: A tolerance either side, for timing-error analysis.
    TOLERANT = "window_with_tolerance"


@dataclass(frozen=True, slots=True)
class MatchPolicy:
    """How a forecast is paired with an observation, recorded with results.

    Section 58 requires a verification result to record its matching
    methods, so this object is stored rather than assumed.
    """

    spatial: SpatialMethod = SpatialMethod.NEIGHBOURHOOD
    temporal: TemporalMethod = TemporalMethod.WINDOW
    #: Event radius, metres. Defaults to the Stage 7 event definition.
    radius_m: float = 10_000.0
    #: Tolerance either side of the valid hour, only for TOLERANT.
    tolerance_hours: float = 0.0
    version: str = MATCHING_VERSION

    def to_dict(self) -> dict:
        return {
            "spatial_method": self.spatial.value,
            "temporal_method": self.temporal.value,
            "radius_m": self.radius_m,
            "tolerance_hours": self.tolerance_hours,
            "version": self.version,
        }


@dataclass(slots=True)
class MatchedField:
    """A forecast grid paired with an observed grid for one valid time."""

    valid_time: datetime
    #: Forecast probabilities, shape (ny, nx). NaN where unavailable.
    forecast: np.ndarray
    #: Observed occurrence: 1.0, 0.0, or NaN for "not observed".
    observed: np.ndarray
    #: True where BOTH the forecast and the observation are usable.
    usable: np.ndarray
    policy: MatchPolicy
    observation_quality: ObsQuality
    coverage: float
    flash_count: int
    notes: list[str] = dc_field(default_factory=list)

    @property
    def n_usable(self) -> int:
        return int(self.usable.sum())

    @property
    def n_events(self) -> int:
        return int(np.nansum(np.where(self.usable, self.observed, 0.0)))

    def pairs(self) -> tuple[np.ndarray, np.ndarray]:
        """Flat forecast/observed arrays over usable cells only."""
        return (
            self.forecast[self.usable].astype("float64"),
            self.observed[self.usable].astype("float64"),
        )

    def to_dict(self) -> dict:
        return {
            "valid_time": self.valid_time.isoformat(),
            "usable_cells": self.n_usable,
            "total_cells": int(self.forecast.size),
            "observed_events": self.n_events,
            "base_rate": (
                round(self.n_events / self.n_usable, 6)
                if self.n_usable else None
            ),
            "observation_quality": self.observation_quality.value,
            "coverage": round(self.coverage, 4),
            "flashes": self.flash_count,
            "policy": self.policy.to_dict(),
            "notes": self.notes,
        }


def observed_grid(
    hour: ObservedHour, lons: np.ndarray, lats: np.ndarray, *,
    policy: MatchPolicy | None = None,
) -> tuple[np.ndarray, list[str]]:
    """Turn detected flashes into a three-valued observed occurrence grid.

    Returns 1.0 where a flash fell within the event radius, 0.0 where none
    did AND the hour was observed well enough to say so, and NaN where the
    hour was not observed. See the module docstring on why the third value
    must survive.
    """
    policy = policy or MatchPolicy()
    notes: list[str] = []

    if hour.event_observed is None:
        notes.append(
            f"{hour.valid_time:%Y-%m-%d %HZ} is not usable: {hour.reason}"
        )
        return np.full(lons.shape, np.nan), notes

    grid = np.zeros(lons.shape, dtype="float64")
    if not hour.strikes:
        return grid, notes

    # Mark the cell each flash fell in, then dilate by the event radius.
    # Dilating a mask is far cheaper than a distance calculation from every
    # flash to every cell, and gives the same answer for a fixed radius.
    from scipy.ndimage import binary_dilation

    seeds = np.zeros(lons.shape, dtype=bool)
    flat_lon = lons.ravel()
    flat_lat = lats.ravel()
    for strike in hour.strikes:
        # Nearest cell by squared degrees, with a cosine correction so that
        # a degree of longitude is not treated as a degree of latitude at
        # 55 N, where it is 57% as long.
        scale = float(np.cos(np.radians(strike.lat)))
        d2 = (
            ((flat_lon - strike.lon) * scale) ** 2
            + (flat_lat - strike.lat) ** 2
        )
        index = int(np.argmin(d2))
        iy, ix = np.unravel_index(index, lons.shape)
        seeds[iy, ix] = True

    if policy.spatial is SpatialMethod.EXACT:
        grid[seeds] = 1.0
        return grid, notes

    spacing = _grid_spacing_m(lons, lats)
    cells = max(1, int(round(policy.radius_m / spacing)))
    yy, xx = np.mgrid[-cells:cells + 1, -cells:cells + 1]
    disc = (xx * xx + yy * yy) <= cells * cells
    grid[binary_dilation(seeds, structure=disc)] = 1.0
    return grid, notes


def _grid_spacing_m(lons: np.ndarray, lats: np.ndarray) -> float:
    """Approximate spacing of a lon/lat mesh, in metres."""
    if lons.shape[1] < 2:
        return 2000.0
    mid = lons.shape[0] // 2
    dlon = float(np.abs(lons[mid, 1] - lons[mid, 0]))
    scale = float(np.cos(np.radians(lats[mid, 0])))
    return max(dlon * scale * 111_320.0, 1.0)


def match(
    forecast: np.ndarray, hour: ObservedHour,
    lons: np.ndarray, lats: np.ndarray, *,
    policy: MatchPolicy | None = None,
    forecast_valid_time: datetime | None = None,
) -> MatchedField:
    """Pair one forecast grid with one observed hour.

    Raises if the times do not correspond under the policy. Section 11 is
    explicit that a 15 UTC forecast must not be compared with 16 UTC
    observations, and silently allowing it would produce a number rather
    than a complaint.
    """
    policy = policy or MatchPolicy()
    forecast = np.asarray(forecast, dtype="float64")
    if forecast.shape != lons.shape:
        raise ValueError(
            f"forecast grid {forecast.shape} does not match the coordinate "
            f"mesh {lons.shape}"
        )

    if forecast_valid_time is not None:
        gap = abs(
            (forecast_valid_time - hour.valid_time).total_seconds()
        ) / 3600.0
        allowed = (
            policy.tolerance_hours
            if policy.temporal is TemporalMethod.TOLERANT else 0.0
        )
        if gap > allowed + 1e-6:
            raise ValueError(
                f"forecast valid {forecast_valid_time:%Y-%m-%d %H:%MZ} "
                f"cannot verify against observations for "
                f"{hour.valid_time:%Y-%m-%d %HZ}: {gap:.1f} h apart, "
                f"tolerance {allowed:.1f} h"
            )

    observed, notes = observed_grid(hour, lons, lats, policy=policy)
    usable = np.isfinite(forecast) & np.isfinite(observed)

    if hour.quality is ObsQuality.DEGRADED:
        notes.append(
            f"observation quality is degraded: {hour.reason}. Occurrence is "
            f"still trustworthy; flash COUNTS are undercounts"
        )
    if not usable.any():
        notes.append(
            "no cell has both a forecast and a usable observation, so "
            "nothing can be scored for this hour"
        )

    return MatchedField(
        valid_time=hour.valid_time, forecast=forecast, observed=observed,
        usable=usable, policy=policy, observation_quality=hour.quality,
        coverage=hour.coverage, flash_count=hour.count, notes=notes,
    )


# --------------------------------------------------------------------------
# Section 60 -- how many independent cases is this really?
# --------------------------------------------------------------------------

def correlation_length_cells(field: np.ndarray, max_lag: int = 40) -> float:
    """Distance in cells over which the observed field decorrelates.

    Estimated from the field's own spatial autocorrelation along both axes:
    the lag at which correlation first falls below 1/e. A field of isolated
    single cells decorrelates in one lag; a field containing one large
    contiguous outbreak takes many, and that is exactly the difference
    section 60 is about.
    """
    values = np.asarray(field, dtype="float64")
    finite = np.isfinite(values)
    if finite.sum() < 4:
        return 1.0
    filled = np.where(finite, values, np.nanmean(values[finite]))
    anomaly = filled - filled.mean()
    denominator = float((anomaly * anomaly).sum())
    if denominator <= 0:
        return 1.0

    def first_crossing(axis: int) -> float:
        limit = min(max_lag, values.shape[axis] - 1)
        for lag in range(1, limit + 1):
            if axis == 0:
                product = anomaly[lag:, :] * anomaly[:-lag, :]
            else:
                product = anomaly[:, lag:] * anomaly[:, :-lag]
            correlation = float(product.sum()) / denominator
            if correlation < np.exp(-1.0):
                return float(lag)
        return float(limit)

    return max(1.0, 0.5 * (first_crossing(0) + first_crossing(1)))


def effective_sample(fields: list[MatchedField]) -> dict:
    """How many independent forecast cases a matched set really contains.

    Two reductions, both from section 60:

      * SPATIALLY, cells within one correlation length of each other are
        not independent. The effective count is the usable cell count
        divided by the area of one correlation patch.

      * TEMPORALLY, consecutive hours of one outbreak are not independent
        cases either. Hours are grouped into episodes separated by at least
        one quiet or unobserved hour, and the episode count is reported as
        the number of genuinely independent weather situations.

    Reporting a Brier score over 1.16 million cells as though it rested on
    1.16 million cases is the specific overstatement this prevents.
    """
    if not fields:
        return {"raw_cells": 0, "effective_cells": 0.0, "episodes": 0,
                "independent_events": 0}

    raw = sum(f.n_usable for f in fields)
    effective = 0.0
    lengths: list[float] = []
    for field in fields:
        if field.n_usable == 0:
            continue
        length = correlation_length_cells(
            np.where(field.usable, field.observed, np.nan)
        )
        lengths.append(length)
        patch = max(1.0, np.pi * length * length)
        effective += field.n_usable / patch

    # Episodes: runs of consecutive hours that all contain events.
    ordered = sorted(fields, key=lambda f: f.valid_time)
    episodes = 0
    in_episode = False
    for field in ordered:
        active = field.n_events > 0
        if active and not in_episode:
            episodes += 1
        in_episode = active

    clusters = sum(event_clusters(f) for f in fields)

    return {
        "raw_cells": raw,
        "raw_events": sum(f.n_events for f in fields),
        "effective_cells": round(effective, 1),
        "independent_events": clusters,
        "reduction_factor": (
            round(raw / effective, 1) if effective > 0 else None
        ),
        "mean_correlation_length_cells": (
            round(float(np.mean(lengths)), 2) if lengths else None
        ),
        "hours": len(fields),
        "episodes": episodes,
        "note": (
            "cells within one correlation length are not independent, and "
            "consecutive hours of one outbreak are not independent cases. "
            "A confidence interval computed from the raw cell count would "
            "be far too narrow"
        ),
        "rare_event_note": (
            "`effective_cells` is estimated from the correlation length of "
            "the observed field, and on a quiet day that field is almost "
            "all zeros and decorrelates in a single cell -- giving a very "
            "large effective count for a day on which almost nothing "
            "happened. For a RARE event the independent unit is the storm "
            "cluster, not the cell, and `independent_events` counts those. "
            "Read that number, not the cell count, when judging whether a "
            "score means anything"
        ),
    }


def event_clusters(field: MatchedField) -> int:
    """How many spatially separate storm areas this hour contains.

    Connected components of the observed occurrence field. One outbreak
    covering 9,000 cells is one cluster, not 9,000 cases, and for a rare
    event this is the count that governs whether a score is meaningful.
    """
    from scipy.ndimage import label

    occurred = np.where(field.usable, field.observed, 0.0) > 0.5
    if not occurred.any():
        return 0
    _, n = label(occurred, structure=np.ones((3, 3), dtype=bool))
    return int(n)


def align(
    forecasts: dict[datetime, np.ndarray], hours: list[ObservedHour],
    lons: np.ndarray, lats: np.ndarray, *,
    policy: MatchPolicy | None = None,
) -> tuple[list[MatchedField], list[str]]:
    """Match a set of forecasts to a set of observed hours.

    Only pairs that correspond in time are returned; the rest are reported
    as skipped, with the reason. A forecast with no observation and an
    observation with no forecast are both normal and neither is an error.
    """
    policy = policy or MatchPolicy()
    by_hour = {h.valid_time: h for h in hours}
    matched: list[MatchedField] = []
    skipped: list[str] = []

    for valid_time, grid in sorted(forecasts.items()):
        key = valid_time.astimezone(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        )
        hour = by_hour.get(key)
        if hour is None:
            skipped.append(
                f"{key:%Y-%m-%d %HZ}: forecast exists but no observation "
                f"was archived for that hour"
            )
            continue
        if hour.event_observed is None:
            skipped.append(
                f"{key:%Y-%m-%d %HZ}: {hour.reason}"
            )
            continue
        matched.append(match(
            grid, hour, lons, lats, policy=policy,
            forecast_valid_time=valid_time,
        ))

    log.info(
        "matched %d forecast hours, skipped %d", len(matched), len(skipped)
    )
    return matched, skipped
