"""Verification metrics.

A metric must match the forecast type. Scoring a probability with RMSE, or a
rare event with accuracy, produces a number that looks like skill and is not:
"no thunderstorms anywhere, ever" scores 97% accurate over a British year and
is worthless.

So the metrics here are grouped by what they can legitimately score, and
`MetricSet.for_kind` will not hand back a metric that does not apply.

WHAT EACH ONE MEASURES -- these are not interchangeable
-------------------------------------------------------
    MAE          typical error magnitude
    RMSE         error magnitude, penalising large errors quadratically
    bias         systematic offset. A model can have zero bias and poor
                 skill, or large bias and excellent discrimination
    correlation  whether the forecast moves WITH the observation, blind to
                 both offset and amplitude
    Brier        mean squared error of a probability
    reliability  whether stated probabilities match observed frequencies
    resolution   whether the forecast distinguishes situations at all
    ROC-AUC      discrimination, independent of calibration
    POD          fraction of events that were forecast
    FAR          fraction of forecasts that were false alarms
    CSI          event-based performance, ignoring correct negatives

NO SINGLE "MODEL SCORE"
-----------------------
Nothing here collapses these into one number. Section 23 forbids it, and for
good reason: the collapse would need weights, the weights would be arbitrary,
and they would silently decide which kind of error the platform cares about.
`SkillScore` converts ONE metric into a comparable skill measure against a
stated reference, and the metric used is recorded on the result.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field as dc_field
from enum import Enum

import numpy as np


class ForecastKind(str, Enum):
    """What sort of forecast a metric can score."""

    CONTINUOUS = "continuous"        # temperature, CAPE, shear
    PROBABILITY = "probability"      # P(lightning), P(hail)
    BINARY = "binary"                # yes/no event forecast


class Direction(str, Enum):
    """Which way is better. Stated because half of these invert."""

    LOWER_IS_BETTER = "lower_is_better"
    HIGHER_IS_BETTER = "higher_is_better"
    #: Zero is best and both signs are bad -- bias, uniquely.
    ZERO_IS_BEST = "zero_is_best"


@dataclass(frozen=True, slots=True)
class MetricResult:
    """One metric, with the sample it came from.

    `n` travels with every value because a metric computed from seven cases
    is not the same evidence as one computed from four thousand, and
    separating them is the single most important guard against overfitting
    model weights.
    """

    name: str
    value: float | None
    n: int
    direction: Direction
    kind: ForecastKind
    #: Why the value is None, when it is.
    reason: str = ""
    #: Anything the metric exposes beyond its headline number.
    extra: dict = dc_field(default_factory=dict)

    @property
    def available(self) -> bool:
        return self.value is not None and math.isfinite(self.value)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "value": (
                round(float(self.value), 6) if self.available else None
            ),
            "n": self.n,
            "direction": self.direction.value,
            "kind": self.kind.value,
            "reason": self.reason,
            **({"extra": self.extra} if self.extra else {}),
        }


def _clean(forecast, observation):
    """Paired finite values only, as float arrays."""
    f = np.asarray(forecast, dtype="float64").ravel()
    o = np.asarray(observation, dtype="float64").ravel()
    if f.size != o.size:
        raise ValueError(
            f"forecast and observation lengths differ: {f.size} vs {o.size}"
        )
    ok = np.isfinite(f) & np.isfinite(o)
    return f[ok], o[ok]


def _empty(name, direction, kind, reason) -> MetricResult:
    return MetricResult(name, None, 0, direction, kind, reason)


# ---------------------------------------------------------------------------
# Continuous
# ---------------------------------------------------------------------------

def mae(forecast, observation) -> MetricResult:
    """Mean absolute error. Typical error magnitude."""
    f, o = _clean(forecast, observation)
    if f.size == 0:
        return _empty("mae", Direction.LOWER_IS_BETTER,
                      ForecastKind.CONTINUOUS, "no paired finite values")
    return MetricResult("mae", float(np.mean(np.abs(f - o))), int(f.size),
                        Direction.LOWER_IS_BETTER, ForecastKind.CONTINUOUS)


def rmse(forecast, observation) -> MetricResult:
    """Root mean squared error. Penalises large errors quadratically.

    Always >= MAE. The gap between them measures error variability: a model
    with MAE 2 and RMSE 2.1 is consistently a little wrong, one with MAE 2
    and RMSE 6 is usually right and occasionally badly wrong. Those are
    different failure modes and often matter differently.
    """
    f, o = _clean(forecast, observation)
    if f.size == 0:
        return _empty("rmse", Direction.LOWER_IS_BETTER,
                      ForecastKind.CONTINUOUS, "no paired finite values")
    return MetricResult(
        "rmse", float(np.sqrt(np.mean((f - o) ** 2))), int(f.size),
        Direction.LOWER_IS_BETTER, ForecastKind.CONTINUOUS,
    )


def bias(forecast, observation) -> MetricResult:
    """Mean error, signed. POSITIVE means the model forecasts too high.

    Deliberately ZERO_IS_BEST, not lower-is-better: -5 is as wrong as +5.
    Bias is also NOT skill, and section 27 forbids converting it
    automatically into a weight penalty. A systematically warm model may
    still discriminate excellently, and the right response is bias
    correction rather than distrust.
    """
    f, o = _clean(forecast, observation)
    if f.size == 0:
        return _empty("bias", Direction.ZERO_IS_BEST,
                      ForecastKind.CONTINUOUS, "no paired finite values")
    return MetricResult("bias", float(np.mean(f - o)), int(f.size),
                        Direction.ZERO_IS_BEST, ForecastKind.CONTINUOUS)


def median_absolute_error(forecast, observation) -> MetricResult:
    """Median absolute error. Robust to a handful of extreme misses."""
    f, o = _clean(forecast, observation)
    if f.size == 0:
        return _empty("median_absolute_error", Direction.LOWER_IS_BETTER,
                      ForecastKind.CONTINUOUS, "no paired finite values")
    return MetricResult(
        "median_absolute_error", float(np.median(np.abs(f - o))),
        int(f.size), Direction.LOWER_IS_BETTER, ForecastKind.CONTINUOUS,
    )


def correlation(forecast, observation) -> MetricResult:
    """Pearson correlation. Blind to offset AND amplitude.

    A model forecasting exactly half the observed CAPE every time scores a
    perfect 1.0. Useful alongside bias and MAE, misleading alone.
    """
    f, o = _clean(forecast, observation)
    if f.size < 3:
        return _empty("correlation", Direction.HIGHER_IS_BETTER,
                      ForecastKind.CONTINUOUS,
                      f"only {f.size} paired values; need at least 3")
    if np.std(f) == 0 or np.std(o) == 0:
        return _empty(
            "correlation", Direction.HIGHER_IS_BETTER,
            ForecastKind.CONTINUOUS,
            "forecast or observation is constant, so correlation is "
            "undefined rather than zero",
        )
    return MetricResult(
        "correlation", float(np.corrcoef(f, o)[0, 1]), int(f.size),
        Direction.HIGHER_IS_BETTER, ForecastKind.CONTINUOUS,
    )


# ---------------------------------------------------------------------------
# Probabilistic
# ---------------------------------------------------------------------------

def brier_score(probability, observed) -> MetricResult:
    """Mean squared error of a probability against a 0/1 outcome.

    Decomposes into reliability - resolution + uncertainty (Murphy 1973),
    and the decomposition is returned in `extra` because the parts answer
    different questions: a model can score well by being cautious near the
    base rate (good reliability, no resolution) and be useless.
    """
    p, o = _clean(probability, observed)
    if p.size == 0:
        return _empty("brier_score", Direction.LOWER_IS_BETTER,
                      ForecastKind.PROBABILITY, "no paired finite values")
    if np.any((p < 0) | (p > 1)):
        return _empty(
            "brier_score", Direction.LOWER_IS_BETTER,
            ForecastKind.PROBABILITY,
            "probabilities outside [0, 1]; this is not a probability "
            "forecast and must not be scored as one",
        )
    score = float(np.mean((p - o) ** 2))
    return MetricResult(
        "brier_score", score, int(p.size), Direction.LOWER_IS_BETTER,
        ForecastKind.PROBABILITY,
        extra=_brier_decomposition(p, o),
    )


def _brier_decomposition(p, o, bins: int = 10) -> dict:
    """Murphy's reliability / resolution / uncertainty decomposition."""
    edges = np.linspace(0.0, 1.0, bins + 1)
    index = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    base_rate = float(np.mean(o))

    reliability = resolution = 0.0
    populated = 0
    for k in range(bins):
        mask = index == k
        n_k = int(np.count_nonzero(mask))
        if n_k == 0:
            continue
        populated += 1
        mean_p = float(np.mean(p[mask]))
        mean_o = float(np.mean(o[mask]))
        reliability += n_k * (mean_p - mean_o) ** 2
        resolution += n_k * (mean_o - base_rate) ** 2

    n = p.size
    return {
        "reliability": round(reliability / n, 6),
        "resolution": round(resolution / n, 6),
        "uncertainty": round(base_rate * (1.0 - base_rate), 6),
        "base_rate": round(base_rate, 6),
        "populated_bins": populated,
        "note": (
            "brier = reliability - resolution + uncertainty. Low reliability "
            "means stated probabilities match observed frequency; high "
            "resolution means the forecast actually distinguishes situations"
        ),
    }


def reliability(probability, observed, bins: int = 10) -> MetricResult:
    """Calibration: do stated probabilities match observed frequency?

    Lower is better, and 0 means perfectly calibrated. Reported separately
    from the Brier score because a well-calibrated forecast with no
    resolution is useless, and a badly calibrated one with high resolution
    is salvageable -- by the later calibration stage, which is exactly what
    this measurement is for.
    """
    p, o = _clean(probability, observed)
    if p.size < bins:
        return _empty(
            "reliability", Direction.LOWER_IS_BETTER,
            ForecastKind.PROBABILITY,
            f"only {p.size} cases for {bins} bins; reliability from a "
            f"handful of cases is noise",
        )
    decomposition = _brier_decomposition(p, o, bins)
    return MetricResult(
        "reliability", decomposition["reliability"], int(p.size),
        Direction.LOWER_IS_BETTER, ForecastKind.PROBABILITY,
        extra=decomposition,
    )


def roc_auc(probability, observed) -> MetricResult:
    """Area under the ROC curve. Discrimination, independent of calibration.

    Computed by the rank (Mann-Whitney) identity rather than by trapezoidal
    integration of a binned curve, so the result does not depend on a bin
    choice. 0.5 is no discrimination; below 0.5 means the forecast is
    anti-correlated with the event, which is information rather than an
    error.
    """
    p, o = _clean(probability, observed)
    events = o > 0.5
    n_pos = int(np.count_nonzero(events))
    n_neg = int(p.size - n_pos)
    if n_pos == 0 or n_neg == 0:
        return _empty(
            "roc_auc", Direction.HIGHER_IS_BETTER, ForecastKind.PROBABILITY,
            f"needs both events and non-events; got {n_pos} events and "
            f"{n_neg} non-events",
        )
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(p.size, dtype="float64")
    ranks[order] = np.arange(1, p.size + 1)
    # Average ranks within ties, or tied forecasts inflate the score.
    unique, inverse, counts = np.unique(
        p, return_inverse=True, return_counts=True
    )
    for value_index, count in enumerate(counts):
        if count > 1:
            tied = inverse == value_index
            ranks[tied] = ranks[tied].mean()
    auc = (ranks[events].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return MetricResult(
        "roc_auc", float(auc), int(p.size), Direction.HIGHER_IS_BETTER,
        ForecastKind.PROBABILITY,
        extra={"events": n_pos, "non_events": n_neg},
    )


# ---------------------------------------------------------------------------
# Event-based
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Contingency:
    """The 2x2 table every event metric is built from."""

    hits: int
    misses: int
    false_alarms: int
    correct_negatives: int

    @property
    def n(self) -> int:
        return (
            self.hits + self.misses + self.false_alarms
            + self.correct_negatives
        )

    def to_dict(self) -> dict:
        return {
            "hits": self.hits, "misses": self.misses,
            "false_alarms": self.false_alarms,
            "correct_negatives": self.correct_negatives, "n": self.n,
        }


def contingency(forecast_event, observed_event, threshold: float = 0.5):
    """Build the contingency table from forecasts and observations."""
    f, o = _clean(forecast_event, observed_event)
    predicted = f >= threshold
    happened = o >= 0.5
    return Contingency(
        hits=int(np.count_nonzero(predicted & happened)),
        misses=int(np.count_nonzero(~predicted & happened)),
        false_alarms=int(np.count_nonzero(predicted & ~happened)),
        correct_negatives=int(np.count_nonzero(~predicted & ~happened)),
    )


def probability_of_detection(table: Contingency) -> MetricResult:
    """Hits / (hits + misses). What fraction of events were forecast?

    Trivially maximised by forecasting the event everywhere, which is why
    it is never reported without FAR or CSI alongside.
    """
    denominator = table.hits + table.misses
    if denominator == 0:
        return _empty("pod", Direction.HIGHER_IS_BETTER,
                      ForecastKind.BINARY, "no observed events in the sample")
    return MetricResult(
        "pod", table.hits / denominator, table.n,
        Direction.HIGHER_IS_BETTER, ForecastKind.BINARY,
        extra=table.to_dict(),
    )


def false_alarm_ratio(table: Contingency) -> MetricResult:
    """False alarms / (hits + false alarms). What fraction were wrong?

    Note this is the false alarm RATIO, not the false alarm RATE. The rate
    divides by correct negatives instead and behaves completely differently
    for rare events; conflating them is a classic verification error.
    """
    denominator = table.hits + table.false_alarms
    if denominator == 0:
        return _empty("far", Direction.LOWER_IS_BETTER, ForecastKind.BINARY,
                      "the event was never forecast")
    return MetricResult(
        "far", table.false_alarms / denominator, table.n,
        Direction.LOWER_IS_BETTER, ForecastKind.BINARY,
        extra=table.to_dict(),
    )


def critical_success_index(table: Contingency) -> MetricResult:
    """Hits / (hits + misses + false alarms).

    Ignores correct negatives, which is what makes it usable for rare
    events: accuracy would score a permanent "no" at 97% over a British
    year, and CSI scores it at 0.
    """
    denominator = table.hits + table.misses + table.false_alarms
    if denominator == 0:
        return _empty("csi", Direction.HIGHER_IS_BETTER, ForecastKind.BINARY,
                      "the event was neither forecast nor observed")
    return MetricResult(
        "csi", table.hits / denominator, table.n,
        Direction.HIGHER_IS_BETTER, ForecastKind.BINARY,
        extra=table.to_dict(),
    )


def frequency_bias(table: Contingency) -> MetricResult:
    """(hits + false alarms) / (hits + misses). Over- or under-forecasting.

    1 means the event was forecast as often as it occurred. Not accuracy:
    a forecast can have perfect frequency bias and no skill at all if it
    puts the events in the wrong places.
    """
    denominator = table.hits + table.misses
    if denominator == 0:
        return _empty("frequency_bias", Direction.ZERO_IS_BEST,
                      ForecastKind.BINARY, "no observed events")
    return MetricResult(
        "frequency_bias", (table.hits + table.false_alarms) / denominator,
        table.n, Direction.ZERO_IS_BEST, ForecastKind.BINARY,
        extra={**table.to_dict(), "perfect_value": 1.0},
    )


# ---------------------------------------------------------------------------
# Skill scores
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class SkillScore:
    """One metric expressed relative to a reference forecast.

        skill = 1 - metric_model / metric_reference     (lower-is-better)
        skill = (metric_model - ref) / (perfect - ref)  (higher-is-better)

    1 is perfect, 0 is no better than the reference, negative is worse.

    The REFERENCE MUST BE STATED. "Skill" against climatology, against
    persistence and against the multi-model mean are three different
    numbers, and comparing them as though they were one is a common and
    serious error. It is a required field here.
    """

    metric: str
    value: float | None
    reference: str
    n: int
    model_metric: float | None = None
    reference_metric: float | None = None
    reason: str = ""

    @property
    def available(self) -> bool:
        return self.value is not None and math.isfinite(self.value)

    def to_dict(self) -> dict:
        return {
            "metric": self.metric,
            "skill": round(float(self.value), 6) if self.available else None,
            "reference": self.reference,
            "n": self.n,
            "model_metric": self.model_metric,
            "reference_metric": self.reference_metric,
            "reason": self.reason,
            "interpretation": (
                "1 = perfect, 0 = no better than the reference, "
                "negative = worse than the reference"
            ),
        }


def skill_score(
    model: MetricResult, reference: MetricResult, reference_name: str,
    *, perfect: float | None = None,
) -> SkillScore:
    """Express `model` relative to `reference`."""
    if not model.available or not reference.available:
        return SkillScore(
            model.name, None, reference_name, model.n,
            reason="model or reference metric unavailable",
        )
    if model.direction is not reference.direction:
        raise ValueError(
            f"cannot compare {model.name} against a reference with a "
            f"different direction"
        )

    if model.direction is Direction.LOWER_IS_BETTER:
        if reference.value == 0:
            return SkillScore(
                model.name, None, reference_name, model.n,
                model.value, reference.value,
                reason="the reference forecast is perfect, so relative "
                       "skill is undefined",
            )
        value = 1.0 - model.value / reference.value
    elif model.direction is Direction.HIGHER_IS_BETTER:
        target = 1.0 if perfect is None else perfect
        denominator = target - reference.value
        if denominator == 0:
            return SkillScore(
                model.name, None, reference_name, model.n,
                model.value, reference.value,
                reason="the reference already achieves the perfect score",
            )
        value = (model.value - reference.value) / denominator
    else:
        # ZERO_IS_BEST: compare magnitudes.
        if reference.value == 0:
            return SkillScore(
                model.name, None, reference_name, model.n,
                model.value, reference.value,
                reason="the reference is unbiased, so relative skill is "
                       "undefined",
            )
        value = 1.0 - abs(model.value) / abs(reference.value)

    return SkillScore(
        model.name, float(value), reference_name, model.n,
        float(model.value), float(reference.value),
    )


CONTINUOUS_METRICS = (mae, rmse, bias, median_absolute_error, correlation)
PROBABILITY_METRICS = (brier_score, reliability, roc_auc)


def evaluate(
    forecast, observation, kind: ForecastKind,
    *, event_threshold: float | None = None,
) -> dict[str, MetricResult]:
    """Every metric appropriate to `kind`. Never one that is not.

    Scoring a probability with RMSE, or a rare event with accuracy, produces
    a number that looks like skill and is not -- so the dispatch is by
    forecast kind and there is no way to ask for an inapplicable metric.
    """
    out: dict[str, MetricResult] = {}
    if kind is ForecastKind.CONTINUOUS:
        for metric in CONTINUOUS_METRICS:
            result = metric(forecast, observation)
            out[result.name] = result
    elif kind is ForecastKind.PROBABILITY:
        for metric in PROBABILITY_METRICS:
            result = metric(forecast, observation)
            out[result.name] = result
        if event_threshold is not None:
            table = contingency(forecast, observation, event_threshold)
            for metric in (probability_of_detection, false_alarm_ratio,
                           critical_success_index, frequency_bias):
                result = metric(table)
                out[result.name] = result
    elif kind is ForecastKind.BINARY:
        table = contingency(forecast, observation,
                            event_threshold if event_threshold else 0.5)
        for metric in (probability_of_detection, false_alarm_ratio,
                       critical_success_index, frequency_bias):
            result = metric(table)
            out[result.name] = result
    else:
        raise ValueError(f"unhandled forecast kind {kind}")
    return out
