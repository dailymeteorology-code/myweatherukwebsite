"""The canonical variable registry: provider names in, TCM names out.

Stage 2. This module knows NOTHING about forecasting. It answers one
question -- "what is this field, in TCM's own vocabulary?" -- and refuses to
answer when it does not know.

WHY THE OLD MAP COULD NOT SURVIVE THE NEW ORDERS
------------------------------------------------
`providers/metoffice/datahub.py` maps a Met Office parameter name straight to
a canonical name with a flat dict, plus a two-entry override table for the
cases where the same name means different things on different surfaces.

That worked while the orders were almost entirely single-level. It cannot
work now. The current UK order carries `isbl temperature` on NINE pressure
levels and `agl temperature` on NINE height levels; a name-only map sends all
eighteen to the same canonical name, and whichever is decoded last wins. The
level is not decoration here -- it is part of the field's identity.

So the registry is keyed by the full triple the provider actually gives us:

    (surfaceId, provider parameter name, level)  ->  CanonicalField

and the level is carried through into the canonical name, matching the
convention already in `params.py`: `temperature_850`, `wind_speed_500`.

WHAT IT REFUSES TO DO
---------------------
* It never guesses. An unmapped triple returns None, and the caller records
  the field as unrecognised rather than storing it under a plausible name.
* It never converts units silently. `native_units` travels alongside
  `units`, and a conversion is declared as data, not applied in a hidden
  branch somewhere downstream.
* It never merges fields whose physical definitions differ. Convective rain
  rate and large-scale rain rate are different quantities and get different
  canonical names, even though both are "rain rate"; an accumulation is
  never given the same name as a rate.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field as dc_field
from enum import Enum


class LevelType(str, Enum):
    """The vertical coordinate a field lives on.

    Kept distinct from the level VALUE because 850 hPa and 850 m are both
    "850" and are nowhere near each other.
    """

    SURFACE = "surface"          # ground, screen level, single-level
    ISOBARIC = "isobaric"        # pressure levels, stored in hPa
    HEIGHT_AGL = "agl"           # metres above ground level
    HEIGHT_ASL = "asl"           # metres above sea level
    MEAN_SEA = "meansea"
    COLUMN = "column"            # whole-atmosphere integrals
    BOUNDARY = "boundary"        # PBL top, inflow layer, cloud base, isotherms


class Semantics(str, Enum):
    """How a value relates to time. Never normalise across these.

    A 1-hour accumulation and an instantaneous rate describe the same
    process and are not interchangeable: interpolating an accumulation in
    time is meaningless, and comparing a rate against an accumulation
    silently compares different units of different things.
    """

    INSTANT = "instantaneous"
    ACCUMULATION = "accumulation"
    MAXIMUM = "maximum_over_period"
    MEAN = "mean_over_period"


@dataclass(frozen=True, slots=True)
class CanonicalField:
    """One identified field. Native identity is preserved, never discarded."""

    canonical: str
    units: str
    level_type: LevelType
    level: float | None
    semantics: Semantics = Semantics.INSTANT
    #: Averaging/accumulation window in hours, where the name declares one.
    period_hours: int | None = None
    #: Exactly what the provider called it, kept so a field can always be
    #: traced back to the request that produced it.
    native_surface: str = ""
    native_parameter: str = ""
    native_level: str | None = None
    native_units: str = ""
    #: Set when the canonical form is not the provider's form. Stage 2 only
    #: DECLARES conversions; applying them belongs to the normalisation step
    #: so that the raw layer stays exactly what the provider sent.
    conversion: str = ""
    notes: str = ""

    @property
    def is_profile(self) -> bool:
        return self.level_type in (LevelType.ISOBARIC, LevelType.HEIGHT_AGL)


# ---------------------------------------------------------------------------
# Level handling
# ---------------------------------------------------------------------------
#
# The DataHub gives pressure levels in PASCALS in the fileId ("85000") and the
# `levels` array. TCM names them in hectopascals, matching `params.py`
# (`temperature_850`). Height levels arrive in metres and stay in metres.
#
# 1.5 m and 10 m are the screen and anemometer levels. They are named `_2m`
# and `_10m` because that is what every downstream consumer already calls
# them -- but `native_level` still records 1.5, so nothing pretends the
# Met Office measured at 2 m.

SCREEN_LEVEL_M = 1.5
ANEMOMETER_LEVEL_M = 10.0


def pascals_to_hpa(level: str | float) -> float:
    return float(level) / 100.0


def _level_suffix_isobaric(level_pa: str | float) -> str:
    hpa = pascals_to_hpa(level_pa)
    return f"{int(hpa)}" if hpa == int(hpa) else f"{hpa:g}"


def _level_suffix_agl(level_m: str | float) -> str:
    metres = float(level_m)
    if metres == SCREEN_LEVEL_M:
        return "2m"
    if metres == ANEMOMETER_LEVEL_M:
        return "10m"
    return f"agl_{int(metres)}" if metres == int(metres) else f"agl_{metres:g}"


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------
#
# A rule matches a (surfaceId, parameter) pair and says how to build the
# canonical field. `stem` is the canonical name for a single-level field, or
# the prefix a level suffix is appended to for a profile field.


@dataclass(frozen=True, slots=True)
class _Rule:
    stem: str
    units: str
    level_type: LevelType
    semantics: Semantics = Semantics.INSTANT
    period_hours: int | None = None
    #: Screen/anemometer-level fields keep their established flat names
    #: (temperature_2m) rather than gaining a level suffix.
    flat_at: tuple[float, ...] = ()
    conversion: str = ""
    notes: str = ""


#: (surfaceId, Met Office parameter) -> rule.
#:
#: Verified against the live catalogues of orders mo-uk, mo-global and
#: mo-mogrepsg on 2026-08-30. Anything not listed here is deliberately
#: unmapped: the ingester records it as unrecognised rather than inventing a
#: name for a field nobody has checked the meaning of.
RULES: dict[tuple[str, str], _Rule] = {}


def _rule(surface: str, parameter: str, rule: _Rule) -> None:
    RULES[(surface, parameter)] = rule


# --- isobaric profile ------------------------------------------------------
# Nine levels in the current orders: 200, 250, 300, 400, 500, 700, 850, 925,
# 1000 hPa. The rule is level-agnostic; adding a level to the order needs no
# code change here.
_rule("isbl", "temperature", _Rule("temperature", "K", LevelType.ISOBARIC))
_rule("isbl", "relative-humidity", _Rule("relative_humidity", "%", LevelType.ISOBARIC))
_rule("isbl", "geopotential-height", _Rule("geopotential_height", "m", LevelType.ISOBARIC))
_rule("isbl", "u-component-of-wind", _Rule("u_wind", "m/s", LevelType.ISOBARIC))
_rule("isbl", "v-component-of-wind", _Rule("v_wind", "m/s", LevelType.ISOBARIC))
_rule("isbl", "wind-speed", _Rule("wind_speed", "m/s", LevelType.ISOBARIC))
_rule("isbl", "wind-direction-from-which-blowing",
      _Rule("wind_direction", "degrees", LevelType.ISOBARIC,
            notes="Direction the wind blows FROM, meteorological convention."))
_rule("isbl", "vertical-velocity-geometric",
      _Rule("vertical_velocity", "m/s", LevelType.ISOBARIC,
            notes="GEOMETRIC vertical velocity (w), not omega. Do not compare "
                  "with a Pa/s omega field without converting."))
_rule("isbl", "wet-bulb-potential-temperature",
      _Rule("wet_bulb_potential_temperature", "K", LevelType.ISOBARIC))
_rule("isbl", "cloud-water-mixing-ratio",
      _Rule("cloud_water_mixing_ratio", "kg/kg", LevelType.ISOBARIC))

# --- height-above-ground profile ------------------------------------------
# 10 m to 6000 m for wind; 1.5 m to 5000 m for temperature and humidity.
# This is what makes a true 0-6 km hodograph possible.
_rule("agl", "temperature",
      _Rule("temperature", "K", LevelType.HEIGHT_AGL, flat_at=(SCREEN_LEVEL_M,)))
_rule("agl", "dewpoint-temperature",
      _Rule("dewpoint", "K", LevelType.HEIGHT_AGL, flat_at=(SCREEN_LEVEL_M,)))
_rule("agl", "relative-humidity",
      _Rule("relative_humidity", "%", LevelType.HEIGHT_AGL, flat_at=(SCREEN_LEVEL_M,)))
_rule("agl", "specific-humidity",
      _Rule("specific_humidity", "kg/kg", LevelType.HEIGHT_AGL, flat_at=(SCREEN_LEVEL_M,)))
_rule("agl", "u-component-of-wind",
      _Rule("u_wind", "m/s", LevelType.HEIGHT_AGL, flat_at=(ANEMOMETER_LEVEL_M,)))
_rule("agl", "v-component-of-wind",
      _Rule("v_wind", "m/s", LevelType.HEIGHT_AGL, flat_at=(ANEMOMETER_LEVEL_M,)))
_rule("agl", "wind-speed",
      _Rule("wind_speed", "m/s", LevelType.HEIGHT_AGL, flat_at=(ANEMOMETER_LEVEL_M,)))
_rule("agl", "vertical-velocity-geometric",
      _Rule("vertical_velocity", "m/s", LevelType.HEIGHT_AGL))
_rule("agl", "cloud-water-mixing-ratio",
      _Rule("cloud_water_mixing_ratio", "kg/kg", LevelType.HEIGHT_AGL))
_rule("agl", "cloud-ice-mixing-ratio",
      _Rule("cloud_ice_mixing_ratio", "kg/kg", LevelType.HEIGHT_AGL))
_rule("agl", "temperature-max-1h",
      _Rule("temperature", "K", LevelType.HEIGHT_AGL, Semantics.MAXIMUM, 1,
            flat_at=(SCREEN_LEVEL_M,)))
_rule("agl", "wind-speed-gust-max-1h",
      _Rule("wind_gust", "m/s", LevelType.HEIGHT_AGL, Semantics.MAXIMUM, 1,
            flat_at=(ANEMOMETER_LEVEL_M,)))

# The "-surface-adjusted" family is a DIFFERENT quantity from the plain 10 m
# wind: it is post-processed for local roughness. Naming them the same would
# make the choice of source silently change the value.
_rule("agl", "wind-speed-surface-adjusted",
      _Rule("wind_speed_surface_adjusted", "m/s", LevelType.HEIGHT_AGL,
            flat_at=(ANEMOMETER_LEVEL_M,),
            notes="Roughness-adjusted. NOT interchangeable with wind_speed_10m."))
_rule("agl", "u-component-of-wind-surface-adjusted",
      _Rule("u_wind_surface_adjusted", "m/s", LevelType.HEIGHT_AGL,
            flat_at=(ANEMOMETER_LEVEL_M,)))
_rule("agl", "v-component-of-wind-surface-adjusted",
      _Rule("v_wind_surface_adjusted", "m/s", LevelType.HEIGHT_AGL,
            flat_at=(ANEMOMETER_LEVEL_M,)))
_rule("agl", "wind-direction-from-which-blowing-surface-adjusted",
      _Rule("wind_direction_surface_adjusted", "degrees", LevelType.HEIGHT_AGL,
            flat_at=(ANEMOMETER_LEVEL_M,)))

# --- single-level instability ---------------------------------------------
_rule("ground", "cape-surface", _Rule("cape_surface", "J/kg", LevelType.SURFACE))
_rule("ground", "cape-mixed-layer-lowest-500m",
      _Rule("cape_mixed_layer", "J/kg", LevelType.SURFACE,
            notes="Parcel mixed over the lowest 500 m."))
_rule("ground", "cape-most-unstable-below-500hpa",
      _Rule("cape_most_unstable", "J/kg", LevelType.SURFACE,
            notes="Most unstable parcel found below 500 hPa."))
_rule("ground", "cin-surface", _Rule("cin", "J/kg", LevelType.SURFACE))
_rule("ground", "cin-mixed-layer-lowest-500m",
      _Rule("cin_mixed_layer", "J/kg", LevelType.SURFACE))
_rule("ground", "cin-most-unstable-below-500hpa",
      _Rule("cin_most_unstable", "J/kg", LevelType.SURFACE))

# --- precipitation: rate, accumulation and type are all distinct ----------
_rule("ground", "rain-precipitation-rate",
      _Rule("precip_rate", "kg/m2/s", LevelType.SURFACE))
_rule("ground", "rain-precipitation-rate-max-1h",
      _Rule("precip_rate_max_1h", "kg/m2/s", LevelType.SURFACE, Semantics.MAXIMUM, 1))
_rule("ground", "rainfall-accumulation-1h",
      _Rule("precip_accum_1h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 1))
_rule("ground", "rainfall-accumulation-3h",
      _Rule("precip_accum_3h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 3))
_rule("ground", "rainfall-accumulation-6h",
      _Rule("precip_accum_6h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 6))
_rule("ground", "precipitation-accumulation-1h",
      _Rule("total_precip_accum_1h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 1,
            notes="TOTAL precipitation including snow; rainfall-accumulation-1h "
                  "is rain only. Different quantities."))
# Convective and large-scale rain are produced by different parts of the model
# and must never be merged into one 'rain rate'.
_rule("ground", "convective-rain-rate",
      _Rule("convective_rain_rate", "kg/m2/s", LevelType.SURFACE))
_rule("ground", "convective-rain-rate-max-1h",
      _Rule("convective_rain_rate_max_1h", "kg/m2/s", LevelType.SURFACE, Semantics.MAXIMUM, 1))
_rule("ground", "convective-rain-rate-mean-1h",
      _Rule("convective_rain_rate_mean_1h", "kg/m2/s", LevelType.SURFACE, Semantics.MEAN, 1))
_rule("ground", "convective-rain-rate-mean-3h",
      _Rule("convective_rain_rate_mean_3h", "kg/m2/s", LevelType.SURFACE, Semantics.MEAN, 3))
_rule("ground", "convective-rain-rate-mean-6h",
      _Rule("convective_rain_rate_mean_6h", "kg/m2/s", LevelType.SURFACE, Semantics.MEAN, 6))
_rule("ground", "convective-rain-accumulation-1h",
      _Rule("convective_rain_accum_1h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 1))
_rule("ground", "convective-rain-accumulation-6h",
      _Rule("convective_rain_accum_6h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 6))
_rule("ground", "large-scale-rain-rate",
      _Rule("large_scale_rain_rate", "kg/m2/s", LevelType.SURFACE))
_rule("ground", "large-scale-rain-rate-max-1h",
      _Rule("large_scale_rain_rate_max_1h", "kg/m2/s", LevelType.SURFACE, Semantics.MAXIMUM, 1))
_rule("ground", "large-scale-rain-rate-max-3h",
      _Rule("large_scale_rain_rate_max_3h", "kg/m2/s", LevelType.SURFACE, Semantics.MAXIMUM, 3))

# --- hail ------------------------------------------------------------------
_rule("ground", "hail-fall-rate", _Rule("hail_fall_rate", "kg/m2/s", LevelType.SURFACE))
_rule("ground", "hail-fall-rate-max-1h",
      _Rule("hail_fall_rate_max_1h", "kg/m2/s", LevelType.SURFACE, Semantics.MAXIMUM, 1))
_rule("ground", "hail-accumulation-1h",
      _Rule("hail_accum_1h", "kg/m2", LevelType.SURFACE, Semantics.ACCUMULATION, 1))

# --- surface state ---------------------------------------------------------
_rule("ground", "temperature", _Rule("temperature_surface", "K", LevelType.SURFACE))
_rule("ground", "pressure", _Rule("pressure_surface", "Pa", LevelType.SURFACE))
_rule("ground", "land-cover",
      _Rule("land_cover", "1", LevelType.SURFACE,
            notes="Static field. Land/sea fraction."))
_rule("ground", "model-terrain-height",
      _Rule("terrain_height", "m", LevelType.SURFACE,
            notes="Static field. The MODEL's orography, not a survey DEM -- "
                  "it is what the model actually saw."))
_rule("ground", "roughness-length", _Rule("roughness_length", "m", LevelType.SURFACE))
_rule("meansea", "pressure-reduced-to-msl",
      _Rule("pressure_msl", "Pa", LevelType.MEAN_SEA))

# --- radiation and fluxes --------------------------------------------------
_rule("ground", "downward-short-wave-radiation-flux",
      _Rule("sw_down", "W/m2", LevelType.SURFACE))
_rule("ground", "diffuse-short-wave-radiation-flux",
      _Rule("sw_diffuse", "W/m2", LevelType.SURFACE))
_rule("ground", "direct-short-wave-radiation-flux",
      _Rule("sw_direct", "W/m2", LevelType.SURFACE))
_rule("ground", "net-short-wave-radiation-flux",
      _Rule("sw_net", "W/m2", LevelType.SURFACE))
_rule("ground", "downward-long-wave-radiation-flux",
      _Rule("lw_down", "W/m2", LevelType.SURFACE))
_rule("ground", "sensible-heat-net-flux",
      _Rule("sensible_heat_flux", "W/m2", LevelType.SURFACE))
_rule("ground", "latent-heat-net-flux-mean-1h",
      _Rule("latent_heat_flux_mean_1h", "W/m2", LevelType.SURFACE, Semantics.MEAN, 1))
_rule("atmospheretop", "upward-long-wave-radiation-flux",
      _Rule("olr", "W/m2", LevelType.COLUMN,
            notes="Outgoing longwave radiation at the model top."))

# --- column and boundary surfaces -----------------------------------------
_rule("atmosphere", "total-cloud-cover", _Rule("total_cloud_cover", "%", LevelType.COLUMN))
_rule("atmosphere", "convective-cloud-cover",
      _Rule("convective_cloud_cover", "%", LevelType.COLUMN))
_rule("atmosphere", "total-lightning-flash-density-1h",
      _Rule("lightning_flash_density_1h", "flashes/km2/h", LevelType.COLUMN,
            Semantics.ACCUMULATION, 1))
_rule("mixing", "planetary-boundary-layer-height",
      _Rule("boundary_layer_height", "m", LevelType.BOUNDARY))
_rule("wbzeroisotherm", "geometric-altitude-asl",
      _Rule("wet_bulb_zero_height", "m", LevelType.BOUNDARY,
            notes="Height of the wet-bulb 0 C isotherm above sea level."))
_rule("zeroisotherm", "geopotential-height",
      _Rule("freezing_level_height", "m", LevelType.BOUNDARY,
            notes="GEOPOTENTIAL height of the 0 C isotherm. The global order "
                  "ships the GEOMETRIC form; they differ by ~0.3% at 3 km."))
_rule("zeroisotherm", "geometric-altitude-asl",
      _Rule("freezing_level_height", "m", LevelType.BOUNDARY))
_rule("effinflowlayerbase", "geometric-altitude-asl",
      _Rule("effective_inflow_base", "m", LevelType.BOUNDARY))
_rule("effinflowlayertop", "geometric-altitude-asl",
      _Rule("effective_inflow_top", "m", LevelType.BOUNDARY))
_rule("convectivecloudtop", "pressure",
      _Rule("convective_cloud_top_pressure", "Pa", LevelType.BOUNDARY))
_rule("mostunstcapeequil", "geometric-altitude-asl",
      _Rule("most_unstable_equilibrium_level", "m", LevelType.BOUNDARY,
            notes="Equilibrium level of the most unstable parcel."))
_rule("mixedlayercapeequil", "geometric-altitude-asl",
      _Rule("mixed_layer_equilibrium_level", "m", LevelType.BOUNDARY,
            notes="Equilibrium level of the mixed-layer parcel."))
_rule("mudl", "geometric-altitude-asl",
      _Rule("most_unstable_parcel_height", "m", LevelType.BOUNDARY,
            notes="Height of the most-unstable displacement level -- where "
                  "the parcel the MU fields describe actually starts. The "
                  "Met Office abbreviation is 'mudl'; the expansion here is "
                  "inferred from context and has not been confirmed against "
                  "their documentation."))
_rule("zeroisotherm", "pressure",
      _Rule("freezing_level_pressure", "Pa", LevelType.BOUNDARY,
            notes="The 0 C isotherm expressed as a PRESSURE, not a height. "
                  "Not interchangeable with freezing_level_height."))
_rule("ground", "total-precipitation-rate",
      _Rule("total_precip_rate", "kg/m2/s", LevelType.SURFACE,
            notes="TOTAL precipitation rate including frozen types; "
                  "precip_rate is rain only."))
_rule("isbl", "cloud-ice-mixing-ratio",
      _Rule("cloud_ice_mixing_ratio", "kg/kg", LevelType.ISOBARIC))
# The global order ships an instantaneous gust as well as the 1-hour maximum.
# They are different quantities and must not share a name.
_rule("agl", "wind-speed-gust",
      _Rule("wind_gust", "m/s", LevelType.HEIGHT_AGL,
            flat_at=(ANEMOMETER_LEVEL_M,),
            notes="Instantaneous gust. wind-speed-gust-max-1h is the hourly "
                  "maximum and is a different field."))

# Cloud base is delivered per cloud-cover threshold (31.25%, 56.25%), so the
# threshold is part of the field's identity and goes into the name.
_rule("cloudbaseforcloudcover", "geometric-height-agl",
      _Rule("cloud_base_agl", "m", LevelType.BOUNDARY))
_rule("cloudbaseforcloudcover", "geometric-altitude-asl",
      _Rule("cloud_base_asl", "m", LevelType.BOUNDARY))


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

_CLOUD_BASE_SURFACES = {"cloudbaseforcloudcover"}


def identify(
    surface_id: str,
    parameter: str,
    level: str | float | None = None,
    native_units: str = "",
) -> CanonicalField | None:
    """Identify one provider field, or return None if it is not recognised.

    `level` is the provider's own level string: pascals for `isbl`, metres
    for `agl`, and the cloud-cover percentage for `cloudbaseforcloudcover`.
    """
    rule = RULES.get((surface_id, parameter))
    if rule is None:
        return None

    level_value: float | None = None
    name = rule.stem

    if rule.level_type is LevelType.ISOBARIC:
        if level is None:
            return None          # an isobaric field without a level is unusable
        level_value = pascals_to_hpa(level)
        name = f"{rule.stem}_{_level_suffix_isobaric(level)}"

    elif rule.level_type is LevelType.HEIGHT_AGL:
        if level is None:
            return None
        level_value = float(level)
        if level_value in rule.flat_at:
            # Screen and anemometer levels keep the established flat names so
            # existing consumers of temperature_2m / wind_speed_10m still work.
            suffix = "2m" if level_value == SCREEN_LEVEL_M else "10m"
            name = f"{rule.stem}_{suffix}"
        else:
            name = f"{rule.stem}_{_level_suffix_agl(level_value)}"

    elif surface_id in _CLOUD_BASE_SURFACES and level is not None:
        # The threshold is not a height; it identifies WHICH cloud base.
        level_value = float(level)
        name = f"{rule.stem}_{str(level).replace('.', 'p')}"

    return CanonicalField(
        canonical=name,
        units=rule.units,
        level_type=rule.level_type,
        level=level_value,
        semantics=rule.semantics,
        period_hours=rule.period_hours,
        native_surface=surface_id,
        native_parameter=parameter,
        native_level=None if level is None else str(level),
        native_units=native_units or rule.units,
        conversion=rule.conversion,
        notes=rule.notes,
    )


def is_known(surface_id: str, parameter: str) -> bool:
    return (surface_id, parameter) in RULES


def known_pairs() -> list[tuple[str, str]]:
    return sorted(RULES)


def expand(surface_id: str, parameter: str, levels: list[str]) -> list[CanonicalField]:
    """Every canonical field one catalogue entry produces.

    A single `isbl temperature` entry with nine levels is nine fields, and
    the ingester needs all nine names before it fetches anything.
    """
    if not levels:
        got = identify(surface_id, parameter)
        return [got] if got else []
    out = []
    for lv in levels:
        got = identify(surface_id, parameter, lv)
        if got:
            out.append(got)
    return out
