"""Multi-model thunderstorm outlook for one UK outlook day, from AWS open data only.

    python blend.py 2026-10-18 out.json

MODELS (all read straight from their AWS buckets, newest run that covers the day):
    UKV 2 km               met-office-atmospheric-model-data / uk-deterministic-2km     (NetCDF, LAEA)
    HARMONIE-AROME DINI    dmi-opendata / forecastdata/HARMONIE_DINI_SF                 (GRIB2, Lambert)
    ECMWF IFS HRES 0.25°   ecmwf-forecasts / {date}/{HH}z/ifs/0p25/oper                 (GRIB2, byte ranges)
    Met Office Global 10km met-office-atmospheric-model-data / global-deterministic-10km (NetCDF)
    GFS 0.25°              noaa-gfs-bdp-pds / gfs.{date}/{HH}/atmos                     (GRIB2, byte ranges)

OUTLOOK DAY: 06:00 to 06:00 UK time (the graphic's timeline), sampled hourly for the
hourly models and 3-hourly for ECMWF.

THUNDER SIGNAL per model and hour, on one 0.05° UK grid:
    proxy  = s(MU CAPE; 150→800 J/kg) × s(precip rate; 0.5→4 mm/h) × CIN factor
    UKV also forecasts lightning explicitly (flashes per km² per hour); there the signal is
    the larger of the proxy and the lightning. (DMI's HARMONIE files carry a local category-17
    field, but it is high where HARMONIE itself has no CAPE and no rain, so it is not used.)
The signal is then taken as the highest within ~24 km (the graphic's "15 mile radius"),
and the day value is the highest hour, capped by how far each model can be trusted to
place convection (0.85 for the convection-permitting UKV/HARMONIE, 0.7 for the others).

BLEND: weighted mean of the models covering each point (weights below), in percent.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import math
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import eccodes
import netCDF4
import numpy as np
from pyproj import Transformer
from scipy.ndimage import gaussian_filter, maximum_filter
from scipy.spatial import cKDTree

UA = {'User-Agent': 'MyWeatherUK-storm-blend/1.0'}
# wider than the UK map so zoomed region views (South England) have data to their edges
LAT = np.arange(48.0, 61.5001, 0.05)
LON = np.arange(-11.5, 4.0001, 0.05)
GLON, GLAT = np.meshgrid(LON, LAT)            # row 0 = south
WEIGHTS = {'ukv': 0.30, 'harmonie': 0.24, 'ecmwf': 0.20, 'mo_global': 0.13, 'gfs': 0.13}
LABELS = {'ukv': 'UKV 2 km', 'harmonie': 'HARMONIE-AROME', 'ecmwf': 'ECMWF IFS', 'mo_global': 'Met Office Global', 'gfs': 'GFS'}
CAP = {'ukv': 0.85, 'harmonie': 0.85, 'ecmwf': 0.7, 'mo_global': 0.7, 'gfs': 0.7}
_codes = threading.Lock()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, rng=None, tries=10):
    last = None
    for i in range(tries):
        h = dict(UA)
        if rng:
            h['Range'] = f'bytes={rng[0]}-{rng[1]}'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise
            if e.code in (429, 503):                 # S3 "Slow Down": back off properly
                time.sleep(4 * (i + 1))
                continue
        except Exception as e:
            last = e
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'{url}: {last}')


def exists(url):
    try:
        req = urllib.request.Request(url, headers=UA, method='HEAD')
        with urllib.request.urlopen(req, timeout=30):
            return True
    except Exception:
        return False


def s(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def uk_hours(day):
    """UTC hours from 06:00 UK time on `day` to 06:00 the next day (BST/GMT aware)."""
    from zoneinfo import ZoneInfo
    tz = ZoneInfo('Europe/London')
    d = datetime.fromisoformat(day)
    start = datetime(d.year, d.month, d.day, 6, tzinfo=tz).astimezone(timezone.utc)
    return [start + timedelta(hours=h) for h in range(25)]


# ── regridding helpers (nearest source cell for every target point) ──────────

def idx_regular(lat_axis, lon_axis, lon360=False):
    lons = np.where(GLON < 0, GLON + 360, GLON) if lon360 else GLON
    iy = np.abs(lat_axis[:, None] - GLAT.ravel()[None, :]).argmin(0)
    ix = np.abs(lon_axis[:, None] - lons.ravel()[None, :]).argmin(0)
    return iy.reshape(GLAT.shape), ix.reshape(GLAT.shape)


# ── UKV ──────────────────────────────────────────────────────────────────────

MO = 'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com'


def mo_runs(model, hours):
    """Newest Met Office run with every hour of the window."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    for k in range(0, 48):
        run = now - timedelta(hours=k)
        if model != 'uk-deterministic-2km' and run.hour % 6:
            continue
        last = hours[-1]
        key = f'{model}/{run:%Y%m%dT%H%MZ}/{last:%Y%m%dT%H%MZ}-PT{int((last - run).total_seconds() // 3600):04d}H00M-precipitation_accumulation-PT01H.nc'
        if exists(f'{MO}/{key}'):
            return run
    raise RuntimeError(f'no {model} run covers the day')


def mo_field(model, run, vt, name):
    lead = int((vt - run).total_seconds() // 3600)
    ds = netCDF4.Dataset('x', memory=get(f'{MO}/{model}/{run:%Y%m%dT%H%MZ}/{vt:%Y%m%dT%H%MZ}-PT{lead:04d}H00M-{name}.nc'))
    var = [v for v in ds.variables.values() if v.ndim == 2][0]
    return ds, np.ma.filled(var[:].astype(np.float32), 0)


def load_ukv(hours):
    model = 'uk-deterministic-2km'
    run = mo_runs(model, hours)
    log(f'UKV run {run:%Y-%m-%d %HZ}')
    ds, _ = mo_field(model, run, hours[0], 'CAPE_most_unstable_below_500hPa')
    gm = ds.variables['lambert_azimuthal_equal_area']
    tr = Transformer.from_crs('EPSG:4326', f'+proj=laea +lat_0={gm.latitude_of_projection_origin} +lon_0={gm.longitude_of_projection_origin} '
                              f'+a={gm.semi_major_axis} +b={gm.semi_minor_axis} +units=m', always_xy=True)
    x, y = tr.transform(GLON, GLAT)
    xs, ys = ds.variables['projection_x_coordinate'][:], ds.variables['projection_y_coordinate'][:]
    ix = np.clip(np.round((x - xs[0]) / (xs[1] - xs[0])).astype(int), 0, len(xs) - 1)
    iy = np.clip(np.round((y - ys[0]) / (ys[1] - ys[0])).astype(int), 0, len(ys) - 1)

    def one(vt):
        f = {}
        for k, n in [('cape', 'CAPE_most_unstable_below_500hPa'), ('precip', 'precipitation_accumulation-PT01H'),
                     ('lightning', 'lightning_flash_accumulation-PT01H'), ('hail', 'hail_fall_accumulation-PT01H'),
                     ('gust', 'wind_gust_at_10m_max-PT01H')]:
            try:
                _, a = mo_field(model, run, vt, n)
                a = a[iy, ix]
                # UKV NetCDF units: precipitation and hail in metres, lightning in flashes per m²
                f[k] = a * 1000 if k in ('precip', 'hail') else a * 1e6 if k == 'lightning' else a
            except Exception:
                pass
        return vt, f
    with cf.ThreadPoolExecutor(8) as ex:
        steps = dict(ex.map(one, hours))
    return {'run': run.isoformat(), 'steps': steps}


def load_mo_global(hours):
    model = 'global-deterministic-10km'
    run = mo_runs(model, hours)
    log(f'MO Global run {run:%Y-%m-%d %HZ}')
    ds, _ = mo_field(model, run, hours[0], 'CAPE_most_unstable_below_500hPa')
    iy, ix = idx_regular(ds.variables['latitude'][:], ds.variables['longitude'][:])
    sample = hours[::3]

    def one(vt):
        f = {}
        for k, n in [('cape', 'CAPE_most_unstable_below_500hPa'), ('precip', 'precipitation_accumulation-PT01H'), ('gust', 'wind_gust_at_10m_max-PT01H')]:
            try:
                _, a = mo_field(model, run, vt, n)
                f[k] = a[iy, ix] * 1000 if k == 'precip' else a[iy, ix]
            except Exception:
                pass
        return vt, f
    with cf.ThreadPoolExecutor(6) as ex:
        steps = dict(ex.map(one, sample))
    return {'run': run.isoformat(), 'steps': steps}


# ── GRIB via byte ranges (GFS, ECMWF, HARMONIE) ──────────────────────────────

def decode(msg):
    with _codes:
        h = eccodes.codes_new_from_message(msg)
        try:
            vals = eccodes.codes_get_values(h)
            meta = {k: eccodes.codes_get(h, k) for k in ('gridType', 'Ni', 'Nj', 'latitudeOfFirstGridPointInDegrees', 'longitudeOfFirstGridPointInDegrees') if eccodes.codes_is_defined(h, k)}
            if meta.get('gridType') == 'lambert':
                meta['lats'] = eccodes.codes_get_array(h, 'latitudes')
                meta['lons'] = eccodes.codes_get_array(h, 'longitudes')
        finally:
            eccodes.codes_release(h)
    return vals, meta


GFS = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'


def wgrib_ranges(idx_text):
    lines = [l for l in idx_text.splitlines() if l.strip()]
    out = []
    for i, l in enumerate(lines):
        p = l.split(':')
        end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
        out.append((p, int(p[1]), end))
    return out


def load_gfs(hours):
    now = datetime.now(timezone.utc)
    for k in range(0, 48, 6):
        run = (now - timedelta(hours=k)).replace(hour=((now - timedelta(hours=k)).hour // 6) * 6, minute=0, second=0, microsecond=0)
        f = int((hours[-1] - run).total_seconds() // 3600)
        if exists(f'{GFS}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{f:03d}.idx'):
            break
    log(f'GFS run {run:%Y-%m-%d %HZ}')
    iy, ix = idx_regular(np.arange(90, -90.001, -0.25), np.arange(0, 360, 0.25), lon360=True)
    want = {'cape': ('CAPE', '180-0 mb above ground'), 'cin': ('CIN', '180-0 mb above ground'), 'precip': ('PRATE', 'surface'), 'gust': ('GUST', 'surface')}

    def one(vt):
        f = int((vt - run).total_seconds() // 3600)
        base = f'{GFS}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{f:03d}'
        recs = wgrib_ranges(get(base + '.idx').decode())
        out = {}
        for k, (var, lev) in want.items():
            r = next((r for r in recs if r[0][3] == var and r[0][4] == lev and 'ave' not in r[0][5]), None)
            if not r:
                continue
            vals, meta = decode(get(base, (r[1], r[2])))
            a = vals.reshape(meta['Nj'], meta['Ni'])[iy, ix].astype(np.float32)
            out[k] = a * 3600 if k == 'precip' else a
        return vt, out
    with cf.ThreadPoolExecutor(6) as ex:
        steps = dict(ex.map(one, hours))
    return {'run': run.isoformat(), 'steps': steps}


ECM = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com'


def load_ecmwf(hours):
    now = datetime.now(timezone.utc)
    sample = [h for h in hours if h.hour % 3 == 0]
    for k in range(0, 48, 6):
        t = now - timedelta(hours=k)
        run = t.replace(hour=(t.hour // 6) * 6, minute=0, second=0, microsecond=0)
        step = int((sample[-1] - run).total_seconds() // 3600)
        if exists(f'{ECM}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/oper/{run:%Y%m%d%H}0000-{step}h-oper-fc.index'):
            break
    log(f'ECMWF run {run:%Y-%m-%d %HZ}')
    iy, ix = idx_regular(np.arange(90, -90.001, -0.25), np.arange(-180, 180, 0.25))

    idx_cache, field_cache = {}, {}

    def field(step, param):
        # one index read per step and one read per field: the bucket throttles hard
        if (step, param) in field_cache:
            return field_cache[(step, param)]
        base = f'{ECM}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/oper/{run:%Y%m%d%H}0000-{step}h-oper-fc'
        if step not in idx_cache:
            idx_cache[step] = [json.loads(l) for l in get(base + '.index').decode().splitlines() if l.strip()]
            time.sleep(0.5)
        r = next((r for r in idx_cache[step] if r.get('param') == param), None)
        out = None
        if r:
            vals, meta = decode(get(base + '.grib2', (r['_offset'], r['_offset'] + r['_length'] - 1)))
            out = vals.reshape(meta['Nj'], meta['Ni'])[iy, ix].astype(np.float32)
            time.sleep(0.5)
        field_cache[(step, param)] = out
        return out

    def one(vt):
        step = int((vt - run).total_seconds() // 3600)
        out = {}
        cape = field(step, 'mucape')
        if cape is not None:
            out['cape'] = cape
        tp1, tp0 = field(step, 'tp'), field(step - 3, 'tp') if step >= 3 else None
        if tp1 is not None:
            out['precip'] = np.maximum(0, tp1 - (tp0 if tp0 is not None else 0)) * 1000 / 3   # m over 3 h -> mm/h
        g = field(step, '10fg3') if step <= 144 else field(step, '10fg')
        if g is not None:
            out['gust'] = g
        return vt, out
    steps = dict(one(vt) for vt in sample)           # serial: the ECMWF bucket throttles hard
    return {'run': run.isoformat(), 'steps': steps}


DMI = 'https://dmi-opendata.s3.eu-north-1.amazonaws.com/forecastdata/HARMONIE_DINI_SF/'


def load_harmonie(hours):
    now = datetime.now(timezone.utc)
    for k in range(0, 48, 3):
        t = now - timedelta(hours=k)
        run = t.replace(hour=(t.hour // 3) * 3, minute=0, second=0, microsecond=0)
        if exists(f'{DMI}HARMONIE_DINI_SF_{run:%Y-%m-%dT%H%M%S}Z_{hours[-1]:%Y-%m-%dT%H%M%S}Z.grib.index'):
            break
    log(f'HARMONIE run {run:%Y-%m-%d %HZ}')
    tree = {'t': None, 'sel': None}

    def regrid(vals, meta):
        if tree['t'] is None:
            lats, lons = meta['lats'], np.where(meta['lons'] > 180, meta['lons'] - 360, meta['lons'])
            sel = np.where((lats > 47) & (lats < 62.5) & (lons > -13) & (lons < 5.5))[0]
            tree['sel'] = sel
            tree['t'] = cKDTree(np.c_[lats[sel], lons[sel] * math.cos(math.radians(55))])
            _, tree['nn'] = tree['t'].query(np.c_[GLAT.ravel(), GLON.ravel() * math.cos(math.radians(55))])
        return vals[tree['sel']][tree['nn']].reshape(GLAT.shape).astype(np.float32)

    def fetch(vt):
        base = f'{DMI}HARMONIE_DINI_SF_{run:%Y-%m-%dT%H%M%S}Z_{vt:%Y-%m-%dT%H%M%S}Z.grib'
        lines = [l for l in get(base + '.index').decode().splitlines() if l.strip()]
        out = {}
        for k, test in [('cape', lambda l: ':CAPE:atmos col' in l), ('cin', lambda l: ':CIN:atmos col' in l),
                        ('tp', lambda l: ':TPRATE:surface' in l),
                        ('gust', lambda l: ':GUST:10 m above ground' in l)]:
            i = next((i for i, l in enumerate(lines) if test(l)), None)
            if i is None:
                continue
            a, b = int(lines[i].split(':')[1]), (int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None)
            vals, meta = decode(get(base, (a, b)))
            out[k] = (vals, meta)
        return vt, out

    raw = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for vt, out in ex.map(fetch, [hours[0] - timedelta(hours=1)] + hours):
            raw[vt] = out
    steps, prev_tp = {}, None
    for vt in sorted(raw):
        out = raw[vt]
        f = {k: regrid(*v) for k, v in out.items()}
        tp = f.pop('tp', None)
        if prev_tp is not None and tp is not None:
            f['precip'] = np.maximum(0, tp - prev_tp)
        prev_tp = tp
        if vt >= hours[0]:
            steps[vt] = f
    return {'run': run.isoformat(), 'steps': steps}


# ── thunder signal + blend ───────────────────────────────────────────────────

DISK = (lambda r: (np.add.outer(np.arange(-r, r + 1) ** 2, np.arange(-r, r + 1) ** 2) <= r * r))(4)


def signal(f, model):
    cape, pr = f.get('cape'), f.get('precip')
    if cape is None or pr is None:
        return None
    p = s(cape, 150, 800) * s(pr, 0.5, 4.0)
    if 'cin' in f:
        p = p * np.clip(1 + f['cin'] / 250.0, 0.3, 1.0)          # CIN is negative
    if 'lightning' in f and model == 'ukv':
        p = np.maximum(p, s(f['lightning'], 0.005, 0.1))       # flashes per km² per hour
    return gaussian_filter(maximum_filter(p, footprint=DISK), 1.2)


def main():
    day, out_path = sys.argv[1], sys.argv[2]
    hours = uk_hours(day)
    loaders = {'ukv': load_ukv, 'harmonie': load_harmonie, 'ecmwf': load_ecmwf, 'mo_global': load_mo_global, 'gfs': load_gfs}
    data, errors = {}, {}
    import os, pickle
    cache = out_path + '.fields.pkl'
    if os.path.exists(cache):                    # re-blend without re-downloading; fetch only what is missing
        data = pickle.load(open(cache, 'rb'))
        loaders = {m: fn for m, fn in loaders.items() if m not in data}
    with cf.ThreadPoolExecutor(5) as ex:
        futs = {ex.submit(fn, hours): m for m, fn in loaders.items()}
        for fu in cf.as_completed(futs):
            m = futs[fu]
            try:
                data[m] = fu.result()
            except Exception as e:
                errors[m] = str(e)
                log(f'{m} FAILED: {e}')
    if loaders:
        pickle.dump(data, open(cache, 'wb'))

    stamps = [hours[0] + timedelta(hours=3 * i) for i in range(9)]              # 06, 09, … 06 UK time
    day_p, stamp_p, extra = {}, {}, {}
    for m, d in data.items():
        sig = {vt: signal(f, m) for vt, f in d['steps'].items()}
        sig = {vt: v for vt, v in sig.items() if v is not None}
        if not sig:
            errors[m] = 'no CAPE/precipitation fields'
            continue
        day_p[m] = np.max(np.stack(list(sig.values())), 0) * CAP[m]
        stamp_p[m] = [np.max(np.stack([v for vt, v in sig.items() if abs((vt - st).total_seconds()) <= 5400] or [np.zeros_like(day_p[m])]), 0) * CAP[m] for st in stamps]
        extra[m] = {
            'cape': np.max(np.stack([f['cape'] for f in d['steps'].values() if 'cape' in f]), 0),
            'precip': np.max(np.stack([f['precip'] for f in d['steps'].values() if 'precip' in f]), 0),
            'gust': np.max(np.stack([f['gust'] for f in d['steps'].values() if 'gust' in f]), 0) if any('gust' in f for f in d['steps'].values()) else None,
            'hail': np.max(np.stack([f['hail'] for f in d['steps'].values() if 'hail' in f]), 0) if any('hail' in f for f in d['steps'].values()) else None,
            'lightning': np.sum(np.stack([f['lightning'] for f in d['steps'].values() if 'lightning' in f]), 0) if any('lightning' in f for f in d['steps'].values()) else None,
        }

    w = np.array([WEIGHTS[m] for m in day_p])
    stack = np.stack([day_p[m] for m in day_p])
    blend = 100 * np.tensordot(w, stack, 1) / w.sum()
    stamp_blend = [float((100 * np.tensordot(w, np.stack([stamp_p[m][i] for m in day_p]), 1) / w.sum()).max()) for i in range(len(stamps))]

    def wmean(key):
        arrs = [(WEIGHTS[m], extra[m][key]) for m in day_p if extra[m][key] is not None]
        return sum(a * b for a, b in arrs) / sum(a for a, _ in arrs) if arrs else None

    cape_b, pr_b, gust_b = wmean('cape'), wmean('precip'), wmean('gust')
    hail_ukv = extra.get('ukv', {}).get('hail')
    lt_ukv = extra.get('ukv', {}).get('lightning')
    risk = blend >= 12
    per_model = {m: {'label': LABELS[m], 'weight': WEIGHTS[m], 'run': data[m]['run'],
                     'peak': round(float(day_p[m].max() * 100), 1),
                     'peak_where': [round(float(GLAT.ravel()[day_p[m].argmax()]), 2), round(float(GLON.ravel()[day_p[m].argmax()]), 2)]} for m in day_p}
    res = {
        'day': day, 'window_utc': [hours[0].isoformat(), hours[-1].isoformat()],
        'grid': {'lat0': float(LAT[0]), 'lon0': float(LON[0]), 'd': 0.05, 'ny': len(LAT), 'nx': len(LON)},
        'blend': np.round(blend, 1).ravel().tolist(),
        'stamps': [st.isoformat() for st in stamps], 'stamp_peak': [round(v, 1) for v in stamp_blend],
        'models': per_model, 'errors': errors, 'weights': WEIGHTS,
        'spread': round(float(np.std(stack[:, risk] * 100, 0).mean()) if risk.any() else 0.0, 1),
        'peak': round(float(blend.max()), 1),
        'peak_where': [round(float(GLAT.ravel()[blend.argmax()]), 2), round(float(GLON.ravel()[blend.argmax()]), 2)],
        'hazards': {
            'cape_max_in_risk': round(float(cape_b[risk].max()), 0) if risk.any() and cape_b is not None else 0,
            'precip_max_in_risk': round(float(pr_b[risk].max()), 1) if risk.any() and pr_b is not None else 0,
            'gust_max_in_risk': round(float(gust_b[risk].max()), 1) if risk.any() and gust_b is not None else 0,
            'ukv_hail_max': round(float(hail_ukv[risk].max()), 2) if risk.any() and hail_ukv is not None else 0,
            'ukv_lightning_max': round(float(lt_ukv.max()), 2) if lt_ukv is not None else 0,
        },
    }
    with open(out_path, 'w') as fh:
        json.dump(res, fh)
    log(json.dumps({k: res[k] for k in ('peak', 'peak_where', 'stamp_peak', 'spread', 'hazards', 'errors')}))
    log(json.dumps(per_model))


if __name__ == '__main__':
    main()
