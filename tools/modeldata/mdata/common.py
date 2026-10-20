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


def regular_frac(lats, lons):
    """Fractional (row, col) of every display cell in a regular lat/lon grid, flattened,
    plus whether the grid wraps round the globe in longitude."""
    lon, lat = lonlat()
    lats = np.asarray(lats, float)
    lons = np.asarray(lons, float)
    dlat, dlon = lats[1] - lats[0], lons[1] - lons[0]
    fj = (lat - lats[0]) / dlat
    lo = np.where(lon < lons[0], lon + 360.0, lon)
    lo = np.where(lo >= lons[0] + 360.0, lo - 360.0, lo)
    fi = (lo - lons[0]) / dlon
    wrap = abs(lons.size * dlon - 360.0) < 1.5 * abs(dlon)
    return fj.ravel(), fi.ravel(), wrap


try:
    from numba import njit
except Exception:                                       # numba missing: plain Python is too slow, fall back below
    njit = None

if njit:
    @njit(cache=True, nogil=True)
    def _cubic_kernel(a, fj, fi, wrap):
        ny, nx = a.shape
        out = np.empty(fj.size, np.float32)
        wy = np.empty(4)
        wx = np.empty(4)
        for k in range(fj.size):
            y, x = fj[k], fi[k]
            if not (y >= 0.0 and y <= ny - 1):
                out[k] = np.nan
                continue
            j1 = int(np.floor(y))
            i1 = int(np.floor(x))
            ty, tx = y - j1, x - i1
            for t, w in ((ty, wy), (tx, wx)):          # Catmull-Rom (Keys a = -0.5)
                w[0] = ((-0.5 * t + 1.0) * t - 0.5) * t
                w[1] = (1.5 * t - 2.5) * t * t + 1.0
                w[2] = ((-1.5 * t + 2.0) * t + 0.5) * t
                w[3] = (0.5 * t - 0.5) * t * t
            s = 0.0
            ws = 0.0
            lo = np.inf
            hi = -np.inf
            for dj in range(4):
                jj = min(max(j1 - 1 + dj, 0), ny - 1)
                for di in range(4):
                    ii = i1 - 1 + di
                    if wrap:
                        ii = ii % nx
                    else:
                        ii = min(max(ii, 0), nx - 1)
                    v = a[jj, ii]
                    if v != v:
                        continue
                    w = wy[dj] * wx[di]
                    s += w * v
                    ws += w
                    if 1 <= dj <= 2 and 1 <= di <= 2:
                        lo = min(lo, v)
                        hi = max(hi, v)
            if hi < lo or ws <= 0.0:
                out[k] = np.nan
            else:
                out[k] = min(max(s / ws, lo), hi)    # never outside the four surrounding cells
        return out


def smooth_sample(a, frac):
    """A coarse model's field on the display grid, interpolated smoothly (cubic, clamped so
    it cannot overshoot: no negative rain, no invented peaks). frac = regular_frac(...)."""
    fj, fi, wrap = frac
    a = np.ascontiguousarray(a, np.float64)
    if njit:
        return _cubic_kernel(a, fj, fi, wrap).reshape(NY, NX)
    from scipy import ndimage
    return ndimage.map_coordinates(np.nan_to_num(a), [fj, fi], order=1, mode='grid-wrap' if wrap else 'nearest').astype(np.float32).reshape(NY, NX)


def encode(a, enc):
    """float field (NY, NX) -> uint8 per the variable's encoding."""
    lo, hi, kind = enc['lo'], enc['hi'], enc.get('scale', 'lin')
    f = (lambda v: np.sqrt(np.maximum(v, 0))) if kind == 'sqrt' else (lambda v: v)
    flo, fhi = f(np.float64(lo)), f(np.float64(hi))
    with np.errstate(invalid='ignore'):
        q = np.rint((f(np.clip(a, lo, hi)) - flo) / (fhi - flo) * 254.0)
    out = np.where(np.isfinite(a), q, 255).astype(np.uint8)
    return out


def _replace(tmp, path):
    """os.replace, retried: Windows refuses while another process (the server) has the target open."""
    import time
    for i in range(8):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.15 * (i + 1))
    os.replace(tmp, path)


def read_frame(path: Path):
    """-> (float32 array, header): the inverse of write_frame (to within the encoding step)."""
    raw = gzip.decompress(Path(path).read_bytes())
    n = struct.unpack('<I', raw[:4])[0]
    h = json.loads(raw[4:4 + n])
    q = np.frombuffer(raw, np.uint8, h['nx'] * h['ny'], 4 + n).reshape(h['ny'], h['nx'])
    if h.get('scale') == 'sqrt':
        flo, fhi = np.sqrt(max(h['lo'], 0)), np.sqrt(h['hi'])
        v = (flo + q / 254.0 * (fhi - flo)) ** 2
    else:
        v = h['lo'] + q / 254.0 * (h['hi'] - h['lo'])
    return np.where(q == 255, np.nan, v).astype(np.float32), h


def write_frame(path: Path, a, enc, meta):
    path.parent.mkdir(parents=True, exist_ok=True)
    ny, nx = np.shape(a)
    head = json.dumps(dict(meta, nx=nx, ny=ny, lo=enc['lo'], hi=enc['hi'], scale=enc.get('scale', 'lin'))).encode()
    raw = struct.pack('<I', len(head)) + head + encode(a, enc).tobytes()
    tmp = path.with_suffix('.tmp')
    tmp.write_bytes(gzip.compress(raw, 6))
    _replace(tmp, path)


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':')))
    _replace(tmp, path)
