"""Compiled Stage 4 against V5's own Stage 4, every field, every cell.

    python -m nova.v5x.verify4 <run YYYYmmddTHH> <forecast hour>
(needs the V5 reference pickled by `nova.v5x.verify` for the same frame)
"""
from __future__ import annotations

import logging
import pickle
import sys
import time
import warnings
from datetime import datetime, timezone

import numpy as np

logging.disable(logging.WARNING)
warnings.filterwarnings('ignore')

from .. import v5_bridge as B  # noqa: E402
from ..config import CACHE  # noqa: E402
from . import stage4  # noqa: E402


def main():
    run = datetime.strptime(sys.argv[1], '%Y%m%dT%H').replace(tzinfo=timezone.utc)
    fh = int(sys.argv[2])
    mode = sys.argv[3] if len(sys.argv) > 3 else 'exact'
    stage4.EXACT = mode == 'exact'
    print('mode:', 'exact RK4 (bit-for-bit target)' if stage4.EXACT else 'v2 shared-environment table kernels (production)')
    ref = pickle.loads((CACHE / f'v5x_gp_{run:%Y%m%dT%H}_{fh:03d}.pkl').read_bytes())
    from app.profiles.build import build_profile
    cube = build_profile('ukv', run, fh, provider=B.PROVIDER, grid_id=B.V5_GRID.name)
    if mode == 'v2-vs-exact':                     # production kernels against the verified exact kernels
        stage4.EXACT = True
        ref = stage4.compute_grid(cube)
        stage4.EXACT = False
    t = time.time()
    stage4.compute_grid(cube)                     # first call compiles
    print(f'first call (with compilation) {time.time() - t:.1f}s', flush=True)
    t = time.time()
    gp = stage4.compute_grid(cube)
    print(f'compiled Stage 4, whole grid: {time.time() - t:.1f}s', flush=True)
    worst = 0.0
    for name, f in sorted(ref.fields.items()):
        a = f.values
        b = gp.fields[name].values if name in gp.fields else None
        if b is None:
            print(f'  {name:28s} MISSING'); worst = 1e9; continue
        fa, fb = np.isfinite(a), np.isfinite(b)
        pattern = int((fa != fb).sum())
        both = fa & fb
        d = np.abs(a[both] - b[both])
        scale = np.maximum(1.0, np.abs(a[both]))
        rel = float((d / scale).max()) if d.size else 0.0
        print(f'  {name:28s} max|d|={float(d.max()) if d.size else 0:.3e}  rel={rel:.2e}  nan-pattern diffs={pattern}')
        worst = max(worst, rel, float(pattern > 0.0005 * a.size))
        for k, ea in f.extra.items():
            eb = gp.fields[name].extra.get(k)
            ok = np.isfinite(ea) & np.isfinite(eb)
            dd = np.abs(ea[ok] - eb[ok])
            print(f'      .{k:36s} max|d|={float(dd.max()) if dd.size else 0:.3e}')
    print('RESULT:', 'PASS' if worst < 1e-3 else f'CHECK (worst relative {worst:.2e})')


if __name__ == '__main__':
    main()
