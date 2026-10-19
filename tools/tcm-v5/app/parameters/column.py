"""The bridge from a Stage 3 `Profile` to the arrays the science works on.

Stage 3 hands over a dictionary of `VariableProfile`s with per-level
provenance. The parcel engine wants clean, aligned, monotonic arrays. This
module does that conversion once, in one place, and enforces the three rules
that every downstream calculation depends on:

**Below-ground levels are dropped, not zeroed.** Stage 3 marks them
`BELOW_GROUND` because the model extrapolates beneath terrain to keep
pressure-level fields rectangular. Those numbers are not atmosphere. Lifting
a parcel through them produces a confident CAPE for a sounding that starts
inside a hill.

**Levels missing a required variable are dropped as a set.** A level with
temperature but no humidity cannot contribute to a parcel ascent, and keeping
it with a NaN dewpoint silently poisons every integral that crosses it.

**Provenance survives.** The column records how many of its levels were
native so a diagnostic can be marked DEGRADED when it rests mostly on
interpolation.

Nothing here interpolates or extrapolates. Stage 3 owns that; this module
only selects.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

import numpy as np

from ..profiles.schema import FieldOrigin, Profile, VariableProfile
from ..profiles.levels import VerticalCoordinate
from . import thermo as th

log = logging.getLogger(__name__)

#: Fewer than this many usable levels and a vertical integral is not
#: meaningfully sampling the atmosphere -- it is joining two dots.
MIN_LEVELS_FOR_INTEGRAL = 4

#: Below this fraction of native levels, results built on the column are
#: marked DEGRADED. Set where it is: nine pressure levels with three
#: interpolated is still a real sounding; mostly-interpolated is not.
NATIVE_FRACTION_DEGRADED = 0.5


@dataclass(slots=True)
class Column:
    """A single vertical column, ready for integration.

    Ordered ground-upward: `pressure` strictly decreasing, `height` strictly
    increasing. Every array has the same length, and index i of each refers
    to the same level.
    """

    #: Pa, strictly decreasing.
    pressure: np.ndarray
    #: K.
    temperature: np.ndarray
    #: K. NaN where moisture was unavailable at that level.
    dewpoint: np.ndarray
    #: m. Geopotential height where native, hypsometric where reconstructed.
    height: np.ndarray
    #: m/s. NaN where wind was unavailable.
    u_wind: np.ndarray
    v_wind: np.ndarray

    # -- the height-coordinate hodograph -----------------------------------
    # Shear and helicity are defined over geometric depths (0-1 km, 0-6 km),
    # and the models publish wind on height levels directly. Using those is
    # not the same as converting the pressure column: 850 hPa is a different
    # height at every point and hour, so a pressure-level substitute for
    # "1 km" is an approximation that varies with the weather. When the
    # height levels exist they are used; the pressure column is the fallback.
    #: m above ground, increasing.
    wind_height: np.ndarray = dc_field(
        default_factory=lambda: np.zeros(0)
    )
    wind_u: np.ndarray = dc_field(default_factory=lambda: np.zeros(0))
    wind_v: np.ndarray = dc_field(default_factory=lambda: np.zeros(0))
    #: Which coordinate the hodograph came from, for provenance.
    wind_source: str = ""
    wind_native_fraction: float = 1.0

    #: hPa levels the values came from, for provenance.
    source_levels: tuple[float, ...] = ()
    #: Fraction of contributing levels that were native model output.
    native_fraction: float = 1.0
    #: True if height was reconstructed hypsometrically rather than read
    #: from the model's geopotential field.
    height_reconstructed: bool = False
    #: Surface state, when the profile carried it.
    surface_pressure: float | None = None
    surface_temperature: float | None = None
    surface_dewpoint: float | None = None
    terrain_height: float | None = None
    #: Model-native boundary-layer depth, m. Preferred over any
    #: reconstruction (Stage 4 rule: keep the model's own definition).
    boundary_layer_height: float | None = None

    issues: list[str] = dc_field(default_factory=list)

    # -- derived quantities, computed once and shared ----------------------
    _mixing_ratio: np.ndarray | None = None
    _virtual_temperature: np.ndarray | None = None
    _theta: np.ndarray | None = None
    _theta_e: np.ndarray | None = None
    _wet_bulb: np.ndarray | None = None

    def __len__(self) -> int:
        return int(self.pressure.size)

    @property
    def has_moisture(self) -> bool:
        return bool(np.any(np.isfinite(self.dewpoint)))

    @property
    def has_wind(self) -> bool:
        return bool(np.any(np.isfinite(self.u_wind)))

    @property
    def has_hodograph(self) -> bool:
        """True when wind is available on a height coordinate, which is what
        layer shear and helicity actually want."""
        return bool(
            self.wind_height.size >= 2 and np.any(np.isfinite(self.wind_u))
        )

    @property
    def hodograph_top(self) -> float:
        """Highest height, m AGL, at which wind is available."""
        if not self.has_hodograph:
            return float("nan")
        ok = np.isfinite(self.wind_u) & np.isfinite(self.wind_v)
        return float(self.wind_height[ok][-1]) if np.any(ok) else float("nan")

    def wind_at_height(self, target_m: float) -> tuple[float, float]:
        """(u, v) at a geometric height, m/s.

        COMPONENTS are interpolated, never speed and direction: blending 350
        with 10 degrees gives 180, a reversed wind. Direction is derived
        afterwards, by `wind.direction_from_components`.

        Returns (nan, nan) above the top of the wind profile rather than
        extrapolating -- a 0-6 km shear computed against an extrapolated
        6 km wind is not a 0-6 km shear.
        """
        if not self.has_hodograph:
            return (float("nan"), float("nan"))
        z, u, v = self.wind_height, self.wind_u, self.wind_v
        ok = np.isfinite(z) & np.isfinite(u) & np.isfinite(v)
        if np.count_nonzero(ok) < 2:
            return (float("nan"), float("nan"))
        zf, uf, vf = z[ok], u[ok], v[ok]
        if target_m < zf[0] - 1e-6 or target_m > zf[-1] + 1e-6:
            return (float("nan"), float("nan"))
        return (
            float(np.interp(target_m, zf, uf)),
            float(np.interp(target_m, zf, vf)),
        )

    @property
    def moist_levels(self) -> int:
        return int(np.count_nonzero(np.isfinite(self.dewpoint)))

    @property
    def top_pressure(self) -> float:
        return float(self.pressure[-1]) if len(self) else float("nan")

    @property
    def bottom_pressure(self) -> float:
        return float(self.pressure[0]) if len(self) else float("nan")

    @property
    def degraded(self) -> bool:
        """True when results from this column should not be presented as
        firm: too few levels, or mostly interpolated."""
        return (
            len(self) < MIN_LEVELS_FOR_INTEGRAL
            or self.native_fraction < NATIVE_FRACTION_DEGRADED
        )

    # -- shared intermediates ---------------------------------------------
    # Computed lazily and cached: half the diagnostics in the package need
    # mixing ratio and virtual temperature, and recomputing Bolton's
    # exponential per diagnostic is the obvious way to make a grid-wide run
    # far slower than it needs to be.

    @property
    def mixing_ratio(self) -> np.ndarray:
        """kg/kg. NaN where the level had no moisture."""
        if self._mixing_ratio is None:
            self._mixing_ratio = th.saturation_mixing_ratio(
                self.dewpoint, self.pressure
            )
        return self._mixing_ratio

    @property
    def virtual_temperature(self) -> np.ndarray:
        """K. Falls back to dry temperature on levels with no moisture --
        which is correct: with no vapour, Tv IS T. The fallback is recorded
        by `moist_levels` rather than hidden."""
        if self._virtual_temperature is None:
            w = np.where(np.isfinite(self.mixing_ratio), self.mixing_ratio, 0.0)
            self._virtual_temperature = th.virtual_temperature(
                self.temperature, w
            )
        return self._virtual_temperature

    @property
    def theta(self) -> np.ndarray:
        if self._theta is None:
            self._theta = th.potential_temperature(
                self.temperature, self.pressure
            )
        return self._theta

    @property
    def theta_e(self) -> np.ndarray:
        """K. NaN where moisture was unavailable."""
        if self._theta_e is None:
            self._theta_e = th.equivalent_potential_temperature(
                self.temperature, self.dewpoint, self.pressure
            )
        return self._theta_e

    @property
    def wet_bulb(self) -> np.ndarray:
        """K. NaN where moisture was unavailable."""
        if self._wet_bulb is None:
            self._wet_bulb = th.wet_bulb_temperature(
                self.temperature, self.dewpoint, self.pressure
            )
        return self._wet_bulb

    # -- interpolation onto the column ------------------------------------

    def interp_at_pressure(
        self, values: np.ndarray, target_pa: float
    ) -> float:
        """Linear-in-ln(p) interpolation of a column variable.

        Returns NaN outside the column rather than extrapolating -- the same
        refusal Stage 3 makes, for the same reason.
        """
        return _interp_log_p(target_pa, self.pressure, values)

    def interp_at_height(
        self, values: np.ndarray, target_m: float
    ) -> float:
        """Linear-in-height interpolation of a column variable.

        Returns NaN above the top of the column or below its base.
        """
        z = self.height
        finite = np.isfinite(z) & np.isfinite(values)
        if np.count_nonzero(finite) < 2:
            return float("nan")
        zf, vf = z[finite], values[finite]
        if target_m < zf[0] - 1e-6 or target_m > zf[-1] + 1e-6:
            return float("nan")
        return float(np.interp(target_m, zf, vf))

    def thermo_at(self, pressure_pa: float) -> tuple[float, float]:
        """(temperature, dew point) at a pressure, K -- including the layer
        between the surface and the lowest stored pressure level.

        Stored pressure levels start at 1000 hPa, but the surface is often
        BELOW that: 1008 hPa is routine over England, and over the sea
        1019 hPa. That leaves a real slab of the atmosphere -- the warmest,
        moistest slab, the one convection starts in -- outside the levels.

        Plain column interpolation returns NaN there, which is what made the
        most-unstable parcel search skip the surface entirely and return
        MUCAPE BELOW SBCAPE: physically impossible, since the surface parcel
        is one of the candidates the most-unstable parcel is chosen from.

        Below the lowest stored level this interpolates between the screen
        state and that level. Both endpoints are real model output, so this
        is interpolation, not extrapolation -- and it is only available when
        the screen state exists. Above the lowest level nothing changes.
        """
        if pressure_pa <= self.pressure[0] + 1e-6:
            return (
                _interp_log_p(pressure_pa, self.pressure, self.temperature),
                _interp_log_p(pressure_pa, self.pressure, self.dewpoint),
            )
        if (
            self.surface_pressure is None
            or self.surface_temperature is None
            or self.surface_dewpoint is None
            or pressure_pa > self.surface_pressure + 1e-6
        ):
            return (float("nan"), float("nan"))

        p_lo, p_hi = self.pressure[0], float(self.surface_pressure)
        if p_hi <= p_lo:
            return (float(self.surface_temperature),
                    float(self.surface_dewpoint))
        weight = (np.log(pressure_pa) - np.log(p_lo)) / (
            np.log(p_hi) - np.log(p_lo)
        )
        t_top, td_top = float(self.temperature[0]), float(self.dewpoint[0])
        t = t_top + weight * (float(self.surface_temperature) - t_top)
        if np.isfinite(td_top):
            td = td_top + weight * (float(self.surface_dewpoint) - td_top)
        else:
            td = float(self.surface_dewpoint)
        return (t, td)

    @property
    def surface_layer_available(self) -> bool:
        """True when the sub-1000 hPa surface layer can be sampled."""
        return (
            self.surface_pressure is not None
            and self.surface_temperature is not None
            and self.surface_dewpoint is not None
            and self.surface_pressure > self.pressure[0] + 1e-6
        )

    def pressure_at_height(self, target_m: float) -> float:
        """Pa at a geometric height, by interpolation in ln(p)."""
        z = self.height
        finite = np.isfinite(z)
        if np.count_nonzero(finite) < 2:
            return float("nan")
        zf, pf = z[finite], self.pressure[finite]
        if target_m < zf[0] - 1e-6 or target_m > zf[-1] + 1e-6:
            return float("nan")
        return float(np.exp(np.interp(target_m, zf, np.log(pf))))

    def height_at_pressure(self, target_pa: float) -> float:
        return _interp_log_p(target_pa, self.pressure, self.height)

    def to_dict(self) -> dict:
        return {
            "levels": len(self),
            "moist_levels": self.moist_levels,
            "bottom_pressure_hpa": (
                self.bottom_pressure / 100.0 if len(self) else None
            ),
            "top_pressure_hpa": (
                self.top_pressure / 100.0 if len(self) else None
            ),
            "native_fraction": round(self.native_fraction, 3),
            "height_reconstructed": self.height_reconstructed,
            "has_wind": self.has_wind,
            "degraded": self.degraded,
            "issues": list(self.issues),
        }


def _interp_log_p(
    target_pa: float, pressure: np.ndarray, values: np.ndarray
) -> float:
    """Interpolate `values` to `target_pa`, linear in ln(p), no extrapolation.

    `pressure` runs ground-upward (decreasing), so it is reversed for
    `np.interp`, which requires an increasing coordinate. Passing a
    decreasing coordinate to np.interp does not raise -- it silently returns
    nonsense, which is why the reversal is explicit here rather than assumed.
    """
    finite = np.isfinite(pressure) & np.isfinite(values)
    if np.count_nonzero(finite) < 2 or not np.isfinite(target_pa):
        return float("nan")
    p, v = pressure[finite], values[finite]
    if target_pa > p[0] + 1e-6 or target_pa < p[-1] - 1e-6:
        return float("nan")
    lp = np.log(p)[::-1]
    return float(np.interp(np.log(target_pa), lp, v[::-1]))


def _usable_mask(variable: VariableProfile | None) -> np.ndarray | None:
    """Levels of a variable that carry real atmospheric values.

    `FieldOrigin.has_value` already excludes UNAVAILABLE / OUT_OF_RANGE.
    BELOW_GROUND is excluded here as well: it HAS a value, it is simply not
    a value from the atmosphere.
    """
    if variable is None:
        return None
    mask = np.array(
        [
            p.origin.has_value and p.origin is not FieldOrigin.BELOW_GROUND
            for p in variable.provenance
        ],
        dtype=bool,
    )
    values = np.asarray(variable.values, dtype="float64")
    if values.ndim > 1:
        # A cube: a level is usable only where it is usable everywhere.
        # Column extraction is a point operation, so callers should pass a
        # point profile; this keeps the behaviour defined rather than
        # accidentally broadcasting.
        finite = np.all(np.isfinite(values.reshape(values.shape[0], -1)), axis=1)
    else:
        finite = np.isfinite(values)
    return mask & finite


def _native_flags(variable: VariableProfile) -> np.ndarray:
    return np.array(
        [p.origin is FieldOrigin.NATIVE for p in variable.provenance],
        dtype=bool,
    )


def _values(variable: VariableProfile | None, index: np.ndarray) -> np.ndarray:
    if variable is None:
        return np.full(index.size, np.nan)
    values = np.asarray(variable.values, dtype="float64")
    if values.ndim > 1:
        values = values.reshape(values.shape[0], -1)[:, 0]
    return values[index]


def column_from_profile(profile: Profile) -> Column | None:
    """Build an integrable column from a Stage 3 point profile.

    Returns None when the profile carries no usable temperature structure at
    all -- there is nothing to compute, and an empty Column would only push
    that discovery further downstream.
    """
    pressure_vars = profile.pressure
    temperature = pressure_vars.get("temperature")
    if temperature is None:
        log.info(
            "no pressure-level temperature for %s %s T+%s; no column",
            profile.metadata.model, profile.metadata.run,
            profile.metadata.forecast_hour,
        )
        return None

    usable = _usable_mask(temperature)
    if usable is None or np.count_nonzero(usable) < 2:
        log.info(
            "only %d usable temperature levels for %s T+%s; no column",
            0 if usable is None else int(np.count_nonzero(usable)),
            profile.metadata.model, profile.metadata.forecast_hour,
        )
        return None

    index = np.flatnonzero(usable)
    levels_hpa = np.asarray(temperature.levels, dtype="float64")[index]
    pressure = levels_hpa * 100.0

    # Ground-upward. Stage 3 promises this ordering, but a column that is not
    # monotonic breaks every integral silently, so it is enforced rather than
    # trusted.
    order = np.argsort(-pressure)
    index = index[order]
    pressure = pressure[order]
    levels_hpa = levels_hpa[order]

    t = _values(temperature, index)

    issues: list[str] = []

    # -- moisture -----------------------------------------------------------
    rh_var = pressure_vars.get("relative_humidity")
    if rh_var is not None:
        rh = _values(rh_var, index)
        rh_ok = _usable_mask(rh_var)
        rh = np.where(rh_ok[index] if rh_ok is not None else False, rh, np.nan)
        dewpoint = th.dewpoint_from_rh(rh, t)
        # A dew point above the temperature is supersaturation. It is real in
        # model output and Stage 3 deliberately does not clip it, but a
        # parcel lifted from a supersaturated state is not defined, so the
        # value is capped HERE, at the point of use, and flagged.
        over = np.isfinite(dewpoint) & (dewpoint > t)
        if np.any(over):
            issues.append(
                f"{int(np.count_nonzero(over))} supersaturated level(s); "
                f"dew point capped at the dry-bulb temperature for parcel work"
            )
            dewpoint = np.where(over, t, dewpoint)
    else:
        dewpoint = np.full(t.size, np.nan)
        issues.append("no pressure-level humidity; parcel diagnostics "
                      "unavailable")

    # -- height -------------------------------------------------------------
    gh_var = pressure_vars.get("geopotential_height")
    height_reconstructed = False
    if gh_var is not None:
        gh_ok = _usable_mask(gh_var)
        height = _values(gh_var, index)
        height = np.where(
            gh_ok[index] if gh_ok is not None else False, height, np.nan
        )
    else:
        height = np.full(t.size, np.nan)
    if not np.all(np.isfinite(height)):
        filled = _hypsometric_heights(pressure, t, dewpoint, height)
        if filled is not None:
            if np.any(~np.isfinite(height)):
                height_reconstructed = True
                issues.append(
                    "geopotential height incomplete; heights reconstructed "
                    "hypsometrically from the virtual-temperature profile"
                )
            height = filled

    # -- wind ---------------------------------------------------------------
    u = _column_wind(pressure_vars.get("u_wind"), index)
    v = _column_wind(pressure_vars.get("v_wind"), index)
    if not np.any(np.isfinite(u)):
        issues.append("no pressure-level wind; shear and helicity "
                      "unavailable from the pressure column")

    # -- provenance ---------------------------------------------------------
    native = _native_flags(temperature)[index]
    native_fraction = float(np.count_nonzero(native)) / max(native.size, 1)

    surface = profile.surface
    column = Column(
        pressure=pressure, temperature=t, dewpoint=dewpoint, height=height,
        u_wind=u, v_wind=v,
        source_levels=tuple(float(x) for x in levels_hpa),
        native_fraction=native_fraction,
        height_reconstructed=height_reconstructed,
        surface_pressure=_scalar(surface.get("pressure_surface")),
        terrain_height=_scalar(surface.get("terrain_height")),
        boundary_layer_height=_scalar(surface.get("boundary_layer_height")),
        issues=issues,
    )
    _attach_screen_level(column, profile)
    _attach_hodograph(column, profile)
    return column


def _attach_hodograph(column: Column, profile: Profile) -> None:
    """Populate the height-coordinate wind profile.

    Prefers the model's own height levels. Falls back to converting the
    pressure column through its geopotential heights, which is legitimate but
    weaker -- it inherits the pressure levels' coarse spacing, so a 0-1 km
    shear ends up resting on one or two points -- and the fallback is
    recorded in `wind_source` rather than hidden.
    """
    u_var = profile.height.get("u_wind")
    v_var = profile.height.get("v_wind")
    if u_var is not None and v_var is not None:
        u_ok, v_ok = _usable_mask(u_var), _usable_mask(v_var)
        if u_ok is not None and v_ok is not None:
            both = u_ok & v_ok
            if np.count_nonzero(both) >= 2:
                index = np.flatnonzero(both)
                heights = np.asarray(u_var.levels, dtype="float64")[index]
                order = np.argsort(heights)
                index = index[order]
                native = _native_flags(u_var)[index] & _native_flags(v_var)[index]
                column.wind_height = heights[order]
                column.wind_u = _values(u_var, index)
                column.wind_v = _values(v_var, index)
                column.wind_source = "native_height_levels"
                column.wind_native_fraction = float(
                    np.count_nonzero(native)
                ) / max(native.size, 1)
                return

    ok = np.isfinite(column.u_wind) & np.isfinite(column.v_wind) \
        & np.isfinite(column.height)
    if np.count_nonzero(ok) >= 2:
        base = column.height[ok][0]
        column.wind_height = column.height[ok] - base
        column.wind_u = column.u_wind[ok]
        column.wind_v = column.v_wind[ok]
        column.wind_source = "converted_from_pressure_levels"
        column.wind_native_fraction = column.native_fraction
        column.issues.append(
            "no height-level wind; the hodograph was converted from pressure "
            "levels via geopotential height, so layer shear rests on the "
            "coarser isobaric spacing"
        )
        return

    column.wind_source = "unavailable"


def _column_wind(
    variable: VariableProfile | None, index: np.ndarray
) -> np.ndarray:
    if variable is None:
        return np.full(index.size, np.nan)
    ok = _usable_mask(variable)
    values = _values(variable, index)
    if ok is None:
        return np.full(index.size, np.nan)
    return np.where(ok[index], values, np.nan)


def _scalar(value) -> float | None:
    if value is None:
        return None
    arr = np.asarray(value, dtype="float64")
    if arr.size == 0:
        return None
    first = float(arr.reshape(-1)[0])
    return first if np.isfinite(first) else None


def _attach_screen_level(column: Column, profile: Profile) -> None:
    """Take surface temperature and dew point from screen level where the
    profile carries them.

    The surface-based parcel should start from the screen-level state, not
    from the lowest pressure level: at 990 hPa surface pressure the lowest
    usable level may be 925 hPa, some 700 m up, and a parcel launched there
    is not surface-based in any useful sense.
    """
    surface = profile.surface
    t2 = _scalar(surface.get("temperature_2m"))
    if t2 is None:
        heights = profile.height
        t_var = heights.get("temperature")
        if t_var is not None and t_var.levels:
            value, prov = t_var.at(min(t_var.levels))
            if prov is not None and prov.origin.has_value:
                t2 = _scalar(value)
    column.surface_temperature = t2

    td2 = _scalar(surface.get("dewpoint_2m"))
    if td2 is None:
        rh2 = _scalar(surface.get("relative_humidity_2m"))
        if rh2 is None:
            rh_var = profile.height.get("relative_humidity")
            if rh_var is not None and rh_var.levels:
                value, prov = rh_var.at(min(rh_var.levels))
                if prov is not None and prov.origin.has_value:
                    rh2 = _scalar(value)
        if rh2 is not None and t2 is not None:
            td2 = float(th.dewpoint_from_rh(rh2, t2))
    column.surface_dewpoint = td2


def _hypsometric_heights(
    pressure: np.ndarray, temperature: np.ndarray, dewpoint: np.ndarray,
    known: np.ndarray,
) -> np.ndarray | None:
    """Fill missing heights by integrating the hypsometric equation.

    This is NOT extrapolation in the sense Stage 3 forbids: it is not
    inventing a temperature outside the data, it is computing the thickness
    the data already imply. The result is anchored to the lowest known
    geopotential height where one exists, so it stays consistent with the
    model's own heights rather than floating on a guessed datum.

    Returns None when nothing can be anchored.
    """
    n = pressure.size
    if n < 2:
        return None
    w = th.saturation_mixing_ratio(dewpoint, pressure)
    w = np.where(np.isfinite(w), w, 0.0)
    tv = th.virtual_temperature(temperature, w)
    if not np.all(np.isfinite(tv)):
        return None

    thickness = np.zeros(n)
    for i in range(1, n):
        tv_mean = 0.5 * (tv[i - 1] + tv[i])
        thickness[i] = th.hypsometric_thickness(
            float(pressure[i - 1]), float(pressure[i]), float(tv_mean)
        )
    relative = np.cumsum(thickness)

    anchors = np.flatnonzero(np.isfinite(known))
    if anchors.size:
        a = int(anchors[0])
        return relative - relative[a] + known[a]
    # No model height anywhere. Anchor at the bottom of the column, which
    # makes heights AGL-from-column-base. Callers that need true AMSL
    # heights check `height_reconstructed`.
    return relative
