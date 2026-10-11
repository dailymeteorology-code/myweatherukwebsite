"""ECMWF ensemble -> three synoptic scenarios for one valid time.

Usage: python ens_scenarios.py <valid-iso-utc> <cache-dir>
Prints one JSON object on stdout.

Data: ECMWF open data, ENS ("enfo") 0.25°, the 50 perturbed members, mean sea-level
pressure only. Each member's field is fetched with an HTTP range request from the step's
.index (the multi-GB step file is never downloaded), decoded with ecCodes, cropped to
NW Europe and cached as .npy so a second request for the same run is instant.

Scenarios: k-means (k=3, many seeded restarts, best inertia kept) on the members' pressure
over the UK and its approaches. A scenario's likelihood is simply its share of the 50
members. Each scenario mean is described with the Jenkinson-Collison objective Lamb
weather type for the UK, and its highs and lows are found as local extremes.
© ECMWF, CC BY 4.0.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import math
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import eccodes
import numpy as np

SOURCES = ['https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com']
UA = 'MyWeatherUK-selfhost/1.0 (ensemble scenarios)'
W, E, S, N, RES = -30.0, 22.0, 42.0, 66.0, 0.25
MEMBERS = range(1, 51)
_codes = threading.Lock()   # ecCodes is not thread-safe


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(path, rng=None, tries=6):
    last = None
    for i in range(tries):
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
                    continue
            except Exception as e:  # timeouts, resets
                last = e
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'download failed: {path}: {last}')


def base_path(run, step):
    return f'{run:%Y%m%d}/{run:%H}z/ifs/0p25/enfo/{run:%Y%m%d%H}0000-{step}h-enfo-ef'


def index(run, step):
    txt = get(base_path(run, step) + '.index').decode()
    return [json.loads(l) for l in txt.splitlines() if l.strip()]


def valid_step(h):
    return (h <= 144 and h % 3 == 0) or (144 < h <= 360 and h % 6 == 0)


def pick_run(valid):
    """Newest 00Z/12Z run whose ENS has the step that lands exactly on `valid`."""
    now = datetime.now(timezone.utc)
    t = now.replace(hour=12 if now.hour >= 12 else 0, minute=0, second=0, microsecond=0)
    for k in range(8):
        run = t - timedelta(hours=12 * k)
        if now - run < timedelta(hours=7):
            continue          # still uploading
        step = int((valid - run).total_seconds() // 3600)
        if step < 0 or not valid_step(step):
            continue
        try:
            recs = [r for r in index(run, step) if r.get('param') == 'msl' and r.get('type') == 'pf']
        except RuntimeError:
            continue
        if len(recs) >= 50:
            return run, step, recs
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


def fetch_members(run, step, recs, cache):
    cdir = cache / f'{run:%Y%m%d%H}' / f'{step:03d}'
    cdir.mkdir(parents=True, exist_ok=True)
    by_member = {int(r['number']): r for r in recs}

    def job(m):
        f = cdir / f'msl_{m:02d}.npy'
        if f.exists():
            return m, np.load(f)
        r = by_member[m]
        msg = get(base_path(run, step) + '.grib2', (r['_offset'], r['_offset'] + r['_length'] - 1))
        with _codes:
            arr = decode(msg)
        if not (850 < float(arr.min()) and float(arr.max()) < 1090):
            raise RuntimeError(f'member {m}: implausible pressure')
        np.save(f, arr)
        return m, arr

    out = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for m, arr in ex.map(job, MEMBERS):
            out[m] = arr
    return np.stack([out[m] for m in MEMBERS])


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
            if 44 < lat < 48.5 and 5 < lon < 17:
                continue      # the Alps: sea-level pressure reduced over high ground makes false centres
            if v == box.min() and v < 1012:
                out.append({'t': 'L', 'lat': S + j * RES * step, 'lon': W + i * RES * step, 'p': round(float(v))})
            elif v == box.max() and v > 1016:
                out.append({'t': 'H', 'lat': S + j * RES * step, 'lon': W + i * RES * step, 'p': round(float(v))})
    return out


def main():
    valid = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
    cache = Path(sys.argv[2])
    run, step, recs = pick_run(valid)
    log(f'run {run:%Y-%m-%d %HZ} T+{step}')
    M = fetch_members(run, step, recs, cache)                       # (50, ny, nx) hPa
    # cluster on the UK and its approaches, 45-62N 22W-10E, every 2nd point
    j0, j1 = int((45 - S) / RES), int((62 - S) / RES) + 1
    i0, i1 = int((-22 - W) / RES), int((10 - W) / RES) + 1
    X = M[:, j0:j1:2, i0:i1:2].reshape(len(M), -1).astype(np.float64)
    lab = kmeans(X)
    clusters = []
    for j in range(3):
        idx = np.where(lab == j)[0]
        mean = M[idx].mean(0)
        half = mean[::2, ::2]
        clusters.append({
            'n': int(len(idx)), 'pct': round(100 * len(idx) / len(M)), 'members': [int(i) + 1 for i in idx],
            'lwt': lamb_type(mean), 'centres': extremes(mean),
            'msl': [round(float(v), 1) for v in half.ravel()],
        })
    clusters.sort(key=lambda c: -c['n'])
    # make the three shares add to exactly 100
    clusters[0]['pct'] = 100 - sum(c['pct'] for c in clusters[1:])
    ny, nx = M[0][::2, ::2].shape
    print(json.dumps({
        'run': run.isoformat(), 'step': step, 'valid': valid.isoformat(), 'members': len(M),
        'grid': {'lon0': W, 'lat0': S, 'd': RES * 2, 'nx': nx, 'ny': ny},
        'clusters': clusters, 'source': 'ECMWF ENS open data (50 members, 0.25°), © ECMWF, CC BY 4.0',
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # report cleanly to the Node side
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
