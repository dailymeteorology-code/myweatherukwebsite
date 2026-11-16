"""Soundings, cross-sections and back-trajectories from NOAA GFS (16 Nov 2026, at the user's request:
"Skew-T at a pin", "cross-section", "back-trajectories").

Data: NOAA's NOMADS grib filter (keyless), asked for only the box around the place or the line, so a
profile is one download of a few tens of kB: temperature, humidity, wind and height on 21 pressure
levels from 1000 to 100 hPa, and the surface. Back-trajectories use the 1-degree GFS (wind and
vertical motion on 17 levels over the North Atlantic and Europe), the run's own forecast hours back
to its start and the earlier runs' analyses before that. Everything is cached on D: (modeldata/sounding).

    python -m mdata.sounding profile <run iso> <step> <lat> <lon>
    python -m mdata.sounding section <run iso> <step> <lat1> <lon1> <lat2> <lon2>
    python -m mdata.sounding trajectory <run iso> <step> <lat> <lon> [hours back]
Each prints one JSON object.
"""
from __future__ import annotations

import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA

CACHE = DATA / 'sounding'
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100]
TRAJ_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 400, 300, 250, 200]
TRAJ_BOX = (-90.0, 50.0, 20.0, 82.0)          # west, east, south, north: where air reaching the UK can come from in five days
RD, CP, LV, EPS, G = 287.04, 1005.7, 2.501e6, 0.622, 9.80665
UA = 'MyWeatherUK-modeldata/1.0'


def _utc(s):
    return datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(timezone.utc)


# ── fetching ──────────────────────────────────────────────────────────────────────────────────────

def _nomads(res, run, step, variables, levels, box):
    """One NOMADS filter download (cached): GRIB2 bytes of `variables` on `levels` in box (w, e, s, n)."""
    w, e, s, n = box
    name = f"gfs{res}_{run:%Y%m%d%H}_f{step:03d}_{'-'.join(variables)}_{len(levels)}_{w:.2f}_{e:.2f}_{s:.2f}_{n:.2f}.grb2"
    f = CACHE / name
    if f.exists() and f.stat().st_size > 0:
        return f.read_bytes()
    q = {'dir': f'/gfs.{run:%Y%m%d}/{run:%H}/atmos', 'file': f'gfs.t{run:%H}z.pgrb2.{res}.f{step:03d}',
         'subregion': '', 'leftlon': f'{w:.2f}', 'rightlon': f'{e:.2f}', 'toplat': f'{n:.2f}', 'bottomlat': f'{s:.2f}'}
    for v in variables:
        q[f'var_{v}'] = 'on'
    for lev in levels:
        q[f'lev_{lev}'] = 'on'
    url = f"https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_{res}.pl?{urllib.parse.urlencode(q)}"
    last = None
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                body = r.read()
            if body[:4] != b'GRIB':
                raise IOError(f'NOMADS gave no GRIB ({body[:80]!r})')
            CACHE.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix('.tmp')
            tmp.write_bytes(body)
            tmp.replace(f)
            return body
        except Exception as ex:                       # noqa: BLE001
            last = ex
            time.sleep(1.5 * (k + 1))
    raise last


def _messages(body):
    """GRIB2 bytes -> {(shortName, typeOfLevel, level): (values N->S, lats, lons)}."""
    import eccodes
    out = {}
    msgs, i = [], 0
    while True:                                           # GRIB2: 'GRIB', then its whole length at bytes 8-16
        j = body.find(b'GRIB', i)
        if j < 0 or j + 16 > len(body):
            break
        n = int.from_bytes(body[j + 8:j + 16], 'big')
        msgs.append(body[j:j + n])
        i = j + max(n, 16)
    for msg in msgs:
        h = eccodes.codes_new_from_message(msg)
        if h is not None:
            try:
                key = (eccodes.codes_get(h, 'shortName'), eccodes.codes_get(h, 'typeOfLevel'), int(eccodes.codes_get(h, 'level')))
                ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
                la0, la1 = eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees'), eccodes.codes_get(h, 'latitudeOfLastGridPointInDegrees')
                lo0, dlo = eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees'), eccodes.codes_get(h, 'iDirectionIncrementInDegrees')
                vals = eccodes.codes_get_values(h).reshape(nj, ni).astype(np.float64)
                lats = np.linspace(la0, la1, nj)
                lons = (lo0 + dlo * np.arange(ni) + 180.0) % 360.0 - 180.0
                if lats[0] < lats[-1]:
                    vals, lats = vals[::-1], lats[::-1]
                out[key] = (vals, lats, lons)
            finally:
                eccodes.codes_release(h)
    return out


def _at(field, lat, lon):
    """Bilinear value of a (values, lats N->S, lons) field at a point."""
    vals, lats, lons = field
    fj = (lats[0] - lat) / (lats[0] - lats[1]) if lats.size > 1 else 0.0
    lo = (lon - lons[0] + 540.0) % 360.0 - 180.0 + lons[0]
    fi = (lo - lons[0]) / (lons[1] - lons[0]) if lons.size > 1 else 0.0
    j0 = int(np.clip(math.floor(fj), 0, max(0, lats.size - 2)))
    i0 = int(np.clip(math.floor(fi), 0, max(0, lons.size - 2)))
    tj = float(np.clip(fj - j0, 0, 1)) if lats.size > 1 else 0.0
    ti = float(np.clip(fi - i0, 0, 1)) if lons.size > 1 else 0.0
    j1, i1 = min(j0 + 1, lats.size - 1), min(i0 + 1, lons.size - 1)
    return float((1 - tj) * ((1 - ti) * vals[j0, i0] + ti * vals[j0, i1]) + tj * ((1 - ti) * vals[j1, i0] + ti * vals[j1, i1]))


# ── thermodynamics ────────────────────────────────────────────────────────────────────────────────

def es_hpa(tk):
    """Saturation vapour pressure over water (hPa), Bolton 1980."""
    return 6.112 * np.exp(17.67 * (tk - 273.15) / (tk - 29.65))


def rs(tk, p):
    e = es_hpa(tk)
    return EPS * e / np.maximum(p - e, 1e-3)


def dew_from_rh(tk, rh):
    e = np.clip(rh, 0.5, 100.0) / 100.0 * es_hpa(tk)
    a = np.log(e / 6.112)
    return 243.5 * a / (17.67 - a)                   # deg C


def tv(tk, p, td_k=None):
    """Virtual temperature (K): with the dew point given, from its mixing ratio; else saturated."""
    r = rs(td_k if td_k is not None else tk, p)
    return tk * (1 + r / EPS) / (1 + r)


def moist_dtdp(tk, p):
    r = rs(tk, p)
    return (RD * tk + LV * r) / (CP + LV * LV * r * EPS / (RD * tk * tk)) / p


def parcel(p_env, t_env, td_env, start=0):
    """Lift a parcel from level `start` (dry to its LCL, then pseudo-adiabatic) through the profile
    (p hPa falling, t and td in C). Returns its LCL, LFC, EL (hPa), CAPE and CIN (J/kg) and its path."""
    p0, t0, d0 = p_env[start], t_env[start] + 273.15, td_env[start] + 273.15
    tl = 1.0 / (1.0 / (d0 - 56.0) + math.log(t0 / d0) / 800.0) + 56.0     # Bolton (1980) LCL temperature
    p_lcl = p0 * (tl / t0) ** (CP / RD)
    ps = np.arange(p0, p_env[-1] - 0.01, -5.0)
    tp = np.empty_like(ps)
    r0 = float(rs(d0, p0))                                                   # its mixing ratio below the LCL
    t = t0
    for k, p in enumerate(ps):
        if p >= p_lcl:
            tp[k] = t0 * (p / p0) ** (RD / CP)
            t = tp[k]
            continue
        if k and ps[k - 1] >= p_lcl:                                         # just past the LCL: start from it
            t = tl
            pa = p_lcl
        else:
            pa = ps[k - 1]
        h = p - pa                                                           # RK4 along the moist adiabat
        k1 = moist_dtdp(t, pa)
        k2 = moist_dtdp(t + h * k1 / 2, pa + h / 2)
        k3 = moist_dtdp(t + h * k2 / 2, pa + h / 2)
        k4 = moist_dtdp(t + h * k3, pa + h)
        t = t + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        tp[k] = t
    lnp = np.log(p_env[::-1])
    te = np.interp(np.log(ps), lnp, (t_env + 273.15)[::-1])
    de = np.interp(np.log(ps), lnp, (td_env + 273.15)[::-1])
    tvp = np.where(ps >= p_lcl, tp * (1 + r0 / EPS) / (1 + r0), tv(tp, ps))
    tve = tv(te, ps, de)
    buoy = tvp - tve
    dlnp = -np.diff(np.log(ps))
    mid = (buoy[1:] + buoy[:-1]) / 2
    pos = np.flatnonzero(buoy > 0)
    lfc = el = None
    cape = cin = 0.0
    if pos.size:
        above = pos[ps[pos] <= p_lcl + 1e-6] if (ps[pos] <= p_lcl + 1e-6).any() else pos
        i_lfc = int(above[0])
        lfc = float(ps[i_lfc])
        i_el = i_lfc
        while i_el + 1 < ps.size and buoy[i_el + 1] > 0:
            i_el += 1
        # the deepest positive layer from the LFC up, allowing short dips back below zero
        last_pos = int(pos[pos >= i_lfc].max())
        i_el = last_pos
        el = float(ps[min(i_el + 1, ps.size - 1)])
        seg = slice(i_lfc, i_el)
        cape = float(RD * np.sum(np.clip(mid[seg], 0, None) * dlnp[seg]))
        cin = float(RD * np.sum(np.clip(mid[:i_lfc], None, 0) * dlnp[:i_lfc]))
    return {'lcl': round(p_lcl, 1), 'lfc': None if lfc is None else round(lfc, 1), 'el': None if el is None else round(el, 1),
            'cape': round(max(cape, 0.0)), 'cin': round(min(cin, 0.0)),
            'path': [[round(float(p), 1), round(float(t) - 273.15, 2)] for p, t in zip(ps[::4], tp[::4])]}


def _height_at(p, levels):
    """Height (m above sea level) at pressure p from the profile's levels [(p, z)], log-linear."""
    ps = np.array([x[0] for x in levels])[::-1]
    zs = np.array([x[1] for x in levels])[::-1]
    return float(np.interp(math.log(p), np.log(ps), zs))


def _bunkers(levels, sfc_z):
    """Bunkers right-mover storm motion (m/s), 0-6 km shear (m/s) and 0-1 / 0-3 km storm-relative
    helicity (m2/s2), from levels [(p, z, u, v)] (m/s)."""
    z = np.array([x[1] for x in levels]) - sfc_z
    u = np.array([x[2] for x in levels])
    v = np.array([x[3] for x in levels])
    o = np.argsort(z)
    z, u, v = z[o], u[o], v[o]
    def wind_at(h):
        return float(np.interp(h, z, u)), float(np.interp(h, z, v))
    hs = np.linspace(0, 6000, 61)
    mu, mv = np.mean([wind_at(h)[0] for h in hs]), np.mean([wind_at(h)[1] for h in hs])
    u0, v0 = wind_at(0)
    u6, v6 = wind_at(6000)
    su, sv = u6 - u0, v6 - v0
    mag = math.hypot(su, sv) or 1.0
    ru, rv = mu + 7.5 * sv / mag, mv - 7.5 * su / mag
    def srh(top):
        hh = np.linspace(0, top, int(top / 100) + 1)
        w = [wind_at(h) for h in hh]
        total = 0.0
        for (ua, va), (ub, vb) in zip(w[:-1], w[1:]):
            total += (ub - ru) * (va - rv) - (ua - ru) * (vb - rv)
        return total
    return {'storm': [round(ru, 1), round(rv, 1)], 'shear06': round(mag, 1), 'srh01': round(srh(1000)), 'srh03': round(srh(3000))}


# ── a profile ─────────────────────────────────────────────────────────────────────────────────────

def profile(run_s, step, lat, lon):
    run, step, lat, lon = _utc(run_s), int(step), float(lat), float(lon)
    box = (lon - 0.5, lon + 0.5, lat - 0.5, lat + 0.5)
    body = _nomads('0p25', run, step, ['HGT', 'TMP', 'RH', 'UGRD', 'VGRD', 'DPT', 'PRES'],
                   [f'{p}_mb' for p in LEVELS] + ['2_m_above_ground', '10_m_above_ground', 'surface'], box)
    m = _messages(body)
    get = lambda name, typ, lev: _at(m[(name, typ, lev)], lat, lon) if (name, typ, lev) in m else None   # noqa: E731
    psfc = get('sp', 'surface', 0)
    psfc = psfc / 100.0 if psfc else 1013.25
    zsfc = get('orog', 'surface', 0) or get('gh', 'surface', 0) or 0.0
    t2, d2 = get('2t', 'heightAboveGround', 2), get('2d', 'heightAboveGround', 2)
    u10, v10 = get('10u', 'heightAboveGround', 10), get('10v', 'heightAboveGround', 10)
    rows = []
    for p in LEVELS:
        t = get('t', 'isobaricInhPa', p)
        if t is None or p > psfc - 1:
            continue
        rh = get('r', 'isobaricInhPa', p)
        rows.append({'p': p, 'z': round(get('gh', 'isobaricInhPa', p) or 0.0), 't': round(t - 273.15, 2),
                     'td': round(float(dew_from_rh(t, rh if rh is not None else 50.0)), 2),
                     'u': round(get('u', 'isobaricInhPa', p) or 0.0, 2), 'v': round(get('v', 'isobaricInhPa', p) or 0.0, 2)})
    sfc = {'p': round(psfc, 1), 'z': round(zsfc), 't': round((t2 or 273.15) - 273.15, 2), 'td': round((d2 or 273.15) - 273.15, 2),
           'u': round(u10 or 0.0, 2), 'v': round(v10 or 0.0, 2)}
    prof = [sfc] + rows
    p_env = np.array([x['p'] for x in prof], float)
    t_env = np.array([x['t'] for x in prof], float)
    d_env = np.array([x['td'] for x in prof], float)
    sb = parcel(p_env, t_env, d_env, 0)
    # the most unstable parcel among the levels in the lowest 300 hPa (by its equivalent potential temperature)
    def theta_e(p, t, td):
        tk, dk = t + 273.15, td + 273.15
        r = float(rs(dk, p))
        tl = 1.0 / (1.0 / (dk - 56.0) + math.log(tk / dk) / 800.0) + 56.0
        return tk * (1000.0 / p) ** (0.2854 * (1 - 0.28 * r)) * math.exp((3.376 / tl - 0.00254) * r * 1000 * (1 + 0.81 * r))
    low = [i for i, x in enumerate(prof) if x['p'] >= psfc - 300]
    mu_i = max(low, key=lambda i: theta_e(prof[i]['p'], prof[i]['t'], prof[i]['td']))
    mu = sb if mu_i == 0 else parcel(p_env[mu_i:], t_env[mu_i:], d_env[mu_i:], 0)
    lv = [(x['p'], x['z'] if x is not sfc else zsfc, x['u'], x['v']) for x in prof]
    lv = [(sfc['p'], zsfc, sfc['u'], sfc['v'])] + [(x['p'], x['z'], x['u'], x['v']) for x in rows]
    kin = _bunkers(lv, zsfc)
    # precipitable water (mm): the column's water vapour
    q = [float(rs(x['td'] + 273.15, x['p'])) for x in prof]
    pw = sum((q[i] + q[i + 1]) / 2 * (prof[i]['p'] - prof[i + 1]['p']) * 100 / G for i in range(len(prof) - 1))
    zl = [(x['p'], x['z']) for x in rows]
    hgt = lambda p: None if p is None or len(zl) < 2 else round(_height_at(p, [(sfc['p'], zsfc)] + zl) - zsfc)   # noqa: E731
    t850 = next((x['t'] for x in rows if x['p'] == 850), None)
    t500 = next((x['t'] for x in rows if x['p'] == 500), None)
    t700 = next((x['t'] for x in rows if x['p'] == 700), None)
    z850 = next((x['z'] for x in rows if x['p'] == 850), None)
    z500 = next((x['z'] for x in rows if x['p'] == 500), None)
    z700 = next((x['z'] for x in rows if x['p'] == 700), None)
    lapse = lambda ta, tb, za, zb: None if None in (ta, tb, za, zb) or zb == za else round((ta - tb) / ((zb - za) / 1000), 1)   # noqa: E731
    frz = None
    for a, b in zip(prof[:-1], prof[1:]):
        if a['t'] >= 0 > b['t']:
            za = zsfc if a is sfc else a['z']
            frz = round(za + (b['z'] - za) * a['t'] / (a['t'] - b['t']) - zsfc)
            break
    return {
        'model': 'GFS 0.25°', 'run': run.isoformat(), 'step': step, 'valid': (run + timedelta(hours=step)).isoformat(),
        'lat': lat, 'lon': lon, 'surface': sfc, 'levels': rows,
        'parcels': {'surface': {**sb, 'lcl_m': hgt(sb['lcl']), 'lfc_m': hgt(sb['lfc']), 'el_m': hgt(sb['el'])},
                    'most_unstable': {**mu, 'from': prof[mu_i]['p'], 'lcl_m': hgt(mu['lcl']), 'lfc_m': hgt(mu['lfc']), 'el_m': hgt(mu['el'])}},
        'indices': {'pw_mm': round(pw, 1), 'lapse_850_500': lapse(t850, t500, z850, z500), 'lapse_700_500': lapse(t700, t500, z700, z500),
                    'freezing_level_m': frz, **kin},
    }


# ── a cross-section ───────────────────────────────────────────────────────────────────────────────

def _great_circle(lat1, lon1, lat2, lon2, n):
    p1, l1, p2, l2 = map(math.radians, (lat1, lon1, lat2, lon2))
    d = 2 * math.asin(math.sqrt(math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((l2 - l1) / 2) ** 2))
    out = []
    for k in range(n):
        f = k / (n - 1)
        if d == 0:
            out.append((lat1, lon1))
            continue
        a, b = math.sin((1 - f) * d) / math.sin(d), math.sin(f * d) / math.sin(d)
        x = a * math.cos(p1) * math.cos(l1) + b * math.cos(p2) * math.cos(l2)
        y = a * math.cos(p1) * math.sin(l1) + b * math.cos(p2) * math.sin(l2)
        z = a * math.sin(p1) + b * math.sin(p2)
        out.append((math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))))
    return out, d * 6371.0


def section(run_s, step, lat1, lon1, lat2, lon2, n=72):
    run, step = _utc(run_s), int(step)
    lat1, lon1, lat2, lon2 = map(float, (lat1, lon1, lat2, lon2))
    pts, km = _great_circle(lat1, lon1, lat2, lon2, n)
    la = [p[0] for p in pts]
    lo = [p[1] for p in pts]
    box = (min(lo) - 0.5, max(lo) + 0.5, min(la) - 0.5, max(la) + 0.5)
    body = _nomads('0p25', run, step, ['HGT', 'TMP', 'RH', 'UGRD', 'VGRD', 'VVEL', 'PRES'], [f'{p}_mb' for p in LEVELS] + ['surface'], box)
    m = _messages(body)
    brg = math.atan2(math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)), math.radians(lat2 - lat1))
    au, av = math.sin(brg), math.cos(brg)                 # along the line (unit, east and north parts)
    grid = {k: [] for k in ('t', 'rh', 'theta', 'thetae', 'wind', 'along', 'across', 'w', 'z')}
    for p in LEVELS:
        row = {k: [] for k in grid}
        for la_, lo_ in pts:
            t = _at(m[('t', 'isobaricInhPa', p)], la_, lo_)
            rh = _at(m[('r', 'isobaricInhPa', p)], la_, lo_)
            u = _at(m[('u', 'isobaricInhPa', p)], la_, lo_)
            v = _at(m[('v', 'isobaricInhPa', p)], la_, lo_)
            w = _at(m[('w', 'isobaricInhPa', p)], la_, lo_) if ('w', 'isobaricInhPa', p) in m else 0.0
            td = float(dew_from_rh(t, rh)) + 273.15
            r = float(rs(td, p))
            th = t * (1000.0 / p) ** 0.2854
            tl = 1.0 / (1.0 / (td - 56.0) + math.log(t / td) / 800.0) + 56.0
            the = t * (1000.0 / p) ** (0.2854 * (1 - 0.28 * r)) * math.exp((3.376 / tl - 0.00254) * r * 1000 * (1 + 0.81 * r))
            row['t'].append(round(t - 273.15, 1)); row['rh'].append(round(rh)); row['theta'].append(round(th, 1)); row['thetae'].append(round(the, 1))
            row['wind'].append(round(math.hypot(u, v) * 1.943844, 1))
            row['along'].append(round((u * au + v * av) * 1.943844, 1)); row['across'].append(round((-u * av + v * au) * 1.943844, 1))
            row['w'].append(round(w, 3)); row['z'].append(round(_at(m[('gh', 'isobaricInhPa', p)], la_, lo_)))
        for k in grid:
            grid[k].append(row[k])
    psfc = [round(_at(m[('sp', 'surface', 0)], la_, lo_) / 100.0, 1) if ('sp', 'surface', 0) in m else 1013.0 for la_, lo_ in pts]
    return {'model': 'GFS 0.25°', 'run': run.isoformat(), 'step': step, 'valid': (run + timedelta(hours=step)).isoformat(),
            'from': [lat1, lon1], 'to': [lat2, lon2], 'km': round(km), 'lats': [round(x, 3) for x in la], 'lons': [round(x, 3) for x in lo],
            'levels': LEVELS, 'surface_p': psfc, **grid}


# ── back-trajectories ─────────────────────────────────────────────────────────────────────────────

_SLICES = {}


def _slice(cycle, f):
    """u, v (m/s) and omega (Pa/s) on TRAJ_LEVELS from one GFS 1-degree file: arrays (levels, lat N->S, lon)."""
    key = (cycle, f)
    if key not in _SLICES:
        body = _nomads('1p00', cycle, f, ['UGRD', 'VGRD', 'VVEL'], [f'{p}_mb' for p in TRAJ_LEVELS], TRAJ_BOX)
        m = _messages(body)
        u = np.stack([m[('u', 'isobaricInhPa', p)][0] for p in TRAJ_LEVELS])
        v = np.stack([m[('v', 'isobaricInhPa', p)][0] for p in TRAJ_LEVELS])
        w = np.stack([m[('w', 'isobaricInhPa', p)][0] for p in TRAJ_LEVELS])
        _, lats, lons = m[('u', 'isobaricInhPa', TRAJ_LEVELS[0])]
        _SLICES[key] = (u, v, w, lats, lons)
    return _SLICES[key]


def _source(run, t):
    """The GFS file for time t: the run's own forecast from its start on; before it, the latest earlier
    run's analysis or 3-hour forecast."""
    if t >= run:
        return run, int(round((t - run).total_seconds() / 3600))
    c = t.replace(minute=0, second=0, microsecond=0)
    c -= timedelta(hours=c.hour % 6)
    return c, int(round((t - c).total_seconds() / 3600))


def trajectory(run_s, step, lat, lon, hours=72, starts=(925, 850, 700, 500)):
    """Where the air arriving over the place at the valid time came from: traced back `hours` in
    one-hour steps (Runge-Kutta, the wind and vertical motion between the three-hourly files drawn in
    time and space), from each starting pressure level."""
    run, step, lat0, lon0, hours = _utc(run_s), int(step), float(lat), float(lon), int(hours)
    vt = run + timedelta(hours=step)
    times = [vt - timedelta(hours=k) for k in range(0, hours + 1, 3)]
    slices = {}
    for t in times:
        c, f = _source(run, t)
        slices[t] = _slice(c, f)
    lnp = np.log(np.array(TRAJ_LEVELS, float))

    def wind(t, la, lo, p):
        """(u, v, omega) at a time between two slices."""
        ts = sorted(slices)
        t1 = min((x for x in ts if x >= t), default=ts[-1])
        t0 = max((x for x in ts if x <= t), default=ts[0])
        def one(sl):
            u, v, w, lats, lons = sl
            fj = (lats[0] - la) / (lats[0] - lats[1])
            fi = (((lo - lons[0]) + 360.0) % 360.0) / (lons[1] - lons[0])
            fk = float(np.interp(math.log(p), lnp[::-1], np.arange(len(TRAJ_LEVELS))[::-1]))
            j0, i0, k0 = int(np.clip(math.floor(fj), 0, lats.size - 2)), int(np.clip(math.floor(fi), 0, lons.size - 2)), int(np.clip(math.floor(fk), 0, len(TRAJ_LEVELS) - 2))
            tj, ti, tk = np.clip(fj - j0, 0, 1), np.clip(fi - i0, 0, 1), np.clip(fk - k0, 0, 1)
            out = []
            for a in (u, v, w):
                c = a[k0:k0 + 2, j0:j0 + 2, i0:i0 + 2]
                c = c[0] * (1 - tk) + c[1] * tk
                c = c[0] * (1 - tj) + c[1] * tj
                out.append(float(c[0] * (1 - ti) + c[1] * ti))
            return out
        a = one(slices[t0])
        if t1 == t0:
            return a
        b = one(slices[t1])
        f = (t - t0).total_seconds() / (t1 - t0).total_seconds()
        return [x + f * (y - x) for x, y in zip(a, b)]

    def move(la, lo, p, u, v, w, dt):
        dla = v * dt / 111195.0
        dlo = u * dt / (111195.0 * max(math.cos(math.radians(la)), 0.05))
        return la + dla, lo + dlo, float(np.clip(p + w * dt / 100.0, TRAJ_LEVELS[-1], TRAJ_LEVELS[0]))

    out = []
    for p0 in starts:
        la, lo, p, t = lat0, lon0, float(p0), vt
        path = [[round(la, 3), round(lo, 3), round(p), 0]]
        dt = -3600.0
        for k in range(1, hours + 1):
            u1, v1, w1 = wind(t, la, lo, p)
            lam, lom, pm = move(la, lo, p, u1, v1, w1, dt / 2)
            u2, v2, w2 = wind(t + timedelta(seconds=dt / 2), lam, lom, pm)
            la, lo, p = move(la, lo, p, u2, v2, w2, dt)
            t = t + timedelta(seconds=dt)
            if k % 3 == 0:
                path.append([round(la, 3), round(lo, 3), round(p), -k])
            if not (TRAJ_BOX[2] <= la <= TRAJ_BOX[3] and TRAJ_BOX[0] <= lo <= TRAJ_BOX[1]):
                break                                     # left the area the wind is known in
        out.append({'from_p': p0, 'path': path})
    return {'model': 'GFS 1°', 'run': run.isoformat(), 'step': step, 'valid': vt.isoformat(), 'lat': lat0, 'lon': lon0, 'hours': hours,
            'trajectories': out}


if __name__ == '__main__':
    import warnings
    warnings.filterwarnings('ignore')
    cmd, args = sys.argv[1], sys.argv[2:]
    try:
        res = {'profile': profile, 'section': section, 'trajectory': trajectory}[cmd](*args)
        print(json.dumps(res, separators=(',', ':')))
    except Exception as e:                                # noqa: BLE001
        print(json.dumps({'error': f'{type(e).__name__}: {e}'[:300]}))
        sys.exit(1)
