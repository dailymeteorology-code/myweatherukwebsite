"""Lapse rates.

SIGN CONVENTION -- fixed here and used platform-wide
-----------------------------------------------------
A lapse rate is reported as

    gamma = -dT/dz     in K/km

so it is POSITIVE when temperature falls with height, which is the normal
atmosphere, and NEGATIVE across an inversion. Every value in this module
follows that, including the pressure-layer rates.

An inversion is a real and important feature -- it is the cap that lets
instability build through the morning -- so a negative lapse rate is never
clipped, rejected or flagged as an error. It is flagged as an *inversion*,
which is different: information, not a fault.

REFERENCE VALUES, for orientation
---------------------------------
    dry adiabatic          9.8 K/km
    saturated adiabatic    4-7 K/km, steepening with height as it cools
    ICA troposphere        6.5 K/km
    absolutely unstable    > 9.8 K/km
    inversion              < 0

WHY HEIGHT LEVELS ARE NOT SUBSTITUTED WITH PRESSURE LEVELS
-----------------------------------------------------------
"1 km is about 900 hPa" is true on average and wrong in every specific case
that matters. The height of a pressure surface varies with the temperature of
the column beneath it -- by well over 100 m between a cold and a warm airmass
-- and again with the ground elevation. In a Highland winter 900 hPa can be
near the surface. So the height-based rates below interpolate the temperature
profile to true geometric heights, and the pressure-based rates use true
pressure surfaces. Neither stands in for the other.
"""
from __future__ import annotations

import numpy as np

from . import thermo as th
from .column import Column
from .result import Diagnostic, Status, unavailable

#: A rate steeper than this is superadiabatic. Physically possible in a
#: shallow surface layer on a hot day, implausible through a deep layer, so
#: it is flagged rather than silently accepted.
DRY_ADIABATIC_K_KM = th.GRAVITY / th.CP_DRY * 1000.0    # 9.75 K/km

#: Height layers, m AGL.
HEIGHT_LAYERS: tuple[tuple[str, float, float], ...] = (
    ("lr_0_1km", 0.0, 1000.0),
    ("lr_0_3km", 0.0, 3000.0),
    ("lr_0_6km", 0.0, 6000.0),
)

#: Pressure layers, hPa.
PRESSURE_LAYERS: tuple[tuple[str, float, float], ...] = (
    ("lr_850_500", 850.0, 500.0),
    ("lr_700_500", 700.0, 500.0),
)


def _flags_for(rate: float, depth_m: float) -> tuple[str, ...]:
    flags: list[str] = []
    if rate < 0:
        flags.append(
            "inversion: temperature increases with height through this layer"
        )
    elif rate > DRY_ADIABATIC_K_KM + 0.05:
        flags.append(
            f"superadiabatic ({rate:.2f} K/km exceeds the dry adiabatic "
            f"{DRY_ADIABATIC_K_KM:.2f} K/km); physical in a shallow surface "
            f"layer, questionable through {depth_m:.0f} m"
        )
    return tuple(flags)


def height_lapse_rate(
    column: Column, name: str, bottom_m: float, top_m: float
) -> Diagnostic:
    """Lapse rate between two geometric heights above ground.

    Heights are AGL: the column's own base is the datum, so the same layer
    means the same thing over the Fens and over the Cairngorms.
    """
    unit = "K/km"
    sources = ("temperature", "geopotential_height")
    if len(column) < 2:
        return unavailable(name, unit, "no usable temperature profile",
                           source_fields=sources)

    base = column.height[0]
    if not np.isfinite(base):
        return unavailable(
            name, unit,
            "column base height is unknown, so heights above ground cannot "
            "be located", source_fields=sources,
        )

    z_bottom, z_top = base + bottom_m, base + top_m
    t_bottom = column.interp_at_height(column.temperature, z_bottom)
    t_top = column.interp_at_height(column.temperature, z_top)

    if not np.isfinite(t_top):
        top_available = float(column.height[np.isfinite(column.temperature)][-1])
        return unavailable(
            name, unit,
            f"the profile reaches only {top_available - base:.0f} m above "
            f"ground, below the {top_m:.0f} m this layer needs; extrapolating "
            f"a lapse rate past the data would invent the answer",
            source_fields=sources,
        )
    if not np.isfinite(t_bottom):
        return unavailable(
            name, unit,
            f"temperature unavailable at {bottom_m:.0f} m above ground",
            source_fields=sources,
        )

    rate = -(t_top - t_bottom) / (top_m - bottom_m) * 1000.0
    status = Status.DEGRADED if column.degraded else Status.AVAILABLE
    return Diagnostic(
        name=name, value=float(rate), unit=unit, status=status,
        source_fields=sources,
        source_levels=(bottom_m, top_m), level_coordinate="height_agl_m",
        method="temperature_difference_over_geometric_depth",
        interpolation_used=True,
        quality_flags=_flags_for(float(rate), top_m - bottom_m),
        reason="" if status is Status.AVAILABLE else (
            f"column has {len(column)} usable levels, "
            f"{column.native_fraction:.0%} native"
        ),
        extra={
            "temperature_bottom_c": round(t_bottom - th.ZERO_CELSIUS, 2),
            "temperature_top_c": round(t_top - th.ZERO_CELSIUS, 2),
            "depth_m": top_m - bottom_m,
        },
    )


def pressure_lapse_rate(
    column: Column, name: str, bottom_hpa: float, top_hpa: float
) -> Diagnostic:
    """Lapse rate between two pressure surfaces, expressed in K/km.

    K/km, not K per 100 hPa. A pressure interval is not a fixed depth -- the
    850-500 hPa layer is roughly 4 km thick in a warm airmass and several
    hundred metres less in a cold one -- so expressing the rate per pressure
    would make the same number mean different things in different airmasses,
    and would not be comparable with the height-based rates in this module.
    The true geometric thickness of the layer is used.

    Where the layer is below ground (a pressure surface beneath terrain) the
    result is unavailable, not extrapolated.
    """
    unit = "K/km"
    sources = ("temperature", "geopotential_height")
    p_bottom, p_top = bottom_hpa * 100.0, top_hpa * 100.0

    if p_bottom > column.bottom_pressure + 1e-6:
        return unavailable(
            name, unit,
            f"{bottom_hpa:.0f} hPa is below the base of the usable column "
            f"({column.bottom_pressure / 100:.0f} hPa) -- underground or "
            f"outside the data",
            source_fields=sources,
        )
    if p_top < column.top_pressure - 1e-6:
        return unavailable(
            name, unit,
            f"{top_hpa:.0f} hPa is above the top of the profile "
            f"({column.top_pressure / 100:.0f} hPa)",
            source_fields=sources,
        )

    t_bottom = column.interp_at_pressure(column.temperature, p_bottom)
    t_top = column.interp_at_pressure(column.temperature, p_top)
    z_bottom = column.height_at_pressure(p_bottom)
    z_top = column.height_at_pressure(p_top)

    if not (np.isfinite(t_bottom) and np.isfinite(t_top)):
        return unavailable(
            name, unit,
            f"temperature unavailable at {bottom_hpa:.0f} or {top_hpa:.0f} hPa",
            source_fields=sources,
        )

    flags: list[str] = []
    if np.isfinite(z_bottom) and np.isfinite(z_top) and z_top > z_bottom:
        depth_m = z_top - z_bottom
        method = "temperature_difference_over_geopotential_thickness"
    else:
        # No usable heights: fall back to the hypsometric thickness the
        # temperatures themselves imply. Recorded, because it is a weaker
        # route -- it uses the layer-mean virtual temperature rather than the
        # model's own geopotential.
        w_b = th.saturation_mixing_ratio(
            column.interp_at_pressure(column.dewpoint, p_bottom), p_bottom
        )
        w_t = th.saturation_mixing_ratio(
            column.interp_at_pressure(column.dewpoint, p_top), p_top
        )
        w_b = float(w_b) if np.isfinite(w_b) else 0.0
        w_t = float(w_t) if np.isfinite(w_t) else 0.0
        tv_mean = 0.5 * (
            float(th.virtual_temperature(t_bottom, w_b))
            + float(th.virtual_temperature(t_top, w_t))
        )
        depth_m = th.hypsometric_thickness(p_bottom, p_top, tv_mean)
        method = "temperature_difference_over_hypsometric_thickness"
        flags.append(
            "geopotential height unavailable; layer depth computed "
            "hypsometrically from the layer-mean virtual temperature"
        )

    if not np.isfinite(depth_m) or depth_m <= 0:
        return unavailable(
            name, unit, "layer depth could not be determined",
            source_fields=sources,
        )

    rate = -(t_top - t_bottom) / depth_m * 1000.0
    status = Status.DEGRADED if (column.degraded or flags) else Status.AVAILABLE
    return Diagnostic(
        name=name, value=float(rate), unit=unit, status=status,
        source_fields=sources,
        source_levels=(bottom_hpa, top_hpa), level_coordinate="pressure_hpa",
        method=method,
        interpolation_used=bottom_hpa not in column.source_levels
        or top_hpa not in column.source_levels,
        quality_flags=tuple(flags) + _flags_for(float(rate), depth_m),
        reason="" if status is Status.AVAILABLE else (
            "; ".join(flags) or
            f"column has {len(column)} usable levels, "
            f"{column.native_fraction:.0%} native"
        ),
        extra={
            "temperature_bottom_c": round(t_bottom - th.ZERO_CELSIUS, 2),
            "temperature_top_c": round(t_top - th.ZERO_CELSIUS, 2),
            "depth_m": round(float(depth_m), 1),
        },
    )


def all_lapse_rates(column: Column) -> dict[str, Diagnostic]:
    """Every lapse rate this stage defines."""
    out: dict[str, Diagnostic] = {}
    for name, bottom, top in HEIGHT_LAYERS:
        out[name] = height_lapse_rate(column, name, bottom, top)
    for name, bottom, top in PRESSURE_LAYERS:
        out[name] = pressure_lapse_rate(column, name, bottom, top)
    return out
