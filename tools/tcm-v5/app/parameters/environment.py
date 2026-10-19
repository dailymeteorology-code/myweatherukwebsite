"""Convective-environment diagnostics.

DCAPE, precipitable water, freezing and wet-bulb-zero levels, cloud depths
and the environmental quantities that later stages will use to reason about
entrainment.

Everything here is a measurement of the atmosphere. Nothing here scores,
ranks or weights anything. In particular `entrainment_indicators` returns the
component quantities and explicitly does NOT combine them into an
"entrainment score" -- how they combine is a modelling decision belonging to
a later stage, and baking one in here would hide it inside a data product.

REFERENCES
----------
Emanuel, K. A. (1994). *Atmospheric Convection*, ch. 6 -- DCAPE.
Gilmore, M. S. & Wicker, L. J. (1998). The influence of midtropospheric
    dryness on supercell morphology and evolution.
    *Monthly Weather Review*, 126, 943-958.  -- mid-level dryness.
Miller, R. C. (1972). AWS TR 200 -- wet-bulb zero as a hail diagnostic.
Doswell, C. A. (2001). Severe convective storms -- an overview.
    *Meteorological Monographs*, 28, 1-26.  -- warm-cloud depth and
    precipitation efficiency.
"""
from __future__ import annotations

import numpy as np

from . import parcel as pc
from . import thermo as th
from .column import Column
from .result import Diagnostic, Status, unavailable, worst

#: Layer searched for the DCAPE source parcel, Pa. The minimum-theta-e level
#: in the mid-troposphere is the air a downdraught most plausibly entrains.
DCAPE_SEARCH = (70_000.0, 50_000.0)

#: Cloud condensate above this counts as cloud, kg/kg. Stated, not hidden:
#: 1e-6 kg/kg is about 1 mg/kg, comfortably above numerical noise and well
#: below anything visible as cloud. Changing it changes cloud depth, so it
#: travels with every diagnostic that uses it.
CLOUD_CONDENSATE_THRESHOLD = 1e-6

#: Mid-level layer whose humidity governs dilution of an updraught, Pa.
MID_LEVEL_LAYER = (70_000.0, 50_000.0)


def precipitable_water(column: Column) -> Diagnostic:
    """Total column water vapour, kg/m2 (equivalently mm of liquid).

        PW = (1/g) INT q dp

    integrated over the available column, with specific humidity q derived
    from the mixing ratio as q = w/(1+w).

    SPECIFIC HUMIDITY, not mixing ratio: the integral is over mass of moist
    air, and q is the mass fraction of vapour in moist air while w is its
    ratio to dry air. The difference is about 2% in a warm moist column,
    which is small but systematic and free to get right.

    The integral covers only the levels that exist. A profile topping out at
    200 hPa misses the little moisture above it -- typically well under 1% --
    but a profile whose BASE is at 925 hPa misses the moistest part of the
    atmosphere entirely, so the integrated pressure range is reported and the
    result is PARTIAL when the column does not start at the surface.
    """
    name = "precipitable_water"
    unit = "kg/m2"
    sources = ("relative_humidity", "temperature")
    if not column.has_moisture:
        return unavailable(
            name, unit, "no humidity in the column", source_fields=sources,
        )

    ok = np.isfinite(column.mixing_ratio) & np.isfinite(column.pressure)
    if np.count_nonzero(ok) < 3:
        return unavailable(
            name, unit,
            f"only {int(np.count_nonzero(ok))} levels carry humidity; too "
            f"few to integrate a column total",
            source_fields=sources,
        )

    p = column.pressure[ok]
    w = column.mixing_ratio[ok]
    q = w / (1.0 + w)
    # p decreases with index; integrating in that order gives a negative
    # result, so the sign is flipped once, explicitly.
    pw = -float(np.trapezoid(q, p)) / th.GRAVITY

    flags: list[str] = []
    status = Status.AVAILABLE
    base = float(p[0])
    if column.surface_pressure is not None and \
            base < column.surface_pressure - 2000.0:
        status = Status.PARTIAL
        flags.append(
            f"integration starts at {base / 100:.0f} hPa but the surface is "
            f"at {column.surface_pressure / 100:.0f} hPa; the moistest part "
            f"of the column is missing, so this is a LOWER BOUND"
        )
    top = float(p[-1])
    if top > 30_000.0:
        flags.append(
            f"integration stops at {top / 100:.0f} hPa; moisture above that "
            f"is excluded"
        )
    if column.degraded:
        status = worst(status, Status.DEGRADED)

    return Diagnostic(
        name=name, value=pw, unit=unit, status=status,
        source_fields=sources,
        source_levels=(base / 100.0, top / 100.0),
        level_coordinate="pressure_hpa",
        method="trapezoidal_integral_of_specific_humidity_over_pressure",
        interpolation_used=False, quality_flags=tuple(flags),
        reason="; ".join(flags) if status is not Status.AVAILABLE else "",
        extra={
            "millimetres": round(pw, 2),
            "integrated_from_hpa": round(base / 100.0, 1),
            "integrated_to_hpa": round(top / 100.0, 1),
            "levels_used": int(np.count_nonzero(ok)),
        },
    )


def _crossings(
    column: Column, values: np.ndarray, threshold: float
) -> list[tuple[float, float, str]]:
    """Every crossing of `threshold`, as (pressure_Pa, height_m, direction).

    Returns ALL of them. A profile with a warm layer aloft over a cold
    surface layer genuinely has three 0 C crossings, and reporting only the
    lowest would describe a different atmosphere -- one that cannot produce
    freezing rain.
    """
    found: list[tuple[float, float, str]] = []
    ok = np.isfinite(values)
    if np.count_nonzero(ok) < 2:
        return found
    p, v, z = column.pressure[ok], values[ok], column.height[ok]
    for i in range(v.size - 1):
        a, b = v[i] - threshold, v[i + 1] - threshold
        if a == b:
            continue
        if (a <= 0 < b) or (a >= 0 > b):
            frac = -a / (b - a)
            ln_p = np.log(p[i]) + frac * (np.log(p[i + 1]) - np.log(p[i]))
            height = z[i] + frac * (z[i + 1] - z[i]) \
                if np.isfinite(z[i]) and np.isfinite(z[i + 1]) else float("nan")
            found.append((
                float(np.exp(ln_p)), float(height),
                "warming_upward" if b > a else "cooling_upward",
            ))
    return found


def freezing_level(column: Column) -> Diagnostic:
    """Height(s) of the 0 C dry-bulb isotherm.

    ALL crossings are returned, not just the lowest. `value` is the lowest
    for convenience; `extra["all_crossings"]` is the complete answer, and a
    profile with more than one is flagged -- multiple freezing levels mean a
    warm nose aloft, which is the freezing-rain signature and is invisible in
    a single number.

    When the whole column is below freezing the level does not exist and the
    diagnostic says so rather than reporting the ground.
    """
    name = "freezing_level"
    unit = "m"
    sources = ("temperature", "geopotential_height")
    if len(column) < 2:
        return unavailable(
            name, unit, "no usable temperature profile",
            source_fields=sources,
        )

    crossings = _crossings(column, column.temperature, th.ZERO_CELSIUS)
    if not crossings:
        coldest = float(np.nanmin(column.temperature)) - th.ZERO_CELSIUS
        warmest = float(np.nanmax(column.temperature)) - th.ZERO_CELSIUS
        return unavailable(
            name, unit,
            f"temperature does not cross 0 C anywhere in the column "
            f"({coldest:.1f} to {warmest:.1f} C): the whole column is "
            f"{'below' if warmest < 0 else 'above'} freezing",
            source_fields=sources,
        )

    heights = [h for _, h, _ in crossings if np.isfinite(h)]
    if not heights:
        return Diagnostic(
            name=name, value=float(crossings[0][0] / 100.0), unit="hPa",
            status=Status.PARTIAL, source_fields=sources,
            method="linear_crossing_in_log_pressure",
            interpolation_used=True,
            reason="the crossing was located in pressure but the column "
                   "carries no usable height, so it cannot be given in metres",
            extra={"pressure_hpa": round(crossings[0][0] / 100.0, 1)},
        )

    flags: list[str] = []
    if len(crossings) > 1:
        flags.append(
            f"{len(crossings)} freezing levels: a warm layer aloft over a "
            f"sub-freezing layer. This is the freezing-rain structure and a "
            f"single value cannot represent it"
        )
    base = column.height[0]
    return Diagnostic(
        name=name, value=float(heights[0]), unit=unit,
        status=Status.DEGRADED if column.degraded else Status.AVAILABLE,
        source_fields=sources, method="linear_crossing_in_log_pressure",
        interpolation_used=True, quality_flags=tuple(flags),
        reason="" if not column.degraded else
        f"column has {len(column)} usable levels",
        extra={
            "height_agl_m": round(float(heights[0] - base), 0)
            if np.isfinite(base) else None,
            "count": len(crossings),
            "all_crossings": [
                {
                    "pressure_hpa": round(p / 100.0, 1),
                    "height_m": round(h, 0) if np.isfinite(h) else None,
                    "direction": d,
                }
                for p, h, d in crossings
            ],
        },
    )


def wet_bulb_zero(column: Column) -> Diagnostic:
    """Height of the 0 C WET-BULB isotherm.

    Not the dry-bulb freezing level. In a dry sub-cloud layer evaporative
    cooling lowers the wet-bulb temperature well below the dry bulb, so the
    wet-bulb zero sits hundreds of metres -- sometimes more than a kilometre
    -- below the freezing level. That difference is the physical reason
    hailstones survive to the ground in an environment where the dry-bulb
    freezing level suggests they should melt, and it is why substituting one
    for the other is a real error rather than an approximation.

    The gap between the two is returned so it can be inspected directly.
    """
    name = "wet_bulb_zero"
    unit = "m"
    sources = ("temperature", "relative_humidity", "geopotential_height")
    if not column.has_moisture:
        return unavailable(
            name, unit,
            "wet-bulb temperature needs humidity, and the column has none",
            source_fields=sources,
        )

    crossings = _crossings(column, column.wet_bulb, th.ZERO_CELSIUS)
    if not crossings:
        return unavailable(
            name, unit,
            "the wet-bulb temperature does not cross 0 C anywhere in the "
            "column",
            source_fields=sources,
        )

    heights = [h for _, h, _ in crossings if np.isfinite(h)]
    if not heights:
        return unavailable(
            name, unit,
            "the wet-bulb zero was located in pressure but the column has no "
            "usable height profile",
            source_fields=sources,
        )

    wbz = float(heights[0])
    dry = _crossings(column, column.temperature, th.ZERO_CELSIUS)
    dry_height = next((h for _, h, _ in dry if np.isfinite(h)), float("nan"))
    gap = dry_height - wbz if np.isfinite(dry_height) else float("nan")

    base = column.height[0]
    return Diagnostic(
        name=name, value=wbz, unit=unit,
        status=Status.DEGRADED if column.degraded else Status.AVAILABLE,
        source_fields=sources,
        method="normand_wet_bulb_then_linear_crossing_in_log_pressure",
        interpolation_used=True,
        reason="" if not column.degraded else
        f"column has {len(column)} usable levels",
        extra={
            "height_agl_m": round(wbz - base, 0) if np.isfinite(base) else None,
            "freezing_level_m": round(dry_height, 0)
            if np.isfinite(dry_height) else None,
            "below_freezing_level_by_m": round(gap, 0)
            if np.isfinite(gap) else None,
            "count": len(crossings),
        },
    )


def dcape(column: Column) -> Diagnostic:
    """Downdraught CAPE.

        DCAPE = INT_(z_source)^(surface) g (Tv_env - Tv_parcel)/Tv_env dz

    METHOD, stated in full because DCAPE has no single universal definition:

    1. Source: the level of MINIMUM equivalent potential temperature between
       700 and 500 hPa. That is the driest, coldest mid-level air by moist
       entropy -- the air a downdraught most readily entrains -- and it is
       Emanuel's (1994) construction. It is not a fixed pressure.
    2. The parcel is saturated at the source by cooling it to its wet-bulb
       temperature there. This represents evaporation of precipitation into
       the descending air, which is what drives the downdraught.
    3. It then descends along a pseudoadiabat -- staying saturated, with
       evaporation maintaining saturation -- to the surface.
    4. The negative buoyancy is integrated over that descent, using virtual
       temperature, and reported as a POSITIVE number by convention (the
       energy available to a downdraught).

    Assumption made explicit: the descent is saturated throughout, which
    requires enough precipitation to keep evaporating. In a dry low-level
    layer with light precipitation the real downdraught would go
    unsaturated and warm faster, so DCAPE is an UPPER BOUND on downdraught
    energy. It is not multiplied by any efficiency factor here -- that
    would be an interpretation.
    """
    name = "dcape"
    unit = "J/kg"
    sources = ("temperature", "relative_humidity")
    if not column.has_moisture:
        return unavailable(
            name, unit,
            "DCAPE needs a humidity profile to find the minimum-theta-e "
            "level and to saturate the parcel",
            source_fields=sources, method="emanuel_1994_min_theta_e",
        )

    lo, hi = DCAPE_SEARCH
    if column.top_pressure > hi + 1e-6:
        return unavailable(
            name, unit,
            f"the profile does not reach {hi / 100:.0f} hPa, so the "
            f"minimum-theta-e source layer cannot be searched",
            source_fields=sources, method="emanuel_1994_min_theta_e",
        )

    grid = np.arange(min(lo, column.bottom_pressure), hi - 1.0, -1000.0)
    theta_e, temps, dews = [], [], []
    for p in grid:
        t = column.interp_at_pressure(column.temperature, float(p))
        td = column.interp_at_pressure(column.dewpoint, float(p))
        if np.isfinite(t) and np.isfinite(td):
            theta_e.append(float(
                th.equivalent_potential_temperature(t, min(td, t), float(p))
            ))
        else:
            theta_e.append(np.nan)
        temps.append(t)
        dews.append(td)
    theta_e = np.array(theta_e)
    if not np.any(np.isfinite(theta_e)):
        return unavailable(
            name, unit,
            "theta-e could not be evaluated anywhere in the 700-500 hPa "
            "source layer",
            source_fields=sources, method="emanuel_1994_min_theta_e",
        )

    i = int(np.nanargmin(theta_e))
    p_source = float(grid[i])
    t_source = float(temps[i])
    td_source = float(min(dews[i], temps[i]))

    # Saturate the parcel at the source by taking it to its wet-bulb
    # temperature: evaporation cools it to saturation at constant pressure.
    t_wet = float(th.wet_bulb_temperature(t_source, td_source, p_source))
    if not np.isfinite(t_wet):
        return unavailable(
            name, unit,
            "the wet-bulb temperature of the source parcel could not be "
            "determined",
            source_fields=sources, method="emanuel_1994_min_theta_e",
        )

    surface_p = column.surface_pressure or column.bottom_pressure
    surface_p = min(float(surface_p), column.bottom_pressure)
    descent = np.arange(p_source, surface_p + 1.0, 500.0)
    if descent.size < 3:
        return unavailable(
            name, unit,
            f"only {descent.size} descent points between "
            f"{p_source / 100:.0f} and {surface_p / 100:.0f} hPa",
            source_fields=sources, method="emanuel_1994_min_theta_e",
        )

    t_parcel = np.empty(descent.size)
    current_t, current_p = t_wet, p_source
    for k, p in enumerate(descent):
        current_t = th.moist_adiabatic_temperature(
            current_t, current_p, float(p), step_pa=200.0
        )
        current_p = float(p)
        t_parcel[k] = current_t

    w_parcel = th.saturation_mixing_ratio(t_parcel, descent)
    w_parcel = np.where(np.isfinite(w_parcel), w_parcel, 0.0)
    tv_parcel = th.virtual_temperature(t_parcel, w_parcel)

    env_t = np.array([
        column.interp_at_pressure(column.temperature, float(p))
        for p in descent
    ])
    env_td = np.array([
        column.interp_at_pressure(column.dewpoint, float(p)) for p in descent
    ])
    w_env = th.saturation_mixing_ratio(env_td, descent)
    w_env = np.where(np.isfinite(w_env), w_env, 0.0)
    tv_env = th.virtual_temperature(env_t, w_env)

    ok = np.isfinite(tv_env) & np.isfinite(tv_parcel)
    if np.count_nonzero(ok) < 3:
        return unavailable(
            name, unit, "the descent could not be evaluated against the "
                        "environment",
            source_fields=sources, method="emanuel_1994_min_theta_e",
        )

    # Same exact pressure-coordinate integral as CAPE, with the sign chosen
    # so a colder-than-environment parcel gives a POSITIVE DCAPE.
    dtv = tv_env[ok] - tv_parcel[ok]
    ln_p = np.log(descent[ok])
    value = float(th.R_DRY * np.trapezoid(np.where(dtv > 0, dtv, 0.0), ln_p))

    flags = [
        "assumes a saturated descent throughout, so this is an UPPER BOUND "
        "on downdraught energy; a drier descent would yield less",
        "reported POSITIVE by convention, unlike CIN",
    ]
    status = Status.DEGRADED if column.degraded else Status.AVAILABLE
    return Diagnostic(
        name=name, value=value, unit=unit, status=status,
        source_fields=sources,
        source_levels=(p_source / 100.0, surface_p / 100.0),
        level_coordinate="pressure_hpa",
        method="emanuel_1994__min_theta_e_source__saturated_pseudoadiabatic"
               "_descent__virtual_temperature",
        interpolation_used=True, quality_flags=tuple(flags),
        reason="" if status is Status.AVAILABLE else
        f"column has {len(column)} usable levels",
        extra={
            "source_pressure_hpa": round(p_source / 100.0, 1),
            "source_height_m": _round_or_none(
                column.height_at_pressure(p_source), 0
            ),
            "source_theta_e_k": round(float(np.nanmin(theta_e)), 2),
            "source_temperature_c": round(t_source - th.ZERO_CELSIUS, 2),
            "source_wet_bulb_c": round(t_wet - th.ZERO_CELSIUS, 2),
            "descended_to_hpa": round(surface_p / 100.0, 1),
        },
    )


def _round_or_none(value: float, digits: int = 1) -> float | None:
    return round(float(value), digits) if np.isfinite(value) else None


def cloud_depths(
    column: Column, ascent: pc.Ascent | None, freezing: Diagnostic
) -> dict[str, Diagnostic]:
    """Cloud depth, and its warm and cold portions.

    DEFINITIONS, chosen and stated because none of these is universal:

    * `cloud_depth` -- LCL to EL of the given parcel: the depth a convective
      cloud could occupy in this environment. This is a POTENTIAL depth from
      the thermodynamics, not an observation of cloud. Where the model
      publishes cloud condensate, `condensate_cloud_depth` reports what is
      actually there, which is a different question and is kept separate.
    * `warm_cloud_depth` -- LCL to the freezing level: the part of the cloud
      where growth is entirely by warm-rain (collision-coalescence)
      processes. A deep warm layer favours efficient rainfall (Doswell 2001);
      a shallow one favours ice processes and hail.
    * `cold_cloud_depth` -- freezing level to EL: the ice-bearing part, which
      is where charge separation and hail growth happen.

    When the freezing level is above the EL the whole cloud is warm and the
    cold depth is zero -- a genuine physical zero, reported as such.
    """
    out: dict[str, Diagnostic] = {}
    sources = ("temperature", "relative_humidity", "geopotential_height")

    if ascent is None or not ascent.status.has_value:
        why = ("no parcel ascent is available, so the cloud-bearing layer "
               "cannot be bounded")
        for n in ("cloud_depth", "warm_cloud_depth", "cold_cloud_depth"):
            out[n] = unavailable(n, "m", why, source_fields=sources)
        out["condensate_cloud_depth"] = _condensate_depth(column)
        return out

    lcl, el = ascent.lcl_height, ascent.el_height
    if not np.isfinite(lcl):
        why = "the LCL height is unknown, so the cloud base cannot be located"
        for n in ("cloud_depth", "warm_cloud_depth", "cold_cloud_depth"):
            out[n] = unavailable(n, "m", why, source_fields=sources)
        out["condensate_cloud_depth"] = _condensate_depth(column)
        return out

    if np.isfinite(el):
        out["cloud_depth"] = Diagnostic(
            name="cloud_depth", value=float(el - lcl), unit="m",
            status=ascent.status, source_fields=sources,
            method=f"lcl_to_el__parcel={ascent.parcel.kind}",
            interpolation_used=True,
            quality_flags=(
                "a POTENTIAL depth from parcel thermodynamics, not observed "
                "cloud; see condensate_cloud_depth for the model's own cloud",
            ),
            extra={
                "lcl_height_m": round(lcl, 0), "el_height_m": round(el, 0),
                "parcel": ascent.parcel.kind,
            },
        )
    elif not ascent.has_lfc:
        out["cloud_depth"] = unavailable(
            "cloud_depth", "m",
            "the parcel has no LFC, so no convective cloud forms and there "
            "is no depth to report",
            source_fields=sources,
        )
    else:
        out["cloud_depth"] = unavailable(
            "cloud_depth", "m",
            "no EL: the parcel is still buoyant at the top of the profile, "
            "so the cloud top is above the data",
            source_fields=sources,
        )

    fz = freezing.value if freezing.status.has_value else None
    if fz is None:
        why = f"the freezing level is unavailable: {freezing.reason}"
        out["warm_cloud_depth"] = unavailable("warm_cloud_depth", "m", why,
                                              source_fields=sources)
        out["cold_cloud_depth"] = unavailable("cold_cloud_depth", "m", why,
                                              source_fields=sources)
    else:
        fz = float(fz)
        # Capped at the equilibrium level. The warm cloud layer cannot extend
        # above the cloud top: at Birmingham the freezing level sits at
        # 3112 m over a cloud that tops out at 1712 m, and an uncapped
        # freezing_level - LCL returns 1938 m of "warm cloud" inside a cloud
        # only 538 m deep.
        cloud_top = el if np.isfinite(el) else fz
        warm = min(fz, cloud_top) - lcl
        if warm < 0:
            out["warm_cloud_depth"] = Diagnostic(
                name="warm_cloud_depth", value=0.0, unit="m",
                status=ascent.status, source_fields=sources,
                method="lcl_to_freezing_level",
                quality_flags=(
                    "the freezing level lies BELOW the cloud base, so the "
                    "cloud is glaciated from its base up: zero is the "
                    "physical result, not a missing value",
                ),
                extra={"freezing_level_m": round(fz, 0),
                       "lcl_height_m": round(lcl, 0)},
            )
        else:
            out["warm_cloud_depth"] = Diagnostic(
                name="warm_cloud_depth", value=float(warm), unit="m",
                status=ascent.status, source_fields=sources,
                method="lcl_to_min_of_freezing_level_and_cloud_top",
                interpolation_used=True,
                quality_flags=(
                    ("capped at the equilibrium level: the freezing level "
                     "lies above the cloud top, so the whole cloud is warm",)
                    if np.isfinite(el) and fz > el else ()
                ) + (
                    () if np.isfinite(el) else
                    ("no EL, so the cloud top is unknown and this depth is "
                     "NOT capped at it; treat as an upper bound",)
                ) + (
                    () if ascent.has_lfc else
                    ("the parcel has no LFC, so no convective cloud actually "
                     "forms; this is the depth a cloud WOULD be warm through "
                     "given this cloud base, not an observed cloud",)
                ),
                extra={"freezing_level_m": round(fz, 0),
                       "lcl_height_m": round(lcl, 0),
                       "cloud_top_m": round(float(cloud_top), 0)},
            )

        if np.isfinite(el):
            cold = max(el - max(fz, lcl), 0.0)
            out["cold_cloud_depth"] = Diagnostic(
                name="cold_cloud_depth", value=float(cold), unit="m",
                status=ascent.status, source_fields=sources,
                method="freezing_level_to_el", interpolation_used=True,
                quality_flags=(
                    () if cold > 0 else
                    ("zero: the equilibrium level lies below the freezing "
                     "level, so no part of the cloud is glaciated",)
                ),
                extra={"freezing_level_m": round(fz, 0),
                       "el_height_m": round(el, 0)},
            )
        elif not ascent.has_lfc:
            out["cold_cloud_depth"] = unavailable(
                "cold_cloud_depth", "m",
                "the parcel has no LFC, so no convective cloud forms and no "
                "part of one can be glaciated",
                source_fields=sources,
            )
        else:
            out["cold_cloud_depth"] = unavailable(
                "cold_cloud_depth", "m",
                "no EL, so the top of the ice-bearing layer is unknown",
                source_fields=sources,
            )

    out["condensate_cloud_depth"] = _condensate_depth(column)
    return out


def _condensate_depth(column: Column) -> Diagnostic:
    """Depth of the layer the model actually holds cloud condensate in.

    Requires the model's cloud water field, which is not always ordered. When
    absent this is unavailable -- the parcel-derived `cloud_depth` answers a
    different question and is not a substitute.
    """
    return unavailable(
        "condensate_cloud_depth", "m",
        "cloud condensate is not carried on the extracted column; the "
        "parcel-derived cloud_depth answers a different question (potential "
        "rather than modelled cloud) and is not a substitute",
        source_fields=("cloud_water_mixing_ratio", "cloud_ice_mixing_ratio"),
    )


def entrainment_indicators(column: Column) -> Diagnostic:
    """Environmental quantities governing dilution of an updraught.

    Deliberately NOT an "entrainment score". Each quantity below is a
    measurement; how they combine into a dilution estimate depends on
    updraught width, storm mode and organisation, none of which is known at
    this stage. Combining them here would bury a modelling decision inside a
    data product, so they are returned side by side.

    What is returned:
      * mean mid-level (700-500 hPa) relative humidity -- dry mid-levels
        dilute an updraught and strengthen downdraughts (Gilmore & Wicker
        1998)
      * the minimum RH in that layer, and the pressure it occurs at
      * the low-to-mid mixing-ratio contrast, which is what actually drives
        evaporative cooling on entrainment
      * mean low-level (surface to 850 hPa) RH
    """
    name = "entrainment_indicators"
    unit = "%"
    sources = ("relative_humidity", "temperature")
    if not column.has_moisture:
        return unavailable(
            name, unit, "no humidity profile", source_fields=sources,
        )

    lo, hi = MID_LEVEL_LAYER
    if column.top_pressure > hi + 1e-6:
        return unavailable(
            name, unit,
            f"the profile does not reach {hi / 100:.0f} hPa, so the "
            f"mid-level layer cannot be sampled",
            source_fields=sources,
        )

    grid = np.arange(min(lo, column.bottom_pressure), hi - 1.0, -1000.0)
    rh, w_mid = [], []
    for p in grid:
        t = column.interp_at_pressure(column.temperature, float(p))
        td = column.interp_at_pressure(column.dewpoint, float(p))
        if np.isfinite(t) and np.isfinite(td):
            value = 100.0 * float(
                th.saturation_vapour_pressure(min(td, t))
                / th.saturation_vapour_pressure(t)
            )
            rh.append(value)
            w_mid.append(float(th.saturation_mixing_ratio(min(td, t),
                                                          float(p))))
        else:
            rh.append(np.nan)
            w_mid.append(np.nan)
    rh = np.array(rh)
    if not np.any(np.isfinite(rh)):
        return unavailable(
            name, unit, "humidity could not be evaluated in the 700-500 hPa "
                        "layer",
            source_fields=sources,
        )

    mean_rh = float(np.nanmean(rh))
    i_min = int(np.nanargmin(rh))

    # Low-level layer: surface to 850 hPa.
    low_grid = np.arange(column.bottom_pressure,
                         max(85_000.0, column.top_pressure) - 1.0, -1000.0)
    low_rh, low_w = [], []
    for p in low_grid:
        t = column.interp_at_pressure(column.temperature, float(p))
        td = column.interp_at_pressure(column.dewpoint, float(p))
        if np.isfinite(t) and np.isfinite(td):
            low_rh.append(100.0 * float(
                th.saturation_vapour_pressure(min(td, t))
                / th.saturation_vapour_pressure(t)
            ))
            low_w.append(float(th.saturation_mixing_ratio(min(td, t),
                                                          float(p))))
    mean_low_rh = float(np.mean(low_rh)) if low_rh else float("nan")
    mean_low_w = float(np.mean(low_w)) if low_w else float("nan")
    mean_mid_w = float(np.nanmean(w_mid))

    return Diagnostic(
        name=name, value=mean_rh, unit=unit,
        status=Status.DEGRADED if column.degraded else Status.AVAILABLE,
        source_fields=sources, source_levels=(700.0, 500.0),
        level_coordinate="pressure_hpa",
        method="layer_mean_humidity_and_mixing_ratio_contrast",
        interpolation_used=True,
        reason="" if not column.degraded else
        f"column has {len(column)} usable levels",
        quality_flags=(
            "component measurements only; deliberately NOT combined into an "
            "entrainment score, which depends on updraught width and storm "
            "mode and belongs to a later stage",
        ),
        extra={
            "mid_level_mean_rh_percent": round(mean_rh, 1),
            "mid_level_min_rh_percent": round(float(np.nanmin(rh)), 1),
            "mid_level_min_rh_at_hpa": round(float(grid[i_min]) / 100.0, 1),
            "mid_level_mean_mixing_ratio_g_kg": round(mean_mid_w * 1000.0, 3),
            "low_level_mean_rh_percent": _round_or_none(mean_low_rh),
            "low_level_mean_mixing_ratio_g_kg": _round_or_none(
                mean_low_w * 1000.0, 3
            ),
            "low_to_mid_mixing_ratio_contrast_g_kg": _round_or_none(
                (mean_low_w - mean_mid_w) * 1000.0, 3
            ),
        },
    )
