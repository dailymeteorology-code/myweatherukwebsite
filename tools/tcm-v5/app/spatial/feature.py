"""What a spatial feature is, and what it must carry with it.

Sections 48 and 49. Every spatial quantity in Stage 8 is wrapped in a
`SpatialFeature` that knows four things a bare array does not:

  * its UNITS, because Stage 8 emits physical quantities, not scores
  * its QUALITY, so a degraded diagnostic cannot pass as a sound one
  * its PROVENANCE, so a number can be traced to the field it came from
  * its LINEAGE CLASS, so a forecast cannot quietly become a nowcast

THE UNITS RULE
--------------
Section 1 forbids arbitrary regional multipliers, and the structural defence
against them is that Stage 8 does not produce scores at all. Orographic
ascent is metres per second. Land-sea contrast is kelvin. Distance to coast
is metres. Convergence is per second.

Turning a physical quantity into a 0-1 potential is Stage 5's job, through
its documented `Transfer` anchors -- which already require a stated reason
and a literature reference. Stage 8 deliberately has no scoring machinery of
its own, so there is nowhere for an undocumented weight to hide.

A `SpatialFeature` whose unit is "1" is therefore either a genuine
dimensionless physical number (a Froude number, a direction cosine, a land
fraction) or a flag -- never a rating.

THE LINEAGE RULE
----------------
Sections 45, 46 and 47. A feature declares where its information came from:

    STATIC       time-invariant geography; cannot leak
    FORECAST     an NWP field valid at the forecast time
    ANALYSIS     a model analysis, available only at and before its own time
    OBSERVATION  a real measurement, available only after the fact
    BLENDED      a mixture, which inherits the most restrictive of its parts

`check_forecast_safe` refuses a collection containing OBSERVATION features
when the run is a historical forecast reconstruction. That is what stops
Stage 8 turning TCM into a nowcasting system while it is still being scored
as a forecast model.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np


class Quality(str, Enum):
    """How much of this feature can be believed.

    Ordered worst to best so `min` over a set of inputs gives the quality of
    a derived feature -- a diagnostic is never sounder than its weakest
    input.
    """

    UNAVAILABLE = "unavailable"
    INVALID = "invalid"
    DEGRADED = "degraded"
    GOOD = "good"


_QUALITY_ORDER = {
    Quality.UNAVAILABLE: 0,
    Quality.INVALID: 1,
    Quality.DEGRADED: 2,
    Quality.GOOD: 3,
}


def worst(*qualities: Quality) -> Quality:
    """The quality of a diagnostic built from several inputs."""
    if not qualities:
        return Quality.UNAVAILABLE
    return min(qualities, key=lambda q: _QUALITY_ORDER[q])


class Lineage(str, Enum):
    """Where a feature's information came from, for leakage control."""

    STATIC = "static"
    FORECAST = "forecast"
    ANALYSIS = "analysis"
    OBSERVATION = "observation"
    BLENDED = "blended"


#: Lineages that describe information which did not exist at forecast time.
#: Section 45: these must never enter a historical forecast reconstruction.
RETROSPECTIVE = frozenset({Lineage.OBSERVATION})


def combine_lineage(*lineages: Lineage) -> Lineage:
    """The lineage of something derived from several sources.

    Mixing anything with an observation gives BLENDED, not FORECAST -- the
    result carries the observation's availability constraint whether or not
    the observation dominates it numerically.
    """
    unique = set(lineages)
    if not unique:
        return Lineage.STATIC
    if len(unique) == 1:
        return next(iter(unique))
    if unique <= {Lineage.STATIC, Lineage.FORECAST}:
        return Lineage.FORECAST
    if unique <= {Lineage.STATIC, Lineage.ANALYSIS}:
        return Lineage.ANALYSIS
    return Lineage.BLENDED


@dataclass(frozen=True, slots=True)
class Provenance:
    """Section 49. How a spatial feature came to exist."""

    #: What produced it, e.g. "orographic_ascent".
    method: str
    #: The fields it was computed from, canonical names.
    inputs: tuple[str, ...] = ()
    #: Which model supplied those fields.
    model: str | None = None
    #: The cycle the fields came from.
    run: datetime | None = None
    #: The time the feature describes.
    valid_time: datetime | None = None
    #: Ensemble member, when the source was one.
    member: int | None = None
    #: The spatial scale the calculation used, in metres. None for a
    #: single-cell calculation.
    scale_m: float | None = None
    #: Version of the Stage 8 processing chain, so a stored feature can be
    #: matched to the code that made it.
    processing_version: str = ""
    #: Free text for anything a consumer must know, e.g. that the terrain is
    #: the model's own orography rather than a survey DEM.
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "method": self.method,
            "inputs": list(self.inputs),
            "model": self.model,
            "run": self.run.isoformat() if self.run else None,
            "valid_time": (
                self.valid_time.isoformat() if self.valid_time else None
            ),
            "member": self.member,
            "scale_m": self.scale_m,
            "processing_version": self.processing_version,
            "notes": self.notes or None,
        }


@dataclass(frozen=True, slots=True)
class SpatialFeature:
    """One spatial quantity on the TCM grid, with everything needed to
    interpret it.

    `values` is always a 2-D array on the TCM grid, or None when the feature
    could not be produced. None is the only representation of "unavailable" --
    an array of zeros is a statement that the quantity IS zero everywhere,
    which is a completely different claim and section 52 of Stage 7 already
    forbids the equivalent confusion for probabilities.
    """

    name: str
    values: np.ndarray | None
    unit: str
    quality: Quality
    lineage: Lineage
    provenance: Provenance
    #: Why the feature is degraded, invalid or unavailable. Required in
    #: those cases -- see __post_init__.
    reason: str = ""
    #: Per-cell validity. False where the value must not be used even though
    #: the feature as a whole is sound, e.g. a gradient at the domain edge.
    valid: np.ndarray | None = None
    #: Anything a consumer should be warned about.
    flags: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.values is None and self.quality is not Quality.UNAVAILABLE:
            raise ValueError(
                f"{self.name}: no values, so quality must be UNAVAILABLE, "
                f"not {self.quality.value}"
            )
        if self.values is not None and self.values.ndim != 2:
            raise ValueError(
                f"{self.name}: spatial features are 2-D on the TCM grid, "
                f"got shape {self.values.shape}"
            )
        if (
            self.valid is not None and self.values is not None
            and self.valid.shape != self.values.shape
        ):
            raise ValueError(
                f"{self.name}: validity mask {self.valid.shape} does not "
                f"match values {self.values.shape}"
            )
        if self.quality is not Quality.GOOD and not self.reason:
            raise ValueError(
                f"{self.name} is {self.quality.value} and must say why. A "
                f"consumer cannot judge a degraded diagnostic without "
                f"knowing what degraded it"
            )

    @property
    def available(self) -> bool:
        return self.values is not None

    @property
    def usable(self) -> bool:
        """Sound enough to compute with. INVALID is not."""
        return self.values is not None and self.quality in (
            Quality.GOOD, Quality.DEGRADED
        )

    def masked(self) -> np.ndarray | None:
        """Values with invalid cells set to NaN.

        Use this rather than `values` wherever a calculation would otherwise
        silently consume an edge artefact.
        """
        if self.values is None:
            return None
        if self.valid is None:
            return self.values
        return np.where(self.valid, self.values, np.nan)

    def at(self, iy: int, ix: int) -> float | None:
        """One cell, or None if it is unavailable or invalid there."""
        if self.values is None:
            return None
        if self.valid is not None and not bool(self.valid[iy, ix]):
            return None
        value = float(self.values[iy, ix])
        return value if np.isfinite(value) else None

    def summary(self) -> dict:
        """Statistics, without shipping the whole array."""
        out: dict = {
            "feature": self.name,
            "unit": self.unit,
            "quality": self.quality.value,
            "lineage": self.lineage.value,
            "available": self.available,
            "reason": self.reason or None,
            "flags": list(self.flags),
            "provenance": self.provenance.to_dict(),
        }
        values = self.masked()
        if values is None:
            return out
        finite = values[np.isfinite(values)]
        if finite.size == 0:
            out["statistics"] = None
            return out
        out["statistics"] = {
            "min": float(np.min(finite)),
            "max": float(np.max(finite)),
            "mean": float(np.mean(finite)),
            "valid_cells": int(finite.size),
            "total_cells": int(values.size),
        }
        return out


def unavailable(
    name: str, unit: str, reason: str, *, method: str = "",
    inputs: tuple[str, ...] = (), **provenance_kwargs,
) -> SpatialFeature:
    """A feature that could not be produced, and says why.

    Every Stage 8 calculation returns one of these rather than raising or
    returning zeros, so a missing input degrades one diagnostic instead of
    failing a whole grid.
    """
    return SpatialFeature(
        name=name, values=None, unit=unit,
        quality=Quality.UNAVAILABLE, lineage=Lineage.STATIC,
        provenance=Provenance(
            method=method or name, inputs=inputs, **provenance_kwargs
        ),
        reason=reason,
    )


def check_forecast_safe(
    features: dict[str, SpatialFeature], *, allow_observations: bool = False
) -> list[str]:
    """Section 45. Names of features that could not exist at forecast time.

    Returns an empty list for a clean set. `allow_observations` is for live
    operational use where real-time observations genuinely ARE available;
    it must stay False for any historical reconstruction or backtest, and
    the backtest harness asserts that.
    """
    if allow_observations:
        return []
    return sorted(
        name for name, f in features.items()
        if f.lineage in RETROSPECTIVE
        or (
            f.lineage is Lineage.BLENDED
            and "observation" in f.provenance.notes.lower()
        )
    )
