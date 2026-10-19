"""Model identity, lineage and independence.

Two things this module exists to prevent.

**Collapsing distinct systems into one label.** "ECMWF" is not a model. IFS
deterministic, the IFS ensemble and AIFS are three different systems with
different physics, different resolution and — in AIFS's case — a different
kind of model entirely. Skill learned for one does not transfer to another,
and a verification record labelled only "ECMWF" is unusable the moment the
mix changes.

**Treating correlated models as independent evidence.** Five forecasts are
not five votes when three of them share an assimilation system, or when
thirty of them are members of one ensemble. ICON, ICON-EU and ICON-D2 are
one model at three resolutions, nested from each other. MOGREPS-UK is UKV's
ensemble. Counting these as independent inflates apparent consensus exactly
when the models are most likely to be wrong together.

So every forecast carries a full `ModelIdentity`, and every identity carries
its `family`. `effective_independent_count` turns a set of models into the
number of genuinely independent opinions they represent — which the later
aggregation stage needs, and which averaging weights alone cannot express.

NOTHING HERE ASSIGNS SKILL. Identity is who a model is; skill is what it has
done. Keeping them apart is what lets a model be upgraded without silently
inheriting its predecessor's record.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum


class Kind(str, Enum):
    """What sort of forecast system produced this."""

    DETERMINISTIC = "deterministic"
    ENSEMBLE_MEAN = "ensemble_mean"
    ENSEMBLE_MEMBER = "ensemble_member"
    ENSEMBLE_CONTROL = "ensemble_control"
    #: Data-driven / machine-learned NWP (AIFS and successors). Kept
    #: distinct because its error characteristics are not those of a
    #: physics-based model and should never be pooled with them.
    DATA_DRIVEN = "data_driven"


class Family(str, Enum):
    """Lineage. Models in one family are NOT independent evidence.

    The grouping is by shared assimilation, shared physics or direct
    nesting, not by provider. AIFS sits apart from IFS despite both being
    ECMWF, because a data-driven model trained on reanalysis fails in
    different ways from the physics model it was trained on -- which is
    precisely why it is worth having.
    """

    UKMO_PHYSICS = "ukmo_physics"      # UKV, UKMO Global, MOGREPS-*
    ECMWF_IFS = "ecmwf_ifs"            # IFS deterministic and ensemble
    ECMWF_AIFS = "ecmwf_aifs"          # data-driven, separate lineage
    DWD_ICON = "dwd_icon"              # ICON, ICON-EU, ICON-D2 (nested)
    METEOFRANCE = "meteofrance"        # AROME, ARPEGE
    NCEP = "ncep"                      # GFS
    UNKNOWN = "unknown"

    @property
    def is_known(self) -> bool:
        return self is not Family.UNKNOWN


@dataclass(frozen=True, slots=True)
class ModelIdentity:
    """Exactly which forecast system produced a value.

    Equality and hashing use every field, so a model upgrade produces a
    genuinely different identity rather than silently continuing the old
    one's verification record.
    """

    provider: str
    model: str
    #: The specific product, where a provider offers several from one model.
    product: str = ""
    kind: Kind = Kind.DETERMINISTIC
    family: Family = Family.UNKNOWN
    #: Provider's model version or cycle string, where published. This is
    #: what makes a skill reset possible: without it, a resolution upgrade
    #: is invisible and its historical record silently misleads.
    version: str = ""
    #: Ensemble member number. None for anything not a member.
    member: int | None = None
    #: Native resolution, m. Used for suitability, NOT for skill: finer is
    #: not automatically better and verification has to establish it.
    resolution_m: float | None = None

    @property
    def key(self) -> str:
        """Stable string key for storage and lookup."""
        parts = [self.provider, self.model]
        # Not both: a product literally named "deterministic" alongside
        # Kind.DETERMINISTIC produced keys like
        # `ecmwf/ifs/deterministic/deterministic`.
        if self.product and self.product != self.kind.value:
            parts.append(self.product)
        parts.append(self.kind.value)
        if self.version:
            parts.append(f"v{self.version}")
        if self.member is not None:
            parts.append(f"m{self.member:02d}")
        return "/".join(parts)

    @property
    def system_key(self) -> str:
        """Key for the SYSTEM, ignoring member and version.

        Members of one ensemble share this; a model and its upgrade also
        share it, which is what lets a skill transition be detected rather
        than the two records simply merging.
        """
        parts = [self.provider, self.model]
        if self.product:
            parts.append(self.product)
        return "/".join(parts)

    @property
    def is_member(self) -> bool:
        return self.kind in (Kind.ENSEMBLE_MEMBER, Kind.ENSEMBLE_CONTROL)

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "system_key": self.system_key,
            "provider": self.provider,
            "model": self.model,
            "product": self.product or None,
            "kind": self.kind.value,
            "family": self.family.value,
            "version": self.version or None,
            "member": self.member,
            "resolution_m": self.resolution_m,
        }


#: The systems Stage 6 is built to represent. Registering one here does NOT
#: give it skill -- that has to be earned through verification -- it only
#: says the framework knows what it is and which family it belongs to.
KNOWN_MODELS: dict[str, ModelIdentity] = {
    "ukv": ModelIdentity(
        provider="metoffice", model="ukv", kind=Kind.DETERMINISTIC,
        family=Family.UKMO_PHYSICS, resolution_m=2000.0,
    ),
    "ukmo_global": ModelIdentity(
        provider="metoffice", model="global", kind=Kind.DETERMINISTIC,
        family=Family.UKMO_PHYSICS, resolution_m=10000.0,
    ),
    "mogreps_uk": ModelIdentity(
        provider="metoffice", model="mogreps_uk", kind=Kind.ENSEMBLE_MEMBER,
        family=Family.UKMO_PHYSICS, resolution_m=2200.0,
    ),
    "mogreps_g": ModelIdentity(
        provider="metoffice", model="mogreps_g", kind=Kind.ENSEMBLE_MEMBER,
        family=Family.UKMO_PHYSICS, resolution_m=20000.0,
    ),
    "ecmwf": ModelIdentity(
        provider="ecmwf", model="ifs", product="deterministic",
        kind=Kind.DETERMINISTIC, family=Family.ECMWF_IFS,
        resolution_m=9000.0,
    ),
    "ecmwf_ens": ModelIdentity(
        provider="ecmwf", model="ifs", product="ensemble",
        kind=Kind.ENSEMBLE_MEMBER, family=Family.ECMWF_IFS,
        resolution_m=18000.0,
    ),
    "aifs": ModelIdentity(
        provider="ecmwf", model="aifs", kind=Kind.DATA_DRIVEN,
        family=Family.ECMWF_AIFS, resolution_m=28000.0,
    ),
    "icon": ModelIdentity(
        provider="dwd", model="icon", kind=Kind.DETERMINISTIC,
        family=Family.DWD_ICON, resolution_m=13000.0,
    ),
    "icon_eu": ModelIdentity(
        provider="dwd", model="icon_eu", kind=Kind.DETERMINISTIC,
        family=Family.DWD_ICON, resolution_m=7000.0,
    ),
    "icon_d2": ModelIdentity(
        provider="dwd", model="icon_d2", kind=Kind.DETERMINISTIC,
        family=Family.DWD_ICON, resolution_m=2100.0,
    ),
    "arome": ModelIdentity(
        provider="meteofrance", model="arome", kind=Kind.DETERMINISTIC,
        family=Family.METEOFRANCE, resolution_m=1300.0,
    ),
    "arpege": ModelIdentity(
        provider="meteofrance", model="arpege", kind=Kind.DETERMINISTIC,
        family=Family.METEOFRANCE, resolution_m=10000.0,
    ),
    "gfs": ModelIdentity(
        provider="ncep", model="gfs", kind=Kind.DETERMINISTIC,
        family=Family.NCEP, resolution_m=13000.0,
    ),
}


def identify(model_id: str, *, member: int | None = None,
             version: str = "") -> ModelIdentity:
    """The identity for a platform model id.

    An unknown id gets an UNKNOWN family rather than being guessed into an
    existing one. Guessing would make an unfamiliar model share another's
    correlation structure, which is worse than admitting ignorance: it would
    quietly suppress genuinely independent evidence.
    """
    base = KNOWN_MODELS.get(model_id)
    if base is None:
        return ModelIdentity(
            provider="unknown", model=model_id, family=Family.UNKNOWN,
            member=member, version=version,
        )
    if member is None and not version:
        return base
    return ModelIdentity(
        provider=base.provider, model=base.model, product=base.product,
        kind=base.kind, family=base.family,
        version=version or base.version, member=member,
        resolution_m=base.resolution_m,
    )


def effective_independent_count(
    identities: list[ModelIdentity],
) -> tuple[float, dict]:
    """How many genuinely independent opinions a set of models represents.

    Not `len(identities)`. Two reductions apply, in order:

    1. **Ensemble members collapse.** Thirty MOGREPS members are one
       system's spread, not thirty models. All members of a system count as
       ONE contribution to independence; their spread is separate
       information, handled by the agreement module.
    2. **Families are discounted.** Within a family, models share
       assimilation, physics or nesting. The second and subsequent members
       of a family contribute progressively less, following

           contribution(k) = 1 / k          for the k-th member

       so a family with three models counts as 1 + 1/2 + 1/3 = 1.83 rather
       than 3. That harmonic form is a documented modelling choice, not a
       fitted one: it has the properties required (the first member counts
       fully, additional ones help but with diminishing return, and nothing
       ever counts as zero) without introducing a tunable parameter.

    Returns the count and a breakdown, because the breakdown is what makes
    an apparent consensus auditable.
    """
    systems: dict[str, ModelIdentity] = {}
    members_per_system: dict[str, int] = {}
    for identity in identities:
        key = identity.system_key
        members_per_system[key] = members_per_system.get(key, 0) + 1
        systems.setdefault(key, identity)

    by_family: dict[Family, list[str]] = {}
    for key, identity in systems.items():
        by_family.setdefault(identity.family, []).append(key)

    total = 0.0
    breakdown: dict[str, float] = {}
    for family, keys in by_family.items():
        if family is Family.UNKNOWN:
            # An unknown family is assumed independent. Assuming otherwise
            # would let an unrecognised model be silently discounted.
            for key in keys:
                total += 1.0
                breakdown[key] = 1.0
            continue
        for rank, key in enumerate(sorted(keys), start=1):
            contribution = 1.0 / rank
            total += contribution
            breakdown[key] = round(contribution, 4)

    return round(total, 4), {
        "nominal_forecasts": len(identities),
        "distinct_systems": len(systems),
        "effective_independent": round(total, 4),
        "per_system_contribution": breakdown,
        "members_per_system": members_per_system,
        "families": {
            f.value: sorted(keys) for f, keys in by_family.items()
        },
        "note": (
            "ensemble members collapse to their system; within a family the "
            "k-th model contributes 1/k. Five correlated forecasts are not "
            "five votes"
        ),
    }


def same_family(a: ModelIdentity, b: ModelIdentity) -> bool:
    """True when two models share lineage and are therefore correlated."""
    return (
        a.family is b.family
        and a.family.is_known
    )


@dataclass(slots=True)
class VersionLedger:
    """When each system changed version, so skill can be reset.

    A provider changing physics, resolution or assimilation breaks the
    assumption that historical performance transfers. Section 61 requires
    recording it; this is the record.
    """

    changes: dict[str, list[tuple[datetime, str]]] = dc_field(
        default_factory=dict
    )

    def record(self, system_key: str, at: datetime, version: str) -> None:
        entries = self.changes.setdefault(system_key, [])
        if entries and entries[-1][1] == version:
            return
        entries.append((at, version))
        entries.sort(key=lambda item: item[0])

    def version_at(self, system_key: str, when: datetime) -> str | None:
        """The version in force at a time, using only what was known then."""
        entries = self.changes.get(system_key, [])
        current = None
        for at, version in entries:
            if at <= when:
                current = version
            else:
                break
        return current

    def changed_between(
        self, system_key: str, start: datetime, end: datetime
    ) -> list[tuple[datetime, str]]:
        """Version changes inside a window.

        A skill window spanning one of these is pooling forecasts from
        different systems. The store flags it rather than refusing, because
        a small upgrade often does transfer -- but the caller is told.
        """
        return [
            (at, version)
            for at, version in self.changes.get(system_key, [])
            if start < at <= end
        ]

    def to_dict(self) -> dict:
        return {
            key: [(at.isoformat(), version) for at, version in entries]
            for key, entries in self.changes.items()
        }


#: The platform's ledger. Populated as provider upgrades are observed.
LEDGER = VersionLedger()
