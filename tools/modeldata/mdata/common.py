"""Model Data viewer: the display grid, frame encoding and file locations.

The display grid IS the Met Office UKV grid: Lambert azimuthal equal-area on the WGS84
ellipsoid, centred 54.9 N 2.5 W, 1042 x 970 cells at exactly 2 km. UKV is therefore shown
cell for cell, with no resampling at all. Every other model is put on the same grid by
nearest neighbour, so its own (coarser) cells stay visible as blocks: nothing is
interpolated to look finer than the model really is.

Frames are one byte per cell (0..254 = value, 255 = no data), quantised linearly or on a
square-root scale per variable, with the scale in a small JSON header, then gzip-compressed.
"""
from __future__ import annotations

import gzip
import json
import os
import struct
import sys
import threading
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                                    # tools/modeldata
REPO = ROOT.parents[1]                                # myweatheruk-selfhost
sys.path.insert(0, str(REPO / 'tools' / 'tcm-nova'))  # AWS/GRIB/NetCDF helpers shared with TCM NOVA

_EXT = Path('D:/MyWeatherUK-data/modeldata')
DATA = Path(os.environ.get('MODELDATA_DIR', _EXT if Path('D:/').exists() else REPO / 'server' / 'data' / 'modeldata'))
FRAMES = DATA / 'frames'
STATIC = DATA / 'static'

PROJ = '+proj=laea +lat_0=54.9 +lon_0=-2.5 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs'
NX, NY, DX = 1042, 970, 2000.0
X0 = -1158000.0                                       # centre of the westernmost column
Y_TOP = 902000.0                                      # centre of the northernmost row (row 0 = north)
NC_LOCK = threading.Lock()                            # netCDF4/HDF5 is not thread-safe


def grid_meta():
    return {'proj': PROJ, 'nx': NX, 'ny': NY, 'dx': DX, 'x0': X0, 'y_top': Y_TOP}


_LL = {}


def lonlat():
    """Cell-centre longitude/latitude of the display grid, (NY, NX) float64, row 0 north."""
    if 'll' not in _LL:
        f = STATIC / 'lonlat.npz'
        if f.exists():
            z = np.load(f)
            _LL['ll'] = (z['lon'], z['lat'])
        else:
            from pyproj import Transformer
            tr = Transformer.from_crs(PROJ, 'EPSG:4326', always_xy=True)
            x = X0 + DX * np.arange(NX)
            y = Y_TOP - DX * np.arange(NY)
            xx, yy = np.meshgrid(x, y)
            lon, lat = tr.transform(xx, yy)
            STATIC.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(f, lon=lon, lat=lat)
            _LL['ll'] = (lon, lat)
    return _LL['ll']


def regular_index(lats, lons):
    """Nearest-cell lookup from the display grid into a regular lat/lon grid given by its
    1-D coordinate vectors (any order, longitudes 0..360 or -180..180)."""
    lon, lat = lonlat()
    lats = np.asarray(lats, float)
    lons = np.asarray(lons, float)
    dlat = lats[1] - lats[0]
    dlon = lons[1] - lons[0]
    j = np.rint((lat - lats[0]) / dlat).astype(np.int64)
    lo = np.where(lon < lons[0], lon + 360.0, lon)
    lo = np.where(lo >= lons[0] + 360.0, lo - 360.0, lo)
    i = np.rint((lo - lons[0]) / dlon).astype(np.int64) % lons.size
    ok = (j >= 0) & (j < lats.size)
    return np.clip(j, 0, lats.size - 1), i, ok


def encode(a, enc):
    """float field (NY, NX) -> uint8 per the variable's encoding."""
    lo, hi, kind = enc['lo'], enc['hi'], enc.get('scale', 'lin')
    f = (lambda v: np.sqrt(np.maximum(v, 0))) if kind == 'sqrt' else (lambda v: v)
    flo, fhi = f(np.float64(lo)), f(np.float64(hi))
    with np.errstate(invalid='ignore'):
        q = np.rint((f(np.clip(a, lo, hi)) - flo) / (fhi - flo) * 254.0)
    out = np.where(np.isfinite(a), q, 255).astype(np.uint8)
    return out


def write_frame(path: Path, a, enc, meta):
    path.parent.mkdir(parents=True, exist_ok=True)
    head = json.dumps(dict(meta, nx=NX, ny=NY, lo=enc['lo'], hi=enc['hi'], scale=enc.get('scale', 'lin'))).encode()
    raw = struct.pack('<I', len(head)) + head + encode(a, enc).tobytes()
    tmp = path.with_suffix('.tmp')
    tmp.write_bytes(gzip.compress(raw, 6))
    os.replace(tmp, path)


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':')))
    os.replace(tmp, path)
