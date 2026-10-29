"""Amazon Easy Ship: the rules (amazon_core.py) and the wiring.

Run: python backend/tests/test_amazon_easyship.py
No network: amazon_core is pure; amazon_easyship (FastAPI + DB) is checked
by reading its code for the guarantees that matter.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import amazon_core as c  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def code_only(path):
    return "\n".join(l for l in open(path, encoding="utf-8").read().splitlines() if not l.strip().startswith(("#", "//")))


# --- listings report
REPORT = ("﻿item-name\tlisting-id\tseller-sku\tprice\tquantity\topen-date\tasin1\tproduct-id\tfulfillment-channel\tstatus\n"
          "Software Protection | Asheeta Regidi\tL1\t9788193746875\t485.00\t\t2025-04-28\t8193746872\t9788193746875\tDEFAULT\tActive\n"
          "Applied Psychology\tL2\t8D-YQZU-GWOD\t399\t0\t2024-01-01\t8194031230\t\tAMAZON_IN\tInactive\n"
          "Sacred Tiger Tales\tL3\tLN-DZGM-YR8J\t650\t7\t2026-09-01\tB0HFS19QM3\t\tDEFAULT\tActive\n"
          "\tL4\t\t1\t1\t\t\t\tDEFAULT\tActive\n")
rows = c.parse_listings_report(REPORT)
check(len(rows) == 3, "report: rows without a SKU are dropped")
check(rows[0]["sku"] == "9788193746875" and rows[0]["qty"] is None and rows[0]["channel"] == "mfn", "report: blank quantity -> None, DEFAULT -> Easy Ship")
check(rows[1]["channel"] == "afn" and rows[1]["qty"] == 0, "report: AMAZON_IN -> FBA")
check(rows[2]["qty"] == 7 and rows[2]["asin"] == "B0HFS19QM3", "report: quantity and ASIN")

# --- buffer
check(c.clean_buffer(None) == c.DEFAULT_BUFFER and c.clean_buffer("x") == c.DEFAULT_BUFFER, "buffer default")
check(c.clean_buffer(-3) == 0 and c.clean_buffer(999) == c.MAX_BUFFER, "buffer clamped")

# --- target quantity
B = lambda **k: {"id": "b", "stock": 10, **k}  # noqa: E731
check(c.target_qty(B(), 2)[0] == 8, "stock 10, buffer 2 -> 8")
check(c.target_qty(B(stock=2), 2)[0] == 0, "stock at the buffer -> 0 (held for the website)")
check(c.target_qty(B(stock=-3), 0)[0] == 0, "below zero -> 0")
check(c.target_qty(B(coming_soon=True), 0)[0] == 0, "pre-order -> 0")
check(c.target_qty(B(stock=0, pod=True), 0)[1].startswith("print on demand"), "POD with no copies -> 0, explained")
check(c.target_qty(B(pod=True), 2)[0] == 8, "POD title WITH copies on the shelf sells them")
check(c.target_qty(B(product_type="hamper"), 0)[0] == 0 and c.target_qty(B(product_type="pack"), 0)[0] == 0, "hampers / packs -> 0")
check(c.target_qty(B(enabled=False), 0)[0] == 0, "hidden on our site -> 0")
check(c.target_qty(None, 0)[0] == 0, "missing book -> 0")

# --- push plan
L = [{"sku": "A", "channel": "mfn", "book_id": "b1", "qty": 5},
     {"sku": "B", "channel": "mfn", "book_id": "b2", "qty": None},
     {"sku": "C", "channel": "afn", "book_id": "b1", "qty": 0},
     {"sku": "D", "channel": "mfn", "book_id": None, "qty": 3},
     {"sku": "E", "channel": "mfn", "book_id": "b1", "qty": 1},
     {"sku": "F", "channel": "mfn", "book_id": "b1", "qty": 1, "pushed_qty": 5},
     {"sku": "G", "channel": "mfn", "book_id": "b1", "qty": 9, "gone": True}]
BOOKS = {"b1": {"id": "b1", "stock": 7}, "b2": {"id": "b2", "stock": 0}}
plan = {p["sku"]: p for p in c.push_plan(L, BOOKS, 2, {"E"})}
check("C" not in plan and "G" not in plan, "FBA and delisted SKUs are never in the plan")
check(plan["A"]["target"] == 5 and plan["A"]["push"] is False, "already right -> no push")
check(plan["B"]["target"] == 0 and plan["B"]["push"] is True, "'--' on Amazon, no stock -> set 0")
check(plan["D"]["push"] is False and plan["D"]["target"] is None, "unlinked SKU -> skipped")
check(plan["E"]["push"] is False and "switched off" in plan["E"]["why"], "per-SKU sync off -> skipped")
check(plan["F"]["push"] is False, "last pushed value wins over a stale report quantity")

# --- order stages: never take twice, restore only what was taken
check(c.order_step("new", "Unshipped") == "take", "new order -> take")
check(c.order_step("new", "Pending") == "take", "pending order -> take (Amazon holds the copy)")
check(c.order_step("new", "Canceled") == "skip", "cancelled before we saw it -> skip")
check(c.order_step("taken", "Shipped") == "none", "taken + shipped -> nothing")
check(c.order_step("taken", "Unshipped") == "none", "taken twice -> nothing (re-run safe)")
check(c.order_step("taken", "Canceled") == "restore", "taken then cancelled -> restore")
check(c.order_step("restored", "Canceled") == "none", "restored -> never again")
check(c.order_step("before_start", "Unshipped") == "none" and c.order_step("before_start", "Canceled") == "none",
      "orders before the switch was turned on never touch stock")
check(c.order_step("skipped", "Canceled") == "none", "skipped stays skipped")

lines = c.order_lines([{"SellerSKU": "A", "QuantityOrdered": 2, "Title": "Book A"},
                       {"SellerSKU": "Z", "QuantityOrdered": 1},
                       {"SellerSKU": "", "QuantityOrdered": 1},
                       {"SellerSKU": "A", "QuantityOrdered": 0}], {"A": "b1"})
check(lines == [{"sku": "A", "book_id": "b1", "qty": 2, "title": "Book A"}, {"sku": "Z", "book_id": None, "qty": 1, "title": ""}],
      "order lines: linked / unlinked kept, empty and zero dropped")

# --- wiring and guarantees in amazon_easyship.py
es = code_only(os.path.join(ROOT, "amazon_easyship.py"))
check('{"amazon_order_id": oid, "stage": "new"}' in es and '{"amazon_order_id": oid, "stage": "taken"}' in es,
      "take / restore are claimed by compare-and-set on stage")
check('"stock": {"$gte": qty}' in es, "stock never goes below zero on an Amazon order")
check('"fulfillment_channel_code": "DEFAULT"' in es and 'l.get("channel") != "mfn"' in code_only(os.path.join(ROOT, "amazon_core.py")),
      "only Easy Ship (DEFAULT channel) quantities are ever set")
check('"FulfillmentChannels": "MFN"' in es, "orders: Easy Ship only")
check("require_superadmin" in es and "def es_settings(body: EsSettings, user: dict = Depends(require_superadmin))" in es,
      "switching on (writes to Amazon) is super admin only")
check('if step == "orders":\n                    break' in es, "no push when the order pull failed")
check("before_start" in es and "orders_from" in es, "orders before the switch change nothing")
check("BuyerInfo" not in es and "ShippingAddress" not in es, "no buyer data read")
wh = code_only(os.path.join(ROOT, "warehouse.py"))
check("async def record_amazon_order" in wh and '"amazon_order", "amazon_cancel")' in wh, "warehouse ledger: Amazon order movements, not undoable")
check("amazon_order" not in wh.split("OUT_REASONS = ")[1].split("\n")[0], "staff cannot type an Amazon order movement")
check("amazon_easyship_router" in code_only(os.path.join(ROOT, "server.py")), "server includes the Easy Ship router")
check("import amazon_easyship" in code_only(os.path.join(ROOT, "worker.py")), "worker registers the Easy Ship job")
check("amazon_easyship.schedule_tick" in code_only(os.path.join(ROOT, "marketing.py")), "15-minute tick")
fe = os.path.join(ROOT, "..", "frontend", "src")
ui = code_only(os.path.join(fe, "components", "admin", "AmazonEasyShip.jsx"))
check("window.confirm" in ui and "Preview quantities" in ui and "Refresh listings" in ui, "admin: read, preview, then confirm to switch on")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
