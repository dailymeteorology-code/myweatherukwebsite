"""Vectorised transfers and composition rules (V5 engines/transfer.py)."""
from __future__ import annotations

import math

import numpy as np

from .. import v5_bridge  # noqa: F401  (puts the V5 package on sys.path)
from app.engines.transfer import Rule, Shape  # noqa: E402

_EXP_LIMIT = 500.0
NAN = np.nan


def tv(transfer, x):
    """Transfer.__call__ over an array. NaN in -> `absent` (or NaN) out."""
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
