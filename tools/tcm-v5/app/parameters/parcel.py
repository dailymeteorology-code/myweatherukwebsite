"""Parcel ascent: one engine, three parcels.

SBCAPE, MLCAPE and MUCAPE differ only in where the parcel starts. Writing
three thermodynamic implementations would guarantee they drift apart, so
there is exactly one `lift()` and three ways of choosing a `Parcel`.

THE ASCENT
----------
1. The parcel rises dry-adiabatically, conserving potential temperature and
   mixing ratio, until it saturates at the LCL (Bolton 1980 eq. 15).
2. Above the LCL it follows a pseudoadiabat -- condensate is removed as it
   forms -- integrated by RK4 on `thermo.moist_lapse_rate_dp`.
3. Buoyancy is evaluated against the environment using VIRTUAL temperature.

WHY A FINE PRESSURE GRID
------------------------
The stored profile has nine pressure levels. Integrating buoyancy on nine
points would place the LFC and EL at whichever of nine levels happened to be
nearest, quantising CAPE into steps of several hundred J/kg. The parcel is
therefore lifted on a uniform fine grid (default 5 hPa) with the environment
interpolated onto it, so the crossings land where the physics puts them.

That does not manufacture precision: the answer is still only as good as a
nine-level environment, which is why `Column.degraded` and the level count
travel with the result. It removes a numerical artefact, it does not add
information.

THE INTEGRAL
------------
CAPE is evaluated in its exact pressure form rather than by summing g*dz:

    CAPE = -Rd * INT (Tv_parcel - Tv_env) d ln p

which follows from CAPE = INT g (Tvp-Tve)/Tve dz and the hypsometric
relation dz = -(Rd Tve/g) d ln p. The Tve cancels exactly, so the result
does not depend on a separately reconstructed height profile -- one fewer
source of error, and it works on columns where geopotential height was
missing.

SIGN CONVENTIONS (fixed here, relied on everywhere)
---------------------------------------------------
    CAPE  >= 0 always. J/kg.
    CIN   <= 0 always -- it is the integral of NEGATIVE buoyancy and is
          reported with its physical sign. A later stage comparing
          `cin > -50` is reading it correctly; one comparing `cin < 50`
          is not. Never reported as a positive magnitude.

REFERENCES
----------
Bolton (1980); Emanuel (1994), ch. 6.
Doswell & Rasmussen (1994) -- virtual temperature correction.
Craven, Jewell & Brooks (2002) -- mixed-layer depth conventions.
Blanchard, D. O. (1998). Assessing the vertical distribution of CAPE.
    *Weather and Forecasting*, 13, 870-877.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

import numpy as np

from . import thermo as th
from .column import Column
from .result import Status

log = logging.getLogger(__name__)

#: Vertical step of the ascent grid, Pa. 5 hPa: fine enough that halving it
#: changes CAPE by well under 1 J/kg, coarse enough to stay cheap on a grid.
ASCENT_STEP_PA = 500.0

#: Depth of the layer averaged for the mixed-layer parcel, Pa.
#: 100 hPa is the operational standard (SPC mesoanalysis; Craven et al.
#: 2002) -- it approximates a well-mixed afternoon boundary layer without
#: being so deep that it dilutes a shallow moist layer out of existence.
#: Configurable, and the value used is recorded on the parcel.
MIXED_LAYER_DEPTH_PA = 10_000.0

#: Depth searched for the most-unstable parcel, Pa. 300 hPa covers elevated
#: convection above a nocturnal inversion, which is the case the parcel
#: exists for, without wandering into the mid-troposphere.
MOST_UNSTABLE_DEPTH_PA = 30_000.0

#: Buoyancy differences below this are numerical noise, not structure.
BUOYANCY_EPSILON = 1e-6


@dataclass(frozen=True, slots=True)
class Parcel:
    """The starting state of a lifted parcel."""

    pressure: float          # Pa
    temperature: float       # K
    dewpoint: float          # K
    kind: str                # surface | mixed_layer | most_unstable
    #: How the state was arrived at, for provenance.
    method: str = ""
    #: Depth averaged or searched, Pa. None for a point parcel.
    layer_depth: float | None = None
    #: Height of the origin, m, where known.
    height: float | None = None
    #: theta-e of the parcel, K -- the selection criterion for MU.
    theta_e: float | None = None

    @property
    def mixing_ratio(self) -> float:
        return float(th.saturation_mixing_ratio(self.dewpoint, self.pressure))

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "method": self.method,
            "pressure_hpa": round(self.pressure / 100.0, 2),
            "temperature_c": round(self.temperature - th.ZERO_CELSIUS, 2),
            "dewpoint_c": round(self.dewpoint - th.ZERO_CELSIUS, 2),
            "mixing_ratio_g_kg": round(self.mixing_ratio * 1000.0, 3),
            "layer_depth_hpa": (
                round(self.layer_depth / 100.0, 1) if self.layer_depth else None
            ),
            "height_m": round(self.height, 1) if self.height is not None else None,
            "theta_e_k": round(self.theta_e, 2) if self.theta_e else None,
        }


@dataclass(slots=True)
class Ascent:
    """The full result of lifting one parcel: profiles, levels and areas.

    The arrays are kept, not just the scalars. Later TCM stages need the
    buoyancy distribution -- whether CAPE is thin and tall or fat and
    shallow changes updraught behaviour completely, and two soundings with
    identical CAPE can behave nothing alike (Blanchard 1998).
    """

    parcel: Parcel

    # -- the lifted profile, on the fine ascent grid ------------------------
    pressure: np.ndarray                 # Pa, decreasing
    height: np.ndarray                   # m
    parcel_temperature: np.ndarray       # K
    parcel_dewpoint: np.ndarray          # K
    parcel_virtual_temperature: np.ndarray
    environment_temperature: np.ndarray
    environment_dewpoint: np.ndarray
    environment_virtual_temperature: np.ndarray
    #: m/s^2. Positive = the parcel accelerates upward.
    buoyancy: np.ndarray
    #: True where the parcel is at or above its LCL, i.e. saturated.
    saturated: np.ndarray

    # -- significant levels ------------------------------------------------
    lcl_pressure: float = float("nan")
    lcl_temperature: float = float("nan")
    lcl_height: float = float("nan")
    lfc_pressure: float = float("nan")
    lfc_height: float = float("nan")
    el_pressure: float = float("nan")
    el_height: float = float("nan")

    # -- integrals ---------------------------------------------------------
    cape: float = 0.0                    # J/kg, >= 0
    #: J/kg, <= 0. NaN when there is no LFC, because CIN is defined as the
    #: negative area beneath one and without an LFC it has no bounds.
    cin: float = 0.0
    #: J/kg, <= 0. The whole negative area to the profile top, only set when
    #: there is no LFC. Deliberately a different name from `cin` so a caller
    #: reading `cin` cannot pick this up by accident.
    total_negative_area: float = float("nan")
    #: Every positively buoyant layer found, as
    #: (p_bottom_Pa, p_top_Pa, cape_J_kg). More than one means the sounding
    #: has separate buoyant layers, which a single CAPE number hides.
    positive_layers: tuple[tuple[float, float, float], ...] = ()

    status: Status = Status.AVAILABLE
    flags: tuple[str, ...] = ()
    reason: str = ""
    levels_used: int = 0

    @property
    def has_lfc(self) -> bool:
        return bool(np.isfinite(self.lfc_pressure))

    @property
    def has_el(self) -> bool:
        return bool(np.isfinite(self.el_pressure))

    def to_dict(self, *, include_profile: bool = False) -> dict:
        out = {
            "parcel": self.parcel.to_dict(),
            "cape_j_kg": round(self.cape, 1),
            "cin_j_kg": _round_or_none(self.cin),
            "total_negative_area_j_kg": _round_or_none(
                self.total_negative_area
            ),
            "lcl_hpa": _round_or_none(self.lcl_pressure / 100.0),
            "lcl_height_m": _round_or_none(self.lcl_height, 0),
            "lfc_hpa": _round_or_none(self.lfc_pressure / 100.0),
            "lfc_height_m": _round_or_none(self.lfc_height, 0),
            "el_hpa": _round_or_none(self.el_pressure / 100.0),
            "el_height_m": _round_or_none(self.el_height, 0),
            "positive_layers": [
                {
                    "bottom_hpa": round(b / 100.0, 1),
                    "top_hpa": round(t / 100.0, 1),
                    "cape_j_kg": round(c, 1),
                }
                for b, t, c in self.positive_layers
            ],
            "status": self.status.value,
            "flags": list(self.flags),
            "levels_used": self.levels_used,
        }
        if self.reason:
            out["reason"] = self.reason
        if include_profile:
            out["profile"] = {
                "pressure_hpa": (self.pressure / 100.0).round(1).tolist(),
                "height_m": np.round(self.height, 1).tolist(),
                "parcel_temperature_c": np.round(
                    self.parcel_temperature - th.ZERO_CELSIUS, 2
                ).tolist(),
                "environment_temperature_c": np.round(
                    self.environment_temperature - th.ZERO_CELSIUS, 2
                ).tolist(),
                "buoyancy_m_s2": np.round(self.buoyancy, 5).tolist(),
            }
        return out


def _round_or_none(value: float, digits: int = 1) -> float | None:
    return round(float(value), digits) if np.isfinite(value) else None


# ---------------------------------------------------------------------------
# Parcel selection
# ---------------------------------------------------------------------------

def surface_parcel(column: Column) -> Parcel | None:
    """The surface-based parcel.

    Prefers the screen-level state (1.5 m temperature and humidity) over the
    lowest pressure level. With surface pressure at 990 hPa the lowest usable
    isobaric level may be 925 hPa -- some 700 m above ground -- and a parcel
    launched from there is not surface-based in any useful sense; it would
    systematically miss the warmest, moistest air in the column.
    """
    if (
        column.surface_pressure is not None
        and column.surface_temperature is not None
        and column.surface_dewpoint is not None
    ):
        p = float(column.surface_pressure)
        t = float(column.surface_temperature)
        td = min(float(column.surface_dewpoint), t)
        return Parcel(
            pressure=p, temperature=t, dewpoint=td, kind="surface",
            method="screen_level_1.5m",
            height=column.terrain_height,
            theta_e=float(th.equivalent_potential_temperature(t, td, p)),
        )

    moist = np.flatnonzero(np.isfinite(column.dewpoint))
    if moist.size == 0:
        return None
    i = int(moist[0])
    t, td = float(column.temperature[i]), float(column.dewpoint[i])
    p = float(column.pressure[i])
    return Parcel(
        pressure=p, temperature=t, dewpoint=min(td, t), kind="surface",
        method="lowest_usable_pressure_level",
        height=float(column.height[i]) if np.isfinite(column.height[i]) else None,
        theta_e=float(th.equivalent_potential_temperature(t, min(td, t), p)),
    )


def mixed_layer_parcel(
    column: Column, depth_pa: float = MIXED_LAYER_DEPTH_PA
) -> Parcel | None:
    """The mixed-layer parcel: the mean state of the lowest `depth_pa`.

    POTENTIAL temperature and MIXING RATIO are averaged, not temperature and
    relative humidity. Those two are the quantities conserved by dry vertical
    mixing, so their average is what a genuinely mixed layer would actually
    contain; averaging temperature across a layer with a lapse rate gives a
    state that no amount of mixing produces.

    The average is mass-weighted (weighted by dp), because a pressure layer
    contains mass in proportion to its pressure depth. An unweighted mean
    over unevenly spaced levels quietly weights by the model's level spacing
    instead of by the atmosphere.

    Averaging is done on the fine grid rather than on the stored levels: with
    nine levels a 100 hPa layer contains one or two of them, and a "mean"
    over two points is dominated by which two.
    """
    if not column.has_moisture or len(column) < 2:
        return None
    # Anchored at the surface where the screen state is available, so the
    # mixed layer is the layer that actually mixes rather than starting at
    # whichever pressure level happens to be lowest.
    base = float(column.surface_pressure) if column.surface_layer_available \
        else float(column.pressure[0])
    top = base - depth_pa
    if top < column.top_pressure:
        return None

    grid = np.arange(base, top - 1.0, -ASCENT_STEP_PA)
    if grid.size < 2:
        return None
    states = [column.thermo_at(float(p)) for p in grid]
    t = np.array([s[0] for s in states])
    td = np.array([s[1] for s in states])
    ok = np.isfinite(t) & np.isfinite(td)
    if np.count_nonzero(ok) < 2:
        return None
    grid, t, td = grid[ok], t[ok], td[ok]
    td = np.minimum(td, t)

    theta = th.potential_temperature(t, grid)
    w = th.saturation_mixing_ratio(td, grid)
    # Mass weights: the pressure depth each sample represents.
    weights = np.gradient(-grid)
    weights = np.abs(weights)
    theta_mean = float(np.sum(theta * weights) / np.sum(weights))
    w_mean = float(np.sum(w * weights) / np.sum(weights))

    # Bring the mean state back to the base of the layer, where the parcel
    # begins its ascent.
    t_parcel = float(th.dry_adiabatic_temperature(theta_mean, th.P_REFERENCE, base))
    td_parcel = float(th.dewpoint_from_mixing_ratio(w_mean, base))
    td_parcel = min(td_parcel, t_parcel)
    return Parcel(
        pressure=base, temperature=t_parcel, dewpoint=td_parcel,
        kind="mixed_layer",
        method=f"mass_weighted_theta_and_mixing_ratio_over_{depth_pa/100:.0f}hPa",
        layer_depth=depth_pa,
        height=column.terrain_height,
        theta_e=float(
            th.equivalent_potential_temperature(t_parcel, td_parcel, base)
        ),
    )


def most_unstable_parcel(
    column: Column, depth_pa: float = MOST_UNSTABLE_DEPTH_PA
) -> Parcel | None:
    """The parcel with the highest equivalent potential temperature in the
    lowest `depth_pa`.

    theta-e, NOT temperature. The most unstable parcel is the one with the
    most buoyant energy available once its moisture is released, and a warm
    dry parcel has less of that than a cooler moist one. Selecting on
    temperature finds the warmest surface parcel, which is a different thing
    and is exactly the confusion this docstring exists to prevent.

    Searching on the fine grid rather than on stored levels matters here:
    with nine levels, the theta-e maximum can only ever land on one of nine
    pressures, so an elevated moist layer between 900 and 850 hPa is
    invisible.
    """
    if not column.has_moisture or len(column) < 2:
        return None
    # Start at the SURFACE, not at the lowest stored pressure level. The
    # surface parcel is one of the candidates the most-unstable parcel is
    # selected from, so a search that cannot see it can return MUCAPE below
    # SBCAPE -- which is impossible, and did happen on real UKV data where
    # the surface was 1008 hPa and the lowest stored level 1000 hPa.
    base = float(column.surface_pressure) if column.surface_layer_available \
        else float(column.pressure[0])
    top = max(base - depth_pa, column.top_pressure)
    grid = np.arange(base, top - 1.0, -ASCENT_STEP_PA)
    if grid.size < 1:
        return None
    states = [column.thermo_at(float(p)) for p in grid]
    t = np.array([s[0] for s in states])
    td = np.array([s[1] for s in states])
    ok = np.isfinite(t) & np.isfinite(td)
    if not np.any(ok):
        return None
    grid, t, td = grid[ok], t[ok], td[ok]
    td = np.minimum(td, t)

    # The surface parcel is ALWAYS a candidate, appended explicitly rather
    # than relied upon to fall on the search grid.
    #
    # Without this the two selectors disagree about what "the surface" is:
    # `surface_parcel` takes the screen state unconditionally, while this
    # search starts from `surface_layer_available`, which is False wherever
    # the screen pressure is not below the lowest stored level. On such a
    # column the screen parcel is never evaluated here and MUCAPE comes out
    # BELOW SBCAPE -- impossible, since the surface parcel is one of the
    # candidates the most-unstable parcel is chosen from.
    surface = surface_parcel(column)
    if surface is not None:
        grid = np.append(grid, surface.pressure)
        t = np.append(t, surface.temperature)
        td = np.append(td, min(surface.dewpoint, surface.temperature))

    theta_e = th.equivalent_potential_temperature(t, td, grid)
    if not np.any(np.isfinite(theta_e)):
        return None
    i = int(np.nanargmax(theta_e))
    return Parcel(
        pressure=float(grid[i]), temperature=float(t[i]), dewpoint=float(td[i]),
        kind="most_unstable",
        method=f"max_theta_e_within_{depth_pa/100:.0f}hPa_of_surface",
        layer_depth=depth_pa,
        height=column.height_at_pressure(float(grid[i])),
        theta_e=float(theta_e[i]),
    )


# ---------------------------------------------------------------------------
# The ascent
# ---------------------------------------------------------------------------

def lift(
    column: Column, parcel: Parcel, *, step_pa: float = ASCENT_STEP_PA
) -> Ascent:
    """Lift `parcel` through `column` and evaluate its buoyancy."""
    top = column.top_pressure
    if not np.isfinite(top) or parcel.pressure <= top:
        return _empty_ascent(
            parcel,
            "parcel origin is at or above the top of the profile; "
            "there is no column to lift it through",
        )

    grid = np.arange(parcel.pressure, top - 1.0, -step_pa)
    if grid.size < 3:
        return _empty_ascent(
            parcel,
            f"only {grid.size} ascent points between the parcel and the "
            f"profile top; too thin to integrate",
        )
    if grid[-1] < top:
        grid[-1] = top

    # `thermo_at` rather than plain interpolation, so the layer between the
    # surface and the lowest stored level contributes its buoyancy instead of
    # being dropped as NaN. That layer is small in pressure and is where CIN
    # is decided.
    states = [column.thermo_at(float(p)) for p in grid]
    env_t = np.array([s[0] for s in states])
    env_td = np.array([s[1] for s in states])
    env_z = np.array([column.height_at_pressure(p) for p in grid])

    usable = np.isfinite(env_t)
    if np.count_nonzero(usable) < 3:
        return _empty_ascent(
            parcel, "environment temperature could not be interpolated onto "
                    "the ascent grid"
        )
    grid, env_t, env_td, env_z = (
        grid[usable], env_t[usable], env_td[usable], env_z[usable]
    )

    flags: list[str] = []

    # -- the parcel's own temperature ---------------------------------------
    p_lcl = float(th.lcl_pressure(parcel.temperature, parcel.dewpoint,
                                  parcel.pressure))
    t_lcl = float(th.lcl_temperature(parcel.temperature, parcel.dewpoint))
    if not np.isfinite(p_lcl):
        return _empty_ascent(parcel, "LCL could not be determined from the "
                                     "parcel state")
    if p_lcl < grid[-1]:
        flags.append(
            "parcel does not reach its LCL below the top of the profile; "
            "the whole ascent is unsaturated"
        )

    parcel_t, parcel_td, saturated = _parcel_temperatures(
        grid, parcel, p_lcl, t_lcl, step_pa
    )

    # -- buoyancy, on virtual temperature ------------------------------------
    w_parcel = th.saturation_mixing_ratio(parcel_td, grid)
    w_parcel = np.where(np.isfinite(w_parcel), w_parcel, 0.0)
    tv_parcel = th.virtual_temperature(parcel_t, w_parcel)

    w_env = th.saturation_mixing_ratio(env_td, grid)
    dry_env = ~np.isfinite(w_env)
    if np.any(dry_env):
        flags.append(
            f"{int(np.count_nonzero(dry_env))} of {grid.size} ascent points "
            f"had no environmental moisture; virtual temperature falls back "
            f"to dry temperature there, which makes the environment look "
            f"colder than it is and so OVERSTATES buoyancy and CAPE"
        )
    w_env = np.where(np.isfinite(w_env), w_env, 0.0)
    tv_env = th.virtual_temperature(env_t, w_env)

    dtv = tv_parcel - tv_env
    dtv = np.where(np.abs(dtv) < BUOYANCY_EPSILON, 0.0, dtv)
    buoyancy = th.GRAVITY * dtv / tv_env

    ascent = Ascent(
        parcel=parcel, pressure=grid, height=env_z,
        parcel_temperature=parcel_t, parcel_dewpoint=parcel_td,
        parcel_virtual_temperature=tv_parcel,
        environment_temperature=env_t, environment_dewpoint=env_td,
        environment_virtual_temperature=tv_env,
        buoyancy=buoyancy, saturated=saturated,
        lcl_pressure=p_lcl, lcl_temperature=t_lcl,
        lcl_height=column.height_at_pressure(p_lcl),
        levels_used=len(column),
    )
    _find_levels_and_areas(ascent, dtv, grid, env_z, p_lcl, column, flags)

    if column.degraded:
        ascent.status = Status.DEGRADED
        flags.append(
            f"column has {len(column)} usable levels, "
            f"{column.native_fraction:.0%} native"
        )
    ascent.flags = tuple(flags)
    return ascent


def _parcel_temperatures(
    grid: np.ndarray, parcel: Parcel, p_lcl: float, t_lcl: float,
    step_pa: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Parcel temperature and dew point at every point of the ascent grid.

    Below the LCL the parcel conserves theta and its mixing ratio, so both
    follow in closed form. Above it the pseudoadiabat is integrated
    step-by-step, each step starting from the previous result so the
    integration is continuous rather than restarted from the LCL every time
    (which would cost O(n^2) and accumulate a different error at each point).
    """
    n = grid.size
    parcel_t = np.empty(n)
    parcel_td = np.empty(n)
    saturated = grid <= p_lcl

    w0 = float(th.saturation_mixing_ratio(parcel.dewpoint, parcel.pressure))

    # Dry stage.
    dry = ~saturated
    if np.any(dry):
        parcel_t[dry] = th.dry_adiabatic_temperature(
            parcel.temperature, parcel.pressure, grid[dry]
        )
        # Mixing ratio is conserved, so the dew point falls as pressure does.
        parcel_td[dry] = th.dewpoint_from_mixing_ratio(w0, grid[dry])

    # Moist stage, marched upward from the LCL.
    moist_index = np.flatnonzero(saturated)
    if moist_index.size:
        t_current = t_lcl
        p_current = p_lcl
        for i in moist_index:
            t_current = th.moist_adiabatic_temperature(
                t_current, p_current, float(grid[i]),
                step_pa=min(step_pa, 200.0),
            )
            p_current = float(grid[i])
            parcel_t[i] = t_current
            # Saturated: the parcel's dew point is its temperature.
            parcel_td[i] = t_current
    return parcel_t, parcel_td, saturated


def _find_levels_and_areas(
    ascent: Ascent, dtv: np.ndarray, grid: np.ndarray, height: np.ndarray,
    p_lcl: float, column: Column, flags: list[str],
) -> None:
    """Locate LFC and EL, and integrate the positive and negative areas.

    Crossings are found by linear interpolation in ln(p) between adjacent
    grid points, so LFC and EL are not quantised to the grid.
    """
    ln_p = np.log(grid)

    # Every sign change, as a fractional index.
    crossings: list[tuple[float, float, int]] = []   # (ln_p, pressure, dir)
    for i in range(dtv.size - 1):
        a, b = dtv[i], dtv[i + 1]
        if a == 0.0 and b == 0.0:
            continue
        if (a < 0 <= b) or (a > 0 >= b):
            if b == a:
                continue
            frac = -a / (b - a)
            lp = ln_p[i] + frac * (ln_p[i + 1] - ln_p[i])
            crossings.append((lp, float(np.exp(lp)), 1 if b > a else -1))

    # -- LFC: the lowest upward crossing at or above the LCL ----------------
    lfc_ln = None
    for lp, p, direction in crossings:
        if direction > 0 and p <= p_lcl + 1e-6:
            lfc_ln, ascent.lfc_pressure = lp, p
            break

    if lfc_ln is None:
        # A parcel that is already positively buoyant when it saturates
        # never crosses zero from below, so the loop above finds nothing.
        # Its LFC is the LCL.
        #
        # This used to test only the single grid point nearest the LCL,
        # which misses the case where buoyancy becomes positive a level or
        # two higher with no negative region in between. The gridded engine
        # caught it: on an elevated sounding whose neighbours gave 1053-1532
        # J/kg, this returned 0 J/kg and "no LFC". Testing the whole layer
        # at or above the LCL is both correct and what the gridded path
        # does, so the two now agree by construction.
        above_lcl = grid <= p_lcl + 1e-6
        buoyant = above_lcl & (dtv > 0)
        if np.any(buoyant):
            lfc_ln, ascent.lfc_pressure = float(np.log(p_lcl)), p_lcl
            flags.append(
                "parcel is positively buoyant at its LCL; LFC set to the LCL"
            )

    if lfc_ln is None:
        # CAPE is genuinely zero: there is no positive area to integrate.
        ascent.cape = 0.0
        # CIN is NOT. Convective inhibition is defined as the negative area
        # BELOW the LFC, so with no LFC the quantity has no bounds and no
        # meaning. Integrating to the top of the profile instead produces
        # numbers around -8000 J/kg that look like a monstrous cap and are
        # really just "this atmosphere is stable" expressed in the wrong
        # units. NaN, with a reason, is the honest answer.
        ascent.cin = float("nan")
        ascent.reason = (
            "the parcel never becomes positively buoyant below the top of "
            "the profile: no LFC, so CAPE is zero and CIN is undefined"
        )
        flags.append("no LFC")
        flags.append(
            "CIN undefined: it is the negative area below an LFC, and there "
            "is no LFC"
        )
        # The total stable area is still useful evidence, so it is kept as a
        # separate, differently named quantity that cannot be mistaken for
        # CIN by a caller reading `cin`.
        ascent.total_negative_area = _integrate(
            dtv, ln_p, np.log(grid[-1]), sign=-1, start_ln=ln_p[0]
        )
        return

    # -- EL: the highest downward crossing above the LFC --------------------
    el_ln = None
    for lp, p, direction in reversed(crossings):
        if direction < 0 and lp < lfc_ln:
            el_ln, ascent.el_pressure = lp, p
            break

    top_ln = ln_p[-1]
    if el_ln is None:
        el_ln = top_ln
        flags.append(
            "parcel is still positively buoyant at the top of the profile; "
            "no EL was found and CAPE is integrated only to "
            f"{grid[-1] / 100:.0f} hPa, so it is a lower bound"
        )
        ascent.status = Status.PARTIAL

    # -- areas ---------------------------------------------------------------
    ascent.cape = _integrate(dtv, ln_p, el_ln, sign=+1, start_ln=lfc_ln)
    ascent.cin = _integrate(dtv, ln_p, lfc_ln, sign=-1, start_ln=ln_p[0])
    ascent.positive_layers = _positive_layers(dtv, ln_p, grid)

    if len(ascent.positive_layers) > 1:
        flags.append(
            f"{len(ascent.positive_layers)} separate positively buoyant "
            f"layers; a single CAPE value hides that structure"
        )

    ascent.lfc_height = column.height_at_pressure(ascent.lfc_pressure)
    ascent.el_height = column.height_at_pressure(ascent.el_pressure)


def _integrate(
    dtv: np.ndarray, ln_p: np.ndarray, end_ln: float, *, sign: int,
    start_ln: float,
) -> float:
    """Integrate the buoyancy area of one sign between two ln(p) bounds.

        area = -Rd * INT (Tv_p - Tv_e) d ln p

    Only the requested sign contributes: between the LFC and the EL a
    sounding can contain thin stable layers, and counting their negative
    area against CAPE is not the accepted definition.

    Returns a POSITIVE number for sign=+1 (CAPE) and a NEGATIVE one for
    sign=-1 (CIN), matching the module's stated convention.
    """
    if not (np.isfinite(start_ln) and np.isfinite(end_ln)):
        return 0.0
    lo, hi = min(start_ln, end_ln), max(start_ln, end_ln)

    # Sample on a grid that includes the exact bounds, so a layer is not
    # truncated at the nearest grid point.
    inside = (ln_p > lo) & (ln_p < hi)
    x = np.concatenate(([lo], ln_p[inside], [hi]))
    y = np.interp(x, ln_p[::-1], dtv[::-1])
    order = np.argsort(x)
    x, y = x[order], y[order]

    contribution = y if sign > 0 else -y
    contribution = np.where(contribution > 0, y, 0.0)

    area = -th.R_DRY * np.trapezoid(contribution, x)
    # x increases (ln p increasing = downward), so the integral comes out
    # with the opposite sign to the upward convention; flip it back.
    area = -area
    return float(area) if np.isfinite(area) else 0.0


def _positive_layers(
    dtv: np.ndarray, ln_p: np.ndarray, grid: np.ndarray
) -> tuple[tuple[float, float, float], ...]:
    """Every contiguous positively buoyant layer, bottom-up."""
    positive = dtv > 0
    layers: list[tuple[float, float, float]] = []
    i = 0
    n = positive.size
    while i < n:
        if not positive[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and positive[j + 1]:
            j += 1
        if j > i:
            cape = _integrate(dtv, ln_p, ln_p[j], sign=+1, start_ln=ln_p[i])
            if cape > 0.5:
                layers.append((float(grid[i]), float(grid[j]), cape))
        i = j + 1
    return tuple(layers)


def _empty_ascent(parcel: Parcel, reason: str) -> Ascent:
    empty = np.zeros(0)
    return Ascent(
        parcel=parcel, pressure=empty, height=empty,
        parcel_temperature=empty, parcel_dewpoint=empty,
        parcel_virtual_temperature=empty, environment_temperature=empty,
        environment_dewpoint=empty, environment_virtual_temperature=empty,
        buoyancy=empty, saturated=np.zeros(0, dtype=bool),
        status=Status.UNAVAILABLE, reason=reason,
    )


#: The parcels the engine knows how to build, by name.
SELECTORS = {
    "surface": surface_parcel,
    "mixed_layer": mixed_layer_parcel,
    "most_unstable": most_unstable_parcel,
}


def ascend(
    column: Column, kind: str, **kwargs
) -> Ascent | None:
    """Select a parcel of `kind` and lift it. None if it cannot be built."""
    selector = SELECTORS.get(kind)
    if selector is None:
        raise ValueError(f"unknown parcel kind {kind!r}")
    parcel = selector(column, **kwargs)
    if parcel is None:
        return None
    return lift(column, parcel)
