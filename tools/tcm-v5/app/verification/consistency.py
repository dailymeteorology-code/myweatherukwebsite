"""Run-to-run consistency.

Verification proper needs observations, and there are none. But one useful
question can be answered today: **when a new cycle arrives, how much did the
forecast for a given moment change?**

Two runs are paired on VALID TIME, not lead time. The 00Z run's T+24 and the
12Z run's T+12 both describe 30 Aug 00Z, and comparing them measures how
stable the forecast for that moment is as it approaches.

This is not a substitute for verification and is never presented as one. A
perfectly consistent forecast can be consistently wrong, and a jumpy one can
be converging on the truth. What it does measure is genuinely useful:

  * **Jumpiness** -- large run-to-run swings mean low confidence in the
    solution regardless of what any single run's spread says.
  * **Convergence** -- if successive runs agree more as the event nears, the
    forecast is settling; if they do not, it is not.

Once observations exist this module stays as it is, alongside real skill
scores rather than in place of them.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from .scores import contingency, field_error

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PairedForecast:
    """Two runs' forecasts for the same valid time."""

    parameter: str
    valid_time: datetime
    older_run: datetime
    newer_run: datetime
    older_hour: int
    newer_hour: int
    error: dict
    agreement: dict

    @property
    def lead_time_gained(self) -> int:
        """How much closer the newer run is to the valid time."""
        return self.older_hour - self.newer_hour

    def to_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "valid_time": self.valid_time.isoformat(),
            "older_run": self.older_run.isoformat(),
            "newer_run": self.newer_run.isoformat(),
            "older_forecast_hour": self.older_hour,
            "newer_forecast_hour": self.newer_hour,
            "lead_time_gained_hours": self.lead_time_gained,
            "difference": self.error,
            "agreement": self.agreement,
        }


@dataclass(slots=True)
class ConsistencyReport:
    parameter: str
    pairs: list[PairedForecast]
    threshold: float

    @property
    def mean_absolute_change(self) -> float | None:
        values = [
            p.error["mae"] for p in self.pairs if p.error.get("mae") is not None
        ]
        return float(np.mean(values)) if values else None

    @property
    def converging(self) -> bool | None:
        """True when the change shrinks as the valid time approaches.

        Compares the mean change over the shorter-lead half of the pairs
        against the longer-lead half. None when there are too few pairs to
        say anything.
        """
        usable = [
            p for p in self.pairs if p.error.get("mae") is not None
        ]
        if len(usable) < 4:
            return None
        ordered = sorted(usable, key=lambda p: p.newer_hour)
        half = len(ordered) // 2
        near = float(np.mean([p.error["mae"] for p in ordered[:half]]))
        far = float(np.mean([p.error["mae"] for p in ordered[half:]]))
        return near < far

    def to_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "pair_count": len(self.pairs),
            "mean_absolute_change": (
                None if self.mean_absolute_change is None
                else round(self.mean_absolute_change, 4)
            ),
            "converging": self.converging,
            "event_threshold": self.threshold,
            "pairs": [p.to_dict() for p in self.pairs],
            "is_verification": False,
            "note": (
                "Run-to-run consistency measures how much the forecast for a "
                "moment CHANGED between cycles. It is not verification: a "
                "consistent forecast can be consistently wrong. Real skill "
                "scores need observations, which are not available."
            ),
        }


def compare_runs(
    older: dict[int, np.ndarray],
    newer: dict[int, np.ndarray],
    older_run: datetime,
    newer_run: datetime,
    parameter: str,
    threshold: float = 20.0,
) -> ConsistencyReport:
    """Pair two runs on valid time and measure how much each changed.

    `older` and `newer` map forecast hour to a field on the TCM grid.
    """
    offset = int((newer_run - older_run).total_seconds() // 3600)
    if offset <= 0:
        raise ValueError(
            "the newer run must start after the older one; got "
            f"{older_run.isoformat()} and {newer_run.isoformat()}"
        )

    pairs: list[PairedForecast] = []
    for newer_hour, newer_values in sorted(newer.items()):
        # Same valid time: older_hour = newer_hour + the gap between cycles.
        older_hour = newer_hour + offset
        older_values = older.get(older_hour)
        if older_values is None:
            continue
        if older_values.shape != newer_values.shape:
            log.warning(
                "%s: shape mismatch pairing T+%d with T+%d",
                parameter, older_hour, newer_hour,
            )
            continue

        pairs.append(PairedForecast(
            parameter=parameter,
            valid_time=newer_run + timedelta(hours=newer_hour),
            older_run=older_run,
            newer_run=newer_run,
            older_hour=older_hour,
            newer_hour=newer_hour,
            error=field_error(newer_values, older_values),
            agreement=contingency(
                newer_values, older_values, threshold
            ).to_dict(),
        ))

    return ConsistencyReport(
        parameter=parameter, pairs=pairs, threshold=threshold
    )
