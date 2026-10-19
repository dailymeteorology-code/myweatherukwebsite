"""Open-Meteo adapter -- the secondary model aggregation.

This is a POINT API, not a gridded one. There is no way to download ICON-EU's
7 km grid from it, so TCM samples a regular lat/lon mesh over the UK and
Ireland and interpolates onto the analysis grid.

That has an honesty consequence which is handled explicitly and must not be
forgotten: **sampling a 7 km model on a 0.25 degree mesh does not give 7 km
data.** It gives ~25 km samples of a 7 km model. So the delivered resolution
recorded for every model here is

    max(model native resolution, sample spacing)

and the registry entries are built from that, not from the modelling centre's
headline figure. ICON-EU is therefore weighted and labelled at the sampling
resolution, exactly as ECMWF is labelled at the 0.25 degree open feed rather
than its 9 km native grid.

The sampling mesh is a deliberate trade. Days 2-4 is where these models earn
their place, and at that range what matters is the convective ENVIRONMENT --
instability, shear, lapse rates, large-scale forcing -- which are smooth
fields that survive coarse sampling. Storm-scale detail at day 1 comes from
UKV and MOGREPS-UK at 2 km, not from here.

One request returns every variable for every lead time at up to a few hundred
points, so the adapter fetches a whole cube per model per cycle and slices
parameters out of it, rather than making a request per field.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np

from ..config import get_settings
from ..crs import WGS84
from ..grid import Field
from ..meta import FieldMeta, GridSpec, MemberKind
from ..registry import UK_IRELAND, ModelSpec
from .base import (
    Availability,
    DataUnavailable,
    ProviderAdapter,
    ProviderError,
    register,
)

log = logging.getLogger(__name__)

#: Sample mesh step in degrees over the UK and Ireland analysis region.
#: 0.25 deg gives ~2,500 points, which is ~17 batched requests per model and
#: returns every variable for all 96 hours. Finer sampling is a config change,
#: not a code change -- but it must be accompanied by the registry resolution
#: moving with it, which `sample_resolution_m` handles automatically.
SAMPLE_SPACING_DEG = 0.5

#: Points per request. Open-Meteo accepts comma-separated coordinate lists,
#: but it weights a call by locations x variables x hours, so a 150-point
#: request for 19 variables over 96 hours counts as a great many calls and
#: trips the per-minute limit immediately. 50 is measured to be sustainable.
BATCH_POINTS = 50

#: Minimum seconds between requests to Open-Meteo. The free tier is rate
#: limited per minute; without this the cube build is refused part-way through
#: and leaves a half-populated grid.
MIN_REQUEST_INTERVAL_S = 1.2

#: A 429 says "try again in one minute", so wait slightly longer than that.
RATE_LIMIT_BACKOFF_S = 65.0
MAX_ATTEMPTS = 3

#: How long a failed cube build is remembered. Without this, every one of the
#: pending (parameter, lead time) tasks re-attempts the whole multi-request
#: build in turn, turning one rate-limit failure into dozens.
FAILURE_CACHE_S = 60.0

#: TCM model id -> Open-Meteo model id. Verified live 2026-08-28.
OPEN_METEO_MODEL = {
    "icon_eu": "icon_eu",
    "arpege": "meteofrance_arpege_europe",
    "arome": "meteofrance_arome_france_hd",
    "ukmo_global": "ukmo_global_deterministic_10km",
    "ifs_hres": "ecmwf_ifs025",
}

#: Canonical TCM parameter -> (Open-Meteo hourly variable, converter).
#:
#: Conversions are explicit because Open-Meteo answers in convenience units
#: (degrees Celsius, hectopascals) and TCM stores SI.
def _c_to_k(a):
    return a + 273.15


def _hpa_to_pa(a):
    return a * 100.0


def _identity(a):
    return a


VARIABLE_MAP: dict[str, tuple[str, object]] = {
    "temperature_2m": ("temperature_2m", _c_to_k),
    "dewpoint_2m": ("dew_point_2m", _c_to_k),
    "relative_humidity_2m": ("relative_humidity_2m", _identity),
    "pressure_msl": ("pressure_msl", _hpa_to_pa),
    "pressure_surface": ("surface_pressure", _hpa_to_pa),
    "total_cloud_cover": ("cloud_cover", _identity),
    "wind_speed_10m": ("wind_speed_10m", _identity),
    "wind_direction_10m": ("wind_direction_10m", _identity),
    "wind_gust_10m": ("wind_gusts_10m", _identity),
    "freezing_level_height": ("freezing_level_height", _identity),
    "precip_accum_1h": ("precipitation", _identity),
    "cape_surface": ("cape", _identity),
    "cin": ("convective_inhibition", _identity),
    "wind_speed_500": ("wind_speed_500hPa", _identity),
    "wind_direction_500": ("wind_direction_500hPa", _identity),
    "temperature_500": ("temperature_500hPa", _c_to_k),
    "temperature_850": ("temperature_850hPa", _c_to_k),
    "dewpoint_850": ("dew_point_850hPa", _c_to_k),
    "geopotential_height_500": ("geopotential_height_500hPa", _identity),
}

#: Parameters that are physically non-negative. Open-Meteo interpolation can
#: return small negatives (ECMWF CAPE was observed at -40 J/kg), which would
#: otherwise propagate into the blend as negative instability.
NON_NEGATIVE = {
    "cape_surface", "precip_accum_1h", "wind_speed_10m", "wind_speed_500",
    "wind_gust_10m", "total_cloud_cover", "relative_humidity_2m",
    "freezing_level_height",
}


def sample_resolution_m(spacing_deg: float = SAMPLE_SPACING_DEG) -> float:
    """Ground spacing of the sample mesh, in metres.

    Uses the LATITUDE step, which is the coarser axis: one degree of latitude
    is ~111 km everywhere, while one degree of longitude is ~64 km at 55N. The
    coarser axis is the honest figure for what the mesh can resolve.
    """
    return spacing_deg * 111_320.0


def sample_grid(spacing_deg: float = SAMPLE_SPACING_DEG) -> GridSpec:
    """The lat/lon mesh TCM samples Open-Meteo on."""
    nx = int(round((UK_IRELAND.lon_max - UK_IRELAND.lon_min) / spacing_deg))
    ny = int(round((UK_IRELAND.lat_max - UK_IRELAND.lat_min) / spacing_deg))
    return GridSpec(
        name=f"open_meteo_sample_{spacing_deg:g}deg",
        projection=WGS84,
        nx=nx,
        ny=ny,
        spacing_m=sample_resolution_m(spacing_deg),
        x0=UK_IRELAND.lon_min,
        y0=UK_IRELAND.lat_min,
        crs_units="degrees",
        spacing_deg=spacing_deg,
    )


def sample_points(g: GridSpec) -> tuple[np.ndarray, np.ndarray]:
    """Cell-centre longitudes and latitudes, flattened row-major."""
    step = g.spacing_deg
    lon = g.x0 + (np.arange(g.nx) + 0.5) * step
    lat = g.y0 + (np.arange(g.ny) + 0.5) * step
    lon2, lat2 = np.meshgrid(lon, lat)
    return lon2.ravel(), lat2.ravel()


def infer_run(model: ModelSpec, now: datetime | None = None,
              availability_lag_h: float = 5.0) -> datetime:
    """Best estimate of the cycle Open-Meteo is currently serving.

    The forecast endpoint does not report which model run produced the data,
    so the run recorded in provenance is INFERRED: the most recent cycle that
    is at least `availability_lag_h` old. `FieldMeta.extra["run_inferred"]`
    marks it, so nothing downstream mistakes it for a reported cycle time.
    """
    now = now or datetime.now(timezone.utc)
    candidate = now - timedelta(hours=availability_lag_h)
    cycles = sorted(model.cycles_utc)
    day = candidate.replace(minute=0, second=0, microsecond=0)
    for hour in reversed(cycles):
        if candidate.hour >= hour:
            return day.replace(hour=hour)
    # Before the first cycle of the day: use the last cycle of yesterday.
    return (day - timedelta(days=1)).replace(hour=cycles[-1])


@dataclass(slots=True)
class Cube:
    """Every parameter, every lead time, on the sample mesh."""

    model_id: str
    run: datetime
    grid: GridSpec
    parameters: tuple[str, ...]
    hours: tuple[int, ...]
    #: parameter -> array (n_hours, ny, nx)
    data: dict[str, np.ndarray]

    def slice(self, parameter: str, forecast_hour: int) -> np.ndarray:
        if parameter not in self.data:
            raise DataUnavailable(
                "open_meteo",
                f"{self.model_id} did not return {parameter}",
            )
        try:
            index = self.hours.index(forecast_hour)
        except ValueError:
            raise DataUnavailable(
                "open_meteo",
                f"{self.model_id} has no T+{forecast_hour} in this cube",
            ) from None
        return self.data[parameter][index]


class OpenMeteoAdapter(ProviderAdapter):
    name = "open_meteo"

    def __init__(self, *, timeout: float = 120.0,
                 spacing_deg: float | None = None) -> None:
        self.settings = get_settings()
        spacing_deg = spacing_deg or getattr(
            self.settings, "open_meteo_sample_deg", SAMPLE_SPACING_DEG
        )
        self._client: httpx.AsyncClient | None = None
        self._timeout = timeout
        self.spacing_deg = spacing_deg
        self._cubes: dict[tuple[str, str], Cube] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._failures: dict[tuple[str, str], tuple[float, Exception]] = {}
        self._lock = asyncio.Lock()
        self._request_lock = asyncio.Lock()
        self._last_request_at = 0.0

    async def _throttled_get(self, url: str, params: dict) -> httpx.Response:
        """One rate-limited request, retrying on 429.

        Requests are serialised behind a lock with a minimum interval. That
        makes the cube build slower but reliable; a partially built cube is
        worse than a slow one, because it silently leaves holes in the grid.
        """
        client = await self._http()
        for attempt in range(1, MAX_ATTEMPTS + 1):
            async with self._request_lock:
                wait = MIN_REQUEST_INTERVAL_S - (
                    asyncio.get_event_loop().time() - self._last_request_at
                )
                if wait > 0:
                    await asyncio.sleep(wait)
                response = await client.get(url, params=params)
                self._last_request_at = asyncio.get_event_loop().time()

            if response.status_code != 429:
                return response
            if attempt == MAX_ATTEMPTS:
                return response
            log.warning(
                "open-meteo rate limited, waiting %.0fs (attempt %d/%d)",
                RATE_LIMIT_BACKOFF_S, attempt, MAX_ATTEMPTS,
            )
            await asyncio.sleep(RATE_LIMIT_BACKOFF_S)
        return response

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout),
                follow_redirects=True,
                headers={"accept": "application/json"},
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # --- availability -----------------------------------------------------

    async def availability(self, model: ModelSpec) -> Availability:
        if model.id not in OPEN_METEO_MODEL:
            raise DataUnavailable(self.name, f"{model.id} is not an Open-Meteo model")
        run = infer_run(model)
        supported = tuple(
            p for p in model.parameters if p in VARIABLE_MAP
        )
        return Availability(
            model_id=model.id,
            runs=(run,),
            parameters=supported,
            max_forecast_hour=model.max_forecast_hour,
            detail=(
                "run time is inferred, not reported by the provider; fields "
                f"are sampled on a {self.spacing_deg:g} degree mesh "
                f"(~{sample_resolution_m(self.spacing_deg) / 1000:.0f} km)"
            ),
        )

    async def latest_run(self, model: ModelSpec) -> datetime:
        return infer_run(model)

    # --- the cube ---------------------------------------------------------

    def _cube_path(self, model: ModelSpec, run: datetime) -> Path:
        return (
            self.settings.raw_dir / "open_meteo" / model.id
            / f"{run:%Y%m%dT%H}" / f"cube_{self.spacing_deg:g}deg.npz"
        )

    async def _get_cube(self, model: ModelSpec, run: datetime,
                        max_hour: int) -> Cube:
        import time

        key = (model.id, run.isoformat())
        async with self._lock:
            if key in self._cubes:
                return self._cubes[key]
            failure = self._failures.get(key)
            if failure and time.monotonic() - failure[0] < FAILURE_CACHE_S:
                raise failure[1]
            lock = self._locks.setdefault(key, asyncio.Lock())

        async with lock:
            if key in self._cubes:
                return self._cubes[key]
            failure = self._failures.get(key)
            if failure and time.monotonic() - failure[0] < FAILURE_CACHE_S:
                raise failure[1]
            try:
                cube = await self._load_or_fetch_cube(model, run, max_hour)
            except Exception as exc:
                # Remember the failure briefly so the other pending fields do
                # not each re-run the whole multi-request build.
                async with self._lock:
                    self._failures[key] = (time.monotonic(), exc)
                raise
            async with self._lock:
                self._cubes[key] = cube
                self._failures.pop(key, None)
            return cube

    async def _load_or_fetch_cube(self, model: ModelSpec, run: datetime,
                                  max_hour: int) -> Cube:
        path = self._cube_path(model, run)
        grid = sample_grid(self.spacing_deg)

        if path.exists():
            with np.load(path, allow_pickle=False) as stored:
                hours = tuple(int(h) for h in stored["__hours__"])
                data = {
                    k: stored[k] for k in stored.files
                    if not k.startswith("__")
                }
            log.info("open-meteo cube for %s loaded from cache", model.id)
            return Cube(model.id, run, grid, tuple(data), hours, data)

        cubes = await self._fetch_cubes(model, run, grid, max_hour)
        for built in cubes.values():
            self._save_cube(built)
        if model.id not in cubes:
            raise ProviderError(
                self.name, f"cube build returned nothing for {model.id}"
            )
        # The sibling models were fetched in the same requests; cache them so
        # ingesting them next costs no further calls.
        async with self._lock:
            for model_id, built in cubes.items():
                self._cubes.setdefault((model_id, run.isoformat()), built)
        return cubes[model.id]

    def _save_cube(self, cube: Cube) -> None:
        from ..registry import get as get_model

        path = self._cube_path(get_model(cube.model_id), cube.run)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.part.npz")
        np.savez_compressed(
            tmp, __hours__=np.array(cube.hours, dtype="int32"), **cube.data
        )
        os.replace(tmp, path)

    def _sibling_models(self, model: ModelSpec, run: datetime) -> list[ModelSpec]:
        """Open-Meteo models that can share this model's requests.

        Open-Meteo accepts `models=a,b,c` and answers with one series per
        model per variable, suffixed `<variable>_<model>`. Fetching the four
        models TCM uses in one pass costs a quarter of the requests, which is
        the difference between completing a cube and being rate limited
        part-way through it.
        """
        from ..registry import MODELS

        out = []
        for candidate in MODELS.values():
            if candidate.provider != self.name:
                continue
            if candidate.id not in OPEN_METEO_MODEL:
                continue
            if not candidate.domain.covers_uk_ireland():
                # AROME does not cover the analysis area; fetching it would
                # spend requests on a model the blend will never use here.
                continue
            if infer_run(candidate) != run:
                continue
            out.append(candidate)
        if model not in out:
            out.append(model)
        return out

    async def _fetch_cubes(self, model: ModelSpec, run: datetime,
                           grid: GridSpec, max_hour: int) -> dict[str, Cube]:
        models = self._sibling_models(model, run)
        wanted: dict[str, list[str]] = {
            m.id: [p for p in m.parameters if p in VARIABLE_MAP] for m in models
        }
        if not wanted.get(model.id):
            raise DataUnavailable(
                self.name, f"{model.id} declares no Open-Meteo parameters"
            )

        variables = sorted({
            VARIABLE_MAP[p][0] for params in wanted.values() for p in params
        })
        om_models = [OPEN_METEO_MODEL[m.id] for m in models]

        lons, lats = sample_points(grid)
        n_points = lons.size
        n_hours = max_hour + 1
        data = {
            m.id: {
                p: np.full((n_hours, grid.ny, grid.nx), np.nan, dtype="float32")
                for p in wanted[m.id]
            }
            for m in models
        }

        forecast_days = min(int(math.ceil(n_hours / 24)), 16)
        n_batches = (n_points + BATCH_POINTS - 1) // BATCH_POINTS
        log.info(
            "open-meteo: %d models x %d variables over %d points "
            "(%d requests, ~%.0fs)",
            len(models), len(variables), n_points, n_batches,
            n_batches * MIN_REQUEST_INTERVAL_S,
        )

        for batch, start in enumerate(range(0, n_points, BATCH_POINTS), 1):
            stop = min(start + BATCH_POINTS, n_points)
            params = {
                "latitude": ",".join(f"{v:.4f}" for v in lats[start:stop]),
                "longitude": ",".join(f"{v:.4f}" for v in lons[start:stop]),
                "models": ",".join(om_models),
                "hourly": ",".join(variables),
                "forecast_days": str(forecast_days),
                "temperature_unit": "celsius",
                "wind_speed_unit": "ms",
                "precipitation_unit": "mm",
                "timeformat": "unixtime",
            }
            if self.settings.open_meteo_api_key:
                params["apikey"] = self.settings.open_meteo_api_key

            response = await self._throttled_get(
                self.settings.open_meteo_forecast_url, params
            )
            if response.status_code != 200:
                raise ProviderError(
                    self.name,
                    f"batch {start}-{stop} -> {response.status_code}: "
                    f"{response.text[:200]}",
                )
            payload = response.json()
            locations = payload if isinstance(payload, list) else [payload]

            for offset, location in enumerate(locations):
                index = start + offset
                row, col = divmod(index, grid.nx)
                hourly = location.get("hourly") or {}
                for spec, om_name in zip(models, om_models):
                    for parameter in wanted[spec.id]:
                        variable, convert = VARIABLE_MAP[parameter]
                        # With several models requested, every series is
                        # suffixed with the model id. With one, it is not.
                        series = hourly.get(f"{variable}_{om_name}")
                        if series is None and len(om_models) == 1:
                            series = hourly.get(variable)
                        if series is None:
                            continue
                        values = np.array(
                            [np.nan if v is None else v
                             for v in series[:n_hours]],
                            dtype="float32",
                        )
                        if values.size < n_hours:
                            values = np.pad(
                                values, (0, n_hours - values.size),
                                constant_values=np.nan,
                            )
                        values = convert(values)
                        if parameter in NON_NEGATIVE:
                            # Interpolation artefacts: ECMWF CAPE was observed
                            # at -40 J/kg, which is not a physical value.
                            values = np.where(values < 0, 0.0, values)
                        data[spec.id][parameter][:, row, col] = values

            if batch % 10 == 0 or stop == n_points:
                log.info(
                    "open-meteo: %d/%d points (%d/%d requests)",
                    stop, n_points, batch, n_batches,
                )

        return {
            m.id: Cube(
                model_id=m.id, run=run, grid=grid,
                parameters=tuple(wanted[m.id]),
                hours=tuple(range(n_hours)), data=data[m.id],
            )
            for m in models
        }

    # --- ProviderAdapter --------------------------------------------------

    async def fetch(
        self,
        model: ModelSpec,
        parameter: str,
        run: datetime,
        forecast_hour: int,
        *,
        member: int | None = None,
    ) -> Field:
        if member is not None:
            raise DataUnavailable(
                self.name, f"{model.id} via Open-Meteo is deterministic"
            )
        if parameter not in VARIABLE_MAP:
            raise DataUnavailable(
                self.name, f"{parameter} has no Open-Meteo variable"
            )

        cube = await self._get_cube(model, run, model.max_forecast_hour)
        values = cube.slice(parameter, forecast_hour)

        from ..params import get as get_param

        spec = get_param(parameter)
        meta = FieldMeta(
            provider=self.name,
            model=model.id,
            parameter=parameter,
            units=spec.units,
            level_type="sample",
            level=None,
            run=run,
            forecast_hour=forecast_hour,
            valid_time=run + timedelta(hours=forecast_hour),
            member_kind=MemberKind.DETERMINISTIC,
            member=None,
            # Truth about what we hold: the coarser of the model and the mesh.
            native_resolution_m=model.delivered_resolution_m,
            native_grid=model.grid,
            native_projection=model.projection,
            grid=cube.grid,
            source_uri=(
                f"{self.settings.open_meteo_forecast_url}"
                f"?models={OPEN_METEO_MODEL[model.id]}"
                f"&hourly={VARIABLE_MAP[parameter][0]}"
            ),
            retrieved_at=datetime.now(timezone.utc),
            extra={
                "open_meteo_model": OPEN_METEO_MODEL[model.id],
                "open_meteo_variable": VARIABLE_MAP[parameter][0],
                "sample_spacing_deg": self.spacing_deg,
                "sample_resolution_m": sample_resolution_m(self.spacing_deg),
                "model_native_resolution_m": model.model_native_resolution_m,
                # The forecast endpoint does not report a cycle time.
                "run_inferred": True,
                "units_source": "tcm_parameter_table",
            },
        )
        return Field(values.astype("float32"), meta)


register(OpenMeteoAdapter())
