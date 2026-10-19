"""Met Office Weather DataHub -- Atmospheric Model Data adapter.

Verified live against the account key on 2026-08-28:

    GET  /orders
        -> o164548752025  model "mo-uk"         (UKV, 00Z/12Z, T+0..54 hourly)
           o210011501743  model "mo-mogrepsuk"  (MOGREPS-UK, 00Z/12Z,
                                                 T+0..126 3-hourly)

    GET  /orders/{orderId}/latest
        -> file descriptors for the two most recent cycles

    GET  /orders/{orderId}/latest/{fileId}/data
        -> HTTP 302 to gridded-data-delivery.cda.api.metoffice.gov.uk,
           then GRIB2 (magic "GRIB", edition 2, centre 74)

Four behaviours that are easy to get wrong and are handled explicitly:

  * The data endpoint ALWAYS redirects to a presigned delivery URL. The
    `apikey` header must not be replayed to that host, so redirects are
    followed manually and the auth header is dropped on the hop.

  * fileIds for multi-parameter bundles contain a literal "+", as in
    `atmosphere_total-cloud-cover+total-lightning-flash-density-1h_...`. The
    gateway decodes a raw "+" in the path as a space and answers 404, so the
    fileId must be percent-encoded.

  * One GRIB2 file holds several parameters. The ground bundle holds twelve;
    MOGREPS bundles hold two. We download the bundle once and decode
    individual parameters out of it.

  * MOGREPS-UK ships EVERY ensemble member in the same file, distinguished
    only by perturbationNumber. Members are not separate files.

Orders are discovered by model id rather than configured, so provisioning a
new model in the DataHub portal needs no code or config change.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

from ...config import get_settings
from ...grid import Field
from ...registry import ModelSpec
from ..base import (
    Availability,
    DataUnavailable,
    ProviderAdapter,
    ProviderError,
    register,
)

log = logging.getLogger(__name__)

# --- Met Office parameter name -> canonical TCM name ----------------------
# Left-hand side is exactly what the DataHub `parameters` array reports.
#
# "temperature" is ambiguous: it appears in the `agl` bundle as screen
# temperature and again in the `ground` bundle as surface temperature. Those
# are different fields, so the surface qualifies the name -- see
# SURFACE_OVERRIDES and `canonical_for`.
PARAMETER_MAP: dict[str, str] = {
    "temperature": "temperature_2m",
    "dewpoint-temperature": "dewpoint_2m",
    "wind-speed-surface-adjusted": "wind_speed_10m",
    "wind-direction-from-which-blowing-surface-adjusted": "wind_direction_10m",
    "total-cloud-cover": "total_cloud_cover",
    "pressure": "pressure_surface",
    "pressure-reduced-to-msl": "pressure_msl",
    "geometric-height-agl": "freezing_level_height",
    # The UKV order ships the freezing level as geopotential height on the
    # zero-isotherm surface; MOGREPS uses the geometric form.
    "geopotential-height": "freezing_level_height",
    "hail-fall-accumulation-1h": "hail_accum_1h",
    # MOGREPS-Global. NOTE: "large-scale" rain EXCLUDES the convective
    # scheme's precipitation, and a global model parameterises convection --
    # so on a showery day this field is close to blind. Mapped to its own
    # canonical name rather than precip_rate so it can never be silently
    # substituted for a convection-permitting model's rainfall.
    "large-scale-rain-rate": "large_scale_rain_rate",
    "large-scale-rain-rate-max-1h": "large_scale_rain_rate_max_1h",
    "rain-precipitation-rate": "precip_rate",
    "rain-precipitation-rate-max-1h": "precip_rate_max_1h",
    "precipitation-accumulation-1h": "precip_accum_1h",
    "rainfall-accumulation-1h": "precip_accum_1h",
    "snowfall-rate-water-equivalent": "snowfall_rate_water_eq",
    "snow-depth-water-equivalent": "snow_depth_water_eq",
    "snowfall-accumulation-water-equivalent-1h": "snowfall_accum_1h_water_eq",
    "hail-fall-rate": "hail_fall_rate",
    "hail-fall-rate-max-1h": "hail_fall_rate_max_1h",
    "cape-surface": "cape_surface",
    "cape-mixed-layer-lowest-500m": "cape_mixed_layer",
    "total-lightning-flash-density-1h": "lightning_flash_density_1h",
    # Observed briefly in the UKV order on 2026-08-29 while it was being
    # edited, then removed again. Mapped here so that re-adding them in the
    # DataHub portal needs no code change.
    #
    # NOTE: their GRIB selectors are NOT yet calibrated. cape-surface is
    # 0/7/6 and cape-mixed-layer is the Met Office local code 0/7/193, so the
    # CIN and most-unstable variants are very likely local codes too. They
    # must be read off a real file with `python -m app.grib.decode` before
    # being trusted -- guessing them from the WMO tables is exactly how the
    # hail and MLCAPE selectors were wrong the first time.
    "cape-most-unstable-below-500hpa": "cape_most_unstable",
    "cin-surface": "cin",
    "cin-mixed-layer-lowest-500m": "cin_mixed_layer",
    "cin-most-unstable-below-500hpa": "cin_most_unstable",
    "lightning-flash-density": "lightning_flash_density_1h",
    "convective-inhibition": "cin",
}

# (surfaceId, Met Office name) -> canonical, for the ambiguous cases only.
SURFACE_OVERRIDES: dict[tuple[str, str], str] = {
    ("ground", "temperature"): "temperature_surface",
    ("agl", "temperature"): "temperature_2m",
}


def canonical_for(
    surface_id: str, mo_name: str, level: str | float | None = None
) -> str | None:
    """Canonical TCM name for a Met Office parameter on a given surface.

    LEVEL-AWARE. The orders now carry the same parameter on nine isobaric and
    twelve height levels, and a name-only lookup maps all of them to one
    canonical name -- so whichever file was read last would win and the other
    levels would be unreachable.

    The Stage 2 registry (`app/catalogue/variables.py`) is the authority and
    is consulted first; the flat tables below remain as the fallback for the
    single-level parameters they were written for, so nothing that worked
    before can regress if the registry lacks an entry.
    """
    from ...catalogue.variables import identify

    known = identify(surface_id, mo_name, level)
    if known is not None:
        return known.canonical

    override = SURFACE_OVERRIDES.get((surface_id, mo_name))
    if override:
        return override
    return PARAMETER_MAP.get(mo_name)


def canonical_names_in(entry: dict) -> set[str]:
    """Every canonical name one catalogue file can yield.

    A file carrying nine levels is nine addressable fields, so a caller
    asking "does this file hold temperature_850?" needs all of them, not the
    first.
    """
    surface = entry.get("surfaceId", "")
    levels = [str(x) for x in (entry.get("levels") or [])]
    out: set[str] = set()
    for mo_name in entry.get("parameters", []):
        if levels:
            for level in levels:
                name = canonical_for(surface, mo_name, level)
                if name:
                    out.add(name)
        else:
            name = canonical_for(surface, mo_name)
            if name:
                out.add(name)
    return out


SURFACE_LEVEL_TYPE = {
    "agl": "agl",
    "ground": "surface",
    "meansea": "meansea",
    "atmosphere": "column",
    "zeroisotherm": "zeroisotherm",
}

# DataHub model id per TCM model id.
DATAHUB_MODEL_ID = {
    "ukv": "mo-uk",
    # Added 2026-08-30, when the account gained a MOGREPS-G order.
    "mogreps_g": "mo-mogrepsg",
    # `mogreps_uk` is deliberately LEFT here although the account no longer
    # has that order. Removing it would turn a precise "no DataHub order for
    # mo-mogrepsuk; orders visible to this key are [...]" into a vague
    # "not a DataHub model", which is a worse diagnostic for a subscription
    # that may well come back.
    "mogreps_uk": "mo-mogrepsuk",
}

#: Longest cache filename we will write. Windows caps a full path at 260
#: characters and the data directory sits several levels deep, so a bundle
#: naming six parameters -- a CAPE/CIN bundle runs to ~190 characters once
#: "+" is expanded -- overflows it and the download fails on rename.
MAX_CACHE_FILENAME = 120


class MetOfficeDataHubAdapter(ProviderAdapter):
    name = "metoffice_datahub"

    def __init__(self, *, timeout: float = 120.0) -> None:
        self.settings = get_settings()
        self._client: httpx.AsyncClient | None = None
        self._timeout = timeout
        self._catalogue: dict[str, tuple[float, dict]] = {}
        self._catalogue_ttl = 300.0
        self._orders: tuple[float, dict[str, str]] | None = None
        self._lock = asyncio.Lock()
        # One lock per fileId. A bundle holds several parameters (and, for
        # MOGREPS, several members), so concurrent ingest tasks want the same
        # file at once; without this they each download it and race on rename.
        self._file_locks: dict[str, asyncio.Lock] = {}

    # --- plumbing ---------------------------------------------------------

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout),
                follow_redirects=False,   # handled manually, see _download
                headers={"accept": "application/json"},
            )
        return self._client

    @property
    def _auth_headers(self) -> dict[str, str]:
        key = self.settings.metoffice_atmospheric_api_key
        if not key:
            raise ProviderError(
                self.name, "METOFFICE_ATMOSPHERIC_API_KEY is not set",
                retryable=False,
            )
        return {"apikey": key}

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # --- order discovery --------------------------------------------------

    async def list_orders(self) -> list[dict]:
        """Every order this key can see."""
        client = await self._http()
        url = f"{self.settings.metoffice_atmospheric_base_url}/orders"
        r = await client.get(url, headers=self._auth_headers)
        if r.status_code != 200:
            raise ProviderError(self.name, f"GET /orders -> {r.status_code}")
        return r.json().get("orders", [])

    async def _orders_by_model(self) -> dict[str, str]:
        """DataHub modelId -> orderId, cached."""
        async with self._lock:
            now = time.monotonic()
            if self._orders and now - self._orders[0] < self._catalogue_ttl:
                return self._orders[1]
            orders = await self.list_orders()
            mapping = {
                o["modelId"]: o["orderId"] for o in orders if o.get("modelId")
            }
            self._orders = (now, mapping)
            log.info(
                "DataHub orders: %s",
                ", ".join(f"{m}={o}" for m, o in sorted(mapping.items())),
            )
            return mapping

    async def order_id_for(self, model: ModelSpec) -> str:
        """The order serving a model, discovered rather than configured."""
        want = DATAHUB_MODEL_ID.get(model.id)
        if want is None:
            raise DataUnavailable(
                self.name, f"{model.id} is not a DataHub model"
            )
        mapping = await self._orders_by_model()
        order_id = mapping.get(want)
        if order_id is None:
            raise DataUnavailable(
                self.name,
                f"no DataHub order for model {want!r} ({model.display_name}). "
                f"Create one in the DataHub portal. Orders visible to this "
                f"key: {sorted(mapping) or 'none'}",
            )
        # An explicit pin is honoured only when it really serves this model.
        pinned = self.settings.metoffice_order_id
        if pinned and pinned in mapping.values():
            if mapping.get(want) == pinned:
                return pinned
        return order_id

    # --- catalogue --------------------------------------------------------

    async def _latest_catalogue(self, order_id: str) -> dict:
        """The `/latest` file listing, cached briefly.

        One call returns hundreds of file descriptors, so we do not want to
        make it per parameter per timestep.
        """
        async with self._lock:
            hit = self._catalogue.get(order_id)
            now = time.monotonic()
            if hit and now - hit[0] < self._catalogue_ttl:
                return hit[1]

            client = await self._http()
            url = (
                f"{self.settings.metoffice_atmospheric_base_url}"
                f"/orders/{order_id}/latest"
            )
            r = await client.get(url, headers=self._auth_headers)
            if r.status_code == 404:
                raise DataUnavailable(self.name, f"order {order_id} not found")
            if r.status_code != 200:
                raise ProviderError(self.name, f"GET /latest -> {r.status_code}")
            payload = r.json()
            # The file list is nested under orderDetails; a flat `files` key
            # is accepted too so a future API tweak does not break ingest.
            details = payload.get("orderDetails") or {}
            files = details.get("files") or payload.get("files") or []
            catalogue = {"files": files, "order": details.get("order", {})}
            self._catalogue[order_id] = (now, catalogue)
            log.info("DataHub catalogue for %s: %d files", order_id, len(files))
            return catalogue

    # --- ProviderAdapter --------------------------------------------------

    async def availability(self, model: ModelSpec) -> Availability:
        order_id = await self.order_id_for(model)
        catalogue = await self._latest_catalogue(order_id)
        files = catalogue["files"]

        runs = sorted({
            datetime.fromisoformat(f["runDateTime"].replace("Z", "+00:00"))
            for f in files if f.get("runDateTime")
        })
        params: set[str] = set()
        for f in files:
            params |= canonical_names_in(f)
        hours = sorted({
            int(t) for f in files for t in f.get("timesteps", [])
        })
        max_fh = hours[-1] if hours else 0

        missing = sorted(set(model.parameters) - params)
        detail = ""
        if missing:
            detail = (
                "not in the current order (add them in the DataHub portal): "
                + ", ".join(missing)
            )
        return Availability(
            model_id=model.id,
            runs=tuple(runs),
            parameters=tuple(sorted(params)),
            forecast_hours=tuple(hours),
            max_forecast_hour=max_fh,
            detail=detail,
        )

    async def latest_run(self, model: ModelSpec) -> datetime:
        avail = await self.availability(model)
        if not avail.runs:
            raise DataUnavailable(self.name, f"no runs published for {model.id}")
        return avail.runs[-1]

    async def members_in(
        self, model: ModelSpec, run: datetime, forecast_hour: int,
        parameter: str,
    ) -> list[int]:
        """Ensemble member numbers actually present in a bundle.

        MOGREPS-UK members are not enumerable from the file listing -- they are
        inside the GRIB -- so this downloads the bundle and reads them.
        """
        from ...grib.decode import scan

        if not model.is_ensemble:
            return []
        order_id = await self.order_id_for(model)
        catalogue = await self._latest_catalogue(order_id)
        entry = self._find_file(catalogue["files"], parameter, run, forecast_hour)
        path = await self._download(
            order_id, entry["fileId"], self._cache_path(model, run, entry["fileId"])
        )
        messages = await asyncio.to_thread(scan, path)
        return sorted({m.member for m in messages if m.member is not None})

    def _find_file(
        self, files: list[dict], parameter: str, run: datetime, fh: int
    ) -> dict:
        """Locate the bundle holding `parameter` at this run and lead time.

        Prefers the dated fileId form (`..._2026082812_12`) over the relative
        form (`..._+00_12`) because the relative form is re-pointed when a new
        cycle lands, which would silently change what a cached file means.
        """
        run_stamp = run.strftime("%Y%m%d%H")
        candidates = []
        for f in files:
            if f.get("runDateTime", "").replace("Z", "+00:00") != run.isoformat():
                continue
            if str(fh) not in [str(t) for t in f.get("timesteps", [])]:
                continue
            if parameter not in canonical_names_in(f):
                continue
            candidates.append(f)

        if not candidates:
            raise DataUnavailable(
                self.name,
                f"{parameter} not available for run {run:%Y-%m-%d %HZ} T+{fh}",
            )
        dated = [c for c in candidates if run_stamp in c["fileId"]]
        return (dated or candidates)[0]

    def _cache_path(self, model: ModelSpec, run: datetime, file_id: str) -> Path:
        """Local cache path for a bundle.

        fileIds for multi-parameter bundles are long -- a CAPE/CIN bundle
        naming six parameters runs to ~190 characters, and once "+" is
        expanded and the temp-file suffix is appended the full path exceeds
        the Windows 260-character limit and the download fails on rename.
        So a long name is truncated and made unique with a hash of the full
        fileId, which keeps it readable without risking the limit.
        """
        safe = file_id.replace("+", "_plus_")
        if len(safe) > MAX_CACHE_FILENAME:
            digest = hashlib.sha1(file_id.encode()).hexdigest()[:12]
            keep = MAX_CACHE_FILENAME - len(digest) - 1
            safe = f"{safe[:keep]}_{digest}"
        return (
            self.settings.raw_dir / model.id / f"{run:%Y%m%dT%H}" / f"{safe}.grib2"
        )

    async def _download(self, order_id: str, file_id: str, dest: Path) -> Path:
        """Fetch one GRIB2 bundle, following the delivery redirect by hand.

        Serialised per fileId so a bundle is fetched exactly once even when
        several parameters or members from it are ingested concurrently.
        """
        if dest.exists() and dest.stat().st_size > 0:
            return dest

        async with self._lock:
            lock = self._file_locks.setdefault(file_id, asyncio.Lock())

        async with lock:
            # Another task may have completed the download while we waited.
            if dest.exists() and dest.stat().st_size > 0:
                return dest
            return await self._download_locked(order_id, file_id, dest)

    async def _download_locked(
        self, order_id: str, file_id: str, dest: Path
    ) -> Path:
        client = await self._http()
        # A literal "+" in the path is decoded as a space by the gateway and
        # answers 404, so encode the fileId with nothing left safe.
        url = (
            f"{self.settings.metoffice_atmospheric_base_url}"
            f"/orders/{order_id}/latest/{quote(file_id, safe='')}/data"
        )
        r = await client.get(
            url, headers={**self._auth_headers, "accept": "application/x-grib"}
        )
        if r.status_code in (301, 302, 303, 307, 308):
            location = r.headers.get("location")
            if not location:
                raise ProviderError(self.name, "redirect without Location header")
            # Deliberately WITHOUT the apikey header: the delivery host uses a
            # presigned URL and rejects unexpected auth headers.
            r = await client.get(location, headers={"accept": "application/x-grib"})
        if r.status_code == 404:
            raise DataUnavailable(self.name, f"file {file_id} not found")
        if r.status_code != 200:
            raise ProviderError(self.name, f"download {file_id} -> {r.status_code}")

        body = r.content
        if body[:4] != b"GRIB":
            raise ProviderError(
                self.name,
                f"{file_id} did not return GRIB2 (got {body[:16]!r})",
            )
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Unique temp name: the data directory may sit inside OneDrive, whose
        # sync agent briefly holds handles open and turns a plain rename into
        # WinError 5.
        tmp = dest.with_name(f"{dest.name}.{os.getpid()}.part")
        tmp.write_bytes(body)
        try:
            os.replace(tmp, dest)
        except PermissionError:
            if dest.exists() and dest.stat().st_size > 0:
                tmp.unlink(missing_ok=True)   # someone else won the race
                return dest
            raise
        log.info("downloaded %s (%.1f MB)", file_id, len(body) / 1e6)
        return dest

    async def fetch(
        self,
        model: ModelSpec,
        parameter: str,
        run: datetime,
        forecast_hour: int,
        *,
        member: int | None = None,
    ) -> Field:
        from ...grib.decode import decode_parameter

        if member is not None and not model.is_ensemble:
            raise DataUnavailable(self.name, f"{model.id} is deterministic")

        order_id = await self.order_id_for(model)
        catalogue = await self._latest_catalogue(order_id)
        entry = self._find_file(catalogue["files"], parameter, run, forecast_hour)
        file_id = entry["fileId"]

        path = await self._download(
            order_id, file_id, self._cache_path(model, run, file_id)
        )

        source_uri = (
            f"{self.settings.metoffice_atmospheric_base_url}"
            f"/orders/{order_id}/latest/{quote(file_id, safe='')}/data"
        )
        return await asyncio.to_thread(
            decode_parameter,
            path,
            parameter=parameter,
            model=model,
            provider=self.name,
            run=run,
            forecast_hour=forecast_hour,
            source_uri=source_uri,
            **_level_of(entry, parameter),
            member=member,
        )


def _level_of(entry: dict, parameter: str) -> dict:
    """The level type and value to record for a decoded field.

    Taken from the Stage 2 registry rather than from `SURFACE_LEVEL_TYPE`,
    which has no entry for `isbl` and would have filed every pressure level
    as "surface". The registry also converts the catalogue's PASCALS to the
    hectopascals the rest of the platform uses, so a stored 850 hPa field
    does not claim to be at level 85000.
    """
    from ...catalogue.variables import identify

    surface = entry.get("surfaceId", "")
    levels = [str(x) for x in (entry.get("levels") or [])]
    for level in levels or [None]:
        known = identify(surface, entry.get("parameters", [""])[0], level)
        if known is not None and known.canonical == parameter:
            return {
                "level_type": known.level_type.value,
                "level": known.level,
            }
    return {
        "level_type": SURFACE_LEVEL_TYPE.get(surface, "surface"),
        "level": float(levels[0]) if levels else None,
    }


register(MetOfficeDataHubAdapter())
