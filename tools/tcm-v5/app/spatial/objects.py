"""Boundaries and structures as objects, and tracking them through time.

Steps 7 and 10 of the Stage 8 order, sections 30, 31, 37, 65 and 66.

Section 30 asks for boundaries to be more than a per-cell flag, and the
reason is in the questions downstream systems actually want to ask:

    how far is the nearest convergence line?
    which way is it oriented relative to the shear?
    is it moving towards me or away?

None of those can be answered by "boundary present: yes/no". They need the
structure to exist as a THING with a position, an orientation, a length and
a motion. So connected regions of a detection mask are turned into objects
with geometry, and distance-to-nearest-object fields are derived from them.

ORIENTATION FROM MOMENTS, NOT FROM A FITTED LINE
------------------------------------------------
A boundary's orientation is the principal axis of its pixel distribution --
the eigenvector of the second-moment (covariance) matrix with the larger
eigenvalue. This handles curved and branching structures gracefully, where
fitting a straight line does not, and the eigenvalue ratio comes free: it
says how ELONGATED the object is, which is what separates a line from a
blob. A convergence blob is not a convergence line and should not be
reported as one.

TRACKING WITHOUT LOOKING FORWARD
--------------------------------
Section 65 ends with the constraint that matters most: tracking must not use
future observations when building forecast-time features. `track` therefore
only ever matches a set of objects to objects from an EARLIER time, and
motion is estimated backwards -- where did this come from -- never forwards
from where it will be. A tracker that peeks at the next frame produces
beautiful trajectories and leaks the answer.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta

import numpy as np

from .boundaries import BoundaryType

log = logging.getLogger(__name__)

#: Below this eigenvalue ratio a structure is a blob, not a line, and its
#: orientation means nothing. 2.0 says the long axis is at least twice the
#: short one -- the weakest statement that still distinguishes the two.
MIN_ELONGATION = 2.0

#: Objects smaller than this are noise on a 2 km grid: a "line" needs to be
#: long enough to be a line. 5 cells is 10 km, the effective resolution of
#: the model -- a structure shorter than that is not resolved.
MIN_OBJECT_CELLS = 5

#: How far an object may move between two times and still be considered the
#: same object, as a speed. 30 m/s is faster than any UK mesoscale boundary
#: propagates and is a physical bound, not a tuning parameter -- a match
#: implying a faster motion is a mis-association.
MAX_MATCH_SPEED_MS = 30.0


@dataclass(slots=True)
class SpatialObject:
    """One coherent environmental structure. Section 37."""

    #: Stable identity across times, assigned by the tracker.
    object_id: int
    kind: BoundaryType
    #: Centroid in grid indices (row, col) and in lon/lat when known.
    centroid_rc: tuple[float, float]
    centroid_lonlat: tuple[float, float] | None
    #: Number of grid cells, and the area they cover.
    n_cells: int
    area_km2: float
    #: Principal-axis bearing, degrees from north, folded to 0-180.
    orientation: float
    #: Extent along and across the principal axis, metres.
    length_m: float
    width_m: float
    #: Ratio of the two, dimensionless. High is a line, near 1 is a blob.
    elongation: float
    #: Mean and peak of whatever field the object was detected in, in that
    #: field's own units.
    mean_intensity: float
    peak_intensity: float
    intensity_unit: str
    #: How much evidence supports it, 0-1. Derived from the number of
    #: agreeing evidence types, NOT from the intensity: a strong gradient
    #: seen by one field is less trustworthy than a modest one seen by four.
    confidence: float
    valid_time: datetime | None = None
    #: Motion, filled by the tracker. m/s and degrees TOWARDS.
    speed_ms: float | None = None
    bearing: float | None = None
    #: How many consecutive times this object has been tracked.
    persistence: int = 1
    #: The cells it occupies, for distance fields and rendering.
    mask: np.ndarray | None = None
    source_fields: tuple[str, ...] = ()

    @property
    def is_line(self) -> bool:
        return self.elongation >= MIN_ELONGATION

    def to_dict(self, *, include_mask: bool = False) -> dict:
        out = {
            "object_id": self.object_id,
            "type": self.kind.value,
            "centroid": {
                "row": round(self.centroid_rc[0], 2),
                "col": round(self.centroid_rc[1], 2),
                "lon": (
                    round(self.centroid_lonlat[0], 4)
                    if self.centroid_lonlat else None
                ),
                "lat": (
                    round(self.centroid_lonlat[1], 4)
                    if self.centroid_lonlat else None
                ),
            },
            "area_km2": round(self.area_km2, 1),
            "n_cells": self.n_cells,
            "orientation_deg": (
                round(self.orientation, 1) if self.is_line else None
            ),
            "length_km": round(self.length_m / 1000.0, 1),
            "width_km": round(self.width_m / 1000.0, 1),
            "elongation": round(self.elongation, 2),
            "is_line": self.is_line,
            "intensity": {
                "mean": float(f"{self.mean_intensity:.6g}"),
                "peak": float(f"{self.peak_intensity:.6g}"),
                "unit": self.intensity_unit,
            },
            "confidence": round(self.confidence, 3),
            "valid_time": (
                self.valid_time.isoformat() if self.valid_time else None
            ),
            "motion": (
                None if self.speed_ms is None
                else {
                    "speed_ms": round(self.speed_ms, 2),
                    "bearing_deg": (
                        round(self.bearing, 1) if self.bearing is not None
                        else None
                    ),
                }
            ),
            "persistence": self.persistence,
            "source_fields": list(self.source_fields),
        }
        if include_mask and self.mask is not None:
            out["cells"] = int(self.mask.sum())
        return out


def extract(
    mask: np.ndarray, intensity: np.ndarray, kind: BoundaryType, *,
    spacing_m: float, intensity_unit: str,
    agreement: np.ndarray | None = None,
    max_evidence: int = 1,
    lonlat: tuple[np.ndarray, np.ndarray] | None = None,
    valid_time: datetime | None = None,
    source_fields: tuple[str, ...] = (),
    min_cells: int = MIN_OBJECT_CELLS,
    lines_only: bool = False,
    min_length_m: float | None = None,
) -> list[SpatialObject]:
    """Turn a detection mask into objects with geometry.

    `lines_only` drops structures that are not elongated, and `min_length_m`
    drops those too short to matter. A convergence BLOB is not a convergence
    LINE, and a 6 km streak is not a boundary storms can organise along.
    Without both, the live grid produced 2,055 "convergence lines", most of
    them a handful of cells of finite-difference texture.

    `agreement` is the count of independent evidence types at each cell; it
    becomes the object's confidence. Confidence is deliberately NOT taken
    from intensity -- a sharp gradient seen by one field alone is a weaker
    claim than a modest one that temperature, moisture, wind and
    frontogenesis all agree on.
    """
    from scipy.ndimage import label

    structure = np.ones((3, 3), dtype=bool)
    labels, n = label(np.asarray(mask, dtype=bool), structure=structure)
    if n == 0:
        return []

    cell_km2 = (spacing_m / 1000.0) ** 2
    out: list[SpatialObject] = []
    for index in range(1, n + 1):
        cells = labels == index
        count = int(cells.sum())
        if count < min_cells:
            continue

        rows, cols = np.nonzero(cells)
        cy, cx = float(rows.mean()), float(cols.mean())

        orientation, length, width, elongation = _principal_axes(
            rows, cols, spacing_m
        )

        values = np.asarray(intensity)[cells]
        finite = values[np.isfinite(values)]
        mean_i = float(finite.mean()) if finite.size else float("nan")
        peak_i = float(np.max(np.abs(finite))) if finite.size else float("nan")

        if agreement is None or max_evidence <= 1:
            confidence = 0.5
        else:
            support = float(np.asarray(agreement)[cells].mean())
            confidence = min(1.0, support / float(max_evidence))

        centroid_ll = None
        if lonlat is not None:
            lons, lats = lonlat
            iy, ix = int(round(cy)), int(round(cx))
            iy = min(max(iy, 0), lons.shape[0] - 1)
            ix = min(max(ix, 0), lons.shape[1] - 1)
            centroid_ll = (float(lons[iy, ix]), float(lats[iy, ix]))

        if lines_only and elongation < MIN_ELONGATION:
            continue
        if min_length_m is not None and length < min_length_m:
            continue

        out.append(SpatialObject(
            object_id=-1, kind=kind, centroid_rc=(cy, cx),
            centroid_lonlat=centroid_ll, n_cells=count,
            area_km2=count * cell_km2, orientation=orientation,
            length_m=length, width_m=width, elongation=elongation,
            mean_intensity=mean_i, peak_intensity=peak_i,
            intensity_unit=intensity_unit, confidence=confidence,
            valid_time=valid_time, mask=cells, source_fields=source_fields,
        ))

    out.sort(key=lambda o: o.area_km2, reverse=True)
    return out


def _principal_axes(
    rows: np.ndarray, cols: np.ndarray, spacing_m: float
) -> tuple[float, float, float, float]:
    """Orientation, length, width and elongation from second moments."""
    if rows.size < 2:
        return float("nan"), spacing_m, spacing_m, 1.0

    y = (rows - rows.mean()) * spacing_m
    x = (cols - cols.mean()) * spacing_m
    cov = np.cov(np.vstack([x, y]))
    if not np.all(np.isfinite(cov)):
        return float("nan"), spacing_m, spacing_m, 1.0

    values, vectors = np.linalg.eigh(cov)
    order = np.argsort(values)[::-1]
    values = values[order]
    major = vectors[:, order[0]]

    # Extent along each axis. For a uniform strip the standard deviation is
    # length/sqrt(12), so the factor recovers the full extent rather than
    # reporting a quarter of it.
    length = float(np.sqrt(max(values[0], 0.0)) * np.sqrt(12.0))
    width = float(np.sqrt(max(values[1], 0.0)) * np.sqrt(12.0))
    length = max(length, spacing_m)
    width = max(width, spacing_m)

    # major is (x, y) = (east, north); bearing is atan2(east, north).
    bearing = float(np.degrees(np.arctan2(major[0], major[1])) % 180.0)
    elongation = length / width if width > 0 else 1.0
    return bearing, length, width, elongation


def distance_to_nearest(
    objects: list[SpatialObject], shape: tuple[int, int], spacing_m: float
) -> np.ndarray:
    """Distance from every cell to the nearest object, metres.

    This is what section 38 asks for: "distance to nearest convergence line"
    as a continuous field rather than a binary mask. Infinite where there
    are no objects of that kind at all -- which is the honest answer, and
    distinguishable from "very far", unlike a large sentinel number.
    """
    from scipy.ndimage import distance_transform_edt

    if not objects:
        return np.full(shape, np.inf)
    occupied = np.zeros(shape, dtype=bool)
    for obj in objects:
        if obj.mask is not None:
            occupied |= obj.mask
    if not occupied.any():
        return np.full(shape, np.inf)
    return distance_transform_edt(~occupied, sampling=spacing_m)


def orientation_to_flow(
    objects: list[SpatialObject], u: np.ndarray, v: np.ndarray,
    shape: tuple[int, int],
) -> np.ndarray:
    """|sin| of the angle between the nearest object and the flow, 0-1.

    1 means the flow crosses the boundary at right angles, which is the
    configuration that lifts air over it. 0 means the flow runs along it,
    which advects parcels down the line instead -- the difference between a
    boundary that initiates convection and one that merely organises it.
    """
    out = np.full(shape, np.nan)
    if not objects:
        return out
    for obj in objects:
        if obj.mask is None or not obj.is_line:
            continue
        angle = np.radians(obj.orientation)
        ox, oy = np.sin(angle), np.cos(angle)
        speed = np.hypot(u, v)
        with np.errstate(invalid="ignore", divide="ignore"):
            along = np.where(
                speed > 1e-9, (u * ox + v * oy) / np.maximum(speed, 1e-9), np.nan
            )
        out = np.where(obj.mask, np.sqrt(np.maximum(1.0 - along**2, 0.0)), out)
    return out


# --------------------------------------------------------------------------
# Tracking -- section 65
# --------------------------------------------------------------------------

@dataclass(slots=True)
class Tracker:
    """Assigns stable identities to objects across successive times.

    Deliberately one-directional. `update` may only be called with times in
    increasing order, and matching only ever looks BACKWARD at objects
    already seen. Section 65's closing constraint -- do not use future
    observations when retrospectively generating forecast-time features --
    is therefore structural: there is no code path that can see forward.
    """

    spacing_m: float
    _next_id: int = 1
    _previous: list[SpatialObject] = dc_field(default_factory=list)
    _previous_time: datetime | None = None

    def update(
        self, objects: list[SpatialObject], valid_time: datetime
    ) -> list[SpatialObject]:
        """Assign identities and motion to a new set of objects."""
        if self._previous_time is not None and valid_time < self._previous_time:
            raise ValueError(
                f"tracking must run forward in time: {valid_time} precedes "
                f"the previous update at {self._previous_time}. Matching "
                f"backwards would let a later state inform an earlier one"
            )

        gap = (
            (valid_time - self._previous_time).total_seconds()
            if self._previous_time else None
        )
        max_distance = (
            MAX_MATCH_SPEED_MS * gap if gap and gap > 0 else 0.0
        )

        unmatched = list(self._previous)
        for obj in objects:
            obj.valid_time = valid_time
            best, best_cost = None, np.inf
            for candidate in unmatched:
                if candidate.kind is not obj.kind:
                    continue
                dy = (obj.centroid_rc[0] - candidate.centroid_rc[0]) * self.spacing_m
                dx = (obj.centroid_rc[1] - candidate.centroid_rc[1]) * self.spacing_m
                distance = float(np.hypot(dx, dy))
                if max_distance <= 0 or distance > max_distance:
                    continue
                # Prefer the nearest candidate of similar size: a small blob
                # next to a long line is not the same object even if their
                # centroids nearly coincide.
                ratio = (
                    min(obj.area_km2, candidate.area_km2)
                    / max(obj.area_km2, candidate.area_km2, 1e-9)
                )
                cost = distance / max(ratio, 1e-3)
                if cost < best_cost:
                    best, best_cost = candidate, cost

            if best is None:
                obj.object_id = self._next_id
                self._next_id += 1
                obj.persistence = 1
                obj.speed_ms = None
                obj.bearing = None
            else:
                obj.object_id = best.object_id
                obj.persistence = best.persistence + 1
                dy = (obj.centroid_rc[0] - best.centroid_rc[0]) * self.spacing_m
                dx = (obj.centroid_rc[1] - best.centroid_rc[1]) * self.spacing_m
                if gap and gap > 0:
                    obj.speed_ms = float(np.hypot(dx, dy) / gap)
                    obj.bearing = float(
                        np.degrees(np.arctan2(dx, dy)) % 360.0
                    )
                unmatched.remove(best)

        self._previous = list(objects)
        self._previous_time = valid_time
        return objects

    def reset(self) -> None:
        self._previous = []
        self._previous_time = None
