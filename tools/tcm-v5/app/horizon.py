"""The TCM forecast horizon, and which models can actually reach it.

TCM forecasts to **4 days** (T+96). No single model in the blend covers that
range at useful resolution, which is the whole reason the platform is
multi-model:

    T+0   ... T+54    UKV 2 km + MOGREPS-UK 2.2 km  -- storm-scale detail
    T+54  ... T+96    MOGREPS-UK + global/European models -- environment only

The honest consequence is that a day-4 thunderstorm forecast is a forecast of
the convective ENVIRONMENT (instability, shear, forcing), not of individual
storms. `coverage_for()` reports exactly which models reach a lead time and
what the finest available resolution is there, so the UI can say "day 4:
environment only, 7 km" rather than implying day-1 precision at day 4.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .registry import MODELS, ModelSpec

#: TCM forecasts four days ahead.
FORECAST_DAYS = 4
FORECAST_HOURS = FORECAST_DAYS * 24          # T+96

#: Beyond this lead time no model in the blend resolves convection explicitly,
#: so TCM switches from storm-scale to environment-scale language.
STORM_SCALE_LIMIT_M = 4000.0


class ForecastScale(str, Enum):
    """What a forecast at a given lead time can honestly claim."""

    STORM_SCALE = "storm_scale"
    """A convection-permitting model is available: individual storms may be
    placed, though never precisely."""

    ENVIRONMENT = "environment"
    """Only parametrised-convection models reach here. TCM can describe how
    favourable the atmosphere is, not where storms will be."""

    NONE = "none"
    """No model reaches this lead time."""

    @property
    def description(self) -> str:
        return {
            ForecastScale.STORM_SCALE: (
                "convection-permitting guidance available; storm placement is "
                "indicative, not precise"
            ),
            ForecastScale.ENVIRONMENT: (
                "convective environment only -- no model here resolves storms, "
                "so this describes how favourable the atmosphere is, not where "
                "storms will occur"
            ),
            ForecastScale.NONE: "beyond every available model",
        }[self]


@dataclass(frozen=True, slots=True)
class Coverage:
    forecast_hour: int
    day: int
    models: tuple[str, ...]
    finest_resolution_m: float
    scale: ForecastScale
    ensemble_models: tuple[str, ...]

    @property
    def has_ensemble(self) -> bool:
        return bool(self.ensemble_models)

    def to_dict(self) -> dict:
        return {
            "forecast_hour": self.forecast_hour,
            "day": self.day,
            "models": list(self.models),
            "model_count": len(self.models),
            "finest_resolution_m": (
                self.finest_resolution_m if self.models else None
            ),
            "scale": self.scale.value,
            "scale_description": self.scale.description,
            "has_ensemble": self.has_ensemble,
            "ensemble_models": list(self.ensemble_models),
        }


def models_reaching(
    forecast_hour: int,
    parameter: str | None = None,
    *,
    require_uk_coverage: bool = True,
) -> list[ModelSpec]:
    """Models that can genuinely serve a lead time over the UK and Ireland.

    Three filters, each of which the horizon got wrong before:

      * is_provisioned -- a registry entry with no parameters has no adapter
        and cannot be ingested. Counting it made the horizon claim day-3
        coverage the platform could not actually produce.
      * require_uk_coverage -- AROME France HD is the finest model in the
        registry at 1.5 km and its domain stops at the Channel. Counting it
        made the horizon report a 1.5 km "finest resolution" nationally.
      * the parameter, when one is named.
    """
    # A model is only real coverage if something can actually retrieve it.
    # Imported lazily: providers imports registry, so a module-level import
    # here would close the cycle.
    from .providers import base as providers

    adapters = providers.registered()

    out = []
    for m in MODELS.values():
        if not m.is_provisioned or m.provider not in adapters:
            continue
        if forecast_hour > m.max_forecast_hour:
            continue
        if require_uk_coverage and not m.domain.covers_uk_ireland():
            continue
        if parameter is not None and parameter not in m.parameters:
            continue
        out.append(m)
    return out


def coverage_for(forecast_hour: int, parameter: str | None = None) -> Coverage:
    """What TCM can honestly offer at one lead time."""
    models = models_reaching(forecast_hour, parameter)
    finest = min(
        (m.delivered_resolution_m for m in models), default=float("inf")
    )
    if not models:
        scale = ForecastScale.NONE
    elif finest <= STORM_SCALE_LIMIT_M:
        scale = ForecastScale.STORM_SCALE
    else:
        scale = ForecastScale.ENVIRONMENT

    return Coverage(
        forecast_hour=forecast_hour,
        # T+96 is the END of day 4, not the start of day 5.
        day=min(forecast_hour // 24 + 1, FORECAST_DAYS),
        models=tuple(m.id for m in models),
        finest_resolution_m=finest if models else 0.0,
        scale=scale,
        ensemble_models=tuple(m.id for m in models if m.is_ensemble),
    )


def horizon_profile(
    step_hours: int = 6, parameter: str | None = None
) -> list[Coverage]:
    """Coverage across the whole 4-day horizon."""
    return [
        coverage_for(fh, parameter)
        for fh in range(0, FORECAST_HOURS + 1, step_hours)
    ]


def storm_scale_limit(parameter: str | None = None) -> int:
    """Last lead time with convection-permitting guidance.

    This is the boundary the outlook generator must respect: beyond it, no
    statement about individual storm locations is defensible.
    """
    last = -1
    for fh in range(0, FORECAST_HOURS + 1):
        if coverage_for(fh, parameter).scale is ForecastScale.STORM_SCALE:
            last = fh
    return last


def horizon_summary(parameter: str | None = None) -> dict:
    profile = horizon_profile(parameter=parameter)
    gaps = [c.forecast_hour for c in profile if c.scale is ForecastScale.NONE]
    return {
        "forecast_days": FORECAST_DAYS,
        "forecast_hours": FORECAST_HOURS,
        "parameter": parameter,
        "storm_scale_limit_hour": storm_scale_limit(parameter),
        "storm_scale_limit_m": STORM_SCALE_LIMIT_M,
        "profile": [c.to_dict() for c in profile],
        "uncovered_hours": gaps,
        "fully_covered": not gaps,
        "note": (
            "Beyond the storm-scale limit TCM forecasts the convective "
            "environment, not individual storms."
        ),
    }
