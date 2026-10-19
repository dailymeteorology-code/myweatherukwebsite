"""Solar elevation on the TCM grid.

Needed because some ingredients only mean what they say while the sun is up.
The clearest case is cloud cover: TCM scores it INVERTED, because broken
cloud lets the surface heat and drive afternoon initiation. At 3am that
reasoning is not merely weaker, it is backwards -- a clear night sky is the
signature of no convection at all, and the modifier was rewarding it. That
inflated overnight risk above the afternoon peak on the 2026-08-29 12Z
cycle: 03:00Z scored 77.5 against 64.9 at 15:00Z, while the model's own
lightning field had 0.11% coverage overnight against 1.32% in the afternoon.

Standard low-precision solar position (NOAA). Good to a few tenths of a
degree, which is far inside what a daylight weighting needs.
"""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

import numpy as np

#: Elevation above which surface heating is treated as fully effective.
FULL_SUN_DEG = 15.0

#: Below this the sun does no useful heating.
NO_SUN_DEG = 0.0


def solar_elevation(when: datetime, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Solar elevation in degrees for every cell, at one instant."""
    when = when.astimezone(timezone.utc)
    day = when.timetuple().tm_yday
    hour = when.hour + when.minute / 60.0 + when.second / 3600.0

    gamma = 2.0 * np.pi / 365.0 * (day - 1 + (hour - 12.0) / 24.0)
    # Equation of time (minutes) and solar declination (radians).
    eqtime = 229.18 * (
        0.000075 + 0.001868 * np.cos(gamma) - 0.032077 * np.sin(gamma)
        - 0.014615 * np.cos(2 * gamma) - 0.040849 * np.sin(2 * gamma)
    )
    decl = (
        0.006918 - 0.399912 * np.cos(gamma) + 0.070257 * np.sin(gamma)
        - 0.006758 * np.cos(2 * gamma) + 0.000907 * np.sin(2 * gamma)
        - 0.002697 * np.cos(3 * gamma) + 0.00148 * np.sin(3 * gamma)
    )

    time_offset = eqtime + 4.0 * lon           # minutes; UTC, so no zone term
    true_solar = hour * 60.0 + time_offset
    hour_angle = np.radians(true_solar / 4.0 - 180.0)

    lat_r = np.radians(lat)
    cos_zenith = (
        np.sin(lat_r) * np.sin(decl)
        + np.cos(lat_r) * np.cos(decl) * np.cos(hour_angle)
    )
    return np.degrees(np.arcsin(np.clip(cos_zenith, -1.0, 1.0)))


def daylight_weight(when: datetime) -> np.ndarray:
    """0 at night, 1 in full sun, ramping between, on the TCM grid."""
    from ..grid import grid_lonlat, tcm_grid

    lon, lat = _lonlat()
    elevation = solar_elevation(when, lat, lon)
    span = FULL_SUN_DEG - NO_SUN_DEG
    return np.clip((elevation - NO_SUN_DEG) / span, 0.0, 1.0)


@lru_cache(maxsize=1)
def _lonlat():
    from ..grid import grid_lonlat, tcm_grid

    return grid_lonlat(tcm_grid())
