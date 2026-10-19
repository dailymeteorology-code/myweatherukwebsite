"""Capability lookup, cached, with failures kept visible.

Stage 2. Discovery costs a provider round trip and the answer changes only
when a new cycle lands, so it is cached. Two rules govern the cache:

  * A FAILURE is cached too, briefly, and as a failure. Without that, a
    provider outage turns every page load into another timeout; with it, the
    outage is reported once and the record says so. What must never happen is
    a failed lookup being cached as "no fields", which reads identically to
    "this model serves nothing".

  * Nothing here falls back to another model. An unavailable model returns a
    record carrying its error, and the caller decides. Substitution is a
    forecasting decision and does not belong in the data layer.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from ..registry import MODELS, ModelSpec
from .capabilities import ModelCapability, from_datahub_catalogue

log = logging.getLogger(__name__)

#: How long a successful discovery stands. A cycle lands every 6-12 hours, so
#: 15 minutes is far inside the window while keeping the site responsive.
TTL_SECONDS = 900
#: A failure is retried much sooner, but not on every request.
FAILURE_TTL_SECONDS = 120

_cache: dict[str, tuple[float, ModelCapability]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(model_id: str) -> asyncio.Lock:
    """One lock per model, so concurrent callers coalesce into one fetch.

    This is the request-deduplication requirement in its simplest useful
    form: ten page loads during a warm start produce one provider call, not
    ten.
    """
    lock = _locks.get(model_id)
    if lock is None:
        lock = _locks[model_id] = asyncio.Lock()
    return lock


def _fresh(entry: tuple[float, ModelCapability]) -> bool:
    stamp, cap = entry
    ttl = FAILURE_TTL_SECONDS if cap.error else TTL_SECONDS
    return (time.monotonic() - stamp) < ttl


async def _discover_datahub(model: ModelSpec) -> ModelCapability:
    from ..providers.metoffice.datahub import MetOfficeDataHubAdapter

    adapter = MetOfficeDataHubAdapter()
    try:
        order_id = await adapter.order_id_for(model)
        catalogue = await adapter._latest_catalogue(order_id)
        files = catalogue.get("files") or (
            catalogue.get("orders", [{}])[0].get("files", [])
        )
        members: tuple[int, ...] = ()
        if model.is_ensemble:
            # Members are inside the GRIB, not the listing, so the registry's
            # declared count is used for the capability summary. Reading the
            # real numbers needs a download and belongs to ingest, which does
            # it per bundle via `members_in()`.
            members = tuple(range(model.n_members))
        return from_datahub_catalogue(
            model.id, order_id, files, members=members,
        )
    finally:
        await adapter.close()


async def capability(model_id: str, *, refresh: bool = False) -> ModelCapability:
    """What `model_id` is serving right now."""
    model = MODELS.get(model_id)
    if model is None:
        return ModelCapability(
            model_id=model_id, provider="", product="", run=None,
            error=f"unknown model {model_id!r}",
            discovered_at=datetime.now(timezone.utc),
        )

    if not refresh:
        entry = _cache.get(model_id)
        if entry and _fresh(entry):
            return entry[1]

    async with _lock_for(model_id):
        # Another caller may have filled it while we waited for the lock.
        entry = _cache.get(model_id)
        if entry and _fresh(entry) and not refresh:
            return entry[1]

        cap = ModelCapability(
            model_id=model_id, provider=model.provider, product="", run=None,
            discovered_at=datetime.now(timezone.utc),
        )
        try:
            if model.provider == "metoffice_datahub":
                cap = await _discover_datahub(model)
            else:
                # Open-Meteo has no catalogue endpoint; its capability is what
                # the registry declares, and that is stated rather than
                # dressed up as discovery.
                cap.error = (
                    f"{model.provider} publishes no catalogue; capability for "
                    f"{model_id} is declared in registry.py, not discovered"
                )
        except Exception as exc:                       # provider-side failure
            cap.error = f"{type(exc).__name__}: {exc}"
            log.info("capability lookup failed for %s: %s", model_id, exc)

        _cache[model_id] = (time.monotonic(), cap)
        return cap


async def all_capabilities(*, refresh: bool = False) -> dict[str, ModelCapability]:
    """Every provisioned model, discovered concurrently.

    One model failing must not take the others with it, so results are
    gathered rather than awaited in sequence.
    """
    ids = [m.id for m in MODELS.values() if m.is_provisioned]
    caps = await asyncio.gather(
        *(capability(i, refresh=refresh) for i in ids),
        return_exceptions=False,
    )
    return dict(zip(ids, caps))


def clear() -> None:
    _cache.clear()
