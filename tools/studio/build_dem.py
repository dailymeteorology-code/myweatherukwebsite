"""Elevation for the Graphic Studio's temperature map.

Builds a ~250 m height grid over the UK and Ireland from the Copernicus DEM GLO-90 (the 90 m
tiles TCM NOVA already caches from the AWS bucket copernicus-dem-90m; any tile missing is
fetched from there), and a copy smoothed to about the scale the UKV's own orography resolves.
The server's temperature map adds the difference between the two, times the local lapse rate,
to the 2 km temperature analysis, so hilltops and valleys come out at ~250 m.

Output (D:/MyWeatherUK-data/studio by default, or STUDIO_DATA):
  dem-250m.i16      int16 metres, row 0 = north, sea = 0
  dem-250m-ukv.i16  the same smoothed with a 2.5 km Gaussian
  dem-250m.json     the grid: lat/lon of the first cell centre, steps, size

Usage: python build_dem.py [--force]
"""
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
from scipy import ndimage

OUT = Path(os.environ.get('STUDIO_DATA', 'D:/MyWeatherUK-data/studio' if Path('D:/').exists() else Path(__file__).parent / 'data'))
CACHE = Path(os.environ.get('NOVA_CACHE', 'D:/TCM-NOVA/cache')) / 'dem'
BUCKET = 'https://copernicus-dem-90m.s3.amazonaws.com'

LAT_N, LAT_S = 61.0, 49.5
LON_W, LON_E = -11.0, 2.5
DLAT, DLON = 0.0025, 0.004            # ~278 m x ~255 m at 55N
NY = round((LAT_N - LAT_S) / DLAT)
NX = round((LON_E - LON_W) / DLON)
SMOOTH_M = 2500                        # the UKV's effective orography scale


def tile_name(lat, lon):
    return f'Copernicus_DSM_COG_30_{"N" if lat >= 0 else "S"}{abs(lat):02d}_00_{"E" if lon >= 0 else "W"}{abs(lon):03d}_00_DEM'


def tile(lat, lon):
    """A tile's heights (row 0 = north), or None for open sea."""
    path = CACHE / f'{tile_name(lat, lon)}.npy'
    if path.exists():
        return np.load(path, mmap_mode='r') if path.stat().st_size > 128 else None
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(f'{BUCKET}/{tile_name(lat, lon)}/{tile_name(lat, lon)}.tif', timeout=120) as r:
            blob = r.read()
    except Exception:
        np.save(path, np.zeros(0, np.float32))          # no file: a sea tile
        return None
    import tifffile
    a = tifffile.imread(io.BytesIO(blob)).astype(np.float32)
    a[a < -1000] = np.nan
    np.save(path, a)
    return a


def main(force=False):
    OUT.mkdir(parents=True, exist_ok=True)
    if (OUT / 'dem-250m.json').exists() and not force:
        print('already built; --force to rebuild')
        return
    total = np.zeros(NY * NX, np.float64)
    count = np.zeros(NY * NX, np.float64)
    for la in range(int(np.floor(LAT_S)), int(np.ceil(LAT_N))):
        for lo in range(int(np.floor(LON_W)), int(np.ceil(LON_E))):
            a = tile(la, lo)
            if a is None or a.size == 0:
                continue
            h, w = a.shape
            # pixel centres: the tile spans [la, la+1] x [lo, lo+1], row 0 at the north edge
            lats = la + 1 - (np.arange(h) + 0.5) / h
            lons = lo + (np.arange(w) + 0.5) / w
            iy = np.floor((LAT_N - lats) / DLAT).astype(np.int64)
            ix = np.floor((lons - LON_W) / DLON).astype(np.int64)
            oky, okx = (iy >= 0) & (iy < NY), (ix >= 0) & (ix < NX)
            if not oky.any() or not okx.any():
                continue
            sub = np.asarray(a)[oky][:, okx]
            idx = (iy[oky][:, None] * NX + ix[okx][None, :]).ravel()
            v = sub.ravel()
            good = np.isfinite(v)
            total += np.bincount(idx[good], weights=v[good], minlength=NY * NX)
            count += np.bincount(idx[good], minlength=NY * NX)
            print(f'  {tile_name(la, lo)}', flush=True)
    dem = np.where(count > 0, total / np.maximum(count, 1), 0.0).reshape(NY, NX)
    dem = np.clip(dem, -50, 1400)
    mid = np.cos(np.radians(55.0))
    sigma = (SMOOTH_M / (DLAT * 111_320), SMOOTH_M / (DLON * 111_320 * mid))
    ukv = ndimage.gaussian_filter(dem, sigma=sigma, mode='nearest')
    np.rint(dem).astype('<i2').tofile(OUT / 'dem-250m.i16')
    np.rint(ukv).astype('<i2').tofile(OUT / 'dem-250m-ukv.i16')
    meta = {
        'lat0': LAT_N - DLAT / 2, 'lon0': LON_W + DLON / 2, 'dlat': DLAT, 'dlon': DLON, 'nx': NX, 'ny': NY,
        'order': 'row 0 = north', 'units': 'm', 'smooth_m': SMOOTH_M,
        'source': 'Copernicus DEM GLO-90 (AWS copernicus-dem-90m), area means',
        'attribution': '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA',
    }
    (OUT / 'dem-250m.json').write_text(json.dumps(meta, indent=1))
    print(f'built {NX}x{NY}, max {dem.max():.0f} m -> {OUT}')


if __name__ == '__main__':
    main('--force' in sys.argv)
