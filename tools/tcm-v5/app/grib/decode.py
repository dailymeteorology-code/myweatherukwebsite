"""GRIB2 decoding, with the grid read from the file rather than assumed.

The Met Office "ground" bundle packs twelve parameters into a single GRIB2
file, and several of them share a parameter code -- rain precipitation rate
and its 1-hour maximum are both discipline 0 / category 1 / number 65, and
differ only in the product definition template and the statistical processing
type. Matching on shortName alone silently confuses them, so the matcher here
keys on the full tuple.

Run `python -m app.grib.decode <file.grib2>` to dump exactly what a file
contains; the mapping table below was built from that output rather than from
documentation.
"""
from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

from ..crs import WGS84
from ..grid import Field
from ..meta import FieldMeta, GridSpec, MemberKind
from ..params import get as get_param
from ..registry import ModelSpec

log = logging.getLogger(__name__)

# Statistical processing codes (GRIB2 code table 4.10)
STAT_AVERAGE = 0
STAT_ACCUMULATION = 1
STAT_MAXIMUM = 2

# ecCodes is NOT thread-safe: its handle creation and definition lookup use
# shared global state. The ingest pipeline decodes several parameters out of
# one bundle concurrently, which without this lock produces spurious
# "Decoding invalid" and "no definitions found" errors that look like corrupt
# downloads. Every entry point into the C library goes through this lock.
_ECCODES_LOCK = threading.RLock()

# Scanning a 6 MB bundle walks every message, and the ground bundle is scanned
# once per parameter extracted from it. Cache by path and mtime.
_SCAN_CACHE: dict[tuple[str, float, int], list["MessageInfo"]] = {}
_SCAN_CACHE_LOCK = threading.Lock()


@dataclass(frozen=True, slots=True)
class Selector:
    """How to recognise one canonical parameter inside a GRIB2 file."""

    discipline: int
    category: int
    number: int
    # None = do not care; otherwise the message must match.
    statistical_processing: int | None = None
    level_type: int | None = None          # typeOfFirstFixedSurface
    level_value: float | None = None

    def matches(self, m: "MessageInfo") -> bool:
        if (m.discipline, m.category, m.number) != (
            self.discipline, self.category, self.number
        ):
            return False
        if self.statistical_processing is None:
            # An instantaneous field must NOT match a processed message.
            if m.statistical_processing is not None:
                return False
        elif m.statistical_processing != self.statistical_processing:
            return False
        if self.level_type is not None and m.level_type != self.level_type:
            return False
        if self.level_value is not None and m.level_value is not None:
            if abs(m.level_value - self.level_value) > 1e-6:
                return False
        return True


# Canonical parameter -> the selectors that may satisfy it, in priority order.
#
# CALIBRATED against the live UKV bundles on 2026-08-28 by dumping every
# message (see __main__ below). Several of these are Met Office LOCAL codes
# that do not appear in the WMO tables and that eccodes reports as "unknown":
#
#     0/2/195  10 m wind speed, surface-adjusted
#     0/7/193  mixed-layer CAPE, lowest 500 m
#     0/1/73   hail fall rate
#
# Guessing these from the WMO tables gives the wrong field silently, so they
# are pinned here from observed output, not from documentation.
SELECTORS: dict[str, tuple[Selector, ...]] = {
    # Screen vs ground temperature share 0/0/0 and differ only by surface.
    # eccodes reports the screen level as 2, not the 1.5 in the Met Office
    # file name, so the level value is deliberately not pinned.
    "temperature_2m": (Selector(0, 0, 0, level_type=103),),
    "temperature_surface": (Selector(0, 0, 0, level_type=1),),

    "pressure_surface": (Selector(0, 3, 0),),

    # Boundary layer height. Read from a real UKV message on 2026-08-31:
    # 0/3/18 "blh" on typeOfFirstFixedSurface 166, which is NOT one of the
    # familiar surface types -- guessing it from the WMO tables would have
    # matched nothing. Stage 4 prefers this over any reconstruction, because
    # a model's boundary layer is defined by its own turbulence scheme.
    "boundary_layer_height": (Selector(0, 3, 18, level_type=166),
                              Selector(0, 3, 18)),
    "pressure_msl": (Selector(0, 3, 1, level_type=101), Selector(0, 3, 1)),
    "total_cloud_cover": (Selector(0, 6, 1),),

    # Static geography, verified live on the 2026-09-01 00Z UKV bundle. Both
    # are discipline 2 (land surface), which is why neither turns up when
    # searching the discipline-0 meteorological tables.
    #
    #   2/0/7  "mterh"  Model terrain height   ground_model-terrain-height
    #   2/0/0  "lsm"    Land-sea mask          ground_land-cover
    #
    # The Met Office ships the mask under a parameter named "land-cover",
    # which suggests a vegetation classification. It is not: the GRIB is a
    # 0-1 land FRACTION, and Stage 8 uses it as the land-sea mask.
    "terrain_height": (Selector(2, 0, 7, level_type=1), Selector(2, 0, 7)),
    "land_cover": (Selector(2, 0, 0, level_type=1), Selector(2, 0, 0)),

    # 10 m wind components. The order also carries a surface-ADJUSTED wind
    # speed on the Met Office local 0/2/195; these are the plain components,
    # which are what a vector calculation (upslope flow, coastal convergence)
    # needs. Speed alone cannot say which way the air is going.
    "u_wind_10m": (Selector(0, 2, 2, level_type=103, level_value=10.0),
                   Selector(0, 2, 2, level_type=103)),
    "v_wind_10m": (Selector(0, 2, 3, level_type=103, level_value=10.0),
                   Selector(0, 2, 3, level_type=103)),
    "wind_speed_10m": (
        Selector(0, 2, 195, level_type=103),   # Met Office surface-adjusted
        Selector(0, 2, 1, level_type=103),     # WMO wind speed, other centres
    ),
    "freezing_level_height": (
        Selector(0, 3, 34, level_type=4),      # geometrical height, 0 C isotherm
        # What the UKV order actually ships (verified 2026-08-29): GEOpotential
        # height on the zero-isotherm surface, in gpm. Geopotential and
        # geometric height differ by under 0.1% at 1-4 km, which is far inside
        # the accuracy this ingredient is used to -- it only has to say whether
        # hail survives the fall.
        Selector(0, 3, 5, level_type=4),
        Selector(0, 3, 6, level_type=4),
    ),

    # CAPE and CIN families, from the six-parameter ground bundle added to
    # the UKV order on 2026-08-29.
    #
    #     CAPE   surface 0/7/6    "mixed-layer" 0/7/193  "most-unstable" 0/7/192
    #     CIN    surface 0/7/7    "mixed-layer" 0/7/195  "most-unstable" 0/7/194
    #
    # THE LOCAL CODES ARE CONFIRMED (2026-08-29, order o162450439327).
    #
    # 0/7/6 and 0/7/7 are WMO standard codes. The other four are Met Office
    # locals that ecCodes reports as "unknown". They are identified by the
    # order's own `parameters` array, which lists the twelve names in the
    # order the messages appear in the bundle -- checked five ways:
    #
    #   1. The six precipitation/hail messages match their names by
    #      discipline/category/number/statistic independently.
    #   2. `cape-surface` lands on 0/7/6, the WMO CAPE code.
    #   3. `cin-surface` lands on 0/7/7, the WMO CIN code.
    #   4. Parcel theory: the surface parcel is inside the most-unstable
    #      search set, so MUCAPE >= SBCAPE must hold at EVERY cell. Under
    #      this mapping 0/7/192 >= 0/7/6 in 100.00% of 290,745 cells. No
    #      other assignment achieves that.
    #   5. Inhibition orders correctly -- the most unstable parcel is the
    #      least inhibited: MUCIN mean -34, MLCIN -85, SBCIN -95 J/kg.
    #
    # An earlier attempt could not settle this because the order then carried
    # only the two locals with no WMO-coded field to anchor them against.
    #
    # Note MUCAPE >= MLCAPE does NOT hold everywhere (59%), and should not be
    # expected to: the most-unstable search is over individual parcels, and a
    # 500 m mixed parcel is not in that set.
    "cape_surface": (Selector(0, 7, 6),),
    "cape_mixed_layer": (
        Selector(0, 7, 193),                   # Met Office local: ML, lowest 500 m
        Selector(0, 7, 6, level_type=108),     # WMO layer form, other centres
    ),
    "cape_most_unstable": (Selector(0, 7, 192),),
    "cin": (Selector(0, 7, 7),),
    "cin_mixed_layer": (Selector(0, 7, 195),),
    "cin_most_unstable": (Selector(0, 7, 194),),

    "dewpoint_2m": (Selector(0, 0, 6, level_type=103),),
    "wind_direction_10m": (
        Selector(0, 2, 194, level_type=103),   # Met Office local, surface-adjusted
        Selector(0, 2, 0, level_type=103),     # WMO wind direction
    ),

    "precip_rate": (Selector(0, 1, 65), Selector(0, 1, 7)),
    "precip_rate_max_1h": (
        Selector(0, 1, 65, statistical_processing=STAT_MAXIMUM),
        Selector(0, 1, 7, statistical_processing=STAT_MAXIMUM),
    ),
    # UKV encodes hourly rainfall as 0/1/52 ("tp"); MOGREPS-UK encodes it as
    # 0/1/65 with accumulation ("tirf", time integral of rain flux). Both are
    # listed. There is no collision with precip_rate/precip_rate_max_1h because
    # those are instantaneous and maximum respectively, never accumulation.
    "precip_accum_1h": (
        Selector(0, 1, 52, statistical_processing=STAT_ACCUMULATION),
        Selector(0, 1, 65, statistical_processing=STAT_ACCUMULATION),
        Selector(0, 1, 8, statistical_processing=STAT_ACCUMULATION),
    ),
    "snowfall_rate_water_eq": (Selector(0, 1, 53),),
    "snow_depth_water_eq": (Selector(0, 1, 60), Selector(0, 1, 13)),
    "snowfall_accum_1h_water_eq": (
        Selector(0, 1, 53, statistical_processing=STAT_ACCUMULATION),
    ),
    "hail_fall_rate": (Selector(0, 1, 73),),
    "hail_fall_rate_max_1h": (
        Selector(0, 1, 73, statistical_processing=STAT_MAXIMUM),
    ),
    # MOGREPS-UK ships hail as an hourly ACCUMULATION rather than a rate.
    # Same GRIB code as the rate, distinguished only by the statistical
    # processing, so it must be selected explicitly or it would collide.
    "hail_accum_1h": (
        Selector(0, 1, 73, statistical_processing=STAT_ACCUMULATION),
    ),
    # MOGREPS-UK "total-lightning-flash-density-1h" is Met Office local code
    # 0/17/192 accumulated over the preceding hour (PDT 11, ensemble member,
    # statistically processed). The WMO 0/17/4 and 0/17/3 forms are kept as
    # fallbacks for other centres.
    "lightning_flash_density_1h": (
        Selector(0, 17, 192, statistical_processing=STAT_ACCUMULATION),
        Selector(0, 17, 4, statistical_processing=STAT_ACCUMULATION),
        Selector(0, 17, 4),
        Selector(0, 17, 3),
    ),
}


# ---------------------------------------------------------------------------
# Profile selectors, generated per level
# ---------------------------------------------------------------------------
#
# The orders now carry nine isobaric levels and twelve height levels of the
# same handful of variables. Writing ~180 selectors by hand would be an
# invitation to a typo that silently decodes the wrong level, so they are
# generated from one verified code per variable.
#
# EVERY code below was read from a real UKV message on 2026-08-30, not taken
# from a table. Two of them are Met Office LOCAL codes and the WMO numbers
# would not have matched anything:
#
#   cloud water mixing ratio        0/1/192   (WMO cloud mixing ratio is 0/1/22)
#   wet-bulb potential temperature  0/0/192
#
# eccodes reports the level as the VALUE IN ITS OWN UNITS: hPa for
# isobaricInhPa (850, not 85000) and metres for heightAboveGround. The
# generated selectors pin that value, so a file containing several levels
# cannot yield the wrong one.
ISOBARIC_LEVEL_TYPE = 100
HEIGHT_AGL_LEVEL_TYPE = 103

#: Levels come from `params.py`, which owns them: the import order runs
#: params -> grid -> decode, so this module may read from params and never
#: the reverse. Re-exported here because the selector generator and its tests
#: both read them from this module.
from ..params import (  # noqa: E402
    ORDER_HEIGHT_LEVELS_M, ORDER_PRESSURE_LEVELS_HPA,
    PROFILE_HEIGHT_STEMS as HEIGHT_STEMS,
)

#: canonical stem -> (discipline, category, number), verified per above.
PROFILE_CODES: dict[str, tuple[int, int, int]] = {
    "temperature": (0, 0, 0),
    "relative_humidity": (0, 1, 1),
    "geopotential_height": (0, 3, 5),
    "u_wind": (0, 2, 2),
    "v_wind": (0, 2, 3),
    "wind_speed": (0, 2, 1),
    "wind_direction": (0, 2, 0),
    "vertical_velocity": (0, 2, 9),
    "cloud_water_mixing_ratio": (0, 1, 192),
    "wet_bulb_potential_temperature": (0, 0, 192),
}

#: Stems that exist on height levels as well as pressure levels.
HEIGHT_STEMS = (
    "temperature", "relative_humidity", "u_wind", "v_wind", "wind_speed",
    "vertical_velocity", "cloud_water_mixing_ratio",
)


def _register_profile_selectors() -> int:
    """Add one pinned selector per (variable, level).

    Hand-written entries WIN. `temperature_2m` and `wind_speed_10m` are
    deliberately not level-pinned -- eccodes reports the screen level as 2
    where the Met Office file says 1.5 -- and regenerating them would undo
    that decision.
    """
    added = 0
    for stem, (d, c, n) in PROFILE_CODES.items():
        for hpa in ORDER_PRESSURE_LEVELS_HPA:
            name = f"{stem}_{hpa}"
            if name in SELECTORS:
                continue
            SELECTORS[name] = (
                Selector(d, c, n, level_type=ISOBARIC_LEVEL_TYPE,
                         level_value=float(hpa)),
            )
            added += 1
        if stem not in HEIGHT_STEMS:
            continue
        for metres in ORDER_HEIGHT_LEVELS_M:
            name = f"{stem}_agl_{metres}"
            if name in SELECTORS:
                continue
            SELECTORS[name] = (
                Selector(d, c, n, level_type=HEIGHT_AGL_LEVEL_TYPE,
                         level_value=float(metres)),
            )
            added += 1
    return added


PROFILE_SELECTORS_ADDED = _register_profile_selectors()


@dataclass(slots=True)
class MessageInfo:
    index: int
    discipline: int
    category: int
    number: int
    short_name: str
    name: str
    units: str
    statistical_processing: int | None
    level_type: int | None
    level_value: float | None
    forecast_hour: int
    reference_time: datetime
    # MOGREPS-UK ships every ensemble member inside ONE file, distinguished
    # only by perturbationNumber. None for deterministic models.
    member: int | None
    nx: int
    ny: int
    grid_template: int

    def describe(self) -> str:
        stat = {0: "avg", 1: "accum", 2: "max"}.get(
            self.statistical_processing, "inst"
        )
        return (
            f"#{self.index:<3} {self.short_name:<12} "
            f"d{self.discipline}/c{self.category}/n{self.number:<3} "
            f"{stat:<6} lvl={self.level_type}:{self.level_value} "
            f"m={self.member if self.member is not None else chr(45):<4} "
            f"T+{self.forecast_hour:<3} {self.nx}x{self.ny} "
            f"[{self.units}] {self.name}"
        )


def _key(handle, name: str, default: Any = None, ktype: type | None = None) -> Any:
    """Read one GRIB key, tolerating absence.

    `ktype` matters: eccodes returns `typeOfFirstFixedSurface` as the string
    "sfc" for several surfaces, which compares unequal to the integer codes in
    the selector table. Always ask for int where the code is what we mean.
    """
    import eccodes

    try:
        if ktype is not None:
            return eccodes.codes_get(handle, name, ktype)
        return eccodes.codes_get(handle, name)
    except Exception:
        return default


def _member_of(handle) -> int | None:
    """Ensemble member number, or None for a deterministic field.

    Only product definition templates 1 and 11 (individual ensemble member,
    instantaneous and statistically processed) carry a meaningful
    perturbationNumber. Deterministic templates 0 and 8 report 0, which must
    not be mistaken for "member 0".
    """
    pdt = _key(handle, "productDefinitionTemplateNumber", ktype=int)
    if pdt not in (1, 11):
        return None
    pert = _key(handle, "perturbationNumber", ktype=int)
    return None if pert is None else int(pert)


def scan(path: Path, *, use_cache: bool = True) -> list[MessageInfo]:
    """Every message in a GRIB2 file, described. Cached by path and mtime."""
    stat = path.stat()
    cache_key = (str(path), stat.st_mtime, stat.st_size)
    if use_cache:
        with _SCAN_CACHE_LOCK:
            hit = _SCAN_CACHE.get(cache_key)
        if hit is not None:
            return hit

    result = _scan_uncached(path)
    if use_cache:
        with _SCAN_CACHE_LOCK:
            _SCAN_CACHE[cache_key] = result
    return result


def _scan_uncached(path: Path) -> list[MessageInfo]:
    import eccodes

    out: list[MessageInfo] = []
    with _ECCODES_LOCK, open(path, "rb") as fh:
        idx = 0
        while True:
            handle = eccodes.codes_grib_new_from_file(fh)
            if handle is None:
                break
            try:
                ref = _key(handle, "dataDate")
                reftime = _key(handle, "dataTime", 0)
                dt = datetime.strptime(f"{ref}{reftime:04d}", "%Y%m%d%H%M").replace(
                    tzinfo=timezone.utc
                )
                stat = _key(handle, "typeOfStatisticalProcessing")
                out.append(MessageInfo(
                    index=idx,
                    discipline=_key(handle, "discipline", -1),
                    category=_key(handle, "parameterCategory", -1),
                    number=_key(handle, "parameterNumber", -1),
                    short_name=str(_key(handle, "shortName", "?")),
                    name=str(_key(handle, "name", "?")),
                    units=str(_key(handle, "units", "")),
                    statistical_processing=(
                        int(stat) if isinstance(stat, int) else None
                    ),
                    level_type=_key(handle, "typeOfFirstFixedSurface", ktype=int),
                    level_value=_key(handle, "level", ktype=float),
                    forecast_hour=int(_key(handle, "forecastTime", 0) or 0),
                    member=_member_of(handle),
                    reference_time=dt,
                    nx=int(_key(handle, "Nx", 0) or _key(handle, "Ni", 0) or 0),
                    ny=int(_key(handle, "Ny", 0) or _key(handle, "Nj", 0) or 0),
                    grid_template=int(
                        _key(handle, "gridDefinitionTemplateNumber", -1)
                    ),
                ))
            finally:
                eccodes.codes_release(handle)
            idx += 1
    return out


#: Metres per degree of latitude. Longitude shrinks by cos(lat); the ground
#: spacing of a lat/lon grid is quoted at the domain's middle latitude.
_M_PER_DEG_LAT = 111_320.0


def _regular_ll_grid(handle) -> GridSpec:
    """Grid geometry for a plain latitude/longitude mesh.

    MOGREPS-G arrives on `regular_ll`, not the Lambert azimuthal mesh the UK
    models use. The LAEA path below reads `Dx`/`Dy` in metres; a lat/lon
    message has neither, so without this branch `dx` fell to 0, the 2000 m
    fallback applied, and a 0.28 degree grid was recorded as a 2 km one --
    wrong by an order of magnitude and silent, because every field still had
    the right shape.

    Degrees are kept as degrees. `spacing_m` carries an APPROXIMATE ground
    spacing purely so resolution comparisons never put a degree value beside
    a metre value; `spacing_deg` is the exact step used for indexing.
    """
    nx = int(_key(handle, "Ni", 0))
    ny = int(_key(handle, "Nj", 0))
    dlon = float(_key(handle, "iDirectionIncrementInDegrees", 0.0) or 0.0)
    dlat = float(_key(handle, "jDirectionIncrementInDegrees", 0.0) or 0.0)
    lat_first = float(_key(handle, "latitudeOfFirstGridPointInDegrees", 0.0))
    lon_first = float(_key(handle, "longitudeOfFirstGridPointInDegrees", 0.0))
    lat_last = float(_key(handle, "latitudeOfLastGridPointInDegrees", 0.0))

    # GRIB longitudes run 0..360; the rest of the platform uses -180..180.
    # 349.17 and -10.83 are the same meridian, and only one of them sorts
    # correctly against a UK bounding box.
    if lon_first > 180.0:
        lon_first -= 360.0

    # Scanning order decides which corner "first" is. jScansPositively is 1
    # when rows run south to north, which is what MOGREPS-G uses; the default
    # in GRIB2 is north to south, so this cannot be assumed either way.
    scans_north = bool(_key(handle, "jScansPositively", 0))
    south_edge = min(lat_first, lat_last) if lat_last else (
        lat_first if scans_north else lat_first - (ny - 1) * dlat
    )

    # Store the lower-left CORNER, matching the metre path: the first grid
    # point is a cell centre.
    x0 = lon_first - dlon / 2.0
    y0 = south_edge - dlat / 2.0

    mid_lat = south_edge + (ny - 1) * dlat / 2.0
    metres_lat = dlat * _M_PER_DEG_LAT
    metres_lon = dlon * _M_PER_DEG_LAT * math.cos(math.radians(mid_lat))
    # The COARSER axis is the honest figure: a grid is only as fine as its
    # worst direction, and quoting the finer one overstates what it resolves.
    spacing_m = max(metres_lat, metres_lon)

    return GridSpec(
        name=f"regular_ll_{dlon:g}x{dlat:g}deg",
        projection=WGS84,
        nx=nx,
        ny=ny,
        spacing_m=round(spacing_m, 1),
        x0=x0,
        y0=y0,
        crs_units="degrees",
        spacing_deg=dlat,
    )


def grid_from_grib(path: Path, index: int, projection: str) -> GridSpec:
    """Read the actual grid geometry out of the file.

    We do not trust a hardcoded extent: if the Met Office repositions the
    domain, this picks it up and the mismatch surfaces as a validation error
    instead of a silently shifted map.
    """
    import eccodes

    with _ECCODES_LOCK, open(path, "rb") as fh:
        for i in range(index + 1):
            handle = eccodes.codes_grib_new_from_file(fh)
            if handle is None:
                raise IndexError(f"message {index} not in {path}")
            if i != index:
                eccodes.codes_release(handle)
        try:
            grid_type = str(_key(handle, "gridType", "") or "")
            if grid_type == "regular_ll":
                return _regular_ll_grid(handle)
            nx = int(_key(handle, "Nx", 0) or _key(handle, "Ni", 0))
            ny = int(_key(handle, "Ny", 0) or _key(handle, "Nj", 0))
            # For grid template 140 eccodes reports Dx/Dy in MILLIMETRES
            # (2 km arrives as 2000000). Anything above 50 km is therefore a
            # unit artefact, not a genuinely coarse grid.
            dx = float(_key(handle, "Dx", 0) or 0)
            dy = float(_key(handle, "Dy", 0) or 0)
            if dx > 50_000:
                dx /= 1000.0
                dy /= 1000.0
            lat0 = float(_key(handle, "latitudeOfFirstGridPointInDegrees", 0))
            lon0 = float(_key(handle, "longitudeOfFirstGridPointInDegrees", 0))
        finally:
            eccodes.codes_release(handle)

    from pyproj import Transformer

    spacing = dx or 2000.0
    tf = Transformer.from_crs(WGS84, projection, always_xy=True)
    x_first, y_first = tf.transform(lon0, lat0)

    # The first grid point is a cell CENTRE; the origin we store is the
    # lower-left corner. Round to the nearest metre: the GRIB gives the first
    # point as latitude/longitude to six decimals, so the round trip through
    # the projection lands a few centimetres off a whole metre. Without the
    # snap, a UKV field fails the identity test against its own grid and gets
    # needlessly resampled.
    x0 = round(x_first - spacing / 2.0)
    y0 = round(y_first - (dy or spacing) / 2.0)

    return GridSpec(
        name=f"ukv_laea_{int(spacing)}m",
        projection=projection,
        nx=nx,
        ny=ny,
        spacing_m=spacing,
        x0=float(x0),
        y0=float(y0),
        crs_units="m",
    )


def _values(path: Path, index: int, ny: int, nx: int) -> np.ndarray:
    import eccodes

    with _ECCODES_LOCK, open(path, "rb") as fh:
        for i in range(index + 1):
            handle = eccodes.codes_grib_new_from_file(fh)
            if handle is None:
                raise IndexError(f"message {index} not in {path}")
            if i != index:
                eccodes.codes_release(handle)
        try:
            eccodes.codes_set(handle, "missingValue", float("nan"))
            flat = eccodes.codes_get_values(handle)
        finally:
            eccodes.codes_release(handle)
    if flat.size != ny * nx:
        raise ValueError(
            f"{path.name} message {index}: {flat.size} values does not match "
            f"{ny}x{nx}={ny * nx}"
        )
    return np.asarray(flat, dtype="float32").reshape(ny, nx)


def decode_parameter(
    path: Path,
    *,
    parameter: str,
    model: ModelSpec,
    provider: str,
    run: datetime,
    forecast_hour: int,
    source_uri: str,
    level_type: str = "surface",
    level: float | None = None,
    member: int | None = None,
) -> Field:
    """Pull one canonical parameter out of a GRIB2 bundle."""
    selectors = SELECTORS.get(parameter)
    if not selectors:
        raise KeyError(f"no GRIB selector defined for {parameter!r}")

    messages = scan(path)

    # A MOGREPS-UK bundle holds every member of every parameter in one file,
    # so narrow to the requested member BEFORE matching the parameter.
    # Requesting no member from an ensemble file would otherwise silently
    # return whichever member happens to come first.
    if member is not None:
        candidates = [m for m in messages if m.member == member]
        if not candidates:
            present = sorted({m.member for m in messages if m.member is not None})
            raise KeyError(
                f"member {member} not in {path.name}; members present: {present}"
            )
    else:
        candidates = [m for m in messages if m.member is None]
        if not candidates and messages:
            present = sorted({m.member for m in messages if m.member is not None})
            raise KeyError(
                f"{path.name} contains only ensemble members {present}; "
                f"{parameter} must be requested with an explicit member"
            )

    chosen: MessageInfo | None = None
    for sel in selectors:
        for m in candidates:
            if sel.matches(m):
                chosen = m
                break
        if chosen:
            break

    if chosen is None:
        available = "\n  ".join(m.describe() for m in candidates)
        raise KeyError(
            f"{parameter} not found in {path.name}"
            + (f" for member {member}" if member is not None else "")
            + f". Candidates:\n  {available}"
        )

    grid = grid_from_grib(path, chosen.index, model.projection)
    values = _values(path, chosen.index, grid.ny, grid.nx)

    # Met Office local parameter codes are absent from the WMO tables, so
    # eccodes reports their units as "unknown". Fall back to the canonical
    # units for the parameter and record that we substituted, rather than
    # storing a field whose units are literally the string "unknown".
    units = chosen.units
    units_source = "grib"
    if units in ("", "unknown", None):
        units = get_param(parameter).units
        units_source = "tcm_parameter_table"

    meta = FieldMeta(
        provider=provider,
        model=model.id,
        parameter=parameter,
        units=units,
        level_type=level_type,
        level=level,
        run=run,
        forecast_hour=forecast_hour,
        valid_time=run + timedelta(hours=forecast_hour),
        member_kind=(
            MemberKind.PERTURBED if member is not None else MemberKind.DETERMINISTIC
        ),
        member=member,
        # From the registry -- never from the grid we happened to receive.
        native_resolution_m=model.delivered_resolution_m,
        native_grid=model.grid,
        native_projection=model.projection,
        grid=grid,
        source_uri=source_uri,
        retrieved_at=datetime.now(timezone.utc),
        extra={
            "units_source": units_source,
            "grib_units": chosen.units,
            "grib_short_name": chosen.short_name,
            "grib_codes": f"{chosen.discipline}/{chosen.category}/{chosen.number}",
            "grib_statistical_processing": chosen.statistical_processing,
            "grib_message_index": chosen.index,
        },
    )
    return Field(values, meta)


if __name__ == "__main__":  # pragma: no cover
    import sys

    for arg in sys.argv[1:]:
        p = Path(arg)
        print(f"=== {p.name} ===")
        infos = scan(p)
        for m in infos:
            print(" ", m.describe())
        print(f"  {len(infos)} messages")
