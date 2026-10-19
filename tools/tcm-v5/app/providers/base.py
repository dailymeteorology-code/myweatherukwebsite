"""The provider adapter contract.

Sources are replaceable. Nothing above this layer knows whether a field came
from the Met Office, Open-Meteo or an ECMWF object store -- it only sees
`Field` objects carrying `FieldMeta`.

Two hard rules every adapter must honour:

  1. It sets `native_resolution_m` from the model registry, never from its own
     opinion, and never from the grid it happens to deliver.
  2. It raises rather than substituting. If UKV is unavailable, an adapter
     must NOT quietly return a coarser model in its place; the pipeline
     decides on fallbacks, explicitly and visibly.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass
from datetime import datetime

from ..grid import Field
from ..registry import ModelSpec


class ProviderError(RuntimeError):
    """Retrieval failed. Carries enough context to show the user."""

    def __init__(self, provider: str, detail: str, *, retryable: bool = True):
        super().__init__(f"[{provider}] {detail}")
        self.provider = provider
        self.detail = detail
        self.retryable = retryable


class DataUnavailable(ProviderError):
    """The source is reachable but does not hold what was asked for.

    Distinct from ProviderError because it is not a fault: a run may simply
    not be published yet, or a parameter may not be in the order.
    """

    def __init__(self, provider: str, detail: str):
        super().__init__(provider, detail, retryable=False)


@dataclass(frozen=True, slots=True)
class Availability:
    """What a provider can currently supply for a model."""

    model_id: str
    runs: tuple[datetime, ...]
    parameters: tuple[str, ...]
    max_forecast_hour: int
    detail: str = ""
    #: The lead times the order actually contains. Orders are not a uniform
    #: step -- UKV is hourly to T+54 then 3-hourly to T+120 -- so walking a
    #: fixed step either skips real data or asks for lead times that do not
    #: exist and burns metered requests on 404s.
    forecast_hours: tuple[int, ...] = ()


class ProviderAdapter(abc.ABC):
    """Base class for every data source."""

    #: stable identifier, matches `ModelSpec.provider`
    name: str = "abstract"

    @abc.abstractmethod
    async def availability(self, model: ModelSpec) -> Availability:
        """What runs and parameters are retrievable right now."""

    @abc.abstractmethod
    async def latest_run(self, model: ModelSpec) -> datetime:
        """Reference time of the most recent complete cycle."""

    @abc.abstractmethod
    async def fetch(
        self,
        model: ModelSpec,
        parameter: str,
        run: datetime,
        forecast_hour: int,
        *,
        member: int | None = None,
    ) -> Field:
        """Retrieve one field, fully described.

        Implementations must return values on the model's NATIVE grid.
        Regridding is the pipeline's job, not the adapter's, so that the
        lineage records exactly one resampling step.
        """

    async def members_in(
        self,
        model: ModelSpec,
        run: datetime,
        forecast_hour: int,
        parameter: str,
    ) -> list[int]:
        """Ensemble member numbers actually present for a run.

        Default: none. Adapters whose members are enumerable only by reading
        the data (MOGREPS-UK hides them inside the GRIB) override this. The
        pipeline asks rather than assuming `range(n_members)`, because a cycle
        can deliver fewer members than the registry advertises.
        """
        return []

    async def close(self) -> None:  # pragma: no cover - trivial
        return None


_REGISTRY: dict[str, ProviderAdapter] = {}


def register(adapter: ProviderAdapter) -> ProviderAdapter:
    _REGISTRY[adapter.name] = adapter
    return adapter


def get(name: str) -> ProviderAdapter:
    try:
        return _REGISTRY[name]
    except KeyError:
        raise KeyError(
            f"no provider adapter named {name!r}; registered: {sorted(_REGISTRY)}"
        ) from None


def registered() -> dict[str, ProviderAdapter]:
    return dict(_REGISTRY)
