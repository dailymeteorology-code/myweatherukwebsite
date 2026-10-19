"""Wind, shear, storm-relative flow and jets.

CONVENTIONS
-----------
Direction is METEOROLOGICAL: the direction the wind blows FROM, in degrees
clockwise from true north. 270 degrees is a westerly. This is the convention
of every observation and model field the platform ingests, and it is the
opposite of the mathematical convention, so it is stated rather than assumed.

    u = -speed * sin(direction)      direction in radians
    v = -speed * cos(direction)
    direction = (270 - atan2(v, u) * 180/pi) mod 360

A calm wind has no direction. Zero is a real direction (due north), so a calm
wind reports direction as NaN, not 0.

VECTOR SHEAR IS NOT SPEED SHEAR
-------------------------------
Both are computed and they are never given the same name.

    bulk (vector) shear   |V_top - V_bottom|      the physically relevant one
    speed shear           |V_top| - |V_bottom|    a scalar difference

A wind of 20 m/s westerly at the surface and 20 m/s easterly at 6 km has
40 m/s of vector shear and ZERO speed shear. Storm organisation responds to
the first. Reporting the second under the name "shear" would understate that
sounding completely -- which is why `speed_shear` is a separate, separately
named quantity.

Vector shear is also never computed from directions. It comes from the
components, so wraparound at 360 degrees cannot affect it.

STORM MOTION
------------
No storm-motion vector is hard-coded. `storm_motion()` returns an estimate
with the method recorded, and every storm-relative quantity carries the
motion it used. The default is Bunkers internal dynamics (Bunkers et al.
2000), which is the operational standard and is derived from the hodograph
rather than assumed. Later stages may supply an observed or model-derived
motion instead; the machinery takes any vector.

REFERENCES
----------
Davies-Jones, R., Burgess, D. & Foster, M. (1990). Test of helicity as a
    tornado forecast parameter. *16th Conf. on Severe Local Storms*, 588-592.
    -- the discrete SRH summation used here.
Bunkers, M. J. et al. (2000). Predicting supercell motion using a new
    hodograph technique. *Weather and Forecasting*, 15, 61-79.
Thompson, R. L. et al. (2007). Effective storm-relative helicity and bulk
    shear in supercell thunderstorm environments.
    *Weather and Forecasting*, 22, 102-115.
    -- the effective inflow layer.
Weisman, M. L. & Klemp, J. B. (1982). The dependence of numerically simulated
    convective storms on vertical wind shear and buoyancy.
    *Monthly Weather Review*, 110, 504-520.  -- the Bulk Richardson Number.
"""
from __future__ import annotations

import numpy as np

from . import parcel as pc
from . import thermo as th
from .column import Column
from .result import Diagnostic, Status, unavailable, worst

#: Below this speed a wind has no meaningful direction, m/s.
CALM_THRESHOLD = 0.1

#: Bunkers deviation from the 0-6 km mean wind, m/s.
BUNKERS_DEVIATION = 7.5
#: The layer Bunkers averages for the mean wind, m AGL.
BUNKERS_MEAN_LAYER = (0.0, 6000.0)
#: The two layers whose mean winds define the Bunkers shear vector, m AGL.
BUNKERS_SHEAR_BOTTOM = (0.0, 500.0)
BUNKERS_SHEAR_TOP = (5500.0, 6000.0)

#: Shear layers, m AGL.
SHEAR_LAYERS: tuple[tuple[str, float, float], ...] = (
    ("shear_0_1km", 0.0, 1000.0),
    ("shear_0_3km", 0.0, 3000.0),
    ("shear_0_6km", 0.0, 6000.0),
    ("shear_0_8km", 0.0, 8000.0),
)

#: SRH layers, m AGL.
SRH_LAYERS: tuple[tuple[str, float, float], ...] = (
    ("srh_0_1km", 0.0, 1000.0),
    ("srh_0_3km", 0.0, 3000.0),
)

#: Effective inflow layer thresholds (Thompson et al. 2007).
EFFECTIVE_CAPE_MIN = 100.0      # J/kg
EFFECTIVE_CIN_MIN = -250.0      # J/kg

#: Layer searched for a low-level jet, m AGL. The nocturnal LLJ over the UK
#: typically maximises between 300 and 1500 m.
LOW_LEVEL_JET_LAYER = (0.0, 3000.0)
#: Pressure layer searched for the upper-level jet, hPa.
UPPER_LEVEL_JET_LAYER = (400.0, 150.0)


# ---------------------------------------------------------------------------
# Basic vector relations
# ---------------------------------------------------------------------------

def speed_from_components(u, v):
    """Wind speed, m/s."""
    return np.hypot(np.asarray(u, dtype="float64"),
                    np.asarray(v, dtype="float64"))


def direction_from_components(u, v):
    """Meteorological wind direction, degrees. NaN when calm.

    Calm returns NaN rather than 0 because 0 means due north, and a field of
    spurious northerlies wherever the wind drops is a real hazard for any
    downstream directional statistic.
    """
    u = np.asarray(u, dtype="float64")
    v = np.asarray(v, dtype="float64")
    speed = np.hypot(u, v)
    direction = (270.0 - np.degrees(np.arctan2(v, u))) % 360.0
    return np.where(speed < CALM_THRESHOLD, np.nan, direction)


def components_from_speed_direction(speed, direction):
    """(u, v) from meteorological speed and direction."""
    speed = np.asarray(speed, dtype="float64")
    rad = np.radians(np.asarray(direction, dtype="float64"))
    return -speed * np.sin(rad), -speed * np.cos(rad)


def direction_difference(from_deg: float, to_deg: float) -> float:
    """Signed change in direction, degrees, in (-180, 180].

    POSITIVE means VEERING (clockwise with height, e.g. southerly to
    westerly), which is associated with warm advection. NEGATIVE means
    BACKING. Handles wraparound: 350 to 10 degrees is +20, not -340.
    """
    if not (np.isfinite(from_deg) and np.isfinite(to_deg)):
        return float("nan")
    diff = (to_deg - from_deg + 180.0) % 360.0 - 180.0
    return float(diff)


def _mean_wind(column: Column, bottom_m: float, top_m: float,
               step: float = 100.0) -> tuple[float, float]:
    """Depth-weighted mean wind over a height layer, as components.

    Sampled on a uniform grid so the mean is weighted by DEPTH and not by
    the model's level spacing, which is far from uniform.
    """
    if not column.has_hodograph:
        return (float("nan"), float("nan"))
    bottom_m = _anchor(column, bottom_m)
    heights = np.arange(bottom_m, top_m + 1e-6, step)
    if heights.size < 2:
        heights = np.array([bottom_m, top_m])
    us, vs = [], []
    for z in heights:
        u, v = column.wind_at_height(float(z))
        if np.isfinite(u) and np.isfinite(v):
            us.append(u)
            vs.append(v)
    if len(us) < 2:
        return (float("nan"), float("nan"))
    return float(np.mean(us)), float(np.mean(vs))


# ---------------------------------------------------------------------------
# Shear
# ---------------------------------------------------------------------------

def _anchor(column: Column, requested_m: float) -> float:
    """The height actually sampled for a requested layer bottom.

    Models publish their lowest wind at anemometer level -- 10 m for the UK
    order -- not at 0 m. Refusing a "0-6 km" shear because the profile starts
    at 10 m would make every shear and helicity diagnostic permanently
    unavailable on real data, which is strictness in the wrong place: the
    surface wind IS the 10 m wind, operationally and in every published
    definition of these layers.

    So a requested bottom below the lowest available level is raised to it,
    and the level actually used is recorded on the result. This is NOT
    extrapolation and is applied only to the BOTTOM of a layer -- a requested
    TOP above the profile still returns unavailable, because inventing an
    upper wind would invent the shear itself.
    """
    if not column.has_hodograph:
        return requested_m
    ok = np.isfinite(column.wind_u) & np.isfinite(column.wind_v)
    if not np.any(ok):
        return requested_m
    lowest = float(column.wind_height[ok][0])
    return max(requested_m, lowest)



def bulk_shear(
    column: Column, name: str, bottom_m: float, top_m: float
) -> Diagnostic:
    """Bulk vector wind shear across a height layer.

    The magnitude of the vector difference between the winds at the two
    levels -- NOT the difference of the two speeds, and NOT an average of
    layer speeds. Both component differences are kept in `extra` so later
    stages can use the vector, not only its length.
    """
    unit = "m/s"
    sources = ("u_wind", "v_wind")
    if not column.has_hodograph:
        return unavailable(
            name, unit, "no wind profile on a height coordinate",
            source_fields=sources,
        )

    sampled_bottom = _anchor(column, bottom_m)
    u_b, v_b = column.wind_at_height(sampled_bottom)
    u_t, v_t = column.wind_at_height(top_m)

    if not (np.isfinite(u_b) and np.isfinite(v_b)):
        return unavailable(
            name, unit,
            f"no wind at {bottom_m:.0f} m above the base of the profile",
            source_fields=sources,
        )
    if not (np.isfinite(u_t) and np.isfinite(v_t)):
        top = column.hodograph_top
        return unavailable(
            name, unit,
            f"the wind profile reaches only {top:.0f} m above ground, below "
            f"the {top_m:.0f} m this layer needs; shear to an extrapolated "
            f"wind is not shear over this layer",
            source_fields=sources,
        )

    du, dv = u_t - u_b, v_t - v_b
    magnitude = float(np.hypot(du, dv))
    speed_shear = float(np.hypot(u_t, v_t) - np.hypot(u_b, v_b))

    status = Status.AVAILABLE
    flags: list[str] = []
    if column.wind_source != "native_height_levels":
        status = Status.DEGRADED
        flags.append(f"hodograph source: {column.wind_source}")
    if sampled_bottom > bottom_m + 50.0:
        flags.append(
            f"the layer bottom was taken at {sampled_bottom:.0f} m, the "
            f"lowest available wind, rather than {bottom_m:.0f} m"
        )

    return Diagnostic(
        name=name, value=magnitude, unit=unit, status=status,
        source_fields=sources,
        source_levels=(sampled_bottom, top_m),
        level_coordinate="height_agl_m",
        method="vector_difference_of_interpolated_components",
        interpolation_used=True, quality_flags=tuple(flags),
        reason="" if status is Status.AVAILABLE else "; ".join(flags),
        extra={
            "du_m_s": round(float(du), 3),
            "dv_m_s": round(float(dv), 3),
            "speed_shear_m_s": round(speed_shear, 3),
            "requested_bottom_m": bottom_m,
            "sampled_bottom_m": round(sampled_bottom, 1),
            "bottom_wind": _wind_dict(u_b, v_b),
            "top_wind": _wind_dict(u_t, v_t),
        },
    )


def _wind_dict(u: float, v: float) -> dict:
    return {
        "u_m_s": round(float(u), 3),
        "v_m_s": round(float(v), 3),
        "speed_m_s": round(float(np.hypot(u, v)), 3),
        "direction_deg": _round_or_none(
            float(direction_from_components(u, v)), 1
        ),
    }


def _round_or_none(value: float, digits: int = 1) -> float | None:
    return round(float(value), digits) if np.isfinite(value) else None


def speed_shear(
    column: Column, name: str, bottom_m: float, top_m: float
) -> Diagnostic:
    """Change in wind SPEED across a layer -- deliberately not "shear".

    Reported separately so nothing downstream can mistake it for the vector
    quantity. Negative means the wind slows with height.
    """
    vector = bulk_shear(column, f"_{name}", bottom_m, top_m)
    if not vector.status.has_value:
        return unavailable(
            name, "m/s", vector.reason, source_fields=vector.source_fields
        )
    return Diagnostic(
        name=name, value=float(vector.extra["speed_shear_m_s"]), unit="m/s",
        status=vector.status, source_fields=vector.source_fields,
        source_levels=(bottom_m, top_m), level_coordinate="height_agl_m",
        method="difference_of_wind_speeds",
        interpolation_used=True,
        quality_flags=vector.quality_flags + (
            "this is a scalar speed difference, NOT vector shear; use "
            "shear_* for the vector quantity",
        ),
        reason=vector.reason,
    )


def directional_shear(column: Column) -> Diagnostic:
    """Directional change with height, layer by layer.

    Not reduced to one number. The whole point of directional shear is its
    vertical structure: a profile that veers strongly through the lowest
    kilometre and then runs straight is a different environment from one that
    veers uniformly through six, and both can produce the same total turning.

    Positive = veering (clockwise), negative = backing.
    """
    name = "directional_shear"
    sources = ("u_wind", "v_wind")
    if not column.has_hodograph:
        return unavailable(
            name, "degrees", "no wind profile on a height coordinate",
            source_fields=sources,
        )

    boundaries = [0.0, 500.0, 1000.0, 2000.0, 3000.0, 6000.0]
    layers = []
    previous_direction = float("nan")
    total = 0.0
    counted = 0

    for z in boundaries:
        u, v = column.wind_at_height(_anchor(column, z))
        direction = float(direction_from_components(u, v))
        if np.isfinite(previous_direction) and np.isfinite(direction):
            change = direction_difference(previous_direction, direction)
            layers.append({
                "bottom_m": boundaries[boundaries.index(z) - 1],
                "top_m": z,
                "change_deg": round(change, 1),
                "character": (
                    "veering" if change > 2 else
                    "backing" if change < -2 else "straight"
                ),
            })
            total += change
            counted += 1
        previous_direction = direction

    if not counted:
        return unavailable(
            name, "degrees",
            "fewer than two levels with a defined wind direction",
            source_fields=sources,
        )

    status = Status.AVAILABLE if counted == len(boundaries) - 1 \
        else Status.PARTIAL
    return Diagnostic(
        name=name, value=float(total), unit="degrees", status=status,
        source_fields=sources,
        source_levels=tuple(boundaries), level_coordinate="height_agl_m",
        method="signed_direction_change_per_layer_from_components",
        interpolation_used=True,
        reason="" if status is Status.AVAILABLE else (
            f"only {counted} of {len(boundaries) - 1} layers had wind at "
            f"both boundaries"
        ),
        extra={
            "layers": layers,
            "total_turning_deg": round(total, 1),
            "character": (
                "veering" if total > 10 else
                "backing" if total < -10 else "little_turning"
            ),
        },
    )


# ---------------------------------------------------------------------------
# Storm motion
# ---------------------------------------------------------------------------

def storm_motion(
    column: Column, *, mover: str = "right"
) -> Diagnostic:
    """Estimated storm motion, by the Bunkers internal-dynamics method.

    The mean 0-6 km wind, displaced 7.5 m/s perpendicular to the 0-6 km shear
    vector: to the right of it for a right-moving supercell, to the left for
    a left mover.

    This is an ESTIMATE from the hodograph, not an observation, and every
    storm-relative quantity that uses it says so. Supplying a measured or
    model-derived motion instead is the intended path once a later stage can
    produce one -- nothing here hard-codes a vector.

    Returns the motion as (u, v) in `value`.
    """
    name = f"storm_motion_{mover}"
    unit = "m/s"
    sources = ("u_wind", "v_wind")
    if mover not in ("right", "left", "mean"):
        raise ValueError(f"unknown mover {mover!r}")

    if not column.has_hodograph:
        return unavailable(
            name, unit, "no wind profile on a height coordinate",
            source_fields=sources,
        )
    top = column.hodograph_top
    if top < BUNKERS_MEAN_LAYER[1] - 1e-6:
        return unavailable(
            name, unit,
            f"the Bunkers method needs wind through 6 km; this profile "
            f"reaches {top:.0f} m. An estimate from a shallower layer is a "
            f"different quantity, so none is returned",
            source_fields=sources,
        )

    mean_u, mean_v = _mean_wind(column, *BUNKERS_MEAN_LAYER)
    if not np.isfinite(mean_u):
        return unavailable(
            name, unit, "0-6 km mean wind could not be computed",
            source_fields=sources,
        )
    if mover == "mean":
        return _motion_diagnostic(
            name, mean_u, mean_v, "0_6km_mean_wind", Status.AVAILABLE, column
        )

    low_u, low_v = _mean_wind(column, *BUNKERS_SHEAR_BOTTOM, step=50.0)
    high_u, high_v = _mean_wind(column, *BUNKERS_SHEAR_TOP, step=50.0)
    if not (np.isfinite(low_u) and np.isfinite(high_u)):
        return unavailable(
            name, unit,
            "the 0-500 m or 5.5-6 km mean wind could not be computed",
            source_fields=sources,
        )

    shear_u, shear_v = high_u - low_u, high_v - low_v
    magnitude = float(np.hypot(shear_u, shear_v))
    if magnitude < 1e-3:
        return unavailable(
            name, unit,
            "the 0-6 km shear vector is effectively zero, so 'right' and "
            "'left' of it are undefined; on a straight calm hodograph there "
            "is no deviant motion to estimate",
            source_fields=sources,
        )

    # k x shear, normalised: rotate the shear vector 90 degrees clockwise
    # for the right mover.
    perp_u, perp_v = shear_v / magnitude, -shear_u / magnitude
    sign = 1.0 if mover == "right" else -1.0
    u = mean_u + sign * BUNKERS_DEVIATION * perp_u
    v = mean_v + sign * BUNKERS_DEVIATION * perp_v

    status = Status.AVAILABLE
    if column.wind_source != "native_height_levels":
        status = Status.DEGRADED
    return _motion_diagnostic(
        name, u, v, f"bunkers_2000_{mover}_mover", status, column,
        extra={
            "mean_wind": _wind_dict(mean_u, mean_v),
            "shear_vector": {
                "du_m_s": round(shear_u, 3), "dv_m_s": round(shear_v, 3),
                "magnitude_m_s": round(magnitude, 3),
            },
            "deviation_m_s": BUNKERS_DEVIATION,
        },
    )


def _motion_diagnostic(
    name: str, u: float, v: float, method: str, status: Status,
    column: Column, extra: dict | None = None,
) -> Diagnostic:
    payload = {
        "u_m_s": round(float(u), 3),
        "v_m_s": round(float(v), 3),
        "speed_m_s": round(float(np.hypot(u, v)), 3),
        "direction_deg": _round_or_none(
            float(direction_from_components(u, v)), 1
        ),
    }
    if extra:
        payload.update(extra)
    return Diagnostic(
        name=name, value=np.array([float(u), float(v)]), unit="m/s",
        status=status, source_fields=("u_wind", "v_wind"),
        method=method, interpolation_used=True,
        reason="" if status is Status.AVAILABLE else
        f"hodograph source: {column.wind_source}",
        extra=payload,
    )


# ---------------------------------------------------------------------------
# Storm-relative helicity
# ---------------------------------------------------------------------------

def storm_relative_helicity(
    column: Column, name: str, bottom_m: float, top_m: float,
    motion: tuple[float, float], motion_method: str,
    *, step: float = 100.0,
) -> Diagnostic:
    """Storm-relative helicity over a height layer, m2/s2.

        SRH = - INT (V - c) . (k x dV/dz) dz

    evaluated by the Davies-Jones et al. (1990) discrete summation over
    hodograph segments, which is exact for a piecewise-linear hodograph:

        SRH = SUM [ (u_(n+1) - c_u)(v_n - c_v) - (u_n - c_u)(v_(n+1) - c_v) ]

    Note this is NOT a simple average of storm-relative winds -- SRH measures
    the AREA the hodograph sweeps relative to the storm motion, so a long
    straight storm-relative hodograph contributes nothing however strong the
    winds are, while a curved one contributes a great deal.

    SIGN: positive SRH means the hodograph turns clockwise with height
    relative to the storm, which in the northern hemisphere favours
    right-moving cyclonic supercells.

    The layer is sampled on a uniform grid so the summation is not weighted
    by the model's uneven level spacing.
    """
    unit = "m2/s2"
    sources = ("u_wind", "v_wind")
    if not column.has_hodograph:
        return unavailable(
            name, unit, "no wind profile on a height coordinate",
            source_fields=sources,
        )
    if not (np.isfinite(motion[0]) and np.isfinite(motion[1])):
        return unavailable(
            name, unit,
            "storm motion is undefined, so storm-relative helicity has no "
            "reference frame",
            source_fields=sources,
        )

    top_available = column.hodograph_top
    if top_available < top_m - 1e-6:
        return unavailable(
            name, unit,
            f"the wind profile reaches {top_available:.0f} m, below the "
            f"{top_m:.0f} m this layer needs",
            source_fields=sources,
        )

    sampled_bottom = _anchor(column, bottom_m)
    heights = np.arange(sampled_bottom, top_m + 1e-6, step)
    us, vs = [], []
    for z in heights:
        u, v = column.wind_at_height(float(z))
        us.append(u)
        vs.append(v)
    u = np.array(us)
    v = np.array(vs)
    ok = np.isfinite(u) & np.isfinite(v)
    if np.count_nonzero(ok) < 2:
        return unavailable(
            name, unit, "fewer than two usable wind levels in the layer",
            source_fields=sources,
        )
    u, v = u[ok], v[ok]

    cu, cv = float(motion[0]), float(motion[1])
    srh = float(np.sum(
        (u[1:] - cu) * (v[:-1] - cv) - (u[:-1] - cu) * (v[1:] - cv)
    ))

    status = Status.AVAILABLE
    if column.wind_source != "native_height_levels":
        status = Status.DEGRADED

    return Diagnostic(
        name=name, value=srh, unit=unit, status=status,
        source_fields=sources,
        source_levels=(sampled_bottom, top_m),
        level_coordinate="height_agl_m",
        method=f"davies_jones_1990_discrete_sum__motion={motion_method}",
        interpolation_used=True,
        reason="" if status is Status.AVAILABLE else
        f"hodograph source: {column.wind_source}",
        extra={
            "storm_motion": {
                "u_m_s": round(cu, 3), "v_m_s": round(cv, 3),
                "method": motion_method,
            },
            "integration_step_m": step,
            "requested_bottom_m": bottom_m,
            "sampled_bottom_m": round(sampled_bottom, 1),
            "samples": int(u.size),
        },
    )


def effective_inflow_layer(
    column: Column, *, most_unstable_cape: float | None = None
) -> Diagnostic:
    """The effective inflow layer (Thompson et al. 2007).

    The contiguous layer, starting from the lowest qualifying level, in which
    a parcel lifted from that level has

        CAPE >= 100 J/kg   and   CIN >= -250 J/kg

    This is what makes effective SRH meaningful: over a deep stable layer the
    fixed 0-1 km and 0-3 km layers include air that cannot reach the storm at
    all, so their helicity describes a flow the storm never ingests.

    A parcel is lifted from every candidate level, which is genuinely
    expensive: profiling put this one function at 71% of the entire Stage 4
    cost, because each of the twelve candidates runs a full moist ascent.

    ONE EXACT SHORT-CIRCUIT
    -----------------------
    `most_unstable_cape` skips the scan when no level could possibly
    qualify. This is not an approximation and does not weaken the
    definition. The most-unstable parcel is, by construction, the parcel
    with the greatest CAPE in the lowest `MOST_UNSTABLE_DEPTH_PA` -- the
    SAME 300 hPa the candidates span. If it cannot reach 100 J/kg then no
    candidate within that depth can either, and the twelve ascents are
    guaranteed to find nothing.

    The result is identical; only the work differs. On a quiet profile --
    which is most of the UK most of the time -- the scan is skipped
    entirely. When MUCAPE is not supplied the full scan runs as before, so
    a caller that cannot provide it loses nothing but speed.
    """
    name = "effective_inflow_layer"
    unit = "m"
    if not column.has_moisture:
        return unavailable(
            name, unit,
            "no humidity profile, so parcel CAPE and CIN cannot be evaluated "
            "at candidate levels",
            source_fields=("temperature", "relative_humidity"),
        )

    if (
        most_unstable_cape is not None
        and np.isfinite(most_unstable_cape)
        and most_unstable_cape < EFFECTIVE_CAPE_MIN
    ):
        return unavailable(
            name, unit,
            f"the most-unstable parcel in the lowest "
            f"{pc.MOST_UNSTABLE_DEPTH_PA / 100:.0f} hPa reaches only "
            f"{most_unstable_cape:.0f} J/kg, below the "
            f"{EFFECTIVE_CAPE_MIN:.0f} J/kg an inflow level must exceed. No "
            f"candidate in that depth can qualify, so there is no effective "
            f"inflow layer. This is a real result, not a failure",
            source_fields=("temperature", "relative_humidity"),
            method="thompson_2007_short_circuit_on_most_unstable_cape",
        )

    base_p = column.bottom_pressure
    # Candidates every 25 hPa through the lowest 300 hPa: fine enough to
    # locate the boundaries, coarse enough to stay affordable.
    candidates = np.arange(base_p, max(base_p - 30_000.0,
                                       column.top_pressure), -2500.0)
    qualifying: list[float] = []
    for p in candidates:
        t = column.interp_at_pressure(column.temperature, float(p))
        td = column.interp_at_pressure(column.dewpoint, float(p))
        if not (np.isfinite(t) and np.isfinite(td)):
            continue
        trial = pc.Parcel(
            pressure=float(p), temperature=float(t),
            dewpoint=float(min(td, t)), kind="effective_inflow_candidate",
            method="level_by_level_scan",
        )
        ascent = pc.lift(column, trial)
        cin_ok = (not np.isfinite(ascent.cin)) is False and \
            ascent.cin >= EFFECTIVE_CIN_MIN
        if ascent.cape >= EFFECTIVE_CAPE_MIN and cin_ok:
            qualifying.append(float(p))
        elif qualifying:
            break          # the layer must be contiguous

    if not qualifying:
        return unavailable(
            name, unit,
            f"no level in the lowest 300 hPa produced a parcel with CAPE >= "
            f"{EFFECTIVE_CAPE_MIN:.0f} J/kg and CIN >= "
            f"{EFFECTIVE_CIN_MIN:.0f} J/kg, so there is no effective inflow "
            f"layer. This is a real result, not a failure",
            source_fields=("temperature", "relative_humidity"),
            method="thompson_2007",
        )

    bottom_p, top_p = qualifying[0], qualifying[-1]
    bottom_z = column.height_at_pressure(bottom_p)
    top_z = column.height_at_pressure(top_p)
    depth = top_z - bottom_z if np.isfinite(top_z) and np.isfinite(bottom_z) \
        else float("nan")

    return Diagnostic(
        name=name, value=float(depth) if np.isfinite(depth) else 0.0,
        unit=unit,
        status=Status.AVAILABLE if np.isfinite(depth) else Status.PARTIAL,
        source_fields=("temperature", "relative_humidity"),
        method=f"thompson_2007_cape>={EFFECTIVE_CAPE_MIN:.0f}"
               f"_cin>={EFFECTIVE_CIN_MIN:.0f}",
        interpolation_used=True,
        reason="" if np.isfinite(depth) else
        "layer located in pressure but its geometric depth is unknown",
        extra={
            "bottom_hpa": round(bottom_p / 100.0, 1),
            "top_hpa": round(top_p / 100.0, 1),
            "bottom_height_m": _round_or_none(bottom_z, 0),
            "top_height_m": _round_or_none(top_z, 0),
            "levels_qualifying": len(qualifying),
            "single_level": len(qualifying) == 1,
        },
    )


def effective_srh(
    column: Column, inflow: Diagnostic, motion: tuple[float, float],
    motion_method: str,
) -> Diagnostic:
    """SRH integrated over the effective inflow layer, not a fixed depth."""
    name = "effective_srh"
    unit = "m2/s2"
    if not inflow.status.has_value:
        return unavailable(
            name, unit,
            f"the effective inflow layer is unavailable: {inflow.reason}",
            source_fields=("u_wind", "v_wind"), method="thompson_2007",
        )
    bottom_z = inflow.extra.get("bottom_height_m")
    top_z = inflow.extra.get("top_height_m")
    if bottom_z is None or top_z is None:
        return unavailable(
            name, unit,
            "the effective inflow layer has no geometric bounds, so SRH "
            "cannot be integrated over it",
            source_fields=("u_wind", "v_wind"), method="thompson_2007",
        )
    if top_z - bottom_z < 50.0:
        return unavailable(
            name, unit,
            f"the effective inflow layer is only {top_z - bottom_z:.0f} m "
            f"deep; helicity over it is not meaningfully resolved",
            source_fields=("u_wind", "v_wind"), method="thompson_2007",
        )

    # The inflow layer is located in geopotential height (AMSL); the
    # hodograph is indexed above ground. The column base converts between
    # them -- mixing the two would offset the layer by the terrain height.
    base = column.height[0] if np.isfinite(column.height[0]) else 0.0
    result = storm_relative_helicity(
        column, name, bottom_z - base, top_z - base, motion, motion_method,
        step=50.0,
    )
    if not result.status.has_value:
        return result
    extra = dict(result.extra)
    extra["effective_layer"] = {
        "bottom_height_m": bottom_z, "top_height_m": top_z,
    }
    return Diagnostic(
        name=name, value=result.value, unit=unit, status=result.status,
        source_fields=result.source_fields,
        source_levels=(bottom_z - base, top_z - base),
        level_coordinate="height_agl_m",
        method=f"thompson_2007_effective_layer__{result.method}",
        interpolation_used=True, quality_flags=result.quality_flags,
        reason=result.reason, extra=extra,
    )


def storm_relative_flow(
    column: Column, motion: tuple[float, float], motion_method: str
) -> Diagnostic:
    """The storm-relative wind profile itself, not only its helicity.

    SRH collapses the whole hodograph into one number. Later stages need
    more: storm-relative inflow at low levels governs how much mass a storm
    can ingest, and storm-relative flow at anvil level governs precipitation
    loading. Both are invisible in a single SRH value, so the profile is
    returned.
    """
    name = "storm_relative_flow"
    unit = "m/s"
    sources = ("u_wind", "v_wind")
    if not column.has_hodograph:
        return unavailable(
            name, unit, "no wind profile on a height coordinate",
            source_fields=sources,
        )
    if not (np.isfinite(motion[0]) and np.isfinite(motion[1])):
        return unavailable(
            name, unit, "storm motion is undefined",
            source_fields=sources,
        )

    cu, cv = float(motion[0]), float(motion[1])
    levels = [0.0, 250.0, 500.0, 1000.0, 2000.0, 3000.0, 4000.0, 6000.0,
              8000.0]
    profile = []
    speeds = []
    for z in levels:
        u, v = column.wind_at_height(_anchor(column, z))
        if not (np.isfinite(u) and np.isfinite(v)):
            continue
        ru, rv = u - cu, v - cv
        speed = float(np.hypot(ru, rv))
        speeds.append(speed)
        profile.append({
            "height_m": z,
            "u_m_s": round(ru, 3), "v_m_s": round(rv, 3),
            "speed_m_s": round(speed, 3),
            "direction_deg": _round_or_none(
                float(direction_from_components(ru, rv)), 1
            ),
        })

    if len(profile) < 2:
        return unavailable(
            name, unit, "fewer than two levels with a usable wind",
            source_fields=sources,
        )

    status = Status.AVAILABLE if len(profile) == len(levels) \
        else Status.PARTIAL
    if column.wind_source != "native_height_levels":
        status = worst(status, Status.DEGRADED)

    return Diagnostic(
        name=name, value=np.array(speeds), unit=unit, status=status,
        source_fields=sources,
        source_levels=tuple(p["height_m"] for p in profile),
        level_coordinate="height_agl_m",
        method=f"wind_minus_storm_motion__motion={motion_method}",
        interpolation_used=True,
        reason="" if status is Status.AVAILABLE else (
            f"{len(profile)} of {len(levels)} levels available; "
            f"hodograph source: {column.wind_source}"
        ),
        extra={
            "storm_motion": {
                "u_m_s": round(cu, 3), "v_m_s": round(cv, 3),
                "method": motion_method,
            },
            "profile": profile,
        },
    )


# ---------------------------------------------------------------------------
# Jets
# ---------------------------------------------------------------------------

def low_level_jet(column: Column) -> Diagnostic:
    """The low-level wind maximum and its vertical structure.

    Not "wind above a threshold". A jet is a MAXIMUM -- wind that increases
    to a peak and then decreases above it -- so this reports the peak, its
    height, and how much the wind falls away above it. A monotonically
    increasing wind profile is strong flow, not a jet, and the `is_jet` flag
    distinguishes them by requiring a genuine fall-off above the maximum.

    The threshold that decides `is_jet` is explicit, not buried: a 2 m/s
    decrease above the peak, which is enough to exclude noise in a smoothly
    increasing profile without demanding a textbook nocturnal jet.
    """
    name = "low_level_jet"
    unit = "m/s"
    sources = ("u_wind", "v_wind")
    bottom, top = LOW_LEVEL_JET_LAYER
    if not column.has_hodograph:
        return unavailable(
            name, unit, "no wind profile on a height coordinate",
            source_fields=sources,
        )

    available_top = min(top, column.hodograph_top)
    heights = np.arange(_anchor(column, bottom), available_top + 1e-6, 50.0)
    if heights.size < 3:
        return unavailable(
            name, unit,
            f"the wind profile spans only {available_top:.0f} m; too "
            f"shallow to identify a maximum",
            source_fields=sources,
        )

    speeds = []
    for z in heights:
        u, v = column.wind_at_height(float(z))
        speeds.append(np.hypot(u, v) if np.isfinite(u) else np.nan)
    speed = np.array(speeds)
    if not np.any(np.isfinite(speed)):
        return unavailable(
            name, unit, "no usable wind in the search layer",
            source_fields=sources,
        )

    i = int(np.nanargmax(speed))
    peak = float(speed[i])
    peak_height = float(heights[i])
    above = speed[i + 1:]
    fall_off = (
        float(peak - np.nanmin(above)) if above.size and
        np.any(np.isfinite(above)) else 0.0
    )
    is_jet = bool(fall_off >= 2.0 and i > 0)

    u_peak, v_peak = column.wind_at_height(float(heights[i]))
    status = Status.AVAILABLE
    flags: list[str] = []
    if available_top < top - 1e-6:
        status = Status.PARTIAL
        flags.append(
            f"searched only to {available_top:.0f} m of the "
            f"{top:.0f} m layer"
        )
    if i == speed.size - 1:
        flags.append(
            "the maximum is at the top of the search layer, so it may not be "
            "a maximum at all -- the wind may keep increasing above"
        )

    return Diagnostic(
        name=name, value=peak, unit=unit, status=status,
        source_fields=sources,
        source_levels=(bottom, top), level_coordinate="height_agl_m",
        method="wind_speed_maximum_in_layer_with_fall_off_test",
        interpolation_used=True, quality_flags=tuple(flags),
        reason="; ".join(flags) if status is not Status.AVAILABLE else "",
        extra={
            "is_jet": is_jet,
            "jet_criterion": "peak with >= 2 m/s decrease above it, not at "
                             "the base of the layer",
            "height_m": round(peak_height, 0),
            "speed_m_s": round(peak, 2),
            "direction_deg": _round_or_none(
                float(direction_from_components(u_peak, v_peak)), 1
            ),
            "fall_off_above_m_s": round(fall_off, 2),
            "search_layer_m": [bottom, top],
        },
    )


def upper_level_jet(column: Column) -> Diagnostic:
    """The upper-tropospheric wind maximum, on the pressure coordinate.

    Searched in pressure rather than height because the upper-level jet sits
    near the tropopause, whose height varies by kilometres, and because the
    models publish upper-level wind on pressure surfaces. Reports the
    maximum, the level it occurs at, and the shear on either side.
    """
    name = "upper_level_jet"
    unit = "m/s"
    sources = ("u_wind", "v_wind")
    bottom_hpa, top_hpa = UPPER_LEVEL_JET_LAYER
    if not column.has_wind:
        return unavailable(
            name, unit, "no wind on the pressure column",
            source_fields=sources,
        )

    lo = min(bottom_hpa * 100.0, column.bottom_pressure)
    hi = max(top_hpa * 100.0, column.top_pressure)
    if lo <= hi:
        return unavailable(
            name, unit,
            f"the profile does not reach the {bottom_hpa:.0f}-{top_hpa:.0f} "
            f"hPa search layer (top is "
            f"{column.top_pressure / 100:.0f} hPa)",
            source_fields=sources,
        )

    grid = np.arange(lo, hi - 1.0, -1000.0)
    speeds = []
    for p in grid:
        u = column.interp_at_pressure(column.u_wind, float(p))
        v = column.interp_at_pressure(column.v_wind, float(p))
        speeds.append(np.hypot(u, v) if np.isfinite(u) else np.nan)
    speed = np.array(speeds)
    if not np.any(np.isfinite(speed)):
        return unavailable(
            name, unit, "no usable wind in the upper-level search layer",
            source_fields=sources,
        )

    i = int(np.nanargmax(speed))
    peak = float(speed[i])
    level = float(grid[i])
    u_peak = column.interp_at_pressure(column.u_wind, level)
    v_peak = column.interp_at_pressure(column.v_wind, level)

    below = speed[:i]
    above = speed[i + 1:]
    flags: list[str] = []
    status = Status.AVAILABLE
    if column.top_pressure > top_hpa * 100.0 + 1e-6:
        status = Status.PARTIAL
        flags.append(
            f"the profile tops out at {column.top_pressure / 100:.0f} hPa, "
            f"so a jet core above that level would be missed"
        )

    return Diagnostic(
        name=name, value=peak, unit=unit, status=status,
        source_fields=sources,
        source_levels=(bottom_hpa, top_hpa), level_coordinate="pressure_hpa",
        method="wind_speed_maximum_in_pressure_layer",
        interpolation_used=True, quality_flags=tuple(flags),
        reason="; ".join(flags) if status is not Status.AVAILABLE else "",
        extra={
            "level_hpa": round(level / 100.0, 1),
            "height_m": _round_or_none(column.height_at_pressure(level), 0),
            "speed_m_s": round(peak, 2),
            "direction_deg": _round_or_none(
                float(direction_from_components(u_peak, v_peak)), 1
            ),
            "shear_below_m_s": (
                round(peak - float(np.nanmin(below)), 2)
                if below.size and np.any(np.isfinite(below)) else None
            ),
            "shear_above_m_s": (
                round(peak - float(np.nanmin(above)), 2)
                if above.size and np.any(np.isfinite(above)) else None
            ),
            "search_layer_hpa": [bottom_hpa, top_hpa],
        },
    )


# ---------------------------------------------------------------------------
# Bulk Richardson Number
# ---------------------------------------------------------------------------

def bulk_richardson_number(
    column: Column, cape: Diagnostic
) -> Diagnostic:
    """Bulk Richardson Number (Weisman & Klemp 1982).

        BRN = CAPE / (0.5 * |V_(0-6km mean) - V_(0-500m mean)|^2)

    The denominator is the BRN SHEAR: half the squared magnitude of the
    difference between the 0-6 km and 0-500 m mean winds. It is NOT the bulk
    shear from `shear_0_6km` -- that is a difference of winds at two LEVELS,
    while this is a difference of two LAYER MEANS, and substituting one for
    the other changes the number materially.

    Dimensionless. Small values indicate shear-dominated (supercell-favouring)
    environments, large values buoyancy-dominated ones. It is a ratio, not a
    probability, and it degenerates when shear approaches zero -- so a
    denominator below 1 m2/s2 returns unavailable rather than a number
    approaching infinity.
    """
    name = "bulk_richardson_number"
    unit = "dimensionless"
    if not cape.status.has_value or cape.value is None:
        return unavailable(
            name, unit,
            f"BRN needs CAPE, which is unavailable: {cape.reason}",
            source_fields=("temperature", "relative_humidity", "u_wind",
                           "v_wind"),
            method="weisman_klemp_1982",
        )
    if not column.has_hodograph:
        return unavailable(
            name, unit, "no wind profile on a height coordinate",
            source_fields=("u_wind", "v_wind"),
            method="weisman_klemp_1982",
        )

    mean_u, mean_v = _mean_wind(column, 0.0, 6000.0)
    low_u, low_v = _mean_wind(column, 0.0, 500.0, step=50.0)
    if not (np.isfinite(mean_u) and np.isfinite(low_u)):
        return unavailable(
            name, unit,
            "the 0-6 km or 0-500 m mean wind could not be computed, so BRN "
            "shear is undefined",
            source_fields=("u_wind", "v_wind"),
            method="weisman_klemp_1982",
        )

    brn_shear = 0.5 * float((mean_u - low_u) ** 2 + (mean_v - low_v) ** 2)
    cape_value = float(cape.value)

    if brn_shear < 1.0:
        return unavailable(
            name, unit,
            f"BRN shear is {brn_shear:.3f} m2/s2, effectively zero; the "
            f"ratio diverges and any value reported would be an artefact of "
            f"the near-zero denominator",
            source_fields=("temperature", "relative_humidity", "u_wind",
                           "v_wind"),
            method="weisman_klemp_1982",
        )

    return Diagnostic(
        name=name, value=cape_value / brn_shear, unit=unit,
        status=worst(cape.status,
                     Status.AVAILABLE if
                     column.wind_source == "native_height_levels"
                     else Status.DEGRADED),
        source_fields=("temperature", "relative_humidity", "u_wind", "v_wind"),
        source_levels=(0.0, 500.0, 6000.0), level_coordinate="height_agl_m",
        method=f"weisman_klemp_1982__cape={cape.name}",
        interpolation_used=True,
        reason="" if cape.status is Status.AVAILABLE and
        column.wind_source == "native_height_levels" else
        f"inherits status from {cape.name}; hodograph source: "
        f"{column.wind_source}",
        extra={
            "cape_source": cape.name,
            "cape_j_kg": round(cape_value, 1),
            "brn_shear_m2_s2": round(brn_shear, 3),
            "brn_shear_definition": "0.5 * |mean(0-6km) - mean(0-500m)|^2",
            "mean_wind_0_6km": _wind_dict(mean_u, mean_v),
            "mean_wind_0_500m": _wind_dict(low_u, low_v),
        },
    )
