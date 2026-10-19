"""Does Stage 8 actually help? Ablation and backtesting.

Steps 12, 13 and 14 of the Stage 8 order, sections 75, 76 and 45.

Section 75 sets the standard this module exists to enforce:

    Do not retain spatial features simply because they appear
    meteorologically plausible. They must demonstrate measurable value
    where possible.

and section 76 asks for the components to be removed one at a time, so that
complexity which contributes nothing can be found and dropped rather than
carried forever because it looks impressive.

WHAT CAN AND CANNOT BE MEASURED YET
-----------------------------------
Being straight about this matters more than producing a number.

MEASURABLE NOW: whether Stage 8 CHANGES the forecast, and by how much, and
which component is responsible. That is a real, verifiable quantity and
`ablate` computes it on live data. A component whose removal changes nothing
is doing nothing, and that conclusion needs no observations at all.

NOT MEASURABLE YET: whether the change is an IMPROVEMENT. That needs
verifying observations, which the platform does not have connected -- the
same gap that leaves Stage 6's skill store empty and every Stage 7
probability uncalibrated. `skill_comparison` therefore refuses to return a
skill number rather than inventing one, and says which observations it
needs.

The distinction is the whole point. A system that reported "Stage 8 improves
the forecast" on the strength of the forecast having changed would be
measuring its own activity and calling it skill.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from .intelligence import SpatialIntelligence
from .integrate import stage5_forcing

log = logging.getLogger(__name__)

#: The Stage 8 components that can be removed independently, and what each
#: withholds. Section 76's list.
COMPONENTS: dict[str, tuple[str, ...]] = {
    "terrain": (
        "elevation", "slope", "slope_degrees", "aspect", "curvature",
        "profile_curvature", "ridge_index", "valley_index", "ridge_bearing",
        "terrain_anisotropy",
    ),
    "terrain_flow": (
        "orographic_ascent", "upslope_flow", "downslope_flow",
        "terrain_convergence", "froude_number", "upwind_barrier",
        "lee_descent", "flow_slope_alignment", "flow_ridge_alignment",
    ),
    "coastal": (
        "distance_to_coast", "signed_distance_to_coast", "onshore_bearing",
        "coastline_bearing", "marine_exposure", "landmass_area", "is_island",
        "land_sea_contrast", "sea_surface_temperature", "coast_normal_wind",
        "sea_breeze_froude", "sea_breeze_advance_speed",
        "sea_breeze_favourable", "sea_breeze_front_speed",
        "sea_breeze_penetration", "sea_breeze_convergence",
        "sea_breeze_inflow_bearing",
    ),
    "boundaries": (
        "convergence", "wind_shift", "boundary_agreement", "front",
        "convergence_line", "temperature_gradient", "theta_e_gradient",
        "humidity_gradient", "frontogenesis_gradient",
        "terrain_convergence_part", "non_terrain_convergence",
    ),
    "neighbourhoods": (),      # matched by suffix, see `_withheld`
    "objects": (),             # matched by prefix distance_to_
    "regional": (),            # not a feature; removed by emptying context
}

#: Suffixes that identify a neighbourhood feature.
NEIGHBOURHOOD_SUFFIXES = ("_mean_", "_gradient_", "_range_")


@dataclass(slots=True)
class AblationRow:
    """What removing one component did."""

    component: str
    features_withheld: int
    #: Forcing values Stage 5 no longer receives.
    forcing_lost: tuple[str, ...]
    #: Mean absolute change in the initiation score across test points.
    mean_abs_change: float
    max_abs_change: float
    #: How many test points changed at all.
    points_changed: int
    points_total: int
    verdict: str

    def to_dict(self) -> dict:
        return {
            "component": self.component,
            "features_withheld": self.features_withheld,
            "forcing_lost": list(self.forcing_lost),
            "mean_abs_change": round(self.mean_abs_change, 5),
            "max_abs_change": round(self.max_abs_change, 5),
            "points_changed": self.points_changed,
            "points_total": self.points_total,
            "verdict": self.verdict,
        }


def _withheld(component: str, name: str) -> bool:
    """Is this feature part of the named component?"""
    if component == "neighbourhoods":
        return any(s in name for s in NEIGHBOURHOOD_SUFFIXES)
    if component == "objects":
        return name.startswith("distance_to_")
    return name in COMPONENTS.get(component, ())


def _forcing_without(
    si: SpatialIntelligence, iy: int, ix: int, component: str | None
) -> dict[str, float]:
    """Stage 5 forcing with one component's features withheld."""
    forcing = stage5_forcing(si, iy, ix)
    overrides = forcing.as_overrides()
    if component is None:
        return overrides

    from .integrate import STAGE5_FORCING
    lost = {
        stage5_name for stage5_name, feature_name in STAGE5_FORCING.items()
        if _withheld(component, feature_name)
    }
    if _withheld(component, "sea_breeze_convergence"):
        lost.add("sea_breeze_convergence")
    return {k: v for k, v in overrides.items() if k not in lost}


def ablate(
    si: SpatialIntelligence, parameters_at, points: list[tuple[int, int]], *,
    engine: str = "convective_initiation",
) -> list[AblationRow]:
    """Remove each component in turn and measure what the forecast does.

    `parameters_at(iy, ix)` must return the Stage 4 result for that cell;
    it is passed in rather than computed here so the caller controls how
    profiles are built and this stays testable with synthetic input.

    The measurement is deliberately CHANGE, not skill. See the module
    docstring: skill needs observations that do not exist yet, and reporting
    change as though it were skill would be measuring our own activity.
    """
    from ..engines import pipeline as ep

    cache: dict[tuple[int, int], object] = {}

    def score_with(iy: int, ix: int, forcing: dict[str, float]) -> float | None:
        key = (iy, ix)
        if key not in cache:
            cache[key] = parameters_at(iy, ix)
        params = cache[key]
        if params is None:
            return None
        elevation = float(si.geography.elevation[iy, ix])
        result = ep.run_for_parameters(
            params, elevation=elevation, forcing=forcing
        )
        found = result.results.get(engine)
        return getattr(found, "score", None) if found else None

    baseline: dict[tuple[int, int], float] = {}
    for iy, ix in points:
        value = score_with(iy, ix, _forcing_without(si, iy, ix, None))
        if value is not None:
            baseline[(iy, ix)] = value

    rows: list[AblationRow] = []
    for component in COMPONENTS:
        withheld = sum(
            1 for name in si.features if _withheld(component, name)
        )
        changes: list[float] = []
        lost: set[str] = set()
        for (iy, ix), base in baseline.items():
            full = _forcing_without(si, iy, ix, None)
            reduced = _forcing_without(si, iy, ix, component)
            lost |= set(full) - set(reduced)
            value = score_with(iy, ix, reduced)
            if value is not None:
                changes.append(abs(value - base))

        array = np.array(changes) if changes else np.array([0.0])
        changed = int((array > 1e-9).sum())
        mean_change = float(array.mean())

        if not baseline:
            verdict = "NOT MEASURED -- no test point produced a score"
        elif changed == 0:
            verdict = (
                f"NO EFFECT on {engine}. Section 76: a component that "
                f"changes nothing is carrying complexity for nothing. It "
                f"may still matter to an engine not tested here"
            )
        else:
            verdict = (
                f"changes {engine} at {changed}/{len(baseline)} points, "
                f"mean {mean_change:.4f}. Whether that is an IMPROVEMENT "
                f"needs observations, which are not connected"
            )

        rows.append(AblationRow(
            component=component, features_withheld=withheld,
            forcing_lost=tuple(sorted(lost)),
            mean_abs_change=mean_change,
            max_abs_change=float(array.max()),
            points_changed=changed, points_total=len(baseline),
            verdict=verdict,
        ))

    rows.sort(key=lambda r: r.mean_abs_change, reverse=True)
    return rows


def report(rows: list[AblationRow]) -> dict:
    """The ablation as a plain structure."""
    inert = [r.component for r in rows if r.points_changed == 0]
    return {
        "note": (
            "measures whether Stage 8 CHANGES the forecast and which "
            "component is responsible. It does NOT measure whether the "
            "change is an improvement: that needs verifying observations, "
            "which are not connected"
        ),
        "components": [r.to_dict() for r in rows],
        "inert_components": inert,
        "recommendation": (
            f"section 76: {', '.join(inert)} changed nothing measured here "
            f"and should be justified or dropped"
            if inert else
            "every component changed the forecast somewhere"
        ),
    }


def skill_comparison(*_args, **_kwargs) -> dict:
    """Section 75's TCM-with vs TCM-without skill comparison.

    Refuses rather than returns a number. The comparison needs observed
    thunderstorm occurrence over a set of historical cases; the platform has
    no verification pairs, which is the same gap that leaves Stage 6's skill
    store empty and every Stage 7 probability uncalibrated.

    Producing a plausible-looking skill score here would be worse than
    producing nothing, because it would be believed.
    """
    return {
        "available": False,
        "reason": (
            "no verifying observations are connected, so whether Stage 8 "
            "improves the forecast cannot be measured. `ablate` measures "
            "what it CHANGES, which is a different and weaker claim"
        ),
        "needs": [
            "observed lightning within the event radius, for a set of "
            "historical cases",
            "Stage 8 features reconstructed as of each case's forecast time",
            "the same cases run with and without spatial forcing",
        ],
        "blocked_by": (
            "the lightning archive is not wired into the verification "
            "store; this blocks Stage 6 calibration and Stage 7 "
            "publishability identically"
        ),
    }


def leakage_audit(
    si: SpatialIntelligence, *, historical: bool = True
) -> dict:
    """Step 14. Confirm no forecast-time feature uses later information.

    `historical=True` is the strict mode used for backtesting: any feature
    with OBSERVATION lineage is a violation. Live operation may legitimately
    use real-time observations, and passing `historical=False` says so
    explicitly rather than letting the distinction blur.
    """
    violations = si.leakage(allow_observations=not historical)
    by_lineage: dict[str, int] = {}
    for f in si.features.values():
        by_lineage[f.lineage.value] = by_lineage.get(f.lineage.value, 0) + 1

    return {
        "mode": "historical_reconstruction" if historical else "live",
        "clean": not violations,
        "violations": violations,
        "features_by_lineage": by_lineage,
        "note": (
            "static geography is time-invariant and cannot leak. Forecast "
            "features come from the NWP fields at the forecast time. The "
            "only route to leakage is an observational input, and outflow "
            "detection -- the one component that needs observations -- is "
            "unavailable"
        ),
    }
