"""The coast: where it is, which way it faces, and how maritime a cell is.

Step 4 of the Stage 8 order, sections 14 to 16, 55 and 56.

Section 14 warns against treating the whole UK coastline as one identical
boundary, and the UK is the worst possible place to do so. A sea breeze off
the North Sea onto the flat Lincolnshire coast, off the Channel onto the
South Downs, and into a Scottish firth between two ranges of hills are three
different phenomena. What separates them is geometry: which way the coast
faces, how far the sea reaches, and what stands behind it.

THE SIGNED DISTANCE FIELD DOES MOST OF THE WORK
-----------------------------------------------
One field carries almost all the coastal geometry:

    d(x) = +distance to the nearest sea      over land
           -distance to the nearest land     over sea

It is continuous across the coastline, zero on it, and its gradient is a
unit vector pointing from sea towards land. So:

  * `distance_to_coast` is |d|, which section 15 asks for directly.
  * The ONSHORE NORMAL is grad(d), which section 16 asks for -- and getting
    it this way is far more robust on a ragged coast than trying to fit a
    line through a staircase of grid cells. Sea breezes blow along this
    vector.
  * The coastline TANGENT is perpendicular to it.

The land mask on the UKV grid is binary -- a cell is wholly land or wholly
sea -- so the mask itself has no gradient to speak of. The distance field is
what turns that step function back into the continuous quantity the physics
needs: a cell 2 km inland is thoroughly marine whatever its label says.

ISLANDS AND ENCLOSED WATER, WITHOUT A GAZETTEER
-----------------------------------------------
Sections 55 and 56 name specific islands and estuaries. Naming them in code
would be exactly the hard-coded geography section 77 forbids, so both are
found by their shape instead:

  * Islands: connected-component labelling of the land. The two largest
    components are Great Britain and Ireland; everything else is an island,
    with its own area. Man, Wight, Lewis, Orkney and Shetland fall out of
    this with no list anywhere, at areas within a few per cent of survey
    values -- Ireland comes out at 84,028 km2 against a true 84,421.

    ANGLESEY DOES NOT. The Menai Strait is under 500 m wide and the grid is
    2 km, so the mask joins Anglesey to Wales and it is reported as part of
    Great Britain. This is a resolution limit, not a labelling bug, and it
    is the general case: any island separated from its mainland by less than
    a grid cell of water is absorbed into it. The same applies to Skye,
    Sheppey and the Isle of Grain. Section 55 asks for small land masses not
    to be lost to coarse preprocessing, and none are -- but a strait can be.

  * Enclosed water: `marine_exposure`, the fraction of the surrounding disc
    that is sea. Open North Sea is near 1; the Severn, the Thames, the
    Humber and the Firths are low, because they are water with land on three
    sides. This is also the physically relevant quantity -- it governs fetch
    and how much the air over the water has been modified -- which a name
    never is.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .feature import Lineage, Provenance, Quality, SpatialFeature
from .static import PROCESSING_VERSION, Geography
from .terrain import SCALE_MASSIF_M, gradient

log = logging.getLogger(__name__)

#: Radius over which marine exposure is measured, metres. The massif scale,
#: because that is the distance over which an estuary's surrounding land is
#: close enough to control the air over the water -- the Severn is ~15 km
#: wide, the outer Thames ~20 km, the Moray Firth ~30 km.
EXPOSURE_RADIUS_M = SCALE_MASSIF_M

#: How far to trace an over-water trajectory when measuring fetch, metres.
#: 300 km is far enough that a UK coastal air mass reaching this without
#: touching land is fully maritime, and short enough to stay inside the
#: domain from most of the coast.
MAX_FETCH_M = 300_000.0

#: Land components at or below this area are islands rather than mainlands,
#: expressed as a fraction of the largest component. Great Britain and
#: Ireland are the only two land masses in the domain of comparable size;
#: the next largest, Lewis and Harris, is under 2% of Great Britain.
MAINLAND_FRACTION = 0.10


@dataclass(frozen=True, slots=True)
class Coast:
    """Static coastal geometry for one grid."""

    #: Signed distance to the coastline, m. Positive over land.
    signed_distance: np.ndarray
    #: |signed_distance|, m.
    distance_to_coast: np.ndarray
    #: Unit vector from sea towards land -- the ONSHORE direction.
    normal_x: np.ndarray
    normal_y: np.ndarray
    #: Compass bearing of the onshore normal, degrees from north. This is
    #: the direction a sea breeze blows TOWARDS.
    onshore_bearing: np.ndarray
    #: Bearing of the coastline itself, degrees, folded to 0-180 because a
    #: coastline is a line and has no head or tail.
    coastline_bearing: np.ndarray
    #: Fraction of the surrounding disc that is sea, 0-1.
    marine_exposure: np.ndarray
    #: Area of the land component a cell belongs to, km2. 0 over sea.
    landmass_area_km2: np.ndarray
    #: True on land that is not one of the two mainlands.
    is_island: np.ndarray
    #: Label of the land component, for grouping. 0 over sea.
    landmass_id: np.ndarray
    #: For every cell, the (row, col) of the nearest coastline cell. Used to
    #: carry a coastal quantity inland -- see `project_from_coast`.
    nearest_coast: tuple[np.ndarray, np.ndarray]
    geography: Geography

    @property
    def is_coastal(self) -> np.ndarray:
        """Within one cell of the coastline, either side."""
        return self.distance_to_coast <= self.geography.spacing_m * 1.5

    def project_from_coast(self, values: np.ndarray) -> np.ndarray:
        """Carry a value computed at the coast inland (and out to sea).

        Every cell takes the value from its nearest coastline cell. This is
        what makes a coastal quantity usable away from the coast, and it is
        needed more often than it looks: a sea-breeze front 50 km inland is
        governed by the contrast and the wind AT THE COAST it came from, not
        by conditions where it currently is -- and 50 km inland there is no
        sea within the averaging radius to form a contrast with at all.

        Without this the sea-breeze convergence line was computed as being
        50 km inland and then looked for at cells whose own penetration was
        undefined, so it landed nowhere and the field was empty.
        """
        rows, cols = self.nearest_coast
        return values[rows, cols]


def analyse(geo: Geography) -> Coast:
    """Compute the static coastal geometry."""
    from scipy.ndimage import distance_transform_edt, label, uniform_filter

    spacing = geo.spacing_m
    land = geo.is_land

    if not land.any() or land.all():
        # A domain with no coast at all. Everything is still defined; the
        # distances are simply enormous and the normals undefined.
        big = np.full(land.shape, np.inf)
        nan = np.full(land.shape, np.nan)
        return Coast(
            signed_distance=np.where(land, big, -big),
            distance_to_coast=big, normal_x=nan, normal_y=nan,
            onshore_bearing=nan, coastline_bearing=nan,
            marine_exposure=np.where(land, 0.0, 1.0),
            landmass_area_km2=np.zeros(land.shape),
            is_island=np.zeros(land.shape, dtype=bool),
            landmass_id=np.zeros(land.shape, dtype=int),
            nearest_coast=tuple(np.indices(land.shape)),
            geography=geo,
        )

    # Distance from each land cell to the nearest sea, and vice versa. The
    # transform measures to the nearest FALSE cell, so each call is fed the
    # mask of the surface it is measuring within.
    to_sea = distance_transform_edt(land, sampling=spacing)
    to_land = distance_transform_edt(~land, sampling=spacing)
    signed = np.where(land, to_sea, -to_land)
    distance = np.abs(signed)

    # Nearest point ON the coastline for every cell, from a single transform
    # away from the coastal cells themselves. Used to carry coastal
    # quantities inland.
    coastal_seed = _coastline_cells(land)
    _, indices = distance_transform_edt(
        ~coastal_seed, sampling=spacing, return_indices=True
    )
    nearest = (indices[0], indices[1])

    # grad(signed) points from sea to land: onshore.
    dx, dy = gradient(signed, spacing)
    magnitude = np.hypot(dx, dy)
    with np.errstate(invalid="ignore", divide="ignore"):
        nx = np.where(magnitude > 1e-9, dx / magnitude, np.nan)
        ny = np.where(magnitude > 1e-9, dy / magnitude, np.nan)
    onshore = np.degrees(np.arctan2(nx, ny)) % 360.0
    coastline = (onshore + 90.0) % 180.0

    # Marine exposure: the sea fraction of a disc. A box filter would weight
    # the corners of a square, which is 27% further away than the sides and
    # would make exposure depend on the compass orientation of an estuary.
    disc = _disc(EXPOSURE_RADIUS_M, spacing)
    from scipy.ndimage import convolve
    sea_f = (~land).astype("float64")
    exposure = convolve(sea_f, disc, mode="nearest")

    # Islands by connected components. 8-connectivity, so a land mass is not
    # split in two by a diagonal isthmus one cell wide.
    structure = np.ones((3, 3), dtype=bool)
    labels, n = label(land, structure=structure)
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    cell_km2 = (spacing / 1000.0) ** 2
    area_km2 = areas * cell_km2
    largest = float(area_km2.max()) if n else 0.0
    mainland_ids = {
        i for i in range(1, n + 1)
        if area_km2[i] >= MAINLAND_FRACTION * largest
    }
    landmass_area = area_km2[labels]
    is_island = land & ~np.isin(labels, list(mainland_ids) or [0])

    log.info(
        "coastline: %d land masses, %d mainland, largest %.0f km2, "
        "island cells %d",
        n, len(mainland_ids), largest, int(is_island.sum()),
    )
    return Coast(
        signed_distance=signed, distance_to_coast=distance,
        normal_x=nx, normal_y=ny, onshore_bearing=onshore,
        coastline_bearing=coastline, marine_exposure=np.clip(exposure, 0, 1),
        landmass_area_km2=landmass_area, is_island=is_island,
        landmass_id=labels, nearest_coast=nearest, geography=geo,
    )


def _coastline_cells(land: np.ndarray) -> np.ndarray:
    """Land cells that touch the sea: the coastline itself, one cell wide."""
    from scipy.ndimage import binary_erosion

    interior = binary_erosion(land, structure=np.ones((3, 3), dtype=bool),
                              border_value=1)
    return land & ~interior


def _disc(radius_m: float, spacing_m: float) -> np.ndarray:
    """A normalised circular averaging kernel."""
    half = max(1, int(round(radius_m / spacing_m)))
    yy, xx = np.mgrid[-half:half + 1, -half:half + 1]
    disc = (xx * xx + yy * yy) <= half * half
    kernel = disc.astype("float64")
    return kernel / kernel.sum()


def fetch(
    coast: Coast, u: np.ndarray, v: np.ndarray, *,
    max_fetch_m: float = MAX_FETCH_M,
) -> np.ndarray:
    """How far the air at each cell has travelled over water, metres.

    Traces the wind back and stops at the first land cell. This is what
    separates a genuinely maritime air mass from continental air that has
    just crossed the Channel, and it is wind-dependent: the same cell on the
    Kent coast has 20 km of fetch in a southerly and 900 km in a westerly.

    Capped at `max_fetch_m`; a cell whose trajectory reaches the cap without
    touching land returns the cap, meaning "fully maritime" rather than an
    exact distance.
    """
    land = coast.geography.is_land
    spacing = coast.geography.spacing_m
    ny, nx = land.shape

    speed = np.hypot(u, v)
    with np.errstate(invalid="ignore", divide="ignore"):
        ux = np.where(speed > 1e-6, u / speed, 0.0)
        uy = np.where(speed > 1e-6, v / speed, 0.0)

    rows, cols = np.indices(land.shape)
    n_steps = max(1, int(max_fetch_m / spacing))
    out = np.full(land.shape, max_fetch_m, dtype="float64")
    still_over_water = ~land          # a land cell has zero fetch
    out[land] = 0.0

    for step in range(1, n_steps + 1):
        if not still_over_water.any():
            break
        sample_col = np.rint(cols - ux * step).astype(int)
        sample_row = np.rint(rows - uy * step).astype(int)
        outside = (
            (sample_row < 0) | (sample_row >= ny)
            | (sample_col < 0) | (sample_col >= nx)
        )
        hit_land = land[
            np.clip(sample_row, 0, ny - 1), np.clip(sample_col, 0, nx - 1)
        ]
        # Leaving the domain over water is not evidence of land; the
        # trajectory simply cannot be followed further, so the cap stands.
        stopping = still_over_water & hit_land & ~outside
        out[stopping] = step * spacing
        still_over_water = still_over_water & ~stopping & ~outside
    return out


def onshore_component(
    coast: Coast, u: np.ndarray, v: np.ndarray
) -> np.ndarray:
    """Wind component directed onshore, m/s. Negative is offshore.

    The projection of the wind onto the coast normal. This is the quantity
    that decides whether a sea breeze can advance inland or is held at the
    coast, and section 17 is explicit that it matters as much as the
    temperature contrast.
    """
    return u * coast.normal_x + v * coast.normal_y


def alongshore_component(
    coast: Coast, u: np.ndarray, v: np.ndarray
) -> np.ndarray:
    """Wind component parallel to the coastline, m/s.

    Signed with the coast on the right for positive values. Alongshore flow
    neither advances nor opposes a sea breeze but does control coastal
    convergence through the change in friction across the coastline.
    """
    return u * coast.normal_y - v * coast.normal_x


# --------------------------------------------------------------------------
# Presentation
# --------------------------------------------------------------------------

def features(coast: Coast) -> dict[str, SpatialFeature]:
    geo = coast.geography
    binary_note = (
        "the land mask is binary at 2 km, so the coastline is a staircase of "
        "cell edges; the signed distance field is what restores a continuous "
        "coastal geometry from it"
        if geo.mask_is_binary else ""
    )

    def make(name, values, unit, method, *, scale=None, flags=()):
        return SpatialFeature(
            name=name, values=values, unit=unit, quality=Quality.GOOD,
            lineage=Lineage.STATIC,
            provenance=Provenance(
                method=method, inputs=("land_cover",), model=geo.model,
                run=geo.run, scale_m=scale,
                processing_version=PROCESSING_VERSION, notes=binary_note,
            ),
            flags=flags,
        )

    out: dict[str, SpatialFeature] = {}
    out["distance_to_coast"] = make(
        "distance_to_coast", coast.distance_to_coast, "m",
        "euclidean_distance_transform")
    out["signed_distance_to_coast"] = make(
        "signed_distance_to_coast", coast.signed_distance, "m",
        "euclidean_distance_transform",
        flags=("positive over land, negative over sea",))
    out["onshore_bearing"] = make(
        "onshore_bearing", coast.onshore_bearing, "degrees_from_north",
        "gradient_of_signed_distance",
        flags=("the direction a sea breeze blows towards",))
    out["coastline_bearing"] = make(
        "coastline_bearing", coast.coastline_bearing, "degrees_from_north",
        "normal_to_signed_distance_gradient",
        flags=("folded to 0-180: a coastline has no head or tail",))
    out["marine_exposure"] = make(
        "marine_exposure", coast.marine_exposure, "1",
        "sea_fraction_of_surrounding_disc", scale=EXPOSURE_RADIUS_M,
        flags=("1 is open sea, low values are estuaries and enclosed water",))
    out["landmass_area"] = make(
        "landmass_area", coast.landmass_area_km2, "km2",
        "connected_component_labelling",
        flags=("0 over sea",))
    out["is_island"] = make(
        "is_island", coast.is_island.astype("float64"), "1",
        "connected_component_labelling",
        flags=(f"land outside the two components larger than "
               f"{MAINLAND_FRACTION:.0%} of the largest",))
    return out
