"""Time one Main Run frame without the download (developer tool).

    python -m nova.v5x.bench [lead] [workers]
The first call fetches every model for the frame and pickles it to the cache; later
calls reuse it, so the timing is the processing alone.
"""
from __future__ import annotations

import logging
import pickle
import sys
import time
import warnings
from datetime import timedelta

logging.disable(logging.WARNING)
warnings.filterwarnings('ignore')

from ..config import CACHE  # noqa: E402
from ..main_run import cycle_init  # noqa: E402
from .. import v5_blend as VB  # noqa: E402
from . import pipeline as PL  # noqa: E402


def main():
    lead = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else None
    path = CACHE / f'bench_got_{lead:03d}.pkl'
    if path.exists():
        init, got, cycles = pickle.loads(path.read_bytes())
        print('cached frame', init, flush=True)
    else:
        init = cycle_init()
        b = VB.Blender(init, lead)
        t = time.time()
        got = b.at(init + timedelta(hours=lead))
        print(f'fetch {time.time() - t:.0f}s', flush=True)
        cycles = b.cycles
        path.write_bytes(pickle.dumps((init, got, cycles)))
    g = VB.grid()
    from .. import terrain
    terr = terrain.load(VB.GRID_NAME)
    for rep in range(2):                       # second pass: compiled, warm pool
        t = time.time()
        out, meta = PL.run_frame(got, lead, cycles, terr, g, run=init, valid_time=init + timedelta(hours=lead),
                                 workers=workers)
        print(f'pass {rep + 1}: frame {time.time() - t:.1f}s  p_thunder max {float(out["p_thunder"].max()):.3f}', flush=True)


if __name__ == '__main__':
    main()
