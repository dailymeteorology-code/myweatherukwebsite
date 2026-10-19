"""Baselines. Nothing is skilful except relative to something.

Section 22 of the Stage 9 order, plus 24 and 89.

    Every TCM verification result must have something to compare against.

The ladder below is ordered so that each rung isolates one layer of the
system. If TCM beats climatology but not persistence, the sophistication is
buying nothing that a forecaster's rule of thumb does not already give.

    climatology       the event's own base rate. The floor.
    persistence       what happened last hour. Beats climatology surprisingly
                      often for convection already in progress.
    always_zero       forecast no thunderstorms, ever. Scores extremely well
                      on a quiet domain by Brier score alone, and is
                      completely useless -- which is exactly why it is here.
    equal_models      multi-model mean with no adaptive weighting, to
                      isolate what Stage 6 contributes.
    specialist_only   Stage 5 without spatial forcing, to isolate Stage 8.

WHY always_zero IS IN THE LADDER
--------------------------------
A UK grid cell has lightning within 10 km in roughly one hour in a thousand.
A forecast of zero everywhere therefore achieves a Brier score around 0.001,
which looks superb. Any system reporting Brier scores without this baseline
alongside is inviting itself to be fooled, and section 28's insistence on
sharpness and resolution is the formal version of the same point.

CLIMATOLOGY MUST NOT BE FITTED ON THE TEST PERIOD
-------------------------------------------------
Section 30. A climatology computed from the same hours it is scored against
has seen the answer, and its Brier score is optimistically low. `Climatology`
therefore records the period it was estimated from, and `check_disjoint`
refuses a comparison where that period overlaps the evaluation window.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

import numpy as np

log = logging.getLogger(__name__)

BASELINES_VERSION = "stage9.1"


@dataclass(frozen=True, slots=True)
class Climatology:
    """A base rate, and the period it was estimated over."""

    rate: float
    fitted_from: datetime | None
    fitted_to: datetime | None
    n_samples: int
    n_events: int
    label: str = "climatology"

    def grid(self, shape) -> np.ndarray:
        return np.full(shape, self.rate, dtype="float64")

    def to_dict(self) -> dict:
        return {
            "baseline": self.label,
            "rate": round(self.rate, 8),
            "fitted_from": (
                self.fitted_from.isoformat() if self.fitted_from else None
            ),
            "fitted_to": (
                self.fitted_to.isoformat() if self.fitted_to else None
            ),
            "n_samples": self.n_samples,
            "n_events": self.n_events,
        }


def climatology_from(fields) -> Climatology:
    """Estimate the event base rate from a set of matched fields."""
    total = events = 0
    first = last = None
    for field in fields:
        _, observed = field.pairs()
        total += observed.size
        events += int(observed.sum())
        first = field.valid_time if first is None else min(
            first, field.valid_time)
        last = field.valid_time if last is None else max(
            last, field.valid_time)
    rate = events / total if total else 0.0
    return Climatology(
        rate=rate, fitted_from=first, fitted_to=last,
        n_samples=total, n_events=events,
    )


def check_disjoint(
    climatology: Climatology, evaluation_from: datetime,
    evaluation_to: datetime,
) -> str | None:
    """Section 30. Refuse a climatology fitted on the evaluation period.

    Returns a complaint, or None when the periods are disjoint.
    """
    if climatology.fitted_from is None or climatology.fitted_to is None:
        return None
    overlaps = (
        climatology.fitted_from <= evaluation_to
        and evaluation_from <= climatology.fitted_to
    )
    if not overlaps:
        return None
    return (
        f"the climatology was fitted over "
        f"{climatology.fitted_from:%Y-%m-%d %HZ}.."
        f"{climatology.fitted_to:%Y-%m-%d %HZ}, which overlaps the "
        f"evaluation window {evaluation_from:%Y-%m-%d %HZ}.."
        f"{evaluation_to:%Y-%m-%d %HZ}. A baseline that has seen the "
        f"answer scores too well, and the skill score against it is "
        f"correspondingly too low -- the comparison is not valid"
    )


def always_zero(shape) -> np.ndarray:
    """The null forecast. Scores beautifully on a quiet domain."""
    return np.zeros(shape, dtype="float64")


def persistence(previous_observed: np.ndarray | None, shape) -> np.ndarray:
    """Last hour's observation as this hour's forecast.

    Returns NaN when there is no previous hour, rather than zeros: an
    absent baseline is not a baseline forecasting no storms.
    """
    if previous_observed is None:
        return np.full(shape, np.nan, dtype="float64")
    return np.asarray(previous_observed, dtype="float64").copy()


@dataclass(frozen=True, slots=True)
class BaselineSet:
    """Every baseline for one matched field, ready to score against."""

    valid_time: datetime
    grids: dict[str, np.ndarray]

    def names(self) -> list[str]:
        return sorted(self.grids)


def build(
    fields, climatology: Climatology | None = None,
) -> list[BaselineSet]:
    """Baseline grids for each matched field, in time order."""
    ordered = sorted(fields, key=lambda f: f.valid_time)
    climatology = climatology or climatology_from(ordered)

    out: list[BaselineSet] = []
    previous: np.ndarray | None = None
    for field in ordered:
        shape = field.forecast.shape
        out.append(BaselineSet(valid_time=field.valid_time, grids={
            "climatology": climatology.grid(shape),
            "always_zero": always_zero(shape),
            "persistence": persistence(previous, shape),
        }))
        previous = np.where(field.usable, field.observed, np.nan)
    return out


def ladder_note() -> str:
    return (
        "climatology is the floor; persistence is the forecaster's rule of "
        "thumb; always_zero is included because on a domain quiet 99.9% of "
        "the time it achieves an excellent Brier score while being useless, "
        "and any system that cannot see that is fooling itself"
    )
