"""Boundary-layer diagnostics.

Two rules shape this module.

**The model's own PBL depth wins.** Each NWP model defines its boundary layer
inside its own turbulence scheme, and that definition is part of how the
model behaves. Reconstructing a depth from the profile and presenting it as
though it were the model's would silently substitute our definition for
theirs. So `pbl_depth` uses the native field when it exists, reconstructs
only when it does not, and always says which it did.

**Change diagnostics are components, not scores.** Destabilisation and CIN
erosion are returned as the underlying quantities at each time with the exact
interval attached -- not as a percentage or an index. How much a 40 J/kg
reduction in CIN over three hours matters depends on lift, moisture and
timing, which are a later stage's business. Compressing it into a number here
would hide that judgement inside a data product.

REFERENCES
----------
Seibert, P. et al. (2000). Review and intercomparison of operational methods
    for the determination of the mixing height.
    *Atmospheric Environment*, 34, 1001-1027.
Vogelezang, D. H. P. & Holtslag, A. A. M. (1996). Evaluation and model
    impacts of alternative boundary-layer height formulations.
    *Boundary-Layer Meteorology*, 81, 245-269.
    -- the bulk Richardson number method used for reconstruction.
Stull, R. B. (1988). *An Introduction to Boundary Layer Meteorology*.
"""
from __future__ import annotations

import numpy as np

from . import thermo as th
from .column import Column
from .result import Diagnostic, Status, unavailable, worst

#: Critical bulk Richardson number for the reconstructed PBL top.
#: 0.25 is the conventional value for the Vogelezang & Holtslag formulation.
CRITICAL_RICHARDSON = 0.25

#: Excess added to the surface potential temperature for the parcel method,
#: K. Represents the buoyancy of a thermal leaving the surface.
PARCEL_EXCESS_K = 0.5

#: Floor on the bulk-shear denominator, m2/s2. This is the b*u_star^2 surface
#: friction term of the Vogelezang & Holtslag formulation, evaluated for a
#: typical u_star near 0.3 m/s with b = 100. It is what stops the criterion
#: from dividing by a near-zero shear in light winds.
SURFACE_SHEAR_FLOOR = 9.0

#: A column whose lowest usable level is more than this far above the surface
#: cannot resolve the boundary layer at all, Pa.
SURFACE_GAP_LIMIT_PA = 1500.0

#: Shallow layers whose mean moisture is reported, m AGL.
MOISTURE_LAYERS: tuple[tuple[str, float], ...] = (
    ("lowest_100m", 100.0),
    ("lowest_500m", 500.0),
)


def pbl_depth(column: Column) -> Diagnostic:
    """Depth of the boundary layer, m.

    Prefers the model's own diagnostic. Falls back to a bulk Richardson
    number reconstruction (Vogelezang & Holtslag 1996): the height at which

        Ri_b = (g/theta_v_s) (theta_v(z) - theta_v_s)(z - z_s)
               / ((u(z)-u_s)^2 + (v(z)-v_s)^2)

    first exceeds 0.25. That method is chosen over a simple parcel or
    gradient method because it accounts for BOTH buoyancy and shear, so it
    behaves sensibly in the stable, windy, weakly heated boundary layers that
    dominate the UK for much of the year -- conditions in which a pure
    thermal-parcel method returns almost nothing.

    Where wind is unavailable it degrades to the parcel method, and says so.
    """
    name = "pbl_depth"
    unit = "m"

    if column.boundary_layer_height is not None:
        return Diagnostic(
            name=name, value=float(column.boundary_layer_height), unit=unit,
            status=Status.AVAILABLE,
            source_fields=("boundary_layer_height",),
            method="model_native_diagnostic",
            quality_flags=(
                "the model's own boundary-layer depth from its turbulence "
                "scheme; definitions differ between models and this one is "
                "preserved rather than recomputed",
            ),
            extra={"native": True},
        )

    if len(column) < 3:
        return unavailable(
            name, unit,
            "no native boundary-layer height, and the column has too few "
            "levels to reconstruct one",
            source_fields=("boundary_layer_height", "temperature"),
        )

    base_z = column.height[0]
    if not np.isfinite(base_z):
        return unavailable(
            name, unit,
            "no native boundary-layer height, and the column has no usable "
            "height coordinate to reconstruct one against",
            source_fields=("boundary_layer_height", "geopotential_height"),
        )

    # The boundary layer lives in the lowest few hundred metres. Where the
    # column's lowest usable level is already well above ground -- as it is
    # anywhere 1000 hPa is underground and the profile starts at 925 -- the
    # whole boundary layer sits BELOW the data, and no criterion applied to
    # what remains can find its top. Returning the first sample (a "50 m
    # boundary layer") would be worse than returning nothing.
    if column.surface_pressure is not None:
        if column.bottom_pressure < column.surface_pressure - SURFACE_GAP_LIMIT_PA:
            above_ground = th.hypsometric_thickness(
                float(column.surface_pressure), float(column.bottom_pressure),
                float(column.temperature[0]),
            )
            return unavailable(
                name, unit,
                f"no native boundary-layer height, and the lowest usable "
                f"level ({column.bottom_pressure / 100:.0f} hPa) is about "
                f"{above_ground:.0f} m above the surface "
                f"({column.surface_pressure / 100:.0f} hPa). The boundary "
                f"layer lies below the available data and cannot be "
                f"reconstructed from what is above it",
                source_fields=("boundary_layer_height", "temperature"),
                method="vogelezang_holtslag_1996",
            )

    # Surface state: screen level where available, lowest level otherwise.
    t_s = column.surface_temperature
    td_s = column.surface_dewpoint
    p_s = column.surface_pressure or column.bottom_pressure
    if t_s is None:
        t_s = float(column.temperature[0])
        td_s = float(column.dewpoint[0]) if np.isfinite(column.dewpoint[0]) \
            else None
        p_s = float(column.pressure[0])
    w_s = float(th.saturation_mixing_ratio(td_s, p_s)) if td_s is not None \
        else 0.0
    if not np.isfinite(w_s):
        w_s = 0.0
    theta_v_s = float(th.potential_temperature(
        th.virtual_temperature(t_s, w_s), p_s
    ))

    # Sample every 50 m through the lowest 4 km.
    heights = np.arange(base_z, base_z + 4000.0, 50.0)
    use_shear = column.has_hodograph
    if use_shear:
        u_s, v_s = column.wind_at_height(column.wind_height[0])
    else:
        u_s = v_s = 0.0

    found = float("nan")
    for z in heights[1:]:
        t = column.interp_at_height(column.temperature, float(z))
        if not np.isfinite(t):
            break
        p = column.pressure_at_height(float(z))
        td = column.interp_at_height(column.dewpoint, float(z))
        w = float(th.saturation_mixing_ratio(min(td, t), p)) \
            if np.isfinite(td) and np.isfinite(p) else 0.0
        if not np.isfinite(w):
            w = 0.0
        theta_v = float(th.potential_temperature(
            th.virtual_temperature(t, w), p
        ))

        if use_shear:
            u, v = column.wind_at_height(z - base_z)
            shear_sq = (u - u_s) ** 2 + (v - v_s) ** 2 \
                if np.isfinite(u) else float("nan")
        else:
            shear_sq = float("nan")

        if np.isfinite(shear_sq):
            # A floor representing surface friction. Without one, a level
            # with near-zero shear divides by almost nothing and the
            # criterion trips at the very first sample, returning a 50 m
            # boundary layer on any profile with the faintest stability.
            shear_sq = max(float(shear_sq), SURFACE_SHEAR_FLOOR)
            criterion = (
                (th.GRAVITY / theta_v_s) * (theta_v - theta_v_s)
                * (z - base_z) / shear_sq
            )
            reached = criterion >= CRITICAL_RICHARDSON
        else:
            # No wind at all. Fall back to the PARCEL method rather than a
            # Richardson number with an invented denominator: the top is
            # where a surface thermal, given a small buoyancy excess, is no
            # longer warmer than its surroundings. That is a DIFFERENT
            # definition, not an approximation of the same one, so it is
            # named differently on the result.
            reached = theta_v >= theta_v_s + PARCEL_EXCESS_K

        if reached:
            found = float(z - base_z)
            break

    if not np.isfinite(found):
        return unavailable(
            name, unit,
            "the bulk Richardson number does not reach "
            f"{CRITICAL_RICHARDSON} anywhere in the lowest 4 km, so no "
            f"boundary-layer top could be identified",
            source_fields=("temperature", "u_wind", "v_wind"),
            method="vogelezang_holtslag_1996",
        )

    flags = [
        "RECONSTRUCTED, not the model's own boundary-layer height; a model "
        "with a native diagnostic would give a different number",
    ]
    method = (f"vogelezang_holtslag_1996_bulk_richardson_"
              f"critical_{CRITICAL_RICHARDSON}")
    if not use_shear:
        method = f"parcel_method_theta_v_excess_{PARCEL_EXCESS_K}K"
        flags.append(
            f"no wind profile, so the bulk Richardson method does not apply; "
            f"the PARCEL method was used instead (top where theta-v exceeds "
            f"the surface value by {PARCEL_EXCESS_K} K). A DIFFERENT "
            f"definition, not an approximation of the same one, and it "
            f"underestimates a windy, weakly heated boundary layer"
        )

    return Diagnostic(
        name=name, value=found, unit=unit,
        status=Status.DEGRADED,
        source_fields=("temperature", "relative_humidity", "u_wind", "v_wind"),
        method=method,
        interpolation_used=True, quality_flags=tuple(flags),
        reason="reconstructed from the profile because the model published "
               "no boundary-layer height",
        extra={
            "native": False,
            "critical_richardson": CRITICAL_RICHARDSON,
            "shear_included": use_shear,
        },
    )


def boundary_layer_moisture(column: Column, depth_m: float | None) -> Diagnostic:
    """Moisture through the boundary layer, several ways.

    NOT surface relative humidity. RH at 1.5 m says almost nothing about how
    much water a storm can ingest: it is a ratio to a temperature-dependent
    saturation value, so it falls through a summer afternoon while the actual
    water content is unchanged. MIXING RATIO is reported as the primary
    quantity because it is conserved under dry vertical motion and is
    therefore what actually gets lifted.

    `value` is the mean mixing ratio through the boundary layer where its
    depth is known, and through the lowest 500 m otherwise -- with the
    fallback recorded.
    """
    name = "boundary_layer_moisture"
    unit = "kg/kg"
    sources = ("relative_humidity", "temperature")
    if not column.has_moisture:
        return unavailable(
            name, unit, "no humidity profile", source_fields=sources,
        )
    base_z = column.height[0]
    if not np.isfinite(base_z):
        return unavailable(
            name, unit,
            "no usable height coordinate, so shallow layers cannot be "
            "delimited",
            source_fields=sources,
        )

    layers: dict[str, float | None] = {}
    for label, top in MOISTURE_LAYERS:
        layers[label] = _mean_mixing_ratio(column, base_z, base_z + top)

    flags: list[str] = []
    if depth_m is not None and np.isfinite(depth_m) and depth_m > 50.0:
        primary = _mean_mixing_ratio(column, base_z, base_z + depth_m)
        method = "mean_mixing_ratio_through_boundary_layer"
        layers["boundary_layer"] = primary
    else:
        primary = layers["lowest_500m"]
        method = "mean_mixing_ratio_lowest_500m_fallback"
        flags.append(
            "the boundary-layer depth is unknown, so the lowest 500 m was "
            "used instead; this is a different layer, not an estimate of the "
            "same one"
        )

    if primary is None or not np.isfinite(primary):
        return unavailable(
            name, unit,
            "the moisture profile could not be averaged over the requested "
            "layer",
            source_fields=sources,
        )

    surface_w = None
    if column.surface_dewpoint is not None and \
            column.surface_pressure is not None:
        value = float(th.saturation_mixing_ratio(
            column.surface_dewpoint, column.surface_pressure
        ))
        surface_w = value if np.isfinite(value) else None

    return Diagnostic(
        name=name, value=float(primary), unit=unit,
        status=Status.DEGRADED if (column.degraded or flags)
        else Status.AVAILABLE,
        source_fields=sources, method=method, interpolation_used=True,
        quality_flags=tuple(flags) + (
            "mixing ratio, NOT relative humidity: RH falls through a heating "
            "afternoon while the water content is unchanged",
        ),
        reason="; ".join(flags) if flags else (
            f"column has {len(column)} usable levels" if column.degraded
            else ""
        ),
        extra={
            "mean_mixing_ratio_g_kg": round(float(primary) * 1000.0, 3),
            "surface_mixing_ratio_g_kg": (
                round(surface_w * 1000.0, 3) if surface_w else None
            ),
            "layers_g_kg": {
                k: (round(v * 1000.0, 3) if v is not None and np.isfinite(v)
                    else None)
                for k, v in layers.items()
            },
            "boundary_layer_depth_m": (
                round(float(depth_m), 0)
                if depth_m is not None and np.isfinite(depth_m) else None
            ),
        },
    )


def _mean_mixing_ratio(
    column: Column, z_bottom: float, z_top: float, step: float = 25.0
) -> float | None:
    heights = np.arange(z_bottom, z_top + 1e-6, step)
    if heights.size < 2:
        return None
    values = []
    for z in heights:
        t = column.interp_at_height(column.temperature, float(z))
        td = column.interp_at_height(column.dewpoint, float(z))
        p = column.pressure_at_height(float(z))
        if not (np.isfinite(t) and np.isfinite(td) and np.isfinite(p)):
            continue
        w = float(th.saturation_mixing_ratio(min(td, t), p))
        if np.isfinite(w):
            values.append(w)
    return float(np.mean(values)) if len(values) >= 2 else None


def boundary_layer_temperature(
    column: Column, depth_m: float | None
) -> Diagnostic:
    """Temperature through the boundary layer -- three distinct quantities.

    The 1.5 m screen temperature, the lowest atmospheric level's temperature
    and the mixed-layer mean are NOT the same thing and are kept apart. On a
    clear night the screen temperature can be several kelvin below the air a
    few tens of metres up; on a hot afternoon the surface layer is
    superadiabatic and the screen value is the warmest of the three. Treating
    them as interchangeable puts that whole error straight into a parcel.
    """
    name = "boundary_layer_temperature"
    unit = "K"
    sources = ("temperature",)
    if len(column) < 2:
        return unavailable(
            name, unit, "no usable temperature profile", source_fields=sources,
        )

    screen = column.surface_temperature
    lowest_level = float(column.temperature[0])
    lowest_level_p = float(column.pressure[0])

    base_z = column.height[0]
    mixed_mean = None
    mixed_theta = None
    if np.isfinite(base_z) and depth_m is not None and np.isfinite(depth_m) \
            and depth_m > 50.0:
        heights = np.arange(base_z, base_z + depth_m + 1e-6, 25.0)
        temps, thetas = [], []
        for z in heights:
            t = column.interp_at_height(column.temperature, float(z))
            p = column.pressure_at_height(float(z))
            if np.isfinite(t):
                temps.append(t)
                if np.isfinite(p):
                    thetas.append(float(th.potential_temperature(t, p)))
        if len(temps) >= 2:
            mixed_mean = float(np.mean(temps))
        if len(thetas) >= 2:
            mixed_theta = float(np.mean(thetas))

    primary = screen if screen is not None else lowest_level
    method = "screen_level_1.5m" if screen is not None \
        else "lowest_usable_pressure_level"

    flags = [
        "the screen, lowest-level and mixed-layer means are DIFFERENT "
        "quantities and are reported separately; they diverge most on clear "
        "nights and hot afternoons",
    ]
    if screen is None:
        flags.append(
            "no screen-level temperature; the lowest pressure level was used "
            "and it may be hundreds of metres above ground"
        )

    c = th.ZERO_CELSIUS
    return Diagnostic(
        name=name, value=float(primary), unit=unit,
        status=Status.DEGRADED if (column.degraded or screen is None)
        else Status.AVAILABLE,
        source_fields=sources, method=method, interpolation_used=True,
        quality_flags=tuple(flags),
        reason="" if screen is not None and not column.degraded else
        "; ".join(flags),
        extra={
            "screen_temperature_c": (
                round(screen - c, 2) if screen is not None else None
            ),
            "lowest_level_temperature_c": round(lowest_level - c, 2),
            "lowest_level_pressure_hpa": round(lowest_level_p / 100.0, 1),
            "mixed_layer_mean_temperature_c": (
                round(mixed_mean - c, 2) if mixed_mean is not None else None
            ),
            "mixed_layer_mean_theta_k": (
                round(mixed_theta, 2) if mixed_theta is not None else None
            ),
            "boundary_layer_depth_m": (
                round(float(depth_m), 0)
                if depth_m is not None and np.isfinite(depth_m) else None
            ),
        },
    )


def surface_heating(surface: dict) -> Diagnostic:
    """Surface energy fields that drive boundary-layer growth.

    Deliberately NOT a "heating index" computed from temperature. Surface
    temperature is a RESULT of heating, not a measure of it: a warm airmass
    advected over a cold sea is warm and heating nothing, while a cool
    airmass over strongly insolated ground is heating fast. The physical
    drivers are the surface energy fluxes, so this reports those where the
    model publishes them and reports nothing where it does not.

    A later stage can combine them into a heating or destabilisation
    assessment; that combination is an interpretation and does not belong
    here.
    """
    name = "surface_heating"
    wanted = {
        "surface_sensible_heat_flux": "W/m2",
        "surface_latent_heat_flux": "W/m2",
        "surface_net_shortwave": "W/m2",
        "surface_downward_shortwave": "W/m2",
    }
    found = {
        key: _scalar(surface.get(key)) for key in wanted
        if surface.get(key) is not None
    }
    found = {k: v for k, v in found.items() if v is not None}

    if not found:
        return unavailable(
            name, "W/m2",
            "no surface energy-flux fields are available on this profile "
            "(sensible heat, latent heat or shortwave radiation). Surface "
            "heating is NOT inferred from temperature, which measures the "
            "result rather than the driver",
            source_fields=tuple(wanted),
            method="model_native_surface_energy_fluxes",
        )

    primary = found.get("surface_sensible_heat_flux")
    if primary is None:
        primary = next(iter(found.values()))

    return Diagnostic(
        name=name, value=float(primary), unit="W/m2",
        status=Status.AVAILABLE if len(found) == len(wanted)
        else Status.PARTIAL,
        source_fields=tuple(found),
        method="model_native_surface_energy_fluxes",
        reason="" if len(found) == len(wanted) else
        f"{len(found)} of {len(wanted)} surface energy fields available",
        quality_flags=(
            "physical energy fluxes, not a heating score; sign convention is "
            "the source model's and is preserved",
        ),
        extra={"fields": {k: round(v, 2) for k, v in found.items()}},
    )


def _scalar(value) -> float | None:
    if value is None:
        return None
    arr = np.asarray(value, dtype="float64")
    if arr.size == 0:
        return None
    first = float(arr.reshape(-1)[0])
    return first if np.isfinite(first) else None


def change_diagnostics(
    earlier: dict, later: dict, hours: float
) -> Diagnostic:
    """Change in the destabilisation-relevant quantities between two times.

    Components with the interval attached -- NOT a destabilisation index and
    NOT a CIN-erosion percentage. Both of those would compress a set of
    independent physical changes into one number and, worse, would imply a
    weighting between them that nothing at this stage has established.

    A percentage is particularly misleading for CIN: going from -200 to
    -100 J/kg is "50% eroded" and still capped, while -20 to -10 J/kg is also
    "50% eroded" and was never going to inhibit anything. The absolute values
    at both times are what carry the information, so both are returned.

    `hours` is the exact interval and is part of the result: a 100 J/kg
    change over one hour and over six are not the same signal.
    """
    name = "change_diagnostics"
    if hours <= 0:
        return unavailable(
            name, "", f"the interval between the two times is {hours} h; a "
                      f"change diagnostic needs a positive interval",
        )

    tracked = (
        ("sbcape", "J/kg"), ("mlcape", "J/kg"), ("mucape", "J/kg"),
        ("sbcin", "J/kg"), ("mlcin", "J/kg"), ("mucin", "J/kg"),
        ("boundary_layer_moisture", "kg/kg"),
        ("boundary_layer_temperature", "K"),
        ("pbl_depth", "m"),
        ("lifted_index", "K"),
    )
    changes: dict[str, dict] = {}
    for key, unit in tracked:
        a, b = earlier.get(key), later.get(key)
        if a is None or b is None or not np.isfinite(a) or not np.isfinite(b):
            changes[key] = {
                "available": False,
                "reason": "missing at one or both times",
            }
            continue
        changes[key] = {
            "available": True,
            "before": round(float(a), 3),
            "after": round(float(b), 3),
            "change": round(float(b - a), 3),
            "change_per_hour": round(float(b - a) / hours, 4),
            "unit": unit,
        }

    usable = [k for k, v in changes.items() if v.get("available")]
    if not usable:
        return unavailable(
            name, "",
            "none of the tracked quantities was available at both times",
        )

    return Diagnostic(
        name=name, value=float(len(usable)), unit="count",
        status=Status.AVAILABLE if len(usable) == len(tracked)
        else Status.PARTIAL,
        method="paired_difference_with_explicit_interval",
        reason="" if len(usable) == len(tracked) else
        f"{len(usable)} of {len(tracked)} quantities available at both times",
        quality_flags=(
            "components only: deliberately NOT a destabilisation index or a "
            "CIN-erosion percentage, both of which would imply a weighting "
            "this stage has not established",
            "a CIN erosion percentage is especially misleading: -200 to -100 "
            "and -20 to -10 J/kg are both '50% eroded' and mean entirely "
            "different things",
        ),
        extra={
            "interval_hours": hours,
            "quantities_available": len(usable),
            "changes": changes,
        },
    )
