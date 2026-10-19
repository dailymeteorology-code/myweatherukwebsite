"""Classical stability indices.

These predate CAPE-based analysis and were designed for hand computation from
a radiosonde using two or three mandatory levels. They are implemented here
because they remain in operational use and later stages may want them, but
each carries its limitations in `quality_flags` rather than in a footnote
somewhere.

WHAT THEY ARE NOT
-----------------
None of these is a probability of thunderstorms. Every one was tuned to a
particular region and season -- mostly the US Great Plains in the 1950s-70s
-- and none accounts for the depth of the moist layer, the shape of the
buoyancy profile, or shear. Where CAPE, CIN and shear are available they are
strictly better information. A later stage that treats "K index 30" as a
forecast is misusing the number, and the flags on each diagnostic say so.

They are kept for three real reasons: they are cheap, they are comparable
with decades of literature and forecaster experience, and they are computable
from a two- or three-level profile where a full parcel ascent is not.

SIGN CONVENTIONS
----------------
    Lifted Index      NEGATIVE means unstable. It is T_env - T_parcel.
    Showalter Index   NEGATIVE means unstable. Same construction.
    Total Totals      LARGER means more unstable.
    K Index           LARGER means more unstable.
    SWEAT             LARGER means more severe potential.

The two that are negative-for-unstable are the ones most often sign-flipped
by mistake, so both are stated on the diagnostic itself.

REFERENCES
----------
Galway, J. G. (1956). The lifted index as a predictor of latent instability.
    *Bull. Amer. Meteor. Soc.*, 37, 528-529.
Showalter, A. K. (1953). A stability index for thunderstorm forecasting.
    *Bull. Amer. Meteor. Soc.*, 34, 250-252.
Miller, R. C. (1972). Notes on analysis and severe storm forecasting
    procedures of the Air Force Global Weather Central. AWS TR 200 (Rev.).
    -- Total Totals, SWEAT.
George, J. J. (1960). *Weather Forecasting for Aeronautics*. Academic Press.
    -- K index.
"""
from __future__ import annotations

import numpy as np

from . import parcel as pc
from . import thermo as th
from . import wind as wd
from .column import Column
from .result import Diagnostic, Status, unavailable

#: The level classical indices lift a parcel to, Pa.
TARGET_PRESSURE = 50_000.0
#: Showalter's parcel origin, Pa.
SHOWALTER_SOURCE = 85_000.0

_LEGACY_FLAG = (
    "a legacy single/two-level index: it ignores moist-layer depth, "
    "buoyancy distribution and shear, and is not a thunderstorm probability"
)

MS_TO_KNOTS = 1.9438445


def _at(column: Column, values: np.ndarray, pressure_pa: float) -> float:
    return column.interp_at_pressure(values, pressure_pa)


def lifted_index(column: Column, ascent: pc.Ascent | None) -> Diagnostic:
    """Lifted Index: environment minus parcel temperature at 500 hPa.

        LI = T_env(500 hPa) - T_parcel(500 hPa)

    Negative means the lifted parcel is warmer than its surroundings, i.e.
    unstable.

    The parcel is the SURFACE-BASED parcel from the shared parcel engine, so
    LI and SBCAPE describe the same ascent -- Galway's original used a
    surface parcel. This is stated because the alternative convention (a
    mixed-layer parcel) produces a systematically different number under the
    same name, and mixing the two across a dataset is exactly the kind of
    silent inconsistency this stage exists to prevent.

    DRY temperature, not virtual: LI is defined on the dry-bulb temperature
    difference, unlike CAPE. Using virtual temperature here would give a
    number that is not comparable with any published LI.
    """
    name = "lifted_index"
    unit = "K"
    sources = ("temperature", "relative_humidity")
    if ascent is None or not ascent.status.has_value or ascent.pressure.size == 0:
        return unavailable(
            name, unit,
            "the surface parcel ascent is unavailable, so no parcel "
            "temperature exists at 500 hPa",
            source_fields=sources, method="galway_1956",
        )
    if column.top_pressure > TARGET_PRESSURE + 1e-6:
        return unavailable(
            name, unit,
            f"the profile tops out at {column.top_pressure / 100:.0f} hPa "
            f"and does not reach 500 hPa",
            source_fields=sources, method="galway_1956",
        )

    t_env = _at(column, column.temperature, TARGET_PRESSURE)
    order = np.argsort(ascent.pressure)
    t_parcel = float(np.interp(
        TARGET_PRESSURE, ascent.pressure[order],
        ascent.parcel_temperature[order],
    ))
    if not (np.isfinite(t_env) and np.isfinite(t_parcel)):
        return unavailable(
            name, unit, "temperature unavailable at 500 hPa",
            source_fields=sources, method="galway_1956",
        )

    return Diagnostic(
        name=name, value=float(t_env - t_parcel), unit=unit,
        status=ascent.status if ascent.status.has_value else Status.DEGRADED,
        source_fields=sources, source_levels=(500.0,),
        level_coordinate="pressure_hpa",
        method=f"galway_1956__parcel={ascent.parcel.kind}"
               f"__dry_bulb_difference",
        interpolation_used=True,
        quality_flags=(
            "NEGATIVE means unstable",
            f"parcel source: {ascent.parcel.kind} "
            f"({ascent.parcel.method}); a mixed-layer parcel gives a "
            f"different LI under the same name",
            _LEGACY_FLAG,
        ),
        extra={
            "environment_temperature_c": round(t_env - th.ZERO_CELSIUS, 2),
            "parcel_temperature_c": round(t_parcel - th.ZERO_CELSIUS, 2),
            "parcel": ascent.parcel.to_dict(),
        },
    )


def showalter_index(column: Column) -> Diagnostic:
    """Showalter Index: an 850 hPa parcel lifted to 500 hPa.

    Deliberately NOT surface-based. Showalter's parcel starts at 850 hPa,
    which makes the index insensitive to a shallow surface layer -- useful
    for elevated convection, and useless when the 850 hPa surface is
    underground, which over the Scottish Highlands it can be.

    Where 850 hPa is below ground the index is unavailable. Substituting the
    lowest available level would produce a number that is not a Showalter
    Index.
    """
    name = "showalter_index"
    unit = "K"
    sources = ("temperature", "relative_humidity")

    if SHOWALTER_SOURCE > column.bottom_pressure + 1e-6:
        return unavailable(
            name, unit,
            f"850 hPa is below the base of the usable column "
            f"({column.bottom_pressure / 100:.0f} hPa) -- underground. "
            f"Lifting from a substitute level would not be a Showalter Index",
            source_fields=sources, method="showalter_1953",
        )
    if column.top_pressure > TARGET_PRESSURE + 1e-6:
        return unavailable(
            name, unit,
            f"the profile does not reach 500 hPa (top is "
            f"{column.top_pressure / 100:.0f} hPa)",
            source_fields=sources, method="showalter_1953",
        )

    t850 = _at(column, column.temperature, SHOWALTER_SOURCE)
    td850 = _at(column, column.dewpoint, SHOWALTER_SOURCE)
    t500 = _at(column, column.temperature, TARGET_PRESSURE)
    if not (np.isfinite(t850) and np.isfinite(td850) and np.isfinite(t500)):
        return unavailable(
            name, unit,
            "temperature or humidity unavailable at 850 or 500 hPa",
            source_fields=sources, method="showalter_1953",
        )

    td850 = min(td850, t850)
    p_lcl = float(th.lcl_pressure(t850, td850, SHOWALTER_SOURCE))
    t_lcl = float(th.lcl_temperature(t850, td850))
    if p_lcl >= TARGET_PRESSURE:
        t_parcel = th.moist_adiabatic_temperature(
            t_lcl, p_lcl, TARGET_PRESSURE
        )
        route = "dry_then_pseudoadiabatic"
    else:
        # The parcel does not saturate before 500 hPa: the whole lift is dry.
        t_parcel = float(th.dry_adiabatic_temperature(
            t850, SHOWALTER_SOURCE, TARGET_PRESSURE
        ))
        route = "dry_throughout_parcel_never_saturates"

    return Diagnostic(
        name=name, value=float(t500 - t_parcel), unit=unit,
        status=Status.DEGRADED if column.degraded else Status.AVAILABLE,
        source_fields=sources, source_levels=(850.0, 500.0),
        level_coordinate="pressure_hpa",
        method=f"showalter_1953__{route}",
        interpolation_used=True,
        reason="" if not column.degraded else
        f"column has {len(column)} usable levels",
        quality_flags=(
            "NEGATIVE means unstable",
            "parcel originates at 850 hPa, so surface-based instability "
            "beneath that level is invisible to this index",
            _LEGACY_FLAG,
        ),
        extra={
            "parcel_temperature_500_c": round(t_parcel - th.ZERO_CELSIUS, 2),
            "environment_temperature_500_c": round(t500 - th.ZERO_CELSIUS, 2),
            "lcl_hpa": round(p_lcl / 100.0, 1),
        },
    )


def total_totals(column: Column) -> Diagnostic:
    """Total Totals index (Miller 1972).

        TT = VT + CT
        VT = T(850) - T(500)          vertical totals -- the lapse rate term
        CT = Td(850) - T(500)         cross totals    -- the moisture term

    Both constituents are returned, because they carry different information
    and the sum conflates them: TT = 50 from a steep dry lapse rate is a
    different atmosphere from TT = 50 from a moist 850 hPa layer under a
    modest lapse rate, and only the second will produce storms readily.
    """
    name = "total_totals"
    unit = "K"
    sources = ("temperature", "relative_humidity")

    if SHOWALTER_SOURCE > column.bottom_pressure + 1e-6:
        return unavailable(
            name, unit,
            f"850 hPa is below ground ({column.bottom_pressure / 100:.0f} hPa "
            f"surface)", source_fields=sources, method="miller_1972",
        )
    if column.top_pressure > TARGET_PRESSURE + 1e-6:
        return unavailable(
            name, unit, "the profile does not reach 500 hPa",
            source_fields=sources, method="miller_1972",
        )

    t850 = _at(column, column.temperature, SHOWALTER_SOURCE)
    td850 = _at(column, column.dewpoint, SHOWALTER_SOURCE)
    t500 = _at(column, column.temperature, TARGET_PRESSURE)
    if not (np.isfinite(t850) and np.isfinite(td850) and np.isfinite(t500)):
        return unavailable(
            name, unit, "temperature or humidity unavailable at 850 or "
                        "500 hPa",
            source_fields=sources, method="miller_1972",
        )

    vt = float(t850 - t500)
    ct = float(min(td850, t850) - t500)
    return Diagnostic(
        name=name, value=vt + ct, unit=unit,
        status=Status.DEGRADED if column.degraded else Status.AVAILABLE,
        source_fields=sources, source_levels=(850.0, 500.0),
        level_coordinate="pressure_hpa", method="miller_1972",
        interpolation_used=True,
        reason="" if not column.degraded else
        f"column has {len(column)} usable levels",
        quality_flags=(
            "LARGER means more unstable",
            "the sum conflates the lapse-rate and moisture terms; use "
            "vertical_totals and cross_totals to tell them apart",
            _LEGACY_FLAG,
        ),
        extra={
            "vertical_totals_k": round(vt, 2),
            "cross_totals_k": round(ct, 2),
        },
    )


def k_index(column: Column) -> Diagnostic:
    """K index (George 1960).

        K = (T850 - T500) + Td850 - (T700 - Td700)

    in degrees CELSIUS -- the only index here whose published thresholds are
    tied to a temperature scale, so the arithmetic is done in Celsius and the
    unit says so.

    The last term is the 700 hPa dew-point depression: a dry layer there
    subtracts from K. That makes K a diagnostic of a DEEP MOIST COLUMN, which
    is why it performs reasonably for airmass thunderstorms and poorly for
    the sheared, drier-mid-level environments that produce severe weather.
    """
    name = "k_index"
    unit = "degC"
    sources = ("temperature", "relative_humidity")

    if SHOWALTER_SOURCE > column.bottom_pressure + 1e-6:
        return unavailable(
            name, unit, "850 hPa is below ground",
            source_fields=sources, method="george_1960",
        )
    if column.top_pressure > TARGET_PRESSURE + 1e-6:
        return unavailable(
            name, unit, "the profile does not reach 500 hPa",
            source_fields=sources, method="george_1960",
        )

    c = th.ZERO_CELSIUS
    t850 = _at(column, column.temperature, 85_000.0) - c
    td850 = _at(column, column.dewpoint, 85_000.0) - c
    t700 = _at(column, column.temperature, 70_000.0) - c
    td700 = _at(column, column.dewpoint, 70_000.0) - c
    t500 = _at(column, column.temperature, 50_000.0) - c

    if not all(np.isfinite(v) for v in (t850, td850, t700, td700, t500)):
        missing = [
            n for n, v in (
                ("T850", t850), ("Td850", td850), ("T700", t700),
                ("Td700", td700), ("T500", t500),
            ) if not np.isfinite(v)
        ]
        return unavailable(
            name, unit,
            f"K index needs all of T850, Td850, T700, Td700, T500; missing "
            f"{', '.join(missing)}",
            source_fields=sources, method="george_1960",
        )

    depression = float(t700 - min(td700, t700))
    value = float((t850 - t500) + min(td850, t850) - depression)
    return Diagnostic(
        name=name, value=value, unit=unit,
        status=Status.DEGRADED if column.degraded else Status.AVAILABLE,
        source_fields=sources, source_levels=(850.0, 700.0, 500.0),
        level_coordinate="pressure_hpa", method="george_1960",
        interpolation_used=True,
        reason="" if not column.degraded else
        f"column has {len(column)} usable levels",
        quality_flags=(
            "LARGER means more unstable",
            "measures a deep moist column; it degrades sharply in dry "
            "mid-level environments, which are common in UK severe cases",
            "an atmospheric diagnostic, NOT a probability of thunderstorms",
            _LEGACY_FLAG,
        ),
        extra={
            "lapse_term_k": round(float(t850 - t500), 2),
            "moisture_term_c": round(float(min(td850, t850)), 2),
            "dewpoint_depression_700_c": round(depression, 2),
        },
    )


def sweat_index(column: Column, totals: Diagnostic) -> Diagnostic:
    """SWEAT index (Miller 1972).

        SWEAT = 12*Td850 + 20*(TT - 49) + 2*f850 + f500 + 125*(S + 0.2)

    with Td850 in degrees Celsius, wind speeds f in KNOTS, and
    S = sin(dir500 - dir850).

    Miller's rules, applied exactly as published:
      * the 12*Td850 term is set to zero if Td850 is negative
      * the 20*(TT-49) term is set to zero if TT < 49
      * the whole 125*(S+0.2) shear term is set to zero unless ALL of:
          - dir850 lies between 130 and 250 degrees
          - dir500 lies between 210 and 310 degrees
          - dir500 - dir850 is positive (veering)
          - both f850 and f500 are at least 15 knots

    Those conditionals are the index, not tidiness -- they encode the
    warm-advection veering profile Miller was looking for. Dropping them
    yields a number that is not SWEAT.

    KNOTS are used because the published coefficients are calibrated to
    knots. The conversion happens here; nothing outside this function sees
    a knot.
    """
    name = "sweat_index"
    unit = "dimensionless"
    sources = ("temperature", "relative_humidity", "u_wind", "v_wind")

    if not totals.status.has_value or totals.value is None:
        return unavailable(
            name, unit,
            f"SWEAT needs Total Totals, which is unavailable: "
            f"{totals.reason}",
            source_fields=sources, method="miller_1972",
        )
    if not column.has_wind:
        return unavailable(
            name, unit,
            "SWEAT needs 850 and 500 hPa wind, and the pressure column "
            "carries none",
            source_fields=sources, method="miller_1972",
        )

    td850_c = _at(column, column.dewpoint, 85_000.0) - th.ZERO_CELSIUS
    u850 = _at(column, column.u_wind, 85_000.0)
    v850 = _at(column, column.v_wind, 85_000.0)
    u500 = _at(column, column.u_wind, 50_000.0)
    v500 = _at(column, column.v_wind, 50_000.0)

    if not all(np.isfinite(v) for v in (td850_c, u850, v850, u500, v500)):
        return unavailable(
            name, unit,
            "850 hPa dew point or 850/500 hPa wind unavailable",
            source_fields=sources, method="miller_1972",
        )

    f850 = float(np.hypot(u850, v850)) * MS_TO_KNOTS
    f500 = float(np.hypot(u500, v500)) * MS_TO_KNOTS
    dir850 = float(wd.direction_from_components(u850, v850))
    dir500 = float(wd.direction_from_components(u500, v500))
    tt = float(totals.value)

    term_moisture = 12.0 * max(td850_c, 0.0)
    term_totals = 20.0 * max(tt - 49.0, 0.0)
    term_wind = 2.0 * f850 + f500

    shear_ok = (
        np.isfinite(dir850) and np.isfinite(dir500)
        and 130.0 <= dir850 <= 250.0
        and 210.0 <= dir500 <= 310.0
        and (dir500 - dir850) > 0.0
        and f850 >= 15.0 and f500 >= 15.0
    )
    if shear_ok:
        s = float(np.sin(np.radians(dir500 - dir850)))
        term_shear = 125.0 * (s + 0.2)
    else:
        term_shear = 0.0

    value = term_moisture + term_totals + term_wind + term_shear
    return Diagnostic(
        name=name, value=float(value), unit=unit, status=totals.status,
        source_fields=sources, source_levels=(850.0, 500.0),
        level_coordinate="pressure_hpa",
        method="miller_1972_awstr200_with_published_conditionals",
        interpolation_used=True,
        reason=totals.reason,
        quality_flags=(
            "LARGER means greater severe potential",
            "NOT a substitute for CAPE and shear analysis; SWEAT was tuned "
            "to US Great Plains soundings and mixes thermodynamics with "
            "wind in fixed proportions that do not transfer",
            "wind direction convention: meteorological degrees, and the "
            "shear term is zero unless Miller's veering criteria are met",
            _LEGACY_FLAG,
        ),
        extra={
            "total_totals": round(tt, 2),
            "dewpoint_850_c": round(float(td850_c), 2),
            "speed_850_kt": round(f850, 1),
            "speed_500_kt": round(f500, 1),
            "direction_850_deg": round(dir850, 1)
            if np.isfinite(dir850) else None,
            "direction_500_deg": round(dir500, 1)
            if np.isfinite(dir500) else None,
            "shear_term_applied": bool(shear_ok),
            "shear_term_suppressed_because": (
                None if shear_ok else
                "Miller's veering criteria not met (850 dir 130-250, "
                "500 dir 210-310, veering, both >= 15 kt)"
            ),
            "terms": {
                "moisture": round(term_moisture, 2),
                "total_totals": round(term_totals, 2),
                "wind": round(term_wind, 2),
                "shear": round(term_shear, 2),
            },
        },
    )


def all_indices(
    column: Column, surface_ascent: pc.Ascent | None
) -> dict[str, Diagnostic]:
    """Every classical index, in dependency order."""
    out: dict[str, Diagnostic] = {}
    out["lifted_index"] = lifted_index(column, surface_ascent)
    out["showalter_index"] = showalter_index(column)
    out["total_totals"] = total_totals(column)
    out["k_index"] = k_index(column)
    out["sweat_index"] = sweat_index(column, out["total_totals"])
    return out
