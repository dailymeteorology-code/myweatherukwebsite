"""TCM V3 input from AWS models (replaces the Open-Meteo ensemble feed).

    python -m nova.v3_points coords.json points.json.gz [--init 2026-10-19T03:00] [--days 3]

V3's risk engine (src/lib/openMeteoTCM.js) scores per-point hourly series keyed
`<variable>_<model>` in Open-Meteo's units (°C, mph, mm, hPa, %, J/kg, m). This module
builds exactly that structure, but every number comes from AWS open data:

  ukv_aws        UKV 2 km                  physics (850/700/500/300 hPa)   weight 4.0
  mo_global_aws  Met Office Global 10 km   surface + convective            weight 3.0
  ifs_aws        ECMWF IFS HRES            physics                         weight 2.4
  ifs_ens_aws    ECMWF IFS ENS (50)        ensemble mean + CAPE spread     weight 2.2
  aifs_aws       ECMWF AIFS Single (AI)    physics (CAPE computed)         weight 1.6
  aifs_ens_aws   ECMWF AIFS ENS (AI)       ensemble-mean precipitation     weight 1.2
  gfs_aws        NOAA GFS                  physics                         weight 1.4
  gefs_aws       NOAA GEFS (30)            ensemble mean + CAPE spread     weight 1.2

Profile diagnostics the engine expects (CAPE, CIN, lifted index, freezing level) are
computed from each model's own pressure-level profile with NOVA's parcel code where the
model does not publish them. Native 3/6-hourly steps are linearly interpolated to hourly
between published steps only — never extrapolated past a model's last step.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import gzip
import json
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

from . import thermo as th
from .io_aws import log
from .sources import READERS

MODELS = {
    'ukv_aws': ('ukv', 1, True), 'mo_global_aws': ('mo_global', 1, False), 'ifs_aws': ('ifs', 3, True),
    'ifs_ens_aws': ('ifs_ens', 3, False), 'aifs_aws': ('aifs', 6, True), 'aifs_ens_aws': ('aifs_ens', 6, False),
    'gfs_aws': ('gfs', 3, True), 'gefs_aws': ('gefs', 3, False),
}
PL = (850, 700, 500, 300)
MS_TO_MPH = 2.236936


class PointGrid:
    """A 1 x N 'grid' of points so the NOVA source readers sample straight onto V3's nodes."""
    def __init__(self, lats, lons):
        self.name = f'v3pts{len(lats)}'
        self.shape = (1, len(lats))
        self.lonlat = (np.asarray(lons, float)[None, :], np.asarray(lats, float)[None, :])
        self.grid_convergence = np.zeros(self.shape)


def solar_is_day(lat, lon, t):
    doy = t.timetuple().tm_yday
    decl = -23.44 * math.cos(math.radians(360 / 365 * (doy + 10)))            # solar declination, degrees
    hour = t.hour + t.minute / 60 + lon / 15.0                                 # local solar time
    ha = np.radians(15 * (hour - 12))
    el = np.degrees(np.arcsin(np.sin(np.radians(lat)) * math.sin(math.radians(decl)) +
                              np.cos(np.radians(lat)) * math.cos(math.radians(decl)) * np.cos(ha)))
    return (el > -0.833).astype(float)


def weather_code(precip, cape, tcc):
    """WMO-style code the V3 engine reads: 95 thunder, 80-82 showers, 61-65 rain, 3/2/0 cloud."""
    wc = np.where(tcc >= 80, 3, np.where(tcc >= 40, 2, 0)).astype(float)
    rain = np.where(precip >= 7.6, 65, np.where(precip >= 2.5, 63, np.where(precip >= 0.2, 61, 0)))
    shower = np.where(precip >= 10, 82, np.where(precip >= 2.5, 81, 80))
    conv = cape >= 150
    wc = np.where(precip >= 0.2, np.where(conv, shower, rain), wc)
    wc = np.where((precip >= 1.0) & (cape >= 500), 95, wc)
    return wc


def profile_fields(pl, sfc, n):
    """Pressure-level variables + column diagnostics in V3's units, for one valid time."""
    out = {}
    levs = list(np.asarray(pl['levels'], float))
    T = pl['t'][:, 0, :]
    q = pl['q'][:, 0, :] if 'q' in pl else th.q_from_rh(pl['rh'][:, 0, :], T, np.asarray(levs)[:, None])
    u, v, z = pl['u'][:, 0, :], pl['v'][:, 0, :], pl['z'][:, 0, :]
    for p in PL:
        if p not in levs:
            continue
        i = levs.index(p)
        e = th.vapour_pressure_from_q(q[i], p)
        Td = th.dewpoint_from_e(e)
        out[f'temperature_{p}hPa'] = T[i] - 273.15
        out[f'dew_point_{p}hPa'] = np.minimum(Td, T[i]) - 273.15
        out[f'relative_humidity_{p}hPa'] = np.clip(100 * e / th.es_hpa(T[i]), 0, 100)
        out[f'geopotential_height_{p}hPa'] = z[i]
        out[f'wind_speed_{p}hPa'] = np.hypot(u[i], v[i]) * MS_TO_MPH
        out[f'wind_direction_{p}hPa'] = (np.degrees(np.arctan2(-u[i], -v[i])) + 360) % 360
        if p == 700 and 'w' in pl:
            rho = p * 100 / (287.04 * T[i])
            out['vertical_velocity_700hPa'] = -pl['w'][i, 0, :] / (rho * 9.80665)
    # column diagnostics from the model's own profile
    t2 = sfc.get('t2', T[0])[0] if 't2' in sfc else T[0]
    td2 = sfc['td2'][0] if 'td2' in sfc else t2 - 5
    ps = (sfc['sp'][0] / 100) if 'sp' in sfc else (sfc['mslp'][0] / 100 if 'mslp' in sfc else np.full(n, 1013.0))
    q2 = th.q_from_rh(100 * th.es_hpa(np.minimum(td2, t2)) / th.es_hpa(t2), t2, ps)
    zs = np.zeros(n)
    try:
        C = th.build_columns(np.asarray(levs), T, q, u, v, z, ps, t2, q2, zs,
                             sfc['u10'][0] if 'u10' in sfc else u[0], sfc['v10'][0] if 'v10' in sfc else v[0])
        sb, ml, mu = th.parcels(C)
        out['_cape_col'] = mu['cape']
        out['_cin_col'] = -np.nan_to_num(ml['cin'])
        T500 = th.interp_p(C, 'T', 500)
        tv = th.interp_at({'x': -np.log(C['p']), 'a': ml['Tvp']}, 'a', None, -np.log(500.0), coordkey='x')
        out['lifted_index'] = T500 - tv
        out['_frz'] = th.crossing_height(C, 'T', 273.15)
    except Exception as e:
        log(f'v3 column diagnostics failed: {e}')
    return out


def model_series(key, reader_key, step, physics, grid, t0, hours, init):
    """{variable: array(len(hours), N)} for one model, NaN where it has no data."""
    r = READERS[reader_key]()
    run = r.find_run(init, need_lead_h=12)
    if run is None:
        log(f'v3: {key} has no cycle')
        return None, None
    n = grid.shape[1]
    H = len(hours)
    S = {}

    def put(name, hi, arr):
        S.setdefault(name, np.full((H, n), np.nan, np.float32))[hi] = arr

    native = [h for h in range(H) if (hours[h] - run).total_seconds() >= 0 and ((hours[h] - run).total_seconds() / 3600) % step == 0]

    def fetch(hi):
        vt = hours[hi]
        rr = r
        if key == 'ukv_aws':                                   # UKV: profiles only every 3 h (big files);
            rr = READERS[reader_key]()                         # own reader per call: no shared flag between threads
            rr._samplers = r._samplers
            rr.profiles = ((vt - run).total_seconds() / 3600) % 3 == 0
        try:
            return hi, rr.frame(run, vt, grid, step)
        except Exception as e:
            log(f'v3 {key} {vt:%d %HZ}: {e}')
            return hi, None
    workers = 2 if reader_key in ('ifs', 'ifs_ens', 'aifs', 'aifs_ens') else 6
    with cf.ThreadPoolExecutor(workers) as ex:
        results = list(ex.map(fetch, native))
    got = 0
    for hi, f in results:
        if not f:
            continue
        got += 1
        sfc = f.get('sfc', {})
        if 'members' in f:
            m = f['members']
            put('precipitation', hi, np.nanmean(m['precip'][:, 0, :], 0))
            if 'cape' in m:
                put('cape', hi, np.nanmean(m['cape'][:, 0, :], 0))
                put('cape_spread', hi, np.nanstd(m['cape'][:, 0, :], 0))
            continue
        g = lambda k: sfc[k][0] if k in sfc else None
        if g('t2') is not None:
            put('temperature_2m', hi, g('t2') - 273.15)
        if g('td2') is not None and g('t2') is not None:
            put('dew_point_2m', hi, np.minimum(g('td2'), g('t2')) - 273.15)
            put('relative_humidity_2m', hi, np.clip(100 * th.es_hpa(np.minimum(g('td2'), g('t2'))) / th.es_hpa(g('t2')), 0, 100))
        if g('precip') is not None:
            put('precipitation', hi, np.maximum(g('precip'), 0))
        if g('mslp') is not None:
            put('pressure_msl', hi, g('mslp') / 100)
        if g('sp') is not None:
            put('surface_pressure', hi, g('sp') / 100)
        if g('u10') is not None:
            put('wind_speed_10m', hi, np.hypot(g('u10'), g('v10')) * MS_TO_MPH)
            put('wind_direction_10m', hi, (np.degrees(np.arctan2(-g('u10'), -g('v10'))) + 360) % 360)
        if g('gust') is not None:
            put('wind_gusts_10m', hi, g('gust') * MS_TO_MPH)
        if g('skt') is not None:
            put('surface_temperature', hi, g('skt') - 273.15)
        if g('tcc') is not None:
            tcc = g('tcc')
            put('cloud_cover', hi, tcc * 100 if np.nanmax(tcc) <= 1.01 else tcc)
        if g('frz_agl') is not None:
            put('freezing_level_height', hi, g('frz_agl'))
        if g('cape_mu_src') is not None:
            put('cape', hi, np.maximum(g('cape_mu_src'), 0))
        if g('cin_mu_src') is not None:
            put('convective_inhibition', hi, np.abs(g('cin_mu_src')))
        if 'pl' in f and physics:
            P = profile_fields(f['pl'], sfc, n)
            for k, a in P.items():
                if k == '_cape_col' and 'cape' not in S or (k == '_cape_col' and np.isnan(S['cape'][hi]).all()):
                    put('cape', hi, a)
                elif k == '_cin_col' and ('convective_inhibition' not in S or np.isnan(S['convective_inhibition'][hi]).all()):
                    put('convective_inhibition', hi, a)
                elif k == '_frz' and ('freezing_level_height' not in S or np.isnan(S['freezing_level_height'][hi]).all()):
                    put('freezing_level_height', hi, a)
                elif not k.startswith('_'):
                    put(k, hi, a)
    log(f'v3: {key} run {run:%d %HZ}: {got}/{len(native)} steps')
    if not got:
        return None, None
    # hourly by linear interpolation between published steps (no extrapolation)
    for k, a in S.items():
        idx = np.arange(H)
        for j in range(n):
            col = a[:, j]
            ok = np.isfinite(col)
            if ok.sum() >= 2:
                lo, hi_ = idx[ok][0], idx[ok][-1]
                col[lo:hi_ + 1] = np.interp(idx[lo:hi_ + 1], idx[ok], col[ok])
    return S, run


def build(coords, init, days=3):
    lats = np.array([c['lat'] for c in coords])
    lons = np.array([c['lon'] for c in coords])
    grid = PointGrid(lats, lons)
    day0 = init.replace(hour=0, minute=0, second=0, microsecond=0)
    hours = [day0 + timedelta(hours=h) for h in range(24 * days)]
    series, runs = {}, {}
    for key, (rk, step, phys) in MODELS.items():
        try:
            S, run = model_series(key, rk, step, phys, grid, day0, hours, init)
        except Exception as e:
            log(f'v3: {key} failed: {e}')
            S, run = None, None
        if S:
            series[key], runs[key] = S, run.isoformat()
    n = len(coords)
    H = len(hours)
    times = [h.strftime('%Y-%m-%dT%H:%M') for h in hours]
    isday = np.stack([solar_is_day(lats, lons, h) for h in hours])
    points = []
    for j in range(n):
        hourly = {'time': times}
        daily = {'time': [(day0 + timedelta(days=d)).strftime('%Y-%m-%d') for d in range(days)]}
        for key, S in series.items():
            pr = S.get('precipitation')
            cp = S.get('cape')
            for var, a in S.items():
                col = a[:, j]
                hourly[f'{var}_{key}'] = [None if not np.isfinite(x) else round(float(x), 2) for x in col]
            hourly[f'is_day_{key}'] = isday[:, j].astype(int).tolist()
            if pr is not None:
                tcc = S.get('cloud_cover', np.full((H, n), 60.0))[:, j]
                wc = weather_code(np.nan_to_num(pr[:, j]), np.nan_to_num(cp[:, j] if cp is not None else np.zeros(H)), np.nan_to_num(tcc, nan=60))
                hourly[f'weather_code_{key}'] = [None if not np.isfinite(pr[i, j]) else int(wc[i]) for i in range(H)]
                daily[f'precipitation_sum_{key}'] = [None if not np.isfinite(pr[d * 24:(d + 1) * 24, j]).any() else round(float(np.nansum(pr[d * 24:(d + 1) * 24, j])), 2) for d in range(days)]
            if cp is not None:
                daily[f'cape_mean_{key}'] = [None if not np.isfinite(cp[d * 24:(d + 1) * 24, j]).any() else round(float(np.nanmean(cp[d * 24:(d + 1) * 24, j])), 1) for d in range(days)]
                daily[f'cape_max_{key}'] = [None if not np.isfinite(cp[d * 24:(d + 1) * 24, j]).any() else round(float(np.nanmax(cp[d * 24:(d + 1) * 24, j])), 1) for d in range(days)]
        points.append({'lat': float(lats[j]), 'lon': float(lons[j]), 'hourly': hourly, 'daily': daily})
    return {'source': 'aws', 'init_utc': init.isoformat(), 'day0_utc': day0.isoformat(), 'model_runs': runs,
            'models': list(series), 'points': points}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('coords')
    ap.add_argument('out')
    ap.add_argument('--init')
    ap.add_argument('--days', type=int, default=3)
    a = ap.parse_args()
    if a.init:
        init = datetime.fromisoformat(a.init).replace(tzinfo=ZoneInfo('Europe/London')).astimezone(timezone.utc)
    else:
        now = datetime.now(timezone.utc).astimezone(ZoneInfo('Europe/London'))
        h = 15 if now.hour >= 15 else 3
        init = now.replace(hour=h, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    coords = json.load(open(a.coords))
    res = build(coords, init, a.days)
    with gzip.open(a.out, 'wt') as f:
        json.dump(res, f)
    print(json.dumps({'points': len(res['points']), 'models': res['models'], 'runs': res['model_runs']}))
