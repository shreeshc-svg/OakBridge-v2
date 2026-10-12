"""jobs.py + dbutil.py against an in-memory fake (tests/_fakedb.py).

The queue must: run each job once, refuse duplicates while one is pending,
retry with backoff then park as dead (with an alert), hand a job over when its
worker dies, and keep long jobs leased. Paging must cover every row exactly
once, even when rows change under it.

Run: python backend/tests/test_jobs.py
"""
import asyncio
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dbutil  # noqa: E402
import jobs  # noqa: E402
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


async def main():
    db = DB(jobs=("id", "active_key"))
    ran = []

    @jobs.handler("t_ok")
    async def ok(p):
        ran.append(p.get("n"))

    @jobs.handler("t_boom")
    async def boom(p):
        raise RuntimeError("boom")

    print("-- enqueue / claim / run --")
    a = await jobs.enqueue(db, "t_ok", {"n": 1}, dedupe="x")
    b = await jobs.enqueue(db, "t_ok", {"n": 2}, dedupe="x")
    check(a and b is None, "same dedupe key while pending -> second enqueue ignored")
    j = await jobs.claim(db, "w1")
    j2 = await jobs.claim(db, "w2")
    check(j and j["id"] == a and j2 is None, "a job is claimed by exactly one worker")
    st = await jobs.run_job(db, j, "w1")
    check(st == "done" and ran == [1], "handler ran once, job done")
    c = await jobs.enqueue(db, "t_ok", {"n": 3}, dedupe="x")
    check(c is not None, "dedupe key is released when the job finishes")
    await jobs.run_job(db, await jobs.claim(db, "w1"), "w1")
    check(ran == [1, 3], "next job runs")

    print("-- delay --")
    await jobs.enqueue(db, "t_ok", {"n": 9}, delay=60)
    check(await jobs.claim(db, "w1") is None, "delayed job not claimable early")
    db.jobs.docs[-1]["run_at"] -= timedelta(seconds=61)
    j = await jobs.claim(db, "w1")
    check(j is not None, "claimable once due")
    await jobs.run_job(db, j, "w1")

    print("-- retry, backoff, dead + alert --")
    dead_alerts = []

    async def on_dead(job, err):
        dead_alerts.append(job["kind"])

    jid = await jobs.enqueue(db, "t_boom", max_attempts=3)
    statuses = []
    for _ in range(3):
        doc = next(d for d in db.jobs.docs if d["id"] == jid)
        doc["run_at"] = jobs.now() - timedelta(seconds=1)   # skip the wait
        j = await jobs.claim(db, "w1")
        statuses.append(await jobs.run_job(db, j, "w1", on_dead=on_dead))
    doc = next(d for d in db.jobs.docs if d["id"] == jid)
    check(statuses == ["queued", "queued", "dead"] and doc["status"] == "dead", f"retries twice then parks as dead {statuses}")
    check(dead_alerts == ["t_boom"] and "boom" in doc.get("error", ""), "dead job raises an alert and keeps the error")
    check(await jobs.claim(db, "w1") is None, "dead jobs are never picked up again")

    print("-- worker dies mid-job --")
    jid = await jobs.enqueue(db, "t_ok", {"n": 7})
    j = await jobs.claim(db, "w1", lease=60)
    check(await jobs.claim(db, "w2") is None, "leased job is not stolen")
    next(d for d in db.jobs.docs if d["id"] == jid)["lease_until"] = jobs.now() - timedelta(seconds=1)
    j2 = await jobs.claim(db, "w2")
    check(j2 and j2["id"] == jid and j2["attempts"] == 2, "expired lease -> another worker takes it")
    await jobs.complete(db, jid, "w1")
    check(next(d for d in db.jobs.docs if d["id"] == jid)["status"] == "running", "the old worker can't complete a job it lost")
    await jobs.run_job(db, j2, "w2")

    print("-- long job keeps its lease --")
    @jobs.handler("t_slow")
    async def slow(p):
        await asyncio.sleep(0.35)

    jid = await jobs.enqueue(db, "t_slow")
    j = await jobs.claim(db, "w1", lease=0.3)
    first = next(d for d in db.jobs.docs if d["id"] == jid)["lease_until"]
    renewed = []
    orig = jobs.renew

    async def spy(db_, i, w, lease=0):
        renewed.append(1)
        return await orig(db_, i, w, lease)

    jobs.renew = spy
    st = await jobs.run_job(db, j, "w1", lease=0.3)
    jobs.renew = orig
    check(st == "done" and renewed, "lease renewed while a slow job runs")

    print("-- unknown kind --")
    jid = await jobs.enqueue(db, "t_nobody")
    st = await jobs.run_job(db, await jobs.claim(db, "w1"), "w1")
    check(st == "dead", "job with no handler parks immediately (no retry loop)")

    print("-- heartbeat --")
    check(not await jobs.worker_alive(db), "no heartbeat -> not alive")
    await jobs.heartbeat(db, "w1")
    check(await jobs.worker_alive(db), "fresh heartbeat -> alive")
    db.worker_state.docs[0]["at"] -= timedelta(seconds=jobs.HEARTBEAT_STALE + 1)
    check(not await jobs.worker_alive(db), "stale heartbeat -> not alive (web falls back to inline)")
    s = await jobs.stats(db)
    check("counts" in s and s["counts"].get("dead", 0) >= 2, f"stats report counts {s['counts']}")

    print("-- paging (dbutil.batches) --")
    pdb = DB()
    for i in range(1234):
        await pdb.c.insert_one({"id": f"{i:05d}", "status": "valid" if i % 3 else "risky"})
    seen = []
    async for page in dbutil.batches(pdb.c, {"status": {"$in": ["valid", "risky"]}}, {"_id": 0, "status": 1}, size=500):
        check(len(page) <= 500, f"page of {len(page)} <= 500") if len(seen) == 0 else None
        for r in page:
            seen.append(r["id"])
            # change rows while walking: must not skip or repeat any
            await pdb.c.update_one({"id": r["id"]}, {"$set": {"status": "risky"}})
    check(len(seen) == 1234 and len(set(seen)) == 1234, "every row exactly once, even when rows change mid-walk")
    empty = [p async for p in dbutil.batches(pdb.c, {"status": "nope"})]
    check(empty == [], "empty result -> no pages")

    print("-- bulk_set --")
    n = await dbutil.bulk_set(pdb.c, [("00001", {"x": 1}), ("00002", {"x": 2}), ("00003", {})],
                              make_op=lambda q, u: {"q": q, "u": u})
    check(n == 2 and (await pdb.c.find_one({"id": "00002"}))["x"] == 2, "bulk_set applies all, skips empty updates")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
