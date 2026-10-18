"""Run storage. Main Run and Hyper-Short live in separate namespaces:

    <DATA>/main/<run_id>/manifest.json
    <DATA>/main/<run_id>/frames/<lead_min>/<field>.bin   (zlib float16, row 0 = south)
    <DATA>/hyper/<run_id>/...
    <DATA>/<product>/latest.json   -> the newest PUBLISHED run id (atomic replace)
    <DATA>/<product>/status.json   -> live job state for monitoring

A run is written into `<run_id>.partial/` and renamed only after validation passes,
so an incomplete run can never be read as a published one, and run ids include the
init time so a new cycle cannot overwrite another.
"""
from __future__ import annotations

import json
import os
import shutil
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .config import DATA

STATES = ['scheduled', 'collecting', 'analysing', 'running', 'validating', 'published', 'degraded', 'failed']


def run_id(product, init):
    return f'{product}-{init:%Y%m%dT%H%MZ}'


def _write_json(path: Path, obj):
    tmp = path.with_suffix(path.suffix + f'.tmp{os.getpid()}')
    tmp.write_text(json.dumps(obj, indent=1, default=str))
    for i in range(6):                       # OneDrive can hold files open (EPERM): retry, then write in place
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.3 * (i + 1))
    path.write_text(tmp.read_text())
    tmp.unlink(missing_ok=True)


class RunWriter:
    def __init__(self, product, init, manifest):
        self.product = product
        self.id = run_id(product, init)
        self.root = DATA / product
        self.final = self.root / self.id
        self.dir = self.root / (self.id + '.partial')
        if self.final.exists():
            raise FileExistsError(f'{self.id} already exists — refusing to overwrite a stored run')
        if self.dir.exists():
            shutil.rmtree(self.dir)
        (self.dir / 'frames').mkdir(parents=True)
        self.manifest = dict(manifest, run_id=self.id, product=product, frames=[], fields={})

    def frame(self, lead_min, valid, fields: dict, meta: dict):
        d = self.dir / 'frames' / str(lead_min)
        d.mkdir(parents=True, exist_ok=True)
        stats = {}
        for name, a in fields.items():
            a = np.asarray(a)
            if a.dtype.kind in 'iub':
                buf, dt = a.astype(np.int8).tobytes(), 'int8'
            else:
                buf, dt = np.clip(a, -65000, 65000).astype(np.float16).tobytes(), 'float16'   # float16 range
            (d / f'{name}.bin').write_bytes(zlib.compress(buf, 6))
            fin = a[np.isfinite(a)] if a.dtype.kind == 'f' else a.ravel()
            stats[name] = {'min': float(fin.min()) if fin.size else None, 'max': float(fin.max()) if fin.size else None,
                           'nan_frac': float(1 - fin.size / a.size), 'dtype': dt}
            self.manifest['fields'].setdefault(name, dt)
        self.manifest['frames'].append(dict(meta, lead_min=lead_min, lead_h=lead_min / 60, valid=valid, stats=stats))

    def publish(self, status):
        self.manifest['status'] = status
        self.manifest['published_utc'] = datetime.now(timezone.utc).isoformat()
        _write_json(self.dir / 'manifest.json', self.manifest)
        os.replace(self.dir, self.final)
        if status in ('published', 'degraded'):
            _write_json(self.root / 'latest.json', {'run_id': self.id, 'status': status, 'init': self.manifest['init_utc']})
        return self.final

    def abandon(self, reason):
        self.manifest['status'] = 'failed'
        self.manifest['failure'] = reason
        _write_json(self.dir / 'manifest.json', self.manifest)


def set_status(product, **kw):
    p = DATA / product / 'status.json'
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        cur = json.loads(p.read_text())
    except Exception:
        cur = {}
    cur.update(kw, updated_utc=datetime.now(timezone.utc).isoformat())
    hist = cur.setdefault('history', [])
    if 'state' in kw:
        hist.append({'state': kw['state'], 'at': cur['updated_utc'], 'run_id': kw.get('run_id', cur.get('run_id'))})
        cur['history'] = hist[-60:]
    _write_json(p, cur)


def read_frame(product, rid, lead_min, field, shape):
    raw = zlib.decompress((DATA / product / rid / 'frames' / str(lead_min) / f'{field}.bin').read_bytes())
    dt = np.int8 if len(raw) == shape[0] * shape[1] else np.float16
    return np.frombuffer(raw, dt).reshape(shape)


def prune(product, keep):
    runs = sorted(p for p in (DATA / product).glob(f'{product}-*') if p.is_dir() and not p.name.endswith('.partial'))
    for p in runs[:-keep]:
        shutil.rmtree(p, ignore_errors=True)
    for p in (DATA / product).glob('*.partial'):
        if time.time() - p.stat().st_mtime > 6 * 3600:
            shutil.rmtree(p, ignore_errors=True)
