"""newsletter.py end to end against the in-memory fake DB (tests/_fakedb.py),
with FastAPI / pydantic / marketing stubbed — so the real tick logic runs:
nothing before the lead time, a draft at the lead time, approval mode waits,
autopilot sends, a missed draft is never sent late, an empty issue is skipped,
two ticks never build two issues for one slot, and a featured new release is
not repeated in the next issue.

Run: python backend/tests/test_newsletter_flow.py
"""
import asyncio
import os
import sys
import types
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


# ---- stubs -------------------------------------------------------------
class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: (lambda fn: fn)


fastapi = types.ModuleType("fastapi")
fastapi.APIRouter, fastapi.HTTPException, fastapi.Depends = _Router, HTTPException, (lambda *a, **k: None)
pyd = types.ModuleType("pydantic")


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self):
        return dict(self.__dict__)


pyd.BaseModel = BaseModel
db = DB(newsletter_issues=("slot",))
ext = types.ModuleType("extensions")
ext.db, ext.require_admin, ext.require_superadmin = db, None, None
audit = types.ModuleType("audit")


async def _audit(*a, **k):
    return None


audit.audit_log = _audit
import marketing_core  # noqa: E402

mk = types.ModuleType("marketing")
mk.SITE, mk.PUBLIC_API, mk.core = "https://www.oakbridge.in", "https://api.oakbridge.in", marketing_core
mk._iso = lambda: datetime.now(timezone.utc).isoformat()
alerts, sends = [], []


async def raise_alert(kind, message, **k):
    alerts.append(message)


async def queue_send(c, schedule_at, *, by_email, by_role, confirm_count=None):
    if c.get("_empty_audience"):
        raise HTTPException(400, "Nobody in this audience can be sent to")
    sends.append((c["id"], schedule_at, by_email))
    await db.mk_campaigns.update_one({"id": c["id"]}, {"$set": {"status": "preparing"}})
    return {"ok": True, "recipients": 42}


mk.raise_alert, mk.queue_send = raise_alert, queue_send
sys.modules.update({"fastapi": fastapi, "pydantic": pyd, "extensions": ext, "audit": audit, "marketing": mk})
import newsletter as NL  # noqa: E402

CLOCK = {"now": datetime(2026, 10, 25, 6, 0, tzinfo=timezone.utc)}
NL._now = lambda: CLOCK["now"]
NL.core.IST  # noqa: B018


async def seed_books(n_new, start=0):
    for i in range(start, start + n_new):
        await db.books.insert_one({"id": f"nb{i}", "title": f"New {i}", "author": "A", "price": 399, "new_release": True,
                                   "created_at": f"2026-10-{10 + i % 9:02d}T00:00:00+00:00", "cover_image": "/api/files/x.jpg"})


async def main():
    await db.integrations.insert_one({"key": "newsletter", "enabled": True, "frequency": "monthly", "weekday": 1,
                                      "week_of_month": 1, "time": "10:30", "lead_days": 2, "mode": "approve"})
    await seed_books(5)
    for i in range(3):
        await db.books.insert_one({"id": f"best{i}", "title": f"Best {i}", "author": "B", "price": 599, "cover_image": ""})
    await db.settings.insert_one({"key": "home_bestsellers", "value": ["best0", "best1", "best2"]})
    slot = datetime(2026, 11, 3, 5, 0, tzinfo=timezone.utc)  # 1st Tue Nov, 10:30 IST

    print("-- lead time --")
    r = await NL.tick()
    check(r.get("next_slot") == slot.isoformat() and not db.newsletter_issues.docs, "8 days early: nothing built")
    CLOCK["now"] = slot - timedelta(days=2) + timedelta(minutes=5)
    r = await NL.tick()
    iss = db.newsletter_issues.docs
    check(len(iss) == 1 and iss[0]["status"] == "drafted", "at the lead time: one drafted issue")
    camp = await db.mk_campaigns.find_one({"id": iss[0]["campaign_id"]})
    check(camp and camp["status"] == "draft" and camp["kind"] == "newsletter", "issue is an ordinary draft campaign")
    check(iss[0]["counts"]["new_releases"] == 4 and any("ready" in a for a in alerts), "content built + admin told to review")
    await NL.tick()
    check(len(db.newsletter_issues.docs) == 1 and not sends, "approve mode: second tick neither duplicates nor sends")

    print("-- two ticks racing --")
    again = await NL.build_draft(slot, NL.core.validate({}))
    check(len(db.newsletter_issues.docs) == 1 and again["id"] == iss[0]["id"], "a second build for the same slot returns the first")
    check(len([c for c in db.mk_campaigns.docs if c.get("kind") == "newsletter"]) == 1, "and leaves no orphan draft campaign")

    print("-- approve --")
    r = await NL.approve(iss[0], by_email="rohan@x", by_role="admin")
    check(sends == [(camp["id"], slot.isoformat(), "rohan@x")], "approved -> queued through queue_send for the slot")
    check(db.newsletter_issues.docs[0]["status"] == "approved", "issue approved")
    await db.mk_campaigns.update_one({"id": camp["id"]}, {"$set": {"status": "sent"}})
    CLOCK["now"] = slot + timedelta(hours=1)
    await NL.tick()
    check(db.newsletter_issues.docs[0]["status"] == "sent", "marked sent when its campaign finished")

    print("-- next issue: no repeats, then skip --")
    dec = datetime(2026, 12, 1, 5, 0, tzinfo=timezone.utc)
    CLOCK["now"] = dec - timedelta(days=2) + timedelta(minutes=1)
    await NL.tick()
    nxt = await db.newsletter_issues.find_one({"slot": dec.isoformat()})
    check(nxt and nxt["status"] == "drafted" and nxt["counts"]["new_releases"] == 1,
          "December: the one release not featured in November + favourites")
    check(not set(nxt.get("new_ids") or []) & set(db.newsletter_issues.docs[0]["new_ids"]), "featured releases never repeated")
    await db.newsletter_issues.update_one({"id": nxt["id"]}, {"$set": {"status": "sent"}})

    print("-- missed --")
    jan = datetime(2027, 1, 5, 5, 0, tzinfo=timezone.utc)
    await seed_books(4, start=20)
    CLOCK["now"] = jan - timedelta(days=1)
    await NL.tick()
    ji = await db.newsletter_issues.find_one({"slot": jan.isoformat()})
    check(ji and ji["status"] == "drafted", "January drafted")
    CLOCK["now"] = jan + timedelta(minutes=1)
    n_sends = len(sends)
    await NL.tick()
    ji = await db.newsletter_issues.find_one({"slot": jan.isoformat()})
    check(ji["status"] == "missed" and len(sends) == n_sends, "unapproved past its slot -> missed, not sent late")
    try:
        await NL.approve(ji, by_email="x", by_role="admin")
        check(False, "approving a missed issue is refused")
    except HTTPException as e:
        check(e.status_code == 409, "approving after the slot is refused")

    print("-- autopilot --")
    await db.integrations.update_one({"key": "newsletter"}, {"$set": {"mode": "autopilot"}})
    feb = datetime(2027, 2, 2, 5, 0, tzinfo=timezone.utc)
    await seed_books(4, start=40)
    CLOCK["now"] = feb - timedelta(days=1)
    await NL.tick()
    fi = await db.newsletter_issues.find_one({"slot": feb.isoformat()})
    check(fi and fi["status"] == "approved" and sends[-1][1] == feb.isoformat() and sends[-1][2] == "autopilot",
          "autopilot approves and queues for the slot")

    print("-- nothing new -> skipped --")
    await db.books.update_many({"new_release": True}, {"$set": {"new_release": False}})
    mar = datetime(2027, 3, 2, 5, 0, tzinfo=timezone.utc)
    CLOCK["now"] = mar - timedelta(days=1)
    await NL.tick()
    mi = await db.newsletter_issues.find_one({"slot": mar.isoformat()})
    check(mi and mi["status"] == "skipped" and "nothing new" in mi.get("reason", "") and not mi.get("campaign_id"),
          "no new releases, no announcement -> skipped, no campaign created")
    check(any("skipped" in a for a in alerts), "admin told it was skipped")

    print("-- switched off --")
    await db.integrations.update_one({"key": "newsletter"}, {"$set": {"enabled": False}})
    before = len(db.newsletter_issues.docs)
    CLOCK["now"] = datetime(2027, 3, 1, 0, 0, tzinfo=timezone.utc)
    await NL.tick()
    check(len(db.newsletter_issues.docs) == before, "disabled: nothing new is built")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
