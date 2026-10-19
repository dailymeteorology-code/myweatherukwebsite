"""Categorical outlook polygons, in the style of an SPC convective outlook.

The raster map answers "what is the index at this cell". A categorical
outlook answers a different question: "which AREA is at which category" --
drawn as a small number of nested polygons with definite edges, the way the
Storm Prediction Center draws a Day 1, and the way a forecaster would draw it
by hand.

That is a genuinely different product from the raster, not a restyling of it:

  * it is **vector**, so it stays crisp at any zoom, can be labelled, and can
    be exported into a graphic;
  * it is **nested** -- the moderate area sits inside the slight area, which
    sits inside the marginal area -- which is what makes the categories
    readable at a glance;
  * it is **generalised**, because a boundary drawn to the nearest 2 km cell
    implies placement accuracy no convective forecast has.

Three rules govern it.

**The whole model output, sea included.** Convection over the Irish Sea, the
Channel and the southern North Sea is real, moves ashore, and is most of what
a UK convective outlook is about -- so the polygons cover the full field and
are not clipped to land.

An earlier version clipped to the union of the named region boxes. Those
boxes are hand-drawn and did not tile: south-west England stopped at 2.4 W
and south-east England began at 1.2 W, leaving a rectangular hole over
Gloucester, Bath, Salisbury, Southampton, Winchester and Oxford that showed
up on the map as a grey block of no data. The boxes are now gapless, but the
outlook no longer depends on them at all.

**It ENCLOSES the risk rather than being a subset of it.** This is the
opposite of the rule the simplified raster follows, and deliberately so. An
outlook polygon is a boundary drawn AROUND an area; if generalising it were
allowed only to remove cells, the smoothing would eat the peak -- the first
attempt did exactly that, reporting a day whose headline was HIGH as a
Slight area, because smoothing a 70 surrounded by 20s gives 30. So each
category is traced from a MASK of the raw field, and the generalisation
closes gaps and rounds corners rather than lowering values. The guarantee is
containment: every contiguous area the raw field puts at a category is
inside that category's polygon.

**A category that cannot be drawn is absent, not empty.** Areas below the
minimum are dropped ON THE MASK, before contouring -- dropping them after
produced 1,222 discarded slivers from a single day, which is a sign of
generalising the wrong thing.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .risk import RISK_BANDS

log = logging.getLogger(__name__)

#: Gaussian smoothing of the category MASK, in grid cells. The TCM grid is
#: 2 km, so 12 cells is a 24 km sigma. Deliberately broad: a categorical
#: outlook is a hand-drawn-looking product, and at 10 km the boundaries still
#: carried the wobble of individual showers, which implies placement accuracy
#: no convective forecast has.
#: Blurring a binary mask and re-cutting at a half SHRINKS a small or convex
#: area, and at 12 cells it erased anything under roughly its own kernel --
#: which is far larger than MIN_AREA_CELLS, so areas that passed the size
#: filter then vanished silently. The line is rounded by Chaikin instead, and
#: the blur only has to remove cell-scale wobble.
SMOOTH_CELLS = 7.0

#: Dilation before blurring, in cells, to give back what the blur takes off.
#: Roughly half the smoothing radius, which keeps the enclosed area close to
#: the raw one instead of eating into it.
DILATE_CELLS = 3

#: Corner-cutting passes over each traced ring. Gaussian smoothing rounds the
#: AREA; Chaikin rounds the LINE, removing the last of the staircase left by
#: tracing a boundary across square cells. Two passes is enough; more starts
#: visibly shrinking tight bends.
CHAIKIN_PASSES = 3

#: Douglas-Peucker tolerance in degrees, applied BEFORE corner-cutting so
#: there are fewer vertices to round. 0.02 deg is under 2 km.
SIMPLIFY_DEGREES = 0.02

#: Smallest area kept, in grid cells, applied to the MASK before contouring.
#: 100 cells at 2 km is 400 km2 -- about an English county, the finest area a
#: categorical outlook can honestly delineate.
MIN_AREA_CELLS = 100

#: Structuring element for closing gaps, in grid cells (about 30 km).
CLOSE_CELLS = 15

#: Smallest ring kept after tracing, in square degrees. A backstop only: the
#: real filtering happens on the mask.
MIN_AREA_SQ_DEG = 0.004

#: Fill colours, matching the raster legend so the two products cannot
#: disagree about what a category looks like.
BAND_COLOURS: dict[str, str] = {
    "very_low": "#78be78",
    "low": "#c8d96a",
    "marginal": "#f5dc5a",
    "slight": "#f0b429",
    "moderate": "#f09632",
    "high": "#dc3c28",
    "severe": "#8f1a12",
}


@dataclass(frozen=True, slots=True)
class Category:
    name: str
    minimum: float
    label: str

    @property
    def colour(self) -> str:
        return BAND_COLOURS.get(self.name, "#888888")


def categories() -> list[Category]:
    """Drawable categories, weakest first. "none" is not an area."""
    return [
        Category(name, float(minimum), label)
        for name, minimum, label in RISK_BANDS
        if minimum > 0
    ]


# --- geometry -------------------------------------------------------------

def ring_area(points: np.ndarray) -> float:
    """Signed area of a closed ring by the shoelace formula.

    The SIGN carries the orientation, which is how an exterior ring is told
    from a hole; the magnitude is used to drop specks.
    """
    x, y = points[:, 0], points[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def simplify_ring(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Douglas-Peucker, iterative so a long coastline cannot blow the stack."""
    if len(points) < 4:
        return points

    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]

    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        a, b = points[start], points[end]
        span = b - a
        length = float(np.hypot(*span))
        segment = points[start + 1:end]
        if length == 0.0:
            distances = np.hypot(*(segment - a).T)
        else:
            # Perpendicular distance from each point to the chord a->b.
            distances = np.abs(
                span[0] * (a[1] - segment[:, 1])
                - (a[0] - segment[:, 0]) * span[1]
            ) / length
        if distances.size == 0:
            continue
        index = int(np.argmax(distances))
        if distances[index] > tolerance:
            split = start + 1 + index
            keep[split] = True
            stack.append((start, split))
            stack.append((split, end))

    return points[keep]


def chaikin(points: np.ndarray, passes: int = CHAIKIN_PASSES) -> np.ndarray:
    """Round a closed ring by corner cutting.

    Each pass replaces every vertex with two points a quarter and
    three-quarters along its edges, which converges on a smooth curve. It is
    what turns a traced cell boundary into something that looks drawn rather
    than sampled.
    """
    out = points
    for _ in range(max(0, passes)):
        if len(out) < 3:
            return out
        following = np.roll(out, -1, axis=0)
        quarter = 0.75 * out + 0.25 * following
        three_quarter = 0.25 * out + 0.75 * following
        # Interleave so the ring stays in order.
        out = np.empty((len(out) * 2, 2), dtype=out.dtype)
        out[0::2] = quarter
        out[1::2] = three_quarter
    return out


def _close(points: np.ndarray) -> list[list[float]]:
    """GeoJSON rings must repeat the first point as the last."""
    coords = [[round(float(x), 5), round(float(y), 5)] for x, y in points]
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


# --- building the outlook -------------------------------------------------

def _domain(values: np.ndarray) -> np.ndarray:
    """The field as the model produced it, sea included.

    No land or region clipping. Convection over the Irish Sea, the Channel
    and the southern North Sea is real and moves ashore, and clipping to the
    region boxes punched a rectangular hole through Wessex where two of them
    failed to meet.
    """
    return np.nan_to_num(values.astype("float64"), nan=0.0)


def category_mask(field: np.ndarray, minimum: float) -> np.ndarray:
    """A drawable, generalised mask of everything at or above a category.

    Three steps, all on the MASK rather than on the values, so that
    generalising a boundary can never lower a category:

      1. drop areas too small to draw, so a lone hot cell does not become a
         polygon implying precision the forecast has not got;
      2. close small gaps, so a ragged area is drawn as one region rather
         than a shower of islands;
      3. round the boundary, by blurring the binary mask and re-cutting at a
         half -- the standard way to get a drawn-looking edge while roughly
         preserving the area enclosed.
    """
    from scipy import ndimage

    mask = field >= minimum
    if not mask.any():
        return mask

    labels, count = ndimage.label(mask)
    if count:
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        keep = np.flatnonzero(sizes >= MIN_AREA_CELLS) + 1
        mask = np.isin(labels, keep)
    if not mask.any():
        return mask

    mask = ndimage.binary_closing(
        mask, structure=np.ones((CLOSE_CELLS, CLOSE_CELLS))
    )
    # Dilate before blurring: cutting a blurred mask at a half pulls the
    # boundary inward, and without this an area that passed the size filter
    # could still be smoothed out of existence.
    if DILATE_CELLS > 0:
        mask = ndimage.binary_dilation(mask, iterations=DILATE_CELLS)
    rounded = ndimage.gaussian_filter(mask.astype("float64"), SMOOTH_CELLS)
    return rounded >= 0.5


def build(values: np.ndarray, *, label: str = "", valid_time: str = "",
          lon: np.ndarray | None = None, lat: np.ndarray | None = None) -> dict:
    """Trace nested categorical polygons and return them as GeoJSON.

    `lon`/`lat` default to the TCM grid. They are a parameter rather than an
    assumption because a function that silently expects one grid shape breaks
    the moment it is handed anything else, and cannot be tested on a small
    synthetic field.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from ..grid import grid_lonlat, tcm_grid

    field = _domain(values)
    if lon is None or lat is None:
        lon, lat = grid_lonlat(tcm_grid())
    if lon.shape != values.shape or lat.shape != values.shape:
        raise ValueError(
            f"coordinates {lon.shape} do not match the field {values.shape}; "
            "pass lon/lat for a field that is not on the TCM grid"
        )

    features: list[dict] = []
    drawn: list[str] = []
    skipped: list[dict] = []
    # Categories the raw field reaches but which have no drawable AREA.
    #
    # This is the difference between the two products, and it must be stated
    # rather than left to look like a disagreement. On 2026-08-30 the day
    # headline read HIGH from a peak of 70.8, while the highest category with
    # a coherent area was Slight: "high" existed in 60 cells spread over 26
    # blobs, the largest 7 cells -- 28 km2. A peak index describes one cell; a
    # categorical outlook describes an area, and 28 km2 of scattered cells is
    # not one.
    too_small: list[dict] = []

    figure = plt.figure()
    try:
        axes = figure.add_subplot(111)
        for category in categories():
            raw = field >= category.minimum
            mask = category_mask(field, category.minimum)
            if not mask.any():
                if raw.any():
                    from scipy import ndimage

                    labels, count = ndimage.label(raw)
                    sizes = (
                        ndimage.sum(raw, labels, range(1, count + 1))
                        if count else np.array([0])
                    )
                    largest = int(sizes.max()) if sizes.size else 0
                    too_small.append({
                        "category": category.name,
                        "label": category.label,
                        "cells": int(raw.sum()),
                        "patches": int(count),
                        "largest_patch_km2": largest * 4,
                        "needs_km2": MIN_AREA_CELLS * 4,
                        "reason": (
                            "reached at cell level, but no patch is large "
                            "enough to draw as an area"
                        ),
                    })
                continue

            # Contour the MASK at a half, not the values at a threshold. The
            # mask has already been de-specked, gap-closed and rounded, so
            # this traces a drawn boundary rather than a pixel staircase.
            contours = axes.contourf(
                lon, lat, mask.astype("float64"), levels=[0.5, 1.5],
            )
            rings = []
            for path in contours.get_paths():
                rings.extend(path.to_polygons(closed_only=True))

            exteriors, holes = [], []
            for ring in rings:
                if len(ring) < 4:
                    continue
                simplified = chaikin(simplify_ring(ring, SIMPLIFY_DEGREES))
                area = ring_area(simplified)
                if abs(area) < MIN_AREA_SQ_DEG:
                    skipped.append({
                        "category": category.name,
                        "area_sq_deg": round(abs(area), 4),
                        "reason": "below the minimum drawable area",
                    })
                    continue
                (exteriors if area > 0 else holes).append(simplified)

            if not exteriors:
                continue

            # One MultiPolygon per category. Holes are matched to whichever
            # exterior contains them, so a quiet pocket inside a risk area is
            # drawn as a hole rather than as a separate outer ring.
            polygons = []
            for exterior in exteriors:
                rings_out = [_close(exterior)]
                for hole in holes:
                    if _contains(exterior, hole[0]):
                        rings_out.append(_close(hole))
                polygons.append(rings_out)

            # A category that reaches the edge of the model domain is
            # bounded there by the DATA, not by the forecast. Saying so stops
            # the straight edge reading as a meteorological boundary.
            edge = bool(
                mask[0, :].any() or mask[-1, :].any()
                or mask[:, 0].any() or mask[:, -1].any()
            )
            features.append({
                "type": "Feature",
                "properties": {
                    "category": category.name,
                    "label": category.label,
                    "min_index": category.minimum,
                    "colour": category.colour,
                    "polygons": len(polygons),
                    "reaches_domain_edge": edge,
                    "coverage_percent": round(
                        100.0 * float(mask.mean()), 1
                    ),
                },
                "geometry": {"type": "MultiPolygon", "coordinates": polygons},
            })
            drawn.append(category.name)
    finally:
        plt.close(figure)

    # WEAKEST first. Renderers draw in array order and later shapes sit on
    # top, so emitting strongest-first buried every severe area under the
    # large marginal one that follows it -- the map came out uniformly the
    # colour of the weakest category.
    #
    # categories() already yields weakest-first, so the order is left alone;
    # `categories_drawn` is reversed separately for reading.

    return {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "label": label,
            "valid_time": valid_time,
            "area": "the full model domain, sea included",
            "categories_drawn": list(reversed(drawn)),   # strongest first, for reading
            "categories_too_small_to_draw": too_small,
            "smoothing_km": round(SMOOTH_CELLS * 2.0, 1),
            "simplify_degrees": SIMPLIFY_DEGREES,
            "min_area_sq_deg": MIN_AREA_SQ_DEG,
            "skipped": skipped,
            "index_is_calibrated": False,
            "note": (
                "Categorical areas, nested strongest-inside-weakest. "
                "Boundaries are generalised: they are drawn to about "
                f"{SMOOTH_CELLS * 2:.0f} km, because a convective forecast "
                "cannot place a storm to the nearest grid cell. Every "
                "contiguous area the field puts at a category is enclosed by "
                "that category's polygon. A category the field reaches only "
                "in scattered cells is listed under "
                "categories_too_small_to_draw rather than drawn, which is why "
                "the strongest polygon can be weaker than the peak index."
            ),
        },
    }


def _contains(ring: np.ndarray, point: np.ndarray) -> bool:
    """Ray-casting point-in-polygon, for matching holes to their exterior."""
    x, y = float(point[0]), float(point[1])
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            crossing = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if crossing > x:
                inside = not inside
    return inside
