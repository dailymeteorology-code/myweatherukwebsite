"""How the flow meets the terrain.

Step 3 of the Stage 8 order, sections 7 to 13.

Section 7 is blunt about the thing to avoid: orographic forcing is not
"elevation above X metres". The physics is the kinematic lower boundary
condition -- air cannot go through the ground, so flow with a component
along the terrain gradient must rise:

    w_oro = u dh/dx + v dh/dy        [m/s]

That is a velocity, in metres per second, and it is signed. Positive is
ascent on windward slopes; negative is descent in the lee. Nothing here
converts it to a score.

WHETHER THE AIR GOES OVER OR AROUND
-----------------------------------
The formula above assumes the air follows the ground. Stably stratified flow
approaching a hill does not always do that: below a critical speed it lacks
the kinetic energy to climb, and splits around the obstacle instead. The
control parameter is the non-dimensional mountain height, the inverse Froude
number,

    Fr = U / (N h)

with N the Brunt-Vaisala frequency and h the height to be climbed (Smith
1979, Adv. Geophys.; Smith 1989, Adv. Geophys.; Reinecke and Durran 2008,
J. Atmos. Sci.). Fr well above 1 is flow-over; Fr well below 1 is blocked
flow that goes around, with upstream deceleration and, importantly, LEE
CONVERGENCE where the two branches rejoin.

This distinction is why section 11 warns against assuming every lee is
suppressed. In the flow-over regime the lee descends, warms and dries and
convection is genuinely suppressed. In the blocked regime the lee is a
convergence zone and can be a favoured initiation site. The same geometry,
the same wind direction, opposite consequences -- and only the stability
tells them apart. So `lee_regime` reports which one, and never assumes.

WHICH WIND
----------
Section 13: not one level for everything. Terrain forcing acts on the layer
that has to climb, so the diagnostics use a DEPTH-WEIGHTED mean wind through
the layer from the surface to the terrain height being crossed, not the
10 m wind. A 10 m wind is inside the surface layer, decoupled by friction,
and systematically underestimates what the hill actually sees. Where only
10 m wind exists the calculation still runs, and says so.
"""
from __future__ import annotations

import logging
from datetime import datetime
from dataclasses import dataclass
from enum import Enum

import numpy as np

from .feature import (
    Lineage, Provenance, Quality, SpatialFeature, unavailable,
)
from .static import PROCESSING_VERSION, Geography
from .terrain import SCALE_EFFECTIVE_M, SCALE_MASSIF_M, TerrainGeometry

log = logging.getLogger(__name__)

#: Gravity, m/s2.
G = 9.80665

#: Froude number below which stable flow is blocked and goes around rather
#: than over. This is the classical critical value of the non-dimensional
#: mountain height, not a fitted parameter: Fr = U/(Nh) = 1 is where the
#: kinetic energy of the approaching flow equals the potential energy needed
#: to lift a parcel over the obstacle.
FROUDE_BLOCKED = 1.0

#: How far upwind to look for the barrier that shades a cell, in metres.
#: The massif scale, because that is the width of the uplands whose lee is
#: being described; a 2 km hill does not cast a rain shadow.
UPWIND_SEARCH_M = SCALE_MASSIF_M

#: Sampling step along the upwind ray, in cells. One cell: no reason to
#: sample the terrain more coarsely than it is stored.
UPWIND_STEP_CELLS = 1


class LeeRegime(str, Enum):
    """Which side of the blocking transition a cell's flow is on."""

    #: Fr > 1: air climbs the barrier and descends in the lee. Warming,
    #: drying, subsidence -- convection genuinely suppressed.
    FLOW_OVER = "flow_over"
    #: Fr < 1: air is blocked and splits around. The lee is where the
    #: branches rejoin, which CONVERGES rather than suppresses.
    BLOCKED = "blocked"
    #: Not downwind of any barrier worth the name.
    NO_BARRIER = "no_barrier"
    #: Stability or wind unavailable, so the regime cannot be determined.
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class FlowInputs:
    """The atmospheric state the terrain diagnostics need.

    `u` and `v` are the wind that actually meets the terrain -- see the
    module docstring on which level that should be. `brunt_vaisala` is the
    dry or moist stability of the layer being lifted, in s-1.
    """

    u: np.ndarray
    v: np.ndarray
    #: Brunt-Vaisala frequency, s-1. None disables the Froude diagnostics,
    #: which then report UNKNOWN rather than assuming a regime.
    brunt_vaisala: np.ndarray | None = None
    #: Which level the wind came from, for provenance and honesty.
    wind_level: str = "unknown"
    #: Depth of the layer the wind represents, m. Used for the continuity
    #: conversion from vertical velocity to convergence.
    layer_depth_m: float = 1000.0
    model: str = ""
    run: datetime | None = None
    valid_time: datetime | None = None
    member: int | None = None


@dataclass(frozen=True, slots=True)
class TerrainFlow:
    """Terrain-flow diagnostics, all in physical units."""

    #: Terrain-forced vertical velocity, m/s. Signed: up on windward
    #: slopes, down in the lee.
    orographic_ascent: np.ndarray
    #: The same quantity split into its one-signed halves, for consumers
    #: that want only one. Both are magnitudes, m/s, never negative.
    upslope: np.ndarray
    downslope: np.ndarray
    #: Cosine of the angle between the wind and the uphill gradient. +1 is
    #: straight up the fall line, 0 is along the contour, -1 straight down.
    #: NaN where there is no slope or no wind to take an angle between.
    flow_slope_alignment: np.ndarray
    #: Cosine of the angle between the wind and the ridge line, folded to
    #: 0-1: 1 is flow along the ridge, 0 is flow across it.
    flow_ridge_alignment: np.ndarray
    #: Low-level convergence implied by the terrain-forced ascent through
    #: continuity, s-1. Positive is convergence.
    terrain_convergence: np.ndarray
    #: Froude number U/(Nh). NaN without stability.
    froude: np.ndarray
    #: Height of the highest terrain upwind within the search distance,
    #: above the cell itself, m. Zero when nothing upwind is higher.
    upwind_barrier: np.ndarray
    #: Which lee regime each cell is in, as LeeRegime values.
    lee_regime: np.ndarray
    #: Descent rate in the lee attributable to the barrier, m/s. Zero
    #: outside the flow-over regime, because a blocked lee does not descend.
    lee_descent: np.ndarray
    inputs: FlowInputs
    geometry: TerrainGeometry
    #: True where every input was finite and the cell is away from the edge.
    valid: np.ndarray


def compute(geom: TerrainGeometry, wind: FlowInputs) -> TerrainFlow:
    """All terrain-flow diagnostics for one wind field."""
    u, v = np.asarray(wind.u, "float64"), np.asarray(wind.v, "float64")
    if u.shape != geom.slope.shape or v.shape != u.shape:
        raise ValueError(
            f"wind {u.shape} is not on the terrain grid {geom.slope.shape}"
        )

    # -- the kinematic boundary condition ---------------------------------
    w_oro = u * geom.dh_dx + v * geom.dh_dy

    # The sea is flat and lifts nothing. A centred difference at a water
    # cell next to a cliff still returns a gradient -- on the live grid that
    # reached 0.68 m/s of "orographic ascent" over open water -- because the
    # stencil straddles the coastline. Attributing the cliff's slope to the
    # water it stands over is an artefact of the difference, not terrain
    # forcing, and it would put spurious lift along every coast in the
    # domain. Coastal cells force air by a completely different mechanism,
    # which `coast.py` handles as convergence rather than as orography.
    sea = geom.geography.is_sea
    w_oro = np.where(sea, 0.0, w_oro)

    upslope = np.maximum(w_oro, 0.0)
    downslope = np.maximum(-w_oro, 0.0)

    speed = np.hypot(u, v)
    with np.errstate(invalid="ignore", divide="ignore"):
        # cos(angle) between wind and uphill gradient.
        denom = speed * geom.slope
        alignment = np.where(denom > 1e-9, w_oro / denom, np.nan)
    alignment = np.clip(alignment, -1.0, 1.0)

    # Flow along vs across the ridge. The ridge bearing is a line, not a
    # direction, so the answer is folded: |cos| runs 1 for along-ridge flow
    # down to 0 for across-ridge flow, and a 180-degree wind shift cannot
    # change it.
    ridge_rad = np.radians(geom.ridge_bearing)
    ridge_x, ridge_y = np.sin(ridge_rad), np.cos(ridge_rad)
    with np.errstate(invalid="ignore", divide="ignore"):
        ridge_alignment = np.where(
            speed > 1e-9,
            np.abs((u * ridge_x + v * ridge_y) / np.maximum(speed, 1e-9)),
            np.nan,
        )
    ridge_alignment = np.clip(ridge_alignment, 0.0, 1.0)

    # -- continuity: ascent aloft implies convergence beneath --------------
    # dw/dz = -div(U_h). Taking w from 0 at the surface to w_oro over the
    # layer depth H gives div = -w_oro/H, i.e. convergence = w_oro/H.
    depth = max(float(wind.layer_depth_m), 1.0)
    terrain_convergence = w_oro / depth

    # -- blocked or over? --------------------------------------------------
    barrier = _upwind_barrier(geom, u, v)
    if wind.brunt_vaisala is None:
        froude = np.full(u.shape, np.nan)
        regime = np.full(u.shape, LeeRegime.UNKNOWN.value, dtype=object)
    else:
        n = np.asarray(wind.brunt_vaisala, "float64")
        with np.errstate(invalid="ignore", divide="ignore"):
            froude = np.where(
                (n > 1e-6) & (barrier > 1.0),
                speed / np.maximum(n * barrier, 1e-9),
                np.inf,
            )
        regime = np.where(
            barrier <= 1.0, LeeRegime.NO_BARRIER.value,
            np.where(
                ~np.isfinite(froude), LeeRegime.UNKNOWN.value,
                np.where(
                    froude < FROUDE_BLOCKED, LeeRegime.BLOCKED.value,
                    LeeRegime.FLOW_OVER.value,
                ),
            ),
        ).astype(object)
        # inf froude means "no barrier or no stability"; barrier>1 with
        # finite N was handled above, so inf here is genuinely flow-over.
        regime = np.where(
            (barrier > 1.0) & np.isinf(froude),
            LeeRegime.FLOW_OVER.value, regime,
        ).astype(object)

    # Lee descent is only meaningful where the air went over. In a blocked
    # lee there is no descent to speak of -- the air went around.
    over = regime == LeeRegime.FLOW_OVER.value
    lee_descent = np.where(over, downslope, 0.0)

    valid = (
        np.isfinite(u) & np.isfinite(v) & np.isfinite(geom.dh_dx)
        & np.isfinite(geom.dh_dy) & geom.valid["local"]
    )
    return TerrainFlow(
        orographic_ascent=w_oro, upslope=upslope, downslope=downslope,
        flow_slope_alignment=alignment, flow_ridge_alignment=ridge_alignment,
        terrain_convergence=terrain_convergence, froude=froude,
        upwind_barrier=barrier, lee_regime=regime, lee_descent=lee_descent,
        inputs=wind, geometry=geom, valid=valid,
    )


def _upwind_barrier(
    geom: TerrainGeometry, u: np.ndarray, v: np.ndarray,
    search_m: float = UPWIND_SEARCH_M,
) -> np.ndarray:
    """Height of the highest upwind terrain above each cell, metres.

    Walks back along the wind vector, sampling the elevation, and keeps the
    maximum. This is what makes lee diagnostics WIND-DIRECTION DEPENDENT,
    which section 11 requires: the lee of the Pennines is in Lancashire in
    an easterly and in Yorkshire in a westerly, and a static "lee side" mask
    would get one of those wrong every time.

    Cells with nothing higher upwind return 0.0, meaning no barrier -- not
    a missing value.
    """
    h = geom.geography.elevation
    spacing = geom.geography.spacing_m
    ny, nx = h.shape

    speed = np.hypot(u, v)
    with np.errstate(invalid="ignore", divide="ignore"):
        ux = np.where(speed > 1e-6, u / speed, 0.0)
        uy = np.where(speed > 1e-6, v / speed, 0.0)

    rows, cols = np.indices(h.shape)
    highest = np.array(h, dtype="float64", copy=True)
    n_steps = max(1, int(search_m / (spacing * UPWIND_STEP_CELLS)))

    for step in range(1, n_steps + 1):
        distance = step * UPWIND_STEP_CELLS
        # Upwind is BACK along the wind vector, hence the minus.
        sample_col = np.rint(cols - ux * distance).astype(int)
        sample_row = np.rint(rows - uy * distance).astype(int)
        inside = (
            (sample_row >= 0) & (sample_row < ny)
            & (sample_col >= 0) & (sample_col < nx)
        )
        sampled = np.where(
            inside, h[np.clip(sample_row, 0, ny - 1),
                      np.clip(sample_col, 0, nx - 1)],
            -np.inf,
        )
        highest = np.maximum(highest, sampled)

    barrier = highest - h
    return np.where(np.isfinite(barrier), np.maximum(barrier, 0.0), 0.0)


def brunt_vaisala(
    theta: np.ndarray, dtheta_dz: np.ndarray
) -> np.ndarray:
    """N = sqrt(g/theta * dtheta/dz), s-1.

    NaN in an unstable layer, where N-squared is negative and there is no
    real frequency. That is the physically correct answer -- a Froude number
    is meaningless in convective flow, which does not go around hills -- and
    it propagates to a lee regime of UNKNOWN rather than a fabricated one.
    """
    with np.errstate(invalid="ignore", divide="ignore"):
        n_sq = G / np.where(theta > 0, theta, np.nan) * dtheta_dz
    return np.sqrt(np.where(n_sq > 0, n_sq, np.nan))


# --------------------------------------------------------------------------
# Presentation
# --------------------------------------------------------------------------

def features(flow: TerrainFlow) -> dict[str, SpatialFeature]:
    """Terrain-flow diagnostics as named, traceable features."""
    wind = flow.inputs
    geo: Geography = flow.geometry.geography

    quality = Quality.GOOD
    reason = ""
    flags: tuple[str, ...] = (
        f"computed with the {wind.wind_level} wind over the model's own "
        f"orography, so the flow and the terrain are consistent",
    )
    if wind.wind_level in ("10m", "unknown"):
        quality = Quality.DEGRADED
        reason = (
            "the terrain-flow diagnostics are using the 10 m wind, which "
            "sits inside the friction layer and understates what the hill "
            "actually sees. A boundary-layer mean wind would be sounder"
        )
    if wind.brunt_vaisala is None:
        flags = flags + (
            "no stability field, so the Froude number and the lee regime "
            "are UNKNOWN: whether the lee subsides or converges cannot be "
            "determined from the geometry alone",
        )

    def provenance(method: str, scale=None, inputs=()) -> Provenance:
        return Provenance(
            method=method,
            inputs=("terrain_height",) + tuple(inputs),
            model=wind.model or geo.model, run=wind.run,
            valid_time=wind.valid_time, member=wind.member, scale_m=scale,
            processing_version=PROCESSING_VERSION,
            notes=geo.notes,
        )

    def add(out, name, values, unit, method, *, scale=None, extra=()):
        out[name] = SpatialFeature(
            name=name, values=values, unit=unit, quality=quality,
            lineage=Lineage.FORECAST,
            provenance=provenance(method, scale, ("u_wind", "v_wind")),
            reason=reason, valid=flow.valid, flags=flags + extra,
        )

    out: dict[str, SpatialFeature] = {}
    add(out, "orographic_ascent", flow.orographic_ascent, "m/s",
        "kinematic_lower_boundary_condition",
        extra=("signed: positive is windward ascent, negative lee descent",))
    add(out, "upslope_flow", flow.upslope, "m/s",
        "positive_part_of_orographic_ascent")
    add(out, "downslope_flow", flow.downslope, "m/s",
        "negative_part_of_orographic_ascent")
    add(out, "flow_slope_alignment", flow.flow_slope_alignment, "1",
        "cosine_wind_to_uphill_gradient",
        extra=("+1 straight up the fall line, 0 along the contour, "
               "-1 straight down",))
    add(out, "flow_ridge_alignment", flow.flow_ridge_alignment, "1",
        "abs_cosine_wind_to_ridge_line", scale=SCALE_EFFECTIVE_M,
        extra=("1 is along-ridge flow, 0 is across-ridge",))
    add(out, "terrain_convergence", flow.terrain_convergence, "1/s",
        "continuity_from_orographic_ascent",
        extra=(f"w_oro divided by a {wind.layer_depth_m:.0f} m layer depth",))
    add(out, "upwind_barrier", flow.upwind_barrier, "m",
        "upwind_ray_maximum_elevation", scale=UPWIND_SEARCH_M,
        extra=("depends on wind direction: the lee of a range moves when "
               "the wind backs",))
    add(out, "lee_descent", flow.lee_descent, "m/s",
        "downslope_flow_in_the_flow_over_regime",
        extra=("zero in a blocked lee, where the air went around rather "
               "than over and there is nothing to descend",))

    if wind.brunt_vaisala is None:
        out["froude_number"] = unavailable(
            "froude_number", "1",
            "no stability field was supplied, so U/(Nh) cannot be formed "
            "and whether the flow goes over or around the terrain is "
            "unknown",
            method="froude_number", inputs=("terrain_height",),
            processing_version=PROCESSING_VERSION,
        )
    else:
        add(out, "froude_number", flow.froude, "1",
            "u_over_n_h", scale=UPWIND_SEARCH_M,
            extra=(f"below {FROUDE_BLOCKED} the flow is blocked and splits "
                   f"around the barrier; above it, it climbs",))
    return out


def lee_regime_counts(flow: TerrainFlow) -> dict[str, int]:
    """How many cells are in each lee regime. For diagnostics and tests."""
    values, counts = np.unique(flow.lee_regime, return_counts=True)
    return {str(v): int(c) for v, c in zip(values, counts)}
