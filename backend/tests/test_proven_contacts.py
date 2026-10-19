"""A delivered / opened / clicked campaign email makes the contact VERIFIED.

Run: python backend/tests/test_proven_contacts.py

Live bug (Oct 2026): SES delivery, opens and clicks set only `proven`, leaving
email_status "risky", so 475 people — many of whom had already received our
newsletter — were skipped as "mailbox unconfirmed" in the next campaign.
Pulled out of marketing.py with ast (it needs the whole app to import).
"""
import ast
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from _fakedb import DB  # noqa: E402
import marketing_core as core  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
want = {"mark_contact_proven", "heal_proven", "handle_ses_event", "_ses_cached", "_recent_no_verdict"}
fns = [n for n in ast.parse(src).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want]
assert {f.name for f in fns} == want
db = DB()
suppressed = []


async def suppress(q, why):
    suppressed.append((q, why))

from datetime import datetime, timedelta, timezone  # noqa: E402
consts = {n.targets[0].id: ast.literal_eval(n.value) for n in ast.parse(src).body
          if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") in ("SES_CHECK_TTL_DAYS", "NO_VERDICT_RETRY_DAYS", "MAX_BOUNCE_CEILING")}
ns = {"db": db, "core": core, "_iso": lambda: "2026-10-19T10:00:00+00:00", "suppress": suppress,
      "_now": lambda: datetime(2026, 10, 19, 10, tzinfo=timezone.utc), "timedelta": timedelta, **consts}
exec(compile(ast.Module(body=fns, type_ignores=[]), "marketing.py", "exec"), ns)


async def main():
    for i, st in enumerate(["risky", "risky", "valid", "risky"]):
        await db.mk_contacts.insert_one({"id": f"c{i}", "email_norm": f"p{i}@gmail.com", "email_status": st, "suppressed": ""})
    await db.mk_contacts.insert_one({"id": "cx", "email_norm": "gone@gmail.com", "email_status": "risky", "suppressed": "unsubscribed"})
    await db.mk_sends.insert_one({"id": "s0", "message_id": "m0", "contact_id": "c0", "campaign_id": "k"})
    await ns["handle_ses_event"]({"eventType": "Delivery", "mail": {"messageId": "m0"}})
    c0 = await db.mk_contacts.find_one({"id": "c0"})
    check(c0["email_status"] == "verified" and c0["proven"] is True, "SES Delivery -> verified (not left 'risky')")
    await ns["mark_contact_proven"]("cx")
    cx = await db.mk_contacts.find_one({"id": "cx"})
    check(cx["email_status"] == "risky", "a suppressed contact is never revived")
    # Contacts the OLD code marked proven but left risky:
    await db.mk_contacts.update_one({"id": "c1"}, {"$set": {"proven": True}})
    await db.mk_contacts.update_one({"id": "c2"}, {"$set": {"proven": True}})
    n = await ns["heal_proven"]()
    c1, c2, c3 = [await db.mk_contacts.find_one({"id": k}) for k in ("c1", "c2", "c3")]
    check(n == 2 and c1["email_status"] == "verified" and c2["email_status"] == "verified", "heal: old proven-but-risky contacts become verified")
    check(c3["email_status"] == "risky", "heal leaves never-delivered contacts alone")
    check(await ns["heal_proven"]() == 0, "heal is idempotent")
    print("-- paid checks --")
    await db.mk_ses_checks.insert_one({"email_norm": "nv@gmail.com", "status": "unknown", "no_verdict": True, "at": "2026-10-15T00:00:00+00:00"})
    await db.mk_ses_checks.insert_one({"email_norm": "old@gmail.com", "status": "unknown", "no_verdict": True, "at": "2026-08-01T00:00:00+00:00"})
    await db.mk_ses_checks.insert_one({"email_norm": "ok@gmail.com", "overall": "MEDIUM", "mailbox": "MEDIUM", "at": "2026-10-10T00:00:00+00:00"})
    cached = await ns["_ses_cached"](["nv@gmail.com", "ok@gmail.com", "old@gmail.com"])
    recent = await ns["_recent_no_verdict"](["nv@gmail.com", "ok@gmail.com", "old@gmail.com"])
    check("ok@gmail.com" in cached and "nv@gmail.com" not in cached, "a no-verdict answer is not treated as a verdict")
    check(recent == {"nv@gmail.com"}, "…but is not paid for again for 30 days (an older one is retried)")
    check(consts["MAX_BOUNCE_CEILING"] <= 0.045, "our bounce stops trip before AWS's 5% review")
    a, b = core.send_decision("risky", "unconfirmed", None, needs_ses=False, has_ses=True), core.send_decision("verified", "", None, needs_ses=False, has_ses=True)
    check(a[0] == "skip" and b[0] == "send", "so: unconfirmed risky is skipped by the default rule, verified is sent")

asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
