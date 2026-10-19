"""What each model can actually deliver, discovered rather than declared.

Stage 2. `registry.py` holds what a model IS -- its grid, domain, cycles,
resolution. This module holds what a model is CURRENTLY SERVING, which is a
different question and changes without warning.

The distinction matters because the two have already diverged. `registry.py`
declares `mogreps_uk` with a hand-written parameter tuple; the DataHub
account no longer has a MOGREPS-UK order at all, so every one of those
declared parameters is unavailable while the registry still asserts them. A
declared capability that nothing verifies is a promise the platform cannot
keep, and downstream code that trusts it will ask for fields that are not
coming.

So capability here is derived from the provider's own catalogue: the file
list the provider publishes for the current run. If it is not in the
catalogue, it is not available, and `available()` says so.

WHAT THIS MODULE MUST NOT DO
----------------------------
* It must not decide a model is good, bad, preferable or substitutable.
  Those are Stage 5 questions.
* It must not fill a gap by pointing at another model. An unavailable field
  returns an explicit unavailable state, never a quiet redirection.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from typing import Iterable

from .variables import CanonicalField, LevelType, expand, is_known

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class FieldCapability:
    """One canonical field, and where it can be got."""

    canonical: str
    level_type: LevelType
    level: float | None
    #: The provider identity, kept so a request can be built from this alone.
    native_surface: str
    native_parameter: str
    native_level: str | None
    units: str
    #: Lead times this field is published for, in hours.
    forecast_hours: tuple[int, ...]
    #: Ensemble members, empty for a deterministic field.
    members: tuple[int, ...] = ()

    @property
    def is_ensemble(self) -> bool:
        return len(self.members) > 1


@dataclass(slots=True)
class ModelCapability:
    """Everything one model is currently serving."""

    model_id: str
    provider: str
    product: str                    # the order / dataset id
    run: datetime | None
    fields: dict[str, FieldCapability] = dc_field(default_factory=dict)
    forecast_hours: tuple[int, ...] = ()
    #: Provider entries the variable registry did not recognise. Surfaced
    #: rather than dropped, because an unrecognised field is a gap in TCM's
    #: vocabulary and somebody should see it.
    unrecognised: tuple[tuple[str, str], ...] = ()
    discovered_at: datetime | None = None
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error and bool(self.fields)

    def has(self, canonical: str) -> bool:
        return canonical in self.fields

    def levels_of(self, stem: str) -> list[float]:
        """Every level a profile variable is served on, ascending.

        `stem` is the canonical name without its level suffix, e.g.
        "temperature" for temperature_850.
        """
        out = [
            f.level for f in self.fields.values()
            if f.level is not None and f.canonical.startswith(stem + "_")
        ]
        return sorted(set(out))

    def profile_levels(self, level_type: LevelType) -> list[float]:
        out = [
            f.level for f in self.fields.values()
            if f.level_type is level_type and f.level is not None
        ]
        return sorted(set(out))

    def to_dict(self) -> dict:
        return {
            "model": self.model_id,
            "provider": self.provider,
            "product": self.product,
            "run": self.run.isoformat() if self.run else None,
            "discovered_at": (
                self.discovered_at.isoformat() if self.discovered_at else None
            ),
            "ok": self.ok,
            "error": self.error or None,
            "field_count": len(self.fields),
            "forecast_hours": list(self.forecast_hours),
            "isobaric_levels_hpa": self.profile_levels(LevelType.ISOBARIC),
            "height_levels_m": self.profile_levels(LevelType.HEIGHT_AGL),
            "ensemble_members": sorted({
                m for f in self.fields.values() for m in f.members
            }),
            "fields": sorted(self.fields),
            "unrecognised": [
                {"surface": s, "parameter": p} for s, p in self.unrecognised
            ],
        }


def from_datahub_catalogue(
    model_id: str,
    product: str,
    files: Iterable[dict],
    *,
    provider: str = "metoffice_datahub",
    members: tuple[int, ...] = (),
    now: datetime | None = None,
) -> ModelCapability:
    """Build a capability record from a DataHub `/latest` file listing.

    The listing is the provider's own statement of what exists for the
    current run, so it is the only honest source for availability.

    Two file-naming conventions are in play and both are handled, because
    they were verified live on 2026-08-30:

      mo-uk, mo-global    one file per parameter+level, holding EVERY
                          timestep. `timesteps` lists them all.
      mo-mogrepsg         one file per parameter+level+timestep, each
                          holding all 18 ensemble members as separate GRIB
                          messages distinguished by `perturbationNumber`.

    Members are therefore NOT visible in the catalogue at all -- they live
    inside the GRIB. The caller passes them in, and they are recorded per
    field so nothing downstream has to rediscover them.
    """
    cap = ModelCapability(
        model_id=model_id,
        provider=provider,
        product=product,
        run=None,
        discovered_at=now or datetime.now(timezone.utc),
    )

    hours_by_field: dict[str, set[int]] = defaultdict(set)
    spec_by_field: dict[str, CanonicalField] = {}
    unknown: set[tuple[str, str]] = set()
    all_hours: set[int] = set()
    runs: set[datetime] = set()

    for entry in files:
        surface = entry.get("surfaceId", "")
        levels = [str(x) for x in (entry.get("levels") or [])]
        steps = [int(t) for t in (entry.get("timesteps") or [])]
        all_hours.update(steps)

        stamp = entry.get("runDateTime")
        if stamp:
            try:
                runs.add(
                    datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                )
            except ValueError:
                pass

        for parameter in entry.get("parameters", []):
            if not is_known(surface, parameter):
                unknown.add((surface, parameter))
                continue
            for spec in expand(surface, parameter, levels):
                spec_by_field[spec.canonical] = spec
                hours_by_field[spec.canonical].update(steps)

    for name, spec in spec_by_field.items():
        cap.fields[name] = FieldCapability(
            canonical=name,
            level_type=spec.level_type,
            level=spec.level,
            native_surface=spec.native_surface,
            native_parameter=spec.native_parameter,
            native_level=spec.native_level,
            units=spec.units,
            forecast_hours=tuple(sorted(hours_by_field[name])),
            members=members,
        )

    cap.forecast_hours = tuple(sorted(all_hours))
    cap.unrecognised = tuple(sorted(unknown))
    # The newest run in the listing is the one being served.
    cap.run = max(runs) if runs else None
    return cap


# ---------------------------------------------------------------------------
# Availability answers
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Availability:
    """A yes/no with a reason. Never a silent no."""

    available: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.available


def available(
    cap: ModelCapability | None,
    canonical: str,
    forecast_hour: int | None = None,
    member: int | None = None,
) -> Availability:
    """Can this exact field be requested right now?

    Every negative answer carries the reason, so a downstream 'missing' can
    be explained without re-deriving it.
    """
    if cap is None:
        return Availability(False, "model has no capability record")
    if cap.error:
        return Availability(False, f"capability lookup failed: {cap.error}")
    field = cap.fields.get(canonical)
    if field is None:
        return Availability(
            False, f"{canonical!r} is not served by {cap.model_id}"
        )
    if forecast_hour is not None and forecast_hour not in field.forecast_hours:
        served = field.forecast_hours
        window = f"{served[0]}..{served[-1]}" if served else "none"
        return Availability(
            False,
            f"{canonical!r} is not served at T+{forecast_hour} "
            f"by {cap.model_id} (published: {window})",
        )
    if member is not None:
        if not field.members:
            return Availability(
                False, f"{cap.model_id} is deterministic; no member {member}"
            )
        if member not in field.members:
            return Availability(
                False,
                f"member {member} not in {cap.model_id} "
                f"({min(field.members)}..{max(field.members)})",
            )
    return Availability(True)
