"""Field provenance.

Every gridded field that enters TCM carries a `FieldMeta`. There is no code
path that produces a field without one -- provenance is a constructor
argument, not an afterthought.

The rule this module exists to enforce:

    Never describe a 9 km model as a 2 km forecast.
    Never interpolate a coarse model to 2 km and then label it native.

`native_resolution_m` is set once, by the provider adapter, from the model
registry. Regridding NEVER changes it. Regridding appends a `RegridStep` to
`lineage` and flips `regridded` to True; the analysis grid spacing is recorded
separately in `grid.spacing_m`. A consumer that wants to know "how good is
this really" reads `native_resolution_m`; a consumer that wants to know "what
cells am I looking at" reads `grid`.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal


class MemberKind(str, Enum):
    DETERMINISTIC = "deterministic"
    CONTROL = "control"
    PERTURBED = "perturbed"
    ENSEMBLE_STAT = "ensemble_stat"   # a percentile/mean derived from members


@dataclass(frozen=True, slots=True)
class GridSpec:
    """The grid a field's values are actually laid out on."""

    name: str                       # "ukv_laea_2km", "tcm_2km", "icon_eu_7km"
    projection: str                 # PROJ string or EPSG code
    nx: int
    ny: int
    #: Cell size in METRES, always. For a lat/lon grid this is the approximate
    #: ground spacing (the coarser of the two axes), used for reporting and
    #: for resolution comparisons; `spacing_deg` carries the exact step used
    #: for indexing. Keeping this in metres means `effective_resolution_m` can
    #: never compare a degree value against a metre value.
    spacing_m: float
    # Lower-left corner in projection units (metres, or degrees for a lat/lon
    # grid) so a consumer can georeference without re-reading the source.
    x0: float
    y0: float
    crs_units: Literal["m", "degrees"] = "m"
    #: Exact grid step in degrees. Set only when `crs_units` is "degrees".
    spacing_deg: float | None = None

    @property
    def shape(self) -> tuple[int, int]:
        return (self.ny, self.nx)

    @property
    def n_points(self) -> int:
        return self.nx * self.ny


@dataclass(frozen=True, slots=True)
class RegridStep:
    """One irreversible resampling, recorded so it can never be forgotten."""

    from_grid: str
    to_grid: str
    method: str                     # "bilinear", "conservative", "nearest"
    from_spacing_m: float
    to_spacing_m: float
    at: datetime

    @property
    def upsampled(self) -> bool:
        """True when we moved to a FINER grid than the source supports.

        This is the dangerous direction: it makes a coarse model look sharp.
        """
        return self.to_spacing_m < self.from_spacing_m


@dataclass(frozen=True, slots=True)
class FieldMeta:
    # --- identity ---------------------------------------------------------
    provider: str                   # "metoffice_datahub", "open_meteo", "ecmwf"
    model: str                      # "ukv", "mogreps_uk", "arome", "ifs_hres"
    parameter: str                  # canonical TCM name, see params.py
    units: str
    level_type: str                 # "surface", "isobaric", "agl", "meansea"
    level: float | None             # 1.5, 850.0, None for surface/column

    # --- time -------------------------------------------------------------
    run: datetime                   # model cycle / reference time (UTC)
    forecast_hour: int              # T+ hours
    valid_time: datetime            # run + forecast_hour (UTC)

    # --- ensemble ---------------------------------------------------------
    member_kind: MemberKind = MemberKind.DETERMINISTIC
    member: int | None = None       # perturbed member number, else None

    # --- resolution truth -------------------------------------------------
    # The resolution the DATA genuinely has. Never mutated by regridding.
    native_resolution_m: float = 0.0
    native_grid: str = ""
    native_projection: str = ""

    # --- where the values currently live ----------------------------------
    grid: GridSpec | None = None
    regridded: bool = False
    lineage: tuple[RegridStep, ...] = ()

    # --- provenance -------------------------------------------------------
    source_uri: str = ""            # the exact endpoint/file this came from
    retrieved_at: datetime | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ #

    def __post_init__(self) -> None:
        for name in ("run", "valid_time"):
            value = getattr(self, name)
            if value is not None and value.tzinfo is None:
                raise ValueError(f"FieldMeta.{name} must be timezone-aware (UTC)")
        if self.native_resolution_m <= 0:
            raise ValueError(
                f"{self.model}/{self.parameter}: native_resolution_m must be set "
                "by the provider adapter from the model registry"
            )
        if self.member_kind is MemberKind.PERTURBED and self.member is None:
            raise ValueError("perturbed member requires a member number")

    # --- the honesty accessors -------------------------------------------

    @property
    def effective_resolution_m(self) -> float:
        """What this field can actually resolve.

        Regridding to a finer mesh does not add information, so the effective
        resolution is the COARSER of native and current grid spacing.
        """
        if self.grid is None:
            return self.native_resolution_m
        return max(self.native_resolution_m, self.grid.spacing_m)

    @property
    def is_upsampled(self) -> bool:
        """True if values sit on a finer grid than the model can support."""
        return any(step.upsampled for step in self.lineage)

    @property
    def resolution_label(self) -> str:
        """Human-facing label. Always tells the truth about regridding."""
        km = self.native_resolution_m / 1000.0
        base = f"{km:g} km"
        if not self.regridded:
            return f"{base} native"
        if self.grid is not None:
            gkm = self.grid.spacing_m / 1000.0
            return f"{base} native, REGRIDDED to {gkm:g} km"
        return f"{base} native, REGRIDDED"

    def regrid_to(self, target: GridSpec, method: str) -> "FieldMeta":
        """Return metadata for the same data resampled onto `target`.

        Note what does NOT change: native_resolution_m, native_grid,
        native_projection. That is the entire point.
        """
        source_spacing = self.grid.spacing_m if self.grid else self.native_resolution_m
        source_name = self.grid.name if self.grid else self.native_grid
        step = RegridStep(
            from_grid=source_name,
            to_grid=target.name,
            method=method,
            from_spacing_m=source_spacing,
            to_spacing_m=target.spacing_m,
            at=datetime.now(timezone.utc),
        )
        return replace(
            self,
            grid=target,
            regridded=True,
            lineage=self.lineage + (step,),
        )

    # --- serialisation ----------------------------------------------------

    def key(self) -> str:
        """Stable cache/storage key for this exact field."""
        parts = [
            self.provider, self.model, self.parameter, self.level_type,
            str(self.level), self.run.isoformat(), str(self.forecast_hour),
            self.member_kind.value, str(self.member),
        ]
        raw = "|".join(parts)
        return hashlib.sha1(raw.encode()).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["member_kind"] = self.member_kind.value
        for k in ("run", "valid_time", "retrieved_at"):
            if d.get(k) is not None:
                d[k] = getattr(self, k).isoformat()
        d["lineage"] = [
            {**asdict(s), "at": s.at.isoformat(), "upsampled": s.upsampled}
            for s in self.lineage
        ]
        d["effective_resolution_m"] = self.effective_resolution_m
        d["resolution_label"] = self.resolution_label
        d["is_upsampled"] = self.is_upsampled
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, default=str)
