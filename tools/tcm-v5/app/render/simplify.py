"""Generalise a risk field into a map a non-specialist can read.

The detailed map is the honest one: a 2 km field with every gradient the
model produced. It is also unreadable to most people. A continuous ramp over
290,745 cells shows dozens of small colour changes, and a reader with no
training cannot tell which of them matter -- a single hot cell in a quiet
area looks the same as the core of a genuine risk zone.

The simplified map answers the question those readers are actually asking:
*roughly where, and roughly how bad.* Three steps, in order:

  1. **Smooth.** A convection-permitting model places individual showers, and
     it is not skilful at placing them -- the platform's own regime
     classification says so ("slow-moving showers, placement poorly
     constrained"). Blurring to about 20 km removes detail the forecast
     cannot justify anyway, so this step costs no real information.
  2. **Band.** Snap to the canonical risk levels, so the map has flat areas
     with definite edges instead of a continuous gradient. The reader sees
     "moderate here, slight there", which is what the bands are for.
  3. **Drop specks.** Remove risk areas too small to act on. A 20-cell blob
     is 80 km2; nobody can use it, and on a public map it reads as false
     precision.

What this must never do is invent coverage. Every step can only remove or
merge; nothing here ever raises a cell's band or grows an area outward, so
the simplified map cannot show risk anywhere the detailed map does not.
"""
from __future__ import annotations

import numpy as np

from ..forecast.risk import RISK_BANDS

#: Smoothing radius in grid cells. The TCM grid is 2 km, so 5 cells is a
#: 10 km sigma and an effective scale of roughly 20-25 km -- about the
#: distance over which storm placement is meaningful a day ahead.
SMOOTH_CELLS = 5.0

#: Smallest area kept, in grid cells. 100 cells at 2 km is 400 km2, roughly
#: an English county: the finest area a general reader can act on.
MIN_AREA_CELLS = 100


def band_edges() -> list[float]:
    """The lower bound of every canonical band, ascending."""
    return sorted(float(minimum) for _, minimum, _ in RISK_BANDS)


def simplify(values: np.ndarray, *, smooth_cells: float = SMOOTH_CELLS,
             min_area_cells: int = MIN_AREA_CELLS) -> np.ndarray:
    """Smooth, band and de-speckle a risk field.

    Returns a field on the same grid whose values are band minima, so the
    existing colour scale renders it as flat areas without any change to the
    palette or the legend.
    """
    from scipy import ndimage

    finite = np.isfinite(values)
    if not finite.any():
        return values

    work = np.where(finite, values, 0.0).astype("float32")

    # 1. Smooth. NaNs are excluded by normalising against a smoothed mask, so
    #    the edge of the domain does not bleed toward zero.
    if smooth_cells > 0:
        blurred = ndimage.gaussian_filter(work, smooth_cells, mode="nearest")
        weight = ndimage.gaussian_filter(
            finite.astype("float32"), smooth_cells, mode="nearest"
        )
        with np.errstate(invalid="ignore", divide="ignore"):
            work = np.where(weight > 1e-6, blurred / np.maximum(weight, 1e-6), 0.0)

    # 2. Band: snap each cell DOWN to the band it falls in. Snapping down
    #    matters -- rounding to the nearest band could promote a cell into a
    #    level the model never gave it.
    edges = band_edges()

    def to_bands(a: np.ndarray) -> np.ndarray:
        out = np.zeros_like(a)
        for low in edges:
            out = np.where(a >= low, low, out)
        return out

    banded = to_bands(work)

    # Smoothing SPREADS a value into its neighbours, which can push a cell
    # that was zero across a band edge: measured at 49.5% of the domain above
    # the lowest band before smoothing and 54.3% after. That would paint risk
    # where the model forecast none, which is exactly what this module
    # promises never to do.
    #
    # Clamping to the unsmoothed banding makes the guarantee structural: a
    # cell's band can only ever be LOWERED from what the detailed field said,
    # so every simplified risk area is a strict subset of the detailed one.
    banded = np.minimum(banded, to_bands(np.where(finite, values, 0.0)))

    # 3. Drop specks, band by band, from the top down. Working downward means
    #    a small "moderate" core inside a large "slight" area is merged into
    #    the slight area rather than deleted outright.
    for low in sorted(edges, reverse=True):
        if low <= 0:
            continue
        mask = banded >= low
        if not mask.any():
            continue
        labels, count = ndimage.label(mask)
        if count == 0:
            continue
        sizes = ndimage.sum(mask, labels, range(1, count + 1))
        too_small = np.isin(labels, np.flatnonzero(sizes < min_area_cells) + 1)
        if too_small.any():
            # Demote to the next band down, never to zero: the risk was real,
            # it is simply too small an area to draw at this level.
            lower = max([e for e in edges if e < low], default=0.0)
            banded = np.where(too_small, lower, banded)

    return np.where(finite, banded, np.nan).astype("float32")
