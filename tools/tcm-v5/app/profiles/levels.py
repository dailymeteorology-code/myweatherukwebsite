"""Vertical coordinates and the standard level sets.

Stage 3. This module owns the answer to "which levels does TCM ask for, and
in what order?" -- nothing else is allowed to hardcode a level list.

TWO COORDINATES, NOT ONE
------------------------
Pressure levels and height levels describe the same atmosphere through
different vertical coordinates, and they are NOT interchangeable. 850 hPa is
a different surface at every location and every hour; 3000 m above ground is
a different pressure at every location and every hour. Both are useful and
both are kept where the data support them.

ORDERING IS DECLARED, NEVER INFERRED
------------------------------------
A provider's ordering is not a contract. TCM stores pressure profiles
SURFACE-FIRST (1000 -> 200 hPa, pressure decreasing with index) and height
profiles GROUND-FIRST (10 -> 6000 m, height increasing with index). Both run
from the ground upward, so index 0 is always the level nearest the surface
whichever coordinate is in use. Anything read from a provider is reordered
into that convention and the reordering is recorded.
"""
from __future__ import annotations

from enum import Enum


class VerticalCoordinate(str, Enum):
    """The vertical coordinate a set of levels is expressed in."""

    ISOBARIC = "isobaric"          # hPa
    HEIGHT_AGL = "height_agl"      # metres above ground level
    HEIGHT_ASL = "height_asl"      # metres above sea level
    MODEL_LEVEL = "model_level"    # native model/hybrid levels
    SINGLE = "single"              # surface and column fields


#: Standard pressure levels, SURFACE FIRST. Pressure DECREASES with index.
#: All nine are present in the current Met Office orders (verified 2026-08-30);
#: no model is assumed to carry them all.
STANDARD_PRESSURE_LEVELS: tuple[float, ...] = (
    1000.0, 925.0, 850.0, 700.0, 500.0, 400.0, 300.0, 250.0, 200.0,
)

#: Standard height levels above ground, GROUND FIRST. Height INCREASES with
#: index. The UK orders carry 10 m to 6000 m for wind; temperature and
#: humidity stop at 5000 m, which the availability layer reports honestly
#: rather than padding.
STANDARD_HEIGHT_LEVELS: tuple[float, ...] = (
    10.0, 50.0, 100.0, 250.0, 500.0, 1000.0,
    2000.0, 3000.0, 4000.0, 5000.0, 6000.0,
)


def is_ordered(levels, coordinate: VerticalCoordinate) -> bool:
    """True when `levels` already follow TCM's ground-upward convention."""
    values = list(levels)
    if len(values) < 2:
        return True
    if coordinate is VerticalCoordinate.ISOBARIC:
        return all(a > b for a, b in zip(values, values[1:]))
    return all(a < b for a, b in zip(values, values[1:]))


def order_indices(levels, coordinate: VerticalCoordinate) -> list[int]:
    """Indices that put `levels` into TCM order.

    Returned as indices rather than sorted values so the caller can reorder
    the DATA alongside, and so a reordering can be recorded as having
    happened. Silently sorting a malformed profile hides the fault.
    """
    values = list(levels)
    descending = coordinate is VerticalCoordinate.ISOBARIC
    return sorted(
        range(len(values)), key=lambda i: values[i], reverse=descending
    )


def find_duplicates(levels) -> list[float]:
    seen, dupes = set(), []
    for value in levels:
        if value in seen and value not in dupes:
            dupes.append(value)
        seen.add(value)
    return dupes


def bracket(target: float, levels: list[float]) -> tuple[int, int] | None:
    """Indices of the two levels enclosing `target`, or None.

    `levels` must already be in TCM order. Returning None is how the engine
    refuses to extrapolate: a target outside the available range has no
    bracket, and no value is produced for it.
    """
    if len(levels) < 2:
        return None
    ascending = levels[0] < levels[-1]
    lo, hi = (levels[0], levels[-1]) if ascending else (levels[-1], levels[0])
    if not (lo <= target <= hi):
        return None
    for i in range(len(levels) - 1):
        a, b = levels[i], levels[i + 1]
        if (a - target) * (b - target) <= 0:
            return (i, i + 1)
    return None


def label(level: float, coordinate: VerticalCoordinate) -> str:
    """Canonical suffix for a level, matching the Stage 2 variable registry."""
    if coordinate is VerticalCoordinate.ISOBARIC:
        return f"{int(level)}" if level == int(level) else f"{level:g}"
    if level == 10.0:
        return "10m"
    if level == 1.5:
        return "2m"
    return f"agl_{int(level)}" if level == int(level) else f"agl_{level:g}"
