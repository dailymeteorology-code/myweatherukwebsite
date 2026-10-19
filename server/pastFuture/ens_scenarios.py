"""ECMWF ensemble -> three synoptic scenarios for one day, or for a run of days.

Usage: python ens_scenarios.py <valid-iso-utc> <cache-dir> [<last-day YYYY-MM-DD>]
Prints one JSON object on stdout.

Data: ECMWF open data, ENS ("enfo") 0.25°, the 50 perturbed members, mean sea-level
pressure only. Each member's field is fetched with an HTTP range request from the step's
.index (the multi-GB step file is never downloaded), decoded with ecCodes, cropped to
NW Europe and cached as .npy so a second request for the same run is instant.

ONE DAY (no third argument): exactly the original behaviour. The members are clustered
on the chart at the valid time (12 UTC unless asked otherwise).

A RUN OF DAYS: the members are clustered on the same chart (the valid hour) of EVERY day
in the range at once, so a scenario is a way the whole period plays out, not one day of
it. Each scenario's chart, weather type, highs and lows are then taken from its windiest
day: the day whose chart has the strongest flow over the UK (the Jenkinson-Collison F),
i.e. the worst case within that scenario.

Scenarios: k-means (k=3, many seeded restarts, best inertia kept) on the members' pressure
over the UK and its approaches. A scenario's likelihood is simply its share of the 50
members. Each scenario mean is described with the Jenkinson-Collison objective Lamb
weather type for the UK, and its highs and lows are found as local extremes.

Tracks: every scenario also gets the track of its main low. The low is picked on the
scenario's chart (the deepest low near the UK, nearness counted against depth) and
followed through the scenario's mean pressure from 12 h before the first day's chart to
12 h after the last one: every 6 h for up to three days, every 12 h beyond that.
© ECMWF, CC BY 4.0.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import math
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import eccodes
import numpy as np

SOURCES = ['https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com']
UA = 'MyWeatherUK-selfhost/1.0 (ensemble scenarios)'
W, E, S, N, RES = -30.0, 32.0, 42.0, 74.0, 0.25
MEMBERS = range(1, 51)
MAX_DAYS = 7
UK_CENTRE = (54.0, -3.0)
_codes = threading.Lock()   # ecCodes is not thread-safe


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(path, rng=None, tries=6):
    last = None
    for i in range(tries):
        missing = 0
        for base in SOURCES:
            h = {'User-Agent': UA}
            if rng:
                h['Range'] = f'bytes={rng[0]}-{rng[1]}'
            try:
                with urllib.request.urlopen(urllib.request.Request(f'{base}/{path}', headers=h), timeout=90) as r:
                    data = r.read()
                if rng and len(data) != rng[1] - rng[0] + 1:
                    raise RuntimeError('short read')
                return data
            except urllib.error.HTTPError as e:
                last = e
                if e.code == 404:
                    missing += 1
                    continue
            except Exception as e:  # timeouts, resets
                last = e
        if missing == len(SOURCES):
            break       # on no mirror at all: a 404 is an answer, retrying only burns half a minute
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'download failed: {path}: {last}')


def base_path(run, step):
    return f'{run:%Y%m%d}/{run:%H}z/ifs/0p25/enfo/{run:%Y%m%d%H}0000-{step}h-enfo-ef'


def index(run, step):
    txt = get(base_path(run, step) + '.index').decode()
    return [json.loads(l) for l in txt.splitlines() if l.strip()]


def msl_records(run, step):
    return [r for r in index(run, step) if r.get('param') == 'msl' and r.get('type') == 'pf']


def valid_step(h):
    return (0 <= h <= 144 and h % 3 == 0) or (144 < h <= 360 and h % 6 == 0)


def hours(a, b):
    return int((a - b).total_seconds() // 3600)


def pick_run(first, last):
    """Newest 00Z/12Z run whose ENS has steps landing exactly on `first` and on `last`."""
    now = datetime.now(timezone.utc)
    t = now.replace(hour=12 if now.hour >= 12 else 0, minute=0, second=0, microsecond=0)
    for k in range(8):
        run = t - timedelta(hours=12 * k)
        if now - run < timedelta(hours=7):
            continue          # still uploading
        s0, s1 = hours(first, run), hours(last, run)
        if not (valid_step(s0) and valid_step(s1)):
            continue
        try:
            recs = {s: msl_records(run, s) for s in sorted({s0, s1})}
        except RuntimeError:
            continue
        if all(len(r) >= 50 for r in recs.values()):
            return run, recs
    raise RuntimeError('no ECMWF ensemble run reaches that time yet (the open data goes 15 days ahead)')


def decode(msg):
    h = eccodes.codes_new_from_message(msg)
    try:
        if eccodes.codes_get(h, 'shortName') != 'msl':
            raise RuntimeError('not msl')
        ni, nj = eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj')
        lat0 = eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees')
        lon0 = eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees')
        v = eccodes.codes_get_values(h).reshape(nj, ni)
    finally:
        eccodes.codes_release(h)
    i0 = int(round(((W - lon0) % 360) / RES))
    i1 = i0 + int(round((E - W) / RES)) + 1
    j0 = int(round((lat0 - N) / RES))
    j1 = j0 + int(round((N - S) / RES)) + 1
    w = np.take(v, range(i0, i1), axis=1, mode='wrap')[j0:j1]
    return np.ascontiguousarray(w[::-1]).astype(np.float32) / 100.0   # hPa, south row first


def save_npy(f, arr):
    """Write via a temp file so a concurrent reader never sees half a file."""
    tmp = f.with_name(f'{f.stem}.{os.getpid()}.{threading.get_ident()}.tmp.npy')
    np.save(tmp, arr)
    for wait in (0, 0.02, 0.04, 0.08):
        time.sleep(wait)
        try:
            os.replace(tmp, f)
            return
        except OSError:
            pass
    np.save(f, arr)          # locked by a sync client or scanner: write in place instead
    try:
        tmp.unlink()
    except OSError:
        pass


def fetch_member(job):
    """Download, decode, check and cache one member's field. Runs in a worker process, so every
    decoder has its own ecCodes (it is not thread-safe); within a process it is still locked."""
    run_iso, s, m, off, length, f = job
    run = datetime.fromisoformat(run_iso)
    msg = get(base_path(run, s) + '.grib2', (off, off + length - 1))
    with _codes:
        arr = decode(msg)
    if not (850 < float(arr.min()) and float(arr.max()) < 1090):
        raise RuntimeError(f'step {s} member {m}: implausible pressure')
    save_npy(Path(f), arr)
    return arr


def fetch_chunk(jobs):
    """One worker process's share: four downloads in flight, decoding one at a time."""
    with cf.ThreadPoolExecutor(4) as ex:
        return list(ex.map(fetch_member, jobs))


def fetch_steps(run, steps, recs, cache):
    """{step: (50, ny, nx) hPa} for every step. Cached members load from disk; the rest are fetched
    by a few worker processes with several downloads each. Both halves matter: a range request
    takes about a second to answer, so downloads need to overlap, and ecCodes can only decode one
    field at a time per process."""
    by = {s: {int(r['number']): r for r in recs[s]} for s in steps}
    out, todo = {}, []
    for s in steps:
        d = cache / f'{run:%Y%m%d%H}' / f'{s:03d}'
        d.mkdir(parents=True, exist_ok=True)
        for m in MEMBERS:
            f = d / f'msl_{m:02d}.npy'
            if f.exists():
                try:
                    out[(s, m)] = np.load(f)
                    continue
                except (OSError, ValueError):
                    pass      # torn file from an interrupted run: fetch it again
            r = by[s][m]
            todo.append(((s, m), (run.isoformat(), s, m, int(r['_offset']), int(r['_length']), str(f))))
    if todo:
        workers = max(1, min(3, (os.cpu_count() or 4) - 1, len(todo) // 8))   # light on CPU: the site shares this PC
        if workers == 1:
            for (key, _), arr in zip(todo, fetch_chunk([j for _, j in todo])):
                out[key] = arr
        else:
            shares = [todo[k::workers] for k in range(workers)]
            with cf.ProcessPoolExecutor(workers) as ex:
                for share, arrs in zip(shares, ex.map(fetch_chunk, [[j for _, j in sh] for sh in shares])):
                    for (key, _), arr in zip(share, arrs):
                        out[key] = arr
    return {s: np.stack([out[(s, m)] for m in MEMBERS]) for s in steps}


def prune_cache(cache, keep_days=3):
    """Drop cached runs older than a few days: a multi-day request caches ~25 MB per step."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    if not cache.exists():
        return
    for d in cache.iterdir():
        try:
            when = datetime.strptime(d.name, '%Y%m%d%H').replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if when < cutoff:
            shutil.rmtree(d, ignore_errors=True)


def kmeans(X, k=3, restarts=40, iters=60):
    rng = np.random.default_rng(20261011)
    best = None
    for _ in range(restarts):
        c = [X[rng.integers(len(X))]]                     # k-means++ seeding
        for _ in range(k - 1):
            d = np.min([((X - ci) ** 2).sum(1) for ci in c], axis=0)
            c.append(X[rng.choice(len(X), p=d / d.sum())])
        c = np.array(c)
        for _ in range(iters):
            lab = np.argmin(((X[:, None, :] - c[None]) ** 2).sum(2), axis=1)
            nc = np.array([X[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
            if np.allclose(nc, c):
                break
            c = nc
        inertia = sum(((X[lab == j] - c[j]) ** 2).sum() for j in range(k))
        if best is None or inertia < best[0]:
            best = (inertia, lab)
    return best[1]


def at(field, lat, lon):
    """Bilinear sample of a cropped field (south row first)."""
    fx, fy = (lon - W) / RES, (lat - S) / RES
    i, j = int(fx), int(fy)
    u, v = fx - i, fy - j
    return float(field[j, i] * (1 - u) * (1 - v) + field[j, i + 1] * u * (1 - v)
                 + field[j + 1, i] * (1 - u) * v + field[j + 1, i + 1] * u * v)


def lamb_type(f):
    """Jenkinson-Collison objective Lamb weather type, grid centred on 55N 5W (Jones et al. 1993)."""
    P = {1: (65, -15), 2: (65, -5), 3: (60, -25), 4: (60, -15), 5: (60, -5), 6: (60, 5), 7: (55, -25), 8: (55, -15),
         9: (55, -5), 10: (55, 5), 11: (50, -25), 12: (50, -15), 13: (50, -5), 14: (50, 5), 15: (45, -15), 16: (45, -5)}
    p = {k: at(f, la, lo) for k, (la, lo) in P.items()}
    phi = math.radians(55)
    sc, zs1, zs2 = 1 / math.cos(phi), math.sin(phi) / math.sin(math.radians(50)), math.sin(phi) / math.sin(math.radians(60))
    zc = 1 / (2 * math.cos(phi) ** 2)
    w = 0.5 * (p[12] + p[13]) - 0.5 * (p[4] + p[5])
    s = sc * (0.25 * (p[5] + 2 * p[9] + p[13]) - 0.25 * (p[4] + 2 * p[8] + p[12]))
    zw = zs1 * (0.5 * (p[15] + p[16]) - 0.5 * (p[8] + p[9])) - zs2 * (0.5 * (p[8] + p[9]) - 0.5 * (p[1] + p[2]))
    zs = zc * (0.25 * (p[6] + 2 * p[10] + p[14]) - 0.25 * (p[5] + 2 * p[9] + p[13])
               - 0.25 * (p[4] + 2 * p[8] + p[12]) + 0.25 * (p[3] + 2 * p[7] + p[11]))
    F, Z = math.hypot(w, s), zw + zs
    frm = (math.degrees(math.atan2(-w, -s)) + 360) % 360       # direction the wind blows FROM
    names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    d = names[int(((frm + 22.5) % 360) // 45)]
    if F < 6 and abs(Z) < 6:
        kind = 'U'
    elif abs(Z) < F:
        kind = d
    elif abs(Z) > 2 * F:
        kind = 'C' if Z > 0 else 'A'
    else:
        kind = ('C' if Z > 0 else 'A') + d
    return {'type': kind, 'dir': d, 'from': round(frm), 'F': round(F, 1), 'Z': round(Z, 1), 'centre': round(p[9], 1)}


def in_alps(lat, lon):
    # sea-level pressure reduced over high ground makes false centres there
    return 44 < lat < 48.5 and 5 < lon < 17


def extremes(f, step=2, win=10):
    """Highs and lows on the half-degree grid: strict local extremes in a ~5° box."""
    g = f[::step, ::step]
    ny, nx = g.shape
    out = []
    for j in range(2, ny - 2):
        for i in range(2, nx - 2):
            box = g[max(0, j - win):j + win + 1, max(0, i - win):i + win + 1]
            v = g[j, i]
            lat, lon = S + j * RES * step, W + i * RES * step
            if in_alps(lat, lon):
                continue
            if v == box.min() and v < 1012:
                out.append({'t': 'L', 'lat': S + j * RES * step, 'lon': W + i * RES * step, 'p': round(float(v))})
            elif v == box.max() and v > 1016:
                out.append({'t': 'H', 'lat': S + j * RES * step, 'lon': W + i * RES * step, 'p': round(float(v))})
    return out


def km(a, b):
    """Great-circle distance between (lat, lon) pairs."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def lows(f, win=6, pmax=1016):
    """Low centres for tracking: local minima in a ~3° box on the half-degree grid, below
    `pmax`, placed between grid points by a parabola through the neighbours."""
    g = f[::2, ::2].astype(np.float64)
    ny, nx = g.shape
    out = []
    js, is_ = np.where(g < pmax)
    for j, i in zip(js, is_):
        if j < 2 or i < 2 or j >= ny - 2 or i >= nx - 2:
            continue
        v = g[j, i]
        if v != g[max(0, j - win):j + win + 1, max(0, i - win):i + win + 1].min():
            continue
        lat, lon = S + j * 0.5, W + i * 0.5
        if in_alps(lat, lon):
            continue

        def vertex(a, b, c):
            den = a - 2 * b + c
            return 0.0 if den <= 0 else max(-0.5, min(0.5, 0.5 * (a - c) / den))
        lat += 0.5 * vertex(g[j - 1, i], v, g[j + 1, i])
        lon += 0.5 * vertex(g[j, i - 1], v, g[j, i + 1])
        out.append((lat, lon, float(v)))
    return out


def main_low(f):
    """The low a UK forecaster cares about on this chart: the deepest one, with distance from the
    UK counted against it (1 hPa per 100 km). Lows inside the UK-and-approaches box come first."""
    cands = lows(f)
    near = [c for c in cands if 46 <= c[0] <= 63 and -22 <= c[1] <= 10]
    pool = near or [c for c in cands if km(c, UK_CENTRE) < 2000]
    if not pool:
        return None
    return min(pool, key=lambda c: c[2] + 0.01 * km(c, UK_CENTRE))


def follow(fields, steps, start, start_step):
    """Follow a low from `start` through `steps` (ordered away from `start_step`): each time the
    nearest low to where it was heading, at most 110 km/h away, nudged towards similar depth."""
    pts, cur, prev, last = [], start, None, start_step
    for s in steps:
        dt = abs(s - last)
        if prev is None:
            pred = cur
        else:
            pred = (2 * cur[0] - prev[0], 2 * cur[1] - prev[1])
        cands = [c for c in lows(fields[s]) if km(c, cur) <= 110 * dt]
        if not cands:
            break
        nxt = min(cands, key=lambda c: km(c, pred) + 3 * abs(c[2] - cur[2]))
        pts.append((s, nxt))
        prev, cur, last = cur, nxt, s
    return pts


def track_of(fields, steps, disp_step, run):
    centre = main_low(fields[disp_step])
    if centre is None:
        return None, None
    back = follow(fields, [s for s in reversed(steps) if s < disp_step], centre, disp_step)
    fwd = follow(fields, [s for s in steps if s > disp_step], centre, disp_step)
    seq = back[::-1] + [(disp_step, centre)] + fwd
    pts = [{'t': (run + timedelta(hours=s)).isoformat(), 'lat': round(c[0], 2), 'lon': round(c[1], 2), 'p': round(c[2])}
           for s, c in seq]
    return pts, len(back)


def main():
    valid = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
    cache = Path(sys.argv[2])
    last_day = date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else valid.date()
    ndays = (last_day - valid.date()).days + 1
    if ndays < 1:
        raise RuntimeError('the last day is before the first')
    if ndays > MAX_DAYS:
        raise RuntimeError(f'pick at most {MAX_DAYS} days')
    anchors = [valid + timedelta(days=k) for k in range(ndays)]
    try:
        prune_cache(cache)
    except Exception as e:  # housekeeping must never cost the answer
        log(f'cache prune skipped: {e}')

    run, recs = pick_run(anchors[0], anchors[-1])
    anchor_steps = [hours(a, run) for a in anchors]
    # track times: 12 h either side of the charts, every 6 h (every 12 h past three days)
    dt = 6 if ndays <= 3 else 12
    track_steps = [s for s in range(anchor_steps[0] - 12, anchor_steps[-1] + 13, dt) if valid_step(s)]
    steps = sorted(set(anchor_steps) | set(track_steps))
    log(f'run {run:%Y-%m-%d %HZ} T+{anchor_steps[0]}..{anchor_steps[-1]}, {len(steps)} steps')

    def records(s):
        if s in recs:
            return s, recs[s]
        try:
            r = msl_records(run, s)
            return s, r if len(r) >= 50 else None
        except RuntimeError:
            return s, None
    with cf.ThreadPoolExecutor(8) as ex:
        for s, r in ex.map(records, steps):
            recs[s] = r
    missing = [s for s in anchor_steps if not recs.get(s)]
    if missing:
        raise RuntimeError(f'ECMWF ensemble step T+{missing[0]} is not available')
    steps = [s for s in steps if recs.get(s)]          # a track step that is missing just shortens the track

    fields = fetch_steps(run, steps, recs, cache)       # {step: (50, ny, nx) hPa}
    first = fields[anchor_steps[0]]
    # cluster on the UK and its approaches, 45-62N 22W-10E, every 2nd point, every day's chart side by side
    j0, j1 = int((45 - S) / RES), int((62 - S) / RES) + 1
    i0, i1 = int((-22 - W) / RES), int((10 - W) / RES) + 1
    X = np.concatenate([fields[s][:, j0:j1:2, i0:i1:2].reshape(len(first), -1) for s in anchor_steps], axis=1).astype(np.float64)
    lab = kmeans(X)
    clusters = []
    for j in range(3):
        idx = np.where(lab == j)[0]
        means = {s: fields[s][idx].mean(0) for s in steps}
        days = [{'valid': (run + timedelta(hours=s)).isoformat(), 'lwt': lamb_type(means[s])} for s in anchor_steps]
        peak = max(range(len(days)), key=lambda k: (days[k]['lwt']['F'], -k))   # windiest day, earliest on a tie
        disp = anchor_steps[peak]
        mean = means[disp]
        half = mean[::2, ::2]
        track, track_at = track_of(means, steps, disp, run)
        clusters.append({
            'n': int(len(idx)), 'pct': round(100 * len(idx) / len(first)), 'members': [int(i) + 1 for i in idx],
            'lwt': days[peak]['lwt'], 'centres': extremes(mean),
            'msl': [round(float(v), 1) for v in half.ravel()],
            'valid': days[peak]['valid'], 'days': days,
            'track': track, 'trackAt': track_at, 'minP': min(p['p'] for p in track) if track else None,
        })
    clusters.sort(key=lambda c: -c['n'])
    # make the three shares add to exactly 100
    clusters[0]['pct'] = 100 - sum(c['pct'] for c in clusters[1:])
    ny, nx = first[0][::2, ::2].shape
    print(json.dumps({
        'run': run.isoformat(), 'step': anchor_steps[0], 'steps': [anchor_steps[0], anchor_steps[-1]],
        'valid': anchors[0].isoformat(), 'end': anchors[-1].isoformat(), 'days': ndays,
        'trackEvery': dt, 'members': len(first),
        'grid': {'lon0': W, 'lat0': S, 'd': RES * 2, 'nx': nx, 'ny': ny},
        'clusters': clusters, 'source': 'ECMWF ENS open data (50 members, 0.25°), © ECMWF, CC BY 4.0',
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # report cleanly to the Node side
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
