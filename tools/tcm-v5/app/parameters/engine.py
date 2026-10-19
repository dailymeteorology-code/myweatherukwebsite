"""The Stage 4 engine: a Stage 3 profile in, a derived-parameter set out.

WHAT THIS IS NOT
----------------
There is no thunderstorm probability here, no risk score, no hazard
likelihood and no model weighting. The engine measures the atmosphere and
stops. Interpreting those measurements belongs to later stages, and the
boundary is enforced by a test asserting that no diagnostic name in the
output matches a risk vocabulary.

GRACEFUL DEGRADATION
--------------------
Every diagnostic is computed inside `_safe`, so one failure cannot take down
the set. If frontogenesis has no horizontal field, frontogenesis is
unavailable and CAPE is still computed. An unexpected exception becomes an
INVALID diagnostic carrying the exception text -- never a silent zero and
never a crash that loses the other forty results.

SHARED WORK
-----------
The dependency graph has two expensive shared nodes and each is computed
once:

    parcel_ascent(surface)    -> SBCAPE, SBCIN, LCL, LFC, EL, LI,
                                 cloud depths, BRN
    storm_motion(right)       -> SRH, effective SRH, storm-relative flow

Recomputing a surface parcel ascent per diagnostic would repeat the most
expensive calculation in the package six times over.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from typing import Callable

import numpy as np

from ..profiles.schema import Profile
from . import boundary, environment, indices, lapse, parcel as pc, wind
from .column import Column, column_from_profile
from .registry import REGISTRY
from .result import (
    Diagnostic, DiagnosticSet, Status, invalid, unavailable,
)

log = logging.getLogger(__name__)

#: Bump when any calculation in the package changes, so a cache keyed on it
#: cannot serve results produced by different maths.
PROCESSING_VERSION = "1.0"
SCHEMA_VERSION = "1.0"

CATEGORIES = (
    "thermodynamics", "lapse_rates", "wind", "dynamics", "boundary_layer",
    "convective_environment",
)


@dataclass(slots=True)
class DerivedParameters:
    """Every derived quantity for one profile: one model, one run, one lead
    time, one ensemble member, one location."""

    provider: str
    model: str
    run: datetime
    valid_time: datetime
    forecast_hour: int
    member: int | None = None
    grid_id: str = ""
    latitude: float | None = None
    longitude: float | None = None
    processing_version: str = PROCESSING_VERSION
    schema_version: str = SCHEMA_VERSION

    thermodynamics: DiagnosticSet = dc_field(
        default_factory=lambda: DiagnosticSet("thermodynamics"))
    lapse_rates: DiagnosticSet = dc_field(
        default_factory=lambda: DiagnosticSet("lapse_rates"))
    wind: DiagnosticSet = dc_field(
        default_factory=lambda: DiagnosticSet("wind"))
    dynamics: DiagnosticSet = dc_field(
        default_factory=lambda: DiagnosticSet("dynamics"))
    boundary_layer: DiagnosticSet = dc_field(
        default_factory=lambda: DiagnosticSet("boundary_layer"))
    convective_environment: DiagnosticSet = dc_field(
        default_factory=lambda: DiagnosticSet("convective_environment"))

    #: The parcel ascents, kept whole. Later stages need the buoyancy
    #: distribution, not only CAPE.
    ascents: dict[str, pc.Ascent] = dc_field(default_factory=dict)
    #: How good the underlying column was.
    column_quality: dict = dc_field(default_factory=dict)
    issues: list[str] = dc_field(default_factory=list)

    @property
    def is_ensemble_member(self) -> bool:
        return self.member is not None

    @property
    def identity(self) -> tuple:
        """Cache key. Includes the processing version so results computed by
        older maths are never served as though they were current."""
        return (
            self.model, self.run, self.forecast_hour, self.member,
            self.grid_id, self.latitude, self.longitude,
            self.schema_version, self.processing_version,
        )

    def sets(self) -> dict[str, DiagnosticSet]:
        return {
            "thermodynamics": self.thermodynamics,
            "lapse_rates": self.lapse_rates,
            "wind": self.wind,
            "dynamics": self.dynamics,
            "boundary_layer": self.boundary_layer,
            "convective_environment": self.convective_environment,
        }

    def get(self, name: str) -> Diagnostic:
        """Look a diagnostic up by name across all categories."""
        for group in self.sets().values():
            if name in group:
                return group.get(name)
        return unavailable(
            name, "", f"{name} was not computed for this profile"
        )

    def value(self, name: str, default: float | None = None) -> float | None:
        found = self.get(name)
        if found.value is None:
            return default
        try:
            return float(found.value)
        except (TypeError, ValueError):
            return default

    def summary(self) -> dict:
        """Counts by status -- how much of the atmosphere was actually
        measurable from this profile."""
        counts: dict[str, int] = {}
        for group in self.sets().values():
            for diagnostic in group:
                counts[diagnostic.status.value] = (
                    counts.get(diagnostic.status.value, 0) + 1
                )
        total = sum(counts.values())
        return {
            "total": total,
            "by_status": counts,
            "available_fraction": (
                round(counts.get("available", 0) / total, 3) if total else 0.0
            ),
        }

    def to_dict(self, *, include_ascents: bool = False) -> dict:
        out = {
            "metadata": {
                "provider": self.provider,
                "model": self.model,
                "run": self.run.isoformat(),
                "valid_time": self.valid_time.isoformat(),
                "forecast_hour": self.forecast_hour,
                "ensemble_member": self.member,
                "grid_id": self.grid_id,
                "latitude": self.latitude,
                "longitude": self.longitude,
                "processing_version": self.processing_version,
                "schema_version": self.schema_version,
            },
            "summary": self.summary(),
            "column_quality": self.column_quality,
            "issues": list(self.issues),
        }
        for name, group in self.sets().items():
            out[name] = group.to_dict()
        if include_ascents:
            out["parcel_profiles"] = {
                k: a.to_dict(include_profile=True)
                for k, a in self.ascents.items()
            }
        return out


def _safe(
    group: DiagnosticSet, name: str, unit: str, fn: Callable[[], Diagnostic],
) -> Diagnostic:
    """Run one calculation, catching anything it throws.

    A calculation that raises is a bug, and it is reported as INVALID with
    the exception text rather than being swallowed or allowed to abort the
    other forty diagnostics. The distinction from UNAVAILABLE matters:
    UNAVAILABLE means the data did not support the calculation, INVALID
    means the code went wrong and someone should look.
    """
    try:
        result = fn()
    except Exception as exc:                      # noqa: BLE001
        log.exception("derived parameter %s raised", name)
        result = invalid(
            name, unit,
            f"the calculation raised {type(exc).__name__}: {exc}",
        )
    return group.add(result)


def compute(profile: Profile) -> DerivedParameters:
    """Derive every supported parameter from one Stage 3 profile."""
    meta = profile.metadata
    out = DerivedParameters(
        provider=meta.provider, model=meta.model, run=meta.run,
        valid_time=meta.valid_time, forecast_hour=meta.forecast_hour,
        member=meta.member, grid_id=meta.grid_id,
        latitude=meta.latitude, longitude=meta.longitude,
    )

    column = column_from_profile(profile)
    if column is None:
        out.issues.append(
            "no usable atmospheric column could be extracted from this "
            "profile, so no derived parameter is calculable"
        )
        log.info(
            "no column for %s %s T+%s member=%s",
            meta.model, meta.run, meta.forecast_hour, meta.member,
        )
        return out

    out.column_quality = column.to_dict()
    out.issues.extend(column.issues)
    _log_column(column, meta)

    _thermodynamics(out, column)
    _lapse_rates(out, column)
    _wind(out, column)
    _convective_environment(out, column)
    _boundary_layer(out, column)
    return out


def _log_column(column: Column, meta) -> None:
    """Record the scientifically significant facts about the column once."""
    if column.degraded:
        log.info(
            "%s T+%s: column is degraded -- %d levels, %.0f%% native",
            meta.model, meta.forecast_hour, len(column),
            column.native_fraction * 100,
        )
    if not column.has_moisture:
        log.info(
            "%s T+%s: no humidity in the column; all parcel diagnostics "
            "will be unavailable", meta.model, meta.forecast_hour,
        )
    if not column.has_hodograph:
        log.info(
            "%s T+%s: no wind profile; shear, helicity and jets will be "
            "unavailable", meta.model, meta.forecast_hour,
        )
    if column.height_reconstructed:
        log.info(
            "%s T+%s: geopotential height was incomplete and reconstructed "
            "hypsometrically", meta.model, meta.forecast_hour,
        )


# ---------------------------------------------------------------------------

_PARCEL_DIAGNOSTICS = (
    # (parcel kind, cape name, cin name)
    ("surface", "sbcape", "sbcin"),
    ("mixed_layer", "mlcape", "mlcin"),
    ("most_unstable", "mucape", "mucin"),
)


def _thermodynamics(out: DerivedParameters, column: Column) -> None:
    group = out.thermodynamics

    for kind, cape_name, cin_name in _PARCEL_DIAGNOSTICS:
        ascent = None
        try:
            ascent = pc.ascend(column, kind)
        except Exception as exc:                  # noqa: BLE001
            log.exception("%s parcel ascent raised", kind)
            group.add(invalid(cape_name, "J/kg",
                              f"the ascent raised {type(exc).__name__}: {exc}"))
            group.add(invalid(cin_name, "J/kg",
                              f"the ascent raised {type(exc).__name__}: {exc}"))
            continue

        if ascent is None:
            why = (
                f"a {kind.replace('_', '-')} parcel could not be constructed: "
                f"the column has "
                + ("no humidity" if not column.has_moisture
                   else "too little structure in the source layer")
            )
            group.add(unavailable(cape_name, "J/kg", why))
            group.add(unavailable(cin_name, "J/kg", why))
            continue

        out.ascents[kind] = ascent
        group.add(_cape_diagnostic(cape_name, ascent, column))
        group.add(_cin_diagnostic(cin_name, ascent, column))

    surface = out.ascents.get("surface")
    for name, attribute in (
        ("lcl", "lcl_height"), ("lfc", "lfc_height"), ("el", "el_height"),
    ):
        group.add(_level_diagnostic(name, attribute, surface, column))

    for name, diagnostic in indices.all_indices(column, surface).items():
        group.add(diagnostic)


def _parcel_sources(ascent: pc.Ascent) -> dict:
    return {
        "parcel": ascent.parcel.to_dict(),
        "lcl_hpa": round(ascent.lcl_pressure / 100.0, 1)
        if np.isfinite(ascent.lcl_pressure) else None,
        "lfc_hpa": round(ascent.lfc_pressure / 100.0, 1)
        if np.isfinite(ascent.lfc_pressure) else None,
        "el_hpa": round(ascent.el_pressure / 100.0, 1)
        if np.isfinite(ascent.el_pressure) else None,
        "positive_layers": len(ascent.positive_layers),
    }


def _cape_diagnostic(
    name: str, ascent: pc.Ascent, column: Column
) -> Diagnostic:
    if not ascent.status.has_value:
        return unavailable(
            name, "J/kg", ascent.reason or "the parcel could not be lifted",
            source_fields=("temperature", "relative_humidity"),
            method=REGISTRY[name].method,
        )
    extra = _parcel_sources(ascent)
    extra["layers"] = [
        {
            "bottom_hpa": round(b / 100.0, 1),
            "top_hpa": round(t / 100.0, 1),
            "cape_j_kg": round(c, 1),
        }
        for b, t, c in ascent.positive_layers
    ]
    return Diagnostic(
        name=name, value=float(ascent.cape), unit="J/kg",
        status=ascent.status,
        source_fields=("temperature", "relative_humidity",
                       "geopotential_height"),
        source_levels=column.source_levels, level_coordinate="pressure_hpa",
        method=REGISTRY[name].method,
        interpolation_used=column.native_fraction < 1.0,
        quality_flags=ascent.flags, reason=ascent.reason,
        extra=extra,
    )


def _cin_diagnostic(
    name: str, ascent: pc.Ascent, column: Column
) -> Diagnostic:
    if not ascent.status.has_value:
        return unavailable(
            name, "J/kg", ascent.reason or "the parcel could not be lifted",
            source_fields=("temperature", "relative_humidity"),
            method=REGISTRY[name].method,
        )
    if not np.isfinite(ascent.cin):
        return unavailable(
            name, "J/kg",
            "there is no LFC, so convective inhibition -- the negative area "
            "beneath one -- is undefined. CAPE is zero; that is the result",
            source_fields=("temperature", "relative_humidity"),
            method=REGISTRY[name].method,
            quality_flags=(
                f"total stable area to the profile top was "
                f"{ascent.total_negative_area:.0f} J/kg, which is NOT CIN"
            ,) if np.isfinite(ascent.total_negative_area) else (),
        )
    return Diagnostic(
        name=name, value=float(ascent.cin), unit="J/kg",
        status=ascent.status,
        source_fields=("temperature", "relative_humidity",
                       "geopotential_height"),
        source_levels=column.source_levels, level_coordinate="pressure_hpa",
        method=REGISTRY[name].method,
        interpolation_used=column.native_fraction < 1.0,
        quality_flags=ascent.flags + (
            "NEGATIVE by convention: it is the integral of negative buoyancy",
        ),
        reason=ascent.reason, extra=_parcel_sources(ascent),
    )


def _level_diagnostic(
    name: str, attribute: str, ascent: pc.Ascent | None, column: Column
) -> Diagnostic:
    if ascent is None or not ascent.status.has_value:
        return unavailable(
            name, "m",
            "no surface parcel ascent is available",
            source_fields=("temperature", "relative_humidity"),
            method=REGISTRY[name].method,
        )
    value = getattr(ascent, attribute)
    if not np.isfinite(value):
        if name == "lcl":
            why = "the parcel does not reach saturation within the profile"
        elif name == "lfc":
            why = (
                "the parcel never becomes positively buoyant: there is no "
                "level of free convection, and forcing one would "
                "misrepresent a stable sounding"
            )
        elif not ascent.has_lfc:
            # An EL is the top of a buoyant layer. With no LFC there is no
            # buoyant layer, so the cause is the missing LFC -- NOT "still
            # buoyant at the top", which is the opposite situation and was
            # being reported alongside "never becomes positively buoyant".
            why = (
                "there is no LFC, so the parcel has no buoyant layer and no "
                "equilibrium level to reach"
            )
        else:
            why = (
                "the parcel is still buoyant at the top of the profile, so "
                "the equilibrium level lies above the available data"
            )
        return unavailable(
            name, "m", why,
            source_fields=("temperature", "relative_humidity",
                           "geopotential_height"),
            method=REGISTRY[name].method,
        )
    base = column.height[0] if np.isfinite(column.height[0]) else 0.0
    return Diagnostic(
        name=name, value=float(value), unit="m", status=ascent.status,
        source_fields=("temperature", "relative_humidity",
                       "geopotential_height"),
        method=REGISTRY[name].method, interpolation_used=True,
        quality_flags=ascent.flags, reason=ascent.reason,
        extra={
            "height_agl_m": round(float(value) - base, 0),
            "pressure_hpa": round(
                getattr(ascent, attribute.replace("_height", "_pressure"))
                / 100.0, 1
            ),
            "parcel": ascent.parcel.kind,
        },
    )


# ---------------------------------------------------------------------------

def _lapse_rates(out: DerivedParameters, column: Column) -> None:
    for name, bottom, top in lapse.HEIGHT_LAYERS:
        _safe(out.lapse_rates, name, "K/km",
              lambda n=name, b=bottom, t=top:
              lapse.height_lapse_rate(column, n, b, t))
    for name, bottom, top in lapse.PRESSURE_LAYERS:
        _safe(out.lapse_rates, name, "K/km",
              lambda n=name, b=bottom, t=top:
              lapse.pressure_lapse_rate(column, n, b, t))


def _wind(out: DerivedParameters, column: Column) -> None:
    group = out.wind

    for name, bottom, top in wind.SHEAR_LAYERS:
        _safe(group, name, "m/s",
              lambda n=name, b=bottom, t=top:
              wind.bulk_shear(column, n, b, t))
    for name, top in (("speed_shear_0_1km", 1000.0),
                      ("speed_shear_0_6km", 6000.0)):
        _safe(group, name, "m/s",
              lambda n=name, t=top: wind.speed_shear(column, n, 0.0, t))

    _safe(group, "directional_shear", "degrees",
          lambda: wind.directional_shear(column))

    motions: dict[str, Diagnostic] = {}
    for mover in ("right", "left", "mean"):
        motions[mover] = _safe(
            group, f"storm_motion_{mover}", "m/s",
            lambda m=mover: wind.storm_motion(column, mover=m),
        )

    right = motions["right"]
    if right.status.has_value and right.value is not None:
        motion = (float(right.value[0]), float(right.value[1]))
        motion_method = right.method
    else:
        motion = (float("nan"), float("nan"))
        motion_method = "unavailable"

    for name, bottom, top in wind.SRH_LAYERS:
        _safe(group, name, "m2/s2",
              lambda n=name, b=bottom, t=top:
              wind.storm_relative_helicity(column, n, b, t, motion,
                                           motion_method))

    # MUCAPE is already computed by , which runs first.
    # Passing it lets the inflow scan skip its twelve moist ascents when no
    # level could qualify -- exact, not approximate, and profiling put that
    # scan at 71% of the whole Stage 4 cost.
    mucape = out.thermodynamics.get("mucape")
    inflow = _safe(group, "effective_inflow_layer", "m",
                   lambda: wind.effective_inflow_layer(
                       column,
                       most_unstable_cape=(
                           mucape.value
                           if mucape is not None and mucape.status.has_value
                           else None
                       ),
                   ))
    _safe(group, "effective_srh", "m2/s2",
          lambda: wind.effective_srh(column, inflow, motion, motion_method))
    _safe(group, "storm_relative_flow", "m/s",
          lambda: wind.storm_relative_flow(column, motion, motion_method))

    _safe(group, "low_level_jet", "m/s", lambda: wind.low_level_jet(column))
    _safe(group, "upper_level_jet", "m/s",
          lambda: wind.upper_level_jet(column))

    _safe(group, "bulk_richardson_number", "dimensionless",
          lambda: wind.bulk_richardson_number(
              column, out.thermodynamics.get("sbcape")))


def _convective_environment(out: DerivedParameters, column: Column) -> None:
    group = out.convective_environment

    _safe(group, "precipitable_water", "kg/m2",
          lambda: environment.precipitable_water(column))
    _safe(group, "dcape", "J/kg", lambda: environment.dcape(column))
    freezing = _safe(group, "freezing_level", "m",
                     lambda: environment.freezing_level(column))
    _safe(group, "wet_bulb_zero", "m",
          lambda: environment.wet_bulb_zero(column))
    _safe(group, "entrainment_indicators", "%",
          lambda: environment.entrainment_indicators(column))

    surface = out.ascents.get("surface")
    try:
        depths = environment.cloud_depths(column, surface, freezing)
    except Exception as exc:                      # noqa: BLE001
        log.exception("cloud depths raised")
        depths = {
            n: invalid(n, "m",
                       f"the calculation raised {type(exc).__name__}: {exc}")
            for n in ("cloud_depth", "warm_cloud_depth", "cold_cloud_depth",
                      "condensate_cloud_depth")
        }
    for diagnostic in depths.values():
        group.add(diagnostic)


def _boundary_layer(out: DerivedParameters, column: Column) -> None:
    group = out.boundary_layer

    depth = _safe(group, "pbl_depth", "m", lambda: boundary.pbl_depth(column))
    depth_value = float(depth.value) if depth.status.has_value \
        and depth.value is not None else None

    _safe(group, "boundary_layer_moisture", "kg/kg",
          lambda: boundary.boundary_layer_moisture(column, depth_value))
    _safe(group, "boundary_layer_temperature", "K",
          lambda: boundary.boundary_layer_temperature(column, depth_value))
    _safe(group, "surface_heating", "W/m2",
          lambda: boundary.surface_heating(
              {"boundary_layer_height": column.boundary_layer_height}))


def compute_changes(
    earlier: DerivedParameters, later: DerivedParameters
) -> Diagnostic:
    """Destabilisation and CIN-change components between two lead times.

    Refuses to compare different models, runs or members: a "change" built
    from a UKV field and an ICON field is a model difference, not an
    evolution, and presenting it as one would be the silent substitution the
    platform forbids.
    """
    if (earlier.model, earlier.run, earlier.member) != \
            (later.model, later.run, later.member):
        return unavailable(
            "change_diagnostics", "",
            f"cannot difference {earlier.model} run {earlier.run:%Y-%m-%d %HZ}"
            f" member {earlier.member} against {later.model} run "
            f"{later.run:%Y-%m-%d %HZ} member {later.member}: that is a model "
            f"or run difference, not an atmospheric evolution",
        )
    hours = later.forecast_hour - earlier.forecast_hour
    tracked = (
        "sbcape", "mlcape", "mucape", "sbcin", "mlcin", "mucin",
        "boundary_layer_moisture", "boundary_layer_temperature", "pbl_depth",
        "lifted_index",
    )
    return boundary.change_diagnostics(
        {k: earlier.value(k) for k in tracked},
        {k: later.value(k) for k in tracked},
        float(hours),
    )
