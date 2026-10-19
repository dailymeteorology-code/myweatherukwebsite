"""The model registry.

One table, one source of truth, for what each model actually is. The blend
engine, the provider adapters and the UI all read resolution and domain from
here -- nothing hardcodes "2 km" anywhere else.

Two resolutions are recorded per model, and the difference matters:

  model_native_resolution_m
      the resolution the modelling centre runs the model at.

  delivered_resolution_m
      the resolution of the product WE can actually retrieve.

For UKV via DataHub these are both 2 km. For ECMWF IFS HRES they are NOT:
the model runs at ~9 km, but the open feed we are legally entitled to is
0.25 degrees, roughly 25 km. TCM treats `delivered_resolution_m` as the truth
for weighting and labelling, because that is the information we hold. Quoting
9 km for a field we received at 25 km would be exactly the lie that
`FieldMeta` exists to prevent.

Domains matter too. AROME France HD is a superb 1.5 km model that barely
touches the UK. A model must never receive blend weight outside its domain,
so `domain` is enforced by the blend engine, not left to judgement.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .crs import UK_LAEA_PROJ, WGS84
from .params import ParamGroup


class Centre(str, Enum):
    METOFFICE = "Met Office"
    METEO_FRANCE = "Meteo-France"
    DWD = "DWD"
    ECMWF = "ECMWF"


@dataclass(frozen=True, slots=True)
class Domain:
    """Model domain as a lon/lat bounding box, plus a coverage note."""

    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float
    note: str = ""

    def contains(self, lon: float, lat: float) -> bool:
        return (
            self.lon_min <= lon <= self.lon_max
            and self.lat_min <= lat <= self.lat_max
        )

    def covers_uk_ireland(self) -> bool:
        return self.contains(-10.5, 50.0) and self.contains(1.8, 59.0)


@dataclass(frozen=True, slots=True)
class ModelSpec:
    id: str
    display_name: str
    centre: Centre
    provider: str                       # which adapter retrieves it

    model_native_resolution_m: float    # what the centre runs
    delivered_resolution_m: float       # what we can actually retrieve
    grid: str
    projection: str

    domain: Domain
    cycles_utc: tuple[int, ...]         # run hours
    max_forecast_hour: int
    forecast_step_hours: int = 1

    # Ensemble
    n_members: int = 0                  # 0 = deterministic only
    has_control: bool = False

    # Which blend groups this model is a credible contributor to.
    strengths: tuple[ParamGroup, ...] = ()
    # Canonical parameters this model can supply, filled per deployment.
    parameters: tuple[str, ...] = ()
    notes: str = ""

    @property
    def is_ensemble(self) -> bool:
        return self.n_members > 0

    @property
    def is_provisioned(self) -> bool:
        """True when this model can actually deliver data today.

        A registry entry with no parameters is a declared intention, not a
        usable source: no adapter retrieves it and nothing can be ingested.
        Counting such an entry as coverage would let the horizon claim a
        resolution the platform cannot produce.
        """
        return bool(self.parameters)

    @property
    def resolution_km(self) -> float:
        return self.delivered_resolution_m / 1000.0

    @property
    def resolution_is_degraded(self) -> bool:
        """True when the feed is coarser than the model itself."""
        return self.delivered_resolution_m > self.model_native_resolution_m * 1.05

    @property
    def resolution_label(self) -> str:
        if not self.resolution_is_degraded:
            return f"{self.resolution_km:g} km"
        native_km = self.model_native_resolution_m / 1000.0
        return (
            f"{self.resolution_km:g} km delivered "
            f"(model runs at {native_km:g} km)"
        )


# --------------------------------------------------------------------------
# UK and Ireland analysis region. Everything TCM produces is clipped to this.
# --------------------------------------------------------------------------
UK_IRELAND = Domain(-11.0, 49.5, 2.5, 61.0, "TCM analysis region")


# --------------------------------------------------------------------------
# Open-Meteo is a POINT API. TCM samples a regular lat/lon mesh and
# interpolates; the mesh, not the modelling centre's headline figure, is what
# limits the data we hold. Sampling a 7 km model on a 0.5 degree mesh gives
# ~56 km samples of a 7 km model, so `delivered_resolution_m` for every
# Open-Meteo model is max(model native, mesh spacing).
#
# The mesh is set by what the FREE Open-Meteo tier can actually serve. Its
# quota is weighted by locations x variables x days, and a 0.25 degree mesh
# (2,530 points) for four models and seventeen variables exhausts the hourly
# allowance part-way through a single cube. 0.5 degrees completes. A
# commercial key or a self-hosted Open-Meteo instance lifts this, and the
# spacing is a one-line change -- the recorded resolution follows it
# automatically through `_sampled_resolution`.
#
# These models earn their place on days 2-4, where what matters is the
# convective ENVIRONMENT -- instability, shear, lapse rates, forcing -- which
# are smooth fields that survive coarse sampling. Storm-scale detail at day 1
# comes from UKV and MOGREPS-UK at 2 km, never from here.
OPEN_METEO_SAMPLE_SPACING_DEG = 0.5
OPEN_METEO_SAMPLE_RESOLUTION_M = OPEN_METEO_SAMPLE_SPACING_DEG * 111_320.0


def _sampled_resolution(model_native_m: float) -> float:
    """What we actually hold after point sampling."""
    return max(model_native_m, OPEN_METEO_SAMPLE_RESOLUTION_M)


#: Variables every Open-Meteo model in the blend supplies. Verified live on
#: 2026-08-28 by requesting all four models in one call and checking which
#: series came back non-null. Availability is NOT uniform, and the exceptions
#: are declared per model rather than assumed:
#:
#:   freezing_level_height   ICON-EU only
#:   convective_inhibition   ICON-EU and UKMO Global only
#:   lifted_index            none of them -- do not add it
#:   boundary_layer_height   none of them
OPEN_METEO_BASE_PARAMS = (
    "temperature_2m", "dewpoint_2m", "relative_humidity_2m",
    "pressure_msl", "pressure_surface", "total_cloud_cover",
    "wind_speed_10m", "wind_direction_10m", "wind_gust_10m",
    "precip_accum_1h",
    "cape_surface",
    # Storm-organisation ingredients: 500 hPa wind gives bulk shear against
    # the 10 m wind, and the 850/500 temperatures give the mid-level lapse
    # rate. These are what make a 4-day convective outlook possible at all.
    "wind_speed_500", "wind_direction_500",
    "temperature_500", "temperature_850", "dewpoint_850",
    "geopotential_height_500",
)


MODELS: dict[str, ModelSpec] = {}


def _reg(spec: ModelSpec) -> ModelSpec:
    MODELS[spec.id] = spec
    return spec


# --- 1. Met Office UKV ----------------------------------------------------
# Confirmed live from the DataHub order: GRIB2 grid template 140 (Lambert
# azimuthal equal area), 290,745 points = 455 x 639 at 2 km, covering
# 910 km x 1277 km ("GB and Eire"). This is genuine native 2 km.
UKV = _reg(ModelSpec(
    id="ukv",
    display_name="Met Office UKV",
    centre=Centre.METOFFICE,
    provider="metoffice_datahub",
    model_native_resolution_m=2000.0,
    delivered_resolution_m=2000.0,
    grid="455x639 Lambert azimuthal equal area, GB and Eire",
    projection=UK_LAEA_PROJ,
    domain=Domain(-12.0, 48.5, 5.0, 61.5, "GB and Eire DataHub region"),
    cycles_utc=(0, 12),
    # The order runs hourly to T+54 and 3-hourly to T+120. Ingest walks the
    # order's own timesteps, so this is the horizon, not the step pattern.
    max_forecast_hour=120,
    forecast_step_hours=1,
    strengths=(
        ParamGroup.INITIATION, ParamGroup.PRECIPITATION, ParamGroup.HAIL,
        ParamGroup.INSTABILITY,
    ),
    parameters=(
        "temperature_2m", "temperature_surface", "dewpoint_2m",
        "wind_speed_10m", "wind_direction_10m", "total_cloud_cover",
        "pressure_msl", "pressure_surface", "freezing_level_height",
        "precip_rate", "precip_rate_max_1h", "precip_accum_1h",
        "snowfall_rate_water_eq", "snow_depth_water_eq",
        "snowfall_accum_1h_water_eq",
        "hail_fall_rate", "hail_fall_rate_max_1h", "hail_accum_1h",
        "cape_surface", "cape_mixed_layer", "cape_most_unstable",
        "cin", "cin_mixed_layer", "cin_most_unstable",
        # UKV forecast lightning at 2 km -- the spec's "MET OFFICE UKV
        # PREDICTED LIGHTNING" product, distinct from TCM's own.
        "lightning_flash_density_1h",
    ),
    notes=(
        "Highest-resolution deterministic model available for the UK. The "
        "current DataHub order delivers T+0..54 hourly for the 00Z and 12Z "
        "cycles. Lightning flash density and CIN are NOT in the order yet."
    ),
))

# --- 2. Met Office MOGREPS-UK --------------------------------------------
# Confirmed live from order o210011501743 (model "mo-mogrepsuk") on
# 2026-08-28. Two things differ from the obvious assumption:
#
#   * MOGREPS-UK is TIME-LAGGED. Each cycle runs only 3 members (delivered
#     here as perturbationNumber 20, 21, 22). The familiar ~18-member
#     ensemble is formed by POOLING consecutive cycles, not by one cycle
#     producing 18 members. `n_members` below is members PER CYCLE.
#
#   * The delivery grid is the 2 km "GB and Eire" mesh -- the same one UKV
#     uses -- even though the model runs at 2.2 km. So the values arrive
#     already interpolated by the Met Office. `model_native_resolution_m`
#     stays 2.2 km, which is what `effective_resolution_m` reports, so a
#     MOGREPS field on 2 km cells is never described as 2 km data.
MOGREPS_UK = _reg(ModelSpec(
    id="mogreps_uk",
    display_name="Met Office MOGREPS-UK",
    centre=Centre.METOFFICE,
    provider="metoffice_datahub",
    model_native_resolution_m=2200.0,
    delivered_resolution_m=2200.0,
    grid="455x639 Lambert azimuthal equal area, GB and Eire (2 km delivery mesh)",
    projection=UK_LAEA_PROJ,
    domain=Domain(-12.0, 48.5, 5.0, 61.5, "MOGREPS-UK domain"),
    cycles_utc=(0, 12),
    # Hourly to T+24, 2-hourly to T+60, then 3-hourly to T+124.
    max_forecast_hour=124,
    forecast_step_hours=1,
    n_members=3,
    has_control=False,
    strengths=(
        ParamGroup.INITIATION, ParamGroup.INSTABILITY,
        ParamGroup.PRECIPITATION, ParamGroup.LIGHTNING,
    ),
    parameters=(
        "temperature_2m", "dewpoint_2m",
        "wind_speed_10m", "wind_direction_10m",
        "total_cloud_cover", "lightning_flash_density_1h",
        "hail_accum_1h",
        "precip_rate", "precip_accum_1h",
    ),
    notes=(
        "Convective-scale ensemble; the primary source of TCM uncertainty at "
        "storm scale, and the only source of forecast lightning flash density. "
        "The current order delivers 3 members per cycle for the 00Z and 12Z "
        "cycles, 3-hourly to T+126. Percentiles from 3 members are weak: "
        "adding more cycles to the order (MOGREPS-UK runs hourly) is what "
        "makes a proper time-lagged ensemble."
    ),
))

# --- 2b. Met Office MOGREPS-G --------------------------------------------
# Confirmed live from the DataHub order on 2026-08-30 by decoding
# `isbl_temperature_85000_2026083012_12`:
#
#   * grid   regular_ll, 46 x 59 = 2714 points at 0.28125 x 0.1875 degrees,
#            covering lon -10.97..1.97, lat 48.94..60.00. This is a UK SUBSET
#            of the global ensemble, not the global domain.
#   * members 18, as `perturbationNumber` 0..17, packed as separate GRIB
#            messages INSIDE one file. They are not visible in the catalogue
#            listing at all -- `members_in()` has to read the bundle.
#   * range  T+0..198, 6-hourly, from the 00Z and 12Z cycles.
#
# `delivered_resolution_m` is the COARSER axis: 0.1875 degrees of latitude is
# 20.9 km, while 0.28125 degrees of longitude is ~18 km at 55 N. A grid is
# only as fine as its worst direction, and quoting the better one would
# overstate what it resolves.
MOGREPS_G = _reg(ModelSpec(
    id="mogreps_g",
    display_name="Met Office MOGREPS-G",
    centre=Centre.METOFFICE,
    provider="metoffice_datahub",
    model_native_resolution_m=20000.0,
    delivered_resolution_m=20872.0,
    grid="46x59 regular lat/lon at 0.28125 x 0.1875 deg, UK and Ireland subset",
    projection=WGS84,
    domain=Domain(-10.97, 48.94, 1.97, 60.0, "MOGREPS-G UK subset as ordered"),
    cycles_utc=(0, 12),
    max_forecast_hour=198,
    forecast_step_hours=6,
    n_members=18,
    has_control=True,
    strengths=(
        ParamGroup.SYNOPTIC, ParamGroup.INSTABILITY, ParamGroup.ORGANISATION,
    ),
    parameters=(
        # Instability and inhibition, all three parcels.
        "cape_surface", "cape_mixed_layer", "cape_most_unstable",
        "cin", "cin_mixed_layer", "cin_most_unstable",
        # Nine isobaric levels of the full thermodynamic and wind profile.
        "temperature_1000", "temperature_925", "temperature_850",
        "temperature_700", "temperature_500", "temperature_400",
        "temperature_300", "temperature_250", "temperature_200",
        "relative_humidity_1000", "relative_humidity_925",
        "relative_humidity_850", "relative_humidity_700",
        "relative_humidity_500",
        "geopotential_height_1000", "geopotential_height_850",
        "geopotential_height_700", "geopotential_height_500",
        "u_wind_1000", "u_wind_925", "u_wind_850", "u_wind_700",
        "u_wind_500", "u_wind_300", "u_wind_250",
        "v_wind_1000", "v_wind_925", "v_wind_850", "v_wind_700",
        "v_wind_500", "v_wind_300", "v_wind_250",
        "wet_bulb_potential_temperature_850",
        "wet_bulb_potential_temperature_700",
        "wet_bulb_potential_temperature_500",
        # Height levels: the 0-6 km wind profile.
        "u_wind_10m", "v_wind_10m", "wind_speed_10m",
        "u_wind_agl_1000", "u_wind_agl_3000", "u_wind_agl_6000",
        "v_wind_agl_1000", "v_wind_agl_3000", "v_wind_agl_6000",
        "temperature_2m", "dewpoint_2m", "relative_humidity_2m",
        # Surface and boundary.
        "pressure_msl", "pressure_surface", "total_cloud_cover",
        "boundary_layer_height", "wet_bulb_zero_height",
        "effective_inflow_top",
        "convective_rain_rate", "large_scale_rain_rate",
        "precip_accum_1h", "terrain_height", "land_cover",
    ),
    notes=(
        "The only genuine ensemble the account currently holds: 18 members, "
        "against MOGREPS-UK's 3 before that order was removed. At ~21 km it "
        "is a SYNOPTIC and environment source, not a storm-scale one -- it "
        "cannot resolve initiation, and must never be described as if it "
        "could. Its value is spread and scenario information on days 2-5, "
        "where UKV does not reach at all (T+54). Every member is stored "
        "separately; see docs/DATA-ENGINE.md."
    ),
))


# --- 3. Met Office UKMO Global -------------------------------------------
UKMO_GLOBAL = _reg(ModelSpec(
    id="ukmo_global",
    display_name="Met Office Global",
    centre=Centre.METOFFICE,
    provider="open_meteo",
    model_native_resolution_m=10000.0,
    delivered_resolution_m=_sampled_resolution(10000.0),
    grid="sampled on a 0.25 deg lat/lon mesh",
    projection=WGS84,
    domain=Domain(-180.0, -90.0, 180.0, 90.0, "global"),
    cycles_utc=(0, 6, 12, 18),
    max_forecast_hour=168,
    strengths=(ParamGroup.SYNOPTIC,),
    parameters=OPEN_METEO_BASE_PARAMS + ("cin",),
    notes=(
        "Large-scale forcing and airmass, and one of only two sources of "
        "convective inhibition. Far too coarse to initiate storms."
    ),
))

# --- 4. AROME -------------------------------------------------------------
# Domain honesty: AROME France HD is 1.5 km but its domain stops around the
# Channel. It contributes to southern England and the Channel Isles ONLY.
AROME = _reg(ModelSpec(
    id="arome",
    display_name="Meteo-France AROME France HD",
    centre=Centre.METEO_FRANCE,
    provider="open_meteo",
    model_native_resolution_m=1500.0,
    delivered_resolution_m=_sampled_resolution(1500.0),
    grid="sampled on a 0.25 deg lat/lon mesh",
    projection=WGS84,
    domain=Domain(-8.0, 41.0, 12.0, 52.0, "France HD domain"),
    cycles_utc=(0, 3, 6, 9, 12, 15, 18, 21),
    max_forecast_hour=51,
    strengths=(ParamGroup.INITIATION, ParamGroup.PRECIPITATION),
    parameters=OPEN_METEO_BASE_PARAMS,
    notes=(
        "Highest-resolution model in the blend, but its domain reaches only "
        "the southern UK. The blend engine zeroes its weight north of ~52N; "
        "it must never be quoted as UK-wide guidance."
    ),
))

# --- 5. ARPEGE ------------------------------------------------------------
ARPEGE = _reg(ModelSpec(
    id="arpege",
    display_name="Meteo-France ARPEGE Europe",
    centre=Centre.METEO_FRANCE,
    provider="open_meteo",
    model_native_resolution_m=11000.0,
    delivered_resolution_m=_sampled_resolution(11000.0),
    grid="sampled on a 0.25 deg lat/lon mesh",
    projection=WGS84,
    domain=Domain(-32.0, 20.0, 42.0, 72.0, "Europe domain"),
    cycles_utc=(0, 6, 12, 18),
    max_forecast_hour=114,
    strengths=(ParamGroup.SYNOPTIC,),
    parameters=OPEN_METEO_BASE_PARAMS,
    notes=(
        "Independent European solution; its value is scenario spread rather "
        "than detail. Open-Meteo does not serve convective inhibition for it."
    ),
))

# --- 6. ICON --------------------------------------------------------------
ICON_EU = _reg(ModelSpec(
    id="icon_eu",
    display_name="DWD ICON-EU",
    centre=Centre.DWD,
    provider="open_meteo",
    model_native_resolution_m=7000.0,
    delivered_resolution_m=_sampled_resolution(7000.0),
    grid="sampled on a 0.25 deg lat/lon mesh",
    projection=WGS84,
    domain=Domain(-23.5, 29.5, 62.5, 70.5, "ICON-EU nest"),
    cycles_utc=(0, 6, 12, 18),
    max_forecast_hour=120,
    strengths=(ParamGroup.INSTABILITY, ParamGroup.SYNOPTIC),
    parameters=OPEN_METEO_BASE_PARAMS + ("cin", "freezing_level_height"),
    notes=(
        "Full UK and Ireland coverage at 7 km. ICON-D2 is 2.2 km but its "
        "domain excludes almost all of the UK, so it is deliberately not used."
    ),
))

# --- 7. ECMWF IFS HRES ----------------------------------------------------
# The important honesty case: HRES runs at ~9 km, the open feed is 0.25 deg.
IFS_HRES = _reg(ModelSpec(
    id="ifs_hres",
    display_name="ECMWF IFS HRES",
    centre=Centre.ECMWF,
    # Retrieved as "ecmwf_ifs025" through the Open-Meteo aggregation. The
    # ECMWF open-data object store would give the 0.25 deg GRIB2 directly and
    # is the better long-term source, but it needs its own adapter.
    provider="open_meteo",
    model_native_resolution_m=9000.0,
    delivered_resolution_m=_sampled_resolution(25000.0),
    grid="0.25 deg open feed, sampled on a 0.25 deg lat/lon mesh",
    projection=WGS84,
    domain=Domain(-180.0, -90.0, 180.0, 90.0, "global"),
    cycles_utc=(0, 6, 12, 18),
    max_forecast_hour=144,
    forecast_step_hours=3,
    strengths=(ParamGroup.SYNOPTIC,),
    parameters=OPEN_METEO_BASE_PARAMS,
    notes=(
        "Best-in-class synoptic guidance. The open feed is 0.25 deg, so TCM "
        "labels and weights it at 25 km, not 9 km."
    ),
))


# --------------------------------------------------------------------------

def get(model_id: str) -> ModelSpec:
    try:
        return MODELS[model_id]
    except KeyError:
        raise KeyError(
            f"unknown model {model_id!r}; known: {sorted(MODELS)}"
        ) from None


def models_for_group(group: ParamGroup) -> list[ModelSpec]:
    """Models that are credible contributors to a given blend group."""
    return [m for m in MODELS.values() if group in m.strengths]


def models_covering(lon: float, lat: float) -> list[ModelSpec]:
    """Models whose domain actually contains a point.

    The blend engine calls this before assigning any weight.
    """
    return [m for m in MODELS.values() if m.domain.contains(lon, lat)]


def ensemble_models() -> list[ModelSpec]:
    return [m for m in MODELS.values() if m.is_ensemble]
