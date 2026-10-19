"""Ingest control endpoints."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from ...pipeline.ingest import IngestReport, ingest_run
from ...registry import get as get_model

log = logging.getLogger(__name__)
router = APIRouter(tags=["ingest"])

# In-process job table. Deliberately simple for Stage 1; the worker queue in
# `app/workers` takes this over once Redis is wired up.
_JOBS: dict[str, dict] = {}


class IngestRequest(BaseModel):
    run: str | None = Field(
        None, description="ISO-8601 cycle; omit for the latest published run"
    )
    parameters: list[str] | None = None
    hours: list[int] | None = Field(
        None, description="Lead times to fetch; omit for the model's full range"
    )
    members: list[int] | None = Field(
        None,
        description=(
            "Ensemble members; omit to read whichever members the cycle "
            "actually contains. Ignored for deterministic models."
        ),
    )
    concurrency: int = Field(4, ge=1, le=12)
    force: bool = False


def _job_id(model_id: str) -> str:
    return f"{model_id}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}"


async def _run_job(job_id: str, model_id: str, req: IngestRequest) -> None:
    _JOBS[job_id]["status"] = "running"
    try:
        run = (
            datetime.fromisoformat(req.run.replace("Z", "+00:00"))
            if req.run else None
        )
        report: IngestReport = await ingest_run(
            model_id, run,
            parameters=req.parameters, hours=req.hours, members=req.members,
            concurrency=req.concurrency, force=req.force,
        )
        _JOBS[job_id].update(
            status="complete" if report.ok else "partial",
            summary=report.summary(),
            stored=report.stored, cached=report.skipped_cached,
            unavailable=report.unavailable, failed=report.failed,
            members=report.members,
            run=report.run.isoformat(),
        )
    except Exception as exc:  # surfaced to the caller, not swallowed
        log.exception("ingest job %s failed", job_id)
        _JOBS[job_id].update(status="error", error=str(exc))


@router.post("/ingest/{model_id}")
async def start_ingest(
    model_id: str, req: IngestRequest, background: BackgroundTasks
) -> dict:
    try:
        get_model(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None

    job_id = _job_id(model_id)
    _JOBS[job_id] = {
        "job_id": job_id, "model": model_id, "status": "queued",
        "queued_at": datetime.now(timezone.utc).isoformat(),
    }
    background.add_task(_run_job, job_id, model_id, req)
    return {"job_id": job_id, "status": "queued"}


@router.get("/ingest/jobs")
def list_jobs() -> dict:
    return {"jobs": list(_JOBS.values())}


@router.get("/ingest/jobs/{job_id}")
def job(job_id: str) -> dict:
    if job_id not in _JOBS:
        raise HTTPException(404, f"no job {job_id}")
    return _JOBS[job_id]
