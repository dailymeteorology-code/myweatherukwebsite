"""Hyper-Short observation ingestion. OBSERVATIONS ONLY — this module must never import
nova.sources or read a model bucket (enforced by tests/test_lineage.py).

Sources actually wired (all lawful, keyless, real time):
  radar      Met Office 1 km UK rain-rate composite, ODIM HDF5, every 15 min, ~10 min
             latency — s3://met-office-radar-obs-data (CC BY-SA 4.0, Crown copyright)
  lightning  Met Office LEELA strikes, last 48 h, ~1 min latency — consumer-digital API
Investigated but not wired (see docs/HYPER_SHORT.md): surface synop/AWS (no keyless
real-time feed found), radiosondes (no keyless real-time GB feed), satellite
(EUMETSAT needs registration), GNSS-IWV (E-GVAP not open), aircraft (AMDAR restricted).
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone

import numpy as np

from ..io_aws import BUCKETS, get, log

RADAR_STEP_MIN = 15
LIGHTNING_URL = 'https://data.consumer-digital.api.metoffice.gov.uk/v1/lightning'
ALLOWED_HOSTS = ('met-office-radar-obs-data', 'data.consumer-digital.api.metoffice.gov.uk')


def radar_key(t):
    return f'{BUCKETS["radar"]}/radar/{t:%Y/%m/%d}/{t:%Y%m%d%H%M}_ODIM_ng_radar_rainrate_composite_1km_UK.h5'


def read_radar(t):
    """-> dict(rate mm/h (ny,nx) N->S rows, x, y axes in the file's projection, projdef, time)."""
    import h5py
    blob = get(radar_key(t), tries=3)
    f = h5py.File(io.BytesIO(blob), 'r')
    w = f['where'].attrs
    what = f['dataset1/data1/what'].attrs
    d = f['dataset1/data1/data'][:].astype(np.float32)
    rate = d * what['gain'] + what['offset']
    rate[d == what['nodata']] = np.nan
    rate[d == what['undetect']] = 0.0
    projdef = w['projdef'].decode()
    from pyproj import Transformer
    tr = Transformer.from_crs('EPSG:4326', projdef, always_xy=True)
    x0, y0 = tr.transform(w['UL_lon'], w['UL_lat'])
    nx, ny = int(w['xsize']), int(w['ysize'])
    xs = x0 + (np.arange(nx) + 0.5) * w['xscale']
    ys = y0 - (np.arange(ny) + 0.5) * w['yscale']
    return {'rate': rate, 'x': xs, 'y': ys, 'projdef': projdef, 'time': t}


def latest_radar(now, n=3, max_age_min=45):
    """Newest n consecutive composites, newest last. Raises if the newest is too old."""
    t = now.replace(second=0, microsecond=0)
    t -= timedelta(minutes=t.minute % RADAR_STEP_MIN)
    frames = []
    for k in range(12):
        tt = t - timedelta(minutes=RADAR_STEP_MIN * k)
        if now - tt > timedelta(minutes=max_age_min) and not frames:
            break
        try:
            frames.append(read_radar(tt))
        except Exception:
            if frames:
                break
            continue
        if len(frames) == n:
            break
    if not frames:
        raise RuntimeError(f'no radar composite newer than {max_age_min} min')
    return frames[::-1]


def lightning(now, minutes=60):
    """Strikes in the last `minutes`: list of (time, lat, lon)."""
    raw = json.loads(get(f'{LIGHTNING_URL}?last-minutes={minutes}', tries=3).decode())
    strikes = list(raw.get('lightning_strikes', []))
    for c in raw.get('chunks', []):                      # older strikes come in numbered chunks
        try:
            strikes += json.loads(get(f'{LIGHTNING_URL}?last-minutes={minutes}&chunk={c["chunk"]}').decode())['lightning_strikes']
        except Exception:
            pass
    out = []
    for s in strikes:
        try:
            t = datetime.fromisoformat(s['strike_time'].replace('Z', '+00:00'))
            lon, lat = s['coordinates']
            out.append((t, float(lat), float(lon)))
        except Exception:
            continue
    return out, raw.get('last_update')
