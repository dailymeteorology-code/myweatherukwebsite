"""Reading a Stage 7 forecast, in one place.

Every production module needs the same handful of values off a
`TCMForecast`, and the first version of this stage got the field names
wrong: it reached for `forecast.thunderstorm.probability`, which does not
exist, and `getattr` returned None. Nothing raised. The probabilities were
silently absent, the gate refused the cycle for a missing layer, and the
real cause took a debugging session to find.

So the accessors live here, once, and `check_interface()` asserts they
match the dataclass. A field renamed in Stage 7 now fails a test instead of
producing a forecast full of Nones.

The lesson generalises: a defensive `getattr(obj, "name", None)` across a
module boundary converts a rename into silent data loss. Where the
attribute is REQUIRED, this module reads it directly and lets the
AttributeError happen.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

#: Fields the production layer relies on. Checked against the real class.
REQUIRED_FIELDS = (
    "valid_time", "run", "forecast_hour", "latitude", "longitude",
    "probability", "raw_probability", "calibration", "confidence",
    "uncertainty", "hazards", "sources", "regime", "provenance",
    "explanation", "limiting", "integrity", "reason",
)

REQUIRED_PROPERTIES = ("available", "publishable")


def check_interface() -> list[str]:
    """Every field this module assumes, verified against Stage 7."""
    from ..tcm.forecast import TCMForecast

    problems: list[str] = []
    fields = set(getattr(TCMForecast, "__dataclass_fields__", {}))
    for name in REQUIRED_FIELDS:
        if name not in fields:
            problems.append(
                f"TCMForecast has no field {name!r}; the production layer "
                f"reads it and would silently receive None"
            )
    for name in REQUIRED_PROPERTIES:
        if not hasattr(TCMForecast, name):
            problems.append(f"TCMForecast has no property {name!r}")
    return problems


# --------------------------------------------------------------------------
# The accessors
# --------------------------------------------------------------------------

def probability(forecast) -> float | None:
    """P(thunderstorm). None means could not compute, never zero."""
    value = forecast.probability
    return float(value) if value is not None else None


def raw_probability(forecast) -> float | None:
    """The value before calibration. Section 27: never overwritten."""
    value = forecast.raw_probability
    return float(value) if value is not None else None


def calibration(forecast) -> str:
    status = forecast.calibration
    return str(getattr(status, "value", status))


def publishable(forecast) -> bool:
    return bool(forecast.publishable)


def confidence(forecast) -> float | None:
    obj = forecast.confidence
    value = getattr(obj, "value", None) if obj is not None else None
    return float(value) if value is not None else None


def uncertainty(forecast) -> float | None:
    obj = forecast.uncertainty
    value = getattr(obj, "value", None) if obj is not None else None
    return float(value) if value is not None else None


def hazards(forecast) -> dict[str, dict]:
    """Every hazard as {probability, conditional}, both kept.

    Both halves travel together because Stage 7 is explicit that a low
    unconditional probability with a high conditional is a real and
    dangerous state -- few storms expected, but any that form would be
    severe.
    """
    out: dict[str, dict] = {}
    for name, hazard in (forecast.hazards or {}).items():
        value = getattr(hazard, "probability", None)
        conditional = getattr(hazard, "conditional", None)
        out[name] = {
            "probability": float(value) if value is not None else None,
            "conditional": (
                float(conditional) if conditional is not None else None
            ),
        }
    return out


def engine_scores(forecast) -> dict[str, float]:
    """Stage 5 scores, from whichever source carries them."""
    out: dict[str, float] = {}
    for source in forecast.sources or []:
        scores = getattr(source, "engine_scores", None) or {}
        for name, value in scores.items():
            if value is not None:
                out.setdefault(name, float(value))
    return out


def explanation(forecast) -> tuple[str, ...]:
    """Stage 7's own explanation. Section 2: do not rewrite it."""
    return tuple(forecast.explanation or ())


def limiting(forecast) -> tuple[str, ...]:
    """What Stage 7 says is holding the forecast back."""
    return tuple(forecast.limiting or ())


def regime(forecast) -> dict[str, float]:
    return dict(forecast.regime or {})


def integrity(forecast) -> list[str]:
    return list(forecast.integrity or [])


def location_key(forecast) -> str:
    """A stable key for one point and lead time."""
    return (
        f"{forecast.latitude:.3f},{forecast.longitude:.3f}"
        f"@T+{forecast.forecast_hour}"
    )


def all_probabilities(forecast) -> list[tuple[str, float | None]]:
    """Every probability, labelled by where it came from.

    Labelled so a range violation names the field: "hail=1.4" is
    actionable, "a probability was out of range" is not.
    """
    out: list[tuple[str, float | None]] = [
        ("thunderstorm", probability(forecast)),
        ("thunderstorm_raw", raw_probability(forecast)),
    ]
    for name, values in hazards(forecast).items():
        out.append((name, values["probability"]))
        if values["conditional"] is not None:
            out.append((f"{name}|storm", values["conditional"]))
    out.append(("confidence", confidence(forecast)))
    out.append(("uncertainty", uncertainty(forecast)))
    return out


def summarise(forecast) -> dict:
    """One forecast as a plain structure."""
    return {
        "valid_time": forecast.valid_time.isoformat(),
        "run": forecast.run.isoformat(),
        "forecast_hour": forecast.forecast_hour,
        "latitude": forecast.latitude,
        "longitude": forecast.longitude,
        "probability": probability(forecast),
        "raw_probability": raw_probability(forecast),
        "calibration": calibration(forecast),
        "publishable": publishable(forecast),
        "confidence": confidence(forecast),
        "uncertainty": uncertainty(forecast),
        "hazards": hazards(forecast),
        "regime": regime(forecast),
        "explanation": list(explanation(forecast)),
        "limiting": list(limiting(forecast)),
        "integrity": integrity(forecast),
        "reason": forecast.reason or None,
    }
