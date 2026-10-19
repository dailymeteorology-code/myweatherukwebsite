"""Shared intermediate features.

Several engines need the same physical concept. Computing "storm depth" three
times in three modules guarantees three slightly different definitions, and
the first sign of it is two engines disagreeing for no visible reason. So each
concept is computed ONCE here, named once, and carries its own availability.

Everything is derived from Stage 4 diagnostics. Nothing here re-derives
meteorology from profiles -- that is Stage 4's job, and duplicating it would
put two versions of the same calculation in the platform.

A feature that cannot be computed is ABSENT from the mapping rather than
present as zero, so an engine reading it gets `None` and must decide what to
do, instead of silently treating a missing mid-level humidity as a bone-dry
one.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from ..parameters.engine import DerivedParameters

log = logging.getLogger(__name__)

#: Temperature bounds of the mixed-phase layer, degrees C. Charge separation
#: in the non-inductive graupel/ice mechanism is effective between roughly
#: -10 and -25 C (Takahashi 1978; Saunders 1993), and hail grows through a
#: similar band. Used for both, with the source stated at each use.
MIXED_PHASE_C = (-10.0, -25.0)


@dataclass(slots=True)
class Feature:
    """One shared value, with where it came from."""

    name: str
    value: float | None
    unit: str
    #: Stage 4 diagnostics it was built from.
    sources: tuple[str, ...] = ()
    #: Why it is None, when it is.
    reason: str = ""

    @property
    def available(self) -> bool:
        return self.value is not None and np.isfinite(self.value)

    def to_dict(self) -> dict:
        return {
            "value": (
                round(float(self.value), 4) if self.available else None
            ),
            "unit": self.unit,
            "sources": list(self.sources),
            "reason": self.reason,
        }


@dataclass(slots=True)
class FeatureSet:
    """The shared features for one point and time."""

    items: dict[str, Feature] = dc_field(default_factory=dict)

    def add(self, feature: Feature) -> Feature:
        self.items[feature.name] = feature
        return feature

    def get(self, name: str, default=None) -> float | None:
        found = self.items.get(name)
        if found is None or not found.available:
            return default
        return float(found.value)

    def feature(self, name: str) -> Feature | None:
        return self.items.get(name)

    def available(self, *names: str) -> bool:
        return all(
            (f := self.items.get(n)) is not None and f.available
            for n in names
        )

    def missing(self, *names: str) -> tuple[str, ...]:
        return tuple(
            n for n in names
            if (f := self.items.get(n)) is None or not f.available
        )

    def __contains__(self, name: str) -> bool:
        return name in self.items

    def to_dict(self) -> dict:
        return {n: f.to_dict() for n, f in self.items.items()}


def _v(parameters: DerivedParameters, name: str) -> float | None:
    return parameters.value(name)


def local_solar_hour(
    valid_time: datetime | None, longitude: float | None
) -> float | None:
    """Local solar hour, 0-24. None when either input is unknown.

    Solar rather than clock time: convection responds to the sun, not to
    British Summer Time. Longitude alone gives the offset -- 15 degrees per
    hour -- which over these longitudes is at most about 40 minutes from UTC
    and matters for a diurnal-timing argument.

    The equation of time is NOT applied: it reaches about 16 minutes, well
    inside the precision any diurnal reasoning here claims.
    """
    if valid_time is None or longitude is None:
        return None
    utc_hour = valid_time.hour + valid_time.minute / 60.0
    return float((utc_hour + longitude / 15.0) % 24.0)


def build_features(
    parameters: DerivedParameters, *, elevation: float | None = None
) -> FeatureSet:
    """Every shared feature derivable from one Stage 4 result."""
    out = FeatureSet()

    def add(name, value, unit, sources, reason=""):
        if value is not None and not np.isfinite(value):
            value, reason = None, reason or "not finite"
        return out.add(Feature(name, value, unit, tuple(sources), reason))

    # -- vertical extent of convection --------------------------------------
    lfc = _v(parameters, "lfc")
    el = _v(parameters, "el")
    lcl = _v(parameters, "lcl")

    add("storm_depth",
        (el - lfc) if (lfc is not None and el is not None) else None,
        "m", ("lfc", "el"),
        "" if (lfc is not None and el is not None)
        else "needs both LFC and EL; without an EL the cloud top is above "
             "the data and the depth is unknown")

    add("cloud_base", lcl, "m", ("lcl",),
        "" if lcl is not None else "no LCL")

    add("sub_cloud_depth", lcl, "m", ("lcl",),
        "" if lcl is not None
        else "the sub-cloud layer runs from the ground to the LCL, and there "
             "is no LCL")

    add("equilibrium_level", el, "m", ("el",),
        "" if el is not None else "no EL")

    # -- the mixed-phase and hail growth layers -----------------------------
    freezing = _v(parameters, "freezing_level")
    add("freezing_level", freezing, "m", ("freezing_level",),
        "" if freezing is not None else "no 0 C crossing in the column")

    cold_depth = _v(parameters, "cold_cloud_depth")
    add("cold_cloud_depth", cold_depth, "m", ("cold_cloud_depth",),
        "" if cold_depth is not None else "needs a freezing level and an EL")

    warm_depth = _v(parameters, "warm_cloud_depth")
    add("warm_cloud_depth", warm_depth, "m", ("warm_cloud_depth",),
        "" if warm_depth is not None else "needs a freezing level and an LCL")

    # Depth of cloud between the freezing level and the EL is the closest
    # available proxy for the mixed-phase layer without a temperature-height
    # lookup at -10 and -25 C. Named for what it IS, not for what it proxies.
    add("glaciated_depth", cold_depth, "m", ("cold_cloud_depth",),
        "" if cold_depth is not None
        else "no glaciated cloud depth; needs freezing level and EL")

    wbz = _v(parameters, "wet_bulb_zero")
    add("wet_bulb_zero", wbz, "m", ("wet_bulb_zero",),
        "" if wbz is not None else "wet-bulb temperature does not cross 0 C")

    # -- instability, kept per parcel ---------------------------------------
    for parcel in ("sb", "ml", "mu"):
        cape = _v(parameters, f"{parcel}cape")
        cin = _v(parameters, f"{parcel}cin")
        add(f"{parcel}cape", cape, "J/kg", (f"{parcel}cape",),
            "" if cape is not None else f"{parcel}cape unavailable")
        add(f"{parcel}cin", cin, "J/kg", (f"{parcel}cin",),
            "" if cin is not None
            else "no LFC, so inhibition is undefined for this parcel")

    # -- moisture structure --------------------------------------------------
    entrainment = parameters.get("entrainment_indicators")
    mid_rh = mid_min_rh = low_rh = contrast = None
    if entrainment.status.has_value:
        extra = entrainment.extra
        mid_rh = extra.get("mid_level_mean_rh_percent")
        mid_min_rh = extra.get("mid_level_min_rh_percent")
        low_rh = extra.get("low_level_mean_rh_percent")
        contrast = extra.get("low_to_mid_mixing_ratio_contrast_g_kg")
    reason = "" if mid_rh is not None else \
        "entrainment indicators unavailable: no humidity profile through " \
        "700-500 hPa"
    add("mid_level_rh", mid_rh, "%", ("entrainment_indicators",), reason)
    add("mid_level_min_rh", mid_min_rh, "%", ("entrainment_indicators",),
        reason)
    add("low_level_rh", low_rh, "%", ("entrainment_indicators",), reason)
    add("low_to_mid_moisture_contrast", contrast, "g/kg",
        ("entrainment_indicators",), reason)

    pw = _v(parameters, "precipitable_water")
    add("precipitable_water", pw, "kg/m2", ("precipitable_water",),
        "" if pw is not None else "no column moisture integral")

    bl_moisture = _v(parameters, "boundary_layer_moisture")
    add("boundary_layer_mixing_ratio",
        bl_moisture * 1000.0 if bl_moisture is not None else None,
        "g/kg", ("boundary_layer_moisture",),
        "" if bl_moisture is not None else "no boundary-layer moisture")

    # -- lapse rates ---------------------------------------------------------
    for name in ("lr_0_1km", "lr_0_3km", "lr_0_6km", "lr_850_500",
                 "lr_700_500"):
        value = _v(parameters, name)
        add(name, value, "K/km", (name,),
            "" if value is not None else f"{name} unavailable")

    # -- wind and organisation ----------------------------------------------
    for name in ("shear_0_1km", "shear_0_3km", "shear_0_6km", "shear_0_8km"):
        value = _v(parameters, name)
        add(name, value, "m/s", (name,),
            "" if value is not None else f"{name} unavailable")

    for name in ("srh_0_1km", "srh_0_3km", "effective_srh"):
        value = _v(parameters, name)
        add(name, value, "m2/s2", (name,),
            "" if value is not None else f"{name} unavailable")

    # Storm-relative inflow: the low-level storm-relative wind, which governs
    # how much air a storm can ingest. Taken from the storm-relative flow
    # profile rather than recomputed, so there is ONE storm motion in the
    # system and every engine inherits it.
    flow = parameters.get("storm_relative_flow")
    inflow = anvil = None
    motion_method = ""
    if flow.status.has_value:
        profile = flow.extra.get("profile", [])
        motion_method = flow.extra.get("storm_motion", {}).get("method", "")
        for level in profile:
            if level.get("height_m") == 1000.0:
                inflow = level.get("speed_m_s")
            if level.get("height_m") in (6000.0, 8000.0):
                anvil = level.get("speed_m_s")
    add("storm_relative_inflow_1km", inflow, "m/s",
        ("storm_relative_flow",),
        "" if inflow is not None
        else "no storm-relative flow at 1 km; needs a storm motion and a "
             "hodograph")
    add("storm_relative_anvil_flow", anvil, "m/s", ("storm_relative_flow",),
        "" if anvil is not None else "no storm-relative flow aloft")
    if motion_method:
        out.items["storm_relative_inflow_1km"].reason = (
            out.items["storm_relative_inflow_1km"].reason
        )

    brn = _v(parameters, "bulk_richardson_number")
    add("bulk_richardson_number", brn, "dimensionless",
        ("bulk_richardson_number",),
        "" if brn is not None else "BRN unavailable")

    # -- boundary layer ------------------------------------------------------
    pbl = _v(parameters, "pbl_depth")
    add("pbl_depth", pbl, "m", ("pbl_depth",),
        "" if pbl is not None else "no boundary-layer depth")

    bl_temp = _v(parameters, "boundary_layer_temperature")
    add("boundary_layer_temperature", bl_temp, "K",
        ("boundary_layer_temperature",),
        "" if bl_temp is not None else "no boundary-layer temperature")

    # LCL relative to the boundary layer top. A cloud base ABOVE the mixed
    # layer means surface thermals cannot reach saturation, however unstable
    # the profile looks: the single most common reason a promising-looking
    # UK sounding produces nothing.
    if lcl is not None and pbl is not None:
        add("lcl_above_pbl", lcl - pbl, "m", ("lcl", "pbl_depth"))
    else:
        add("lcl_above_pbl", None, "m", ("lcl", "pbl_depth"),
            "needs both an LCL and a boundary-layer depth")

    # -- downdraught ---------------------------------------------------------
    dcape = _v(parameters, "dcape")
    add("dcape", dcape, "J/kg", ("dcape",),
        "" if dcape is not None else "no DCAPE")

    # Sub-cloud dew-point depression drives evaporative cooling in a
    # downdraught. Approximated by the low-level humidity deficit, which is
    # what Stage 4 exposes.
    add("low_level_dryness",
        (100.0 - low_rh) if low_rh is not None else None,
        "%", ("entrainment_indicators",),
        "" if low_rh is not None else "no low-level humidity")

    add("mid_level_dryness",
        (100.0 - mid_rh) if mid_rh is not None else None,
        "%", ("entrainment_indicators",),
        "" if mid_rh is not None else "no mid-level humidity")

    # -- terrain -------------------------------------------------------------
    add("elevation", elevation, "m", ("terrain_height",),
        "" if elevation is not None
        else "the model did not publish terrain height for this run")

    # -- forcing (grid-derived; absent for a point evaluation) ---------------
    # Convergence, frontogenesis and vertical velocity are horizontal-field
    # quantities. A point evaluation has no neighbours, so they are recorded
    # as unavailable with that as the reason -- NOT as zero, which would tell
    # every initiation engine that there is no forcing anywhere.
    for name, unit in (
        ("convergence", "s-1"), ("frontogenesis", "K/m/s"),
        ("moisture_flux_convergence", "kg/kg/s"),
        ("vertical_velocity", "native"),
    ):
        diagnostic = parameters.get(name)
        value = None
        reason = (
            f"{name} is a horizontal-field quantity and this is a point "
            f"evaluation with no neighbouring cells"
        )
        if diagnostic.status.has_value and diagnostic.value is not None:
            try:
                candidate = float(np.asarray(diagnostic.value).reshape(-1)[0])
                if np.isfinite(candidate):
                    value, reason = candidate, ""
            except (TypeError, ValueError, IndexError):
                pass
        add(name, value, unit, (name,), reason)

    return out
