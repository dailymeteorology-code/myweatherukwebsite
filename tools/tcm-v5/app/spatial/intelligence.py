"""The assembled Stage 8 result.

Section 60's interface, adapted to what this project actually has. One
object holding terrain, coastal, boundary, neighbourhood, object and
regional layers for one model at one valid time, with every feature carrying
its own units, quality and provenance.

WHAT THIS IS NOT
----------------
Section 61: Stage 8 feeds the existing engines and does not replace them.
There is no thunderstorm score anywhere in this package, and
`no_forecast_quantities` asserts it -- a test walks every feature's unit and
fails if one is a probability. Stage 8's job ends at handing physical
quantities to Stage 5, geographic context to Stage 6, and spatial structure
to Stage 7.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from . import boundaries as B
from . import coast as C
from . import flow as F
from . import neighbourhood as N
from . import objects as O
from . import regional as R
from . import seabreeze as SB
from . import static as S
from . import terrain as T
from .feature import (
    Quality, SpatialFeature, check_forecast_safe,
)

log = logging.getLogger(__name__)

#: Units that would mean Stage 8 had started forecasting. A feature carrying
#: one of these is a bug, not a feature.
FORBIDDEN_UNITS = frozenset({"probability", "%", "risk", "score", "index"})


@dataclass(slots=True)
class SpatialIntelligence:
    """Section 60's structure, for one model at one time."""

    model: str
    run: datetime | None
    valid_time: datetime | None
    member: int | None
    grid_name: str
    processing_version: str

    geography: S.Geography
    terrain_geometry: T.TerrainGeometry
    coast: C.Coast
    terrain_flow: F.TerrainFlow | None = None
    sea_breeze: SB.SeaBreeze | None = None
    boundary_analysis: B.BoundaryAnalysis | None = None

    features: dict[str, SpatialFeature] = dc_field(default_factory=dict)
    spatial_objects: list[O.SpatialObject] = dc_field(default_factory=list)
    regional_context: dict[str, R.RegionContext] = dc_field(
        default_factory=dict
    )
    #: Distance to the nearest object of each kind, metres.
    distances: dict[str, np.ndarray] = dc_field(default_factory=dict)
    notes: list[str] = dc_field(default_factory=list)

    # -- integrity ---------------------------------------------------------

    def no_forecast_quantities(self) -> list[str]:
        """Features whose unit suggests Stage 8 has started forecasting."""
        bad = []
        for name, f in self.features.items():
            unit = (f.unit or "").strip().lower()
            if unit in FORBIDDEN_UNITS:
                bad.append(f"{name} carries unit {f.unit!r}")
        return bad

    def leakage(self, *, allow_observations: bool = False) -> list[str]:
        """Features that could not have existed at forecast time."""
        return check_forecast_safe(
            self.features, allow_observations=allow_observations
        )

    def integrity(self) -> list[str]:
        problems = self.no_forecast_quantities()
        problems += [
            f"{name} uses information unavailable at forecast time"
            for name in self.leakage()
        ]
        return problems

    # -- access ------------------------------------------------------------

    def at(self, iy: int, ix: int) -> dict[str, float | None]:
        """Every available feature at one grid cell."""
        return {
            name: f.at(iy, ix) for name, f in self.features.items()
            if f.available
        }

    def available(self) -> list[str]:
        return sorted(n for n, f in self.features.items() if f.available)

    def unavailable(self) -> dict[str, str]:
        return {
            n: f.reason for n, f in self.features.items() if not f.available
        }

    def objects_of(self, kind: B.BoundaryType) -> list[O.SpatialObject]:
        return [o for o in self.spatial_objects if o.kind is kind]

    def describe(self) -> dict:
        by_quality: dict[str, int] = {}
        for f in self.features.values():
            by_quality[f.quality.value] = by_quality.get(f.quality.value, 0) + 1
        return {
            "model": self.model,
            "run": self.run.isoformat() if self.run else None,
            "valid_time": (
                self.valid_time.isoformat() if self.valid_time else None
            ),
            "member": self.member,
            "grid": self.grid_name,
            "processing_version": self.processing_version,
            "geography": self.geography.describe(),
            "features": {
                "total": len(self.features),
                "available": len(self.available()),
                "by_quality": by_quality,
                "unavailable": self.unavailable(),
            },
            "objects": {
                kind.value: len(self.objects_of(kind))
                for kind in B.BoundaryType
                if self.objects_of(kind)
            },
            "integrity": self.integrity(),
            "notes": self.notes,
        }


@dataclass(frozen=True, slots=True)
class AtmosphericInputs:
    """The NWP fields Stage 8 consumes. Everything except wind is optional.

    Each missing field disables the diagnostics that need it, with a stated
    reason, rather than being replaced by an assumption.
    """

    u: np.ndarray
    v: np.ndarray
    temperature: np.ndarray | None = None
    theta_e: np.ndarray | None = None
    humidity: np.ndarray | None = None
    boundary_layer_depth: np.ndarray | None = None
    brunt_vaisala: np.ndarray | None = None
    cape: np.ndarray | None = None
    cin: np.ndarray | None = None
    wind_level: str = "unknown"
    hours_since_sunrise: float | None = None
    #: Extra fields to summarise at every neighbourhood scale, as
    #: name -> (values, unit).
    extra: dict[str, tuple[np.ndarray, str]] = dc_field(default_factory=dict)


def build(
    geo: S.Geography, atmosphere: AtmosphericInputs, *,
    model: str = "", run: datetime | None = None,
    valid_time: datetime | None = None, member: int | None = None,
    lonlat: tuple[np.ndarray, np.ndarray] | None = None,
    tracker: O.Tracker | None = None,
    neighbourhood_fields: tuple[str, ...] = ("cape", "cin", "humidity",
                                             "temperature", "convergence"),
) -> SpatialIntelligence:
    """Run the whole Stage 8 chain for one model at one time."""
    spacing = geo.spacing_m
    geom = T.geometry(geo)
    coastline = C.analyse(geo)

    features: dict[str, SpatialFeature] = {}
    features.update(T.features(geom))
    features.update(C.features(coastline))
    notes: list[str] = []

    if geo.mask_is_binary:
        notes.append(
            "the land mask is binary at 2 km: no cell is partly land, so "
            "sub-grid coastal mixing is carried by distance_to_coast rather "
            "than by a land fraction"
        )

    # -- terrain and flow ---------------------------------------------------
    wind = F.FlowInputs(
        u=atmosphere.u, v=atmosphere.v,
        brunt_vaisala=atmosphere.brunt_vaisala,
        wind_level=atmosphere.wind_level,
        layer_depth_m=(
            float(np.nanmedian(atmosphere.boundary_layer_depth))
            if atmosphere.boundary_layer_depth is not None else 1000.0
        ),
        model=model, run=run, valid_time=valid_time, member=member,
    )
    terrain_flow = F.compute(geom, wind)
    features.update(F.features(terrain_flow))

    # -- sea breeze ---------------------------------------------------------
    sea_breeze = None
    if atmosphere.temperature is not None:
        sst = SB.sea_surface_from_screen(atmosphere.temperature, coastline)
        sea_breeze = SB.compute(coastline, SB.SeaBreezeInputs(
            screen_temperature=atmosphere.temperature,
            u=atmosphere.u, v=atmosphere.v, sea_surface=sst,
            boundary_layer_depth=atmosphere.boundary_layer_depth,
            hours_since_sunrise=atmosphere.hours_since_sunrise,
            wind_level=atmosphere.wind_level, model=model, run=run,
            valid_time=valid_time, member=member,
        ))
        features.update(SB.features(sea_breeze))
    else:
        from .feature import unavailable
        for name, unit in (("land_sea_contrast", "K"),
                           ("sea_breeze_froude", "1"),
                           ("sea_breeze_convergence", "1/s")):
            features[name] = unavailable(
                name, unit,
                "no screen temperature was supplied, so no land-sea "
                "contrast can be formed and no sea-breeze diagnostic "
                "follows from it",
                method="sea_breeze", model=model, run=run,
                processing_version=S.PROCESSING_VERSION,
            )

    # -- boundaries ---------------------------------------------------------
    analysis = B.detect(B.BoundaryInputs(
        u=atmosphere.u, v=atmosphere.v, spacing_m=spacing,
        temperature=atmosphere.temperature, theta_e=atmosphere.theta_e,
        humidity=atmosphere.humidity,
        terrain_convergence=terrain_flow.terrain_convergence,
        sea_breeze_convergence=(
            sea_breeze.convergence if sea_breeze is not None else None
        ),
        model=model, run=run, valid_time=valid_time, member=member,
    ))
    features.update(B.features(analysis))
    features["outflow_boundary"] = B.outflow(model=model, run=run)

    # -- objects ------------------------------------------------------------
    max_evidence = max(len(analysis.ridges), 1)
    spatial_objects: list[O.SpatialObject] = []

    # THE COASTLINE IS NOT A FRONT. A land-sea temperature and moisture
    # contrast puts a ridge in temperature, humidity and theta-e along every
    # coast in the domain, and three agreeing evidence types is exactly the
    # front criterion -- so the whole coastline was being reported as
    # frontal, 913 objects of it. The contrast is real and it matters, but
    # it is a COASTAL boundary with its own physics and its own diagnostics
    # in `seabreeze.py`, not an air-mass front. Cells on the coastline are
    # therefore excluded from front detection, and reported as their own
    # type instead.
    off_coast = ~coastline.is_coastal
    front_mask = analysis.front & off_coast
    coastal_boundary = analysis.front & coastline.is_coastal

    thermal_evidence = analysis.evidence.get(
        "theta_e",
        analysis.evidence.get("temperature", analysis.total_convergence),
    )
    spatial_objects += O.extract(
        front_mask, thermal_evidence,
        B.BoundaryType.FRONT, spacing_m=spacing, intensity_unit="K/m",
        agreement=analysis.agreement, max_evidence=max_evidence,
        lonlat=lonlat, valid_time=valid_time,
        source_fields=tuple(analysis.ridges),
        lines_only=True, min_length_m=N.SCALE_EVENT_M,
    )
    spatial_objects += O.extract(
        coastal_boundary, thermal_evidence,
        B.BoundaryType.SEA_BREEZE, spacing_m=spacing, intensity_unit="K/m",
        agreement=analysis.agreement, max_evidence=max_evidence,
        lonlat=lonlat, valid_time=valid_time,
        source_fields=("coastal_thermal_contrast",),
        lines_only=True, min_length_m=N.SCALE_EVENT_M,
    )
    spatial_objects += O.extract(
        analysis.convergence_line, analysis.total_convergence,
        B.BoundaryType.CONVERGENCE_LINE, spacing_m=spacing,
        intensity_unit="1/s", agreement=analysis.agreement,
        max_evidence=max_evidence, lonlat=lonlat, valid_time=valid_time,
        source_fields=("convergence",), lines_only=True,
        min_length_m=N.SCALE_EVENT_M,
    )
    if sea_breeze is not None:
        spatial_objects += O.extract(
            sea_breeze.convergence > 0.0, sea_breeze.convergence,
            B.BoundaryType.SEA_BREEZE, spacing_m=spacing,
            intensity_unit="1/s", lonlat=lonlat, valid_time=valid_time,
            source_fields=("sea_breeze_convergence",), lines_only=True,
            min_length_m=N.SCALE_EVENT_M,
        )
    spatial_objects += O.extract(
        terrain_flow.terrain_convergence > 0.0,
        terrain_flow.terrain_convergence, B.BoundaryType.TERRAIN_DRIVEN,
        spacing_m=spacing, intensity_unit="1/s", lonlat=lonlat,
        valid_time=valid_time, source_fields=("orographic_ascent",),
        lines_only=True, min_length_m=N.SCALE_EVENT_M,
    )

    if tracker is not None and valid_time is not None:
        spatial_objects = tracker.update(spatial_objects, valid_time)
    else:
        for i, obj in enumerate(spatial_objects, start=1):
            obj.object_id = i

    distances: dict[str, np.ndarray] = {}
    for kind in B.BoundaryType:
        of_kind = [o for o in spatial_objects if o.kind is kind]
        if not of_kind:
            continue
        distances[kind.value] = O.distance_to_nearest(
            of_kind, geo.elevation.shape, spacing
        )
        features[f"distance_to_{kind.value}"] = SpatialFeature(
            name=f"distance_to_{kind.value}",
            values=distances[kind.value], unit="m", quality=Quality.GOOD,
            lineage=features["convergence"].lineage,
            provenance=features["convergence"].provenance,
            flags=(f"{len(of_kind)} {kind.value} object(s) detected; "
                   f"infinite where none exist, which is distinguishable "
                   f"from 'very far'",),
        )

    # -- neighbourhoods -----------------------------------------------------
    pool: dict[str, tuple[np.ndarray, str]] = {
        "convergence": (analysis.total_convergence, "1/s"),
        "orographic_ascent": (terrain_flow.orographic_ascent, "m/s"),
    }
    for name, unit in (("cape", "J/kg"), ("cin", "J/kg"),
                       ("humidity", "kg/kg"), ("temperature", "K")):
        values = getattr(atmosphere, name, None)
        if values is not None:
            pool[name] = (values, unit)
    pool.update(atmosphere.extra)

    summaries: dict[str, dict[str, N.Neighbourhood]] = {}
    for name in neighbourhood_fields:
        if name not in pool:
            continue
        values, unit = pool[name]
        summaries[name] = N.summarise(
            values, name=name, unit=unit, spacing_m=spacing
        )
    features.update(N.features(
        summaries, model=model, run=run, valid_time=valid_time, member=member
    ))

    # -- interactions -------------------------------------------------------
    interaction_pool = {
        "cape": atmosphere.cape, "cin": atmosphere.cin,
        "humidity": atmosphere.humidity,
        "upslope_flow": terrain_flow.upslope,
        "u": atmosphere.u, "v": atmosphere.v,
    }
    for name, (values, unit, meaning) in N.interactions(
        {k: v for k, v in interaction_pool.items() if v is not None}, spacing
    ).items():
        features[name] = SpatialFeature(
            name=name, values=values, unit=unit, quality=Quality.GOOD,
            lineage=features["convergence"].lineage,
            provenance=features["convergence"].provenance,
            flags=(meaning,),
        )

    # -- regional context ---------------------------------------------------
    regional_context: dict[str, R.RegionContext] = {}
    if lonlat is not None:
        regional_context = R.contexts(geo, geom, coastline, lonlat)

    result = SpatialIntelligence(
        model=model, run=run, valid_time=valid_time, member=member,
        grid_name=geo.grid.name, processing_version=S.PROCESSING_VERSION,
        geography=geo, terrain_geometry=geom, coast=coastline,
        terrain_flow=terrain_flow, sea_breeze=sea_breeze,
        boundary_analysis=analysis, features=features,
        spatial_objects=spatial_objects, regional_context=regional_context,
        distances=distances, notes=notes,
    )
    problems = result.integrity()
    if problems:
        for p in problems:
            log.error("Stage 8 integrity: %s", p)
    log.info(
        "spatial intelligence for %s: %d features (%d available), "
        "%d objects", model, len(features), len(result.available()),
        len(spatial_objects),
    )
    return result
