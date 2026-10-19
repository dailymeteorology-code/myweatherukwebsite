"""The forecast orchestrator.

Steps 2 and 4 to 9 of the Stage 10 order, sections 3, 13, 14, 18, 19, 25
and 26.

Section 2 sets the constraint this module works under:

    Do not rewrite the scientific engine. Use clearly defined interfaces.
    The production layer should ORCHESTRATE the existing components.

So every task below is a thin adapter onto a Stage 2-9 module. There is no
meteorology in this file. If a task looks like it is computing something,
that is a bug.

RESUME IS THE POINT
-------------------
Section 14: a cycle whose final aggregation failed should not re-download
its data. The orchestrator persists the manifest after every task, so a
rerun reads what already completed and starts from the first task that did
not. `resume=False` forces a full recomputation and says so in the record
rather than quietly reusing.

Section 13 makes reruns safe: a task that already completed is REUSED, and
the record says `reused: true`, so a cycle run twice produces one forecast
rather than two inconsistent ones.

LOCKING
-------
Section 18. Two workers on the same cycle would download the same files
twice and race on the same outputs. The lock is a file with the holder's
process id and a timestamp; a stale lock older than the maximum plausible
cycle duration is broken with a warning rather than blocking forever,
because a worker killed mid-cycle would otherwise wedge the platform.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import manifest as MF
from . import readiness as RD
from . import tasks as TK

log = logging.getLogger(__name__)

ORCHESTRATOR_VERSION = "stage10.1"

#: A lock older than this is assumed to belong to a dead worker. Longer
#: than any plausible cycle: the measured full-grid Stage 4 pass alone is
#: about 67 s, and a complete cycle with products is minutes, so an hour is
#: far beyond normal and still far below "wedged forever".
LOCK_STALE_AFTER = timedelta(hours=1)


class CycleLocked(RuntimeError):
    """Another worker holds this cycle. Section 18."""


@dataclass(slots=True)
class RunResult:
    """What one orchestrated cycle did."""

    manifest: MF.CycleManifest
    decision: RD.Decision | None = None
    records: dict[str, TK.TaskRecord] = dc_field(default_factory=dict)
    #: Objects produced by tasks, passed between them. Not persisted: the
    #: manifest records what happened, this carries the actual arrays.
    context: dict = dc_field(default_factory=dict)
    stopped_at: str | None = None
    stopped_because: str = ""

    @property
    def succeeded(self) -> bool:
        return self.manifest.status in (
            MF.CycleStatus.READY, MF.CycleStatus.PUBLISHED,
            MF.CycleStatus.DEGRADED,
        )

    def to_dict(self) -> dict:
        return {
            "manifest": self.manifest.to_dict(),
            "decision": self.decision.to_dict() if self.decision else None,
            "tasks": {
                name: record.to_dict()
                for name, record in self.records.items()
            },
            "stopped_at": self.stopped_at,
            "stopped_because": self.stopped_because or None,
            "succeeded": self.succeeded,
            "orchestrator_version": ORCHESTRATOR_VERSION,
        }


# --------------------------------------------------------------------------
# Locking -- section 18
# --------------------------------------------------------------------------

def _lock_path(forecast_id: str) -> Path:
    from ..config import get_settings
    root = get_settings().data_root / "production" / "locks"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{forecast_id}.lock"


class CycleLock:
    """A file lock for one forecast cycle."""

    def __init__(self, forecast_id: str, *, break_stale: bool = True):
        self.path = _lock_path(forecast_id)
        self.forecast_id = forecast_id
        self.break_stale = break_stale
        self._held = False

    def __enter__(self) -> "CycleLock":
        if self.path.exists():
            held = self._read()
            age = self._age(held)
            if age is not None and age > LOCK_STALE_AFTER and self.break_stale:
                log.warning(
                    "breaking a stale lock on %s held by pid %s for %.0f "
                    "minutes: the worker that took it is not running",
                    self.forecast_id, held.get("pid"), age.total_seconds() / 60,
                )
            else:
                raise CycleLocked(
                    f"{self.forecast_id} is locked by pid "
                    f"{held.get('pid')} since {held.get('taken_at')}. "
                    f"Section 18: two workers on one cycle would download "
                    f"the same data twice and race on the same outputs"
                )
        self.path.write_text(json.dumps({
            "pid": os.getpid(),
            "taken_at": datetime.now(timezone.utc).isoformat(),
            "forecast_id": self.forecast_id,
        }), encoding="utf-8")
        self._held = True
        return self

    def __exit__(self, *_exc) -> None:
        if self._held:
            try:
                self.path.unlink(missing_ok=True)
            except OSError:
                log.exception("could not release the lock on %s",
                              self.forecast_id)
            self._held = False

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _age(held: dict) -> timedelta | None:
        stamp = held.get("taken_at")
        if not stamp:
            return None
        try:
            return datetime.now(timezone.utc) - datetime.fromisoformat(stamp)
        except ValueError:
            return None


# --------------------------------------------------------------------------
# The task adapters -- thin wrappers onto Stages 2 to 9
# --------------------------------------------------------------------------

class Orchestrator:
    """Runs one forecast cycle through the dependency graph."""

    def __init__(
        self, cycle: datetime, *,
        expected_models: dict[str, str] | None = None,
        rules: RD.Rules | None = None,
        retry: TK.RetryPolicy | None = None,
        resume: bool = True,
        dry_run: bool = False,
    ):
        self.cycle = cycle.astimezone(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        )
        self.expected_models = expected_models or self._default_models()
        self.rules = rules or RD.Rules()
        self.retry = retry or TK.RetryPolicy()
        self.resume = resume
        self.dry_run = dry_run

    @staticmethod
    def _default_models() -> dict[str, str]:
        try:
            from ..registry import MODELS
            return {
                model_id: getattr(spec, "provider", "unknown")
                for model_id, spec in MODELS.items()
            }
        except Exception:            # noqa: BLE001
            log.exception("could not read the model registry")
            return {"ukv": "metoffice_datahub"}

    # -- entry point -------------------------------------------------------

    def run(self) -> RunResult:
        """Execute the cycle. Section 25, in the graph's order."""
        problems = TK.validate_graph()
        if problems:
            raise ValueError(f"the task graph is malformed: {problems}")

        manifest = MF.build(
            self.cycle, expected_models=self.expected_models
        )
        previous = MF.load(manifest.forecast_id)
        if previous and self.resume:
            manifest = self._restore(manifest, previous)

        result = RunResult(manifest=manifest)
        with CycleLock(manifest.forecast_id):
            manifest.started_at = manifest.started_at or datetime.now(
                timezone.utc
            )
            manifest.status = MF.CycleStatus.PROCESSING
            MF.save(manifest)

            for wave in TK.execution_order():
                if result.stopped_at:
                    break
                for name in wave:
                    self._run_task(name, result)
                    if result.stopped_at:
                        break
                MF.save(manifest)

            self._finalise(result)
            MF.save(manifest)
        return result

    # -- internals ---------------------------------------------------------

    def _restore(
        self, manifest: MF.CycleManifest, previous: dict
    ) -> MF.CycleManifest:
        """Section 14. Carry a partial run forward.

        Everything the earlier attempt established, not only its task
        records. Carrying tasks alone lost the products and -- worse -- the
        DEGRADED state, because the detect task that set it was reused
        rather than re-run. Section 8 requires a degraded cycle to say so,
        and a resumed cycle that forgot it would publish as though it had
        run on a full model set.
        """
        manifest.tasks = previous.get("tasks", {})
        manifest.products = previous.get("products", {}) or {}
        manifest.notes = list(previous.get("notes", []) or [])
        manifest.compared_with = previous.get("compared_with")
        manifest.degraded = bool(previous.get("degraded"))
        manifest.degraded_because = list(
            previous.get("degraded_because", []) or []
        )

        # The model states too: an operator reading a resumed manifest must
        # see which models were actually used, not a set reset to PENDING.
        for model_id, record in (previous.get("models") or {}).items():
            try:
                state = MF.ModelState(record["state"])
                manifest.record(MF.ModelEntry(
                    model_id=model_id,
                    provider=record.get("provider", ""),
                    state=state,
                    run=(
                        datetime.fromisoformat(record["run"])
                        if record.get("run") else None
                    ),
                    members=tuple(
                        (record.get("ensemble") or {}).get("members", ())
                    ),
                    expected_members=(
                        (record.get("ensemble") or {}).get(
                            "members_expected", 0
                        )
                    ),
                    fields_expected=(
                        record.get("fields", {}).get("expected", 0)
                    ),
                    fields_present=record.get("fields", {}).get("present", 0),
                    weight=record.get("weight"),
                    reason=record.get("reason") or (
                        "" if state is MF.ModelState.AVAILABLE
                        else "carried forward from the previous attempt"
                    ),
                ))
            except (KeyError, ValueError):
                continue

        completed = [
            name for name, task in manifest.tasks.items()
            if task.get("state") in ("complete", "degraded")
        ]
        if completed:
            log.info(
                "resuming %s: %d task(s) already complete (%s)",
                manifest.forecast_id, len(completed), ", ".join(completed),
            )
            manifest.notes.append(
                f"resumed from a previous attempt; reused {len(completed)} "
                f"completed task(s) rather than recomputing them"
            )
        started = previous.get("timing", {}).get("started_at")
        if started:
            try:
                manifest.started_at = datetime.fromisoformat(started)
            except ValueError:
                pass
        return manifest

    def _already_done(self, name: str, manifest: MF.CycleManifest) -> bool:
        """Section 13. Has this task already succeeded in this cycle?"""
        if not self.resume:
            return False
        record = manifest.tasks.get(name)
        return bool(record) and record.get("state") in (
            "complete", "degraded"
        )

    def _run_task(self, name: str, result: RunResult) -> None:
        manifest = result.manifest
        task = TK.TASKS_BY_NAME[name]

        if self._already_done(name, manifest):
            record = TK.TaskRecord(
                name=name, state=TK.TaskState.COMPLETE,
                depends_on=task.depends_on, reused=True,
                output=manifest.tasks[name].get("output", "") or "",
            )
            result.records[name] = record
            log.info("%s: reusing the completed result", name)
            return

        # A dependency that FAILED blocks this task. A dependency that was
        # SKIPPED does not, unless it was critical.
        #
        # The distinction matters on the very first forecast: the change
        # engine legitimately has nothing to compare against and skips, and
        # treating that as a failure blocked the gate, the archive and
        # publication -- so the first forecast could never be published.
        blocked = []
        for dependency in task.depends_on:
            record_of = result.records.get(dependency)
            if record_of is None:
                continue
            if record_of.state is TK.TaskState.FAILED:
                blocked.append(f"{dependency} failed")
            elif (
                record_of.state is TK.TaskState.SKIPPED
                and TK.TASKS_BY_NAME[dependency].critical
            ):
                blocked.append(f"{dependency} was skipped and is critical")
        if blocked:
            record = TK.TaskRecord(
                name=name, state=TK.TaskState.SKIPPED,
                depends_on=task.depends_on,
                error="dependency did not succeed: " + "; ".join(blocked),
            )
            result.records[name] = record
            manifest.tasks[name] = record.to_dict()
            return

        record = TK.TaskRecord(
            name=name, state=TK.TaskState.RUNNING,
            depends_on=task.depends_on,
            started_at=datetime.now(timezone.utc),
            version=manifest.versions.cache_key(),
        )
        result.records[name] = record
        manifest.tasks[name] = record.to_dict()

        handler = getattr(self, f"_task_{name}", None)
        if handler is None:
            record.state = TK.TaskState.SKIPPED
            record.error = f"no handler is implemented for {name}"
            record.ended_at = datetime.now(timezone.utc)
            manifest.tasks[name] = record.to_dict()
            return

        try:
            TK.with_retries(
                lambda: handler(result, record), policy=self.retry,
                record=record,
            )
            if record.state is TK.TaskState.RUNNING:
                record.state = TK.TaskState.COMPLETE
        except (TK.Transient, TK.Permanent) as exc:
            record.state = TK.TaskState.FAILED
            record.error = record.error or str(exc)
            log.error("task %s failed: %s", name, record.error)
            if task.critical:
                result.stopped_at = name
                result.stopped_because = record.error
                manifest.status = MF.CycleStatus.FAILED
            else:
                manifest.mark_degraded(
                    f"the {name} task failed but is not critical: "
                    f"{record.error}"
                )
        finally:
            record.ended_at = datetime.now(timezone.utc)
            manifest.tasks[name] = record.to_dict()

    def _finalise(self, result: RunResult) -> None:
        manifest = result.manifest
        manifest.completed_at = datetime.now(timezone.utc)
        if manifest.status is MF.CycleStatus.FAILED:
            return
        if result.stopped_at:
            manifest.status = MF.CycleStatus.FAILED
            return
        manifest.status = (
            MF.CycleStatus.DEGRADED if manifest.degraded
            else MF.CycleStatus.READY
        )

        # A resumed cycle whose publish task was reused never re-ran the
        # handler that sets PUBLISHED, so the status would silently fall
        # back to READY and the cycle would look unpublished. The task
        # record is the authority on what happened, not the handler.
        published = result.records.get("publish")
        if published is not None and published.state.succeeded:
            manifest.status = MF.CycleStatus.PUBLISHED

    # -- the adapters ------------------------------------------------------
    #
    # Each one calls an existing stage. None of them computes meteorology.

    def _task_detect(self, result: RunResult, record: TK.TaskRecord) -> None:
        RD.detect(result.manifest)
        decision = RD.evaluate(result.manifest, rules=self.rules)
        result.decision = decision
        record.output = "; ".join(decision.reasons[:2])

        if not decision.proceed:
            raise TK.Permanent(
                "the cycle is not ready: " + "; ".join(decision.reasons)
            )
        if decision.degraded:
            for reason in decision.reasons:
                result.manifest.mark_degraded(reason)
            for limitation in decision.limitations:
                result.manifest.notes.append(limitation)
            record.state = TK.TaskState.DEGRADED

    def _task_ingest(self, result: RunResult, record: TK.TaskRecord) -> None:
        if self.dry_run:
            record.output = "dry run: no data downloaded"
            return
        import asyncio

        from ..pipeline.ingest import ingest_run

        stored = failed = 0
        unreachable: list[str] = []
        for model_id in result.manifest.usable_models():
            try:
                report = asyncio.run(ingest_run(model_id, self.cycle))
            except Exception as exc:            # noqa: BLE001
                # Detection already confirmed this model is usable from what
                # is ON DISK. A failed re-download therefore does not mean
                # the cycle cannot run -- most often it means the cycle has
                # aged out of the provider catalogue, which is expected for
                # anything but the newest run and is not a reason to throw
                # away data already held.
                unreachable.append(f"{model_id}: {exc}")
                log.warning(
                    "could not re-fetch %s for %s (%s); continuing with "
                    "what is already stored", model_id, self.cycle, exc,
                )
                continue
            stored += getattr(report, "stored", 0)
            failed += len(getattr(report, "failed", []) or [])

        if unreachable:
            record.warnings.append(
                "could not reach the provider for "
                + "; ".join(unreachable)
                + ". The cycle continues on the data already stored, which "
                  "detection confirmed is present. Nothing is substituted"
            )
            record.state = TK.TaskState.DEGRADED
        record.output = f"{stored} field(s) stored, {failed} failed"
        if failed:
            record.warnings.append(
                f"{failed} field(s) failed to download and are recorded as "
                f"unavailable rather than substituted"
            )
            record.state = TK.TaskState.DEGRADED

    def _task_validate(self, result: RunResult, record: TK.TaskRecord) -> None:
        RD.detect(result.manifest)
        decision = RD.evaluate(result.manifest, rules=self.rules)
        result.decision = decision
        if not decision.proceed:
            raise TK.Permanent(
                "after ingestion the cycle is still not viable: "
                + "; ".join(decision.reasons)
            )
        record.output = f"{len(decision.usable)} usable model(s)"
        if decision.degraded:
            record.state = TK.TaskState.DEGRADED

    def _task_profiles(self, result: RunResult, record: TK.TaskRecord) -> None:
        """Stage 3. Deliberately does not build every column: the grid is
        290,745 cells and Stages 4-7 still run per point, so the production
        path evaluates the points a product needs."""
        record.output = (
            "profiles are reconstructed on demand by the point evaluator; "
            "Stages 4-7 remain point-based, which is recorded as a known "
            "limitation rather than worked around here"
        )
        record.warnings.append(
            "gridded evaluation is not wired: `parameters/gridded.py` "
            "vectorises the parcel ascent but Stage 4's compute and Stages "
            "5 and 7 still run per point"
        )
        record.state = TK.TaskState.DEGRADED

    def _task_derived(self, result: RunResult, record: TK.TaskRecord) -> None:
        record.output = "Stage 4 runs inside the point evaluator"

    def _task_spatial(self, result: RunResult, record: TK.TaskRecord) -> None:
        if self.dry_run:
            record.output = "dry run"
            return
        from ..grid import grid_lonlat, tcm_grid
        from ..pipeline.ingest import load_field
        from ..spatial import intelligence as SI
        from ..spatial import static as SS

        def field(name: str, hour: int = 12):
            stored = load_field("ukv", self.cycle, name, hour)
            return stored.values if stored is not None else None

        try:
            geo = SS.load("ukv")
        except LookupError as exc:
            raise TK.Permanent(str(exc)) from exc

        u, v = field("u_wind_10m"), field("v_wind_10m")
        if u is None or v is None:
            raise TK.Permanent(
                "no 10 m wind is stored for this cycle, so no terrain-flow "
                "or boundary diagnostic can be computed"
            )
        spatial = SI.build(
            geo,
            SI.AtmosphericInputs(
                u=u, v=v, temperature=field("temperature_2m"),
                theta_e=field("wet_bulb_potential_temperature_850"),
                boundary_layer_depth=field("boundary_layer_height"),
                cape=field("cape_surface"), cin=field("cin"),
                wind_level="10m",
            ),
            model="ukv", run=self.cycle,
            valid_time=self.cycle + timedelta(hours=12),
            lonlat=grid_lonlat(tcm_grid()),
        )
        result.context["spatial"] = spatial
        record.output = (
            f"{len(spatial.available())} spatial feature(s), "
            f"{len(spatial.spatial_objects)} object(s)"
        )
        for problem in spatial.integrity():
            record.warnings.append(problem)

    def _task_regime(self, result: RunResult, record: TK.TaskRecord) -> None:
        record.output = "regime classification runs inside Stage 5"

    def _task_specialists(
        self, result: RunResult, record: TK.TaskRecord
    ) -> None:
        record.output = (
            "specialist engines run inside the point evaluator, fed by the "
            "spatial forcing computed above"
        )

    def _task_weighting(
        self, result: RunResult, record: TK.TaskRecord
    ) -> None:
        record.output = (
            "Stage 6 weights are applied inside Stage 7 aggregation, from "
            "the skill store"
        )
        record.warnings.append(
            "the skill store holds no verified records, so weighting falls "
            "back to its cold-start behaviour"
        )
        record.state = TK.TaskState.DEGRADED

    def _task_aggregate(
        self, result: RunResult, record: TK.TaskRecord
    ) -> None:
        record.output = "aggregation runs inside the point evaluator"

    def _task_probability(
        self, result: RunResult, record: TK.TaskRecord
    ) -> None:
        """Stage 7, evaluated at the product points."""
        if self.dry_run:
            record.output = "dry run"
            return
        from .points import evaluate_points

        forecasts = evaluate_points(
            self.cycle, spatial=result.context.get("spatial"),
        )
        if not forecasts:
            raise TK.Permanent(
                "no point produced a forecast; there is nothing to publish"
            )
        result.context["forecasts"] = forecasts
        record.output = f"{len(forecasts)} point forecast(s)"

    def _task_calibrate(
        self, result: RunResult, record: TK.TaskRecord
    ) -> None:
        """Section 27. Record the raw value, never overwrite it."""
        from . import access as AX

        forecasts = result.context.get("forecasts") or []
        calibrated = sum(1 for f in forecasts if AX.publishable(f))
        record.output = (
            f"{calibrated} of {len(forecasts)} point(s) carry a calibrated "
            f"probability"
        )
        if calibrated == 0 and forecasts:
            record.warnings.append(
                "no calibration has been fitted against observations, so "
                "every probability is UNCALIBRATED and marked unpublishable. "
                "The raw value is preserved and nothing overwrites it"
            )
            record.state = TK.TaskState.DEGRADED

    def _task_confidence(
        self, result: RunResult, record: TK.TaskRecord
    ) -> None:
        forecasts = result.context.get("forecasts") or []
        record.output = f"confidence and uncertainty on {len(forecasts)} point(s)"
        if result.manifest.degraded:
            record.warnings.append(
                "the cycle is degraded, which lowers CONFIDENCE. It does "
                "not lower probability: missing models make the answer less "
                "certain, not the weather less likely"
            )

    def _task_change(self, result: RunResult, record: TK.TaskRecord) -> None:
        from . import change as CH

        comparison = CH.compare_to_previous(result.manifest, result.context)
        result.context["change"] = comparison
        result.manifest.compared_with = comparison.get("reference")
        record.output = comparison.get("summary", "")
        if not comparison.get("available"):
            record.state = TK.TaskState.SKIPPED
            record.error = comparison.get("reason", "")

    def _task_products(self, result: RunResult, record: TK.TaskRecord) -> None:
        from . import products as PR

        built = PR.generate(result.manifest, result.context,
                            dry_run=self.dry_run)
        result.manifest.products = built
        record.output = f"{len(built)} product(s)"

    def _task_gate(self, result: RunResult, record: TK.TaskRecord) -> None:
        from . import gate as GT

        verdict = GT.validate(result.manifest, result.context)
        result.context["gate"] = verdict
        record.output = verdict["verdict"]
        if not verdict["passed"]:
            raise TK.Permanent(
                "the publication gate refused this forecast: "
                + "; ".join(verdict["failures"])
            )
        for warning in verdict.get("warnings", []):
            record.warnings.append(warning)

    def _task_archive(self, result: RunResult, record: TK.TaskRecord) -> None:
        """Step 9. Write the immutable Stage 9 record."""
        from ..verify import archive as AR

        forecasts = result.context.get("forecasts") or []
        written = 0
        for forecast in forecasts:
            try:
                entry = AR.from_tcm_forecast(
                    forecast, created_at=result.manifest.started_at
                )
                AR.store(entry)
                written += 1
            except AR.ImmutableArchiveError:
                # Already archived: a rerun must not create a second copy.
                written += 1
            except Exception as exc:            # noqa: BLE001
                record.warnings.append(f"could not archive: {exc!r}")
        record.output = f"{written} forecast(s) archived"

    def _task_publish(self, result: RunResult, record: TK.TaskRecord) -> None:
        manifest = result.manifest
        gate = result.context.get("gate") or {}
        if not gate.get("passed"):
            record.state = TK.TaskState.SKIPPED
            record.error = "the gate did not pass, so nothing is published"
            return
        manifest.status = MF.CycleStatus.PUBLISHED
        record.output = f"cycle {manifest.cycle:%Y-%m-%d %HZ} published"

    def _task_handoff(self, result: RunResult, record: TK.TaskRecord) -> None:
        """Section 70. Register with Stage 9 automatically."""
        from . import feedback as FB

        registered = FB.register(result.manifest, result.context)
        record.output = registered["summary"]


def run_cycle(
    cycle: datetime | None = None, *, resume: bool = True,
    dry_run: bool = False, rules: RD.Rules | None = None,
) -> RunResult:
    """Run one cycle. The operational entry point."""
    if cycle is None:
        cycle = RD.next_cycles()[0]
    return Orchestrator(
        cycle, resume=resume, dry_run=dry_run, rules=rules
    ).run()
