"""More models for the Model Data page (15 Nov 2026, at the user's request): every one keyless and
official, each with as many of its fields as make a map, on the wide grid unless said.

    aigfs   NOAA AIGFS: the GFS's operational AI version (GraphCast trained on GFS analyses),
            0.25 degrees, every 6 hours to 16 days (NOMADS: 13 pressure levels and the surface).

The upper air's humidity, dew points, K-index and wet-bulb potential temperature are worked out
from its specific humidity; vorticity from its winds on its own grid, before regridding.
"""
from __future__ import annotations

import numpy as np

from .common import NX, NY, recent_runs
from .models import (ECMWF, GFS, MPH, _coriolis, _dewpoint, _kindex, _rh_from_q, _theta_e, _theta_w, _wdir, _windchill)
from nova.io_aws import decode_grib, exists, fetch_ranges, get


def _vort_ll(u, v, meta):
    """Relative vorticity (1/s) of winds on a regular lat/lon grid (GRIB meta), lightly smoothed."""
    from scipy import ndimage
    R = 6371000.0
    lat1, lat2 = meta['latitudeOfFirstGridPointInDegrees'], meta['latitudeOfLastGridPointInDegrees']
    dj, di = np.radians(meta['jDirectionIncrementInDegrees']), np.radians(meta['iDirectionIncrementInDegrees'])
    nj = meta['Nj']
    sign = 1.0 if lat2 > lat1 else -1.0
    lat = np.radians(lat1 + sign * np.degrees(dj) * np.arange(nj))[:, None]
    near_pole = np.abs(lat) > np.radians(88.0)               # the metric terms blow up at the poles (the wide grid reaches one)
    latc = np.clip(lat, -np.radians(88.0), np.radians(88.0))
    dvdx = np.gradient(v, axis=1) / (R * np.cos(latc) * di)
    dudy = sign * np.gradient(u, axis=0) / (R * dj)
    zeta = np.where(near_pole, 0.0, dvdx - dudy + u * np.tan(latc) / R)
    return ndimage.gaussian_filter(np.nan_to_num(zeta), 1.0)


# ── NOAA AIGFS ───────────────────────────────────────────────────────────────────────────────
AIGFS_BASE = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/aigfs/v1.1'
_LEVELS = (925, 850, 700, 500, 300, 250, 200)


class AIGFS(GFS):
    id, label, res_km = 'aigfs', 'NOAA AIGFS (AI)', 25.0
    SPEC = {
        't2': [('TMP', '2 m above ground')], 'mslp': [('PRMSL', 'mean sea level')],
        'wind10': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'wdir10': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'windchill': [('TMP', '2 m above ground'), ('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'precip_total': [('APCP', 'surface')], 'precip_rate': [('APCP6', 'surface')],
        'z500': [('HGT', '500 mb')], 'z850': [('HGT', '850 mb')], 'thick': [('HGT', '500 mb'), ('HGT', '1000 mb')],
        'w700': [('VVEL', '700 mb')], 'w500': [('VVEL', '500 mb')],
        'vort500': [('UGRD', '500 mb'), ('VGRD', '500 mb')],
        'kindex': [('TMP', '850 mb'), ('TMP', '700 mb'), ('TMP', '500 mb'), ('SPFH', '850 mb'), ('SPFH', '700 mb')],
        'wbpt850': [('TMP', '850 mb'), ('SPFH', '850 mb')],
        **{f't{p}': [('TMP', f'{p} mb')] for p in (925, 850, 700, 500, 300)},
        **{f'rh{p}': [('TMP', f'{p} mb'), ('SPFH', f'{p} mb')] for p in (925, 850, 700, 500)},
        **{f'wind{p}': [('UGRD', f'{p} mb'), ('VGRD', f'{p} mb')] for p in _LEVELS},
    }
    variables = ['precip_rate', 'precip_total', 't2', 'windchill', 'wind10', 'wdir10', 'mslp', 't925', 't850', 't700', 't500', 't300',
                 'z850', 'z500', 'thick', 'rh925', 'rh850', 'rh700', 'rh500', 'wbpt850', 'kindex', 'wind925', 'wind850', 'wind700',
                 'wind500', 'wind300', 'wind250', 'wind200', 'w700', 'w500', 'vort500']

    def schedule(self, run):
        return list(range(0, 385, 6))

    def url(self, run, h, kind='sfc'):
        return f'{AIGFS_BASE}/aigfs.{run:%Y%m%d}/{run:%H}/model/atmos/grib2/aigfs.t{run:%H}z.{kind}.f{h:03d}.grib2'

    def runs(self, n=None):
        return recent_runs(lambda r, h: exists(self.url(r, h, 'sfc') + '.idx'), self.schedule, n=n)

    def index(self, run, h, kind='sfc'):
        k = (run, h, kind)
        if k not in self._idx:
            lines = [l for l in get(self.url(run, h, kind) + '.idx', tries=3, timeout=60).decode().splitlines() if l.strip()]
            recs = []
            for i, l in enumerate(lines):
                p = l.split(':')
                end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
                recs.append({'var': p[3], 'level': p[4], 'desc': p[5] if len(p) > 5 else '', 'start': int(p[1]), 'end': end})
            self._idx[k] = recs
        return self._idx[k]

    def _pick_ai(self, recs, var, level, h):
        if var == 'APCP6':                                 # the last six hours' amount
            c = [r for r in recs if r['var'] == 'APCP' and r['level'] == level]
            return next((r for r in c if r['desc'].startswith(f'{h - 6}-') and 'hour' in r['desc']), c[0] if c else None)
        c = [r for r in recs if r['var'] == var and r['level'] == level]
        if var == 'APCP':                                  # the running total from T+0
            return next((r for r in c if r['desc'].startswith('0-')), c[-1] if c else None)
        return c[0] if c else None

    def field(self, run, h, var, prev_h, prev_raw=None):
        if var in ('precip_total', 'precip_rate') and h == 0:
            return np.zeros((NY, NX), np.float32)
        spec = self.SPEC[var]
        by_kind = {}
        for i, (v, lev) in enumerate(spec):
            kind = 'pres' if lev.endswith(' mb') else 'sfc'
            r = self._pick_ai(self.index(run, h, kind), v, lev, h)
            if r is None:
                raise KeyError(f'{v}:{lev} not in {self.id} T+{h}')
            by_kind.setdefault(kind, []).append((r['start'], r['end'], i))
        raw = [None] * len(spec)
        for kind, wants in by_kind.items():
            blobs = fetch_ranges(self.url(run, h, kind), wants, gap=0, workers=8)
            for (_, _, i) in wants:
                raw[i] = decode_grib(blobs[i])
        meta = raw[0][1]
        native = [np.asarray(a, np.float32).reshape(m['Nj'], m['Ni']) for a, m in raw]
        disp = lambda a: ECMWF._to_display(self, a, meta)     # noqa: E731
        p = lambda lev: float(lev.split()[0])                 # noqa: E731
        if var == 'vort500':
            return (disp(_vort_ll(native[0], native[1], meta)) * 1e5).astype(np.float32)
        A = [disp(a) for a in native]
        if var == 'precip_rate':
            return np.clip(A[0], 0, None) / 6.0
        if var == 'precip_total':
            return np.clip(A[0], 0, None)
        if var == 't2' or (var.startswith('t') and var[1:].isdigit()):
            return A[0] - 273.15
        if var == 'mslp':
            return A[0] / 100.0
        if var == 'wdir10':
            return _wdir(A[0], A[1])
        if var == 'windchill':
            return _windchill(A[0] - 273.15, np.hypot(A[1], A[2]) * MPH)
        if var.startswith('wind'):
            return np.hypot(A[0], A[1]) * MPH
        if var in ('z500', 'z850'):
            return A[0] / 10.0
        if var == 'thick':
            return (A[0] - A[1]) / 10.0
        if var.startswith('rh'):
            return _rh_from_q(A[0] - 273.15, A[1], p(spec[0][1]))
        if var == 'kindex':
            rh850 = _rh_from_q(A[0] - 273.15, A[3], 850.0)
            rh700 = _rh_from_q(A[1] - 273.15, A[4], 700.0)
            return _kindex(A[0] - 273.15, A[1] - 273.15, A[2] - 273.15, rh850, rh700)
        if var == 'wbpt850':
            return _theta_w(_theta_e(A[0], A[1], 850.0))
        return A[0]                                        # w700, w500 (Pa/s)


# ── Environment and Climate Change Canada GDPS ─────────────────────────────────────────────────
# One file per field and step (global, 0.15 degrees), hourly to 240 h from 00Z and 12Z; listed as
# hourly to 48 h then 3-hourly, so a layer is ~113 frames rather than 241.
GDPS_BASE = 'https://dd.weather.gc.ca/{day:%Y%m%d}/WXO-DD/model_gdps/15km/{run:%H}/{h:03d}/'


def _gdps_lev(p):
    return f'IsbL-{p:04d}'


class GDPS(GFS):
    id, label, res_km = 'gdps', 'ECCC GDPS (Canada)', 15.0
    SPEC = {
        't2': ['AirTemp_AGL-2m'], 'td2': ['DewPoint_AGL-2m'], 'rh2': ['RelativeHumidity_AGL-2m'], 'q2': ['SpecificHumidity_AGL-2m'],
        't2max': ['AirTemp-Max_AGL-2m'], 't2min': ['AirTemp-Min_AGL-2m'], 'tskin': ['SoilTemp_Sfc'],
        'windchill': ['WindChill_Sfc'], 'wind10': ['WindSpeed_AGL-10m'], 'wdir10': ['WindDir_AGL-10m'],
        'gust10': ['WindGust_AGL-10m'], 'gust_max': ['WindGust-Max_AGL-10m'],
        'mslp': ['Pressure_MSL'], 'sp': ['Pressure_Sfc'],
        'precip_rate': ['PrecipRate_Sfc'], 'precip_total': ['Precip-Accum_Sfc'], 'precip_1h': ['Precip-Accum1h_Sfc'],
        'rain_1h': ['Rain-Accum1h_Sfc'], 'snow_1h': ['Snow-Accum1h_Sfc'], 'snow_total': ['Snow-Accum_Sfc'],
        'rain_total': ['Rain-Accum_Sfc'], 'frzr_total': ['FreezingRain-Accum_Sfc'], 'icep_total': ['IcePellets-Accum_Sfc'],
        'conv_total': ['ConvectivePrecip-Accum_Sfc'], 'ptype': ['PrecipType-Instant_Sfc', 'PrecipRate_Sfc'],
        'tcc': ['TotalCloudCover_Sfc'], 'cape_sb': ['CAPE_Sfc'], 'cin_sb': ['CIN_Sfc'], 'li': ['LiftedIndex-MU-VT_IsbL-0500'],
        'kindex': ['KIndex_Sfc'], 'tt': ['TotalTotalsIndex_Sfc'], 'showalter': ['ShowalterIndex_IsbL-0500'],
        'hpbl': ['PlanetaryBoundaryLayerHeight_Sfc'], 'snow_depth': ['SnowDepth_Sfc'], 'uv_index': ['UVIndex_Sfc'],
        'lhf': ['LatentHeatNetFlux_Sfc'], 'shf': ['SensibleHeatNetFlux_Sfc'], 'olr': ['UpwardLongwaveRadiationFlux_NTAtm'],
        'soil_t': ['SoilTemp_DBS-0to10cm'], 'soil_m': ['SoilVolumetricWaterContent_DBS-0to10cm'], 'albedo': ['Albedo_Sfc'],
        'thick': [f'GeopotentialHeight_{_gdps_lev(500)}', f'GeopotentialHeight_{_gdps_lev(1000)}'],
        'vort500': [f'RelativeVorticity_{_gdps_lev(500)}'],
        'wbpt850': [f'AirTemp_{_gdps_lev(850)}', f'RelativeHumidity_{_gdps_lev(850)}'],
        **{f't{p}': [f'AirTemp_{_gdps_lev(p)}'] for p in (925, 850, 700, 500, 300)},
        **{f'z{p}': [f'GeopotentialHeight_{_gdps_lev(p)}'] for p in (850, 500)},
        **{f'rh{p}': [f'RelativeHumidity_{_gdps_lev(p)}'] for p in (925, 850, 700, 500)},
        **{f'wind{p}': [f'WindSpeed_{_gdps_lev(p)}'] for p in _LEVELS},
        **{f'w{p}': [f'VerticalVelocity_{_gdps_lev(p)}'] for p in (700, 500)},
    }
    variables = ['precip_rate', 'precip_1h', 'precip_total', 'rain_1h', 'rain_total', 'conv_total', 'ptype', 'snow_1h', 'snow_total',
                 'snow_acc', 'frzr_total', 'icep_total', 'snow_depth', 't2', 't2max', 't2min', 'td2', 'rh2', 'q2', 'tskin', 'windchill',
                 'wind10', 'wdir10', 'gust10', 'gust_max', 'mslp', 'sp', 'tcc', 'cape_sb', 'cin_sb', 'li', 'kindex', 'tt', 'showalter',
                 'hpbl', 'uv_index', 'lhf', 'shf', 'olr', 'soil_t', 'soil_m', 'albedo', 't925', 't850', 't700', 't500', 't300',
                 'z850', 'z500', 'thick', 'rh925', 'rh850', 'rh700', 'rh500', 'wbpt850', 'wind925', 'wind850', 'wind700', 'wind500',
                 'wind300', 'wind250', 'wind200', 'w700', 'w500', 'vort500']

    def schedule(self, run):
        return list(range(0, 49)) + list(range(51, 241, 3))

    def url(self, run, h, name='AirTemp_AGL-2m'):
        return GDPS_BASE.format(day=run, run=run, h=h) + f'{run:%Y%m%d}T{run:%H}Z_MSC_GDPS_{name}_LatLon0.15_PT{h:03d}H.grib2'

    def runs(self, n=None):
        return recent_runs(lambda r, h: exists(self.url(r, h)), self.schedule, cycles=(0, 12), n=n)

    # the fields published every hour (the rest every 3 hours; the 6-hour max/min every 6), and the
    # ones that start at T+1 (rates and totals: nothing has fallen at the analysis)
    HOURLY = {'AirTemp_AGL-2m', 'DewPoint_AGL-2m', 'RelativeHumidity_AGL-2m', 'SpecificHumidity_AGL-2m', 'WindSpeed_AGL-10m',
              'WindDir_AGL-10m', 'WindGust_AGL-10m', 'WindGust-Max_AGL-10m', 'Pressure_MSL', 'Pressure_Sfc', 'PrecipRate_Sfc',
              'Precip-Accum_Sfc', 'Precip-Accum1h_Sfc', 'Rain-Accum1h_Sfc', 'Snow-Accum1h_Sfc', 'Snow-Accum_Sfc', 'Rain-Accum_Sfc',
              'FreezingRain-Accum_Sfc', 'IcePellets-Accum_Sfc', 'ConvectivePrecip-Accum_Sfc', 'TotalCloudCover_Sfc',
              'PlanetaryBoundaryLayerHeight_Sfc', 'SnowDepth_Sfc', 'UVIndex_Sfc', 'LatentHeatNetFlux_Sfc', 'SensibleHeatNetFlux_Sfc',
              'UpwardLongwaveRadiationFlux_NTAtm', 'SoilTemp_DBS-0to10cm', 'SoilVolumetricWaterContent_DBS-0to10cm', 'Albedo_Sfc',
              'SoilTemp_Sfc', 'WindSpeed_IsbL-0700'}
    SIX_HOURLY = {'AirTemp-Max_AGL-2m', 'AirTemp-Min_AGL-2m'}

    def _published(self, h, name):
        if h == 0 and (name.startswith(('Precip', 'Rain-', 'Snow-', 'FreezingRain', 'IcePellets', 'ConvectivePrecip')) or name in self.SIX_HOURLY):
            return False
        return h % (6 if name in self.SIX_HOURLY else 1 if name in self.HOURLY else 3) == 0

    def _get(self, run, h, name):
        if not self._published(h, name):
            raise KeyError(f'GDPS publishes {name} only every {6 if name in self.SIX_HOURLY else 3} hours')
        a, meta = decode_grib(get(self.url(run, h, name), tries=3, timeout=120))
        return np.asarray(a, np.float32).reshape(meta['Nj'], meta['Ni']), meta

    def field(self, run, h, var, prev_h, prev_raw=None):
        names = self.SPEC[var]
        import concurrent.futures as cf
        with cf.ThreadPoolExecutor(len(names)) as ex:
            got = list(ex.map(lambda nm: self._get(run, h, nm), names))
        meta = got[0][1]
        cat = var == 'ptype'
        A = [ECMWF._to_display(self, a, m, nearest=(cat and i == 0)) for i, (a, m) in enumerate(got)]
        C = lambda a: a - 273.15 if np.nanmax(a) > 150 else a          # noqa: E731  (kelvin where it is)
        if var in ('t2', 'td2', 't2max', 't2min', 'tskin', 'windchill', 'soil_t') or (var.startswith('t') and var[1:].isdigit()):
            return C(A[0])
        if var in ('wind10', 'gust10', 'gust_max') or var.startswith('wind'):
            return A[0] * MPH
        if var in ('mslp', 'sp'):
            return A[0] / 100.0
        if var == 'precip_rate':                                        # kg m-2 s-1 (mm/s), or m/s where it is
            return A[0] * (3.6e6 if np.nanmax(A[0]) < 0.01 else 3600.0)
        if var in ('precip_total', 'precip_1h', 'rain_1h', 'snow_1h', 'snow_total', 'rain_total', 'frzr_total', 'icep_total', 'conv_total'):
            return np.clip(A[0] * (1000.0 if np.nanmax(A[0]) < 5 and h > 6 else 1.0), 0, None)
        if var == 'ptype':
            from .derived import typed_rate
            code = np.nan_to_num(A[0]).astype(np.int16)
            rate = A[1] * (3.6e6 if np.nanmax(A[1]) < 0.01 else 3600.0)
            return typed_rate(rate, np.where(rate >= 0.05, code, 0))
        if var == 'snow_depth':
            return A[0] * 100.0
        if var == 'q2':
            return A[0] * 1000.0
        if var in ('z850', 'z500'):
            return A[0] / 10.0
        if var == 'thick':
            return (A[0] - A[1]) / 10.0
        if var == 'vort500':
            return A[0] * 1e5
        if var == 'wbpt850':
            from .models import _q_from_rh
            t = C(A[0])
            return _theta_w(_theta_e(t + 273.15, _q_from_rh(t, A[1], 850.0), 850.0))
        if var == 'soil_m':
            return np.clip(A[0] * (100.0 if np.nanmax(A[0]) <= 1.5 else 1.0), 0, 100)
        if var in ('tcc', 'rh2') or var.startswith('rh'):
            return np.clip(A[0] * (100.0 if np.nanmax(A[0]) <= 1.5 else 1.0), 0, 100)
        if var == 'albedo':
            return np.clip(A[0] * (100.0 if np.nanmax(A[0]) <= 1.5 else 1.0), 0, 100)
        return A[0]


# ── MET Norway MEPS (HARMONIE-AROME, MetCoOp), 2.5 km over the Nordic countries ───────────────────
# Read field by field over OPeNDAP from MET Norway's THREDDS (no whole-file downloads): a run every 3
# hours, hourly to 66 h. Its Lambert grid is regridded onto the wide grid; cells outside its area stay empty.
MEPS_CAT = 'https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml'
MEPS_DAP = 'https://thredds.met.no/thredds/dodsC/mepslatest/meps_det_2_5km_{run:%Y%m%dT%H}Z.ncml'
MEPS_PROJ = '+proj=lcc +lat_1=63.3 +lat_2=63.3 +lat_0=63.3 +lon_0=15 +R=6371000 +units=m +no_defs'
_P = (50, 100, 150, 200, 250, 300, 400, 500, 700, 800, 850, 925, 1000)


_MEPS_LOCK = __import__('threading').RLock()     # netCDF-C / libcurl are not thread-safe: one DAP read at a time
# MEPS precipitation_type (MET Norway's codes, worked out from the run's own rain, snow and graupel
# shares and temperatures, 15 Nov 2026): 0 drizzle, 1 rain, 2 sleet, 3 snow, 4 freezing drizzle,
# 5 freezing rain, 6 graupel, 7 hail -> the ECMWF codes typed_rate takes (graupel counted as snow)
MEPS_PTYPE = {0: 11, 1: 1, 2: 7, 3: 5, 4: 12, 5: 3, 6: 5, 7: 10}


class MEPS:
    id, label, res_km = 'meps', 'MET Norway MEPS (HARMONIE-AROME)', 2.5
    # our layer: [(MEPS variable, level index or pressure in hPa)]
    SPEC = {
        't2': [('air_temperature_2m', 0)], 'rh2': [('relative_humidity_2m', 0)], 'td2': [('air_temperature_2m', 0), ('relative_humidity_2m', 0)],
        'q2': [('specific_humidity_2m', 0)], 'tskin': [('air_temperature_0m', 0)],
        't2max': [('air_temperature_max', 0)], 't2min': [('air_temperature_min', 0)],
        'wind10': [('x_wind_10m', 0), ('y_wind_10m', 0)], 'wdir10': [('x_wind_10m', 0), ('y_wind_10m', 0)],
        'gust10': [('wind_speed_of_gust', 0)],
        'mslp': [('air_pressure_at_sea_level', 0)], 'sp': [('surface_air_pressure', 0)],
        'precip_total': [('precipitation_amount_acc', 0)], 'precip_rate': [('precipitation_amount_acc', 0)],
        'snow_total': [('snowfall_amount_acc', 0)], 'snow_rate': [('snowfall_amount_acc', 0)],
        'ptype': [('precipitation_type', 0), ('precipitation_amount_acc', 0)],
        'tcc': [('cloud_area_fraction', 0)], 'lcc': [('low_type_cloud_area_fraction', 0)],
        'mcc': [('medium_type_cloud_area_fraction', 0)], 'hcc': [('high_type_cloud_area_fraction', 0)],
        'cloud_base': [('cloud_base_altitude', 0)], 'cloud_top': [('cloud_top_altitude', 0)],
        'vis': [('visibility_in_air', 0)], 'fog': [('fog_area_fraction', 0)],
        'cape_sb': [('specific_convective_available_potential_energy', 0)], 'cin_sb': [('atmosphere_convective_inhibition', 0)],
        'lightning_index': [('lightning_index', 0)],
        'frz': [('altitude_of_0_degree_isotherm', 0)], 'hpbl': [('atmosphere_boundary_layer_thickness', 0)],
        'pw': [('lwe_thickness_of_atmosphere_mass_content_of_water_vapor', 0)],
        'sw_down': [('surface_downwelling_shortwave_flux_in_air', 0)], 'lw_down': [('surface_downwelling_longwave_flux_in_air', 0)],
        'olr': [('toa_outgoing_longwave_flux', 0)], 'trop_p': [('tropopause_air_pressure', 0)], 'trop_t': [('tropopause_air_temperature', 0)],
        **{f't{p}': [('air_temperature_pl', p)] for p in (925, 850, 700, 500, 300)},
        **{f'rh{p}': [('relative_humidity_pl', p)] for p in (925, 850, 700, 500)},
        **{f'z{p}': [('geopotential_pl', p)] for p in (850, 500)},
        'thick': [('geopotential_pl', 500), ('geopotential_pl', 1000)],
        **{f'wind{p}': [('x_wind_pl', p), ('y_wind_pl', p)] for p in (925, 850, 700, 500, 300, 250, 200)},
    }
    CODED = {'precipitation_type'}                      # categories: the nearest point, never averaged
    # (its lifting_condensation_level and convective_cloud_area_fraction are zero everywhere at every step: left out)
    variables = ['precip_rate', 'precip_total', 'ptype', 'snow_rate', 'snow_total', 'snow_acc', 't2', 't2max', 't2min', 'td2', 'rh2',
                 'q2', 'tskin', 'wind10', 'wdir10', 'gust10', 'gust_peak', 'mslp', 'sp', 'tcc', 'lcc', 'mcc', 'hcc',
                 'cloud_base', 'cloud_top', 'vis', 'fog', 'cape_sb', 'cin_sb', 'lightning_index', 'frz', 'hpbl', 'pw', 'sw_down',
                 'lw_down', 'olr', 'trop_p', 'trop_t', 't925', 't850', 't700', 't500', 't300', 'rh925', 'rh850', 'rh700', 'rh500',
                 'z850', 'z500', 'thick', 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 'wind200']

    def __init__(self):
        self._ds, self._frac, self._off, self._rot = {}, None, None, None

    def schedule(self, run):
        return list(range(0, 67))

    def runs(self, n=None):
        import re
        from datetime import datetime, timezone
        xml = get(MEPS_CAT, tries=3, timeout=60).decode()
        stamps = sorted(set(re.findall(r'meps_det_2_5km_(\d{8}T\d{2})Z\.ncml', xml)), reverse=True)
        out = [(datetime.strptime(s, '%Y%m%dT%H').replace(tzinfo=timezone.utc), self.schedule(None)) for s in stamps]
        return out[:n] if n else out[:8]

    def _open(self, run):
        import netCDF4
        with _MEPS_LOCK:
            if run not in self._ds:
                self._ds[run] = netCDF4.Dataset(MEPS_DAP.format(run=run))
            return self._ds[run]

    def _geo(self):
        """Where each display cell falls on the MEPS grid (fractional rows and columns), the cells
        outside its area, and the angle from its grid's north to true north at each cell."""
        with _MEPS_LOCK:
            if self._frac is None:
                from pyproj import Transformer
                from .common import lonlat
                lon, lat = lonlat()
                x, y = Transformer.from_crs('EPSG:4326', MEPS_PROJ, always_xy=True).transform(lon, lat)
                fi, fj = (np.asarray(x) - (-1060084.0)) / 2500.0, (np.asarray(y) - (-1332517.875)) / 2500.0
                self._off = ((fi < 0) | (fi > 948) | (fj < 0) | (fj > 1068)).reshape(NY, NX)
                self._frac = (fj.ravel(), fi.ravel(), False)
                # Lambert conformal, one standard parallel: grid north turns by n*(lon - lon0), n = sin(63.3)
                self._rot = (np.sin(np.radians(63.3)) * np.radians(((np.asarray(lon) - 15.0 + 180.0) % 360.0) - 180.0)).reshape(NY, NX)
        return self._frac

    def _read(self, run, h, name, lev, fill=None):
        """One field at step h on the display grid. The 2.5 km field is averaged over each 10 km cell
        first (a point sample would pick out single showers), cells the model leaves empty (no cloud
        base where there is no cloud) stay empty, and `fill` stands in for them where it is given."""
        with _MEPS_LOCK:
            ds = self._open(run)
            v = ds[name]
            if h >= v.shape[0]:
                raise KeyError(f'{name} has no T+{h} in the MEPS {run:%d %HZ} run')
            k = _P.index(lev) if 'pressure' in v.dimensions else lev
            a = np.ma.filled(np.ma.asarray(v[h, k, :, :]).astype(np.float32), np.nan)
        a[np.abs(a) > 1e30] = np.nan
        if fill is not None:
            a = np.where(np.isfinite(a), a, np.float32(fill))
        frac = self._geo()
        if name in self.CODED:
            fj, fi, _ = frac
            j = np.clip(np.rint(fj).astype(np.int64), 0, a.shape[0] - 1)
            i = np.clip(np.rint(fi).astype(np.int64), 0, a.shape[1] - 1)
            out = a[j, i].reshape(NY, NX).astype(np.float32)
        else:
            from scipy import ndimage
            from .common import smooth_sample
            ok = np.isfinite(a)
            w = ndimage.uniform_filter(ok.astype(np.float32), 4, mode='nearest')
            s = ndimage.uniform_filter(np.where(ok, a, 0).astype(np.float32), 4, mode='nearest')
            with np.errstate(invalid='ignore', divide='ignore'):
                m = np.where(w > 0.25, s / np.maximum(w, 1e-6), np.nan)
            okm = np.isfinite(m)
            out = smooth_sample(np.where(okm, m, 0), frac).astype(np.float32)
            if not okm.all():
                out[smooth_sample(okm.astype(np.float32), frac) < 0.5] = np.nan
        out[self._off] = np.nan
        return out

    def field(self, run, h, var, prev_h, prev_raw=None):
        spec = self.SPEC[var]
        if var == 'ptype':                               # its own type, at the rate of the past hour
            from .derived import typed_rate
            code = self._read(run, h, *spec[0])
            if h == 0:
                return np.where(self._off, np.nan, 0).astype(np.float32)
            rate = np.maximum(self._read(run, h, *spec[1]) - self._read(run, h - 1, *spec[1]), 0)
            ecm = np.zeros(code.shape, np.int16)
            for c, e in MEPS_PTYPE.items():
                ecm[code == c] = e
            return typed_rate(rate, np.where(rate >= 0.05, ecm, 0))
        A = [self._read(run, h, nm, lev, fill=0.0 if var == 'frz' else None) for nm, lev in spec]
        if var in ('t2', 'tskin', 't2max', 't2min', 'trop_t') or (var.startswith('t') and var[1:].isdigit()):
            return A[0] - 273.15
        if var == 'td2':
            from .models import _dewpoint
            return _dewpoint(A[0] - 273.15, np.clip(A[1], 0.01, 1) * 100.0)
        if var in ('rh2', 'tcc', 'lcc', 'mcc', 'hcc', 'fog') or var.startswith('rh'):
            return np.clip(A[0] * 100.0, 0, 100)
        if var == 'q2':
            return A[0] * 1000.0
        if var == 'wdir10':                              # grid-relative winds turned to true north
            th = self._rot
            ue = A[0] * np.cos(th) + A[1] * np.sin(th)
            ve = -A[0] * np.sin(th) + A[1] * np.cos(th)
            return ((np.degrees(np.arctan2(-ue, -ve)) + 360.0) % 360.0).astype(np.float32)
        if var == 'wind10' or var.startswith('wind'):
            return np.hypot(A[0], A[1]) * MPH
        if var == 'gust10':
            return A[0] * MPH
        if var in ('mslp', 'sp', 'trop_p'):
            return A[0] / 100.0
        if var in ('z850', 'z500'):
            return A[0] / 98.0665
        if var == 'thick':
            return (A[0] - A[1]) / 98.0665
        if var == 'vis':
            return A[0] / 1000.0
        if var == 'pw':                                  # metres of water -> mm
            return A[0] * (1000.0 if np.nanmax(A[0]) < 1.0 else 1.0)
        if var == 'olr':
            return np.abs(A[0])
        return A[0]                                      # totals (mm; differenced into rates in job.py), CAPE, heights (m), fluxes


# layers only the newer models have
VARIABLES_MORE = {
    'cloud_top': dict(label='Cloud top height', unit='m', group='Cloud & visibility', lo=0, hi=14000, scale='sqrt'),
    'lightning_index': dict(label='Lightning index', unit='', group='Convection', lo=0, hi=50, scale='sqrt'),
}


SOURCES_MORE = {
    'aigfs': 'NOAA AIGFS 0.25° (the GFS’s operational AI version) — NOAA NOMADS (aigfs v1.1)',
    'gdps': 'ECCC GDPS 0.15° (15 km), Environment and Climate Change Canada — MSC Datamart (dd.weather.gc.ca)',
    'meps': 'MET Norway MEPS 2.5 km (HARMONIE-AROME, MetCoOp) — MET Norway THREDDS (thredds.met.no)',
}
MODELS_MORE = [AIGFS(), GDPS(), MEPS()]
# accumulations differenced between steps into rates (job.py DIFFERENCED, RATE_DIFF)
DIFFERENCED_MORE = {('meps', 'precip_rate'), ('meps', 'snow_rate')}
