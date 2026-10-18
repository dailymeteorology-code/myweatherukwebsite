"""Terrain pipeline: Copernicus DEM GLO-90 (AWS) -> static terrain features on each NOVA grid,
plus the time-dependent terrain–flow diagnostics computed every frame.

Source: Copernicus DEM GLO-90 (DSM, EGM2008 heights in metres, WGS84 geographic, 3"
spacing; 1.5"x3" north of 50°N is NOT the case for GLO-90 — GLO-90 uses 3" latitude and
latitude-dependent longitude spacing, read from the tile). It is a *surface* model
(includes buildings/forest canopy); at 1.5–2 km cell scale the canopy bias (~10–20 m)
is far below the resolved-terrain signal, and it is documented in the provenance.
Licence: Copernicus DEM licence, free incl. commercial use with attribution
"© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under
COPERNICUS by the European Union and ESA; all rights reserved".

Static features are built once per grid and versioned (TERRAIN_VERSION); forecasts
reuse the cached .npz and never re-download the DEM. Four separate representations
are kept, as the design requires:
    h_dyn   smoothed terrain used for flow diagnostics (filtered at 2Δx)
    h_mean  resolved cell-mean terrain (feature inputs, vertical-column surface)
    h_std / slope_sub / h_min / h_max   unresolved sub-grid statistics
    (display terrain is not produced here: maps use their own basemap)
"""
from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import json
import math
from datetime import datetime, timezone

import numpy as np
from pyproj import Transformer
from scipy import ndimage

from .config import CACHE, DATA
from .grid import Grid
from .io_aws import BUCKETS, get, log

TERRAIN_VERSION = 'terrain-1.0.0'
LAT_RANGE = (49, 61)          # tile south edges 49..60
LON_RANGE = (-9, 2)           # tile west edges -9..1
TPI_SCALES_KM = (6, 20, 50)   # neighbourhood, valley/ridge, barrier/regional


def tile_name(lat, lon):
    ns = 'N' if lat >= 0 else 'S'
    ew = 'E' if lon >= 0 else 'W'
    return f'Copernicus_DSM_COG_30_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM'


def fetch_tile(lat, lon):
    path = CACHE / 'dem' / f'{tile_name(lat, lon)}.npy'
    if path.exists():
        return np.load(path, mmap_mode='r') if path.stat().st_size > 128 else None
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        blob = get(f'{BUCKETS["dem"]}/{tile_name(lat, lon)}/{tile_name(lat, lon)}.tif', tries=4)
    except Exception:
        np.save(path, np.zeros(0, np.float32))          # sea tile: no file exists
        return None
    import tifffile
    a = tifffile.imread(io.BytesIO(blob)).astype(np.float32)
    a[a < -1000] = np.nan
    np.save(path, a)
    return a


def accumulate(grid: Grid):
    """Single pass over all tiles: per target cell sums for mean/var/min/max/land/slope."""
    n = grid.nx * grid.ny
    acc = {k: np.zeros(n) for k in ('n', 's', 'ss', 'land', 'slope', 'sx', 'sy')}
    hmin = np.full(n, np.inf)
    hmax = np.full(n, -np.inf)
    tr = Transformer.from_crs('EPSG:4326', grid.crs, always_xy=True)
    tiles = [(la, lo) for la in range(LAT_RANGE[0], LAT_RANGE[1] + 1) for lo in range(LON_RANGE[0], LON_RANGE[1] + 1)]
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda t: fetch_tile(*t), tiles))          # download in parallel, process serially
    used = []
    for la, lo in tiles:
        a = fetch_tile(la, lo)
        if a is None or a.size == 0:
            continue
        used.append(tile_name(la, lo))
        a = np.array(a)
        ny, nx = a.shape
        lat = la + 1 - (np.arange(ny) + 0.5) / ny               # row 0 = north edge
        lon = lo + (np.arange(nx) + 0.5) / nx
        LON, LAT = np.meshgrid(lon, lat)
        X, Y = tr.transform(LON, LAT)
        dy = 111_320.0 / ny
        dx = 111_320.0 * np.cos(np.deg2rad(lat))[:, None] / nx
        h = np.nan_to_num(a, nan=0.0)
        gy, gx = np.gradient(h)
        sx, sy = gx / dx, -gy / dy                              # east, north gradients
        slope = np.hypot(sx, sy)
        ix = np.floor((X - grid.x0) / grid.dx).astype(np.int64)
        iy = np.floor((Y - grid.y0) / grid.dx).astype(np.int64)
        ok = (ix >= 0) & (ix < grid.nx) & (iy >= 0) & (iy < grid.ny)
        idx = (iy * grid.nx + ix)[ok]
        land = np.isfinite(a[ok]) & (a[ok] != 0)          # COP-DEM stores open water as exactly 0 m
        hv = h[ok]
        acc['n'] += np.bincount(idx, minlength=n)
        acc['land'] += np.bincount(idx, land.astype(float), minlength=n)
        acc['s'] += np.bincount(idx, hv, minlength=n)
        acc['ss'] += np.bincount(idx, hv * hv, minlength=n)
        acc['slope'] += np.bincount(idx, slope[ok], minlength=n)
        acc['sx'] += np.bincount(idx, sx[ok], minlength=n)
        acc['sy'] += np.bincount(idx, sy[ok], minlength=n)
        np.minimum.at(hmin, idx, hv)
        np.maximum.at(hmax, idx, hv)
        log(f'terrain {grid.name}: {tile_name(la, lo)}')
    return acc, hmin, hmax, used


def build(grid_name: str, force=False):
    grid = Grid.get(grid_name)
    out = DATA / 'terrain' / f'{grid_name}-{TERRAIN_VERSION}.npz'
    if out.exists() and not force:
        return out
    acc, hmin, hmax, used = accumulate(grid)
    shp = grid.shape
    nn = np.maximum(acc['n'], 1)
    mean = (acc['s'] / nn).reshape(shp)
    var = np.maximum(acc['ss'] / nn - (acc['s'] / nn) ** 2, 0).reshape(shp)
    land = (acc['land'] / nn).reshape(shp)
    covered = acc['n'].reshape(shp) > 0
    mean[~covered] = 0.0                                       # outside tiles = open sea
    land[~covered] = 0.0
    hmin = np.where(np.isfinite(hmin), hmin, 0).reshape(shp)
    hmax = np.where(np.isfinite(hmax), hmax, 0).reshape(shp)
    feats = derive_static(grid, mean.astype(np.float32), np.sqrt(var).astype(np.float32),
                          (acc['slope'] / nn).reshape(shp).astype(np.float32), hmin, hmax, land)
    feats['subgrid_slope_x'] = (acc['sx'] / nn).reshape(shp).astype(np.float32)
    feats['subgrid_slope_y'] = (acc['sy'] / nn).reshape(shp).astype(np.float32)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, **feats)
    prov = {
        'version': TERRAIN_VERSION, 'grid': grid.meta(), 'built_utc': datetime.now(timezone.utc).isoformat(),
        'dataset': 'Copernicus DEM GLO-90 (DGED/COG), s3://copernicus-dem-90m',
        'surface_type': 'DSM (includes canopy/buildings)', 'vertical_datum': 'EGM2008', 'units': 'm',
        'horizontal_crs_source': 'EPSG:4326', 'resampling': 'area-conservative cell statistics of every 90 m sample',
        'h_dyn_filter': 'Gaussian, sigma = 1 grid length (removes 2Δx noise; ridges reduced, not removed)',
        'licence': 'Copernicus DEM licence — free incl. commercial use, attribution required',
        'attribution': '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA',
        'tiles_used': len(used), 'tiles_hash': hashlib.sha1(','.join(used).encode()).hexdigest(),
        'features': sorted(feats),
    }
    out.with_suffix('.json').write_text(json.dumps(prov, indent=1))
    return out


def derive_static(grid, h, hstd, slope_sub, hmin, hmax, land):
    dx = grid.dx
    h_dyn = ndimage.gaussian_filter(h, 1.0)
    gy, gx = np.gradient(h_dyn, dx)                     # grid north/east (BNG)
    slope = np.hypot(gx, gy)
    aspect = (np.degrees(np.arctan2(-gx, -gy)) + 360) % 360      # direction the slope FACES (downhill)
    gyy, _ = np.gradient(gy, dx)
    _, gxx = np.gradient(gx, dx)
    gxy = np.gradient(gx, dx, axis=0)
    p2 = np.maximum(gx ** 2 + gy ** 2, 1e-12)
    prof_curv = -(gxx * gx * gx + 2 * gxy * gx * gy + gyy * gy * gy) / (p2 * (1 + p2) ** 1.5)
    plan_curv = -(gxx * gy * gy - 2 * gxy * gx * gy + gyy * gx * gx) / (p2 ** 1.5)
    plan_curv = np.where(slope > 0.002, plan_curv, 0)
    out = {
        'h_mean': h, 'h_dyn': h_dyn.astype(np.float32), 'h_std': hstd, 'h_min': hmin.astype(np.float32),
        'h_max': hmax.astype(np.float32), 'h_range': (hmax - hmin).astype(np.float32), 'land_frac': land.astype(np.float32),
        'slope': slope.astype(np.float32), 'slope_deg': np.degrees(np.arctan(slope)).astype(np.float32),
        'aspect_deg': aspect.astype(np.float32), 'grad_x': gx.astype(np.float32), 'grad_y': gy.astype(np.float32),
        'curvature': (gxx + gyy).astype(np.float32), 'profile_curvature': prof_curv.astype(np.float32),
        'plan_curvature': plan_curv.astype(np.float32), 'subgrid_slope': slope_sub,
        'ruggedness': _tri(h).astype(np.float32),
    }
    for km in TPI_SCALES_KM:
        r = max(1, int(round(km * 1000 / dx / 2)))
        local = ndimage.uniform_filter(h, 2 * r + 1)
        out[f'tpi_{km}km'] = (h - local).astype(np.float32)
        out[f'local_mean_{km}km'] = local.astype(np.float32)
        out[f'local_max_{km}km'] = ndimage.maximum_filter(h, 2 * r + 1).astype(np.float32)
        out[f'local_min_{km}km'] = ndimage.minimum_filter(h, 2 * r + 1).astype(np.float32)
    # ridge / valley classes (Weiss 2001 style, two scales, threshold = 0.5 sd of TPI)
    t1, t2 = out['tpi_6km'], out['tpi_20km']
    s1, s2 = max(t1.std(), 1), max(t2.std(), 1)
    cls = np.zeros(h.shape, np.int8)                    # 0 flat/open
    cls[(t2 > 0.5 * s2) & (t1 > 0.5 * s1)] = 1          # ridge / summit
    cls[(t2 < -0.5 * s2) & (t1 < -0.5 * s1)] = -1       # valley / basin
    cls[(cls == 0) & (out['slope'] > 0.03)] = 2         # slope
    cls[land < 0.5] = 9                                  # sea
    out['landform_class'] = cls
    high = h > 300
    out['dist_high_terrain_km'] = (ndimage.distance_transform_edt(~high) * dx / 1000).astype(np.float32)
    out['dist_coast_km'] = (ndimage.distance_transform_edt(land >= 0.5) * dx / 1000).astype(np.float32)
    out['dist_ridge_km'] = (ndimage.distance_transform_edt(cls != 1) * dx / 1000).astype(np.float32)
    out['dist_valley_km'] = (ndimage.distance_transform_edt(cls != -1) * dx / 1000).astype(np.float32)
    # roughness length from sub-grid orography (crude effective z0, Wood & Mason 1993 style, capped)
    out['z0_oro'] = np.clip(0.1 * hstd * np.minimum(slope_sub, 0.5), 0.0002, 3.0).astype(np.float32)
    return out


def _tri(h):
    """Terrain ruggedness index (Riley 1999): mean |Δh| to the eight neighbours."""
    p = np.pad(h, 1, mode='edge')
    acc = np.zeros_like(h)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                acc += np.abs(p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx] - h)
    return acc / 8


def load(grid_name: str):
    path = build(grid_name)
    z = np.load(path)
    return {k: z[k] for k in z.files}


# ── dynamic terrain–flow diagnostics (every frame) ──────────────────────────

def flow_diagnostics(T, grid: Grid, u, v, N_bv=None, fetch_km=(5, 10, 20)):
    """u, v: grid-relative low-level wind (m/s), e.g. the 0–1 km mean.  N_bv: Brunt–Väisälä
    frequency (s-1) of the lowest 2 km. Returns flow-dependent terrain diagnostics.

    w_oro = u ∂h/∂x + v ∂h/∂y on the 2Δx-filtered terrain: a terrain-following forced
    ascent estimate at the surface, NOT the model vertical velocity."""
    dx = grid.dx
    spd = np.hypot(u, v)
    gx, gy = T['grad_x'], T['grad_y']
    w_oro = u * gx + v * gy
    gmag = np.maximum(np.hypot(gx, gy), 1e-6)
    upslope = w_oro / gmag                                # wind component up the slope (m/s)
    normal = upslope
    parallel = (u * -gy + v * gx) / gmag
    ux, uy = u / np.maximum(spd, 0.1), v / np.maximum(spd, 0.1)
    h = T['h_dyn']
    upwind = []
    yy, xx = np.indices(h.shape, dtype=np.float32)
    for km in fetch_km:
        d = km * 1000 / dx
        upwind.append(ndimage.map_coordinates(h, [yy - uy * d, xx - ux * d], order=1, mode='nearest'))
    upwind = np.stack(upwind)
    up_max = upwind.max(0)
    gain = h - upwind[-1]                                  # >0: air has climbed to get here
    exposure = np.tanh(gain / 150.0)                       # +1 windward crest, −1 lee
    obstruction = np.maximum(up_max - h, 0)                # higher ground upwind (lee shelter)
    relief = np.maximum(T['local_max_20km'] - T['local_min_20km'], 1.0)
    out = {'w_oro': w_oro.astype(np.float32), 'upslope_wind': upslope.astype(np.float32),
           'downslope_wind': np.maximum(-upslope, 0).astype(np.float32), 'terrain_normal_wind': normal.astype(np.float32),
           'terrain_parallel_wind': parallel.astype(np.float32), 'windward_exposure': exposure.astype(np.float32),
           'upwind_height_max': up_max.astype(np.float32), 'upwind_gain': gain.astype(np.float32),
           'upwind_obstruction': obstruction.astype(np.float32)}
    if N_bv is not None:
        Nb = np.clip(N_bv, 1e-4, 0.05)
        fr = spd / (Nb * relief)
        out['froude'] = fr.astype(np.float32)
        out['blocked'] = (fr < 1.0).astype(np.float32)
        # flow splitting: where blocked, the terrain-normal part is removed (flow goes round)
        ub = np.where(fr < 1, u - (u * gx + v * gy) * gx / gmag ** 2, u)
        vb = np.where(fr < 1, v - (u * gx + v * gy) * gy / gmag ** 2, v)
        dub = np.gradient(ndimage.gaussian_filter(ub, 1.5), dx, axis=1)
        dvb = np.gradient(ndimage.gaussian_filter(vb, 1.5), dx, axis=0)
        out['terrain_convergence'] = (-(dub + dvb)).astype(np.float32)
        # vertical displacement limited by stability: effective lift height ~ U/N (Smith 1979)
        out['w_oro_eff'] = np.where(fr < 1, w_oro * fr, w_oro).astype(np.float32)
    # valley channelling: alignment of wind with the valley axis (perpendicular to the aspect)
    axis = np.deg2rad(T['aspect_deg'] + 90)
    wdir = np.arctan2(u, v)
    align = np.abs(np.cos(wdir - axis))
    out['valley_alignment'] = np.where(T['landform_class'] == -1, align, np.nan).astype(np.float32)
    return out


def slope_insolation(T, zenith_rad, sun_az_rad):
    """cos of solar incidence on the resolved slope (no horizon shading — documented)."""
    s = np.arctan(T['slope'])
    asp = np.deg2rad(T['aspect_deg'])
    ci = np.cos(zenith_rad) * np.cos(s) + np.sin(zenith_rad) * np.sin(s) * np.cos(sun_az_rad - asp)
    return np.clip(ci, 0, 1).astype(np.float32)
