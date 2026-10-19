"""Where the production forecast is evaluated.

Section 2: the production layer orchestrates, it does not rewrite the
science. This module is the adapter that turns a cycle into a set of Stage 7
forecasts by calling Stages 3 to 7 exactly as they are.

WHY POINTS AND NOT THE GRID
---------------------------
The TCM grid is 290,745 cells. Stage 4's parcel ascent is vectorised
(`parameters/gridded.py`, measured at 67 s for the full grid), but Stage 4's
`compute`, all of Stage 5 and all of Stage 7 still run per point. Running
the full chain on every cell is therefore not currently possible in an
operational window, and pretending otherwise would either produce a forecast
that never finishes or one quietly computed on a coarser grid than it claims.

So production evaluates a declared set of points, and says so. Every product
built from them carries the same statement. This is a known limitation with
a known fix -- wiring the gridded ascent into a gridded Stage 4/5/7 -- and
it is recorded rather than hidden.

THE POINTS ARE THE UK'S POPULATION AND ITS METEOROLOGY
------------------------------------------------------
Chosen to cover the regions Stage 8 defines and the terrain and coastal
situations that make UK convection distinctive, so that a forecast built
from them is not silently blind to a class of setup.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

log = logging.getLogger(__name__)

POINTS_VERSION = "stage10.1"


@dataclass(frozen=True, slots=True)
class ForecastPoint:
    """One place the production forecast is evaluated."""

    name: str
    lon: float
    lat: float
    region: str
    #: Why this point is in the set, so the coverage can be argued about.
    rationale: str = ""


#: The production point set. Not a grid, and the products say so.
POINTS: tuple[ForecastPoint, ...] = (
    ForecastPoint("London", -0.13, 51.51, "south-east England",
                  "largest population centre"),
    ForecastPoint("Birmingham", -1.90, 52.48, "the Midlands",
                  "inland, far from any coast: the classic UK plume target"),
    ForecastPoint("Manchester", -2.24, 53.48, "northern England",
                  "lee of the Pennines in a westerly"),
    ForecastPoint("Leeds", -1.55, 53.80, "northern England",
                  "east of the Pennines"),
    ForecastPoint("Norwich", 1.30, 52.63, "eastern England",
                  "North Sea coastal convection and sea-breeze fronts"),
    ForecastPoint("Bristol", -2.59, 51.45, "south-west England",
                  "Severn estuary convergence"),
    ForecastPoint("Exeter", -3.53, 50.72, "south-west England",
                  "peninsula with sea breezes from both coasts"),
    ForecastPoint("Brighton", -0.14, 50.82, "south-east England",
                  "south-coast sea breeze against the Downs"),
    ForecastPoint("Cardiff", -3.18, 51.48, "Wales",
                  "coastal south Wales below the valleys"),
    ForecastPoint("Aberystwyth", -4.08, 52.41, "Wales",
                  "west Wales coast, upwind of Snowdonia"),
    ForecastPoint("Snowdonia", -3.95, 53.05, "Wales",
                  "orographic ascent on the highest Welsh terrain"),
    ForecastPoint("Newcastle", -1.61, 54.98, "northern England",
                  "north-east coast"),
    ForecastPoint("Carlisle", -2.94, 54.89, "northern England",
                  "Solway gap between two upland masses"),
    ForecastPoint("Glasgow", -4.25, 55.86, "southern Scotland",
                  "central belt"),
    ForecastPoint("Edinburgh", -3.19, 55.95, "southern Scotland",
                  "east coast of the central belt"),
    ForecastPoint("Inverness", -4.22, 57.48, "northern Scotland",
                  "Moray Firth, lee of the Highlands"),
    ForecastPoint("Fort William", -5.11, 56.82, "northern Scotland",
                  "windward of the highest UK terrain"),
    ForecastPoint("Belfast", -5.93, 54.60, "Northern Ireland",
                  "Northern Ireland's population centre"),
    ForecastPoint("Dublin", -6.26, 53.35, "Ireland",
                  "east coast of Ireland"),
    ForecastPoint("Cambridge", 0.12, 52.21, "eastern England",
                  "flat, dry, inland east: the driest UK convective setting"),
)

#: Lead times to evaluate. UKV publishes 6-hourly to T+54; these are the
#: ones a day-ahead thunderstorm product needs.
LEAD_HOURS: tuple[int, ...] = (6, 12, 18, 24, 30, 36)

#: Spacing of the supplementary land grid, degrees of latitude. 0.35 is
#: about 39 km, which is chosen from what the forecast can actually
#: resolve rather than from what looks tidy: the model's effective
#: resolution is ~12 km and a convective outbreak is tens of kilometres
#: across, so this samples the field without pretending to detail the
#: point set cannot carry.
GRID_SPACING_DEG = 0.35

#: The land box the supplementary points are drawn from.
UK_LON = (-10.5, 1.9)
UK_LAT = (49.9, 58.7)


def _supplementary_points() -> tuple[ForecastPoint, ...]:
    """A coarse land grid, to fill the gaps between the named places.

    THE NAMED POINTS ARE NOT ENOUGH ON THEIR OWN. Twenty locations chosen
    for population and for meteorological interest leave most of the
    country unsampled, and a storm between them is invisible to the
    forecast rather than merely unremarked.

    Adding a regular land grid is affordable because of a measured change:
    the per-point cost fell from 1373 ms to 443 ms when the effective-inflow
    scan gained its exact short-circuit, so a few hundred points now fit
    inside an operational window where twenty was already most of it.

    This is still NOT a gridded forecast and nothing here pretends
    otherwise. It is a denser sample, and `describe()` says so.
    """
    try:
        from ..forecast import landmask
        from ..grid import grid_lonlat, tcm_grid
        from ..spatial import regional
    except Exception:                       # noqa: BLE001
        return ()

    try:
        land = landmask.land_mask()
        if land is None:
            return ()
        lons, lats = grid_lonlat(tcm_grid())
    except Exception:                       # noqa: BLE001
        log.warning("could not build the supplementary point grid",
                    exc_info=True)
        return ()

    # Candidate lon/lat pairs first, then ONE blocked nearest-cell lookup.
    # Searching the 290,745-cell grid separately for each candidate took six
    # seconds; doing it in blocks takes a fraction of that.
    candidates: list[tuple[float, float]] = []
    for lat in np.arange(UK_LAT[0], UK_LAT[1], GRID_SPACING_DEG):
        # Constant spacing in longitude would crowd the north: a degree of
        # longitude at 58N is 59% of its length at 50N.
        step = GRID_SPACING_DEG / max(np.cos(np.radians(lat)), 0.3)
        for lon in np.arange(UK_LON[0], UK_LON[1], step):
            candidates.append((float(lon), float(lat)))
    if not candidates:
        return ()

    query = np.asarray(candidates, dtype=float)
    flat_lon = np.asarray(lons, dtype=float).ravel()
    flat_lat = np.asarray(lats, dtype=float).ravel()
    flat_land = np.asarray(land, dtype=bool).ravel()

    # Cosine-weighted separation, so "nearest" means nearest on the ground
    # rather than nearest in degrees -- at 58N a degree of longitude is a
    # little over half a degree of latitude, and ignoring that biases the
    # northern points towards whichever cell is closest in raw degrees.
    scale = np.cos(np.radians(query[:, 1]))
    nearest = np.empty(len(query), dtype=np.intp)
    for i in range(0, len(query), 64):       # blocked, to bound the memory
        block = query[i:i + 64]
        dx = (flat_lon[None, :] - block[:, 0:1]) * scale[i:i + 64, None]
        dy = flat_lat[None, :] - block[:, 1:2]
        nearest[i:i + 64] = np.argmin(dx * dx + dy * dy, axis=1)

    named = {(round(p.lat, 1), round(p.lon, 1)) for p in POINTS}
    out: list[ForecastPoint] = []
    for (lon, lat), cell in zip(candidates, nearest):
        if (round(lat, 1), round(lon, 1)) in named:
            continue
        if not bool(flat_land[cell]):
            continue
        region = regional.region_of(lon, lat)
        out.append(ForecastPoint(
            name=f"{lat:.2f}N {abs(lon):.2f}{'W' if lon < 0 else 'E'}",
            lon=lon, lat=lat,
            # A real region, not a placeholder: the regional products group
            # on this field, and a bucket called "grid" holding 90% of the
            # points would make the regional breakdown meaningless.
            region=region.name if region is not None else "outside_regions",
            rationale="supplementary land grid point",
        ))
    return tuple(out)


_supplementary: tuple[ForecastPoint, ...] | None = None


def all_points() -> tuple[ForecastPoint, ...]:
    """Named places plus the supplementary land grid."""
    global _supplementary
    if _supplementary is None:
        _supplementary = _supplementary_points()
    return POINTS + _supplementary


def evaluate_points(
    cycle: datetime, *, spatial=None, model_id: str = "ukv",
    points: tuple[ForecastPoint, ...] | None = None,
    lead_hours: tuple[int, ...] = LEAD_HOURS,
) -> list:
    """Run Stages 3 to 7 at every point and lead time.

    Returns Stage 7 `TCMForecast` objects, unmodified. Every failure is
    logged and skipped rather than substituted: section 9 forbids inventing
    a forecast for a point that could not be evaluated.
    """
    from ..engines import pipeline as engine_pipeline
    from ..grid import grid_lonlat, tcm_grid
    from ..profiles.build import build_profile, point_profile
    from ..skill import identity as ident
    from ..spatial import integrate as spatial_integrate
    from ..tcm import forecast as tcm_forecast

    points = points if points is not None else all_points()
    lons, lats = grid_lonlat(tcm_grid())
    out: list = []
    attempted = failed = 0

    for hour in lead_hours:
        try:
            cube = build_profile(model_id, cycle, hour)
        except (LookupError, ValueError) as exc:
            log.info("no profile for T+%d: %s", hour, exc)
            continue
        if not cube.usable:
            continue
        valid_time = None

        for point in points:
            attempted += 1
            try:
                distance = (lons - point.lon) ** 2 + (lats - point.lat) ** 2
                iy, ix = np.unravel_index(
                    int(np.argmin(distance)), distance.shape
                )
                profile = point_profile(
                    cube, int(iy), int(ix),
                    latitude=float(lats[iy, ix]),
                    longitude=float(lons[iy, ix]),
                )
                valid_time = profile.metadata.valid_time

                forcing = None
                elevation = None
                if spatial is not None:
                    supplied = spatial_integrate.stage5_forcing(
                        spatial, int(iy), int(ix)
                    )
                    forcing = supplied.as_overrides()
                    elevation = supplied.context.get("elevation")

                specialist = engine_pipeline.run_for_profile(
                    profile, elevation=elevation, forcing=forcing
                )
                forecast = tcm_forecast.produce(
                    {(model_id, None): specialist.results},
                    run=cycle, valid_time=valid_time, forecast_hour=hour,
                    identities={model_id: ident.identify(model_id)},
                    latitude=float(lats[iy, ix]),
                    longitude=float(lons[iy, ix]),
                    output_grid_spacing_m=2000.0,
                )
                out.append(forecast)
            except Exception as exc:            # noqa: BLE001
                failed += 1
                log.warning(
                    "point %s at T+%d could not be evaluated: %r",
                    point.name, hour, exc,
                )

    log.info(
        "production points: %d forecast(s) from %d attempt(s), %d failed",
        len(out), attempted, failed,
    )
    return out


def describe() -> dict:
    """What the production forecast actually covers."""
    everything = all_points()
    by_region: dict[str, list[str]] = {}
    for point in everything:
        by_region.setdefault(point.region, []).append(point.name)
    return {
        "version": POINTS_VERSION,
        "points": len(everything),
        "named_places": len(POINTS),
        "supplementary_grid": len(everything) - len(POINTS),
        "grid_spacing_deg": GRID_SPACING_DEG,
        "lead_hours": list(LEAD_HOURS),
        "by_region": {k: sorted(v) for k, v in sorted(by_region.items())},
        "coverage": (
            f"{len(everything)} points across {len(by_region)} regions at "
            f"{len(LEAD_HOURS)} lead times"
        ),
        "limitation": (
            "the production forecast is evaluated at POINTS, not on the "
            "2 km grid. Stage 4's parcel ascent is vectorised but Stage 4's "
            "compute, Stage 5 and Stage 7 still run per point, so a full "
            "grid pass is not achievable in an operational window. Every "
            "product built from this carries the same statement rather "
            "than implying grid coverage it does not have"
        ),
    }
