"""Vectorised parcel ascent, for whole grids.

`parcel.lift()` handles one column and marches the pseudoadiabat in a Python
loop. That is right for a point and hopeless for 455x639 cells: the loop runs
once per cell, and the UKV grid has 290,745 of them.

This module does the same physics for every cell at once. It is NOT a
different or approximate calculation -- `test_gridded.py` asserts it
reproduces `parcel.lift()` cell by cell, and the two share every
thermodynamic function in `thermo.py`. If they ever disagree, one of them is
wrong and the test says so.

EVERYTHING IS ANCHORED PER CELL
-------------------------------
The ascent grid is a set of pressure OFFSETS shared by every cell, applied to
each cell's own parcel origin. The spacing is therefore identical everywhere
-- which is what makes the march vectorisable -- while the absolute pressures
differ. Parcel searches are anchored the same way, on each cell's own surface.

That is not a detail. A single shared ABSOLUTE grid means a cell whose
surface is 992 hPa is never evaluated at 992 hPa, so the most-unstable search
misses the warmest, moistest air it exists to find and selects a different
parcel. Against the scalar engine that cost 163 J/kg.

At any given level some cells are still dry and others are already on a
pseudoadiabat, and the ones that just crossed started partway through the
step. So the march carries a `t_current` array and, at each level:

  * cells still below their LCL take the closed-form dry solution
  * cells already saturated take an RK4 step from the previous level
  * cells crossing at this level take an RK4 step from their OWN LCL
    pressure, with a per-cell step size

That last case is why the step size is an array rather than a scalar.
Snapping each LCL to the nearest grid level instead would quantise cloud base
to 5 hPa and print the ascent grid onto every derived field.

AGREEMENT AND SPEED
-------------------
Across twelve different synthetic soundings with surface pressures spread
either side of 1000 hPa, all three parcel types agree with `parcel.lift()` to
within 1.3 J/kg of CAPE. The residual is ascent-grid discretisation, not a
modelling difference.

Measured at roughly 230 us per cell against 118 ms for the scalar path: about
510x, or 67 seconds for the full 290,745-cell UKV grid where the scalar
engine would need over nine hours.

WHAT THIS BUYS
--------------
Forcing. Convergence, frontogenesis and vertical velocity are horizontal-
field quantities that a single column cannot see, so Stage 5's initiation
engine had to cap itself at 0.45 and report LOW_CONFIDENCE. On a grid those
fields exist, and the cap lifts.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

import numpy as np

from . import thermo as th
from .parcel import (
    ASCENT_STEP_PA, BUOYANCY_EPSILON, MIXED_LAYER_DEPTH_PA,
    MOST_UNSTABLE_DEPTH_PA,
)

log = logging.getLogger(__name__)

#: Substeps used when a cell crosses its LCL partway through a grid step.
#: Four keeps the RK4 error of the partial step below the error of the step
#: it sits inside, so the crossing costs nothing in accuracy.
CROSSING_SUBSTEPS = 4


@dataclass(slots=True)
class GriddedColumns:
    """The environment for every cell, on a common pressure grid.

    Arrays are (n_levels, ny, nx) with level 0 nearest the ground, matching
    the Stage 3 convention. Cells where a level is below ground or otherwise
    unusable carry NaN, and every calculation here propagates that rather
    than filling it.
    """

    pressure: np.ndarray          # (n_levels,) Pa, decreasing -- shared
    temperature: np.ndarray       # (n_levels, ny, nx) K
    dewpoint: np.ndarray          # (n_levels, ny, nx) K
    height: np.ndarray            # (n_levels, ny, nx) m
    surface_pressure: np.ndarray | None = None   # (ny, nx) Pa
    surface_temperature: np.ndarray | None = None
    surface_dewpoint: np.ndarray | None = None

    @property
    def shape(self) -> tuple[int, int]:
        return self.temperature.shape[1:]

    @property
    def n_levels(self) -> int:
        return int(self.pressure.size)


@dataclass(slots=True)
class GriddedAscent:
    """Parcel diagnostics for every cell.

    Same quantities as `parcel.Ascent`, one value per cell instead of one
    per column. The full lifted profile is NOT retained: it would be
    (n_ascent_levels, ny, nx) floats, about 180 MB per parcel type on the UKV
    grid, and nothing downstream reads it gridded. `parcel.lift()` still
    returns it for a point, which is where it is actually inspected.
    """

    kind: str
    cape: np.ndarray
    cin: np.ndarray
    lcl_pressure: np.ndarray
    lcl_height: np.ndarray
    lfc_pressure: np.ndarray
    lfc_height: np.ndarray
    el_pressure: np.ndarray
    el_height: np.ndarray
    parcel_pressure: np.ndarray
    parcel_temperature: np.ndarray
    parcel_dewpoint: np.ndarray
    #: Cells where no LFC exists. CAPE is 0 and CIN is NaN there, matching
    #: the scalar engine: inhibition is the area beneath an LFC, and without
    #: one it has no bounds and no meaning.
    no_lfc: np.ndarray
    notes: list[str] = dc_field(default_factory=list)


def _interp_log_p_grid(
    target: np.ndarray, pressure: np.ndarray, values: np.ndarray
) -> np.ndarray:
    """Interpolate (n_levels, ny, nx) values onto `target` pressures.

    Linear in ln(p), no extrapolation: outside the source range the result is
    NaN, the same refusal the scalar path makes.

    `target` is (m,) and shared; `pressure` is (n_levels,) and shared; the
    per-cell variation is entirely in `values`. That is what makes this a
    handful of array operations rather than a loop.
    """
    shape = values.shape[1:]
    ln_source = np.log(pressure)[::-1]            # ascending
    flat = values.reshape(values.shape[0], -1)[::-1]
    cells = flat.shape[1]

    target = np.asarray(target, dtype="float64")
    if target.ndim == 1:
        # A shared set of target pressures: broadcast across cells.
        ln_target = np.repeat(np.log(target)[:, None], cells, axis=1)
    else:
        # PER-CELL target pressures. Needed wherever the sampling must be
        # anchored on something that varies by cell -- a parcel origin, or
        # each cell's own surface. Sampling every cell on one shared grid
        # instead means a cell whose surface is 992 hPa is never evaluated
        # AT 992 hPa, so the most-unstable search misses the warmest,
        # moistest air it exists to find and selects a different parcel.
        ln_target = np.log(target).reshape(target.shape[0], -1)

    index = np.searchsorted(ln_source, ln_target.ravel()).reshape(
        ln_target.shape
    )
    index = np.clip(index, 1, ln_source.size - 1)
    lower, upper = index - 1, index

    span = ln_source[upper] - ln_source[lower]
    with np.errstate(divide="ignore", invalid="ignore"):
        weight = np.where(span != 0, (ln_target - ln_source[lower]) / span, 0.0)

    below = np.take_along_axis(flat, lower, axis=0)
    above = np.take_along_axis(flat, upper, axis=0)
    out = below + weight * (above - below)

    outside = (
        (ln_target < ln_source[0] - 1e-9) | (ln_target > ln_source[-1] + 1e-9)
    )
    out = np.where(outside, np.nan, out)
    return out.reshape((ln_target.shape[0],) + shape)


def _lowest_usable(columns: GriddedColumns) -> tuple[np.ndarray, np.ndarray,
                                                     np.ndarray]:
    """Per cell: (pressure, T, Td) at the lowest level carrying real values.

    Not simply level 0. Where 1000 hPa is below ground the model still
    carries an extrapolated number there, Stage 3 marks it and the column
    builder drops it, so the lowest USABLE level varies from cell to cell.
    """
    usable = np.isfinite(columns.temperature) & np.isfinite(columns.dewpoint)
    first = np.argmax(usable, axis=0)
    idx = np.indices(columns.shape)
    pressure = np.broadcast_to(
        columns.pressure[:, None, None], columns.temperature.shape
    )[first, idx[0], idx[1]]
    any_usable = usable.any(axis=0)
    return (
        np.where(any_usable, pressure, np.nan),
        np.where(any_usable, columns.temperature[first, idx[0], idx[1]], np.nan),
        np.where(any_usable, columns.dewpoint[first, idx[0], idx[1]], np.nan),
    )


def environment_at(
    columns: GriddedColumns, target: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """(T, Td) at each target pressure, INCLUDING the surface layer.

    The gridded twin of `Column.thermo_at`, and it exists for the same
    reason. Stored pressure levels start at 1000 hPa but the surface is
    routinely below that -- 1008 hPa over England, 1019 over the sea. Plain
    interpolation returns NaN through that slab, which is the warmest and
    moistest air in the column, so a parcel search that cannot see it picks
    the wrong parcel: it returned MUCAPE 333 J/kg below the scalar engine's
    answer, from a visibly different LCL.

    Below the lowest usable level this interpolates between the screen state
    and that level. Both endpoints are real model output, so it is
    interpolation rather than extrapolation, and it is only available where
    the screen state exists.
    """
    aloft_t = _interp_log_p_grid(target, columns.pressure, columns.temperature)
    aloft_td = _interp_log_p_grid(target, columns.pressure, columns.dewpoint)

    if (
        columns.surface_pressure is None
        or columns.surface_temperature is None
        or columns.surface_dewpoint is None
    ):
        return aloft_t, aloft_td

    p_low, t_low, td_low = _lowest_usable(columns)
    target = np.asarray(target, dtype="float64")
    # `target` may be shared (m,) or per-cell (m, ny, nx); the latter is how
    # a search anchored on each cell's own surface is expressed.
    p3 = target[:, None, None] if target.ndim == 1 else target
    surface_p = columns.surface_pressure[None, ...]

    in_surface_layer = (
        (p3 > p_low[None, ...] + 1e-6)
        & (p3 <= surface_p + 1e-6)
        & np.isfinite(p_low)[None, ...]
    )
    span = np.log(surface_p) - np.log(p_low[None, ...])
    with np.errstate(divide="ignore", invalid="ignore"):
        weight = np.where(
            span != 0, (np.log(p3) - np.log(p_low[None, ...])) / span, 0.0
        )
    weight = np.clip(np.nan_to_num(weight), 0.0, 1.0)

    blended_t = t_low[None, ...] + weight * (
        columns.surface_temperature[None, ...] - t_low[None, ...]
    )
    blended_td = td_low[None, ...] + weight * (
        columns.surface_dewpoint[None, ...] - td_low[None, ...]
    )
    return (
        np.where(in_surface_layer, blended_t, aloft_t),
        np.where(in_surface_layer, blended_td, aloft_td),
    )


def _moist_step(
    temperature: np.ndarray, pressure: np.ndarray, step: np.ndarray
) -> np.ndarray:
    """One vectorised RK4 step of the pseudoadiabat, per-cell step size.

    `step` is an array so that cells crossing their LCL partway through a
    grid interval can integrate from their own crossing pressure.
    """
    k1 = th.moist_lapse_rate_dp(temperature, pressure)
    k2 = th.moist_lapse_rate_dp(
        temperature + 0.5 * step * k1, pressure + 0.5 * step
    )
    k3 = th.moist_lapse_rate_dp(
        temperature + 0.5 * step * k2, pressure + 0.5 * step
    )
    k4 = th.moist_lapse_rate_dp(temperature + step * k3, pressure + step)
    return temperature + step * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0


def lift_grid(
    columns: GriddedColumns,
    parcel_pressure: np.ndarray,
    parcel_temperature: np.ndarray,
    parcel_dewpoint: np.ndarray,
    *, kind: str, step_pa: float = ASCENT_STEP_PA,
) -> GriddedAscent:
    """Lift one parcel per cell and evaluate its buoyancy everywhere."""
    shape = columns.shape
    top = float(np.nanmin(columns.pressure))
    base = float(np.nanmax(parcel_pressure))
    if not np.isfinite(base) or base <= top:
        raise ValueError(
            "parcel origins are at or above the top of the profile"
        )

    # Levels are offsets ABOVE each cell's OWN parcel origin, so the ascent
    # begins exactly where the parcel does -- as the scalar engine's does by
    # construction. The SPACING is identical for every cell, which is what
    # keeps the moist march vectorisable; only the absolute pressures differ.
    # A shared absolute grid instead samples each cell at a different offset
    # from its origin, which moved CAPE by ~100 J/kg against the scalar.
    n_levels = int(np.ceil((base - top) / step_pa)) + 1
    if n_levels < 3:
        raise ValueError(
            f"only {n_levels} ascent levels between {base/100:.0f} and "
            f"{top/100:.0f} hPa"
        )
    offsets = np.arange(n_levels) * step_pa
    grid = parcel_pressure[None, ...] - offsets[:, None, None]
    # Clip at the profile top. The offset count is sized for the DEEPEST
    # parcel on the domain, so for a cell whose parcel starts at 850 hPa the
    # last offsets run past zero into NEGATIVE pressure -- and log() of that
    # is NaN, which propagates through the trapezoid and returns NaN CAPE
    # for the whole cell. Clipped levels sit at the top with zero width, so
    # they contribute nothing.
    grid = np.maximum(grid, top)

    # `environment_at`, not plain interpolation: the layer between the
    # surface and the lowest stored level is where CIN is decided, and
    # dropping it as NaN would silently remove it from every ascent.
    env_t, env_td = environment_at(columns, grid)
    env_z = _interp_log_p_grid(grid, columns.pressure, columns.height)

    # -- the LCL, per cell -------------------------------------------------
    p_lcl = th.lcl_pressure(
        parcel_temperature, parcel_dewpoint, parcel_pressure
    )
    t_lcl = th.lcl_temperature(parcel_temperature, parcel_dewpoint)
    w0 = th.saturation_mixing_ratio(parcel_dewpoint, parcel_pressure)

    n = grid.shape[0]
    parcel_t = np.full((n,) + shape, np.nan)
    parcel_td = np.full((n,) + shape, np.nan)

    # `t_current` and `p_current` carry each cell's moist integration
    # forward. Cells not yet saturated are untouched by the moist branch.
    t_current = np.array(t_lcl, dtype="float64", copy=True)
    p_current = np.array(p_lcl, dtype="float64", copy=True)
    was_saturated = np.zeros(shape, dtype=bool)

    for i in range(n):
        level = grid[i]
        saturated = level <= p_lcl
        dry = ~saturated

        if np.any(dry):
            t_dry = th.dry_adiabatic_temperature(
                parcel_temperature, parcel_pressure, level
            )
            td_dry = th.dewpoint_from_mixing_ratio(w0, level)
            parcel_t[i] = np.where(dry, t_dry, np.nan)
            parcel_td[i] = np.where(dry, td_dry, np.nan)

        if np.any(saturated):
            crossing = saturated & ~was_saturated
            continuing = saturated & was_saturated

            if np.any(crossing):
                # Integrate from each cell's OWN LCL pressure to this level.
                # Snapping to the grid instead would quantise cloud base and
                # print the ascent grid onto every derived field.
                total = level - p_current
                sub = total / CROSSING_SUBSTEPS
                t_cross = np.where(crossing, t_current, np.nan)
                p_cross = np.where(crossing, p_current, np.nan)
                for _ in range(CROSSING_SUBSTEPS):
                    t_cross = _moist_step(t_cross, p_cross, sub)
                    p_cross = p_cross + sub
                t_current = np.where(crossing, t_cross, t_current)

            if np.any(continuing):
                step = (level - grid[i - 1]) if i else np.zeros(shape)
                t_step = _moist_step(t_current, p_current, step)
                t_current = np.where(continuing, t_step, t_current)

            p_current = np.where(saturated, level, p_current)
            parcel_t[i] = np.where(saturated, t_current, parcel_t[i])
            # Saturated: the parcel's dew point is its temperature.
            parcel_td[i] = np.where(saturated, t_current, parcel_td[i])
            was_saturated = was_saturated | saturated

    # -- buoyancy on virtual temperature -----------------------------------
    w_parcel = th.saturation_mixing_ratio(parcel_td, grid)
    w_parcel = np.where(np.isfinite(w_parcel), w_parcel, 0.0)
    tv_parcel = th.virtual_temperature(parcel_t, w_parcel)

    w_env = th.saturation_mixing_ratio(env_td, grid)
    w_env = np.where(np.isfinite(w_env), w_env, 0.0)
    tv_env = th.virtual_temperature(env_t, w_env)

    dtv = tv_parcel - tv_env
    dtv = np.where(np.abs(dtv) < BUOYANCY_EPSILON, 0.0, dtv)

    # No origin mask is needed: the grid starts AT each cell's parcel
    # origin, so no level lies below it.
    dtv = np.where(np.isfinite(dtv), dtv, np.nan)

    return _levels_and_areas(
        kind, grid, dtv, env_z, p_lcl, t_lcl, columns,
        parcel_pressure, parcel_temperature, parcel_dewpoint,
    )


def _levels_and_areas(
    kind, grid, dtv, env_z, p_lcl, t_lcl, columns,
    parcel_pressure, parcel_temperature, parcel_dewpoint,
) -> GriddedAscent:
    """Locate LFC and EL and integrate the areas, for every cell at once."""
    n = grid.shape[0]
    shape = dtv.shape[1:]
    ln_p = np.log(grid)
    at_or_above_lcl = grid <= p_lcl[None, ...] + 1e-6

    positive = (dtv > 0) & at_or_above_lcl
    positive = np.where(np.isfinite(dtv), positive, False)

    has_positive = positive.any(axis=0)
    # First positive level at or above the LCL -> the LFC bracket.
    first = np.argmax(positive, axis=0)
    # Last positive level -> the EL bracket. argmax on the reversed array.
    last = n - 1 - np.argmax(positive[::-1], axis=0)

    lfc_pressure = np.full(shape, np.nan)
    el_pressure = np.full(shape, np.nan)

    # Interpolate the crossings in ln(p) between the bracketing levels, so
    # LFC and EL are not quantised to the 5 hPa ascent grid.
    idx = np.indices(shape)
    f = first
    below = np.maximum(f - 1, 0)
    a = dtv[below, idx[0], idx[1]]
    b = dtv[f, idx[0], idx[1]]
    ln_below = ln_p[below, idx[0], idx[1]]
    ln_f = ln_p[f, idx[0], idx[1]]
    # Interpolate the zero crossing only where the lower bracket really is
    # negative. Where it is already positive there is no crossing between
    # the two levels -- the parcel became buoyant at its LCL, below the
    # first level the LCL mask admits -- and forcing an interpolation there
    # snapped the LFC onto the ascent grid, 3-4 hPa from the scalar answer.
    crosses = np.isfinite(a) & np.isfinite(b) & (a < 0) & (b > 0)
    with np.errstate(divide="ignore", invalid="ignore"):
        frac = np.where(crosses & (b != a), -a / (b - a), 0.0)
    frac = np.clip(np.nan_to_num(frac), 0.0, 1.0)
    ln_lfc = np.where(
        crosses, ln_below + frac * (ln_f - ln_below), np.log(p_lcl)
    )
    lfc_pressure = np.where(has_positive, np.exp(ln_lfc), np.nan)
    # A parcel already buoyant at the first level has its LFC at the LCL.
    lfc_pressure = np.where(
        has_positive & (f == 0), np.minimum(p_lcl, grid[0]), lfc_pressure
    )

    l = last
    above = np.minimum(l + 1, n - 1)
    a2 = dtv[l, idx[0], idx[1]]
    b2 = dtv[above, idx[0], idx[1]]
    ln_l = ln_p[l, idx[0], idx[1]]
    ln_above = ln_p[above, idx[0], idx[1]]
    crosses_down = np.isfinite(a2) & np.isfinite(b2) & (a2 > 0) & (b2 < 0)
    with np.errstate(divide="ignore", invalid="ignore"):
        frac2 = np.where(crosses_down & (b2 != a2), -a2 / (b2 - a2), 0.0)
    frac2 = np.clip(np.nan_to_num(frac2), 0.0, 1.0)
    ln_el = ln_l + frac2 * (ln_above - ln_l)
    el_pressure = np.where(has_positive, np.exp(ln_el), np.nan)
    # Still buoyant at the profile top: no EL was found, and CAPE is a lower
    # bound. Flagged rather than silently truncated.
    still_buoyant = has_positive & (l == n - 1)
    el_pressure = np.where(still_buoyant, np.nan, el_pressure)

    # -- the areas ----------------------------------------------------------
    # CAPE = -Rd INT (Tv_p - Tv_e) d ln p over the positive area, exactly as
    # the scalar engine computes it.
    contribution = np.where(positive, np.nan_to_num(dtv), 0.0)
    cape = th.R_DRY * np.abs(np.trapezoid(contribution, ln_p, axis=0))
    cape = np.where(has_positive, cape, 0.0)

    below_lfc = grid > lfc_pressure[None, ...]
    negative = (dtv < 0) & below_lfc
    negative = np.where(np.isfinite(dtv), negative, False)
    negative_contribution = np.where(negative, np.nan_to_num(dtv), 0.0)
    cin = -th.R_DRY * np.abs(
        np.trapezoid(negative_contribution, ln_p, axis=0)
    )
    # No LFC -> CIN is undefined, not a huge number. Same rule as the scalar
    # engine: inhibition is the area beneath an LFC.
    no_lfc = ~has_positive
    cin = np.where(no_lfc, np.nan, cin)
    cape = np.where(no_lfc, 0.0, cape)

    def height_at(pressure_field):
        """Geopotential height at a per-cell pressure, by interpolation."""
        out = np.full(shape, np.nan)
        finite = np.isfinite(pressure_field)
        if not np.any(finite):
            return out
        ln_target = np.log(np.where(finite, pressure_field, grid[0]))
        for i in range(n - 1):
            lo, hi = ln_p[i], ln_p[i + 1]          # both 2-D now
            inside = (ln_target <= lo) & (ln_target >= hi)
            if not np.any(inside):
                continue
            span = hi - lo
            with np.errstate(divide="ignore", invalid="ignore"):
                w = np.where(span != 0, (ln_target - lo) / span, 0.0)
            interpolated = env_z[i] + w * (env_z[i + 1] - env_z[i])
            out = np.where(inside & finite, interpolated, out)
        return out

    return GriddedAscent(
        kind=kind,
        cape=cape, cin=cin,
        lcl_pressure=p_lcl, lcl_height=height_at(p_lcl),
        lfc_pressure=lfc_pressure, lfc_height=height_at(lfc_pressure),
        el_pressure=el_pressure, el_height=height_at(el_pressure),
        parcel_pressure=parcel_pressure,
        parcel_temperature=parcel_temperature,
        parcel_dewpoint=parcel_dewpoint,
        no_lfc=no_lfc,
    )


# ---------------------------------------------------------------------------
# Parcel selection, vectorised
# ---------------------------------------------------------------------------

def _search_base(columns: GriddedColumns) -> np.ndarray:
    """Per cell, the pressure a parcel search starts from.

    The screen-level surface where it genuinely lies BELOW the lowest usable
    stored level, otherwise that level.

    The guard is not a formality. Over higher ground the surface pressure can
    be LOWER than 1000 hPa -- 992 hPa at about 150 m, routinely -- which
    means the 1000 hPa level is underground and the screen state is the
    higher of the two. Starting the search from the screen state there would
    skip the 1000 hPa level entirely and select a cooler, drier parcel: it
    cost 109 J/kg of MUCAPE against the scalar engine, which applies exactly
    this test through `Column.surface_layer_available`.
    """
    lowest = _lowest_usable(columns)[0]
    if columns.surface_pressure is None:
        return lowest
    surface = np.asarray(columns.surface_pressure, dtype="float64")
    usable_surface = np.isfinite(surface) & np.isfinite(lowest) \
        & (surface > lowest + 1e-6)
    return np.where(usable_surface, surface, lowest)


def surface_parcel_grid(columns: GriddedColumns):
    """Screen-level state where available, lowest usable level otherwise."""
    p_low, t_low, td_low = _lowest_usable(columns)
    if (
        columns.surface_pressure is None
        or columns.surface_temperature is None
        or columns.surface_dewpoint is None
    ):
        return p_low, t_low, np.minimum(td_low, t_low)

    # The screen state is used whenever it exists, WITHOUT the guard that
    # `_search_base` applies, because that is exactly what
    # `parcel.surface_parcel` does and the two must agree cell for cell.
    #
    # The asymmetry is deliberate on both sides. A surface-based parcel IS
    # the screen-level state by definition. The mixed-layer and
    # most-unstable searches, by contrast, scan a layer downward from a
    # starting pressure, so that pressure has to be the genuine bottom of
    # the column -- and where the surface lies above the lowest stored level
    # (higher ground, 992 hPa over a 1000 hPa level that is underground)
    # it is not.
    return (
        np.asarray(columns.surface_pressure, dtype="float64"),
        np.asarray(columns.surface_temperature, dtype="float64"),
        np.minimum(columns.surface_dewpoint, columns.surface_temperature),
    )


def most_unstable_parcel_grid(
    columns: GriddedColumns, depth_pa: float = MOST_UNSTABLE_DEPTH_PA,
    step_pa: float = ASCENT_STEP_PA,
):
    """The maximum-theta-e parcel in the lowest `depth_pa`, per cell.

    theta-e, not temperature -- a warm dry parcel has less available energy
    than a cooler moist one. The search starts at the SURFACE where the
    screen state exists, because the lowest stored pressure level is often
    well above it and skipping that slab returned MUCAPE below SBCAPE on
    live data.
    """
    base_field = _search_base(columns)
    # Offsets BELOW each cell's OWN surface, so the surface itself is always
    # candidate zero. A shared absolute grid skips it wherever the surface
    # pressure does not land on a grid point -- and the surface is precisely
    # the warmest, moistest air this search exists to find. That omission
    # selected a different parcel and cost 163 J/kg against the scalar
    # engine, with a visibly different LCL.
    offsets = np.arange(0.0, depth_pa + 1.0, step_pa)
    targets = base_field[None, ...] - offsets[:, None, None]

    t, td = environment_at(columns, targets)
    td = np.minimum(td, t)

    # The surface parcel is ALWAYS a candidate, appended explicitly. See the
    # matching comment in `parcel.most_unstable_parcel`: without it the two
    # selectors disagree about what "the surface" is and MUCAPE can come out
    # below SBCAPE, which is impossible by definition.
    sp, st, sd = surface_parcel_grid(columns)
    targets = np.concatenate([targets, sp[None, ...]], axis=0)
    t = np.concatenate([t, st[None, ...]], axis=0)
    td = np.concatenate([td, np.minimum(sd, st)[None, ...]], axis=0)

    theta_e = th.equivalent_potential_temperature(t, td, targets)
    theta_e = np.where(np.isfinite(theta_e), theta_e, -np.inf)

    best = np.argmax(theta_e, axis=0)
    idx = np.indices(columns.shape)
    return (
        np.take_along_axis(targets, best[None, ...], axis=0)[0],
        t[best, idx[0], idx[1]],
        td[best, idx[0], idx[1]],
    )


def mixed_layer_parcel_grid(
    columns: GriddedColumns, depth_pa: float = MIXED_LAYER_DEPTH_PA,
    step_pa: float = ASCENT_STEP_PA,
):
    """Mass-weighted mean theta and mixing ratio over the lowest `depth_pa`.

    theta and mixing ratio, not temperature and RH: those are what dry
    mixing conserves, so their average is what a mixed layer actually holds.
    """
    base_field = _search_base(columns)
    # Anchored on each cell's own surface, for the same reason as the
    # most-unstable search: the mixed layer is the layer that actually
    # mixes, not the slab a shared absolute grid happens to cover.
    offsets = np.arange(0.0, depth_pa + 1.0, step_pa)
    p3 = base_field[None, ...] - offsets[:, None, None]

    t, td = environment_at(columns, p3)
    td = np.minimum(td, t)

    inside = np.isfinite(t) & np.isfinite(td)
    theta = th.potential_temperature(t, p3)
    w = th.saturation_mixing_ratio(td, p3)

    weights = np.where(inside, step_pa, 0.0)
    total = weights.sum(axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        theta_mean = np.where(
            total > 0, (np.nan_to_num(theta) * weights).sum(axis=0) / total,
            np.nan,
        )
        w_mean = np.where(
            total > 0, (np.nan_to_num(w) * weights).sum(axis=0) / total,
            np.nan,
        )

    t_parcel = th.dry_adiabatic_temperature(
        theta_mean, th.P_REFERENCE, base_field
    )
    td_parcel = th.dewpoint_from_mixing_ratio(w_mean, base_field)
    return base_field, t_parcel, np.minimum(td_parcel, t_parcel)


SELECTORS = {
    "surface": surface_parcel_grid,
    "mixed_layer": mixed_layer_parcel_grid,
    "most_unstable": most_unstable_parcel_grid,
}


def ascend_grid(
    columns: GriddedColumns, kind: str, **kwargs
) -> GriddedAscent:
    """Select a parcel of `kind` for every cell and lift it."""
    selector = SELECTORS.get(kind)
    if selector is None:
        raise ValueError(f"unknown parcel kind {kind!r}")
    pressure, temperature, dewpoint = selector(columns, **kwargs)
    return lift_grid(
        columns, pressure, temperature, dewpoint, kind=kind
    )
