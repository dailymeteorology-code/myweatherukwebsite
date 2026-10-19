"""TCM high-resolution precipitation, and the rolling 24-hour rainfall.

The product the spec is most specific about: rainfall accumulated over
arbitrary windows, and a rolling 24-hour total computed at EVERY forecast
hour, so that `rainfall(T-24h -> T)` can be animated through the forecast.

Two things here are easy to get wrong and are handled explicitly.

**Accumulations are summed, never averaged.** `precip_accum_1h` is the total
over the PRECEDING hour. A 24-hour total is the sum of 24 consecutive hourly
fields, and averaging them -- the instinctive thing to do with a stack of
fields, and what the ensemble code correctly does for instantaneous
quantities -- would under-report rainfall by a factor of 24.

**A window with a missing hour is not a 24-hour total.** If any hour in the
window is absent from the store, the sum is not the quantity it claims to be.
`accumulate()` reports `hours_present` against `hours_required` and sets
`complete`; a partial window is returned with what it has, clearly labelled,
rather than either silently under-reporting or refusing to answer. Quietly
summing 19 of 24 hours and calling it a 24-hour rainfall total would be a
serious misrepresentation on a flood product.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from ..grid import Field
from ..meta import FieldMeta, MemberKind

log = logging.getLogger(__name__)

#: The accumulation windows TCM publishes, in hours.
STANDARD_WINDOWS = (1, 3, 6, 12, 24)

ROLLING_WINDOW_H = 24


@dataclass(slots=True)
class Accumulation:
    """Rainfall summed over a window ending at `forecast_hour`."""

    values: np.ndarray
    meta: FieldMeta
    window_hours: int
    forecast_hour: int
    valid_time: datetime
    #: Lead times actually summed.
    hours_used: tuple[int, ...]
    hours_required: int

    @property
    def hours_present(self) -> int:
        return len(self.hours_used)

    @property
    def complete(self) -> bool:
        return self.hours_present == self.hours_required

    @property
    def missing_hours(self) -> list[int]:
        expected = set(
            range(self.forecast_hour - self.window_hours + 1,
                  self.forecast_hour + 1)
        )
        return sorted(h for h in expected if h not in self.hours_used)

    def as_field(self) -> Field:
        return Field(self.values, self.meta)

    def to_dict(self) -> dict:
        finite = self.values[np.isfinite(self.values)]
        return {
            "window_hours": self.window_hours,
            "forecast_hour": self.forecast_hour,
            "valid_time": self.valid_time.isoformat(),
            "window_start": (
                self.valid_time - timedelta(hours=self.window_hours)
            ).isoformat(),
            "units": "mm",
            "max_mm": float(finite.max()) if finite.size else None,
            "mean_mm": float(finite.mean()) if finite.size else None,
            "area_fraction_over_10mm": (
                float((finite > 10).mean()) if finite.size else None
            ),
            "area_fraction_over_25mm": (
                float((finite > 25).mean()) if finite.size else None
            ),
            "hours_present": self.hours_present,
            "hours_required": self.hours_required,
            "complete": self.complete,
            "missing_hours": self.missing_hours,
            "resolution_label": self.meta.resolution_label,
            "warning": (
                None if self.complete else
                f"INCOMPLETE: {self.hours_present} of "
                f"{self.hours_required} hours present. This is a "
                f"{self.hours_present}-hour total, not a "
                f"{self.window_hours}-hour total, and under-reports rainfall."
            ),
        }


def _accumulation_meta(
    fields: list[Field], window_hours: int, forecast_hour: int
) -> FieldMeta:
    """Provenance for a summed accumulation.

    The resolution is the coarsest contributing hour: a 24-hour total that
    borrowed one hour from a coarse model is not a 2 km product.
    """
    from dataclasses import replace

    coarsest = max(f.meta.effective_resolution_m for f in fields)
    models = sorted({f.meta.model for f in fields})
    reference = fields[-1]

    return replace(
        reference.meta,
        parameter=f"precip_accum_{window_hours}h",
        units="kg/m2",
        member_kind=(
            reference.meta.member_kind
            if reference.meta.member is not None
            else MemberKind.DETERMINISTIC
        ),
        native_resolution_m=coarsest,
        forecast_hour=forecast_hour,
        extra={
            **reference.meta.extra,
            "accumulation_window_h": window_hours,
            "summed_from": [f.meta.forecast_hour for f in fields],
            "contributing_models": models,
            "coarsest_input_m": coarsest,
        },
    )


def accumulate(
    hourly: dict[int, Field], forecast_hour: int, window_hours: int,
) -> Accumulation:
    """Sum hourly rainfall over the window ending at `forecast_hour`.

    `hourly` maps lead time to a `precip_accum_1h` field. The window covers
    the hours (forecast_hour - window + 1) .. forecast_hour inclusive, because
    each field is the total for the hour ENDING at its lead time.
    """
    if window_hours < 1:
        raise ValueError("window_hours must be at least 1")

    wanted = range(forecast_hour - window_hours + 1, forecast_hour + 1)
    present = [h for h in wanted if h in hourly and hourly[h] is not None]
    if not present:
        raise LookupError(
            f"no hourly rainfall stored in T+{wanted.start}..T+{forecast_hour}"
        )

    fields = [hourly[h] for h in present]
    shapes = {f.values.shape for f in fields}
    if len(shapes) != 1:
        raise ValueError(f"hourly fields have different shapes: {shapes}")

    # Summed, not averaged. NaN is treated as "no data", not as zero rain,
    # so a cell absent from every hour stays NaN rather than reading 0 mm.
    stack = np.stack([f.values for f in fields])
    with np.errstate(invalid="ignore"):
        total = np.nansum(stack, axis=0).astype("float32")
    any_finite = np.any(np.isfinite(stack), axis=0)
    total = np.where(any_finite, total, np.nan)

    meta = _accumulation_meta(fields, window_hours, forecast_hour)
    accumulation = Accumulation(
        values=total,
        meta=meta,
        window_hours=window_hours,
        forecast_hour=forecast_hour,
        valid_time=meta.valid_time,
        hours_used=tuple(present),
        hours_required=window_hours,
    )
    if not accumulation.complete:
        log.warning(
            "%dh accumulation at T+%d has only %d of %d hours",
            window_hours, forecast_hour,
            accumulation.hours_present, window_hours,
        )
    return accumulation


def rolling_24h(
    hourly: dict[int, Field], forecast_hour: int
) -> Accumulation:
    """Rainfall over the 24 hours ending at `forecast_hour`."""
    return accumulate(hourly, forecast_hour, ROLLING_WINDOW_H)


def rolling_series(
    hourly: dict[int, Field],
    window_hours: int = ROLLING_WINDOW_H,
    step_hours: int = 1,
) -> list[Accumulation]:
    """The rolling accumulation at every forecast hour that supports it.

    This is what the animated rolling-rainfall map plays through. Only lead
    times with a COMPLETE window are returned, because an animation that
    silently mixes complete and partial totals would show rainfall appearing
    to fall and then vanish as hours drop out of the store.
    """
    if not hourly:
        return []
    out: list[Accumulation] = []
    for forecast_hour in sorted(hourly):
        if forecast_hour < window_hours - 1:
            continue
        if forecast_hour % step_hours:
            continue
        try:
            accumulation = accumulate(hourly, forecast_hour, window_hours)
        except LookupError:
            continue
        if accumulation.complete:
            out.append(accumulation)
    return out
