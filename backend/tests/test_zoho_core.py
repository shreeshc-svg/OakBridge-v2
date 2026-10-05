"""
Zoho Inventory link — the pure decisions (backend/zoho_core.py).

Runs without FastAPI, Motor or a Zoho account:  python backend/tests/test_zoho_core.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import zoho_core as c  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


books = [
    {"id": "a", "isbn": "978-93-95764-54-4", "stock": 169},
    {"id": "b", "isbn": "9788169999090", "stock": 500, "zoho_item_id": "Z2"},
    {"id": "c", "isbn": "9780000000002", "stock": 3},
    {"id": "d", "isbn": "9788199888166", "stock": 10},
]
items = [
    {"item_id": "Z1", "sku": "9789395764544", "actual_available_stock": 160, "stock_on_hand": 169},
    {"item_id": "Z2", "sku": "9788169999090", "available_stock": "500"},
    {"item_id": "Z4", "sku": "9788199888166", "actual_available_stock": 12},
    {"item_id": "Z9", "sku": "9781111111111", "stock_on_hand": 5},
    {"item_id": "Zd", "sku": "9781111111111"},
]
p = c.plan_stock_changes(books, items, ["d"])

print("-- pulling stock from Zoho --")
check(p["changes"] == [{"book_id": "a", "isbn": "9789395764544", "title": "", "from": 169, "to": 160}],
      "available-for-sale wins over stock on hand (169 on hand, 9 committed -> 160)")
check(p["skipped_pending"] == ["9788199888166"],
      "a book with a website order still queued for Zoho is NOT overwritten")
check(not any(ch["book_id"] == "b" for ch in p["changes"]), "an unchanged count is not a change")
check(p["unmapped_books"] == ["9780000000002"], "a website book Zoho does not have is reported, untouched")
check({m["book_id"] for m in p["mappings"]} == {"a", "d"}, "new Zoho item links are recorded; known ones are not rewritten")
check(p["duplicate_skus"] == ["9781111111111"], "two Zoho items with one SKU are flagged, first one wins")
check(p["fields_used"] == {"actual_available_stock": 2, "available_stock": 1}, "which Zoho field was used is reported")

print("-- sending an order --")
body, missing = c.build_salesorder(
    "OAK-1", "2026-10-05", "C1",
    [{"book_id": "a", "qty": 2, "rate": 716}, {"book_id": "a", "qty": 1, "rate": 0}, {"book_id": "h", "qty": 1}],
    {"a": "Z1"},
)
check(body["reference_number"] == "OAK-1", "the website order number is the Zoho reference (duplicate guard)")
check(body["line_items"] == [{"item_id": "Z1", "quantity": 3, "rate": 716.0}],
      "the same book bought alone and inside a hamper is one Zoho line")
check(missing == ["h"], "a line with no Zoho item is dropped and reported, not fatal")
check(c.build_salesorder("X", "d", "C", [{"book_id": "h", "qty": 1}], {})[0] is None,
      "an order with nothing Zoho knows creates no sales order")

print("-- checkout --")
check(c.shortages({"a": 3, "b": 1}, {"a": 5, "b": 1}, {"a": 2}, {"a": "A"}) ==
      [{"title": "A", "requested": 3, "available": 2}], "the lower of website and Zoho counts decides")
check(c.shortages({"a": 3}, {"a": 5}, {}, {}) == [], "no answer from Zoho never blocks a sale")

print("-- odds and ends --")
check([c.backoff_minutes(n) for n in (1, 2, 3, 7, 8)] == [1, 2, 4, 60, 60], "retry backoff 1,2,4… capped at 60 min")
check(c.zoho_available({"actual_available_stock": -3}) == (0, "actual_available_stock"), "negative Zoho stock reads as 0")
check(c.zoho_available({"stock_on_hand": ""}) == (None, None), "no usable stock field -> no change, not 0")
check(c.norm_isbn(9789395764544.0) == "9789395764544", "spreadsheet-style float ISBNs normalise")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
