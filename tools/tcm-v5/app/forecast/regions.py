"""Named regions of the UK and Ireland, for describing where risk sits.

An outlook that says "peak index 61" is useless to a forecaster; one that
says "highest over the south-east" is not. These boxes are deliberately
coarse -- they exist to place a risk area in plain language, not to define
warning areas -- and they overlap where the country does not divide cleanly.

Masks are computed once from the TCM grid and cached, because building them
means projecting 290,745 cell centres to lon/lat.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from ..grid import GridSpec, grid_lonlat, tcm_grid


@dataclass(frozen=True, slots=True)
class Region:
    name: str
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float

    def mask(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        return (
            (lon >= self.lon_min) & (lon <= self.lon_max)
            & (lat >= self.lat_min) & (lat <= self.lat_max)
        )


REGIONS: tuple[Region, ...] = (
    Region("northern Scotland", -8.0, 57.2, 0.0, 61.0),
    Region("southern Scotland", -6.5, 55.0, -1.5, 57.2),
    Region("Northern Ireland", -8.2, 54.0, -5.4, 55.3),
    Region("Ireland", -10.6, 51.4, -5.9, 55.4),
    # Reaches into the Irish Sea to take in the Isle of Man and the
    # Lancashire and Cumbrian coasts, which the original box missed.
    Region("northern England", -4.9, 53.4, 0.0, 55.8),
    Region("Wales", -5.4, 51.3, -2.6, 53.5),
    Region("the Midlands", -3.2, 52.0, 0.5, 53.6),
    Region("eastern England", -0.5, 51.8, 2.0, 53.6),
    Region("south-west England", -6.0, 49.9, -2.4, 51.8),
    Region("south-east England", -1.2, 50.5, 2.0, 52.2),
    # Wessex and the Cotswolds. The boxes are hand-drawn and did NOT tile:
    # south-west England stopped at -2.4 and south-east England began at
    # -1.2, leaving a rectangular hole containing Gloucester, Bath,
    # Salisbury, Southampton, Winchester, Bournemouth and Oxford -- 11.6% of
    # UK and Ireland land in no region at all.
    #
    # That hole was not merely cosmetic. `forecast_area()` is the union of
    # these boxes, and the headline peak, severity, coverage and the
    # highest-risk marker are all computed over it, so a storm over Oxford
    # counted for nothing. It showed up as a grey rectangle in the
    # categorical outlook, which is how it was found.
    Region("central southern England", -2.7, 50.3, -0.8, 52.1),
)


@lru_cache(maxsize=4)
def _lonlat(grid_name: str) -> tuple[np.ndarray, np.ndarray]:
    del grid_name          # only used as the cache key
    return grid_lonlat(tcm_grid())


@lru_cache(maxsize=4)
def region_masks(grid_name: str = "tcm") -> dict[str, np.ndarray]:
    """Region boxes intersected with land, when a land mask exists.

    The boxes are lon/lat rectangles, so "eastern England" reaches 2.0 E and
    "south-east England" reaches 52.2 N -- both take in a wide strip of the
    North Sea and the Channel. Scoring a region over its whole box let
    convection sitting offshore name a land region whose land was quiet,
    which is how the outlook described the wrong parts of the country.

    If no land mask has been built the boxes are used unchanged and
    `masks_are_land_only()` reports False, so the caller can say the areas
    are box-based rather than quietly implying otherwise.
    """
    from .landmask import land_mask

    lon, lat = _lonlat(grid_name)
    land = land_mask()
    masks = {}
    for r in REGIONS:
        box = r.mask(lon, lat)
        if land is not None and land.shape == box.shape:
            box = box & land
        masks[r.name] = box
    return masks


@lru_cache(maxsize=4)
def forecast_area(grid_name: str = "tcm") -> np.ndarray | None:
    """Land inside the NAMED regions: the area this product forecasts for.

    The UKV domain reaches well into northern France, the Low Countries and
    the open Atlantic. Those cells are real land or real sea, but they are
    not "UK and Ireland", and a headline drawn from them describes somewhere
    the product does not claim to cover -- at 2300Z on 2026-08-30 the hottest
    land cell in the domain sat at 49.76N 0.14E, in Normandy.

    None when no land mask has been built, so the caller falls back to the
    whole domain and says so rather than silently narrowing.
    """
    from .landmask import land_mask

    if land_mask() is None:
        return None
    masks = region_masks(grid_name)
    if not masks:
        return None
    out = np.zeros_like(next(iter(masks.values())), dtype=bool)
    for mask in masks.values():
        out |= mask
    return out


def masks_are_land_only() -> bool:
    """Whether region coverage is measured over land or over the raw box."""
    from .landmask import land_mask

    return land_mask() is not None


def peak_by_region(values: np.ndarray) -> dict[str, float]:
    """Maximum of a field within each named region."""
    masks = region_masks()
    out: dict[str, float] = {}
    for name, mask in masks.items():
        if mask.shape != values.shape:
            continue
        cells = values[mask]
        finite = cells[np.isfinite(cells)]
        if finite.size:
            out[name] = float(finite.max())
    return out


def coverage_by_region(
    values: np.ndarray, threshold: float
) -> dict[str, float]:
    """Fraction of each region at or above a threshold."""
    masks = region_masks()
    out: dict[str, float] = {}
    for name, mask in masks.items():
        if mask.shape != values.shape:
            continue
        cells = values[mask]
        finite = cells[np.isfinite(cells)]
        if finite.size:
            out[name] = float((finite >= threshold).mean())
    return out


def regions_above(values: np.ndarray, threshold: float) -> list[str]:
    """Regions with risk above a threshold, most affected first.

    Ordered by COVERAGE, not by each region's maximum. The risk index
    saturates -- on an unstable day every region can peak at exactly the same
    value -- so ranking on the maximum put regions in essentially arbitrary
    order and named the wrong parts of the country. Coverage keeps
    discriminating after the maximum has flattened out.
    """
    coverage = coverage_by_region(values, threshold)
    above = [(n, c) for n, c in coverage.items() if c > 0]
    above.sort(key=lambda item: item[1], reverse=True)
    return [n for n, _ in above]


def describe_areas(names: list[str], limit: int = 3) -> str:
    """Join region names into readable prose."""
    if not names:
        return ""
    shown = names[:limit]
    if len(shown) == 1:
        return shown[0]
    if len(shown) == 2:
        return f"{shown[0]} and {shown[1]}"
    return ", ".join(shown[:-1]) + f" and {shown[-1]}"
