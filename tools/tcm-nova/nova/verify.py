"""Verification against independent observations and the skill record behind the
dynamic weights.

For every published Main Run whose early frames are now in the past:
  * each SOURCE's precipitation (saved per run for leads <= 24 h at 10 km) is scored
    against the Met Office radar composite with the Fractions Skill Score
    (Roberts & Lean 2008; threshold 1 mm/h, 30 km neighbourhood) — a neighbourhood
    score, so a slightly displaced storm is not counted as a total miss;
  * NOVA's own p_thunder is scored against LEELA lightning (any strike within the
    frame's neighbourhood, ±90 min): Brier score, reliability bins, POD/FAR/CSI at 30 %.
Results go to <DATA>/skill.json (per hazard, lead window, model: running mean, n)
and <DATA>/verification.json (per run). Only observations valid BEFORE a later run's
initialisation can influence that run's weights: skill is read at run start.

    python -m nova.verify
"""
from __future__ import annotations

import json
import zlib
from datetime import datetime, timedelta, timezone

import numpy as np
from scipy import ndimage

from . import store
from .config import DATA
from .grid import Grid, block_mean, coarsen_sampler
from .hyper import obs
from .weights import SKILL_FILE, window_index

COARSE = 5            # 2 km -> 10 km for the saved source fields


def fss(f, o, thr, n):
    bf, bo = (f >= thr).astype(np.float32), (o >= thr).astype(np.float32)
    pf, po = ndimage.uniform_filter(bf, n), ndimage.uniform_filter(bo, n)
    num = np.mean((pf - po) ** 2)
    den = np.mean(pf ** 2) + np.mean(po ** 2)
    return None if den == 0 else float(1 - num / den)


def radar_on(grid, vt):
    r = obs.read_radar(vt)
    return coarsen_sampler(grid, r['projdef'], r['x'], r['y'])(r['rate'])


def run_verification(now=None):
    now = now or datetime.now(timezone.utc)
    grid = Grid.get('gb2km')
    skill = json.loads(SKILL_FILE.read_text()) if SKILL_FILE.exists() else {}
    vfile = DATA / 'verification.json'
    ver = json.loads(vfile.read_text()) if vfile.exists() else {}
    try:
        strikes, _ = obs.lightning(now, 2880)
    except Exception:
        strikes = []
    for rd in sorted((DATA / 'main').glob('main-*')):
        if rd.name.endswith('.partial') or rd.name in ver:
            continue
        m = json.loads((rd / 'manifest.json').read_text())
        init = datetime.fromisoformat(m['init_utc'])
        if now - init < timedelta(hours=25):
            continue                                    # wait until the first 24 h are observed
        rec = {'frames': []}
        for fr in m['frames']:
            if not fr.get('valid') or fr['lead_min'] > 24 * 60:
                continue
            vt = datetime.fromisoformat(fr['valid'])
            try:
                o = radar_on(grid, vt)
            except Exception:
                continue
            oc = block_mean(np.nan_to_num(o), COARSE)
            wi = str(window_index(fr['lead_h']))
            sd = rd / 'sources' / str(fr['lead_min'])
            for f in sd.glob('*.bin') if sd.exists() else []:
                a = np.frombuffer(zlib.decompress(f.read_bytes()), np.float16).astype(np.float32).reshape(oc.shape)
                s = fss(a, oc, 1.0, 3)
                if s is None:
                    continue
                cell = skill.setdefault('thunder', {}).setdefault(wi, {}).setdefault(f.stem, {'n': 0, 'fss': 0.0})
                cell['fss'] = (cell['fss'] * cell['n'] + s) / (cell['n'] + 1)
                cell['n'] += 1
            # NOVA's own thunder probability vs lightning
            try:
                p = store.read_frame('main', rd.name, fr['lead_min'], 'p_thunder', grid.shape).astype(np.float32)
            except Exception:
                continue
            hit = np.zeros(grid.shape, np.float32)
            from pyproj import Transformer
            tr = Transformer.from_crs('EPSG:4326', grid.crs, always_xy=True)
            for t, la, lo in strikes:
                if abs((t - vt).total_seconds()) <= 5400:
                    x, y = tr.transform(lo, la)
                    ix, iy = int(x // grid.dx), int(y // grid.dx)
                    if 0 <= ix < grid.nx and 0 <= iy < grid.ny:
                        hit[iy, ix] = 1
            r = max(1, int((10 + 0.35 * fr['lead_h']) * 1000 / grid.dx))
            yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
            obs_ev = ndimage.maximum_filter(hit, footprint=(xx * xx + yy * yy) <= r * r)
            bs = float(np.mean((p - obs_ev) ** 2))
            clim = float(obs_ev.mean())
            bss = None if clim in (0, 1) else 1 - bs / (clim * (1 - clim))
            yes, ev = p >= 0.3, obs_ev > 0
            a, b, c = int((yes & ev).sum()), int((yes & ~ev).sum()), int((~yes & ev).sum())
            rec['frames'].append({'lead_h': fr['lead_h'], 'brier': bs, 'bss': bss, 'pod': a / (a + c) if a + c else None,
                                  'far': b / (a + b) if a + b else None, 'csi': a / (a + b + c) if a + b + c else None,
                                  'event_frac': clim})
        ver[rd.name] = rec
    store._write_json(SKILL_FILE, skill)
    store._write_json(vfile, ver)
    return skill, ver


def save_source_fields(writer_dir, lead_min, got, grid):
    """Called by the Main Run for leads <= 24 h: each source's precip at 10 km."""
    d = writer_dir / 'sources' / str(lead_min)
    d.mkdir(parents=True, exist_ok=True)
    for k, v in got.items():
        pr = v.get('sfc', {}).get('precip')
        if pr is None and 'members' in v:
            pr = v['members']['precip'].mean(0)
        if pr is not None:
            (d / f'{k}.bin').write_bytes(zlib.compress(block_mean(np.nan_to_num(pr), COARSE).astype(np.float16).tobytes(), 6))


if __name__ == '__main__':
    s, v = run_verification()
    print(json.dumps({'skill_windows': {h: {w: len(m) for w, m in d.items()} for h, d in s.items()}, 'runs_verified': len(v)}))
