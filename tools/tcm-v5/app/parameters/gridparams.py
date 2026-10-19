"""Stage 4 on the whole grid.

`engine.compute` derives every parameter for ONE profile. On the 290,745-cell
UKV grid that is 53 hours, because 99.2% of its cost is scalar pseudoadiabat
integration repeated cell by cell.

This module computes the same quantities for every cell at once. It is NOT a
different or approximate calculation: the parcel work goes through
`gridded.lift_grid`, which `test_gridded.py` already holds to cell-by-cell
agreement with `parcel.lift`, and everything added here is held to the same
standard by `test_gridparams.py`. Where the two disagree, one of them is
wrong and the test says which.

WHAT IS AND IS NOT HERE
-----------------------
The set is driven by what Stage 5 actually reads -- `engines/features.py`
names about forty Stage 4 diagnostics, and those are the ones that change a
forecast. A quantity that is not yet gridded is ABSENT rather than zero, so
Stage 5's own rule -- a missing feature is None, never a neutral value --
keeps working and nothing is silently invented. `missing()` lists them.

STATUS IS PER CELL
------------------
A scalar `Diagnostic` carries one `Status`. Gridded, the status varies from
cell to cell: CAPE is AVAILABLE over the Midlands and UNAVAILABLE over a
Scottish summit where the column is two levels thick. So each field carries a
status ARRAY, and `at()` materialises the right per-cell status when it builds
a `DerivedParameters` for Stage 5.

THE HODOGRAPH COMES FROM THE NATIVE HEIGHT LEVELS
--------------------------------------------------
`column._attach_hodograph` prefers the model's own height-coordinate winds
and only falls back to the pressure levels. The UKV publishes winds at 10,
50, 100, 250, 500, 1000, 2000 ... 6000 m, and that low-level resolution is
the point: a 0-1 km shear built from nine PRESSURE levels rests on one or two
points. Building it that way here disagreed with the scalar engine by up to
9 m/s in shear and 96 m2/s2 in helicity, which is how this was found.

The consequence is that 0-8 km shear is UNAVAILABLE, because the winds stop
at 6 km. That matches the scalar engine exactly, and it is the honest answer:
the depth is not in the data.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from ..profiles.schema import Profile
from . import gridded, thermo as th
from .gridbuild import columns_from_cube
from .result import Diagnostic, Status

log = logging.getLogger(__name__)

GRID_PARAMETERS_VERSION = "1.0"

#: Vertical step for hodograph integrals, m.
#:
#: The scalar path samples every 100 m. 250 m is used here and it is close to
#: free: the gridded hodograph is LINEARLY interpolated from eleven stored
#: wind levels, and the Davies-Jones summation is exact for a piecewise
#: linear hodograph, so sampling finer than the stored levels adds nothing.
#: What it does change is memory -- 100 m to 8 km over the UKV grid is 377 MB
#: of wind arrays, against 58 MB here.
HODOGRAPH_STEP_M = 250.0

#: Depth the sampled hodograph covers. Deeper shear layers are interpolated
#: directly rather than by extending this, for the same memory reason.
HODOGRAPH_TOP_M = 6000.0

#: Bunkers et al. (2000) deviation from the 0-6 km mean wind, m/s.
BUNKERS_DEVIATION = 7.5


@dataclass(slots=True)
class Field:
    """One diagnostic over the whole grid."""

    name: str
    values: np.ndarray            # (ny, nx), NaN where unavailable
    unit: str
    group: str
    method: str = ""
    source_fields: tuple[str, ...] = ()
    status: Status = Status.AVAILABLE
    #: Gridded counterparts of `Diagnostic.extra`. Stage 5 reads several
    #: quantities out of `entrainment_indicators.extra` rather than from
    #: named diagnostics, so a gridded field that dropped this would leave
    #: the entrainment engine blind.
    extra: dict[str, np.ndarray] = dc_field(default_factory=dict)

    def status_at(self, iy: int, ix: int) -> Status:
        return (
            self.status if np.isfinite(self.values[iy, ix])
            else Status.UNAVAILABLE
        )

    def extra_at(self, iy: int, ix: int) -> dict:
        out = {}
        for key, array in self.extra.items():
            value = array[iy, ix]
            out[key] = float(value) if np.isfinite(value) else None
        return out


@dataclass(slots=True)
class GriddedParameters:
    """Every gridded Stage 4 field, plus what it takes to use them."""

    model: str
    run: datetime
    valid_time: datetime
    forecast_hour: int
    shape: tuple[int, int]
    fields: dict[str, Field] = dc_field(default_factory=dict)
    ascents: dict[str, gridded.GriddedAscent] = dc_field(default_factory=dict)
    issues: list[str] = dc_field(default_factory=list)
    version: str = GRID_PARAMETERS_VERSION

    def add(self, field: Field) -> Field:
        self.fields[field.name] = field
        return field

    def value(self, name: str) -> np.ndarray | None:
        found = self.fields.get(name)
        return None if found is None else found.values

    def at(self, iy: int, ix: int, *, latitude: float | None = None,
           longitude: float | None = None):
        """Materialise one cell as a `DerivedParameters` for Stage 5.

        Deliberately a plain rebuild rather than a view: Stage 5 reads
        `parameters.value(name)` and expects `Diagnostic` objects, and
        offering it something else would put a second interface into the
        platform for the same data.
        """
        from .engine import DerivedParameters

        out = DerivedParameters(
            provider="", model=self.model, run=self.run,
            valid_time=self.valid_time, forecast_hour=self.forecast_hour,
            latitude=latitude, longitude=longitude,
        )
        groups = {
            "thermodynamics": out.thermodynamics,
            "lapse_rates": out.lapse_rates,
            "wind": out.wind,
            "dynamics": out.dynamics,
            "boundary_layer": out.boundary_layer,
            "convective_environment": out.convective_environment,
        }
        for field in self.fields.values():
            target = groups.get(field.group)
            if target is None:
                continue
            raw = field.values[iy, ix]
            if not np.isfinite(raw):
                target.add(Diagnostic(
                    name=field.name, value=None, unit=field.unit,
                    status=Status.UNAVAILABLE,
                    reason="not available at this cell",
                    method=field.method, source_fields=field.source_fields,
                ))
                continue
            target.add(Diagnostic(
                name=field.name, value=float(raw), unit=field.unit,
                status=field.status, method=field.method,
                source_fields=field.source_fields,
                extra=field.extra_at(iy, ix) if field.extra else {},
            ))
        return out

    def missing(self) -> tuple[str, ...]:
        """Stage 4 names Stage 5 reads that this module does not yet grid."""
        return tuple(sorted(set(STAGE5_INPUTS) - set(self.fields)))


#: What `engines/features.py` reads off a `DerivedParameters`. Kept here so
#: `missing()` reports a real gap rather than a guess.
STAGE5_INPUTS = (
    "sbcape", "sbcin", "mlcape", "mlcin", "mucape", "mucin",
    "lcl", "lfc", "el", "freezing_level", "wet_bulb_zero",
    "warm_cloud_depth", "cold_cloud_depth", "precipitable_water",
    "lr_0_1km", "lr_0_3km", "lr_0_6km", "lr_700_500", "lr_850_500",
    "shear_0_1km", "shear_0_3km", "shear_0_6km", "shear_0_8km",
    "srh_0_1km", "srh_0_3km", "bulk_richardson_number",
    "pbl_depth", "boundary_layer_temperature", "boundary_layer_moisture",
    "entrainment_indicators", "dcape",
)


# ---------------------------------------------------------------------------
# Vectorised column helpers
# ---------------------------------------------------------------------------

def _interp_at_height(
    height: np.ndarray, values: np.ndarray, target: np.ndarray | float
) -> np.ndarray:
    """Linear interpolation of a (n_lev, ny, nx) field to a target height.

    NaN where the target lies outside the cell's own usable range, which is
    the honest answer: extrapolating a wind profile above its top invents
    shear that the data does not contain.
    """
    n, ny, nx = values.shape
    target = np.broadcast_to(
        np.asarray(target, dtype="float64"), (ny, nx)
    ).astype("float64")
    out = np.full((ny, nx), np.nan)
    for k in range(n - 1):
        lo, hi = height[k], height[k + 1]
        vlo, vhi = values[k], values[k + 1]
        span = hi - lo
        good_span = np.isfinite(span) & (span > 0)
        inside = (
            good_span & np.isfinite(vlo) & np.isfinite(vhi)
            & (target >= lo) & (target <= hi) & ~np.isfinite(out)
        )
        if np.any(inside):
            safe = np.where(good_span, span, 1.0)
            weight = (target - lo) / safe
            out = np.where(inside, vlo + weight * (vhi - vlo), out)
    return out


def _crossing_height(
    height: np.ndarray, values: np.ndarray, threshold: float,
) -> np.ndarray:
    """Height at which a profile first falls through `threshold`, upward.

    Written for temperature, which decreases with height: the freezing level
    is the FIRST level at which it drops through 0 C, not the last.
    """
    n = values.shape[0]
    out = np.full(values.shape[1:], np.nan)
    for k in range(n - 1):
        a, b = values[k], values[k + 1]
        za, zb = height[k], height[k + 1]
        usable = (
            (a > threshold) & (b <= threshold)
            & np.isfinite(a) & np.isfinite(b)
            & np.isfinite(za) & np.isfinite(zb) & ~np.isfinite(out)
        )
        if np.any(usable):
            denominator = np.where(b != a, b - a, np.nan)
            weight = (threshold - a) / denominator
            out = np.where(usable, za + weight * (zb - za), out)
    return out


def _layer_mean(
    coordinate: np.ndarray, values: np.ndarray, lo: float, hi: float
) -> np.ndarray:
    inside = (coordinate >= lo) & (coordinate <= hi) & np.isfinite(values)
    count = np.count_nonzero(inside, axis=0)
    total = np.where(inside, values, 0.0).sum(axis=0)
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def _layer_min(
    coordinate: np.ndarray, values: np.ndarray, lo: float, hi: float
) -> np.ndarray:
    inside = (coordinate >= lo) & (coordinate <= hi) & np.isfinite(values)
    masked = np.where(inside, values, np.inf)
    out = masked.min(axis=0)
    return np.where(np.isfinite(out), out, np.nan)


def _at_pressure(
    pressure: np.ndarray, values: np.ndarray, target_pa: float
) -> np.ndarray:
    """A field at one pressure, by linear interpolation in ln(p)."""
    ln_p = np.log(pressure)
    ln_t = float(np.log(target_pa))
    out = np.full(values.shape[1:], np.nan)
    for k in range(pressure.size - 1):
        lo, hi = ln_p[k], ln_p[k + 1]
        if not (min(lo, hi) <= ln_t <= max(lo, hi)):
            continue
        weight = 0.0 if hi == lo else (ln_t - lo) / (hi - lo)
        candidate = values[k] + weight * (values[k + 1] - values[k])
        out = np.where(np.isfinite(out), out, candidate)
    return out


def _take_at(
    columns: gridded.GriddedColumns, values: np.ndarray, target: np.ndarray
) -> np.ndarray:
    """A field at a PER-CELL pressure, interpolated in ln(p).

    `_at_pressure` takes one pressure for the whole grid. The downdraught
    source is at the level of minimum theta-e, which is a different pressure
    in every cell, so it needs this instead.
    """
    ln_p = np.log(columns.pressure)
    ln_target = np.log(np.where(np.isfinite(target) & (target > 0),
                                target, np.nan))
    out = np.full(values.shape[1:], np.nan)
    for k in range(columns.pressure.size - 1):
        lo, hi = ln_p[k], ln_p[k + 1]
        span = hi - lo
        if span == 0:
            continue
        weight = (ln_target - lo) / span
        inside = (weight >= 0.0) & (weight <= 1.0) & ~np.isfinite(out)
        if np.any(inside):
            candidate = values[k] + weight * (values[k + 1] - values[k])
            out = np.where(inside, candidate, out)
    return out


def _base_height(columns: gridded.GriddedColumns) -> np.ndarray:
    """The datum for heights above ground: the lowest usable level, per cell.

    Matches `lapse.height_lapse_rate`, which uses `column.height[0]` so that
    the same named layer means the same thing over the Fens and over the
    Cairngorms.
    """
    height = columns.height
    finite = np.isfinite(height)
    first = np.argmax(finite, axis=0)
    ny, nx = columns.shape
    yy, xx = np.meshgrid(np.arange(ny), np.arange(nx), indexing="ij")
    return np.where(np.any(finite, axis=0), height[first, yy, xx], np.nan)


# ---------------------------------------------------------------------------
# The gridded Stage 4
# ---------------------------------------------------------------------------

def compute_grid(cube: Profile) -> GriddedParameters | None:
    """Derive every gridded parameter from one Stage 3 gridded profile."""
    columns = columns_from_cube(cube)
    if columns is None:
        return None

    meta = cube.metadata
    out = GriddedParameters(
        model=meta.model, run=meta.run, valid_time=meta.valid_time,
        forecast_hour=meta.forecast_hour, shape=columns.shape,
    )
    _thermodynamics(out, columns)
    _lapse_rates(out, columns)
    _moisture(out, columns)
    _dcape(out, columns)
    _boundary_layer(out, columns, cube)
    _wind(out, columns, cube)
    if out.missing():
        out.issues.append(
            "not gridded yet, so absent for every cell: "
            + ", ".join(out.missing())
        )
    return out


#: Rows processed per tile. The ascent holds roughly 160 pressure levels for
#: every cell it is working on, so the whole UKV grid at once needs about
#: 2.7 GB of live arrays. Cells are completely independent, so tiling the
#: rows bounds that to a few hundred megabytes and changes no answer -- a
#: test asserts the tiled and untiled results are bit-identical.
TILE_ROWS = 96


def _tile(columns: gridded.GriddedColumns, rows: slice
          ) -> gridded.GriddedColumns:
    take = lambda a: None if a is None else a[rows]      # noqa: E731
    return gridded.GriddedColumns(
        pressure=columns.pressure,
        temperature=columns.temperature[:, rows],
        dewpoint=columns.dewpoint[:, rows],
        height=columns.height[:, rows],
        surface_pressure=take(columns.surface_pressure),
        surface_temperature=take(columns.surface_temperature),
        surface_dewpoint=take(columns.surface_dewpoint),
    )


def _ascend_tiled(
    columns: gridded.GriddedColumns, kind: str, tile_rows: int = TILE_ROWS
) -> gridded.GriddedAscent:
    """`ascend_grid`, one horizontal band at a time.

    Identical arithmetic -- every cell is independent of every other, and the
    ascent never looks sideways -- but it holds one band of the ascent grid
    instead of all of it.
    """
    ny = columns.shape[0]
    if ny <= tile_rows:
        return gridded.ascend_grid(columns, kind)

    parts = [
        gridded.ascend_grid(_tile(columns, slice(start, start + tile_rows)),
                            kind)
        for start in range(0, ny, tile_rows)
    ]
    joined = {}
    for name in ("cape", "cin", "lcl_pressure", "lcl_height", "lfc_pressure",
                 "lfc_height", "el_pressure", "el_height", "parcel_pressure",
                 "parcel_temperature", "parcel_dewpoint", "no_lfc"):
        joined[name] = np.concatenate([getattr(p, name) for p in parts],
                                      axis=0)
    notes: list[str] = []
    for part in parts:
        for note in part.notes:
            if note not in notes:
                notes.append(note)
    return gridded.GriddedAscent(kind=kind, notes=notes, **joined)


def _thermodynamics(
    out: GriddedParameters, columns: gridded.GriddedColumns
) -> None:
    for kind, cape_name, cin_name in (
        ("surface", "sbcape", "sbcin"),
        ("mixed_layer", "mlcape", "mlcin"),
        ("most_unstable", "mucape", "mucin"),
    ):
        ascent = _ascend_tiled(columns, kind)
        out.ascents[kind] = ascent
        out.add(Field(cape_name, ascent.cape, "J/kg", "thermodynamics",
                      method="pseudoadiabatic_virtual",
                      source_fields=("temperature", "relative_humidity")))
        out.add(Field(cin_name, ascent.cin, "J/kg", "thermodynamics",
                      method="pseudoadiabatic_virtual",
                      source_fields=("temperature", "relative_humidity")))

    # The convective levels come from the SURFACE parcel. `engine.compute`
    # passes `out.ascents.get("surface")` to `_level_diagnostic`, and taking
    # them from the most-unstable parcel instead moved the LCL by up to
    # 3.7 km on elevated soundings -- where the two parcels differ is exactly
    # where it matters.
    mu = out.ascents["surface"]
    for name, values in (("lcl", mu.lcl_height), ("lfc", mu.lfc_height),
                         ("el", mu.el_height)):
        out.add(Field(name, values, "m", "thermodynamics",
                      method="most_unstable_parcel",
                      source_fields=("temperature", "relative_humidity",
                                     "geopotential_height")))

    height, t, td = columns.height, columns.temperature, columns.dewpoint
    p = columns.pressure

    freezing = _crossing_height(height, t, th.ZERO_CELSIUS)
    out.add(Field("freezing_level", freezing, "m", "thermodynamics",
                  method="first_zero_crossing",
                  source_fields=("temperature", "geopotential_height")))

    wet_bulb = th.wet_bulb_temperature(t, td, p[:, None, None])
    out.add(Field("wet_bulb_zero",
                  _crossing_height(height, wet_bulb, th.ZERO_CELSIUS),
                  "m", "thermodynamics", method="normand_bisection",
                  source_fields=("temperature", "relative_humidity")))

    # CAPPED AT THE EQUILIBRIUM LEVEL. The warm layer cannot extend above
    # cloud top: where the freezing level sits above the EL, an uncapped
    # `freezing - lcl` reports warm cloud inside a cloud that has already
    # ended. `environment.cloud_depths` states this, and it moved the answer
    # by up to 1,546 m here. A freezing level BELOW cloud base gives zero --
    # a genuine physical zero, not an absence.
    cloud_top = mu.el_height
    lcl_height = mu.lcl_height
    # Cap at the equilibrium level where there IS one. Without an EL the
    # cloud has no top to cap against, so the freezing level stands alone --
    # which is what `environment.cloud_depths` does.
    capped = np.where(np.isfinite(cloud_top),
                      np.minimum(freezing, cloud_top), freezing)
    # A ZERO IS NOT AN ABSENCE. `np.where(x > 0, x, 0.0)` silently turns a
    # NaN into a zero, because NaN > 0 is False -- so a cell with no LCL was
    # being reported as having no warm cloud rather than as unknown.
    known = np.isfinite(lcl_height) & np.isfinite(freezing)
    warm = np.where(known, np.maximum(capped - lcl_height, 0.0), np.nan)
    cold_known = known & np.isfinite(cloud_top)
    cold = np.where(
        cold_known,
        np.maximum(cloud_top - np.maximum(freezing, lcl_height), 0.0),
        np.nan,
    )
    out.add(Field("warm_cloud_depth", warm, "m", "thermodynamics",
                  method="lcl_to_min_of_freezing_level_and_cloud_top"))
    out.add(Field("cold_cloud_depth", cold, "m", "thermodynamics",
                  method="freezing_level_to_el"))

    # Precipitable water: the mass of vapour above unit area.
    #     PW = (1/g) INT q dp,   q = w / (1 + w)
    w = th.saturation_mixing_ratio(td, p[:, None, None])
    q = np.where(np.isfinite(w), w / (1.0 + w), np.nan)
    dp = np.abs(np.diff(p))[:, None, None]
    layer = 0.5 * (q[:-1] + q[1:])
    usable = np.isfinite(layer)
    pw = np.where(usable, layer * dp, 0.0).sum(axis=0) / th.GRAVITY
    out.add(Field("precipitable_water",
                  np.where(np.any(usable, axis=0), pw, np.nan),
                  "kg/m2", "thermodynamics", method="trapezoid_in_pressure",
                  source_fields=("relative_humidity",)))


def _lapse_rates(
    out: GriddedParameters, columns: gridded.GriddedColumns
) -> None:
    base = _base_height(columns)
    height, t = columns.height, columns.temperature
    for name, bottom, top in (("lr_0_1km", 0.0, 1000.0),
                              ("lr_0_3km", 0.0, 3000.0),
                              ("lr_0_6km", 0.0, 6000.0)):
        t_bottom = _interp_at_height(height, t, base + bottom)
        t_top = _interp_at_height(height, t, base + top)
        rate = -(t_top - t_bottom) / (top - bottom) * 1000.0
        out.add(Field(name, rate, "K/km", "lapse_rates",
                      method="two_point_agl",
                      source_fields=("temperature", "geopotential_height")))

    for name, bottom_hpa, top_hpa in (("lr_850_500", 850.0, 500.0),
                                      ("lr_700_500", 700.0, 500.0)):
        z_bottom = _at_pressure(columns.pressure, height, bottom_hpa * 100.0)
        z_top = _at_pressure(columns.pressure, height, top_hpa * 100.0)
        t_bottom = _at_pressure(columns.pressure, t, bottom_hpa * 100.0)
        t_top = _at_pressure(columns.pressure, t, top_hpa * 100.0)
        depth_km = (z_top - z_bottom) / 1000.0
        safe = np.where(depth_km > 0, depth_km, np.nan)
        out.add(Field(name, -(t_top - t_bottom) / safe, "K/km", "lapse_rates",
                      method="two_point_isobaric",
                      source_fields=("temperature", "geopotential_height")))


def _sample_layer(
    columns: gridded.GriddedColumns, top_pa: float, bottom_pa: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """RH and mixing ratio on a 10 hPa grid through a pressure layer.

    The same sampling `environment.entrainment_indicators` uses, for the same
    reason: a layer mean taken over whichever stored levels happen to fall
    inside it is weighted by the model's level spacing rather than by depth.
    """
    grid = np.arange(bottom_pa, top_pa - 1.0, -1000.0)
    rh = np.full((grid.size,) + columns.shape, np.nan)
    w = np.full((grid.size,) + columns.shape, np.nan)
    for i, p in enumerate(grid):
        t = _at_pressure(columns.pressure, columns.temperature, float(p))
        td = _at_pressure(columns.pressure, columns.dewpoint, float(p))
        td = np.minimum(td, t)
        with np.errstate(invalid="ignore", divide="ignore"):
            es = th.saturation_vapour_pressure(t)
            rh[i] = 100.0 * th.saturation_vapour_pressure(td) / es
        w[i] = th.saturation_mixing_ratio(td, float(p))
    return grid, rh, w


def _nanmean(values: np.ndarray) -> np.ndarray:
    ok = np.isfinite(values)
    count = np.count_nonzero(ok, axis=0)
    total = np.where(ok, values, 0.0).sum(axis=0)
    return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def _moisture(
    out: GriddedParameters, columns: gridded.GriddedColumns
) -> None:
    """The entrainment indicators, as ONE diagnostic with an `extra` dict.

    Stage 5 does not read layer humidity from named diagnostics; it reads it
    out of `entrainment_indicators.extra`. Producing tidy separate fields
    here would look right and leave the entrainment engine blind.
    """
    _, mid_rh, mid_w = _sample_layer(columns, 50_000.0, 70_000.0)
    _, low_rh, low_w = _sample_layer(columns, 85_000.0, 100_000.0)

    mean_mid_rh = _nanmean(mid_rh)
    masked = np.where(np.isfinite(mid_rh), mid_rh, np.inf)
    min_mid_rh = masked.min(axis=0)
    min_mid_rh = np.where(np.isfinite(min_mid_rh), min_mid_rh, np.nan)
    mean_mid_w = _nanmean(mid_w)
    mean_low_rh = _nanmean(low_rh)
    mean_low_w = _nanmean(low_w)

    out.add(Field(
        "entrainment_indicators", mean_mid_rh, "%", "convective_environment",
        method="layer_mean_humidity_and_mixing_ratio_contrast",
        source_fields=("relative_humidity", "temperature"),
        extra={
            "mid_level_mean_rh_percent": mean_mid_rh,
            "mid_level_min_rh_percent": min_mid_rh,
            "mid_level_mean_mixing_ratio_g_kg": mean_mid_w * 1000.0,
            "low_level_mean_rh_percent": mean_low_rh,
            "low_level_mean_mixing_ratio_g_kg": mean_low_w * 1000.0,
            "low_to_mid_mixing_ratio_contrast_g_kg":
                (mean_low_w - mean_mid_w) * 1000.0,
        },
    ))


#: Layer searched for the downdraught source, Pa. Emanuel (1994): the level
#: of MINIMUM theta-e, not a fixed pressure.
DCAPE_SEARCH = (70_000.0, 50_000.0)

#: Pressure step of the gridded descent, Pa.
DCAPE_STEP_PA = 500.0


def _dcape(
    out: GriddedParameters, columns: gridded.GriddedColumns
) -> None:
    """Downdraught CAPE, vectorised.

    The same construction as `environment.dcape`, which states the method in
    full because DCAPE has no universal definition: source at the level of
    minimum theta-e between 700 and 500 hPa, saturated there by cooling to
    its wet-bulb temperature, descending along a pseudoadiabat to the
    surface, negative buoyancy integrated on virtual temperature and reported
    POSITIVE by convention.

    The descent marches a COMMON pressure grid, but every cell starts at its
    own source pressure, so the first step is a per-cell partial step. That
    is the same device `gridded.lift_grid` uses for cells crossing their LCL
    partway through an interval, and for the same reason: snapping each
    source to the nearest grid level would quantise DCAPE.
    """
    top, bottom = DCAPE_SEARCH[1], DCAPE_SEARCH[0]
    search = np.arange(bottom, top - 1.0, -1000.0)
    shape = columns.shape

    theta_e = np.full((search.size,) + shape, np.nan)
    t_layer = np.full((search.size,) + shape, np.nan)
    td_layer = np.full((search.size,) + shape, np.nan)
    for i, p in enumerate(search):
        t = _at_pressure(columns.pressure, columns.temperature, float(p))
        td = np.minimum(
            _at_pressure(columns.pressure, columns.dewpoint, float(p)), t
        )
        t_layer[i], td_layer[i] = t, td
        with np.errstate(invalid="ignore", divide="ignore"):
            theta_e[i] = th.equivalent_potential_temperature(t, td, float(p))

    have = np.any(np.isfinite(theta_e), axis=0)
    if not np.any(have):
        out.issues.append("theta-e could not be evaluated in the 700-500 hPa "
                          "source layer anywhere; DCAPE unavailable")
        return

    # Minimum theta-e per cell. NaN levels are pushed out of contention
    # rather than allowed to win an argmin.
    ranked = np.where(np.isfinite(theta_e), theta_e, np.inf)
    source = np.argmin(ranked, axis=0)
    take = source[None, :, :]
    p_source = search[source]
    t_source = np.take_along_axis(t_layer, take, axis=0)[0]
    td_source = np.take_along_axis(td_layer, take, axis=0)[0]

    t_wet = th.wet_bulb_temperature(t_source, td_source, p_source)

    surface = columns.surface_pressure
    if surface is None:
        surface = np.full(shape, float(columns.pressure[0]))
    surface = np.minimum(surface, float(columns.pressure[0]))

    descent = np.arange(top, 105_000.0 + 1.0, DCAPE_STEP_PA)
    current_t = np.array(t_wet, dtype="float64", copy=True)
    current_p = np.array(p_source, dtype="float64", copy=True)
    total = np.zeros(shape)
    started = np.zeros(shape, dtype=bool)

    # SEED THE INTEGRAL AT THE SOURCE ITSELF, not at the first common grid
    # level below it. The source pressure is per cell and almost never lands
    # on the grid, so starting at the first level below drops a partial
    # layer -- measured as a systematic 1 J/kg low bias against the scalar
    # engine, about 2% of a typical UK DCAPE.
    previous_ln = np.log(np.where(np.isfinite(p_source), p_source, np.nan))
    w_source = th.saturation_mixing_ratio(t_wet, p_source)
    w_source = np.where(np.isfinite(w_source), w_source, 0.0)
    tv_source = th.virtual_temperature(t_wet, w_source)
    env_t0 = _take_at(columns, columns.temperature, p_source)
    env_td0 = np.minimum(_take_at(columns, columns.dewpoint, p_source), env_t0)
    w_env0 = th.saturation_mixing_ratio(env_td0, p_source)
    w_env0 = np.where(np.isfinite(w_env0), w_env0, 0.0)
    previous_dtv = th.virtual_temperature(env_t0, w_env0) - tv_source

    for p in descent:
        active = have & np.isfinite(t_wet) & (p > p_source) & (p <= surface)
        if not np.any(active):
            continue
        step = np.where(active, p - current_p, 0.0)
        stepped = _descend(current_t, current_p, step, active)
        current_t = np.where(active, stepped, current_t)
        current_p = np.where(active, p, current_p)

        w_parcel = th.saturation_mixing_ratio(current_t, p)
        w_parcel = np.where(np.isfinite(w_parcel), w_parcel, 0.0)
        tv_parcel = th.virtual_temperature(current_t, w_parcel)

        env_t = _at_pressure(columns.pressure, columns.temperature, float(p))
        env_td = _at_pressure(columns.pressure, columns.dewpoint, float(p))
        w_env = th.saturation_mixing_ratio(np.minimum(env_td, env_t), p)
        w_env = np.where(np.isfinite(w_env), w_env, 0.0)
        tv_env = th.virtual_temperature(env_t, w_env)

        dtv = np.where(active, tv_env - tv_parcel, np.nan)
        ln_p = float(np.log(p))
        both = np.isfinite(dtv) & np.isfinite(previous_dtv) & active
        # Trapezoid on max(dtv, 0): only a parcel COLDER than its
        # environment contributes downdraught energy.
        area = 0.5 * (
            np.where(dtv > 0, dtv, 0.0)
            + np.where(previous_dtv > 0, previous_dtv, 0.0)
        ) * (ln_p - previous_ln)
        total = np.where(both, total + th.R_DRY * area, total)
        previous_dtv = np.where(active, dtv, previous_dtv)
        previous_ln = np.where(active, ln_p, previous_ln)
        started = started | active

    values = np.where(started & np.isfinite(total), total, np.nan)
    out.add(Field("dcape", values, "J/kg", "convective_environment",
                  method="emanuel_1994_min_theta_e",
                  source_fields=("temperature", "relative_humidity")))


def _descend(
    temperature: np.ndarray, pressure: np.ndarray, step: np.ndarray,
    active: np.ndarray,
) -> np.ndarray:
    """One RK4 pseudoadiabatic step downward, in several substeps.

    The descent covers up to 550 hPa, and a single RK4 step that long drifts.
    Four substeps hold the pseudoadiabat to better than 0.01 K over the whole
    descent, matching what the scalar path gets from its 2 hPa march.
    """
    out = np.array(temperature, dtype="float64", copy=True)
    substep = np.where(active, step / 4.0, 0.0)
    current_p = np.array(pressure, dtype="float64", copy=True)
    for _ in range(4):
        out = np.where(
            active, gridded._moist_step(out, current_p, substep), out
        )
        current_p = current_p + substep
    return out


#: Samples taken through the boundary layer when averaging its moisture.
#: The scalar path walks a fixed 25 m step; this takes the same number of
#: samples spread through EACH cell's own depth, which is the same average
#: without a per-cell loop.
BOUNDARY_LAYER_SAMPLES = 25

#: Depth averaged when the boundary-layer depth is unknown, m. Matches
#: `boundary.boundary_layer_moisture`, which falls back to the lowest 500 m
#: and records that it did.
FALLBACK_LAYER_M = 500.0


def _mean_mixing_ratio(
    columns: gridded.GriddedColumns, depth: np.ndarray | None
) -> np.ndarray:
    """Mean mixing ratio through the boundary layer, kg/kg.

    NOT the screen-level value. `boundary.boundary_layer_moisture` is
    explicit that surface humidity says almost nothing about how much water a
    storm can ingest, and reports a LAYER MEAN of the mixing ratio because
    that is what is conserved under dry ascent and therefore what actually
    gets lifted. Using the screen value disagreed by up to 9 g/kg.
    """
    base = _base_height(columns)
    if depth is None:
        used = np.full(columns.shape, FALLBACK_LAYER_M)
    else:
        used = np.where(np.isfinite(depth) & (depth > 50.0), depth,
                        FALLBACK_LAYER_M)

    pressure = np.broadcast_to(
        columns.pressure[:, None, None], columns.temperature.shape
    ).astype("float64")

    total = np.zeros(columns.shape)
    count = np.zeros(columns.shape)
    for fraction in np.linspace(0.0, 1.0, BOUNDARY_LAYER_SAMPLES):
        target = base + used * fraction
        t = _interp_at_height(columns.height, columns.temperature, target)
        td = _interp_at_height(columns.height, columns.dewpoint, target)
        p = _interp_at_height(columns.height, pressure, target)
        w = th.saturation_mixing_ratio(np.minimum(td, t), p)
        ok = np.isfinite(w)
        total = np.where(ok, total + w, total)
        count = np.where(ok, count + 1.0, count)
    return np.where(count >= 2, total / np.maximum(count, 1.0), np.nan)


def _boundary_layer(
    out: GriddedParameters, columns: gridded.GriddedColumns, cube: Profile
) -> None:
    pbl = cube.surface.get("boundary_layer_height")
    if pbl is not None:
        values = np.asarray(pbl, dtype="float64")
        if values.shape == columns.shape:
            out.add(Field("pbl_depth", values, "m", "boundary_layer",
                          method="model_diagnosed",
                          source_fields=("boundary_layer_height",)))
    if columns.surface_temperature is not None:
        out.add(Field("boundary_layer_temperature",
                      np.asarray(columns.surface_temperature, dtype="float64"),
                      "K", "boundary_layer", method="screen_level",
                      source_fields=("temperature_2m",)))
    # NOT the screen-level value, and NOT in g/kg. `boundary.
    # boundary_layer_moisture` returns the MEAN mixing ratio through the
    # boundary layer in kg/kg, falling back to the lowest 500 m where the
    # depth is unknown. The screen value disagreed by up to 9 g/kg.
    depth = out.value("pbl_depth")
    out.add(Field("boundary_layer_moisture",
                  _mean_mixing_ratio(columns, depth),
                  "kg/kg", "boundary_layer",
                  method="mean_mixing_ratio_through_boundary_layer",
                  source_fields=("relative_humidity", "temperature")))


# ---------------------------------------------------------------------------
# Kinematics
# ---------------------------------------------------------------------------

def _hodograph(
    columns: gridded.GriddedColumns, cube: Profile
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Wind on a regular height-above-ground grid, from the pressure levels.

    Returns (levels_agl, u, v) with u and v shaped (n_levels, ny, nx), or
    None when the cube carries no wind.
    """
    # NATIVE HEIGHT LEVELS FIRST, exactly as `column._attach_hodograph`
    # prefers them. The UKV carries winds at 10, 50, 100, 250, 500, 1000,
    # 2000 ... 6000 m, and that low-level resolution is the whole point: a
    # 0-1 km shear built from nine PRESSURE levels rests on one or two
    # points, and using them instead disagreed with the scalar engine by up
    # to 9 m/s.
    u_var = cube.height.get("u_wind")
    v_var = cube.height.get("v_wind")
    if u_var is None or v_var is None:
        return None
    u = np.asarray(u_var.values, dtype="float64")
    v = np.asarray(v_var.values, dtype="float64")
    if u.ndim != 3 or u.shape[1:] != columns.shape:
        return None

    # These levels are already heights above ground, so the datum is the
    # lowest of them rather than the column base.
    wind_levels = np.asarray(u_var.levels, dtype="float64")
    order = np.argsort(wind_levels)
    wind_levels, u, v = wind_levels[order], u[order], v[order]
    height = np.broadcast_to(
        wind_levels[:, None, None], u.shape
    ).astype("float64")
    # The datum is ZERO, not the lowest level: these heights are already
    # above ground, so "0-6 km" means 6000 m, not 6000 m above the 10 m
    # level. Offsetting by the lowest level put the 6 km target at 6010 m,
    # one metre above the top of the profile, and made 0-6 km shear
    # unavailable everywhere.
    base = np.zeros(columns.shape)
    lowest = float(wind_levels[0])
    top = min(HODOGRAPH_TOP_M, float(wind_levels[-1]) - float(wind_levels[0]))
    levels = np.arange(0.0, top + HODOGRAPH_STEP_M, HODOGRAPH_STEP_M)
    us = np.empty((levels.size,) + columns.shape)
    vs = np.empty((levels.size,) + columns.shape)
    for i, z in enumerate(levels):
        # Anchored at the lowest wind level, not at 0 m. The model's lowest
        # wind is at 10 m, so asking for 0 m returns NaN -- which dropped the
        # 0-250 m layer out of the helicity sum entirely, and that is the
        # most helicity-rich layer there is. The scalar path anchors the same
        # way, through `wind._anchor`.
        target = max(float(z), lowest)
        us[i] = _interp_at_height(height, u, base + target)
        vs[i] = _interp_at_height(height, v, base + target)
    return Hodograph(levels=levels, u=us, v=vs, base=base, lowest=lowest,
                     raw_height=height, raw_u=u, raw_v=v)


@dataclass(slots=True)
class Hodograph:
    """Wind sampled on height above ground, plus the profile it came from.

    The raw profile is kept so a layer DEEPER than the sampled top can be
    interpolated directly. Reading it off the sampled levels instead would
    return the top level for any height above it, which would silently make
    0-8 km shear equal to 0-6 km shear.
    """

    levels: np.ndarray
    u: np.ndarray
    v: np.ndarray
    base: np.ndarray
    #: Height of the lowest wind level, m. The shear datum: the model's
    #: lowest wind is at 10 m, not at the ground.
    lowest: float
    raw_height: np.ndarray
    raw_u: np.ndarray
    raw_v: np.ndarray

    def at(self, height_agl: float) -> tuple[np.ndarray, np.ndarray]:
        target = self.base + height_agl
        return (_interp_at_height(self.raw_height, self.raw_u, target),
                _interp_at_height(self.raw_height, self.raw_v, target))


def _mean_wind(
    levels: np.ndarray, u: np.ndarray, v: np.ndarray, lo: float, hi: float
) -> tuple[np.ndarray, np.ndarray]:
    inside = (levels >= lo) & (levels <= hi)
    if not np.any(inside):
        shape = u.shape[1:]
        return np.full(shape, np.nan), np.full(shape, np.nan)
    block_u, block_v = u[inside], v[inside]
    ok = np.isfinite(block_u) & np.isfinite(block_v)
    count = np.count_nonzero(ok, axis=0)
    mean_u = np.where(ok, block_u, 0.0).sum(axis=0) / np.maximum(count, 1)
    mean_v = np.where(ok, block_v, 0.0).sum(axis=0) / np.maximum(count, 1)
    empty = count == 0
    return np.where(empty, np.nan, mean_u), np.where(empty, np.nan, mean_v)


def _wind(
    out: GriddedParameters, columns: gridded.GriddedColumns, cube: Profile
) -> None:
    hodograph = _hodograph(columns, cube)
    if hodograph is None:
        out.issues.append("no gridded wind profile; shear and helicity "
                          "are unavailable everywhere")
        return
    levels, u, v = hodograph.levels, hodograph.u, hodograph.v

    # -- bulk shear ----------------------------------------------------------
    # Interpolated from the RAW profile at every depth, including those
    # deeper than the sampled hodograph.
    u0, v0 = hodograph.at(hodograph.lowest)
    for name, top in (("shear_0_1km", 1000.0), ("shear_0_3km", 3000.0),
                      ("shear_0_6km", 6000.0), ("shear_0_8km", 8000.0)):
        u_top, v_top = hodograph.at(top)
        out.add(Field(name, np.hypot(u_top - u0, v_top - v0), "m/s", "wind",
                      method="two_point_vector_difference",
                      source_fields=("u_wind", "v_wind"),
                      status=Status.DEGRADED))

    # -- Bunkers storm motion, for the helicity reference frame -------------
    mean_u, mean_v = _mean_wind(levels, u, v, 0.0, 6000.0)
    low_u, low_v = _mean_wind(levels, u, v, 0.0, 500.0)
    high_u, high_v = _mean_wind(levels, u, v, 5500.0, 6000.0)
    shear_u, shear_v = high_u - low_u, high_v - low_v
    magnitude = np.hypot(shear_u, shear_v)
    safe = np.where(magnitude > 1e-3, magnitude, np.nan)
    # k x shear, normalised: the right mover deviates to the right of the
    # shear vector. Same construction as `wind.bunkers_motion`.
    motion_u = mean_u + BUNKERS_DEVIATION * (shear_v / safe)
    motion_v = mean_v - BUNKERS_DEVIATION * (shear_u / safe)

    # -- storm-relative helicity --------------------------------------------
    #     SRH = SUM (u[k+1]-c_u)(v[k]-c_v) - (u[k]-c_u)(v[k+1]-c_v)
    # the Davies-Jones et al. (1990) discrete form, exact for a piecewise
    # linear hodograph.
    for name, top in (("srh_0_1km", 1000.0), ("srh_0_3km", 3000.0)):
        inside = levels <= top
        du = u[inside] - motion_u[None, :, :]
        dv = v[inside] - motion_v[None, :, :]
        terms = du[1:] * dv[:-1] - du[:-1] * dv[1:]
        ok = np.isfinite(terms)
        srh = np.where(ok, terms, 0.0).sum(axis=0)
        out.add(Field(name, np.where(np.any(ok, axis=0), srh, np.nan),
                      "m2/s2", "wind", method="davies_jones_1990",
                      source_fields=("u_wind", "v_wind"),
                      status=Status.DEGRADED))

    # -- bulk Richardson number ----------------------------------------------
    # BRN = CAPE / (0.5 * |V(0-6 km mean) - V(0-500 m mean)|^2)
    cape = out.value("sbcape")
    if cape is not None:
        denominator = 0.5 * (np.hypot(mean_u - low_u, mean_v - low_v) ** 2)
        brn = np.where(denominator > 0, cape / np.where(denominator > 0,
                                                        denominator, np.nan),
                       np.nan)
        out.add(Field("bulk_richardson_number", brn, "dimensionless", "wind",
                      method="cape_over_shear_kinetic_energy",
                      source_fields=("u_wind", "v_wind", "temperature"),
                      status=Status.DEGRADED))
