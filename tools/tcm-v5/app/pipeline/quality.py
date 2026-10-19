"""Data quality control: judge the data, never quietly mend it.

Stage 2. The platform has had no QC layer at all -- an impossible value has
been able to travel from a GRIB message into a published risk index without
anything noticing. This module gives every field a measurable quality state
so a later stage can weight by it, and so a degraded forecast can say it is
degraded.

THE GOVERNING RULE
------------------
A check REPORTS. It does not repair. Silently clipping a temperature into a
plausible range would make the downstream code work and destroy the evidence
that something is wrong with the feed, the decode or the model. Where a
repair is genuinely safe it is applied explicitly, recorded in `repairs`, and
the field is marked as repaired -- never presented as pristine.

ON PHYSICAL BOUNDS
------------------
The bounds here are deliberately WIDE. They exist to catch decode errors,
unit mix-ups and fill values -- a temperature of 9999, a pressure in the
wrong unit, a CAPE of -1 -- not to enforce a meteorologist's expectation of
what is reasonable. A bound tight enough to reject a genuine extreme would
make the platform blind on exactly the days it exists for, so every limit
below is set outside anything the atmosphere has been observed to do.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone
from enum import Enum

import numpy as np

log = logging.getLogger(__name__)


class QualityState(str, Enum):
    """The overall verdict on one field."""

    OK = "ok"
    #: Usable, but something is off and a later stage may wish to downweight.
    SUSPECT = "suspect"
    #: Structurally usable but incomplete -- e.g. missing cells.
    PARTIAL = "partial"
    #: Repaired in a declared, recorded way. Usable, provenance preserved.
    REPAIRED = "repaired"
    #: Must not be used.
    INVALID = "invalid"


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class Issue:
    code: str
    severity: Severity
    detail: str

    def to_dict(self) -> dict:
        return {
            "code": self.code, "severity": self.severity.value,
            "detail": self.detail,
        }


@dataclass(slots=True)
class QualityReport:
    """What is wrong with a field, and how wrong."""

    parameter: str
    model: str
    state: QualityState = QualityState.OK
    issues: list[Issue] = dc_field(default_factory=list)
    repairs: list[str] = dc_field(default_factory=list)

    # --- measured properties, recorded whether or not they are problems ---
    n_total: int = 0
    n_finite: int = 0
    minimum: float | None = None
    maximum: float | None = None
    mean: float | None = None
    checked_at: datetime | None = None

    @property
    def finite_fraction(self) -> float:
        return self.n_finite / self.n_total if self.n_total else 0.0

    @property
    def usable(self) -> bool:
        return self.state is not QualityState.INVALID

    def add(self, code: str, severity: Severity, detail: str) -> None:
        self.issues.append(Issue(code, severity, detail))
        # Severity only ever escalates: a later INFO cannot clear an ERROR.
        if severity is Severity.ERROR:
            self.state = QualityState.INVALID
        elif severity is Severity.WARNING and self.state is QualityState.OK:
            self.state = QualityState.SUSPECT

    def to_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "model": self.model,
            "state": self.state.value,
            "usable": self.usable,
            "finite_fraction": round(self.finite_fraction, 6),
            "n_total": self.n_total,
            "n_finite": self.n_finite,
            "min": self.minimum,
            "max": self.maximum,
            "mean": self.mean,
            "issues": [i.to_dict() for i in self.issues],
            "repairs": list(self.repairs),
            "checked_at": (
                self.checked_at.isoformat() if self.checked_at else None
            ),
        }


# ---------------------------------------------------------------------------
# Physical bounds
# ---------------------------------------------------------------------------
#
# (minimum, maximum) in the field's CANONICAL units. Chosen to sit outside
# anything physically observed, so only a genuine fault trips them.
#
# The keys are matched by canonical stem, so `temperature_850`, and
# `temperature_agl_3000` all use the "temperature" entry.

BOUNDS: dict[str, tuple[float, float]] = {
    # Kelvin. 150 K and 350 K bracket the whole troposphere with room to spare.
    "temperature": (150.0, 350.0),
    "dewpoint": (150.0, 350.0),
    "wet_bulb_potential_temperature": (150.0, 350.0),
    # Pascals. 1000 Pa is far above the model top; 120000 Pa far below any
    # surface pressure.
    "pressure_surface": (1000.0, 120000.0),
    "pressure_msl": (80000.0, 120000.0),
    "convective_cloud_top_pressure": (1000.0, 120000.0),
    # Percent. Slight overshoot is tolerated as a rounding artefact and
    # reported, not silently clipped.
    "relative_humidity": (-1.0, 101.0),
    "total_cloud_cover": (-1.0, 101.0),
    "convective_cloud_cover": (-1.0, 101.0),
    # m/s. 200 m/s exceeds any observed jet.
    "wind_speed": (0.0, 200.0),
    "wind_gust": (0.0, 200.0),
    "u_wind": (-200.0, 200.0),
    "v_wind": (-200.0, 200.0),
    "vertical_velocity": (-100.0, 100.0),
    "wind_direction": (0.0, 360.0),
    # J/kg. CAPE cannot be negative; CIN cannot be positive.
    "cape_surface": (0.0, 20000.0),
    "cape_mixed_layer": (0.0, 20000.0),
    "cape_most_unstable": (0.0, 20000.0),
    "cin": (-2000.0, 0.0),
    "cin_mixed_layer": (-2000.0, 0.0),
    "cin_most_unstable": (-2000.0, 0.0),
    # Rates and accumulations are non-negative by definition.
    "precip_rate": (0.0, 1.0),
    "convective_rain_rate": (0.0, 1.0),
    "large_scale_rain_rate": (0.0, 1.0),
    "hail_fall_rate": (0.0, 1.0),
    "precip_accum": (0.0, 2000.0),
    "hail_accum": (0.0, 2000.0),
    "lightning_flash_density_1h": (0.0, 1000.0),
    # Heights in metres.
    "geopotential_height": (-500.0, 60000.0),
    "boundary_layer_height": (0.0, 10000.0),
    "freezing_level_height": (-500.0, 10000.0),
    "wet_bulb_zero_height": (-500.0, 10000.0),
    "terrain_height": (-500.0, 9000.0),
    "cloud_base": (0.0, 20000.0),
    "effective_inflow_base": (0.0, 20000.0),
    "effective_inflow_top": (0.0, 20000.0),
}

#: Values providers use to mean "no data". A field made mostly of these is a
#: decode failure, not a forecast.
FILL_VALUES = (-9999.0, 9999.0, -999.0, 9.999e20, -32767.0)

#: Below this fraction of finite cells a field is not usable as a field.
MIN_FINITE_FRACTION = 0.5
#: Between this and MIN_FINITE_FRACTION it is usable but flagged partial.
GOOD_FINITE_FRACTION = 0.99


def bounds_for(canonical: str) -> tuple[float, float] | None:
    """Bounds for a canonical name, matched by longest stem."""
    best: tuple[float, float] | None = None
    best_len = -1
    for stem, limits in BOUNDS.items():
        if (canonical == stem or canonical.startswith(stem + "_")) \
                and len(stem) > best_len:
            best, best_len = limits, len(stem)
    return best


def check_values(
    values: np.ndarray, canonical: str, model: str = "",
    *, now: datetime | None = None,
) -> QualityReport:
    """Numerical and physical checks on one field's array."""
    report = QualityReport(
        parameter=canonical, model=model,
        checked_at=now or datetime.now(timezone.utc),
    )

    if values is None or getattr(values, "size", 0) == 0:
        report.add("empty", Severity.ERROR, "field has no data")
        return report

    if not np.issubdtype(values.dtype, np.floating):
        report.add(
            "dtype", Severity.WARNING,
            f"expected a floating array, got {values.dtype}",
        )

    report.n_total = int(values.size)
    finite = np.isfinite(values)
    report.n_finite = int(finite.sum())

    n_nan = int(np.isnan(values).sum())
    n_inf = int(np.isinf(values).sum())
    if n_inf:
        report.add(
            "infinite", Severity.ERROR,
            f"{n_inf} infinite value(s); a field cannot contain an infinity",
        )
    if n_nan:
        # NaN is normal at domain edges and over regions a model does not
        # cover, so it is only an error when it dominates.
        severity = (
            Severity.ERROR if report.finite_fraction < MIN_FINITE_FRACTION
            else Severity.INFO
        )
        report.add(
            "nan", severity,
            f"{n_nan} NaN ({100 * n_nan / report.n_total:.2f}% of cells)",
        )

    if report.n_finite == 0:
        report.add("no_finite_values", Severity.ERROR, "every cell is NaN or infinite")
        return report

    good = values[finite]
    report.minimum = float(good.min())
    report.maximum = float(good.max())
    report.mean = float(good.mean())

    # Fill values masquerading as data.
    for fill in FILL_VALUES:
        n_fill = int(np.count_nonzero(good == fill))
        if n_fill and n_fill / report.n_finite > 0.01:
            report.add(
                "fill_value", Severity.ERROR,
                f"{n_fill} cells equal {fill}, a provider fill value; "
                "the field was probably not decoded correctly",
            )
            break

    limits = bounds_for(canonical)
    if limits is None:
        report.add(
            "no_bounds", Severity.INFO,
            f"no physical bounds registered for {canonical!r}; "
            "range was recorded but not checked",
        )
    else:
        low, high = limits
        n_low = int(np.count_nonzero(good < low))
        n_high = int(np.count_nonzero(good > high))
        if n_low or n_high:
            report.add(
                "out_of_bounds", Severity.ERROR,
                f"{n_low + n_high} cell(s) outside the physical range "
                f"[{low}, {high}] for {canonical!r}: "
                f"observed [{report.minimum:.4g}, {report.maximum:.4g}]. "
                "This usually means a unit mismatch or a decode error.",
            )

    # A constant field is legal but almost always a fault.
    if report.n_finite > 1 and math.isclose(
        report.minimum, report.maximum, rel_tol=0.0, abs_tol=1e-12
    ):
        report.add(
            "constant", Severity.WARNING,
            f"every finite cell is {report.minimum:.6g}; "
            "a uniform field is rarely a real forecast",
        )

    if report.state is QualityState.OK \
            and report.finite_fraction < GOOD_FINITE_FRACTION:
        report.state = QualityState.PARTIAL

    return report


def check_metadata(
    meta, *, expected_model: str = "", now: datetime | None = None,
    max_age: timedelta | None = None,
) -> QualityReport:
    """Checks on a FieldMeta: time consistency, identity, staleness."""
    now = now or datetime.now(timezone.utc)
    report = QualityReport(
        parameter=getattr(meta, "parameter", "?"),
        model=getattr(meta, "model", "?"),
        checked_at=now,
    )

    run = getattr(meta, "run", None)
    valid = getattr(meta, "valid_time", None)
    lead = getattr(meta, "forecast_hour", None)

    for name, value in (("run", run), ("valid_time", valid)):
        if value is None:
            report.add("missing_time", Severity.ERROR, f"{name} is not set")
        elif value.tzinfo is None:
            report.add(
                "naive_time", Severity.ERROR,
                f"{name} is timezone-naive; every internal time must be UTC-aware",
            )

    # run + lead must equal valid_time. Conflating the three is the classic
    # NWP bug, and it is silent: the field looks fine and is an hour wrong.
    if run and valid and lead is not None:
        expected = run + timedelta(hours=int(lead))
        if expected != valid:
            report.add(
                "time_inconsistent", Severity.ERROR,
                f"run {run.isoformat()} + T+{lead} = {expected.isoformat()}, "
                f"but valid_time is {valid.isoformat()}",
            )

    if lead is not None and lead < 0:
        report.add("negative_lead", Severity.ERROR, f"forecast_hour is {lead}")

    if expected_model and getattr(meta, "model", "") != expected_model:
        report.add(
            "model_mismatch", Severity.ERROR,
            f"expected model {expected_model!r}, field says "
            f"{getattr(meta, 'model', '')!r}. A field must never be filed "
            "under a model that did not produce it.",
        )

    if not getattr(meta, "units", ""):
        report.add("no_units", Severity.WARNING, "units are not recorded")

    if max_age is not None and run is not None:
        age = now - run
        if age > max_age:
            report.add(
                "stale", Severity.WARNING,
                f"run is {age.total_seconds() / 3600:.1f} h old, older than "
                f"the {max_age.total_seconds() / 3600:.0f} h limit",
            )

    return report


def check_grid(values: np.ndarray, grid, canonical: str = "") -> QualityReport:
    """Spatial integrity: does the array match the grid it claims?"""
    report = QualityReport(parameter=canonical, model="")
    if grid is None:
        report.add("no_grid", Severity.WARNING, "field carries no grid spec")
        return report

    nx = getattr(grid, "nx", None)
    ny = getattr(grid, "ny", None)
    if nx is None or ny is None:
        report.add("grid_incomplete", Severity.WARNING, "grid lacks nx/ny")
        return report

    if values.ndim != 2:
        report.add(
            "rank", Severity.ERROR,
            f"expected a 2-D field, got {values.ndim} dimensions {values.shape}",
        )
        return report

    if values.shape != (ny, nx):
        report.add(
            "shape_mismatch", Severity.ERROR,
            f"array is {values.shape} but the grid declares "
            f"(ny={ny}, nx={nx}). The field and its grid disagree about "
            "how many cells there are.",
        )
    return report


def combine(*reports: QualityReport) -> QualityReport:
    """Merge several reports, keeping the worst state and every issue."""
    order = {
        QualityState.OK: 0, QualityState.PARTIAL: 1, QualityState.REPAIRED: 1,
        QualityState.SUSPECT: 2, QualityState.INVALID: 3,
    }
    reports = tuple(r for r in reports if r is not None)
    if not reports:
        return QualityReport(parameter="", model="")
    base = max(reports, key=lambda r: order[r.state])
    merged = QualityReport(
        parameter=reports[0].parameter, model=reports[0].model,
        state=base.state, checked_at=reports[0].checked_at,
        n_total=max(r.n_total for r in reports),
        n_finite=max(r.n_finite for r in reports),
    )
    for r in reports:
        merged.issues.extend(r.issues)
        merged.repairs.extend(r.repairs)
        if r.minimum is not None and merged.minimum is None:
            merged.minimum, merged.maximum, merged.mean = r.minimum, r.maximum, r.mean
    return merged
