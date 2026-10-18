"""HTTP access to the public AWS buckets, GRIB/NetCDF decoding and byte-range coalescing.

Only AWS buckets are used (never Open-Meteo). Range requests are coalesced: fields
that sit next to each other in a GRIB file are fetched in one request, which matters
because the ECMWF bucket throttles per request, not per byte.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request

import numpy as np

from .config import UA

_codes = threading.Lock()

BUCKETS = {
    'mo':   'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com',
    'ecm':  'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com',
    'gfs':  'https://noaa-gfs-bdp-pds.s3.amazonaws.com',
    'gefs': 'https://noaa-gefs-pds.s3.amazonaws.com',
    'radar': 'https://met-office-radar-obs-data.s3.eu-west-2.amazonaws.com',
    'dem':  'https://copernicus-dem-90m.s3.amazonaws.com',
}


def log(*a):
    print('[nova]', *a, file=sys.stderr, flush=True)


def get(url, rng=None, tries=8, timeout=180):
    last = None
    for i in range(tries):
        h = dict(UA)
        if rng:
            h['Range'] = f'bytes={rng[0]}-{"" if rng[1] is None else rng[1]}'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 404):
                raise
            time.sleep(3 * (i + 1) if e.code in (429, 503) else 1.5 * (i + 1))
        except Exception as e:                      # network blips
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'{url}: {last}')


def exists(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method='HEAD'), timeout=30):
            return True
    except Exception:
        return False


def coalesce(ranges, gap=2_000_000):
    """ranges: list of (start, end_inclusive_or_None, key). Returns list of
    (start, end, [(key, rel_start, rel_end)]) with neighbours merged."""
    rs = sorted(ranges, key=lambda r: r[0])
    out = []
    for a, b, k in rs:
        if out and b is not None and out[-1][1] is not None and a - out[-1][1] <= gap:
            s, e, ks = out[-1]
            out[-1] = (s, max(e, b), ks + [(k, a - s, b - s)])
        else:
            out.append((a, b, [(k, 0, None if b is None else b - a)]))
    return out


def fetch_ranges(url, ranges, gap=2_000_000, workers=6):
    """Fetch many byte ranges of one object with as few requests as possible
    (neighbours coalesced, groups fetched concurrently)."""
    import concurrent.futures as cf
    groups = coalesce(ranges, gap)

    def one(g):
        s, e, parts = g
        blob = get(url, (s, e))
        return {k: (blob[a:] if b is None else blob[a:b + 1]) for k, a, b in parts}
    res = {}
    with cf.ThreadPoolExecutor(max(1, min(workers, len(groups)))) as ex:
        for d in ex.map(one, groups):
            res.update(d)
    return res


def decode_grib(msg):
    """-> (values 2-D array N->S as stored, meta). ecCodes is not thread-safe: serialise."""
    import eccodes
    with _codes:
        h = eccodes.codes_new_from_message(msg)
        try:
            meta = {}
            for k in ('gridType', 'Ni', 'Nj', 'latitudeOfFirstGridPointInDegrees', 'longitudeOfFirstGridPointInDegrees',
                      'latitudeOfLastGridPointInDegrees', 'longitudeOfLastGridPointInDegrees', 'iDirectionIncrementInDegrees',
                      'jDirectionIncrementInDegrees', 'shortName', 'level', 'units', 'number'):
                if eccodes.codes_is_defined(h, k):
                    try:
                        meta[k] = eccodes.codes_get(h, k)
                    except Exception:
                        pass
            vals = eccodes.codes_get_values(h)
            if eccodes.codes_is_defined(h, 'missingValue') and eccodes.codes_get(h, 'bitmapPresent'):
                vals = np.where(vals == eccodes.codes_get(h, 'missingValue'), np.nan, vals)
        finally:
            eccodes.codes_release(h)
    return vals.reshape(meta['Nj'], meta['Ni']).astype(np.float32), meta


def grib_axes(meta):
    lat = np.linspace(meta['latitudeOfFirstGridPointInDegrees'], meta['latitudeOfLastGridPointInDegrees'], meta['Nj'])
    lon0 = meta['longitudeOfFirstGridPointInDegrees']
    lon = lon0 + np.arange(meta['Ni']) * meta['iDirectionIncrementInDegrees']
    return lat, lon


def wgrib_index(text):
    """NCEP .idx -> list of dicts {var, level, desc, start, end}."""
    lines = [l for l in text.splitlines() if l.strip()]
    out = []
    for i, l in enumerate(lines):
        p = l.split(':')
        end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
        out.append({'var': p[3], 'level': p[4], 'desc': p[5] if len(p) > 5 else '', 'start': int(p[1]), 'end': end})
    return out


def ecmwf_index(text):
    return [json.loads(l) for l in text.splitlines() if l.strip()]


def open_nc(blob):
    import netCDF4
    return netCDF4.Dataset('mem', memory=blob)
