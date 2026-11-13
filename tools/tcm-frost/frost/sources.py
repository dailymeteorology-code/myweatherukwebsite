"""Every model TCM FROST uses, read member by member onto its land cells.

Each source gives, for a run and one of its own steps, arrays of (members, cells):
    tp    precipitation since the run began (mm)
    sf    snowfall since the run began (mm of water), where the model gives it
    fs    the frozen share of what is falling at the step (0-1), where it gives that instead
    t2, td2   screen temperature and dew point (C)
    t850  temperature at 850 hPa (C), where cheap to get
all at the MODEL's own (smoothed) terrain; frost.physics brings them down to the 2 km ground.

The readers are AWS (and ECMWF's Google Cloud copy) only, through the NOVA library's I/O
(nova.io_aws): byte-range GRIB fields from each step's index, the Met Office's NetCDF through
Model Data's readers (mdata.models). Never Open-Meteo.
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import threading
from datetime import timedelta

import numpy as np

os.environ.setdefault('MDATA_GRID', 'uk')           # Model Data's readers put the Met Office fields on our grid

from nova import sources as NS                       # noqa: E402
from nova.io_aws import BUCKETS, decode_grib, exists, fetch_ranges, get, grib_axes, wgrib_index   # noqa: E402

from .config import HORIZON_H, SOURCES              # noqa: E402

K0 = 273.15


class Sampler:
    """Bilinear from a regular lat/lon source onto the cells (either orientation, 0..360 or -180..180)."""

    def __init__(self, lat_axis, lon_axis, lat, lon):
        lat_axis = np.asarray(lat_axis, float)
        lon_axis = np.asarray(lon_axis, float)
        dlon = lon_axis[1] - lon_axis[0]
        glob = abs(len(lon_axis) * dlon - 360) < 1
        lons = np.where(lon < lon_axis.min(), lon + 360, lon) if lon_axis.min() >= 0 else lon
        fy = (lat - lat_axis[0]) / (lat_axis[1] - lat_axis[0])
        fx = (lons - lon_axis[0]) / dlon
        ny, nx = len(lat_axis), len(lon_axis)
        self.i0 = np.clip(np.floor(fy).astype(np.int64), 0, ny - 2)
        self.j0 = np.clip(np.floor(fx).astype(np.int64), 0, nx - 1 if glob else nx - 2)
        self.j1 = (self.j0 + 1) % nx if glob else self.j0 + 1
        self.ty = np.clip(fy - self.i0, 0, 1).astype(np.float32)
        self.tx = np.clip(fx - self.j0, 0, 1).astype(np.float32)

    def __call__(self, a):
        i0, i1, j0, j1, tx, ty = self.i0, self.i0 + 1, self.j0, self.j1, self.tx, self.ty
        return ((a[i0, j0] * (1 - tx) + a[i0, j1] * tx) * (1 - ty) + (a[i1, j0] * (1 - tx) + a[i1, j1] * tx) * ty).astype(np.float32)


class Source:
    key = ''
    members = 1

    def __init__(self, cells):
        self.cells = cells
        self.cfg = SOURCES[self.key]
        self._samplers = {}
        self._lock = threading.Lock()

    def sample(self, meta, a):
        k = (meta['Ni'], meta['Nj'], meta.get('latitudeOfFirstGridPointInDegrees'), meta.get('longitudeOfFirstGridPointInDegrees'))
        with self._lock:
            if k not in self._samplers:
                lat, lon = grib_axes(meta)
                self._samplers[k] = Sampler(lat, lon, self.cells.lat, self.cells.lon)
        return self._samplers[k](a)

    def runs_before(self, cycle, back_h=24, every=6):
        return [cycle - timedelta(hours=h) for h in range(0, back_h + 1, every)]

    def schedule(self, run):
        raise NotImplementedError

    def available(self, run, need_h):
        raise NotImplementedError

    def fetch(self, run, step):
        raise NotImplementedError


# ── ECMWF (IFS, AIFS, and their ensembles), from the Google Cloud copy first ────────────────────
class _Ecm(Source):
    path = stem = ''
    params = ('tp', 'sf', '2t', '2d')

    def __init__(self, cells):
        super().__init__(cells)
        self._host = {}                                # nova's helpers remember which copy answered

    def schedule(self, run):
        long = run.hour in (0, 12)
        if self.key in ('aifs', 'aifs_ens'):
            return list(range(0, HORIZON_H + 25, 6))
        if self.key == 'ifs_ens':
            return list(range(0, 145, 3)) + (list(range(150, HORIZON_H + 25, 6)) if long else [])
        return list(range(0, 145, 3)) + list(range(150, 241, 6)) if long else list(range(0, 91, 3))

    def available(self, run, need_h):
        return NS._ecm_available(self, run, need_h)

    def fetch(self, run, step):
        idx = NS._ecm_index(self, run, step)
        if not idx:
            return None
        want = [(r['_offset'], r['_offset'] + r['_length'] - 1, (r['param'] if r.get('levtype') == 'sfc' else 't850', int(r.get('number', 0))))
                for r in idx
                if (r.get('levtype') == 'sfc' and r.get('param') in self.params)
                or (r.get('levtype') == 'pl' and r.get('param') == 't' and str(r.get('levelist')) == '850')]
        if not want:
            return None
        blobs = fetch_ranges(NS._ecm_base(self, run, step) + '.grib2', want, gap=200_000, workers=16)
        got = {}
        for (p, n), blob in blobs.items():
            a, meta = decode_grib(blob)
            v = self.sample(meta, a)
            if p in ('tp', 'sf'):
                v = v * (1000.0 if str(meta.get('units', 'm')).strip() == 'm' else 1.0)    # IFS: m, AIFS: kg m-2
            else:
                v = v - K0
            got.setdefault(p, {})[n] = v
        if 'tp' not in got:
            return None
        nums = sorted(got['tp'])
        out = {p: np.stack([d[k] for k in nums]) for p, d in got.items() if all(k in d for k in nums)}
        return {'tp': out['tp'], 'sf': out.get('sf'), 'fs': None, 't2': out.get('2t'), 'td2': out.get('2d'), 't850': out.get('t850')}


class IFS(_Ecm):
    key, path, stem = 'ifs', 'ifs/0p25/oper', 'oper-fc'


class AIFS(_Ecm):
    key, path, stem = 'aifs', 'aifs-single/0p25/oper', 'oper-fc'


class IFSEns(_Ecm):
    key, path, stem, members = 'ifs_ens', 'ifs/0p25/enfo', 'enfo-ef', 50


class AIFSEns(_Ecm):
    key, path, stem, members = 'aifs_ens', 'aifs-ens/0p25/enfo', 'enfo-pf', 50


# ── NOAA GFS and GEFS (AWS), precipitation in buckets made into totals ──────────────────────────
def _apcp_records(idx):
    """APCP records of a step as (start h, end h, record)."""
    out = []
    for r in idx:
        if r['var'] != 'APCP' or r['level'] != 'surface':
            continue
        try:
            a, b = r['desc'].split()[0].split('-')
            out.append((int(a), int(b), r))
        except Exception:
            pass
    return out


class _Noaa(Source):
    def __init__(self, cells):
        super().__init__(cells)
        self._cum = {}                                # (run, member) -> {step: precipitation since the run began}

    def total(self, run, m, step, recs):
        """Precipitation since the run began at `step`, from this step's buckets and earlier totals."""
        cum = self._cum.setdefault((run, m), {0: 0.0})
        for a, b, v in sorted(recs, key=lambda x: x[0]):
            if b == step and a in cum:
                cum[step] = cum[a] + v
                return cum[step]
        return None

    def _one(self, run, m, step, url):
        try:
            idx = wgrib_index(get(url + '.idx', tries=4, timeout=60).decode())
        except Exception:
            return None
        want, apcp = [], _apcp_records(idx)
        for a, b, r in apcp:
            want.append((r['start'], r['end'], f'APCP|{a}|{b}'))
        for r in idx:
            k = (r['var'], r['level'])
            if k in self.FIELDS:
                want.append((r['start'], r['end'], self.FIELDS[k]))
        if not apcp and step:
            return None
        got = {}
        for k, blob in fetch_ranges(url, want, gap=400_000, workers=4).items():
            a, meta = decode_grib(blob)
            got[k] = self.sample(meta, a)
        return got

    def fetch(self, run, step):
        with cf.ThreadPoolExecutor(min(8, self.members)) as ex:
            res = list(ex.map(lambda m: self._one(run, m, step, self.url(run, m, step)), self.member_ids()))
        if any(r is None for r in res):
            return None
        tp, fs, t2, td2, t850 = [], [], [], [], []
        for m, got in zip(self.member_ids(), res):
            recs = [(int(k.split('|')[1]), int(k.split('|')[2]), v) for k, v in got.items() if k.startswith('APCP|')]
            tot = np.zeros(self.cells.n, np.float32) if step == 0 else self.total(run, m, step, recs)
            if tot is None:
                return None
            tp.append(tot)
            fs.append(self.frozen(got))
            t2.append(got.get('t2', np.full(self.cells.n, np.nan, np.float32)) - K0)
            td2.append(self.dewpoint(got))
            t850.append(got.get('t850', np.full(self.cells.n, np.nan, np.float32)) - K0)
        return {'tp': np.stack(tp), 'sf': None, 'fs': np.stack(fs), 't2': np.stack(t2), 'td2': np.stack(td2), 't850': np.stack(t850)}


class GFS(_Noaa):
    key = 'gfs'
    FIELDS = {('CPOFP', 'surface'): 'cpofp', ('TMP', '2 m above ground'): 't2', ('DPT', '2 m above ground'): 'td2',
              ('TMP', '850 mb'): 't850'}

    def member_ids(self):
        return [0]

    def url(self, run, m, f):
        return f'{BUCKETS["gfs"]}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{f:03d}'

    def schedule(self, run):
        return list(range(0, HORIZON_H + 25, 3))

    def available(self, run, need_h):
        return exists(self.url(run, 0, int(np.ceil(need_h / 3) * 3)) + '.idx')

    def frozen(self, got):
        c = got.get('cpofp')                           # percent of frozen precipitation (-50: none falling)
        return np.full(self.cells.n, np.nan, np.float32) if c is None else np.where(c >= 0, np.clip(c / 100.0, 0, 1), np.nan).astype(np.float32)

    def dewpoint(self, got):
        d = got.get('td2')
        return np.full(self.cells.n, np.nan, np.float32) if d is None else d - K0


class GEFS(_Noaa):
    key, members = 'gefs', 30
    FIELDS = {('CSNOW', 'surface'): 'csnow', ('CRAIN', 'surface'): 'crain', ('CFRZR', 'surface'): 'cfrzr',
              ('CICEP', 'surface'): 'cicep', ('TMP', '2 m above ground'): 't2', ('RH', '2 m above ground'): 'rh2',
              ('TMP', '850 mb'): 't850'}

    def member_ids(self):
        return list(range(1, self.members + 1))

    def url(self, run, m, f):
        return f'{BUCKETS["gefs"]}/gefs.{run:%Y%m%d}/{run:%H}/atmos/pgrb2ap5/gep{m:02d}.t{run:%H}z.pgrb2a.0p50.f{f:03d}'

    def schedule(self, run):
        return list(range(0, 241, 3)) + list(range(246, HORIZON_H + 25, 6))

    def available(self, run, need_h):
        return exists(self.url(run, 1, int(np.ceil(need_h / 3) * 3)) + '.idx')

    def frozen(self, got):
        s, r = got.get('csnow'), got.get('crain')
        if s is None or r is None:
            return np.full(self.cells.n, np.nan, np.float32)
        any_ = s + r + got.get('cfrzr', 0) + got.get('cicep', 0)
        return np.where(any_ > 0.5, np.clip(s / np.maximum(any_, 1), 0, 1), np.nan).astype(np.float32)

    def dewpoint(self, got):
        t, rh = got.get('t2'), got.get('rh2')
        if t is None or rh is None:
            return np.full(self.cells.n, np.nan, np.float32)
        tc = t - K0
        g = np.log(np.clip(rh, 1, 100) / 100.0) + 17.625 * tc / (243.04 + tc)
        return (243.04 * g / (17.625 - g)).astype(np.float32)


# ── the Met Office (UKV, Global), through Model Data's readers; rates made into totals ──────────
class _MetOffice(Source):
    every = 1

    def __init__(self, cells):
        super().__init__(cells)
        from mdata import models as MD
        self.M = getattr(MD, self.MD)()
        self._steps = {}
        self._rate = {}                               # (run, step) -> (precip, snow) rates

    def runs_before(self, cycle, back_h=24, every=None):
        return [cycle - timedelta(hours=h) for h in range(0, back_h + 1, self.every)]

    def schedule(self, run):
        if run not in self._steps:
            try:
                self._steps[run] = [h for h in self.M.steps(run) if h <= HORIZON_H + 24]
            except Exception:
                self._steps[run] = []
        return self._steps[run]

    def available(self, run, need_h):
        s = self.schedule(run)
        return bool(s) and max(s) >= min(need_h, self.reach)

    def _field(self, run, step, var):
        a = self.M.field(run, step, var, None)
        a = a[0] if isinstance(a, tuple) else a
        return np.asarray(a, np.float32).ravel()[self.cells.idx]

    def fetch(self, run, step):
        try:
            with cf.ThreadPoolExecutor(4) as ex:      # the downloads side by side (decoding is serialised by NC_LOCK)
                pr, sr, t2, td2 = ex.map(lambda v: self._field(run, step, v), ('precip_rate', 'snow_rate', 't2', 'td2'))
        except Exception:
            return None
        self._rate[(run, step)] = (pr, sr)
        steps = [s for s in self.schedule(run) if s < step]
        prev = steps[-1] if steps else None
        cum = self.__dict__.setdefault('_cum', {})
        if prev is None:
            tp, sf = np.zeros_like(pr), np.zeros_like(sr)
        elif (run, prev) in cum and (run, prev) in self._rate:
            p0, s0 = self._rate[(run, prev)]
            dt = step - prev
            tp = cum[(run, prev)][0] + 0.5 * (np.nan_to_num(p0) + np.nan_to_num(pr)) * dt      # trapezoid through the hours
            sf = cum[(run, prev)][1] + 0.5 * (np.nan_to_num(s0) + np.nan_to_num(sr)) * dt
        else:
            return None
        cum[(run, step)] = (tp, sf)
        one = lambda a: a[None, :]                                                             # noqa: E731
        return {'tp': one(tp), 'sf': one(sf), 'fs': None, 't2': one(t2), 'td2': one(td2), 't850': None}


class UKV(_MetOffice):
    key, MD, reach = 'ukv', 'UKV', 54


class MOGlobal(_MetOffice):
    key, MD, reach, every = 'mo_global', 'MOGlobal', 120, 6


READERS = {'ukv': UKV, 'mo_global': MOGlobal, 'ifs': IFS, 'aifs': AIFS, 'gfs': GFS,
           'ifs_ens': IFSEns, 'aifs_ens': AIFSEns, 'gefs': GEFS}
