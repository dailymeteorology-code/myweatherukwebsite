"""MWUK Consensus: the middle of every model's forecast (16 Nov 2026, at the user's request: "a
consensus map, the median of all models", with "an agreement / spread layer").

Members. The nine single models that cover the whole of the UK and Ireland: the Met Office UKV and
Global, ECMWF IFS and AIFS, NOAA GFS and AIGFS, DWD ICON-EU, Canada's GDPS and Meteo-France's ARPEGE.
Blends and ensemble means are left out (they would count a model twice, or a smoothed one), and so are
the models that cover only part of the map (AROME, HARMONIE), whose edges would show as seams.

Runs. A Consensus run is named by a main hour (00, 06, 12 or 18 UTC). It is listed once at least
three members have a whole run of that hour and six or more have one no more than 12 hours older:
each member gives its newest whole run of that hour or before that reaches two days or more, so a slow
model takes part with its last run. Who takes part is fixed the first time the run is listed
(DATA/consensus.json), so its frames never mix two sets of models.

Steps. Every three hours to T+120, then every six to T+240, while at least four members reach that
far; a member with no step at that valid time is drawn between its two nearest steps.

Layers, on the UKV's 2 km grid (the global models drawn up onto it smoothly):
  * precip_rate, t2, mslp, wind10, gust10, tcc, t850, z500: the median of the members that give it;
  * wdir10: the direction of the members' mean wind;
  * rain_agree: the share of the members giving rain there (0.2 mm/h or more);
  * t2_spread, mslp_spread: how far apart the members are (their standard deviation).
A member's layers that are not made yet are made first: those on this grid here, those on the wide
grid each in a process of its own (a process works on one grid, mdata/common.py).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA, GRID, GRIDS, ROOT, STATIC, frames_root, grid_of, lonlat, read_frame, smooth_sample, write_json

MEMBERS = ('ukv', 'icon', 'mo_global', 'ifs', 'aifs', 'gfs', 'aigfs', 'gdps', 'arpege')
MEDIAN = ['precip_rate', 't2', 'mslp', 'wind10', 'gust10', 'tcc', 't850', 'z500']
VARS = MEDIAN + ['wdir10', 'rain_agree', 't2_spread', 'mslp_spread']
SRC_OF = {'rain_agree': ['precip_rate'], 't2_spread': ['t2'], 'mslp_spread': ['mslp'], 'wdir10': ['wind10', 'wdir10']}
RAIN = 0.2                     # mm/h: a member gives rain there
MIN_MEMBERS = 4                # a step is listed while at least this many members reach it
MIN_NOW = 3                    # and made while at least this many have a frame there
STATE = DATA / 'consensus.json'
LEADS = list(range(0, 121, 3)) + list(range(126, 241, 6))

SOURCE_CONS = ('MWUK Consensus: the median of nine models (Met Office UKV and Global, ECMWF IFS and AIFS, NOAA GFS and AIGFS, '
               'DWD ICON-EU, ECCC GDPS, Meteo-France ARPEGE), on the UKV 2 km grid')
VARIABLES_CONS = {
    'rain_agree': dict(label='Models showing rain', unit='%', group='Precipitation', lo=0, hi=100),
}

_LOCK = threading.Lock()
_POOL = ThreadPoolExecutor(6, thread_name_prefix='consensus-member')   # members' layers being made here, a few at once
_JOBS = {}                                                             # (model, run iso, var) -> its Future
_COMBINE = threading.Semaphore(3)                                      # nine full fields at once is ~40 MB: a few steps at a time


def _utc(s):
    return datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(timezone.utc)


def _choose(models, R):
    """Each member's run for a Consensus run R, from the catalogue's entries: its newest whole run of
    R's hour or before, reaching two days or more, no more than 12 hours older than R."""
    by = {m['id']: m for m in models}
    out = {}
    for mid in MEMBERS:
        best = None
        for r in by.get(mid, {}).get('runs', []):
            t = _utc(r['run'])
            if t > R or R - t > timedelta(hours=12) or not r.get('complete') or not r.get('steps') or max(r['steps']) < 48:
                continue
            if best is None or t > best[0]:
                best = (t, r['steps'])
        if best:
            out[mid] = best
    return out


def _steps(R, chosen):
    """The leads a run has: those at least MIN_MEMBERS members reach."""
    out = []
    for h in LEADS:
        vt = R + timedelta(hours=h)
        n = sum(1 for t, st in chosen.values() if st and st[0] <= (vt - t).total_seconds() / 3600 <= st[-1])
        if n >= MIN_MEMBERS:
            out.append(h)
    return out


def catalog_entry(models, save=True):
    """The Consensus's catalogue entry from the members' entries (the last day's runs, newest first),
    who takes part in each run fixed the first time it is listed."""
    try:
        state = json.loads(STATE.read_text())
    except Exception:
        state = {}
    now = datetime.now(timezone.utc)
    base = now.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 6)
    runs = []
    for k in range(5):
        R = base - timedelta(hours=6 * k)
        key = R.isoformat()
        if key not in state:
            chosen = _choose(models, R)
            if len(chosen) < 6 or sum(1 for t, _ in chosen.values() if t == R) < 3:
                continue
            state[key] = {'members': {m: t.isoformat() for m, (t, _) in chosen.items()},
                          'msteps': {m: st for m, (_, st) in chosen.items()}, 'listed': now.isoformat()}
        s = state[key]
        steps = _steps(R, {m: (_utc(t), s['msteps'][m]) for m, t in s['members'].items()})
        if steps:
            runs.append({'run': key, 'steps': steps, 'complete': True, 'members': s['members']})
    if save:
        write_json(STATE, {k: v for k, v in state.items() if now - _utc(k) <= timedelta(hours=48)})
    if not runs:
        return None
    return {'id': 'consensus', 'label': 'MWUK Consensus', 'res_km': 2.0, 'grid': grid_of('consensus'), 'source': SOURCE_CONS,
            'variables': VARS, 'runs': runs}


def _subjob(mid, run_s, var, first):
    """A wide-grid member's layer, made by a process of its own on that grid."""
    env = dict(os.environ, MDATA_GRID=grid_of(mid), MDATA_THREADS='6')
    args = [sys.executable, '-m', 'mdata.job', mid, run_s, var] + ([str(int(first))] if first is not None else [])
    subprocess.run(args, cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1800, check=False)


class ConsensusModel:
    id, label, res_km = 'consensus', 'MWUK Consensus', 2.0
    variables = VARS

    def __init__(self):
        self._entries, self._msteps = {}, {}
        self._frac = None
        self._flock = threading.Lock()

    def runs(self, n=None):
        return []                                      # listed by catalog_entry, from the members' entries

    def entry(self, run):
        """A Consensus run's catalogue entry (or, before the catalogue lists it, worked out the same way)."""
        key = run.isoformat()
        if key not in self._entries:
            cat = json.loads((DATA / 'catalog.json').read_text())
            r = None
            for m in cat['models']:
                if m['id'] == 'consensus':
                    r = next((x for x in m['runs'] if _utc(x['run']) == run), None)
            if r is None:
                e = catalog_entry(cat['models'], save=False)
                r = next((x for x in (e or {}).get('runs', []) if _utc(x['run']) == run), None)
            if r is None:
                raise KeyError(f'MWUK Consensus has no run {key}')
            self._entries[key] = r
        return self._entries[key]

    def steps(self, run):
        return self.entry(run)['steps']

    def schedule(self, run):
        return self.steps(run)

    def members(self, run, var):
        """(model, its run) of each member that gives this layer's sources."""
        from .models import MODELS
        srcs = SRC_OF.get(var, [var])
        return [(m, _utc(t)) for m, t in self.entry(run)['members'].items() if all(s in MODELS[m].variables for s in srcs)]

    def prepare(self, run, var, first=None):
        """Start making the members' layers this needs that are not made yet, each from the step on screen.
        Returns at once: each Consensus step waits only for its own member frames (_member)."""
        from .job import main as make_frames
        jobs = []
        for mid, mrun in self.members(run, var):
            for v in SRC_OF.get(var, [var]):
                st = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}' / v / 'status.json'
                try:
                    done = json.loads(st.read_text()).get('state') == 'complete'
                except Exception:
                    done = False
                if not done:
                    f = None if first is None else int(first) + int((run - mrun).total_seconds() // 3600)
                    jobs.append((mid, mrun.isoformat(), v, f))
        with _LOCK:
            for mid, mrun_s, v, f in jobs:
                key = (mid, mrun_s, v)
                if key in _JOBS and not _JOBS[key].done():
                    continue
                if grid_of(mid) == GRID:
                    _JOBS[key] = _POOL.submit(make_frames, mid, mrun_s, v, f, 6)
                else:
                    _JOBS[key] = _POOL.submit(_subjob, mid, mrun_s, v, f)

    def _mstep_list(self, mid, mrun):
        k = (mid, mrun)
        if k not in self._msteps:
            from .job import steps_for
            self._msteps[k] = steps_for(mid, mrun)
        return self._msteps[k]

    @staticmethod
    def _read(p):
        """A frame, read again a moment later if it cannot be read whole (one written in place, mdata/mix.py)."""
        for i in range(6):
            try:
                return read_frame(p)[0]
            except Exception:
                if i == 5:
                    raise
                time.sleep(0.3 * (i + 1))

    def _wait(self, mid, mrun, var, p):
        """While that member layer is being made here, wait for one of its frames."""
        fut = _JOBS.get((mid, mrun.isoformat(), var))
        while fut is not None and not fut.done() and not p.exists():
            time.sleep(0.25)

    def _up(self, a):
        """A wide-grid (10 km) field drawn up onto this grid smoothly (cubic, never overshooting)."""
        with self._flock:
            if self._frac is None:
                f = STATIC / 'frac_from_eu.npz'
                if f.exists():
                    z = np.load(f)
                    fj, fi = z['fj'], z['fi']
                else:
                    from pyproj import Transformer
                    g = GRIDS['eu']
                    tr = Transformer.from_crs('EPSG:4326', f"+proj=laea +lat_0={g['lat0']} +lon_0={g['lon0']} +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs", always_xy=True)
                    lon, lat = lonlat()
                    x, y = tr.transform(lon, lat)
                    fi = ((np.asarray(x) - g['x0']) / g['dx']).ravel()
                    fj = ((g['y_top'] - np.asarray(y)) / g['dx']).ravel()
                    STATIC.mkdir(parents=True, exist_ok=True)
                    np.savez_compressed(f, fj=fj, fi=fi)
                self._frac = (fj, fi, False)
        ok = np.isfinite(a)
        out = smooth_sample(np.where(ok, a, np.nanmean(a) if ok.any() else 0.0), self._frac).astype(np.float32)
        if not ok.all():
            out[smooth_sample(ok.astype(np.float32), self._frac) < 0.5] = np.nan
        return out

    def _member(self, mid, mrun, var, lead):
        """A member's field at a lead (hours) on this grid: between its two nearest steps where it has
        none there (a direction: the nearer one), and a wide-grid model's drawn up onto the 2 km grid."""
        d = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}' / var
        st = self._mstep_list(mid, mrun)
        lo = max((s for s in st if s <= lead + 1e-6), default=None)
        hi = min((s for s in st if s >= lead - 1e-6), default=None)
        if lo is None or hi is None:
            raise KeyError(f'{mid} does not reach T+{lead}')
        pl, ph = d / f'{lo}.bin', d / f'{hi}.bin'
        self._wait(mid, mrun, var, pl)
        if not pl.exists():
            raise FileNotFoundError(f'{mid} {var} has no T+{lo}')
        a = self._read(pl)
        if hi != lo:
            if var == 'wdir10':
                if hi - lead < lead - lo:
                    self._wait(mid, mrun, var, ph)
                    a = self._read(ph) if ph.exists() else a
            else:
                self._wait(mid, mrun, var, ph)
                if not ph.exists():
                    raise FileNotFoundError(f'{mid} {var} has no T+{hi}')
                t = (lead - lo) / (hi - lo)
                a = a + t * (self._read(ph) - a)
        if grid_of(mid) != GRID:
            if var == 'wdir10':
                raise ValueError('a direction is made from its components')
            a = self._up(a)
        return a

    def field(self, run, h, var, prev_h, prev_raw=None):
        vt = run + timedelta(hours=h)
        mems = self.members(run, var)
        lead = lambda mrun: (vt - mrun).total_seconds() / 3600     # noqa: E731
        if var == 'wdir10':
            us, vs = [], []
            for mid, mrun in mems:
                try:
                    s = self._member(mid, mrun, 'wind10', lead(mrun))
                    if grid_of(mid) == GRID:
                        dr = np.radians(self._member(mid, mrun, 'wdir10', lead(mrun)))
                        u, v = -s * np.sin(dr), -s * np.cos(dr)
                    else:                                  # a wide-grid member: its components drawn up, not its angle
                        d = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}'
                        st = self._mstep_list(mid, mrun)
                        near = min(st, key=lambda x: abs(x - lead(mrun)))
                        sw, dw = self._read(d / 'wind10' / f'{near}.bin'), np.radians(self._read(d / 'wdir10' / f'{near}.bin'))
                        u, v = self._up(-sw * np.sin(dw)), self._up(-sw * np.cos(dw))
                    us.append(u)
                    vs.append(v)
                except Exception:
                    continue
            if len(us) < MIN_NOW:
                raise KeyError(f'MWUK Consensus: {len(us)} members at T+{h}')
            with np.errstate(all='ignore'):
                uu, vv = np.nanmean(us, 0), np.nanmean(vs, 0)
            return np.mod(np.degrees(np.arctan2(-uu, -vv)), 360.0).astype(np.float32)
        src = SRC_OF.get(var, [var])[0]
        stack = []
        for mid, mrun in mems:
            try:
                stack.append(self._member(mid, mrun, src, lead(mrun)))
            except Exception:
                continue
        if len(stack) < MIN_NOW:
            raise KeyError(f'MWUK Consensus: {len(stack)} members at T+{h}')
        with _COMBINE:
            A = np.stack(stack)
            with np.errstate(all='ignore'):
                if var == 'rain_agree':
                    n = np.isfinite(A).sum(0)
                    out = 100.0 * (A >= RAIN).sum(0) / np.maximum(n, 1)
                    out[n < MIN_NOW] = np.nan
                elif var in ('t2_spread', 'mslp_spread'):
                    out = np.nanstd(A, 0)
                else:
                    out = np.nanmedian(A, 0) if np.isnan(A).any() else np.median(A, 0)
            return out.astype(np.float32)
