"""Every model the viewer shows, straight from the providers' AWS open-data buckets.

    Met Office UKV 2 km          s3://met-office-atmospheric-model-data/uk-deterministic-2km
    Met Office Global 10 km      s3://met-office-atmospheric-model-data/global-deterministic-10km
    ECMWF IFS 0.25 deg           s3://ecmwf-forecasts (ifs/0p25/oper)
    ECMWF AIFS 0.25 deg          s3://ecmwf-forecasts (aifs-single/0p25/oper)
    NOAA GFS 0.25 deg            s3://noaa-gfs-bdp-pds

No Open-Meteo, no third-party API. ECMWF's AWS copy throttles some objects to tens of
seconds per request, so ECMWF files are read from ECMWF's own Google Cloud copy of the same
open-data release first, with the AWS copy as the fallback.

Coarse models are put on the 2 km display grid with a clamped cubic (smooth, no overshoot);
UKV IS the display grid and is never resampled.
"""
from __future__ import annotations

import math
import re
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import NC_LOCK, NX, NY, X0, DX, Y_TOP, regular_frac, smooth_sample

from nova.io_aws import decode_grib, ecmwf_index, exists, fetch_ranges, get, open_nc   # noqa: E402

MPH = 2.236936

# ── variables: one definition shared by every model ─────────────────────────
VARIABLES = {
    # precipitation
    'precip_rate':  dict(label='Precipitation rate', unit='mm/h', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'precip_1h':    dict(label='Precipitation (past hour)', unit='mm', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'precip_total': dict(label='Total precipitation', unit='mm', group='Precipitation', lo=0, hi=400, scale='sqrt'),
    'rain_rate':    dict(label='Rain rate', unit='mm/h', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'conv_rain':    dict(label='Convective rain rate', unit='mm/h', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'refc':         dict(label='Simulated radar (composite)', unit='dBZ', group='Precipitation', lo=-10, hi=75),
    'hail_rate':    dict(label='Hail fall rate', unit='mm/h', group='Precipitation', lo=0, hi=50, scale='sqrt'),
    # snow & ice
    'snow_rate':    dict(label='Snowfall rate (water equiv.)', unit='mm/h', group='Snow & ice', lo=0, hi=30, scale='sqrt'),
    'snow_1h':      dict(label='Snowfall (past hour, water equiv.)', unit='mm', group='Snow & ice', lo=0, hi=30, scale='sqrt'),
    'snow_total':   dict(label='Total snowfall (water equiv.)', unit='mm', group='Snow & ice', lo=0, hi=200, scale='sqrt'),
    'snow_swe':     dict(label='Lying snow (water equiv.)', unit='mm', group='Snow & ice', lo=0, hi=500, scale='sqrt'),
    'snow_depth':   dict(label='Snow depth', unit='cm', group='Snow & ice', lo=0, hi=300, scale='sqrt'),
    'frz':          dict(label='Freezing level', unit='m', group='Snow & ice', lo=0, hi=5000),
    'wbfz':         dict(label='Wet-bulb freezing level', unit='m', group='Snow & ice', lo=0, hi=5000),
    # temperature
    't2':           dict(label='Temperature (2 m)', unit='°C', group='Temperature', lo=-35, hi=45),
    't2max':        dict(label='Max temperature (past hour)', unit='°C', group='Temperature', lo=-35, hi=45),
    't2min':        dict(label='Min temperature (past hour)', unit='°C', group='Temperature', lo=-35, hi=45),
    'td2':          dict(label='Dew point (2 m)', unit='°C', group='Temperature', lo=-35, hi=35),
    'rh2':          dict(label='Relative humidity (2 m)', unit='%', group='Temperature', lo=0, hi=100),
    'tskin':        dict(label='Ground / sea surface temperature', unit='°C', group='Temperature', lo=-35, hi=50),
    'feels':        dict(label='Feels-like temperature', unit='°C', group='Temperature', lo=-45, hi=45),
    # wind & pressure
    'wind10':       dict(label='Wind speed (10 m)', unit='mph', group='Wind & pressure', lo=0, hi=150),
    'gust10':       dict(label='Wind gusts', unit='mph', group='Wind & pressure', lo=0, hi=150),
    'gust_max':     dict(label='Max gust (past hour)', unit='mph', group='Wind & pressure', lo=0, hi=150),
    'wind100':      dict(label='Wind speed (100 m)', unit='mph', group='Wind & pressure', lo=0, hi=150),
    'mslp':         dict(label='Mean sea-level pressure', unit='hPa', group='Wind & pressure', lo=930, hi=1060),
    # cloud & visibility
    'tcc':          dict(label='Total cloud', unit='%', group='Cloud & visibility', lo=0, hi=100),
    'lcc':          dict(label='Low cloud', unit='%', group='Cloud & visibility', lo=0, hi=100),
    'mcc':          dict(label='Medium cloud', unit='%', group='Cloud & visibility', lo=0, hi=100),
    'hcc':          dict(label='High cloud', unit='%', group='Cloud & visibility', lo=0, hi=100),
    'cloud_1000ft': dict(label='Cloud below 1000 ft', unit='%', group='Cloud & visibility', lo=0, hi=100),
    'cloud_base':   dict(label='Cloud base height', unit='m', group='Cloud & visibility', lo=0, hi=5000, scale='sqrt'),
    'vis':          dict(label='Visibility', unit='km', group='Cloud & visibility', lo=0, hi=60, scale='sqrt'),
    'fog':          dict(label='Fog probability', unit='%', group='Cloud & visibility', lo=0, hi=100),
    # convection
    'cape_mu':      dict(label='CAPE (most unstable)', unit='J/kg', group='Convection', lo=0, hi=5000, scale='sqrt'),
    'cape_sb':      dict(label='CAPE (surface)', unit='J/kg', group='Convection', lo=0, hi=5000, scale='sqrt'),
    'cape_ml':      dict(label='CAPE (mixed layer)', unit='J/kg', group='Convection', lo=0, hi=5000, scale='sqrt'),
    'cin_sb':       dict(label='CIN (surface)', unit='J/kg', group='Convection', lo=-800, hi=0),
    'cin_mu':       dict(label='CIN (most unstable)', unit='J/kg', group='Convection', lo=-800, hi=0),
    'li':           dict(label='Lifted index', unit='K', group='Convection', lo=-12, hi=15),
    'srh3':         dict(label='Storm-relative helicity 0-3 km', unit='m²/s²', group='Convection', lo=-100, hi=700),
    'lightning':    dict(label='Lightning (past hour)', unit='flashes/km²', group='Convection', lo=0, hi=5, scale='sqrt'),
    'pw':           dict(label='Precipitable water', unit='mm', group='Convection', lo=0, hi=60),
    # upper air
    'wbpt850':      dict(label='Wet-bulb potential temperature 850 hPa', unit='°C', group='Upper air', lo=-10, hi=26),
    't850':         dict(label='Temperature 850 hPa', unit='°C', group='Upper air', lo=-35, hi=30),
    't500':         dict(label='Temperature 500 hPa', unit='°C', group='Upper air', lo=-55, hi=0),
    'z500':         dict(label='500 hPa height', unit='dam', group='Upper air', lo=470, hi=600),
    'rh700':        dict(label='Relative humidity 700 hPa', unit='%', group='Upper air', lo=0, hi=100),
    'wind850':      dict(label='Wind 850 hPa', unit='mph', group='Upper air', lo=0, hi=200),
    'wind500':      dict(label='Wind 500 hPa', unit='mph', group='Upper air', lo=0, hi=250),
    'wind250':      dict(label='Jet stream (250 hPa wind)', unit='mph', group='Upper air', lo=0, hi=280),
    'trop_p':       dict(label='Tropopause pressure', unit='hPa', group='Upper air', lo=80, hi=500),
    # radiation & surface
    'sw_down':      dict(label='Solar radiation (downward)', unit='W/m²', group='Radiation & surface', lo=0, hi=1100),
    'lw_down':      dict(label='Longwave radiation (downward)', unit='W/m²', group='Radiation & surface', lo=150, hi=480),
    'uv_down':      dict(label='UV radiation (downward)', unit='W/m²', group='Radiation & surface', lo=0, hi=80),
    'shf':          dict(label='Sensible heat flux', unit='W/m²', group='Radiation & surface', lo=-200, hi=600),
}

# accumulated-from-T+0 quantities and how they are built
ACCUM = {'precip_total', 'snow_total'}


def _utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)


def _feels(t, td, w_mph):
    """UK Met Office-style feels-like: wind chill below 10 C, heat index above 26 C."""
    v = w_mph * 1.609344
    wc = 13.12 + 0.6215 * t - 11.37 * np.power(np.maximum(v, 4.8), 0.16) + 0.3965 * t * np.power(np.maximum(v, 4.8), 0.16)
    e = 6.105 * np.exp(17.27 * td / (237.7 + td))
    at = t + 0.33 * e - 0.70 * (v / 3.6) - 4.0
    return np.where(t <= 10, np.minimum(wc, t), np.where(t >= 26, np.maximum(at, t), t))


# ── Met Office (UKV, Global) ────────────────────────────────────────────────
MO_BUCKET = 'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com'


def _s3_list(prefix, delimiter=None, start_after=None):
    out_k, out_p, token = [], [], None
    while True:
        q = f'{MO_BUCKET}/?list-type=2&prefix={prefix}'
        if delimiter:
            q += f'&delimiter={delimiter}'
        if start_after:
            q += f'&start-after={start_after}'
        if token:
            q += '&continuation-token=' + urllib.request.quote(token, safe='')
        txt = get(q, tries=3, timeout=60).decode()
        out_k += re.findall(r'<Key>([^<]+)</Key>', txt)
        out_p += re.findall(r'<Prefix>([^<]+)</Prefix>', txt)[1:] if delimiter else []
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', txt)
        if not m:
            return out_k, out_p
        token = m.group(1)


class MetOffice:
    model = ''
    files = {}
    pl_files = {}

    def runs(self, n=8):
        start = (datetime.now(timezone.utc) - timedelta(days=2)).strftime('%Y%m%d')
        _, pre = _s3_list(f'{self.model}/', '/', f'{self.model}/{start}')
        runs = sorted({_utc(p.split('/')[1]) for p in pre if re.match(r'.*/\d{8}T\d{4}Z/$', p)}, reverse=True)
        out = []
        for r in runs[:n * 2]:
            steps = self.steps(r)
            if steps:
                out.append((r, steps))
            if len(out) >= n:
                break
        return out

    def steps(self, run):
        _, pre = _s3_list(f'{self.model}/{run:%Y%m%dT%H%MZ}/', '-')
        hrs = sorted({round((_utc(p.rsplit('/', 1)[1].rstrip('-')) - run).total_seconds() / 3600) for p in pre})
        return [h for h in hrs if h >= 0]

    def url(self, run, h, name):
        vt = run + timedelta(hours=h)
        return f'{MO_BUCKET}/{self.model}/{run:%Y%m%dT%H%MZ}/{vt:%Y%m%dT%H%MZ}-PT{h:04d}H00M-{name}.nc'

    def _read(self, run, h, name, level=None):
        blob = get(self.url(run, h, name), tries=3, timeout=120)
        with NC_LOCK:
            ds = open_nc(blob)
            var = next(v for v in ds.variables.values() if v.ndim >= 2 and 'bnds' not in v.name)
            units = getattr(var, 'units', '')
            a = np.ma.filled(var[:].astype(np.float32), np.nan)
            if a.ndim == 3:
                levs = None
                for c in ('pressure', 'height'):
                    if c in ds.variables:
                        levs = np.asarray(ds.variables[c][:], float)
                k = int(np.argmin(np.abs(levs - level))) if levs is not None else 0
                a = a[k]
            geo = self._geo(ds)
            ds.close()
        return self._to_display(a, geo), units

    def _geo(self, ds):
        if 'projection_x_coordinate' in ds.variables:
            x = ds.variables['projection_x_coordinate'][:]
            y = ds.variables['projection_y_coordinate'][:]
            return ('laea', float(x[0]), float(x[1] - x[0]), float(y[0]), float(y[1] - y[0]), len(x), len(y))
        return ('ll', np.asarray(ds.variables['latitude'][:], float), np.asarray(ds.variables['longitude'][:], float))

    def _to_display(self, a, geo):
        if geo[0] == 'laea':
            _, x0, dx, y0, dy, nx, ny = geo
            if (nx, ny) == (NX, NY) and abs(x0 - X0) < 1 and abs(dx - DX) < 1:
                return (a[::-1] if dy > 0 else a).astype(np.float32)        # the UKV grid IS the display grid
            raise ValueError('unexpected UKV grid')
        _, lats, lons = geo
        key = (lats.size, lons.size, float(lats[0]), float(lons[0]))
        if getattr(self, '_ix_key', None) != key:
            self._ix = regular_frac(lats, lons)
            self._ix_key = key
        return smooth_sample(a, self._ix)              # coarse model: smooth, not blocks

    def field(self, run, h, var, prev_h):
        """-> float32 (NY, NX) in display units, plus the raw accumulation for running totals."""
        F = self.files
        if var in ('precip_total', 'precip_1h', 'snow_total', 'snow_1h'):
            stem = 'precipitation_accumulation' if var.startswith('precip') else 'snowfall_accumulation'
            if h == 0:
                return np.zeros((NY, NX), np.float32), 0
            # hourly accumulations to T+54, 3-hourly beyond (where only every third hour is published);
            # returns (mm, hours covered) so job.py can chain them into a running total
            for hours in ((1,) if var.endswith('_1h') else (1, 3)):
                try:
                    a, units = self._read(run, h, f'{stem}-PT{hours:02d}H')
                    return a * (1000.0 if units == 'm' else 1.0), hours
                except Exception:
                    continue
            raise FileNotFoundError(stem)
        if var == 'feels':
            t, _ = self._read(run, h, F['t2'])
            td, _ = self._read(run, h, F['td2'])
            w, _ = self._read(run, h, F['wind10'])
            return _feels(t - 273.15, td - 273.15, w * MPH)
        if var in self.pl_files:
            name, level = self.pl_files[var]
            a, _ = self._read(run, h, name, level)
            return a - 273.15 if var == 'wbpt850' and np.nanmean(a) > 150 else a
        a, units = self._read(run, h, F[var])
        if units == 'K':
            return a - 273.15
        if var in ('precip_rate', 'rain_rate', 'snow_rate', 'conv_rain', 'hail_rate'):
            return a * (3.6e6 if units == 'm s-1' else 3600.0)
        if units == 'Pa':
            return a / 100.0
        if var in ('wind10', 'gust10', 'gust_max'):
            return a * MPH
        if var in ('tcc', 'lcc', 'mcc', 'hcc', 'cloud_1000ft', 'fog', 'rh2'):
            return a * 100.0 if np.nanmax(a) <= 1.6 else a
        if var == 'vis':
            return a / 1000.0
        if var == 'lightning':
            return a * 1e6
        if var == 'cin_sb' or var == 'cin_mu':
            return -np.abs(a)
        return a


class UKV(MetOffice):
    id, label, res_km, model = 'ukv', 'Met Office UKV', 2.0, 'uk-deterministic-2km'
    files = {
        'precip_rate': 'precipitation_rate', 'rain_rate': 'rainfall_rate', 'snow_rate': 'snowfall_rate',
        'hail_rate': 'hail_fall_rate', 't2': 'temperature_at_screen_level',
        't2max': 'temperature_at_screen_level_max-PT01H', 't2min': 'temperature_at_screen_level_min-PT01H',
        'td2': 'temperature_of_dew_point_at_screen_level', 'rh2': 'relative_humidity_at_screen_level',
        'tskin': 'temperature_at_surface', 'wind10': 'wind_speed_at_10m', 'gust10': 'wind_gust_at_10m',
        'gust_max': 'wind_gust_at_10m_max-PT01H', 'mslp': 'pressure_at_mean_sea_level',
        'tcc': 'cloud_amount_of_total_cloud', 'lcc': 'cloud_amount_of_low_cloud', 'mcc': 'cloud_amount_of_medium_cloud',
        'hcc': 'cloud_amount_of_high_cloud', 'cloud_1000ft': 'cloud_amount_below_1000ft_ASL',
        'cloud_base': 'height_AGL_at_cloud_base_where_cloud_cover_2p5_oktas', 'vis': 'visibility_at_screen_level',
        'fog': 'fog_fraction_at_screen_level', 'cape_mu': 'CAPE_most_unstable_below_500hPa', 'cape_sb': 'CAPE_surface',
        'lightning': 'lightning_flash_accumulation-PT01H', 'frz': 'height_AGL_at_freezing_level',
        'wbfz': 'height_AGL_at_wet_bulb_freezing_level', 'snow_swe': 'snow_depth_water_equivalent',
        'sw_down': 'radiation_flux_in_shortwave_total_downward_at_surface',
        'lw_down': 'radiation_flux_in_longwave_downward_at_surface', 'uv_down': 'radiation_flux_in_uv_downward_at_surface',
        'shf': 'sensible_heat_flux_at_surface',
    }
    pl_files = {'wbpt850': ('wet_bulb_potential_temperature_on_pressure_levels', 85000.0)}
    variables = list(files) + ['precip_1h', 'precip_total', 'snow_1h', 'snow_total', 'feels', 'wbpt850']


class MOGlobal(MetOffice):
    id, label, res_km, model = 'mo_global', 'Met Office Global', 10.0, 'global-deterministic-10km'
    files = {
        'precip_rate': 'precipitation_rate', 'rain_rate': 'rainfall_rate', 'snow_rate': 'snowfall_rate',
        'conv_rain': 'rainfall_rate_from_convection', 't2': 'temperature_at_screen_level',
        't2max': 'temperature_at_screen_level_max-PT01H', 't2min': 'temperature_at_screen_level_min-PT01H',
        'td2': 'temperature_of_dew_point_at_screen_level', 'rh2': 'relative_humidity_at_screen_level',
        'tskin': 'temperature_at_surface', 'wind10': 'wind_speed_at_10m', 'gust10': 'wind_gust_at_10m',
        'gust_max': 'wind_gust_at_10m_max-PT01H', 'mslp': 'pressure_at_mean_sea_level',
        'tcc': 'cloud_amount_of_total_cloud', 'lcc': 'cloud_amount_of_low_cloud', 'mcc': 'cloud_amount_of_medium_cloud',
        'hcc': 'cloud_amount_of_high_cloud', 'cloud_1000ft': 'cloud_amount_below_1000ft_ASL',
        'vis': 'visibility_at_screen_level', 'fog': 'fog_fraction_at_screen_level',
        'cape_mu': 'CAPE_most_unstable_below_500hPa', 'cape_sb': 'CAPE_surface', 'cape_ml': 'CAPE_mixed_layer_lowest_500m',
        'cin_sb': 'CIN_surface', 'cin_mu': 'CIN_most_unstable_below_500hPa', 'snow_swe': 'snow_depth_water_equivalent',
        'sw_down': 'radiation_flux_in_shortwave_total_downward_at_surface',
        'lw_down': 'radiation_flux_in_longwave_downward_at_surface', 'uv_down': 'radiation_flux_in_uv_downward_at_surface',
        'trop_p': 'pressure_at_tropopause',
    }
    variables = list(files) + ['precip_1h', 'precip_total', 'feels']


# ── ECMWF (IFS, AIFS) ───────────────────────────────────────────────────────
ECM_HOSTS = ('https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com')


class ECMWF:
    id, label, res_km = 'ifs', 'ECMWF IFS', 25.0
    path, stem = 'ifs/0p25/oper', 'oper-fc'
    cycles = (0, 6, 12, 18)
    SPEC = {
        't2': [('sfc', '2t')], 'td2': [('sfc', '2d')], 'tskin': [('sfc', 'skt')],
        'wind10': [('sfc', '10u'), ('sfc', '10v')], 'gust10': [('sfc', ('10fg3', '10fg6', '10fg'))],
        'wind100': [('sfc', '100u'), ('sfc', '100v')],
        'mslp': [('sfc', 'msl')], 'precip_total': [('sfc', 'tp')], 'precip_rate': [('sfc', 'tp')],
        'snow_total': [('sfc', 'sf')], 'tcc': [('sfc', 'tcc')], 'lcc': [('sfc', 'lcc')], 'mcc': [('sfc', 'mcc')],
        'hcc': [('sfc', 'hcc')], 'cape_mu': [('sfc', 'mucape')], 'pw': [('sfc', ('tcwv', 'tcw'))],
        'rh2': [('sfc', '2t'), ('sfc', '2d')], 'feels': [('sfc', '2t'), ('sfc', '2d'), ('sfc', '10u'), ('sfc', '10v')],
        't850': [('pl', 't', 850)], 't500': [('pl', 't', 500)], 'z500': [('pl', 'gh', 500)], 'rh700': [('pl', 'r', 700)],
        'wind850': [('pl', 'u', 850), ('pl', 'v', 850)], 'wind500': [('pl', 'u', 500), ('pl', 'v', 500)],
        'wind250': [('pl', 'u', 250), ('pl', 'v', 250)], 'sw_down': [('sfc', 'ssrd')], 'lw_down': [('sfc', 'strd')],
    }
    variables = ['precip_rate', 'precip_total', 'snow_total', 't2', 'td2', 'rh2', 'tskin', 'feels', 'wind10', 'gust10',
                 'wind100', 'mslp', 'tcc', 'lcc', 'mcc', 'hcc', 'cape_mu', 'pw', 't850', 't500', 'z500', 'rh700',
                 'wind850', 'wind500', 'wind250', 'sw_down', 'lw_down']

    def __init__(self):
        self._idx, self._host, self._ix = {}, {}, None

    def schedule(self, run):
        long = run.hour in (0, 12)
        return list(range(0, 145, 3)) + list(range(150, 241, 6)) if long else list(range(0, 91, 3))

    def base(self, run, h, host):
        return f'{host}/{run:%Y%m%d}/{run:%H}z/{self.path}/{run:%Y%m%d%H}0000-{h}h-{self.stem}'

    def index(self, run, h):
        k = (run, h)
        if k not in self._idx:
            last = None
            for host in ECM_HOSTS:
                try:
                    txt = get(self.base(run, h, host) + '.index', tries=2, timeout=8).decode()
                    if txt.strip():
                        self._idx[k], self._host[k] = ecmwf_index(txt), host
                        break
                except Exception as e:
                    last = e
            else:
                raise FileNotFoundError(f'{self.id} {run:%d%HZ} T+{h}: {last}')
        return self._idx[k]

    def _has(self, run, h):
        return any(exists(self.base(run, h, host) + '.index') for host in ECM_HOSTS)

    def runs(self, n=4):
        now = datetime.now(timezone.utc)
        t = now.replace(minute=0, second=0, microsecond=0)
        t -= timedelta(hours=t.hour % 6)
        out = []
        for k in range(10):
            r = t - timedelta(hours=6 * k)
            if r.hour not in self.cycles or not self._has(r, 0):
                continue
            sched = self.schedule(r)
            lo, hi = 0, len(sched) - 1                      # how far the run is published
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

    def _get(self, run, h, wants):
        idx = self.index(run, h)
        host = self._host[(run, h)]
        ranges, names = [], []
        for w in wants:
            lt, p = w[0], w[1]
            lev = str(w[2]) if len(w) > 2 else None
            ps = p if isinstance(p, tuple) else (p,)
            rec = next((r for pp in ps for r in idx if r.get('param') == pp and r.get('levtype') == lt
                        and (lev is None or str(r.get('levelist')) == lev)), None)
            if rec is None:
                raise KeyError(f'{w} not in {self.id} T+{h}')
            ranges.append((rec['_offset'], rec['_offset'] + rec['_length'] - 1, len(names)))
            names.append(w)
        blobs = fetch_ranges(self.base(run, h, host) + '.grib2', ranges, gap=0, workers=12)
        out = []
        for i in range(len(names)):
            a, meta = decode_grib(blobs[i])
            out.append(self._to_display(a, meta))
        return out

    def _to_display(self, a, meta):
        key = (meta['Ni'], meta['Nj'], meta['latitudeOfFirstGridPointInDegrees'], meta['longitudeOfFirstGridPointInDegrees'])
        if self._ix is None or self._ix[0] != key:
            lat1, lon1 = meta['latitudeOfFirstGridPointInDegrees'], meta['longitudeOfFirstGridPointInDegrees']
            dj, di = meta['jDirectionIncrementInDegrees'], meta['iDirectionIncrementInDegrees']
            lat2 = meta['latitudeOfLastGridPointInDegrees']
            lats = lat1 + np.arange(meta['Nj']) * (dj if lat2 > lat1 else -dj)
            lons = lon1 + np.arange(meta['Ni']) * di
            self._ix = (key, regular_frac(lats, lons))
        a = np.asarray(a, np.float32).reshape(meta['Nj'], meta['Ni'])
        return smooth_sample(a, self._ix[1])           # coarse model: smooth, not blocks

    def field(self, run, h, var, prev_h, prev_raw=None):
        S = self.SPEC[var]
        A = self._get(run, h, S)
        if var in ('t2', 'td2', 'tskin', 't850', 't500'):
            return A[0] - 273.15
        if var in ('wind10', 'wind100', 'wind850', 'wind500', 'wind250'):
            return np.hypot(A[0], A[1]) * MPH
        if var == 'gust10':
            return A[0] * MPH
        if var == 'mslp':
            return A[0] / 100.0
        if var == 'z500':
            return A[0] / 10.0
        if var in ('precip_total', 'snow_total'):
            return A[0] * 1000.0
        if var in ('tcc', 'lcc', 'mcc', 'hcc'):
            return A[0] * 100.0 if np.nanmax(A[0]) <= 1.01 else A[0]
        if var == 'rh2':
            t, td = A[0] - 273.15, A[1] - 273.15
            return 100 * np.exp(17.625 * td / (243.04 + td)) / np.exp(17.625 * t / (243.04 + t))
        if var == 'feels':
            return _feels(A[0] - 273.15, A[1] - 273.15, np.hypot(A[2], A[3]) * MPH)
        if var in ('precip_rate', 'sw_down', 'lw_down'):
            return A[0]                          # raw accumulation; job.py differences consecutive steps
        return A[0]


class AIFS(ECMWF):
    id, label, res_km = 'aifs', 'ECMWF AIFS (AI)', 25.0
    path = 'aifs-single/0p25/oper'

    def schedule(self, run):
        return list(range(0, 241, 6))

    variables = ['precip_rate', 'precip_total', 'snow_total', 't2', 'td2', 'rh2', 'tskin', 'feels', 'wind10', 'wind100',
                 'mslp', 'tcc', 'lcc', 'mcc', 'hcc', 'pw', 't850', 't500', 'z500', 'wind850', 'wind500', 'wind250',
                 'sw_down', 'lw_down']


# ── NOAA GFS ────────────────────────────────────────────────────────────────
GFS_BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'


class GFS:
    id, label, res_km = 'gfs', 'NOAA GFS', 25.0
    SPEC = {
        't2': [('TMP', '2 m above ground')], 'td2': [('DPT', '2 m above ground')], 'rh2': [('RH', '2 m above ground')],
        'tskin': [('TMP', 'surface')], 'feels': [('APTMP', '2 m above ground')],
        'wind10': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')], 'gust10': [('GUST', 'surface')],
        'wind100': [('UGRD', '100 m above ground'), ('VGRD', '100 m above ground')],
        'mslp': [('PRMSL', 'mean sea level')], 'precip_rate': [('PRATE', 'surface')],
        'precip_total': [('APCP', 'surface')], 'refc': [('REFC', 'entire atmosphere')],
        'tcc': [('TCDC', 'entire atmosphere')], 'lcc': [('LCDC', 'low cloud layer')], 'mcc': [('MCDC', 'middle cloud layer')],
        'hcc': [('HCDC', 'high cloud layer')], 'vis': [('VIS', 'surface')], 'cape_sb': [('CAPE', 'surface')],
        'cin_sb': [('CIN', 'surface')], 'li': [('LFTX', 'surface')], 'srh3': [('HLCY', '3000-0 m above ground')],
        'pw': [('PWAT', 'entire atmosphere (considered as a single layer)')], 'snow_depth': [('SNOD', 'surface')],
        'snow_swe': [('WEASD', 'surface')], 't850': [('TMP', '850 mb')], 't500': [('TMP', '500 mb')],
        'z500': [('HGT', '500 mb')], 'rh700': [('RH', '700 mb')],
        'wind850': [('UGRD', '850 mb'), ('VGRD', '850 mb')], 'wind500': [('UGRD', '500 mb'), ('VGRD', '500 mb')],
        'wind250': [('UGRD', '250 mb'), ('VGRD', '250 mb')], 'sw_down': [('DSWRF', 'surface')],
        'frz': [('HGT', '0C isotherm')], 'trop_p': [('PRES', 'tropopause')],
    }
    variables = ['precip_rate', 'precip_total', 'refc', 't2', 'td2', 'rh2', 'tskin', 'feels', 'wind10', 'gust10',
                 'wind100', 'mslp', 'tcc', 'lcc', 'mcc', 'hcc', 'vis', 'cape_sb', 'cin_sb', 'li', 'srh3', 'pw',
                 'snow_depth', 'snow_swe', 'frz', 't850', 't500', 'z500', 'rh700', 'wind850', 'wind500', 'wind250',
                 'trop_p', 'sw_down']

    def __init__(self):
        self._idx, self._ix = {}, None

    def schedule(self, run):
        return list(range(0, 121)) + list(range(123, 241, 3))

    def url(self, run, h):
        return f'{GFS_BUCKET}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{h:03d}'

    def runs(self, n=4):
        t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        t -= timedelta(hours=t.hour % 6)
        out = []
        for k in range(8):
            r = t - timedelta(hours=6 * k)
            if not exists(self.url(r, 0) + '.idx'):
                continue
            sched = self.schedule(r)
            lo, hi = 0, len(sched) - 1
            if not exists(self.url(r, sched[hi]) + '.idx'):
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if exists(self.url(r, sched[mid]) + '.idx'):
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
            lines = [l for l in get(self.url(run, h) + '.idx', tries=3, timeout=60).decode().splitlines() if l.strip()]
            recs = []
            for i, l in enumerate(lines):
                p = l.split(':')
                end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
                recs.append({'var': p[3], 'level': p[4], 'desc': p[5] if len(p) > 5 else '', 'start': int(p[1]), 'end': end})
            self._idx[k] = recs
        return self._idx[k]

    def _pick(self, recs, var, level):
        c = [r for r in recs if r['var'] == var and r['level'] == level]
        if not c:
            return None
        if var == 'APCP':                                  # the running total from T+0
            return next((r for r in c if r['desc'].startswith('0-')), c[-1])
        if var in ('PRATE', 'DSWRF'):                      # instantaneous where published
            return next((r for r in c if 'ave' not in r['desc']), c[-1])
        return c[0]

    def field(self, run, h, var, prev_h, prev_raw=None):
        recs = self.index(run, h)
        wants = []
        for v, lev in self.SPEC[var]:
            r = self._pick(recs, v, lev)
            if r is None:
                raise KeyError(f'{v}:{lev} not in GFS T+{h}')
            wants.append((r['start'], r['end'], len(wants)))
        blobs = fetch_ranges(self.url(run, h), wants, gap=0, workers=12)
        A = []
        for i in range(len(wants)):
            a, meta = decode_grib(blobs[i])
            A.append(ECMWF._to_display(self, a, meta))
        if var in ('t2', 'td2', 'tskin', 'feels', 't850', 't500'):
            return A[0] - 273.15
        if var in ('wind10', 'wind100', 'wind850', 'wind500', 'wind250'):
            return np.hypot(A[0], A[1]) * MPH
        if var == 'gust10':
            return A[0] * MPH
        if var in ('mslp', 'trop_p'):
            return A[0] / 100.0
        if var == 'precip_rate':
            return A[0] * 3600.0
        if var == 'z500':
            return A[0] / 10.0
        if var == 'vis':
            return A[0] / 1000.0
        if var == 'snow_depth':
            return A[0] * 100.0
        if var == 'precip_total' and h == 0:
            return np.zeros((NY, NX), np.float32)
        return A[0]


MODELS = {m.id: m for m in (UKV(), MOGlobal(), ECMWF(), AIFS(), GFS())}
SOURCES = {
    'ukv': 'Met Office UKV 2 km — AWS open data (uk-deterministic-2km)',
    'mo_global': 'Met Office Global 10 km — AWS open data (global-deterministic-10km)',
    'ifs': "ECMWF IFS 0.25° — ECMWF open data (ECMWF's Google Cloud copy; the AWS copy as fallback)",
    'aifs': "ECMWF AIFS 0.25° — ECMWF open data (ECMWF's Google Cloud copy; the AWS copy as fallback)",
    'gfs': 'NOAA GFS 0.25° — AWS open data (noaa-gfs-bdp-pds)',
}
# variables whose frames are differences of an accumulation between consecutive steps
DIFFERENCED = {('ifs', 'precip_rate'), ('aifs', 'precip_rate'), ('ifs', 'sw_down'), ('aifs', 'sw_down'),
               ('ifs', 'lw_down'), ('aifs', 'lw_down')}
