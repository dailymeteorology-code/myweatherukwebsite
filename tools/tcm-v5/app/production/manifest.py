"""The cycle manifest: exactly what produced one forecast.

Steps 2 and 3 of the Stage 10 order, sections 5, 6, 9, 17 and 65.

Section 5 asks for a single record that defines what was used to produce a
forecast, and section 17 asks for it to be complete enough to reproduce it.
The manifest is that record, and it is written BEFORE the forecast runs
rather than assembled afterwards from whatever happened -- a manifest built
from the outcome would describe the run that succeeded rather than the run
that was attempted, and the difference is exactly what an operator needs
when a cycle goes wrong.

NEVER FABRICATE
---------------
Section 9 is absolute. Every model carries an explicit `ModelState`, and
there is no state meaning "assumed present". A model that did not arrive is
UNAVAILABLE and the manifest says so; it is never quietly replaced by
another model, by zeros, or by its own previous run.

The one legitimate fallback -- serving the previous valid forecast when the
current cycle fails -- is handled in `gate.py` and is required to carry the
ORIGINAL cycle timestamp (section 54). It is never presented as the current
cycle.

VERSIONS ARE PART OF THE IDENTITY
---------------------------------
Section 65: a production forecast must never have an ambiguous software
state. `Versions` collects every component version at run time from the
modules themselves, so a forecast cannot claim a version its code does not
have, and `cache_key` folds them into the identity used for reuse --
section 16's requirement that the same input under a new algorithm must not
return the old result.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass, field as dc_field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path

log = logging.getLogger(__name__)

#: Version of the production layer itself.
PRODUCTION_VERSION = "stage10.1"

#: Schema version of the manifest record.
MANIFEST_SCHEMA = "1.0"


class ModelState(str, Enum):
    """Section 6's states. Every model has exactly one, always."""

    #: The run is complete and every required field is stored.
    AVAILABLE = "available"
    #: Expected, not yet arrived, still inside its normal window.
    PENDING = "pending"
    #: Past its normal arrival window and still not complete.
    DELAYED = "delayed"
    #: Some fields present, some missing.
    PARTIAL = "partial"
    #: Not published for this cycle at all.
    UNAVAILABLE = "unavailable"
    #: The provider returned an error rather than nothing.
    FAILED = "failed"
    #: Present, but from an older cycle than this forecast is for.
    STALE = "stale"
    #: Present and usable, but Stage 6 has ruled it out.
    INELIGIBLE = "ineligible"

    @property
    def usable(self) -> bool:
        """Whether this model may contribute to the forecast."""
        return self in (ModelState.AVAILABLE, ModelState.PARTIAL)

    @property
    def is_failure(self) -> bool:
        """Whether an operator should be told about this state."""
        return self in (
            ModelState.FAILED, ModelState.DELAYED, ModelState.UNAVAILABLE
        )


class CycleStatus(str, Enum):
    """Section 52's publication states."""

    PLANNED = "planned"
    PROCESSING = "processing"
    VALIDATING = "validating"
    READY = "ready"
    PUBLISHED = "published"
    DEGRADED = "degraded"
    FAILED = "failed"
    SUPERSEDED = "superseded"


@dataclass(frozen=True, slots=True)
class Versions:
    """Every component version. Section 65.

    Collected from the modules at run time rather than written by hand, so
    a manifest cannot claim a version the running code does not have.
    """

    tcm: str = ""
    production: str = PRODUCTION_VERSION
    schema: str = MANIFEST_SCHEMA
    stage5_engines: str = ""
    stage6_weighting: str = ""
    stage8_spatial: str = ""
    stage9_verification: str = ""
    calibration: str = ""
    configuration: str = ""
    code: str = ""

    @classmethod
    def source_fingerprint(cls) -> str:
        """A content hash over the scientific source. Section 65.

        This repository is not a git checkout, so there is no commit to
        record and an empty code version would leave the software state
        ambiguous -- which is exactly what section 65 forbids. Hashing the
        source of every stage gives a real, reproducible identity: two
        forecasts with the same fingerprint were produced by the same code,
        and a change anywhere in the science changes it.
        """
        import hashlib
        from pathlib import Path

        root = Path(__file__).resolve().parent.parent
        digest = hashlib.sha256()
        packages = (
            "catalogue", "profiles", "parameters", "engines", "skill",
            "tcm", "spatial", "verify", "production", "grib", "pipeline",
        )
        for package in packages:
            directory = root / package
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.py")):
                try:
                    digest.update(path.name.encode())
                    digest.update(path.read_bytes())
                except OSError:
                    log.warning("could not hash %s", path)
        return digest.hexdigest()[:16]

    @classmethod
    def collect(cls, *, configuration: str = "", code: str = "") -> "Versions":
        def version_of(module_path: str, attribute: str) -> str:
            try:
                import importlib
                module = importlib.import_module(module_path)
                return str(getattr(module, attribute, "") or "")
            except Exception:            # noqa: BLE001
                log.warning("could not read %s.%s", module_path, attribute)
                return "unknown"

        return cls(
            tcm=version_of("app.tcm.forecast", "TCM_VERSION"),
            stage5_engines=version_of("app.engines.base", "STAGE5_VERSION"),
            stage6_weighting=version_of("app.skill.weights", "WEIGHTING_VERSION"),
            stage8_spatial=version_of("app.spatial.static",
                                      "PROCESSING_VERSION"),
            stage9_verification=version_of("app.verify.run",
                                           "VERIFICATION_VERSION"),
            calibration=version_of("app.verify.calibrate",
                                   "CALIBRATION_VERSION"),
            configuration=configuration or "default",
            code=code or cls.source_fingerprint(),
        )

    def cache_key(self) -> str:
        """Section 16. Folds every version into one identity.

        Two runs with the same inputs but different algorithm versions must
        NOT share a cache entry, or the old result is returned as though the
        new algorithm had produced it.
        """
        blob = json.dumps(asdict(self), sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()[:16]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class ModelEntry:
    """One NWP source's participation in this cycle. Section 5."""

    model_id: str
    provider: str
    state: ModelState
    #: Which run of that model, when there is one.
    run: datetime | None = None
    #: Ensemble members actually present, not expected.
    members: tuple[int, ...] = ()
    expected_members: int = 0
    #: Fields required, and how many arrived.
    fields_expected: int = 0
    fields_present: int = 0
    #: Stage 6's weight, filled once weighting has run.
    weight: float | None = None
    #: Why this model is in the state it is. Required for every state that
    #: is not AVAILABLE -- see __post_init__.
    reason: str = ""
    first_seen: datetime | None = None
    last_checked: datetime | None = None

    def __post_init__(self) -> None:
        if self.state is not ModelState.AVAILABLE and not self.reason:
            raise ValueError(
                f"{self.model_id} is {self.state.value} and must say why. "
                f"Section 9: a model that did not contribute must be "
                f"recorded as not contributing, with the reason, rather "
                f"than left to be guessed at"
            )

    @property
    def completeness(self) -> float:
        if self.fields_expected <= 0:
            return 0.0
        return min(1.0, self.fields_present / self.fields_expected)

    @property
    def ensemble_complete(self) -> bool:
        if self.expected_members <= 0:
            return True
        return len(self.members) >= self.expected_members

    def to_dict(self) -> dict:
        return {
            "model": self.model_id,
            "provider": self.provider,
            "state": self.state.value,
            "run": self.run.isoformat() if self.run else None,
            "usable": self.state.usable,
            "fields": {
                "expected": self.fields_expected,
                "present": self.fields_present,
                "completeness": round(self.completeness, 4),
            },
            "ensemble": {
                "members_present": len(self.members),
                "members_expected": self.expected_members,
                "complete": self.ensemble_complete,
                "members": list(self.members),
            } if self.expected_members else None,
            "weight": self.weight,
            "reason": self.reason or None,
            "first_seen": (
                self.first_seen.isoformat() if self.first_seen else None
            ),
            "last_checked": (
                self.last_checked.isoformat() if self.last_checked else None
            ),
        }


@dataclass(slots=True)
class CycleManifest:
    """Section 5. Exactly what a forecast cycle is and what it used."""

    forecast_id: str
    cycle: datetime
    versions: Versions
    models: dict[str, ModelEntry] = dc_field(default_factory=dict)
    status: CycleStatus = CycleStatus.PLANNED
    #: True when the forecast ran without every expected model. Section 8.
    degraded: bool = False
    degraded_because: list[str] = dc_field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    #: Task records, filled by the orchestrator.
    tasks: dict = dc_field(default_factory=dict)
    #: Product references, filled by the product pipeline.
    products: dict = dc_field(default_factory=dict)
    #: What this cycle was compared against. Section 29.
    compared_with: str | None = None
    notes: list[str] = dc_field(default_factory=list)

    # -- model bookkeeping -------------------------------------------------

    def record(self, entry: ModelEntry) -> None:
        self.models[entry.model_id] = entry

    def usable_models(self) -> list[str]:
        return sorted(
            m for m, e in self.models.items() if e.state.usable
        )

    def unusable_models(self) -> dict[str, str]:
        return {
            m: f"{e.state.value}: {e.reason}"
            for m, e in self.models.items() if not e.state.usable
        }

    def by_state(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for model, entry in sorted(self.models.items()):
            out.setdefault(entry.state.value, []).append(model)
        return out

    def mark_degraded(self, reason: str) -> None:
        """Record a degradation. Section 8: the state must be explicit."""
        self.degraded = True
        if reason not in self.degraded_because:
            self.degraded_because.append(reason)
        log.warning("cycle %s degraded: %s", self.forecast_id, reason)

    @property
    def duration_seconds(self) -> float | None:
        if not (self.started_at and self.completed_at):
            return None
        return (self.completed_at - self.started_at).total_seconds()

    # -- serialisation -----------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "forecast_id": self.forecast_id,
            "cycle": self.cycle.isoformat(),
            "status": self.status.value,
            "degraded": self.degraded,
            "degraded_because": self.degraded_because,
            "versions": self.versions.to_dict(),
            "version_key": self.versions.cache_key(),
            "models": {
                m: e.to_dict() for m, e in sorted(self.models.items())
            },
            "models_by_state": self.by_state(),
            "models_usable": self.usable_models(),
            "models_unusable": self.unusable_models(),
            "timing": {
                "started_at": (
                    self.started_at.isoformat() if self.started_at else None
                ),
                "completed_at": (
                    self.completed_at.isoformat()
                    if self.completed_at else None
                ),
                "duration_seconds": (
                    round(self.duration_seconds, 1)
                    if self.duration_seconds is not None else None
                ),
            },
            "tasks": self.tasks,
            "products": self.products,
            "compared_with": self.compared_with,
            "notes": self.notes,
            "schema": MANIFEST_SCHEMA,
        }

    def summary(self) -> dict:
        """Section 57's machine-readable operational summary."""
        states = self.by_state()
        return {
            "forecast_cycle": self.cycle.strftime("%Y-%m-%d %HZ"),
            "forecast_id": self.forecast_id,
            "status": self.status.value,
            "degraded": self.degraded,
            "models": (
                f"{len(self.usable_models())} / {len(self.models)} usable"
            ),
            "models_by_state": states,
            "processing_seconds": (
                round(self.duration_seconds, 1)
                if self.duration_seconds is not None else None
            ),
            "tasks": {
                name: task.get("state") for name, task in self.tasks.items()
            },
            "products": sorted(self.products),
            "calibration": self.versions.calibration,
            "tcm_version": self.versions.tcm,
        }


# --------------------------------------------------------------------------
# Identity and storage
# --------------------------------------------------------------------------

def make_forecast_id(cycle: datetime, versions: Versions) -> str:
    """A stable id for one cycle under one software state.

    The version key is part of the id on purpose: rerunning the same cycle
    after a code change produces a DIFFERENT forecast, and section 69
    requires the earlier one to survive rather than be overwritten.
    """
    return f"tcm-{cycle:%Y%m%dT%H%M}-{versions.cache_key()}"


def _root() -> Path:
    from ..config import get_settings
    return get_settings().data_root / "production" / "manifests"


def save(manifest: CycleManifest, *, root: Path | None = None) -> Path:
    root = root or _root()
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{manifest.forecast_id}.json"
    path.write_text(
        json.dumps(manifest.to_dict(), indent=1), encoding="utf-8"
    )
    return path


def load(forecast_id: str, *, root: Path | None = None) -> dict | None:
    path = (root or _root()) / f"{forecast_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.exception("could not read manifest %s", forecast_id)
        return None


def history(*, limit: int = 50, root: Path | None = None) -> list[dict]:
    """Every stored cycle, newest first. Section 69."""
    root = root or _root()
    if not root.exists():
        return []
    out: list[dict] = []
    for path in sorted(root.glob("tcm-*.json"), reverse=True)[:limit]:
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda m: m.get("cycle", ""), reverse=True)


def latest_published(*, root: Path | None = None) -> dict | None:
    """The most recent cycle that actually reached PUBLISHED.

    Used by section 54's fallback. Deliberately not "the most recent
    manifest": a failed cycle is still a manifest, and serving its products
    would be serving a forecast that was refused publication.
    """
    for record in history(limit=200, root=root):
        if record.get("status") == CycleStatus.PUBLISHED.value:
            return record
    return None


def build(
    cycle: datetime, *, expected_models: dict[str, str],
    configuration: str = "", code: str = "",
) -> CycleManifest:
    """Start a manifest for a cycle, before anything has been attempted.

    Every expected model begins as PENDING. A model that never arrives ends
    the cycle as PENDING or DELAYED rather than silently absent, which is
    what makes section 9's rule visible in the record.
    """
    versions = Versions.collect(configuration=configuration, code=code)
    manifest = CycleManifest(
        forecast_id=make_forecast_id(cycle, versions),
        cycle=cycle, versions=versions,
    )
    now = datetime.now(timezone.utc)
    for model_id, provider in sorted(expected_models.items()):
        manifest.record(ModelEntry(
            model_id=model_id, provider=provider,
            state=ModelState.PENDING,
            reason="expected for this cycle, not yet checked",
            last_checked=now,
        ))
    return manifest
