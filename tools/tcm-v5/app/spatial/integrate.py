"""Feeding Stage 8 into the stages that already exist.

Step 11 of the Stage 8 order, sections 61 and 67.

Section 61 is the rule this module implements:

    Stage 8 should FEED spatial information into Stages 5, 6 and 7. It
    should NOT create an entirely separate final thunderstorm score.

So there is no score here, and nothing here computes a probability. Three
one-directional handovers, each into an interface the receiving stage
already defined:

    Stage 5   the forcing features its initiation engine has been asking
              for since it was written, and could never be given
    Stage 6   a geographic stratification key, and nothing else
    Stage 7   spatial structure for provenance and neighbourhood context

WHAT THIS UNBLOCKS
------------------
The Stage 5 initiation engine was built to consume `convergence`,
`frontogenesis`, `moisture_flux_convergence` and `vertical_velocity`, and
was explicit that a point evaluation cannot supply them:

    Convergence, frontogenesis and vertical velocity are horizontal-field
    quantities. A point evaluation has no neighbours, so they are recorded
    as unavailable with that as the reason -- NOT as zero, which would tell
    every initiation engine that there is no forcing anywhere.

Having no forcing capped that engine at `NO_FORCING_CEILING = 0.45`, and
because Stage 7 multiplies its realisation term through, the cap propagated
all the way to the final thunderstorm probability. Stage 8 computes exactly
those four quantities on the grid, so the cap can lift -- not because the
ceiling was raised, but because the missing evidence arrived.

That is also the honest test of whether this stage is worth anything, and
`ablation.py` measures it rather than assuming it.

NO REGIONAL WEIGHTS PASS THROUGH HERE
-------------------------------------
Section 67 says Stage 6 remains responsible for the learned weighting and
that Stage 8 must not duplicate it. `stage6_context` therefore returns a
STRING KEY and a geographic description. There is no number in it that
could be mistaken for a weight, and a test asserts the returned mapping
contains no float that varies by region name.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .boundaries import BoundaryType
from .intelligence import SpatialIntelligence

log = logging.getLogger(__name__)

#: Stage 5's forcing feature names, and the Stage 8 feature that supplies
#: each. The left-hand names are fixed by `engines/features.py`; changing
#: them here would silently stop feeding the engine rather than fail.
STAGE5_FORCING: dict[str, str] = {
    "convergence": "convergence",
    "frontogenesis": "frontogenesis_gradient",
    "moisture_flux_convergence": "moisture_flux_convergence",
    "vertical_velocity": "orographic_ascent",
}


@dataclass(frozen=True, slots=True)
class PointForcing:
    """The forcing at one grid cell, ready for Stage 5.

    Every value is either a real number in the stated unit or None with a
    reason. None means "not computed here", never "zero forcing" -- the
    distinction the initiation engine's ceiling exists to protect.
    """

    values: dict[str, float | None]
    reasons: dict[str, str]
    #: Spatial context that is not forcing but that Stage 5's engines can
    #: use: distance to the nearest boundary, terrain exposure, and so on.
    context: dict[str, float | None]

    def as_overrides(self) -> dict[str, float]:
        """Only the values that exist, for merging into a feature set."""
        return {k: v for k, v in self.values.items() if v is not None}


def stage5_forcing(
    si: SpatialIntelligence, iy: int, ix: int
) -> PointForcing:
    """Pull the forcing quantities Stage 5 needs at one cell.

    `vertical_velocity` is supplied as the TERRAIN-FORCED ascent, not the
    model's own omega. That is deliberate and it is a limitation worth
    stating: the model's vertical velocity includes everything -- fronts,
    convection already happening in the model, gravity waves -- and feeding
    it to an initiation engine risks the engine reading the model's own
    convection back as evidence that convection will initiate. The
    orographic term is clean, because it is computed from the wind and the
    ground rather than from the model's own dynamics.
    """
    values: dict[str, float | None] = {}
    reasons: dict[str, str] = {}

    for stage5_name, feature_name in STAGE5_FORCING.items():
        feature = si.features.get(feature_name)
        if feature is None or not feature.usable:
            values[stage5_name] = None
            reasons[stage5_name] = (
                feature.reason if feature is not None
                else f"Stage 8 did not produce {feature_name}"
            )
            continue
        value = feature.at(iy, ix)
        values[stage5_name] = value
        reasons[stage5_name] = (
            "" if value is not None
            else f"{feature_name} is not valid at this cell"
        )

    # Sea-breeze convergence is a SEPARATE forcing mechanism from the
    # ordinary convergence field, and adding the two would double-count the
    # same air. It is offered under its own name so an engine can use it
    # explicitly.
    breeze = si.features.get("sea_breeze_convergence")
    if breeze is not None and breeze.usable:
        values["sea_breeze_convergence"] = breeze.at(iy, ix)
        reasons["sea_breeze_convergence"] = ""
    else:
        values["sea_breeze_convergence"] = None
        reasons["sea_breeze_convergence"] = (
            breeze.reason if breeze is not None
            else "no sea-breeze diagnostic was produced"
        )

    context: dict[str, float | None] = {}
    for name in (
        "elevation", "slope_degrees", "distance_to_coast",
        "marine_exposure", "upslope_flow", "downslope_flow",
        "terrain_convergence", "upwind_barrier", "froude_number",
        "land_sea_contrast", "boundary_agreement", "terrain_anisotropy",
        "flow_ridge_alignment",
    ):
        feature = si.features.get(name)
        context[name] = feature.at(iy, ix) if feature and feature.usable else None
    for kind in BoundaryType:
        feature = si.features.get(f"distance_to_{kind.value}")
        if feature is not None and feature.usable:
            value = feature.at(iy, ix)
            context[f"distance_to_{kind.value}"] = (
                value if value is not None and np.isfinite(value) else None
            )
    return PointForcing(values=values, reasons=reasons, context=context)


def stage6_context(si: SpatialIntelligence, lon: float, lat: float) -> dict:
    """Geographic stratification context for Stage 6. No weights.

    Section 67: Stage 6 owns the learned weighting; this supplies only the
    stratum to learn it against, plus the geography that explains why one
    stratum might differ from another.
    """
    from . import regional as R

    region = R.region_of(lon, lat)
    if region is None:
        return {
            "region": None, "parent": None, "skill_key": None,
            "note": (
                "outside every analysis region; Stage 6 should fall back to "
                "its domain-wide skill estimate"
            ),
        }
    context = si.regional_context.get(region.name)
    out = {
        "region": region.name,
        "parent": region.parent,
        "skill_key": f"region:{region.name}",
        "parent_key": f"country:{region.parent}",
        "note": (
            "a stratification key and a geographic description. Stage 6 "
            "computes the weighting; nothing here is or becomes a weight"
        ),
    }
    if context is not None:
        out["geography"] = context.to_dict()
    return out


def stage7_context(si: SpatialIntelligence, iy: int, ix: int) -> dict:
    """Spatial structure for the final forecast's provenance.

    Section 68 wants outputs designed so spatial skill can eventually be
    verified. What Stage 7 needs for that is not more probability -- it is
    the ability to say WHERE the forecast thinks the structure is, so a
    displacement can be measured later.
    """
    nearby = []
    for obj in si.spatial_objects:
        if obj.mask is None or not bool(obj.mask[iy, ix]):
            continue
        nearby.append(obj.to_dict())

    distances: dict[str, float | None] = {}
    for kind, field in si.distances.items():
        value = float(field[iy, ix])
        distances[kind] = value if np.isfinite(value) else None

    return {
        "on_boundary": nearby,
        "distance_to_nearest_m": distances,
        "effective_resolution_note": (
            "spatial structure is resolved at the model's effective "
            "resolution, roughly 12 km for a 2 km model, not at the grid "
            "spacing. A boundary's position carries that uncertainty"
        ),
        "objects_detected": len(si.spatial_objects),
    }


def apply_to_features(
    features: dict, forcing: PointForcing
) -> tuple[dict, list[str]]:
    """Merge Stage 8 forcing into a Stage 5 feature set.

    Returns the updated features and a list of what was filled in. Only
    fills features Stage 5 recorded as UNAVAILABLE: a value the profile
    genuinely supplied is never overwritten by a gridded estimate of the
    same thing, because the profile's own value is the more direct
    measurement and silently replacing it would make the two paths disagree
    for no visible reason.
    """
    filled: list[str] = []
    for name, value in forcing.as_overrides().items():
        existing = features.get(name)
        if existing is None:
            continue
        if getattr(existing, "available", False):
            continue
        replacement = _with_value(existing, value)
        if replacement is not None:
            features[name] = replacement
            filled.append(name)
    return features, filled


def _with_value(feature, value: float):
    """Copy a Stage 5 feature with a value filled in, if it supports it."""
    import dataclasses

    if not dataclasses.is_dataclass(feature):
        return None
    fields = {f.name for f in dataclasses.fields(feature)}
    changes: dict = {}
    if "value" in fields:
        changes["value"] = value
    else:
        return None
    if "reason" in fields:
        changes["reason"] = ""
    if "source" in fields:
        changes["source"] = "stage8_spatial"
    try:
        return dataclasses.replace(feature, **changes)
    except (TypeError, ValueError):
        return None
