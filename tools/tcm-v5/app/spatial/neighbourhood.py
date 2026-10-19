"""What is around a cell, at more than one scale.

Step 8 of the Stage 8 order, sections 33 to 35, 44 and 64.

Section 33 is careful about what "neighbourhood" must not mean:

    Do not blindly average neighbouring cells. Spatial gradients often
    contain important meteorological information.

The averaging trap is real and it is subtle. Smoothing CAPE over 25 km makes
a prettier field and destroys the thing that mattered -- the edge of the
unstable air, where the storms actually go. So every quantity here is
reported as a TRIPLE:

    mean       what the surroundings are like
    gradient   how fast that is changing
    range      how different the extremes are

The mean alone is the destructive one. The gradient and the range are what
say "this cell is on the edge of something", which no single-cell value and
no smoothed value can express.

THE SCALES
----------
Section 34 requires justification rather than round numbers, and the three
scales are inherited from `terrain.py` so that a terrain feature and a
thermodynamic feature at "mesoscale" mean the same distance:

  LOCAL 2 km        one cell; the grid's own scale
  EFFECTIVE 12 km   what a 2 km model actually resolves, 5-7 dx
                    (Skamarock 2004; Ricard et al. 2013)
  MASSIF 30 km      the scale of a UK upland or a mesoscale
                    convective organisation

A fourth is added here because Stage 7 already fixed it:

  EVENT 10 km       the radius of the thunderstorm event definition. A
                    neighbourhood at exactly the verification radius is the
                    one that answers "will there be a storm within 10 km",
                    which is the question TCM is scored on. Section 64's
                    neighbourhood verification uses the same number, so the
                    feature and the score are on the same footing.

INTERACTIONS
------------
Section 44 asks for interaction features -- CAPE x terrain forcing, moisture
x convergence -- and immediately forbids turning them into arbitrary
multiplicative scores. The distinction that keeps both: an interaction is
formed only where the product is PHYSICALLY a quantity.

    moisture flux convergence = -div(q V)     kg/kg/s -- a real flux
    CAPE x upslope            = J/kg x m/s    -- energy times a lift rate,
                                                 which is a power per unit
                                                 mass and does mean
                                                 something

`interactions` builds those. It does not build "instability x sea-breeze
potential", because a sea-breeze potential is not a physical quantity and
the product would be a score wearing a unit. Where the useful combination
is not a product, the two features are simply both provided and the model
downstream is left to learn the relationship -- which is what section 44
actually asks for.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .feature import Lineage, Provenance, Quality, SpatialFeature
from .static import PROCESSING_VERSION
from .terrain import SCALE_EFFECTIVE_M, SCALE_LOCAL_M, SCALE_MASSIF_M, gradient

log = logging.getLogger(__name__)

#: The event radius from Stage 7's thunderstorm definition.
SCALE_EVENT_M = 10_000.0

#: Neighbourhood scales, smallest first. Shared with `terrain.py` so that a
#: distance means the same thing everywhere in Stage 8.
NEIGHBOURHOOD_SCALES: dict[str, float] = {
    "local": SCALE_LOCAL_M,
    "event": SCALE_EVENT_M,
    "effective": SCALE_EFFECTIVE_M,
    "massif": SCALE_MASSIF_M,
}


@dataclass(frozen=True, slots=True)
class Neighbourhood:
    """One field seen at one scale, as mean, gradient and range."""

    name: str
    scale: str
    scale_m: float
    mean: np.ndarray
    #: |grad| of the field, per metre of the field's own unit. The
    #: quantity section 35 asks for.
    gradient_magnitude: np.ndarray
    #: Max minus min within the window. Catches a sharp local structure that
    #: a gradient computed at the grid scale can miss.
    range: np.ndarray
    #: Fraction of the window with finite data, 0-1. Below 1 at the domain
    #: edge and wherever the source field had gaps.
    coverage: np.ndarray
    unit: str


def _disc(radius_m: float, spacing_m: float) -> np.ndarray:
    half = max(1, int(round(radius_m / spacing_m)))
    yy, xx = np.mgrid[-half:half + 1, -half:half + 1]
    disc = ((xx * xx + yy * yy) <= half * half).astype("float64")
    return disc / disc.sum()


def summarise(
    field: np.ndarray, *, name: str, unit: str, spacing_m: float,
    scales: dict[str, float] | None = None,
) -> dict[str, Neighbourhood]:
    """Every scale's view of one field."""
    from scipy.ndimage import convolve, maximum_filter, minimum_filter

    scales = scales or NEIGHBOURHOOD_SCALES
    values = np.asarray(field, "float64")
    finite = np.isfinite(values)
    filled = np.where(finite, values, 0.0)

    dx, dy = gradient(np.where(finite, values, np.nan), spacing_m)
    magnitude = np.hypot(dx, dy)

    out: dict[str, Neighbourhood] = {}
    for scale_name, radius in scales.items():
        if radius <= spacing_m:
            out[scale_name] = Neighbourhood(
                name=name, scale=scale_name, scale_m=radius,
                mean=values, gradient_magnitude=magnitude,
                range=np.zeros_like(values),
                coverage=finite.astype("float64"), unit=unit,
            )
            continue

        kernel = _disc(radius, spacing_m)
        weight = convolve(finite.astype("float64"), kernel, mode="nearest")
        total = convolve(filled, kernel, mode="nearest")
        with np.errstate(invalid="ignore", divide="ignore"):
            mean = np.where(weight > 1e-9, total / weight, np.nan)

        size = 2 * max(1, int(round(radius / spacing_m))) + 1
        # A NaN must not win a maximum or a minimum, so gaps are filled
        # with the opposite extreme for each pass.
        hi = maximum_filter(np.where(finite, values, -np.inf), size=size,
                            mode="nearest")
        lo = minimum_filter(np.where(finite, values, np.inf), size=size,
                            mode="nearest")
        spread = np.where(np.isfinite(hi) & np.isfinite(lo), hi - lo, np.nan)

        # The gradient AT the scale: how much the neighbourhood mean itself
        # changes from place to place. This is the transition-zone
        # detector -- a cell can sit in uniform local conditions and still
        # be on the edge of a mesoscale change.
        mdx, mdy = gradient(mean, spacing_m)
        out[scale_name] = Neighbourhood(
            name=name, scale=scale_name, scale_m=radius, mean=mean,
            gradient_magnitude=np.hypot(mdx, mdy), range=spread,
            coverage=weight, unit=unit,
        )
    return out


def features(
    summaries: dict[str, dict[str, Neighbourhood]], *,
    model: str = "", run=None, valid_time=None, member: int | None = None,
) -> dict[str, SpatialFeature]:
    """Neighbourhood summaries as named features.

    Named `<field>_<statistic>_<scale>`, e.g. `cape_gradient_event`, so a
    consumer can ask for exactly the scale it wants and cannot silently get
    a different one.
    """
    out: dict[str, SpatialFeature] = {}
    for field_name, by_scale in summaries.items():
        for scale_name, n in by_scale.items():
            def provenance(method: str) -> Provenance:
                return Provenance(
                    method=method, inputs=(field_name,), model=model, run=run,
                    valid_time=valid_time, member=member, scale_m=n.scale_m,
                    processing_version=PROCESSING_VERSION,
                )

            base = f"{field_name}_{{}}_{scale_name}"
            out[base.format("mean")] = SpatialFeature(
                name=base.format("mean"), values=n.mean, unit=n.unit,
                quality=Quality.GOOD, lineage=Lineage.FORECAST,
                provenance=provenance("disc_mean"),
                flags=("a mean ALONE hides the edge of a feature; the "
                       "gradient and range at the same scale are what "
                       "locate transitions",),
            )
            out[base.format("gradient")] = SpatialFeature(
                name=base.format("gradient"), values=n.gradient_magnitude,
                unit=f"{n.unit}/m", quality=Quality.GOOD,
                lineage=Lineage.FORECAST,
                provenance=provenance("gradient_of_disc_mean"),
            )
            out[base.format("range")] = SpatialFeature(
                name=base.format("range"), values=n.range, unit=n.unit,
                quality=Quality.GOOD, lineage=Lineage.FORECAST,
                provenance=provenance("window_max_minus_min"),
            )
    return out


def interactions(
    fields: dict[str, np.ndarray], spacing_m: float
) -> dict[str, tuple[np.ndarray, str, str]]:
    """Section 44's interaction features, as physical quantities only.

    Returns name -> (values, unit, what it means). Each entry is a product
    that IS a physical quantity; combinations that would only be a score
    wearing a unit are not built here, and the two ingredients are exposed
    separately instead.
    """
    out: dict[str, tuple[np.ndarray, str, str]] = {}

    cape = fields.get("cape")
    upslope = fields.get("upslope_flow")
    if cape is not None and upslope is not None:
        out["cape_upslope_power"] = (
            np.asarray(cape) * np.asarray(upslope), "W/kg",
            "available energy times the rate terrain is lifting air into "
            "it: the power per unit mass the orography is feeding to "
            "convection",
        )

    cin = fields.get("cin")
    if cin is not None and upslope is not None:
        # How long the terrain needs to lift a parcel through its own
        # inhibition. |CIN| is an energy per unit mass, and w gives the rate
        # at which lifting supplies it.
        with np.errstate(invalid="ignore", divide="ignore"):
            values = np.where(
                np.asarray(upslope) > 1e-6,
                np.abs(np.asarray(cin)) / np.maximum(np.asarray(upslope), 1e-6),
                np.inf,
            )
        out["terrain_cap_removal_time"] = (
            values, "s",
            "how long the terrain's lift must persist to work through the "
            "inhibition. Infinite where there is no upslope flow, which is "
            "the correct answer rather than a large number",
        )

    q = fields.get("humidity")
    u, v = fields.get("u"), fields.get("v")
    if q is not None and u is not None and v is not None:
        from .boundaries import moisture_flux_convergence
        out["moisture_flux_convergence"] = (
            moisture_flux_convergence(q, u, v, spacing_m), "1/s",
            "the flow both converging on existing moisture and carrying "
            "more in; a genuine flux, not a product of two scores",
        )
    return out
