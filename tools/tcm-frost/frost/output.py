"""TCM FROST's outputs, in Model Data's own frame format so the site shows them like any model.

    <run>/<var>/<lead>.bin       one byte a cell over the whole 2 km grid (gzip; JSON head)
    <run>/<var>/status.json      as Model Data's jobs write it (complete)
    <run>/_days/<date>/<var>.bin each day's totals and chances
    <run>/_point.bin             every land cell's whole forecast, for the Location page
    <run>/manifest.json          the run: sources, members, weights, leads, days
"""
from __future__ import annotations

import gzip
import json
import struct

import numpy as np

from .config import ENC, GRID


def encode(a, enc):
    lo, hi, kind = enc['lo'], enc['hi'], enc.get('scale', 'lin')
    f = (lambda v: np.sqrt(np.maximum(v, 0))) if kind == 'sqrt' else (lambda v: v)
    flo, fhi = f(np.float64(lo)), f(np.float64(hi))
    with np.errstate(invalid='ignore'):
        q = np.rint((f(np.clip(a, lo, hi)) - flo) / (fhi - flo) * 254.0)
    return np.where(np.isfinite(a), q, 255).astype(np.uint8)


def write_frame(path, a, enc, meta):
    path.parent.mkdir(parents=True, exist_ok=True)
    ny, nx = a.shape
    head = json.dumps(dict(meta, grid='uk', nx=nx, ny=ny, lo=enc['lo'], hi=enc['hi'], scale=enc.get('scale', 'lin'))).encode()
    path.write_bytes(gzip.compress(struct.pack('<I', len(head)) + head + encode(a, enc).tobytes(), 6))


def write_status(d, run_iso, var, leads):
    (d / 'status.json').write_text(json.dumps({'model': 'frost', 'run': run_iso, 'var': var, 'steps': leads, 'done': leads,
                                               'missing': [], 'state': 'complete'}, separators=(',', ':')))


def write_point(path, idx, leads, series, days, day_names, valid):
    """series: uint8 (cells, leads, 3) = expected cm since the start (snow_expected bytes), chance %, risk;
    days: uint8 (cells, days, 6) = expected cm (snow_24h bytes), chance of 0.2 / 1 / 5 / 10 cm %, risk."""
    head = json.dumps({'cells': int(idx.size), 'leads': leads, 'valid': valid, 'series': ['snow_expected', 'snow_chance', 'snow_risk'],
                       'days': day_names, 'day_vars': ['cm', 'p0', 'p1', 'p5', 'p10', 'risk'], 'enc': ENC,
                       'grid': GRID}).encode()
    body = struct.pack('<I', len(head)) + head + idx.astype('<u4').tobytes() + series.tobytes() + days.tobytes()
    path.write_bytes(gzip.compress(body, 6))
