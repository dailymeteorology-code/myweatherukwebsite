"""Météo-France's ARPEGE and AROME for the Model Data page (15 Nov 2026, at the user's request).

From Météo-France's open bucket (meteofrance-pnt on OVH: the files meteo.data.gouv.fr publishes,
keyless), in 'packages' of fields: SP1-SP3 at the surface, IP1-IP5 on pressure levels, HP1-HP3 on
heights above the ground.

    arpege  ARPEGE 0.1 degree over Europe, North Africa and the eastern Atlantic (32W-42E, 20-72N),
            hourly to T+102 (shorter from 06Z and 18Z), on the wide grid.
    arome   AROME 0.025 degree (2.5 km) over France, the Low Countries, southern Britain and Ireland
            (12W-16E, 37.5-55.4N), hourly to T+51, on the UK's 2 km grid (empty north of 55.4N).

A package is one long file for 12 hours of steps (ARPEGE) or 6 (AROME), with no index. Each file is
walked once, one small range request per field over a kept-alive connection (about 25 fields a
second), and its index (what each field is, its step and its bytes) is kept on D:; a layer then
fetches only its own fields. A field is keyed as GRIB2 has it: (discipline, category, number, type
of level, level, product template, statistical process); a field over a time (a total, the past
hour's maximum) is valid at the end of that time.
"""
from __future__ import annotations

import http.client
import json
import re
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA, NX, NY, regular_frac, smooth_sample, write_json

HOST = 'meteofrance-pnt.s3.rbx.io.cloud.ovh.net'
IDX = DATA / 'mf_index'
MPH = 2.236936
_tls = threading.local()
_locks, _locks_lock = {}, threading.Lock()


def _http(method, path, headers=None, tries=4):
    """One request on this thread's kept-alive connection (made again after a failure)."""
    last = None
    for k in range(tries):
        c = getattr(_tls, 'c', None)
        if c is None:
            c = _tls.c = http.client.HTTPSConnection(HOST, timeout=90)
        try:
            c.request(method, path, headers=headers or {})
            r = c.getresponse()
            body = r.read()
            if r.status >= 500:
                raise IOError(f'HTTP {r.status} for {path}')
            return r.status, body
        except Exception as e:                              # noqa: BLE001  (a dropped connection: a new one)
            last = e
            try:
                c.close()
            except Exception:                               # noqa: BLE001
                pass
            _tls.c = None
            time.sleep(0.4 * (k + 1))
    raise last


def _range(path, a, b):
    st, body = _http('GET', path, {'Range': f'bytes={a}-{b}'})
    if st not in (200, 206):
        raise FileNotFoundError(f'{path}: HTTP {st}')
    return body


def _list(prefix, folders=False):
    """The keys and sizes under a prefix, or with folders=True the folders just below it."""
    out, token = [], None
    while True:
        q = {'list-type': '2', 'prefix': prefix, 'max-keys': '1000'}
        if folders:
            q['delimiter'] = '/'
        if token:
            q['continuation-token'] = token
        st, body = _http('GET', '/?' + urllib.parse.urlencode(q))
        if st != 200:
            raise IOError(f'listing {prefix}: HTTP {st}')
        x = body.decode('utf-8', 'replace')
        if folders:
            out += re.findall(r'<CommonPrefixes><Prefix>([^<]+)</Prefix></CommonPrefixes>', x)
        else:
            out += [(k, int(s)) for k, s in re.findall(r'<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>', x)]
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', x)
        if '<IsTruncated>true</IsTruncated>' not in x or not m:
            return out
        token = m.group(1)


def _parse(h):
    """A GRIB2 message's head -> [disc, cat, num, level type, level, template, stat, forecast h, span h, length]."""
    total = int.from_bytes(h[8:16], 'big')
    disc, p = h[6], 16
    while p + 5 <= len(h):
        n = int.from_bytes(h[p:p + 4], 'big')
        sec = h[p + 4]
        if sec == 4:
            s = h[p:p + n]
            tpl = int.from_bytes(s[7:9], 'big')
            per = {0: 1 / 60, 1: 1, 2: 24}.get(s[17], 1)    # the forecast time's unit -> hours
            ft = int.from_bytes(s[18:22], 'big') * per
            stat, span = -1, 0
            if tpl == 8 and len(s) >= 53:
                stat = s[46]
                span = int.from_bytes(s[49:53], 'big') * {0: 1 / 60, 1: 1, 2: 24}.get(s[48], 1)
            return [disc, s[9], s[10], s[22], int.from_bytes(s[24:28], 'big'), tpl, stat, ft, span, total]
        if sec >= 5 or n <= 0:
            break
        p += n
    return [disc, -1, -1, -1, -1, -1, -1, -1, 0, total]


def _lock(key):
    with _locks_lock:
        return _locks.setdefault(key, threading.Lock())


def index(path, size):
    """Every field in one file with its bytes: [*key, forecast h, span h, length, offset], walked once
    and kept (a file in the bucket never changes once it is there)."""
    f = IDX / (path.strip('/').replace('/', '__').replace(':', '') + '.json')
    for attempt in (0, 1):
        try:
            d = json.loads(f.read_text())
            if d.get('size') == size:
                return d['msgs']
        except Exception:                                   # noqa: BLE001  (not walked yet)
            pass
        if attempt:
            break
        with _lock(path):
            try:
                d = json.loads(f.read_text())
                if d.get('size') == size:
                    return d['msgs']
            except Exception:                               # noqa: BLE001
                pass
            msgs, off = [], 0
            while off < size:
                h = _range(path, off, min(off + 2047, size - 1))
                if h[:4] != b'GRIB':
                    raise IOError(f'{path}: no GRIB message at byte {off}')
                rec = _parse(h)
                msgs.append(rec + [off])
                off += rec[9]
            IDX.mkdir(parents=True, exist_ok=True)
            write_json(f, {'size': size, 'walked': datetime.now(timezone.utc).isoformat(), 'msgs': msgs})
            return msgs
    raise IOError(f'{path}: no index')


def prune(days=4):
    """Indexes of runs gone from the bucket's window."""
    cut = time.time() - days * 86400
    for f in IDX.glob('*.json') if IDX.exists() else []:
        try:
            if f.stat().st_mtime < cut:
                f.unlink()
        except OSError:
            pass


def _valid(rec):
    """The step a field is valid at: the end of its time for a total, maximum or minimum."""
    return int(round(rec[7] + (rec[8] if rec[5] == 8 else 0)))


# GRIB2 keys of the fields used (disc, cat, num, level type, level, template, stat)
def _k(cat, num, lt=1, lv=0, tpl=0, stat=-1, disc=0):
    return (disc, cat, num, lt, lv, tpl, stat)


T2, RH2, TD2, Q2 = _k(0, 0, 103, 2), _k(1, 1, 103, 2), _k(0, 6, 103, 2), _k(1, 0, 103, 2)
TSKIN, SP, MSLP = _k(0, 0), _k(3, 0), _k(3, 1, 101, 0)
WS10, WD10, U10, V10 = _k(2, 1, 103, 10), _k(2, 0, 103, 10), _k(2, 2, 103, 10), _k(2, 3, 103, 10)
GUST1H = _k(2, 22, 103, 10, 8, 2)
TP, SNOW, RAIN, GRAUPEL, CONV = _k(1, 52, tpl=8, stat=1), _k(1, 66, tpl=8, stat=1), _k(1, 65, tpl=8, stat=1), _k(1, 75, tpl=8, stat=1), _k(1, 37, tpl=8, stat=1)
TCC, LCC, MCC, HCC = _k(6, 1), _k(6, 3), _k(6, 4), _k(6, 5)
CAPE, BLH, PW = _k(7, 6), _k(3, 18), _k(1, 64)
SSRD, STRD = _k(4, 7, tpl=8, stat=1), _k(5, 3, tpl=8, stat=1)
TMAX, TMIN = _k(0, 0, 103, 2, 8, 2), _k(0, 0, 103, 2, 8, 3)
VISMIN, PTYPE = _k(19, 0, tpl=8, stat=3), _k(1, 19, tpl=8, stat=0)
SNOWDEPTH = _k(1, 60)


def _pl(cat, num, hpa):
    return _k(cat, num, 100, hpa * 100)


def _hl(cat, num, m):
    return _k(cat, num, 103, m)


# Météo-France's precipitation type -> the ECMWF codes typed_rate takes. WMO code table 4.201 (graupel
# counted as snow, 'mixed ice' as ice pellets), and Météo-France's own codes above 192: 200 + a code is
# that code's shower form, 193 and 213 rain and snow together. Worked out from ARPEGE's own rain and
# snow on 15 Nov 2026: 201 had no snow at 10 C, 205 was all snow at -3 C, 206 three-quarters snow at
# 0 C, 207 a fifth snow, 193 and 213 half snow at 3-4 C. Anything else counts as rain.
_BASE = {1: 1, 2: 1, 3: 3, 4: 8, 5: 5, 6: 6, 7: 7, 8: 8, 9: 5, 10: 10, 11: 11, 12: 12}
MF_PTYPE = {**_BASE, **{200 + c: e for c, e in _BASE.items()}, 193: 7, 213: 7}
# totals since the start of the run: nothing at T+0
FROM_START = {'precip_total', 'precip_rate', 'snow_total', 'snow_rate', 'rain_total', 'conv_total', 'sw_down', 'lw_down'}


class _MF:
    """What ARPEGE and AROME share: the bucket's runs, its files, their indexes, and the regridding."""
    MODEL, RES, CHUNK, DIGITS = '', '', 12, 3
    SPEC: dict = {}
    variables: list = []
    CYCLES = (0, 6, 12, 18)
    LAST = 102

    def __init__(self):
        self._files, self._geo_key, self._frac, self._off = {}, None, None, None
        self._glock = threading.Lock()

    def schedule(self, run):
        return list(range(0, self.LAST + 1))

    def _pkg_files(self, run, pkg):
        """{(first h, last h): (path, size)} of one package of a run (listed again after 10 minutes
        while the run is still arriving)."""
        key = (run, pkg)
        got = self._files.get(key)
        if got and (got[0] > time.time() - 600 or got[2]):
            return got[1]
        iso = f'{run:%Y-%m-%dT%H:%M:%S}Z'
        files = {}
        for k, size in _list(f'pnt/{iso}/{self.MODEL}/{self.RES}/{pkg}/'):
            m = re.search(rf'__{pkg}__(\d+)H(\d+)H__', k)
            if m:
                files[(int(m.group(1)), int(m.group(2)))] = ('/' + k, size)
        done = bool(files) and max(b for a, b in files) >= self.LAST
        self._files[key] = (time.time(), files, done)
        return files

    def runs(self, n=None):
        """The runs in the bucket, newest first (back 24 hours, or the newest n), each with the steps
        its first surface package has so far."""
        try:
            prune()
        except Exception:                                   # noqa: BLE001
            pass
        out = []
        for f in sorted(_list('pnt/', folders=True), reverse=True):
            try:
                run = datetime.strptime(f[4:-1], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if run.hour not in self.CYCLES:
                continue
            if out and (len(out) >= n if n else (out[0][0] - run) > timedelta(hours=24)):
                break
            files = self._pkg_files(run, 'SP1')
            if not files:
                continue
            last = max(b for a, b in files)
            out.append((run, [h for h in self.schedule(run) if h <= last]))
        return out

    def _msg(self, run, pkg, key, h):
        """(path, offset, length) of one field at step h."""
        for (a, b), (path, size) in self._pkg_files(run, pkg).items():
            if a <= h <= b or (a == 0 and h == 0):
                for rec in index(path, size):
                    if tuple(rec[:7]) == key and _valid(rec) == h:
                        return path, rec[10], rec[9]
                break
        raise KeyError(f'{self.MODEL} {pkg} has no {key} at T+{h}')

    def _get(self, run, pkg, key, h):
        from nova.io_aws import decode_grib
        path, off, n = self._msg(run, pkg, key, h)
        a, meta = decode_grib(_range(path, off, off + n - 1))
        return a, meta

    def _geo(self, meta):
        k = (meta['Ni'], meta['Nj'], meta['latitudeOfFirstGridPointInDegrees'], meta['longitudeOfFirstGridPointInDegrees'])
        with self._glock:
            if self._geo_key != k:
                lat1, lat2 = meta['latitudeOfFirstGridPointInDegrees'], meta['latitudeOfLastGridPointInDegrees']
                d_lat = meta['jDirectionIncrementInDegrees'] * (1 if lat2 > lat1 else -1)
                lats = lat1 + d_lat * np.arange(meta['Nj'])
                lon1 = meta['longitudeOfFirstGridPointInDegrees']
                lon1 = lon1 - 360.0 if lon1 > 180 else lon1
                lons = lon1 + meta['iDirectionIncrementInDegrees'] * np.arange(meta['Ni'])
                fj, fi, _ = regular_frac(lats, lons)
                self._off = ((fi < 0) | (fi > meta['Ni'] - 1) | (fj < 0) | (fj > meta['Nj'] - 1)).reshape(NY, NX)
                self._frac = (fj, fi, False)                 # a regional grid: never round the globe
                self._geo_key = k
            return self._frac, self._off

    def _disp(self, a, meta, nearest=False):
        frac, off = self._geo(meta)
        if nearest:
            fj, fi, _ = frac
            j = np.clip(np.rint(fj).astype(np.int64), 0, a.shape[0] - 1)
            i = np.clip(np.rint(fi).astype(np.int64), 0, a.shape[1] - 1)
            out = np.asarray(a, np.float32)[j, i].reshape(NY, NX)
        else:
            a = np.asarray(a, np.float32)
            ok = np.isfinite(a)
            if ok.all():
                out = smooth_sample(a, frac).astype(np.float32)
            else:                                          # AROME's corners outside its area: the nearest
                out = smooth_sample(a[self._fill_index(ok)], frac).astype(np.float32)   # value, not nought, beside them
                out[smooth_sample(ok.astype(np.float32), frac) < 0.5] = np.nan
        out = np.array(out, np.float32)
        out[off] = np.nan
        return out

    def _fill_index(self, ok):
        """For each cell, the nearest cell with a value (cached: a model's gaps are the same every time)."""
        k = (ok.shape, int(ok.sum()))
        if getattr(self, '_fill_key', None) != k:
            from scipy import ndimage
            self._fill = tuple(ndimage.distance_transform_edt(~ok, return_distances=False, return_indices=True))
            self._fill_key = k
        return self._fill

    def _read(self, run, h, pkg, key, nearest=False):
        a, meta = self._get(run, pkg, key, h)
        return self._disp(a, meta, nearest)

    def _zeros(self, run):
        """The analysis' totals: nought everywhere the model covers (its grid from any field at T+1)."""
        off = self._off
        if off is None:
            a, meta = self._get(run, 'SP1', TP, 1)
            _, off = self._geo(meta)
        return np.where(off, np.nan, 0).astype(np.float32)

    def _rate(self, run, h):
        """Precipitation over the past hour (mm/h), from the run's running total."""
        now = self._read(run, h, 'SP1', TP)
        before = self._zeros(run) if h == 1 else self._read(run, h - 1, 'SP1', TP)
        return np.maximum(now - before, 0)

    def _share_type(self, run, h, frozen_keys):
        """A type from the model's own frozen share of the past hour's precipitation: seven-tenths or
        more snow (ARPEGE's 'wet snow' is 0.7-0.8 snow), from 0.15 sleet, less rain."""
        from .derived import typed_rate
        rate = self._rate(run, h)
        frozen = 0.0
        for key in frozen_keys:
            now = self._read(run, h, 'SP1', key)
            before = self._zeros(run) if h == 1 else self._read(run, h - 1, 'SP1', key)
            frozen = frozen + np.maximum(now - before, 0)
        with np.errstate(invalid='ignore', divide='ignore'):
            share = np.clip(frozen / np.where(rate > 0, rate, np.nan), 0, 1)
        code = np.where(share >= 0.7, 5, np.where(share >= 0.15, 7, 1))
        return typed_rate(rate, np.where(rate >= 0.05, code, 0))

    def field(self, run, h, var, prev_h, prev_raw=None):
        if h == 0 and var in FROM_START:
            return self._zeros(run)
        if var == 'ptype':
            return self._ptype(run, h)
        spec = self.SPEC[var]
        A = [self._read(run, h, pkg, key) for pkg, key in spec[:-1]]
        return spec[-1](*A)


C = lambda a: a - 273.15                                    # noqa: E731
PCT = lambda a: np.clip(a * (100.0 if np.nanmax(a) <= 1.5 else 1.0), 0, 100)   # noqa: E731
SPEED = lambda a: a * MPH                                   # noqa: E731
SAME = lambda a: a                                          # noqa: E731
HPA = lambda a: a / 100.0                                   # noqa: E731
DAM = lambda a: a / 98.0665                                 # noqa: E731
POS = lambda a: np.maximum(a, 0)                            # noqa: E731
SPEED2 = lambda u, v: np.hypot(u, v) * MPH                  # noqa: E731
WDIR = lambda u, v: ((np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0).astype(np.float32)   # noqa: E731  (where it blows from)


def _common_surface(gusts_hourly=True):
    """The surface fields both models have, in the same packages."""
    return {
        't2': [('SP1', T2), C], 'rh2': [('SP1', RH2), PCT], 'td2': [('SP2', TD2), C], 'q2': [('SP2', Q2), lambda a: a * 1000.0],
        'tskin': [('SP2', TSKIN), C],
        'wind10': [('SP1', WS10), SPEED], 'gust_max': [('SP1', GUST1H), SPEED],
        'wdir10': [('SP1', U10), ('SP1', V10), WDIR],     # from u and v: degrees cannot be interpolated across north
        'mslp': [('SP1', MSLP), HPA], 'sp': [('SP2', SP), HPA],
        'precip_total': [('SP1', TP), POS], 'precip_rate': [('SP1', TP), POS],
        'snow_total': [('SP1', SNOW), POS], 'snow_rate': [('SP1', SNOW), POS],
        'tcc': [('SP1', TCC), PCT], 'lcc': [('SP2', LCC), PCT], 'mcc': [('SP2', MCC), PCT], 'hcc': [('SP2', HCC), PCT],
        'cape_mu': [('SP2', CAPE), POS], 'hpbl': [('SP2', BLH), POS],
        'sw_down': [('SP1', SSRD), SAME],
    }


class ARPEGE(_MF):
    id, label, res_km = 'arpege', 'Météo-France ARPEGE (Europe)', 11.0
    MODEL, RES, CHUNK, DIGITS = 'arpege', '01', 12, 3
    LAST = 102
    SPEC = {
        **_common_surface(),
        'rain_total': [('SP1', RAIN), POS], 'conv_total': [('SP1', CONV), POS],
        'pw': [('SP2', PW), POS], 'lw_down': [('SP2', STRD), SAME],
        't2max3': [('SP2', TMAX), C], 't2min3': [('SP2', TMIN), C],
        'vis': [('SP2', VISMIN), lambda a: a / 1000.0],
        **{f't{p}': [('IP1', _pl(0, 0, p)), C] for p in (925, 850, 700, 500, 300)},
        **{f'rh{p}': [('IP1', _pl(1, 1, p)), PCT] for p in (925, 850, 700, 500)},
        **{f'z{p}': [('IP1', _pl(3, 4, p)), DAM] for p in (850, 500)},
        'thick': [('IP1', _pl(3, 4, 500)), ('IP1', _pl(3, 4, 1000)), lambda a, b: (a - b) / 98.0665],
        **{f'wind{p}': [('IP2', _pl(2, 1, p)), SPEED] for p in (925, 850, 700, 500, 300, 250, 200)},
        'td850': [('IP2', _pl(0, 6, 850)), C],
        **{f'w{p}': [('IP2', _pl(2, 8, p)), SAME] for p in (700, 500)},
        **{f'cloud{p}': [('IP3', _pl(6, 32, p)), PCT] for p in (850, 700, 500, 300)},
        'vort500': [('IP4', _pl(2, 12, 500)), lambda a: a * 1e5],
        'wbpt850': [('IP4', _pl(0, 3, 850)), C],
    }
    variables = ['precip_rate', 'precip_total', 'ptype', 'rain_total', 'conv_total', 'snow_rate', 'snow_total', 'snow_acc',
                 't2', 't2max3', 't2min3', 'td2', 'rh2', 'q2', 'tskin', 'wind10', 'wdir10', 'gust_max', 'gust_peak', 'mslp', 'sp',
                 'tcc', 'lcc', 'mcc', 'hcc', 'vis', 'cape_mu', 'hpbl', 'pw', 'sw_down', 'lw_down',
                 't925', 't850', 't700', 't500', 't300', 'rh925', 'rh850', 'rh700', 'rh500', 'z850', 'z500', 'thick',
                 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 'wind200', 'td850', 'w700', 'w500',
                 'cloud850', 'cloud700', 'cloud500', 'cloud300', 'vort500', 'wbpt850']

    def _ptype(self, run, h):
        """Its own type over the past hour, at the past hour's rate. ARPEGE gives a type only to T+48:
        after that, its own snow share of the hour (as AROME)."""
        from .derived import typed_rate
        if h == 0:
            return self._zeros(run)
        try:
            code = self._read(run, h, 'SP2', PTYPE, nearest=True)
        except KeyError:
            return self._share_type(run, h, (SNOW,))
        rate = self._rate(run, h)
        ecm = np.zeros(code.shape, np.int16)
        for c, e in MF_PTYPE.items():
            ecm[code == c] = e
        return typed_rate(rate, np.where(rate >= 0.05, ecm, 0))


class AROME(_MF):
    id, label, res_km = 'arome', 'Météo-France AROME (2.5 km)', 2.5
    MODEL, RES, CHUNK, DIGITS = 'arome', '0025', 6, 2
    CYCLES = (0, 3, 6, 9, 12, 15, 18, 21)
    LAST = 51
    SPEC = {
        **_common_surface(),
        'rain_total': [('SP2', RAIN), POS],
        'pw': [('SP3', PW), POS], 'lw_down': [('SP3', STRD), SAME],
        't2max': [('SP2', TMAX), C], 't2min': [('SP2', TMIN), C],
    }
    variables = ['precip_rate', 'precip_total', 'ptype', 'rain_total', 'snow_rate', 'snow_total', 'snow_acc',
                 't2', 't2max', 't2min', 'td2', 'rh2', 'q2', 'tskin', 'wind10', 'wdir10', 'gust_max', 'gust_peak',
                 'mslp', 'sp', 'tcc', 'lcc', 'mcc', 'hcc', 'cape_mu', 'hpbl', 'pw', 'sw_down', 'lw_down']

    def _ptype(self, run, h):
        """From its own snow and graupel share of the past hour (AROME's files give no type, and no
        freezing rain)."""
        if h == 0:
            return self._zeros(run)
        return self._share_type(run, h, (SNOW, GRAUPEL))


SOURCES_MF = {
    'arpege': 'Météo-France ARPEGE 0.1° (Europe) — Météo-France open data (meteo.data.gouv.fr)',
    'arome': 'Météo-France AROME 0.025° (2.5 km) — Météo-France open data (meteo.data.gouv.fr)',
}
MODELS_MF = [ARPEGE(), AROME()]
DIFFERENCED_MF = {(m, v) for m in ('arpege', 'arome') for v in ('precip_rate', 'snow_rate', 'sw_down', 'lw_down')}


def prewalk(model_id, run_iso=None, workers=8):
    """Walk every package file of a run as soon as it is listed (15 Nov 2026, at the user's request:
    "faster ARPEGE upper air"), so the first layer anyone opens finds its index ready: a cold ARPEGE
    upper-air layer took about a minute and a half walking its files. Header reads only (2 KB a
    field), kept on D: like any other index.

        python -m mdata.mf prewalk arpege [run]"""
    import concurrent.futures as cf
    M = {m.id: m for m in MODELS_MF}[model_id]
    if run_iso:
        from .models import _utc
        run = _utc(run_iso)
    else:
        run = M.runs(n=1)[0][0]
    pkgs = ['SP1', 'SP2', 'IP1', 'IP2', 'IP3', 'IP4'] if model_id == 'arpege' else ['SP1', 'SP2', 'SP3']
    files = [f for pkg in pkgs for f in M._pkg_files(run, pkg).values()]
    t0 = time.time()

    def one(f):
        try:
            return len(index(*f))
        except Exception:                                   # noqa: BLE001  (a file still uploading: walked later)
            return 0
    with cf.ThreadPoolExecutor(workers) as ex:
        n = sum(ex.map(one, files))
    print(f'{model_id} {run:%d %HZ}: {len(files)} files, {n} fields indexed in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == 'prewalk':
        prewalk(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
