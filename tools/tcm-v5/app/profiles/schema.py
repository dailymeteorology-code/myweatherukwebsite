"""The standard profile representation.

Stage 3. A profile is the vertical atmospheric state for exactly one
(model, run, member, valid time, location). Nothing here interprets that
state -- no stability, no shear, no scores. It stores structure and the
provenance of every number in it.

ONE ARRAY SHAPE, TWO USES
-------------------------
Values are stored with LEVEL as the leading axis:

    point profile   (n_levels,)
    gridded cube    (n_levels, ny, nx)

The same interpolation and validation code then serves both, which matters
because the eventual system profiles millions of cells and a per-cell Python
loop would be hopeless. A point profile is just a cube with the trailing axes
dropped.

PROVENANCE IS PER LEVEL, NOT PER PROFILE
----------------------------------------
A profile assembled entirely from native model levels is not the same object
as one reconstructed by interpolation, and a downstream engine must be able
to tell which values it is trusting. So origin is recorded for EVERY level of
EVERY variable, not summarised at the profile level. `is_native` on a whole
profile would be a lie the moment one level was filled in.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np

from .levels import VerticalCoordinate

#: Bumped when the SHAPE of a profile changes.
PROFILE_SCHEMA_VERSION = "1.0"
#: Bumped when the MATHS changes -- an interpolation method, a bound, an
#: ordering rule. Two profiles with the same schema version but different
#: processing versions are not comparable, and a cache must not serve one for
#: the other.
PROFILE_PROCESSING_VERSION = "1.0"


class FieldOrigin(str, Enum):
    """Where one value at one level actually came from."""

    NATIVE = "native"                       # the model published it here
    UNIT_CONVERTED = "unit_converted"       # native, in different units
    VERTICAL_INTERPOLATION = "vertical_interpolation"
    HORIZONTAL_INTERPOLATION = "horizontal_interpolation"
    DERIVED = "derived"                     # computed from other fields
    UNAVAILABLE = "unavailable"             # not obtainable; value is NaN
    BELOW_GROUND = "below_ground"           # level is inside terrain
    OUT_OF_RANGE = "out_of_range"           # outside the native levels

    @property
    def has_value(self) -> bool:
        return self not in (
            FieldOrigin.UNAVAILABLE,
            FieldOrigin.BELOW_GROUND,
            FieldOrigin.OUT_OF_RANGE,
        )


class ProfileStatus(str, Enum):
    COMPLETE = "complete"      # every requested level and variable present
    PARTIAL = "partial"        # some levels missing, structure sound
    DEGRADED = "degraded"      # heavily interpolated or sparse
    INVALID = "invalid"        # failed structural validation; do not use


@dataclass(frozen=True, slots=True)
class LevelProvenance:
    """How one level of one variable was obtained."""

    level: float
    origin: FieldOrigin
    #: Native levels the value was built from. Empty when NATIVE.
    source_levels: tuple[float, ...] = ()
    method: str = ""
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "level": self.level,
            "origin": self.origin.value,
            "source_levels": list(self.source_levels),
            "method": self.method or None,
            "note": self.note or None,
        }


@dataclass(slots=True)
class VariableProfile:
    """One variable through the vertical, with per-level provenance."""

    name: str
    units: str
    coordinate: VerticalCoordinate
    levels: tuple[float, ...]
    #: Leading axis is level. NaN wherever origin has no value.
    values: np.ndarray
    provenance: tuple[LevelProvenance, ...]
    native_name: str = ""
    native_units: str = ""

    def __post_init__(self) -> None:
        if len(self.levels) != len(self.provenance):
            raise ValueError(
                f"{self.name}: {len(self.levels)} levels but "
                f"{len(self.provenance)} provenance entries"
            )
        if self.values.shape[0] != len(self.levels):
            raise ValueError(
                f"{self.name}: values lead axis is {self.values.shape[0]}, "
                f"expected {len(self.levels)} levels"
            )

    def at(self, level: float) -> tuple[np.ndarray | None, LevelProvenance | None]:
        """Values and provenance for one level, or (None, None)."""
        for i, lv in enumerate(self.levels):
            if lv == level:
                return self.values[i], self.provenance[i]
        return None, None

    @property
    def native_levels(self) -> tuple[float, ...]:
        return tuple(
            p.level for p in self.provenance if p.origin is FieldOrigin.NATIVE
        )

    @property
    def available_levels(self) -> tuple[float, ...]:
        return tuple(p.level for p in self.provenance if p.origin.has_value)

    @property
    def interpolated_fraction(self) -> float:
        """How much of this variable was reconstructed rather than read."""
        usable = [p for p in self.provenance if p.origin.has_value]
        if not usable:
            return 0.0
        interpolated = sum(
            1 for p in usable
            if p.origin is FieldOrigin.VERTICAL_INTERPOLATION
        )
        return interpolated / len(usable)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "units": self.units,
            "coordinate": self.coordinate.value,
            "levels": list(self.levels),
            "native_levels": list(self.native_levels),
            "available_levels": list(self.available_levels),
            "interpolated_fraction": round(self.interpolated_fraction, 4),
            "provenance": [p.to_dict() for p in self.provenance],
            "native_name": self.native_name or None,
        }


@dataclass(frozen=True, slots=True)
class ProfileMetadata:
    """Identity. Every field in a profile must share ALL of this."""

    provider: str
    model: str
    run: datetime
    valid_time: datetime
    forecast_hour: int
    member: int | None = None            # None = deterministic
    model_version: str = ""
    # Horizontal position. Recorded whether the profile is a point or a cube;
    # for a cube the lat/lon are None and the grid identifies the geometry.
    grid_id: str = ""
    latitude: float | None = None
    longitude: float | None = None
    ix: int | None = None
    iy: int | None = None
    horizontal_interpolation: str = ""   # "" when the cell was used as-is
    schema_version: str = PROFILE_SCHEMA_VERSION
    processing_version: str = PROFILE_PROCESSING_VERSION

    def __post_init__(self) -> None:
        for name in ("run", "valid_time"):
            value = getattr(self, name)
            if value is not None and value.tzinfo is None:
                raise ValueError(
                    f"ProfileMetadata.{name} must be timezone-aware (UTC)"
                )

    @property
    def is_ensemble_member(self) -> bool:
        return self.member is not None

    @property
    def identity(self) -> tuple:
        """What makes two profiles the same profile.

        Used as the cache key. The processing version is part of it so a
        profile built by older maths is never served as though it were built
        by the current maths.
        """
        return (
            self.model, self.run, self.forecast_hour, self.member,
            self.grid_id, self.ix, self.iy,
            self.schema_version, self.processing_version,
        )

    def to_dict(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "model_version": self.model_version or None,
            "run": self.run.isoformat(),
            "valid_time": self.valid_time.isoformat(),
            "forecast_hour": self.forecast_hour,
            "member": self.member,
            "grid_id": self.grid_id or None,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "ix": self.ix,
            "iy": self.iy,
            "horizontal_interpolation": self.horizontal_interpolation or None,
            "schema_version": self.schema_version,
            "processing_version": self.processing_version,
        }


@dataclass(slots=True)
class Profile:
    """The vertical atmospheric state at one place and time."""

    metadata: ProfileMetadata
    #: variable name -> VariableProfile, on pressure levels
    pressure: dict[str, VariableProfile] = dc_field(default_factory=dict)
    #: variable name -> VariableProfile, on height levels above ground
    height: dict[str, VariableProfile] = dc_field(default_factory=dict)
    #: Single-level context: surface pressure, terrain height, PBL top.
    surface: dict[str, np.ndarray] = dc_field(default_factory=dict)
    status: ProfileStatus = ProfileStatus.COMPLETE
    issues: list[str] = dc_field(default_factory=list)

    def add_issue(self, text: str, *, degrade: ProfileStatus | None = None) -> None:
        self.issues.append(text)
        if degrade is None:
            return
        order = {
            ProfileStatus.COMPLETE: 0, ProfileStatus.PARTIAL: 1,
            ProfileStatus.DEGRADED: 2, ProfileStatus.INVALID: 3,
        }
        if order[degrade] > order[self.status]:
            self.status = degrade

    @property
    def usable(self) -> bool:
        return self.status is not ProfileStatus.INVALID

    def variables(self, coordinate: VerticalCoordinate) -> dict[str, VariableProfile]:
        if coordinate is VerticalCoordinate.ISOBARIC:
            return self.pressure
        if coordinate is VerticalCoordinate.HEIGHT_AGL:
            return self.height
        return {}

    @property
    def interpolated_fraction(self) -> float:
        """Share of all available values that were reconstructed."""
        variables = list(self.pressure.values()) + list(self.height.values())
        counts = [len(v.available_levels) for v in variables]
        if not sum(counts):
            return 0.0
        weighted = sum(
            v.interpolated_fraction * n for v, n in zip(variables, counts)
        )
        return weighted / sum(counts)

    def quality(self) -> dict:
        """Data-quality summary. NOT a forecast quality or model ranking.

        It says how much of the profile was read versus reconstructed, and
        how much is missing -- nothing about the weather it describes.
        """
        variables = list(self.pressure.values()) + list(self.height.values())
        requested = sum(len(v.levels) for v in variables)
        available = sum(len(v.available_levels) for v in variables)
        native = sum(len(v.native_levels) for v in variables)
        return {
            "status": self.status.value,
            "usable": self.usable,
            "levels_requested": requested,
            "levels_available": available,
            "levels_native": native,
            "completeness": round(available / requested, 4) if requested else 0.0,
            "native_fraction": round(native / available, 4) if available else 0.0,
            "interpolated_fraction": round(self.interpolated_fraction, 4),
            "issues": list(self.issues),
        }

    def to_dict(self) -> dict:
        return {
            "metadata": self.metadata.to_dict(),
            "quality": self.quality(),
            "pressure": {k: v.to_dict() for k, v in self.pressure.items()},
            "height": {k: v.to_dict() for k, v in self.height.items()},
            "surface": sorted(self.surface),
        }
