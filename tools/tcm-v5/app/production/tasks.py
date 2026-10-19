"""The dependency graph, task state, and retry policy.

Steps 2 and 14 of the Stage 10 order, sections 10 to 16 and 19 to 21.

THE GRAPH FOLLOWS THE SCIENCE, NOT THE NUMBERED LIST
----------------------------------------------------
Section 25 lists twenty-two steps in order, and section 26 then says
explicitly not to copy that order blindly if the scientific dependencies
require a different one. They do, in one place that matters:

    section 25 puts model weighting (step 10) BEFORE the specialist
    engines (step 11)

but Stage 6 weights models by their demonstrated skill at the tasks Stage 5
produces, and Stage 7 applies those weights when aggregating Stage 5's
outputs across models. Weighting therefore needs the specialists to have
run. Section 81's own architecture diagram agrees -- specialists feed
weighting -- and the graph below follows that.

The other reordering is spatial intelligence. Section 25 puts it at step 7,
after derived parameters, and that is right: Stage 8 consumes Stage 4's
fields and feeds forcing into Stage 5. The graph makes that a hard edge,
because running the specialists first would silently cap the initiation
engine at its no-forcing ceiling.

RETRIES DISTINGUISH TRANSIENT FROM PERMANENT
--------------------------------------------
Section 12 lists both. The distinction is not a guess: a network timeout
gets retried with backoff, an authentication failure does not, and the
policy is attached to the exception type rather than decided at the call
site where it would drift.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum

log = logging.getLogger(__name__)

TASKS_VERSION = "stage10.1"


class TaskState(str, Enum):
    """Section 11."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    DEGRADED = "degraded"
    FAILED = "failed"
    SKIPPED = "skipped"

    @property
    def finished(self) -> bool:
        return self in (
            TaskState.COMPLETE, TaskState.DEGRADED,
            TaskState.FAILED, TaskState.SKIPPED,
        )

    @property
    def succeeded(self) -> bool:
        """Whether dependents may run. DEGRADED counts: a task that did its
        job with less than it wanted has still done its job."""
        return self in (TaskState.COMPLETE, TaskState.DEGRADED)


class Transient(RuntimeError):
    """A failure worth retrying: network, timeout, rate limit, 5xx."""


class Permanent(RuntimeError):
    """A failure that retrying cannot fix. Section 12.

    Bad credentials, a malformed request, an unsupported variable, a
    dataset that does not exist. Retrying these is how a client turns its
    own bug into a request storm.
    """


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Section 12. Bounded, with backoff, and never for a Permanent."""

    max_attempts: int = 3
    base_delay_seconds: float = 2.0
    max_delay_seconds: float = 60.0
    #: Multiplier per attempt. 2.0 is exponential backoff.
    factor: float = 2.0

    def delay_for(self, attempt: int) -> float:
        return min(
            self.base_delay_seconds * (self.factor ** max(0, attempt - 1)),
            self.max_delay_seconds,
        )

    def to_dict(self) -> dict:
        return {
            "max_attempts": self.max_attempts,
            "base_delay_seconds": self.base_delay_seconds,
            "max_delay_seconds": self.max_delay_seconds,
            "factor": self.factor,
        }


@dataclass(slots=True)
class TaskRecord:
    """Section 11's required fields for one job."""

    name: str
    state: TaskState = TaskState.PENDING
    started_at: datetime | None = None
    ended_at: datetime | None = None
    attempts: int = 0
    error: str = ""
    warnings: list[str] = dc_field(default_factory=list)
    #: What this task depended on, recorded so a failure can be traced
    #: back through the graph rather than guessed at.
    depends_on: tuple[str, ...] = ()
    version: str = ""
    #: Where the output went, when it went anywhere.
    output: str = ""
    #: Whether the result was reused rather than recomputed. Section 13.
    reused: bool = False

    @property
    def duration_seconds(self) -> float | None:
        if not (self.started_at and self.ended_at):
            return None
        return (self.ended_at - self.started_at).total_seconds()

    def to_dict(self) -> dict:
        return {
            "task": self.name,
            "state": self.state.value,
            "started_at": (
                self.started_at.isoformat() if self.started_at else None
            ),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "duration_seconds": (
                round(self.duration_seconds, 2)
                if self.duration_seconds is not None else None
            ),
            "attempts": self.attempts,
            "error": self.error or None,
            "warnings": self.warnings,
            "depends_on": list(self.depends_on),
            "version": self.version,
            "output": self.output or None,
            "reused": self.reused,
        }


@dataclass(frozen=True, slots=True)
class Task:
    """One node in the graph."""

    name: str
    depends_on: tuple[str, ...] = ()
    #: Whether the cycle must stop if this fails. A products failure is
    #: bad; a final-probability failure means there is no forecast.
    critical: bool = True
    #: Whether this task may run at the same time as its siblings.
    parallel_safe: bool = True
    description: str = ""


#: The production dependency graph. Section 10, ordered by the science
#: rather than by section 25's numbering -- see the module docstring.
GRAPH: tuple[Task, ...] = (
    Task("detect", (), True, True,
         "find which model runs have arrived and in what state"),
    Task("ingest", ("detect",), True, True,
         "download the fields this cycle needs"),
    Task("validate", ("ingest",), True, True,
         "Stage 2 quality control on what arrived"),
    Task("profiles", ("validate",), True, True,
         "Stage 3 atmospheric column reconstruction"),
    Task("derived", ("profiles",), True, True,
         "Stage 4 derived meteorological parameters"),
    # Spatial BEFORE specialists: Stage 8 supplies the forcing that lifts
    # Stage 5's no-forcing ceiling. Running them the other way round leaves
    # the initiation engine capped and nothing says so.
    Task("spatial", ("derived",), False, True,
         "Stage 8 UK spatial intelligence"),
    Task("regime", ("derived",), False, True,
         "Stage 5 convective regime classification"),
    Task("specialists", ("spatial", "regime"), True, True,
         "Stage 5 specialist convective engines"),
    # Weighting AFTER specialists: Stage 6 weights models by their skill at
    # the tasks Stage 5 produces. Section 26 permits exactly this
    # reordering against section 25's numbering.
    Task("weighting", ("specialists",), False, True,
         "Stage 6 adaptive model skill and weights"),
    Task("aggregate", ("weighting",), True, False,
         "Stage 7 ensemble and multi-model aggregation"),
    Task("probability", ("aggregate",), True, False,
         "Stage 7 final thunderstorm and hazard probabilities"),
    Task("calibrate", ("probability",), True, False,
         "apply the fitted calibration, or record that none exists"),
    Task("confidence", ("calibrate",), True, False,
         "confidence and uncertainty, separately"),
    Task("change", ("confidence",), False, True,
         "run-to-run comparison against the reference forecast"),
    Task("products", ("confidence",), False, True,
         "grids, maps, animation frames and summaries"),
    Task("gate", ("products", "change"), True, False,
         "final validation before anything is published"),
    Task("archive", ("gate",), True, False,
         "write the immutable forecast record"),
    Task("publish", ("archive",), False, False,
         "make the approved outputs live"),
    Task("handoff", ("archive",), False, True,
         "register the forecast with Stage 9 verification"),
)

TASKS_BY_NAME: dict[str, Task] = {t.name: t for t in GRAPH}


def validate_graph() -> list[str]:
    """Every way the graph could be malformed."""
    problems: list[str] = []
    for task in GRAPH:
        for dependency in task.depends_on:
            if dependency not in TASKS_BY_NAME:
                problems.append(
                    f"{task.name} depends on {dependency}, which is not a task"
                )

    # Cycles. A dependency graph with a loop never completes and the
    # failure looks like a hang rather than an error.
    visiting: set[str] = set()
    done: set[str] = set()

    def walk(name: str, trail: tuple[str, ...]) -> None:
        if name in done:
            return
        if name in visiting:
            problems.append(
                f"dependency cycle: {' -> '.join(trail + (name,))}"
            )
            return
        visiting.add(name)
        for dependency in TASKS_BY_NAME[name].depends_on:
            walk(dependency, trail + (name,))
        visiting.discard(name)
        done.add(name)

    for task in GRAPH:
        walk(task.name, ())
    return problems


def execution_order() -> list[list[str]]:
    """Tasks grouped into waves that may run in parallel. Section 19.

    Each wave contains only tasks whose dependencies are all satisfied by
    earlier waves, so everything in one wave is independent of everything
    else in it.
    """
    remaining = {t.name: set(t.depends_on) for t in GRAPH}
    waves: list[list[str]] = []
    done: set[str] = set()

    while remaining:
        wave = sorted(
            name for name, deps in remaining.items() if deps <= done
        )
        if not wave:
            raise ValueError(
                f"the graph cannot be ordered; unresolved: {sorted(remaining)}"
            )
        # A task marked not parallel-safe runs alone, so a stage that
        # cannot share memory or a database connection is not made to.
        serial = [n for n in wave if not TASKS_BY_NAME[n].parallel_safe]
        if serial and len(wave) > 1:
            wave = [serial[0]] if len(serial) == len(wave) else [
                n for n in wave if TASKS_BY_NAME[n].parallel_safe
            ]
        waves.append(wave)
        done |= set(wave)
        for name in wave:
            remaining.pop(name)
    return waves


def with_retries(
    fn, *, policy: RetryPolicy | None = None, record: TaskRecord,
    sleep=time.sleep,
) -> object:
    """Run `fn`, retrying transient failures only. Section 12.

    A `Permanent` is never retried: retrying bad credentials or a malformed
    request is how a client turns its own bug into a request storm against
    a provider that has already said no.
    """
    policy = policy or RetryPolicy()
    last: Exception | None = None

    for attempt in range(1, policy.max_attempts + 1):
        record.attempts = attempt
        try:
            return fn()
        except Permanent as exc:
            record.error = f"permanent: {exc}"
            log.error(
                "%s failed permanently on attempt %d, not retrying: %s",
                record.name, attempt, exc,
            )
            raise
        except Transient as exc:
            last = exc
            if attempt >= policy.max_attempts:
                break
            delay = policy.delay_for(attempt)
            record.warnings.append(
                f"attempt {attempt} failed ({exc}); retrying in {delay:.0f}s"
            )
            log.warning(
                "%s attempt %d/%d failed: %s; retrying in %.0fs",
                record.name, attempt, policy.max_attempts, exc, delay,
            )
            sleep(delay)
        except Exception as exc:            # noqa: BLE001
            # An unclassified exception is treated as permanent. Retrying
            # something we do not understand is how a bug becomes a storm.
            record.error = f"unclassified, treated as permanent: {exc!r}"
            log.exception("%s raised an unclassified error", record.name)
            raise Permanent(str(exc)) from exc

    record.error = (
        f"transient failure persisted through {policy.max_attempts} "
        f"attempts: {last}"
    )
    raise Transient(record.error)


def classify(exc: BaseException) -> type[Exception]:
    """Map a provider exception onto the retry policy. Section 12.

    Deliberately conservative: anything not recognised as transient is
    permanent, so an unknown failure is investigated rather than hammered.
    """
    name = type(exc).__name__.lower()
    text = str(exc).lower()

    transient_names = (
        "timeout", "connect", "readerror", "remotedisconnected",
        "temporary", "unavailable",
    )
    transient_text = (
        "timed out", "timeout", "connection reset", "temporarily",
        "rate limit", "too many requests", "502", "503", "504",
    )
    if any(n in name for n in transient_names):
        return Transient
    if any(t in text for t in transient_text):
        return Transient

    permanent_text = (
        "401", "403", "unauthorized", "forbidden", "invalid api key",
        "not found", "404", "malformed", "unsupported",
        # A cycle that has rolled out of the provider catalogue is gone for
        # good: the DataHub /latest listing holds only the current run, so
        # retrying an aged-out cycle is three guaranteed failures.
        "not available for run",
    )
    if any(p in text for p in permanent_text):
        return Permanent
    return Permanent
