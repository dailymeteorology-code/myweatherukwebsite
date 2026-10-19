"""What profile each model can actually support, before one is built.

Stage 3. This is the variable-availability matrix the specification asks
for, and the important thing about it is that it is DERIVED, not written
down. A table of ticks maintained by hand goes stale the moment an order
changes -- which has already happened once on this platform, when the UK
order gained nine pressure levels and the registry's parameter tuple did
not.

So availability is computed by asking the Stage 2 capability layer which
canonical names exist, and reporting exactly that. A model that cannot
support a profile says so with a reason rather than producing an empty one.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field

from ..catalogue.capabilities import ModelCapability
from .build import HEIGHT_VARIABLES, PRESSURE_VARIABLES
from .levels import (
    STANDARD_HEIGHT_LEVELS, STANDARD_PRESSURE_LEVELS, VerticalCoordinate,
    label,
)

#: A profile needs at least this many levels of a variable to be worth
#: building: two points define a gradient, and below that there is no
#: vertical structure to interpolate through or reason about.
MINIMUM_LEVELS = 2


@dataclass(slots=True)
class VariableAvailability:
    """Which levels of one variable a model publishes."""

    stem: str
    coordinate: VerticalCoordinate
    native_levels: tuple[float, ...]
    requested_levels: tuple[float, ...]

    @property
    def supported(self) -> bool:
        return len(self.native_levels) >= MINIMUM_LEVELS

    @property
    def reconstructable_levels(self) -> tuple[float, ...]:
        """Requested levels obtainable natively or by interpolation.

        Anything outside the native range is excluded: this engine does not
        extrapolate, so a level beyond the model's top is not obtainable at
        all, however close it looks.
        """
        if not self.native_levels:
            return ()
        lo, hi = min(self.native_levels), max(self.native_levels)
        return tuple(
            lv for lv in self.requested_levels if lo <= lv <= hi
        )

    @property
    def coverage(self) -> float:
        if not self.requested_levels:
            return 0.0
        return len(self.reconstructable_levels) / len(self.requested_levels)

    def to_dict(self) -> dict:
        return {
            "variable": self.stem,
            "coordinate": self.coordinate.value,
            "supported": self.supported,
            "native_levels": list(self.native_levels),
            "reconstructable_levels": list(self.reconstructable_levels),
            "coverage": round(self.coverage, 4),
        }


@dataclass(slots=True)
class ProfileAvailability:
    """Whether a model can support a profile at all, and how good it is."""

    model_id: str
    pressure: dict[str, VariableAvailability] = dc_field(default_factory=dict)
    height: dict[str, VariableAvailability] = dc_field(default_factory=dict)
    reason: str = ""

    @property
    def has_pressure_profile(self) -> bool:
        return any(v.supported for v in self.pressure.values())

    @property
    def has_height_profile(self) -> bool:
        return any(v.supported for v in self.height.values())

    @property
    def supported(self) -> bool:
        return self.has_pressure_profile or self.has_height_profile

    def to_dict(self) -> dict:
        return {
            "model": self.model_id,
            "supported": self.supported,
            "reason": self.reason or None,
            "has_pressure_profile": self.has_pressure_profile,
            "has_height_profile": self.has_height_profile,
            "pressure": {k: v.to_dict() for k, v in self.pressure.items()},
            "height": {k: v.to_dict() for k, v in self.height.items()},
        }


def _levels_present(
    cap: ModelCapability, stem: str, coordinate: VerticalCoordinate,
    candidates: tuple[float, ...],
) -> tuple[float, ...]:
    return tuple(
        lv for lv in candidates
        if cap.has(f"{stem}_{label(lv, coordinate)}")
    )


def profile_availability(cap: ModelCapability | None) -> ProfileAvailability:
    """The variable-availability matrix for one model, from its capability."""
    if cap is None:
        return ProfileAvailability("unknown", reason="no capability record")
    if cap.error:
        return ProfileAvailability(
            cap.model_id, reason=f"capability lookup failed: {cap.error}"
        )

    out = ProfileAvailability(cap.model_id)
    for stem, _units in PRESSURE_VARIABLES:
        out.pressure[stem] = VariableAvailability(
            stem, VerticalCoordinate.ISOBARIC,
            _levels_present(cap, stem, VerticalCoordinate.ISOBARIC,
                            STANDARD_PRESSURE_LEVELS),
            STANDARD_PRESSURE_LEVELS,
        )
    for stem, _units in HEIGHT_VARIABLES:
        out.height[stem] = VariableAvailability(
            stem, VerticalCoordinate.HEIGHT_AGL,
            _levels_present(cap, stem, VerticalCoordinate.HEIGHT_AGL,
                            STANDARD_HEIGHT_LEVELS),
            STANDARD_HEIGHT_LEVELS,
        )
    if not out.supported:
        out.reason = (
            f"{cap.model_id} publishes fewer than {MINIMUM_LEVELS} levels of "
            "any profile variable, so no vertical structure can be built "
            "from it"
        )
    return out


def matrix(caps: dict[str, ModelCapability]) -> dict:
    """The whole availability matrix, model by model.

    Reported as data rather than prose so it can be diffed between runs: a
    model quietly losing a level is exactly the kind of change that should
    be visible without anybody noticing it by eye.
    """
    rows = {model: profile_availability(cap).to_dict()
            for model, cap in caps.items()}
    return {
        "models": rows,
        "pressure_levels_hpa": list(STANDARD_PRESSURE_LEVELS),
        "height_levels_m": list(STANDARD_HEIGHT_LEVELS),
        "note": (
            "Derived from each provider's live catalogue, not declared. "
            "'reconstructable' excludes levels outside a model's native "
            "range: this engine interpolates but never extrapolates."
        ),
    }
