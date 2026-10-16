"""Campaign report adds up: delivered + hard bounced + soft bounced +
no-report = sent (marketing.refresh_campaign_stats, pulled out with ast).

Written after a live report showed 186 sent, 181 delivered and 0.00% bounced:
soft bounces keep status "sent" and never get delivered_at, so they fell out
of every card.

Run: python backend/tests/test_campaign_stats.py
"""
import ast
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
fn = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "refresh_campaign_stats")
db = DB()
ns = {"db": db, "core": types.SimpleNamespace(campaign_tag=lambda c: f"mk-{c}"), "_iso": lambda: "2026-10-15T10:00:00"}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "marketing.py", "exec"), ns)


async def main():
    await db.mk_campaigns.insert_one({"id": "c1", "channel": "email"})
    rows = (
        [{"status": "sent", "delivered_at": "t"}] * 170                       # delivered
        + [{"status": "sent", "delivered_at": "t", "opened_at": "t"}] * 9    # delivered + opened
        + [{"status": "sent", "opened_at": "t"}] * 2                         # opened, Delivery event lost
        + [{"status": "sent", "bounce_type": "Transient", "bounced_at": "t"}] * 3  # soft bounces
        + [{"status": "sent"}] * 1                                           # nothing reported
        + [{"status": "bounced", "bounce_type": "Permanent"}] * 1            # hard bounce
        + [{"status": "skipped"}] * 4 + [{"status": "blocked"}] * 2          # never sent
    )
    for i, r in enumerate(rows):
        await db.mk_sends.insert_one({"id": f"s{i}", "campaign_id": "c1", **r})
    st = await ns["refresh_campaign_stats"]("c1")
    check(st["sent"] == 186, f"sent excludes skipped/blocked ({st['sent']})")
    check(st["delivered"] == 181, f"an open proves delivery ({st['delivered']})")
    check(st["soft_bounced"] == 3 and st["no_report"] == 1 and st["bounced"] == 1, f"soft / no report / hard ({st})")
    check(st["delivered"] + st["bounced"] + st["soft_bounced"] + st["no_report"] == st["sent"], "the four add up to sent")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
