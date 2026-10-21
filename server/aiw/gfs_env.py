"""Model atmosphere for the AI lightning warnings: NOAA GFS 0.25° from AWS open data.

    python gfs_env.py <out-dir> <YYYYMMDDHH> [<YYYYMMDDHH> ...]

For each valid hour it takes the newest GFS cycle that covers it (at least one hour into the
forecast, so the hourly-mean fields exist), cuts nine fields out of the global GRIB file with HTTP
range requests found from the .idx, keeps every second point (a 0.5° global grid, 720 x 361,
north row first, longitude 0..359.5) and writes

    <out-dir>/<YYYYMMDDHH>.bin    nine int16 grids, little-endian, one after another
    <out-dir>/<YYYYMMDDHH>.json   the cycle, forecast hour, grid and each field's scale

so the Node side can read any point with no GRIB library. Hours already written are skipped. The
same hour-files serve the live engine and training on archived strikes, so a model is trained on
exactly the inputs it will see.

Fields (scale: stored = value * scale):
    cape   CAPE, surface-based, J/kg               1
    cin    convective inhibition, J/kg (<= 0)      1
    lftx   surface lifted index, K                 100
    u10 v10, u500 v500, u700 v700   wind, m/s      100
    cprat  convective precipitation rate, mm/h     100
Data: NOAA GFS, public domain.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BASE = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'
UA = 'MyWeatherUK-selfhost/1.0 (lightning warnings)'
FIELDS = [
    ('cape', 'CAPE', 'surface', 1),
    ('cin', 'CIN', 'surface', 1),
    ('lftx', 'LFTX', 'surface', 100),
    ('u10', 'UGRD', '10 m above ground', 100),
    ('v10', 'VGRD', '10 m above ground', 100),
    ('u500', 'UGRD', '500 mb', 100),
    ('v500', 'VGRD', '500 mb', 100),
    ('u700', 'UGRD', '700 mb', 100),
    ('v700', 'VGRD', '700 mb', 100),
    ('cprat', 'CPRAT', 'surface', 100),
]
_codes = threading.Lock()


def get(url, rng=None, tries=4):
    last = None
    for i in range(tries):
        h = {'User-Agent': UA}
        if rng:
            h['Range'] = f'bytes={rng[0]}-{"" if rng[1] is None else rng[1]}'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise FileNotFoundError(url) from e
            last = e
        except Exception as e:
            last = e
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'download failed: {url}: {last}')


def url_of(cycle, fh):
    return f'{BASE}/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos/gfs.t{cycle:%H}z.pgrb2.0p25.f{fh:03d}'


def records(cycle, fh):
    """{(var, level): (start, end)} for the instantaneous fields of one file."""
    lines = [l for l in get(url_of(cycle, fh) + '.idx').decode().splitlines() if l.strip()]
    offs = [int(l.split(':')[1]) for l in lines]
    out = {}
    for i, l in enumerate(lines):
        p = l.split(':')
        var, lev, when = p[3], p[4], p[5]
        if when != f'{fh} hour fcst' and not (fh == 0 and when == 'anl'):
            continue                                  # skip the averages and accumulations
        out.setdefault((var, lev), (offs[i], offs[i + 1] - 1 if i + 1 < len(offs) else None))
    return out


def pick_cycle(valid):
    """The newest cycle with a file for this hour, at least 1 h into its forecast."""
    c = valid.replace(hour=valid.hour - valid.hour % 6)
    for k in range(0, 6):
        cycle = c - timedelta(hours=6 * k)
        fh = int((valid - cycle).total_seconds() // 3600)
        if fh < 1:
            continue
        try:
            return cycle, fh, records(cycle, fh)
        except FileNotFoundError:
            continue
    raise RuntimeError(f'no GFS cycle covers {valid:%Y-%m-%d %H}Z yet')


def decode(msg):
    import eccodes
    with _codes:
        h = eccodes.codes_new_from_message(msg)
        try:
            ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
            v = eccodes.codes_get_values(h).reshape(nj, ni)
            first_lat = eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees')
        finally:
            eccodes.codes_release(h)
    if first_lat < 0:
        v = v[::-1]                                   # north row first
    return v[::2, ::2]                                # 0.25° -> 0.5°: 361 x 720


def build(out, valid):
    tag = f'{valid:%Y%m%d%H}'
    if (out / f'{tag}.bin').exists() and (out / f'{tag}.json').exists():
        return 'cached'
    cycle, fh, recs = pick_cycle(valid)
    url = url_of(cycle, fh)
    missing = [(n, v, l) for n, v, l, _ in FIELDS if (v, l) not in recs]
    if missing:
        raise RuntimeError(f'{tag}: {cycle:%Y%m%d%H}+{fh} lacks {missing}')

    def one(field):
        name, var, lev, scale = field
        a, b = recs[(var, lev)]
        arr = decode(get(url, (a, b)))
        if name == 'cprat':
            arr = arr * 3600.0                        # kg m-2 s-1 -> mm/h
        return name, np.clip(np.rint(arr * scale), -32767, 32767).astype('<i2')

    with cf.ThreadPoolExecutor(5) as ex:
        grids = dict(ex.map(one, FIELDS))
    tmp = out / f'{tag}.bin.{os.getpid()}.tmp'
    with open(tmp, 'wb') as f:
        for name, *_ in FIELDS:
            f.write(grids[name].tobytes())
    os.replace(tmp, out / f'{tag}.bin')
    head = {'valid': valid.isoformat(), 'cycle': cycle.isoformat(), 'fh': fh, 'nx': 720, 'ny': 361,
            'lat0': 90.0, 'dlat': -0.5, 'lon0': 0.0, 'dlon': 0.5,
            'fields': [{'name': n, 'scale': s} for n, _, _, s in FIELDS],
            'source': 'NOAA GFS 0.25° (AWS open data)'}
    (out / f'{tag}.json').write_text(json.dumps(head), encoding='utf-8')
    return f'{cycle:%Y%m%d%H}+{fh}'


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    hours = [datetime.strptime(h, '%Y%m%d%H').replace(tzinfo=timezone.utc) for h in sys.argv[2:]]
    ok = 0
    with cf.ThreadPoolExecutor(3) as ex:                 # a few hours at once
        futs = {ex.submit(build, out, h): h for h in hours}
        for fut in cf.as_completed(futs):
            h = futs[fut]
            try:
                print(json.dumps({'hour': f'{h:%Y%m%d%H}', 'ok': True, 'from': fut.result()}), flush=True)
                ok += 1
            except Exception as e:
                print(json.dumps({'hour': f'{h:%Y%m%d%H}', 'ok': False, 'error': str(e)[:200]}), flush=True)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
