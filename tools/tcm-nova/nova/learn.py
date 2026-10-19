"""Nightly learning cycle (runs at 00:00 Europe/London, scheduled by server/tcmNova.js).

    python -m nova.learn [--day 2026-10-18]

For the UK calendar day that just ended:
  1. COLLECT every Main Run and Hyper-Short frame valid during the day.
  2. OBSERVE: radar convective cores (>= 25 mm/h) and Met Office LEELA lightning
     (the feed holds 48 h, so at midnight the whole day is available), within each
     frame's neighbourhood and ±90 min.
  3. SCORE per product and lead window: Brier, BSS, POD/FAR/CSI at 30 %, reliability
     bins, bias; peak-timing error; per-source FSS (Main Run).
  4. DIAGNOSE: compare the environment at hits, misses and false alarms (MUCAPE, MLCIN,
     0–6 km shear, terrain ascent, landform, source disagreement, nowcast weight, lead)
     — "why it was right or wrong", quantified.
  5. LEARN (statistics only, never a language model):
       - append the day's thinned (p_raw, event) pairs to the learning store;
       - retrain source skill -> dynamic model weights;
       - refit the calibration curves on hindcasts + the rolling 60 days of live pairs,
         per product, accepted only if the leave-one-day-out Brier score improves.
  6. EXPLAIN: a written analysis. If ANTHROPIC_API_KEY is set, Claude writes it from the
     numbers in step 3–5 (it cannot change any model setting); otherwise a rule-based
     summary is written. Report -> <DATA>/learning/reports/<day>.json.
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

from . import ai_cal, calibrate, store, terrain
from .regions import REGIONS, region_map
from .config import DATA, REPO
from .grid import Grid
from .hyper import obs
from .io_aws import log
from .weights import window_index

LDIR = DATA / 'learning'
LONDON = ZoneInfo('Europe/London')
GRIDS = {'main': 'gb2km', 'hyper': 'gb1p5km'}
DIAG_FIELDS = ['mu_cape', 'ml_cin', 'shear_0_6km', 'w_oro', 'source_disagreement', 'confidence']
CLASS_NAMES = {0: 'flat/open', 1: 'ridge', -1: 'valley', 2: 'slope', 9: 'sea'}


def day_bounds(day):
    a = datetime(day.year, day.month, day.day, tzinfo=LONDON)
    return a.astimezone(timezone.utc), (a + timedelta(days=1)).astimezone(timezone.utc)


def leela_array(now):
    try:
        strikes, _ = obs.lightning(now, 2880)
    except Exception as e:
        log(f'learn: lightning unavailable: {e}')
        return None
    if not strikes:
        return np.zeros((0, 3))
    return np.array([(t.timestamp(), la, lo) for t, la, lo in strikes])


def score(p, ev):
    yes = p >= 0.3
    a, b, c = int((yes & ev).sum()), int((yes & ~ev).sum()), int((~yes & ev).sum())
    bs = float(np.mean((p - ev) ** 2))
    clim = float(ev.mean())
    return {'brier': bs, 'bss': None if clim in (0, 1) else 1 - bs / (clim * (1 - clim)), 'event_rate': clim,
            'mean_p': float(p.mean()), 'hits': a, 'false_alarms': b, 'misses': c,
            'pod': a / (a + c) if a + c else None, 'far': b / (a + b) if a + b else None,
            'csi': a / (a + b + c) if a + b + c else None}


def analyse_product(product, day, strikes, now):
    t0, t1 = day_bounds(day)
    grid = Grid.get(GRIDS[product])
    terr = terrain.load(grid.name)
    land = terr['landform_class'][::calibrate.THIN, ::calibrate.THIN].ravel()
    reg_full = region_map(grid, terr['land_frac'])
    static = {k: np.asarray(v)[::calibrate.THIN, ::calibrate.THIN].ravel() for k, v in ai_cal.static_fields(terr, reg_full).items()}
    regs = static['region']
    by_win, pairs, groups = {}, [], {'hit': {}, 'miss': {}, 'false_alarm': {}}
    by_region = {}
    peak_fc, peak_ob = {}, {}
    for rd in sorted((DATA / product).glob(f'{product}-*')):
        if rd.name.endswith('.partial') or not calibrate.same_grid(rd, grid) or not calibrate.engine_ok(rd, product):
            continue
        m = json.loads((rd / 'manifest.json').read_text())
        raw_name = 'p_thunder_uncal' if 'p_thunder_uncal' in m['fields'] else 'p_thunder'
        for fr in m['frames']:
            if not fr.get('valid'):
                continue
            vt = datetime.fromisoformat(fr['valid'])
            if not (t0 <= vt < t1) or vt > now - timedelta(minutes=90):
                continue
            if product == 'hyper' and fr['lead_min'] % 60:          # hourly is plenty for learning
                continue
            r = (fr.get('neighbourhood_km') or (10 + 0.35 * fr['lead_h'])) * 1000 / grid.dx
            ev = calibrate.observed_events(grid, vt, r, strikes)
            if ev is None:
                continue
            p = store.read_frame(product, rd.name, fr['lead_min'], 'p_thunder', grid.shape).astype(np.float32)
            praw = store.read_frame(product, rd.name, fr['lead_min'], raw_name, grid.shape).astype(np.float32)
            T = calibrate.THIN
            pp, pr, oo = p[::T, ::T].ravel(), praw[::T, ::T].ravel(), ev[::T, ::T].ravel()
            ok = np.isfinite(pp) & np.isfinite(pr)
            wi = str(window_index(fr['lead_h']))
            by_win.setdefault(wi, {'p': [], 'o': []})
            by_win[wi]['p'].append(pp[ok]); by_win[wi]['o'].append(oo[ok])
            env = {f: store.read_frame(product, rd.name, fr['lead_min'], f, grid.shape).astype(np.float32)[::T, ::T].ravel()
                   for f in ai_cal.ENV_FIELDS if f in m['fields']}
            X = ai_cal.features(pr, fr['lead_h'], env, static, product)[ok]
            pairs.append((wi, pr[ok], oo[ok].astype(np.float32), X))
            for ri, rn in enumerate(REGIONS):
                sel = ok & (regs == ri)
                if sel.any():
                    by_region.setdefault(rn, {'p': [], 'o': []})
                    by_region[rn]['p'].append(pp[sel]); by_region[rn]['o'].append(oo[sel])
            peak_fc.setdefault(rd.name, []).append((vt, float(pp[ok].mean())))
            peak_ob.setdefault(vt, float(oo.mean()))
            # environment at hits / misses / false alarms
            cls = {'hit': (pp >= 0.3) & oo, 'miss': (pp < 0.15) & oo, 'false_alarm': (pp >= 0.4) & ~oo}
            env = {}
            for f in DIAG_FIELDS:
                if f in m['fields']:
                    env[f] = store.read_frame(product, rd.name, fr['lead_min'], f, grid.shape).astype(np.float32)[::T, ::T].ravel()
            for g, mask in cls.items():
                mask = mask & ok
                if not mask.any():
                    continue
                G = groups[g]
                G['n'] = G.get('n', 0) + int(mask.sum())
                G.setdefault('lead_h', []).append(float(fr['lead_h']))
                for f, a in env.items():
                    G.setdefault(f, []).append(float(np.nanmean(a[mask])))
                lf = land[mask] if land.size == mask.size else np.array([])
                for c in np.unique(lf):
                    G.setdefault('landform', {}).setdefault(CLASS_NAMES.get(int(c), str(c)), 0)
                    G['landform'][CLASS_NAMES.get(int(c), str(c))] += int((lf == c).sum())
    scores = {}
    for wi, d in by_win.items():
        scores[wi] = score(np.concatenate(d['p']), np.concatenate(d['o']).astype(bool))
    diag = {}
    for g, G in groups.items():
        if G:
            diag[g] = {k: (round(float(np.mean(v)), 3) if isinstance(v, list) else v) for k, v in G.items()}
    # peak timing: hour of max observed coverage vs hour of max forecast mean p, per run
    timing = []
    if peak_ob:
        ob_peak = max(peak_ob, key=peak_ob.get)
        for rid, seq in peak_fc.items():
            fpk = max(seq, key=lambda x: x[1])[0]
            timing.append((fpk - ob_peak).total_seconds() / 3600)
    region_scores = {rn: score(np.concatenate(d['p']), np.concatenate(d['o']).astype(bool)) for rn, d in by_region.items()}
    return {'scores_by_window': scores, 'scores_by_region': region_scores, 'diagnosis': diag,
            'peak_timing_error_h': {'mean': float(np.mean(timing)), 'n_runs': len(timing)} if timing else None,
            'observed_peak_utc': max(peak_ob, key=peak_ob.get).isoformat() if peak_ob else None}, pairs


def rule_based_explanation(rep):
    lines = []
    for prod, r in rep['products'].items():
        for wi, s in sorted(r['scores_by_window'].items()):
            if s['event_rate'] == 0 and s['mean_p'] < 0.02:
                lines.append(f'{prod} {wi}: a quiet day correctly forecast as quiet.')
                continue
            bias = s['mean_p'] - s['event_rate']
            what = 'over-forecast' if bias > 0.02 else 'under-forecast' if bias < -0.02 else 'well calibrated on average'
            lines.append(f"{prod} window {wi}: {what} (mean p {s['mean_p']:.2f} vs observed {s['event_rate']:.2f}); "
                         f"POD {s['pod'] if s['pod'] is None else round(s['pod'], 2)}, FAR {s['far'] if s['far'] is None else round(s['far'], 2)}.")
        d = r['diagnosis']
        if 'miss' in d and 'hit' in d and 'mu_cape' in d['miss'] and 'mu_cape' in d['hit']:
            if d['miss']['mu_cape'] < 0.5 * d['hit']['mu_cape']:
                lines.append(f'{prod}: misses happened where the blended MUCAPE was low ({d["miss"]["mu_cape"]:.0f} vs {d["hit"]["mu_cape"]:.0f} J/kg at hits) — the models under-did instability there.')
        if 'false_alarm' in d and 'ml_cin' in d['false_alarm'] and d['false_alarm']['ml_cin'] < -100:
            lines.append(f'{prod}: false alarms sat under strong inhibition (MLCIN {d["false_alarm"]["ml_cin"]:.0f} J/kg) — the cap held.')
        if 'false_alarm' in d and 'w_oro' in d['false_alarm'] and d['false_alarm']['w_oro'] > 0.1:
            lines.append(f'{prod}: false alarms clustered on windward slopes (mean orographic ascent {d["false_alarm"]["w_oro"]:.2f} m/s) — terrain lift was over-weighted.')
        rs = r.get('scores_by_region') or {}
        worst = sorted(((k, v) for k, v in rs.items() if v['event_rate'] > 0 or v['mean_p'] > 0.02),
                       key=lambda kv: -abs(kv[1]['mean_p'] - kv[1]['event_rate']))
        for k, v in worst[:2]:
            b = v['mean_p'] - v['event_rate']
            if abs(b) > 0.02:
                lines.append(f"{prod}: largest regional bias over {k} ({'over' if b > 0 else 'under'}-forecast by {abs(b) * 100:.0f} points).")
        if r.get('peak_timing_error_h'):
            lines.append(f"{prod}: forecast peak activity was {r['peak_timing_error_h']['mean']:+.1f} h from the observed peak on average.")
    return ' '.join(lines)


def ai_explanation(rep):
    key = os.environ.get('ANTHROPIC_API_KEY')
    if not key:
        envf = REPO / '.env'
        if envf.exists():
            for l in envf.read_text().splitlines():
                if l.startswith('ANTHROPIC_API_KEY='):
                    key = l.split('=', 1)[1].strip()
    if not key:
        return None
    prompt = ('You are the verification analyst for TCM NOVA, a UK thunderstorm forecasting model. Below is the '
              'objective verification of yesterday\'s forecasts against radar convective cores and lightning, with the '
              'environment at hits, misses and false alarms, and what the statistical learning step changed. Write a '
              'concise analysis (max 250 words) for the forecaster: what went right, what went wrong and the most likely '
              'physical reasons, citing the numbers. Do not invent data beyond what is given. You cannot change model '
              'settings; suggest at most two things to watch.\n\n' + json.dumps({k: v for k, v in rep.items() if k != 'ai_analysis'}, default=str)[:60000])
    body = json.dumps({'model': os.environ.get('NOVA_LLM_MODEL', 'claude-opus-5-5'), 'max_tokens': 900,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body, headers={
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read())
        return ''.join(b.get('text', '') for b in d.get('content', []))
    except Exception as e:
        log(f'learn: AI analysis failed ({type(e).__name__})')
        return None


def run(day=None):
    now = datetime.now(timezone.utc)
    day = day or (now.astimezone(LONDON) - timedelta(days=1)).date()
    store.set_status('learning', state='running', day=str(day))
    strikes = leela_array(now)
    local = calibrate.local_strikes()
    if strikes is not None and local is not None:
        strikes = np.concatenate([strikes, local])
    elif strikes is None:
        strikes = local
    rep = {'day': str(day), 'generated_utc': now.isoformat(), 'products': {},
           'observations': {'radar': 'Met Office 1 km composite', 'lightning': 'LEELA (48 h) + site archive',
                            'event': f'radar >= {calibrate.CORE_MMH} mm/h or lightning, within neighbourhood, ±90 min'}}
    (LDIR / 'pairs').mkdir(parents=True, exist_ok=True)
    for product in ('main', 'hyper'):
        res, pairs = analyse_product(product, day, strikes, now)
        rep['products'][product] = res
        if pairs:
            np.savez_compressed(LDIR / 'pairs' / f'{product}-{day}.npz',
                                **{f'{i}_{wi}_p': p for i, (wi, p, o, X) in enumerate(pairs)},
                                **{f'{i}_{wi}_o': o for i, (wi, p, o, X) in enumerate(pairs)},
                                **{f'{i}_{wi}_X': X.astype(np.float16) for i, (wi, p, o, X) in enumerate(pairs)})
    # learning: weights from skill, calibration from hindcasts + live pairs
    before = _read(DATA / 'calibration.json')
    try:
        skill = calibrate.train_skill()
        rep['skill_update'] = {wi: {m: round(v['fss'], 3) for m, v in d.items()} for wi, d in skill.get('thunder', {}).items()}
    except Exception as e:
        rep['skill_update'] = f'failed: {e}'
    try:
        cal = calibrate.fit(live_days=60)
        rep['calibration_update'] = _cal_summary(before, cal)
    except Exception as e:
        rep['calibration_update'] = f'failed: {e}'
    try:
        rep['nova_ai'] = json.loads((DATA / 'nova_ai.json').read_text())
        rep['nova_ai'].pop('model', None)
    except Exception:
        rep['nova_ai'] = None
    rep['rule_based_analysis'] = rule_based_explanation(rep)
    rep['ai_analysis'] = ai_explanation(rep)
    rep['ai_analysis_status'] = 'written by Claude from the verification numbers' if rep['ai_analysis'] else \
        'not available (set ANTHROPIC_API_KEY in .env to enable)'
    (LDIR / 'reports').mkdir(parents=True, exist_ok=True)
    store._write_json(LDIR / 'reports' / f'{day}.json', rep)
    store._write_json(LDIR / 'latest.json', {'day': str(day), 'file': f'reports/{day}.json'})
    store.set_status('learning', state='published', day=str(day))
    return rep


def _read(p):
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def _cal_summary(before, after):
    out = {}
    for field in ('p_thunder', 'p_lightning', 'hyper_p_thunder'):
        for wi, c in (after.get(field) or {}).items():
            b = (before.get(field) or {}).get(wi, {})
            out[f'{field}/{wi}'] = {'applied': c.get('applied'), 'was_applied': b.get('applied'), 'n_days': c.get('n_days'),
                                   'brier_cv_raw': c.get('brier_raw_cv'), 'brier_cv_calibrated': c.get('brier_calibrated_cv')}
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--day')
    a = ap.parse_args()
    r = run(datetime.fromisoformat(a.day).date() if a.day else None)
    print(json.dumps({'day': r['day'], 'analysis': r['rule_based_analysis'][:800], 'ai': r['ai_analysis_status']}, indent=1))
