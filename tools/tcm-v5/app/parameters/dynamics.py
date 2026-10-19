"""Dynamical diagnostics: horizontal derivatives of gridded fields.

Everything else in this package works on a single column. This module cannot:
divergence, vorticity, advection and frontogenesis are all HORIZONTAL
derivatives, so they need neighbouring grid cells and they need to know what
the grid actually is.

WHY THE GRID MATTERS, AND WHY A UNIFORM ASSUMPTION IS WRONG
------------------------------------------------------------
The platform carries two very different grids:

    UKV         Lambert azimuthal equal-area, 2 km, spacing in METRES
    MOGREPS-G   regular latitude/longitude, spacing in DEGREES

On a lat/lon grid the east-west spacing of one degree is 111 km at the
equator and about 62 km at 56 N -- the latitude of central Scotland. Treating
the grid as uniform would overstate every east-west derivative over Scotland
by nearly 80% relative to the south coast, putting a spurious north-south
gradient into every divergence, vorticity and advection field across the
domain. So `_spacing` computes dx per row from the latitude, and dy from the
meridional step, and the projected case is handled separately.

The LAEA grid is treated as locally uniform at its stated metre spacing.
Lambert azimuthal equal-area preserves area exactly and distorts distance by
under about 1% across a domain this size, which is small against the
truncation error of a centred difference at 2 km. That approximation is
stated rather than assumed.

CONVENTIONS -- all fixed here
-----------------------------
    divergence            s^-1   POSITIVE = outflow (air spreading apart)
    convergence           s^-1   POSITIVE = inflow. Literally -divergence,
                                 provided separately because sign errors
                                 between the two are the classic mistake.
    relative vorticity    s^-1   POSITIVE = cyclonic in the NORTHERN
                                 hemisphere (anticlockwise)
    absolute vorticity    s^-1   relative + planetary (f), f varying with
                                 latitude across the domain
    temperature advection K/s    POSITIVE = WARM advection
    moisture advection    kg/kg/s POSITIVE = moistening
    moisture flux conv.   kg/kg/s POSITIVE = moisture accumulating
    frontogenesis         K/m/s  POSITIVE = the gradient is STRENGTHENING

REFERENCES
----------
Petterssen, S. (1936). Contribution to the theory of frontogenesis.
    *Geofysiske Publikasjoner*, 11, 1-27.
Bluestein, H. B. (1993). *Synoptic-Dynamic Meteorology in Midlatitudes*,
    vol. II -- the kinematic frontogenesis function and its terms.
Banacos, P. C. & Schultz, D. M. (2005). The use of moisture flux convergence
    in forecasting convective initiation. *Weather and Forecasting*, 20,
    351-366.  -- and its well-documented limitations.
"""
from __future__ import annotations

import numpy as np

from ..meta import GridSpec
from ..grid import grid_lonlat
from . import thermo as th
from .result import Diagnostic, Status, unavailable

#: Earth's angular velocity, rad/s.
OMEGA = 7.2921159e-5
#: Mean Earth radius, m.
EARTH_RADIUS = 6_371_229.0

#: Minimum gradient magnitude for frontogenesis to be defined, K/m.
#: Equivalent to 0.01 K per 100 km -- below this the direction of the
#: temperature gradient is numerical noise, and dividing by it produces
#: enormous meaningless values.
MIN_THETA_GRADIENT = 1e-7


def _nanmean(values: np.ndarray) -> float | None:
    """Mean of the finite cells, or None when there are none.

    numpy warns on an all-NaN slice and returns NaN; here an all-weak
    frontogenesis field is an expected outcome, not an anomaly, so it
    reports None rather than emitting a warning per call.
    """
    finite = np.isfinite(values)
    return float(np.mean(values[finite])) if np.any(finite) else None


def coriolis(latitude: np.ndarray) -> np.ndarray:
    """Planetary vorticity f = 2 * OMEGA * sin(latitude), s^-1.

    Computed per grid cell, not as a domain constant. Across the UK and
    Ireland f varies from about 1.16e-4 at 53 N to 1.26e-4 at 60 N -- nearly
    9%. Since absolute vorticity is relative vorticity PLUS f, and synoptic
    relative vorticity is often a small fraction of f, using one value for
    the domain would put a systematic error into the larger term.
    """
    return 2.0 * OMEGA * np.sin(np.radians(np.asarray(latitude,
                                                      dtype="float64")))


def _spacing(grid: GridSpec) -> tuple[np.ndarray, float, np.ndarray]:
    """(dx per row in metres, dy in metres, latitude grid in degrees).

    `dx` is returned as a column vector broadcastable over the field, since
    on a lat/lon grid it varies with latitude and on a projected grid it does
    not.
    """
    lon, lat = grid_lonlat(grid)
    if lat.ndim == 1:
        lat2d = np.broadcast_to(lat.reshape(-1, 1), (grid.ny, grid.nx))
    else:
        lat2d = lat

    if grid.crs_units == "degrees":
        step = grid.spacing_deg
        if step is None:
            raise ValueError(
                f"grid {grid.name!r} is in degrees but carries no "
                f"spacing_deg; horizontal derivatives cannot be scaled"
            )
        dy = float(np.radians(step) * EARTH_RADIUS)
        row_lat = lat2d[:, 0] if lat2d.ndim == 2 else lat2d
        dx = np.radians(step) * EARTH_RADIUS * np.cos(np.radians(row_lat))
        # Guard the pole, where the meridians converge and dx -> 0. Not
        # reachable in this domain, but a zero here would divide by zero.
        dx = np.maximum(dx, 1.0).reshape(-1, 1)
        return dx, dy, lat2d

    spacing = float(grid.spacing_m)
    dx = np.full((grid.ny, 1), spacing)
    return dx, spacing, lat2d


def horizontal_gradient(
    values: np.ndarray, grid: GridSpec
) -> tuple[np.ndarray, np.ndarray]:
    """(d/dx, d/dy) of a 2-D field, per metre.

    Centred differences in the interior, one-sided at the edges (numpy's
    `gradient`). Row index increases northward and column index eastward,
    matching the platform's convention of a lower-left grid origin.
    """
    values = np.asarray(values, dtype="float64")
    if values.ndim != 2:
        raise ValueError(
            f"horizontal derivatives need a 2-D field, got shape "
            f"{values.shape}"
        )
    dx, dy, _ = _spacing(grid)
    d_dy_index, d_dx_index = np.gradient(values)
    return d_dx_index / dx, d_dy_index / dy


def _make(
    name: str, values: np.ndarray, unit: str, method: str,
    sources: tuple[str, ...], grid: GridSpec, *,
    flags: tuple[str, ...] = (), extra: dict | None = None,
    status: Status = Status.AVAILABLE,
) -> Diagnostic:
    payload = {
        "grid": grid.name,
        "grid_units": grid.crs_units,
        "shape": list(values.shape),
    }
    if extra:
        payload.update(extra)
    return Diagnostic(
        name=name, value=values, unit=unit, status=status,
        source_fields=sources, method=method, quality_flags=flags,
        extra=payload,
    )


def _check(u, v, grid: GridSpec, name: str, unit: str, sources):
    """Shared guard for the wind-derivative diagnostics."""
    if u is None or v is None:
        return unavailable(
            name, unit,
            "both wind components are required for a horizontal derivative "
            "and at least one is missing",
            source_fields=sources,
        )
    u = np.asarray(u, dtype="float64")
    v = np.asarray(v, dtype="float64")
    if u.shape != v.shape:
        return unavailable(
            name, unit,
            f"wind components have different shapes {u.shape} and {v.shape}",
            source_fields=sources,
        )
    if u.shape != grid.shape:
        return unavailable(
            name, unit,
            f"field shape {u.shape} does not match grid {grid.name} "
            f"{grid.shape}; derivatives would be scaled by the wrong spacing",
            source_fields=sources,
        )
    if u.ndim != 2 or min(u.shape) < 3:
        return unavailable(
            name, unit,
            f"a centred difference needs at least 3 points on each axis; "
            f"field is {u.shape}",
            source_fields=sources,
        )
    return None


def divergence(u, v, grid: GridSpec) -> Diagnostic:
    """Horizontal divergence, s^-1. POSITIVE = outflow."""
    sources = ("u_wind", "v_wind")
    bad = _check(u, v, grid, "divergence", "s-1", sources)
    if bad is not None:
        return bad
    du_dx, _ = horizontal_gradient(u, grid)
    _, dv_dy = horizontal_gradient(v, grid)
    return _make(
        "divergence", du_dx + dv_dy, "s-1",
        "centred_difference_du_dx_plus_dv_dy", sources, grid,
        flags=("POSITIVE means outflow; see `convergence` for the negative",),
    )


def convergence(u, v, grid: GridSpec) -> Diagnostic:
    """Horizontal convergence, s^-1. POSITIVE = inflow.

    Exactly -divergence. It exists as its own diagnostic because "positive
    convergence" and "negative divergence" describe the same air and the sign
    is the single easiest thing to get backwards; a named quantity with a
    stated sign removes the ambiguity at the point of use.
    """
    div = divergence(u, v, grid)
    if not div.status.has_value:
        return unavailable(
            "convergence", "s-1", div.reason, source_fields=div.source_fields
        )
    return _make(
        "convergence", -np.asarray(div.value), "s-1",
        "negative_of_divergence", div.source_fields, grid,
        flags=("POSITIVE means inflow (air converging)",),
    )


def relative_vorticity(u, v, grid: GridSpec) -> Diagnostic:
    """Vertical component of relative vorticity, s^-1.

        zeta = dv/dx - du/dy

    POSITIVE is cyclonic in the northern hemisphere.
    """
    sources = ("u_wind", "v_wind")
    bad = _check(u, v, grid, "relative_vorticity", "s-1", sources)
    if bad is not None:
        return bad
    _, du_dy = horizontal_gradient(u, grid)
    dv_dx, _ = horizontal_gradient(v, grid)
    return _make(
        "relative_vorticity", dv_dx - du_dy, "s-1",
        "centred_difference_dv_dx_minus_du_dy", sources, grid,
        flags=("POSITIVE is cyclonic in the northern hemisphere",),
    )


def absolute_vorticity(u, v, grid: GridSpec) -> Diagnostic:
    """Absolute vorticity, s^-1: relative vorticity plus planetary vorticity.

    f is evaluated at every cell's own latitude. Over this domain f changes
    by about 9% from the south coast to Shetland, and since f is usually the
    larger term, a domain-constant f would be a bigger error than most of the
    relative vorticity signal.
    """
    zeta = relative_vorticity(u, v, grid)
    if not zeta.status.has_value:
        return unavailable(
            "absolute_vorticity", "s-1", zeta.reason,
            source_fields=zeta.source_fields,
        )
    _, _, lat = _spacing(grid)
    f = coriolis(lat)
    return _make(
        "absolute_vorticity", np.asarray(zeta.value) + f, "s-1",
        "relative_vorticity_plus_latitude_varying_coriolis",
        zeta.source_fields, grid,
        flags=("planetary vorticity varies per cell with latitude",),
        extra={
            "coriolis_min_s-1": float(np.min(f)),
            "coriolis_max_s-1": float(np.max(f)),
        },
    )


def advection(
    scalar, u, v, grid: GridSpec, *, name: str, unit: str,
    source_field: str,
) -> Diagnostic:
    """Horizontal advection of a scalar, per second.

        A = -(u dS/dx + v dS/dy)

    The leading minus sign is the definition, and it is why POSITIVE means
    the advected quantity is INCREASING at the point: wind blowing from
    warmer air towards colder air gives warm advection and a positive value.
    Omitting it -- an easy slip -- flips warm and cold advection everywhere.
    """
    sources = (source_field, "u_wind", "v_wind")
    bad = _check(u, v, grid, name, unit, sources)
    if bad is not None:
        return bad
    scalar = np.asarray(scalar, dtype="float64")
    if scalar.shape != grid.shape:
        return unavailable(
            name, unit,
            f"{source_field} has shape {scalar.shape}, which does not match "
            f"grid {grid.name} {grid.shape}",
            source_fields=sources,
        )
    ds_dx, ds_dy = horizontal_gradient(scalar, grid)
    return _make(
        name, -(np.asarray(u) * ds_dx + np.asarray(v) * ds_dy), unit,
        "negative_wind_dot_gradient", sources, grid,
        flags=(
            "POSITIVE means the quantity is increasing at the point "
            "(warm advection / moistening)",
        ),
    )


def temperature_advection(temperature, u, v, grid: GridSpec) -> Diagnostic:
    """Horizontal temperature advection, K/s. POSITIVE = warm advection."""
    return advection(
        temperature, u, v, grid, name="temperature_advection", unit="K/s",
        source_field="temperature",
    )


def moisture_advection(
    mixing_ratio, u, v, grid: GridSpec
) -> Diagnostic:
    """Horizontal moisture advection, kg/kg/s. POSITIVE = moistening.

    MIXING RATIO, not relative humidity. RH is a ratio to a saturation value
    that itself varies with temperature, so its horizontal gradient conflates
    a moisture gradient with a temperature gradient: air advected from a cold
    saturated region into a warm one carries the same water and a completely
    different RH. Mixing ratio is conserved under horizontal advection, which
    is precisely the property the calculation requires.
    """
    return advection(
        mixing_ratio, u, v, grid, name="moisture_advection",
        unit="kg/kg/s", source_field="mixing_ratio",
    )


def moisture_flux_convergence(
    mixing_ratio, u, v, grid: GridSpec
) -> Diagnostic:
    """Moisture flux convergence, kg/kg/s. POSITIVE = accumulating.

        MFC = -div(q V) = -(d(qu)/dx + d(qv)/dy)
            = [-(u dq/dx + v dq/dy)]  +  [-q (du/dx + dv/dy)]
                 advection term              convergence term

    Both terms are returned separately in `extra`, because they are different
    physics and MFC is regularly misread as if it were only the second.
    Advection alone, convergence alone and their sum are three distinct
    quantities; this module exposes all three under distinct names so nothing
    downstream has to guess which it has.

    Banacos & Schultz (2005) is worth heeding: MFC is dominated by the
    convergence term in practice, which makes it largely a proxy for
    low-level convergence rather than an independent moisture diagnostic.
    That limitation is recorded on the result rather than left implicit.
    """
    name = "moisture_flux_convergence"
    unit = "kg/kg/s"
    sources = ("mixing_ratio", "u_wind", "v_wind")
    bad = _check(u, v, grid, name, unit, sources)
    if bad is not None:
        return bad
    q = np.asarray(mixing_ratio, dtype="float64")
    if q.shape != grid.shape:
        return unavailable(
            name, unit,
            f"mixing ratio has shape {q.shape}, which does not match grid "
            f"{grid.name} {grid.shape}",
            source_fields=sources,
        )
    u = np.asarray(u, dtype="float64")
    v = np.asarray(v, dtype="float64")

    dq_dx, dq_dy = horizontal_gradient(q, grid)
    du_dx, _ = horizontal_gradient(u, grid)
    _, dv_dy = horizontal_gradient(v, grid)

    advective = -(u * dq_dx + v * dq_dy)
    convergent = -q * (du_dx + dv_dy)
    return _make(
        name, advective + convergent, unit,
        "negative_divergence_of_moisture_flux", sources, grid,
        flags=(
            "POSITIVE means moisture accumulating",
            "in practice dominated by the convergence term, so it behaves "
            "largely as a proxy for low-level convergence rather than an "
            "independent moisture diagnostic (Banacos & Schultz 2005)",
            "NOT interchangeable with moisture_advection or convergence; "
            "all three are computed separately",
        ),
        extra={
            "advection_term_mean": float(np.nanmean(advective)),
            "convergence_term_mean": float(np.nanmean(convergent)),
        },
    )


def scalar_gradient(
    values, grid: GridSpec, *, name: str, unit: str, source_field: str
) -> Diagnostic:
    """Horizontal gradient of a scalar field.

    `value` is the magnitude; the components are kept in `extra` because a
    gradient is a vector and collapsing it to a magnitude discards its
    direction, which is what tells you which way the air is being pushed.
    """
    values = np.asarray(values, dtype="float64")
    if values.ndim != 2 or values.shape != grid.shape:
        return unavailable(
            name, unit,
            f"{source_field} has shape {values.shape}, which does not match "
            f"grid {grid.name} {grid.shape}",
            source_fields=(source_field,),
        )
    if min(values.shape) < 3:
        return unavailable(
            name, unit,
            f"a centred difference needs at least 3 points on each axis; "
            f"field is {values.shape}",
            source_fields=(source_field,),
        )
    d_dx, d_dy = horizontal_gradient(values, grid)
    return _make(
        name, np.hypot(d_dx, d_dy), unit, "centred_difference_magnitude",
        (source_field,), grid,
        flags=("value is the MAGNITUDE; components are in extra",),
        extra={
            "component_x_mean": float(np.nanmean(d_dx)),
            "component_y_mean": float(np.nanmean(d_dy)),
            "components_available": True,
        },
    )


def pressure_gradient(pressure, grid: GridSpec) -> Diagnostic:
    """Horizontal pressure-gradient magnitude, Pa/m."""
    return scalar_gradient(
        pressure, grid, name="pressure_gradient", unit="Pa/m",
        source_field="pressure_surface",
    )


def geopotential_gradient(height, grid: GridSpec) -> Diagnostic:
    """Horizontal geopotential-height gradient magnitude, m/m."""
    return scalar_gradient(
        height, grid, name="geopotential_gradient", unit="m/m",
        source_field="geopotential_height",
    )


def frontogenesis(
    temperature, u, v, grid: GridSpec, pressure_pa: float | None = None
) -> Diagnostic:
    """Petterssen 2-D kinematic frontogenesis, K/m/s.

        F = D|grad theta| / Dt
          = -(1/|grad theta|) [ theta_x^2 u_x
                                + theta_x theta_y (v_x + u_y)
                                + theta_y^2 v_y ]

    POSITIVE means the horizontal potential-temperature gradient is
    STRENGTHENING -- a front is forming or sharpening.

    POTENTIAL temperature, not temperature. Frontogenesis is about the
    gradient of a conserved thermodynamic variable; using temperature on a
    pressure surface would mix a real gradient with the adiabatic effect of
    vertical displacement. When `pressure_pa` is supplied the field is
    converted to theta; when it is not, and the input is already theta, that
    must be stated by the caller -- so the pressure argument is required for
    a temperature input and the method string records which was used.

    The formula contains all three kinematic terms and they are returned
    separately:
      * the two DEFORMATION terms (stretching and shearing), which
        concentrate or dilute a gradient without any convergence, and
      * the CONVERGENCE contribution, which is embedded in the
        stretching terms via u_x and v_y.
    This is why a temperature-gradient threshold is not frontogenesis: a
    strong stationary gradient in uniform flow has a large gradient and zero
    frontogenesis, while a weak gradient in strong confluence can be
    frontogenetic. The two are close to independent.

    Where |grad theta| is below MIN_THETA_GRADIENT the direction of the
    gradient is numerical noise; dividing by it would produce enormous
    meaningless values, so those cells are NaN and the count is reported.
    """
    name = "frontogenesis"
    unit = "K/m/s"
    sources = ("temperature", "u_wind", "v_wind")
    bad = _check(u, v, grid, name, unit, sources)
    if bad is not None:
        return bad
    field = np.asarray(temperature, dtype="float64")
    if field.shape != grid.shape:
        return unavailable(
            name, unit,
            f"temperature has shape {field.shape}, which does not match grid "
            f"{grid.name} {grid.shape}",
            source_fields=sources,
        )

    if pressure_pa is not None:
        theta = th.potential_temperature(field, float(pressure_pa))
        route = f"potential_temperature_at_{pressure_pa / 100:.0f}hPa"
    else:
        theta = field
        route = "caller_supplied_potential_temperature"

    u = np.asarray(u, dtype="float64")
    v = np.asarray(v, dtype="float64")
    theta_x, theta_y = horizontal_gradient(theta, grid)
    du_dx, du_dy = horizontal_gradient(u, grid)
    dv_dx, dv_dy = horizontal_gradient(v, grid)

    magnitude = np.hypot(theta_x, theta_y)
    weak = magnitude < MIN_THETA_GRADIENT
    safe = np.where(weak, np.nan, magnitude)

    stretching = theta_x * theta_x * du_dx + theta_y * theta_y * dv_dy
    shearing = theta_x * theta_y * (dv_dx + du_dy)
    with np.errstate(divide="ignore", invalid="ignore"):
        value = -(stretching + shearing) / safe

    flags = [
        "POSITIVE means the potential-temperature gradient is strengthening",
        "Petterssen 2-D kinematic form: deformation and convergence, "
        "computed on potential temperature -- NOT a temperature-gradient "
        "threshold",
    ]
    status = Status.AVAILABLE
    weak_count = int(np.count_nonzero(weak))
    if weak_count:
        flags.append(
            f"{weak_count} of {magnitude.size} cells have a "
            f"potential-temperature gradient below "
            f"{MIN_THETA_GRADIENT:.0e} K/m and are NaN: the gradient "
            f"direction there is numerical noise"
        )
        if weak_count > magnitude.size // 2:
            status = Status.PARTIAL

    return _make(
        name, value, unit, f"petterssen_1936__{route}", sources, grid,
        flags=tuple(flags), status=status,
        extra={
            "conventional_unit": "K/(100 km)/3 h",
            "conventional_scale_factor": 1.0e5 * 3.0 * 3600.0,
            "weak_gradient_cells": weak_count,
            "stretching_term_mean": _nanmean(-stretching / safe),
            "shearing_term_mean": _nanmean(-shearing / safe),
        },
    )


def vertical_velocity(
    values, grid: GridSpec, *, native_units: str, native_name: str = "",
) -> Diagnostic:
    """Normalise a model's vertical-motion field, preserving its own sign.

    Models publish vertical motion in incompatible ways and the SIGN IS NOT
    SHARED:

        omega  (Pa/s)  NEGATIVE is ascent -- pressure decreases upward
        w      (m/s)   POSITIVE is ascent

    Getting that backwards inverts every ascent signal in the system, so this
    function refuses to guess. It requires the native units, records them,
    and reports the canonical quantity with an explicit sign convention.

    NO CONVERSION between omega and w is performed. The exact relation
    requires density and the vertical velocity of the pressure surface
    itself; the common approximation omega ~ -rho g w discards the second
    term and is only valid for synoptic-scale motion, which is exactly the
    regime convective diagnostics are not in. Both forms are preserved as
    they came, and the caller is told which it has.
    """
    name = "vertical_velocity"
    values = np.asarray(values, dtype="float64")
    units = native_units.strip().lower()

    if units in ("pa/s", "pa s-1", "pa s^-1"):
        canonical, ascent_sign = "omega", "negative"
    elif units in ("m/s", "m s-1", "m s^-1"):
        canonical, ascent_sign = "w", "positive"
    else:
        return unavailable(
            name, native_units,
            f"unrecognised vertical-motion units {native_units!r}; the sign "
            f"convention for ascent cannot be established, and guessing it "
            f"would invert every ascent signal downstream",
            source_fields=(native_name or "vertical_velocity",),
        )

    return _make(
        name, values, native_units,
        f"native_{canonical}_preserved_without_conversion",
        (native_name or "vertical_velocity",), grid,
        flags=(
            f"{canonical}: {ascent_sign.upper()} values are ASCENT",
            "not converted between omega and w: the exact relation needs "
            "density and the motion of the pressure surface, and the usual "
            "approximation is only valid for synoptic-scale motion",
        ),
        extra={
            "canonical_form": canonical,
            "native_units": native_units,
            "ascent_sign": ascent_sign,
        },
    )
