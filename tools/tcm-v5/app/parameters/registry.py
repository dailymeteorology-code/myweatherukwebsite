"""The machine-readable registry of every derived parameter.

One entry per quantity, holding what it means, what it needs, how it is
computed, what its sign means and where it comes from in the literature.

This exists so the answer to "what is `mucin` and can this model produce it?"
is a lookup rather than an archaeology expedition through the calculation
modules. It is also the guard against scattered unexplained maths: a test
asserts that every diagnostic the engine emits has an entry here, so a new
calculation cannot enter the system without a definition, a unit, a sign
convention and a reference.

`processing_version` is per parameter, not global. When the mixed-layer depth
or the storm-motion method changes, only the affected parameters' versions
move, and a cache keyed on them invalidates exactly what changed rather than
everything.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from enum import Enum


class Category(str, Enum):
    THERMODYNAMICS = "thermodynamics"
    LAPSE_RATES = "lapse_rates"
    WIND = "wind"
    DYNAMICS = "dynamics"
    BOUNDARY_LAYER = "boundary_layer"
    CONVECTIVE_ENVIRONMENT = "convective_environment"


class LevelRequirement(str, Enum):
    #: Needs a full vertical profile to integrate through.
    PROFILE = "profile"
    #: Needs specific named levels only.
    SPECIFIC_LEVELS = "specific_levels"
    #: Needs a horizontal field with neighbouring grid cells.
    HORIZONTAL_FIELD = "horizontal_field"
    #: Needs the same quantity at two times.
    TWO_TIMES = "two_times"


@dataclass(frozen=True, slots=True)
class ParameterSpec:
    """Everything that defines one derived parameter."""

    name: str
    category: Category
    unit: str
    description: str
    #: Canonical Stage 3 profile variables required.
    inputs: tuple[str, ...]
    level_requirement: LevelRequirement
    #: The mathematical definition, in words or as a formula.
    definition: str
    #: The algorithm identifier the implementation stamps on results.
    method: str
    #: What a positive value means. Required for anything signed.
    sign_convention: str = ""
    #: Plausible physical range, for quality control. None where unbounded.
    valid_range: tuple[float, float] | None = None
    #: Specific levels needed, when `level_requirement` says so.
    required_levels: tuple[float, ...] = ()
    level_coordinate: str = ""
    #: Literature this implementation follows.
    references: tuple[str, ...] = ()
    #: Known limitations, surfaced on every result.
    limitations: tuple[str, ...] = ()
    #: Bump when the maths changes.
    processing_version: str = "1.0"
    #: Other registry entries this is computed from.
    depends_on: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "category": self.category.value,
            "unit": self.unit,
            "description": self.description,
            "inputs": list(self.inputs),
            "level_requirement": self.level_requirement.value,
            "definition": self.definition,
            "method": self.method,
            "sign_convention": self.sign_convention,
            "valid_range": list(self.valid_range) if self.valid_range else None,
            "required_levels": list(self.required_levels),
            "level_coordinate": self.level_coordinate,
            "references": list(self.references),
            "limitations": list(self.limitations),
            "processing_version": self.processing_version,
            "depends_on": list(self.depends_on),
        }


_BOLTON = "Bolton (1980), Mon. Wea. Rev. 108, 1046-1053"
_DOSWELL_RASMUSSEN = "Doswell & Rasmussen (1994), Wea. Forecasting 9, 625-629"
_EMANUEL = "Emanuel (1994), Atmospheric Convection"
_DAVIES_JONES = "Davies-Jones et al. (1990), 16th Conf. Severe Local Storms"
_BUNKERS = "Bunkers et al. (2000), Wea. Forecasting 15, 61-79"
_THOMPSON = "Thompson et al. (2007), Wea. Forecasting 22, 102-115"
_WEISMAN_KLEMP = "Weisman & Klemp (1982), Mon. Wea. Rev. 110, 504-520"
_PETTERSSEN = "Petterssen (1936), Geofys. Publ. 11, 1-27"
_MILLER = "Miller (1972), AWS TR 200 (Rev.)"
_VOGELEZANG = "Vogelezang & Holtslag (1996), Bound.-Layer Meteor. 81, 245-269"

_LEGACY_INDEX = (
    "a legacy index tuned to mid-20th-century US soundings; not a "
    "thunderstorm probability, and inferior to CAPE/shear where available"
)

_PARCEL_INPUTS = ("temperature", "relative_humidity", "geopotential_height")
_WIND_INPUTS = ("u_wind", "v_wind")


def _cape(name: str, parcel: str, detail: str) -> ParameterSpec:
    return ParameterSpec(
        name=name, category=Category.THERMODYNAMICS, unit="J/kg",
        description=f"Convective available potential energy for a {detail}.",
        inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
        definition="-Rd * INT(Tv_parcel - Tv_env) d ln p, integrated over the "
                   "positively buoyant area between the LFC and the EL",
        method=f"pseudoadiabatic_virtual_temperature__parcel={parcel}",
        sign_convention="always >= 0; zero means no positive buoyant area",
        valid_range=(0.0, 8000.0),
        references=(_EMANUEL, _DOSWELL_RASMUSSEN, _BOLTON),
        limitations=(
            "undiluted parcel: no entrainment, so real updraughts realise "
            "less than this",
            "pseudoadiabatic, so condensate loading is not represented",
        ),
        depends_on=("parcel_ascent",),
    )


def _cin(name: str, parcel: str, detail: str) -> ParameterSpec:
    return ParameterSpec(
        name=name, category=Category.THERMODYNAMICS, unit="J/kg",
        description=f"Convective inhibition for a {detail}.",
        inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
        definition="-Rd * INT(Tv_parcel - Tv_env) d ln p over the negatively "
                   "buoyant area between the parcel origin and the LFC",
        method=f"pseudoadiabatic_virtual_temperature__parcel={parcel}",
        sign_convention="always <= 0, reported with its physical sign. "
                        "UNAVAILABLE when there is no LFC, because CIN is "
                        "defined as the area beneath one",
        valid_range=(-1000.0, 0.0),
        references=(_EMANUEL, _DOSWELL_RASMUSSEN),
        limitations=(
            "not derived from CAPE by any ratio; it comes from the actual "
            "negative buoyancy of the same ascent",
        ),
        depends_on=("parcel_ascent",),
    )


def _shear(name: str, top_m: float) -> ParameterSpec:
    return ParameterSpec(
        name=name, category=Category.WIND, unit="m/s",
        description=f"Bulk vector wind shear from the surface to "
                    f"{top_m / 1000:.0f} km above ground.",
        inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
        definition="|V(top) - V(bottom)|, the magnitude of the vector "
                   "difference of the winds at the two levels",
        method="vector_difference_of_interpolated_components",
        sign_convention="magnitude, always >= 0",
        valid_range=(0.0, 100.0),
        required_levels=(0.0, top_m), level_coordinate="height_agl_m",
        limitations=(
            "NOT the difference of wind speeds -- see speed_shear_* for "
            "that, which is a different quantity",
            "unavailable rather than extrapolated where the profile does not "
            "reach the top of the layer",
        ),
    )


def _lapse_height(name: str, top_m: float) -> ParameterSpec:
    return ParameterSpec(
        name=name, category=Category.LAPSE_RATES, unit="K/km",
        description=f"Temperature lapse rate from the surface to "
                    f"{top_m / 1000:.0f} km above ground.",
        inputs=("temperature", "geopotential_height"),
        level_requirement=LevelRequirement.PROFILE,
        definition="-(T_top - T_bottom) / (z_top - z_bottom), in K/km",
        method="temperature_difference_over_geometric_depth",
        sign_convention="POSITIVE when temperature falls with height "
                        "(normal); NEGATIVE across an inversion",
        valid_range=(-30.0, 15.0),
        required_levels=(0.0, top_m), level_coordinate="height_agl_m",
        limitations=(
            "true geometric heights are used; a pressure level is never "
            "substituted for a height, because the pressure-height relation "
            "varies with airmass and terrain",
        ),
    )


def _lapse_pressure(name: str, bottom: float, top: float) -> ParameterSpec:
    return ParameterSpec(
        name=name, category=Category.LAPSE_RATES, unit="K/km",
        description=f"Temperature lapse rate between the {bottom:.0f} and "
                    f"{top:.0f} hPa surfaces.",
        inputs=("temperature", "geopotential_height"),
        level_requirement=LevelRequirement.SPECIFIC_LEVELS,
        definition="-(T_top - T_bottom) divided by the true geometric "
                   "thickness of the layer, in K/km",
        method="temperature_difference_over_geopotential_thickness",
        sign_convention="POSITIVE when temperature falls with height; "
                        "NEGATIVE across an inversion",
        valid_range=(-30.0, 15.0),
        required_levels=(bottom, top), level_coordinate="pressure_hpa",
        limitations=(
            "expressed per kilometre, not per pressure interval, so it is "
            "comparable with the height-based rates and does not change "
            "meaning between airmasses",
            "unavailable where the lower surface is below ground",
        ),
    )


def _srh(name: str, top_m: float) -> ParameterSpec:
    return ParameterSpec(
        name=name, category=Category.WIND, unit="m2/s2",
        description=f"Storm-relative helicity over the lowest "
                    f"{top_m / 1000:.0f} km.",
        inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
        definition="-INT (V - c) . (k x dV/dz) dz, evaluated by the "
                   "Davies-Jones discrete hodograph summation",
        method="davies_jones_1990_discrete_sum",
        sign_convention="POSITIVE when the hodograph turns clockwise with "
                        "height relative to the storm; favours right-moving "
                        "supercells in the northern hemisphere",
        valid_range=(-1500.0, 1500.0),
        required_levels=(0.0, top_m), level_coordinate="height_agl_m",
        references=(_DAVIES_JONES, _BUNKERS),
        limitations=(
            "depends entirely on the assumed storm motion, which is an "
            "estimate; the motion used is recorded on every result",
            "measures hodograph curvature relative to the storm, not wind "
            "strength: a long straight hodograph contributes nothing",
        ),
        depends_on=("storm_motion_right",),
    )


#: Every parameter Stage 4 produces.
REGISTRY: dict[str, ParameterSpec] = {}


def _register(spec: ParameterSpec) -> None:
    if spec.name in REGISTRY:
        raise ValueError(f"duplicate registry entry {spec.name!r}")
    REGISTRY[spec.name] = spec


for _n, _p, _d in (
    ("sbcape", "surface", "parcel lifted from the surface"),
    ("mlcape", "mixed_layer", "parcel with the mean state of the lowest "
                              "100 hPa"),
    ("mucape", "most_unstable", "parcel with the highest theta-e in the "
                                "lowest 300 hPa"),
):
    _register(_cape(_n, _p, _d))

for _n, _p, _d in (
    ("sbcin", "surface", "parcel lifted from the surface"),
    ("mlcin", "mixed_layer", "parcel with the mean state of the lowest "
                             "100 hPa"),
    ("mucin", "most_unstable", "parcel with the highest theta-e in the "
                               "lowest 300 hPa"),
):
    _register(_cin(_n, _p, _d))

for _n, _t in (
    ("shear_0_1km", 1000.0), ("shear_0_3km", 3000.0),
    ("shear_0_6km", 6000.0), ("shear_0_8km", 8000.0),
):
    _register(_shear(_n, _t))

for _n, _t in (
    ("lr_0_1km", 1000.0), ("lr_0_3km", 3000.0), ("lr_0_6km", 6000.0),
):
    _register(_lapse_height(_n, _t))

_register(_lapse_pressure("lr_850_500", 850.0, 500.0))
_register(_lapse_pressure("lr_700_500", 700.0, 500.0))

for _n, _t in (("srh_0_1km", 1000.0), ("srh_0_3km", 3000.0)):
    _register(_srh(_n, _t))


_register(ParameterSpec(
    name="lcl", category=Category.THERMODYNAMICS, unit="m",
    description="Lifting condensation level: the height at which a lifted "
                "parcel becomes saturated. Cloud base for surface-based "
                "convection.",
    inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="T_LCL from Bolton (1980) eq. 15, then p_LCL from the "
               "conservation of potential temperature below the LCL",
    method="bolton_1980_eq15",
    sign_convention="height above ground, always >= 0",
    valid_range=(0.0, 6000.0), references=(_BOLTON,),
    limitations=("accurate to about 0.1 K in T_LCL; far better than the "
                 "common 125*(T-Td) rule of thumb",),
    depends_on=("parcel_ascent",),
))

_register(ParameterSpec(
    name="lfc", category=Category.THERMODYNAMICS, unit="m",
    description="Level of free convection: where the lifted parcel first "
                "becomes warmer than its environment.",
    inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="the lowest level at or above the LCL where the parcel's "
               "virtual temperature exceeds the environment's, located by "
               "interpolation in ln(p) between ascent grid points",
    method="buoyancy_zero_crossing_above_lcl",
    sign_convention="height above ground",
    valid_range=(0.0, 12000.0), references=(_EMANUEL,),
    limitations=(
        "may not exist: a stable profile has no LFC, and none is invented",
        "a profile with several buoyant layers has several candidate "
        "crossings; the lowest above the LCL is taken and the others are "
        "reported in positive_layers",
    ),
    depends_on=("parcel_ascent", "lcl"),
))

_register(ParameterSpec(
    name="el", category=Category.THERMODYNAMICS, unit="m",
    description="Equilibrium level: where the rising parcel becomes neutrally "
                "buoyant again. Approximates anvil height.",
    inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="the HIGHEST downward buoyancy crossing above the LFC, not "
               "the first",
    method="highest_buoyancy_crossing_above_lfc",
    sign_convention="height above ground",
    valid_range=(0.0, 20000.0), references=(_EMANUEL,),
    limitations=(
        "may not exist within the profile: a parcel still buoyant at the top "
        "of the data has no located EL, and CAPE is then a lower bound",
        "the first zero crossing is deliberately NOT used -- a thin stable "
        "layer mid-ascent would truncate the cloud far too low",
    ),
    depends_on=("parcel_ascent", "lfc"),
))

_register(ParameterSpec(
    name="lifted_index", category=Category.THERMODYNAMICS, unit="K",
    description="Environment minus surface-parcel temperature at 500 hPa.",
    inputs=_PARCEL_INPUTS,
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="T_env(500 hPa) - T_parcel(500 hPa), on DRY-bulb temperature",
    method="galway_1956", sign_convention="NEGATIVE means unstable",
    valid_range=(-20.0, 40.0), required_levels=(500.0,),
    level_coordinate="pressure_hpa",
    references=("Galway (1956), Bull. Amer. Meteor. Soc. 37, 528-529",),
    limitations=(_LEGACY_INDEX,
                 "parcel choice changes the value under the same name; the "
                 "surface parcel is used and is recorded on every result"),
    depends_on=("parcel_ascent",),
))

_register(ParameterSpec(
    name="showalter_index", category=Category.THERMODYNAMICS, unit="K",
    description="An 850 hPa parcel lifted to 500 hPa, compared with the "
                "environment there.",
    inputs=_PARCEL_INPUTS,
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="T_env(500 hPa) - T_parcel(500 hPa), parcel from 850 hPa",
    method="showalter_1953", sign_convention="NEGATIVE means unstable",
    valid_range=(-20.0, 40.0), required_levels=(850.0, 500.0),
    level_coordinate="pressure_hpa",
    references=("Showalter (1953), Bull. Amer. Meteor. Soc. 34, 250-252",),
    limitations=(_LEGACY_INDEX,
                 "blind to instability below 850 hPa",
                 "unavailable where 850 hPa is below ground; no substitute "
                 "level is used"),
))

_register(ParameterSpec(
    name="total_totals", category=Category.THERMODYNAMICS, unit="K",
    description="Vertical totals plus cross totals.",
    inputs=("temperature", "relative_humidity"),
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="(T850 - T500) + (Td850 - T500)",
    method="miller_1972", sign_convention="LARGER means more unstable",
    valid_range=(0.0, 80.0), required_levels=(850.0, 500.0),
    level_coordinate="pressure_hpa", references=(_MILLER,),
    limitations=(_LEGACY_INDEX,
                 "the sum conflates a lapse-rate term and a moisture term; "
                 "both constituents are returned separately"),
))

_register(ParameterSpec(
    name="k_index", category=Category.THERMODYNAMICS, unit="degC",
    description="A deep-moisture index combining the 850-500 hPa lapse rate, "
                "850 hPa moisture and the 700 hPa dew-point depression.",
    inputs=("temperature", "relative_humidity"),
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="(T850 - T500) + Td850 - (T700 - Td700), in degrees Celsius",
    method="george_1960", sign_convention="LARGER means more unstable",
    valid_range=(-40.0, 45.0), required_levels=(850.0, 700.0, 500.0),
    level_coordinate="pressure_hpa",
    references=("George (1960), Weather Forecasting for Aeronautics",),
    limitations=(_LEGACY_INDEX,
                 "degrades sharply in dry mid-level environments, which are "
                 "common in UK severe convection"),
))

_register(ParameterSpec(
    name="sweat_index", category=Category.THERMODYNAMICS,
    unit="dimensionless",
    description="Severe Weather Threat index: a weighted combination of "
                "850 hPa moisture, Total Totals, 850 and 500 hPa wind speed "
                "and the veering between them.",
    inputs=("temperature", "relative_humidity", "u_wind", "v_wind"),
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="12*Td850 + 20*(TT-49) + 2*f850 + f500 + 125*(sin(dir500 - "
               "dir850) + 0.2), with Miller's published conditionals applied",
    method="miller_1972_awstr200_with_published_conditionals",
    sign_convention="LARGER means greater severe potential",
    valid_range=(0.0, 800.0), required_levels=(850.0, 500.0),
    level_coordinate="pressure_hpa", references=(_MILLER,),
    limitations=(_LEGACY_INDEX,
                 "mixes thermodynamics and wind in fixed proportions tuned "
                 "to US Great Plains soundings; not a substitute for "
                 "CAPE/shear analysis",
                 "coefficients are calibrated to KNOTS; the conversion is "
                 "internal"),
    depends_on=("total_totals",),
))

_register(ParameterSpec(
    name="dcape", category=Category.CONVECTIVE_ENVIRONMENT, unit="J/kg",
    description="Downdraught CAPE: energy available to a saturated "
                "downdraught descending from the minimum-theta-e level.",
    inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="Rd * INT(Tv_env - Tv_parcel) d ln p over a saturated "
               "pseudoadiabatic descent from the minimum-theta-e level "
               "between 700 and 500 hPa to the surface",
    method="emanuel_1994_min_theta_e_saturated_descent",
    sign_convention="reported POSITIVE, unlike CIN",
    valid_range=(0.0, 2000.0), references=(_EMANUEL,),
    limitations=(
        "assumes saturation throughout the descent, so it is an UPPER BOUND",
        "no efficiency factor is applied -- that would be an interpretation",
        "the source level is diagnosed, not fixed at a pressure",
    ),
))

_register(ParameterSpec(
    name="precipitable_water", category=Category.CONVECTIVE_ENVIRONMENT,
    unit="kg/m2",
    description="Total column water vapour, equivalently millimetres of "
                "liquid water.",
    inputs=("relative_humidity", "temperature"),
    level_requirement=LevelRequirement.PROFILE,
    definition="(1/g) INT q dp, with q the specific humidity",
    method="trapezoidal_integral_of_specific_humidity_over_pressure",
    sign_convention="always >= 0", valid_range=(0.0, 100.0),
    limitations=(
        "covers only the levels present; a column not reaching the surface "
        "is a LOWER BOUND and is marked PARTIAL",
        "specific humidity, not mixing ratio -- the integral is over moist "
        "air mass",
    ),
))

_register(ParameterSpec(
    name="freezing_level", category=Category.CONVECTIVE_ENVIRONMENT,
    unit="m",
    description="Height of the 0 C dry-bulb isotherm. All crossings are "
                "reported, not only the lowest.",
    inputs=("temperature", "geopotential_height"),
    level_requirement=LevelRequirement.PROFILE,
    definition="linear crossing of T = 273.15 K, interpolated in ln(p)",
    method="linear_crossing_in_log_pressure",
    sign_convention="height above mean sea level; height_agl_m in extra",
    valid_range=(0.0, 6000.0),
    limitations=(
        "there can be more than one: a warm nose aloft over a sub-freezing "
        "layer gives three, and that is the freezing-rain structure",
        "unavailable when the column never crosses 0 C, rather than "
        "reporting the ground",
    ),
))

_register(ParameterSpec(
    name="wet_bulb_zero", category=Category.CONVECTIVE_ENVIRONMENT, unit="m",
    description="Height of the 0 C wet-bulb isotherm.",
    inputs=("temperature", "relative_humidity", "geopotential_height"),
    level_requirement=LevelRequirement.PROFILE,
    definition="Normand wet-bulb temperature, then the linear crossing of "
               "Tw = 273.15 K interpolated in ln(p)",
    method="normand_wet_bulb_then_linear_crossing_in_log_pressure",
    sign_convention="height above mean sea level",
    valid_range=(0.0, 6000.0), references=(_MILLER,),
    limitations=(
        "NOT the dry-bulb freezing level: in a dry sub-cloud layer the two "
        "differ by hundreds of metres or more, which is why hail survives "
        "descent in environments the freezing level alone would rule out",
    ),
))

for _n, _desc, _defn in (
    ("cloud_depth", "Potential depth of a convective cloud, LCL to EL.",
     "el_height - lcl_height for the given parcel"),
    ("warm_cloud_depth",
     "Depth of the cloud layer warmer than 0 C, where growth is by "
     "collision-coalescence.",
     "freezing_level - lcl_height, floored at zero"),
    ("cold_cloud_depth",
     "Depth of the ice-bearing cloud layer, where charge separation and hail "
     "growth occur.",
     "el_height - max(freezing_level, lcl_height), floored at zero"),
):
    _register(ParameterSpec(
        name=_n, category=Category.CONVECTIVE_ENVIRONMENT, unit="m",
        description=_desc, inputs=_PARCEL_INPUTS,
        level_requirement=LevelRequirement.PROFILE,
        definition=_defn, method="parcel_levels_and_freezing_level",
        sign_convention="depth, always >= 0",
        valid_range=(0.0, 20000.0),
        references=("Doswell (2001), Meteor. Monogr. 28, 1-26",),
        limitations=(
            "a POTENTIAL depth from parcel thermodynamics, not observed "
            "cloud; the model's own condensate answers a different question",
            "zero is a physical result where the freezing level lies below "
            "cloud base, not a missing value",
        ),
        depends_on=("parcel_ascent", "freezing_level"),
    ))

_register(ParameterSpec(
    name="entrainment_indicators", category=Category.CONVECTIVE_ENVIRONMENT,
    unit="%",
    description="Environmental humidity and moisture-contrast measurements "
                "relevant to dilution of an updraught.",
    inputs=("relative_humidity", "temperature"),
    level_requirement=LevelRequirement.PROFILE,
    definition="mean and minimum 700-500 hPa relative humidity, the "
               "low-level mean, and the low-to-mid mixing-ratio contrast",
    method="layer_mean_humidity_and_mixing_ratio_contrast",
    sign_convention="humidity percentages, always >= 0",
    valid_range=(0.0, 100.0),
    references=("Gilmore & Wicker (1998), Mon. Wea. Rev. 126, 943-958",),
    limitations=(
        "deliberately NOT combined into an entrainment score: dilution "
        "depends on updraught width and storm mode, which this stage does "
        "not know",
    ),
))

_register(ParameterSpec(
    name="directional_shear", category=Category.WIND, unit="degrees",
    description="Signed change of wind direction with height, layer by layer.",
    inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="direction differences between successive layer boundaries, "
               "each derived from interpolated components",
    method="signed_direction_change_per_layer_from_components",
    sign_convention="POSITIVE means VEERING (clockwise with height); "
                    "NEGATIVE means backing",
    valid_range=(-720.0, 720.0),
    limitations=(
        "the per-layer breakdown is the result; the total is a convenience "
        "and hides where the turning happens",
        "derived from components, so 360-degree wraparound cannot corrupt it",
    ),
))

for _n, _t in (
    ("speed_shear_0_1km", 1000.0), ("speed_shear_0_6km", 6000.0),
):
    _register(ParameterSpec(
        name=_n, category=Category.WIND, unit="m/s",
        description=f"Change in wind SPEED from the surface to "
                    f"{_t / 1000:.0f} km -- a scalar difference, not shear.",
        inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
        definition="|V(top)| - |V(bottom)|",
        method="difference_of_wind_speeds",
        sign_convention="NEGATIVE when the wind slows with height",
        valid_range=(-100.0, 100.0),
        required_levels=(0.0, _t), level_coordinate="height_agl_m",
        limitations=(
            "NOT vector shear: a wind reversing direction at constant speed "
            "has zero speed shear and very large vector shear",
        ),
    ))

for _mover in ("right", "left", "mean"):
    _register(ParameterSpec(
        name=f"storm_motion_{_mover}", category=Category.WIND, unit="m/s",
        description=f"Estimated {_mover}-moving storm motion vector (u, v).",
        inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
        definition="the 0-6 km mean wind displaced 7.5 m/s perpendicular to "
                   "the 0-6 km shear vector" if _mover != "mean"
                   else "the depth-weighted 0-6 km mean wind",
        method=f"bunkers_2000_{_mover}_mover" if _mover != "mean"
               else "0_6km_mean_wind",
        sign_convention="a vector (u, v) in m/s, not a magnitude",
        references=(_BUNKERS,),
        limitations=(
            "an ESTIMATE from the hodograph, not an observation",
            "undefined on a hodograph with negligible 0-6 km shear",
            "requires wind through 6 km; no shallower substitute is used",
        ),
    ))

_register(ParameterSpec(
    name="effective_inflow_layer", category=Category.WIND, unit="m",
    description="Depth of the layer whose parcels can actually reach a "
                "storm's updraught.",
    inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="the contiguous layer in which a lifted parcel has "
               "CAPE >= 100 J/kg and CIN >= -250 J/kg",
    method="thompson_2007", sign_convention="depth, always >= 0",
    valid_range=(0.0, 6000.0), references=(_THOMPSON,),
    limitations=(
        "may not exist; no fixed-level fallback is substituted",
        "requires a parcel ascent from every candidate level, which is "
        "expensive by construction",
    ),
    depends_on=("parcel_ascent",),
))

_register(ParameterSpec(
    name="effective_srh", category=Category.WIND, unit="m2/s2",
    description="Storm-relative helicity over the effective inflow layer.",
    inputs=_WIND_INPUTS + _PARCEL_INPUTS,
    level_requirement=LevelRequirement.PROFILE,
    definition="the Davies-Jones summation over the effective inflow layer "
               "rather than a fixed depth",
    method="thompson_2007_effective_layer",
    sign_convention="POSITIVE for clockwise turning relative to the storm",
    valid_range=(-1500.0, 1500.0),
    references=(_THOMPSON, _DAVIES_JONES),
    limitations=(
        "unavailable whenever the effective inflow layer is; a fixed layer "
        "is never substituted",
    ),
    depends_on=("effective_inflow_layer", "storm_motion_right"),
))

_register(ParameterSpec(
    name="storm_relative_flow", category=Category.WIND, unit="m/s",
    description="The storm-relative wind profile: speed and direction at "
                "each of nine heights.",
    inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="V(z) - c at each level, for the assumed storm motion c",
    method="wind_minus_storm_motion",
    sign_convention="speeds are magnitudes; the components are in extra",
    valid_range=(0.0, 120.0), references=(_BUNKERS,),
    limitations=("depends on the assumed storm motion, which is recorded",),
    depends_on=("storm_motion_right",),
))

_register(ParameterSpec(
    name="low_level_jet", category=Category.WIND, unit="m/s",
    description="Wind maximum in the lowest 3 km, with its height and the "
                "fall-off above it.",
    inputs=_WIND_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="the wind-speed maximum in the layer, qualified as a jet only "
               "if the speed falls by at least 2 m/s above it",
    method="wind_speed_maximum_in_layer_with_fall_off_test",
    sign_convention="speed, always >= 0", valid_range=(0.0, 80.0),
    limitations=(
        "a threshold alone would call any strong flow a jet; the fall-off "
        "test distinguishes a maximum from monotonic increase",
        "a maximum at the top of the search layer may not be a maximum at "
        "all, and is flagged",
    ),
))

_register(ParameterSpec(
    name="upper_level_jet", category=Category.WIND, unit="m/s",
    description="Wind maximum between 400 and 150 hPa, with its level and "
                "the shear on either side.",
    inputs=_WIND_INPUTS,
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="the wind-speed maximum in the pressure layer",
    method="wind_speed_maximum_in_pressure_layer",
    sign_convention="speed, always >= 0", valid_range=(0.0, 150.0),
    required_levels=(400.0, 150.0), level_coordinate="pressure_hpa",
    limitations=("a jet core above the top of the profile is invisible and "
                 "the result is marked PARTIAL",),
))

_register(ParameterSpec(
    name="bulk_richardson_number", category=Category.WIND,
    unit="dimensionless",
    description="Ratio of CAPE to the BRN shear.",
    inputs=_PARCEL_INPUTS + _WIND_INPUTS,
    level_requirement=LevelRequirement.PROFILE,
    definition="CAPE / (0.5 * |mean(0-6 km) - mean(0-500 m)|^2)",
    method="weisman_klemp_1982",
    sign_convention="a positive ratio; small values indicate "
                    "shear-dominated environments",
    valid_range=(0.0, 2000.0), references=(_WEISMAN_KLEMP,),
    limitations=(
        "the denominator uses LAYER MEAN winds, not the two-level difference "
        "in shear_0_6km; the two are not interchangeable",
        "diverges as shear approaches zero, and is unavailable below "
        "1 m2/s2 rather than reporting a huge number",
    ),
    depends_on=("sbcape",),
))

for _n, _u, _desc, _defn, _sign in (
    ("divergence", "s-1", "Horizontal divergence of the wind field.",
     "du/dx + dv/dy", "POSITIVE means outflow"),
    ("convergence", "s-1", "Horizontal convergence of the wind field.",
     "-(du/dx + dv/dy)", "POSITIVE means inflow"),
    ("relative_vorticity", "s-1",
     "Vertical component of relative vorticity.", "dv/dx - du/dy",
     "POSITIVE is cyclonic in the northern hemisphere"),
    ("absolute_vorticity", "s-1",
     "Relative plus planetary vorticity.",
     "(dv/dx - du/dy) + 2*OMEGA*sin(latitude)",
     "POSITIVE is cyclonic in the northern hemisphere"),
):
    _register(ParameterSpec(
        name=_n, category=Category.DYNAMICS, unit=_u, description=_desc,
        inputs=_WIND_INPUTS,
        level_requirement=LevelRequirement.HORIZONTAL_FIELD,
        definition=_defn, method="centred_finite_difference",
        sign_convention=_sign, valid_range=(-1e-2, 1e-2),
        limitations=(
            "grid-spacing aware: metres on a projected grid, and per-row "
            "cos(latitude) scaling on a lat/lon grid",
            "one-sided differences at the domain edges",
        ),
    ))

for _n, _u, _desc, _src in (
    ("temperature_advection", "K/s",
     "Horizontal advection of temperature.", "temperature"),
    ("moisture_advection", "kg/kg/s",
     "Horizontal advection of water vapour mixing ratio.", "mixing_ratio"),
):
    _register(ParameterSpec(
        name=_n, category=Category.DYNAMICS, unit=_u, description=_desc,
        inputs=(_src,) + _WIND_INPUTS,
        level_requirement=LevelRequirement.HORIZONTAL_FIELD,
        definition="-(u dS/dx + v dS/dy)",
        method="negative_wind_dot_gradient",
        sign_convention="POSITIVE means the quantity is increasing at the "
                        "point: warm advection, or moistening",
        valid_range=(-1e-1, 1e-1),
        limitations=(
            "mixing ratio is used for moisture, not relative humidity, "
            "because RH conflates moisture with temperature",
        ) if _src == "mixing_ratio" else (),
    ))

_register(ParameterSpec(
    name="moisture_flux_convergence", category=Category.DYNAMICS,
    unit="kg/kg/s",
    description="Convergence of the horizontal moisture flux.",
    inputs=("mixing_ratio",) + _WIND_INPUTS,
    level_requirement=LevelRequirement.HORIZONTAL_FIELD,
    definition="-div(qV) = -(u dq/dx + v dq/dy) - q(du/dx + dv/dy)",
    method="negative_divergence_of_moisture_flux",
    sign_convention="POSITIVE means moisture accumulating",
    valid_range=(-1e-1, 1e-1),
    references=("Banacos & Schultz (2005), Wea. Forecasting 20, 351-366",),
    limitations=(
        "dominated in practice by the convergence term, so it behaves as a "
        "proxy for low-level convergence rather than an independent "
        "moisture diagnostic",
        "NOT interchangeable with moisture_advection or convergence; both "
        "constituent terms are returned separately",
    ),
))

for _n, _u, _desc, _src in (
    ("pressure_gradient", "Pa/m", "Horizontal pressure-gradient magnitude.",
     "pressure_surface"),
    ("geopotential_gradient", "m/m",
     "Horizontal geopotential-height gradient magnitude.",
     "geopotential_height"),
):
    _register(ParameterSpec(
        name=_n, category=Category.DYNAMICS, unit=_u, description=_desc,
        inputs=(_src,),
        level_requirement=LevelRequirement.HORIZONTAL_FIELD,
        definition="|grad S|, with the components retained separately",
        method="centred_difference_magnitude",
        sign_convention="magnitude, always >= 0",
        limitations=("the magnitude discards direction; the components are "
                     "kept in extra",),
    ))

_register(ParameterSpec(
    name="frontogenesis", category=Category.DYNAMICS, unit="K/m/s",
    description="Petterssen 2-D kinematic frontogenesis: the rate of change "
                "of the horizontal potential-temperature gradient.",
    inputs=("temperature",) + _WIND_INPUTS,
    level_requirement=LevelRequirement.HORIZONTAL_FIELD,
    definition="-(1/|grad theta|)[theta_x^2 u_x + theta_x theta_y (v_x + u_y)"
               " + theta_y^2 v_y]",
    method="petterssen_1936",
    sign_convention="POSITIVE means the gradient is STRENGTHENING",
    valid_range=(-1e-6, 1e-6), references=(_PETTERSSEN,
                                           "Bluestein (1993), vol. II"),
    limitations=(
        "computed on POTENTIAL temperature; a temperature-gradient threshold "
        "is not frontogenesis and the two are close to independent",
        "undefined where the gradient is negligible; those cells are NaN "
        "rather than enormous",
    ),
))

_register(ParameterSpec(
    name="vertical_velocity", category=Category.DYNAMICS, unit="native",
    description="The model's vertical-motion field, normalised in "
                "representation but not converted.",
    inputs=("vertical_velocity",),
    level_requirement=LevelRequirement.HORIZONTAL_FIELD,
    definition="the native field, with its form (omega in Pa/s or w in m/s) "
               "and ascent sign identified",
    method="native_preserved_without_conversion",
    sign_convention="DEPENDS ON FORM: omega NEGATIVE is ascent, w POSITIVE "
                    "is ascent. Always read ascent_sign from the result",
    limitations=(
        "no conversion between omega and w: the exact relation needs density "
        "and the motion of the pressure surface, and the usual "
        "approximation holds only for synoptic-scale motion",
        "unavailable rather than guessed when the native units are "
        "unrecognised",
    ),
))

_register(ParameterSpec(
    name="pbl_depth", category=Category.BOUNDARY_LAYER, unit="m",
    description="Depth of the atmospheric boundary layer.",
    inputs=("boundary_layer_height", "temperature", "u_wind", "v_wind"),
    level_requirement=LevelRequirement.PROFILE,
    definition="the model's native diagnostic where published; otherwise the "
               "height at which the bulk Richardson number first reaches 0.25",
    method="model_native_or_vogelezang_holtslag_1996",
    sign_convention="depth above ground, always >= 0",
    valid_range=(0.0, 5000.0), references=(_VOGELEZANG,
                                           "Seibert et al. (2000)"),
    limitations=(
        "models define the boundary layer differently inside their "
        "turbulence schemes; the native definition is preserved and never "
        "silently replaced",
        "a reconstruction is marked DEGRADED and says so",
    ),
))

_register(ParameterSpec(
    name="boundary_layer_moisture", category=Category.BOUNDARY_LAYER,
    unit="kg/kg",
    description="Mean water vapour mixing ratio through the boundary layer, "
                "with the lowest 100 m and 500 m reported alongside.",
    inputs=("relative_humidity", "temperature"),
    level_requirement=LevelRequirement.PROFILE,
    definition="depth-weighted mean mixing ratio over the layer",
    method="mean_mixing_ratio_through_boundary_layer",
    sign_convention="always >= 0", valid_range=(0.0, 0.05),
    limitations=(
        "mixing ratio, NOT surface relative humidity: RH falls through a "
        "heating afternoon while the water content is unchanged",
    ),
    depends_on=("pbl_depth",),
))

_register(ParameterSpec(
    name="boundary_layer_temperature", category=Category.BOUNDARY_LAYER,
    unit="K",
    description="Screen, lowest-level and mixed-layer mean temperatures, "
                "kept distinct.",
    inputs=("temperature",), level_requirement=LevelRequirement.PROFILE,
    definition="the 1.5 m screen temperature, the lowest usable level's "
               "temperature, and the mean through the boundary layer",
    method="screen_level_and_layer_means",
    sign_convention="absolute temperature", valid_range=(180.0, 340.0),
    references=("Stull (1988), An Introduction to Boundary Layer "
                "Meteorology",),
    limitations=(
        "the three are NOT interchangeable; they diverge most on clear "
        "nights and hot afternoons",
    ),
    depends_on=("pbl_depth",),
))

_register(ParameterSpec(
    name="surface_heating", category=Category.BOUNDARY_LAYER, unit="W/m2",
    description="Surface energy fluxes that drive boundary-layer growth.",
    inputs=("surface_sensible_heat_flux", "surface_latent_heat_flux",
            "surface_net_shortwave", "surface_downward_shortwave"),
    level_requirement=LevelRequirement.SPECIFIC_LEVELS,
    definition="the model's own surface energy-flux fields, passed through",
    method="model_native_surface_energy_fluxes",
    sign_convention="the source model's own; preserved, not normalised",
    limitations=(
        "NOT inferred from temperature: surface temperature is the result of "
        "heating, not a measure of it",
        "unavailable where the model publishes no flux fields",
    ),
))

_register(ParameterSpec(
    name="change_diagnostics", category=Category.BOUNDARY_LAYER,
    unit="count",
    description="Paired before/after values of the destabilisation-relevant "
                "quantities, with the exact interval.",
    inputs=("sbcape", "mlcape", "mucape", "sbcin", "mlcin", "mucin",
            "boundary_layer_moisture", "boundary_layer_temperature",
            "pbl_depth", "lifted_index"),
    level_requirement=LevelRequirement.TWO_TIMES,
    definition="value at each time, the difference, and the difference per "
               "hour, for every tracked quantity",
    method="paired_difference_with_explicit_interval",
    sign_convention="each tracked quantity keeps its own convention",
    limitations=(
        "components only: NOT a destabilisation index and NOT a CIN-erosion "
        "percentage, both of which would imply a weighting this stage has "
        "not established",
    ),
))

_register(ParameterSpec(
    name="parcel_ascent", category=Category.THERMODYNAMICS, unit="mixed",
    description="The full lifted-parcel profile: pressure, height, parcel "
                "and environment temperature, virtual temperature and "
                "buoyancy at every ascent level.",
    inputs=_PARCEL_INPUTS, level_requirement=LevelRequirement.PROFILE,
    definition="dry-adiabatic ascent to the LCL, then pseudoadiabatic ascent "
               "integrated by RK4 on a 5 hPa grid, with buoyancy evaluated "
               "against the environment on virtual temperature",
    method="pseudoadiabatic_virtual_temperature",
    sign_convention="buoyancy POSITIVE means upward acceleration",
    references=(_BOLTON, _EMANUEL, _DOSWELL_RASMUSSEN,
                "Blanchard (1998), Wea. Forecasting 13, 870-877"),
    limitations=(
        "the shared foundation of every parcel diagnostic; changing it "
        "changes CAPE, CIN, LI, cloud depths and BRN together",
    ),
))


def get(name: str) -> ParameterSpec | None:
    return REGISTRY.get(name)


def by_category(category: Category) -> tuple[ParameterSpec, ...]:
    return tuple(s for s in REGISTRY.values() if s.category is category)


def dependency_graph() -> dict[str, tuple[str, ...]]:
    """What each parameter is computed from.

    The expensive shared nodes are `parcel_ascent` (one lift serving CAPE,
    CIN, LCL, LFC, EL, LI and the cloud depths) and `storm_motion_right`
    (one hodograph estimate serving every storm-relative quantity). The
    engine computes each once per column and passes the result down.
    """
    return {name: spec.depends_on for name, spec in REGISTRY.items()}


def to_dict() -> dict:
    return {name: spec.to_dict() for name, spec in REGISTRY.items()}
