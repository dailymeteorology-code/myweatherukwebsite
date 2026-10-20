"""Current conditions on the display grid every 15 minutes, and every day's observed extremes.

    run from `python -m mdata.live update` (every 2 minutes); works only on new radar times

Analysis, at each radar time t:
  1. Background: the newest UKV run's fields at t, linear between its hourly steps (2 km — the
     display grid itself).
  2. Observations: the METAR reports of the UK and Irish airports (NOAA aviationweather.gov, the
     official feed of what the stations send; keyless). Each station's difference from the
     background — temperature, dew point, wind, gust, pressure — is spread over the map with a
     Gaussian weight that relaxes to the model between stations:
         field = background + sum(w_i r_i) / (sum(w_i) + 0.25),   w_i = exp(-(d_i / L)^2)
     so a station pulls its own cell 80 % of the way to what it measured.
  3. Rain is the Met Office 1 km radar composite at t (observed). The weather type adds LEELA
     lightning (strikes within 15 km in the past 20 minutes), the wet bulb for snow and sleet,
     and the UKV cloud and visibility.
  Products: live/now_<var>/<YYYYmmddTHHMM>.bin (display grid, k = 1).

Observed days (Europe/London): observed/<YYYY-MM-DD>/ holds the day's highest and lowest of
every analysed field, the radar rainfall total and peak rate (1 km), the lightning strikes, and
each METAR station's own extremes. Updated with every analysis and kept for good.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

from .common import DATA, DX, NX, NY, PROJ, STATIC, X0, Y_TOP, read_frame, write_frame, write_json
from .derived import weather_type, wet_bulb
from .models import UKV, _feels, _windchill

LIVE = DATA / 'live'
OBS = DATA / 'observed'
CACHE = LIVE / '_ukv'
LONDON = ZoneInfo('Europe/London')
KEEP_H = 12
PER_CYCLE = 6                                    # analyses per 2-minute cycle (backfill catches up)
METAR_URL = 'https://aviationweather.gov/api/data/metar?bbox=49,-11.5,61.5,2.5&format=json&hours={h}'
KT = 1.150779                                    # knots -> mph

# product: label, unit, encoding, the day statistics kept for it
NOW = {
    'now_t2':        ('Temperature', '°C', dict(lo=-35, hi=45), ('max', 'min')),
    'now_td2':       ('Dew point', '°C', dict(lo=-35, hi=35), ('max', 'min')),
    'now_rh2':       ('Humidity', '%', dict(lo=0, hi=100), ('max', 'min')),
    'now_wind10':    ('Wind speed', 'mph', dict(lo=0, hi=150), ('max',)),
    'now_wdir10':    ('Wind direction', '°', dict(lo=0, hi=360), ()),
    'now_gust10':    ('Wind gusts', 'mph', dict(lo=0, hi=150), ('max',)),
    'now_mslp':      ('Pressure', 'hPa', dict(lo=930, hi=1060), ('max', 'min')),
    'now_windchill': ('Wind chill', '°C', dict(lo=-45, hi=35), ('min',)),
    'now_feels':     ('Feels like', '°C', dict(lo=-45, hi=45), ('max', 'min')),
    'now_tcc':       ('Cloud cover', '%', dict(lo=0, hi=100), ()),
    'now_wx':        ('Weather', '', dict(lo=0, hi=254), ()),
}
UKV_VARS = ('t2', 'td2', 'wind10', 'gust10', 'mslp', 'tcc', 'vis', 'precip_rate')
# residual spreading: field, length scale (km), largest believable station-minus-model difference
SPREAD = {'t2': (45, 8), 'td2': (45, 8), 'wind10': (40, 25), 'gust10': (35, 30), 'mslp': (120, 6)}

_U = UKV()


def _utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)


def to_grid(lon, lat):
    from pyproj import Transformer
    x, y = Transformer.from_crs('EPSG:4326', PROJ, always_xy=True).transform(np.asarray(lon, float), np.asarray(lat, float))
    return (x - (X0 - DX / 2)) / DX, ((Y_TOP + DX / 2) - y) / DX


# ── background: UKV at the analysis time ─────────────────────────────────────
def ukv_hour(V):
    """{field: display-grid array} at the whole hour V, from the newest UKV run that has it."""
    from nova.io_aws import exists
    f = CACHE / f'{V:%Y%m%dT%H}.npz'
    if f.exists():
        with np.load(f) as z:
            return {k: z[k] for k in z.files}
    now = datetime.now(timezone.utc)
    newest = min(V, now.replace(minute=0, second=0, microsecond=0))
    for back in range(0, 14):
        run = newest - timedelta(hours=back)
        h = int((V - run).total_seconds() // 3600)
        if h < 0 or h > 54:
            continue
        if not exists(_U.url(run, h, _U.files['t2'])):
            continue
        out = {}
        for v in UKV_VARS:
            try:
                out[v] = _U.field(run, h, v, None).astype(np.float32)
            except Exception:
                pass
        try:
            out['wdir'] = np.mod(_U._read(run, h, 'wind_direction_at_10m')[0], 360).astype(np.float32)
        except Exception:
            pass
        if 't2' not in out:
            continue
        CACHE.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(f, run=np.array(run.timestamp()), **out)
        return out
    raise FileNotFoundError(f'no UKV run has {V:%d %H}Z')


def background(t):
    V0 = t.replace(minute=0, second=0, microsecond=0)
    a = ukv_hour(V0)
    if t == V0:
        return a
    b = ukv_hour(V0 + timedelta(hours=1))
    f = (t - V0).total_seconds() / 3600
    out = {k: (a[k] * (1 - f) + b[k] * f).astype(np.float32) for k in a if k in b and k not in ('wdir', 'run')}
    if 'wdir' in a and 'wdir' in b:                    # direction through its components
        ra, rb = np.radians(a['wdir']), np.radians(b['wdir'])
        s, c = np.sin(ra) * (1 - f) + np.sin(rb) * f, np.cos(ra) * (1 - f) + np.cos(rb) * f
        out['wdir'] = np.mod(np.degrees(np.arctan2(s, c)), 360).astype(np.float32)
    return out


# ── observations ─────────────────────────────────────────────────────────────
def metars(hours=3):
    from nova.io_aws import get
    rows = json.loads(get(METAR_URL.format(h=hours), tries=3, timeout=60))
    out = []
    for r in rows:
        try:
            vis = r.get('visib')
            vis_km = 10.0 if isinstance(vis, str) and vis.endswith('+') else float(vis) * 1.609344 if vis not in (None, '') else None
        except Exception:
            vis_km = None
        num = lambda k: float(r[k]) if isinstance(r.get(k), (int, float)) else None   # noqa: E731
        out.append({'id': r['icaoId'], 'name': (r.get('name') or r['icaoId']).split(',')[0], 'lat': r['lat'], 'lon': r['lon'],
                    'elev': r.get('elev') or 0, 't': r['obsTime'], 'temp': num('temp'), 'dewp': num('dewp'),
                    'wspd': num('wspd') * KT if num('wspd') is not None else None,
                    'wgst': num('wgst') * KT if num('wgst') is not None else None,
                    'wdir': num('wdir'), 'pres': num('altim'), 'vis': vis_km, 'wx': r.get('wxString') or ''})
    if out:
        gx, gy = to_grid([o['lon'] for o in out], [o['lat'] for o in out])
        for o, x, y in zip(out, gx, gy):
            o['gx'], o['gy'] = float(x), float(y)
    return [o for o in out if 0 <= o['gx'] < NX and 0 <= o['gy'] < NY]


_YX = None


def spread(st, field, L_km, w0=0.25):
    """sum(w r) / (sum(w) + w0) for station residuals st = [(gx, gy, r)]."""
    global _YX
    if _YX is None:
        _YX = (np.arange(NY, dtype=np.float32)[:, None] + 0.5, np.arange(NX, dtype=np.float32)[None, :] + 0.5)
    num = np.zeros((NY, NX), np.float32)
    den = np.zeros((NY, NX), np.float32)
    Lc = L_km / (DX / 1000.0)
    for x, y, r in st:
        x0, x1 = int(max(0, x - 3 * Lc)), int(min(NX, x + 3 * Lc + 1))
        y0, y1 = int(max(0, y - 3 * Lc)), int(min(NY, y + 3 * Lc + 1))
        w = np.exp(-(((_YX[1][:, x0:x1] - x) ** 2) + ((_YX[0][y0:y1] - y) ** 2)) / (Lc * Lc))
        num[y0:y1, x0:x1] += w * r
        den[y0:y1, x0:x1] += w
    return field + num / (den + w0)


def at_station(a, o):
    j, i = int(o['gy']), int(o['gx'])
    return float(a[j, i]) if 0 <= j < NY and 0 <= i < NX else np.nan


# ── radar and lightning at t ─────────────────────────────────────────────────
def radar_2km(t):
    p = LIVE / 'radar' / f'{t:%Y%m%dT%H%M}.bin'
    if not p.exists():
        return None, None
    r, _ = read_frame(p)                                         # 1 km: 2 x the display grid
    return r, np.nanmean(r.reshape(NY, 2, NX, 2), axis=(1, 3))


def strikes_between(t0, t1):
    try:
        j = json.loads((LIVE / 'lightning.json').read_text())
    except Exception:
        return []
    a, b = t0.timestamp() * 1000, t1.timestamp() * 1000
    return [s for s in j.get('strikes', []) if a < s[0] <= b]


def near_mask(points, radius_cells):
    m = np.zeros((NY, NX), bool)
    r = int(np.ceil(radius_cells))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disc = xx * xx + yy * yy <= radius_cells ** 2
    for _, gx, gy in points:
        i, j = int(gx), int(gy)
        x0, x1, y0, y1 = max(0, i - r), min(NX, i + r + 1), max(0, j - r), min(NY, j + r + 1)
        if x0 < x1 and y0 < y1:
            m[y0:y1, x0:x1] |= disc[y0 - (j - r):y1 - (j - r), x0 - (i - r):x1 - (i - r)]
    return m


# ── the analysis ─────────────────────────────────────────────────────────────
def analyse(t, reports):
    B = background(t)
    near = {}
    for o in reports:                                            # each station's report nearest t, within 35 min
        dt = abs(o['t'] - t.timestamp())
        if dt <= 35 * 60 and (o['id'] not in near or dt < abs(near[o['id']]['t'] - t.timestamp())):
            near[o['id']] = o
    used = {}
    A = {}
    for v, (L, lim) in SPREAD.items():
        if v not in B:
            continue
        key = {'t2': 'temp', 'td2': 'dewp', 'wind10': 'wspd', 'gust10': 'wgst', 'mslp': 'pres'}[v]
        st = []
        for o in near.values():
            ob = o[key]
            if ob is None or (v == 'mslp' and o['elev'] > 150):     # QNH ~ MSLP only near sea level
                continue
            bg = at_station(B[v], o)
            if np.isfinite(bg) and abs(ob - bg) <= lim:
                st.append((o['gx'], o['gy'], ob - bg))
        used[v] = len(st)
        A[v] = spread(st, B[v], L) if st else B[v]
    A['wind10'] = np.maximum(A['wind10'], 0)
    A['gust10'] = np.maximum(A.get('gust10', A['wind10']), A['wind10'])
    A['td2'] = np.minimum(A['td2'], A['t2'])
    t2, td2 = A['t2'], A['td2']
    A['rh2'] = np.clip(100 * np.exp(17.625 * td2 / (243.04 + td2)) / np.exp(17.625 * t2 / (243.04 + t2)), 0, 100)
    A['windchill'] = _windchill(t2, A['wind10'])
    A['feels'] = _feels(t2, td2, A['wind10'])
    A['wdir10'] = B.get('wdir', np.full((NY, NX), np.nan, np.float32))
    A['tcc'] = B.get('tcc', np.full((NY, NX), np.nan, np.float32))
    r1, r2 = radar_2km(t)
    pr = np.where(np.isfinite(r2), r2, B.get('precip_rate', 0)) if r2 is not None else B.get('precip_rate', np.zeros((NY, NX)))
    wx = weather_type({'precip_rate': pr, 'tcc': A['tcc'], 't2': t2, 'td2': td2, 'vis': B.get('vis', np.full((NY, NX), 99.0))})
    thunder = near_mask(strikes_between(t - timedelta(minutes=20), t), 7.5)
    A['wx'] = np.where(thunder, 13, wx).astype(np.float32)
    return A, {'stations': len(near), 'used': used, 'radar': r2 is not None}, near, r1


# ── observed days ────────────────────────────────────────────────────────────
DAY_FIELDS = [(p[4:], s) for p, (_, _, _, stats) in NOW.items() for s in stats]


def ukie_mask():
    """UK, Ireland, the Isle of Man and the Channel Islands, on the display grid (for 'the UK's
    highest' — not France's)."""
    f = STATIC / 'ukie_mask.npy'
    if f.exists():
        return np.load(f)
    from PIL import Image, ImageDraw
    from .static import ring, topo, to_px
    t, arcs = topo('countries-10m.json')
    img = Image.new('L', (NX, NY), 0)
    dr = ImageDraw.Draw(img)
    for g in t['objects']['countries']['geometries']:
        if str(g.get('id')) not in ('826', '372', '833', '831', '832'):
            continue
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
        for poly in polys:
            ll = ring(arcs, poly[0])
            px, py = to_px(ll[:, 0], ll[:, 1])
            dr.polygon(list(zip(px.tolist(), py.tolist())), fill=1)
    m = np.asarray(img, bool)
    # Natural Earth counts Rockall as the UK: keep the islands people live on (east of 11 W)
    from pyproj import Transformer
    ys, xs = np.nonzero(m)
    lon, _ = Transformer.from_crs(PROJ, 'EPSG:4326', always_xy=True).transform(X0 - DX / 2 + (xs + 0.5) * DX, Y_TOP + DX / 2 - (ys + 0.5) * DX)
    m[ys[lon < -11.0], xs[lon < -11.0]] = False
    np.save(f, m)
    return m


_PLACES = None


def place_near(gx, gy):
    """'Aviemore', 'near Aviemore' or '18 km from Fort William': the motion graphics' gazetteer
    (OpenStreetMap places: cities, towns and villages) on the display grid."""
    global _PLACES
    if _PLACES is None:
        try:
            from .static import MWUK_BASEMAP
            ps = [p for p in json.loads((MWUK_BASEMAP / 'places.json').read_text()) if p.get('kind') in ('city', 'town', 'village')]
            ps += [{'name': n, 'kind': 'town', 'lat': la, 'lon': lo} for n, la, lo in (     # islands the gazetteer lacks
                ('Isles of Scilly', 49.92, -6.30), ('Braemar', 57.006, -3.397), ('Aviemore', 57.195, -3.825),
                ('Achnasheen', 57.58, -5.08), ('Lochinver', 58.15, -5.24), ('Durness', 58.57, -4.75), ('Tyndrum', 56.43, -4.71),
                ('Dalwhinnie', 56.93, -4.24), ('Kinlochewe', 57.60, -5.30), ('Tongue', 58.48, -4.42), ('Bettyhill', 58.53, -4.24),
                ('Ullapool', 57.90, -5.16), ('Portree', 57.41, -6.19), ('Tobermory', 56.62, -6.07), ('Castlebay', 56.95, -7.49),
                ('Balivanich', 57.47, -7.38), ('Belmullet', 54.22, -9.99), ('Clifden', 53.49, -10.02), ('Dingle', 52.14, -10.27))]
            px, py = to_grid([p['lon'] for p in ps], [p['lat'] for p in ps])
            _PLACES = [(p['name'], p['kind'], float(x), float(y)) for p, x, y in zip(ps, px, py)]
        except Exception:
            _PLACES = [(c['name'], 'city', c['x'], c['y']) for c in json.loads((STATIC / 'cities.json').read_text())]
    km = lambda p: ((p[2] - gx) ** 2 + (p[3] - gy) ** 2) ** 0.5 * DX / 1000      # noqa: E731
    best = min(_PLACES, key=km, default=None)
    if best is None:
        return None
    d = km(best)
    if d < 3:
        return best[0]
    if d < 9:
        return f'near {best[0]}'
    return f'{d:.0f} km from {best[0]}'


def update_day(t, A, near, rain1km):
    day = t.astimezone(LONDON).date().isoformat()
    d = OBS / day
    w = d / 'work'
    w.mkdir(parents=True, exist_ok=True)
    try:
        state = json.loads((w / 'state.json').read_text())
    except Exception:
        state = {'analyses': [], 'radar': [], 'stations': {}}
    stamp = f'{t:%Y%m%dT%H%M}'
    if stamp in state['analyses']:
        return day
    for v, s in DAY_FIELDS:
        a = A[v]
        f = w / f'{v}_{s}.npy'
        cur = np.load(f) if f.exists() else None
        new = a if cur is None else (np.fmax(cur, a) if s == 'max' else np.fmin(cur, a))
        np.save(f, new.astype(np.float32))
    state['analyses'].append(stamp)
    for o in near.values():                                       # the stations' own day
        if datetime.fromtimestamp(o['t'], timezone.utc).astimezone(LONDON).date().isoformat() != day:
            continue
        S = state['stations'].setdefault(o['id'], {'name': o['name'], 'lat': o['lat'], 'lon': o['lon'], 'gx': round(o['gx'], 1), 'gy': round(o['gy'], 1)})
        for k, src, fn in (('tmax', 'temp', max), ('tmin', 'temp', min), ('dmax', 'dewp', max), ('dmin', 'dewp', min),
                           ('wind', 'wspd', max), ('gust', 'wgst', max), ('pmax', 'pres', max), ('pmin', 'pres', min), ('vis', 'vis', min)):
            if o[src] is not None:
                S[k] = round(fn(S.get(k, o[src]), o[src]), 1)
        for code in ('TS', 'SN', 'RA', 'DZ', 'FG', 'GR', 'SH'):
            if code in o['wx']:
                S.setdefault('wx', [])
                if code not in S['wx']:
                    S['wx'].append(code)
    write_json(w / 'state.json', state)
    publish_day(day, state)
    return day


RAIN_QC = 2          # bump to rebuild the days' radar totals (2: 3x3 median against hot cells)


def radar_index():
    try:
        return [_utc(s) for s in json.loads((LIVE / 'radar' / 'index.json').read_text())['times']]
    except Exception:
        return []


def today_slots(until):
    """Every quarter-hour of today (Europe/London) up to `until`, as UTC instants."""
    start = datetime.now(timezone.utc).astimezone(LONDON).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    out, t = [], start
    while t <= until:
        out.append(t)
        t += timedelta(minutes=15)
    return out


def fold_radar(max_fetch=12):
    """Every radar composite of the day into its rainfall total and peak rate (each is the rate
    over the 15 minutes to its time), independent of the analyses: the frames on disk, and any
    of today's quarter-hours the live layer never kept fetched straight from AWS. A 3x3 median
    first: the composite has single hot cells (100+ mm/h with nothing around) that would
    otherwise become the day's 'heaviest rain'."""
    from scipy import ndimage
    times = radar_index()
    if not times:
        return []
    times = sorted(set(times) | set(today_slots(max(times))[1:]))
    fetched = 0
    touched = {}
    for t in times:
        day = (t - timedelta(minutes=7.5)).astimezone(LONDON).date().isoformat()
        w = OBS / day / 'work'
        if day not in touched:
            w.mkdir(parents=True, exist_ok=True)
            try:
                st = json.loads((w / 'state.json').read_text())
            except Exception:
                st = {'analyses': [], 'radar': [], 'stations': {}}
            if st.get('rain_qc') != RAIN_QC:                       # rebuild under the current QC
                for n in ('precip_total.npy', 'rain_rate_max.npy'):
                    (w / n).unlink(missing_ok=True)
                st['radar'], st['rain_qc'] = [], RAIN_QC
            touched[day] = [st, False]
        st = touched[day][0]
        stamp = f'{t:%Y%m%dT%H%M}'
        if stamp in st['radar']:
            continue
        p = LIVE / 'radar' / f'{stamp}.bin'
        if p.exists():
            r = read_frame(p)[0]
        elif fetched < max_fetch:
            fetched += 1
            try:
                from .live import radar_rate
                r = radar_rate(t)
            except Exception:
                continue
        else:
            continue
        ok = np.isfinite(r)
        r = np.where(ok, ndimage.median_filter(np.nan_to_num(r), size=3), np.nan).astype(np.float32)
        f = w / 'precip_total.npy'
        np.save(f, ((np.load(f) if f.exists() else np.zeros_like(r)) + np.nan_to_num(r) * 0.25).astype(np.float32))
        f = w / 'rain_rate_max.npy'
        np.save(f, (r if not f.exists() else np.fmax(np.load(f), r)).astype(np.float32))
        st['radar'].append(stamp)
        touched[day][1] = True
    out = []
    for day, (st, changed) in touched.items():
        if changed:
            # the analyses may have saved state meanwhile: merge, keeping theirs
            w = OBS / day / 'work'
            try:
                cur = json.loads((w / 'state.json').read_text())
            except Exception:
                cur = {'analyses': [], 'stations': {}}
            cur['radar'], cur['rain_qc'] = st['radar'], RAIN_QC
            write_json(w / 'state.json', cur)
            publish_day(day, cur)
            out.append(day)
    return out


DAY_LABEL = {('t2', 'max'): 'Highest temperature', ('t2', 'min'): 'Lowest temperature', ('td2', 'max'): 'Highest dew point',
             ('td2', 'min'): 'Lowest dew point', ('rh2', 'max'): 'Highest humidity', ('rh2', 'min'): 'Lowest humidity',
             ('wind10', 'max'): 'Strongest wind (mean)', ('gust10', 'max'): 'Strongest gust', ('mslp', 'max'): 'Highest pressure',
             ('mslp', 'min'): 'Lowest pressure', ('windchill', 'min'): 'Lowest wind chill', ('feels', 'max'): 'Highest feels-like',
             ('feels', 'min'): 'Lowest feels-like'}


def publish_day(day, state):
    d = OBS / day
    w = d / 'work'
    mask = ukie_mask()
    fields = {}
    for (v, s), label in DAY_LABEL.items():
        f = w / f'{v}_{s}.npy'
        if not f.exists():
            continue
        a = np.load(f)
        enc = NOW[f'now_{v}'][2]
        name = f'{v}_{s}'
        write_frame(d / f'{name}.bin', a, enc, {'product': name, 'day': day, 'valid': f'{day}T12:00:00+00:00', 'k': 1})
        m = np.where(mask & np.isfinite(a), a, np.nan)
        if np.isfinite(m).any():
            j, i = np.unravel_index(np.nanargmax(m) if s == 'max' else np.nanargmin(m), m.shape)
            fields[name] = {'label': label, 'unit': NOW[f'now_{v}'][1], 'value': round(float(a[j, i]), 1),
                            'gx': int(i) + 0.5, 'gy': int(j) + 0.5, 'place': place_near(i + 0.5, j + 0.5)}
        else:
            fields[name] = {'label': label, 'unit': NOW[f'now_{v}'][1]}
    for name, label, enc in (('precip_total', 'Rainfall total (radar)', dict(lo=0, hi=400, scale='sqrt')),
                             ('rain_rate_max', 'Heaviest rain rate (radar)', dict(lo=0, hi=128, scale='sqrt'))):
        f = w / f'{name}.npy'
        if not f.exists():
            continue
        a = np.load(f)
        write_frame(d / f'{name}.bin', a, enc, {'product': name, 'day': day, 'valid': f'{day}T12:00:00+00:00', 'k': 0.5})
        m2 = np.repeat(np.repeat(mask, 2, 0), 2, 1)
        m = np.where(m2 & np.isfinite(a), a, np.nan)
        if np.isfinite(m).any():
            j, i = np.unravel_index(np.nanargmax(m), m.shape)
            fields[name] = {'label': label, 'unit': 'mm' if name == 'precip_total' else 'mm/h', 'value': round(float(a[j, i]), 1),
                            'gx': i / 2 + 0.25, 'gy': j / 2 + 0.25, 'place': place_near(i / 2, j / 2)}
    # the day's lightning, from the LEELA list (48 h deep)
    t0 = datetime.fromisoformat(day).replace(tzinfo=LONDON).astimezone(timezone.utc)
    sf = d / 'strikes.json'
    old = json.loads(sf.read_text()).get('strikes', []) if sf.exists() else []
    allst = {tuple(s) for s in old} | {tuple(s) for s in strikes_between(t0, t0 + timedelta(days=1))}
    write_json(sf, {'day': day, 'strikes': sorted(allst)})
    stations = sorted(state['stations'].items(), key=lambda kv: -kv[1].get('tmax', -99))
    write_json(d / 'summary.json', {
        'day': day, 'updated': datetime.now(timezone.utc).isoformat(), 'analyses': len(state['analyses']),
        'radar_frames': len(state['radar']), 'expected': 96, 'fields': fields, 'lightning': len(allst),
        'stations': [dict(v, id=k) for k, v in stations]})


# ── the cycle ────────────────────────────────────────────────────────────────
def update():
    """Analyse the radar times that have none yet (newest first, a few per cycle), write the
    products and their index, and fold each into its day."""
    times = radar_index()
    if not times:
        return 'no radar yet'
    # the radar's times (the 'now' products), and every quarter-hour of today since midnight, so
    # the day's extremes include the night before the live layers had any of it
    slots = sorted(set(times) | set(today_slots(max(times))), reverse=True)
    cut = datetime.now(timezone.utc) - timedelta(hours=KEEP_H)
    have = {p.stem for p in (LIVE / 'now_t2').glob('*.bin')} if (LIVE / 'now_t2').exists() else set()
    days = {}

    def analysed(t):
        day = t.astimezone(LONDON).date().isoformat()
        if day not in days:
            try:
                days[day] = set(json.loads((OBS / day / 'work' / 'state.json').read_text())['analyses'])
            except Exception:
                days[day] = set()
        stamp = f'{t:%Y%m%dT%H%M}'
        return stamp in days[day] and (t < cut or stamp in have)
    todo = [t for t in slots if not analysed(t)][:PER_CYCLE]
    made = []
    if todo:
        span_h = (datetime.now(timezone.utc) - min(todo)).total_seconds() / 3600 + 1.5
        reports = metars(min(24, max(3, int(np.ceil(span_h)))))
        for t in todo:
            try:
                A, info, near, r1 = analyse(t, reports)
            except FileNotFoundError:
                continue
            stamp = f'{t:%Y%m%dT%H%M}'
            if t >= cut:                                        # older slots only feed their day
                for p, (_, _, enc, _) in NOW.items():
                    write_frame(LIVE / p / f'{stamp}.bin', A[p[4:]], enc, {'product': p, 'valid': t.isoformat(), 'k': 1, **info})
            update_day(t, A, near, r1)
            made.append(f'{t:%H:%M}')
    rained = fold_radar()
    for p in NOW:
        d = LIVE / p
        if not d.exists():
            continue
        keep = []
        for f in sorted(d.glob('*.bin')):
            tt = datetime.strptime(f.stem, '%Y%m%dT%H%M').replace(tzinfo=timezone.utc)
            if tt < cut:
                f.unlink(missing_ok=True)
            else:
                keep.append(tt.isoformat())
        write_json(d / 'index.json', {'product': p, 'times': keep, 'ext': 'bin'})
    for f in CACHE.glob('*.npz') if CACHE.exists() else []:     # background hours older than the window
        if datetime.strptime(f.stem, '%Y%m%dT%H').replace(tzinfo=timezone.utc) < cut - timedelta(hours=2):
            f.unlink(missing_ok=True)
    write_json(OBS / 'days.json', {'days': sorted((p.name for p in OBS.iterdir() if p.is_dir() and (p / 'summary.json').exists()), reverse=True)}) if OBS.exists() else None
    return (f'analysed {made}' if made else 'up to date') + (f', radar into {rained}' if rained else '')


def catalog_entries():
    out = {}
    for p, (label, unit, enc, _) in NOW.items():
        try:
            idx = json.loads((LIVE / p / 'index.json').read_text())
        except Exception:
            idx = {'times': [], 'ext': 'bin'}
        out[p] = {'label': label, 'kind': 'grid', 'source': 'UKV + METAR observations + Met Office radar', 'step': 15,
                  'times': idx['times'], 'ext': 'bin', 'lo': enc['lo'], 'hi': enc['hi'], 'unit': unit}
    return out


if __name__ == '__main__':
    t0 = time.time()
    print(update(), f'{time.time() - t0:.0f} s')
