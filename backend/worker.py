"""
Oakbridge background worker — runs marketing jobs away from the website.

    python worker.py            (Render: Background Worker, root dir `backend`)

The website process (WORKER_MODE=external) only writes small job documents;
this process claims and runs them (jobs.py): campaign preparation and sending,
address checks, the daily learning pass, suppression-list sync, throwaway-list
refresh, re-confirm lapses, newsletter sign-up checks. It also runs the routine
marketing tick every minute, so no cron is needed for marketing.

Safety:
* At most WORKER_CONCURRENCY jobs at once (default 3).
* A heartbeat every few seconds; if it stops, the website notices within 3
  minutes and does the work itself (with a dashboard alert).
* SIGTERM (Render redeploy): stop claiming, give running jobs up to 25 s.
  A job cut off mid-way keeps its lease until it expires, then is claimed
  again — every handler is safe to re-run.
* A job that fails 3 times is parked and raises a dashboard alert.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import time
import uuid
from pathlib import Path

try:  # local runs read backend/.env like server.py; Render sets real env vars
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:  # noqa: BLE001
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("oakbridge.worker")

import jobs  # noqa: E402
import marketing  # noqa: E402  (registers the marketing job handlers)
from extensions import db  # noqa: E402

CONCURRENCY = max(1, int(os.environ.get("WORKER_CONCURRENCY", "3")))
TICK_EVERY = 60          # seconds between marketing.periodic() runs
POLL_EVERY = 2           # seconds between queue polls when idle
SHUTDOWN_GRACE = 25      # seconds running jobs get after SIGTERM


async def main() -> None:
    wid = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
    await jobs.ensure_indexes(db)
    await marketing._ensure_indexes()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows dev box
            pass
    running: set = set()
    last_tick = 0.0
    log.info("worker %s started (concurrency %s, handlers: %s)", wid, CONCURRENCY, ", ".join(jobs.kinds()))
    while not stop.is_set():
        try:
            await jobs.heartbeat(db, wid, {"running": len(running), "concurrency": CONCURRENCY})
            if time.monotonic() - last_tick >= TICK_EVERY:
                last_tick = time.monotonic()
                await marketing.periodic()
            while len(running) < CONCURRENCY and not stop.is_set():
                job = await jobs.claim(db, wid)
                if not job:
                    break
                log.info("job %s %s (attempt %s)", job["kind"], job["id"], job.get("attempts"))
                t = asyncio.create_task(jobs.run_job(db, job, wid, on_dead=marketing.job_dead_alert))
                running.add(t)
                t.add_done_callback(running.discard)
        except Exception:  # noqa: BLE001 — a DB blip must not kill the worker
            log.exception("worker loop error")
        try:
            await asyncio.wait_for(stop.wait(), timeout=POLL_EVERY)
        except asyncio.TimeoutError:
            pass
    log.info("worker %s stopping: %s job(s) running", wid, len(running))
    if running:
        await asyncio.wait(running, timeout=SHUTDOWN_GRACE)


if __name__ == "__main__":
    asyncio.run(main())
