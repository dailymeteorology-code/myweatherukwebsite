"""Skill metrics, each tied to a target and a baseline.

Step 6 of the Stage 9 order, sections 21 to 28, 61, 64, 92 and 96.

Section 21 ends with the instruction that governs this module:

    Do not calculate metrics blindly. Every metric must be associated with
    a clear forecast target and event definition.

So a metric is never a bare float here. `Score` carries the metric name, the
target it was computed against, the sample size, the number of events, and
an uncertainty interval. A Brier score of 0.03 means nothing without knowing
whether the base rate was 0.5 or 0.001, and this makes it impossible to
report the number without the context.

BRIER SKILL SCORE NEEDS A NAMED BASELINE
----------------------------------------
Section 24: never report BSS without saying what it is relative to.
`brier_skill_score` therefore takes the baseline's NAME as a required
argument and puts it in the result. Two BSS values against different
baselines are not comparable, and the naming is what makes that visible
rather than something a reader has to remember.

CONFIDENCE INTERVALS USE THE EFFECTIVE SAMPLE SIZE
--------------------------------------------------
Sections 61 and 96. A bootstrap over 1.16 million correlated grid cells
produces an interval so narrow that any difference looks significant. Every
interval here is computed from the EFFECTIVE sample size supplied by
`matching.effective_sample`, and when that is not supplied the interval is
refused rather than computed optimistically.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

import numpy as np

log = logging.getLogger(__name__)

METRICS_VERSION = "stage9.1"

#: Probability bins for reliability. Section 64's ten deciles.
RELIABILITY_BINS = np.linspace(0.0, 1.0, 11)

#: Thresholds at which categorical scores are evaluated. Section 92.
DEFAULT_THRESHOLDS = (0.10, 0.25, 0.40, 0.50, 0.60, 0.75, 0.90)


@dataclass(frozen=True, slots=True)
class Score:
    """One metric, with everything needed to read it correctly."""

    metric: str
    value: float | None
    #: What was being forecast. Without this a score is uninterpretable.
    target: str
    #: How many cases. Raw, and effective after correlation.
    n: int
    n_effective: float | None = None
    #: How many of those were events. A score over 3 events is not a skill
    #: estimate whatever its value.
    n_events: int = 0
    base_rate: float | None = None
    #: Baseline this is relative to, for skill scores. Required for BSS.
    baseline: str | None = None
    #: 95% interval, when the effective sample size allowed one.
    interval: tuple[float, float] | None = None
    reason: str = ""
    flags: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.value is not None

    def to_dict(self) -> dict:
        return {
            "metric": self.metric,
            "value": (
                round(self.value, 6) if self.value is not None else None
            ),
            "target": self.target,
            "baseline": self.baseline,
            "n": self.n,
            "n_effective": (
                round(self.n_effective, 1)
                if self.n_effective is not None else None
            ),
            "n_events": self.n_events,
            "base_rate": (
                round(self.base_rate, 6) if self.base_rate is not None
                else None
            ),
            "interval_95": (
                [round(v, 6) for v in self.interval] if self.interval
                else None
            ),
            "reason": self.reason or None,
            "flags": list(self.flags),
        }


def _unavailable(metric: str, target: str, reason: str, n: int = 0) -> Score:
    return Score(metric=metric, value=None, target=target, n=n,
                 reason=reason)


def _sample_flags(n: int, n_events: int, n_effective: float | None
                  ) -> tuple[str, ...]:
    """Section 36: never present a skill number without saying what it rests
    on."""
    flags: list[str] = []
    if n_events < 10:
        flags.append(
            f"only {n_events} observed event(s): this is not a skill "
            f"estimate, it is a description of a handful of cases"
        )
    if n_effective is not None and n_effective < 30:
        flags.append(
            f"effective sample size is {n_effective:.0f} after accounting "
            f"for spatial and temporal correlation, whatever the raw cell "
            f"count suggests"
        )
    return tuple(flags)


# --------------------------------------------------------------------------
# Probabilistic metrics
# --------------------------------------------------------------------------

def brier_score(
    forecast: np.ndarray, observed: np.ndarray, *,
    target: str, n_effective: float | None = None,
) -> Score:
    """Mean squared error of a probability forecast. Section 23.

    Lower is better. Reflects calibration AND sharpness together, which is
    why it is decomposed in `brier_decomposition` rather than read alone.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep], o[keep]
    if f.size == 0:
        return _unavailable("brier_score", target,
                            "no matched forecast/observation pairs")

    value = float(np.mean((f - o) ** 2))
    events = int(o.sum())
    return Score(
        metric="brier_score", value=value, target=target, n=int(f.size),
        n_effective=n_effective, n_events=events,
        base_rate=float(o.mean()),
        interval=_bootstrap_interval(
            lambda a, b: float(np.mean((a - b) ** 2)), f, o, n_effective
        ),
        flags=_sample_flags(int(f.size), events, n_effective),
    )


def brier_skill_score(
    forecast: np.ndarray, observed: np.ndarray,
    reference: np.ndarray, *, baseline: str, target: str,
    n_effective: float | None = None,
) -> Score:
    """Brier score relative to an explicitly named baseline. Section 24.

    `baseline` is required, not optional. A BSS whose baseline is not stated
    cannot be compared with any other BSS, and the commonest way to
    overstate skill is to quote one computed against climatology as though
    it were against a real competitor.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    r = np.asarray(reference, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o) & np.isfinite(r)
    f, o, r = f[keep], o[keep], r[keep]
    if f.size == 0:
        return _unavailable("brier_skill_score", target,
                            "no matched forecast/observation pairs")

    bs = float(np.mean((f - o) ** 2))
    bs_ref = float(np.mean((r - o) ** 2))
    if bs_ref <= 0:
        return _unavailable(
            "brier_skill_score", target,
            f"the {baseline} baseline scored a perfect 0, so a skill ratio "
            f"against it is undefined. This usually means the baseline was "
            f"handed the answer",
            n=int(f.size),
        )

    events = int(o.sum())
    return Score(
        metric="brier_skill_score", value=1.0 - bs / bs_ref, target=target,
        baseline=baseline, n=int(f.size), n_effective=n_effective,
        n_events=events, base_rate=float(o.mean()),
        flags=_sample_flags(int(f.size), events, n_effective) + (
            f"relative to {baseline}; not comparable with a skill score "
            f"computed against a different baseline",
        ),
    )


def brier_decomposition(
    forecast: np.ndarray, observed: np.ndarray, *, target: str,
    bins: np.ndarray | None = None,
) -> dict:
    """Murphy's decomposition: reliability, resolution, uncertainty.

    BS = reliability - resolution + uncertainty

    Section 28's point lives here. A forecast can lower its Brier score by
    improving reliability OR by improving resolution, and a calibration
    that pushes everything to climatology improves the first while
    destroying the second. Only the decomposition shows which happened.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep], o[keep]
    if f.size == 0:
        return {"available": False, "reason": "no pairs"}

    edges = RELIABILITY_BINS if bins is None else np.asarray(bins)
    climatology = float(o.mean())
    reliability = resolution = 0.0
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        inside = (f >= lo) & (f < hi if i < len(edges) - 2 else f <= hi)
        count = int(inside.sum())
        if count == 0:
            continue
        mean_f = float(f[inside].mean())
        mean_o = float(o[inside].mean())
        reliability += count * (mean_f - mean_o) ** 2
        resolution += count * (mean_o - climatology) ** 2

    n = float(f.size)
    rel = reliability / n
    res = resolution / n
    unc = climatology * (1 - climatology)
    brier = float(np.mean((f - o) ** 2))
    # Murphy's identity is exact only for a forecast taking finitely many
    # distinct values. Binning a CONTINUOUS forecast leaves a residual --
    # the spread of forecast values inside each bin, which the bin mean
    # cannot represent. Reporting it stops a reader who checks the identity
    # from finding an unexplained discrepancy, and it is a direct measure of
    # whether the binning is too coarse for this forecast: a residual that
    # is a large fraction of the Brier score means the bins are hiding
    # structure and should be finer.
    residual = brier - (rel - res + unc)
    return {
        "available": True,
        "target": target,
        "reliability": round(rel, 6),
        "resolution": round(res, 6),
        "uncertainty": round(unc, 6),
        "brier_score": round(brier, 6),
        "binning_residual": round(residual, 6),
        "bins": int(len(edges) - 1),
        "note": (
            "BS = reliability - resolution + uncertainty + binning_residual. "
            "LOW reliability is good (it is a squared error); HIGH "
            "resolution is good. A calibration that improves reliability "
            "while collapsing resolution has made the forecast useless, not "
            "better. The residual is the within-bin spread of the forecast, "
            "zero for a forecast with one value per bin"
        ),
    }


def roc_auc(
    forecast: np.ndarray, observed: np.ndarray, *, target: str,
    n_effective: float | None = None,
) -> Score:
    """Discrimination. Section 25.

    Computed by the rank identity (equivalent to the Mann-Whitney U), which
    is exact and needs no threshold sweep.

    ROC-AUC says nothing about calibration: a forecast that halves every
    probability has identical AUC and ruined reliability. Section 25 warns
    against optimising the probability system for it alone, so the flag
    saying so travels with every value.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep], o[keep]
    positives = o > 0.5
    n_pos, n_neg = int(positives.sum()), int((~positives).sum())
    if n_pos == 0 or n_neg == 0:
        return _unavailable(
            "roc_auc", target,
            f"ROC-AUC needs both outcomes; this sample has {n_pos} events "
            f"and {n_neg} non-events",
            n=int(f.size),
        )

    order = np.argsort(f, kind="mergesort")
    ranks = np.empty(f.size, dtype="float64")
    ranks[order] = np.arange(1, f.size + 1, dtype="float64")
    # Average ranks within ties, or a forecast of a constant probability
    # would score 1.0 or 0.0 depending only on sort order.
    sorted_f = f[order]
    start = 0
    for i in range(1, f.size + 1):
        if i == f.size or sorted_f[i] != sorted_f[start]:
            if i - start > 1:
                ranks[order[start:i]] = ranks[order[start:i]].mean()
            start = i

    auc = (ranks[positives].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)
    return Score(
        metric="roc_auc", value=float(auc), target=target, n=int(f.size),
        n_effective=n_effective, n_events=n_pos,
        base_rate=float(o.mean()),
        flags=_sample_flags(int(f.size), n_pos, n_effective) + (
            "discrimination only: a strong AUC is compatible with badly "
            "miscalibrated probabilities",
        ),
    )


def pr_auc(
    forecast: np.ndarray, observed: np.ndarray, *, target: str,
    n_effective: float | None = None,
) -> Score:
    """Area under the precision-recall curve. Section 26.

    Preferred for rare events, where ROC-AUC flatters a forecast because
    the huge number of true negatives dominates the false-positive rate.
    Interpret against the base rate: a random forecast scores the base
    rate, not 0.5, so the base rate travels with the value.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep], o[keep]
    positives = o > 0.5
    n_pos = int(positives.sum())
    if n_pos == 0:
        return _unavailable(
            "pr_auc", target, "no observed events in this sample",
            n=int(f.size),
        )

    order = np.argsort(-f, kind="mergesort")
    hits = np.cumsum(positives[order].astype("float64"))
    ranks = np.arange(1, f.size + 1, dtype="float64")
    precision = hits / ranks
    recall = hits / n_pos
    # Step-wise integration, which is the average-precision estimator and
    # does not interpolate between operating points the way a trapezoid
    # would -- interpolation on a PR curve is not meaningful.
    area = float(np.sum(np.diff(np.concatenate([[0.0], recall])) * precision))
    base = float(o.mean())
    return Score(
        metric="pr_auc", value=area, target=target, n=int(f.size),
        n_effective=n_effective, n_events=n_pos, base_rate=base,
        flags=_sample_flags(int(f.size), n_pos, n_effective) + (
            f"a random forecast scores the base rate ({base:.4f}), not 0.5. "
            f"Compare against that, not against a half",
        ),
    )


# --------------------------------------------------------------------------
# Categorical metrics
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Contingency:
    """A 2x2 table at one probability threshold."""

    threshold: float
    hits: int
    misses: int
    false_alarms: int
    correct_negatives: int

    @property
    def pod(self) -> float | None:
        """Probability of detection. None when nothing happened."""
        denominator = self.hits + self.misses
        return self.hits / denominator if denominator else None

    @property
    def far(self) -> float | None:
        """False alarm RATIO: of the warnings issued, how many were wrong."""
        denominator = self.hits + self.false_alarms
        return self.false_alarms / denominator if denominator else None

    @property
    def csi(self) -> float | None:
        """Critical success index, ignoring correct negatives."""
        denominator = self.hits + self.misses + self.false_alarms
        return self.hits / denominator if denominator else None

    @property
    def bias(self) -> float | None:
        """Frequency bias: warned area over observed area."""
        denominator = self.hits + self.misses
        return (
            (self.hits + self.false_alarms) / denominator
            if denominator else None
        )

    def to_dict(self) -> dict:
        def r(value):
            return round(value, 4) if value is not None else None
        return {
            "threshold": self.threshold,
            "hits": self.hits, "misses": self.misses,
            "false_alarms": self.false_alarms,
            "correct_negatives": self.correct_negatives,
            "pod": r(self.pod), "far": r(self.far), "csi": r(self.csi),
            "frequency_bias": r(self.bias),
        }


def contingency(
    forecast: np.ndarray, observed: np.ndarray, threshold: float
) -> Contingency:
    """The 2x2 table at one threshold."""
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep] >= threshold, o[keep] > 0.5
    return Contingency(
        threshold=threshold,
        hits=int((f & o).sum()),
        misses=int((~f & o).sum()),
        false_alarms=int((f & ~o).sum()),
        correct_negatives=int((~f & ~o).sum()),
    )


def threshold_sweep(
    forecast: np.ndarray, observed: np.ndarray, *,
    thresholds=DEFAULT_THRESHOLDS,
) -> list[Contingency]:
    """Section 92: behaviour across the thresholds an alert product would use.

    Reported so a threshold can be chosen from evidence later, and
    deliberately NOT reduced to a single "best" one -- section 92 warns
    against choosing an operational threshold because it looked good on one
    historical dataset.
    """
    return [contingency(forecast, observed, t) for t in thresholds]


# --------------------------------------------------------------------------
# Reliability
# --------------------------------------------------------------------------

def reliability(
    forecast: np.ndarray, observed: np.ndarray, *, target: str,
    bins: np.ndarray | None = None,
) -> dict:
    """Observed frequency by forecast probability bin. Sections 27 and 64.

    The question is whether 30% forecasts occur about 30% of the time. Each
    bin reports its own sample size, because a bin holding four cases
    cannot answer that and its apparent miscalibration is noise.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep], o[keep]
    if f.size == 0:
        return {"available": False, "reason": "no pairs", "target": target}

    edges = RELIABILITY_BINS if bins is None else np.asarray(bins)
    rows = []
    weighted_error = 0.0
    total = 0
    for i in range(len(edges) - 1):
        lo, hi = float(edges[i]), float(edges[i + 1])
        inside = (f >= lo) & (f < hi if i < len(edges) - 2 else f <= hi)
        count = int(inside.sum())
        row = {
            "bin": f"{lo:.0%}-{hi:.0%}",
            "n": count,
            "mean_forecast": (
                round(float(f[inside].mean()), 4) if count else None
            ),
            "observed_frequency": (
                round(float(o[inside].mean()), 4) if count else None
            ),
        }
        if count:
            row["deviation"] = round(
                row["observed_frequency"] - row["mean_forecast"], 4
            )
            if count < 30:
                row["warning"] = (
                    f"only {count} cases in this bin; its apparent "
                    f"deviation is not evidence of miscalibration"
                )
            weighted_error += count * abs(row["deviation"])
            total += count
        rows.append(row)

    return {
        "available": True,
        "target": target,
        "bins": rows,
        "calibration_error": (
            round(weighted_error / total, 6) if total else None
        ),
        "note": (
            "calibration error is the sample-weighted mean absolute "
            "deviation of observed frequency from forecast probability"
        ),
    }


def sharpness(forecast: np.ndarray, *, target: str) -> dict:
    """How much the forecast commits. Sections 28 and 65.

    A forecast that always says the climatological rate is perfectly
    reliable and completely useless. Sharpness is the variance of the
    forecast distribution: a constant forecast has zero.
    """
    f = np.asarray(forecast, dtype="float64").ravel()
    f = f[np.isfinite(f)]
    if f.size == 0:
        return {"available": False, "reason": "no forecasts",
                "target": target}
    counts, _ = np.histogram(f, bins=RELIABILITY_BINS)
    return {
        "available": True,
        "target": target,
        "variance": round(float(f.var()), 8),
        "mean": round(float(f.mean()), 6),
        "distribution": {
            f"{RELIABILITY_BINS[i]:.0%}-{RELIABILITY_BINS[i+1]:.0%}":
                int(counts[i])
            for i in range(len(counts))
        },
        "fraction_above_50pct": round(float((f >= 0.5).mean()), 6),
        "note": (
            "a forecast with near-zero variance is climatology in "
            "disguise: perfectly reliable and of no use. Reliability must "
            "be read together with this"
        ),
    }


# --------------------------------------------------------------------------
# Continuous metrics
# --------------------------------------------------------------------------

def continuous_scores(
    forecast: np.ndarray, observed: np.ndarray, *, target: str, unit: str,
    n_effective: float | None = None,
) -> dict[str, Score]:
    """Bias, MAE, RMSE and correlation. Sections 20 and 21."""
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observed, dtype="float64").ravel()
    keep = np.isfinite(f) & np.isfinite(o)
    f, o = f[keep], o[keep]
    if f.size == 0:
        reason = "no matched forecast/observation pairs"
        return {
            name: _unavailable(name, target, reason)
            for name in ("bias", "mae", "rmse", "correlation")
        }

    error = f - o
    n = int(f.size)
    flags = (f"units: {unit}",) + _sample_flags(n, n, n_effective)

    def make(name: str, value: float) -> Score:
        return Score(
            metric=name, value=float(value), target=target, n=n,
            n_effective=n_effective, n_events=n, flags=flags,
        )

    out = {
        "bias": make("bias", error.mean()),
        "mae": make("mae", np.abs(error).mean()),
        "rmse": make("rmse", np.sqrt((error * error).mean())),
    }
    if f.std() > 0 and o.std() > 0 and n > 2:
        out["correlation"] = make(
            "correlation", float(np.corrcoef(f, o)[0, 1])
        )
    else:
        out["correlation"] = _unavailable(
            "correlation", target,
            "one of the series is constant, so correlation is undefined",
            n=n,
        )
    return out


# --------------------------------------------------------------------------
# Uncertainty -- sections 37, 61, 96
# --------------------------------------------------------------------------

def _bootstrap_interval(
    statistic, forecast: np.ndarray, observed: np.ndarray,
    n_effective: float | None, *, draws: int = 400, seed: int = 20260901,
) -> tuple[float, float] | None:
    """A 95% interval computed at the EFFECTIVE sample size.

    Resampling the raw cells would produce an interval narrower than the
    data supports, because neighbouring cells in one outbreak are not
    independent draws. So each bootstrap replicate draws only
    `n_effective` values.

    Returns None when the effective size is unknown, rather than silently
    falling back to the raw count -- which is the mistake that makes every
    difference look significant.
    """
    if n_effective is None or not np.isfinite(n_effective):
        return None
    size = int(max(2, min(n_effective, forecast.size)))
    if forecast.size < 2:
        return None

    rng = np.random.default_rng(seed)
    values = np.empty(draws, dtype="float64")
    for i in range(draws):
        index = rng.integers(0, forecast.size, size=size)
        values[i] = statistic(forecast[index], observed[index])
    return (
        float(np.percentile(values, 2.5)),
        float(np.percentile(values, 97.5)),
    )


def compare_paired(
    forecast_a: np.ndarray, forecast_b: np.ndarray, observed: np.ndarray, *,
    statistic, label_a: str, label_b: str, metric: str, target: str,
    n_effective: float | None, draws: int = 400, seed: int = 20260901,
) -> dict:
    """Compare two forecasts of the SAME cases, by bootstrapping the
    difference rather than comparing two separate intervals.

    WHY NOT JUST CHECK WHETHER THE INTERVALS OVERLAP
    ------------------------------------------------
    Because that test is wrong in two directions at once, and `compare`
    below can only do it because it is handed two finished scores.

    First, overlapping 95% intervals do NOT mean the difference is
    insignificant. For two equal standard errors the intervals separate only
    at about p = 0.006, so the overlap rule is roughly an alpha of 0.5%
    dressed up as 5%: it calls real differences indistinguishable.

    Second, and much larger here, the two forecasts are scored on the SAME
    observations. In an ablation they differ by one component and their
    errors are correlated near 1 -- both get the easy cases right. The
    variance of the DIFFERENCE is then far smaller than the variance of
    either score, and treating the two as independent throws that away
    entirely. The paired difference is the quantity the question is about.

    So: one set of resampled indices, applied to BOTH forecasts, and the
    interval taken on the difference. Still drawn at the effective sample
    size, for the same reason `_bootstrap_interval` is.
    """
    fa = np.asarray(forecast_a, dtype="float64").ravel()
    fb = np.asarray(forecast_b, dtype="float64").ravel()
    ob = np.asarray(observed, dtype="float64").ravel()
    if not (fa.size == fb.size == ob.size):
        return {
            "comparable": False,
            "reason": (
                f"paired comparison needs the same cases on both sides; got "
                f"{fa.size} and {fb.size} against {ob.size} observations"
            ),
        }
    keep = np.isfinite(fa) & np.isfinite(fb) & np.isfinite(ob)
    fa, fb, ob = fa[keep], fb[keep], ob[keep]
    n = int(fa.size)
    n_events = int(np.count_nonzero(ob > 0.5))
    if n < 2:
        return {"comparable": False, "reason": "fewer than two usable pairs"}

    value_a = float(statistic(fa, ob))
    value_b = float(statistic(fb, ob))
    difference = value_b - value_a

    interval = None
    if n_effective is not None and np.isfinite(n_effective):
        size = int(max(2, min(n_effective, n)))
        rng = np.random.default_rng(seed)
        deltas = np.empty(draws, dtype="float64")
        for i in range(draws):
            index = rng.integers(0, n, size=size)
            deltas[i] = (
                statistic(fb[index], ob[index])
                - statistic(fa[index], ob[index])
            )
        interval = (
            float(np.percentile(deltas, 2.5)),
            float(np.percentile(deltas, 97.5)),
        )

    if n_events < 10:
        verdict = (
            f"NOT MEANINGFUL: {n_events} events is too few to distinguish "
            f"two forecasts"
        )
    elif interval is None:
        verdict = (
            "UNKNOWN: no interval on the difference was computed, which "
            "needs an effective sample size"
        )
    elif interval[0] <= 0.0 <= interval[1]:
        verdict = (
            "NOT DISTINGUISHABLE: the interval on the paired difference "
            "includes zero"
        )
    else:
        better = label_b if difference < 0 else label_a
        verdict = f"DISTINGUISHABLE: {better} scores better"

    return {
        "comparable": True,
        "metric": metric,
        "target": target,
        "paired": True,
        label_a: round(value_a, 6),
        label_b: round(value_b, 6),
        "difference": round(difference, 6),
        "difference_interval": (
            [round(interval[0], 6), round(interval[1], 6)]
            if interval else None
        ),
        "n": n,
        "n_events": n_events,
        "n_effective": (
            round(float(n_effective), 2) if n_effective is not None else None
        ),
        "verdict": verdict,
    }


def compare(
    a: Score, b: Score, *, label_a: str, label_b: str
) -> dict:
    """Is the difference between two scores meaningful? Section 96.

    Refuses to call a difference an improvement when the intervals overlap,
    and refuses outright when the samples are too small to support the
    question. A tiny metric improvement on a handful of events is not
    evidence of anything.
    """
    if not (a.available and b.available):
        return {
            "comparable": False,
            "reason": "one of the two scores is unavailable",
        }
    difference = b.value - a.value
    overlapping = None
    if a.interval and b.interval:
        overlapping = not (
            a.interval[1] < b.interval[0] or b.interval[1] < a.interval[0]
        )

    if min(a.n_events, b.n_events) < 10:
        verdict = (
            f"NOT MEANINGFUL: {min(a.n_events, b.n_events)} events is too "
            f"few to distinguish two forecasts"
        )
    elif overlapping is None:
        verdict = (
            "UNKNOWN: no confidence intervals were computed, which needs "
            "an effective sample size"
        )
    elif overlapping:
        verdict = (
            "NOT DISTINGUISHABLE: the confidence intervals overlap at the "
            "effective sample size. NOTE this is a conservative screen, not "
            "a test: overlapping 95% intervals separate only at about "
            "p=0.006, and these two scores are computed on the same cases, "
            "so their errors are correlated and the interval on the "
            "DIFFERENCE is narrower than this comparison can see. Use "
            "`compare_paired` where the underlying arrays are available"
        )
    else:
        better = label_b if difference < 0 else label_a
        verdict = f"DISTINGUISHABLE: {better} scores better"

    return {
        "comparable": True,
        "metric": a.metric,
        label_a: a.to_dict(),
        label_b: b.to_dict(),
        "difference": round(difference, 6),
        "intervals_overlap": overlapping,
        "verdict": verdict,
    }
