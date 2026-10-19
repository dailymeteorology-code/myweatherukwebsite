"""Observations to verify against.

Verification and training both need to know what actually happened. For
convection over the UK and Ireland that means, above all, observed lightning
strikes: they are the only routinely available, unambiguous record of whether
a thunderstorm occurred at a place and time.

A provider is selected by `LIGHTNING_PROVIDER`. With no feed configured the
offline provider RAISES rather than returning zeros, because the two things
observations unblock are the two that make TCM more than a model viewer:

  * **Verification** cannot score a forecast with nothing to score it against.
  * **Training** cannot learn which model to trust in which regime without
    knowing which model was right.

Nothing anywhere fabricates an observation. A synthesised "observation" would
not merely mislead a reader; it would be written into the training set as
ground truth, and every hour it covered would score as a correctly forecast
quiet hour.
"""
from __future__ import annotations

import abc
import logging
from dataclasses import dataclass
from datetime import datetime

import numpy as np

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ObservationField:
    """What was observed, on the TCM analysis grid."""

    parameter: str
    valid_time: datetime
    values: np.ndarray
    source: str
    #: Window the observation covers, e.g. 1 hour of strike accumulation.
    window_hours: float = 1.0


class ObservationsUnavailable(RuntimeError):
    """No observations exist for this request. Never a reason to invent any."""


class ObservationProvider(abc.ABC):
    """A source of what actually happened."""

    name: str = "abstract"

    @property
    @abc.abstractmethod
    def available(self) -> bool:
        """False when nothing can be retrieved."""

    @abc.abstractmethod
    def status(self) -> dict:
        """Human-readable state, for the verification dashboard."""

    @abc.abstractmethod
    def fetch(
        self, parameter: str, valid_time: datetime, window_hours: float = 1.0
    ) -> ObservationField:
        """Observations for one parameter and valid time."""


class OfflineObservations(ObservationProvider):
    """The state of the platform today: no detection network configured."""

    name = "none"

    def __init__(self, reason: str | None = None) -> None:
        self._reason = reason or (
            "No observation provider is configured. Set LIGHTNING_PROVIDER "
            "and supply credentials to enable verification and training."
        )

    @property
    def available(self) -> bool:
        return False

    def status(self) -> dict:
        return {
            "provider": self.name,
            "available": False,
            "reason": self._reason,
            "blocks": [
                "forecast verification (nothing to score against)",
                "blend training (cannot learn which model was right)",
            ],
            "note": (
                "Observations are never synthesised from a forecast. A "
                "fabricated observation would be written into the training "
                "set as ground truth."
            ),
        }

    def fetch(
        self, parameter: str, valid_time: datetime, window_hours: float = 1.0
    ) -> ObservationField:
        raise ObservationsUnavailable(self._reason)


_PROVIDER: ObservationProvider | None = None


def get_provider() -> ObservationProvider:
    """The configured observation provider, or the offline one."""
    global _PROVIDER
    if _PROVIDER is None:
        from ..config import get_settings

        settings = get_settings()
        configured = (settings.lightning_provider or "none").lower()
        if configured in ("", "none"):
            _PROVIDER = OfflineObservations()
        elif configured == "blitzortung":
            from .blitzortung import BlitzortungObservations

            url = settings.lightning_api_url
            if not url:
                _PROVIDER = OfflineObservations(
                    "LIGHTNING_PROVIDER is 'blitzortung' but "
                    "LIGHTNING_API_URL is not set."
                )
            else:
                _PROVIDER = BlitzortungObservations(
                    url, settings.data_root / "observations" / "lightning"
                )
        else:
            # A name is configured but no adapter implements it. Reporting
            # that precisely is more useful than a generic "offline".
            _PROVIDER = OfflineObservations(
                f"LIGHTNING_PROVIDER is set to {configured!r} but no adapter "
                "implements it yet."
            )
    return _PROVIDER


def set_provider(provider: ObservationProvider | None) -> None:
    """Install a provider, or pass None to fall back to configuration."""
    global _PROVIDER
    _PROVIDER = provider
