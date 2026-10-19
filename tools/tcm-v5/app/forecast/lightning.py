"""Lightning products, kept rigorously separate.

The spec is emphatic on one point and this module enforces it structurally:

    Do not confuse predicted lightning with observed lightning.

There are three products and they are different kinds of thing. A forecast of
where flashes may occur, a deterministic model's flash-density field, and a
record of flashes that actually happened are not interchangeable, and nothing
here ever averages, blends or overlays them into a single number.

  UKV_PREDICTED   Met Office UKV forecast flash density at 2 km. One
                  deterministic solution. No probability attached -- a single
                  model saying "flashes here" is not a 100% chance.

  TCM_PREDICTED   TCM's own probabilistic lightning: the fraction of
                  MOGREPS-UK members forecasting flashes, plus the ensemble
                  median density. This is the only product that carries a
                  genuine probability, and its resolution is limited by the
                  member count.

  OBSERVED        Real strikes from a lightning detection network. There is
                  no provider configured, so this reports OFFLINE. It is
                  never synthesised from a forecast, and the absence is
                  reported rather than quietly filled -- observed lightning
                  is also the data training and verification need, so a fake
                  version would corrupt both.

Each product is independently switchable, so a map can show any combination
without them ever being merged.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum

import numpy as np

from ..config import get_settings
from ..derived.ensemble import Reliability
from ..grid import Field

log = logging.getLogger(__name__)

#: Flash density above which a member counts as forecasting lightning.
#: The Met Office field's absolute scaling is unconfirmed (see app/params.py),
#: so this is a presence threshold, not a calibrated rate.
FLASH_PRESENCE_THRESHOLD = 1e-8


class LightningKind(str, Enum):
    UKV_PREDICTED = "ukv_predicted"
    TCM_PREDICTED = "tcm_predicted"
    OBSERVED = "observed"

    @property
    def is_forecast(self) -> bool:
        return self is not LightningKind.OBSERVED

    @property
    def display_name(self) -> str:
        return {
            LightningKind.UKV_PREDICTED: "Met Office UKV predicted lightning",
            LightningKind.TCM_PREDICTED: "TCM predicted lightning",
            LightningKind.OBSERVED: "Live observed lightning",
        }[self]


@dataclass(slots=True)
class LightningLayer:
    """One lightning product, independently switchable."""

    kind: LightningKind
    available: bool
    forecast_hour: int | None = None
    valid_time: datetime | None = None

    #: Flash density, for the deterministic and ensemble-median products.
    density: np.ndarray | None = dc_field(default=None, repr=False)
    #: Fraction of members forecasting flashes. TCM_PREDICTED only.
    probability: np.ndarray | None = dc_field(default=None, repr=False)

    units: str = ""
    source_model: str = ""
    resolution_label: str = ""
    n_members: int = 0
    reliability: Reliability | None = None
    unavailable_reason: str = ""
    #: Provenance of the field this layer was built from. Rendering must use
    #: THIS, not "whichever lightning field is best": tagging the UKV image
    #: with MOGREPS metadata reported 2.2 km over 2 km UKV data.
    meta: object | None = dc_field(default=None, repr=False)

    @property
    def has_probability(self) -> bool:
        return self.probability is not None

    def _stats(self, a: np.ndarray | None) -> dict | None:
        if a is None:
            return None
        finite = a[np.isfinite(a)]
        if finite.size == 0:
            return None
        return {
            "max": float(finite.max()),
            "mean": float(finite.mean()),
            "area_fraction_nonzero": float((finite > 0).mean()),
        }

    def to_dict(self) -> dict:
        return {
            "kind": self.kind.value,
            "display_name": self.kind.display_name,
            "is_forecast": self.kind.is_forecast,
            "available": self.available,
            "unavailable_reason": self.unavailable_reason,
            "forecast_hour": self.forecast_hour,
            "valid_time": (
                self.valid_time.isoformat() if self.valid_time else None
            ),
            "source_model": self.source_model,
            "resolution": self.resolution_label,
            "units": self.units,
            "units_confirmed": False,
            "density": self._stats(self.density),
            "probability": (
                None if self.probability is None else {
                    "max_percent": round(
                        float(np.nanmax(self.probability) * 100), 1
                    ),
                    "members": self.n_members,
                    "reliability": (
                        self.reliability.value if self.reliability else None
                    ),
                }
            ),
            "note": self._note(),
        }

    def _note(self) -> str:
        if self.kind is LightningKind.OBSERVED:
            return (
                "Observed strikes. Never derived from a forecast; when no "
                "detection network is configured this layer is offline and "
                "shows nothing."
            )
        if self.kind is LightningKind.UKV_PREDICTED:
            return (
                "A single deterministic solution. UKV forecasting flashes in "
                "a cell is not a 100% chance of lightning there; for a "
                "probability use the TCM layer."
            )
        return (
            "Probability is the fraction of ensemble members forecasting "
            f"flashes. With {self.n_members} members it can only take "
            f"{self.n_members + 1} distinct values."
        )


def unavailable(kind: LightningKind, reason: str) -> LightningLayer:
    return LightningLayer(kind=kind, available=False, unavailable_reason=reason)


def ukv_layer(field: Field | None) -> LightningLayer:
    """The Met Office UKV predicted-lightning product."""
    if field is None:
        return unavailable(
            LightningKind.UKV_PREDICTED,
            "no UKV lightning field stored for this lead time",
        )
    return LightningLayer(
        kind=LightningKind.UKV_PREDICTED,
        available=True,
        forecast_hour=field.meta.forecast_hour,
        valid_time=field.meta.valid_time,
        density=field.values,
        units=field.meta.units,
        source_model=field.meta.model,
        resolution_label=field.meta.resolution_label,
        meta=field.meta,
    )


def tcm_layer(members: list[Field]) -> LightningLayer:
    """TCM's probabilistic lightning, from the ensemble members."""
    if not members:
        return unavailable(
            LightningKind.TCM_PREDICTED,
            "no ensemble lightning members stored for this lead time",
        )

    stack = np.stack([f.values for f in members])
    with np.errstate(invalid="ignore"):
        probability = np.nanmean(
            (stack > FLASH_PRESENCE_THRESHOLD).astype("float32"), axis=0
        )
        median = np.nanmedian(stack, axis=0).astype("float32")

    reference = members[0].meta
    return LightningLayer(
        kind=LightningKind.TCM_PREDICTED,
        available=True,
        forecast_hour=reference.forecast_hour,
        valid_time=reference.valid_time,
        density=median,
        probability=probability,
        units=reference.units,
        source_model=reference.model,
        resolution_label=reference.resolution_label,
        n_members=stack.shape[0],
        reliability=Reliability.for_members(stack.shape[0]),
        meta=reference,
    )


def observed_layer(valid_time: datetime | None = None) -> LightningLayer:
    """Live observed strikes, or an honest offline state.

    Never falls back to a forecast. Observed lightning is what verification
    and training score against, so a synthesised version would corrupt the
    training set as well as misleading the user.

    An hour that was never polled raises rather than returning an empty grid:
    "not observed" and "no lightning" are different facts.
    """
    from ..verification.observations import (
        ObservationsUnavailable,
        get_provider,
    )

    provider = get_provider()
    if not provider.available:
        return unavailable(
            LightningKind.OBSERVED,
            "LIGHTNING FEED OFFLINE -- "
            + provider.status().get("reason", "no detection network"),
        )

    when = valid_time or datetime.now(timezone.utc)
    try:
        observed = provider.fetch("lightning_flash_density_1h", when)
    except ObservationsUnavailable as exc:
        return unavailable(LightningKind.OBSERVED, str(exc))

    return LightningLayer(
        kind=LightningKind.OBSERVED,
        available=True,
        valid_time=observed.valid_time,
        density=observed.values,
        units="strikes per grid cell",
        source_model=observed.source,
        resolution_label="observed strike locations, counted on the 2 km grid",
    )


@dataclass(slots=True)
class LightningProducts:
    """All three layers for one lead time."""

    forecast_hour: int
    layers: dict[str, LightningLayer]

    @property
    def available_kinds(self) -> list[str]:
        return [k for k, v in self.layers.items() if v.available]

    def to_dict(self) -> dict:
        return {
            "forecast_hour": self.forecast_hour,
            "layers": {k: v.to_dict() for k, v in self.layers.items()},
            "available": self.available_kinds,
            "toggles": list(self.layers),
            "note": (
                "Predicted and observed lightning are separate products and "
                "are never combined. Each layer switches independently."
            ),
        }
