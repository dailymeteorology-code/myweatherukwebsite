"""Point forecasts for the Location Weather page, from Met Office UKV runs on AWS.

    python -m mdata.point cube 2026-10-20T03:00Z

The page asks for one place at a time, while a run's data arrives as whole-grid frames (one
file per variable per step). Reading a place from those would mean opening every frame, so a
run's frames are restacked once into a "point cube": point/<run>/<var>.u8 holds every cell's
whole forecast as one contiguous row of bytes, [cell][step], in the frames' own encoding. The
server then reads a place with one small read per variable.

Only the UK and Ireland window of the grid is kept (with a margin for the server's
neighbourhood chance of rain), about a third of the grid.

The frames come from the ordinary Model Data jobs, which the server queues (server/
modelData.js, refreshPoint): this module only assembles them, so a job is never run twice
at once. Frames the Model Data page has already made are reused, and vice versa.
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .common import DATA, DX, NX, NY, X0, Y_TOP, lonlat, write_json
from .job import run_dir, steps_for
from .models import VARIABLES, _utc

POINT = DATA / 'point'
KEEP = 4                                              # newest cubes kept (a T+120 run and fresher T+54 ones)

# what the Location page shows, in the server's list order (server/modelData.js POINT_VARS)
POINT_VARS = ['t2', 'td2', 'rh2', 'tskin', 'wind10', 'gust10', 'wdir10', 'mslp',
              'precip_rate', 'precip_step', 'snow_rate', 'snow_step', 'hail_rate',
              'tcc', 'lcc', 'mcc', 'hcc', 'cloud_base', 'vis', 'fog',
              'cape_mu', 'lightning', 'frz', 'snow_swe', 'sw_down', 'uv_down']

# the UK, the Crown Dependencies and Ireland, plus 12 cells (24 km) all round
BOX = dict(lon=(-11.2, 2.4), lat=(48.9, 61.3))
PAD = 12


def window():
    """(r0, r1, c0, c1): the rows and columns of the display grid the cubes keep (row 0 north)."""
    lon, lat = lonlat()
    m = (lon >= BOX['lon'][0]) & (lon <= BOX['lon'][1]) & (lat >= BOX['lat'][0]) & (lat <= BOX['lat'][1])
    rows, cols = np.where(m.any(1))[0], np.where(m.any(0))[0]
    return (max(0, int(rows[0]) - PAD), min(NY, int(rows[-1]) + PAD + 1),
            max(0, int(cols[0]) - PAD), min(NX, int(cols[-1]) + PAD + 1))


def _raw(path: Path):
    """A frame's bytes as stored (no decoding): (uint8 (ny, nx), header)."""
    raw = gzip.decompress(path.read_bytes())
    n = struct.unpack('<I', raw[:4])[0]
    h = json.loads(raw[4:4 + n])
    return np.frombuffer(raw, np.uint8, h['nx'] * h['ny'], 4 + n).reshape(h['ny'], h['nx']), h


def prune():
    tags = sorted(p.name for p in POINT.iterdir() if p.is_dir() and (p / 'manifest.json').exists())
    for t in tags[:-KEEP]:
        shutil.rmtree(POINT / t, ignore_errors=True)
    for p in POINT.glob('*.partial'):
        if time.time() - p.stat().st_mtime > 3600:
            shutil.rmtree(p, ignore_errors=True)


def cube(run_s):
    run = _utc(run_s)
    tag = f'{run:%Y%m%dT%H%MZ}'
    t0 = time.time()
    steps = steps_for('ukv', run)
    r0, r1, c0, c1 = window()
    nr, nc = r1 - r0, c1 - c0
    tmp = POINT / f'{tag}.partial'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    man = {'model': 'ukv', 'run': run.isoformat(), 'tag': tag, 'steps': steps,
           'r0': r0, 'c0': c0, 'nr': nr, 'nc': nc, 'nx': NX, 'ny': NY, 'x0': X0, 'y_top': Y_TOP, 'dx': DX,
           'vars': {}}
    for v in POINT_VARS:
        d = run_dir('ukv', run, v)
        arr = np.full((len(steps), nr, nc), 255, np.uint8)
        have, enc = [], None
        for i, h in enumerate(steps):
            p = d / f'{h}.bin'
            if not p.exists():
                continue
            try:
                q, head = _raw(p)
            except Exception:
                continue                               # a frame being rewritten: that step stays empty
            arr[i] = q[r0:r1, c0:c1]
            have.append(h)
            enc = enc or {'lo': head['lo'], 'hi': head['hi'], 'scale': head.get('scale', 'lin')}
        if enc is None:
            e = VARIABLES[v]
            enc = {'lo': e['lo'], 'hi': e['hi'], 'scale': e.get('scale', 'lin')}
        np.ascontiguousarray(arr.reshape(len(steps), nr * nc).T).tofile(tmp / f'{v}.u8')
        man['vars'][v] = dict(enc, unit=VARIABLES[v]['unit'], steps=have)
    man['built'] = datetime.now(timezone.utc).isoformat()
    write_json(tmp / 'manifest.json', man)
    out = POINT / tag
    if out.exists():
        shutil.rmtree(out)
    os.replace(tmp, out)
    prune()
    print(f'point cube {tag}: {len(steps)} steps, {nr}x{nc} cells, {time.time() - t0:.0f} s')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'cube':
        cube(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(2)
