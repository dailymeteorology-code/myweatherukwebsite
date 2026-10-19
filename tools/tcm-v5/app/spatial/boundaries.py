"""Mesoscale boundary detection.

Step 6 of the Stage 8 order, sections 23 to 32.

Section 24 states the trap directly: a front is not "temperature gradient
above X". Every warm afternoon has temperature gradients. What makes a
boundary is that several independent things change across the SAME line, and
that the line is a line -- coherent, elongated, and narrow relative to its
length.

So detection here has three stages, and the arbitrariness that a single
threshold would carry is spread across all three where it can be checked:

  1. EVIDENCE, in physical units. Temperature gradient in K/m, moisture
     gradient in kg/kg/m, wind shift in s-1, convergence in s-1,
     frontogenesis in K/m/s. Nothing is scored.

  2. RIDGE EXTRACTION. A boundary sits on a local maximum of the gradient
     magnitude, in the direction the gradient points. Non-maximum
     suppression along the gradient direction -- the same operation the
     Canny edge detector uses -- turns a broad gradient zone into a line one
     cell wide, WITHOUT needing a magnitude threshold to do it. This is what
     separates "there is a gradient here" from "there is a boundary here":
     a broad synoptic gradient has no ridge, and section 26 asks exactly
     that distinction to be made.

  3. AGREEMENT. A front is declared where several evidence types have
     ridges in the same place. The number of agreeing types is reported, so
     a consumer can see that a boundary rests on temperature alone rather
     than on temperature, moisture, wind and frontogenesis together.

WIND DIRECTION DOES NOT SUBTRACT
--------------------------------
Section 28. A change from 359 degrees to 1 degree is a 2-degree shift, not
358. Nothing in this module ever subtracts two bearings: wind shift is
computed from the VECTOR difference, which has no wraparound to get wrong.
There is a test that plants exactly this case.

WHAT IS NOT HERE
----------------
Outflow boundaries (section 29) need observations -- a temperature drop and
pressure rise measured behind a storm, or radar. Model precipitation alone
is not evidence of a cold pool, and section 29 says so. `outflow` therefore
exists as an interface that returns UNAVAILABLE until an observational
source is supplied, and is marked OBSERVATION lineage when one is, so that
`check_forecast_safe` will refuse it in a historical reconstruction.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np

from .feature import (
    Lineage, Provenance, Quality, SpatialFeature, unavailable,
)
from .static import PROCESSING_VERSION
from .terrain import gradient

log = logging.getLogger(__name__)

#: Minimum number of independent evidence types that must agree before a
#: structure is called a FRONT rather than a single-field gradient. Three
#: because a front is, by definition, a boundary between air masses: it must
#: show in the temperature, in the moisture, AND in the wind. Two of those
#: can coincide without an air-mass change -- a sea breeze shifts wind and
#: temperature but not always theta-e -- so two is not enough to claim a
#: front, though it is enough to claim a boundary.
FRONT_EVIDENCE_REQUIRED = 3

#: A structure narrower than this many cells across cannot be resolved as a
#: line by a grid. Two: one cell cannot have a width at all.
MIN_LINE_WIDTH_CELLS = 2


class BoundaryType(str, Enum):
    """What kind of boundary a structure is, by the evidence behind it."""

    FRONT = "front"
    CONVERGENCE_LINE = "convergence_line"
    MOISTURE_BOUNDARY = "moisture_boundary"
    TEMPERATURE_BOUNDARY = "temperature_boundary"
    WIND_SHIFT = "wind_shift"
    SEA_BREEZE = "sea_breeze"
    OUTFLOW = "outflow"
    TERRAIN_DRIVEN = "terrain_driven"


class GradientScale(str, Enum):
    """How broad a gradient is. Section 26 asks for this distinction.

    Measured as the width of the gradient zone around its ridge, not
    assumed: a synoptic baroclinic zone is hundreds of kilometres wide and
    is not a mesoscale boundary however strong it is.
    """

    LOCAL = "local"          # under 10 km
    MESOSCALE = "mesoscale"  # 10-100 km
    SYNOPTIC = "synoptic"    # over 100 km


@dataclass(frozen=True, slots=True)
class GradientField:
    """The gradient of one scalar, with everything needed to find a ridge."""

    name: str
    #: Gradient components per metre of whatever unit the scalar had.
    dx: np.ndarray
    dy: np.ndarray
    #: |grad|, per metre.
    magnitude: np.ndarray
    #: Direction the gradient points, degrees from north. Toward INCREASING
    #: values.
    bearing: np.ndarray
    unit: str

    def ridge(self) -> np.ndarray:
        """Cells on a local maximum of |grad| along the gradient direction.

        Non-maximum suppression. Interpolating the neighbours either side
        along the gradient and keeping only cells at least as large as both
        gives a line one cell wide with NO magnitude threshold involved --
        the shape does the work, not a cut-off.
        """
        return _non_maximum_suppression(self.magnitude, self.dx, self.dy)


def scalar_gradient(
    field: np.ndarray, spacing_m: float, name: str, unit: str
) -> GradientField:
    """Gradient of a scalar field, in units per metre."""
    dx, dy = gradient(np.asarray(field, "float64"), spacing_m)
    magnitude = np.hypot(dx, dy)
    with np.errstate(invalid="ignore"):
        bearing = np.degrees(np.arctan2(dx, dy)) % 360.0
    bearing = np.where(magnitude > 0, bearing, np.nan)
    return GradientField(
        name=name, dx=dx, dy=dy, magnitude=magnitude, bearing=bearing,
        unit=f"{unit}/m",
    )


def noise_floor(field: np.ndarray, spacing_m: float) -> float:
    """A robust estimate of the numerical noise in a differenced field.

    Non-maximum suppression finds every local maximum, including the ones
    made of arithmetic. On the live 2 km convergence field that produced
    2,055 "convergence lines" across the domain -- one for every ripple in a
    field whose small-scale content is finite-difference noise, not weather.

    The floor is estimated from the field itself, so it is not a tuning
    parameter: the high-pass component (the field minus a 3-cell smooth) is
    dominated by noise at the grid scale, and its median absolute deviation
    scaled by 1/0.6745 is the standard robust estimate of that noise's
    standard deviation. A ridge below one sigma of it is not distinguishable
    from the differencing.
    """
    from scipy.ndimage import uniform_filter

    values = np.asarray(field, "float64")
    finite = np.isfinite(values)
    if not finite.any():
        return 0.0
    smooth = uniform_filter(np.where(finite, values, 0.0), size=3,
                            mode="nearest")
    high_pass = np.where(finite, values - smooth, np.nan)
    mad = np.nanmedian(np.abs(high_pass - np.nanmedian(high_pass)))
    return float(mad / 0.6745) if np.isfinite(mad) else 0.0


def _non_maximum_suppression(
    magnitude: np.ndarray, dx: np.ndarray, dy: np.ndarray
) -> np.ndarray:
    """True on cells that are a local maximum along the gradient direction."""
    from scipy.ndimage import map_coordinates

    norm = np.hypot(dx, dy)
    with np.errstate(invalid="ignore", divide="ignore"):
        ux = np.where(norm > 1e-30, dx / norm, 0.0)
        uy = np.where(norm > 1e-30, dy / norm, 0.0)

    rows, cols = np.indices(magnitude.shape).astype("float64")
    filled = np.nan_to_num(magnitude, nan=0.0)
    forward = map_coordinates(
        filled, [rows + uy, cols + ux], order=1, mode="nearest"
    )
    backward = map_coordinates(
        filled, [rows - uy, cols - ux], order=1, mode="nearest"
    )
    return (
        (filled >= forward) & (filled >= backward)
        & (norm > 1e-30) & np.isfinite(magnitude)
    )


def wind_shift(
    u: np.ndarray, v: np.ndarray, spacing_m: float
) -> np.ndarray:
    """Magnitude of the horizontal wind VECTOR change, per second.

    Section 28's wraparound problem does not arise, because directions are
    never subtracted. The quantity is

        sqrt(|du/dx|^2 + |du/dy|^2 + |dv/dx|^2 + |dv/dy|^2)

    which is the Frobenius norm of the wind gradient tensor: it counts every
    way the wind vector changes with position, including a pure direction
    change at constant speed, and it cannot see a 359-to-1 degree transition
    as anything other than the small change it is.
    """
    du_dx, du_dy = gradient(np.asarray(u, "float64"), spacing_m)
    dv_dx, dv_dy = gradient(np.asarray(v, "float64"), spacing_m)
    return np.sqrt(du_dx**2 + du_dy**2 + dv_dx**2 + dv_dy**2)


def divergence(
    u: np.ndarray, v: np.ndarray, spacing_m: float
) -> np.ndarray:
    """du/dx + dv/dy, per second. NEGATIVE is convergence."""
    du_dx, _ = gradient(np.asarray(u, "float64"), spacing_m)
    _, dv_dy = gradient(np.asarray(v, "float64"), spacing_m)
    return du_dx + dv_dy


def convergence(u: np.ndarray, v: np.ndarray, spacing_m: float) -> np.ndarray:
    """-(du/dx + dv/dy), per second. POSITIVE is convergence.

    The sign is flipped from `divergence` deliberately, because every
    consumer of this asks "how much convergence is there" and a diagnostic
    whose favourable direction is negative invites exactly one class of
    silent sign error.
    """
    return -divergence(u, v, spacing_m)


def moisture_flux_convergence(
    q: np.ndarray, u: np.ndarray, v: np.ndarray, spacing_m: float
) -> np.ndarray:
    """-div(q V), per second, in mixing-ratio units.

    Two terms with different meanings: the flow converging on existing
    moisture, and the flow carrying moisture into the cell. Both matter, and
    computing the divergence of the product keeps them together rather than
    losing the advective half.
    """
    q = np.asarray(q, "float64")
    qu_dx, _ = gradient(q * np.asarray(u, "float64"), spacing_m)
    _, qv_dy = gradient(q * np.asarray(v, "float64"), spacing_m)
    return -(qu_dx + qv_dy)


def frontogenesis(
    theta: np.ndarray, u: np.ndarray, v: np.ndarray, spacing_m: float
) -> np.ndarray:
    """Petterssen 2-D frontogenesis, K/m/s.

    The rate at which the flow is tightening or relaxing the gradient of a
    conserved thermal variable:

        F = -(1/|grad T|) [ Tx^2 ux + Tx Ty (vx + uy) + Ty^2 vy ]

    Positive is frontogenetic. This is the diagnostic that separates a
    gradient the flow is actively sharpening from one it is smearing out,
    which is what section 24 means by a coherent frontal boundary rather
    than an incidental contrast. Petterssen (1936); Miller (1948).

    Use with theta-e or wet-bulb potential temperature where possible: dry
    theta misses the moisture half of a UK front entirely.
    """
    theta = np.asarray(theta, "float64")
    tx, ty = gradient(theta, spacing_m)
    ux, uy = gradient(np.asarray(u, "float64"), spacing_m)
    vx, vy = gradient(np.asarray(v, "float64"), spacing_m)
    magnitude = np.hypot(tx, ty)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(
            magnitude > 1e-12,
            -(tx * tx * ux + tx * ty * (vx + uy) + ty * ty * vy) / magnitude,
            0.0,
        )


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class BoundaryInputs:
    """Fields the boundary detector can use. All optional but the wind.

    Every one that IS supplied becomes an independent line of evidence, and
    the count of agreeing evidence is what distinguishes a front from a
    gradient.
    """

    u: np.ndarray
    v: np.ndarray
    spacing_m: float
    #: Screen or low-level temperature, K.
    temperature: np.ndarray | None = None
    #: Equivalent or wet-bulb potential temperature, K. Far better than dry
    #: temperature for a UK front, which is as much a moisture boundary as
    #: a thermal one.
    theta_e: np.ndarray | None = None
    #: Specific humidity or mixing ratio, kg/kg.
    humidity: np.ndarray | None = None
    #: Terrain-forced convergence from `flow.py`, s-1, to be separated from
    #: the ordinary atmospheric convergence.
    terrain_convergence: np.ndarray | None = None
    #: Sea-breeze convergence from `seabreeze.py`, s-1.
    sea_breeze_convergence: np.ndarray | None = None
    model: str = ""
    run: datetime | None = None
    valid_time: datetime | None = None
    member: int | None = None


@dataclass(frozen=True, slots=True)
class BoundaryAnalysis:
    """Detected boundary structure across the grid."""

    #: Per-evidence ridge masks, keyed by evidence name.
    ridges: dict[str, np.ndarray]
    #: Per-evidence physical magnitude fields.
    evidence: dict[str, np.ndarray]
    #: How many evidence types have a ridge at each cell.
    agreement: np.ndarray
    #: Cells that qualify as a front: enough agreeing evidence.
    front: np.ndarray
    #: Convergence line: a ridge in convergence, whether or not thermal
    #: evidence agrees. Section 25 -- these exist without precipitation and
    #: without an air-mass change.
    convergence_line: np.ndarray
    #: Total low-level convergence, s-1, positive convergent.
    total_convergence: np.ndarray
    #: The part of it attributable to terrain, s-1. Section 10.
    terrain_convergence: np.ndarray | None
    #: Frontogenesis, K/m/s, when a thermal field was available.
    frontogenesis: np.ndarray | None
    #: How broad each cell's dominant gradient is.
    gradient_scale: np.ndarray
    inputs: BoundaryInputs
    gradients: dict[str, GradientField] = dc_field(default_factory=dict)


def detect(inputs: BoundaryInputs) -> BoundaryAnalysis:
    """Find boundary structure in one set of fields."""
    spacing = inputs.spacing_m
    gradients: dict[str, GradientField] = {}
    ridges: dict[str, np.ndarray] = {}
    evidence: dict[str, np.ndarray] = {}

    thermal = inputs.theta_e if inputs.theta_e is not None else inputs.temperature

    if inputs.temperature is not None:
        g = scalar_gradient(inputs.temperature, spacing, "temperature", "K")
        gradients["temperature"] = g
        ridges["temperature"] = g.ridge() & (
            g.magnitude > noise_floor(g.magnitude, spacing))
        evidence["temperature"] = g.magnitude
    if inputs.theta_e is not None:
        g = scalar_gradient(inputs.theta_e, spacing, "theta_e", "K")
        gradients["theta_e"] = g
        ridges["theta_e"] = g.ridge() & (
            g.magnitude > noise_floor(g.magnitude, spacing))
        evidence["theta_e"] = g.magnitude
    if inputs.humidity is not None:
        g = scalar_gradient(inputs.humidity, spacing, "humidity", "kg/kg")
        gradients["humidity"] = g
        ridges["humidity"] = g.ridge() & (
            g.magnitude > noise_floor(g.magnitude, spacing))
        evidence["humidity"] = g.magnitude

    shift = wind_shift(inputs.u, inputs.v, spacing)
    shift_field = GradientField(
        name="wind_shift", dx=shift, dy=np.zeros_like(shift),
        magnitude=shift, bearing=np.full(shift.shape, np.nan), unit="1/s",
    )
    # A scalar built from a tensor norm has no direction of its own, so the
    # ridge is taken along the gradient OF THE NORM.
    shift_grad = scalar_gradient(shift, spacing, "wind_shift", "1/s")
    ridges["wind_shift"] = (
        _non_maximum_suppression(shift, shift_grad.dx, shift_grad.dy)
        & (shift > noise_floor(shift, spacing))
    )
    evidence["wind_shift"] = shift
    gradients["wind_shift"] = shift_field

    total_convergence = convergence(inputs.u, inputs.v, spacing)
    conv_grad = scalar_gradient(
        total_convergence, spacing, "convergence", "1/s"
    )
    conv_noise = noise_floor(total_convergence, spacing)
    conv_ridge = (
        _non_maximum_suppression(total_convergence, conv_grad.dx, conv_grad.dy)
        & (total_convergence > conv_noise)
    )
    ridges["convergence"] = conv_ridge
    evidence["convergence"] = total_convergence

    fronto = None
    if thermal is not None:
        fronto = frontogenesis(thermal, inputs.u, inputs.v, spacing)
        f_grad = scalar_gradient(fronto, spacing, "frontogenesis", "K/m/s")
        ridges["frontogenesis"] = (
            _non_maximum_suppression(fronto, f_grad.dx, f_grad.dy)
            & (fronto > noise_floor(fronto, spacing))
        )
        evidence["frontogenesis"] = fronto

    agreement = np.zeros(inputs.u.shape, dtype=int)
    for mask in ridges.values():
        agreement = agreement + mask.astype(int)

    front = agreement >= FRONT_EVIDENCE_REQUIRED
    scale = _gradient_scale(
        gradients.get("theta_e") or gradients.get("temperature"), spacing
    )

    log.info(
        "boundaries: %d evidence types, %d front cells, %d convergence-line "
        "cells", len(ridges), int(front.sum()), int(conv_ridge.sum()),
    )
    return BoundaryAnalysis(
        ridges=ridges, evidence=evidence, agreement=agreement, front=front,
        convergence_line=conv_ridge, total_convergence=total_convergence,
        terrain_convergence=inputs.terrain_convergence,
        frontogenesis=fronto, gradient_scale=scale, inputs=inputs,
        gradients=gradients,
    )


def _gradient_scale(
    g: GradientField | None, spacing_m: float
) -> np.ndarray:
    """How broad the gradient zone is around each cell. Section 26.

    Measured, not assumed: the width is estimated from how far the gradient
    magnitude stays above half its local peak, which is the standard
    full-width-half-maximum idea applied to a field rather than a curve.
    A broad synoptic baroclinic zone and a sharp sea-breeze front can have
    the same peak gradient and are completely different objects.
    """
    if g is None:
        return np.full((1, 1), GradientScale.MESOSCALE.value, dtype=object)

    from scipy.ndimage import maximum_filter, uniform_filter

    shape = g.magnitude.shape
    out = np.full(shape, GradientScale.MESOSCALE.value, dtype=object)

    # Peak within a mesoscale window, and the fraction of that window that
    # is above half the peak. A wide zone fills its window; a sharp line
    # occupies a few cells of it.
    window = max(3, int(round(50_000.0 / spacing_m)))
    peak = maximum_filter(np.nan_to_num(g.magnitude), size=window)
    with np.errstate(invalid="ignore", divide="ignore"):
        above_half = (
            np.nan_to_num(g.magnitude) >= 0.5 * peak
        ).astype("float64")
    filled = uniform_filter(above_half, size=window, mode="nearest")

    out = np.where(filled > 0.5, GradientScale.SYNOPTIC.value,
                   np.where(filled > 0.15, GradientScale.MESOSCALE.value,
                            GradientScale.LOCAL.value)).astype(object)
    return out


def outflow(
    observations=None, *, model: str = "", run: datetime | None = None,
) -> SpatialFeature:
    """Cold-pool and gust-front detection. Section 29.

    Returns UNAVAILABLE without an observational source, and that is the
    correct answer rather than a limitation to apologise for: a cold pool is
    defined by a measured temperature drop, pressure rise and wind shift
    behind existing convection. Model precipitation is not evidence of one,
    and section 29 says so explicitly.

    When observations ARE supplied the resulting feature carries OBSERVATION
    lineage, so `check_forecast_safe` refuses it in any historical forecast
    reconstruction -- which is what stops outflow detection quietly turning
    TCM into a nowcasting system that is still being scored as a forecast
    model (sections 45 and 47).
    """
    if observations is None:
        return unavailable(
            "outflow_boundary", "1",
            "cold pools are defined by an observed temperature drop, "
            "pressure rise and wind shift behind existing convection. No "
            "observational source is connected, and model precipitation is "
            "not evidence of an outflow boundary",
            method="cold_pool_detection", model=model, run=run,
            processing_version=PROCESSING_VERSION,
        )
    raise NotImplementedError(
        "observational outflow detection is not implemented; the interface "
        "exists so that connecting a source is a change in one place"
    )


# --------------------------------------------------------------------------
# Presentation
# --------------------------------------------------------------------------

def features(analysis: BoundaryAnalysis) -> dict[str, SpatialFeature]:
    inputs = analysis.inputs

    def provenance(method: str, extra_inputs=()) -> Provenance:
        return Provenance(
            method=method, inputs=("u_wind", "v_wind") + tuple(extra_inputs),
            model=inputs.model, run=inputs.run, valid_time=inputs.valid_time,
            member=inputs.member, scale_m=inputs.spacing_m,
            processing_version=PROCESSING_VERSION,
        )

    def make(name, values, unit, method, *, extra_inputs=(), flags=(),
             quality=Quality.GOOD, reason=""):
        return SpatialFeature(
            name=name, values=values, unit=unit, quality=quality,
            lineage=Lineage.FORECAST,
            provenance=provenance(method, extra_inputs),
            reason=reason, flags=flags,
        )

    out: dict[str, SpatialFeature] = {}
    out["convergence"] = make(
        "convergence", analysis.total_convergence, "1/s",
        "negative_horizontal_divergence",
        flags=("positive is convergence",))
    out["wind_shift"] = make(
        "wind_shift", analysis.evidence["wind_shift"], "1/s",
        "frobenius_norm_of_wind_gradient_tensor",
        flags=("computed from vectors, so a 359-to-1 degree transition is "
               "the 2-degree shift it actually is",))
    out["boundary_agreement"] = make(
        "boundary_agreement", analysis.agreement.astype("float64"), "count",
        "co_located_evidence_ridges",
        flags=(f"how many independent fields have a boundary here; "
               f"{FRONT_EVIDENCE_REQUIRED} or more is called a front",))
    out["front"] = make(
        "front", analysis.front.astype("float64"), "1",
        "multi_evidence_ridge_agreement",
        flags=("a coherent air-mass boundary, not a single strong gradient",))
    out["convergence_line"] = make(
        "convergence_line", analysis.convergence_line.astype("float64"), "1",
        "non_maximum_suppression_on_convergence",
        flags=("may exist with no precipitation and no air-mass change",))

    for name, values in analysis.evidence.items():
        if name in ("wind_shift", "convergence"):
            continue
        unit = {
            "temperature": "K/m", "theta_e": "K/m", "humidity": "kg/kg/m",
            "frontogenesis": "K/m/s",
        }.get(name, "1")
        out[f"{name}_gradient"] = make(
            f"{name}_gradient", values, unit, "central_difference",
            extra_inputs=(name,))

    if analysis.terrain_convergence is not None:
        # Section 10: ordinary convergence and terrain-forced convergence are
        # different things and a consumer must be able to tell them apart.
        residual = analysis.total_convergence - analysis.terrain_convergence
        out["terrain_convergence_part"] = make(
            "terrain_convergence_part", analysis.terrain_convergence, "1/s",
            "continuity_from_orographic_ascent",
            extra_inputs=("terrain_height",),
            flags=("the part of the convergence the terrain forces",))
        out["non_terrain_convergence"] = make(
            "non_terrain_convergence", residual, "1/s",
            "total_convergence_minus_terrain_part",
            extra_inputs=("terrain_height",),
            flags=("convergence the terrain does NOT explain: fronts, sea "
                   "breezes and synoptic forcing",))
    return out
