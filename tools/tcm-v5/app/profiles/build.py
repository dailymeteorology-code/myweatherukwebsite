"""Profile construction: native first, interpolate only when forced to.

Stage 3. This assembles a `Profile` from Stage 2's stored fields. It reads
what the model published, fills a gap only when the target is bracketed by
real levels, and marks everything else unavailable.

THE FOUR RULES
--------------
1. NATIVE FIRST. If the model published 850 hPa, the 850 hPa value is the
   model's, untouched. An interpolation framework existing is not a reason to
   use it.

2. NO EXTRAPOLATION. A target outside the native range has no bracket and is
   marked OUT_OF_RANGE. Extending a lapse rate past the top of the profile,
   or below its base, invents data that reads exactly like measurement.

3. NO SUBSTITUTION. A missing level is not filled from a neighbouring level,
   another member, another run, or another model. Missing stays missing.

4. TERRAIN IS REAL. Over the Cairngorms the 925 hPa surface is underground.
   The model still carries a number there -- an extrapolated one, produced so
   that pressure-level fields stay rectangular -- and it is not an
   atmospheric value. Where surface pressure says a level is below ground, it
   is marked BELOW_GROUND rather than used.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

import numpy as np

from ..pipeline.ingest import load_field
from .interpolate import (
    interpolate_height_level, interpolate_pressure_level, is_circular,
    method_for, wind_direction_from_components, wind_speed_from_components,
)
from .levels import (
    STANDARD_HEIGHT_LEVELS, STANDARD_PRESSURE_LEVELS, VerticalCoordinate,
    bracket, find_duplicates, is_ordered, label, order_indices,
)
from .schema import (
    FieldOrigin, LevelProvenance, Profile, ProfileMetadata, ProfileStatus,
    VariableProfile,
)

log = logging.getLogger(__name__)

#: Below this share of requested levels a profile is DEGRADED rather than
#: PARTIAL: too little structure remains for a vertical calculation to mean
#: much, and downstream should be able to see that at a glance.
DEGRADED_BELOW = 0.6

#: Pressure-level variables the builder knows how to assemble. The stems
#: match the Stage 2 canonical registry.
PRESSURE_VARIABLES: tuple[tuple[str, str], ...] = (
    ("temperature", "K"),
    ("relative_humidity", "%"),
    ("geopotential_height", "m"),
    ("u_wind", "m/s"),
    ("v_wind", "m/s"),
    ("wind_speed", "m/s"),
    ("vertical_velocity", "m/s"),
    ("wet_bulb_potential_temperature", "K"),
    ("cloud_water_mixing_ratio", "kg/kg"),
    ("cloud_ice_mixing_ratio", "kg/kg"),
)

HEIGHT_VARIABLES: tuple[tuple[str, str], ...] = (
    ("temperature", "K"),
    ("relative_humidity", "%"),
    ("u_wind", "m/s"),
    ("v_wind", "m/s"),
    ("wind_speed", "m/s"),
    ("vertical_velocity", "m/s"),
    ("cloud_water_mixing_ratio", "kg/kg"),
)


def _name_at(stem: str, level: float, coordinate: VerticalCoordinate) -> str:
    return f"{stem}_{label(level, coordinate)}"


def _load(
    model_id: str, run: datetime, name: str, forecast_hour: int,
    member: int | None, root=None,
):
    field = load_field(model_id, run, name, forecast_hour, member, root)
    return None if field is None else field.values


def discover_native_levels(
    model_id: str, run: datetime, stem: str, forecast_hour: int,
    coordinate: VerticalCoordinate, candidates, member: int | None = None,
    root=None,
) -> dict[float, np.ndarray]:
    """Which of `candidates` the model actually published for `stem`.

    Discovery is by attempted read, not by asking the registry: the registry
    says what a model generally offers, and this needs to know what is on
    disk for THIS run, member and lead time.
    """
    found: dict[float, np.ndarray] = {}
    for level in candidates:
        values = _load(
            model_id, run, _name_at(stem, level, coordinate),
            forecast_hour, member, root,
        )
        if values is not None:
            found[float(level)] = values
    return found


def _below_ground_mask(
    level_hpa: float, surface_pressure_pa: np.ndarray | None
) -> np.ndarray | None:
    """True where this pressure level lies beneath the model surface.

    A margin is deliberately NOT applied. The test is whether the level is
    above the surface at all; how close it sits is a separate question and
    inventing a buffer here would silently discard valid near-surface data.
    """
    if surface_pressure_pa is None:
        return None
    return np.asarray(surface_pressure_pa) < (level_hpa * 100.0)


def build_pressure_variable(
    stem: str, units: str, native: dict[float, np.ndarray],
    targets: tuple[float, ...],
    *,
    native_temperature: dict[float, np.ndarray] | None = None,
    surface_pressure: np.ndarray | None = None,
    shape: tuple | None = None,
) -> VariableProfile:
    """Assemble one pressure-level variable across the target levels."""
    if is_circular(stem):
        raise ValueError(
            f"{stem} is circular; build u_wind and v_wind and derive it"
        )

    available = sorted(native, reverse=True)          # TCM order: 1000 -> 200
    values, provenance = [], []

    template = next(iter(native.values()), None)
    if template is None and shape is None:
        shape = ()
    blank_shape = shape if template is None else template.shape

    for target in targets:
        below = _below_ground_mask(target, surface_pressure)
        fully_below = below is not None and bool(np.all(below))

        if fully_below:
            values.append(np.full(blank_shape, np.nan, dtype="float32"))
            provenance.append(LevelProvenance(
                target, FieldOrigin.BELOW_GROUND,
                note="pressure level lies beneath the model surface",
            ))
            continue

        if target in native:
            layer = np.array(native[target], dtype="float32", copy=True)
            origin, sources, method = FieldOrigin.NATIVE, (), ""
        else:
            pair = bracket(target, available)
            if pair is None:
                values.append(np.full(blank_shape, np.nan, dtype="float32"))
                provenance.append(LevelProvenance(
                    target, FieldOrigin.OUT_OF_RANGE,
                    note=(
                        f"outside the model's published levels "
                        f"({available[-1]:g}-{available[0]:g} hPa); "
                        "not extrapolated"
                    ),
                ))
                continue
            lo_i, hi_i = pair
            lo, hi = available[lo_i], available[hi_i]
            kwargs = {}
            if stem == "relative_humidity" and native_temperature:
                kwargs = {
                    "lower_temperature": native_temperature.get(lo),
                    "upper_temperature": native_temperature.get(hi),
                    "target_temperature": native_temperature.get(target),
                }
            layer, method = interpolate_pressure_level(
                stem, target, lo, native[lo], hi, native[hi], **kwargs
            )
            origin, sources = FieldOrigin.VERTICAL_INTERPOLATION, (lo, hi)

        # Mask the cells that ARE underground even when most of the grid is
        # not, so a mountain does not carry a fabricated 925 hPa value.
        if below is not None and np.any(below):
            layer = np.where(below, np.nan, layer)

        values.append(layer)
        provenance.append(LevelProvenance(
            target, origin, sources, method or ("" if origin is FieldOrigin.NATIVE
                                                else method_for(stem)),
        ))

    return VariableProfile(
        name=stem, units=units, coordinate=VerticalCoordinate.ISOBARIC,
        levels=tuple(targets), values=np.stack(values),
        provenance=tuple(provenance),
    )


def build_height_variable(
    stem: str, units: str, native: dict[float, np.ndarray],
    targets: tuple[float, ...], shape: tuple | None = None,
) -> VariableProfile:
    """Assemble one height-level variable across the target levels."""
    available = sorted(native)                         # TCM order: 10 -> 6000
    template = next(iter(native.values()), None)
    blank_shape = (shape or ()) if template is None else template.shape
    values, provenance = [], []

    for target in targets:
        if target in native:
            values.append(np.array(native[target], dtype="float32", copy=True))
            provenance.append(LevelProvenance(target, FieldOrigin.NATIVE))
            continue
        pair = bracket(target, available)
        if pair is None:
            values.append(np.full(blank_shape, np.nan, dtype="float32"))
            provenance.append(LevelProvenance(
                target, FieldOrigin.OUT_OF_RANGE,
                note=(
                    f"outside the model's published heights "
                    f"({available[0]:g}-{available[-1]:g} m); not extrapolated"
                    if available else "no native height levels for this variable"
                ),
            ))
            continue
        lo_i, hi_i = pair
        lo, hi = available[lo_i], available[hi_i]
        layer, method = interpolate_height_level(
            stem, target, lo, native[lo], hi, native[hi]
        )
        values.append(layer)
        provenance.append(LevelProvenance(
            target, FieldOrigin.VERTICAL_INTERPOLATION, (lo, hi), method
        ))

    return VariableProfile(
        name=stem, units=units, coordinate=VerticalCoordinate.HEIGHT_AGL,
        levels=tuple(targets), values=np.stack(values),
        provenance=tuple(provenance),
    )


def build_profile(
    model_id: str,
    run: datetime,
    forecast_hour: int,
    *,
    member: int | None = None,
    provider: str = "",
    grid_id: str = "",
    pressure_levels: tuple[float, ...] = STANDARD_PRESSURE_LEVELS,
    height_levels: tuple[float, ...] = STANDARD_HEIGHT_LEVELS,
    root=None,
) -> Profile:
    """Build the gridded profile for one model, run, member and lead time.

    The result is a CUBE: every variable's values have level as the leading
    axis and the model grid as the trailing axes. A single-point profile is
    taken from it afterwards rather than built separately, so the two can
    never disagree.
    """
    meta = ProfileMetadata(
        provider=provider, model=model_id, run=run,
        valid_time=run + timedelta(hours=forecast_hour),
        forecast_hour=forecast_hour, member=member, grid_id=grid_id,
    )
    profile = Profile(metadata=meta)

    # Surface context first: terrain validity depends on it.
    surface_pressure = _load(
        model_id, run, "pressure_surface", forecast_hour, member, root
    )
    if surface_pressure is not None:
        profile.surface["pressure_surface"] = surface_pressure
    else:
        profile.add_issue(
            "surface pressure unavailable, so below-ground pressure levels "
            "cannot be identified; near-surface levels may include values "
            "the model extrapolated beneath terrain",
            degrade=ProfileStatus.PARTIAL,
        )
    # Screen-level state and the model's own boundary-layer depth. Additive
    # surface context: nothing here changes a profile value or its
    # provenance. Stage 4 needs them because a parcel launched from the
    # lowest usable pressure level is not surface-based -- where 1000 hPa is
    # underground that level can be 700 m up -- and because a model's own
    # PBL definition should never be silently replaced by a reconstruction.
    for extra in ("terrain_height", "boundary_layer_height",
                  "temperature_2m", "relative_humidity_2m", "dewpoint_2m"):
        values = _load(model_id, run, extra, forecast_hour, member, root)
        if values is not None:
            profile.surface[extra] = values

    # Temperature is discovered first: the humidity route needs it.
    native_temperature = discover_native_levels(
        model_id, run, "temperature", forecast_hour,
        VerticalCoordinate.ISOBARIC, pressure_levels, member, root,
    )

    shape = None
    if native_temperature:
        shape = next(iter(native_temperature.values())).shape
    elif surface_pressure is not None:
        shape = np.asarray(surface_pressure).shape

    for stem, units in PRESSURE_VARIABLES:
        native = (
            native_temperature if stem == "temperature"
            else discover_native_levels(
                model_id, run, stem, forecast_hour,
                VerticalCoordinate.ISOBARIC, pressure_levels, member, root,
            )
        )
        if not native:
            continue
        _check_ordering(profile, stem, sorted(native, reverse=True),
                        VerticalCoordinate.ISOBARIC)
        profile.pressure[stem] = build_pressure_variable(
            stem, units, native, pressure_levels,
            native_temperature=native_temperature,
            surface_pressure=surface_pressure, shape=shape,
        )

    for stem, units in HEIGHT_VARIABLES:
        native = discover_native_levels(
            model_id, run, stem, forecast_hour,
            VerticalCoordinate.HEIGHT_AGL, height_levels, member, root,
        )
        if not native:
            continue
        _check_ordering(profile, stem, sorted(native),
                        VerticalCoordinate.HEIGHT_AGL)
        profile.height[stem] = build_height_variable(
            stem, units, native, height_levels, shape=shape,
        )

    _derive_wind_direction(profile)
    _assess(profile)
    return profile


def _check_ordering(
    profile: Profile, stem: str, levels: list[float],
    coordinate: VerticalCoordinate,
) -> None:
    """Record duplicate or non-monotonic native levels rather than sorting."""
    dupes = find_duplicates(levels)
    if dupes:
        profile.add_issue(
            f"{stem}: duplicate native levels {dupes}",
            degrade=ProfileStatus.DEGRADED,
        )
    if not is_ordered(levels, coordinate):
        profile.add_issue(
            f"{stem}: native levels were not in TCM order and were reordered",
            degrade=ProfileStatus.PARTIAL,
        )


def _derive_wind_direction(profile: Profile) -> None:
    """Direction from components, never interpolated as an angle."""
    for store, coordinate in (
        (profile.pressure, VerticalCoordinate.ISOBARIC),
        (profile.height, VerticalCoordinate.HEIGHT_AGL),
    ):
        u, v = store.get("u_wind"), store.get("v_wind")
        if u is None or v is None:
            continue
        store["wind_direction"] = VariableProfile(
            name="wind_direction", units="degrees", coordinate=coordinate,
            levels=u.levels,
            values=wind_direction_from_components(u.values, v.values),
            provenance=tuple(
                LevelProvenance(
                    p.level,
                    FieldOrigin.DERIVED if p.origin.has_value else p.origin,
                    p.source_levels, "arctan2_of_u_and_v",
                    "direction is circular and is never interpolated directly",
                )
                for p in u.provenance
            ),
        )
        # Wind speed: NATIVE WINS, derive only where it is missing.
        #
        # A model can publish wind_speed on fewer levels than u and v -- the
        # UK order carries it at 10 m and on the isobaric levels, so a height
        # profile has u and v at 3000 m and no speed. Leaving that NaN is
        # defensible under the no-extrapolation rule and unhelpful: speed at
        # that level is not an extrapolation, it is |(u, v)| exactly.
        #
        # So a native value is never overwritten, and a level that has none is
        # filled from the components and marked DERIVED.
        derived_speed = wind_speed_from_components(u.values, v.values)
        existing = store.get("wind_speed")
        if existing is None:
            store["wind_speed"] = VariableProfile(
                name="wind_speed", units="m/s", coordinate=coordinate,
                levels=u.levels, values=derived_speed,
                provenance=tuple(
                    LevelProvenance(
                        p.level,
                        FieldOrigin.DERIVED if p.origin.has_value else p.origin,
                        p.source_levels, "hypot_of_u_and_v",
                    )
                    for p in u.provenance
                ),
            )
        elif existing.levels == u.levels:
            values = existing.values.copy()
            provenance = list(existing.provenance)
            for i, entry in enumerate(provenance):
                if entry.origin.has_value:
                    continue                      # native or interpolated: keep
                if not u.provenance[i].origin.has_value:
                    continue                      # no components either
                values[i] = derived_speed[i]
                provenance[i] = LevelProvenance(
                    entry.level, FieldOrigin.DERIVED, (), "hypot_of_u_and_v",
                    "no native wind speed at this level; computed from u and v",
                )
            store["wind_speed"] = VariableProfile(
                name=existing.name, units=existing.units,
                coordinate=existing.coordinate, levels=existing.levels,
                values=values, provenance=tuple(provenance),
            )


def _assess(profile: Profile) -> None:
    """Set the completeness status from what was actually assembled."""
    if not profile.pressure and not profile.height:
        profile.add_issue(
            "no vertical levels could be assembled for this model, run and "
            "lead time", degrade=ProfileStatus.INVALID,
        )
        return
    quality = profile.quality()
    completeness = quality["completeness"]
    if completeness < DEGRADED_BELOW:
        profile.add_issue(
            f"only {completeness:.0%} of requested levels are available",
            degrade=ProfileStatus.DEGRADED,
        )
    elif completeness < 1.0:
        profile.add_issue(
            f"{completeness:.0%} of requested levels are available",
            degrade=ProfileStatus.PARTIAL,
        )


def point_profile(cube: Profile, iy: int, ix: int,
                  latitude: float | None = None,
                  longitude: float | None = None) -> Profile:
    """Extract one grid cell's profile from a gridded profile.

    Taken from the cube rather than rebuilt, so a point can never disagree
    with the field it came from.
    """
    from dataclasses import replace

    meta = replace(
        cube.metadata, ix=ix, iy=iy, latitude=latitude, longitude=longitude,
    )
    out = Profile(
        metadata=meta, status=cube.status, issues=list(cube.issues),
        surface={
            k: np.asarray(v)[iy, ix] for k, v in cube.surface.items()
            if np.asarray(v).ndim >= 2
        },
    )
    # Below-ground is a PER-CELL fact, and the cube records it per level.
    # A level can be native across the grid and still be inside terrain at
    # this particular cell -- 1000 hPa over Birmingham, ~140 m up, is exactly
    # that. Without this refinement the point reads "native" beside a NaN,
    # which looks like a decode failure rather than the ground.
    surface_pa = cube.surface.get("pressure_surface")
    cell_pressure = (
        float(np.asarray(surface_pa)[iy, ix])
        if surface_pa is not None and np.asarray(surface_pa).ndim >= 2
        else None
    )

    for source, target in ((cube.pressure, out.pressure),
                           (cube.height, out.height)):
        for name, variable in source.items():
            values = variable.values[:, iy, ix]
            provenance = list(variable.provenance)
            if cell_pressure is not None and \
                    variable.coordinate is VerticalCoordinate.ISOBARIC:
                for i, entry in enumerate(provenance):
                    below = entry.level * 100.0 > cell_pressure
                    if below and not np.isfinite(values[i]):
                        provenance[i] = LevelProvenance(
                            entry.level, FieldOrigin.BELOW_GROUND,
                            entry.source_levels, entry.method,
                            "this level is beneath the surface at this cell",
                        )
            target[name] = VariableProfile(
                name=variable.name, units=variable.units,
                coordinate=variable.coordinate, levels=variable.levels,
                values=values, provenance=tuple(provenance),
                native_name=variable.native_name,
                native_units=variable.native_units,
            )
    return out
