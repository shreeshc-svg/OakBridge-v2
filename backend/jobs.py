"""
Background jobs in MongoDB — so slow work never runs inside a shopper's request.

WHY
Campaign sending, address checks, the learning pass and syncs used to run as
asyncio tasks inside the web process, sharing its 0.5 CPU / 512 MB with
checkout. This queue lets a separate worker process (worker.py) do them. The
web process only inserts a small document.

GUARANTEES
* A job is claimed by exactly one worker (atomic find_one_and_update) and holds
  a lease; a long job renews it. If a worker dies, the lease runs out and the
  job is picked up again — handlers are written to be safe to re-run.
* `dedupe`: while a job with the same key is queued or running, enqueueing it
  again does nothing (unique index on `active_key`, which is removed when the
  job finishes) — five "check addresses" kicks in a minute become one job.
* Failures retry with backoff (30 s, 2 min, 10 min), then the job is parked as
  "dead" and an alert is raised on the Marketing dashboard. Nothing loops.
* Finished jobs are deleted after 7 days (TTL index), so the collection stays small.
* A worker heartbeat lets the web process tell whether a worker is really
  running, and fall back to doing the work itself if it is not.

Kept free of marketing logic so it can be tested with a fake collection.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger("oakbridge.jobs")

BACKOFF = (30, 120, 600)          # seconds before retry 1, 2, 3
DEFAULT_LEASE = 120               # seconds a claim is valid without renewal
HEARTBEAT_STALE = 180             # a worker silent this long is considered gone
_HANDLERS: dict[str, Callable[[dict], Awaitable[Any]]] = {}


def now() -> datetime:
    return datetime.now(timezone.utc)


def handler(kind: str):
    """Register the coroutine that runs jobs of this kind: @handler("learn")."""
    def deco(fn):
        _HANDLERS[kind] = fn
        return fn
    return deco


def kinds() -> list:
    return sorted(_HANDLERS)


def worker_mode() -> str:
    """inline (default: work runs in the web process, as before) | external
    (a separate worker process runs it; the web process only enqueues)."""
    return (os.environ.get("WORKER_MODE") or "inline").strip().lower()


async def ensure_indexes(db) -> None:
    try:
        await db.jobs.create_index("id", unique=True)
        await db.jobs.create_index([("status", 1), ("run_at", 1)])
        await db.jobs.create_index("active_key", unique=True, sparse=True)
        await db.jobs.create_index("finished_at", expireAfterSeconds=7 * 86400)
    except Exception:  # noqa: BLE001
        log.warning("jobs: index creation failed", exc_info=True)


async def enqueue(db, kind: str, payload: Optional[dict] = None, *, dedupe: Optional[str] = None,
                  delay: float = 0, max_attempts: int = 3) -> Optional[str]:
    """Add a job. Returns its id, or None if an identical job is already
    queued/running (dedupe)."""
    doc = {"id": str(uuid.uuid4()), "kind": kind, "payload": payload or {}, "status": "queued",
           "run_at": now() + timedelta(seconds=delay), "attempts": 0, "max_attempts": max_attempts,
           "created_at": now()}
    if dedupe:
        doc["active_key"] = f"{kind}:{dedupe}"
    try:
        await db.jobs.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        if "duplicate key" in str(e).lower() or "E11000" in str(e):
            return None
        raise
    return doc["id"]


async def claim(db, worker_id: str, lease: int = DEFAULT_LEASE) -> Optional[dict]:
    """Take the oldest due job, or one whose previous worker's lease ran out."""
    t = now()
    return await db.jobs.find_one_and_update(
        {"$or": [{"status": "queued", "run_at": {"$lte": t}},
                 {"status": "running", "lease_until": {"$lt": t}}]},
        {"$set": {"status": "running", "worker": worker_id, "lease_until": t + timedelta(seconds=lease), "started_at": t},
         "$inc": {"attempts": 1}},
        sort=[("run_at", 1)], return_document=True, projection={"_id": 0})


async def renew(db, job_id: str, worker_id: str, lease: int = DEFAULT_LEASE) -> bool:
    r = await db.jobs.update_one({"id": job_id, "worker": worker_id, "status": "running"},
                                 {"$set": {"lease_until": now() + timedelta(seconds=lease)}})
    return r.modified_count == 1


async def complete(db, job_id: str, worker_id: str) -> None:
    await db.jobs.update_one({"id": job_id, "worker": worker_id},
                             {"$set": {"status": "done", "finished_at": now()}, "$unset": {"active_key": "", "lease_until": ""}})


async def fail(db, job: dict, worker_id: str, error: str, on_dead: Optional[Callable[[dict, str], Awaitable[None]]] = None) -> str:
    """Retry with backoff, or park as dead after max_attempts. Returns the new status."""
    attempts = int(job.get("attempts") or 1)
    if attempts >= int(job.get("max_attempts") or 3):
        await db.jobs.update_one({"id": job["id"], "worker": worker_id},
                                 {"$set": {"status": "dead", "finished_at": now(), "error": error[:2000]},
                                  "$unset": {"active_key": "", "lease_until": ""}})
        if on_dead:
            try:
                await on_dead(job, error)
            except Exception:  # noqa: BLE001
                log.warning("jobs: on_dead hook failed", exc_info=True)
        return "dead"
    wait = BACKOFF[min(attempts - 1, len(BACKOFF) - 1)]
    await db.jobs.update_one({"id": job["id"], "worker": worker_id},
                             {"$set": {"status": "queued", "run_at": now() + timedelta(seconds=wait), "error": error[:2000]},
                              "$unset": {"lease_until": ""}})
    return "queued"


async def run_job(db, job: dict, worker_id: str, *, lease: int = DEFAULT_LEASE,
                  on_dead: Optional[Callable[[dict, str], Awaitable[None]]] = None) -> str:
    """Run one claimed job with lease renewal. Returns done | queued | dead."""
    fn = _HANDLERS.get(job["kind"])
    if fn is None:
        return await fail(db, {**job, "attempts": job.get("max_attempts", 3)}, worker_id, f"no handler for {job['kind']}", on_dead)
    stop = asyncio.Event()

    async def keep_alive():
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=lease / 3)
            except asyncio.TimeoutError:
                await renew(db, job["id"], worker_id, lease)

    ka = asyncio.create_task(keep_alive())
    try:
        await fn(job.get("payload") or {})
        await complete(db, job["id"], worker_id)
        return "done"
    except Exception as e:  # noqa: BLE001
        log.exception("jobs: %s failed", job["kind"])
        return await fail(db, job, worker_id, f"{e}\n{traceback.format_exc()[-1500:]}", on_dead)
    finally:
        stop.set()
        await ka


async def heartbeat(db, worker_id: str, extra: Optional[dict] = None) -> None:
    await db.worker_state.update_one({"key": "worker"}, {"$set": {"key": "worker", "id": worker_id, "at": now(),
                                                                 "host": socket.gethostname(), **(extra or {})}}, upsert=True)


async def worker_alive(db) -> bool:
    d = await db.worker_state.find_one({"key": "worker"}, {"_id": 0, "at": 1})
    at = (d or {}).get("at")
    if not at:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return (now() - at).total_seconds() < HEARTBEAT_STALE


async def stats(db) -> dict:
    counts = {r["_id"]: r["n"] async for r in db.jobs.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}])}
    oldest = await db.jobs.find_one({"status": "queued", "run_at": {"$lte": now()}}, {"_id": 0, "run_at": 1, "kind": 1},
                                    sort=[("run_at", 1)])
    lag = None
    if oldest and oldest.get("run_at"):
        ra = oldest["run_at"] if oldest["run_at"].tzinfo else oldest["run_at"].replace(tzinfo=timezone.utc)
        lag = round((now() - ra).total_seconds())
    w = await db.worker_state.find_one({"key": "worker"}, {"_id": 0})
    dead = await db.jobs.find({"status": "dead"}, {"_id": 0, "kind": 1, "error": 1, "finished_at": 1}).sort("finished_at", -1).limit(5).to_list(5)
    return {"mode": worker_mode(), "counts": counts, "lag_seconds": lag, "oldest_kind": (oldest or {}).get("kind"),
            "worker": w, "worker_alive": await worker_alive(db), "recent_dead": dead, "kinds": kinds()}
