"""MWUK Mix: MyWeatherUK's blend of the Met Office UKV (2 km) and DWD ICON-EU (6.5 km), on the UKV's
own 2 km grid (15 Nov 2026, at the user's request: "the UKV and ICON combined into 1 model").

Runs. Each Mix run is a UKV run that reaches at least T+54 (every three hours; T+120 at 03Z and 15Z),
paired with the newest ICON-EU main run (00/06/12/18Z, to T+120) at least three hours older than it.
ICON publishes about 3.5 hours after its time and the UKV about 2, so by the time a UKV run is listed
its partner is already complete, and the pair never changes afterwards. The Mix has the UKV run's
steps that the ICON run covers where both models give their own fields: hourly to T+54, then every
three hours (most UKV fields are three-hourly from there; ICON's are from T+78, and the long UKV
runs, 03Z and 15Z, pair with ICON runs three hours older, so the steps line up), never an hour made
up by drawing between two.

Making a layer. The source layers it needs that are not made yet are made here, all at once, each
starting from the step on screen; a Mix step is made as soon as its own source frames are written
(_frame waits for them), so the first frame shows in seconds, not once every source layer is done.

Steps. Each is made from the two models' own frames at the same valid time (both are on this grid):
  * most fields: a weighted mean, the UKV 60 % over the first day (it is the finer model, and the
    Met Office's own for the UK), easing to an even split by T+48;
  * rain and snow rates: probability matched. The weighted mean gives where; the intensities are the
    weighted mean of the two models' own distributions, so a shower keeps its strength instead of
    being halved where the two models put it a few miles apart, and the rain area is as large as the
    two models' on average, not the union of both;
  * wind direction: from the blended components (each model's speed and direction);
  * ICON's freezing level is above sea level: brought to above the ground first, as the UKV's is.
Where one model has nothing at a cell (the edge of the ICON area, a cloud base where it has no cloud)
the other's value is used. The weather symbols, precipitation type, fog, gust peaks and snow depth
are then made from the Mix's own fields, as for every other model (mdata/job.py).

The snow conditions index is the exception: it is each model's own index (made from that model's
own fields, mdata/derived.py), probability matched like the rain. Made from the blended fields, it
lost what either model alone shows: a model's heavier precipitation comes with its own colder air
beneath it, and with the two averaged, one model's rain over the other's milder air lifted nothing
(16 Nov 2026 21Z: ICON-EU's Low across the Midlands to East Anglia, gone from the Mix).
"""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA, FRAMES, read_frame

# fields both models have, blended directly (the others come from these: job.py derived/alias/peak)
BLEND = ['precip_rate', 'rain_rate', 'precip_total', 'snow_rate', 'snow_total', 'snow_swe', 'frz',
         't2', 'td2', 'rh2', 'tskin', 'feels', 'windchill', 'wind10', 'wdir10', 'gust10', 'mslp',
         'tcc', 'lcc', 'mcc', 'hcc', 'cloud_base', 'vis', 'kindex', 'wbpt850', 't925', 't850', 't700', 't500',
         'z850', 'z500', 'thick', 'rh850', 'rh700', 'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 'sw_down']
MATCHED = {'precip_rate', 'rain_rate', 'snow_rate'}
SOURCES = ('ukv', 'icon')
_LOCK = threading.Lock()
_POOL = ThreadPoolExecutor(24, thread_name_prefix='mix-source')    # source layers being made here, all at once
_JOBS = {}                                                          # (model, run iso, var) -> its Future


def _utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc)


def pairs(ukv_runs, icon_runs):
    """The Mix runs from the catalogue's UKV and ICON entries: [{run, steps, complete, pair}]."""
    mains = [(_utc(r['run']), r) for r in icon_runs if _utc(r['run']).hour % 6 == 0 and r.get('complete')]
    out = []
    for u in ukv_runs:
        if not u.get('steps') or max(u['steps']) < 54 or u.get('kept') and max(u['steps']) < 120:
            continue
        ut = _utc(u['run'])
        partner = max((x for x in mains if x[0] <= ut - timedelta(hours=3)), key=lambda x: x[0], default=None)
        if partner is None:
            continue
        it, ir = partner
        top = it + timedelta(hours=max(ir['steps']))
        steps = [h for h in u['steps'] if (h <= 54 or h % 3 == 0) and ut + timedelta(hours=h) <= top]
        if steps:
            out.append({'run': u['run'], 'steps': steps, 'complete': bool(u.get('complete')),
                        'pair': {'ukv': u['run'], 'icon': ir['run']}, **({'kept': True} if u.get('kept') else {})})
    return out


def weight(h):
    """The UKV's share at lead h: 60 % to T+24, an even split from T+48."""
    return 0.6 if h <= 24 else 0.5 if h >= 48 else 0.6 - 0.1 * (h - 24) / 24


def matched(a, b, w):
    """Probability-matched blend: the weighted mean's pattern, carrying the weighted mean of the two
    fields' own distributions (their sorted values), rank for rank."""
    m = np.where(np.isfinite(a) & np.isfinite(b), w * a + (1 - w) * b, np.where(np.isfinite(a), a, b))
    ok = np.isfinite(m)
    n = int(ok.sum())
    if n < 2:
        return m.astype(np.float32)
    q = np.linspace(0.0, 1.0, n)
    def quant(x):
        v = np.sort(x[np.isfinite(x)])
        return np.interp(q, np.linspace(0.0, 1.0, v.size), v) if v.size > 1 else np.full(n, v[0] if v.size else 0.0)
    target = w * quant(a) + (1 - w) * quant(b)
    out = m.copy()
    idx = np.flatnonzero(ok)
    out.flat[idx[np.argsort(m.flat[idx], kind='stable')]] = target
    return out.astype(np.float32)


class MixModel:
    id, label, res_km = 'mix', 'MWUK Mix (UKV + ICON-EU)', 2.0
    variables = BLEND + ['ptype', 'wx', 'fog_vis', 'gust_peak', 'snow_acc', 'snow_cond']

    def __init__(self):
        self._pairs = {}
        self._orog = None

    def runs(self, n=None):
        return []                         # listed by catalog.py mix_entry, from the UKV and ICON entries

    def entry(self, run):
        """A Mix run's catalogue entry: the catalogue's own, or (before it lists the Mix) worked out from
        its UKV and ICON entries the same way."""
        key = run.isoformat()
        if key not in self._pairs:
            cat = json.loads((DATA / 'catalog.json').read_text())
            by = {m['id']: m for m in cat['models']}
            runs = by['mix']['runs'] if 'mix' in by else pairs(by.get('ukv', {}).get('runs', []), by.get('icon', {}).get('runs', []))
            r = next((x for x in runs if _utc(x['run']) == run), None)
            if r is None:
                raise KeyError(f'MWUK Mix has no run {key}')
            self._pairs[key] = r
        return self._pairs[key]

    def pair(self, run):
        """The UKV and ICON runs behind a Mix run."""
        r = self.entry(run)
        return _utc(r['pair']['ukv']), _utc(r['pair']['icon'])

    def steps(self, run):
        return self.entry(run)['steps']

    @staticmethod
    def inputs(var, src='ukv'):
        """The fields of model `src` a Mix field is made from."""
        if var == 'snow_cond':
            from .derived import snow_cond_inputs
            from .models import MODELS
            return snow_cond_inputs(MODELS[src].variables)
        if var == 'frz' and src == 'icon':
            return ['frz', 'orog']
        return ['wind10', 'wdir10'] if var == 'wdir10' else [var]

    def prepare(self, run, var, first=None):
        """Start making both models' layers that this field needs and that are not complete (a run still
        arriving is topped up), all at once, each from the step on screen. Returns at once: each Mix
        step waits only for its own source frames (_frame)."""
        from .job import main as make_frames, steps_for
        u_run, i_run = self.pair(run)
        jobs = []
        for src, srun in (('ukv', u_run), ('icon', i_run)):
            want = len(steps_for(src, srun))
            for v in self.inputs(var, src):
                st = FRAMES / src / f'{srun:%Y%m%dT%H%MZ}' / v / 'status.json'
                try:
                    s_ = json.loads(st.read_text())
                    done = s_.get('state') == 'complete' and len(s_.get('steps', [])) >= want
                except Exception:
                    done = False
                if not done:
                    f = None if first is None else int(first) + (0 if src == 'ukv' else int((u_run - i_run).total_seconds() // 3600))
                    jobs.append((src, srun.isoformat(), v, f))
        each = max(3, min(16, 48 // max(1, len(jobs))))    # downloads in flight shared out: about 48 in all
        with _LOCK:
            for src, srun_s, v, f in jobs:
                key = (src, srun_s, v)
                if key not in _JOBS or _JOBS[key].done():
                    _JOBS[key] = _POOL.submit(make_frames, src, srun_s, v, f, each)

    @staticmethod
    def _await(src, srun, var, lead):
        """While this process is still making that source layer, wait for its frame at `lead` (it is
        written whole: write_frame renames it into place). Once the layer is done, what it made is used."""
        fut = _JOBS.get((src, srun.isoformat(), var))
        if fut is None:
            return
        p = FRAMES / src / f'{srun:%Y%m%dT%H%MZ}' / var / f'{int(round(lead))}.bin'
        while not fut.done() and not p.exists():
            time.sleep(0.2)

    @staticmethod
    def _read(p):
        """A frame, read again a moment later if it cannot be read whole: a frame the drive would not let
        be renamed into place is written where it stands (common._replace), and can be caught half-way
        (15 Nov 2026: three steps of a Mix layer lost while its source layers were being made)."""
        for i in range(6):
            try:
                return read_frame(p)[0]
            except Exception:
                if i == 5:
                    raise
                time.sleep(0.3 * (i + 1))

    def _frame(self, src, srun, var, lead):
        """A source frame at a lead (hours), linear in time between its steps where it has none there."""
        self._await(src, srun, var, lead)
        d = FRAMES / src / f'{srun:%Y%m%dT%H%MZ}' / var
        p = d / f'{int(round(lead))}.bin'
        if abs(lead - round(lead)) < 1e-6 and p.exists():
            return self._read(p)
        have = sorted(int(x.stem) for x in d.glob('*.bin') if x.stem.isdigit())
        lo = max((h for h in have if h <= lead), default=None)
        hi = min((h for h in have if h >= lead), default=None)
        if lo is None or hi is None:
            raise FileNotFoundError(f'{src} {var} has no frame near T+{lead}')
        a = self._read(d / f'{lo}.bin')
        if hi == lo or var in ('wdir10',):
            return a
        t = (lead - lo) / (hi - lo)
        return a + t * (self._read(d / f'{hi}.bin') - a)

    def field(self, run, h, var, prev_h, prev_raw=None):
        u_run, i_run = self.pair(run)
        vt = run + timedelta(hours=h)
        lu = (vt - u_run).total_seconds() / 3600
        li = (vt - i_run).total_seconds() / 3600
        w = weight(lu)
        if var == 'wdir10':
            def comp(src, srun, lead):
                s = self._frame(src, srun, 'wind10', lead)
                d = np.radians(self._frame(src, srun, 'wdir10', lead))
                return -s * np.sin(d), -s * np.cos(d)
            (ua, va), (ub, vb) = comp('ukv', u_run, lu), comp('icon', i_run, li)
            uu, vv = self._mean(ua, ub, w), self._mean(va, vb, w)
            return np.mod(np.degrees(np.arctan2(-uu, -vv)), 360.0).astype(np.float32)
        if var == 'snow_cond':                               # each model's own index, matched (the docstring)
            from .common import DX
            from .derived import snow_cond_score, snow_cond_steps
            s_u = snow_cond_score({v: self._frame('ukv', u_run, v, lu) for v in self.inputs(var, 'ukv')}, DX / 1000.0)
            s_i = snow_cond_score({v: self._frame('icon', i_run, v, li) for v in self.inputs(var, 'icon')}, DX / 1000.0)
            return snow_cond_steps(matched(s_u, s_i, w))
        a = self._frame('ukv', u_run, var, lu)
        b = self._frame('icon', i_run, var, li)
        if var in ('precip_total', 'snow_total'):            # ICON's totals run from its own start, earlier: from the Mix's
            l0 = (u_run - i_run).total_seconds() / 3600
            b = np.maximum(b - self._frame('icon', i_run, var, l0), 0) if l0 > 0 else b
        if var == 'frz':                                     # ICON's 0 C level is above sea level
            if self._orog is None:                           # its hills: the same in every frame (this step's comes first)
                self._orog = self._frame('icon', i_run, 'orog', li)
            b = np.maximum(b - np.nan_to_num(self._orog), 0)
        if var in MATCHED:
            return matched(a, b, w)
        return self._mean(a, b, w)

    @staticmethod
    def _mean(a, b, w):
        both = np.isfinite(a) & np.isfinite(b)
        return np.where(both, w * a + (1 - w) * b, np.where(np.isfinite(a), a, b)).astype(np.float32)
