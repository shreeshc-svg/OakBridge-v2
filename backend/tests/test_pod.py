"""Print on Demand: the rules (pod_core.py) and the wiring.

Run: python backend/tests/test_pod.py
Cases mirrored in frontend/scripts/test-pod.mjs, so page and invoice agree.
"""
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import pod_core as p  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


utc = lambda s: datetime.fromisoformat(s + "+00:00")  # noqa: E731
HOL = [{"date": "2026-11-03", "name": "Test holiday"}]
CASES = [  # paid at (UTC) -> dispatch window, with 3 Nov 2026 a holiday
    ("2026-10-26T04:00:00", "2026-11-02", "2026-11-05", "Mon 09:30 IST: starts Mon; holiday skipped"),
    ("2026-10-26T09:00:00", "2026-11-04", "2026-11-06", "Mon 14:30 IST: after 2 pm, starts Tue"),
    ("2026-10-30T08:29:00", "2026-11-09", "2026-11-11", "Fri 13:59 IST: starts Fri"),
    ("2026-10-30T08:31:00", "2026-11-10", "2026-11-12", "Fri 14:01 IST: starts Mon"),
    ("2026-10-31T04:00:00", "2026-11-10", "2026-11-12", "Saturday: starts Mon"),
]
print("-- working days, cut-off, holidays --")
for at, a, b, label in CASES:
    w = p.dispatch_window(utc(at), HOL)
    check((w[0].isoformat(), w[1].isoformat()) == (a, b), f"{label} -> {w[0]} … {w[1]}")
w = p.dispatch_window(utc("2026-10-26T04:00:00"), [])
check(all(d.weekday() < 5 for d in w), "never lands on a weekend")

print("-- which books --")
check(p.pod_active({"pod": True, "stock": 0}), "ticked + no stock -> POD")
check(not p.pod_active({"pod": True, "stock": 3}), "copies on the shelf -> sells normally")
check(not p.pod_active({"pod": True, "stock": 0}, preorder=True), "a live pre-order is never POD")
check(not p.pod_active({"pod": True, "stock": 0, "product_type": "hamper"}), "hampers excluded")
check(not p.pod_active({"stock": 0}), "not ticked -> out of stock as before")

print("-- admin holiday list --")
rows, errs = p.clean_holidays([{"date": "2026-11-08", "name": "Diwali"}, {"date": "2026-11-08", "name": "dup"},
                               {"date": "2026-01-26", "name": "Republic Day"}, {"date": "26/01", "name": "bad"}])
check([r["date"] for r in rows] == ["2026-01-26", "2026-11-08"] and len(errs) == 1, "sorted, de-duplicated, bad dates named")

print("-- wiring --")
ROOT = os.path.dirname(os.path.dirname(HERE))
srv = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
check("pod_core.pod_active(bdoc, preorder=is_pre)" in srv and "avail = pod_core.MAX_QTY" in srv, "checkout: POD sells at 0 stock, max 10 per order")
check("if not payload.pod_ack:" in srv and "pod=bool(pod_items)" in srv and "dispatch_to=dispatch_to" in srv,
      "order refuses without the customer's confirmation; records POD items + dates")
check("pod_items: List[str]" in srv and "dispatch_to: Optional[str]" in srv and "    pod: bool = False" in srv, "fields declared on Order and Book")
check("elif category == POD_CATEGORY:" in srv and '"virtual": True' in srv, "Bookstore tab via ?category=print-on-demand")
pay = open(os.path.join(ROOT, "backend", "payments.py"), encoding="utf-8").read()
check('if (book or {}).get("pod"):' in pay and '"pod_dates_fixed": True' in pay,
      "payment: no backorder alarm for POD; dates fixed at payment time")
em = open(os.path.join(ROOT, "backend", "emailer.py"), encoding="utf-8").read()
check('"[Print on Demand] " if order.get("pod")' in em and "_pod_admin_row(order)" in em and "_pod_receipt_note(order)" in em,
      "office email tagged + 'send to printing' row; customer receipt shows the dates")
ext = open(os.path.join(ROOT, "backend", "extensions.py"), encoding="utf-8").read()
check(ext.count("pre-order or print on demand, not both") == 2, "a book can't be both pre-order and POD (create + edit)")
gc = open(os.path.join(ROOT, "backend", "growth_core.py"), encoding="utf-8").read()
check('availability = "backorder"' in gc, "Google feed: POD listed as backorder with a date")
pod = open(os.path.join(ROOT, "backend", "pod.py"), encoding="utf-8").read()
check('show_new = bool(st["show_new"]) and (not st["new_until"] or today <= st["new_until"])' in pod
      and '"explore_strip": bool(st["explore_strip"])' in pod, "'NEW' labels: on/off + automatic end date; Explore strip on/off")
for f in ("components/BookCard.jsx", "pages/BookDetail.jsx", "pages/Catalog.jsx"):
    src = open(os.path.join(ROOT, "frontend", "src", f), encoding="utf-8").read()
    check("show_new === true" in src, f"{f}: 'NEW' only when switched on (and never in the prerender)")
check("async def list_categories(shelves: bool = False):" in srv and "if shelves else 0" in srv,
      "admin category pickers never offer 'Print on Demand' (only the Bookstore asks for shelves)")
print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
