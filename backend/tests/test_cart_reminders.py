"""Cart reminders (cart_reminders.py): customers only, at most 3, 1–2 days
apart, daytime IST only, claimed atomically, failed sends not counted.

Run: python backend/tests/test_cart_reminders.py
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


sent = []
FAIL_FOR = set()


async def _send(to, name, items, stage):
    if to in FAIL_FOR:
        return False
    sent.append((to, stage))
    return True


async def _anoop(*a, **k):
    return None

sys.modules["emailer"] = types.SimpleNamespace(send_cart_reminder=_send)
sys.modules["interakt"] = types.SimpleNamespace(on_cart_reminder=_anoop)
sys.modules["rbac"] = types.SimpleNamespace(ADMIN_ROLES=frozenset({"superadmin", "admin", "manager", "editor", "fulfilment", "warehouse"}))
import cart_reminders as CR  # noqa: E402

UTC = timezone.utc
T0 = datetime(2026, 11, 10, 6, 0, tzinfo=UTC)          # 11:30 IST
H = lambda h: T0 + timedelta(hours=h)                   # noqa: E731

print("-- timing rules --")
cart = {"items": [{"book_id": "b1"}], "updated_at": T0.isoformat()}
check(CR.due(cart, H(12)) is None, "nothing at 12 h")
check(CR.due(cart, H(24)) == 0, "#1 at 24 h (11:30 IST)")
check(CR.due({**cart, "reminder_count": 1, "last_reminder_at": H(24).isoformat()}, H(40)) is None, "#2 not before 24 h after #1")
check(CR.due({**cart, "reminder_count": 1, "last_reminder_at": H(24).isoformat()}, H(48)) == 1, "#2 a day after #1")
night = datetime(2026, 11, 11, 18, 0, tzinfo=UTC)       # 23:30 IST
check(CR.due(cart, night) is None and CR.due(cart, night + timedelta(hours=11)) == 0, "due at night -> waits for 10:00 IST")
check(CR.due({**cart, "reminder_count": 3, "last_reminder_at": T0.isoformat()}, H(200)) is None, "never a 4th")
check(CR.due({**cart, "reminders_sent": ["12h", "1w", "eom"]}, H(200)) is None, "old carts already sent 3 under the old scheme: done")
check(CR.due({**cart, "items": []}, H(48)) is None, "empty cart: nothing")
check(CR.is_staff({"role": "warehouse"}, set(), set()) and CR.is_staff({"role": "customer", "id": "u9"}, {"u9"}, set())
      and CR.is_staff({"role": "customer", "email": "Ravi@Oakbridge.in"}, set(), {"ravi@oakbridge.in"})
      and not CR.is_staff({"role": "customer", "id": "c1", "email": "c@x.in"}, set(), set()),
      "staff = office role, or in the HRM by account / work email")


async def flow():
    db = DB()
    for u in ({"id": "c1", "email": "reader@x.in", "name": "Reader", "role": "customer"},
              {"id": "c2", "email": "other@x.in", "name": "Other", "role": "customer"},
              {"id": "s1", "email": "ops@oakbridge.in", "name": "Ops", "role": "fulfilment"},
              {"id": "e1", "email": "ravi@oakbridge.in", "name": "Ravi", "role": "customer"}):
        await db.users.insert_one(u)
    await db.hr_employees.insert_one({"id": "p1", "work_email": "ravi@oakbridge.in", "user_id": "e1"})
    for uid in ("c1", "c2", "s1", "e1"):
        await db.carts.insert_one({"user_id": uid, "items": [{"book_id": "b1"}], "updated_at": T0.isoformat(), "reminders_sent": []})
    FAIL_FOR.add("other@x.in")
    r = await CR.process(db, now=H(25))
    check([s[0] for s in sent] == ["reader@x.in"], "only the customer gets #1 (office role + HRM employee skipped)")
    check(r["skipped_staff"] == 2, "two staff skipped")
    c2 = await db.carts.find_one({"user_id": "c2"})
    check(not c2.get("reminder_count") and not c2.get("last_reminder_at"), "a failed send isn't counted as one of the three")
    FAIL_FOR.clear()
    await CR.process(db, now=H(26))
    check(sent.count(("reader@x.in", "12h")) == 1, "no repeat within the gap")
    await asyncio.gather(CR.process(db, now=H(49)), CR.process(db, now=H(49)))
    check(sent.count(("reader@x.in", "1w")) == 1, "two runners at once (worker + cron) -> still one #2")
    await CR.process(db, now=H(73))
    await CR.process(db, now=H(97))
    await CR.process(db, now=H(200))
    check([s[1] for s in sent if s[0] == "reader@x.in"] == ["12h", "1w", "eom"], "exactly 3: 24 h, +1 day, +1 day — the last says it's the last")

asyncio.run(flow())

src = open(os.path.join(os.path.dirname(HERE), "features.py"), encoding="utf-8").read()
check("{i[\"book_id\"] for i in items} - {i.get(\"book_id\") for i in old.get(\"items\") or []}" in src,
      "only a NEW book restarts the reminders (re-saving the same cart doesn't)")
check('dispatch("cart_reminders", dedupe=hour)' in open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
      and "import cart_reminders" in open(os.path.join(os.path.dirname(HERE), "worker.py"), encoding="utf-8").read(),
      "runs automatically every hour on the worker")
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
