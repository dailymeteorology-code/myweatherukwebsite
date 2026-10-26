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

import concurrent.futures as cf
import io
import re
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import NC_LOCK, NX, NY, X0, DX, regular_frac, smooth_sample

from nova.io_aws import decode_grib, ecmwf_index, exists, fetch_ranges, get, open_nc   # noqa: E402

MPH = 2.236936


class _HttpFile(io.RawIOBase):
    """A read-only file over HTTP byte ranges, kept in whole blocks, so h5py can read one level of
    a Met Office pressure-level file without the rest. Those files hold every level of the model
    (MO Global's 158-210 MB a step); a level is ~4 MB of 128x128 chunks. Finding them walks the
    chunk index, ~50 small reads scattered through the file one after another: those go over one
    kept-open connection in small blocks; the level's data, found, comes in a few large pieces at
    once (prefetch)."""
    BLOCK = 1 << 16

    def __init__(self, url):
        import urllib.parse
        u = urllib.parse.urlsplit(url)
        self.url, self.host, self.path = url, u.netloc, u.path + (f'?{u.query}' if u.query else '')
        self.pos, self.blocks, self.conn = 0, {}, None
        self.size = int(self._request('HEAD')[1]['Content-Length'])

    def _request(self, method, rng=None):
        import http.client
        import time
        for i in range(4):
            try:
                if self.conn is None:
                    self.conn = http.client.HTTPSConnection(self.host, timeout=60)
                h = {'User-Agent': 'MyWeatherUK-modeldata/1.0'}
                if rng:
                    h['Range'] = f'bytes={rng[0]}-{rng[1]}'
                self.conn.request(method, self.path, headers=h)
                r = self.conn.getresponse()
                data = r.read()
                if r.status not in (200, 206):
                    raise OSError(f'HTTP {r.status}')
                return data, r.headers
            except Exception:
                if self.conn is not None:
                    self.conn.close()
                self.conn = None
                if i == 3:
                    raise
                time.sleep(0.5 * (i + 1))

    def close(self):
        if self.conn is not None:
            self.conn.close()
            self.conn = None
        super().close()

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i):
        if i not in self.blocks:
            self.blocks[i] = self._request('GET', (i * self.BLOCK, min(self.size, (i + 1) * self.BLOCK) - 1))[0]
        return self.blocks[i]

    def prefetch(self, spans):
        """The blocks under [(offset, length)], fetched in pieces of up to 2 MB, in parallel."""
        want = sorted({b for off, n in spans for b in range(off // self.BLOCK, (off + n - 1) // self.BLOCK + 1)} - set(self.blocks))
        runs = []
        for b in want:
            if runs and b == runs[-1][1] + 1 and runs[-1][1] - runs[-1][0] < 31:
                runs[-1][1] = b
            else:
                runs.append([b, b])

        def one(r):
            a, z = r
            blob = get(self.url, (a * self.BLOCK, min(self.size, (z + 1) * self.BLOCK) - 1))
            return {b: blob[(b - a) * self.BLOCK:(b - a + 1) * self.BLOCK] for b in range(a, z + 1)}
        with cf.ThreadPoolExecutor(8) as ex:
            for d in ex.map(one, runs):
                self.blocks.update(d)

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        out = bytearray()
        while len(out) < n:
            p = self.pos + len(out)
            i = p // self.BLOCK
            out += self._block(i)[p - i * self.BLOCK:p - i * self.BLOCK + n - len(out)]
        buf[:n] = out
        self.pos += n
        return n


# ── variables: one definition shared by every model ─────────────────────────
VARIABLES = {
    # precipitation
    'precip_rate':  dict(label='Precipitation rate', unit='mm/h', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'precip_1h':    dict(label='Precipitation (past hour)', unit='mm', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'precip_total': dict(label='Total precipitation', unit='mm', group='Precipitation', lo=0, hi=400, scale='sqrt'),
    # the amount since the run's previous step (1 h to T+54, 3 h beyond): exact per-step amounts for
    # the Location page, where differencing the byte-quantised running total would be too coarse
    'precip_step':  dict(label='Precipitation since the previous step', unit='mm', group='Precipitation', lo=0, hi=150, scale='sqrt'),
    'rain_rate':    dict(label='Rain rate', unit='mm/h', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'conv_rain':    dict(label='Convective rain rate', unit='mm/h', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'refc':         dict(label='Simulated radar (composite)', unit='dBZ', group='Precipitation', lo=-10, hi=75),
    'hail_rate':    dict(label='Hail fall rate', unit='mm/h', group='Precipitation', lo=0, hi=50, scale='sqrt'),
    # snow & ice
    'snow_rate':    dict(label='Snowfall rate (water equiv.)', unit='mm/h', group='Snow & ice', lo=0, hi=30, scale='sqrt'),
    'snow_1h':      dict(label='Snowfall (past hour, water equiv.)', unit='mm', group='Snow & ice', lo=0, hi=30, scale='sqrt'),
    'snow_total':   dict(label='Total snowfall (water equiv.)', unit='mm', group='Snow & ice', lo=0, hi=200, scale='sqrt'),
    'snow_step':    dict(label='Snowfall since the previous step (water equiv.)', unit='mm', group='Snow & ice', lo=0, hi=60, scale='sqrt'),
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
    # the strongest gust at each point from the start of the run to the step on screen (mdata/job.py)
    'gust_peak':    dict(label='Max gust so far (this run)', unit='mph', group='Wind & pressure', lo=0, hi=150),
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
    # the Met Office UV flux is close to the UV-B band: about 0.3 W/m² at a clear October noon, ~1.5 in summer
    'uv_down':      dict(label='UV radiation (downward)', unit='W/m²', group='Radiation & surface', lo=0, hi=3, scale='sqrt'),
    'shf':          dict(label='Sensible heat flux', unit='W/m²', group='Radiation & surface', lo=-200, hi=600),
    # wind direction (drawn as arrows over any layer), wind chill and the weather type (symbols)
    'wdir10':       dict(label='Wind direction (10 m)', unit='°', group='Wind & pressure', lo=0, hi=360),
    'windchill':    dict(label='Wind chill', unit='°C', group='Temperature', lo=-45, hi=35),
    'wx':           dict(label='Weather type', unit='', group='Cloud & visibility', lo=0, hi=254),
    # sea state (ECMWF WAM, NOAA GFS-Wave)
    'swh':          dict(label='Wave height (significant)', unit='m', group='Sea & waves', lo=0, hi=20, scale='sqrt'),
    'mwp':          dict(label='Wave period (mean)', unit='s', group='Sea & waves', lo=0, hi=25),
    'pp1d':         dict(label='Wave period (peak)', unit='s', group='Sea & waves', lo=0, hi=30),
    'mwd':          dict(label='Wave direction', unit='°', group='Sea & waves', lo=0, hi=360),
    # added 26 Oct 2026: every further field each model publishes that makes a useful map
    'rain_1h':      dict(label='Rain (past hour)', unit='mm', group='Precipitation', lo=0, hi=100, scale='sqrt'),
    'hail_1h':      dict(label='Hail (past hour)', unit='mm', group='Precipitation', lo=0, hi=50, scale='sqrt'),
    'conv_total':   dict(label='Convective precipitation (total)', unit='mm', group='Precipitation', lo=0, hi=300, scale='sqrt'),
    # 0 none, 1 rain, 3 freezing rain, 5 snow, 6 wet snow, 7 rain and snow, 8 ice pellets, 12 freezing drizzle (ECMWF's codes)
    'ptype':        dict(label='Precipitation type', unit='', group='Precipitation', lo=0, hi=12),
    'frozen_pct':   dict(label='Share of precipitation falling frozen', unit='%', group='Snow & ice', lo=0, hi=100),
    # snowfall as a depth, at the usual 10:1 ratio of fresh snow to water
    'snow_acc':     dict(label='Snow accumulation (10:1)', unit='cm', group='Snow & ice', lo=0, hi=200, scale='sqrt'),
    't2max3':       dict(label='Max temperature (past 3 h)', unit='°C', group='Temperature', lo=-35, hi=45),
    't2min3':       dict(label='Min temperature (past 3 h)', unit='°C', group='Temperature', lo=-35, hi=45),
    't925':         dict(label='Temperature 925 hPa', unit='°C', group='Upper air', lo=-35, hi=35),
    't700':         dict(label='Temperature 700 hPa', unit='°C', group='Upper air', lo=-45, hi=20),
    'rh850':        dict(label='Relative humidity 850 hPa', unit='%', group='Upper air', lo=0, hi=100),
    'z850':         dict(label='850 hPa height', unit='dam', group='Upper air', lo=100, hi=170),
    'thick':        dict(label='1000-500 hPa thickness', unit='dam', group='Upper air', lo=480, hi=590),
    'wind925':      dict(label='Wind 925 hPa', unit='mph', group='Upper air', lo=0, hi=180),
    'wind700':      dict(label='Wind 700 hPa', unit='mph', group='Upper air', lo=0, hi=200),
    'wind300':      dict(label='Wind 300 hPa', unit='mph', group='Upper air', lo=0, hi=280),
    'w700':         dict(label='Vertical motion 700 hPa (negative = rising)', unit='Pa/s', group='Upper air', lo=-4, hi=4),
    'vort500':      dict(label='Relative vorticity 500 hPa', unit='10⁻⁵/s', group='Upper air', lo=-40, hi=60),
    'trop_t':       dict(label='Tropopause temperature', unit='°C', group='Upper air', lo=-85, hi=-30),
    'kindex':       dict(label='K-index (thunderstorm potential)', unit='°C', group='Convection', lo=-20, hi=50),
    'cin_ml':       dict(label='CIN (mixed layer)', unit='J/kg', group='Convection', lo=-800, hi=0),
    'hpbl':         dict(label='Boundary layer height', unit='m', group='Convection', lo=0, hi=4000, scale='sqrt'),
    'conv_cloud':   dict(label='Convective cloud', unit='%', group='Cloud & visibility', lo=0, hi=100),
    'sw_direct':    dict(label='Direct sunshine (radiation)', unit='W/m²', group='Radiation & surface', lo=0, hi=1100),
    'lhf':          dict(label='Latent heat flux (evaporation)', unit='W/m²', group='Radiation & surface', lo=-100, hi=600),
    'olr':          dict(label='Outgoing longwave (satellite-like cloud tops)', unit='W/m²', group='Radiation & surface', lo=80, hi=340),
    # air quality (NOAA GEFS-Aerosols)
    'aod':          dict(label='Aerosol optical depth (all, 550 nm)', unit='', group='Air quality', lo=0, hi=4, scale='sqrt'),
    'dust_aod':     dict(label='Saharan dust (optical depth)', unit='', group='Air quality', lo=0, hi=4, scale='sqrt'),
    'pm25':         dict(label='PM2.5 (fine particles)', unit='µg/m³', group='Air quality', lo=0, hi=400, scale='sqrt'),
    'pm10':         dict(label='PM10 (coarse particles)', unit='µg/m³', group='Air quality', lo=0, hi=600, scale='sqrt'),
}

# accumulated-from-T+0 quantities and how they are built
ACCUM = {'precip_total', 'snow_total'}
STEP_VARS = {'precip_step', 'snow_step'}       # an amount over whatever span the step covers (1 or 3 h)


def _utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)


def _feels(t, td, w_mph):
    """UK Met Office-style feels-like: wind chill below 10 C, heat index above 26 C."""
    v = w_mph * 1.609344
    wc = 13.12 + 0.6215 * t - 11.37 * np.power(np.maximum(v, 4.8), 0.16) + 0.3965 * t * np.power(np.maximum(v, 4.8), 0.16)
    e = 6.105 * np.exp(17.27 * td / (237.7 + td))
    at = t + 0.33 * e - 0.70 * (v / 3.6) - 4.0
    return np.where(t <= 10, np.minimum(wc, t), np.where(t >= 26, np.maximum(at, t), t))


def _windchill(t, w_mph):
    """Wind chill (JAG/TI, as the Met Office and NWS): 10 m wind in km/h, defined for T <= 10 C
    and wind above 4.8 km/h; elsewhere it is the air temperature."""
    v = w_mph * 1.609344
    p = np.power(np.maximum(v, 4.8), 0.16)
    wc = 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p
    return np.where((t <= 10) & (v > 4.8), np.minimum(wc, t), t)


def _wdir(u, v):
    """Meteorological direction (degrees the wind blows FROM) of earth-relative u, v."""
    with np.errstate(invalid='ignore'):
        return np.mod(np.degrees(np.arctan2(-u, -v)), 360.0)


_LAND = None


def _sea_only(a):
    """A wave field over the sea only. The smooth resampling of a 0.25-degree wave grid carries
    sea values up to a grid cell inland, so the display grid's land (Natural Earth) is blanked."""
    global _LAND
    if _LAND is None:
        from .common import STATIC
        try:
            _LAND = np.load(STATIC / 'land_mask.npy')
        except Exception:
            _LAND = np.zeros((NY, NX), bool)
    return np.where(_LAND, np.nan, a).astype(np.float32)


def _dewpoint(t, rh):
    """Dew point (C) from temperature (C) and relative humidity (%), Magnus."""
    g = np.log(np.clip(rh, 1, 100) / 100.0) + 17.625 * t / (243.04 + t)
    return 243.04 * g / (17.625 - g)


def _rh_from_q(t, q, p_hpa):
    """Relative humidity (%) from temperature (C) and specific humidity (kg/kg) at a pressure level."""
    e = q * p_hpa / (0.622 + 0.378 * q)
    return np.clip(100.0 * e / (6.112 * np.exp(17.67 * t / (t + 243.5))), 0, 100)


def _kindex(t850, t700, t500, rh850, rh700):
    """K-index (C): (T850 - T500) + Td850 - (T700 - Td700), from temperatures (C) and humidities (%)."""
    return (t850 - t500) + _dewpoint(t850, rh850) - (t700 - _dewpoint(t700, rh700))


def _pct(a):
    """A fraction or a percentage, as a percentage."""
    return a * 100.0 if np.nanmax(a) <= 1.6 else a


def _coriolis():
    """The Coriolis parameter (1/s) of every display cell."""
    from .common import lonlat
    return 2 * 7.2921e-5 * np.sin(np.radians(lonlat()[1]))


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
        # UKV reaches T+120 only from 03Z and 15Z: once those fall out of the newest n, keep the
        # newest of them listed anyway (marked `kept`), so the Location page always has days 3-5
        self.kept_runs = set()
        if self.id == 'ukv' and not any(max(s) >= 120 for _, s in out):
            listed = {r for r, _ in out}
            for r in runs:
                if r in listed or r.hour % 12 != 3:
                    continue
                steps = self.steps(r)
                if steps and max(steps) >= 120:
                    out.append((r, steps))
                    self.kept_runs.add(r)
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
        a, units, geo = self._load(run, h, name, level)
        return self._to_display(a, geo), units

    def _levels(self, run, h, name, levels):
        """Some levels of a multi-level file, on the display grid: ([arrays], units). Only those
        levels' chunks are fetched (h5py finds them, they come in parallel, h5py decodes them)."""
        import h5py
        f = _HttpFile(self.url(run, h, name))
        with NC_LOCK:
            hf = h5py.File(f, 'r')
            ds = next(v for k, v in hf.items() if isinstance(v, h5py.Dataset) and v.ndim == 3 and k != 'flag')
            levs = np.asarray(hf['pressure' if 'pressure' in hf else 'height'][:], float)
            ks = [int(np.argmin(np.abs(levs - lv))) for lv in levels]
            cz, cy, cx = ds.chunks
            spans = []
            for k in ks:
                for j in range(0, ds.shape[1], cy):
                    for i in range(0, ds.shape[2], cx):
                        c = ds.id.get_chunk_info_by_coord((k - k % cz, j, i))
                        spans.append((c.byte_offset, c.size))
        f.prefetch(spans)
        with NC_LOCK:
            arrs = [np.asarray(ds[k], np.float32) for k in ks]
            units = ds.attrs.get('units', b'')
            units = units.decode() if isinstance(units, bytes) else str(units)
            if 'projection_x_coordinate' in hf:
                x, y = hf['projection_x_coordinate'][:], hf['projection_y_coordinate'][:]
                geo = ('laea', float(x[0]), float(x[1] - x[0]), float(y[0]), float(y[1] - y[0]), len(x), len(y))
            else:
                geo = ('ll', np.asarray(hf['latitude'][:], float), np.asarray(hf['longitude'][:], float))
            hf.close()
        f.close()
        return [self._to_display(a, geo) for a in arrs], units

    def _load(self, run, h, name, level=None):
        """The field on the model's own grid: (array, units, geometry)."""
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
        return a, units, geo

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
        if var in ('precip_total', 'precip_1h', 'snow_total', 'snow_1h', 'precip_step', 'snow_step'):
            stem = 'precipitation_accumulation' if var.startswith('precip') else 'snowfall_accumulation'
            if h == 0:
                return np.zeros((NY, NX), np.float32), 0
            # hourly accumulations to T+54, 3-hourly beyond (where only every third hour is published);
            # returns (mm, hours covered) so job.py can chain them into a running total
            if stem == 'snowfall_accumulation' and self.id == 'mo_global':
                # the Global publishes no snowfall amounts: the precipitation amount times the share
                # falling as snow at the step (its snowfall rate over its precipitation rate)
                amt, hours = self.field(run, h, var.replace('snow', 'precip'), prev_h)
                sr, _ = self._read(run, h, F['snow_rate'])
                pr, _ = self._read(run, h, F['precip_rate'])
                with np.errstate(invalid='ignore', divide='ignore'):
                    frac = np.where(pr > 1e-7, np.clip(sr / np.maximum(pr, 1e-9), 0, 1), 0)
                return (amt * frac).astype(np.float32), hours
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
        if var == 'windchill':
            t, _ = self._read(run, h, F['t2'])
            w, _ = self._read(run, h, F['wind10'])
            return _windchill(t - 273.15, w * MPH)
        if var == 'wdir10':
            # direction cannot be interpolated across north (359 -> 1): go through the wind's
            # components on the model grid, interpolate those, and take the direction after
            s, _, geo = self._load(run, h, F['wind10'])
            d, _, _ = self._load(run, h, 'wind_direction_at_10m')
            r = np.radians(d)
            return _wdir(self._to_display(-s * np.sin(r), geo), self._to_display(-s * np.cos(r), geo))
        if var == 'thick':
            (z5, z1), _ = self._levels(run, h, 'geopotential_height_on_pressure_levels', (50000.0, 100000.0))
            return (z5 - z1) / 10.0
        if var == 'kindex':
            (t8, t7, t5), _ = self._levels(run, h, 'temperature_on_pressure_levels', (85000.0, 70000.0, 50000.0))
            (r8, r7), _ = self._levels(run, h, 'relative_humidity_on_pressure_levels', (85000.0, 70000.0))
            return _kindex(t8 - 273.15, t7 - 273.15, t5 - 273.15, _pct(r8), _pct(r7))
        if var in self.pl_files:
            name, level = self.pl_files[var]
            (a,), units = self._levels(run, h, name, (level,))
            if units == 'K' or (var == 'wbpt850' and np.nanmean(a) > 150):
                return a - 273.15
            if name.startswith('geopotential'):
                return a / 10.0
            if name.startswith('relative_humidity'):
                return _pct(a)
            if name.startswith('wind_speed'):
                return a * MPH
            if name.startswith('wind_vertical'):
                return a * -8.86                   # m/s upward -> Pa/s (rising negative), at about 0.9 kg/m3
            return a
        a, units = self._read(run, h, F[var])
        if units == 'K':
            return a - 273.15
        if var in ('precip_rate', 'rain_rate', 'snow_rate', 'conv_rain', 'hail_rate'):
            return a * (3.6e6 if units == 'm s-1' else 3600.0)
        if units == 'Pa':
            return a / 100.0
        if var in ('wind10', 'gust10', 'gust_max'):
            return a * MPH
        if var in ('tcc', 'lcc', 'mcc', 'hcc', 'cloud_1000ft', 'fog', 'rh2', 'conv_cloud'):
            return a * 100.0 if np.nanmax(a) <= 1.6 else a
        if var == 'vis':
            return a / 1000.0
        if var == 'lightning':
            return a * 1e6
        if var in ('cin_sb', 'cin_mu', 'cin_ml'):
            return -np.abs(a)
        return a


# pressure-level fields both Met Office models publish: (file name, level in Pa)
MO_PL = {
    't925': ('temperature_on_pressure_levels', 92500.0), 't850': ('temperature_on_pressure_levels', 85000.0),
    't700': ('temperature_on_pressure_levels', 70000.0), 't500': ('temperature_on_pressure_levels', 50000.0),
    'z850': ('geopotential_height_on_pressure_levels', 85000.0), 'z500': ('geopotential_height_on_pressure_levels', 50000.0),
    'rh850': ('relative_humidity_on_pressure_levels', 85000.0), 'rh700': ('relative_humidity_on_pressure_levels', 70000.0),
    'wind925': ('wind_speed_on_pressure_levels', 92500.0), 'wind850': ('wind_speed_on_pressure_levels', 85000.0),
    'wind700': ('wind_speed_on_pressure_levels', 70000.0), 'wind500': ('wind_speed_on_pressure_levels', 50000.0),
    'wind300': ('wind_speed_on_pressure_levels', 30000.0), 'wind250': ('wind_speed_on_pressure_levels', 25000.0),
    'wbpt850': ('wet_bulb_potential_temperature_on_pressure_levels', 85000.0),
}
MO_UPPER = ['t925', 't850', 't700', 't500', 'z850', 'z500', 'thick', 'rh850', 'rh700', 'wind925', 'wind850', 'wind700',
            'wind500', 'wind300', 'wind250', 'wbpt850', 'kindex']


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
        'shf': 'sensible_heat_flux_at_surface', 'rain_1h': 'rainfall_accumulation-PT01H', 'hail_1h': 'hail_fall_accumulation-PT01H',
        'sw_direct': 'radiation_flux_in_shortwave_direct_downward_at_surface',
    }
    pl_files = dict(MO_PL, wind100=('wind_speed_on_height_levels', 100.0))
    variables = list(files) + ['precip_1h', 'precip_total', 'snow_1h', 'snow_total', 'snow_acc', 'feels', 'windchill', 'wdir10', 'wx',
                               'gust_peak', 'wind100'] + MO_UPPER


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
        'trop_p': 'pressure_at_tropopause', 'trop_t': 'temperature_at_tropopause', 'conv_cloud': 'cloud_amount_of_total_convective_cloud',
        'cin_ml': 'CIN_mixed_layer_lowest_500m', 'lhf': 'latent_heat_flux_at_surface_mean-PT01H', 'rain_1h': 'rainfall_accumulation-PT01H',
        'sw_direct': 'radiation_flux_in_shortwave_direct_downward_at_surface',
    }
    pl_files = dict(MO_PL, w700=('wind_vertical_velocity_on_pressure_levels', 70000.0))
    variables = list(files) + ['precip_1h', 'precip_total', 'snow_1h', 'snow_total', 'snow_acc', 'feels', 'windchill', 'wdir10', 'wx',
                               'gust_peak', 'w700'] + MO_UPPER


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
        'wdir10': [('sfc', '10u'), ('sfc', '10v')], 'windchill': [('sfc', '2t'), ('sfc', '10u'), ('sfc', '10v')],
        # the wave model (ECMWF WAM), a stream of its own beside the atmosphere
        'swh': [('sfc', 'swh')], 'mwp': [('sfc', 'mwp')], 'pp1d': [('sfc', 'pp1d')], 'mwd': [('sfc', 'mwd')],
        # added 26 Oct 2026
        'snow_swe': [('sfc', 'sd')], 'snow_depth': [('sfc', 'sd'), ('sfc', 'rsn')], 'ptype': [('sfc', 'ptype'), ('sfc', 'tp')],
        't2max3': [('sfc', 'mx2t3')], 't2min3': [('sfc', 'mn2t3')], 'conv_total': [('sfc', 'cp')], 'olr': [('sfc', 'ttr')],
        't925': [('pl', 't', 925)], 't700': [('pl', 't', 700)], 'rh850': [('pl', 'r', 850)], 'z850': [('pl', 'gh', 850)],
        'thick': [('pl', 'gh', 500), ('pl', 'gh', 1000)],
        'wind925': [('pl', 'u', 925), ('pl', 'v', 925)], 'wind700': [('pl', 'u', 700), ('pl', 'v', 700)],
        'wind300': [('pl', 'u', 300), ('pl', 'v', 300)], 'w700': [('pl', 'w', 700)], 'vort500': [('pl', 'vo', 500)],
        'kindex': [('pl', 't', 850), ('pl', 't', 700), ('pl', 't', 500), ('pl', 'r', 850), ('pl', 'r', 700)],
    }
    WAVE = {'swh', 'mwp', 'pp1d', 'mwd'}
    CATEGORY = {'ptype'}                 # codes, not amounts: sampled from the nearest cell, never blended
    variables = ['precip_rate', 'precip_total', 'conv_total', 'ptype', 'snow_total', 'snow_acc', 'snow_swe', 'snow_depth', 't2', 't2max3',
                 't2min3', 'td2', 'rh2', 'tskin', 'feels', 'windchill', 'wind10', 'wdir10', 'gust10', 'gust_peak', 'wind100', 'mslp', 'tcc',
                 'lcc', 'mcc', 'hcc', 'cape_mu', 'kindex', 'pw', 't925', 't850', 't700', 't500', 'z850', 'z500', 'thick', 'rh850', 'rh700',
                 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 'w700', 'vort500', 'sw_down', 'lw_down', 'olr', 'wx',
                 'swh', 'mwp', 'pp1d', 'mwd']

    def __init__(self):
        self._idx, self._host, self._ix = {}, {}, None

    def schedule(self, run):
        long = run.hour in (0, 12)
        return list(range(0, 145, 3)) + list(range(150, 241, 6)) if long else list(range(0, 91, 3))

    def base(self, run, h, host, wave=False):
        path, stem = ('ifs/0p25/wave', 'wave-fc') if wave else (self.path, self.stem)
        return f'{host}/{run:%Y%m%d}/{run:%H}z/{path}/{run:%Y%m%d%H}0000-{h}h-{stem}'

    def index(self, run, h, wave=False):
        k = (run, h, wave)
        if k not in self._idx:
            last = None
            for host in ECM_HOSTS:
                try:
                    txt = get(self.base(run, h, host, wave) + '.index', tries=2, timeout=8).decode()
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

    def _get(self, run, h, wants, wave=False):
        idx = self.index(run, h, wave)
        host = self._host[(run, h, wave)]
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
        blobs = fetch_ranges(self.base(run, h, host, wave) + '.grib2', ranges, gap=0, workers=12)
        out = []
        for i in range(len(names)):
            a, meta = decode_grib(blobs[i])
            if names[i][1] == 'mwd':                       # a direction: interpolate its components
                r = np.radians(np.asarray(a, np.float32).reshape(meta['Nj'], meta['Ni']))
                out.append(_wdir(-self._to_display(np.sin(r).ravel(), meta), -self._to_display(np.cos(r).ravel(), meta)))
                continue
            out.append(self._to_display(a, meta, nearest=names[i][1] in ('ptype',)))
        return out

    def _nearest(self, a, meta):
        """A categorical field (precipitation type) on the display grid from its nearest cell."""
        from .common import regular_index
        lat1, lon1 = meta['latitudeOfFirstGridPointInDegrees'], meta['longitudeOfFirstGridPointInDegrees']
        dj, di = meta['jDirectionIncrementInDegrees'], meta['iDirectionIncrementInDegrees']
        lats = lat1 + np.arange(meta['Nj']) * (dj if meta['latitudeOfLastGridPointInDegrees'] > lat1 else -dj)
        lons = lon1 + np.arange(meta['Ni']) * di
        j, i, ok = regular_index(lats, lons)
        a = np.asarray(a, np.float32).reshape(meta['Nj'], meta['Ni'])
        return np.where(ok, a[j, i], np.nan).astype(np.float32)

    def _to_display(self, a, meta, nearest=False):
        if nearest:
            return ECMWF._nearest(self, a, meta)           # GFS borrows this method unbound
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
        A = self._get(run, h, S, wave=var in self.WAVE)
        if var in self.WAVE:
            return _sea_only(A[0])
        if var in ('t2', 'td2', 'tskin', 't850', 't500', 't925', 't700', 't2max3', 't2min3'):
            return A[0] - 273.15
        if var == 'wdir10':
            return _wdir(A[0], A[1])
        if var == 'windchill':
            return _windchill(A[0] - 273.15, np.hypot(A[1], A[2]) * MPH)
        if var in ('wind10', 'wind100', 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250'):
            return np.hypot(A[0], A[1]) * MPH
        if var in ('z850', 'thick'):
            return (A[0] - A[1]) / 10.0 if var == 'thick' else A[0] / 10.0
        if var == 'rh850':
            return _rh_from_q(A[0] - 273.15, A[1], 850.0) if len(A) == 2 else A[0]
        if var == 'kindex':
            t8, t7, t5 = (x - 273.15 for x in A[:3])
            r8, r7 = (_rh_from_q(t8, A[3], 850.0), _rh_from_q(t7, A[4], 700.0)) if S[3][1] == 'q' else (A[3], A[4])
            return _kindex(t8, t7, t5, r8, r7)
        if var == 'snow_swe':
            return A[0] * 1000.0
        if var == 'snow_depth':                    # metres of water / snow density (kg/m3) -> cm of snow
            with np.errstate(invalid='ignore', divide='ignore'):
                return np.where(A[0] > 0, A[0] * 1000.0 / np.maximum(A[1], 50.0) * 100.0, 0.0).astype(np.float32)
        if var == 'conv_total':
            return A[0] * 1000.0
        if var == 'vort500':
            return A[0] * 1e5
        if var == 'olr':
            return -A[0]                             # upward thermal radiation: job.py differences the accumulation
        if var == 'ptype':
            # the type is set wherever a trace falls: shown only where 0.1 mm/h or more fell since
            # the step before (tp is the running total, in metres)
            if not h or prev_h is None:
                return np.zeros_like(A[0])
            tp0 = self._get(run, prev_h, [('sfc', 'tp')])[0]
            rate = np.nan_to_num(A[1] - tp0) * 1000.0 / (h - prev_h)
            return np.where(rate >= 0.1, A[0], 0).astype(np.float32)
        if var == 'w700':
            return A[0]
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
    # the AI model gives specific humidity on pressure levels, not relative humidity
    SPEC = dict(ECMWF.SPEC, rh850=[('pl', 't', 850), ('pl', 'q', 850)],
                kindex=[('pl', 't', 850), ('pl', 't', 700), ('pl', 't', 500), ('pl', 'q', 850), ('pl', 'q', 700)])

    def schedule(self, run):
        return list(range(0, 241, 6))

    variables = ['precip_rate', 'precip_total', 'conv_total', 'snow_total', 'snow_acc', 't2', 'td2', 'rh2', 'tskin', 'feels', 'windchill',
                 'wind10', 'wdir10', 'wind100', 'mslp', 'tcc', 'lcc', 'mcc', 'hcc', 'kindex', 'pw', 't925', 't850', 't700', 't500', 'z850',
                 'z500', 'thick', 'rh850', 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 'w700', 'sw_down', 'lw_down', 'wx']


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
        'wdir10': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'windchill': [('TMP', '2 m above ground'), ('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        # NOAA GFS-Wave (WAVEWATCH III), its own file beside the atmosphere
        'swh': [('HTSGW', 'surface')], 'pp1d': [('PERPW', 'surface')], 'mwd': [('DIRPW', 'surface')],
        # added 26 Oct 2026
        'ptype': [('CRAIN', 'surface'), ('CSNOW', 'surface'), ('CFRZR', 'surface'), ('CICEP', 'surface'), ('PRATE', 'surface')],
        'frozen_pct': [('CPOFP', 'surface')], 'conv_total': [('ACPCP', 'surface')],
        'snow_total': [('APCP', 'surface'), ('CPOFP', 'surface')],
        'cape_mu': [('CAPE', '255-0 mb above ground')], 'cape_ml': [('CAPE', '90-0 mb above ground')],
        'cin_mu': [('CIN', '255-0 mb above ground')], 'cin_ml': [('CIN', '90-0 mb above ground')],
        'hpbl': [('HPBL', 'surface')], 'vort500': [('ABSV', '500 mb')], 'w700': [('VVEL', '700 mb')],
        't925': [('TMP', '925 mb')], 't700': [('TMP', '700 mb')], 'rh850': [('RH', '850 mb')], 'z850': [('HGT', '850 mb')],
        'thick': [('HGT', '500 mb'), ('HGT', '1000 mb')],
        'wind925': [('UGRD', '925 mb'), ('VGRD', '925 mb')], 'wind700': [('UGRD', '700 mb'), ('VGRD', '700 mb')],
        'wind300': [('UGRD', '300 mb'), ('VGRD', '300 mb')],
        'kindex': [('TMP', '850 mb'), ('TMP', '700 mb'), ('TMP', '500 mb'), ('RH', '850 mb'), ('RH', '700 mb')],
        'shf': [('SHTFL', 'surface')], 'lhf': [('LHTFL', 'surface')], 'lw_down': [('DLWRF', 'surface')],
        'olr': [('ULWRF', 'top of atmosphere')],
    }
    WAVE = {'swh', 'pp1d', 'mwd'}
    CATEGORY = {'CRAIN', 'CSNOW', 'CFRZR', 'CICEP'}
    variables = ['precip_rate', 'precip_total', 'conv_total', 'ptype', 'frozen_pct', 'refc', 'snow_total', 'snow_acc', 'snow_depth',
                 'snow_swe', 'frz', 't2', 'td2', 'rh2', 'tskin', 'feels', 'windchill', 'wind10', 'wdir10', 'gust10', 'gust_peak', 'wind100',
                 'mslp', 'tcc', 'lcc', 'mcc', 'hcc', 'vis', 'cape_sb', 'cape_ml', 'cape_mu', 'cin_sb', 'cin_ml', 'cin_mu', 'li', 'kindex',
                 'srh3', 'pw', 'hpbl', 't925', 't850', 't700', 't500', 'z850', 'z500', 'thick', 'rh850', 'rh700', 'wind925', 'wind850',
                 'wind700', 'wind500', 'wind300', 'wind250', 'w700', 'vort500', 'trop_p', 'sw_down', 'lw_down', 'olr', 'shf', 'lhf', 'wx',
                 'swh', 'pp1d', 'mwd']

    def __init__(self):
        self._idx, self._ix = {}, None

    def schedule(self, run):
        return list(range(0, 121)) + list(range(123, 241, 3))

    def url(self, run, h, wave=False):
        if wave:
            return f'{GFS_BUCKET}/gfs.{run:%Y%m%d}/{run:%H}/wave/gridded/gfswave.t{run:%H}z.global.0p25.f{h:03d}.grib2'
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

    def index(self, run, h, wave=False):
        k = (run, h, wave)
        if k not in self._idx:
            lines = [l for l in get(self.url(run, h, wave) + '.idx', tries=3, timeout=60).decode().splitlines() if l.strip()]
            recs = []
            for i, l in enumerate(lines):
                p = l.split(':')
                end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
                recs.append({'var': p[3], 'level': p[4], 'desc': p[5] if len(p) > 5 else '', 'start': int(p[1]), 'end': end,
                             'extra': ':'.join(p[6:])})
            self._idx[k] = recs
        return self._idx[k]

    def _pick(self, recs, var, level):
        c = [r for r in recs if r['var'] == var and r['level'] == level]
        if not c:
            return None
        if var in ('APCP', 'ACPCP'):                       # the running total from T+0
            return next((r for r in c if r['desc'].startswith('0-')), c[-1])
        if var in ('PRATE', 'DSWRF', 'DLWRF', 'ULWRF', 'SHTFL', 'LHTFL'):    # instantaneous where published
            return next((r for r in c if 'ave' not in r['desc']), c[-1])
        return c[0]

    def field(self, run, h, var, prev_h, prev_raw=None):
        wave = var in self.WAVE
        recs = self.index(run, h, wave)
        wants = []
        for v, lev in self.SPEC[var]:
            r = self._pick(recs, v, lev)
            if r is None:
                raise KeyError(f'{v}:{lev} not in {self.id} T+{h}')
            wants.append((r['start'], r['end'], len(wants)))
        blobs = fetch_ranges(self.url(run, h, wave), wants, gap=0, workers=12)
        A = []
        for i in range(len(wants)):
            a, meta = decode_grib(blobs[i])
            if var == 'mwd':                               # a direction: interpolate its components
                r = np.radians(np.asarray(a, np.float32))
                A.append(_wdir(-ECMWF._to_display(self, np.sin(r), meta), -ECMWF._to_display(self, np.cos(r), meta)))
                continue
            A.append(ECMWF._to_display(self, a, meta, nearest=self.SPEC[var][i][0] in getattr(self, 'CATEGORY', ())))
        if wave:
            return _sea_only(A[0])
        if var == 'ptype':                                 # GFS's yes/no types as ECMWF's codes
            # the types are set wherever a trace falls: shown only where 0.1 mm/h or more does
            rain, snow, frzr, icep = (np.nan_to_num(x) > 0.5 for x in A[:4])
            code = np.select([snow & rain, snow, icep, frzr, rain], [7, 5, 8, 3, 1], 0)
            return np.where(np.nan_to_num(A[4]) * 3600.0 >= 0.1, code, 0).astype(np.float32)
        if var == 'frozen_pct':                            # -50 where nothing falls
            return np.where(A[0] < 0, np.nan, A[0]).astype(np.float32)
        if var == 'snow_total':                            # chained by job.py: each step's new precipitation times its frozen share
            # only where most of it is frozen: CPOFP is noisy in light rain, and 10-30 % over a warm
            # sea, step after step, adds up to snow that is not there
            pct = np.clip(np.nan_to_num(A[1]), 0, 100)
            return {'apcp': A[0] if h else np.zeros_like(A[0]), 'frac': np.where(pct >= 50, pct / 100.0, 0.0)}
        if var in ('t2', 'td2', 'tskin', 'feels', 't850', 't500', 't925', 't700'):
            return A[0] - 273.15
        if var == 'wdir10':
            return _wdir(A[0], A[1])
        if var == 'windchill':
            return _windchill(A[0] - 273.15, np.hypot(A[1], A[2]) * MPH)
        if var in ('wind10', 'wind100', 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250'):
            return np.hypot(A[0], A[1]) * MPH
        if var in ('z850', 'thick'):
            return (A[0] - A[1]) / 10.0 if var == 'thick' else A[0] / 10.0
        if var == 'kindex':
            return _kindex(A[0] - 273.15, A[1] - 273.15, A[2] - 273.15, A[3], A[4])
        if var == 'vort500':                               # absolute vorticity less the Coriolis parameter
            return (A[0] - _coriolis()) * 1e5
        if var == 'conv_total' and h == 0:
            return np.zeros((NY, NX), np.float32)
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


# ── NOAA GEFS ensemble mean, as a forecast model in its own right (0.5°, 16 days) ──────────
GEFS_BUCKET = 'https://noaa-gefs-pds.s3.amazonaws.com'


class GEFSMean(GFS):
    id, label, res_km = 'gefs_mean', 'NOAA GEFS (ensemble mean)', 50.0
    SPEC = {
        't2': [('TMP', '2 m above ground')], 'rh2': [('RH', '2 m above ground')],
        'td2': [('TMP', '2 m above ground'), ('RH', '2 m above ground')],
        'wind10': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'wdir10': [('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'windchill': [('TMP', '2 m above ground'), ('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'feels': [('TMP', '2 m above ground'), ('RH', '2 m above ground'), ('UGRD', '10 m above ground'), ('VGRD', '10 m above ground')],
        'mslp': [('PRMSL', 'mean sea level')], 'precip_rate': [('APCP', 'surface')], 'tcc': [('TCDC', 'entire atmosphere')],
        'cape_mu': [('CAPE', '180-0 mb above ground')], 'pw': [('PWAT', 'entire atmosphere (considered as a single layer)')],
        'snow_depth': [('SNOD', 'surface')], 't850': [('TMP', '850 mb')], 't500': [('TMP', '500 mb')], 'z500': [('HGT', '500 mb')],
        'rh700': [('RH', '700 mb')], 'wind850': [('UGRD', '850 mb'), ('VGRD', '850 mb')],
        'wind500': [('UGRD', '500 mb'), ('VGRD', '500 mb')], 'wind250': [('UGRD', '250 mb'), ('VGRD', '250 mb')],
        'sw_down': [('DSWRF', 'surface')],
    }
    WAVE = set()
    variables = ['precip_rate', 't2', 'td2', 'rh2', 'feels', 'windchill', 'wind10', 'wdir10', 'mslp', 'tcc', 'cape_mu', 'pw',
                 'snow_depth', 't850', 't500', 'z500', 'rh700', 'wind850', 'wind500', 'wind250', 'sw_down', 'wx']

    def schedule(self, run):
        return list(range(0, 241, 3)) + list(range(246, 385, 6))

    def url(self, run, h, wave=False):
        return f'{GEFS_BUCKET}/gefs.{run:%Y%m%d}/{run:%H}/atmos/pgrb2ap5/geavg.t{run:%H}z.pgrb2a.0p50.f{h:03d}'

    def field(self, run, h, var, prev_h, prev_raw=None):
        if var == 'precip_rate':
            # GEFS buckets rain over 6 h (0-3, 0-6, 6-9, 6-12, ...): the mean rate over the bucket
            if h == 0:
                return np.zeros((NY, NX), np.float32)
            r = self._pick(self.index(run, h), 'APCP', 'surface')
            a, meta = decode_grib(fetch_ranges(self.url(run, h), [(r['start'], r['end'], 0)], gap=0, workers=2)[0])
            hrs = re.match(r'(\d+)-(\d+) hour', r['desc'])
            span = int(hrs.group(2)) - int(hrs.group(1)) if hrs else 6
            return ECMWF._to_display(self, a, meta) / max(span, 1)
        if var in ('td2', 'feels'):
            S = self.SPEC[var]
            recs = self.index(run, h)
            rr = [self._pick(recs, v, lev) for v, lev in S]
            blobs = fetch_ranges(self.url(run, h), [(r['start'], r['end'], i) for i, r in enumerate(rr)], gap=0, workers=4)
            A = [ECMWF._to_display(self, *decode_grib(blobs[i])) for i in range(len(rr))]
            t = A[0] - 273.15
            td = _dewpoint(t, A[1])
            return td if var == 'td2' else _feels(t, td, np.hypot(A[2], A[3]) * MPH)
        return super().field(run, h, var, prev_h, prev_raw)


# ── NOAA GEFS-Aerosols: dust, smoke and fine particles (0.25°, 5 days) ───────────────────
class GEFSAerosol(GFS):
    id, label, res_km = 'gefs_aer', 'NOAA GEFS-Aerosols', 25.0
    # (GRIB name, level, a phrase the record's extra fields must contain)
    PICK = {
        'aod': ('AOTK', 'entire atmosphere', 'aerosol=Total aerosol:aerosol_size <2e-05:aerosol_wavelength >=5.45e-07'),
        'dust_aod': ('AOTK', 'entire atmosphere', 'aerosol=Dust dry:aerosol_size <2e-05:aerosol_wavelength >=5.45e-07'),
        'pm25': ('PMTF', 'surface', 'aerosol=Total aerosol'),
        'pm10': ('PMTC', 'surface', 'aerosol=Total aerosol'),
    }
    WAVE = set()
    variables = ['aod', 'dust_aod', 'pm25', 'pm10']

    def schedule(self, run):
        return list(range(0, 121, 3))

    def url(self, run, h, wave=False):
        return f'{GEFS_BUCKET}/gefs.{run:%Y%m%d}/{run:%H}/chem/pgrb2ap25/gefs.chem.t{run:%H}z.a2d_0p25.f{h:03d}.grib2'

    def field(self, run, h, var, prev_h, prev_raw=None):
        name, lev, phrase = self.PICK[var]
        r = next((x for x in self.index(run, h) if x['var'] == name and x['level'] == lev and x['extra'].startswith(phrase)), None)
        if r is None:
            raise KeyError(f'{var} not in GEFS-Aerosols T+{h}')
        a, meta = decode_grib(fetch_ranges(self.url(run, h), [(r['start'], r['end'], 0)], gap=0, workers=2)[0])
        a = ECMWF._to_display(self, a, meta)
        return a                                     # PMTF/PMTC are published in micrograms/m3


MODELS = {m.id: m for m in (UKV(), MOGlobal(), ECMWF(), AIFS(), GFS(), GEFSMean(), GEFSAerosol())}
SOURCES = {
    'ukv': 'Met Office UKV 2 km — AWS open data (uk-deterministic-2km)',
    'mo_global': 'Met Office Global 10 km — AWS open data (global-deterministic-10km)',
    'ifs': "ECMWF IFS 0.25° — ECMWF open data (ECMWF's Google Cloud copy; the AWS copy as fallback)",
    'aifs': "ECMWF AIFS 0.25° — ECMWF open data (ECMWF's Google Cloud copy; the AWS copy as fallback)",
    'gfs': 'NOAA GFS 0.25° — AWS open data (noaa-gfs-bdp-pds); waves from GFS-Wave (WAVEWATCH III)',
    'gefs_mean': 'NOAA GEFS 0.5° ensemble mean of 31 members, to 16 days — AWS open data (noaa-gefs-pds)',
    'gefs_aer': 'NOAA GEFS-Aerosols 0.25°: dust, smoke, sea salt and fine particles — AWS open data (noaa-gefs-pds, chem)',
}
# variables whose frames are differences of an accumulation between consecutive steps
DIFFERENCED = {('ifs', 'precip_rate'), ('aifs', 'precip_rate'), ('ifs', 'sw_down'), ('aifs', 'sw_down'),
               ('ifs', 'lw_down'), ('aifs', 'lw_down'), ('ifs', 'olr')}
# a running snowfall total built in job.py from a running precipitation total and the frozen share
SNOW_CHAIN = {('gfs', 'snow_total')}
# copies of another variable in other units: snow_acc is the snowfall total as cm of snow at 10:1
ALIASES = {'snow_acc': 'snow_total'}
