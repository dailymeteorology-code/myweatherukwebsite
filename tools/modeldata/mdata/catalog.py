"""Which runs exist right now, for every model -> catalog.json (refreshed by the server).

    python -m mdata.catalog
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import time
import warnings
from datetime import datetime, timezone

from .common import DATA, FRAMES, grid_meta, write_json
from .models import MODELS, SOURCES, VARIABLES


def model_entry(m):
    try:
        runs = m.runs()
    except Exception as e:
        return {'id': m.id, 'error': str(e)[:200], 'runs': []}
    return {'id': m.id, 'label': m.label, 'res_km': m.res_km, 'source': SOURCES[m.id], 'variables': m.variables,
            'runs': [{'run': r.isoformat(), 'steps': s} for r, s in runs]}


def prune(keep_hours=36):
    """Frames of runs older than `keep_hours` (relative to the newest run of that model)."""
    import shutil
    for md in FRAMES.glob('*'):
        runs = sorted(p for p in md.iterdir() if p.is_dir())
        if not runs:
            continue
        newest = datetime.strptime(runs[-1].name, '%Y%m%dT%H%MZ')
        for p in runs:
            if (newest - datetime.strptime(p.name, '%Y%m%dT%H%MZ')).total_seconds() > keep_hours * 3600:
                shutil.rmtree(p, ignore_errors=True)


def main():
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    t = time.time()
    old = {}
    try:
        old = {m['id']: m for m in json.loads((DATA / 'catalog.json').read_text())['models']}
    except Exception:
        pass
    with cf.ThreadPoolExecutor(len(MODELS)) as ex:
        models = list(ex.map(model_entry, MODELS.values()))
    # a model whose listing failed this time keeps its last good runs
    models = [m if m['runs'] or m['id'] not in old else dict(old[m['id']], stale=True) for m in models]
    write_json(DATA / 'catalog.json', {
        'generated': datetime.now(timezone.utc).isoformat(), 'grid': grid_meta(),
        'variables': VARIABLES, 'models': models})
    try:
        prune()
    except Exception:
        pass
    print(f'catalog: {[(m["id"], len(m["runs"])) for m in models]} in {time.time() - t:.0f} s')


if __name__ == '__main__':
    main()
