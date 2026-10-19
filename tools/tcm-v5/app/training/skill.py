"""Learned model skill: the trained half of the adaptive blend.

The blend's other factors -- resolution suitability, lead-time decay,
agreement, ensemble spread -- are reasoned a priori. They encode what
*should* be true. This module holds what *was* true: how each model actually
performed, verified against observations, for a given regime, parameter group
and lead time over the UK and Ireland.

The key design decision is that skill is **neutral until trained**. An
untrained store returns 1.0 for every model, which multiplies out of the
weighting entirely, and `is_trained` is False so the blend explanation says
so. A platform that silently applied made-up skill numbers would be worse
than one with no skill term at all, because the numbers would look earned.

Skill is keyed by (model, parameter group, regime, lead band). That is
deliberate and is the whole point of training here: a single per-model skill
number averaged over a year would hide that UKV may excel in a slack summer
airmass and struggle in a sheared autumn trough. See `regime.py` for why the
regimes are what they are.

Training itself needs three things the platform does not yet have:

  1. a forecast archive -- accumulating from the moment ingest runs, since
     every field is stored with full provenance;
  2. observations to verify against -- lightning strikes above all, and the
     lightning provider is currently `none`;
  3. enough seasons to be climatologically meaningful for these islands.

Until those exist, this module is scaffolding with an honest default, not a
trained model, and it reports itself as such.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field as dc_field
from datetime import datetime, timezone
from pathlib import Path

from ..params import ParamGroup
from .regime import ConvectiveRegime

log = logging.getLogger(__name__)

#: Lead-time bands. Model skill changes character with range: a
#: convection-permitting model's edge is largest on day 1 and largely gone by
#: day 4, and that is exactly what training should measure rather than assume.
LEAD_BANDS: tuple[tuple[int, int, str], ...] = (
    (0, 12, "0-12h"),
    (12, 24, "12-24h"),
    (24, 48, "24-48h"),
    (48, 72, "48-72h"),
    (72, 96, "72-96h"),
)

#: A model needs at least this many verified cases in a bucket before its
#: learned skill is used at all. Below it the bucket stays neutral: three wet
#: Tuesdays are not a climatology.
MIN_CASES_FOR_SKILL = 30

#: How far a learned skill score may move a model's weight. Training adjusts
#: the blend; it does not get to silence a model entirely on limited evidence.
SKILL_FLOOR = 0.5
SKILL_CEILING = 1.8


def lead_band(forecast_hour: int) -> str:
    for low, high, label in LEAD_BANDS:
        if low <= forecast_hour < high:
            return label
    return LEAD_BANDS[-1][2]


@dataclass(frozen=True, slots=True)
class SkillKey:
    model_id: str
    group: str
    regime: str
    band: str

    @classmethod
    def build(cls, model_id: str, group: ParamGroup,
              regime: ConvectiveRegime, forecast_hour: int) -> "SkillKey":
        return cls(model_id, group.value, regime.value, lead_band(forecast_hour))

    def as_str(self) -> str:
        return f"{self.model_id}|{self.group}|{self.regime}|{self.band}"

    @classmethod
    def parse(cls, raw: str) -> "SkillKey":
        return cls(*raw.split("|"))


@dataclass
class SkillRecord:
    """What verification found for one bucket."""

    n_cases: int = 0
    #: Mean absolute error, in the parameter's own units.
    mae: float | None = None
    #: Skill relative to the multi-model mean: >1 means better than the pack.
    relative_skill: float = 1.0
    updated_at: str | None = None

    @property
    def is_usable(self) -> bool:
        return self.n_cases >= MIN_CASES_FOR_SKILL

    @property
    def factor(self) -> float:
        """The multiplier the blend applies. Neutral until well evidenced."""
        if not self.is_usable:
            return 1.0
        return float(min(max(self.relative_skill, SKILL_FLOOR), SKILL_CEILING))


@dataclass
class SkillStore:
    """Learned skill, persisted as JSON.

    Deliberately a plain file rather than a database: the whole platform runs
    without a database server, and a trained blend must be inspectable and
    diffable by a forecaster who wants to know why a weight moved.
    """

    path: Path | None = None
    records: dict[str, SkillRecord] = dc_field(default_factory=dict)
    trained_at: str | None = None
    training_window: str | None = None
    n_verified_cases: int = 0

    # --- state ------------------------------------------------------------

    @property
    def is_trained(self) -> bool:
        """True only when real verification has produced usable buckets."""
        return any(r.is_usable for r in self.records.values())

    def status(self) -> dict:
        usable = [k for k, r in self.records.items() if r.is_usable]
        return {
            "is_trained": self.is_trained,
            "trained_at": self.trained_at,
            "training_window": self.training_window,
            "n_verified_cases": self.n_verified_cases,
            "buckets_total": len(self.records),
            "buckets_usable": len(usable),
            "min_cases_for_skill": MIN_CASES_FOR_SKILL,
            "skill_floor": SKILL_FLOOR,
            "skill_ceiling": SKILL_CEILING,
            "note": (
                "Skill is neutral (1.0) for every model until verification "
                "has produced enough cases in a bucket. An untrained store "
                "does not influence the blend."
                if not self.is_trained else
                "Learned skill is active for the buckets listed as usable; "
                "all others remain neutral."
            ),
        }

    # --- lookup -----------------------------------------------------------

    def factor(self, model_id: str, group: ParamGroup,
               regime: ConvectiveRegime, forecast_hour: int) -> float:
        """Skill multiplier for one model in one situation. 1.0 if untrained."""
        key = SkillKey.build(model_id, group, regime, forecast_hour).as_str()
        record = self.records.get(key)
        if record is None:
            return 1.0
        return record.factor

    def record_for(self, model_id: str, group: ParamGroup,
                   regime: ConvectiveRegime,
                   forecast_hour: int) -> SkillRecord | None:
        key = SkillKey.build(model_id, group, regime, forecast_hour).as_str()
        return self.records.get(key)

    def explain(self, model_id: str, group: ParamGroup,
                regime: ConvectiveRegime, forecast_hour: int) -> dict:
        record = self.record_for(model_id, group, regime, forecast_hour)
        if record is None:
            return {
                "trained": False, "factor": 1.0,
                "reason": "no verified cases for this model in this situation",
            }
        if not record.is_usable:
            return {
                "trained": False, "factor": 1.0,
                "n_cases": record.n_cases,
                "reason": (
                    f"only {record.n_cases} verified cases; "
                    f"{MIN_CASES_FOR_SKILL} needed before learned skill counts"
                ),
            }
        return {
            "trained": True,
            "factor": round(record.factor, 3),
            "n_cases": record.n_cases,
            "mae": record.mae,
            "relative_skill": round(record.relative_skill, 3),
            "reason": (
                f"verified over {record.n_cases} cases in the "
                f"{regime.value} regime at {lead_band(forecast_hour)}"
            ),
        }

    # --- persistence ------------------------------------------------------

    @classmethod
    def load(cls, path: Path) -> "SkillStore":
        if not path.exists():
            log.info("no skill store at %s; blend runs untrained", path)
            return cls(path=path)
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = {
            key: SkillRecord(**value)
            for key, value in raw.get("records", {}).items()
        }
        store = cls(
            path=path,
            records=records,
            trained_at=raw.get("trained_at"),
            training_window=raw.get("training_window"),
            n_verified_cases=raw.get("n_verified_cases", 0),
        )
        log.info(
            "skill store loaded: %d buckets, %d usable, trained=%s",
            len(store.records),
            sum(1 for r in store.records.values() if r.is_usable),
            store.is_trained,
        )
        return store

    def save(self, path: Path | None = None) -> Path:
        target = path or self.path
        if target is None:
            raise ValueError("no path to save the skill store to")
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "trained_at": self.trained_at,
            "training_window": self.training_window,
            "n_verified_cases": self.n_verified_cases,
            "records": {k: asdict(v) for k, v in self.records.items()},
        }
        target.write_text(json.dumps(payload, indent=2, sort_keys=True),
                          encoding="utf-8")
        return target

    # --- training ---------------------------------------------------------

    def update(self, key: SkillKey, *, n_cases: int, mae: float,
               relative_skill: float) -> None:
        """Record a verification result for one bucket."""
        self.records[key.as_str()] = SkillRecord(
            n_cases=n_cases, mae=mae, relative_skill=relative_skill,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        self.n_verified_cases = sum(r.n_cases for r in self.records.values())
        self.trained_at = datetime.now(timezone.utc).isoformat()


_STORE: SkillStore | None = None


def get_store() -> SkillStore:
    """The process-wide skill store, loaded from the data directory."""
    global _STORE
    if _STORE is None:
        from ..config import get_settings

        _STORE = SkillStore.load(get_settings().data_root / "skill.json")
    return _STORE


def set_store(store: SkillStore) -> None:
    """Replace the active store. Used by training and by tests."""
    global _STORE
    _STORE = store
