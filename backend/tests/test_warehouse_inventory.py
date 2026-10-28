"""Admin → Warehouse → Inventory (warehouse.py) — wiring checks.

Run: python backend/tests/test_warehouse_inventory.py
Every change is a ledger movement with who/why; nothing deletes.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(ROOT, "backend", "warehouse.py"), encoding="utf-8").read()
code = re.sub(r'"""[\s\S]*?"""', "", src)
inv = code[code.index("# ------------------------------------------------- warehouse inventory ---"):code.index('@wh_admin_router.get("/docs")')]
check('@wh_admin_router.get("/inventory")' in inv and '@wh_admin_router.get("/inventory/export.csv")' in inv,
      "search/read list + CSV export (under Admin → Warehouse permission)")
cnt = inv[inv.index("async def adm_set_count"):inv.index("async def adm_inventory_move")]
check('"correction_in" if diff > 0 else "correction_out"' in cnt and "actor=user" in cnt and "len(note) < 3" in cnt,
      "set count = a correction movement with the person and a required reason")
check('"product_type": {"$nin": list(NOT_COUNTED)}' in cnt, "packs/hampers can't be counted as one item")
mv = inv[inv.index("async def adm_inventory_move"):]
check('(IN_REASONS | OUT_REASONS) - {"opening"}' in mv and "0 < body.qty <= 100000" in mv, "in/out moves: known reasons, sane quantities")
inv_code = "\n".join(x for x in inv.splitlines() if not x.strip().startswith("#"))
check("delete" not in inv_code.lower() and "@wh_admin_router.delete" not in inv_code, "no delete — a wrong movement is undone in Movements")
check('"WAREHOUSE_INVENTORY_EXPORT"' in inv and '"WAREHOUSE_COUNT_SET"' in inv, "exports and counts are audited")
app = open(os.path.join(ROOT, "frontend", "src", "pages", "admin", "AdminWarehouse.jsx"), encoding="utf-8").read()
check('["inventory", "Inventory"]' in app and "<WarehouseInventory" in app, "Inventory tab in Admin → Warehouse")
print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
