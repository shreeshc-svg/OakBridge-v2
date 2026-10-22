"""Pre-order launch time: server, feed and browser agree (launch_time.py).

Run: python backend/tests/test_launch_time.py

Mirrors the timezone block in frontend/scripts/test-preorder.mjs — same
inputs, same instants.
"""
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from launch_time import parse_launch_at  # noqa: E402
import growth_core as g  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


utc = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)  # noqa: E731
check(parse_launch_at("2026-10-28T17:04") == utc("2026-10-28T11:34"), "admin time with no zone = IST")
check(parse_launch_at("2026-10-28 17:04:30") == utc("2026-10-28T11:34:30"), "space instead of T, with seconds")
check(parse_launch_at("2026-10-28T17:04Z") == utc("2026-10-28T17:04"), "explicit offset honoured")
check(parse_launch_at("2026-09-14") == utc("2026-09-14T00:00"), "bare date unchanged: UTC midnight")
check(parse_launch_at("") is None and parse_launch_at(None) is None and parse_launch_at("next tuesday") is None, "empty / junk -> None")

feed = g.merchant_item({"id": "b", "title": "T", "price": 100, "stock": 0, "coming_soon": True,
                        "launch_at": "2026-11-01T10:00"}, site="s", image_url="i")
check(feed.get("availability_date") == "2026-11-01T10:00:00+05:30", f"Merchant feed date carries IST ({feed.get('availability_date')})")

# _preorder_active, without importing the whole server: its body only needs
# parse_launch_at and the clock, so it is checked through the same helper.
src = open(os.path.join(os.path.dirname(HERE), "server.py"), encoding="utf-8").read()
body = src[src.index("def _preorder_active"):src.index("def _checkout_consents")]
check("parse_launch_at(bdoc.get(\"launch_at\"))" in body and "fromisoformat" not in body.split('"""')[-1],
      "checkout's _preorder_active uses the shared parser")
ns = {"parse_launch_at": parse_launch_at, "timezone": timezone}


class _Clock:
    now_at = None

    @classmethod
    def now(cls, tz=None):
        return cls.now_at


ns["datetime"] = _Clock
exec(body.split("\n\n\n")[0], ns)
b = {"coming_soon": True, "launch_at": "2026-10-28T17:04"}
_Clock.now_at = utc("2026-10-28T11:33")
live_before = ns["_preorder_active"](b)
_Clock.now_at = utc("2026-10-28T11:35")
live_after = ns["_preorder_active"](b)
check(live_before and not live_after, "checkout: pre-order until 17:04 IST, ordinary book after (was 22:34)")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
