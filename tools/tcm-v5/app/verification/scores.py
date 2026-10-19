"""Verification scores.

Standard, unglamorous metrics, kept in one place so the verification
dashboard, the training pipeline and any future report all compute them
identically. Two properties are enforced rather than assumed:

  * **A score is never returned without its sample size.** A CSI of 1.0 from
    four events is not evidence of anything, and a dashboard that shows the
    number without the count invites exactly that reading.

  * **Undefined is not zero.** POD is undefined when nothing was observed;
    FAR is undefined when nothing was forecast. Returning 0.0 in those cases
    reads as "perfectly bad" when the truth is "no information", so they
    return None.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Below this many paired samples, a score is reported but flagged unreliable.
MIN_SAMPLES = 30


@dataclass(frozen=True, slots=True)
class ContingencyTable:
    """The 2x2 table for a yes/no event."""

    hits: int
    misses: int
    false_alarms: int
    correct_negatives: int

    @property
    def total(self) -> int:
        return (
            self.hits + self.misses + self.false_alarms
            + self.correct_negatives
        )

    @property
    def observed(self) -> int:
        return self.hits + self.misses

    @property
    def forecast(self) -> int:
        return self.hits + self.false_alarms

    @property
    def pod(self) -> float | None:
        """Probability of detection. Undefined when nothing was observed."""
        return self.hits / self.observed if self.observed else None

    @property
    def far(self) -> float | None:
        """False alarm ratio. Undefined when nothing was forecast."""
        return (
            self.false_alarms / self.forecast if self.forecast else None
        )

    @property
    def csi(self) -> float | None:
        """Critical success index, the standard convective skill measure."""
        denominator = self.hits + self.misses + self.false_alarms
        return self.hits / denominator if denominator else None

    @property
    def bias(self) -> float | None:
        """Frequency bias: >1 over-forecast, <1 under-forecast."""
        return self.forecast / self.observed if self.observed else None

    @property
    def reliable(self) -> bool:
        return self.observed >= MIN_SAMPLES

    def to_dict(self) -> dict:
        return {
            "hits": self.hits,
            "misses": self.misses,
            "false_alarms": self.false_alarms,
            "correct_negatives": self.correct_negatives,
            "observed_events": self.observed,
            "forecast_events": self.forecast,
            "pod": _round(self.pod),
            "far": _round(self.far),
            "csi": _round(self.csi),
            "bias": _round(self.bias),
            "reliable": self.reliable,
            "min_samples": MIN_SAMPLES,
            "caveat": (
                None if self.reliable else
                f"only {self.observed} observed events; "
                f"{MIN_SAMPLES} needed before these scores mean much"
            ),
        }


def _round(value: float | None, places: int = 4) -> float | None:
    return None if value is None else round(float(value), places)


def contingency(
    forecast: np.ndarray, observed: np.ndarray, threshold: float
) -> ContingencyTable:
    """Build the 2x2 table for "value >= threshold"."""
    valid = np.isfinite(forecast) & np.isfinite(observed)
    f = forecast[valid] >= threshold
    o = observed[valid] >= threshold
    return ContingencyTable(
        hits=int(np.sum(f & o)),
        misses=int(np.sum(~f & o)),
        false_alarms=int(np.sum(f & ~o)),
        correct_negatives=int(np.sum(~f & ~o)),
    )


def brier_score(probability: np.ndarray, occurred: np.ndarray) -> dict:
    """Mean squared error of a probability forecast. Lower is better.

    Also returns the climatological reference and the skill score against it,
    because a raw Brier score is uninterpretable on its own: 0.05 is superb
    for a common event and worthless for a rare one.
    """
    valid = np.isfinite(probability) & np.isfinite(occurred)
    p = probability[valid].astype("float64")
    o = occurred[valid].astype("float64")
    if p.size == 0:
        return {"brier": None, "samples": 0, "reliable": False}

    brier = float(np.mean((p - o) ** 2))
    climatology = float(np.mean(o))
    reference = float(np.mean((climatology - o) ** 2))
    skill = None if reference == 0 else 1.0 - brier / reference
    return {
        "brier": round(brier, 5),
        "climatology": round(climatology, 5),
        "reference_brier": round(reference, 5),
        "brier_skill_score": _round(skill),
        "samples": int(p.size),
        "reliable": bool(p.size >= MIN_SAMPLES),
        "note": (
            "Brier skill is measured against climatology; a raw Brier score "
            "alone cannot be judged without knowing how common the event is."
        ),
    }


def field_error(forecast: np.ndarray, reference: np.ndarray) -> dict:
    """Error statistics between two fields on the same grid."""
    valid = np.isfinite(forecast) & np.isfinite(reference)
    if not valid.any():
        return {"samples": 0, "mae": None, "rmse": None, "bias": None}
    difference = forecast[valid].astype("float64") - reference[valid]
    return {
        "samples": int(valid.sum()),
        "mae": round(float(np.mean(np.abs(difference))), 5),
        "rmse": round(float(np.sqrt(np.mean(difference ** 2))), 5),
        "bias": round(float(np.mean(difference)), 5),
        "max_abs": round(float(np.max(np.abs(difference))), 5),
    }
