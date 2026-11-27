"""One stock number (Nov 2026): with the warehouse live, a counted book's
stock is changed only in Warehouse → Inventory. extensions.py wiring checks +
the Books form / Inventory screens. Run: python backend/tests/test_stock_lock.py"""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
failed = 0


def check(c, label):
    global failed
    print(("ok   " if c else "FAIL ") + label)
    if not c:
        failed += 1


def code(p):
    s = open(os.path.join(ROOT, p), encoding="utf-8").read()
    s = re.sub(r'"""[\s\S]*?"""', "", s)
    return "\n".join(x for x in s.splitlines() if not x.strip().startswith(("#", "//", "*", "/*")))


ext = code("backend/extensions.py")
upd = ext[ext.index("async def admin_update_book"):ext.index("async def admin_delete_book")]
check('NOT_WAREHOUSE_COUNTED = ("hamper", "pack")' in ext and "return await warehouse_is_master()" in ext,
      "lock applies only in live mode, never to packs / hampers")
check('raise HTTPException(status_code=409, detail=STOCK_LOCKED_MSG)' in upd and 'updates.pop("stock")' in upd,
      "a real stock change on a counted book is refused; an unchanged value is just dropped")
check(upd.index("warehouse_owns_stock(prev.get(\"product_type\"))") < upd.index("is_preorder = "),
      "checked before anything is written")
cre = ext[ext.index("async def admin_create_book"):ext.index("async def _notify_back_in_stock")]
check('if await warehouse_owns_stock(doc.get("product_type")):' in cre and 'doc["stock"] = 0' in cre, "a new book starts at 0 in live mode")
feat = code("backend/features.py")
check('"warehouse_live": live' in feat and "zero_stock = await warehouse_owns_stock(\"book\")" in feat,
      "public settings tell the admin screens; bulk import also starts at 0")
books = code("frontend/src/pages/admin/AdminBooks.jsx")
check("Number(form.stock) === Number(initial?.stock) ? { stock: undefined }" in books,
      "Books form never re-sends stock it didn't change (the stale-stock bug)")
check("const warehouseStock = name === \"stock\" && whLive && !form.coming_soon;" in books and "book-form-stock-warehouse" in books,
      "Books form: stock field locked with a link to the warehouse")
inv = code("frontend/src/pages/admin/AdminInventory.jsx")
check('const fromWarehouse = whLive && !["pack", "hamper"].includes(book.product_type);' in inv and "stock-from-warehouse-" in inv,
      "Admin → Inventory: books read-only (Count in Warehouse), packs / hampers still editable")
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED")); sys.exit(1 if failed else 0)
