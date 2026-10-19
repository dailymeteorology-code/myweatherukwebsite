"""Ingest: provider -> native field -> TCM grid -> disk, with lineage intact.

The pipeline owns regridding (adapters return native grids) so that every
field carries exactly one resampling step in its lineage, and UKV carries
none at all.

Storage layout, chosen so a run is reproducible from what is on disk:

    /data/fields/<model>/<run>/<parameter>/T+<hh>[.m<member>].npy
    /data/fields/<model>/<run>/<parameter>/T+<hh>[.m<member>].json

The `.json` sidecar is the serialised `FieldMeta`. Nothing reads a `.npy`
without its sidecar; a field without provenance is treated as corrupt and
re-fetched.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from pathlib import Path

import numpy as np

from ..config import get_settings
from ..grid import Field, regrid_to_tcm, tcm_grid
from ..providers import base as providers
from ..registry import ModelSpec, get as get_model

log = logging.getLogger(__name__)


@dataclass
class IngestReport:
    model_id: str
    run: datetime
    requested: int = 0
    stored: int = 0
    skipped_cached: int = 0
    unavailable: list[str] = dc_field(default_factory=list)
    failed: list[str] = dc_field(default_factory=list)
    members: list[int] = dc_field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.stored > 0 and not self.failed

    def summary(self) -> str:
        members = f", {len(self.members)} members" if self.members else ""
        return (
            f"{self.model_id} {self.run:%Y-%m-%d %HZ}{members}: "
            f"{self.stored} stored, {self.skipped_cached} cached, "
            f"{len(self.unavailable)} unavailable, {len(self.failed)} failed"
        )


def field_path(
    root: Path, model_id: str, run: datetime, parameter: str,
    forecast_hour: int, member: int | None,
) -> Path:
    """Base path for a field, WITHOUT an extension."""
    stem = f"T+{forecast_hour:02d}" + (f".m{member:02d}" if member is not None else "")
    return root / model_id / f"{run:%Y%m%dT%H}" / parameter / stem


def field_files(base: Path) -> tuple[Path, Path]:
    """The (.npy, .json) pair for a field base path.

    Deliberately NOT `Path.with_suffix`. A member file is named `T+12.m20`,
    whose "suffix" is `.m20`, so `with_suffix(".npy")` silently returns
    `T+12.npy` -- every ensemble member then writes to the same file and the
    last member overwrites the rest. Append, never replace.
    """
    return (
        base.parent / f"{base.name}.npy",
        base.parent / f"{base.name}.json",
    )


def store_field(f: Field, root: Path | None = None) -> Path:
    """Write values and provenance side by side, atomically."""
    settings = get_settings()
    root = root or settings.field_dir
    m = f.meta
    base = field_path(root, m.model, m.run, m.parameter, m.forecast_hour, m.member)
    base.parent.mkdir(parents=True, exist_ok=True)

    npy, js = field_files(base)
    # np.save appends .npy to a path that lacks it, so name the temp file
    # explicitly. Unique per process: the store may live inside OneDrive.
    tmp = base.with_name(f"{base.name}.{os.getpid()}.part.npy")
    with open(tmp, "wb") as fh:
        np.save(fh, f.values.astype("float32"))
    os.replace(tmp, npy)
    js.write_text(m.to_json(), encoding="utf-8")

    # A newly stored field can change which cycle counts as the latest one
    # servable, and that answer is memoised. Imported here rather than at
    # module scope: `forecast.service` imports THIS module, so a top-level
    # import would be circular.
    from ..forecast.service import clear_run_cache
    clear_run_cache()
    return npy


def load_field(
    model_id: str, run: datetime, parameter: str, forecast_hour: int,
    member: int | None = None, root: Path | None = None,
) -> Field | None:
    """Read a stored field back, or None if it is absent or unprovenanced."""
    from ..meta import FieldMeta, GridSpec, MemberKind, RegridStep

    settings = get_settings()
    root = root or settings.field_dir
    base = field_path(root, model_id, run, parameter, forecast_hour, member)
    npy, js = field_files(base)
    if not (npy.exists() and js.exists()):
        return None

    raw = json.loads(js.read_text(encoding="utf-8"))
    grid = GridSpec(**{k: raw["grid"][k] for k in (
        "name", "projection", "nx", "ny", "spacing_m", "x0", "y0", "crs_units"
    )}) if raw.get("grid") else None
    lineage = tuple(
        RegridStep(
            from_grid=s["from_grid"], to_grid=s["to_grid"], method=s["method"],
            from_spacing_m=s["from_spacing_m"], to_spacing_m=s["to_spacing_m"],
            at=datetime.fromisoformat(s["at"]),
        ) for s in raw.get("lineage", [])
    )
    meta = FieldMeta(
        provider=raw["provider"], model=raw["model"], parameter=raw["parameter"],
        units=raw["units"], level_type=raw["level_type"], level=raw["level"],
        run=datetime.fromisoformat(raw["run"]),
        forecast_hour=raw["forecast_hour"],
        valid_time=datetime.fromisoformat(raw["valid_time"]),
        member_kind=MemberKind(raw["member_kind"]), member=raw["member"],
        native_resolution_m=raw["native_resolution_m"],
        native_grid=raw["native_grid"], native_projection=raw["native_projection"],
        grid=grid, regridded=raw["regridded"], lineage=lineage,
        source_uri=raw.get("source_uri", ""),
        retrieved_at=(
            datetime.fromisoformat(raw["retrieved_at"])
            if raw.get("retrieved_at") else None
        ),
        extra=raw.get("extra", {}),
    )
    return Field(np.load(npy), meta)


async def ingest_parameter(
    model: ModelSpec, parameter: str, run: datetime, forecast_hour: int,
    *, member: int | None = None, force: bool = False,
    report: IngestReport | None = None,
) -> Field | None:
    """Fetch, regrid and store one field. Idempotent unless `force`."""
    label = f"{parameter}@T+{forecast_hour}" + (
        f".m{member}" if member is not None else ""
    )
    if report:
        report.requested += 1

    if not force:
        cached = load_field(model.id, run, parameter, forecast_hour, member)
        if cached is not None:
            if report:
                report.skipped_cached += 1
            return cached

    adapter = providers.get(model.provider)
    try:
        native = await adapter.fetch(
            model, parameter, run, forecast_hour, member=member
        )
    except providers.DataUnavailable as exc:
        log.info("unavailable %s/%s: %s", model.id, label, exc.detail)
        if report:
            report.unavailable.append(f"{label}: {exc.detail}")
        return None
    except providers.ProviderError as exc:
        log.warning("failed %s/%s: %s", model.id, label, exc.detail)
        if report:
            report.failed.append(f"{label}: {exc.detail}")
        return None
    except KeyError as exc:
        # The bundle exists but does not contain this parameter at this lead
        # time. T+0 is the common case: a 1-hour accumulation or maximum has
        # no preceding hour to accumulate over, so lightning, rainfall totals
        # and hourly maxima simply do not exist there. That is an absence,
        # not a fault.
        detail = str(exc).split(". File contains")[0].strip("\"' ")
        log.info("unavailable %s/%s: %s", model.id, label, detail)
        if report:
            report.unavailable.append(f"{label}: {detail}")
        return None

    on_tcm = regrid_to_tcm(native)
    store_field(on_tcm)
    if report:
        report.stored += 1
    log.info(
        "ingested %s/%s (%s)", model.id, label, on_tcm.meta.resolution_label
    )
    return on_tcm


async def ingest_run(
    model_id: str, run: datetime | None = None, *,
    parameters: list[str] | None = None,
    hours: list[int] | None = None,
    members: list[int] | None = None,
    concurrency: int = 4,
    force: bool = False,
) -> IngestReport:
    """Ingest a whole model cycle.

    For an ensemble model every member is ingested and stored separately, so
    percentiles can be computed later from the members themselves rather than
    from a pre-collapsed mean.

    Concurrency is deliberately modest: the DataHub tier is request-counted,
    and a bundle is several MB per lead time.
    """
    model = get_model(model_id)
    adapter = providers.get(model.provider)

    if run is None:
        run = await adapter.latest_run(model)

    avail = await adapter.availability(model)
    params = parameters or [
        p for p in model.parameters if p in avail.parameters
    ]
    if not params:
        raise RuntimeError(
            f"none of {model.id}'s parameters are in the provider catalogue. "
            f"{avail.detail}"
        )
    if hours is not None:
        lead_times = hours
    elif avail.forecast_hours:
        # Walk the order's OWN timesteps. A fixed step cannot describe an
        # order that is hourly to T+54 and 3-hourly beyond it: stepping by 1
        # asks for 60 lead times that do not exist, and stepping by 3 throws
        # away two thirds of the hourly data.
        lead_times = [
            h for h in avail.forecast_hours if h <= model.max_forecast_hour
        ]
    else:
        lead_times = list(
            range(0, min(model.max_forecast_hour, avail.max_forecast_hour) + 1,
                  model.forecast_step_hours)
        )

    # Members are inside the GRIB, not in the file listing, so they have to be
    # read from a real bundle. Ask once and reuse for the whole cycle.
    member_list: list[int | None]
    if not model.is_ensemble:
        member_list = [None]
    elif members is not None:
        member_list = list(members)
    else:
        discovered = await adapter.members_in(
            model, run, lead_times[0], params[0]
        )
        if not discovered:
            raise RuntimeError(
                f"{model.id} is registered as an ensemble but no members were "
                f"found in the {params[0]} bundle at T+{lead_times[0]}"
            )
        member_list = list(discovered)
        log.info("%s members in this cycle: %s", model.id, member_list)

    report = IngestReport(model_id=model.id, run=run)
    report.members = [m for m in member_list if m is not None]
    sem = asyncio.Semaphore(concurrency)

    async def one(parameter: str, fh: int, member: int | None) -> None:
        async with sem:
            await ingest_parameter(
                model, parameter, run, fh, member=member,
                force=force, report=report,
            )

    await asyncio.gather(*(
        one(p, fh, m)
        for fh in lead_times for p in params for m in member_list
    ))
    log.info(report.summary())
    return report


def stored_runs(model_id: str, root: Path | None = None) -> list[datetime]:
    settings = get_settings()
    root = (root or settings.field_dir) / model_id
    if not root.exists():
        return []
    out = []
    for d in root.iterdir():
        try:
            out.append(datetime.strptime(d.name, "%Y%m%dT%H").replace(
                tzinfo=__import__("datetime").timezone.utc))
        except ValueError:
            continue
    return sorted(out)


def stored_members(
    model_id: str, run: datetime, parameter: str, forecast_hour: int,
    root: Path | None = None,
) -> list[int]:
    """Member numbers stored for one parameter and lead time.

    Reads the directory rather than probing candidate member numbers. Probing
    is not merely inelegant: on a OneDrive-backed store each miss triggers a
    cloud placeholder lookup costing seconds, so scanning 0..64 to find three
    members took four minutes.
    """
    settings = get_settings()
    directory = (
        (root or settings.field_dir) / model_id / f"{run:%Y%m%dT%H}" / parameter
    )
    if not directory.exists():
        return []
    members: list[int] = []
    for path in directory.glob(f"T+{forecast_hour:02d}.m*.npy"):
        try:
            members.append(int(path.name.split(".m")[1].split(".")[0]))
        except (IndexError, ValueError):
            continue
    return sorted(members)


def stored_inventory(model_id: str, run: datetime, root: Path | None = None) -> dict:
    """What is actually on disk for a run -- the archive side of the contract."""
    settings = get_settings()
    base = (root or settings.field_dir) / model_id / f"{run:%Y%m%dT%H}"
    if not base.exists():
        return {}
    inv: dict[str, list[int]] = {}
    for pdir in sorted(base.iterdir()):
        if not pdir.is_dir():
            continue
        hours = sorted(
            int(f.stem.split("+")[1].split(".")[0])
            for f in pdir.glob("T+*.npy")
        )
        inv[pdir.name] = hours
    return inv
