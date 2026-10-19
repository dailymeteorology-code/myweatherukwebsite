"""Canonical TCM parameter vocabulary.

Providers speak different dialects: the Met Office calls it
`cape-mixed-layer-lowest-500m`, Open-Meteo calls it `cape`, ECMWF calls it
`cape`. TCM speaks exactly one name for each physical quantity, and every
provider adapter is responsible for translating into it.

A parameter that is not in this table cannot enter the system -- that is
deliberate. It stops a provider quietly introducing a near-synonym that the
blend engine then treats as a different variable.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ParamGroup(str, Enum):
    """Which adaptive blend a parameter feeds.

    TCM does not use one universal blend: large-scale forcing and
    convective-scale initiation are weighted differently.
    """

    SYNOPTIC = "synoptic"
    INSTABILITY = "instability"
    INITIATION = "initiation"
    ORGANISATION = "organisation"
    PRECIPITATION = "precipitation"
    LIGHTNING = "lightning"
    HAIL = "hail"
    WIND = "wind"
    FLOODING = "flooding"
    BASIC = "basic"


@dataclass(frozen=True, slots=True)
class ParamSpec:
    name: str
    units: str
    group: ParamGroup
    description: str
    # Accumulated/statistically-processed fields cannot be interpolated in
    # time the way instantaneous fields can.
    accumulation: bool = False
    # Conservative (area-weighted) regridding for fluxes and accumulations;
    # bilinear for smooth continuous fields.
    regrid_method: str = "bilinear"


def _p(name, units, group, description, accumulation=False, regrid="bilinear"):
    return ParamSpec(name, units, group, description, accumulation, regrid)


PARAMS: dict[str, ParamSpec] = {
    p.name: p
    for p in [
        # --- thermodynamics / instability ---------------------------------
        _p("cape_surface", "J/kg", ParamGroup.INSTABILITY,
           "Surface-based CAPE"),
        _p("cape_mixed_layer", "J/kg", ParamGroup.INSTABILITY,
           "Mixed-layer CAPE, lowest 500 m"),
        _p("cape_most_unstable", "J/kg", ParamGroup.INSTABILITY,
           "Most-unstable CAPE, below 500 hPa -- the parcel that matters for "
           "elevated and overnight convection"),
        _p("cin", "J/kg", ParamGroup.INITIATION,
           "Convective inhibition, surface parcel"),
        _p("cin_mixed_layer", "J/kg", ParamGroup.INITIATION,
           "Convective inhibition, mixed layer lowest 500 m"),
        _p("cin_most_unstable", "J/kg", ParamGroup.INITIATION,
           "Convective inhibition, most-unstable parcel below 500 hPa"),
        _p("lifted_index", "K", ParamGroup.INSTABILITY, "Lifted index"),
        _p("freezing_level_height", "m", ParamGroup.HAIL,
           "Height of the 0 C isotherm above ground"),

        # --- static geography (Stage 8) -------------------------------------
        # Time-invariant fields. Neither varies between cycles, so a stored
        # copy from any run is current.
        _p("terrain_height", "m", ParamGroup.BASIC,
           "Model orography. NOT a survey DEM: at 2 km, peaks are smoothed "
           "(Ben Nevis reads ~800 m). It is what the model's own wind field "
           "flowed over, which is what the terrain-flow diagnostics need"),
        # NEAREST, not bilinear. The Met Office ships this as a BINARY mask
        # despite the name, and interpolating a step function invents
        # partial-land cells along every coast -- cells that are neither
        # land nor sea and that the sea-breeze contrast would then average
        # into itself.
        _p("land_cover", "1", ParamGroup.BASIC,
           "Land-sea mask, 0-1 land fraction. The Met Office parameter is "
           "named land-cover but the GRIB is a land-sea mask",
           regrid="nearest"),

        # --- kinematics ----------------------------------------------------
        _p("wind_speed_10m", "m/s", ParamGroup.WIND, "10 m wind speed"),
        # Components, not just speed: a vector calculation -- upslope flow,
        # coastal convergence, the coast-normal wind -- needs to know which
        # way the air is going, and a speed cannot say.
        _p("u_wind_10m", "m/s", ParamGroup.WIND, "10 m eastward wind"),
        _p("v_wind_10m", "m/s", ParamGroup.WIND, "10 m northward wind"),
        _p("wind_direction_10m", "deg", ParamGroup.WIND, "10 m wind direction",
           regrid="nearest"),
        _p("wind_gust_10m", "m/s", ParamGroup.WIND, "10 m wind gust"),
        _p("shear_bulk_0_6km", "m/s", ParamGroup.ORGANISATION,
           "0-6 km bulk shear magnitude"),
        _p("shear_bulk_0_1km", "m/s", ParamGroup.ORGANISATION,
           "0-1 km bulk shear magnitude"),
        _p("srh_0_3km", "m2/s2", ParamGroup.ORGANISATION,
           "0-3 km storm-relative helicity"),
        _p("wind_speed_500", "m/s", ParamGroup.ORGANISATION,
           "500 hPa wind speed -- with the 10 m wind this gives bulk shear"),
        _p("wind_direction_500", "deg", ParamGroup.ORGANISATION,
           "500 hPa wind direction", regrid="nearest"),
        _p("lapse_rate_850_500", "K/km", ParamGroup.INSTABILITY,
           "Mid-level lapse rate between 850 and 500 hPa"),

        # --- surface / synoptic -------------------------------------------
        _p("temperature_2m", "K", ParamGroup.BASIC, "Screen temperature"),
        _p("temperature_surface", "K", ParamGroup.BASIC,
           "Surface (ground) temperature -- distinct from screen temperature"),
        _p("dewpoint_2m", "K", ParamGroup.BASIC, "Screen dewpoint"),
        _p("relative_humidity_2m", "%", ParamGroup.BASIC,
           "Screen relative humidity"),
        _p("pressure_msl", "Pa", ParamGroup.SYNOPTIC,
           "Mean-sea-level pressure"),
        _p("pressure_surface", "Pa", ParamGroup.SYNOPTIC, "Surface pressure"),
        _p("boundary_layer_height", "m", ParamGroup.INITIATION,
           "Boundary layer depth, from the model's own turbulence scheme"),
        _p("total_cloud_cover", "%", ParamGroup.BASIC,
           "Total cloud cover"),
        _p("geopotential_height_500", "m", ParamGroup.SYNOPTIC,
           "500 hPa geopotential height"),
        _p("temperature_500", "K", ParamGroup.INSTABILITY,
           "500 hPa temperature"),
        _p("temperature_850", "K", ParamGroup.INSTABILITY,
           "850 hPa temperature"),
        _p("dewpoint_850", "K", ParamGroup.INSTABILITY, "850 hPa dewpoint"),

        # --- precipitation -------------------------------------------------
        _p("precip_rate", "kg/m2/s", ParamGroup.PRECIPITATION,
           "Instantaneous precipitation rate", regrid="conservative"),
        _p("precip_rate_max_1h", "kg/m2/s", ParamGroup.PRECIPITATION,
           "Maximum precipitation rate in the preceding hour",
           accumulation=True, regrid="conservative"),
        _p("precip_accum_1h", "kg/m2", ParamGroup.PRECIPITATION,
           "Precipitation accumulated over the preceding hour",
           accumulation=True, regrid="conservative"),
        _p("snowfall_rate_water_eq", "kg/m2/s", ParamGroup.PRECIPITATION,
           "Snowfall rate, water equivalent", regrid="conservative"),
        _p("snow_depth_water_eq", "kg/m2", ParamGroup.PRECIPITATION,
           "Snow depth, water equivalent", regrid="conservative"),
        _p("snowfall_accum_1h_water_eq", "kg/m2", ParamGroup.PRECIPITATION,
           "Snowfall accumulated over the preceding hour, water equivalent",
           accumulation=True, regrid="conservative"),

        # --- hail -----------------------------------------------------------
        _p("hail_fall_rate", "kg/m2/s", ParamGroup.HAIL,
           "Instantaneous hail fall rate", regrid="conservative"),
        _p("hail_fall_rate_max_1h", "kg/m2/s", ParamGroup.HAIL,
           "Maximum hail fall rate in the preceding hour",
           accumulation=True, regrid="conservative"),

        _p("hail_accum_1h", "kg/m2", ParamGroup.HAIL,
           "Hail accumulation over the preceding hour",
           accumulation=True, regrid="conservative"),

        # --- large-scale (stratiform) precipitation --------------------------
        # Kept SEPARATE from precip_rate on purpose. "Large-scale" is the
        # resolved, non-convective part of the precipitation in a model that
        # parameterises convection, so on a showery day it can read near zero
        # while the convective scheme is producing the actual rain. Blending
        # it into precip_rate would let a global model quietly overwrite a
        # convection-permitting model's rainfall with a stratiform-only field.
        _p("large_scale_rain_rate", "kg/m2/s", ParamGroup.PRECIPITATION,
           "Large-scale (non-convective) rain rate", regrid="conservative"),
        _p("large_scale_rain_rate_max_1h", "kg/m2/s", ParamGroup.PRECIPITATION,
           "Maximum large-scale rain rate in the preceding hour",
           accumulation=True, regrid="conservative"),

        # --- lightning -------------------------------------------------------
        # PREDICTED lightning only. Observed strikes live in a separate store
        # and are never mixed into a forecast field.
        #
        # UNITS UNCONFIRMED. The Met Office ships this as local code 0/17/192
        # with no units in the GRIB, so the string below is substituted from
        # this table and `FieldMeta.extra.units_source` records that it was not
        # read from the data. Observed magnitudes in a quiet regime are of
        # order 1e-7, which is consistent with "no lightning" but does not
        # confirm the scaling. Calibrate against a known thunderstorm case, and
        # against observed strike counts, before quoting an absolute flash rate
        # to a user. Relative and probabilistic use is unaffected.
        _p("lightning_flash_density_1h", "flashes/km2/h", ParamGroup.LIGHTNING,
           "Forecast lightning flash density, preceding hour (units unconfirmed)",
           accumulation=True, regrid="conservative"),
    ]
}


# ---------------------------------------------------------------------------
# Profile parameters, registered per level
# ---------------------------------------------------------------------------
#
# The orders carry the same handful of variables on nine isobaric and ten
# height levels. Each (variable, level) is its OWN canonical parameter --
# `temperature_850` is not `temperature` with a note attached -- so each needs
# a ParamSpec, and writing ~170 by hand would be a transcription exercise with
# no upside.
#
# The LEVELS live here, not in `grib/decode.py`, because the import order runs
# params -> grid -> decode: decode may read from params, never the reverse.
# decode adds the verified GRIB codes on top of this list.
#
# Levels confirmed present in the live Met Office orders on 2026-08-30.
# Adding a level to an order needs only these tuples.
ORDER_PRESSURE_LEVELS_HPA: tuple[int, ...] = (
    1000, 925, 850, 700, 500, 400, 300, 250, 200,
)
ORDER_HEIGHT_LEVELS_M: tuple[int, ...] = (
    50, 100, 250, 500, 1000, 2000, 3000, 4000, 5000, 6000,
)

#: Profile stems that also exist on height levels.
PROFILE_HEIGHT_STEMS: tuple[str, ...] = (
    "temperature", "relative_humidity", "u_wind", "v_wind", "wind_speed",
    "vertical_velocity", "cloud_water_mixing_ratio",
)

_PROFILE_GROUPS: dict[str, ParamGroup] = {
    "temperature": ParamGroup.INSTABILITY,
    "relative_humidity": ParamGroup.INSTABILITY,
    "geopotential_height": ParamGroup.SYNOPTIC,
    "u_wind": ParamGroup.ORGANISATION,
    "v_wind": ParamGroup.ORGANISATION,
    "wind_speed": ParamGroup.ORGANISATION,
    "wind_direction": ParamGroup.ORGANISATION,
    "vertical_velocity": ParamGroup.INITIATION,
    "cloud_water_mixing_ratio": ParamGroup.PRECIPITATION,
    "wet_bulb_potential_temperature": ParamGroup.INSTABILITY,
}

_PROFILE_UNITS: dict[str, str] = {
    "temperature": "K",
    "relative_humidity": "%",
    "geopotential_height": "gpm",
    "u_wind": "m/s",
    "v_wind": "m/s",
    "wind_speed": "m/s",
    "wind_direction": "degrees",
    "vertical_velocity": "m/s",
    "cloud_water_mixing_ratio": "kg/kg",
    "wet_bulb_potential_temperature": "K",
}


def _register_profile_params() -> int:
    """One ParamSpec per (profile variable, level)."""
    added = 0
    for stem in _PROFILE_UNITS:
        units = _PROFILE_UNITS[stem]
        group = _PROFILE_GROUPS[stem]
        pretty = stem.replace("_", " ")
        for hpa in ORDER_PRESSURE_LEVELS_HPA:
            name = f"{stem}_{hpa}"
            if name in PARAMS:
                continue
            PARAMS[name] = _p(name, units, group, f"{pretty} at {hpa} hPa")
            added += 1
        if stem not in PROFILE_HEIGHT_STEMS:
            continue
        for metres in ORDER_HEIGHT_LEVELS_M:
            name = f"{stem}_agl_{metres}"
            if name in PARAMS:
                continue
            PARAMS[name] = _p(
                name, units, group, f"{pretty} at {metres} m above ground"
            )
            added += 1
    return added


PROFILE_PARAMS_ADDED = _register_profile_params()


def get(name: str) -> ParamSpec:
    try:
        return PARAMS[name]
    except KeyError:
        raise KeyError(
            f"{name!r} is not a canonical TCM parameter. Add it to "
            "app/params.py rather than passing a provider-specific name."
        ) from None


def in_group(group: ParamGroup) -> list[ParamSpec]:
    return [p for p in PARAMS.values() if p.group is group]
