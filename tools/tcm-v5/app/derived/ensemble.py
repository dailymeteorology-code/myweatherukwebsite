"""Ensemble statistics: percentiles, spread, agreement.

Two honesty rules are enforced here rather than left to the caller.

**Percentiles are not scenarios.** P90 is the 90th percentile computed
independently at every grid cell. The P90 map is therefore not a forecast any
single ensemble member produced, and the heaviest-rain cell on it is not
necessarily raining at the same time as the cell next to it. `PercentileField`
carries `spatially_coherent=False` so the API and UI cannot quietly present it
as "the wet scenario". Scenario clusters, which ARE coherent because they are
built from whole members, are a separate product.

**Small ensembles are labelled small.** MOGREPS-UK is time-lagged and delivers
3 members per cycle. The 10th and 90th percentiles of 3 samples are an
extrapolation of the tails, not a measurement of them, so `reliability` says
so and never silently presents 3 members as a distribution.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

import numpy as np

from ..grid import Field
from ..meta import FieldMeta, MemberKind

# The percentiles TCM computes for every ensemble-capable parameter.
PERCENTILES = (10, 25, 50, 75, 90)

# Below this many members, tail percentiles are extrapolation.
MIN_MEMBERS_FOR_TAILS = 8
MIN_MEMBERS_FOR_QUARTILES = 4


class Reliability(str, Enum):
    """How much the ensemble distribution can bear."""

    NONE = "none"                 # 0-1 members: no distribution at all
    INDICATIVE = "indicative"     # 2-3: central value only, tails meaningless
    LIMITED = "limited"           # 4-7: quartiles usable, tails weak
    GOOD = "good"                 # 8+: tails meaningful

    @classmethod
    def for_members(cls, n: int) -> "Reliability":
        if n < 2:
            return cls.NONE
        if n < MIN_MEMBERS_FOR_QUARTILES:
            return cls.INDICATIVE
        if n < MIN_MEMBERS_FOR_TAILS:
            return cls.LIMITED
        return cls.GOOD

    @property
    def tails_are_meaningful(self) -> bool:
        return self is Reliability.GOOD

    def caveat(self, n: int) -> str:
        if self is Reliability.NONE:
            return f"{n} member: no distribution can be formed"
        if self is Reliability.INDICATIVE:
            return (
                f"{n} members: the median is indicative, but P10 and P90 are "
                "extrapolated from the outer members and should not be quoted "
                "as a forecast range"
            )
        if self is Reliability.LIMITED:
            return (
                f"{n} members: quartiles are usable; P10 and P90 remain weak"
            )
        return f"{n} members: percentiles are meaningful"


@dataclass(frozen=True, slots=True)
class PercentileField:
    """One percentile of an ensemble, at every grid cell independently."""

    percentile: int
    values: np.ndarray
    meta: FieldMeta
    n_members: int
    reliability: Reliability
    #: Always False. A per-cell percentile is not a coherent weather scenario.
    spatially_coherent: bool = False

    def as_field(self) -> Field:
        return Field(self.values, self.meta)


@dataclass(frozen=True, slots=True)
class EnsembleSummary:
    """Everything TCM derives from a set of members for one parameter."""

    parameter: str
    model: str
    valid_time: datetime
    forecast_hour: int
    n_members: int
    members: tuple[int, ...]
    reliability: Reliability

    percentiles: dict[int, PercentileField]
    mean: np.ndarray
    #: Standard deviation across members, per cell.
    spread: np.ndarray
    #: P75-P25, a spread measure robust to a single outlying member.
    iqr: np.ndarray
    #: Fraction of members exceeding zero, per cell. Meaningful for
    #: precipitation and lightning; meaningless for temperature.
    exceedance_zero: np.ndarray

    @property
    def median(self) -> np.ndarray:
        return self.percentiles[50].values

    def summary_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "model": self.model,
            "valid_time": self.valid_time.isoformat(),
            "forecast_hour": self.forecast_hour,
            "n_members": self.n_members,
            "members": list(self.members),
            "reliability": self.reliability.value,
            "reliability_caveat": self.reliability.caveat(self.n_members),
            "tails_are_meaningful": self.reliability.tails_are_meaningful,
            "percentiles_available": sorted(self.percentiles),
            "spatially_coherent": False,
            "note": (
                "Percentiles are computed per grid cell. A percentile map is "
                "not a scenario any single member produced."
            ),
        }


def nan_percentiles(
    stack: np.ndarray, percentiles: tuple[int, ...] = PERCENTILES
) -> dict[int, np.ndarray]:
    """Per-cell percentiles across the member axis, ignoring NaN.

    Deliberately NOT `np.nanpercentile`. When the input contains any NaN,
    numpy falls back to applying a scalar routine cell by cell, which for a
    455 x 639 grid is ~290,000 Python-level calls -- measured at 220 seconds
    for five percentiles. This sorts once (NaNs sort to the end) and gathers
    the interpolated positions with vectorised indexing instead: same result,
    sub-second.

    Matches numpy's default "linear" interpolation. Cells where no member is
    finite return NaN rather than a fabricated value.
    """
    n_members = stack.shape[0]
    ordered = np.sort(stack, axis=0)          # NaN sort to the end
    count = np.isfinite(stack).sum(axis=0)
    valid = count > 0
    safe_count = np.maximum(count, 1)

    out: dict[int, np.ndarray] = {}
    for p in percentiles:
        position = (safe_count - 1).astype("float32") * (p / 100.0)
        lower = np.clip(np.floor(position).astype(np.intp), 0, n_members - 1)
        upper = np.clip(np.ceil(position).astype(np.intp), 0, n_members - 1)
        frac = (position - lower).astype("float32")

        v_lo = np.take_along_axis(ordered, lower[None, ...], axis=0)[0]
        v_hi = np.take_along_axis(ordered, upper[None, ...], axis=0)[0]
        value = v_lo + (v_hi - v_lo) * frac
        out[p] = np.where(valid, value, np.nan).astype("float32")
    return out


def _stack(fields: list[Field]) -> np.ndarray:
    if not fields:
        raise ValueError("no members supplied")
    shapes = {f.values.shape for f in fields}
    if len(shapes) != 1:
        raise ValueError(f"members have inconsistent shapes: {shapes}")
    return np.stack([f.values for f in fields]).astype("float32")


def _percentile_meta(base: FieldMeta, percentile: int, n: int) -> FieldMeta:
    """Metadata for a derived percentile.

    The member becomes None and the kind becomes ENSEMBLE_STAT, so a
    percentile can never be mistaken for a member. Resolution provenance is
    inherited unchanged: a percentile of 2.2 km members is 2.2 km data.
    """
    from dataclasses import replace

    return replace(
        base,
        member_kind=MemberKind.ENSEMBLE_STAT,
        member=None,
        extra={
            **base.extra,
            "statistic": f"P{percentile}",
            "n_members": n,
            "spatially_coherent": False,
        },
    )


def summarise(fields: list[Field]) -> EnsembleSummary:
    """Compute the full ensemble summary for one parameter and lead time."""
    if not fields:
        raise ValueError("no members supplied")

    parameters = {f.meta.parameter for f in fields}
    if len(parameters) != 1:
        raise ValueError(f"members span several parameters: {parameters}")
    hours = {f.meta.forecast_hour for f in fields}
    if len(hours) != 1:
        raise ValueError(f"members span several lead times: {hours}")

    stack = _stack(fields)
    n = stack.shape[0]
    base = fields[0].meta
    reliability = Reliability.for_members(n)

    raw_percentiles = nan_percentiles(stack)
    pct: dict[int, PercentileField] = {}
    for p in PERCENTILES:
        values = raw_percentiles[p]
        pct[p] = PercentileField(
            percentile=p,
            values=values,
            meta=_percentile_meta(base, p, n),
            n_members=n,
            reliability=reliability,
        )

    with np.errstate(invalid="ignore"):
        mean = np.nanmean(stack, axis=0).astype("float32")
        spread = np.nanstd(stack, axis=0).astype("float32")
        exceed = np.nanmean((stack > 0).astype("float32"), axis=0)

    iqr = (pct[75].values - pct[25].values).astype("float32")

    return EnsembleSummary(
        parameter=base.parameter,
        model=base.model,
        valid_time=base.valid_time,
        forecast_hour=base.forecast_hour,
        n_members=n,
        members=tuple(
            sorted(f.meta.member for f in fields if f.meta.member is not None)
        ),
        reliability=reliability,
        percentiles=pct,
        mean=mean,
        spread=spread,
        iqr=iqr,
        exceedance_zero=exceed,
    )


def probability_over(fields: list[Field], threshold: float) -> np.ndarray:
    """Fraction of members exceeding a threshold, per cell."""
    stack = _stack(fields)
    with np.errstate(invalid="ignore"):
        return np.nanmean((stack > threshold).astype("float32"), axis=0)


def normalised_spread(summary: EnsembleSummary) -> np.ndarray:
    """Spread scaled by the magnitude of the field, for cross-parameter use.

    A 2 K spread in temperature and a 2 mm spread in rainfall are not
    comparable; dividing by a robust scale makes them so. Cells where the
    field is essentially zero return 0 rather than dividing by nothing.
    """
    scale = np.abs(summary.median)
    typical = float(np.nanmedian(scale[np.isfinite(scale) & (scale > 0)] ) or 1.0)
    denom = np.where(scale > typical * 0.05, scale, typical)
    out = np.divide(
        summary.spread, denom,
        out=np.zeros_like(summary.spread), where=np.isfinite(denom) & (denom > 0),
    )
    return np.clip(out, 0.0, 10.0)


def agreement_score(summary: EnsembleSummary) -> float:
    """One number in 0..1 for how tightly the members agree.

    1.0 = members are effectively identical. Reported alongside, never
    instead of, the member count: three members agreeing is much weaker
    evidence than eighteen agreeing.
    """
    rel = normalised_spread(summary)
    finite = rel[np.isfinite(rel)]
    if finite.size == 0:
        return 0.0
    mean_rel = float(np.mean(finite))
    return float(np.clip(1.0 / (1.0 + 4.0 * mean_rel), 0.0, 1.0))
