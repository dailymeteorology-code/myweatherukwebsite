"""Members to forecasts: weights, chances, risk and the amount expected.

Weights: each member's weight at a lead time comes from its source's curve (config.SOURCES), less
for a source run older than the cycle (LAG_PENALTY per 6 h), and nothing where it has no data.

Chance: the weighted share of members that give at least CHANCE_CM in the period.

Amount: the probability-matched mean (Ebert 2001): the members' mean puts the snow in the right
places, but averaging members that disagree on where a band sits smears it thin and wide. PMM
keeps the mean's pattern and gives it the amounts the members themselves have, pooled: the cell
the mean ranks wettest gets the pooled amounts' top value, and so on down.

Risk: from the chances of 24-hour totals reaching set amounts (config.RISK_RULES): none, low,
moderate, high, severe.
"""
from __future__ import annotations

import numpy as np

from .config import LAG_PENALTY, RISK_RULES, SOURCES


def weight(key, lead_h, lag_h):
    k = np.array(SOURCES[key]['w'], float)
    return float(np.interp(lead_h + lag_h, k[:, 0], k[:, 1])) * LAG_PENALTY ** (lag_h / 6.0)


def chance(x, w, thr):
    """Weighted share of members (rows of x) at or above thr, per cell. NaN members carry no weight."""
    ok = np.isfinite(x)
    ww = w[:, None] * ok
    tot = ww.sum(0)
    return np.where(tot > 0, (ww * (np.nan_to_num(x) >= thr)).sum(0) / np.maximum(tot, 1e-9), np.nan)


def wmean(x, w):
    ok = np.isfinite(x)
    ww = w[:, None] * ok
    return (ww * np.nan_to_num(x)).sum(0) / np.maximum(ww.sum(0), 1e-9)


def pmm(x, w):
    """Probability-matched mean of x (members, cells; members with data only) with weights w."""
    m, n = x.shape
    x = np.nan_to_num(x, nan=0.0)
    mean = (w[:, None] * x).sum(0) / max(w.sum(), 1e-9)
    vals = x.ravel()                                    # member by member
    wts = np.repeat(w / max(w.sum(), 1e-9) / n, n)      # each member's weight spread over its cells
    order = np.argsort(vals, kind='stable')
    vs, ws = vals[order], wts[order]
    cw = np.cumsum(ws)
    cw = (cw - ws / 2) / max(cw[-1], 1e-12)
    rank = np.empty(n, np.int64)
    rank[np.argsort(mean, kind='stable')] = np.arange(n)
    out = np.interp((rank + 0.5) / n, cw, vs)
    return np.where(mean > 0, out, 0.0).astype(np.float32)


def risk(x24, w):
    """Risk level 0-4 from members' 24-hour amounts (members, cells)."""
    level = np.zeros(x24.shape[1], np.uint8)
    for lv, rules in RISK_RULES:                     # highest first
        hit = np.zeros(x24.shape[1], bool)
        for cm, p in rules:
            hit |= np.nan_to_num(chance(x24, w, cm)) >= p
        level = np.where((level == 0) & hit, lv, level)
    return level
