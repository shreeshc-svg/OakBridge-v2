"""Amazon FBA read-only sync (amazon_spapi.py): the pure parts and the wiring.

Run: python backend/tests/test_amazon_spapi.py
amazon_spapi imports FastAPI + the DB, so the pure functions are lifted out
with ast and run on their own — the network is never touched here.
"""
import ast
import os
import re
import sys
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = open(os.path.join(ROOT, "amazon_spapi.py"), encoding="utf-8").read()
PURE = {"isbn_digits", "isbn13_to_10", "summary_row", "match_book"}
ns = {"re": re, "Optional": Optional}
tree = ast.parse(SRC)
exec(compile(ast.Module([n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in PURE], []),
             "amazon_spapi_pure", "exec"), ns)

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def code_only(path):
    """Source without comment lines/docstrings' noise, so a test never passes on a comment."""
    return "\n".join(l for l in open(path, encoding="utf-8").read().splitlines() if not l.strip().startswith(("#", "//")))


# --- ISBN-13 -> ISBN-10 (Amazon's ASIN for a book is its ISBN-10)
check(ns["isbn13_to_10"]("978-0-306-40615-7") == "0306406152", "isbn13_to_10 standard")
check(ns["isbn13_to_10"]("9780804429573") == "080442957X", "isbn13_to_10 X check digit")
check(ns["isbn13_to_10"]("9791234567896") is None, "979 prefix has no ISBN-10")
check(ns["isbn13_to_10"]("12345") is None, "short input -> None")

# --- summary_row: Amazon payload -> our numbers
s = {"sellerSku": "9780306406157", "asin": "0306406152", "fnSku": "X001", "productName": "A Book", "condition": "NewItem",
     "totalQuantity": 17, "lastUpdatedTime": "2026-10-28T10:00:00Z",
     "inventoryDetails": {"fulfillableQuantity": 9, "inboundWorkingQuantity": 2, "inboundShippedQuantity": 3,
                          "inboundReceivingQuantity": 1, "reservedQuantity": {"totalReservedQuantity": 1},
                          "unfulfillableQuantity": {"totalUnfulfillableQuantity": 1}}}
r = ns["summary_row"](s)
check(r["available"] == 9 and r["inbound"] == 6 and r["reserved"] == 1 and r["unfulfillable"] == 1 and r["total"] == 17,
      "summary_row numbers")
e = ns["summary_row"]({"sellerSku": "X"})
check(e["available"] == 0 and e["inbound"] == 0 and e["total"] == 0, "summary_row tolerates missing details")

# --- match_book: manual > SKU=ISBN-13 > SKU=ISBN-10 > ASIN=ISBN-10
by13, by10 = {"9780306406157": "b1"}, {"0306406152": "b1", "019852663X": "b2"}
mb = ns["match_book"]
check(mb({"sku": "9780306406157", "asin": ""}, by13, by10, {}) == ("b1", "sku_isbn13"), "SKU = ISBN-13")
check(mb({"sku": "978-0306406157", "asin": ""}, by13, by10, {}) == ("b1", "sku_isbn13"), "SKU with dashes")
check(mb({"sku": "0306406152", "asin": ""}, by13, by10, {}) == ("b1", "sku_isbn10"), "SKU = ISBN-10")
check(mb({"sku": "OAK-17", "asin": "019852663X"}, by13, by10, {})[0] == "b2", "ASIN = ISBN-10")
check(mb({"sku": "9780306406157", "asin": ""}, by13, by10, {"9780306406157": "b9"}) == ("b9", "manual"), "manual link wins")
check(mb({"sku": "OAK-99", "asin": "B0XXXX"}, by13, by10, {})[0] is None, "unknown -> unmatched")

# --- read-only guarantee: only GETs to Amazon, never a write call
check(not re.search(r"requests\.(post|put|patch|delete)\([^)]*sellingpartnerapi", SRC), "no write calls to SP-API")
check("/fba/inventory/v1/summaries" in SRC, "uses the FBA inventory summaries API")

# --- wiring
srv = code_only(os.path.join(ROOT, "server.py"))
wk = code_only(os.path.join(ROOT, "worker.py"))
mk = code_only(os.path.join(ROOT, "marketing.py"))
wh = code_only(os.path.join(ROOT, "warehouse.py"))
check("amazon_admin_router" in srv, "server includes the Amazon admin router")
check("amazon_spapi" in wk, "worker imports amazon_spapi (job handler registered)")
check("amazon_spapi.schedule_tick" in mk, "periodic tick schedules the 6-hourly sync")
check('"amazon_fba"' in wh and '"amazon_vendor_po"' in wh, "warehouse stock-out reasons for Amazon")
check("amz_available" in wh, "inventory rows carry Amazon stock")
fe = os.path.join(ROOT, "..", "frontend", "src")
inv = code_only(os.path.join(fe, "components", "admin", "WarehouseInventory.jsx"))
check("AmazonPanel" in inv and "amz_low" in inv, "admin inventory shows Amazon panel + low-at-Amazon filter")
api = code_only(os.path.join(fe, "lib", "api.js"))
check(all(f in api for f in ("amzStatus", "amzSync", "amzSkus", "amzLink", "amzSaveSettings")), "api.js Amazon calls")

amz = code_only(os.path.join(ROOT, "amazon_spapi.py"))
check('"ignored": {"$ne": True}' in amz and "n_ignored" in amz, "hidden SKUs are not counted as 'to link'")
check("Not on our site" in inv, "admin can hide an Amazon listing that is not on our site")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
