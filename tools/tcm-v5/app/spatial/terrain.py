"""Terrain geometry: what the ground looks like, in physical units.

Steps 2 and 3 of the Stage 8 order, sections 4, 5, 6 and 12.

Section 4 is explicit that elevation alone will not do -- two places at the
same height behave differently because of exposure, slope, and the shape of
what surrounds them. So this module computes the geometry that distinguishes
them, and every quantity comes out in its own unit: metres, degrees,
per-metre. Nothing here is a score.

THE SCALES, AND WHY THESE ONES
------------------------------
Section 6 requires multiple scales and section 34 forbids hard-coding them
without justification. Three, each with a physical reason:

  LOCAL, 2 km -- one grid cell. The finest structure the grid holds. A
  centred difference spans 4 km, which is the smallest gradient that can be
  measured at all.

  EFFECTIVE, 12 km -- what the MODEL can actually respond to. An NWP model
  does not resolve motions at its grid spacing; the effective resolution is
  roughly 5-7 dx (Skamarock 2004, Mon. Wea. Rev.; Ricard et al. 2013,
  Q.J.R.M.S.), so a 2 km model resolves 10-14 km. Terrain detail finer than
  this exists in the orography but the model's flow response to it does not.
  This is the honest scale for any diagnostic that combines terrain with
  model wind.

  MASSIF, 30 km -- the width of a whole UK upland. The Pennines are about
  30 km across, Snowdonia about 30 km, the Cairngorms about 40 km, Dartmoor
  about 25 km. At this scale terrain blocks and deflects the synoptic flow
  rather than merely lifting it, which is a different physical regime and is
  what the Froude number in `flow.py` is testing for.

RIDGES AND VALLEYS
------------------
Two independent, published methods rather than one invented one:

  * The Topographic Position Index (Weiss 2001, ESRI User Conference) --
    the height of a cell above the mean of its surroundings. Positive on
    ridges and summits, negative in valleys and hollows, in metres.

  * The STRUCTURE TENSOR of the elevation field, which gives ridge
    ORIENTATION and how ridge-like the terrain is at all. The smoothed outer
    product of the gradient has eigenvectors along and across the dominant
    terrain lineation; the eigenvector with the smaller eigenvalue points
    along the ridge, and the eigenvalue ratio says whether there is a
    lineation to speak of or whether the terrain is a dome or a bowl.

The second is what section 12 needs: "ridge orientation" is meaningless on
an isolated hill, and the anisotropy tells you when to stop asking.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .feature import Quality, SpatialFeature
from .static import Geography

log = logging.getLogger(__name__)

#: Analysis scales in metres, with the reasoning in the module docstring.
SCALE_LOCAL_M = 2_000.0
SCALE_EFFECTIVE_M = 12_000.0
SCALE_MASSIF_M = 30_000.0
SCALES: dict[str, float] = {
    "local": SCALE_LOCAL_M,
    "effective": SCALE_EFFECTIVE_M,
    "massif": SCALE_MASSIF_M,
}

#: Below this the structure tensor has no dominant direction and a ridge
#: orientation should not be quoted. It is a property of the tensor, not a
#: tuning knob: an anisotropy of 0 is a perfectly isotropic dome or bowl,
#: and 0.2 still means the two eigenvalues are within a factor of 1.5.
MIN_ANISOTROPY = 0.2


def _window_cells(scale_m: float, spacing_m: float) -> int:
    """Half-width in cells for a window of the given physical scale.

    At least 1, and always odd in total, so the window is centred on the
    cell rather than offset by half a cell.
    """
    return max(1, int(round(scale_m / (2.0 * spacing_m))))


def _edge_valid(shape: tuple[int, int], margin: int) -> np.ndarray:
    """False within `margin` cells of the domain edge.

    Section 73. Window statistics near the edge are computed against
    replicated values, which cannot invent a peak or a gradient but does
    flatten the answer. Consumers are told where that happened rather than
    being handed a number that looks as sound as the interior.
    """
    valid = np.zeros(shape, dtype=bool)
    if margin <= 0:
        return ~valid
    if 2 * margin >= min(shape):
        return valid
    valid[margin:-margin, margin:-margin] = True
    return valid


def gradient(
    field: np.ndarray, spacing_m: float
) -> tuple[np.ndarray, np.ndarray]:
    """Horizontal gradient (d/dx east, d/dy north) per metre.

    The TCM grid is an equal-area projection in metres with y increasing
    northward, so `np.gradient` axis 0 is the northward derivative and axis
    1 the eastward one. Getting this pair the wrong way round rotates every
    aspect, every upslope diagnostic and every boundary orientation by 90
    degrees, which looks like weather rather than like a bug -- so it is
    stated here once and used everywhere through this function.
    """
    d_dy, d_dx = np.gradient(field, spacing_m, spacing_m)
    return d_dx, d_dy


def _window_stat(
    field: np.ndarray, half: int, stat: str
) -> np.ndarray:
    from scipy.ndimage import (
        maximum_filter, minimum_filter, uniform_filter,
    )

    size = 2 * half + 1
    if stat == "mean":
        return uniform_filter(field, size=size, mode="nearest")
    if stat == "max":
        return maximum_filter(field, size=size, mode="nearest")
    if stat == "min":
        return minimum_filter(field, size=size, mode="nearest")
    if stat == "std":
        mean = uniform_filter(field, size=size, mode="nearest")
        mean_sq = uniform_filter(field * field, size=size, mode="nearest")
        return np.sqrt(np.maximum(mean_sq - mean * mean, 0.0))
    raise ValueError(f"unknown window statistic {stat!r}")


@dataclass(frozen=True, slots=True)
class TerrainGeometry:
    """Every static terrain descriptor, in its own unit.

    Held as one object because the flow diagnostics need several of these
    together and pairing a gradient with the wrong aspect is silent.
    """

    #: Gradient components, m per m, pointing UPHILL.
    dh_dx: np.ndarray
    dh_dy: np.ndarray
    #: Slope magnitude, m per m, and its angle in degrees from horizontal.
    slope: np.ndarray
    slope_degrees: np.ndarray
    #: Compass bearing the slope FACES, i.e. the downhill direction,
    #: degrees clockwise from north. NaN where the ground is flat, because
    #: a flat cell faces nowhere and 0 would read as "north".
    aspect: np.ndarray
    #: Laplacian of the elevation, per metre. Negative on convex ground
    #: (ridges, summits), positive in concave ground (valleys, hollows).
    curvature: np.ndarray
    #: Curvature along the slope direction, per metre. This is the one that
    #: accelerates or decelerates flow running downhill.
    profile_curvature: np.ndarray
    #: Per-scale window statistics.
    roughness: dict[str, np.ndarray]      # m, std of elevation
    local_relief: dict[str, np.ndarray]   # m, max minus min
    tpi: dict[str, np.ndarray]            # m, height above surroundings
    #: Ridge-line bearing in degrees, from the structure tensor, and how
    #: strongly the terrain is lineated at all (0-1).
    ridge_bearing: np.ndarray
    anisotropy: np.ndarray
    #: Validity per scale, False where a window crossed the domain edge.
    valid: dict[str, np.ndarray]
    geography: Geography

    @property
    def ridge_index(self) -> np.ndarray:
        """Positive where the cell stands above its surroundings, m.

        The massif-scale TPI: a summit is above its surroundings at every
        scale, but a valley-floor knoll is only above them locally.
        """
        return self.tpi["massif"]

    @property
    def valley_index(self) -> np.ndarray:
        """Positive where the cell lies below its surroundings, m."""
        return -self.tpi["massif"]


def geometry(geo: Geography) -> TerrainGeometry:
    """Compute the full terrain geometry for a static layer."""
    h = geo.elevation
    spacing = geo.spacing_m

    dh_dx, dh_dy = gradient(h, spacing)
    slope = np.hypot(dh_dx, dh_dy)
    slope_degrees = np.degrees(np.arctan(slope))

    # Aspect is the direction the ground FACES: downhill, so -grad. Bearing
    # is measured clockwise from north, hence atan2(east, north).
    aspect = np.degrees(np.arctan2(-dh_dx, -dh_dy)) % 360.0
    aspect = np.where(slope > 1e-6, aspect, np.nan)

    d2x_dy, d2x_dx = np.gradient(dh_dx, spacing, spacing)
    d2y_dy, _ = np.gradient(dh_dy, spacing, spacing)
    curvature = d2x_dx + d2y_dy

    # Profile curvature: the second derivative along the unit slope vector,
    # n = grad/|grad|, i.e. n . H . n. Zero where there is no slope to run
    # along.
    with np.errstate(invalid="ignore", divide="ignore"):
        nx = np.where(slope > 1e-9, dh_dx / slope, 0.0)
        ny = np.where(slope > 1e-9, dh_dy / slope, 0.0)
    hxx, hxy = d2x_dx, d2x_dy
    hyy = d2y_dy
    profile_curvature = (
        nx * nx * hxx + 2.0 * nx * ny * hxy + ny * ny * hyy
    )
    profile_curvature = np.where(slope > 1e-9, profile_curvature, 0.0)

    roughness: dict[str, np.ndarray] = {}
    relief: dict[str, np.ndarray] = {}
    tpi: dict[str, np.ndarray] = {}
    valid: dict[str, np.ndarray] = {}
    for name, scale in SCALES.items():
        half = _window_cells(scale, spacing)
        roughness[name] = _window_stat(h, half, "std")
        relief[name] = (
            _window_stat(h, half, "max") - _window_stat(h, half, "min")
        )
        tpi[name] = h - _window_stat(h, half, "mean")
        valid[name] = _edge_valid(h.shape, half)

    bearing, anisotropy = _structure_tensor(dh_dx, dh_dy, spacing)

    return TerrainGeometry(
        dh_dx=dh_dx, dh_dy=dh_dy, slope=slope, slope_degrees=slope_degrees,
        aspect=aspect, curvature=curvature,
        profile_curvature=profile_curvature,
        roughness=roughness, local_relief=relief, tpi=tpi,
        ridge_bearing=bearing, anisotropy=anisotropy,
        valid=valid, geography=geo,
    )


def _structure_tensor(
    dh_dx: np.ndarray, dh_dy: np.ndarray, spacing_m: float,
    scale_m: float = SCALE_EFFECTIVE_M,
) -> tuple[np.ndarray, np.ndarray]:
    """Ridge-line bearing and terrain anisotropy.

    The structure tensor is the gradient outer product smoothed over the
    analysis window:

        J = [[<gx gx>, <gx gy>],
             [<gx gy>, <gy gy>]]

    Its large eigenvalue lies ACROSS the dominant terrain lineation and the
    small one ALONG it, so the ridge runs along the small eigenvector. This
    is the standard orientation estimator from image analysis, used here
    because it answers the question section 12 actually asks -- which way
    does the ridge run -- rather than the question a single gradient answers,
    which is which way is uphill from this one cell.

    Anisotropy (l1 - l2) / (l1 + l2) is 1 for a perfect ridge or scarp and 0
    for a dome, a bowl or a plain. Below `MIN_ANISOTROPY` the bearing is
    returned as NaN, because a dome has no ridge line and quoting one would
    invent a direction out of numerical noise.
    """
    from scipy.ndimage import uniform_filter

    size = 2 * _window_cells(scale_m, spacing_m) + 1
    jxx = uniform_filter(dh_dx * dh_dx, size=size, mode="nearest")
    jyy = uniform_filter(dh_dy * dh_dy, size=size, mode="nearest")
    jxy = uniform_filter(dh_dx * dh_dy, size=size, mode="nearest")

    trace = jxx + jyy
    diff = jxx - jyy
    root = np.sqrt(diff * diff + 4.0 * jxy * jxy)
    lam1 = 0.5 * (trace + root)     # across the lineation
    lam2 = 0.5 * (trace - root)     # along it

    with np.errstate(invalid="ignore", divide="ignore"):
        anisotropy = np.where(trace > 1e-18, root / trace, 0.0)

    # Eigenvector for lam1 points ACROSS the ridge; the ridge runs at right
    # angles to it.
    #
    # `across` is the eigenvector's angle FROM THE X AXIS, which is not a
    # compass bearing: the vector is (cos, sin) in (east, north), so the
    # bearing is atan2(east, north) = atan2(cos, sin). Reading the angle
    # straight off as a bearing rotates every ridge by 90 degrees, and a
    # north-south ridge came out as east-west -- which then rotated the
    # along-ridge flow diagnostic with it.
    across = np.arctan2(2.0 * jxy, diff) / 2.0
    across_bearing = np.degrees(np.arctan2(np.cos(across), np.sin(across)))
    ridge = (across_bearing + 90.0) % 180.0
    ridge = np.where(anisotropy >= MIN_ANISOTROPY, ridge, np.nan)
    return ridge, np.clip(anisotropy, 0.0, 1.0)


# --------------------------------------------------------------------------
# Presentation as features
# --------------------------------------------------------------------------

def features(geom: TerrainGeometry) -> dict[str, SpatialFeature]:
    """The terrain geometry as named, unit-carrying, traceable features."""
    geo = geom.geography
    out: dict[str, SpatialFeature] = {}

    flags: tuple[str, ...] = ()
    quality = Quality.GOOD
    reason = ""
    if geo.is_upsampled:
        quality = Quality.DEGRADED
        reason = (
            f"the terrain is {geo.native_resolution_m:.0f} m data on a "
            f"{geo.spacing_m:.0f} m grid, so its detail is interpolated"
        )
    if geo.source.value == "model_orography":
        flags = flags + (
            "model orography, not a survey DEM: peaks are smoothed and "
            "narrow valleys are absent. Consistent with the model's own "
            "wind field, which is what the flow diagnostics need",
        )

    def add(name, values, unit, method, *, scale=None, valid=None,
            extra_flags=()):
        out[name] = geo.feature(
            name, values, unit, method, scale_m=scale, valid=valid,
            quality=quality, reason=reason, flags=flags + extra_flags,
        )

    add("elevation", geo.elevation, "m", "model_orography")
    add("land_fraction", geo.land_fraction, "1", "model_land_sea_mask")
    add("slope", geom.slope, "m/m", "central_difference", scale=SCALE_LOCAL_M)
    add("slope_degrees", geom.slope_degrees, "degrees", "central_difference",
        scale=SCALE_LOCAL_M)
    add("aspect", geom.aspect, "degrees_from_north", "downhill_bearing",
        scale=SCALE_LOCAL_M,
        extra_flags=("NaN on flat ground, which faces no direction",))
    add("terrain_gradient_x", geom.dh_dx, "m/m", "central_difference",
        scale=SCALE_LOCAL_M)
    add("terrain_gradient_y", geom.dh_dy, "m/m", "central_difference",
        scale=SCALE_LOCAL_M)
    add("curvature", geom.curvature, "1/m", "laplacian", scale=SCALE_LOCAL_M,
        extra_flags=("negative is convex (ridge), positive concave (valley)",))
    add("profile_curvature", geom.profile_curvature, "1/m",
        "second_derivative_along_slope", scale=SCALE_LOCAL_M)

    for name, scale in SCALES.items():
        add(f"terrain_roughness_{name}", geom.roughness[name], "m",
            "window_standard_deviation", scale=scale, valid=geom.valid[name])
        add(f"local_relief_{name}", geom.local_relief[name], "m",
            "window_max_minus_min", scale=scale, valid=geom.valid[name])
        add(f"tpi_{name}", geom.tpi[name], "m",
            "topographic_position_index_weiss_2001", scale=scale,
            valid=geom.valid[name])

    add("ridge_index", geom.ridge_index, "m",
        "topographic_position_index_weiss_2001", scale=SCALE_MASSIF_M,
        valid=geom.valid["massif"],
        extra_flags=("positive above the surrounding terrain",))
    add("valley_index", geom.valley_index, "m",
        "topographic_position_index_weiss_2001", scale=SCALE_MASSIF_M,
        valid=geom.valid["massif"],
        extra_flags=("positive below the surrounding terrain",))
    add("ridge_bearing", geom.ridge_bearing, "degrees_from_north",
        "structure_tensor", scale=SCALE_EFFECTIVE_M,
        extra_flags=(
            f"NaN where terrain anisotropy is below {MIN_ANISOTROPY}: a dome "
            f"or a plain has no ridge line to quote",
        ))
    add("terrain_anisotropy", geom.anisotropy, "1", "structure_tensor",
        scale=SCALE_EFFECTIVE_M,
        extra_flags=("1 is a clean ridge or scarp, 0 a dome, bowl or plain",))
    return out
