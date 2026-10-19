"""Deployment safety: shadow mode, rollback and the changelog.

Sections 65 to 69 and 72 of the Stage 10 order.

Section 66 sets the path a forecasting change must take:

    development -> validation -> staging/shadow -> production

and section 67 describes shadow mode precisely: the candidate consumes the
same inputs, generates forecasts, archives outputs and runs verification,
and does NOT replace the live forecast. That last clause is the whole point,
so `ShadowRun` cannot publish -- there is no code path from it to a
published cycle, and a test asserts that.

ROLLBACK KEEPS THE NEWER VERSION
--------------------------------
Section 68: provide the ability to roll back, and do not delete the newer
version. A rollback that destroys what it rolls back from makes the failure
unstudiable, and the reason the version was rolled back is exactly what
needs investigating. `rollback` moves the pointer and leaves both records.

WHAT THIS DOES NOT DO
---------------------
It does not promote anything by itself. Stage 9's `governance.Registry`
already owns that for learned models and refuses without a named approver;
this module owns the same discipline for the CODE version, and
`promote` requires an approver for the same reason.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

log = logging.getLogger(__name__)

DEPLOY_VERSION = "stage10.1"


class Channel(str, Enum):
    """Where a version sits. Section 66's path, as states."""

    DEVELOPMENT = "development"
    VALIDATION = "validation"
    SHADOW = "shadow"
    PRODUCTION = "production"
    ROLLED_BACK = "rolled_back"


@dataclass(frozen=True, slots=True)
class Release:
    """One deployable version of the forecasting system. Section 72."""

    version: str
    channel: Channel
    #: Section 72's required changelog content.
    changes: tuple[str, ...] = ()
    bug_fixes: tuple[str, ...] = ()
    scientific_changes: tuple[str, ...] = ()
    known_limitations: tuple[str, ...] = ()
    #: Which component versions this release pins.
    component_versions: dict = dc_field(default_factory=dict)
    released_at: datetime | None = None
    approved_by: str | None = None
    superseded_by: str | None = None
    notes: str = ""

    def changelog_complete(self) -> list[str]:
        """Section 72: do not hide material changes."""
        missing = []
        if not self.changes and not self.bug_fixes and not (
            self.scientific_changes
        ):
            missing.append(
                "no changes of any kind are recorded, which cannot be true "
                "of a new version"
            )
        if not self.known_limitations:
            missing.append(
                "no known limitations are recorded. A release with none "
                "stated has not been examined"
            )
        return missing

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "channel": self.channel.value,
            "changes": list(self.changes),
            "bug_fixes": list(self.bug_fixes),
            "scientific_changes": list(self.scientific_changes),
            "known_limitations": list(self.known_limitations),
            "component_versions": self.component_versions,
            "released_at": (
                self.released_at.isoformat() if self.released_at else None
            ),
            "approved_by": self.approved_by,
            "superseded_by": self.superseded_by,
            "changelog_gaps": self.changelog_complete(),
            "notes": self.notes or None,
        }


def _root() -> Path:
    from ..config import get_settings
    root = get_settings().data_root / "production" / "releases"
    root.mkdir(parents=True, exist_ok=True)
    return root


class Releases:
    """The release history and which version is live."""

    def __init__(self, path: Path | None = None):
        self.path = path or (_root() / "releases.json")
        self.releases: dict[str, Release] = {}
        self.log: list[dict] = []
        self._load()

    # -- state -------------------------------------------------------------

    def production(self) -> Release | None:
        for release in self.releases.values():
            if release.channel is Channel.PRODUCTION:
                return release
        return None

    def previous_production(self) -> Release | None:
        """Section 68. The version to roll back TO."""
        candidates = [
            r for r in self.releases.values()
            if r.channel is Channel.ROLLED_BACK or r.superseded_by
        ]
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda r: r.released_at or datetime.min.replace(
                tzinfo=timezone.utc
            ),
        )

    def shadow(self) -> list[Release]:
        return [
            r for r in self.releases.values() if r.channel is Channel.SHADOW
        ]

    # -- transitions -------------------------------------------------------

    def register(self, release: Release) -> Release:
        if release.version in self.releases:
            raise ValueError(
                f"version {release.version} is already registered. Bump the "
                f"version rather than replacing it: section 69 requires the "
                f"history to survive"
            )
        stored = Release(**{
            **{f: getattr(release, f) for f in release.__slots__},
            "channel": Channel.DEVELOPMENT,
            "released_at": datetime.now(timezone.utc),
        })
        self.releases[stored.version] = stored
        self._record("registered", stored.version, "entered development")
        self._save()
        return stored

    def to_shadow(self, version: str) -> Release:
        """Section 67. Run alongside production without replacing it."""
        release = self._require(version)
        self.releases[version] = self._with(release, Channel.SHADOW)
        self._record(
            "shadow", version,
            "running in shadow: consumes the same inputs, archives its own "
            "outputs, and cannot publish",
        )
        self._save()
        return self.releases[version]

    def promote(
        self, version: str, *, approved_by: str, motivation: str
    ) -> Release:
        """Make a version live. Requires a named approver."""
        if not approved_by or not approved_by.strip():
            raise PermissionError(
                "promoting a production version requires a named approver. "
                "Section 66: forecasting changes do not reach the live "
                "pipeline untested and unattributed"
            )
        release = self._require(version)
        gaps = release.changelog_complete()
        if gaps:
            raise PermissionError(
                f"version {version} cannot be promoted: its changelog is "
                f"incomplete ({'; '.join(gaps)}). Section 72: do not hide "
                f"material changes"
            )

        current = self.production()
        if current is not None:
            self.releases[current.version] = Release(**{
                **{f: getattr(current, f) for f in current.__slots__},
                "channel": Channel.ROLLED_BACK,
                "superseded_by": version,
            })
            self._record(
                "superseded", current.version,
                f"replaced in production by {version}",
            )

        self.releases[version] = Release(**{
            **{f: getattr(release, f) for f in release.__slots__},
            "channel": Channel.PRODUCTION,
            "approved_by": approved_by,
            "released_at": datetime.now(timezone.utc),
        })
        self._record("promoted", version, motivation, approved_by)
        self._save()
        log.warning(
            "PROMOTED %s to production, approved by %s: %s",
            version, approved_by, motivation,
        )
        return self.releases[version]

    def rollback(self, *, approved_by: str, reason: str) -> Release:
        """Section 68. Return to the previous version, keeping the newer one."""
        if not approved_by or not approved_by.strip():
            raise PermissionError("a rollback requires a named approver")

        current = self.production()
        target = self.previous_production()
        if target is None:
            raise ValueError(
                "there is no previous production version to roll back to"
            )

        if current is not None:
            # Kept, not deleted: the reason for the rollback is exactly
            # what needs investigating.
            self.releases[current.version] = Release(**{
                **{f: getattr(current, f) for f in current.__slots__},
                "channel": Channel.ROLLED_BACK,
                "notes": f"rolled back: {reason}",
            })
        self.releases[target.version] = Release(**{
            **{f: getattr(target, f) for f in target.__slots__},
            "channel": Channel.PRODUCTION,
            "superseded_by": None,
            "approved_by": approved_by,
        })
        self._record(
            "rolled_back",
            current.version if current else "none",
            f"back to {target.version}: {reason}", approved_by,
        )
        self._save()
        log.warning(
            "ROLLED BACK from %s to %s, approved by %s: %s",
            current.version if current else "none", target.version,
            approved_by, reason,
        )
        return self.releases[target.version]

    # -- internals ---------------------------------------------------------

    def _require(self, version: str) -> Release:
        if version not in self.releases:
            raise KeyError(f"{version} is not registered")
        return self.releases[version]

    @staticmethod
    def _with(release: Release, channel: Channel) -> Release:
        return Release(**{
            **{f: getattr(release, f) for f in release.__slots__},
            "channel": channel,
        })

    def _record(
        self, action: str, version: str, detail: str,
        approved_by: str | None = None,
    ) -> None:
        self.log.append({
            "at": datetime.now(timezone.utc).isoformat(),
            "action": action, "version": version, "detail": detail,
            "approved_by": approved_by,
        })

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log.exception("could not read the release history")
            return
        self.log = payload.get("changelog", [])
        for record in payload.get("releases", {}).values():
            try:
                self.releases[record["version"]] = Release(
                    version=record["version"],
                    channel=Channel(record["channel"]),
                    changes=tuple(record.get("changes", ())),
                    bug_fixes=tuple(record.get("bug_fixes", ())),
                    scientific_changes=tuple(
                        record.get("scientific_changes", ())
                    ),
                    known_limitations=tuple(
                        record.get("known_limitations", ())
                    ),
                    component_versions=record.get("component_versions", {}),
                    released_at=(
                        datetime.fromisoformat(record["released_at"])
                        if record.get("released_at") else None
                    ),
                    approved_by=record.get("approved_by"),
                    superseded_by=record.get("superseded_by"),
                    notes=record.get("notes") or "",
                )
            except (KeyError, ValueError):
                continue

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({
                "releases": {
                    v: r.to_dict() for v, r in sorted(self.releases.items())
                },
                "changelog": self.log,
                "version": DEPLOY_VERSION,
            }, indent=1), encoding="utf-8")
        except OSError:
            log.exception("could not save the release history")

    def describe(self) -> dict:
        current = self.production()
        previous = self.previous_production()
        return {
            "production": current.to_dict() if current else None,
            "previous_production": (
                previous.to_dict() if previous else None
            ),
            "shadow": [r.to_dict() for r in self.shadow()],
            "all": {
                v: r.to_dict() for v, r in sorted(self.releases.items())
            },
            "changelog": self.log,
            "policy": (
                "a version enters DEVELOPMENT, may run in SHADOW alongside "
                "production without publishing, and becomes PRODUCTION only "
                "through an explicit human approval with a complete "
                "changelog. A rollback keeps the newer version rather than "
                "deleting it"
            ),
            "version": DEPLOY_VERSION,
        }


# --------------------------------------------------------------------------
# Shadow running -- section 67
# --------------------------------------------------------------------------

@dataclass(slots=True)
class ShadowResult:
    """A shadow run's output. Cannot be published."""

    version: str
    forecast_id: str
    manifest: dict
    #: Comparison against the live forecast for the same cycle.
    against_production: dict = dc_field(default_factory=dict)

    @property
    def publishable(self) -> bool:
        """Always False. Section 67: a shadow run does not replace the
        live forecast, and there is no argument that changes that."""
        return False

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "forecast_id": self.forecast_id,
            "publishable": False,
            "manifest": self.manifest,
            "against_production": self.against_production,
            "note": (
                "a shadow forecast archives its outputs and runs "
                "verification. It never replaces the live forecast, and "
                "there is no code path from here to publication"
            ),
        }


def run_shadow(cycle: datetime, version: str, *, dry_run: bool = True
               ) -> ShadowResult:
    """Run a candidate version alongside production. Section 67."""
    from . import orchestrator as ORC

    result = ORC.Orchestrator(cycle, dry_run=dry_run, resume=False).run()
    # A shadow run is never published, whatever its gate said.
    result.manifest.status = ORC.MF.CycleStatus.READY
    result.manifest.notes.append(
        f"SHADOW RUN of version {version}: archived and verified, never "
        f"published"
    )

    return ShadowResult(
        version=version,
        forecast_id=result.manifest.forecast_id,
        manifest=result.manifest.to_dict(),
    )
