"""Target grids and deterministic remapping operators.

Remapping is chosen per variable (see REMAP below and docs/DOWNSCALING.md):
  * continuous state fields (T, q, Z, p)         -> bilinear
  * winds                                        -> bilinear on earth-relative u/v,
                                                    rotated to grid-relative where needed
  * rates/accumulations (precip, lightning)      -> area-conservative when the source
                                                    is finer than the target, bilinear
                                                    (flux-preserving) when it is coarser
  * categorical (land-sea, land cover)           -> nearest / majority
No learned interpolation of any kind.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

import numpy as np
from pyproj import Transformer

from .config import GRIDS


@dataclass(frozen=True)
class Grid:
    name: str
    crs: str
    x0: float
    y0: float
    dx: float
    nx: int
    ny: int

    @classmethod
    def get(cls, name: str) -> 'Grid':
        g = GRIDS[name]
        return cls(name, g['crs'], g['x0'], g['y0'], g['dx'], g['nx'], g['ny'])

    @property
    def shape(self):
        return (self.ny, self.nx)                 # row 0 = south

    @cached_property
    def xy(self):
        x = self.x0 + (np.arange(self.nx) + 0.5) * self.dx
        y = self.y0 + (np.arange(self.ny) + 0.5) * self.dx
        return np.meshgrid(x, y)

    @cached_property
    def lonlat(self):
        tr = Transformer.from_crs(self.crs, 'EPSG:4326', always_xy=True)
        X, Y = self.xy
        lon, lat = tr.transform(X, Y)
        return lon.astype(np.float64), lat.astype(np.float64)

    @cached_property
    def grid_convergence(self):
        """Angle (rad) from true north to grid north; rotates earth winds to grid winds."""
        lon, lat = self.lonlat
        tr = Transformer.from_crs('EPSG:4326', self.crs, always_xy=True)
        x1, y1 = tr.transform(lon, lat + 0.01)
        X, Y = self.xy
        return np.arctan2(x1 - X, y1 - Y)

    def meta(self):
        return {'name': self.name, 'crs': self.crs, 'x0': self.x0, 'y0': self.y0, 'dx_m': self.dx,
                'nx': self.nx, 'ny': self.ny, 'origin': 'lower-left cell corner, row 0 = south',
                'cell_area_km2': (self.dx / 1000) ** 2}


def earth_to_grid_wind(u, v, gamma):
    c, s = np.cos(gamma), np.sin(gamma)
    return u * c - v * s, u * s + v * c


class Bilinear:
    """Bilinear sampler for fractional source indices; wrap_x for global longitudes.
    Points outside the source domain are flagged (`valid`) rather than clamped, so a
    model never 'covers' a cell it does not."""
    def __init__(self, fy, fx, ny, nx, wrap_x=False):
        self.valid = (fy >= 0) & (fy <= ny - 1)
        if not wrap_x:
            self.valid &= (fx >= 0) & (fx <= nx - 1)
        fy = np.clip(fy, 0, ny - 1.000001)
        self.y0 = np.floor(fy).astype(np.int32)
        self.ty = (fy - self.y0).astype(np.float32)
        if wrap_x:
            fx = np.mod(fx, nx)
            self.x0 = np.floor(fx).astype(np.int32) % nx
            self.x1 = (self.x0 + 1) % nx
        else:
            fx = np.clip(fx, 0, nx - 1.000001)
            self.x0 = np.floor(fx).astype(np.int32)
            self.x1 = self.x0 + 1
        self.tx = (fx - np.floor(fx)).astype(np.float32)

    def __call__(self, a):
        a = np.asarray(a)
        if a.ndim == 3:                               # (level, y, x)
            return np.stack([self(k) for k in a])
        y0, y1, x0, x1, ty, tx = self.y0, self.y0 + 1, self.x0, self.x1, self.ty, self.tx
        out = (a[y0, x0] * (1 - tx) + a[y0, x1] * tx) * (1 - ty) + (a[y1, x0] * (1 - tx) + a[y1, x1] * tx) * ty
        out = out.astype(np.float32)
        out[~self.valid] = np.nan
        return out


def regular_sampler(grid: Grid, lat_axis, lon_axis):
    """Sampler from a regular lat/lon source (any orientation, 0..360 or -180..180)."""
    lon, lat = grid.lonlat
    lat_axis = np.asarray(lat_axis, float)
    lon_axis = np.asarray(lon_axis, float)
    dlon = lon_axis[1] - lon_axis[0]
    glob = abs(len(lon_axis) * dlon - 360) < 1
    lons = np.where(lon < lon_axis.min(), lon + 360, lon) if lon_axis.min() >= 0 else lon
    fy = (lat - lat_axis[0]) / (lat_axis[1] - lat_axis[0])
    fx = (lons - lon_axis[0]) / dlon
    return Bilinear(fy, fx, len(lat_axis), len(lon_axis), wrap_x=glob)


def projected_sampler(grid: Grid, crs_def: str, xs, ys):
    lon, lat = grid.lonlat
    tr = Transformer.from_crs('EPSG:4326', crs_def, always_xy=True)
    x, y = tr.transform(lon, lat)
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    return Bilinear((y - ys[0]) / (ys[1] - ys[0]), (x - xs[0]) / (xs[1] - xs[0]), len(ys), len(xs))


def block_mean(a, f):
    """Area-conservative coarsening by an integer factor (NaN-aware)."""
    ny, nx = a.shape[0] // f * f, a.shape[1] // f * f
    b = a[:ny, :nx].reshape(ny // f, f, nx // f, f)
    with np.errstate(invalid='ignore'):
        return np.nanmean(b, axis=(1, 3))


def coarsen_sampler(grid: Grid, crs_def: str, xs, ys):
    """For a source FINER than the target (e.g. 1 km radar onto 2 km): returns a
    function that averages every source cell falling inside each target cell —
    conservative for rates — via index accumulation."""
    tr = Transformer.from_crs(crs_def, grid.crs, always_xy=True)
    XS, YS = np.meshgrid(np.asarray(xs, float), np.asarray(ys, float))
    X, Y = tr.transform(XS, YS)
    ix = np.floor((X - grid.x0) / grid.dx).astype(np.int64)
    iy = np.floor((Y - grid.y0) / grid.dx).astype(np.int64)
    ok = (ix >= 0) & (ix < grid.nx) & (iy >= 0) & (iy < grid.ny)
    flat = (iy * grid.nx + ix)[ok]
    n = grid.nx * grid.ny

    def apply(a):
        a = np.asarray(a, np.float64)[ok]
        good = np.isfinite(a)
        s = np.bincount(flat[good], a[good], minlength=n)
        c = np.bincount(flat[good], minlength=n)
        with np.errstate(invalid='ignore', divide='ignore'):
            out = (s / c).reshape(grid.shape)
        return out.astype(np.float32)
    return apply
