"""What changed since the last forecast, and by how much.

Step 10 of the Stage 10 order, sections 29 to 34.

Section 29 requires the reference to be EXPLICITLY SELECTED and recorded.
"the previous forecast" is ambiguous the moment a cycle fails: the previous
attempted cycle, the previous cycle that completed, and the previous cycle
that was published are three different forecasts, and comparing against the
wrong one produces a change report about a forecast nobody saw.

`Reference` names which of the three was used, and the comparison carries it.

CHANGE IS NOT DIFFERENCE
------------------------
Section 31 asks for more than new minus old, and section 32 adds the rule
that stops a change report becoming noise:

    Do not interpret any change smaller than meaningful numerical noise as
    a meteorological signal.

So every comparison carries a NOISE FLOOR, and a difference below it is
reported as unchanged rather than as a small change. The floor is not a
guess: for an uncalibrated probability whose link anchors are declared
calibration parameters, differences below a percentage point are not
distinguishable from the arbitrariness of those anchors.

COMPARING INCOMPATIBLE FIELDS
-----------------------------
Section 30 ends with "do not compare incompatible fields". Two forecasts
built by different code versions are not comparable in the way two cycles
of the same version are: the difference contains both the weather and the
software. `compare` detects that and says so rather than attributing a
version change to the atmosphere.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np

from . import access as AX
from . import manifest as MF

log = logging.getLogger(__name__)

CHANGE_VERSION = "stage10.1"

#: Below this a probability difference is not a meteorological signal.
#: Section 32. One percentage point: the link anchors that turn Stage 5
#: potentials into probabilities are declared calibration parameters with
#: deliberately uninformative defaults, so differences smaller than this
#: are inside the arbitrariness of those anchors.
PROBABILITY_NOISE = 0.01

#: Relative change is only meaningful above a floor. 2% absolute: below it,
#: a change from 0.001 to 0.002 is a 100% increase and means nothing.
RELATIVE_FLOOR = 0.02


class Reference(str, Enum):
    """Which previous forecast the comparison used. Section 29."""

    PREVIOUS_CYCLE = "previous_cycle"
    PREVIOUS_COMPLETE = "previous_complete_cycle"
    PREVIOUS_PUBLISHED = "previous_published_forecast"
    NONE = "none"


@dataclass(slots=True)
class FieldChange:
    """How one quantity changed. Section 31."""

    name: str
    unit: str
    old: float | None
    new: float | None
    absolute: float | None = None
    relative: float | None = None
    significant: bool = False
    note: str = ""

    def to_dict(self) -> dict:
        def r(value, digits=5):
            return round(value, digits) if value is not None else None
        return {
            "field": self.name, "unit": self.unit,
            "previous": r(self.old), "current": r(self.new),
            "absolute_change": r(self.absolute),
            "relative_change": (
                r(self.relative, 3) if self.relative is not None else None
            ),
            "significant": self.significant,
            "note": self.note or None,
        }


#: Fields worth comparing, with the unit and the noise floor for each.
#: Section 30's list, restricted to what a point forecast actually carries.
COMPARED: tuple[tuple[str, str, float], ...] = (
    ("thunderstorm", "probability", PROBABILITY_NOISE),
    ("lightning", "probability", PROBABILITY_NOISE),
    ("hail", "probability", PROBABILITY_NOISE),
    ("severe_hail", "probability", PROBABILITY_NOISE),
    ("heavy_rainfall", "probability", PROBABILITY_NOISE),
    ("severe_wind", "probability", PROBABILITY_NOISE),
    ("downburst", "probability", PROBABILITY_NOISE),
    ("tornado_environment", "probability", PROBABILITY_NOISE),
    ("confidence", "1", 0.05),
    ("uncertainty", "1", 0.05),
)


def compare_field(
    name: str, unit: str, old: float | None, new: float | None,
    noise: float,
) -> FieldChange:
    """One field's change, with the noise floor applied. Section 32."""
    change = FieldChange(name=name, unit=unit, old=old, new=new)
    if old is None or new is None:
        change.note = (
            "unavailable in one of the two forecasts, so no change can be "
            "computed. This is NOT a change of zero"
        )
        return change

    change.absolute = new - old
    if abs(change.absolute) < noise:
        change.note = (
            f"unchanged: the difference of {change.absolute:+.4f} is below "
            f"the {noise} noise floor and is not a meteorological signal"
        )
        return change

    change.significant = True
    if abs(old) >= RELATIVE_FLOOR:
        change.relative = change.absolute / old
    else:
        change.note = (
            f"the previous value was {old:.4f}, too small for a relative "
            f"change to mean anything, so only the absolute change is given"
        )
    return change


def compare_forecasts(previous: dict, current: dict) -> dict:
    """Compare two archived forecast records. Sections 30 and 31."""
    changes: list[FieldChange] = []

    for name, unit, noise in COMPARED:
        if name in ("confidence", "uncertainty"):
            old, new = previous.get(name), current.get(name)
        elif name == "thunderstorm":
            old, new = previous.get("thunderstorm"), current.get("thunderstorm")
        else:
            old = (previous.get("hazards") or {}).get(name)
            new = (current.get("hazards") or {}).get(name)
        changes.append(compare_field(name, unit, old, new, noise))

    significant = [c for c in changes if c.significant]
    increased = [c for c in significant if (c.absolute or 0) > 0]
    decreased = [c for c in significant if (c.absolute or 0) < 0]

    return {
        "fields": [c.to_dict() for c in changes],
        "significant_changes": len(significant),
        "increased": [c.name for c in increased],
        "decreased": [c.name for c in decreased],
        "largest": (
            max(significant, key=lambda c: abs(c.absolute or 0)).to_dict()
            if significant else None
        ),
        "note": (
            f"differences below the noise floor are reported as unchanged. "
            f"Section 32: a change smaller than meaningful numerical noise "
            f"is not a meteorological signal"
        ),
    }


def compare_weights(previous: dict, current: dict) -> dict:
    """Section 33. Model weight movement, with the reason where known."""
    old_models = (previous.get("models") or {})
    new_models = (current.get("models") or {})
    rows = []
    for model in sorted(set(old_models) | set(new_models)):
        old = (old_models.get(model) or {}).get("weight")
        new = (new_models.get(model) or {}).get("weight")
        old_state = (old_models.get(model) or {}).get("state")
        new_state = (new_models.get(model) or {}).get("state")
        why = ""
        if old_state != new_state:
            why = f"availability changed: {old_state} -> {new_state}"
        elif old is not None and new is not None and abs(new - old) > 0.01:
            why = (
                "the skill store changed, or the eligible model set did"
            )
        rows.append({
            "model": model,
            "previous_weight": old, "current_weight": new,
            "previous_state": old_state, "current_state": new_state,
            "change": (
                round(new - old, 4)
                if old is not None and new is not None else None
            ),
            "why": why or "no material change",
        })
    return {
        "models": rows,
        "note": (
            "a weight that moved because a model became unavailable is an "
            "OPERATIONAL change, not a change in trust. The state column "
            "separates the two"
        ),
    }


def spatial_change(
    previous: dict[str, float], current: dict[str, float], *,
    noise: float = PROBABILITY_NOISE,
) -> dict:
    """Section 32. Where the forecast changed, across the point set."""
    shared = sorted(set(previous) & set(current))
    if not shared:
        return {
            "available": False,
            "reason": "the two forecasts share no common location",
        }

    deltas = {k: current[k] - previous[k] for k in shared}
    significant = {k: v for k, v in deltas.items() if abs(v) >= noise}
    increased = sorted(
        (k for k, v in significant.items() if v > 0),
        key=lambda k: -significant[k],
    )
    decreased = sorted(
        (k for k, v in significant.items() if v < 0),
        key=lambda k: significant[k],
    )
    values = np.array(list(deltas.values()))

    return {
        "available": True,
        "locations_compared": len(shared),
        "locations_changed": len(significant),
        "increased_at": increased[:8],
        "decreased_at": decreased[:8],
        "mean_change": round(float(values.mean()), 5),
        "max_increase": round(float(values.max()), 5),
        "max_decrease": round(float(values.min()), 5),
        "unchanged_fraction": round(
            1.0 - len(significant) / len(shared), 3
        ),
        "note": (
            f"{len(shared) - len(significant)} of {len(shared)} locations "
            f"changed by less than {noise} and are reported as unchanged"
        ),
    }


def compare_to_previous(
    manifest: MF.CycleManifest, context: dict, *,
    prefer: Reference = Reference.PREVIOUS_PUBLISHED,
) -> dict:
    """Compare this cycle against an explicitly chosen reference.

    Section 29: which forecast was used is recorded, because "the previous
    forecast" means three different things once a cycle has failed.
    """
    history = MF.history(limit=30)
    candidates = [
        m for m in history
        if m.get("forecast_id") != manifest.forecast_id
        and m.get("cycle", "") < manifest.cycle.isoformat()
    ]
    if not candidates:
        return {
            "available": False,
            "reason": (
                "no earlier cycle is archived, so there is nothing to "
                "compare against. This is the first forecast"
            ),
            "reference": None,
        }

    chosen = None
    used = Reference.NONE
    if prefer is Reference.PREVIOUS_PUBLISHED:
        chosen = next(
            (m for m in candidates
             if m.get("status") == MF.CycleStatus.PUBLISHED.value), None
        )
        used = Reference.PREVIOUS_PUBLISHED
    if chosen is None:
        chosen = next(
            (m for m in candidates
             if m.get("status") in (
                 MF.CycleStatus.PUBLISHED.value,
                 MF.CycleStatus.READY.value,
                 MF.CycleStatus.DEGRADED.value,
             )), None
        )
        used = Reference.PREVIOUS_COMPLETE
    if chosen is None:
        chosen = candidates[0]
        used = Reference.PREVIOUS_CYCLE

    # Section 30: two forecasts built by different code are not comparable
    # in the way two cycles of one version are.
    old_versions = chosen.get("versions", {})
    new_versions = manifest.versions.to_dict()
    differing = [
        key for key in new_versions
        if key not in ("configuration", "code")
        and old_versions.get(key) != new_versions.get(key)
    ]

    result = {
        "available": True,
        "reference": chosen.get("forecast_id"),
        "reference_kind": used.value,
        "reference_cycle": chosen.get("cycle"),
        "reference_status": chosen.get("status"),
        "weights": compare_weights(chosen, manifest.to_dict()),
        "version": CHANGE_VERSION,
    }

    if differing:
        result["comparable"] = False
        result["incomparable_because"] = (
            f"the two forecasts were produced by different software "
            f"({', '.join(differing)}), so the difference between them "
            f"contains both the weather and the code change. Section 30: "
            f"do not compare incompatible fields"
        )
        result["summary"] = (
            "not compared: the reference forecast was built by a different "
            "software version"
        )
        return result

    result["comparable"] = True
    forecasts = context.get("forecasts") or []
    current_points = {
        _point_key(f): _probability(f) for f in forecasts
    }
    current_points = {k: v for k, v in current_points.items() if v is not None}

    previous_points = chosen.get("products", {}).get("point_probabilities")
    if isinstance(previous_points, dict) and current_points:
        result["spatial"] = spatial_change(previous_points, current_points)
        changed = result["spatial"].get("locations_changed", 0)
        total = result["spatial"].get("locations_compared", 0)
        result["summary"] = (
            f"compared against {chosen.get('forecast_id')}: {changed} of "
            f"{total} locations changed materially"
        )
    else:
        result["spatial"] = {
            "available": False,
            "reason": (
                "the reference cycle stored no point probabilities to "
                "compare against"
            ),
        }
        result["summary"] = (
            f"compared against {chosen.get('forecast_id')}; model weights "
            f"only, no point field was stored to compare"
        )
    return result


def _point_key(forecast) -> str:
    return AX.location_key(forecast)


def _probability(forecast) -> float | None:
    return AX.probability(forecast)
