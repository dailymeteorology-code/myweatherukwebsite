"""Probabilities: every ensemble member, so the page can work out the chance of ANY threshold.

    python -m mdata.ens ecmwf_ens 2026-10-19T12:00Z gust [first_step]

Sources (no Open-Meteo):
    ECMWF ENS   50 members, 0.25 deg   ECMWF open data (Google Cloud copy first, AWS copy as fallback)
    NOAA GEFS   31 members, 0.25 deg   s3://noaa-gefs-pds (pgrb2sp25)

Each member is put (clamped cubic, as the deterministic models) on a 16 km version of the
display grid (every 8th 2 km cell: 131 x 122), which is finer than either ensemble. A frame
stores every member as one byte per cell; the browser counts the members past the user's
threshold, so moving the threshold slider needs no new data.

Fields (one job each, 6-hourly steps to T+240):
    gust, wind (mph) · t2 (C) · precip_6h, precip_24h (mm) · snow_24h (cm, 10:1) ·
    runoff_24h (mm, ECMWF: a flooding signal that knows how wet the ground is) · cape (J/kg) ·
    mslp (hPa) · tcc (%) · vis (km, GEFS) · snowing, frzr (0/1, GEFS categorical)
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import json
import logging
import struct
import sys
import time
import traceback
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA, DX, NX, NY, PROJ, X0, Y_TOP, smooth_sample, write_json
from .models import MPH, _utc
from nova.io_aws import decode_grib, ecmwf_index, exists, fetch_ranges, get   # noqa: E402

C = 8
CNX, CNY = -(-NX // C), -(-NY // C)
ENS_FRAMES = DATA / 'frames' / 'ens'

FIELDS = {
    'gust':       dict(label='Wind gust', unit='mph', lo=0, hi=150),
    'wind':       dict(label='Mean wind (10 m)', unit='mph', lo=0, hi=120),
    't2':         dict(label='Temperature (2 m)', unit='°C', lo=-35, hi=45),
    'precip_6h':  dict(label='Rain/precipitation (6 h)', unit='mm', lo=0, hi=200, scale='sqrt'),
    'precip_24h': dict(label='Rain/precipitation (24 h)', unit='mm', lo=0, hi=300, scale='sqrt'),
    'snow_24h':   dict(label='Snowfall (24 h, approx.)', unit='cm', lo=0, hi=100, scale='sqrt'),
    'snow_depth': dict(label='Snow depth', unit='cm', lo=0, hi=200, scale='sqrt'),
    'runoff_24h': dict(label='Runoff (24 h)', unit='mm', lo=0, hi=200, scale='sqrt'),
    'cape':       dict(label='CAPE (thunderstorm energy)', unit='J/kg', lo=0, hi=5000, scale='sqrt'),
    'mslp':       dict(label='Sea-level pressure', unit='hPa', lo=930, hi=1060),
    'tcc':        dict(label='Cloud cover', unit='%', lo=0, hi=100),
    'vis':        dict(label='Visibility', unit='km', lo=0, hi=60, scale='sqrt'),
    'snowing':    dict(label='Snow falling', unit='', lo=0, hi=1),
    'frzr':       dict(label='Freezing rain', unit='', lo=0, hi=1),
}


_LL = {}


def coarse_lonlat():
    if 'll' not in _LL:
        from pyproj import Transformer
        tr = Transformer.from_crs(PROJ, 'EPSG:4326', always_xy=True)
        x = X0 + DX * (C * np.arange(CNX) + (C - 1) / 2)
        y = Y_TOP - DX * (C * np.arange(CNY) + (C - 1) / 2)
        xx, yy = np.meshgrid(x, y)
        _LL['ll'] = tr.transform(xx, yy)
    return _LL['ll']


def coarse_frac(meta):
    lat1, lon1 = meta['latitudeOfFirstGridPointInDegrees'], meta['longitudeOfFirstGridPointInDegrees']
    dj, di = meta['jDirectionIncrementInDegrees'], meta['iDirectionIncrementInDegrees']
    lat2 = meta['latitudeOfLastGridPointInDegrees']
    dlat = dj if lat2 > lat1 else -dj
    lon, lat = coarse_lonlat()
    fj = (lat - lat1) / dlat
    lo = np.where(lon < lon1, lon + 360.0, lon)
    lo = np.where(lo >= lon1 + 360.0, lo - 360.0, lo)
    fi = (lo - lon1) / di
    return fj.ravel(), fi.ravel(), abs(meta['Ni'] * di - 360.0) < 1.5 * di


def regrid(a, meta, cache):
    key = (meta['Ni'], meta['Nj'], meta['latitudeOfFirstGridPointInDegrees'], meta['longitudeOfFirstGridPointInDegrees'])
    if key not in cache:
        cache[key] = coarse_frac(meta)
    fj, fi, wrap = cache[key]
    import mdata.common as cm
    a = np.ascontiguousarray(np.asarray(a, np.float64).reshape(meta['Nj'], meta['Ni']))
    return cm._cubic_kernel(a, fj, fi, wrap).reshape(CNY, CNX) if cm.njit else \
        smooth_sample(a, (fj, fi, wrap))


# ── ECMWF ENS ───────────────────────────────────────────────────────────────
class ECMWFEns:
    id, label, members = 'ecmwf_ens', 'ECMWF ENS', 50
    hosts = ('https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com')
    PARAMS = {'gust': ['10fg'], 'wind': ['10u', '10v'], 't2': ['2t'], 'precip_6h': ['tp'], 'precip_24h': ['tp'],
              'snow_24h': ['sf'], 'runoff_24h': ['ro'], 'cape': ['mucape'], 'mslp': ['msl'], 'tcc': ['tcc']}
    fields = list(PARAMS)

    def __init__(self):
        self._idx, self._host, self._ll = {}, {}, {}

    def base(self, run, h, host):
        return f'{host}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/enfo/{run:%Y%m%d%H}0000-{h}h-enfo-ef'

    def schedule(self, run):
        return list(range(0, 241, 6)) if run.hour in (0, 12) else list(range(0, 145, 6))

    def _has(self, run, h):
        return any(exists(self.base(run, h, host) + '.index') for host in self.hosts)

    def runs(self, n=3):
        t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        t -= timedelta(hours=t.hour % 6)
        out = []
        for k in range(8):
            r = t - timedelta(hours=6 * k)
            if not self._has(r, 0):
                continue
            sched = self.schedule(r)
            lo, hi = 0, len(sched) - 1
            if not self._has(r, sched[hi]):
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if self._has(r, sched[mid]):
                        lo = mid
                    else:
                        hi = mid - 1
                sched = sched[:lo + 1]
            out.append((r, sched))
            if len(out) >= n:
                break
        return out

    def index(self, run, h):
        k = (run, h)
        if k not in self._idx:
            for host in self.hosts:
                try:
                    txt = get(self.base(run, h, host) + '.index', tries=2, timeout=10).decode()
                    if txt.strip():
                        self._idx[k], self._host[k] = ecmwf_index(txt), host
                        break
                except Exception:
                    continue
            else:
                raise FileNotFoundError(f'ENS T+{h}')
        return self._idx[k]

    def raw(self, run, h, param):
        """(members, CNY, CNX) of one parameter, in GRIB units."""
        idx = self.index(run, h)
        names = param if isinstance(param, tuple) else (param,)          # e.g. 10fg / 10fg3 / 10fg6 by lead time
        have = {r.get('param') for r in idx}
        param = next((n for n in names if n in have), names[0])
        recs = sorted((r for r in idx if r.get('param') == param and r.get('levtype') == 'sfc'), key=lambda r: int(r.get('number', 0)))
        if not recs:
            raise KeyError(f'{param} not at T+{h}')
        want = [(r['_offset'], r['_offset'] + r['_length'] - 1, i) for i, r in enumerate(recs)]
        blobs = fetch_ranges(self.base(run, h, self._host[(run, h)]) + '.grib2', want, gap=0, workers=16)
        out = np.empty((len(recs), CNY, CNX), np.float32)
        for i in range(len(recs)):
            a, meta = decode_grib(blobs[i])
            out[i] = regrid(a, meta, self._ll)
        return out

    def field(self, run, h, f, raw_at):
        P = self.PARAMS[f]
        if f == 'gust':
            if h == 0:
                raise KeyError('no gust at T+0')
            return raw_at(h, ('10fg', '10fg3', '10fg6')) * MPH
        if f == 'wind':
            return np.hypot(raw_at(h, '10u'), raw_at(h, '10v')) * MPH
        if f == 't2':
            return raw_at(h, '2t') - 273.15
        if f == 'mslp':
            return raw_at(h, 'msl') / 100.0
        if f == 'cape':
            return raw_at(h, 'mucape')
        if f == 'tcc':
            a = raw_at(h, 'tcc')
            return a * 100.0 if np.nanmax(a) <= 1.01 else a
        # accumulations (metres since T+0) -> window totals
        win = 6 if f == 'precip_6h' else 24
        if h == 0:
            raise KeyError('no accumulation at T+0')
        a = raw_at(h, P[0])
        b = raw_at(max(0, h - win), P[0]) if h - win > 0 else 0.0
        d = np.maximum(a - b, 0) * 1000.0                 # m -> mm (water equivalent)
        return d                                         # snow: 1 mm water ~ 1 cm of snow (10:1)


# ── ECMWF AIFS ENS (the machine-learned ensemble, 50 members) ────────────────
class AIFSEns(ECMWFEns):
    id, label, members = 'aifs_ens', 'ECMWF AIFS ENS (AI)', 50
    PARAMS = {'wind': ['10u', '10v'], 't2': ['2t'], 'precip_6h': ['tp'], 'precip_24h': ['tp'], 'snow_24h': ['sf'],
              'mslp': ['msl'], 'tcc': ['tcc']}
    fields = list(PARAMS)

    def base(self, run, h, host):
        return f'{host}/{run:%Y%m%d}/{run:%H}z/aifs-ens/0p25/enfo/{run:%Y%m%d%H}0000-{h}h-enfo-pf'

    def schedule(self, run):
        return list(range(0, 361, 6))

    def field(self, run, h, f, raw_at):
        if f in ('precip_6h', 'precip_24h', 'snow_24h'):
            # AIFS writes accumulations in kg m-2, which is already mm (IFS: metres)
            win = 6 if f == 'precip_6h' else 24
            if h == 0:
                raise KeyError('no accumulation at T+0')
            a = raw_at(h, self.PARAMS[f][0])
            b = raw_at(max(0, h - win), self.PARAMS[f][0]) if h - win > 0 else 0.0
            return np.maximum(a - b, 0)
        return super().field(run, h, f, raw_at)


# ── NOAA GEFS ───────────────────────────────────────────────────────────────
class GEFS:
    id, label, members = 'gefs', 'NOAA GEFS', 31
    BUCKET = 'https://noaa-gefs-pds.s3.amazonaws.com'
    REC = {'gust': [('GUST', 'surface')], 'wind': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
           't2': [('TMP', '2 m above ground')], 'precip_6h': [('APCP', 'surface')], 'precip_24h': [('APCP', 'surface')],
           'snow_depth': [('SNOD', 'surface')], 'cape': [('CAPE', 'surface')], 'mslp': [('PRMSL', 'mean sea level')],
           'tcc': [('TCDC', 'entire atmosphere')], 'vis': [('VIS', 'surface')], 'snowing': [('CSNOW', 'surface')],
           'frzr': [('CFRZR', 'surface')]}
    fields = list(REC)

    def __init__(self):
        self._idx, self._ll = {}, {}

    def url(self, run, h, m):
        mem = 'gec00' if m == 0 else f'gep{m:02d}'
        return f'{self.BUCKET}/gefs.{run:%Y%m%d}/{run:%H}/atmos/pgrb2sp25/{mem}.t{run:%H}z.pgrb2s.0p25.f{h:03d}'

    def schedule(self, run):
        return list(range(0, 241, 6))

    def runs(self, n=3):
        t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        t -= timedelta(hours=t.hour % 6)
        out = []
        for k in range(8):
            r = t - timedelta(hours=6 * k)
            if not exists(self.url(r, 0, 30) + '.idx'):
                continue
            sched = self.schedule(r)
            lo, hi = 0, len(sched) - 1
            if not exists(self.url(r, sched[hi], 30) + '.idx'):
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if exists(self.url(r, sched[mid], 30) + '.idx'):
                        lo = mid
                    else:
                        hi = mid - 1
                sched = sched[:lo + 1]
            out.append((r, sched))
            if len(out) >= n:
                break
        return out

    def _recs(self, run, h, m):
        k = (run, h, m)
        if k not in self._idx:
            lines = [l for l in get(self.url(run, h, m) + '.idx', tries=3, timeout=30).decode().splitlines() if l.strip()]
            recs = []
            for i, l in enumerate(lines):
                p = l.split(':')
                end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
                recs.append({'var': p[3], 'level': p[4], 'desc': p[5] if len(p) > 5 else '', 'start': int(p[1]), 'end': end})
            self._idx[k] = recs
        return self._idx[k]

    def raw(self, run, h, key):
        """(members, CNY, CNX) for one record (var, level), all 31 members in parallel."""
        var, level = key

        def one(m):
            recs = self._recs(run, h, m)
            c = [r for r in recs if r['var'] == var and r['level'] == level]
            if not c:
                raise KeyError(f'{var} at T+{h}')
            r = c[-1] if var != 'APCP' else min(c, key=lambda r: _span(r['desc']))   # APCP: the shortest bucket
            blob = get(self.url(run, h, m), (r['start'], r['end']), tries=3, timeout=60)
            a, meta = decode_grib(blob)
            return regrid(a, meta, self._ll), r['desc']
        with cf.ThreadPoolExecutor(16) as ex:
            got = list(ex.map(one, range(self.members)))
        self.last_desc = got[0][1]
        return np.stack([g[0] for g in got])

    def field(self, run, h, f, raw_at):
        R = self.REC[f]
        if f in ('gust', 'wind'):
            if f == 'wind':
                return np.hypot(raw_at(h, R[0]), raw_at(h, R[1])) * MPH
            return raw_at(h, R[0]) * MPH
        if f == 't2':
            return raw_at(h, R[0]) - 273.15
        if f == 'mslp':
            return raw_at(h, R[0]) / 100.0
        if f == 'vis':
            return raw_at(h, R[0]) / 1000.0
        if f == 'snow_depth':
            return raw_at(h, R[0]) * 100.0
        if f in ('precip_6h', 'precip_24h'):
            if h == 0:
                raise KeyError('no accumulation at T+0')
            win = 6 if f == 'precip_6h' else 24
            tot = 0.0
            for hh in range(h, max(0, h - win), -6):        # 6-hourly buckets
                tot = tot + raw_at(hh, R[0])
            return tot
        return raw_at(h, R[0])


def _span(desc):
    try:
        a, b = desc.split(' hour')[0].split('-')
        return int(b) - int(a)
    except Exception:
        return 999


ENSEMBLES = {m.id: m for m in (ECMWFEns(), AIFSEns(), GEFS())}


def encode_members(a, enc):
    from .common import encode
    return np.stack([encode(m, enc) for m in a])


def frame_dir(model, run, f):
    return ENS_FRAMES / model / f'{run:%Y%m%dT%H%MZ}' / f


def main(model, run_s, f, first=None):
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    M = ENSEMBLES[model]
    run = _utc(run_s)
    enc = FIELDS[f]
    steps = M.schedule(run)
    try:
        cat = json.loads((DATA / 'catalog.json').read_text())
        for e in cat.get('ensembles', []):
            if e['id'] == model:
                for r in e['runs']:
                    if _utc(r['run']) == run:
                        steps = r['steps']
    except Exception:
        pass
    d = frame_dir(model, run, f)
    d.mkdir(parents=True, exist_ok=True)
    status = {'model': model, 'run': run.isoformat(), 'var': f, 'steps': steps, 'done': [], 'missing': [], 'state': 'running',
              'members': M.members, 'started': time.time()}
    write_json(d / 'status.json', status)
    cache, lock = {}, __import__('threading').Lock()

    def raw_at(h, p):
        k = (h, p if isinstance(p, str) else tuple(p))
        with lock:
            fut = cache.get(k)
            if fut is None or (fut.done() and fut.exception() is not None):     # a failed fetch is tried again
                fut = cache[k] = pool.submit(M.raw, run, h, p)
        return fut.result()

    order = sorted(steps, key=lambda s: (abs(s - int(first)), s)) if first is not None else steps
    pool = cf.ThreadPoolExecutor(4)                  # fetches (each already 16-way parallel inside)

    def make(h):
        out = d / f'{h}.bin'
        if out.exists():
            return h, 'have'
        try:
            a = M.field(run, h, f, raw_at)
        except Exception as e:
            return h, e
        head = json.dumps({'model': model, 'run': run.isoformat(), 'field': f, 'step': h, 'valid': (run + timedelta(hours=h)).isoformat(),
                           'nx': CNX, 'ny': CNY, 'k': C, 'members': int(a.shape[0]), 'lo': enc['lo'], 'hi': enc['hi'],
                           'scale': enc.get('scale', 'lin')}).encode()
        raw = struct.pack('<I', len(head)) + head + encode_members(a, enc).tobytes()
        tmp = out.with_suffix('.tmp')
        tmp.write_bytes(gzip.compress(raw, 5))
        tmp.replace(out)
        return h, None
    import threading
    slock = threading.Lock()

    def focus():
        # the page writes focus.json when you move the timeline: build around where you are now
        try:
            return int(json.loads((d / 'focus.json').read_text())['step'])
        except Exception:
            return int(first) if first is not None else 0

    def run_batch(lst, workers):
        failed, todo = [], list(lst)

        def worker():
            while True:
                with slock:
                    if not todo:
                        return
                    f0 = focus()
                    h = min(todo, key=lambda s: (abs(s - f0), s))
                    todo.remove(h)
                h, e = make(h)
                with slock:
                    if isinstance(e, KeyError):            # not published for this step (e.g. T+0)
                        status['missing'].append(h)
                    elif isinstance(e, Exception):
                        failed.append(h)
                    else:
                        status['done'].append(h)
                    write_json(d / 'status.json', status)
        ts = [threading.Thread(target=worker) for _ in range(workers)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        return failed

    # the step on screen alone first (all the bandwidth), then the rest, then retries
    failed = run_batch(order[:1], 1) + run_batch(order[1:], 3)
    for attempt in range(2):
        if not failed:
            break
        time.sleep(3 + 5 * attempt)
        failed = run_batch(failed, 2)
    status['missing'] += failed
    pool.shutdown(wait=False)
    status['state'] = 'complete'
    status['seconds'] = round(time.time() - status['started'], 1)
    write_json(d / 'status.json', status)
    print(f'{model} {run:%d %HZ} {f}: {len(status["done"])} frames, {len(status["missing"])} missing, {status["seconds"]} s')


def catalog_entries():
    out = []
    for m in ENSEMBLES.values():
        try:
            runs = m.runs()
        except Exception as e:
            out.append({'id': m.id, 'error': str(e)[:200], 'runs': []})
            continue
        out.append({'id': m.id, 'label': m.label, 'members': m.members, 'fields': m.fields,
                    'runs': [{'run': r.isoformat(), 'steps': s} for r, s in runs]})
    return out


if __name__ == '__main__':
    try:
        main(*sys.argv[1:5])
    except Exception:
        traceback.print_exc()
        sys.exit(1)
