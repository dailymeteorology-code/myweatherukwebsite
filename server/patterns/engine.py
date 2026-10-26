"""Weather Patterns: the likeliest weather patterns for each of the next two weeks, from ECMWF and GFS blended.

Started once a day at 12:00 UK time by server/patterns/index.js (or by an admin from the page):

    python engine.py <out-dir> <cache-dir>

Progress goes to stdout as lines of `@progress {json}`. Everything else is written into <out-dir>:
    building.json      the issue being made, rewritten as each week is finished, so the page can
                       show week 1 while week 2 is still being worked out
    latest.json        the last finished issue (building.json, renamed when the run completes)
    issues/<id>.json   the last 30 finished issues
    land.json          the land-sea mask the page draws its maps from (ECMWF, 0.25°)

MODELS: the newest complete 00 or 12 UTC run of each.
    ECMWF ENS    50 perturbed members, 0.25°    ECMWF open data (Google mirror, AWS fallback)
    ECMWF HRES   the main run, 0.25°            same place; it reaches 10 days, so week 1 only
    GFS          the main run, 0.25°            NOAA open data on AWS
    GEFS         control + 30 members, 0.5°     NOAA open data on AWS
Each field is cut out of the global file with an HTTP range request found from the step's index,
decoded with ecCodes and reduced to one shared 0.5° grid over the Atlantic and Europe, then cached
on disk so a run that stops halfway can carry on.

THE BLEND: every run gets a weight, so a model counts for its own share however many members it has.
    week 1   ECMWF ENS 45%, GEFS 28%, ECMWF HRES 15%, GFS 12%
    week 2   ECMWF ENS 60%, GEFS 34%, GFS 6%
ECMWF leads because it verifies best in the medium range; the main runs count for less in week 2,
where a single run has little skill left.

PATTERNS: each of a run's seven 12 UTC charts of mean sea-level pressure is named: Atlantic
westerlies, a Scandinavian high, northern blocking, a mid-Atlantic ridge, a high over the UK or
over the continent, a trough over the UK, lows to the south, or plainly by its flow (classify).
The run's week is the pattern on most of its days (week_pattern). The runs are grouped by pattern;
each week shows up to three, the likeliest first, and a pattern's chance is the summed weight of
its runs. Every pattern found is listed with its chance. It is all told week by week: the page
shows no single day.

For each scenario: its pattern chart (its runs on the days with the pattern) with its highs and
lows; each day's weather type
(Jenkinson-Collison objective Lamb type, centred on the UK); and from its runs the UK's daily
maximum and minimum temperature, rainfall, frost and wintriness, sampled at ~550 points over UK
land and compared, district by district, with the 1991-2020 normals (Met Office HadUK-Grid); wind
from the Jenkinson-Collison gale index of each run's own chart. Then it is written up in words.

Data © ECMWF, CC BY 4.0. GFS and GEFS: NOAA, public domain.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import math
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DISTRICTS = ROOT / 'public' / 'static-data' / 'uk-climate-districts.geo.json'
NORMALS = ROOT / 'server' / 'data' / 'scenarios' / 'climate-1991-2020.json'

UA = 'MyWeatherUK-selfhost/1.0 (weather patterns)'
ECMWF = ['https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com']
GFS_URL = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com'
GEFS_URL = 'https://noaa-gefs-pds.s3.amazonaws.com'

# the shared grid: 0.5°, south row first
W, E, S, N, G = -30.0, 32.0, 42.0, 74.0, 0.5
NX, NY = int(round((E - W) / G)) + 1, int(round((N - S) / G)) + 1
LATS, LONS = S + G * np.arange(NY), W + G * np.arange(NX)
# the maps on the page: every 2nd point of the shared grid (1°)
MAP = {'lon0': -28.0, 'lat0': 43.0, 'd': 1.0, 'nx': 53, 'ny': 27}
LAND = {'lon0': -28.0, 'lat0': 43.0, 'd': 0.25, 'nx': 209, 'ny': 105}
# the box a scenario's day-to-day spread is measured on: the UK and its approaches
SPREAD_BOX = (45.0, 62.0, -22.0, 10.0)
UK = (54.5, -3.5)
WEEKS = 2
KEEP_ISSUES = 30

MODELS = {
    'ens': {'name': 'ECMWF ensemble', 'short': 'ECMWF ENS', 'members': list(range(1, 51)), 'weight': (0.45, 0.60)},
    'hres': {'name': 'ECMWF main run', 'short': 'ECMWF HRES', 'members': [0], 'weight': (0.15, 0.0)},
    'gfs': {'name': 'GFS main run', 'short': 'GFS', 'members': [0], 'weight': (0.12, 0.06)},
    'gefs': {'name': 'GFS ensemble', 'short': 'GEFS', 'members': list(range(0, 31)), 'weight': (0.28, 0.34)},
}
ECMWF_PARAM = {'msl': 'msl', 'tmax3': 'mx2t3', 'tmax6': 'mx2t6', 'tmin3': 'mn2t3', 'tmin6': 'mn2t6', 'tpcum': 'tp'}
UNIT = {'msl': 'pa', 'tmax3': 'k', 'tmax6': 'k', 'tmin3': 'k', 'tmin6': 'k', 'tpcum': 'm', 'apcp6': 'mm', 'lsm': 'one'}


def unit_of(model, kind):
    """ECMWF gives rain in metres of water, NOAA in kg/m² (millimetres)."""
    return 'mm' if kind == 'tpcum' and model in ('gfs', 'gefs') else UNIT[kind]

_codes = threading.Lock()          # ecCodes is not thread-safe


def progress(**kw):
    print('@progress ' + json.dumps(kw), flush=True)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ── downloads ────────────────────────────────────────────────────────────────

def http(urls, rng=None, tries=5):
    """GET the first of `urls` that answers (mirrors), retrying; `rng` is (start, end or None)."""
    last = None
    for i in range(tries):
        missing = 0
        for u in urls:
            h = {'User-Agent': UA}
            if rng:
                h['Range'] = f'bytes={rng[0]}-{"" if rng[1] is None else rng[1]}'
            try:
                with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=90) as r:
                    data = r.read()
                if rng and rng[1] is not None and len(data) != rng[1] - rng[0] + 1:
                    raise RuntimeError('short read')
                return data
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (403, 404):
                    missing += 1
            except Exception as e:  # timeouts, resets, short reads
                last = e
        if missing == len(urls):
            break                     # not there on any mirror: retrying only wastes time
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'download failed: {urls[0]}: {last}')


def decode(msg, unit):
    """One GRIB message -> the shared 0.5° grid, in hPa / °C / mm."""
    import eccodes
    with _codes:
        h = eccodes.codes_new_from_message(msg)
        try:
            ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
            lat0 = eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees')
            lon0 = eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees')
            dx = eccodes.codes_get(h, 'iDirectionIncrementInDegrees')
            dy = eccodes.codes_get(h, 'jDirectionIncrementInDegrees')
            up = eccodes.codes_get(h, 'jScansPositively')
            v = eccodes.codes_get_values(h).reshape(nj, ni)
        finally:
            eccodes.codes_release(h)
    top = lat0 + (nj - 1) * dy if up else lat0
    if up:
        v = v[::-1]
    jj = np.rint((top - LATS) / dy).astype(int)
    ii = np.rint(((LONS - lon0) % 360) / dx).astype(int) % ni
    if jj.min() < 0 or jj.max() >= nj:
        raise RuntimeError('grid does not cover the area')
    out = v[np.ix_(jj, ii)].astype(np.float64)
    if unit == 'pa':
        out = out / 100.0
    elif unit == 'k':
        out = out - 273.15
    elif unit == 'm':
        out = out * 1000.0
    return out.astype(np.float32)


def plausible(arr, unit):
    lo, hi = float(np.nanmin(arr)), float(np.nanmax(arr))
    if not (np.isfinite(lo) and np.isfinite(hi)):
        return False
    return {'pa': (870 < lo and hi < 1085), 'k': (-75 < lo and hi < 60), 'm': (-1 < lo and hi < 3000),
            'mm': (-1 < lo and hi < 3000), 'one': (-0.01 <= lo and hi <= 1.01)}[unit]


def save(f, arr):
    tmp = f.with_name(f'{f.stem}.{os.getpid()}.{threading.get_ident()}.tmp.npy')
    np.save(tmp, arr)
    for wait in (0, 0.05, 0.2):
        time.sleep(wait)
        try:
            os.replace(tmp, f)
            return
        except OSError:
            pass
    np.save(f, arr)
    try:
        tmp.unlink()
    except OSError:
        pass


def fetch_one(job):
    """(key, urls, start, end, unit, file) -> (key, array or None, error)."""
    key, urls, start, end, unit, f = job
    try:
        arr = decode(http(urls, (start, end)), unit)
        if not plausible(arr, unit):
            raise RuntimeError('implausible values')
        save(Path(f), arr)
        return key, arr, None
    except Exception as e:
        return key, None, str(e)[:200]


def fetch_chunk(jobs):
    """One worker process's share: several downloads at once, decoded one at a time."""
    with cf.ThreadPoolExecutor(5) as ex:
        return list(ex.map(fetch_one, jobs))


# ── model runs and their indexes ─────────────────────────────────────────────

def hours(a, b):
    return int(round((a - b).total_seconds() / 3600))


class Ecmwf:
    """ENS (stream enfo) or HRES (stream oper) of one run."""

    def __init__(self, model, run):
        self.model, self.run = model, run
        self.stream = 'enfo' if model == 'ens' else 'oper'
        self.kind = 'ef' if model == 'ens' else 'fc'
        self.idx, self.lock = {}, threading.Lock()

    def path(self, step):
        r = self.run
        return f'{r:%Y%m%d}/{r:%H}z/ifs/0p25/{self.stream}/{r:%Y%m%d%H}0000-{step}h-{self.stream}-{self.kind}'

    def max_step(self):
        return 360 if self.model == 'ens' else 240

    def valid(self, s):
        return 0 <= s <= self.max_step() and ((s <= 144 and s % 3 == 0) or (s > 144 and s % 6 == 0))

    def load(self, step):
        with self.lock:
            if step in self.idx:
                return self.idx[step]
        txt = http([f'{b}/{self.path(step)}.index' for b in ECMWF]).decode()
        recs = {}
        for line in txt.splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get('param') not in ('msl', 'mx2t3', 'mx2t6', 'mn2t3', 'mn2t6', 'tp', 'lsm'):
                continue
            if r.get('levtype') not in (None, 'sfc'):
                continue
            num = int(r.get('number', 0)) if self.model == 'ens' else 0
            if self.model == 'ens' and r.get('type') != 'pf':
                continue
            recs[(r['param'], num)] = (int(r['_offset']), int(r['_length']))
        with self.lock:
            self.idx[step] = recs
        return recs

    def ready(self, last_step):
        """Is the run there all the way to `last_step`?"""
        try:
            recs = self.load(last_step)
        except RuntimeError:
            return False
        want = 50 if self.model == 'ens' else 1
        return sum(1 for (p, _) in recs if p == 'msl') >= want

    def locate(self, member, kind, step):
        param = 'lsm' if kind == 'lsm' else ECMWF_PARAM[kind]
        rec = self.load(step).get((param, member))
        if not rec:
            return None
        off, length = rec
        return [f'{b}/{self.path(step)}.grib2' for b in ECMWF], off, off + length - 1


class Noaa:
    """GFS (one run) or GEFS (control + 30 members), from their .idx files."""

    def __init__(self, model, run):
        self.model, self.run = model, run
        self.idx, self.lock = {}, threading.Lock()

    def url(self, member, step):
        r = self.run
        if self.model == 'gfs':
            return f'{GFS_URL}/gfs.{r:%Y%m%d}/{r:%H}/atmos/gfs.t{r:%H}z.pgrb2.0p25.f{step:03d}'
        name = 'gec00' if member == 0 else f'gep{member:02d}'
        return f'{GEFS_URL}/gefs.{r:%Y%m%d}/{r:%H}/atmos/pgrb2ap5/{name}.t{r:%H}z.pgrb2a.0p50.f{step:03d}'

    def max_step(self):
        return 384

    def valid(self, s):
        if self.model == 'gfs':
            return 0 <= s <= 384 and (s <= 120 or s % 3 == 0)
        return 0 <= s <= 384 and ((s <= 240 and s % 3 == 0) or s % 6 == 0)

    def load(self, member, step):
        k = (member, step)
        with self.lock:
            if k in self.idx:
                return self.idx[k]
        lines = [l for l in http([self.url(member, step) + '.idx']).decode().splitlines() if l.strip()]
        offs = [int(l.split(':')[1]) for l in lines]
        recs = []
        for i, l in enumerate(lines):
            parts = l.split(':')
            recs.append((parts[3], parts[4], parts[5], offs[i], offs[i + 1] - 1 if i + 1 < len(offs) else None))
        with self.lock:
            self.idx[k] = recs
        return recs

    def ready(self, last_step):
        try:
            recs = self.load(self.members()[-1], last_step)
        except RuntimeError:
            return False
        return any(v == 'PRMSL' for v, *_ in recs)

    def members(self):
        return MODELS[self.model]['members']

    def locate(self, member, kind, step):
        want = {
            'msl': lambda v, lev, t: v == 'PRMSL' and lev == 'mean sea level',
            'tmax6': lambda v, lev, t: v == 'TMAX' and lev == '2 m above ground' and t.startswith(f'{step - 6}-{step} hour max'),
            'tmin6': lambda v, lev, t: v == 'TMIN' and lev == '2 m above ground' and t.startswith(f'{step - 6}-{step} hour min'),
            # a total from the start that is a whole number of days is written in days ("0-2 day acc")
            'tpcum': lambda v, lev, t: v == 'APCP' and lev == 'surface' and (
                t.startswith(f'0-{step} hour acc') or (step % 24 == 0 and t.startswith(f'0-{step // 24} day acc'))),
            'apcp6': lambda v, lev, t: v == 'APCP' and lev == 'surface' and t.startswith(f'{step - 6}-{step} hour acc'),
        }[kind]
        for v, lev, t, start, end in self.load(member, step):
            if want(v, lev, t):
                return [self.url(member, step)], start, end
        return None


def pick_runs(now):
    """The newest ECMWF run that reaches the end of week 2, then GFS and GEFS runs as close to it
    as possible (the same cycle, or up to a day older)."""
    t = now.replace(minute=0, second=0, microsecond=0, hour=12 if now.hour >= 12 else 0)
    for k in range(6):
        run = t - timedelta(hours=12 * k)
        if now - run < timedelta(hours=6, minutes=30):
            continue                      # still being published
        first = datetime.combine(run.date() + timedelta(days=1), datetime.min.time(), timezone.utc)
        last = first + timedelta(days=7 * WEEKS)
        ens = Ecmwf('ens', run)
        if not ens.ready(hours(last, run)):
            continue
        hres = Ecmwf('hres', run)
        runs = {'ens': ens, 'hres': hres if hres.ready(hours(first + timedelta(days=7), run)) else None}
        for m in ('gfs', 'gefs'):
            runs[m] = None
            for back in range(0, 4):
                r = run - timedelta(hours=6 * back)
                src = Noaa(m, r)
                if hours(last, r) <= 384 and src.ready(hours(last, r) - hours(last, r) % 6):
                    runs[m] = src
                    break
        return run, first, runs
    raise RuntimeError('no ECMWF ensemble run reaching two weeks ahead is available yet')


# ── what each model is asked for ─────────────────────────────────────────────

def day_plan(src, day):
    """[(field, [(kind, step), ...])] for one day: the 12 UTC chart, the 12-18 UTC maximum, the
    00-06 UTC minimum and the day's rain (00-24 UTC)."""
    t0 = datetime.combine(day, datetime.min.time(), timezone.utc)
    s = lambda h: hours(t0 + timedelta(hours=h), src.run)
    ec = isinstance(src, Ecmwf)
    if ec:
        tmax = [('tmax3', s(15)), ('tmax3', s(18))] if s(18) <= 144 else [('tmax6', s(18))]
        tmin = [('tmin3', s(3)), ('tmin3', s(6))] if s(6) <= 144 else [('tmin6', s(6))]
    else:
        tmax, tmin = [('tmax6', s(18))], [('tmin6', s(6))]
    if src.model == 'gefs':
        rain = [('apcp6', s(h)) for h in (6, 12, 18, 24)]
    else:
        rain = [('tpcum', s(0)), ('tpcum', s(24))]
    plan = [('msl', [('msl', s(12))]), ('tmax', tmax), ('tmin', tmin), ('rain', rain)]
    for _, parts in plan:
        for kind, step in parts:
            if not src.valid(step):
                return None
    return plan


def gather(srcs, days, cache, week, base_pct, span_pct):
    """Download (or load from cache) every field the week needs. -> {(model, member, kind, step): array}"""
    wanted = set()
    for m, src in srcs.items():
        for d in days:
            plan = day_plan(src, d)
            if plan is None:
                continue
            for _, parts in plan:
                for kind, step in parts:
                    for mem in MODELS[m]['members']:
                        wanted.add((m, mem, kind, step))
    out, todo = {}, []
    for key in sorted(wanted):
        m, mem, kind, step = key
        f = cache / f'{m}{srcs[m].run:%Y%m%d%H}' / f'{mem:02d}' / f'{kind}_{step:03d}.npy'
        if f.exists():
            try:
                out[key] = np.load(f)
                continue
            except (OSError, ValueError):
                pass
        todo.append((key, f))
    log(f'week {week}: {len(wanted)} fields, {len(todo)} to fetch')

    # the indexes first, all at once (one per step for ECMWF and GFS, one per member and step for GEFS)
    need_idx = sorted({(k[0], k[1] if k[0] == 'gefs' else 0, k[3]) for k, _ in todo})

    def load_idx(t):
        m, mem, step = t
        try:
            if isinstance(srcs[m], Ecmwf):
                srcs[m].load(step)
            else:
                srcs[m].load(mem, step)
        except RuntimeError as e:
            log(f'index missing: {m} {mem} T+{step}: {e}')
    with cf.ThreadPoolExecutor(16) as ex:
        list(ex.map(load_idx, need_idx))

    jobs, failed = [], 0
    for key, f in todo:
        m, mem, kind, step = key
        try:
            loc = srcs[m].locate(mem, kind, step)
        except RuntimeError:
            loc = None
        if not loc:
            failed += 1
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        jobs.append((key, loc[0], loc[1], loc[2], unit_of(m, kind), str(f)))
    if failed:
        log(f'week {week}: {failed} fields not in the indexes')
    if jobs:
        chunks = [jobs[i:i + 24] for i in range(0, len(jobs), 24)]
        done = 0
        workers = max(1, min(3, (os.cpu_count() or 4) - 1))      # light on CPU: the site shares this PC
        with cf.ProcessPoolExecutor(workers) as ex:
            futs = [ex.submit(fetch_chunk, c) for c in chunks]
            for fut in cf.as_completed(futs):
                for key, arr, err in fut.result():
                    done += 1
                    if arr is not None:
                        out[key] = arr
                    else:
                        log(f'failed {key}: {err}')
                progress(stage='download', week=week, done=done, of=len(jobs),
                         pct=round(base_pct + span_pct * done / len(jobs), 1))
    return out


# ── UK points, districts and normals ─────────────────────────────────────────

def inside(px, py, ring):
    x, y = ring[:, 0], ring[:, 1]
    res = np.zeros(len(px), bool)
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    for xa, ya, xb, yb in zip(x, y, x2, y2):
        c = ((ya > py) != (yb > py))
        if c.any():
            xi = xa + (py - ya) * (xb - xa) / (yb - ya + 1e-12)
            res ^= c & (px < xi)
    return res


def uk_points():
    """Points 0.25° apart over UK land, each with its climate district."""
    gj = json.loads(DISTRICTS.read_text(encoding='utf-8'))
    la, lo = np.meshgrid(np.arange(49.875, 61.0, 0.25), np.arange(-8.375, 2.0, 0.25), indexing='ij')
    px, py = lo.ravel(), la.ravel()
    dist = np.full(len(px), -1)
    names = []
    for k, f in enumerate(gj['features']):
        names.append(f['properties']['id'])
        geom = f['geometry']
        polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
        hit = np.zeros(len(px), bool)
        for poly in polys:
            ring = np.array(poly[0], float)
            box = (px >= ring[:, 0].min()) & (px <= ring[:, 0].max()) & (py >= ring[:, 1].min()) & (py <= ring[:, 1].max())
            if not box.any():
                continue
            sel = np.where(box)[0]
            inn = inside(px[sel], py[sel], ring)
            for hole in poly[1:]:
                inn &= ~inside(px[sel], py[sel], np.array(hole, float))
            hit[sel[inn]] = True
        dist[(dist < 0) & hit] = k
    keep = dist >= 0
    return py[keep], px[keep], dist[keep], names


class Sampler:
    """Bilinear samples of shared-grid fields at fixed points."""

    def __init__(self, lat, lon):
        fx, fy = (lon - W) / G, (lat - S) / G
        self.i, self.j = np.floor(fx).astype(int), np.floor(fy).astype(int)
        self.u, self.v = fx - self.i, fy - self.j

    def __call__(self, f):
        i, j, u, v = self.i, self.j, self.u, self.v
        return (f[j, i] * (1 - u) * (1 - v) + f[j, i + 1] * u * (1 - v) + f[j + 1, i] * (1 - u) * v + f[j + 1, i + 1] * u * v)


def month_normal(months, d, total=False):
    """A monthly normal, linearly interpolated between month middles; `total` turns monthly totals
    into a daily amount first."""
    def mid(y, m):
        m0 = date(y + (m - 1) // 12, (m - 1) % 12 + 1, 1)
        m1 = date(m0.year + (m0.month // 12), m0.month % 12 + 1, 1)
        val = months[m0.month - 1] / ((m1 - m0).days if total else 1)
        return m0 + (m1 - m0) / 2, val
    pts = [mid(d.year, d.month + k) for k in (-1, 0, 1)]
    for (a, va), (b, vb) in zip(pts, pts[1:]):
        if a <= d <= b:
            return va + (vb - va) * ((d - a).days / max(1, (b - a).days))
    return pts[1][1]


# ── weather types ────────────────────────────────────────────────────────────

def bilinear(f, lat, lon):
    fx, fy = (lon - W) / G, (lat - S) / G
    i, j = int(fx), int(fy)
    u, v = fx - i, fy - j
    return float(f[j, i] * (1 - u) * (1 - v) + f[j, i + 1] * u * (1 - v) + f[j + 1, i] * (1 - u) * v + f[j + 1, i + 1] * u * v)


JC_POINTS = {1: (65, -10), 2: (65, 0), 3: (60, -20), 4: (60, -10), 5: (60, 0), 6: (60, 10), 7: (55, -20), 8: (55, -10),
             9: (55, 0), 10: (55, 10), 11: (50, -20), 12: (50, -10), 13: (50, 0), 14: (50, 10), 15: (45, -10), 16: (45, 0)}
COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']


def weather_type(f):
    """Jenkinson-Collison classification for the British Isles (Jones, Hulme & Briffa 1993):
    flow strength F, vorticity Z, gale index G and the objective Lamb type."""
    p = {k: bilinear(f, la, lo) for k, (la, lo) in JC_POINTS.items()}
    w = 0.5 * (p[12] + p[13]) - 0.5 * (p[4] + p[5])
    s = 1.74 * (0.25 * (p[5] + 2 * p[9] + p[13]) - 0.25 * (p[4] + 2 * p[8] + p[12]))
    zw = 1.07 * (0.5 * (p[15] + p[16]) - 0.5 * (p[8] + p[9])) - 0.95 * (0.5 * (p[8] + p[9]) - 0.5 * (p[1] + p[2]))
    zs = 1.52 * (0.25 * (p[6] + 2 * p[10] + p[14]) - 0.25 * (p[5] + 2 * p[9] + p[13])
                 - 0.25 * (p[4] + 2 * p[8] + p[12]) + 0.25 * (p[3] + 2 * p[7] + p[11]))
    F, Z = math.hypot(w, s), zw + zs
    frm = (math.degrees(math.atan2(-w, -s)) + 360) % 360
    d = COMPASS[int(((frm + 22.5) % 360) // 45)]
    if F < 6 and abs(Z) < 6:
        t = 'U'
    elif abs(Z) < F:
        t = d
    elif abs(Z) > 2 * F:
        t = 'C' if Z > 0 else 'A'
    else:
        t = ('C' if Z > 0 else 'A') + d
    return {'type': t, 'dir': d, 'from': round(frm), 'F': round(F, 1), 'Z': round(Z, 1), 'G': round(math.hypot(F, 0.5 * Z), 1)}


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(min(1.0, math.sqrt(h)))


def false_centre(t, lat, lon):
    """Sea-level pressure reduced over high ground and ice makes centres that are not there."""
    if 43.5 < lat < 48.5 and 5 < lon < 17:
        return True                                   # the Alps
    if t == 'H' and lat > 62.5 and lon < -21.5:
        return True                                   # the Greenland ice sheet's edge
    return False


def centres(f, win=8):
    """Highs and lows on a chart: strict local extremes in a ~8° box, in and near the map."""
    out = []
    lo0, lo1 = MAP['lon0'] - 2, MAP['lon0'] + (MAP['nx'] - 1) * MAP['d'] + 2
    la0, la1 = MAP['lat0'] - 1, MAP['lat0'] + (MAP['ny'] - 1) * MAP['d'] + 1
    for j in range(1, NY - 1):
        lat = S + j * G
        if not (la0 <= lat <= la1):
            continue
        for i in range(1, NX - 1):
            lon = W + i * G
            if not (lo0 <= lon <= lo1):
                continue
            box = f[max(0, j - win):j + win + 1, max(0, i - win):i + win + 1]
            v = f[j, i]
            if v == box.min() and v < 1010:
                t = 'L'
            elif v == box.max() and v > 1020:
                t = 'H'
            else:
                continue
            if not false_centre(t, lat, lon):
                out.append({'t': t, 'lat': lat, 'lon': lon, 'p': int(round(float(v)))})
    return out


def main_centre(cs, t):
    """The high or low that matters for the UK: the strongest, with distance counted against it."""
    pool = [c for c in cs if c['t'] == t and km((c['lat'], c['lon']), UK) < 2600]
    if not pool:
        return None
    if t == 'L':
        return min(pool, key=lambda c: c['p'] + 0.008 * km((c['lat'], c['lon']), UK))
    return max(pool, key=lambda c: c['p'] - 0.008 * km((c['lat'], c['lon']), UK))


# ── named patterns ───────────────────────────────────────────────────────────
# A run's week is named from its average chart over the seven days: where the high and the low
# sit around the UK and the flow they make, in the terms forecasters use for the North Atlantic
# and European patterns (Atlantic westerlies, blocking highs to the north or over Scandinavia, a
# mid-Atlantic ridge, a high over the UK or the continent, a trough over the UK).

def box(f, la0, la1, lo0, lo1):
    j0, j1 = int(round((la0 - S) / G)), int(round((la1 - S) / G)) + 1
    i0, i1 = int(round((lo0 - W) / G)), int(round((lo1 - W) / G)) + 1
    return float(f[j0:j1, i0:i1].mean())


PATTERNS = {
    'stormy_westerlies': ('Stormy westerlies', 'A deep low near Iceland and high pressure to the south drive a strong westerly jet straight at the UK: one low after another.'),
    'westerlies': ('Atlantic westerlies', 'Low pressure to the north-west and high pressure to the south set up a westerly flow off the Atlantic: weather systems move through in turn.'),
    'uk_trough': ('Trough over the UK', 'Low pressure sits over or close to the UK for much of the week, so the weather stays unsettled.'),
    'scandi_high': ('Scandinavian high', 'A blocking high over Scandinavia holds the Atlantic at bay and turns the flow easterly or south-easterly.'),
    'northern_block': ('Northern blocking', 'High pressure to the north, around Iceland and the Norwegian Sea, with lows pushed south: a northerly or easterly flow.'),
    'atlantic_ridge': ('Mid-Atlantic ridge', 'High pressure out in the Atlantic, west of the UK, with lower pressure over Scandinavia: a northerly or north-westerly flow.'),
    'uk_high': ('High over the UK', 'High pressure is centred over or right next to the UK, so the week is mostly settled.'),
    'euro_high': ('High over the continent', 'High pressure over central Europe holds weather fronts out to the west: a southerly or south-westerly flow.'),
    'southern_track': ('Lows to the south', 'Lows take a southern track towards France and Iberia, with higher pressure to the north.'),
    'westerly': ('Westerly flow', 'A westerly flow, without strong highs or lows close by.'),
    'northwesterly': ('North-westerly flow', 'A north-westerly flow brings cooler air down from the north-west.'),
    'northerly': ('Northerly flow', 'A northerly flow brings cold air down from the Arctic.'),
    'easterly': ('Easterly flow', 'An easterly flow brings air in from the continent.'),
    'southerly': ('Southerly flow', 'A southerly flow brings air up from the south.'),
    'southwesterly': ('South-westerly flow', 'A south-westerly flow brings mild air in from the Atlantic.'),
    'slack': ('Slack pattern', 'No strong highs or lows near the UK and little flow: light winds, the weather decided locally.'),
}
# patterns counted together when the runs are grouped (a stormy week and a plain westerly flow are
# both the westerly pattern; the scenario is called stormy when most of its weight is)
FAMILY = {'stormy_westerlies': 'westerlies', 'westerly': 'westerlies'}


def classify(f):
    """The named pattern of an average chart (hPa on the shared grid) -> {'key', 'name', ...}."""
    pI = box(f, 62, 68, -28, -12)        # Iceland
    pA = box(f, 42, 46, -30, -12)        # the northern flank of the Azores high
    pS = box(f, 58, 68, 8, 30)           # Scandinavia
    pN = box(f, 64, 72, -10, 12)         # the Norwegian Sea
    pM = box(f, 46, 60, -30, -17)        # the Atlantic west of Ireland
    pU = box(f, 50, 59, -8, 2)           # the UK
    pC = box(f, 45, 54, 6, 22)           # central Europe
    pB = box(f, 42, 48, -12, 2)          # Biscay and northern Iberia
    jc = weather_type(f)
    d, F, Z = jc['dir'], jc['F'], jc['Z']
    nao = pA - pI                        # an Azores-Iceland pressure difference, as the NAO
    north = max(pI, pN)
    if pS >= 1020 and pS - pM >= 5 and pS >= pU + 2 and d in ('E', 'SE', 'S', 'NE'):
        key = 'scandi_high'
    elif north >= 1016 and north - pB >= 5 and nao < 4:
        key = 'northern_block'
    elif pU >= 1021 and pU >= max(pS, pM, pC) - 1.5 and Z < 0:
        key = 'uk_high'
    elif pM >= 1020 and pM - pS >= 6 and pM >= pU + 2 and d in ('N', 'NW', 'NE', 'W'):
        key = 'atlantic_ridge'
    elif pC >= 1020 and pC - pU >= 3 and pC - pM >= 3 and d in ('S', 'SW', 'SE'):
        key = 'euro_high'
    elif pU <= 1006 and (Z >= 6 or jc['type'].startswith('C')):
        key = 'uk_trough'
    elif nao >= 14 and d in ('W', 'SW', 'NW') and F >= 8:
        key = 'stormy_westerlies' if (F >= 18 or (pI <= 992 and nao >= 24)) else 'westerlies'
    elif pB <= pU - 4 and pB <= north - 6 and d in ('E', 'NE', 'SE', 'N'):
        key = 'southern_track'
    elif F < 5 and abs(Z) < 6:
        key = 'slack'
    else:
        key = {'W': 'westerly', 'NW': 'northwesterly', 'N': 'northerly', 'NE': 'easterly', 'E': 'easterly',
               'SE': 'southerly', 'S': 'southerly', 'SW': 'southwesterly'}[d]
    return {'key': key, 'name': PATTERNS[key][0], 'nao': round(nao, 1), 'uk': round(pU, 1), 'dir': d, 'F': F, 'Z': Z,
            'boxes': {k: round(v, 1) for k, v in dict(I=pI, A=pA, S=pS, N=pN, M=pM, U=pU, C=pC, B=pB).items()}}


def week_pattern(msl):
    """A run's pattern for the week: the one on most of its days (a stormy and a plain westerly day
    count alike, and the week is stormy when at least half of those days are). A tie goes to the one
    the week settles into, the later. -> (pattern, each day's pattern family)"""
    keys = [classify(f)['key'] for f in msl]
    fams = [FAMILY.get(k, k) for k in keys]
    n = {k: fams.count(k) for k in fams}
    best = [k for k in n if n[k] == max(n.values())]
    top = max(best, key=lambda k: max(i for i, x in enumerate(fams) if x == k))
    if top == 'westerlies' and 2 * keys.count('stormy_westerlies') >= n[top]:
        return 'stormy_westerlies', fams
    return top, fams


# ── grouping the runs ────────────────────────────────────────────────────────

# ── words ────────────────────────────────────────────────────────────────────

REGION = {
    'England_SE_and_Central_S': 'south-east and central southern England', 'England_SW_and_S_Wales': 'south-west England and south Wales',
    'East_Anglia': 'East Anglia', 'Midlands': 'the Midlands', 'England_E_and_NE': 'eastern and north-east England',
    'England_NW_and_N_Wales': 'north-west England and north Wales', 'Scotland_N': 'northern Scotland',
    'Scotland_E': 'eastern Scotland', 'Scotland_W': 'western Scotland', 'Northern_Ireland': 'Northern Ireland',
}
FLOW = {'N': 'northerly', 'NE': 'north-easterly', 'E': 'easterly', 'SE': 'south-easterly', 'S': 'southerly',
        'SW': 'south-westerly', 'W': 'westerly', 'NW': 'north-westerly'}
DIR_WORD = {'N': 'north', 'NE': 'north-east', 'E': 'east', 'SE': 'south-east', 'S': 'south', 'SW': 'south-west', 'W': 'west', 'NW': 'north-west'}


def cap(s):
    return s[:1].upper() + s[1:] if s else s


def listing(xs):
    xs = [x for x in xs if x]
    return xs[0] if len(xs) == 1 else ', '.join(xs[:-1]) + ' and ' + xs[-1] if xs else ''


def where(c):
    """Where a high or low sits, as seen from the UK."""
    lat, lon = c['lat'], c['lon']
    d = km((lat, lon), UK)
    if d < 450:
        return 'over the UK'
    if c['t'] == 'L' and lat > 61 and -28 < lon < -8:
        return 'near Iceland'
    if lat > 57.5 and 5 < lon < 30:
        return 'over Scandinavia'
    if 43 < lat < 51 and -5 < lon < 9:
        return 'over France'
    if 46 < lat < 56 and 6 < lon < 25:
        return 'over central Europe'
    if lon < -18 and 42 < lat < 58:
        return 'out in the Atlantic'
    b = (math.degrees(math.atan2(math.radians(lon - UK[1]) * math.cos(math.radians(UK[0])), math.radians(lat - UK[0]))) + 360) % 360
    side = DIR_WORD[COMPASS[int(((b + 22.5) % 360) // 45)]]
    return f'close to the {side}' if d < 1100 else f'to the {side}'


def regime(day):
    t, rain = day['type'], day['rain']
    cyc, anti = t.startswith('C'), t.startswith('A')
    if rain >= 3.5 or (cyc and rain >= 1):
        return 'unsettled'
    if rain < 1 and (anti or day['Z'] < -4 or day['G'] < 12):
        return 'settled'
    if cyc:
        return 'unsettled'
    if anti:
        return 'settled'
    return 'changeable'


def describe(days, charts_c, normals, month_word, warm_season):
    """Chips and the write-up of one scenario's week, as a whole: no single day is named (the page
    puts the pattern's own sentence first)."""
    for d in days:
        d['regime'] = regime(d)
    n = len(days)

    # rain
    total = float(sum(d['rain'] for d in days))
    pct = 100 * total / max(0.1, normals['rain'])
    reg = normals['regionRain']                      # {district: week total}
    wettest = max(reg, key=reg.get)
    lo, hi = min(reg.values()), max(reg.values())
    word = ('Very dry for the time of year' if pct < 35 else 'Drier than normal' if pct < 70 else
            'Near-normal rainfall' if pct < 130 else 'Wetter than normal' if pct < 200 else 'A very wet week')
    if hi < 3:
        s2 = f'{word}, with little or no rain for most.'
    elif hi - lo < 4:
        s2 = f'{word}: around {round(total)} mm through the week for most.'
    else:
        s2 = f'{word}, with {round(lo)}–{round(hi)} mm through the week, most in {REGION.get(wettest, wettest)}.'

    # wind
    gi = max(range(n), key=lambda i: (days[i]['G'], days[i]['gale']))
    gd = days[gi]
    exposed = {'N': 'in the north and down eastern coasts', 'NE': 'down eastern coasts', 'E': 'in the south and east',
               'SE': 'in the south and west', 'S': 'in the west', 'SW': 'in the north and west', 'W': 'in the north and west',
               'NW': 'in the north and west'}[gd['dir']]
    if gd['G'] >= 30 or gd['gale'] >= 0.4:
        low = main_centre(charts_c[gi], 'L')
        deep = f', as a deep low ({low["p"]} hPa) sits {where(low)}' if low and low['p'] <= 985 else ''
        s3 = f'Gales are possible at times, especially {exposed}{deep}.'
    elif gd['G'] >= 22:
        s3 = f'Windy at times, especially {exposed}.'
    elif gd['G'] >= 14:
        s3 = 'Breezy at times.'
    else:
        s3 = 'Winds are mostly light.'

    # temperature
    amax = float(np.mean([d['tmaxAnom'] for d in days]))
    amin = float(np.mean([d['tminAnom'] for d in days]))
    mild, coldw = ('warm', 'cool') if warm_season else ('mild', 'cold')
    tword = (f'well above normal' if amax >= 3 else 'above normal' if amax >= 1.2 else 'close to normal' if amax > -1.2
             else 'below normal' if amax > -3 else 'well below normal')
    hl = normals['regionHigh']
    h_lo, h_hi = round(min(hl.values())), round(max(hl.values()))
    highs = f'highs around {h_lo}°C' if h_lo == h_hi else f'highs of {h_lo}–{h_hi}°C'
    s4 = f'Temperatures {tword} for {month_word}, with {highs}'
    early = float(np.mean([d['tmaxAnom'] for d in days[:3]]))
    late = float(np.mean([d['tmaxAnom'] for d in days[-3:]]))
    if late - early >= 2.5:
        s4 += ', turning milder later' if not warm_season else ', turning warmer later'
    elif early - late >= 2.5:
        s4 += ', turning colder later'
    frost = float(np.mean([d['frost'] for d in days]))
    settled_share = sum(1 for d in days if d['regime'] == 'settled') / n
    if frost >= 0.3:
        s4 += '; frost on many nights'
    elif frost >= 0.08:
        s4 += '; a touch of frost in places'
    elif amin >= 2:
        s4 += f'; {mild} nights'
    fog_season = not warm_season
    if fog_season and settled_share >= 0.5 and max(d['G'] for d in days) < 20:
        s4 += ', and fog patches could be slow to clear'
    s4 += '.'
    wint = max(d['wintry'] for d in days)
    s5 = ''
    if wint >= 0.15:
        s5 = 'Snow is possible at times, mostly in the north and over hills.'
    elif wint >= 0.04:
        s5 = 'Some showers could be wintry, mainly over northern hills.'

    chips = [
        'Very wet' if pct >= 200 else 'Wet' if pct >= 130 else 'Changeable' if pct >= 70 else 'Mostly dry' if pct >= 35 else 'Dry',
        'Gales' if (gd['G'] >= 30 or gd['gale'] >= 0.4) else 'Windy' if gd['G'] >= 22 else 'Breezy' if gd['G'] >= 14 else 'Light winds',
        (cap(mild) if amax >= 1.2 else 'Near normal' if amax > -1.2 else cap(coldw)) + (' · frosty nights' if frost >= 0.3 else ''),
    ]
    text = ' '.join(x for x in (s2, s3, s4, s5) if x)
    return chips, text


def support_line(mix):
    parts = []
    for m in ('ens', 'gefs'):
        x = mix.get(m)
        if x and x['of']:
            parts.append(f'{x["n"]} of {x["of"]} {MODELS[m]["name"]} runs')
    mains = [MODELS[m]['name'] for m in ('hres', 'gfs') if mix.get(m) and mix[m]['n']]
    s = 'Backed by ' + (listing(parts) if parts else 'no ensemble runs')
    if mains:
        s += f', plus the {listing(mains)}' if len(mains) == 1 else f', plus both main runs ({listing(mains)})'
    return s + '.'


# ── one week ─────────────────────────────────────────────────────────────────

def build_week(wk, days, runs, cache, pts, base_pct, span_pct):
    srcs = {m: r for m, r in runs.items() if r is not None and MODELS[m]['weight'][wk - 1] > 0}
    fields = gather(srcs, days, cache, wk, base_pct, span_pct)
    lat, lon, dist, names = pts
    sample = Sampler(lat, lon)
    coslat = np.cos(np.radians(lat))
    wpt = coslat / coslat.sum()

    # every run's week: charts, and its UK weather at the points
    members = []
    for m, src in srcs.items():
        plans = [day_plan(src, d) for d in days]
        if any(p is None for p in plans):
            log(f'{m}: run does not cover week {wk}')
            continue
        for mem in MODELS[m]['members']:
            try:
                msl, tmax, tmin, rain = [], [], [], []
                for plan in plans:
                    got = {name: [fields[(m, mem, k, s)] for k, s in parts] for name, parts in plan}
                    msl.append(got['msl'][0])
                    tmax.append(sample(np.maximum.reduce(got['tmax'])))
                    tmin.append(sample(np.minimum.reduce(got['tmin'])))
                    r = got['rain']
                    rr = np.sum(r, axis=0) if m == 'gefs' else r[1] - r[0]
                    rain.append(np.clip(sample(rr), 0, None))
            except KeyError:
                continue                               # a field this run is missing: leave the run out
            members.append({'model': m, 'member': mem, 'msl': np.stack(msl), 'tmax': np.stack(tmax),
                            'tmin': np.stack(tmin), 'rain': np.stack(rain)})
    if len(members) < 12:
        raise RuntimeError(f'week {wk}: only {len(members)} model runs could be read')

    # weights: each model's share, split between its runs
    present = {}
    for x in members:
        present[x['model']] = present.get(x['model'], 0) + 1
    share = {m: MODELS[m]['weight'][wk - 1] for m in present}
    tot = sum(share.values())
    w = np.array([share[x['model']] / tot / present[x['model']] for x in members])

    progress(stage='cluster', week=wk, pct=round(base_pct + span_pct, 1))
    la0, la1, lo0, lo1 = SPREAD_BOX
    j0, j1 = int((la0 - S) / G), int((la1 - S) / G) + 1
    i0, i1 = int((lo0 - W) / G), int((lo1 - W) / G) + 1
    X = np.stack([x['msl'][:, j0:j1:2, i0:i1:2].reshape(-1) for x in members]).astype(np.float64)

    # every run's week named by the pattern on most of its days, and the runs grouped by pattern: up
    # to three patterns with at least 8% of the weight and four runs, likeliest first; when only one
    # pattern gets there, the next one (three runs or more) is shown beside it as the alternative
    named, day_fams = zip(*[week_pattern(x['msl']) for x in members])
    fam = np.array([FAMILY.get(k, k) for k in named])
    weight_of = {k: float(w[fam == k].sum()) for k in sorted(set(fam.tolist()))}
    order = sorted(weight_of, key=lambda k: -weight_of[k])
    groups = [k for k in order if weight_of[k] >= 0.08 and (fam == k).sum() >= 4][:3]
    if len(groups) < 2:
        groups += [k for k in order if k not in groups and (fam == k).sum() >= 3][:2 - len(groups)]
    groups = groups or order[:1]

    # normals at every point for every day
    nm = json.loads(NORMALS.read_text(encoding='utf-8'))['series']
    nmax = np.array([[month_normal(nm[names[k]]['vars']['Tmax']['months'], d) for k in dist] for d in days])
    nmin = np.array([[month_normal(nm[names[k]]['vars']['Tmin']['months'], d) for k in dist] for d in days])
    nrain = np.array([[month_normal(nm[names[k]]['vars']['Rainfall']['months'], d, total=True) for k in dist] for d in days])
    mid = days[len(days) // 2]
    part = 'early' if mid.day <= 10 else 'mid' if mid.day <= 20 else 'late'
    month_word = f'{part} {mid:%B}'
    warm_season = mid.month in (5, 6, 7, 8, 9)

    scen = []
    for key in groups:
        idx = np.where(fam == key)[0]
        cw = w[idx] / w[idx].sum()
        stormy = sum(c for c, i in zip(cw, idx) if named[i] == 'stormy_westerlies')
        pkey = 'stormy_westerlies' if key == 'westerlies' and stormy >= 0.5 else key
        stack = lambda key: np.stack([members[i][key] for i in idx])
        msl, tmax, tmin, rain = stack('msl'), stack('tmax'), stack('tmin'), stack('rain')
        avg = lambda a: np.tensordot(cw, a, axes=1)
        chart = avg(msl)                                   # (7, NY, NX)
        tmax_m, tmin_m, rain_m = avg(tmax), avg(tmin), avg(rain)   # (7, P)
        frost = avg((tmin < 0).astype(np.float64)) @ wpt
        wintry = avg(((rain >= 1) & (tmax <= 2.5)).astype(np.float64)) @ wpt
        cover = avg((rain >= 1).astype(np.float64)) @ wpt
        per_run = [[weather_type(msl[r, d]) for d in range(len(days))] for r in range(len(idx))]
        spread = float(np.sqrt(np.tensordot(cw, ((X[idx] - np.average(X[idx], axis=0, weights=cw)) ** 2).mean(1), axes=1)))
        mix = {}
        for m in MODELS:
            n_all = sum(1 for x in members if x['model'] == m)
            n_in = sum(1 for i in idx if members[i]['model'] == m)
            if n_all:
                mix[m] = {'n': n_in, 'of': n_all, 'share': round(float(sum(w[i] for i in idx if members[i]['model'] == m) / w[idx].sum()), 3)}
        # the pattern's own chart: its runs' charts on the days that have the pattern, averaged (the
        # week's average would mix in the days before it sets in), and how many days it holds
        on = np.array([[f == key for f in day_fams[i]] for i in idx], float)          # (runs, 7)
        dw = cw[:, None] * on
        week_chart = np.tensordot(dw.ravel(), msl.reshape(-1, *msl.shape[2:]), axes=1) / dw.sum()
        week_cs = centres(week_chart)
        held = float(cw @ on.sum(1))
        day_out, charts_c = [], []
        for d in range(len(days)):
            jc = weather_type(chart[d])
            g_runs = np.array([per_run[r][d]['G'] for r in range(len(idx))])
            cs = centres(chart[d])
            charts_c.append(cs)
            day_out.append({
                'date': days[d], 'type': jc['type'], 'dir': jc['dir'], 'from': jc['from'], 'F': jc['F'], 'Z': jc['Z'],
                'G': round(float(cw @ g_runs), 1), 'gale': round(float(cw @ (g_runs >= 30)), 2),
                'tmax': round(float(tmax_m[d] @ wpt), 1), 'tmin': round(float(tmin_m[d] @ wpt), 1),
                'tmaxAnom': round(float((tmax_m[d] - nmax[d]) @ wpt), 1), 'tminAnom': round(float((tmin_m[d] - nmin[d]) @ wpt), 1),
                'rain': round(float(rain_m[d] @ wpt), 1), 'cover': round(float(cover[d]), 2),
                'frost': round(float(frost[d]), 2), 'wintry': round(float(wintry[d]), 2),
            })
        # district totals and highs for the week
        reg_rain, reg_high = {}, {}
        for k in sorted(set(dist.tolist())):
            sel = dist == k
            reg_rain[names[k]] = float(rain_m[:, sel].sum(0).mean())
            reg_high[names[k]] = float(tmax_m[:, sel].mean())
        normals = {'rain': float((nrain @ wpt).sum()), 'regionRain': reg_rain, 'regionHigh': reg_high}
        chips, text = describe(day_out, charts_c, normals, month_word, warm_season)
        wdisp = week_chart[2:2 + 2 * MAP['ny']:2, 4:4 + 2 * MAP['nx']:2]
        for d in day_out:
            d['date'] = d['date'].isoformat()
        scen.append({
            'weight': float(w[idx].sum()), 'runs': int(len(idx)), 'pattern': pkey, 'title': PATTERNS[pkey][0],
            'about': PATTERNS[pkey][1], 'chips': chips, 'description': text,
            'weekMsl': [round(float(v), 1) for v in wdisp.ravel()], 'weekCentres': week_cs, 'patternDays': round(held, 1),
            'support': support_line(mix), 'mix': mix, 'spread': round(spread, 1),
            'week': {'rain': round(float(sum(d['rain'] for d in day_out)), 1),
                     'rainNormal': round(normals['rain'], 1),
                     'rainRegions': {k: round(v, 1) for k, v in reg_rain.items()},
                     'highRegions': {k: round(v, 1) for k, v in reg_high.items()},
                     'tmaxAnom': round(float(np.mean([d['tmaxAnom'] for d in day_out])), 1),
                     'tminAnom': round(float(np.mean([d['tminAnom'] for d in day_out])), 1),
                     'galeDays': sum(1 for d in day_out if d['gale'] >= 0.4 or d['G'] >= 30),
                     'frostNights': sum(1 for d in day_out if d['frost'] >= 0.3)},
            'days': day_out,
        })
    scen.sort(key=lambda s: -s['weight'])
    pct = [int(round(100 * s['weight'])) for s in scen]   # each pattern's own chance: the rest is in `patterns`
    for k, (s, p) in enumerate(zip(scen, pct)):
        s['rank'], s['chance'] = k + 1, p
        if k == 0:
            s['likelihood'] = 'Most likely' if len(pct) < 2 or p - pct[1] >= 6 else 'Marginally favoured'
        else:
            s['likelihood'] = 'Possible' if p >= 20 else 'Less likely'
        del s['weight']
    counts = {m: present.get(m, 0) for m in MODELS}
    patterns = [{'key': k, 'name': PATTERNS[k][0], 'chance': round(100 * weight_of[k], 1), 'runs': int((fam == k).sum()),
                 'shown': k in groups} for k in order]
    return {'n': wk, 'start': days[0].isoformat(), 'end': days[-1].isoformat(), 'runs': len(members),
            'models': {m: {'runs': counts[m], 'weight': round(share.get(m, 0) / tot, 3)} for m in MODELS if counts[m]},
            'patterns': patterns, 'scenarios': scen}


# ── output ───────────────────────────────────────────────────────────────────

def write_json(f, obj):
    tmp = f.with_name(f.name + f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(obj, separators=(',', ':'), default=str), encoding='utf-8')
    for wait in (0, 0.1, 0.4, 1.0):
        time.sleep(wait)
        try:
            os.replace(tmp, f)
            return
        except OSError:
            pass
    f.write_text(tmp.read_text(encoding='utf-8'), encoding='utf-8')
    tmp.unlink(missing_ok=True)


def write_land(out, src):
    """The land-sea mask the page's maps are drawn from (only when it is missing or a month old)."""
    f = out / 'land.json'
    if f.exists() and time.time() - f.stat().st_mtime < 30 * 86400:
        return
    try:
        loc = src.locate(0, 'lsm', 0)
        if not loc:
            return
        import eccodes
        msg = http(loc[0], (loc[1], loc[2]))
        with _codes:
            h = eccodes.codes_new_from_message(msg)
            try:
                ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
                lat0, lon0 = eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees'), eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees')
                d = eccodes.codes_get(h, 'iDirectionIncrementInDegrees')
                v = eccodes.codes_get_values(h).reshape(nj, ni)
            finally:
                eccodes.codes_release(h)
        lats = LAND['lat0'] + LAND['d'] * np.arange(LAND['ny'])
        lons = LAND['lon0'] + LAND['d'] * np.arange(LAND['nx'])
        jj = np.rint((lat0 - lats) / d).astype(int)
        ii = np.rint(((lons - lon0) % 360) / d).astype(int) % ni
        m = np.clip(v[np.ix_(jj, ii)], 0, 1)
        rows = [''.join(str(int(round(x * 9))) for x in row) for row in m]
        write_json(f, {**LAND, 'rows': rows, 'source': 'ECMWF land-sea mask, © ECMWF, CC BY 4.0'})
    except Exception as e:  # the map can wait for tomorrow
        log(f'land mask skipped: {e}')


def prune(cache, out):
    cutoff = time.time() - 2.5 * 86400
    if cache.exists():
        for d in cache.iterdir():
            try:
                if d.is_dir() and d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass
    iss = out / 'issues'
    if iss.exists():
        files = sorted(iss.glob('*.json'))
        for f in files[:-KEEP_ISSUES]:
            f.unlink(missing_ok=True)


def main():
    out, cache = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    (out / 'issues').mkdir(exist_ok=True)
    try:
        prune(cache, out)
    except Exception as e:
        log(f'prune skipped: {e}')
    now = datetime.now(timezone.utc)
    progress(stage='runs', pct=1)
    run, first, runs = pick_runs(now)
    log('runs: ' + ', '.join(f'{m} {r.run:%Y-%m-%d %HZ}' for m, r in runs.items() if r))
    write_land(out, runs['hres'] or runs['ens'])
    pts = uk_points()
    log(f'{len(pts[0])} UK points')
    issue = {
        'id': now.strftime('%Y%m%d%H%M'), 'issued': now.isoformat(), 'status': 'building',
        'runs': {m: (r.run.isoformat() if r else None) for m, r in runs.items()},
        'modelInfo': {m: {'name': v['name'], 'short': v['short'], 'members': len(v['members'])} for m, v in MODELS.items()},
        'map': MAP, 'weeks': [],
        'source': 'ECMWF open data (© ECMWF, CC BY 4.0); NOAA GFS and GEFS (public domain)',
    }
    building = out / 'building.json'
    write_json(building, issue)
    for wk in range(1, WEEKS + 1):
        days = [first.date() + timedelta(days=7 * (wk - 1) + k) for k in range(7)]
        base = 2 + 49 * (wk - 1)
        issue['weeks'].append(build_week(wk, days, runs, cache, pts, base, 44))
        progress(stage='week', week=wk, pct=base + 49)
        write_json(building, issue)
    issue['status'] = 'done'
    issue['finished'] = datetime.now(timezone.utc).isoformat()
    write_json(out / 'issues' / f'{issue["id"]}.json', issue)
    write_json(out / 'latest.json', issue)
    building.unlink(missing_ok=True)
    progress(stage='done', pct=100)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('@error ' + json.dumps({'error': str(e)[:400]}), flush=True)
        sys.exit(1)
