"""The unit of Stage 4 output: one diagnostic, with everything needed to
distrust it.

A bare number is not a usable scientific result. `SBCAPE = 0` could mean the
atmosphere is absolutely stable, or that the humidity profile was missing, or
that the parcel never reached its LCL below the top of the data. Those are
three completely different statements, and a later stage that cannot tell
them apart will eventually forecast on the second one.

So every value produced by this package is a `Diagnostic` carrying its
status, its inputs, the levels it used, the method that produced it and any
quality flags. A diagnostic that could not be calculated has
`value is None` -- never 0.0.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum
from typing import Any

import numpy as np


class Status(str, Enum):
    """Whether a diagnostic can be believed, and how far."""

    #: Calculated from inputs that met every requirement.
    AVAILABLE = "available"
    #: Calculated, but an input was degraded -- interpolated where native was
    #: wanted, or a profile thinner than the method assumes. Usable with care.
    DEGRADED = "degraded"
    #: Only part of the definition could be evaluated: e.g. shear computed to
    #: 5 km because the profile stops there, when 6 km was asked for.
    PARTIAL = "partial"
    #: Required inputs absent. NOT an error -- the commonest honest outcome.
    UNAVAILABLE = "unavailable"
    #: Inputs were present but the result is not physical, or the maths did
    #: not converge. Something is wrong and someone should look.
    INVALID = "invalid"

    @property
    def has_value(self) -> bool:
        return self in (Status.AVAILABLE, Status.DEGRADED, Status.PARTIAL)


#: Ranked so that combining can only ever degrade.
_SEVERITY = {
    Status.AVAILABLE: 0, Status.DEGRADED: 1, Status.PARTIAL: 2,
    Status.UNAVAILABLE: 3, Status.INVALID: 4,
}


def worst(*statuses: Status) -> Status:
    """The least trustworthy of several statuses.

    Used when one diagnostic is built from others: a BRN computed from a
    DEGRADED CAPE is itself at best DEGRADED. Quality never improves by being
    combined with something else.
    """
    present = [s for s in statuses if s is not None]
    if not present:
        return Status.UNAVAILABLE
    return max(present, key=lambda s: _SEVERITY[s])


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """One derived meteorological quantity."""

    name: str
    #: Scalar, or an array for a gridded or vertical result. None when the
    #: quantity could not be calculated -- this is the ONLY way to say that.
    value: float | np.ndarray | None
    unit: str
    status: Status
    #: Canonical profile variables this was built from.
    source_fields: tuple[str, ...] = ()
    #: Vertical levels used, in the coordinate named by `level_coordinate`.
    source_levels: tuple[float, ...] = ()
    level_coordinate: str = ""
    #: Short identifier for the algorithm, e.g. "pseudoadiabatic_virtual".
    #: Distinguishes a value from the same-named quantity computed another
    #: way -- the thing that silently breaks cross-model comparison.
    method: str = ""
    #: True when any input level was vertically interpolated rather than
    #: native. Stage 3 knows this per level; it is summarised here.
    interpolation_used: bool = False
    #: Free-form observations: "no LFC", "profile top below 6 km",
    #: "supersaturated layer". Never silently dropped.
    quality_flags: tuple[str, ...] = ()
    #: Why the status is not AVAILABLE. Required whenever it is not.
    reason: str = ""
    #: Anything structured a caller may want: parcel properties, layer lists.
    extra: dict[str, Any] = dc_field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.status.has_value and self.value is None:
            raise ValueError(
                f"{self.name}: status {self.status.value} promises a value "
                f"but value is None"
            )
        if not self.status.has_value and self.value is not None:
            raise ValueError(
                f"{self.name}: status {self.status.value} but a value was "
                f"supplied; an unavailable diagnostic must not carry a number"
            )
        if not self.status.has_value and not self.reason:
            raise ValueError(
                f"{self.name}: {self.status.value} without a reason. Every "
                f"refusal to produce a value must say why."
            )

    @property
    def is_finite(self) -> bool:
        """True when a value exists and is everywhere finite."""
        if self.value is None:
            return False
        try:
            return bool(
                np.all(np.isfinite(np.asarray(self.value, dtype="float64")))
            )
        except (TypeError, ValueError):
            return False

    def to_dict(self) -> dict:
        value = self.value
        if isinstance(value, np.ndarray):
            value = _jsonable(value)
        elif value is not None:
            value = float(value) if np.isfinite(value) else None
        out: dict[str, Any] = {
            "name": self.name,
            "value": value,
            "unit": self.unit,
            "status": self.status.value,
            "method": self.method,
        }
        if self.source_fields:
            out["source_fields"] = list(self.source_fields)
        if self.source_levels:
            out["source_levels"] = [float(v) for v in self.source_levels]
            out["level_coordinate"] = self.level_coordinate
        if self.interpolation_used:
            out["interpolation_used"] = True
        if self.quality_flags:
            out["quality_flags"] = list(self.quality_flags)
        if self.reason:
            out["reason"] = self.reason
        if self.extra:
            out["extra"] = _jsonable(self.extra)
        return out


def unavailable(
    name: str, unit: str, reason: str, *,
    source_fields: tuple[str, ...] = (), method: str = "",
    quality_flags: tuple[str, ...] = (),
) -> Diagnostic:
    """The standard way to say 'not calculable', with the reason attached.

    Deliberately the shortest path in the package, so that returning a
    justified nothing is always easier than inventing a number.
    """
    return Diagnostic(
        name=name, value=None, unit=unit, status=Status.UNAVAILABLE,
        reason=reason, source_fields=source_fields, method=method,
        quality_flags=quality_flags,
    )


def invalid(
    name: str, unit: str, reason: str, *, method: str = "",
    quality_flags: tuple[str, ...] = (),
) -> Diagnostic:
    """Inputs were present but the answer is not physical."""
    return Diagnostic(
        name=name, value=None, unit=unit, status=Status.INVALID,
        reason=reason, method=method, quality_flags=quality_flags,
    )


def _jsonable(obj):
    """Recursively make numpy / enum / datetime content JSON-serialisable.

    NaN becomes None rather than the bare token `NaN`, which is not valid
    JSON and which several clients silently parse as a number.
    """
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        return [_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return f if np.isfinite(f) else None
    return obj


@dataclass(slots=True)
class DiagnosticSet:
    """A named group of diagnostics -- thermodynamics, wind, and so on.

    `get` returns an UNAVAILABLE diagnostic rather than None for an absent
    key, so callers can treat "never computed" and "computed and
    unavailable" alike and cannot accidentally dereference a None.
    """

    category: str
    items: dict[str, Diagnostic] = dc_field(default_factory=dict)

    def add(self, diagnostic: Diagnostic) -> Diagnostic:
        self.items[diagnostic.name] = diagnostic
        return diagnostic

    def get(self, name: str) -> Diagnostic:
        found = self.items.get(name)
        if found is not None:
            return found
        return unavailable(
            name, "", f"{name} was not computed for this profile"
        )

    def value(self, name: str, default: float | None = None) -> float | None:
        """The scalar value, or `default` when there isn't one."""
        found = self.items.get(name)
        if found is None or found.value is None:
            return default
        try:
            return float(found.value)
        except (TypeError, ValueError):
            return default

    def __contains__(self, name: str) -> bool:
        return name in self.items

    def __iter__(self):
        return iter(self.items.values())

    def __len__(self) -> int:
        return len(self.items)

    @property
    def available(self) -> tuple[str, ...]:
        return tuple(n for n, d in self.items.items() if d.status.has_value)

    def to_dict(self) -> dict:
        return {n: d.to_dict() for n, d in self.items.items()}
