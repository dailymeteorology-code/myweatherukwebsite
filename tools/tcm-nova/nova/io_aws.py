"""HTTP access to the public AWS buckets, GRIB/NetCDF decoding and byte-range coalescing.

Only AWS buckets are used (never Open-Meteo). Range requests are coalesced: fields
that sit next to each other in a GRIB file are fetched in one request, which matters
because the ECMWF bucket throttles per request, not per byte.
"""
from __future__ import annotations

import collections
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
    # ECMWF's own Google Cloud copy of the same open-data files. The AWS copy throttles the
    # AIFS and ENS objects hard (a 1 MB range measured at 18-46 s on 19 Oct 2026, the same
    # 46 MB in 4 s here), so ECMWF readers try this first and fall back to AWS.
    'ecm_gcs': 'https://storage.googleapis.com/ecmwf-open-data',
    'gfs':  'https://noaa-gfs-bdp-pds.s3.amazonaws.com',
    'gefs': 'https://noaa-gefs-pds.s3.amazonaws.com',
    'radar': 'https://met-office-radar-obs-data.s3.eu-west-2.amazonaws.com',
    'dem':  'https://copernicus-dem-90m.s3.amazonaws.com',
}


def log(*a):
    print('[nova]', *a, file=sys.stderr, flush=True)


# Every HTTP attempt, (start, end, source, outcome, bytes, host): a frame's manifest entry
# summarises its own window of these per model (net_summary), so a slow model shows WHY --
# throttling (429/503), stalls (slow), timeouts, or simply a lot of bytes.
NET = collections.deque(maxlen=400_000)
# Decoder lock use, (asked, got, released) per decode, by lock: how much of a frame the
# GRIB (ecCodes) and NetCDF/HDF5 decoders spent serialised, and how long sources queued.
LOCKS = {'grib': collections.deque(maxlen=200_000), 'netcdf': collections.deque(maxlen=200_000)}
_SOURCES = (('/ifs/0p25/oper/', 'ifs'), ('/ifs/0p25/enfo/', 'ifs_ens'), ('/aifs-single/', 'aifs'),
            ('/aifs-ens/', 'aifs_ens'), ('noaa-gfs-bdp-pds', 'gfs'), ('noaa-gefs-pds', 'gefs'),
            ('/uk-deterministic-2km/', 'ukv'), ('/global-deterministic-10km/', 'mo_global'),
            ('/icon-eu-eps/', 'icon_eps'), ('/icon-d2/', 'icon_d2'), ('/icon-eu/', 'icon_eu'))
#: A byte-range transfer slower than this, once past the grace period, is abandoned and asked
#: again at once: the socket timeout only fires on a connection that goes fully silent, so a
#: stalled or trickling range could hold its whole model for up to 180 s. (Whole-file
#: downloads are left alone.)
MIN_RATE, GRACE_S = 2e6, 20.0


def source_of(url):
    return next((k for pat, k in _SOURCES if pat in url), 'other')


class _Slow(Exception):
    pass


def _read(r, t0):
    """The body, abandoning it if it arrives slower than MIN_RATE after GRACE_S."""
    size = r.headers.get('Content-Length')
    limit = GRACE_S + (int(size) / MIN_RATE if size and size.isdigit() else 300.0)
    parts = []
    while True:
        b = r.read(1 << 20)
        if not b:
            return b''.join(parts)
        parts.append(b)
        if time.time() - t0 > limit:
            raise _Slow(f'{sum(map(len, parts)) / 1e6:.1f} MB in {time.time() - t0:.0f} s')


def get(url, rng=None, tries=8, timeout=180):
    last = None
    src, host = source_of(url), url.split('/')[2]
    for i in range(tries):
        h = dict(UA)
        if rng:
            h['Range'] = f'bytes={rng[0]}-{"" if rng[1] is None else rng[1]}'
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                data = _read(r, t0) if rng else r.read()
                NET.append((t0, time.time(), src, r.status, len(data), host))
                return data
        except urllib.error.HTTPError as e:
            NET.append((t0, time.time(), src, e.code, 0, host))
            last = e
            if e.code in (403, 404):
                raise
            time.sleep(3 * (i + 1) if e.code in (429, 503) else 1.5 * (i + 1))
        except _Slow as e:                          # ask again straight away
            NET.append((t0, time.time(), src, 'slow', 0, host))
            last = e
        except Exception as e:                      # network blips
            NET.append((t0, time.time(), src, 'timeout' if 'timed out' in str(e) else type(e).__name__, 0, host))
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'{url}: {last}')


def net_summary(t_start, t_end, sources=None):
    """Per model, the HTTP attempts that STARTED in [t_start, t_end]: count, MB, slowest
    attempt (s), and the outcomes other than success; plus how many went to the AWS copy of
    ECMWF. Then each decoder lock's busy share of the window and its queueing."""
    out = {}
    for t0, t1, src, outcome, n, host in list(NET):
        if not (t_start <= t0 <= t_end) or (sources is not None and src not in sources):
            continue
        s = out.setdefault(src, {'requests': 0, 'mb': 0.0, 'slowest_s': 0.0})
        s['requests'] += 1
        s['mb'] += n / 1e6
        s['slowest_s'] = max(s['slowest_s'], t1 - t0)
        if outcome not in (200, 206):
            s.setdefault('failed', {})
            s['failed'][str(outcome)] = s['failed'].get(str(outcome), 0) + 1
        if host.startswith('ecmwf-forecasts'):
            s['aws_ecmwf'] = s.get('aws_ecmwf', 0) + 1
    for s in out.values():
        s['mb'], s['slowest_s'] = round(s['mb'], 1), round(s['slowest_s'], 1)
    locks = {}
    span = max(t_end - t_start, 1e-6)
    for name, q in LOCKS.items():
        rows = [r for r in list(q) if t_start <= r[0] <= t_end]
        if rows:
            locks[name] = {'decodes': len(rows), 'busy_frac': round(sum(c - b for _, b, c in rows) / span, 2),
                           'queued_s': round(sum(b - a for a, b, _ in rows), 1),
                           'longest_queue_s': round(max(b - a for a, b, _ in rows), 1)}
    return out, locks


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
    t_ask = time.time()
    with _codes:
        t_got = time.time()
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
    LOCKS['grib'].append((t_ask, t_got, time.time()))
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
