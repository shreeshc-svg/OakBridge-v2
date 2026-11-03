"""Warehouse → Inventory: what each row IS, and whether it really disagrees
with the website (warehouse_core.inventory_kind / owed_diff).

The bug this guards (Nov 2026): two pre-orders sat in "Out / below 0" and
"≠ Website" — a paid pre-order is −2 on the warehouse count (2 copies owed)
and 0 on the site, which is exactly right, but the screen called it a fault.

Run: python backend/tests/test_inventory_kinds.py
"""
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import warehouse_core as core  # noqa: E402
import inventory_reports as rep  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


NOW = datetime(2026, 11, 3, 10, 0, tzinfo=timezone.utc)
k = lambda **b: core.inventory_kind(b, NOW)  # noqa: E731

check(k(stock=12) == "book", "ordinary book")
check(k(stock=0) == "book", "ordinary book at 0 is still a book (a real 'out')")
check(k(coming_soon=True, launch_at="2026-12-12T14:00", stock=0) == "preorder", "future launch (IST datetime) -> pre-order")
check(k(coming_soon=True, launch_at="2026-11-03T16:00", stock=0) == "preorder", "later today IST (10:30 UTC) is still future")
check(k(coming_soon=True, launch_at="2026-11-03T15:00", stock=0) == "launched_empty", "15:00 IST = 09:30 UTC: launched, no copies")
check(k(coming_soon=True, launch_at="2026-10-28T17:04", stock=0) == "launched_empty", "Constitutional Miscellany case")
check(k(coming_soon=True, launch_at="", stock=0) == "launched_empty", "ticked with no launch date: not buyable -> flagged")
check(k(coming_soon=True, launch_at="2026-10-28", stock=40) == "book", "launched and copies arrived -> ordinary book")
check(k(pod=True, stock=0) == "pod", "print on demand, no copies")
check(k(pod=True, stock=5) == "book", "POD title with copies sells them: ordinary book")
check(k(coming_soon=True, launch_at="2026-10-01", stock=0, pod=True) == "pod", "launched pre-order with POD ticked -> POD")

check(core.owed_diff(-2, 2, 0) == 0, "paid pre-order: −2 + 2 owed = 0 = website -> no difference")
check(core.owed_diff(37, 3, 40) == 0, "backorder explained by owed copies")
check(core.owed_diff(35, 3, 40) == -2, "a real difference stays")
check(core.owed_diff(None, 0, 5) is None, "never counted -> None")

th = 10
check(rep.status_of({"kind": "preorder", "wh_stock": -2}, th) == "Pre-order", "export: pre-order")
check(rep.status_of({"kind": "launched_empty", "wh_stock": 0}, th) == "Launched, no copies", "export: launched, no copies")
check(rep.status_of({"kind": "pod", "wh_stock": 0}, th) == "Print on demand", "export: POD")
check(rep.status_of({"kind": "book", "wh_stock": 0}, th) == "Out of stock", "export: real out of stock")
check(rep.status_of({"wh_stock": 4}, th) == "Low", "export: rows without kind still work")

wh = open(os.path.join(ROOT, "warehouse.py"), encoding="utf-8").read()
check('"kind": core.inventory_kind(b, now)' in wh and "core.owed_diff(wh, o," in wh, "inventory rows carry kind and the owed-aware difference")
ui = open(os.path.join(ROOT, "..", "frontend", "src", "components", "admin", "WarehouseInventory.jsx"), encoding="utf-8").read()
check('const isOut = (b) => kindOf(b) === "book"' in ui and 'const isLow = (b, t) => kindOf(b) === "book"' in ui,
      "Out / Low count ordinary books only")
check('data-testid="wh-inv-bydesign"' in ui and "Launched, no copies" in ui, "separate tiles: launched-no-copies, pre-orders, POD")

gl = wh.split("async def go_live_checks")[1].split("\n@")[0]
check('core.inventory_kind(b, now) not in ("preorder", "pod")' in gl, "go-live 'never counted' skips books empty by design")
check("never_books[:3]" in gl, "go-live check names the uncounted books")
check("const needsCount = (b) => b.wh_stock == null && !byDesign(b);" in ui, "Inventory 'never counted' uses the same rule")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
