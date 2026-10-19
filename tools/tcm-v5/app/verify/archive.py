"""The immutable forecast archive.

Step 1 of the Stage 9 order, sections 3 to 7.

Section 3 makes this the source of truth, and section 4 makes it immutable:

    A forecast generated at 00 UTC must remain the exact 00 UTC forecast
    even if a later model run or later observation makes it look wrong.

That is enforced here rather than promised. `store` refuses to overwrite an
existing record and raises; the only way to record a changed forecast is to
write a NEW record with a new `revision`, and both remain readable forever.
A verification run that could quietly repair the forecast it is scoring is
not a verification run.

WHY A HASH
----------
The record carries a content hash over its scientific payload. Two things
fall out of it:

  * tampering is detectable. `verify_integrity` recomputes the hash, so a
    forecast edited on disk after the fact cannot pass unnoticed.
  * reproduction is checkable. Section 7 accepts that bit-for-bit
    reproduction may not always be practical but requires enough
    information to explain differences; a differing hash is where that
    conversation starts.

The hash deliberately EXCLUDES the archived-at timestamp and the revision
number, so re-archiving an identical forecast is detectable as identical.

WHAT MUST BE IN IT
------------------
Section 5's list, and the reason it is that long: a probability with no
provenance cannot be verified, only recorded. If the archive does not say
which model weights were used, a later finding that the weighting was wrong
cannot be traced to the forecasts it affected.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass, field as dc_field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

ARCHIVE_VERSION = "stage9.1"

#: Schema version of the record itself. Section 5 requires it; changing the
#: record shape without changing this makes two incompatible generations of
#: archive indistinguishable.
SCHEMA_VERSION = "1.0"


class ImmutableArchiveError(RuntimeError):
    """Raised on any attempt to change a forecast that already exists."""


@dataclass(frozen=True, slots=True)
class ForecastIdentity:
    """Section 5's identity block: which code produced this."""

    tcm_version: str
    forecast_engine_version: str = ""
    aggregation_version: str = ""
    calibration_version: str = ""
    spatial_version: str = ""
    parameter_set_version: str = ""
    configuration_version: str = ""
    schema_version: str = SCHEMA_VERSION
    ml_model_versions: dict[str, str] = dc_field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ForecastTiming:
    """Section 5's timing block.

    `created_at` is the one that governs leakage: everything the forecast
    used must have been available by then, and everything that verifies it
    must have become available after.
    """

    created_at: datetime
    run: datetime
    valid_time: datetime
    forecast_hour: int
    #: Length of the window the forecast describes, hours. Must match the
    #: event definition the verification uses (section 12).
    interval_hours: float = 1.0


@dataclass(frozen=True, slots=True)
class SourceRecord:
    """One NWP source as it was actually used. Section 5."""

    provider: str
    model: str
    model_version: str = ""
    run: datetime | None = None
    members: tuple[int, ...] = ()
    weight: float | None = None
    eligible: bool = True
    ineligible_reason: str = ""
    data_quality: str = ""

    def to_dict(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "model_version": self.model_version,
            "run": self.run.isoformat() if self.run else None,
            "members": list(self.members),
            "weight": self.weight,
            "eligible": self.eligible,
            "ineligible_reason": self.ineligible_reason or None,
            "data_quality": self.data_quality or None,
        }


@dataclass(frozen=True, slots=True)
class ArchivedForecast:
    """One archived TCM forecast. Immutable once stored."""

    forecast_id: str
    identity: ForecastIdentity
    timing: ForecastTiming
    sources: tuple[SourceRecord, ...]

    #: The probabilities, as produced. None means unavailable, and section
    #: 52 of Stage 7 already forbids representing that as zero.
    thunderstorm: float | None
    hazards: dict[str, float | None] = dc_field(default_factory=dict)
    hazard_conditionals: dict[str, float | None] = dc_field(
        default_factory=dict
    )
    confidence: float | None = None
    uncertainty: float | None = None
    epistemic: float | None = None
    aleatoric: float | None = None

    #: Whether these probabilities had been calibrated when issued.
    calibration_status: str = "uncalibrated"
    publishable: bool = False

    #: Scientific inputs, section 5. Kept as summaries rather than whole
    #: grids; `snapshot_ref` points at the full artefacts.
    regime_probabilities: dict[str, float] = dc_field(default_factory=dict)
    engine_scores: dict[str, float | None] = dc_field(default_factory=dict)
    spatial_features: dict[str, float | None] = dc_field(default_factory=dict)
    ensemble_statistics: dict[str, float] = dc_field(default_factory=dict)

    #: Where the forecast applies.
    latitude: float | None = None
    longitude: float | None = None
    grid: str = ""
    projection: str = ""
    grid_spacing_m: float | None = None
    effective_resolution_m: float | None = None

    #: Path to the machine-readable snapshot, if one was written.
    snapshot_ref: str | None = None
    archived_at: datetime | None = None
    revision: int = 1
    content_hash: str = ""
    notes: str = ""

    # -- identity ----------------------------------------------------------

    def payload(self) -> dict:
        """The scientific content, for hashing and storage.

        Excludes `archived_at`, `revision` and `content_hash`: a forecast
        re-archived unchanged must hash identically, or the hash cannot
        answer "is this the same forecast".
        """
        def clean(value):
            if isinstance(value, datetime):
                return value.isoformat()
            if isinstance(value, (np.floating, np.integer)):
                return value.item()
            if isinstance(value, dict):
                return {k: clean(v) for k, v in sorted(value.items())}
            if isinstance(value, (list, tuple)):
                return [clean(v) for v in value]
            return value

        return {
            "forecast_id": self.forecast_id,
            "identity": clean(asdict(self.identity)),
            "timing": clean(asdict(self.timing)),
            "sources": [s.to_dict() for s in self.sources],
            "thunderstorm": clean(self.thunderstorm),
            "hazards": clean(self.hazards),
            "hazard_conditionals": clean(self.hazard_conditionals),
            "confidence": clean(self.confidence),
            "uncertainty": clean(self.uncertainty),
            "epistemic": clean(self.epistemic),
            "aleatoric": clean(self.aleatoric),
            "calibration_status": self.calibration_status,
            "publishable": self.publishable,
            "regime_probabilities": clean(self.regime_probabilities),
            "engine_scores": clean(self.engine_scores),
            "spatial_features": clean(self.spatial_features),
            "ensemble_statistics": clean(self.ensemble_statistics),
            "location": {
                "latitude": self.latitude, "longitude": self.longitude,
                "grid": self.grid, "projection": self.projection,
                "grid_spacing_m": self.grid_spacing_m,
                "effective_resolution_m": self.effective_resolution_m,
            },
            "snapshot_ref": self.snapshot_ref,
            "notes": self.notes,
        }

    def compute_hash(self) -> str:
        blob = json.dumps(self.payload(), sort_keys=True,
                          separators=(",", ":"))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]

    def to_dict(self) -> dict:
        out = self.payload()
        out["archived_at"] = (
            self.archived_at.isoformat() if self.archived_at else None
        )
        out["revision"] = self.revision
        out["content_hash"] = self.content_hash or self.compute_hash()
        out["archive_version"] = ARCHIVE_VERSION
        return out


def make_forecast_id(
    model: str, run: datetime, forecast_hour: int,
    latitude: float | None, longitude: float | None,
) -> str:
    """A stable key for one forecast at one place and time.

    Location is rounded to four decimals -- about 10 m -- so that the same
    grid cell requested twice with slightly different coordinates produces
    one forecast_id rather than two, which would silently double-count it
    in verification.
    """
    lat = f"{latitude:.4f}" if latitude is not None else "none"
    lon = f"{longitude:.4f}" if longitude is not None else "none"
    return (
        f"{model}/{run:%Y%m%dT%H%M}/T{forecast_hour:+04d}/{lat}/{lon}"
    ).replace("+", "p")


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------

def _root() -> Path:
    from ..config import get_settings
    return get_settings().data_root / "forecast_archive"


def _path_for(forecast_id: str, revision: int, root: Path | None = None) -> Path:
    root = root or _root()
    safe = forecast_id.replace("/", "__")
    return root / f"{safe}.r{revision}.json"


def store(
    forecast: ArchivedForecast, *, root: Path | None = None,
    allow_new_revision: bool = False,
) -> Path:
    """Write a forecast to the archive. Refuses to overwrite.

    Section 4. If a record already exists for this forecast_id and
    revision, storing raises rather than replacing it. A genuine re-run
    must pass `allow_new_revision`, which writes revision n+1 and leaves
    every earlier revision in place.
    """
    root = root or _root()
    root.mkdir(parents=True, exist_ok=True)

    revision = forecast.revision
    path = _path_for(forecast.forecast_id, revision, root)
    if path.exists():
        if not allow_new_revision:
            existing = json.loads(path.read_text(encoding="utf-8"))
            same = existing.get("content_hash") == forecast.compute_hash()
            raise ImmutableArchiveError(
                f"{forecast.forecast_id} revision {revision} is already "
                f"archived and forecasts are immutable"
                + (
                    ". The content is identical, so nothing needed to change"
                    if same else
                    ". The content DIFFERS: pass allow_new_revision=True to "
                    "record it as a new revision, which keeps the original"
                )
            )
        revision = latest_revision(forecast.forecast_id, root=root) + 1
        path = _path_for(forecast.forecast_id, revision, root)

    stored = ArchivedForecast(
        **{
            **{
                f: getattr(forecast, f)
                for f in forecast.__slots__
                if f not in ("archived_at", "revision", "content_hash")
            },
            "archived_at": datetime.now(timezone.utc),
            "revision": revision,
            "content_hash": forecast.compute_hash(),
        }
    )
    path.write_text(
        json.dumps(stored.to_dict(), indent=1), encoding="utf-8"
    )
    log.info(
        "archived %s r%d hash=%s", forecast.forecast_id, revision,
        stored.content_hash,
    )
    return path


def latest_revision(forecast_id: str, *, root: Path | None = None) -> int:
    root = root or _root()
    safe = forecast_id.replace("/", "__")
    revisions = []
    for path in root.glob(f"{safe}.r*.json"):
        try:
            revisions.append(int(path.stem.rsplit(".r", 1)[1]))
        except (IndexError, ValueError):
            continue
    return max(revisions) if revisions else 0


def load(
    forecast_id: str, revision: int | None = None,
    *, root: Path | None = None,
) -> dict | None:
    """Read one archived forecast. Defaults to the latest revision."""
    root = root or _root()
    if revision is None:
        revision = latest_revision(forecast_id, root=root)
        if revision == 0:
            return None
    path = _path_for(forecast_id, revision, root)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_all(*, root: Path | None = None) -> list[dict]:
    """Every archived forecast, latest revision of each."""
    root = root or _root()
    if not root.exists():
        return []
    by_id: dict[str, tuple[int, dict]] = {}
    for path in sorted(root.glob("*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        key = record.get("forecast_id", path.stem)
        revision = int(record.get("revision", 1))
        if key not in by_id or revision > by_id[key][0]:
            by_id[key] = (revision, record)
    return [record for _, record in by_id.values()]


def verify_integrity(*, root: Path | None = None) -> dict:
    """Recompute every hash. Section 4's immutability, checked.

    A record whose stored hash does not match its content was changed after
    archiving, which is exactly what the archive exists to prevent.
    """
    root = root or _root()
    if not root.exists():
        return {"records": 0, "intact": True, "tampered": []}

    tampered: list[str] = []
    count = 0
    for path in sorted(root.glob("*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            tampered.append(f"{path.name}: unreadable")
            continue
        count += 1
        stored_hash = record.get("content_hash")
        payload = {
            k: v for k, v in record.items()
            if k not in ("archived_at", "revision", "content_hash",
                         "archive_version")
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        recomputed = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]
        if stored_hash != recomputed:
            tampered.append(
                f"{record.get('forecast_id', path.name)}: stored "
                f"{stored_hash}, content hashes to {recomputed}"
            )

    return {
        "records": count,
        "intact": not tampered,
        "tampered": tampered,
        "note": (
            "a forecast whose content no longer matches its hash was "
            "edited after archiving. Section 4 makes archived forecasts "
            "immutable precisely so verification cannot score a repaired "
            "forecast"
        ),
    }


#: Fields `from_tcm_forecast` reads directly off a Stage 7 forecast.
#: Checked by a test, because this module got them wrong once and the
#: consequence was silent: `getattr(forecast, "thunderstorm", None)` returned
#: None for every archived record, so 120 forecasts were stored with no
#: probability in them. The archive existed and contained nothing.
REQUIRED_FORECAST_FIELDS = (
    "probability", "raw_probability", "calibration", "confidence",
    "uncertainty", "hazards", "regime", "run", "valid_time",
    "forecast_hour", "latitude", "longitude", "sources", "provenance",
)


def check_forecast_interface() -> list[str]:
    """Every field this module assumes, verified against Stage 7."""
    from ..tcm.forecast import TCMForecast

    fields = set(getattr(TCMForecast, "__dataclass_fields__", {}))
    return [
        f"TCMForecast has no field {name!r}; the archive reads it and would "
        f"silently store None"
        for name in REQUIRED_FORECAST_FIELDS if name not in fields
    ]


def from_tcm_forecast(
    forecast, *, created_at: datetime | None = None,
    spatial_features: dict | None = None, snapshot_ref: str | None = None,
) -> ArchivedForecast:
    """Build an archive record from a Stage 7 `TCMForecast`.

    Required fields are read DIRECTLY, not through `getattr` with a default.
    An earlier version reached for `forecast.thunderstorm.probability` --
    which does not exist -- and every archived forecast was stored with a
    null probability. Nothing raised, and the archive looked full.

    A defensive default across a module boundary turns a wrong field name
    into silent data loss, and an archive is the worst place for that: the
    records are immutable, so the loss is permanent.
    """
    from ..tcm import forecast as tcm_forecast

    provenance = getattr(forecast, "provenance", None)
    sources: list[SourceRecord] = []
    for source in (forecast.sources or []):
        identity = getattr(source, "model", None)
        sources.append(SourceRecord(
            provider=getattr(identity, "provider", "") or "",
            model=(
                getattr(identity, "model", None)
                or getattr(source, "model", None)
                or str(source)
            ),
            model_version=getattr(identity, "version", "") or "",
            run=getattr(source, "run", None),
            members=tuple(getattr(source, "members", ()) or ()),
            weight=getattr(source, "weight", None),
            eligible=bool(getattr(source, "eligible", True)),
            ineligible_reason=getattr(source, "ineligible_reason", "") or "",
        ))

    calibration = str(
        getattr(forecast.calibration, "value", forecast.calibration)
    )
    identity = ForecastIdentity(
        tcm_version=getattr(tcm_forecast, "TCM_VERSION", "unknown"),
        spatial_version=(
            getattr(spatial_features, "processing_version", "")
            if spatial_features is not None else ""
        ),
        calibration_version=calibration,
    )
    timing = ForecastTiming(
        created_at=created_at or datetime.now(timezone.utc),
        run=forecast.run,
        valid_time=forecast.valid_time,
        forecast_hour=int(forecast.forecast_hour),
    )

    def _float(value) -> float | None:
        return float(value) if value is not None else None

    def _of(obj) -> float | None:
        return _float(getattr(obj, "value", None)) if obj is not None else None

    hazards = forecast.hazards or {}
    return ArchivedForecast(
        forecast_id=make_forecast_id(
            sources[0].model if sources else "tcm", timing.run,
            timing.forecast_hour, forecast.latitude, forecast.longitude,
        ),
        identity=identity, timing=timing, sources=tuple(sources),
        thunderstorm=_float(forecast.probability),
        hazards={
            name: _float(getattr(h, "probability", None))
            for name, h in hazards.items()
        },
        hazard_conditionals={
            name: _float(getattr(h, "conditional", None))
            for name, h in hazards.items()
        },
        confidence=_of(forecast.confidence),
        uncertainty=_of(forecast.uncertainty),
        epistemic=getattr(forecast.uncertainty, "epistemic", None),
        aleatoric=getattr(forecast.uncertainty, "aleatoric", None),
        calibration_status=calibration,
        publishable=bool(forecast.publishable),
        regime_probabilities={
            k: float(v) for k, v in (forecast.regime or {}).items()
        },
        engine_scores=_engine_scores(forecast),
        latitude=forecast.latitude,
        longitude=forecast.longitude,
        grid=getattr(provenance, "grid", "") or "",
        grid_spacing_m=getattr(provenance, "output_grid_spacing_m", None),
        effective_resolution_m=getattr(
            provenance, "effective_resolution_m", None
        ),
        spatial_features=dict(spatial_features or {}),
        snapshot_ref=snapshot_ref,
        notes="; ".join(forecast.explanation or ()),
    )


def _engine_scores(forecast) -> dict[str, float | None]:
    """Stage 5 scores, so a later failure can be attributed.

    Section 46 asks why a forecast was wrong, and Stage 9's attribution
    returns UNATTRIBUTED without these. Archiving them is what turns "the
    forecast missed" into "the environment was recognised and the initiation
    was not" -- which is a finding a developer can act on.

    The scores are not a field on `SourceForecast`. They live inside each
    stage's `combination.contributions`, which is where Stage 7 records
    which engine contributed what to the composition. Reading a
    non-existent `source.engine_scores` returned {} for every forecast, so
    the attribution had nothing to work with and the priority it derived
    was "improve the RECORD, not the forecast" -- correct advice about a
    gap this function is the fix for.
    """
    out: dict[str, float | None] = {}
    for source in (forecast.sources or []):
        for stage in (
            getattr(source, "environment", None),
            getattr(source, "realisation", None),
        ):
            if stage is None:
                continue
            # The stage's own potential, named so the two are
            # distinguishable in the archive.
            potential = getattr(stage, "potential", None)
            if potential is not None:
                out.setdefault(
                    f"{getattr(stage, 'stage', 'stage')}_potential",
                    float(potential),
                )
            combination = getattr(stage, "combination", None)
            for name, value in (
                getattr(combination, "contributions", None) or {}
            ).items():
                if name not in out and value is not None:
                    out[name] = float(value)
    return out
