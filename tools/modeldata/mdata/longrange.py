"""Long range (15 Nov 2026, at the user's request): the stratospheric polar vortex and the MJO.

    python -m mdata.longrange        -> D:/MyWeatherUK-data/modeldata/longrange.json

The polar vortex: its strength is the zonal-mean westerly wind at 60°N, 10 hPa (below nought, the
vortex has broken down: a major sudden stratospheric warming). Every value is worked out here from
the models' own global fields, the mean of the wind all the way round the 60°N circle:
    analysis   GFS's 00Z analyses, the past 90 days (one 10 hPa field a day; kept, so a day is fetched once)
    gfs        the newest GFS run, every 12 hours to 16 days
    gefs       the newest complete GEFS 00Z run's 30 members, daily to 35 days, with their mean and
               the share of members below nought (NOAA's 00Z GEFS runs to 35 days; its later days
               upload slowly, so the newest run whose 30th member has reached day 35)
    normal     the 1991-2020 average for each day of the year (NCEP/NCAR reanalysis daily long-term
               means, NOAA PSL, over OPeNDAP)
The MJO: the Bureau of Meteorology's real-time RMM index (RMM1, RMM2, its phase and amplitude), the
past 90 days. There is no open MJO forecast data to draw (the centres publish theirs as pictures).
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import re
import sys
import time
import traceback
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA, write_json
from nova.io_aws import decode_grib, get

OUT = DATA / 'longrange.json'
GFS_BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'
GEFS_BUCKET = 'https://noaa-gefs-pds.s3.amazonaws.com'
PSL_LTM = 'https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis.derived/pressure/uwnd.day.ltm.1991-2020.nc'
BOM_RMM = 'https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt'
DAYS_BACK = 90


def _u60(url, idx_url):
    """The zonal mean of the 10 hPa westerly wind at 60°N (m/s) in one global GRIB file."""
    lines = get(idx_url, tries=3, timeout=60).decode().splitlines()
    for i, ln in enumerate(lines):
        if ':UGRD:10 mb:' in ln:
            start = int(ln.split(':')[1])
            end = int(lines[i + 1].split(':')[1]) - 1 if i + 1 < len(lines) else None
            break
    else:
        raise KeyError(f'no 10 hPa wind in {url}')
    a, meta = decode_grib(get(url, (start, end) if end else (start, start + 4_000_000), tries=3, timeout=120))
    lat1, lat2, nj = meta['latitudeOfFirstGridPointInDegrees'], meta['latitudeOfLastGridPointInDegrees'], meta['Nj']
    lats = np.linspace(lat1, lat2, nj)
    j = int(np.argmin(np.abs(lats - 60.0)))
    if abs(lats[j] - 60.0) > 0.01:
        raise ValueError(f'no 60N row in {url}')
    return round(float(np.nanmean(a[j])), 2)


def analysis(old):
    """GFS's 00Z analyses, a day each, for the past DAYS_BACK days (what is kept is not fetched again)."""
    have = {d: u for d, u in (old or [])}
    today = datetime.now(timezone.utc).date()
    want = [today - timedelta(days=k) for k in range(DAYS_BACK, -1, -1)]

    def one(day):
        key = day.isoformat()
        if key in have:
            return key, have[key]
        base = f'{GFS_BUCKET}/gfs.{day:%Y%m%d}/00/atmos/gfs.t00z.pgrb2.0p25.f000'
        try:
            return key, _u60(base, base + '.idx')
        except Exception:                                   # noqa: BLE001  (not there yet, or gone)
            return key, None
    with cf.ThreadPoolExecutor(8) as ex:
        got = dict(ex.map(one, want))
    return [[d, u] for d, u in sorted(got.items()) if u is not None]


def gfs():
    """The newest GFS run with its day 16, every 12 hours."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    for k in range(0, 8):
        run = now - timedelta(hours=now.hour % 6 + 6 * k)
        base = f'{GFS_BUCKET}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f'
        try:
            get(base + '384.idx', tries=1, timeout=20)
        except Exception:                                   # noqa: BLE001  (not finished)
            continue
        steps = list(range(0, 385, 12))

        def one(h):
            try:
                return h, _u60(f'{base}{h:03d}', f'{base}{h:03d}.idx')
            except Exception:                               # noqa: BLE001
                return h, None
        with cf.ThreadPoolExecutor(8) as ex:
            got = dict(ex.map(one, steps))
        pts = [[(run + timedelta(hours=h)).strftime('%Y-%m-%dT%H:%MZ'), u] for h, u in sorted(got.items()) if u is not None]
        return {'run': run.strftime('%Y-%m-%dT%H:%MZ'), 'points': pts}
    return None


def gefs(old):
    """The newest 00Z GEFS run whose 30th member has reached day 35: every member's wind, daily."""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    for k in range(0, 4):
        run = today - timedelta(days=k)
        base = f'{GEFS_BUCKET}/gefs.{run:%Y%m%d}/00/atmos/pgrb2ap5/'
        try:
            get(base + 'gep30.t00z.pgrb2a.0p50.f840.idx', tries=1, timeout=20)
        except Exception:                                   # noqa: BLE001  (its last days not up yet)
            continue
        iso = run.strftime('%Y-%m-%dT%H:%MZ')
        if old and old.get('run') == iso and len(old.get('members', [])) == 30:
            return old
        days = list(range(1, 36))
        tasks = [(m, d) for m in range(1, 31) for d in days]

        def one(t):
            m, d = t
            url = f'{base}gep{m:02d}.t00z.pgrb2a.0p50.f{24 * d:03d}'
            for attempt in range(3):
                try:
                    return t, _u60(url, url + '.idx')
                except Exception:                           # noqa: BLE001
                    time.sleep(1 + attempt)
            return t, None
        with cf.ThreadPoolExecutor(16) as ex:
            got = dict(ex.map(one, tasks))
        members = [[got.get((m, d)) for d in days] for m in range(1, 31)]
        cols = [[x for x in col if x is not None] for col in zip(*members)]
        return {'run': iso, 'days': [(run + timedelta(days=d)).date().isoformat() for d in days], 'members': members,
                'mean': [round(float(np.mean(c)), 2) if c else None for c in cols],
                'below0': [round(sum(x < 0 for x in c) / len(c), 3) if c else None for c in cols]}
    return old


def normal(old):
    """The 1991-2020 zonal-mean wind at 60°N, 10 hPa, for each day of the year (kept once fetched)."""
    if old and len(old) >= 365:
        return old
    import netCDF4
    ds = netCDF4.Dataset(PSL_LTM)
    levs = list(np.asarray(ds['level'][:], float))
    lats = np.asarray(ds['lat'][:], float)
    k, j = levs.index(10.0), int(np.argmin(np.abs(lats - 60.0)))
    u = np.asarray(ds['uwnd'][:, k, j, :], float)               # (day of year, longitude)
    ds.close()
    return [round(float(x), 2) for x in u.mean(axis=1)]


def mjo():
    """The Bureau of Meteorology's real-time RMM index, the past DAYS_BACK days."""
    txt = get(BOM_RMM, tries=3, timeout=60).decode('utf-8', 'replace')
    rows = []
    for ln in txt.splitlines():
        p = ln.split()
        if len(p) < 7 or not re.fullmatch(r'\d{4}', p[0]):
            continue
        try:
            y, mo, d = int(p[0]), int(p[1]), int(p[2])
            r1, r2, ph, amp = float(p[3]), float(p[4]), int(float(p[5])), float(p[6])
        except ValueError:
            continue
        if abs(r1) > 100 or abs(r2) > 100 or amp > 100:     # missing: 1.E36 or 999
            continue
        rows.append([f'{y:04d}-{mo:02d}-{d:02d}', round(r1, 3), round(r2, 3), ph, round(amp, 3)])
    return {'source': 'Bureau of Meteorology real-time RMM index (Wheeler and Hendon)', 'days': rows[-DAYS_BACK:]}


def main():
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    t0 = time.time()
    try:
        old = json.loads(OUT.read_text())
    except Exception:                                       # noqa: BLE001
        old = {}
    ov = old.get('vortex', {})
    out = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'vortex': {}, 'mjo': old.get('mjo')}
    v = out['vortex']
    for name, fn in (('normal', lambda: normal(ov.get('normal'))), ('analysis', lambda: analysis(ov.get('analysis'))),
                     ('gfs', gfs), ('gefs', lambda: gefs(ov.get('gefs')))):
        try:
            v[name] = fn()
        except Exception as e:                              # noqa: BLE001  (one source down: keep what we had)
            v[name] = ov.get(name)
            print(f'longrange {name}: {type(e).__name__}: {e}'[:300], file=sys.stderr)
    try:
        out['mjo'] = mjo()
    except Exception as e:                                  # noqa: BLE001
        print(f'longrange mjo: {type(e).__name__}: {e}'[:300], file=sys.stderr)
    out['seconds'] = round(time.time() - t0, 1)
    write_json(OUT, out)
    g = v.get('gefs') or {}
    print(f"longrange: analysis {len(v.get('analysis') or [])} days, gfs {len((v.get('gfs') or {}).get('points', []))} points, "
          f"gefs {g.get('run')} {len(g.get('members', []))} members, normal {len(v.get('normal') or [])} days, "
          f"mjo {len((out.get('mjo') or {}).get('days', []))} days, {out['seconds']} s")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
