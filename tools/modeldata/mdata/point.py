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


def _raw_again(path: Path, tries=4):
    """_raw, read again a moment later if the frame cannot be read whole: a frame the drive would not let be
    renamed into place is written where it stands (common._replace) and can be caught half-way."""
    for i in range(tries):
        try:
            return _raw(path)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(0.3 * (i + 1))


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


# ── version 2 (15 Nov 2026): a place in one read ────────────────────────────────────────────────
# A place's first load read ~500 scattered rows from the v1 cubes (a row per variable, and 50-200 cells
# round the place for its chance of rain and lightning and its sky), 1.6-2.6 s on the external drive.
# A v2 cube keeps each cell's whole forecast, every variable at every step, as one block of bytes
# ([cell][var][step]), with the neighbourhood values already worked out (the chance of rain within
# 10 km, of lightning within 16 km, the cloud as the sky within 8 km), so a place costs one read of
# a few kB from each cube. Three kinds, each in point2/<model>/<run>/:
#   ukv        the hours (as v1, plus the snow conditions index for the hourly snow chance)
#   mix        the days: the MWUK Mix (UKV + ICON-EU, mdata/mix.py)
#   mo_global  the days beyond the Mix: the Met Office Global from T+90, read straight from AWS
#              (frames already made are used), only the steps and fields the days need
#
#     python -m mdata.point cube2 ukv 2026-11-15T03:00Z      (MDATA_GRID=eu for mo_global)
POINT2 = DATA / 'point2'
UKV_VARS2 = POINT_VARS + ['snow_cond']
MIX_VARS = ['t2', 'td2', 'rh2', 'tskin', 'wind10', 'gust10', 'wdir10', 'mslp', 'precip_rate', 'precip_step',
            'snow_rate', 'snow_step', 'tcc', 'lcc', 'mcc', 'hcc', 'vis', 'sw_down', 'snow_cond']
# (the pressure, the cloud's layers, the sunshine and the ground temperature too: the detailed forecast's
# charts reach the last day from these, 15 Nov 2026)
MOG_VARS = ['t2', 'tmax_step', 'tmin_step', 'td2', 'tskin', 'wind10', 'gust10', 'wdir10', 'mslp', 'precip_rate', 'precip_step',
            'snow_rate', 'tcc', 'lcc', 'mcc', 'hcc', 'vis', 'sw_down', 'uv_down']
# the Global's highest and lowest temperature over each step (3 or 6 hours this far out): the days'
# highs and lows from those, not from the hours the steps happen to land on
EXTRA_ENC = {'tmax_step': VARIABLES['t2'], 'tmin_step': VARIABLES['t2']}
enc_of = lambda v: EXTRA_ENC.get(v) or VARIABLES[v]           # noqa: E731
SPECS = {
    'ukv': dict(grid='uk', vars=UKV_VARS2, keep=4, rain_km=10.0, bolt_km=16.0, sky_km=8.0),
    'mix': dict(grid='uk', vars=MIX_VARS, keep=3, rain_km=10.0, sky_km=8.0),
    # a week out, a deterministic model's rain is a matter of where within a wider area: 24 km
    'mo_global': dict(grid='eu', vars=MOG_VARS, keep=2, rain_km=24.0, sky_km=8.0, from_lead=90, direct=True),
}
SKY = ('tcc', 'lcc', 'mcc', 'hcc')
PCT = {'lo': 0, 'hi': 254, 'scale': 'lin', 'unit': '%'}       # a chance: the byte is the percentage


def _lut(enc):
    """The 256 values a variable's bytes stand for (NaN for 255)."""
    q = np.arange(256, dtype=np.float64)
    lo, hi = float(enc['lo']), float(enc['hi'])
    if enc.get('scale') == 'sqrt':
        flo, fhi = np.sqrt(max(lo, 0.0)), np.sqrt(hi)
        v = (flo + q / 254.0 * (fhi - flo)) ** 2
    else:
        v = lo + q / 254.0 * (hi - lo)
    v[255] = np.nan
    return v.astype(np.float32)


def _disc(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return ((x * x + y * y) <= r * r).astype(np.float32)


def _conv(a, k):
    from scipy.signal import fftconvolve
    return fftconvolve(a, k, mode='same')


def _chance(q, lut, thr, k):
    """(steps, ny, nx) bytes -> the share of the cells within the disc k that reach thr, as bytes of %
    (255 where none of them has a value), step by step."""
    out = np.full(q.shape, 255, np.uint8)
    for i in range(q.shape[0]):
        v = lut[q[i]]
        ok = np.isfinite(v).astype(np.float32)
        if not ok.any():
            continue
        n = _conv(ok, k)
        hit = _conv(((v >= thr) & (ok > 0)).astype(np.float32), k)
        with np.errstate(invalid='ignore', divide='ignore'):
            p = np.where(n > 0.5, np.clip(np.rint(100.0 * hit / np.maximum(n, 1e-6)), 0, 100), np.nan)
        out[i] = np.where(np.isfinite(p), p, 255).astype(np.uint8)
    return out


def _sky(q, enc, k):
    """The mean within the disc k (cells with a value), re-encoded in the variable's own bytes."""
    from .common import encode
    lut = _lut(enc)
    out = np.full(q.shape, 255, np.uint8)
    for i in range(q.shape[0]):
        v = lut[q[i]]
        ok = np.isfinite(v).astype(np.float32)
        if not ok.any():
            continue
        n = _conv(ok, k)
        s = _conv(np.where(ok > 0, v, 0.0).astype(np.float32), k)
        with np.errstate(invalid='ignore', divide='ignore'):
            m = np.where(n > 0.5, s / np.maximum(n, 1e-6), np.nan)
        out[i] = encode(m, enc)
    return out


def _mog_field(M, run, h, var, prev_h):
    """A Met Office Global field at a step, for the days beyond the Mix. Its steps there are three- and
    then six-hourly, and what covers a step comes in files named for its length (PT03H, PT06H): the
    highest and lowest temperature, the strongest gust and the precipitation over the whole step."""
    span = h - (prev_h if prev_h is not None else h - 1)
    if var in ('tmax_step', 'tmin_step'):
        a, units = M._read(run, h, f"temperature_at_screen_level_{'max' if var == 'tmax_step' else 'min'}-PT{span:02d}H")
        return a - 273.15 if units == 'K' else a
    if var == 'gust10':
        try:
            a, units = M._read(run, h, f'wind_gust_at_10m_max-PT{span:02d}H')
            return a * 2.236936                                  # m/s -> mph, as the frames
        except Exception:
            pass
    if var == 'precip_step':
        try:
            a, units = M._read(run, h, f'precipitation_accumulation-PT{span:02d}H')
            return a * (1000.0 if units == 'm' else 1.0)
        except Exception:
            pass
    a = M.field(run, h, var, prev_h)
    return a[0] if isinstance(a, tuple) else a


def _direct(model, run, steps, all_steps, var, r0, r1, c0, c1):
    """One field's bytes in the window at these steps, (steps, nr, nc): its frames where they are made,
    the rest read from AWS here (never written as frames: a layer with gaps would look finished)."""
    import concurrent.futures as cf
    from .common import FRAMES, encode
    from .job import wait_turn
    from .models import MODELS
    M = MODELS[model]
    enc = enc_of(var)
    prev = {h: (all_steps[i - 1] if i else None) for i, h in enumerate(all_steps)}
    d = FRAMES / model / f'{run:%Y%m%dT%H%MZ}' / var
    out = np.full((len(steps), r1 - r0, c1 - c0), 255, np.uint8)

    def one(i):
        h = steps[i]
        p = d / f'{h}.bin'
        if var != 'gust10' and p.exists():                       # (the frames' gust is the gust at the step, not its strongest)
            try:
                q, _ = _raw_again(p)
                return i, q[r0:r1, c0:c1]
            except Exception:
                pass
        wait_turn()
        for attempt in range(2):
            try:
                a = _mog_field(M, run, h, var, prev[h]) if model == 'mo_global' else M.field(run, h, var, prev[h])
                if isinstance(a, tuple):
                    a = a[0]
                return i, encode(a, enc)[r0:r1, c0:c1]
            except FileNotFoundError:
                break                                            # not published at this step (UV ends before T+168)
            except Exception:
                time.sleep(2)
        return i, None

    with cf.ThreadPoolExecutor(int(os.environ.get('MDATA_THREADS', '6'))) as ex:
        for i, q in ex.map(one, range(len(steps))):
            if q is not None:
                out[i] = q
    return out


MIX_AMOUNTS = {'precip_step': 'precip_rate', 'snow_step': 'snow_rate'}


def _mix_amounts(run, var, steps, all_steps, r0, r1, c0, c1):
    """The MWUK Mix's amount over each of its steps (what falls since the step before), made here from
    its two models' own, as the Mix makes its rates (mdata/mix.py weight and matched): the UKV's own
    step amount, and ICON-EU's over the same hours, its mean rates over its own steps times their
    lengths (ICON's rates are its totals differenced, so this is its amount to rounding). Where ICON's
    steps do not fill the hours (the edge of its run) the UKV's amount stands alone."""
    from .common import FRAMES, encode
    from .mix import MixModel, matched, weight
    read = MixModel._read                                        # reads again when a frame is caught half-written
    u_run, i_run = MixModel().pair(run)
    off = (u_run - i_run).total_seconds() / 3600.0                # ICON's lead at a Mix lead: this much more
    idir = FRAMES / 'icon' / f'{i_run:%Y%m%dT%H%MZ}' / MIX_AMOUNTS[var]
    isteps = sorted(int(p.stem) for p in idir.glob('*.bin') if p.stem.isdigit())
    iprev = {s: (isteps[k - 1] if k else None) for k, s in enumerate(isteps)}
    udir = FRAMES / 'ukv' / f'{u_run:%Y%m%dT%H%MZ}' / var
    prev = {h: (all_steps[i - 1] if i else None) for i, h in enumerate(all_steps)}
    enc = VARIABLES[var]
    out = np.full((len(steps), r1 - r0, c1 - c0), 255, np.uint8)
    for i, h in enumerate(steps):
        p = udir / f'{h}.bin'                                     # the Mix's run is its UKV run: the same lead
        if not p.exists():
            continue
        a = read(p)
        b, p0 = None, prev[h]
        if p0 is not None:
            lo, hi = p0 + off, h + off
            parts = [s for s in isteps if lo < s <= hi]
            if parts and iprev[parts[0]] is not None and abs(iprev[parts[0]] - lo) < 1e-6 and abs(parts[-1] - hi) < 1e-6:
                b = sum(read(idir / f'{s}.bin') * (s - iprev[s]) for s in parts)
        out[i] = encode(a if b is None else matched(a, b, weight(h)), enc)[r0:r1, c0:c1]
    return out


def prune2(model):
    base = POINT2 / model
    tags = sorted(p.name for p in base.iterdir() if p.is_dir() and (p / 'manifest.json').exists())
    for t in tags[:-SPECS[model]['keep']]:
        shutil.rmtree(base / t, ignore_errors=True)
    for p in base.glob('*.partial'):
        if time.time() - p.stat().st_mtime > 3600:
            shutil.rmtree(p, ignore_errors=True)


def cube2(model, run_s):
    from .common import GRID, grid_meta
    spec = SPECS[model]
    if spec['grid'] != GRID:
        raise SystemExit(f'{model} cubes are on the {spec["grid"]} grid: run with MDATA_GRID={spec["grid"]}')
    run = _utc(run_s)
    tag = f'{run:%Y%m%dT%H%MZ}'
    t0 = time.time()
    all_steps = steps_for(model, run)
    steps = [h for h in all_steps if h >= spec.get('from_lead', 0)]
    if not steps:
        raise SystemExit(f'{model} {tag}: no steps')
    r0, r1, c0, c1 = window()
    nr, nc = r1 - r0, c1 - c0
    ncell, nstep = nr * nc, len(steps)
    km = DX / 1000.0
    disc = lambda dist: _disc(max(1, int(round(dist / km))))     # noqa: E731
    base = POINT2 / model
    tmp = base / f'{tag}.partial'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    prior = {h: (all_steps[i - 1] if i else None) for i, h in enumerate(all_steps)}
    man = {'version': 2, 'model': model, 'run': run.isoformat(), 'tag': tag, 'steps': steps, 'layout': 'cell-var-step',
           # the hours each step's amounts cover (1, then 3, then 6 for the Global): back to the step before it
           'spans': [h - prior[h] if prior[h] is not None else 0 for h in steps],
           'grid': grid_meta(), 'r0': r0, 'c0': c0, 'nr': nr, 'nc': nc,
           'nb': {k: spec[k] for k in ('rain_km', 'bolt_km', 'sky_km') if k in spec}, 'vars': {}, 'order': []}
    if model == 'mix':
        from .mix import MixModel
        man['pair'] = MixModel().entry(run)['pair']

    def put(v, q, enc, have):
        np.ascontiguousarray(q.reshape(nstep, ncell).T).tofile(tmp / f'{v}.u8')
        man['vars'][v] = dict({k: enc[k] for k in ('lo', 'hi')}, scale=enc.get('scale', 'lin'), unit=enc.get('unit', ''), steps=have)
        man['order'].append(v)

    held = {}                                                   # the stacks other fields are worked out from
    for v in spec['vars']:
        if spec.get('direct'):
            arr = _direct(model, run, steps, all_steps, v, r0, r1, c0, c1)
            enc = {k: enc_of(v)[k] for k in ('lo', 'hi')} | {'scale': enc_of(v).get('scale', 'lin')}
        elif model == 'mix' and v in MIX_AMOUNTS:
            arr = _mix_amounts(run, v, steps, all_steps, r0, r1, c0, c1)
            enc = {k: VARIABLES[v][k] for k in ('lo', 'hi')} | {'scale': VARIABLES[v].get('scale', 'lin')}
        else:
            d = run_dir(model, run, v)
            arr = np.full((nstep, nr, nc), 255, np.uint8)
            enc = None
            for i, h in enumerate(steps):
                p = d / f'{h}.bin'
                if not p.exists():
                    continue
                try:
                    q, head = _raw_again(p)
                except Exception:
                    continue
                arr[i] = q[r0:r1, c0:c1]
                enc = enc or {'lo': head['lo'], 'hi': head['hi'], 'scale': head.get('scale', 'lin')}
            if enc is None:
                e = VARIABLES[v]
                enc = {'lo': e['lo'], 'hi': e['hi'], 'scale': e.get('scale', 'lin')}
        have = [h for i, h in enumerate(steps) if (arr[i] != 255).any()]
        enc['unit'] = enc_of(v)['unit']
        if v in SKY:
            arr = _sky(arr, enc, disc(spec['sky_km']))
        put(v, arr, enc, have)
        if v == 'precip_step':
            put('p_rain', _chance(arr, _lut(enc), 0.1, disc(spec['rain_km'])), PCT, have)
        if v == 'lightning' and 'bolt_km' in spec:
            put('p_thunder', _chance(arr, _lut(enc), 0.01, disc(spec['bolt_km'])), PCT, have)
        if v in ('precip_step', 'precip_rate', 'snow_rate') and model == 'mo_global':
            held[v] = (arr, enc)
    if model == 'mo_global' and len(held) == 3:
        # the Global publishes no snowfall amounts: each step's amount times the share falling as snow
        # (its snowfall rate over its precipitation rate), as mdata/models.py makes its snow_step
        from .common import encode
        (ps, pe), (pr, re_), (sr, se) = held['precip_step'], held['precip_rate'], held['snow_rate']
        amt, rate, snow = _lut(pe)[ps], _lut(re_)[pr], _lut(se)[sr]
        with np.errstate(invalid='ignore', divide='ignore'):
            share = np.where(rate > 1e-4, np.clip(snow / np.maximum(rate, 1e-9), 0, 1), 0.0)
        e = VARIABLES['snow_step']
        enc = {'lo': e['lo'], 'hi': e['hi'], 'scale': e.get('scale', 'lin'), 'unit': e['unit']}
        put('snow_step', np.stack([encode(amt[i] * share[i], enc) for i in range(nstep)]), enc,
            [h for h in man['vars']['precip_step']['steps']])
    # the hours each step's amounts cover: back to the step before it that has an amount (the UKV lists
    # every hour to T+120, but its amounts are three-hourly beyond T+54)
    ps = man['vars'].get('precip_step', {}).get('steps') or []
    before = {h: (ps[i - 1] if i else None) for i, h in enumerate(ps)}
    man['spans'] = [h - before[h] if before.get(h) is not None else s for h, s in zip(steps, man['spans'])]
    # [cell][var][step], written a slab of cells at a time from the stacks just written
    order = man['order']
    mm = {v: np.memmap(tmp / f'{v}.u8', np.uint8, 'r', shape=(ncell, nstep)) for v in order}
    CH = 8192
    with open(tmp / 'cube.u8', 'wb') as f:
        for a in range(0, ncell, CH):
            b = min(ncell, a + CH)
            block = np.empty((b - a, len(order), nstep), np.uint8)
            for j, v in enumerate(order):
                block[:, j, :] = mm[v][a:b]
            f.write(block.tobytes())
    for m in mm.values():
        m._mmap.close()
    del mm
    for v in order:
        (tmp / f'{v}.u8').unlink(missing_ok=True)
    man['built'] = datetime.now(timezone.utc).isoformat()
    write_json(tmp / 'manifest.json', man)
    out = base / tag
    if out.exists():
        shutil.rmtree(out)
    os.replace(tmp, out)
    prune2(model)
    print(f'point2 {model} {tag}: {nstep} steps, {len(order)} fields, {nr}x{nc} cells, {time.time() - t0:.0f} s')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'cube':
        cube(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'cube2':
        cube2(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(2)
