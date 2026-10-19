"""Regional context: geography as an analysis frame, never as a multiplier.

Step 9 of the Stage 8 order, sections 39 to 43, 67 and 77.

Section 77 could not be blunter:

    Never implement Scotland = -10%, Wales = +15%, South East = +5%.

This module is where that temptation lives, so it is built so the
temptation has nowhere to go. THERE IS NO PROBABILITY IN THIS FILE. A region
here carries only:

  * geographic description -- elevation statistics, terrain complexity,
    coastal exposure, computed from the static layer, not asserted
  * a KEY for looking up model skill in the Stage 6 store
  * an aggregation frame for reporting

A region cannot modify a forecast because a region has no number to modify
it with. Where geography genuinely does change the answer, it does so
through the physical features -- upslope flow, distance to coast, land-sea
contrast -- which are computed from the terrain and the wind, and which
differ between Snowdonia and Norfolk without anyone having written either
name down.

`test_spatial.py` asserts this by walking the module's syntax tree for any
arithmetic on a probability, and by checking that no region name appears in
the Stage 5/6/7 packages at all.

WHY REGIONS EXIST AT ALL
------------------------
Two legitimate uses, both from the spec.

Section 39 and 67: NWP skill genuinely varies geographically, because
terrain, coastline and convective climatology vary. Stage 6 already learns
skill by stratification; it needs a stratum to learn against, and "the
Scottish Highlands" is a more useful stratum than a grid index. Stage 8
supplies the label. Stage 6 keeps ownership of the weighting -- section 67
is explicit that this module must not duplicate it, and it does not: nothing
here computes or holds a weight.

Section 40: regional aggregation is how a forecast gets described to a human
at all. That is a reporting concern, and it belongs to Stage 9, not here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .coast import Coast
from .static import Geography
from .terrain import TerrainGeometry

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Region:
    """A named area of the domain. Geography only.

    The bounds are a lon/lat rectangle, which is crude: "eastern England"
    reaches into the North Sea. That is why every region is intersected with
    the LAND MASK before its statistics are computed -- the platform has
    been bitten by exactly this before, when outlook regions ranked by the
    fraction of a BOX above a threshold let an offshore convective area name
    a land region whose land was quiet.
    """

    name: str
    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float
    #: Country or grouping, for coarser stratification when a region has too
    #: few verification cases of its own. This is the parent Stage 6's
    #: hierarchical shrinkage falls back towards.
    parent: str


#: The analysis regions from section 40. Rectangles, deliberately: a
#: precise polygon would imply a precision the use does not need, and every
#: statistic is masked to land anyway.
REGIONS: tuple[Region, ...] = (
    Region("northern_scotland", -8.0, -1.0, 57.0, 61.0, "scotland"),
    Region("southern_scotland", -6.0, -1.5, 54.6, 57.0, "scotland"),
    Region("northern_ireland", -8.2, -5.4, 54.0, 55.4, "ireland"),
    Region("republic_of_ireland", -10.6, -5.9, 51.4, 55.4, "ireland"),
    Region("northern_england", -3.7, 0.0, 53.4, 55.8, "england"),
    Region("wales", -5.4, -2.6, 51.3, 53.5, "wales"),
    # The Midlands stop at the Greenwich meridian and East Anglia starts
    # west of it. The boxes used to overlap between 0.0 and 0.5 E, which put
    # CAMBRIDGE in the Midlands: it sat 0.12 deg inside East Anglia's western
    # edge but well inside the Midlands box, and the deepest-margin rule
    # correctly preferred the box it was further inside. Moving the seam
    # rather than special-casing the tie keeps the rule general.
    #
    # East Anglia's northern edge moves with it, from 53.0 to 53.5, so that
    # shrinking the Midlands does not open a gap over the Wash and the
    # Lincolnshire coast.
    Region("midlands", -3.2, 0.0, 52.0, 53.5, "england"),
    Region("east_anglia", -0.4, 1.8, 51.8, 53.5, "england"),
    Region("south_west_england", -6.5, -2.4, 49.8, 51.7, "england"),
    Region("south_east_england", -1.5, 1.5, 50.5, 52.0, "england"),
)


@dataclass(frozen=True, slots=True)
class RegionContext:
    """What a region IS, geographically. No forecast quantities.

    Every field is measured from the static layer. `skill_key` is the only
    thing that leaves this module for another stage, and it is a string.
    """

    region: str
    parent: str
    n_land_cells: int
    #: Elevation distribution over the region's land, metres.
    elevation_mean: float
    elevation_p90: float
    elevation_max: float
    #: Terrain complexity: the mean local relief at the massif scale, in
    #: metres. A single number that separates Norfolk from Snowdonia
    #: without naming either.
    terrain_complexity_m: float
    #: Median distance from the region's land to the sea, metres. The UK
    #: is small and this is a genuinely discriminating quantity.
    median_distance_to_coast_m: float
    #: Fraction of the region's land within 20 km of the sea.
    coastal_fraction: float
    #: Fraction of the region's cells that are land at all.
    land_fraction: float

    @property
    def skill_key(self) -> str:
        """The stratum Stage 6 should look up skill under.

        A string. Stage 6 owns what it means and what weight comes out of
        it; section 67 gives that stage the responsibility and this one the
        context, and this property is the entire interface between them.
        """
        return f"region:{self.region}"

    def to_dict(self) -> dict:
        return {
            "region": self.region,
            "parent": self.parent,
            "skill_key": self.skill_key,
            "land_cells": self.n_land_cells,
            "land_fraction": round(self.land_fraction, 3),
            "elevation_m": {
                "mean": round(self.elevation_mean, 1),
                "p90": round(self.elevation_p90, 1),
                "max": round(self.elevation_max, 1),
            },
            "terrain_complexity_m": round(self.terrain_complexity_m, 1),
            "median_distance_to_coast_km": round(
                self.median_distance_to_coast_m / 1000.0, 1
            ),
            "coastal_fraction": round(self.coastal_fraction, 3),
        }


def region_masks(
    geo: Geography, lonlat: tuple[np.ndarray, np.ndarray]
) -> dict[str, np.ndarray]:
    """Land cells belonging to each region.

    Intersected with the land mask, always. A lon/lat box over the UK is
    mostly sea in several cases and a region's statistics must describe its
    land.
    """
    lons, lats = lonlat
    land = geo.is_land
    out: dict[str, np.ndarray] = {}
    for region in REGIONS:
        box = (
            (lons >= region.lon_min) & (lons <= region.lon_max)
            & (lats >= region.lat_min) & (lats <= region.lat_max)
        )
        out[region.name] = box & land
    return out


def contexts(
    geo: Geography, geom: TerrainGeometry, coast: Coast,
    lonlat: tuple[np.ndarray, np.ndarray],
) -> dict[str, RegionContext]:
    """Geographic context for every region."""
    masks = region_masks(geo, lonlat)
    relief = geom.local_relief["massif"]
    out: dict[str, RegionContext] = {}

    for region in REGIONS:
        mask = masks[region.name]
        count = int(mask.sum())
        if count == 0:
            log.warning("region %s contains no land cells", region.name)
            out[region.name] = RegionContext(
                region=region.name, parent=region.parent, n_land_cells=0,
                elevation_mean=float("nan"), elevation_p90=float("nan"),
                elevation_max=float("nan"),
                terrain_complexity_m=float("nan"),
                median_distance_to_coast_m=float("nan"),
                coastal_fraction=float("nan"), land_fraction=0.0,
            )
            continue

        elevation = geo.elevation[mask]
        distance = coast.distance_to_coast[mask]
        box = (
            (lonlat[0] >= region.lon_min) & (lonlat[0] <= region.lon_max)
            & (lonlat[1] >= region.lat_min) & (lonlat[1] <= region.lat_max)
        )
        out[region.name] = RegionContext(
            region=region.name, parent=region.parent, n_land_cells=count,
            elevation_mean=float(np.nanmean(elevation)),
            elevation_p90=float(np.nanpercentile(elevation, 90)),
            elevation_max=float(np.nanmax(elevation)),
            terrain_complexity_m=float(np.nanmean(relief[mask])),
            median_distance_to_coast_m=float(np.nanmedian(distance)),
            coastal_fraction=float(np.mean(distance <= 20_000.0)),
            land_fraction=float(mask.sum() / max(int(box.sum()), 1)),
        )
    return out


def region_of(
    lon: float, lat: float
) -> Region | None:
    """The region containing a point, or None outside all of them.

    THE MOST SPECIFIC CONTAINING BOX WINS, not the first one listed.

    Returning the first match looked harmless -- the docstring here used to
    say there was "no meaningful way to break the tie from geometry alone"
    -- and it was not. The boxes overlap substantially, `southern_scotland`
    happens to be declared before `northern_ireland` and `northern_england`,
    and the result was that Belfast, Newcastle, Carlisle and Dumfries were
    all reported as being in southern Scotland. That is not a cosmetic
    labelling problem: `region` is a stratification key for model skill, so
    it pooled Northern Irish and English verification cases into Scotland
    and depleted the pools they belonged to.

    There IS a meaningful geometric tie-break, and it is the ordinary
    most-specific-match rule: prefer the smallest box containing the point,
    since a small box is a more particular claim than a large one. Ties in
    area are broken by whichever box the point sits deepest inside,
    normalised by that box's own dimensions so a large region is not
    penalised for being large.

    Checked against every named production point: Belfast -> northern_ireland,
    Newcastle and Carlisle -> northern_england, Cambridge -> east_anglia.
    """
    candidates = [r for r in REGIONS
                  if r.lon_min <= lon <= r.lon_max
                  and r.lat_min <= lat <= r.lat_max]
    if not candidates:
        return None

    # Where the candidates straddle a national border, geometry from the
    # boxes alone cannot decide, because the boxes themselves are wrong
    # there -- see `_gb_country`. Resolve the country first and keep only
    # the regions belonging to it.
    parents = {r.parent for r in candidates}
    if len(parents) > 1:
        country = _gb_country(lon, lat, parents)
        if country:
            national = [r for r in candidates if r.parent == country]
            if national:
                candidates = national

    # Among the survivors, the point belongs to whichever box it sits
    # deepest inside, normalised by that box's own dimensions so a large
    # region is not penalised for being large. Area is the tie-break.
    def depth(region: Region) -> tuple[float, float]:
        width = region.lon_max - region.lon_min
        height = region.lat_max - region.lat_min
        margin = min(
            (lon - region.lon_min) / width, (region.lon_max - lon) / width,
            (lat - region.lat_min) / height, (region.lat_max - lat) / height,
        )
        return (margin, -(width * height))

    return max(candidates, key=depth)


#: The England-Scotland border, as the line through the Solway Firth and
#: Berwick-upon-Tweed. It runs diagonally across nearly a degree of latitude,
#: which is why `northern_england` reaches into Dumfriesshire and
#: `southern_scotland` reaches down to Newcastle: no lon/lat rectangle can
#: follow it.
_SCOTLAND_BORDER = ((-3.05, 54.98), (-2.03, 55.78))

#: The England-Wales border, as the line through the Severn crossing and the
#: Dee estuary. Same problem, in the other axis.
_WALES_BORDER = ((-2.66, 51.65), (-3.13, 53.25))


def _gb_country(lon: float, lat: float, parents: set[str]) -> str:
    """Which side of a national border a point falls, or "" if not decidable.

    Deliberately narrow: this is consulted ONLY when the containing boxes
    disagree about the country, which is the one case a rectangle cannot
    settle. Everywhere else the boxes are used as declared.

    Checked against Dumfries, Carlisle, Newcastle, Berwick, Edinburgh,
    Cardiff, Bristol, Shrewsbury and Hereford -- the places that sit within
    a few tens of kilometres of one of the two lines.
    """
    if {"scotland", "england"} <= parents:
        (x0, y0), (x1, y1) = _SCOTLAND_BORDER
        boundary = y0 + (lon - x0) * (y1 - y0) / (x1 - x0)
        return "scotland" if lat > boundary else "england"
    if {"wales", "england"} <= parents:
        (x0, y0), (x1, y1) = _WALES_BORDER
        boundary = x0 + (lat - y0) * (x1 - x0) / (y1 - y0)
        return "wales" if lon < boundary else "england"
    return ""


def parent_of(name: str) -> str:
    """The country a region belongs to, or "" if the name is not a region.

    The coarser grouping a sparse region's statistics should fall back to
    before they are pooled nationally.
    """
    for region in REGIONS:
        if region.name == name:
            return region.parent
    return ""


def describe(contexts_by_region: dict[str, RegionContext]) -> dict:
    """The regional layer as a plain structure, for the API and for tests."""
    return {
        "note": (
            "regions are ANALYSIS CONTEXTS and stratification keys. They "
            "carry no probability and no weight, and nothing in this layer "
            "can modify a forecast. Where geography changes the answer it "
            "does so through the physical features -- upslope flow, "
            "distance to coast, land-sea contrast -- not through a name"
        ),
        "regions": [c.to_dict() for c in contexts_by_region.values()],
    }
