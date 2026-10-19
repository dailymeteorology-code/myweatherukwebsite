"""The probabilistic machinery: links, combination and calibration.

WHY A LINK EXISTS AT ALL
------------------------
Stage 5 emits POTENTIALS -- bounded measures of environmental favourability
-- and one uncalibrated probability. A potential of 0.7 does not mean 70% of
such atmospheres produce storms; it means "0.7 of the way to as supportive
as it gets". Multiplying two potentials together produces a number with no
probabilistic meaning at all, which is what section 5 forbids.

Section 5 also says what makes multiplication legitimate: the quantities must
"explicitly have been constructed as valid probabilities with compatible
conditional meanings". So each stage's potential passes through a documented
`Link` that maps it onto a probability with a stated meaning, and only then
are they combined:

    P(thunderstorm) = P(environment supports deep convection)
                      x P(storm realised | environment supports it)

That is a genuine conditional chain, and multiplication is the correct
operation for one.

THE LINK ANCHORS ARE CALIBRATION PARAMETERS
--------------------------------------------
A link needs two anchors, and no verification data exists to fit them. They
are therefore declared as CALIBRATION parameters with deliberately
conservative defaults, and any probability produced with the defaults is
marked `UNCALIBRATED` all the way to the output. Section 81 permits exactly
this during development -- "clearly marked as uncalibrated" -- and section 33
requires that the marking never quietly disappears.

The defaults are chosen to be uninformative rather than plausible: they
deliberately do NOT reproduce a realistic UK thunderstorm base rate, because
a number that looks right invites being trusted. `CalibrationStatus` is the
only thing that says whether it can be.

CORRELATED EVIDENCE
-------------------
Section 73. The thermodynamic, updraught and entrainment engines all read
CAPE. Combining them as independent evidence would count it three times, and
a noisy-OR or a sum would compound it into false confidence. They are
combined by geometric mean -- the same rule Stage 5 uses for ingredients,
scale-preserving and non-compounding -- and the shared-input overlap is
computed from the engines' own declared `input_diagnostics` and reported.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np

#: Probabilities are held away from exactly 0 and 1 so log-odds stay finite.
#: Not a fudge: a forecast of exactly 0 asserts the event is impossible,
#: which no atmospheric forecast can support, and a single such value would
#: make any log-scoring rule infinite.
EPSILON = 1e-6

#: The floor applied ONLY where a LOG-ODDS is taken, and deliberately far
#: below EPSILON. EPSILON is a statement about reporting -- no forecast
#: should be published as exactly 0 -- but using it inside `logit` collapses
#: every probability under 1e-6 onto one value and destroys the ordering
#: between them. For a rare hazard that is most of the domain: a UKV
#: lightning field whose densities run to 4e-6 loses its entire ranking.
#:
#: 1e-45 keeps the log-odds inside +/-104, comfortably within the +/-500
#: bound `logistic` clips at, so raw -> logit -> logistic round-trips
#: order-preservingly across 45 decades -- far more than any real forecast
#: field spans.
LOGIT_FLOOR = 1e-45


def logistic(x: float | np.ndarray) -> float | np.ndarray:
    """1 / (1 + exp(-x)), overflow-safe."""
    x = np.asarray(x, dtype="float64")
    out = np.where(
        x >= 0,
        1.0 / (1.0 + np.exp(-np.clip(x, -500, 500))),
        np.exp(np.clip(x, -500, 500)) / (1.0 + np.exp(np.clip(x, -500, 500))),
    )
    return float(out) if out.ndim == 0 else out


def logit(p: float | np.ndarray) -> float | np.ndarray:
    """Log-odds, with probabilities held away from 0 and 1.

    The bound is LOGIT_FLOOR, not EPSILON: see the note on that constant.
    Clipping at 1e-6 here silently flattened the bottom of every rare-event
    field into a single log-odds value.
    """
    p = np.clip(np.asarray(p, dtype="float64"),
                LOGIT_FLOOR, 1.0 - LOGIT_FLOOR)
    out = np.log(p / (1.0 - p))
    return float(out) if out.ndim == 0 else out


class CalibrationStatus(str, Enum):
    """Whether a probability may be presented as one."""

    #: Produced by the documented structure with DEFAULT link anchors and
    #: no verification behind it. Structured like a probability, ordered
    #: like a probability, and not verified against any observed frequency.
    UNCALIBRATED = "uncalibrated"
    #: A calibration model has been fitted but on too little data to trust.
    PROVISIONAL = "provisional"
    #: Fitted and verified against held-out observations.
    CALIBRATED = "calibrated"

    @property
    def publishable(self) -> bool:
        """Whether this may be shown to a user as a probability.

        UNCALIBRATED is not publishable. Section 33: every public TCM
        probability must pass through calibration.
        """
        return self is CalibrationStatus.CALIBRATED


@dataclass(frozen=True, slots=True)
class Link:
    """Maps a Stage 5 potential onto a probability with a stated meaning.

    Logistic in the potential, anchored at two points:

        `low` maps to `low_probability`
        `high` maps to `high_probability`

    Two anchors fully determine the curve, so there is no separate steepness
    to tune -- the same discipline as the Stage 5 transfers.
    """

    name: str
    #: What the output probability MEANS. Required: a link whose output has
    #: no stated meaning cannot be multiplied by anything.
    meaning: str
    low: float = 0.2
    low_probability: float = 0.02
    high: float = 0.8
    high_probability: float = 0.60
    #: Set True once these anchors have been fitted against observations.
    fitted: bool = False
    #: Where the anchors came from.
    basis: str = (
        "DEFAULT, unfitted. Deliberately conservative and deliberately not "
        "tuned to look like a realistic base rate: a number that looks right "
        "invites being trusted"
    )

    def __post_init__(self) -> None:
        if not self.meaning.strip():
            raise ValueError(
                f"link {self.name!r} has no stated meaning. A probability "
                f"with no meaning cannot legitimately be multiplied by "
                f"another one"
            )
        if not (0.0 < self.low_probability < self.high_probability < 1.0):
            raise ValueError(
                f"link {self.name!r}: anchors must satisfy "
                f"0 < low_probability < high_probability < 1"
            )
        if self.low >= self.high:
            raise ValueError(f"link {self.name!r}: low must be below high")

    def __call__(self, potential: float | None) -> float | None:
        if potential is None:
            return None
        value = float(potential)
        if not math.isfinite(value):
            return None
        a = logit(self.low_probability)
        b = logit(self.high_probability)
        slope = (b - a) / (self.high - self.low)
        return float(logistic(a + slope * (value - self.low)))

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "meaning": self.meaning,
            "anchors": {
                str(self.low): self.low_probability,
                str(self.high): self.high_probability,
            },
            "fitted": self.fitted,
            "basis": self.basis,
        }


@dataclass(slots=True)
class Combination:
    """The result of combining correlated engine outputs."""

    value: float
    #: Engines that contributed, with their potentials.
    contributions: dict[str, float] = dc_field(default_factory=dict)
    #: Upstream diagnostics read by more than one contributor.
    shared_inputs: dict[str, list[str]] = dc_field(default_factory=dict)
    #: How many independent opinions the contributors represent.
    effective_independent: float = 0.0
    missing: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "value": round(self.value, 6),
            "contributions": {
                k: round(v, 4) for k, v in self.contributions.items()
            },
            "shared_inputs": self.shared_inputs,
            "effective_independent_engines": round(
                self.effective_independent, 3
            ),
            "missing": list(self.missing),
            "method": "geometric_mean_over_correlated_engines",
            "why": (
                "these engines share upstream diagnostics, so a sum or a "
                "noisy-OR would count the same evidence several times. The "
                "geometric mean is scale-preserving and does not compound"
            ),
        }


def combine_correlated(
    values: dict[str, float | None],
    inputs: dict[str, tuple[str, ...]],
    *, minimum: int = 2,
) -> Combination | None:
    """Combine engine outputs that share upstream evidence.

    Geometric mean, deliberately: five engines each at 0.8 give 0.8, not
    0.33, and any one going to zero takes the result to zero. Missing
    contributors are EXCLUDED rather than replaced by a neutral value --
    an absent engine must not argue for a middling answer.

    The shared-input overlap is computed from the engines' declared inputs
    and reported so the double-counting risk is visible rather than assumed
    away.
    """
    usable = {
        name: float(v) for name, v in values.items()
        if v is not None and math.isfinite(float(v))
    }
    missing = tuple(sorted(set(values) - set(usable)))
    if len(usable) < max(1, minimum):
        return None

    seen: dict[str, list[str]] = {}
    for name in usable:
        for diagnostic in inputs.get(name, ()):
            seen.setdefault(diagnostic, []).append(name)
    shared = {
        diagnostic: sorted(engines)
        for diagnostic, engines in sorted(seen.items())
        if len(engines) > 1
    }

    memberships = list(usable.values())
    if any(m <= 0.0 for m in memberships):
        value = 0.0
    else:
        value = float(np.exp(np.mean(np.log(memberships))))

    return Combination(
        value=min(1.0, max(0.0, value)),
        contributions={k: round(v, 4) for k, v in usable.items()},
        shared_inputs=shared,
        effective_independent=_effective_engines(usable, inputs),
        missing=missing,
    )


def _effective_engines(
    usable: dict[str, float], inputs: dict[str, tuple[str, ...]]
) -> float:
    """How many independent opinions a set of engines represents.

    The same idea as Stage 6's model independence, applied to engines. Two
    engines sharing most of their inputs are close to one opinion. Measured
    by mean pairwise Jaccard overlap of declared inputs:

        effective = n / (1 + (n - 1) * mean_overlap)

    With no overlap this is n; with total overlap it is 1. Reported, not
    used to scale anything -- the geometric mean already avoids compounding.
    It exists so the aggregation layer can SEE the dependence.
    """
    names = list(usable)
    if len(names) < 2:
        return float(len(names))
    overlaps = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            sa, sb = set(inputs.get(a, ())), set(inputs.get(b, ()))
            if not sa or not sb:
                continue
            overlaps.append(len(sa & sb) / len(sa | sb))
    mean_overlap = float(np.mean(overlaps)) if overlaps else 0.0
    n = len(names)
    return round(n / (1.0 + (n - 1) * mean_overlap), 4)


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class Calibrator:
    """Maps a raw probability onto a verified one.

    Three methods, chosen by testing rather than asserted (section 33):

        identity   no calibration. The state until observations exist, and
                   it says so rather than pretending
        logistic   Platt scaling: a two-parameter fit in log-odds. Robust on
                   small samples; cannot fix a badly shaped curve
        isotonic   a monotone step fit. Flexible enough to repair any
                   monotone miscalibration, and prone to overfitting a small
                   sample into a staircase

    SHARPNESS IS NOT SACRIFICED FOR RELIABILITY. Section 37: pushing every
    forecast towards climatology gives excellent average calibration and a
    useless forecast, so `fit` records sharpness before and after and
    `degrades_sharpness` flags a calibration that has flattened the
    distribution.
    """

    method: str = "identity"
    status: CalibrationStatus = CalibrationStatus.UNCALIBRATED
    #: Platt parameters.
    slope: float = 1.0
    intercept: float = 0.0
    #: Isotonic knots: (raw, calibrated), ascending in raw.
    knots: tuple[tuple[float, float], ...] = ()
    n_fitted: int = 0
    fitted_at: datetime | None = None
    #: The regime this calibrator applies to. Empty means all regimes.
    regime: str = ""
    version: str = "1.0"
    notes: tuple[str, ...] = ()
    sharpness_before: float | None = None
    sharpness_after: float | None = None

    #: Below this many events a fit is provisional at best. Isotonic on a
    #: handful of cases produces a staircase that verifies its own noise.
    MINIMUM_EVENTS = 100

    def __call__(self, probability: float | np.ndarray):
        # The input is NOT clipped. Clipping it to EPSILON collapses every
        # probability below 1e-6 onto the same value and destroys the
        # ordering between them -- which for a rare hazard is most of the
        # domain. Verifying a UKV lightning field whose densities run to
        # 4e-6, the identity calibrator alone moved ROC-AUC from 0.598 to
        # 0.517, purely from that clip. An identity calibration must be
        # exactly identity.
        #
        # The clip exists only so `logit` stays finite, so it is applied
        # only where a logit is actually taken.
        p = np.asarray(probability, dtype="float64")
        if self.method == "identity":
            out = p
        elif self.method == "logistic":
            # `logit` applies its own order-preserving floor; clipping to
            # EPSILON first would undo it.
            out = logistic(self.slope * logit(p) + self.intercept)
        elif self.method == "isotonic":
            if not self.knots:
                out = p
            else:
                # Anchored at (0, 0) and (1, 1) rather than left to
                # `np.interp`'s default clamping. Clamping maps EVERY raw
                # value below the lowest knot onto one number, and on a
                # rare-event field that is most of the domain -- measured at
                # 76% of a log-uniform lightning field, which is precisely
                # the ordering collapse the identity branch above was fixed
                # for. Anchoring keeps the map monotone AND injective.
                xs = np.array([0.0] + [k[0] for k in self.knots] + [1.0])
                ys = np.array([0.0] + [k[1] for k in self.knots] + [1.0])
                out = np.interp(p, xs, ys)
        else:
            raise ValueError(f"unknown calibration method {self.method!r}")
        # The OUTPUT is bounded to the open unit interval, which is a
        # statement about probabilities rather than about ordering.
        out = np.clip(out, 0.0, 1.0)
        return float(out) if np.ndim(out) == 0 else out

    @property
    def degrades_sharpness(self) -> bool:
        """True when calibration has flattened the forecast distribution.

        A calibrator that pushes everything towards the base rate scores
        well on reliability and is useless. Section 37.
        """
        if self.sharpness_before is None or self.sharpness_after is None:
            return False
        if self.sharpness_before <= 0:
            return False
        return self.sharpness_after < 0.5 * self.sharpness_before

    def to_dict(self) -> dict:
        return {
            "method": self.method,
            "status": self.status.value,
            "publishable": self.status.publishable,
            "n_fitted": self.n_fitted,
            "fitted_at": (
                self.fitted_at.isoformat() if self.fitted_at else None
            ),
            "regime": self.regime or "all",
            "version": self.version,
            "sharpness_before": (
                round(self.sharpness_before, 5)
                if self.sharpness_before is not None else None
            ),
            "sharpness_after": (
                round(self.sharpness_after, 5)
                if self.sharpness_after is not None else None
            ),
            "degrades_sharpness": self.degrades_sharpness,
            "notes": list(self.notes),
        }


def fit_calibrator(
    raw: np.ndarray, observed: np.ndarray, *,
    method: str = "logistic", regime: str = "",
    now: datetime | None = None,
) -> Calibrator:
    """Fit a calibrator on held-out forecast/observation pairs.

    The caller is responsible for the separation: section 34 requires the
    calibration data to be independent of whatever fitted the underlying
    model, and section 35 requires the split to be temporal rather than
    random. `evaluate.py` does the splitting; this function only fits.
    """
    raw = np.clip(np.asarray(raw, dtype="float64"),
                  LOGIT_FLOOR, 1 - LOGIT_FLOOR)
    observed = np.asarray(observed, dtype="float64")
    ok = np.isfinite(raw) & np.isfinite(observed)
    raw, observed = raw[ok], observed[ok]

    events = int(np.count_nonzero(observed > 0.5))
    notes: list[str] = []
    if raw.size == 0:
        return Calibrator(
            method="identity", status=CalibrationStatus.UNCALIBRATED,
            notes=("no usable pairs; calibration not attempted",),
        )

    sharpness_before = float(np.var(raw))

    refused = False
    if method == "logistic":
        slope, intercept = _fit_platt(raw, observed)
        if slope <= 0.0:
            # A NEGATIVE SLOPE IS NOT A CALIBRATION.
            #
            # `logistic(a*logit(p) + b)` is monotone decreasing when a < 0,
            # so applying it reverses the ranking of every forecast: the
            # cells the model thought most likely become the least likely.
            # That is a claim about DISCRIMINATION, and calibration is not
            # entitled to make it. Calibration adjusts the level of a
            # probability; if a forecast is genuinely anti-informative that
            # is a verification finding to report, not something to patch
            # over by flipping the sign.
            #
            # It is a real fit, not a numerical accident: on the UKV
            # lightning training episode the slope came out at -0.057
            # because that episode's top 1% of forecasts contained no
            # observed flashes at all. Fitting 162 events from a single
            # outbreak is not evidence that the model is inverted.
            notes.append(
                f"the Platt fit returned a negative slope ({slope:.4f}), "
                f"which would reverse the ranking of every forecast rather "
                f"than adjust its level. Calibration is not entitled to "
                f"invert a forecast, so this fit is refused and the raw "
                f"probabilities stand. If the forecast really is "
                f"anti-informative, that is a verification finding"
            )
            slope, intercept = 1.0, 0.0
            refused = True
        calibrator = Calibrator(
            method="logistic", slope=slope, intercept=intercept,
        )
    elif method == "isotonic":
        knots = _fit_isotonic(raw, observed)
        calibrator = Calibrator(method="isotonic", knots=knots)
        if events < Calibrator.MINIMUM_EVENTS:
            notes.append(
                f"isotonic fitted on only {events} events; it will have "
                f"reproduced sampling noise as a staircase. Logistic is the "
                f"safer choice at this sample size"
            )
    else:
        raise ValueError(f"unknown calibration method {method!r}")

    calibrated = calibrator(raw)
    calibrator.sharpness_before = sharpness_before
    calibrator.sharpness_after = float(np.var(calibrated))
    calibrator.n_fitted = int(raw.size)
    calibrator.fitted_at = now
    calibrator.regime = regime

    if refused:
        calibrator.status = CalibrationStatus.UNCALIBRATED
    elif events < Calibrator.MINIMUM_EVENTS:
        calibrator.status = CalibrationStatus.PROVISIONAL
        notes.append(
            f"{events} events against the {Calibrator.MINIMUM_EVENTS} "
            f"required for a trusted fit; status is PROVISIONAL and these "
            f"probabilities are not publishable"
        )
    else:
        calibrator.status = CalibrationStatus.CALIBRATED

    if calibrator.degrades_sharpness:
        notes.append(
            f"calibration halved the forecast variance "
            f"({sharpness_before:.4f} -> {calibrator.sharpness_after:.4f}). "
            f"That is reliability bought by pushing forecasts towards "
            f"climatology, which section 37 warns against"
        )
    calibrator.notes = tuple(notes)
    return calibrator


def _fit_platt(raw, observed, iterations: int = 100):
    """Two-parameter logistic regression of outcome on raw log-odds.

    Newton-Raphson on the log-likelihood. Small, closed and dependency-free;
    scikit-learn is not installed and is not needed for two parameters.
    """
    x = logit(raw)
    events = (observed > 0.5).astype("float64")

    # Platt's (1999) target smoothing, section 2.1. Fitting against hard
    # 0/1 targets is maximum-likelihood on separable data, where the
    # likelihood is maximised only as the slope runs to infinity -- Newton
    # then walks off and the calibration saturates every forecast to 0 or 1.
    # Regularised targets are the standard remedy and cost nothing when the
    # data are not separable: they shrink by 1/(N+2), which is negligible
    # once N is large and decisive when it is not.
    n_pos = float(np.count_nonzero(events))
    n_neg = float(events.size - n_pos)
    hi = (n_pos + 1.0) / (n_pos + 2.0)
    lo = 1.0 / (n_neg + 2.0)
    y = np.where(events > 0.5, hi, lo)

    slope, intercept = 1.0, 0.0
    for _ in range(iterations):
        p = logistic(slope * x + intercept)
        w = np.clip(p * (1.0 - p), 1e-9, None)
        residual = y - p
        # Gradient and Hessian of the log-likelihood.
        g = np.array([np.sum(residual * x), np.sum(residual)])
        h = np.array([
            [-np.sum(w * x * x), -np.sum(w * x)],
            [-np.sum(w * x), -np.sum(w)],
        ])
        try:
            # step = -H^-1 g, which IS the Newton increment. It is ADDED:
            # theta_new = theta - H^-1 g = theta + step. Subtracting it
            # instead walks away from the optimum, and the fit came out
            # worse than no calibration at all.
            step = np.linalg.solve(h, -g)
        except np.linalg.LinAlgError:
            break
        # Damp a wild step. Newton is only locally quadratic, and an
        # early iteration on near-separable data can propose a slope of
        # several hundred, from which it never returns.
        largest = float(np.max(np.abs(step)))
        if largest > 4.0:
            step = step * (4.0 / largest)
        slope += step[0]
        intercept += step[1]
        if np.max(np.abs(step)) < 1e-8:
            break
    if not (np.isfinite(slope) and np.isfinite(intercept)):
        # Refusing to calibrate is better than calibrating with a diverged
        # fit; identity parameters leave the forecast as it was.
        return 1.0, 0.0
    return float(slope), float(intercept)


def _fit_isotonic(raw, observed, bins: int | None = None):
    """Monotone step fit by pool-adjacent-violators on binned means.

    THE BINS FOLLOW THE DATA, NOT THE UNIT INTERVAL. Ten equal-width bins
    over [0, 1] are the obvious choice and are wrong for every hazard this
    platform forecasts: a rare-event field lives almost entirely below 0.1,
    so nine of the ten bins are empty and the fit collapses to two or three
    knots. Measured on a 40,000-pair lightning-like field, equal-width
    binning produced 3 knots and LOWERED ROC-AUC from 0.941 to 0.931 --
    calibration destroying discrimination the raw forecast already had.

    Quantile edges put a bin boundary where the data actually is, so the
    curve is resolved where it is being used. The bin COUNT is tied to the
    number of observed events rather than fixed, because the thing that
    limits how finely this can be estimated is events, not pairs: roughly
    ten events per bin, bounded to [5, 40].
    """
    order = np.argsort(raw)
    x, y = raw[order], (observed[order] > 0.5).astype("float64")
    if bins is None:
        events = int(np.count_nonzero(y))
        bins = int(np.clip(events // 10, 5, 40))
    # Quantile edges, deduplicated: a field with many tied values (a
    # thresholded forecast, say) can produce fewer distinct edges than
    # requested, and that is the honest resolution for it.
    edges = np.unique(np.quantile(x, np.linspace(0.0, 1.0, bins + 1)))
    if edges.size < 3:
        # Not enough distinct values to bin at all.
        return ((float(np.mean(x)), float(np.mean(y))),)
    bins = edges.size - 1
    index = np.clip(np.digitize(x, edges[1:-1]), 0, bins - 1)

    centres, means, counts = [], [], []
    for k in range(bins):
        mask = index == k
        if not np.any(mask):
            continue
        centres.append(float(np.mean(x[mask])))
        means.append(float(np.mean(y[mask])))
        counts.append(int(np.count_nonzero(mask)))
    if not centres:
        return ()

    # Pool adjacent violators: enforce monotonicity by merging any bin whose
    # mean falls below its predecessor.
    values = list(means)
    weights = list(counts)
    i = 0
    while i < len(values) - 1:
        if values[i] <= values[i + 1]:
            i += 1
            continue
        total = weights[i] + weights[i + 1]
        pooled = (values[i] * weights[i] + values[i + 1] * weights[i + 1]) \
            / total
        values[i:i + 2] = [pooled]
        weights[i:i + 2] = [total]
        centres[i:i + 2] = [np.mean(centres[i:i + 2])]
        i = max(i - 1, 0)

    return tuple(
        (float(c), float(min(max(v, EPSILON), 1 - EPSILON)))
        for c, v in zip(centres, values)
    )


def reliability_diagram(
    probability, observed, bins: int = 10
) -> dict:
    """Forecast probability against observed frequency, by bin.

    The single most informative verification of a probability forecast, and
    the reason it is returned in full rather than as a scalar: a summary
    number cannot show WHERE a forecast is miscalibrated, and a forecast
    that is reliable at 10% and badly overconfident at 70% is a specific,
    fixable problem.
    """
    p = np.clip(np.asarray(probability, dtype="float64"), 0.0, 1.0)
    o = np.asarray(observed, dtype="float64")
    ok = np.isfinite(p) & np.isfinite(o)
    p, o = p[ok], o[ok]
    if p.size == 0:
        return {"available": False, "reason": "no usable pairs"}

    edges = np.linspace(0.0, 1.0, bins + 1)
    index = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    rows = []
    for k in range(bins):
        mask = index == k
        n = int(np.count_nonzero(mask))
        if n == 0:
            continue
        rows.append({
            "bin": f"{edges[k]:.1f}-{edges[k+1]:.1f}",
            "n": n,
            "mean_forecast": round(float(np.mean(p[mask])), 4),
            "observed_frequency": round(float(np.mean(o[mask] > 0.5)), 4),
            # A bin of a handful of cases says nothing about calibration.
            "sufficient": n >= 30,
        })

    base_rate = float(np.mean(o > 0.5))
    return {
        "available": True,
        "bins": rows,
        "base_rate": round(base_rate, 5),
        "sharpness": round(float(np.var(p)), 5),
        "n": int(p.size),
        "note": (
            "sharpness is the variance of the forecasts. A forecast that "
            "always says the base rate is perfectly reliable and has zero "
            "sharpness -- it is also useless"
        ),
    }
