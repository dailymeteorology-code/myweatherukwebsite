"""Source-model readers. Every reader pulls from a public AWS bucket only.

Each reader exposes
    find_run(init)            newest cycle available at NOVA initialisation `init`
    frame(run, vt, grid, dt)  dict for valid time vt on the target grid, or None if the
                              cycle does not reach vt (never extrapolated):
        'pl'      {'t','q'|'rh','u','v','z','w'} -> (L, ny, nx), plus 'levels' (hPa)
        'sfc'     surface / single-level fields (SI units, precip as mm/h mean over dt)
        'members' {'precip': (M, ny, nx), 'cape': ...}  (ensembles only)
        'valid'   bool (ny, nx) — where this source covers the target grid
Units are standardised here so nothing downstream guesses.
"""
from __future__ import annotations

import concurrent.futures as cf
import math
import time
import urllib.error
from datetime import datetime, timedelta, timezone

import numpy as np

from .grid import projected_sampler, regular_sampler
from .io_aws import BUCKETS, LOCKS, decode_grib, ecmwf_index, exists, fetch_ranges, get, grib_axes, log, open_nc, wgrib_index

import threading
NC_LOCK = threading.Lock()

PL_KEEP = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200]


def _floor(t, h):
    return t.replace(hour=(t.hour // h) * h, minute=0, second=0, microsecond=0)


def _uv(speed, direction_from_deg):
    r = np.deg2rad(direction_from_deg)
    return -speed * np.sin(r), -speed * np.cos(r)


class Source:
    key = ''
    cycle_h = 6
    latency_h = 3

    def __init__(self):
        self._samplers = {}

    def candidates(self, init):
        t = _floor(init - timedelta(hours=self.latency_h), self.cycle_h)
        for k in range(0, 48 // self.cycle_h + 1):
            yield t - timedelta(hours=k * self.cycle_h)

    def find_run(self, init, need_lead_h=6, until=None):
        """Newest cycle at or before `init` that reaches `need_lead_h` hours past its own
        start, or -- with `until` -- the valid time `until` (so an older cycle must reach
        further)."""
        for run in self.candidates(init):
            if run > init:
                continue
            need = need_lead_h if until is None else max(need_lead_h, math.ceil((until - run).total_seconds() / 3600))
            try:
                if self.available(run, need):
                    return run
            except Exception:
                pass
        return None


# ── Met Office (UKV 2 km, Global 10 km) ─────────────────────────────────────

class MetOffice(Source):
    model = ''
    sfc_names = {}

    def key_for(self, run, vt, name):
        lead = int((vt - run).total_seconds() // 60)
        return (f'{BUCKETS["mo"]}/{self.model}/{run:%Y%m%dT%H%MZ}/{vt:%Y%m%dT%H%MZ}-'
                f'PT{lead // 60:04d}H{lead % 60:02d}M-{name}.nc')

    def available(self, run, need):
        return exists(self.key_for(run, run + timedelta(hours=need), 'temperature_at_screen_level'))

    def nc(self, run, vt, name):
        ds = open_nc(get(self.key_for(run, vt, name)))
        var = next(v for v in ds.variables.values() if v.ndim >= 2 and 'bnds' not in v.name)
        return ds, var

    def sampler(self, ds, grid):
        if grid.name in self._samplers:
            return self._samplers[grid.name]
        if 'lambert_azimuthal_equal_area' in ds.variables:
            gm = ds.variables['lambert_azimuthal_equal_area']
            crs = (f'+proj=laea +lat_0={gm.latitude_of_projection_origin} +lon_0={gm.longitude_of_projection_origin} '
                   f'+a={gm.semi_major_axis} +b={gm.semi_minor_axis} +units=m')
            s = projected_sampler(grid, crs, ds.variables['projection_x_coordinate'][:], ds.variables['projection_y_coordinate'][:])
        else:
            s = regular_sampler(grid, ds.variables['latitude'][:], ds.variables['longitude'][:])
        self._samplers[grid.name] = s
        return s

    def field(self, run, vt, name, grid):
        # Download in parallel, but DECODE one file at a time: netCDF4/HDF5 is not thread-safe,
        # and concurrent decodes were returning another file's array (found 18 Oct 2026: UKV 2 m
        # temperature repeated across hours).
        blob = get(self.key_for(run, vt, name))
        t_ask = time.time()
        with NC_LOCK:
            t_got = time.time()
            ds = open_nc(blob)
            var = next(v for v in ds.variables.values() if v.ndim >= 2 and 'bnds' not in v.name)
            S = self.sampler(ds, grid)
            a = np.ma.filled(var[:].astype(np.float32), np.nan)
            lev = None
            for c in ('pressure', 'height'):
                if c in ds.variables and a.ndim == 3:
                    lev = np.asarray(ds.variables[c][:], float)
            ds.close()
        LOCKS['netcdf'].append((t_ask, t_got, time.time()))
        return S(a), lev, S.valid

    def accum_rate(self, run, vt, grid, dt_h, name='precipitation_accumulation-PT01H'):
        """Mean rate (mm/h) over (vt-dt, vt] from hourly accumulations; falls back to the
        3-hourly product beyond the hourly range. Metres -> mm."""
        tot, n = None, 0
        for k in range(dt_h):
            try:
                a, _, _ = self.field(run, vt - timedelta(hours=k), name, grid)
                tot = a if tot is None else tot + a
                n += 1
            except Exception:
                break
        if n == dt_h:
            return tot * 1000.0 / dt_h
        try:
            a, _, _ = self.field(run, vt, name.replace('PT01H', 'PT03H'), grid)
            return a * 1000.0 / 3.0
        except Exception:
            return None

    def frame(self, run, vt, grid, dt_h):
        if vt < run:
            return None
        try:
            t2, _, valid = self.field(run, vt, 'temperature_at_screen_level', grid)
        except Exception:
            return None                                   # cycle does not reach vt
        out = {'sfc': {'t2': t2}, 'valid': valid}
        jobs = dict(self.sfc_names)

        def one(item):
            k, n = item
            try:
                return k, self.field(run, vt, n, grid)[0]
            except Exception:
                return k, None
        with cf.ThreadPoolExecutor(6) as ex:
            for k, a in ex.map(one, jobs.items()):
                if a is not None:
                    out['sfc'][k] = a
        pr = self.accum_rate(run, vt, grid, dt_h)
        if pr is not None:
            out['sfc']['precip'] = pr
        if 'lightning' in out['sfc']:
            out['sfc']['lightning'] = out['sfc']['lightning'] * 1e6          # flashes m-2 -> km-2
        if 'hail' in out['sfc']:
            out['sfc']['hail'] = out['sfc']['hail'] * 1000.0                 # m -> mm
        if 'u10s' in out['sfc'] and 'u10d' in out['sfc']:
            out['sfc']['u10'], out['sfc']['v10'] = _uv(out['sfc'].pop('u10s'), out['sfc'].pop('u10d'))
        if self.profiles:
            pl = self.pl(run, vt, grid)
            if pl:
                out['pl'] = pl
        return out

    profiles = False


class UKV(MetOffice):
    key = 'ukv'
    model = 'uk-deterministic-2km'
    cycle_h = 1
    latency_h = 3
    profiles = True
    sfc_names = {
        'td2': 'temperature_of_dew_point_at_screen_level', 'sp': 'pressure_at_surface',
        'mslp': 'pressure_at_mean_sea_level', 'gust': 'wind_gust_at_10m', 'u10s': 'wind_speed_at_10m',
        'u10d': 'wind_direction_at_10m', 'cape_mu_src': 'CAPE_most_unstable_below_500hPa',
        'cape_sb_src': 'CAPE_surface', 'skt': 'temperature_at_surface', 'shf': 'sensible_heat_flux_at_surface',
        'cbh': 'height_AGL_at_cloud_base_where_cloud_cover_2p5_oktas', 'tcc': 'cloud_amount_of_total_cloud',
        'swdown': 'radiation_flux_in_shortwave_total_downward_at_surface', 'lwdown': 'radiation_flux_in_longwave_downward_at_surface',
        'lightning': 'lightning_flash_accumulation-PT01H', 'hail': 'hail_fall_accumulation-PT01H',
        'frz_agl': 'height_AGL_at_freezing_level', 'wbz_agl': 'height_AGL_at_wet_bulb_freezing_level',
    }

    def candidates(self, init):
        # UKV: hourly cycles but only some run long; walk back up to 24 h
        t = (init - timedelta(hours=self.latency_h)).replace(minute=0, second=0, microsecond=0)
        for k in range(24):
            yield t - timedelta(hours=k)

    def pl(self, run, vt, grid):
        names = {'t': 'temperature_on_pressure_levels', 'rh': 'relative_humidity_on_pressure_levels',
                 'ws': 'wind_speed_on_pressure_levels', 'wd': 'wind_direction_on_pressure_levels',
                 'z': 'geopotential_height_on_pressure_levels'}
        got, lev = {}, None

        def one(item):
            k, n = item
            try:
                return k, self.field(run, vt, n, grid)
            except Exception as e:
                log(f'ukv pl {k} {vt:%d%H}: {e}')
                return k, None
        with cf.ThreadPoolExecutor(5) as ex:
            for k, r in ex.map(one, names.items()):
                if r is not None:
                    got[k] = r[0]
                    lev = r[1] if r[1] is not None else lev
        if len(got) < 5 or lev is None:
            return None
        lev_hpa = lev / 100.0 if lev.max() > 2000 else lev
        u, v = _uv(got['ws'], got['wd'])
        # UKV publishes RH as a FRACTION (units "1"), relative to ICE below 0 °C and to water
        # above (values up to ~1.5 over ice). Convert to specific humidity directly so nothing
        # downstream mistakes it for a percentage or for RH over water.
        T = got['t']
        rh = np.clip(np.nan_to_num(got['rh']), 0, 1.6)
        Tc = T - 273.15
        es_w = 6.112 * np.exp(17.67 * Tc / (Tc + 243.5))
        es_i = 6.112 * np.exp(22.46 * Tc / (Tc + 272.62))
        e = rh * np.where(T < 273.15, es_i, es_w)
        e = np.minimum(e, es_w)                                    # never supersaturated w.r.t. water
        p3 = lev_hpa[:, None, None]
        r = 0.622 * e / np.maximum(p3 - e, 1e-3)
        q = (r / (1 + r)).astype(np.float32)
        pl = {'t': T, 'q': q, 'u': u, 'v': v, 'z': got['z'], 'levels': lev_hpa}
        return _order_levels(pl)


class MOGlobal(MetOffice):
    key = 'mo_global'
    model = 'global-deterministic-10km'
    cycle_h = 6
    latency_h = 5
    sfc_names = {
        'td2': 'temperature_of_dew_point_at_screen_level', 'mslp': 'pressure_at_mean_sea_level',
        'gust': 'wind_gust_at_10m', 'u10s': 'wind_speed_at_10m', 'u10d': 'wind_direction_at_10m',
        'cape_mu_src': 'CAPE_most_unstable_below_500hPa', 'cin_mu_src': 'CIN_most_unstable_below_500hPa',
        'cape_ml_src': 'CAPE_mixed_layer_lowest_500m', 'conv_rain': 'rainfall_rate_from_convection',
    }
    # The 3-D fields are global files of ~870 MB a step; only the UK window's HDF5 chunks
    # are read (h5window.py, ~1 MB a variable), so the Global model can run the V5 chain.
    profiles = True

    def pl(self, run, vt, grid):
        names = {'t': 'temperature_on_pressure_levels', 'rh': 'relative_humidity_on_pressure_levels',
                 'ws': 'wind_speed_on_pressure_levels', 'wd': 'wind_direction_on_pressure_levels',
                 'z': 'geopotential_height_on_pressure_levels'}

        from .h5window import read_windows
        try:
            got = read_windows({k: self.key_for(run, vt, n) for k, n in names.items()})
        except Exception as e:
            log(f'mo_global pl {vt:%d%H}: {e}')
            return None
        a, lat, lon, lev = got['t']
        S = regular_sampler(grid, lat, lon)
        vals = {k: S(v[0]) for k, v in got.items()}
        lev_hpa = np.asarray(lev, float) / 100.0
        u, v = _uv(vals['ws'], vals['wd'])
        T = vals['t']
        rh = np.nan_to_num(vals['rh'])
        if np.nanmax(rh) > 3.0:                     # percent -> fraction
            rh = rh / 100.0
        rh = np.clip(rh, 0, 1.6)
        Tc = T - 273.15
        es_w = 6.112 * np.exp(17.67 * Tc / (Tc + 243.5))
        es_i = 6.112 * np.exp(22.46 * Tc / (Tc + 272.62))
        e = np.minimum(rh * np.where(T < 273.15, es_i, es_w), es_w)      # Met Office RH is w.r.t. ice below 0 C
        p3 = lev_hpa[:, None, None]
        r = 0.622 * e / np.maximum(p3 - e, 1e-3)
        q = (r / (1 + r)).astype(np.float32)
        return _order_levels({'t': T, 'q': q, 'u': u, 'v': v, 'z': vals['z'], 'levels': lev_hpa})


def _order_levels(pl):
    lev = np.asarray(pl['levels'], float)
    order = np.argsort(-lev)                     # surface (high p) first
    out = {k: (v[order] if isinstance(v, np.ndarray) and v.ndim == 3 else v) for k, v in pl.items() if k != 'levels'}
    out['levels'] = lev[order]
    return out


# ── GRIB sources on regular lat/lon grids ───────────────────────────────────

class GribLatLon(Source):
    def sampler_for(self, meta, grid):
        k = (grid.name, meta['Ni'], meta['Nj'])
        if k not in self._samplers:
            lat, lon = grib_axes(meta)
            self._samplers[k] = regular_sampler(grid, lat, lon)
        return self._samplers[k]


def _tp_metres(a, meta):
    """IFS writes total precipitation in m, AIFS in kg m-2 (= mm): standardise to m."""
    return a if str(meta.get('units', 'm')).strip() == 'm' else a / 1000.0


class GFS(GribLatLon):
    key = 'gfs'
    latency_h = 4
    PL = ['TMP', 'RH', 'UGRD', 'VGRD', 'HGT', 'VVEL', 'CLMR', 'ICMR', 'RWMR', 'SNMR', 'GRLE']
    SFC = {('TMP', '2 m above ground'): 't2', ('DPT', '2 m above ground'): 'td2', ('PRES', 'surface'): 'sp',
           ('PRMSL', 'mean sea level'): 'mslp', ('UGRD', '10 m above ground'): 'u10', ('VGRD', '10 m above ground'): 'v10',
           ('GUST', 'surface'): 'gust', ('CAPE', '180-0 mb above ground'): 'cape_mu_src', ('CIN', '180-0 mb above ground'): 'cin_mu_src',
           ('PRATE', 'surface'): 'precip_inst', ('SOILW', '0-0.1 m below ground'): 'soilw', ('TMP', 'surface'): 'skt',
           ('SHTFL', 'surface'): 'shf', ('LHTFL', 'surface'): 'lhf', ('PWAT', 'entire atmosphere (considered as a single layer)'): 'pw_src'}

    def url(self, run, f):
        return f'{BUCKETS["gfs"]}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{f:03d}'

    def available(self, run, need):
        return exists(self.url(run, need) + '.idx')

    def frame(self, run, vt, grid, dt_h):
        f = int((vt - run).total_seconds() // 3600)
        if f < 0 or f > 384:
            return None
        try:
            idx = wgrib_index(get(self.url(run, f) + '.idx').decode())
        except Exception:
            return None
        want = []
        for r in idx:
            lev = r['level']
            if r['var'] in self.PL and lev.endswith(' mb') and lev.split()[0].isdigit() and int(lev.split()[0]) in PL_KEEP and 'ave' not in r['desc']:
                want.append((r['start'], r['end'], ('pl', r['var'], int(lev.split()[0]))))
            elif (r['var'], lev) in self.SFC and 'ave' not in r['desc'] and 'acc' not in r['desc']:
                want.append((r['start'], r['end'], ('sfc', self.SFC[(r['var'], lev)], 0)))
            elif r['var'] == 'APCP' and lev == 'surface' and 'acc' in r['desc']:
                want.append((r['start'], r['end'], ('apcp', r['desc'], 0)))
        blobs = fetch_ranges(self.url(run, f), want, gap=1_500_000, workers=8)
        pl, sfc, valid = {}, {}, None
        apcp = {}
        for (kind, name, lev), blob in blobs.items():
            a, meta = decode_grib(blob)
            S = self.sampler_for(meta, grid)
            valid = S.valid
            if kind == 'pl':
                pl.setdefault(name, {})[lev] = S(a)
            elif kind == 'sfc':
                sfc[name] = S(a)
            else:
                apcp[name] = S(a)
        if 'precip_inst' in sfc:
            sfc['precip'] = sfc.pop('precip_inst') * 3600.0          # kg m-2 s-1 -> mm/h
        for desc, a in apcp.items():                                  # prefer the accumulation over dt
            try:
                rng = desc.split()[0].split('-')
                hrs = int(rng[1]) - int(rng[0])
                if hrs == dt_h or 'precip' not in sfc:
                    sfc['precip'] = a / max(hrs, 1)
            except Exception:
                pass
        levs = sorted({l for d in pl.values() for l in d}, reverse=True)
        if all(k in pl for k in ('TMP', 'RH', 'UGRD', 'VGRD', 'HGT')):
            def stack(k):
                return np.stack([pl[k].get(l, np.full(grid.shape, np.nan, np.float32)) for l in levs])
            prof = {'t': stack('TMP'), 'rh': stack('RH'), 'u': stack('UGRD'), 'v': stack('VGRD'), 'z': stack('HGT'),
                    'levels': np.array(levs, float)}
            if 'VVEL' in pl:
                prof['w'] = stack('VVEL')
            # GFS hydrometeor mixing ratios (kg/kg): cloud water, ice, rain, snow, graupel
            for g, k in (('CLMR', 'qc'), ('ICMR', 'qi'), ('RWMR', 'qr'), ('SNMR', 'qs'), ('GRLE', 'qg')):
                if g in pl:
                    prof[k] = stack(g)
        else:
            prof = None
        out = {'sfc': sfc, 'valid': valid if valid is not None else np.ones(grid.shape, bool)}
        if prof:
            out['pl'] = prof
        return out


def _ecm_base(src, run, step, stem=None, host=None):
    host = host or src.__dict__.get('_host', {}).get((run, step), BUCKETS['ecm_gcs'])
    return f'{host}/{run:%Y%m%d}/{run:%H}z/{src.path}/{run:%Y%m%d%H}0000-{step}h-{stem or src.stem}'


def _ecm_step_at(src, need):
    """The published step that covers lead `need` h: 3-hourly to T+144 (AIFS 6-hourly),
    6-hourly beyond."""
    every = 6 if src.key in ('aifs', 'aifs_ens') or need > 144 else 3
    return int(math.ceil(need / every) * every)


def _ecm_available(src, run, need=0):
    """The cycle's T+0 index is on either copy and, for a cycle that must reach T+`need`,
    the step covering it is COMPLETE (index and GRIB) on ECMWF's Google Cloud copy.

    That copy fills 20-35 min behind the AWS copy (IFS ENS: the 00Z and 12Z cycles complete
    there only ~8 h 15 min after the cycle time, 06Z and 18Z ~7 h 40 min), and the AWS copy
    answers most range requests with 503 SlowDown (20 Oct 2026: 3 of 4 refused from one
    client asking one range at a time). A Main Run starting at 08:02Z used to take the 00Z
    ENS, find T+84..T+105 only on AWS and wait 136-194 s for frames that then dropped the
    ENS anyway. Steps arrive in order, so the last step needed stands for all of them."""
    if not any(exists(_ecm_base(src, run, 0, host=h) + '.index') for h in (BUCKETS['ecm_gcs'], BUCKETS['ecm'])):
        return False
    if need <= 0:
        return True
    base = _ecm_base(src, run, _ecm_step_at(src, need), host=BUCKETS['ecm_gcs'])
    return exists(base + '.grib2') and exists(base + '.index')


def _ecm_find_run(src, init, need_lead_h=6, until=None):
    """The newest cycle complete on the Google Cloud copy; if that copy has none (it is
    down, or everything is late), the newest cycle on either copy, as before."""
    return Source.find_run(src, init, need_lead_h, until) or Source.find_run(src, init, 0)


def _ecm_index(src, run, step):
    """The step's index from ECMWF's Google Cloud copy, else the AWS copy; remembers which
    host answered so the GRIB ranges come from the same file. The Google copy is asked
    three times first: once a step's index comes from AWS, its ~100 ranges do too, and
    the AWS copy refuses most of them (503 SlowDown) -- minutes of retries."""
    hosts = src.__dict__.setdefault('_host', {})
    plan = [BUCKETS['ecm_gcs']] * 3 + [BUCKETS['ecm']] * 2
    i = 0
    while i < len(plan):
        h = plan[i]
        try:
            txt = get(_ecm_base(src, run, step, host=h) + '.index', tries=2, timeout=60).decode()
            if txt.strip():
                hosts[(run, step)] = h
                return ecmwf_index(txt)
        except urllib.error.HTTPError as e:
            if e.code == 404 and h == BUCKETS['ecm_gcs']:
                i = plan.index(BUCKETS['ecm'])            # not on the Google copy (yet): no point retrying it
                continue
        except Exception:
            pass
        time.sleep(1 + i)
        i += 1
    return None


class ECMWF(GribLatLon):
    """IFS HRES and AIFS Single (stream oper)."""
    key = 'ifs'
    path = 'ifs/0p25/oper'
    stem = 'oper-fc'
    latency_h = 7
    PL = ['t', 'q', 'u', 'v', 'gh', 'w']
    SFC = {'2t': 't2', '2d': 'td2', 'sp': 'sp', 'msl': 'mslp', '10u': 'u10', '10v': 'v10', 'mucape': 'cape_mu_src',
           'skt': 'skt', 'tcwv': 'pw_src', 'swvl1': 'soilw', 'vsw': 'soilw'}

    def base(self, run, step):
        return _ecm_base(self, run, step)

    def available(self, run, need):
        return _ecm_available(self, run, need)

    def find_run(self, init, need_lead_h=6, until=None):
        return _ecm_find_run(self, init, need_lead_h, until)

    def steps_ok(self, step):
        return step <= 144 and step % 3 == 0 or step % 6 == 0

    def _index(self, run, step):
        return _ecm_index(self, run, step)

    def frame(self, run, vt, grid, dt_h):
        step = int((vt - run).total_seconds() // 3600)
        if step < 0 or not self.steps_ok(step):
            return None
        try:
            idx = self._index(run, step)
        except Exception:
            return None
        if not idx:
            return None
        want, gust_name = [], '10fg3' if step <= 144 else '10fg6'
        for r in idx:
            p, lt = r.get('param'), r.get('levtype')
            if lt == 'pl' and p in self.PL and int(r.get('levelist', 0)) >= 200:
                want.append((r['_offset'], r['_offset'] + r['_length'] - 1, ('pl', p, int(r['levelist']))))
            elif lt in ('sfc', 'sol') and (p in self.SFC or p in ('tp', gust_name, '10fg')):
                if lt == 'sol' and str(r.get('levelist')) not in ('1',):
                    continue
                want.append((r['_offset'], r['_offset'] + r['_length'] - 1, ('sfc', p, 0)))
        blobs = fetch_ranges(self.base(run, step) + '.grib2', want, gap=200_000, workers=16)
        pl, sfc, valid = {}, {}, None
        tp = None
        for (kind, p, lev), blob in blobs.items():
            a, meta = decode_grib(blob)
            S = self.sampler_for(meta, grid)
            valid = S.valid
            a = S(a)
            if kind == 'pl':
                pl.setdefault(p, {})[lev] = a
            elif p == 'tp':
                tp = _tp_metres(a, meta)
            elif p in ('10fg3', '10fg6', '10fg'):
                sfc['gust'] = a
            else:
                sfc[self.SFC[p]] = a
        if tp is not None:
            prev = self._tp(run, step - dt_h, grid) if step - dt_h > 0 else 0.0
            if prev is not None:
                sfc['precip'] = np.maximum(0, tp - prev) * 1000.0 / dt_h          # m since start -> mm/h
        out = {'sfc': sfc, 'valid': valid if valid is not None else np.ones(grid.shape, bool)}
        if all(k in pl for k in ('t', 'u', 'v', 'gh')) and ('q' in pl):
            levs = sorted(pl['t'], reverse=True)
            def stack(k):
                return np.stack([pl[k].get(l, np.full(grid.shape, np.nan, np.float32)) for l in levs])
            prof = {'t': stack('t'), 'q': stack('q'), 'u': stack('u'), 'v': stack('v'), 'z': stack('gh'), 'levels': np.array(levs, float)}
            if 'w' in pl:
                prof['w'] = stack('w')
            out['pl'] = prof
        return out

    def _tp(self, run, step, grid):
        try:
            idx = self._index(run, step)
            r = next(r for r in idx if r.get('param') == 'tp')
            blob = get(self.base(run, step) + '.grib2', (r['_offset'], r['_offset'] + r['_length'] - 1))
            a, meta = decode_grib(blob)
            return _tp_metres(self.sampler_for(meta, grid)(a), meta)
        except Exception:
            return None


class AIFS(ECMWF):
    key = 'aifs'
    path = 'aifs-single/0p25/oper'
    latency_h = 6

    def steps_ok(self, step):
        return step % 6 == 0


class ECMWFEns(GribLatLon):
    """IFS ENS / AIFS ENS: all members of the requested params, as members arrays."""
    key = 'ifs_ens'
    path = 'ifs/0p25/enfo'
    stem = 'enfo-ef'
    latency_h = 8
    params = ('tp', 'mucape')

    def base(self, run, step, stem=None):
        return _ecm_base(self, run, step, stem)

    def available(self, run, need):
        return _ecm_available(self, run, need)

    def find_run(self, init, need_lead_h=6, until=None):
        return _ecm_find_run(self, init, need_lead_h, until)

    def members(self, run, step, grid):
        key = (run, step, grid.name)
        memo = self.__dict__.setdefault('_memo', {})
        if key not in memo:
            if len(memo) > 2:
                memo.pop(next(iter(memo)))
            memo[key] = self._members(run, step, grid)
        return memo[key]

    def _members(self, run, step, grid):
        idx = _ecm_index(self, run, step)
        if not idx:
            return None
        want = [(r['_offset'], r['_offset'] + r['_length'] - 1, (r['param'], int(r.get('number', 0))))
                for r in idx if r.get('param') in self.params and r.get('levtype') == 'sfc']
        if not want:
            return None
        blobs = fetch_ranges(self.base(run, step) + '.grib2', want, gap=200_000, workers=16)
        out = {}
        for (p, n), blob in blobs.items():
            a, meta = decode_grib(blob)
            a = self.sampler_for(meta, grid)(a)
            out.setdefault(p, {})[n] = _tp_metres(a, meta) if p == 'tp' else a
        return {p: np.stack([d[k] for k in sorted(d)]) for p, d in out.items()}

    def frame(self, run, vt, grid, dt_h):
        step = int((vt - run).total_seconds() // 3600)
        if step < 0 or (step > 144 and step % 6) or step % 3:
            return None
        cur = self.members(run, step, grid)
        if not cur or 'tp' not in cur:
            return None
        prev = self.members(run, step - dt_h, grid) if step - dt_h > 0 else None
        tp0 = prev['tp'] if prev and 'tp' in prev and prev['tp'].shape == cur['tp'].shape else 0.0
        if step - dt_h > 0 and prev is None:
            return None
        mem = {'precip': np.maximum(0, cur['tp'] - tp0) * 1000.0 / dt_h}
        if 'mucape' in cur:
            mem['cape'] = cur['mucape']
        return {'members': mem, 'sfc': {}, 'valid': np.isfinite(mem['precip'][0])}


class AIFSEns(ECMWFEns):
    key = 'aifs_ens'
    path = 'aifs-ens/0p25/enfo'
    stem = 'enfo-pf'
    latency_h = 7
    params = ('tp',)

    def frame(self, run, vt, grid, dt_h):
        step = int((vt - run).total_seconds() // 3600)
        if step % 6:
            return None
        return super().frame(run, vt, grid, 6 if dt_h < 6 else dt_h)


class GEFS(GribLatLon):
    key = 'gefs'
    latency_h = 5
    n_members = 30

    def url(self, run, m, f):
        return f'{BUCKETS["gefs"]}/gefs.{run:%Y%m%d}/{run:%H}/atmos/pgrb2ap5/gep{m:02d}.t{run:%H}z.pgrb2a.0p50.f{f:03d}'

    def available(self, run, need):
        return exists(self.url(run, 1, need) + '.idx')

    def frame(self, run, vt, grid, dt_h):
        f = int((vt - run).total_seconds() // 3600)
        if f <= 0 or f % 3 or f > 384:
            return None

        def one(m):
            try:
                idx = wgrib_index(get(self.url(run, m, f) + '.idx').decode())
            except Exception:
                return m, None
            want = [(r['start'], r['end'], r['var'] + '|' + r['desc']) for r in idx
                    if (r['var'] == 'APCP' and r['level'] == 'surface') or (r['var'] == 'CAPE' and r['level'] == '180-0 mb above ground')]
            res = {}
            for k, blob in fetch_ranges(self.url(run, m, f), want, gap=500_000).items():
                a, meta = decode_grib(blob)
                a = self.sampler_for(meta, grid)(a)
                if k.startswith('APCP'):
                    try:
                        r0, r1 = k.split('|')[1].split()[0].split('-')
                        res['precip'] = a / max(int(r1) - int(r0), 1)
                    except Exception:
                        pass
                else:
                    res['cape'] = a
            return m, res
        with cf.ThreadPoolExecutor(8) as ex:
            got = dict(ex.map(one, range(1, self.n_members + 1)))
        got = {m: r for m, r in got.items() if r and 'precip' in r}
        if len(got) < 10:
            return None
        mem = {'precip': np.stack([r['precip'] for r in got.values()])}
        if all('cape' in r for r in got.values()):
            mem['cape'] = np.stack([r['cape'] for r in got.values()])
        return {'members': mem, 'sfc': {}, 'valid': np.isfinite(mem['precip'][0])}


READERS = {'ukv': UKV, 'mo_global': MOGlobal, 'ifs': ECMWF, 'aifs': AIFS, 'ifs_ens': ECMWFEns,
           'aifs_ens': AIFSEns, 'gfs': GFS, 'gefs': GEFS}


def _register_external():
    """Non-AWS readers (never Open-Meteo): DWD open data."""
    from .sources_dwd import ICOND2, ICONEU, ICONEUEPS
    READERS.update({'icon_eu': ICONEU, 'icon_d2': ICOND2, 'icon_eps': ICONEUEPS})


_register_external()
