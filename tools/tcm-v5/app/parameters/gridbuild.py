"""Building a `GriddedColumns` from a Stage 3 gridded profile.

`gridded.py` does the vectorised parcel physics and `column.py` builds a
single integrable column from a point profile. Nothing joined the two: the
only way to reach the gridded engine was to construct `GriddedColumns` by
hand, which is why it existed solely inside the tests.

This module is that join, and it exists so there is exactly ONE definition
of "the usable column at a cell". It mirrors `column.column_from_profile`
step for step -- same level selection, same supersaturation cap, same
hypsometric fill, same screen-level surface state -- because the whole value
of the gridded path is that it agrees with the scalar one cell by cell.
`test_gridbuild.py` asserts that agreement rather than trusting this
docstring.

THE BELOW-GROUND MASK IS PER CELL, NOT PER LEVEL
------------------------------------------------
Stage 3 records provenance per LEVEL for a cube: a level is BELOW_GROUND if
it is below ground *somewhere*. That is too coarse here. 1000 hPa is roughly
140 m up and is perfectly good air over the North Sea while being inside the
terrain over the Pennines, so a level-wise rule either discards a level that
most of the grid can use or keeps values that are inside a hill.

So levels are selected level-wise (a level must be usable somewhere) and
then masked to NaN cell by cell wherever the level's pressure exceeds that
cell's own surface pressure. This is the same refinement `point_profile`
applies when it extracts a single cell, so the two paths see the same air.
"""
from __future__ import annotations

import logging

import numpy as np

from ..profiles.schema import FieldOrigin, Profile, VariableProfile
from . import thermo as th
from .gridded import GriddedColumns

log = logging.getLogger(__name__)

#: A level is kept when at least this fraction of the grid can use it.
#: Not 0: a level usable in a single cell would carry NaN almost everywhere
#: and add an ascent level for nothing. Not 1: requiring every cell would
#: throw away 1000 hPa because it is inside the Cairngorms.
MIN_LEVEL_COVERAGE = 0.02


def _level_mask(variable: VariableProfile | None) -> np.ndarray | None:
    """Levels carrying real atmospheric values, from provenance alone."""
    if variable is None:
        return None
    return np.array(
        [
            p.origin.has_value and p.origin is not FieldOrigin.BELOW_GROUND
            for p in variable.provenance
        ],
        dtype=bool,
    )


def _cube(variable: VariableProfile | None, index: np.ndarray,
          shape: tuple[int, int]) -> np.ndarray:
    """A variable's values as (n_levels, ny, nx), NaN where absent."""
    if variable is None:
        return np.full((index.size,) + shape, np.nan)
    values = np.asarray(variable.values, dtype="float64")
    if values.ndim != 3:
        return np.full((index.size,) + shape, np.nan)
    return values[index]


def columns_from_cube(cube: Profile) -> GriddedColumns | None:
    """Build the gridded environment from a Stage 3 gridded profile.

    Returns None when there is no usable temperature structure at all --
    the same condition under which `column_from_profile` returns None.
    """
    pressure_vars = cube.pressure
    temperature = pressure_vars.get("temperature")
    if temperature is None:
        log.info("no pressure-level temperature in the cube; no columns")
        return None

    values = np.asarray(temperature.values, dtype="float64")
    if values.ndim != 3:
        log.info("the profile is not gridded (temperature is %dD)",
                 values.ndim)
        return None
    shape = values.shape[1:]

    usable = _level_mask(temperature)
    if usable is None:
        return None
    # A level also has to carry finite values somewhere.
    finite_fraction = np.isfinite(values).reshape(values.shape[0], -1).mean(1)
    usable = usable & (finite_fraction >= MIN_LEVEL_COVERAGE)
    if np.count_nonzero(usable) < 2:
        log.info("only %d usable levels in the cube; no columns",
                 int(np.count_nonzero(usable)))
        return None

    index = np.flatnonzero(usable)
    levels_hpa = np.asarray(temperature.levels, dtype="float64")[index]
    pressure = levels_hpa * 100.0

    # Ground-upward, enforced rather than trusted: a non-monotonic column
    # breaks every integral silently.
    order = np.argsort(-pressure)
    index, pressure = index[order], pressure[order]

    t = _cube(temperature, index, shape)

    # -- per-cell below-ground mask -----------------------------------------
    surface_pressure = _surface_field(cube, "pressure_surface", shape)
    if surface_pressure is not None:
        below = pressure[:, None, None] > surface_pressure[None, :, :] + 1e-6
        t = np.where(below, np.nan, t)
    else:
        below = np.zeros(t.shape, dtype=bool)

    # -- moisture ------------------------------------------------------------
    rh_var = pressure_vars.get("relative_humidity")
    if rh_var is not None:
        rh_levels = _level_mask(rh_var)
        rh = _cube(rh_var, index, shape)
        if rh_levels is not None:
            keep = rh_levels[index][:, None, None]
            rh = np.where(keep, rh, np.nan)
        rh = np.where(below, np.nan, rh)
        dewpoint = th.dewpoint_from_rh(rh, t)
        # Supersaturation is real in model output and Stage 3 deliberately
        # does not clip it, but a parcel lifted from a supersaturated state
        # is not defined. Capped HERE, at the point of use, exactly as the
        # scalar path does.
        over = np.isfinite(dewpoint) & np.isfinite(t) & (dewpoint > t)
        if np.any(over):
            log.info("%d supersaturated cell-levels; dew point capped",
                     int(np.count_nonzero(over)))
            dewpoint = np.where(over, t, dewpoint)
    else:
        dewpoint = np.full_like(t, np.nan)
        log.info("no pressure-level humidity in the cube; parcel "
                 "diagnostics will be unavailable")

    # -- height --------------------------------------------------------------
    gh_var = pressure_vars.get("geopotential_height")
    height = _cube(gh_var, index, shape)
    if gh_var is not None:
        gh_levels = _level_mask(gh_var)
        if gh_levels is not None:
            keep = gh_levels[index][:, None, None]
            height = np.where(keep, height, np.nan)
    height = np.where(below, np.nan, height)
    missing = ~np.isfinite(height)
    if np.any(missing):
        filled = _hypsometric_grid(pressure, t, dewpoint, height)
        if filled is not None:
            height = filled

    return GriddedColumns(
        pressure=pressure,
        temperature=t,
        dewpoint=dewpoint,
        height=height,
        surface_pressure=surface_pressure,
        surface_temperature=_surface_temperature(cube, shape),
        surface_dewpoint=_surface_dewpoint(cube, shape),
    )


# ---------------------------------------------------------------------------
# Surface state
# ---------------------------------------------------------------------------

def _surface_field(cube: Profile, name: str,
                   shape: tuple[int, int]) -> np.ndarray | None:
    value = cube.surface.get(name)
    if value is None:
        return None
    array = np.asarray(value, dtype="float64")
    if array.shape != shape:
        return None
    return array


def _surface_temperature(cube: Profile,
                         shape: tuple[int, int]) -> np.ndarray | None:
    """Screen-level temperature, falling back to the lowest height level.

    The surface parcel must start from the screen-level state: at 990 hPa
    surface pressure the lowest usable pressure level may be 700 m up, and a
    parcel launched there is not surface-based in any useful sense.
    """
    t2 = _surface_field(cube, "temperature_2m", shape)
    if t2 is not None:
        return t2
    variable = cube.height.get("temperature")
    return _lowest_height_level(variable, shape)


def _surface_dewpoint(cube: Profile,
                      shape: tuple[int, int]) -> np.ndarray | None:
    td2 = _surface_field(cube, "dewpoint_2m", shape)
    if td2 is not None:
        return td2
    rh2 = _surface_field(cube, "relative_humidity_2m", shape)
    if rh2 is None:
        rh2 = _lowest_height_level(cube.height.get("relative_humidity"), shape)
    t2 = _surface_temperature(cube, shape)
    if rh2 is None or t2 is None:
        return None
    return np.asarray(th.dewpoint_from_rh(rh2, t2), dtype="float64")


def _lowest_height_level(variable: VariableProfile | None,
                         shape: tuple[int, int]) -> np.ndarray | None:
    if variable is None or not variable.levels:
        return None
    lowest = int(np.argmin(np.asarray(variable.levels, dtype="float64")))
    provenance = variable.provenance
    if lowest < len(provenance) and not provenance[lowest].origin.has_value:
        return None
    values = np.asarray(variable.values, dtype="float64")
    if values.ndim != 3 or values.shape[1:] != shape:
        return None
    return values[lowest]


# ---------------------------------------------------------------------------
# Height reconstruction
# ---------------------------------------------------------------------------

def _hypsometric_grid(
    pressure: np.ndarray, temperature: np.ndarray, dewpoint: np.ndarray,
    height: np.ndarray,
) -> np.ndarray | None:
    """Fill missing heights by integrating the hypsometric equation.

    Anchored on the lowest level that HAS a height, per cell, and integrated
    both ways from there. Uses virtual temperature, for which the relation is
    exact.
    """
    finite = np.isfinite(height)
    if not np.any(finite):
        return None

    w = th.saturation_mixing_ratio(dewpoint, pressure[:, None, None])
    w = np.where(np.isfinite(w), w, 0.0)
    tv = th.virtual_temperature(temperature, w)

    # Layer thickness between adjacent levels, from the mean virtual
    # temperature of the layer.
    ln_p = np.log(pressure)
    mean_tv = 0.5 * (tv[:-1] + tv[1:])
    thickness = (th.R_DRY * mean_tv / th.GRAVITY) * (
        ln_p[:-1] - ln_p[1:]
    )[:, None, None]

    out = np.array(height, dtype="float64", copy=True)
    n = pressure.size
    has_anchor = np.any(finite, axis=0)

    # Two sweeps rather than one, because a cell's anchor -- the lowest level
    # that has a height -- can sit anywhere in the column, and a missing
    # level may be below it as well as above.
    for level in range(1, n):
        need = ~np.isfinite(out[level]) & np.isfinite(out[level - 1])
        if np.any(need):
            out[level] = np.where(
                need, out[level - 1] + thickness[level - 1], out[level]
            )
    # Downward sweep, for cells whose anchor was above the missing level.
    for level in range(n - 2, -1, -1):
        need = ~np.isfinite(out[level]) & np.isfinite(out[level + 1])
        if np.any(need):
            out[level] = np.where(
                need, out[level + 1] - thickness[level], out[level]
            )

    out = np.where(has_anchor[None, :, :], out, np.nan)
    return out
