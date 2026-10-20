"""Live layers: satellite, radar and lightning, kept fresh on the display grid at 1 km.

    python -m mdata.live update          (run by the server every 2 minutes)

Sources (keyless, official, real time; no RainViewer, no Open-Meteo):
    Satellite   EUMETSAT EUMETView WMS: Meteosat-12 (MTG FCI) every 10 min (infrared 10.5 um and
                visible 0.6 um at the FCI's finest "HRFI" resolution, GeoColour, true colour, fog
                RGB) and Meteosat 0 deg (SEVIRI) every 15 min (water vapour, airmass, convection,
                cloud-top height).
    Radar       Met Office 1 km UK rain-rate composite, ODIM HDF5, every 15 min
                (s3://met-office-radar-obs-data), at its native 1 km.
    Lightning   Met Office LEELA strikes (last 48 h, ~1 min latency).

Everything is reprojected onto the display grid at 1 km (2084 x 1940, twice the 2 km model
grid), so it lines up exactly with the models, coastlines and places.
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import io
import json
import logging
import re
import struct
import sys
import time
import traceback
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image
from scipy import ndimage

from .common import DATA, DX, NX, NY, PROJ, X0, Y_TOP, encode, write_json

LIVE = DATA / 'live'
SS = 2                                                     # 1 km = half a display cell
LW, LH = NX * SS, NY * SS
WMS = 'https://view.eumetsat.int/geoserver'
BBOX = (43.5, -26.0, 64.5, 17.0)                           # lat0, lon0, lat1, lon1 (covers the whole grid)
TILES = (4, 4)
TILE_PX = (1000, 760)
KEEP_H = 12
BACKFILL_H = 3

PRODUCTS = {
    'sat_ir':      dict(kind='grey', layer='mtg_fd:ir105_hrfi', step=10, label='Infrared 10.5 µm', sat='Meteosat-12 FCI'),
    'sat_vis':     dict(kind='grey', layer='mtg_fd:vis06_hrfi', step=10, label='Visible 0.6 µm', sat='Meteosat-12 FCI'),
    'sat_geo':     dict(kind='rgb', layer='mtg_fd:rgb_geocolour', step=10, label='GeoColour (day & night)', sat='Meteosat-12 FCI'),
    'sat_true':    dict(kind='rgb', layer='mtg_fd:rgb_truecolour', step=10, label='True colour', sat='Meteosat-12 FCI'),
    'sat_fog':     dict(kind='rgb', layer='mtg_fd:rgb_fog', step=10, label='Fog & low cloud RGB', sat='Meteosat-12 FCI'),
    'sat_wv':      dict(kind='grey', layer='msg_fes:wv062', step=15, label='Water vapour 6.2 µm', sat='Meteosat 0° SEVIRI'),
    'sat_airmass': dict(kind='rgb', layer='msg_fes:rgb_airmass', step=15, label='Airmass RGB', sat='Meteosat 0° SEVIRI'),
    'sat_conv':    dict(kind='rgb', layer='msg_fes:rgb_convection', step=15, label='Severe convection RGB', sat='Meteosat 0° SEVIRI'),
    'sat_cth':     dict(kind='rgba', layer='msg_fes:cth', step=15, label='Cloud-top height', sat='Meteosat 0° SEVIRI'),
    'radar':       dict(kind='grid', step=15, label='Rain radar', sat='Met Office 1 km composite', lo=0, hi=128, scale='sqrt'),
}


def _utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)


def _ll1km():
    """lon/lat of every 1 km pixel of the display grid (cached)."""
    f = LIVE / 'lonlat_1km.npz'
    if f.exists():
        z = np.load(f)
        return z['lon'], z['lat']
    from pyproj import Transformer
    tr = Transformer.from_crs(PROJ, 'EPSG:4326', always_xy=True)
    x = (X0 - DX / 2) + (np.arange(LW) + 0.5) * DX / SS
    y = (Y_TOP + DX / 2) - (np.arange(LH) + 0.5) * DX / SS
    xx, yy = np.meshgrid(x, y)
    lon, lat = tr.transform(xx, yy)
    LIVE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(f, lon=lon.astype(np.float32), lat=lat.astype(np.float32))
    return lon.astype(np.float32), lat.astype(np.float32)


# ── satellite (WMS) ─────────────────────────────────────────────────────────
def latest_time(layer):
    """The newest image the layer offers (its capabilities' time dimension)."""
    ws, name = layer.split(':')
    from nova.io_aws import get
    txt = get(f'{WMS}/{ws}/{name}/wms?service=WMS&version=1.3.0&request=GetCapabilities', tries=3, timeout=60).decode('utf8', 'replace')
    m = re.search(r'<Dimension name="time"[^>]*>([^<]+)</Dimension>', txt)
    if not m:
        raise RuntimeError(f'no time dimension for {layer}')
    spec = m.group(1).strip().split(',')[-1]
    end = spec.split('/')[1] if '/' in spec else spec
    return _utc(end)


def wms_mosaic(layer, t, rgba=False):
    """The layer at time t over BBOX as one equirectangular image (tiles fetched in parallel)."""
    from nova.io_aws import get
    lat0, lon0, lat1, lon1 = BBOX
    ncol, nrow = TILES
    tw, th = TILE_PX
    dlon, dlat = (lon1 - lon0) / ncol, (lat1 - lat0) / nrow
    fmt = 'image/png' if rgba else 'image/jpeg'

    def one(ij):
        i, j = ij
        b = (lat1 - (j + 1) * dlat, lon0 + i * dlon, lat1 - j * dlat, lon0 + (i + 1) * dlon)
        url = (f'{WMS}/wms?service=WMS&version=1.3.0&request=GetMap&layers={layer}&styles=&crs=EPSG:4326'
               f'&bbox={b[0]:.4f},{b[1]:.4f},{b[2]:.4f},{b[3]:.4f}&width={tw}&height={th}&format={fmt}'
               f'&transparent={"true" if rgba else "false"}&time={t:%Y-%m-%dT%H:%M:%SZ}')
        blob = get(url, tries=3, timeout=90)
        if blob[:5] == b'<?xml' or blob[:1] == b'<':
            raise RuntimeError(f'{layer} {t:%H%M}: service exception')
        return ij, Image.open(io.BytesIO(blob)).convert('RGBA' if rgba else 'RGB')
    mode = 'RGBA' if rgba else 'RGB'
    mos = Image.new(mode, (ncol * tw, nrow * th))
    with cf.ThreadPoolExecutor(ncol * nrow) as ex:
        for (i, j), im in ex.map(one, [(i, j) for j in range(nrow) for i in range(ncol)]):
            mos.paste(im, (i * tw, j * th))
    return np.asarray(mos)


_IDX = {}


def to_grid(img):
    """Equirectangular BBOX image -> the 1 km display grid (bilinear)."""
    h, w = img.shape[:2]
    if (h, w) not in _IDX:
        lon, lat = _ll1km()
        lat0, lon0, lat1, lon1 = BBOX
        _IDX[(h, w)] = (((lat1 - lat) / (lat1 - lat0) * h - 0.5).astype(np.float32),
                        ((lon - lon0) / (lon1 - lon0) * w - 0.5).astype(np.float32))
        _IDX[(h, w)][0].shape  # noqa: B018
    rr, cc = _IDX[(h, w)]
    chans = [ndimage.map_coordinates(img[..., c].astype(np.float32), [rr, cc], order=1, mode='nearest') for c in range(img.shape[2])]
    return np.clip(np.stack(chans, -1), 0, 255).astype(np.uint8)


def make_sat(key, t):
    P = PRODUCTS[key]
    out = LIVE / key / f'{t:%Y%m%dT%H%M}.{"png" if P["kind"] == "rgba" else "jpg"}'
    if out.exists():
        return out
    a = to_grid(wms_mosaic(P['layer'], t, rgba=P['kind'] == 'rgba'))
    out.parent.mkdir(parents=True, exist_ok=True)
    if P['kind'] == 'grey':
        im = Image.fromarray(a[..., 0], 'L')
    elif P['kind'] == 'rgba':
        im = Image.fromarray(a, 'RGBA')
    else:
        im = Image.fromarray(a, 'RGB')
    tmp = out.with_suffix('.tmp')
    if P['kind'] == 'rgba':
        im.save(tmp, format='PNG', optimize=True)
    else:
        im.save(tmp, format='JPEG', quality=88, optimize=True)
    tmp.replace(out)
    return out


# ── radar ───────────────────────────────────────────────────────────────────
_RIDX = {}


def make_radar(t):
    out = LIVE / 'radar' / f'{t:%Y%m%dT%H%M}.bin'
    if out.exists():
        return out
    rate = radar_rate(t)
    P = PRODUCTS['radar']
    enc = {'lo': P['lo'], 'hi': P['hi'], 'scale': P['scale']}
    head = json.dumps({'product': 'radar', 'valid': t.isoformat(), 'nx': LW, 'ny': LH, 'k': 1 / SS,
                       'lo': enc['lo'], 'hi': enc['hi'], 'scale': enc['scale']}).encode()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp')
    tmp.write_bytes(gzip.compress(struct.pack('<I', len(head)) + head + encode(rate, enc).tobytes(), 6))
    tmp.replace(out)
    return out


def radar_rate(t):
    """The Met Office composite at t (mm/h) on the 1 km display grid (NaN outside coverage)."""
    from nova.hyper.obs import read_radar
    R = read_radar(t)
    key = (R['projdef'], R['x'].size, R['y'].size, float(R['x'][0]), float(R['y'][0]))
    if key not in _RIDX:
        from pyproj import Transformer
        lon, lat = _ll1km()
        x, y = Transformer.from_crs('EPSG:4326', R['projdef'], always_xy=True).transform(lon, lat)
        dx, dy = R['x'][1] - R['x'][0], R['y'][1] - R['y'][0]
        ci = np.rint((x - R['x'][0]) / dx).astype(np.int64)
        rj = np.rint((y - R['y'][0]) / dy).astype(np.int64)
        ok = (ci >= 0) & (ci < R['x'].size) & (rj >= 0) & (rj < R['y'].size)
        _RIDX.clear()
        _RIDX[key] = (np.clip(rj, 0, R['y'].size - 1), np.clip(ci, 0, R['x'].size - 1), ok)
    rj, ci, ok = _RIDX[key]
    return np.where(ok, R['rate'][rj, ci], np.nan).astype(np.float32)


def radar_latest(now):
    """The newest composite on AWS (they appear ~10 min after their time)."""
    from nova.io_aws import exists
    from nova.hyper.obs import radar_key
    t = now.replace(second=0, microsecond=0)
    t -= timedelta(minutes=t.minute % 15)
    for k in range(8):
        if exists(radar_key(t - timedelta(minutes=15 * k))):
            return t - timedelta(minutes=15 * k)
    return None


# ── lightning ───────────────────────────────────────────────────────────────
def lightning():
    from nova.hyper.obs import lightning as leela
    from pyproj import Transformer
    now = datetime.now(timezone.utc)
    strikes, last = leela(now, KEEP_H * 60)
    tr = Transformer.from_crs('EPSG:4326', PROJ, always_xy=True)
    out = []
    if strikes:
        lat = np.array([s[1] for s in strikes]); lon = np.array([s[2] for s in strikes])
        x, y = tr.transform(lon, lat)
        gx = (x - (X0 - DX / 2)) / DX
        gy = ((Y_TOP + DX / 2) - y) / DX
        for (t, _, _), a, b in zip(strikes, gx, gy):
            if -5 < a < NX + 5 and -5 < b < NY + 5:
                out.append([int(t.timestamp() * 1000), round(float(a), 2), round(float(b), 2)])
    out.sort()
    write_json(LIVE / 'lightning.json', {'updated': now.isoformat(), 'feed_updated': last, 'strikes': out})
    return len(out)


# ── the updater ─────────────────────────────────────────────────────────────
def wanted(latest, step_min, hours):
    return [latest - timedelta(minutes=step_min * k) for k in range(int(hours * 60 / step_min) + 1)]


def update_product(key):
    P = PRODUCTS[key]
    now = datetime.now(timezone.utc)
    try:
        latest = radar_latest(now) if key == 'radar' else latest_time(P['layer'])
    except Exception as e:
        return key, f'no times: {e}'
    if latest is None:
        return key, 'nothing yet'
    made, failed = 0, 0
    for t in wanted(latest, P['step'], BACKFILL_H):              # newest first
        try:
            path = make_radar(t) if key == 'radar' else make_sat(key, t)
            made += 1 if path else 0
        except Exception:
            failed += 1
            if failed > 3:
                break
    d = LIVE / key
    cut = now - timedelta(hours=KEEP_H)
    times = []
    for f in sorted(d.glob('*.*')) if d.exists() else []:
        if f.suffix not in ('.jpg', '.png', '.bin'):
            continue
        tt = datetime.strptime(f.stem, '%Y%m%dT%H%M').replace(tzinfo=timezone.utc)
        if tt < cut:
            f.unlink(missing_ok=True)
        else:
            times.append(tt.isoformat())
    write_json(d / 'index.json', {'product': key, 'times': times, 'ext': ('png' if P['kind'] == 'rgba' else 'bin' if P['kind'] == 'grid' else 'jpg')})
    return key, f'{len(times)} times, latest {latest:%H:%M}'


def catalog():
    out = {}
    for k, P in PRODUCTS.items():
        try:
            idx = json.loads((LIVE / k / 'index.json').read_text())
        except Exception:
            idx = {'times': [], 'ext': None}
        out[k] = {'label': P['label'], 'kind': P['kind'], 'source': P['sat'], 'step': P['step'],
                  'times': idx['times'], 'ext': idx.get('ext')}
        if P['kind'] == 'grid':
            out[k].update(lo=P['lo'], hi=P['hi'], scale=P['scale'], unit='mm/h')
    from . import now
    out.update(now.catalog_entries())
    write_json(LIVE / 'catalog.json', {'updated': datetime.now(timezone.utc).isoformat(), 'products': out})


def update():
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    t0 = time.time()
    LIVE.mkdir(parents=True, exist_ok=True)
    _ll1km()
    with cf.ThreadPoolExecutor(4) as ex:
        res = list(ex.map(update_product, PRODUCTS))
    try:
        n = lightning()
    except Exception as e:
        n = f'failed: {e}'
    try:                                       # current conditions + the observed day (mdata/now.py)
        from . import now
        nw = now.update()
    except Exception as e:
        nw = f'failed: {type(e).__name__}: {e}'
        traceback.print_exc()
    catalog()
    print(f'live: {res} lightning={n} now={nw} in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    try:
        {'update': update}[sys.argv[1]]()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
