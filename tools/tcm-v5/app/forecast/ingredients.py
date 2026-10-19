"""Every variable the risk engine can use, and what each contributes.

The first risk engine scored on four ingredients and effectively leaned on
CAPE alone. That is not a convective forecast: instability says a parcel
*could* rise, not that it will, nor what happens if it does. This table is
the full set of what the orders actually deliver, and what each one is for.

Each ingredient declares a `role`:

  POTENTIAL   establishes that convection is possible or forecast at all.
              Without at least one of these the risk is gated to zero, so a
              wet front is not scored as a thunderstorm.
  INHIBITION  can SUPPRESS the risk. Strong CIN caps convection however much
              instability exists -- this is the ingredient whose absence made
              the engine unable to tell a capped day from an active one.
  INTENSITY   scales how bad it gets if convection happens.
  MODIFIER    adjusts the score without being able to create or destroy it.

Every ingredient is optional. Missing ones are declared and the remaining
weights renormalise, so the engine degrades transparently rather than
silently changing meaning.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Role(str, Enum):
    POTENTIAL = "potential"
    INHIBITION = "inhibition"
    INTENSITY = "intensity"
    MODIFIER = "modifier"


@dataclass(frozen=True, slots=True)
class IngredientSpec:
    name: str
    role: Role
    #: Value at which the ingredient starts to contribute.
    low: float
    #: Value at which it contributes fully.
    high: float
    #: Relative weight within its role.
    weight: float
    why: str
    #: True when a LOWER value means more risk (CIN, cloud at night).
    inverted: bool = False
    units: str = ""
    #: Ingredients that are ALTERNATIVE MEASURES OF THE SAME THING rather
    #: than independent evidence. The three CAPE fields are one parcel
    #: question asked three ways; so are the three CIN fields.
    #:
    #: They must not be averaged. Convection needs ONE parcel with energy,
    #: not three: averaging MUCAPE 1500 with SBCAPE 0 and MLCAPE 200 reports
    #: a third of the real potential and systematically under-forecasts
    #: elevated and overnight storms -- the Spanish-plume case this platform
    #: exists to catch. Within a family the POTENTIAL parcels combine by
    #: MAXIMUM (the most unstable parcel is the one that goes) and the
    #: INHIBITION parcels by MINIMUM (the least-capped parcel is the one that
    #: can rise). Weights apply BETWEEN families, not inside one.
    family: str = ""

    #: True when the ingredient's reasoning only holds while the sun is up.
    #: Such an ingredient is WEIGHTED OUT after dark rather than scored zero:
    #: scoring it zero would drag the role's mean down and penalise a night,
    #: whereas the honest statement is that it has nothing to say.
    daylight_only: bool = False

    #: Which air parcel this field describes, for the CAPE/CIN fields.
    #: CAPE and CIN are only meaningful TOGETHER and only for the SAME
    #: parcel: most-unstable CIN is near zero on most days, so applying it to
    #: a surface parcel's CAPE removes essentially all inhibition, while
    #: applying surface CIN to an elevated parcel's CAPE suppresses exactly
    #: the overnight storms that parcel exists to find. The engine gates each
    #: parcel by its own cap and then takes the parcel most likely to go.
    parcel: str = ""

    #: How to collapse an ensemble to one field for THIS ingredient.
    #:
    #: "median" is the right default: it is robust, and for a continuous
    #: field (CAPE, dewpoint, cloud) it is the central solution.
    #:
    #: For an INTERMITTENT field it is degenerate. A per-cell median only
    #: returns a flash where a majority of members put a storm in the SAME
    #: cell, and members disagree about location far more than about whether
    #: storms occur. Measured on the 2026-08-29 12Z MOGREPS-UK cycle: at T+30
    #: the three members carried lightning over 0.66%, 0.46% and 0.43% of
    #: cells while their median carried it over 0.08% -- and at T+78 all
    #: three members forecast lightning somewhere while the median was zero
    #: EVERYWHERE, which scored a thundery day as "none".
    #:
    #: "mean" is used for those fields. The ensemble mean of a flash density
    #: is expected flash density: a well-defined physical quantity that keeps
    #: the signal in proportion to how many members produce it. The member
    #: FRACTION is still reported separately as the lightning probability;
    #: this only governs the deterministic risk index.
    ensemble_statistic: str = "median"


#: CAPE ramps to 2000 J/kg, not 1200.
#:
#: Anchored to what the UKV actually produces over UK/Ireland LAND, measured
#: across the 2026-08-29 12Z cycle (27 lead times, land cells only):
#:
#:     median 103   p90 632   p99 1080   p99.9 1393   max 2056  J/kg
#:
#: A 1200 ceiling put the top 1% of cells at 0.89 and the top 0.1% at 1.0, so
#: the index saturated across any moderately unstable area and reported 37%
#: of the domain as "severe" -- on a cycle where the model's own lightning
#: field forecast flashes over 1.1% of land cells. 2000 keeps the scale
#: discriminating right up to the strongest cell the model produced.
#:
#: This is a RANKING calibration, not a verified probability. It is anchored
#: to the model's climatology and cross-checked against the model's own
#: lightning coverage; verifying it against observed strikes is what
#: app/training exists for, and needs an archive this platform does not yet
#: have.
CAPE_RAMP_FULL = 2000.0

#: The full ingredient set, ordered by role.
INGREDIENTS: tuple[IngredientSpec, ...] = (
    # --- potential: can convection happen at all? -------------------------
    IngredientSpec(
        "cape_mixed_layer", Role.POTENTIAL, 100.0, 2000.0, 1.0,
        "mixed-layer CAPE -- the standard measure of how much energy a "
        "surface-based parcel has. 500 J/kg is a significant UK day.",
        units="J/kg",
        family="cape",
        parcel="mixed_layer",
    ),
    IngredientSpec(
        "cape_surface", Role.POTENTIAL, 100.0, 2000.0, 0.7,
        "surface-based CAPE -- responds faster to daytime heating than the "
        "mixed-layer value and catches shallow surface-driven convection.",
        units="J/kg",
        family="cape",
        parcel="surface",
    ),
    IngredientSpec(
        "cape_most_unstable", Role.POTENTIAL, 100.0, 2000.0, 0.8,
        "most-unstable CAPE -- the parcel that matters for ELEVATED and "
        "overnight storms, which surface-based measures miss entirely. "
        "Met Office local code 0/7/192, confirmed 2026-08-29: it is >= "
        "surface CAPE in 100.00% of cells, which is what parcel theory "
        "demands of a most-unstable field and of nothing else.",
        units="J/kg",
        family="cape",
        parcel="most_unstable",
    ),
    IngredientSpec(
        "lightning_flash_density_1h", Role.POTENTIAL, 1e-8, 1e-5, 1.4,
        "the model explicitly forecasting flashes -- a direct convective "
        "signal, and stronger evidence than any instability proxy.",
        units="flashes/km2/h", ensemble_statistic="mean",
    ),

    # --- inhibition: will it actually initiate? ----------------------------
    #
    # Inhibition is parcel-specific in a way instability is not. A surface
    # parcel can be firmly capped while an elevated one is not, which is
    # exactly the overnight/elevated storm the surface field would call
    # impossible -- so the most-unstable cap is weighted highest. All three
    # are Met Office codes confirmed on 2026-08-29 and order correctly:
    # MUCIN (mean -34) is less negative than MLCIN (-85) than SBCIN (-95),
    # as the least-inhibited parcel must be.
    IngredientSpec(
        "cin_most_unstable", Role.INHIBITION, -25.0, -150.0, 1.0,
        "most-unstable CIN -- the cap on the parcel that is actually most "
        "likely to go. If THIS is weak, convection is possible however "
        "strongly the surface is capped.",
        inverted=True, units="J/kg",
        family="cin",
        parcel="most_unstable",
    ),
    IngredientSpec(
        "cin_mixed_layer", Role.INHIBITION, -25.0, -150.0, 0.8,
        "mixed-layer CIN -- the cap on a realistically mixed boundary layer, "
        "the usual measure for surface-driven afternoon initiation.",
        inverted=True, units="J/kg",
        family="cin",
        parcel="mixed_layer",
    ),
    IngredientSpec(
        "cin", Role.INHIBITION, -25.0, -150.0, 0.6,
        "surface CIN -- the cap on an undiluted surface parcel. The most "
        "pessimistic of the three: it says nothing about elevated ascent.",
        inverted=True, units="J/kg",
        family="cin",
        parcel="surface",
    ),

    # --- intensity: how bad if it happens? --------------------------------
    IngredientSpec(
        "precip_rate_max_1h", Role.INTENSITY, 0.00055, 0.0055, 1.0,
        "peak hourly rainfall rate -- convective downpour intensity "
        "(2 to 20 mm/h).",
        units="kg/m2/s",
    ),
    IngredientSpec(
        "precip_rate", Role.INTENSITY, 0.00028, 0.0042, 0.8,
        "instantaneous rainfall rate (1 to 15 mm/h).",
        units="kg/m2/s",
    ),
    IngredientSpec(
        "precip_accum_1h", Role.INTENSITY, 1.0, 15.0, 0.9,
        "hourly rainfall total -- flash-flood potential.",
        units="kg/m2",
    ),
    IngredientSpec(
        "hail_fall_rate_max_1h", Role.INTENSITY, 1e-6, 1e-3, 1.0,
        "hail production.",
        units="kg/m2/s", ensemble_statistic="mean",
    ),
    IngredientSpec(
        "hail_accum_1h", Role.INTENSITY, 1e-4, 1e-1, 0.9,
        "hourly hail accumulation -- how MOGREPS-UK ships hail. Intermittent "
        "like lightning, so it is collapsed with a mean, not a median.",
        units="kg/m2", ensemble_statistic="mean",
    ),

    # --- modifiers: sharpen the picture -----------------------------------
    IngredientSpec(
        "shear_bulk_0_6km", Role.MODIFIER, 8.0, 20.0, 1.0,
        "deep-layer shear -- organises storms into multicells and "
        "supercells, making them longer-lived and more severe.",
        units="m/s",
    ),
    IngredientSpec(
        "lapse_rate_850_500", Role.MODIFIER, 5.5, 7.5, 0.9,
        "mid-level lapse rate -- steep lapse rates support strong updraughts "
        "and are the plume signature behind the biggest UK hail days.",
        units="K/km",
    ),
    IngredientSpec(
        "dewpoint_2m", Role.MODIFIER, 283.15, 291.15, 0.8,
        "surface moisture (10 to 18 C dewpoint) -- the fuel. High dewpoints "
        "raise both storm intensity and rainfall efficiency.",
        units="K",
    ),
    IngredientSpec(
        "freezing_level_height", Role.MODIFIER, 3600.0, 2200.0, 0.6,
        "freezing level -- a LOW freezing level lets hail reach the ground "
        "before melting, so lower means more hail risk.",
        inverted=True, units="m",
    ),
    IngredientSpec(
        "total_cloud_cover", Role.MODIFIER, 95.0, 40.0, 0.4,
        "cloud cover -- broken cloud allows the surface heating that drives "
        "afternoon initiation, so less cloud means more daytime potential. "
        "DAYLIGHT ONLY: after dark the reasoning inverts, because a clear "
        "night sky is the signature of no convection rather than of coming "
        "convection. Scored around the clock it lifted overnight risk above "
        "the afternoon peak.",
        inverted=True, units="%", daylight_only=True,
    ),
    IngredientSpec(
        "wind_speed_10m", Role.MODIFIER, 5.0, 18.0, 0.4,
        "surface wind -- contributes to damaging-gust potential and to "
        "storm motion.",
        units="m/s",
    ),
)

BY_NAME: dict[str, IngredientSpec] = {i.name: i for i in INGREDIENTS}


def by_role(role: Role) -> list[IngredientSpec]:
    return [i for i in INGREDIENTS if i.role is role]


def names() -> tuple[str, ...]:
    return tuple(i.name for i in INGREDIENTS)
