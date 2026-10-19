"""The TCM analysis grid, and honest regridding onto it.

Design decision: the TCM grid IS the UKV native grid -- 455 x 639 at 2 km on
the Met Office Lambert azimuthal equal-area projection. Two consequences,
both deliberate:

  * UKV, the highest-resolution model in the blend, enters the system with no
    resampling at all. `regrid_to_tcm` detects the identity case and returns
    the field untouched, with `regridded` still False.

  * Every coarser model is upsampled onto a mesh finer than it can support.
    That is unavoidable if models are to be combined at all, but it is
    recorded: `FieldMeta.is_upsampled` becomes True, and
    `effective_resolution_m` keeps reporting the coarse value. A 25 km ECMWF
    field living on 2 km cells still reports 25 km.

The grid geometry is READ FROM THE GRIB at ingest, not hardcoded, so that a
change to the Met Office product cannot silently desynchronise us. The
constants below are the expected values, used to validate what we read and as
a fallback for tests that run without a GRIB file.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .crs import UK_LAEA_PROJ
from .meta import FieldMeta, GridSpec
from .params import get as get_param

log = logging.getLogger(__name__)

# Expected UKV "GB and Eire" geometry, confirmed live from the DataHub order
# extent (910,127 m x 1,276,939 m) and the GRIB2 point count (290,745).
TCM_GRID_NAME = "tcm_ukv_laea_2km"
TCM_NX = 455
TCM_NY = 639
TCM_SPACING_M = 2000.0
# Grid origin (lower-left CORNER, not cell centre) in LAEA metres. Read back
# from the UKV GRIB2 itself: the order metadata advertises -576719, but the
# GRIB puts the first grid point at -577000, and the GRIB is authoritative.
# Being 281 m out would misplace every field by an eighth of a cell.
TCM_X0 = -577000.0
TCM_Y0 = -577000.0
TCM_PROJECTION = UK_LAEA_PROJ


def tcm_grid() -> GridSpec:
    return GridSpec(
        name=TCM_GRID_NAME,
        projection=TCM_PROJECTION,
        nx=TCM_NX,
        ny=TCM_NY,
        spacing_m=TCM_SPACING_M,
        x0=TCM_X0,
        y0=TCM_Y0,
        crs_units="m",
    )


def same_geometry(a: GridSpec, b: GridSpec, tol_m: float = 1.0) -> bool:
    """True when two grids are the same mesh, so regridding is a no-op."""
    return (
        a.nx == b.nx
        and a.ny == b.ny
        and abs(a.spacing_m - b.spacing_m) < tol_m
        and abs(a.x0 - b.x0) < tol_m
        and abs(a.y0 - b.y0) < tol_m
        and a.projection == b.projection
    )


@dataclass(frozen=True, slots=True)
class Field:
    """Values plus the provenance that describes them. Never separated."""

    values: np.ndarray
    meta: FieldMeta

    def __post_init__(self) -> None:
        if self.meta.grid is None:
            raise ValueError("a Field must know which grid it is on")
        if self.values.shape != self.meta.grid.shape:
            raise ValueError(
                f"values {self.values.shape} do not match grid "
                f"{self.meta.grid.shape} for {self.meta.model}/"
                f"{self.meta.parameter}"
            )


# --------------------------------------------------------------------------
# Coordinate machinery
# --------------------------------------------------------------------------

def grid_step(g: GridSpec) -> float:
    """The step to use for indexing, in the grid's own units.

    Metres for a projected grid, degrees for a lat/lon grid. `spacing_m` is
    always metres and is therefore the wrong quantity for indexing a lat/lon
    sample grid.
    """
    if g.crs_units == "degrees":
        if g.spacing_deg is None:
            raise ValueError(
                f"grid {g.name} is in degrees but has no spacing_deg"
            )
        return g.spacing_deg
    return g.spacing_m


def grid_coords(g: GridSpec) -> tuple[np.ndarray, np.ndarray]:
    """Cell-centre coordinates (x, y) in the grid's own units."""
    step = grid_step(g)
    x = g.x0 + (np.arange(g.nx) + 0.5) * step
    y = g.y0 + (np.arange(g.ny) + 0.5) * step
    return x, y


def grid_lonlat(g: GridSpec) -> tuple[np.ndarray, np.ndarray]:
    """Longitude/latitude of every cell centre, shape (ny, nx)."""
    from pyproj import Transformer

    x, y = grid_coords(g)
    xx, yy = np.meshgrid(x, y)
    if g.crs_units == "degrees":
        return xx, yy
    tf = Transformer.from_crs(g.projection, "EPSG:4326", always_xy=True)
    lon, lat = tf.transform(xx, yy)
    return lon, lat


def _source_index_of_target(source: GridSpec, target: GridSpec):
    """Fractional (row, col) in `source` for every cell centre of `target`.

    Handles the projected-to-projected and latlon-to-projected cases by going
    through WGS84.
    """
    from pyproj import Transformer

    tx, ty = grid_coords(target)
    txx, tyy = np.meshgrid(tx, ty)

    if target.projection == source.projection:
        sxx, syy = txx, tyy
    else:
        to_wgs = Transformer.from_crs(target.projection, "EPSG:4326",
                                      always_xy=True)
        lon, lat = to_wgs.transform(txx, tyy)
        to_src = Transformer.from_crs("EPSG:4326", source.projection,
                                      always_xy=True)
        sxx, syy = to_src.transform(lon, lat)

    step = grid_step(source)
    col = (sxx - source.x0) / step - 0.5
    row = (syy - source.y0) / step - 0.5
    return row, col


# --------------------------------------------------------------------------
# Regridding
# --------------------------------------------------------------------------

def _interp(values: np.ndarray, row, col, method: str) -> np.ndarray:
    from scipy.ndimage import map_coordinates

    order = {"nearest": 0, "bilinear": 1, "conservative": 1}[method]
    out = map_coordinates(
        np.nan_to_num(values, nan=0.0),
        [row, col],
        order=order,
        mode="constant",
        cval=np.nan,
        prefilter=False,
    )
    # Points that fell outside the source domain must be NaN, not zero --
    # a model has no opinion outside its own domain.
    outside = (
        (row < 0) | (row > values.shape[0] - 1)
        | (col < 0) | (col > values.shape[1] - 1)
    )
    out = np.where(outside, np.nan, out)
    return out


def _conservative_downsample(values, source: GridSpec, target: GridSpec):
    """Area-weighted mean for flux/accumulation fields being coarsened.

    Only valid when the grids share a projection and the ratio is close to an
    integer; otherwise we fall back to bilinear, which is recorded as such.
    """
    ratio = target.spacing_m / source.spacing_m
    if source.projection != target.projection or ratio < 1.5:
        return None
    k = int(round(ratio))
    if abs(ratio - k) > 0.05:
        return None
    ny, nx = values.shape
    cy, cx = (ny // k) * k, (nx // k) * k
    trimmed = values[:cy, :cx]
    blocks = trimmed.reshape(cy // k, k, cx // k, k)
    return np.nanmean(blocks, axis=(1, 3))


def regrid(f: Field, target: GridSpec, method: str | None = None) -> Field:
    """Resample a field onto `target`, recording the step in its lineage.

    Returns the field UNCHANGED (and still not flagged as regridded) when the
    source and target are the same mesh. This is what keeps UKV pristine.
    """
    source = f.meta.grid
    assert source is not None

    if same_geometry(source, target):
        log.debug("regrid no-op: %s already on %s", f.meta.model, target.name)
        return f

    if method is None:
        method = get_param(f.meta.parameter).regrid_method

    if method == "conservative":
        coarsened = _conservative_downsample(f.values, source, target)
        if coarsened is not None and coarsened.shape == target.shape:
            return Field(coarsened, f.meta.regrid_to(target, "conservative"))
        # Not an integer coarsening -- be honest about what we actually did.
        method = "bilinear"

    row, col = _source_index_of_target(source, target)
    values = _interp(f.values, row, col, method)
    meta = f.meta.regrid_to(target, method)

    if meta.is_upsampled:
        log.info(
            "%s/%s upsampled %.0f m -> %.0f m; effective resolution stays %.0f m",
            meta.model, meta.parameter, source.spacing_m, target.spacing_m,
            meta.effective_resolution_m,
        )
    return Field(values, meta)


def regrid_to_tcm(f: Field, method: str | None = None) -> Field:
    return regrid(f, tcm_grid(), method)
