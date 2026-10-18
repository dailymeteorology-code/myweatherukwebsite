"""DWD ICON-EU (6.5 km) and ICON-EU-EPS (40 members, 13 km) from DWD's own open-data
server, opendata.dwd.de (free, licence: DWD open data / GeoNutzV, attribution "Source:
Deutscher Wetterdienst"). Not AWS and not Open-Meteo: the user widened the source rule to
"anything except Open-Meteo" for models AWS does not carry.

ICON-EU files are one field per file, bz2-compressed GRIB2 on a regular 0.0625° grid.
ICON-EU-EPS files hold all members on the icosahedral grid; they are mapped to the target
grid by inverse-distance weighting of the 4 nearest cells (clat/clon from DWD).
DWD keeps roughly the last 24 h of cycles online.
"""
from __future__ import annotations

import bz2
import concurrent.futures as cf
import math
from datetime import timedelta

import numpy as np
from scipy.spatial import cKDTree

from .config import CACHE
from .io_aws import decode_grib, exists, get, log
from .sources import GribLatLon, Source, _floor

DWD = 'https://opendata.dwd.de/weather/nwp'
PL = [1000, 950, 925, 900, 875, 850, 825, 800, 775, 700, 600, 500, 400, 300, 250, 200]


def _grib(url):
    return decode_grib(bz2.decompress(get(url, tries=4)))


class ICONEU(GribLatLon):
    key = 'icon_eu'
    cycle_h = 3
    latency_h = 4
    SFC = {'T_2M': 't2', 'TD_2M': 'td2', 'PMSL': 'mslp', 'PS': 'sp', 'U_10M': 'u10', 'V_10M': 'v10', 'VMAX_10M': 'gust',
           'CAPE_ML': 'cape_mu_src', 'CIN_ML': 'cin_mu_src', 'T_G': 'skt', 'ASHFL_S': 'shf', 'ALHFL_S': 'lhf',
           'TQC': 'tqc', 'TQI': 'tqi', 'TQR': 'tqr', 'TQS': 'tqs', 'TQV': 'pw_src', 'HTOP_CON': 'htop_con',
           'HBAS_CON': 'hbas_con', 'LPI_CON_MAX': 'lpi', 'CLCT': 'tcc', 'HZEROCL': 'frz_asl', 'W_SO': 'soilw_kgm2'}
    PLV = {'T': 't', 'RELHUM': 'rh', 'U': 'u', 'V': 'v', 'FI': 'z', 'OMEGA': 'w'}

    def url(self, run, step, var, kind='single-level', lev=None):
        lv = f'{lev}_' if lev is not None else ''
        return (f'{DWD}/icon-eu/grib/{run:%H}/{var.lower()}/icon-eu_europe_regular-lat-lon_{kind}_'
                f'{run:%Y%m%d%H}_{step:03d}_{lv}{var}.grib2.bz2')

    def available(self, run, need):
        return exists(self.url(run, min(need, 48), 'T_2M'))

    def candidates(self, init):
        t = _floor(init - timedelta(hours=self.latency_h), 3)
        for k in range(9):
            yield t - timedelta(hours=3 * k)

    def frame(self, run, vt, grid, dt_h):
        step = int((vt - run).total_seconds() // 3600)
        maxlead = 120 if run.hour % 6 == 0 else 48
        if step < 0 or step > maxlead or (step > 78 and step % 3):
            return None
        jobs = [('sfc', v, None) for v in self.SFC] + [('pl', v, l) for v in self.PLV for l in PL] + [('acc', 'TOT_PREC', None)]

        def one(j):
            kind, v, lev = j
            try:
                if kind == 'pl':
                    return j, _grib(self.url(run, step, v, 'pressure-level', lev))
                return j, _grib(self.url(run, step, v))
            except Exception:
                return j, None
        with cf.ThreadPoolExecutor(12) as ex:
            got = dict(ex.map(one, jobs))
        if got.get(('sfc', 'T_2M', None)) is None:
            return None
        sfc, pl, valid = {}, {}, None
        for (kind, v, lev), r in got.items():
            if r is None:
                continue
            a, meta = r
            S = self.sampler_for(meta, grid)
            valid = S.valid
            a = S(a)
            if kind == 'sfc':
                sfc[self.SFC[v]] = a
            elif kind == 'pl':
                pl.setdefault(self.PLV[v], {})[lev] = a
            else:
                tp1 = a
        if ('acc', 'TOT_PREC', None) in got and got[('acc', 'TOT_PREC', None)] is not None:
            prev = 0.0
            if step - dt_h > 0:
                try:
                    a, meta = _grib(self.url(run, step - dt_h, 'TOT_PREC'))
                    prev = self.sampler_for(meta, grid)(a)
                except Exception:
                    prev = None
            if prev is not None:
                sfc['precip'] = np.maximum(0, tp1 - prev) / dt_h                    # kg m-2 == mm
        if 'cin_mu_src' in sfc:
            sfc['cin_mu_src'] = -np.abs(sfc['cin_mu_src'])                          # DWD stores CIN as positive
        for k in ('htop_con', 'hbas_con'):
            if k in sfc:
                sfc[k] = np.where(sfc[k] < -400, np.nan, sfc[k])                   # -500 = no convection
        if 'lpi' in sfc:
            # Lightning Potential Index (Lynn & Yair 2010), J/kg. Treated as an explicit lightning
            # signal: LPI >~ 1–2 J/kg is where ICON's convection scheme diagnoses electrification.
            sfc['lightning_lpi'] = sfc.pop('lpi')
        out = {'sfc': sfc, 'valid': valid if valid is not None else np.ones(grid.shape, bool)}
        if all(k in pl for k in ('t', 'rh', 'u', 'v', 'z')):
            levs = sorted(pl['t'], reverse=True)
            def stack(k):
                return np.stack([pl[k].get(l, np.full(grid.shape, np.nan, np.float32)) for l in levs])
            prof = {'t': stack('t'), 'rh': stack('rh'), 'u': stack('u'), 'v': stack('v'), 'z': stack('z') / 9.80665,
                    'levels': np.array(levs, float)}
            if 'w' in pl:
                prof['w'] = stack('w')
            out['pl'] = prof
        return out


class ICONEUEPS(Source):
    key = 'icon_eps'
    cycle_h = 6
    latency_h = 5
    _tree = None

    def url(self, run, step, var):
        return (f'{DWD}/icon-eu-eps/grib/{run:%H}/{var}/icon-eu-eps_europe_icosahedral_single-level_'
                f'{run:%Y%m%d%H}_{step:03d}_{var}.grib2.bz2')

    def available(self, run, need):
        return exists(self.url(run, need, 'tot_prec'))

    def _map(self, run, grid):
        k = grid.name
        if self._tree and self._tree[0] == k:
            return self._tree[1]
        f = CACHE / f'icon_eu_eps_map_{grid.name}.npz'
        if f.exists():
            z = np.load(f)
            m = (z['sel'], z['nn'], z['w'])
        else:
            def coord(v):
                raw = bz2.decompress(get(f'{DWD}/icon-eu-eps/grib/{run:%H}/{v}/icon-eu-eps_europe_icosahedral_time-invariant_{run:%Y%m%d%H}_{v}.grib2.bz2'))
                import eccodes
                h = eccodes.codes_new_from_message(raw)
                try:
                    return eccodes.codes_get_values(h)
                finally:
                    eccodes.codes_release(h)
            lat, lon = coord('clat'), coord('clon')
            sel = np.where((lat > 47) & (lat < 63) & (lon > -14) & (lon < 6))[0]
            c = math.cos(math.radians(55))
            tree = cKDTree(np.c_[lat[sel], lon[sel] * c])
            glon, glat = grid.lonlat
            d, nn = tree.query(np.c_[glat.ravel(), glon.ravel() * c], k=4)
            w = 1 / np.maximum(d, 1e-6) ** 2
            w = (w / w.sum(1, keepdims=True)).astype(np.float32)
            m = (sel, nn, w)
            f.parent.mkdir(parents=True, exist_ok=True)
            np.savez(f, sel=sel, nn=nn, w=w)
        self._tree = (k, m)
        return m

    def _members(self, run, step, var, grid):
        import eccodes
        raw = bz2.decompress(get(self.url(run, step, var), tries=4))
        sel, nn, w = self._map(run, grid)
        out = {}
        pos = 0
        while pos < len(raw):
            h = eccodes.codes_new_from_message(raw[pos:])
            try:
                n = eccodes.codes_get(h, 'perturbationNumber') if eccodes.codes_is_defined(h, 'perturbationNumber') else 0
                vals = eccodes.codes_get_values(h)
                pos += eccodes.codes_get(h, 'totalLength')
            finally:
                eccodes.codes_release(h)
            out[n] = (vals[sel][nn] * w).sum(1).reshape(grid.shape).astype(np.float32)
        return np.stack([out[k] for k in sorted(out)])

    def frame(self, run, vt, grid, dt_h):
        step = int((vt - run).total_seconds() // 3600)
        if step <= 0 or step > 120 or (step > 48 and step % 6) or step % 3:
            return None
        try:
            tp = self._members(run, step, 'tot_prec', grid)
            tp0 = self._members(run, step - dt_h, 'tot_prec', grid) if step - dt_h > 0 else 0.0
            mem = {'precip': np.maximum(0, tp - tp0) / dt_h}
            try:
                mem['cape'] = self._members(run, step, 'cape_ml', grid)
            except Exception:
                pass
        except Exception as e:
            log(f'icon_eps {vt}: {e}')
            return None
        return {'members': mem, 'sfc': {}, 'valid': np.ones(grid.shape, bool)}
