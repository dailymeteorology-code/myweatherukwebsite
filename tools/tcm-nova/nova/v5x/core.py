"""Vectorised transfers and composition rules (V5 engines/transfer.py)."""
from __future__ import annotations

import math

import numpy as np

from .. import v5_bridge  # noqa: F401  (puts the V5 package on sys.path)
from app.engines.transfer import Rule, Shape  # noqa: E402

_EXP_LIMIT = 500.0
NAN = np.nan


# ── compiled versions (same arithmetic, one pass over the grid instead of ~6) ──
from numba import njit, prange  # noqa: E402

_SHAPE = {Shape.RAMP: 0, Shape.INVERSE_RAMP: 1, Shape.LOGISTIC: 2, Shape.INVERSE_LOGISTIC: 3, Shape.BAND: 4}
_RULE = {Rule.INGREDIENTS: 0, Rule.CONDITIONAL: 1, Rule.LIMITING: 2, Rule.ALTERNATIVES: 3, Rule.DOMINANT: 4}


@njit(cache=True)
def _clip01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


@njit(parallel=True, cache=True)
def _tv_nb(code, lo, hi, margin, margin_low, absent, x):
    out = np.empty(x.size)
    mid = 0.5 * (lo + hi)
    span = hi - lo
    k = 2.0 * math.log(9.0) / span if span != 0 else 0.0
    for i in prange(x.size):
        v = x[i]
        if not math.isfinite(v):
            out[i] = absent
            continue
        if code == 0:
            o = _clip01((v - lo) / (hi - lo))
        elif code == 1:
            o = _clip01(1.0 - (v - lo) / (hi - lo))
        elif code == 2 or code == 3:
            e = -k * (v - mid) if code == 2 else k * (v - mid)
            if e > 500.0:
                o = 0.0
            elif e < -500.0:
                o = 1.0
            else:
                o = _clip01(1.0 / (1.0 + math.exp(e)))
        else:
            if v >= lo and v <= hi:
                o = 1.0
            elif v < lo:
                o = _clip01(1.0 - (lo - v) / margin_low)
            else:
                o = _clip01(1.0 - (v - hi) / margin)
        out[i] = o
    return out


@njit(parallel=True, cache=True)
def _compose_nb(code, M, minimum):
    nf, n = M.shape
    val = np.empty(n)
    cnt = np.empty(n, np.int64)
    for i in prange(n):
        c = 0
        if code == 0:
            anyzero = False
            ls = 0.0
            for f in range(nf):
                m = M[f, i]
                if math.isfinite(m):
                    c += 1
                    if m <= 0.0:
                        anyzero = True
                    else:
                        ls += math.log(m)
            v = 0.0 if anyzero else math.exp(ls / max(c, 1))
        elif code == 1:
            v = 1.0
            for f in range(nf):
                m = M[f, i]
                if math.isfinite(m):
                    c += 1
                    v = v * m
        elif code == 2:
            v = np.inf
            for f in range(nf):
                m = M[f, i]
                if math.isfinite(m):
                    c += 1
                    v = min(v, m)
        elif code == 3:
            pr = 1.0
            for f in range(nf):
                m = M[f, i]
                if math.isfinite(m):
                    c += 1
                    pr = pr * (1.0 - m)
            v = 1.0 - pr
        else:
            v = -np.inf
            for f in range(nf):
                m = M[f, i]
                if math.isfinite(m):
                    c += 1
                    v = max(v, m)
        cnt[i] = c
        val[i] = _clip01(v) if c >= max(1, minimum) else np.nan
    return val, cnt


#: Use the compiled versions (production). verify.py may switch to NumPy to cross-check.
COMPILED = True


def tv(transfer, x):
    """Transfer.__call__ over an array. NaN in -> `absent` (or NaN) out."""
    if COMPILED:
        xa = np.asarray(x, dtype='float64')
        flat = np.ascontiguousarray(xa.ravel())
        ml = transfer.margin_low if transfer.margin_low is not None else transfer.margin
        absent = NAN if transfer.absent is None else float(transfer.absent)
        return _tv_nb(_SHAPE[transfer.shape], float(transfer.low), float(transfer.high), float(transfer.margin or 0.0),
                      float(ml or 0.0), absent, flat).reshape(xa.shape)
    x = np.asarray(x, dtype='float64')
    lo, hi = transfer.low, transfer.high
    with np.errstate(invalid='ignore', divide='ignore', over='ignore'):
        if transfer.shape is Shape.RAMP:
            out = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
        elif transfer.shape is Shape.INVERSE_RAMP:
            out = np.clip(1.0 - (x - lo) / (hi - lo), 0.0, 1.0)
        elif transfer.shape in (Shape.LOGISTIC, Shape.INVERSE_LOGISTIC):
            mid = 0.5 * (lo + hi)
            span = hi - lo
            k = 2.0 * math.log(9.0) / span
            e = -k * (x - mid) if transfer.shape is Shape.LOGISTIC else k * (x - mid)
            out = np.where(e > _EXP_LIMIT, 0.0, np.where(
                e < -_EXP_LIMIT, 1.0, 1.0 / (1.0 + np.exp(np.clip(e, -_EXP_LIMIT, _EXP_LIMIT)))))
            out = np.clip(out, 0.0, 1.0)
        elif transfer.shape is Shape.BAND:
            ml = transfer.margin_low if transfer.margin_low is not None else transfer.margin
            out = np.where((x >= lo) & (x <= hi), 1.0, np.where(
                x < lo, np.clip(1.0 - (lo - x) / ml, 0.0, 1.0), np.clip(1.0 - (x - hi) / transfer.margin, 0.0, 1.0)))
        else:
            raise ValueError(transfer.shape)
    absent = NAN if transfer.absent is None else float(transfer.absent)
    return np.where(np.isfinite(x), out, absent)


def compose(rule, members, minimum=1):
    """compose() over arrays. members: list of membership arrays (NaN = unusable).
    Returns (value, n_usable); value is NaN where fewer than `minimum` are usable."""
    shape = np.broadcast(*[np.asarray(m) for m in members]).shape if members else ()
    if COMPILED and members:
        M = np.ascontiguousarray(np.stack([np.broadcast_to(np.asarray(m, dtype='float64'), shape).ravel()
                                           for m in members]))
        val, cnt = _compose_nb(_RULE[rule], M, int(minimum))
        return val.reshape(shape), cnt.reshape(shape)
    ms = [np.broadcast_to(np.asarray(m, dtype='float64'), shape) for m in members]
    ok = [np.isfinite(m) for m in ms]
    n = np.sum(ok, axis=0) if ms else np.zeros(shape, int)
    with np.errstate(invalid='ignore', divide='ignore'):
        if rule is Rule.INGREDIENTS:
            anyzero = np.zeros(shape, bool)
            logsum = np.zeros(shape)
            for m, k in zip(ms, ok):
                anyzero |= k & (m <= 0.0)
                logsum = logsum + np.where(k & (m > 0), np.log(np.where(m > 0, m, 1.0)), 0.0)
            value = np.where(anyzero, 0.0, np.exp(logsum / np.maximum(n, 1)))
        elif rule is Rule.CONDITIONAL:
            value = np.ones(shape)
            for m, k in zip(ms, ok):
                value = value * np.where(k, m, 1.0)
        elif rule is Rule.LIMITING:
            value = np.full(shape, np.inf)
            for m, k in zip(ms, ok):
                value = np.where(k, np.minimum(value, m), value)
        elif rule is Rule.ALTERNATIVES:
            prod = np.ones(shape)
            for m, k in zip(ms, ok):
                prod = prod * np.where(k, 1.0 - m, 1.0)
            value = 1.0 - prod
        elif rule is Rule.DOMINANT:
            value = np.full(shape, -np.inf)
            for m, k in zip(ms, ok):
                value = np.where(k, np.maximum(value, m), value)
        else:
            raise ValueError(rule)
    value = np.clip(value, 0.0, 1.0)
    return np.where(n >= max(1, minimum), value, NAN), n


#: True only when holding the port to V5 (verify.py): ties resolved as Python does.
#: Production rounds with numpy -- a 1e-4 difference at an exact tie, nothing more.
EXACT_ROUND = False


def r(x, nd):
    """Python round() for arrays, exactly. np.round scales by 10**nd first, which can
    move a value across a .5 tie that Python's correctly-rounded round() resolves on
    the exact binary value, so cells near a tie are re-rounded with round() itself."""
    x = np.asarray(x, dtype='float64')
    out = np.round(x, nd)
    if not EXACT_ROUND:
        return out
    y = x * 10.0 ** nd
    near = np.isfinite(y) & (np.abs(np.abs(y - np.floor(y)) - 0.5) < 1e-6)
    if near.any():
        idx = np.flatnonzero(near)
        flat = out.reshape(-1).copy() if out.ndim else out
        xs = x.reshape(-1)
        if out.ndim:
            for i in idx:
                flat[i] = round(float(xs[i]), nd)
            out = flat.reshape(out.shape)
        else:
            out = np.float64(round(float(x), nd))
    return out


def finite(x):
    return np.isfinite(np.asarray(x, dtype='float64'))
