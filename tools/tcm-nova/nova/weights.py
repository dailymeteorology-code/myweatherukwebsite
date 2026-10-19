"""Per-run, per-lead, per-hazard, per-cell model weights.

    1. Baseline table (config.BASELINE) for the lead window of each frame.
    2. Eligibility: a source must be on AWS, have a cycle reaching the valid time, and
       cover the cell. Ineligible weight is renormalised away — never treated as zero data.
    3. Dynamic skill update: weight = baseline^(1-a) · skill^a with a = n/(n+N0), where
       skill comes from verification of each source's recent forecasts against radar and
       lightning observations (verify.py). With no record yet, a = 0: pure baseline.
    4. Hazard emphasis multipliers, then family caps, then renormalise to exactly 1.
Ensemble systems carry ONE weight each, split equally among members.
"""
from __future__ import annotations

import json

import numpy as np

from .config import BASELINE, DATA, FAMILY_CAP, HAZARD_EMPHASIS, MODELS, SKILL_MIN_SAMPLES, SKILL_SHRINK_N0, WINDOWS

SKILL_FILE = DATA / 'skill.json'


def window_index(lead_h):
    for i, (a, b) in enumerate(WINDOWS):
        if a <= lead_h < b or (i == len(WINDOWS) - 1 and lead_h <= b):
            return i
    return len(WINDOWS) - 1


def load_skill():
    try:
        return json.loads(SKILL_FILE.read_text())
    except Exception:
        return {}


def dynamic(lead_h, available, hazard='environment', skill=None):
    """Weights (dict model->fraction summing to 1) over `available` models for a lead time.
    Returns (weights, provenance) where provenance records every step for the manifest."""
    wi = window_index(lead_h)
    base = {m: BASELINE[m][wi] / 100.0 for m in BASELINE}
    elig = {m: base[m] for m in available if base.get(m, 0) > 0}
    prov = {'window': f'{WINDOWS[wi][0]}-{WINDOWS[wi][1]} h', 'baseline': {m: round(v * 100, 2) for m, v in base.items()},
            'ineligible': sorted(set(base) - set(elig))}
    if not elig:
        return {}, prov
    s = sum(elig.values())
    w = {m: v / s for m, v in elig.items()}
    prov['renormalised'] = {m: round(v * 100, 2) for m, v in w.items()}
    skill = load_skill() if skill is None else skill
    key = hazard if hazard in skill else ('thunder_v5' if 'thunder_v5' in skill else 'thunder')
    sk = skill.get(key, {}).get(str(wi), {})
    alpha = {}
    if sk:
        raw = {}
        for m in w:
            rec = sk.get(m)
            if rec and rec.get('n', 0) >= SKILL_MIN_SAMPLES:
                a = rec['n'] / (rec['n'] + SKILL_SHRINK_N0)
                score = max(rec.get('skill', rec.get('fss', 0.0)), 0.01)   # BSS of V5 P(thunder) or precip FSS
                raw[m] = (w[m], score, a)
        if raw:
            mean_score = np.mean([r[1] for r in raw.values()])
            for m, (b, score, a) in raw.items():
                w[m] = b ** (1 - a) * (b * score / mean_score) ** a
                alpha[m] = round(a, 3)
            s = sum(w.values())
            w = {m: v / s for m, v in w.items()}
    prov['skill_alpha'] = alpha
    emph = HAZARD_EMPHASIS.get(hazard, {})
    if emph:
        w = {m: v * emph.get(m, 1.0) for m, v in w.items()}
        s = sum(w.values())
        w = {m: v / s for m, v in w.items()}
    w = cap_families(w)
    prov['final'] = {m: round(v * 100, 2) for m, v in w.items()}
    return w, prov


def cap_families(w, caps=FAMILY_CAP, iters=10):
    """Iteratively cap each modelling centre's share, redistributing the excess
    proportionally to the uncapped families. Only binding when >1 family is present."""
    fams = {}
    for m in w:
        fams.setdefault(MODELS[m]['family'], []).append(m)
    if len(fams) < 2:
        return w
    w = dict(w)
    for _ in range(iters):
        tot = {f: sum(w[m] for m in ms) for f, ms in fams.items()}
        over = {f: t for f, t in tot.items() if t > caps.get(f, 1) + 1e-9}
        if not over:
            break
        free = [f for f in fams if f not in over]
        free_tot = sum(tot[f] for f in free)
        if free_tot <= 0:
            break
        excess = 0.0
        for f, t in over.items():
            k = caps[f] / t
            for m in fams[f]:
                excess += w[m] * (1 - k)
                w[m] *= k
        for f in free:
            for m in fams[f]:
                w[m] += excess * w[m] / free_tot
    s = sum(w.values())
    return {m: v / s for m, v in w.items()}


def cell_weights(weights, valid_masks):
    """Per-cell renormalisation where a source does not cover a cell (e.g. UKV's
    rotated domain edge). Returns {model: (ny, nx) weight} summing to 1 where any covers."""
    num = {m: weights[m] * valid_masks[m].astype(np.float32) for m in weights if m in valid_masks}
    tot = sum(num.values())
    with np.errstate(invalid='ignore', divide='ignore'):
        return {m: np.where(tot > 0, a / tot, 0).astype(np.float32) for m, a in num.items()}
