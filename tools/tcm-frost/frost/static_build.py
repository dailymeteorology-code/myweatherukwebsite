"""Build TCM FROST's ground data on its 2 km grid. Run once, on the PC that has the inputs; the
result is committed beside the package, so a run anywhere (GitHub's servers) needs nothing else.

    python -m frost.static_build

    static/dem2km.npy   int16 (ny, nx): each cell's mean height (m) from the 250 m Copernicus DEM
                        (GLO-90, area means, as the Graphic Studio uses), 0 at sea
    static/cells.npz    the UK and Ireland land cells the model works on:
                          idx    flat index in the grid (row-major, row 0 = north)
                          lat, lon   cell centre
                          z      mean height (m)
                          zmax   highest 250 m pixel in the cell
                          zstd   spread of the 250 m pixels (m)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from pyproj import Transformer

from .config import GRID, PROJ, STATIC

DEM = Path('D:/MyWeatherUK-data/studio')
UKIE = Path('D:/MyWeatherUK-data/modeldata/static/ukie_mask.npy')


def main():
    meta = json.loads((DEM / 'dem-250m.json').read_text())
    dem = np.fromfile(DEM / 'dem-250m.i16', dtype='<i2').reshape(meta['ny'], meta['nx']).astype(np.float32)
    nx, ny = GRID['nx'], GRID['ny']
    tr = Transformer.from_crs('EPSG:4326', PROJ, always_xy=True)
    n = nx * ny
    s1, s2, cnt = np.zeros(n), np.zeros(n), np.zeros(n)
    zmax = np.full(n, -1e9)
    lons = meta['lon0'] + np.arange(meta['nx']) * meta['dlon']
    for r0 in range(0, meta['ny'], 200):                   # in bands, to keep memory down
        rows = np.arange(r0, min(r0 + 200, meta['ny']))
        lat = meta['lat0'] - rows * meta['dlat']
        LON, LAT = np.meshgrid(lons, lat)
        x, y = tr.transform(LON.ravel(), LAT.ravel())
        col = np.rint((x - GRID['x0']) / GRID['dx']).astype(np.int64)
        row = np.rint((GRID['y_top'] - y) / GRID['dx']).astype(np.int64)
        ok = (col >= 0) & (col < nx) & (row >= 0) & (row < ny)
        k = row[ok] * nx + col[ok]
        v = dem[rows[0]:rows[-1] + 1].ravel()[ok]
        v = np.maximum(v, 0)                                   # the sea is 0, never below
        s1 += np.bincount(k, v, minlength=n)
        s2 += np.bincount(k, v * v, minlength=n)
        cnt += np.bincount(k, minlength=n)
        np.maximum.at(zmax, k, v)
    have = cnt > 0
    mean = np.where(have, s1 / np.maximum(cnt, 1), 0.0)
    std = np.where(have, np.sqrt(np.maximum(s2 / np.maximum(cnt, 1) - mean ** 2, 0)), 0.0)
    zmax = np.where(have, zmax, 0.0)
    STATIC.mkdir(parents=True, exist_ok=True)
    np.save(STATIC / 'dem2km.npy', np.rint(mean).astype(np.int16).reshape(ny, nx))

    land = np.load(UKIE).astype(bool).ravel()               # UK, Ireland, Isle of Man, Channel Islands
    idx = np.nonzero(land & have)[0].astype(np.int32)
    cx = GRID['x0'] + (idx % nx) * GRID['dx']
    cy = GRID['y_top'] - (idx // nx) * GRID['dx']
    lon, lat = Transformer.from_crs(PROJ, 'EPSG:4326', always_xy=True).transform(cx, cy)
    np.savez_compressed(STATIC / 'cells.npz', idx=idx, lat=lat.astype(np.float32), lon=lon.astype(np.float32),
                        z=mean[idx].astype(np.float32), zmax=zmax[idx].astype(np.float32), zstd=std[idx].astype(np.float32))
    print(f'dem2km {ny}x{nx}, land cells {idx.size}, highest cell mean {mean[idx].max():.0f} m, '
          f'highest pixel {zmax[idx].max():.0f} m')


if __name__ == '__main__':
    main()
