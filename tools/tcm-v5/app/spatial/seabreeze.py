"""Sea-breeze potential, direction, penetration and convergence.

Step 5 of the Stage 8 order, sections 17 to 22.

Section 17 names the mistake to avoid: defining sea-breeze potential as
"land warmer than sea". That condition holds over southern England on most
afternoons from April to September, and sea breezes do not form on most of
them. What stops them is the background wind.

THE PHYSICS, AND THE CRITERION THIS MODULE ACTUALLY USES
--------------------------------------------------------
A sea breeze is a DENSITY CURRENT driven by the horizontal pressure gradient
that a land-sea temperature contrast sets up. It has to work against the
background flow, which advects the developing circulation away and mixes the
contrast out.

The classical index is Biggs and Graves (1962, J. Appl. Meteor.), who
scaled the background kinetic energy against the thermal energy as
U^2/(c_p dT) and found lake breezes on Lake Erie below about 3. That number
is not used here, and the reason is worth recording because it was found by
testing rather than by reading. With c_p = 1004.6 J/kg/K, a 5 K contrast and
the criterion as written, suppression would require

    U = sqrt(3 * 1004.6 * 5) = 123 m/s

which no criterion can have meant. On the live grid it marked 99% of the
coast favourable in a 25 m/s gale. c_p dT is the total heat content of the
air, not the buoyancy energy available to drive a circulation over a
boundary layer, so the ratio is off by the depth of the layer and comes out
about two orders of magnitude too small.

The quantity that IS the right scale is the density-current speed, which
this module already needs for the front:

    c = k sqrt(g' H),   g' = g dT / T

with H the boundary-layer depth (Simpson 1997, "Gravity Currents", 2nd ed.;
k = 0.7 for atmospheric sea-breeze fronts). For a 5 K contrast through an
800 m boundary layer that is 8 m/s, and the suppression criterion becomes a
single physical statement with no free constant in it:

    THE FRONT ADVANCES WHEN ITS OWN SPEED EXCEEDS THE OPPOSING FLOW.

    advance = c + U_normal        [m/s]

Positive and the front moves inland; negative and it is held out to sea. The
ratio |U_normal| / c is the Froude number of the same statement, so the
suppression threshold sits at Fr = 1 -- around 8-12 m/s of opposing gradient
wind for typical UK contrasts, which is what is observed.

The background wind used is the COAST-NORMAL COMPONENT, not the wind speed.
An 8 m/s wind blowing along the Sussex coast does not fight a sea breeze the
way an 8 m/s wind blowing out to sea does.

Offshore and onshore background flow are also not symmetric, and the
asymmetry is physically important:

  * OFFSHORE background flow opposes the breeze. It holds the front near the
    coast or just inland, where it sharpens into a strong convergence line.
    This is the classic UK sea-breeze-front setup.
  * ONSHORE background flow carries the front inland quickly and the
    convergence is weak and diffuse -- there is a breeze but not a
    convergence line worth forecasting storms on.

`penetration` and `convergence` therefore respond differently to the sign,
and section 19's warning that a sea-breeze convergence zone is a forcing
mechanism rather than a thunderstorm hotspot is respected by keeping them
in physical units and letting Stage 5 judge.

THE SEA-SURFACE TEMPERATURE PROBLEM
-----------------------------------
Section 21 says not to fabricate SST where it is unavailable. It IS
unavailable: the UK DataHub order carries no sea-surface temperature field.

What it does carry is the screen temperature everywhere, including over the
sea. Over water the model's 1.5 m temperature is tightly coupled to the sea
surface temperature it was initialised with -- there is no diurnal cycle to
decouple them and the surface layer over water is close to neutral. So the
screen temperature over sea is used as a PROXY, the resulting features are
marked DEGRADED, and the reason travels with them. `SeaSurface.source` says
which it is, so a real SST field can replace the proxy without any consumer
silently changing meaning.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

import numpy as np

from .coast import Coast, alongshore_component, onshore_component
from .feature import Lineage, Provenance, Quality, SpatialFeature
from .static import PROCESSING_VERSION

log = logging.getLogger(__name__)

#: Specific heat of dry air at constant pressure, J/kg/K.
CP = 1004.6

#: Froude number above which the opposing flow is faster than the density
#: current and the front cannot advance. This is 1 by definition rather than
#: a tuned value: it is the statement "the front moves when its own speed
#: exceeds the flow opposing it", written as a ratio.
FROUDE_SUPPRESSED = 1.0

#: Radius over which the land and sea temperatures either side of a coast
#: are averaged, metres. A sea breeze is driven by the contrast between air
#: masses, not between two adjacent cells: 30 km is roughly the width of the
#: developing circulation on the day it forms, and matches the massif scale
#: used elsewhere so the two are comparable.
CONTRAST_RADIUS_M = 30_000.0

#: Density-current speed constant. The head of a density current advances at
#: u = k * sqrt(g' H), and laboratory and atmospheric measurements put k
#: between 0.6 and 1.1 (Simpson 1997, "Gravity Currents", 2nd ed.). 0.7 is
#: the value Simpson gives for atmospheric sea-breeze fronts specifically.
DENSITY_CURRENT_K = 0.7

#: Gravity, m/s2.
G = 9.80665

#: Numerical-noise floor on the land-sea contrast, K. The disc convolution
#: that forms the contrast carries rounding error of order 1e-13 K, which is
#: enough to start a density current under a calm wind. This is eight orders
#: of magnitude below any real contrast, so it excludes arithmetic noise
#: without excluding any weather.
CONTRAST_NOISE_K = 1e-6


class SSTSource(str, Enum):
    """What the sea-surface temperature actually is. Section 21."""

    #: A genuine sea-surface temperature analysis or forecast field.
    MEASURED = "measured"
    #: Screen temperature sampled over sea cells. Section 21 allows this
    #: only if it is declared, which is what this value does.
    SCREEN_PROXY = "screen_over_sea_proxy"


@dataclass(frozen=True, slots=True)
class SeaSurface:
    """The water temperature, and the truth about where it came from."""

    temperature: np.ndarray        # K, valid over sea cells
    source: SSTSource
    valid: np.ndarray              # where the value means anything

    @property
    def quality(self) -> Quality:
        return (
            Quality.GOOD if self.source is SSTSource.MEASURED
            else Quality.DEGRADED
        )

    @property
    def reason(self) -> str:
        if self.source is SSTSource.MEASURED:
            return ""
        return (
            "no sea-surface temperature field is available in the UK order, "
            "so the screen temperature over sea is used as a proxy. Over "
            "water the two are closely coupled -- there is no diurnal cycle "
            "to separate them -- but this is a proxy and not a measurement"
        )


def sea_surface_from_screen(
    screen_temperature: np.ndarray, coast: Coast
) -> SeaSurface:
    """Build the SST proxy from the screen temperature over sea."""
    sea = coast.geography.is_sea
    values = np.where(sea, screen_temperature, np.nan)
    return SeaSurface(
        temperature=values, source=SSTSource.SCREEN_PROXY,
        valid=sea & np.isfinite(screen_temperature),
    )


@dataclass(frozen=True, slots=True)
class SeaBreezeInputs:
    """Everything the sea-breeze diagnostics need."""

    #: Screen temperature over the whole grid, K.
    screen_temperature: np.ndarray
    #: Background wind, m/s. The gradient-level wind, not 10 m: the
    #: criterion is about the flow the circulation has to work against, and
    #: the 10 m wind is already partly the sea breeze itself once one forms.
    u: np.ndarray
    v: np.ndarray
    sea_surface: SeaSurface
    #: Boundary-layer depth, m. Sets the depth of the density current and
    #: therefore how fast its front advances.
    boundary_layer_depth: np.ndarray | None = None
    #: Hours since sunrise at the valid time, for inland penetration. None
    #: leaves penetration unavailable rather than assuming a time of day.
    hours_since_sunrise: float | None = None
    wind_level: str = "unknown"
    model: str = ""
    run: datetime | None = None
    valid_time: datetime | None = None
    member: int | None = None


@dataclass(frozen=True, slots=True)
class SeaBreeze:
    """Sea-breeze diagnostics, in physical units."""

    #: Land minus sea temperature across the coast, K. The driver.
    land_sea_contrast: np.ndarray
    #: Coast-normal background wind, m/s. Positive onshore, negative
    #: offshore. The quantity the breeze has to work against.
    opposing_wind: np.ndarray
    #: |opposing flow| / density-current speed. Above 1 the front cannot
    #: advance. NaN where the land is not warmer than the sea, because there
    #: is then no density current to take a ratio against.
    froude: np.ndarray
    #: Net speed of the front over the ground, m/s. Positive inland,
    #: NEGATIVE when the background flow holds it out to sea -- which is a
    #: real and common outcome, not a missing value.
    advance_speed: np.ndarray
    #: True where the front can actually advance inland. A physical
    #: statement (advance_speed > 0), not a threshold on a score.
    favourable: np.ndarray
    #: Direction the breeze blows towards, degrees from north. The onshore
    #: normal, which is what a density current follows.
    inflow_bearing: np.ndarray
    #: Speed of the density-current head, m/s.
    front_speed: np.ndarray
    #: How far inland the front has reached, m. None-safe: NaN without a
    #: time of day.
    penetration: np.ndarray
    #: Convergence at the sea-breeze front, s-1. Positive is convergence.
    convergence: np.ndarray
    inputs: SeaBreezeInputs
    coast: Coast


def compute(coast: Coast, inputs: SeaBreezeInputs) -> SeaBreeze:
    """All sea-breeze diagnostics for one time."""
    from scipy.ndimage import convolve

    from .coast import _disc

    geo = coast.geography
    spacing = geo.spacing_m
    land = geo.is_land
    screen = np.asarray(inputs.screen_temperature, "float64")

    # -- the contrast, between AIR MASSES not adjacent cells ---------------
    # Averaging over a disc either side of the coast. Land and sea are
    # averaged separately and each normalised by its own count, so a cell
    # with little land nearby still gets the true mean of what land there is
    # rather than a value diluted towards the sea.
    disc = _disc(CONTRAST_RADIUS_M, spacing)
    land_f = land.astype("float64")
    sea_f = (~land).astype("float64")
    finite = np.isfinite(screen)
    filled = np.where(finite, screen, 0.0)

    land_weight = convolve(land_f * finite, disc, mode="nearest")
    sea_weight = convolve(sea_f * finite, disc, mode="nearest")
    land_sum = convolve(filled * land_f * finite, disc, mode="nearest")
    sea_sum = convolve(filled * sea_f * finite, disc, mode="nearest")

    with np.errstate(invalid="ignore", divide="ignore"):
        land_mean = np.where(land_weight > 1e-6, land_sum / land_weight, np.nan)
        sea_mean = np.where(sea_weight > 1e-6, sea_sum / sea_weight, np.nan)
    contrast = land_mean - sea_mean

    # -- the background flow it works against ------------------------------
    onshore = onshore_component(coast, inputs.u, inputs.v)
    # The breeze blows onshore, so an OFFSHORE background wind opposes it.
    # `opposing_wind` keeps the sign: positive onshore, negative offshore.
    opposing = onshore

    # -- the density current -----------------------------------------------
    # A density-current head advances at k sqrt(g' H) with reduced gravity
    # g' = g dT / T, over the boundary layer the current fills. This is the
    # IDEALISED head speed: real fronts are slower, because the contrast
    # across the head is smaller than the land-sea contrast feeding it and
    # because friction over land is not in the formula.
    depth = inputs.boundary_layer_depth
    if depth is None:
        front_speed = np.full(contrast.shape, np.nan)
        froude = np.full(contrast.shape, np.nan)
        advance = np.full(contrast.shape, np.nan)
        favourable = np.zeros(contrast.shape, dtype=bool)
    else:
        with np.errstate(invalid="ignore", divide="ignore"):
            reduced_g = G * np.maximum(contrast, 0.0) / np.maximum(sea_mean, 1.0)
            front_speed = DENSITY_CURRENT_K * np.sqrt(
                np.maximum(reduced_g * np.asarray(depth, "float64"), 0.0)
            )
            # No contrast, no current. `> 0.0` is not enough: the disc
            # convolution carries rounding error of order 1e-13 K, so a
            # field with NO contrast at all produced tiny positive values,
            # a tiny front speed, and -- under a calm background wind -- an
            # advance that was positive. That marked 53,184 cells as
            # sea-breeze favourable on a uniform temperature field. The
            # floor below is a numerical-noise cutoff, eight orders of
            # magnitude beneath any real land-sea contrast, not a
            # meteorological threshold.
            front_speed = np.where(contrast > CONTRAST_NOISE_K, front_speed,
                                   np.nan)
            froude = np.where(
                front_speed > 1e-6, np.abs(opposing) / front_speed, np.nan
            )
        # Helped or hindered by the coast-normal background wind. Negative
        # means the front is held offshore.
        advance = front_speed + opposing

        # A sea-breeze FRONT is a distinguishable density-current head only
        # when the background flow does not overwhelm it -- in EITHER
        # direction. Strong offshore flow holds it out to sea; strong
        # onshore flow simply advects marine air inland with no front in it
        # at all. Froude uses |U|, so both are excluded, and a 25 m/s
        # onshore gale no longer reports a sea breeze running 500 km inland.
        favourable = (
            np.isfinite(advance) & (advance > 0.0)
            & np.isfinite(froude) & (froude < FROUDE_SUPPRESSED)
        )

    # -- how far inland ----------------------------------------------------
    if inputs.hours_since_sunrise is None or depth is None:
        penetration = np.full(contrast.shape, np.nan)
    else:
        seconds = max(0.0, float(inputs.hours_since_sunrise)) * 3600.0
        penetration = np.where(
            favourable, np.maximum(advance, 0.0) * seconds, np.nan
        )

    # -- convergence, AT THE FRONT -----------------------------------------
    convergence = _front_convergence(
        coast, opposing, front_speed, penetration, favourable
    )

    return SeaBreeze(
        land_sea_contrast=contrast, opposing_wind=opposing, froude=froude,
        advance_speed=advance, favourable=favourable,
        inflow_bearing=coast.onshore_bearing,
        front_speed=front_speed, penetration=penetration,
        convergence=convergence, inputs=inputs, coast=coast,
    )


def _front_convergence(
    coast: Coast, opposing: np.ndarray, front_speed: np.ndarray,
    penetration: np.ndarray, favourable: np.ndarray,
) -> np.ndarray:
    """Convergence at the sea-breeze front, s-1.

    Two things make this useful rather than decorative.

    FIRST, IT IS PLACED WHERE THE FRONT IS. The convergence is not smeared
    along the whole coast -- it sits at the distance inland the front has
    actually reached, which is what makes it a LINE, and what makes
    "distance to the nearest sea-breeze convergence" a meaningful feature
    downstream. Every cell on the Sussex coast carrying the same value would
    say nothing about where storms might fire.

    SECOND, IT IS STRONGEST WHERE THE BREEZE MEETS OPPOSING FLOW, which is
    the offshore background case. That is the classic UK setup: the front
    stalls a short distance inland and sharpens, instead of running away
    across the country. An onshore background wind carries the front inland
    quickly and the convergence is weak and diffuse.
    """
    spacing = coast.geography.spacing_m
    # The narrowest structure a grid can hold is two cells. A real
    # sea-breeze head is 1-2 km across and converges far more strongly than
    # this over that width; a 2 km model cannot resolve it and neither can
    # this diagnostic, so the value quoted is what the GRID can represent.
    width = 2.0 * spacing

    jump = np.where(
        favourable,
        np.nan_to_num(front_speed, nan=0.0) - np.minimum(opposing, 0.0),
        0.0,
    )
    strength = np.where(favourable, jump / width, 0.0)

    # The front is inland, where there is no local sea to form a contrast
    # with, so its strength and the distance it has run must be carried out
    # from the coast that launched it. Comparing each inland cell against
    # its OWN penetration -- which is undefined there -- placed the line
    # nowhere and left the field empty.
    reach = coast.project_from_coast(np.nan_to_num(penetration, nan=-1.0))
    strength = coast.project_from_coast(strength)

    inland = coast.signed_distance
    at_front = (reach >= 0.0) & (np.abs(inland - reach) <= width)
    return np.where(at_front, strength, 0.0)


# --------------------------------------------------------------------------
# Presentation
# --------------------------------------------------------------------------

def features(breeze: SeaBreeze) -> dict[str, SpatialFeature]:
    inputs = breeze.inputs
    sst = inputs.sea_surface
    quality = sst.quality
    reason = sst.reason

    flags: tuple[str, ...] = (
        "sea-breeze potential is an ENVIRONMENTAL diagnostic, not a "
        "prediction that a front will form at this cell",
    )
    if inputs.wind_level in ("10m", "unknown"):
        flags = flags + (
            "the background wind is the 10 m wind; once a breeze forms the "
            "10 m wind IS partly the breeze, so the criterion is being fed "
            "something it partly explains. A gradient-level wind is sounder",
        )

    def provenance(method: str, scale=None) -> Provenance:
        return Provenance(
            method=method,
            inputs=("temperature_2m", "u_wind", "v_wind", "land_cover"),
            model=inputs.model, run=inputs.run, valid_time=inputs.valid_time,
            member=inputs.member, scale_m=scale,
            processing_version=PROCESSING_VERSION,
            notes=(
                f"sea-surface temperature source: {sst.source.value}"
            ),
        )

    def add(out, name, values, unit, method, *, scale=None, extra=(),
            q=None, r=None):
        out[name] = SpatialFeature(
            name=name, values=values, unit=unit,
            quality=q or quality, lineage=Lineage.FORECAST,
            provenance=provenance(method, scale),
            reason=(r if r is not None else reason), flags=flags + extra,
        )

    out: dict[str, SpatialFeature] = {}
    add(out, "land_sea_contrast", breeze.land_sea_contrast, "K",
        "disc_mean_land_minus_disc_mean_sea", scale=CONTRAST_RADIUS_M,
        extra=("the contrast between air masses either side of the coast, "
               "not between two adjacent cells",))
    add(out, "sea_surface_temperature",
        np.where(sst.valid, sst.temperature, np.nan), "K",
        f"sea_surface_{sst.source.value}")
    add(out, "coast_normal_wind", breeze.opposing_wind, "m/s",
        "wind_projected_on_coast_normal",
        extra=("positive onshore, negative offshore. Offshore flow OPPOSES "
               "the breeze and sharpens its front",))
    add(out, "sea_breeze_froude", breeze.froude, "1",
        "opposing_flow_over_density_current_speed",
        extra=(f"|coast-normal wind| / front speed; above "
               f"{FROUDE_SUPPRESSED} the flow is faster than the current and "
               f"the front cannot advance. NaN where the sea is not colder "
               f"than the land and there is no current to compare against",))
    add(out, "sea_breeze_advance_speed", breeze.advance_speed, "m/s",
        "front_speed_plus_coast_normal_wind",
        extra=("negative means the front is held out to sea, which is a "
               "real outcome and not a missing value",))
    add(out, "sea_breeze_favourable", breeze.favourable.astype("float64"),
        "1", "advance_speed_positive",
        extra=("a flag, not a probability: the front can physically advance "
               "inland",))
    add(out, "sea_breeze_inflow_bearing", breeze.inflow_bearing,
        "degrees_from_north", "onshore_normal",
        extra=("the direction the breeze blows towards",))

    if np.all(np.isnan(breeze.front_speed)):
        from .feature import unavailable
        out["sea_breeze_front_speed"] = unavailable(
            "sea_breeze_front_speed", "m/s",
            "no boundary-layer depth was supplied, so the density-current "
            "speed k*sqrt(g'H) has no depth to work with",
            method="density_current_head_speed",
            processing_version=PROCESSING_VERSION,
        )
    else:
        add(out, "sea_breeze_front_speed", breeze.front_speed, "m/s",
            "density_current_head_speed",
            extra=(f"idealised head speed k={DENSITY_CURRENT_K} sqrt(g.H), "
               f"Simpson 1997. An UPPER BOUND: real fronts are slower",))

    if inputs.hours_since_sunrise is None:
        from .feature import unavailable
        out["sea_breeze_penetration"] = unavailable(
            "sea_breeze_penetration", "m",
            "inland penetration needs the time since sunrise, which was not "
            "supplied. Without it the distance would be an assumption about "
            "the time of day",
            method="front_speed_times_elapsed",
            processing_version=PROCESSING_VERSION,
        )
    else:
        add(out, "sea_breeze_penetration", breeze.penetration, "m",
            "front_speed_times_elapsed",
            extra=(f"{inputs.hours_since_sunrise:.1f} h since sunrise, "
                   f"advanced at the front speed plus the coast-normal "
                   f"background wind",))

    add(out, "sea_breeze_convergence", breeze.convergence, "1/s",
        "velocity_jump_over_front_width",
        extra=("strongest where the breeze meets OPPOSING background flow, "
               "which is the offshore case, not where the breeze itself is "
               "strongest",))
    return out
