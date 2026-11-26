"""Admin → Books → Import CSV/xlsx: binding / size / edition, release rank,
and no second copy of an ISBN already in the catalogue (features.py).
The pure row parser is extracted by name; the endpoint is checked by wiring.
Run: python backend/tests/test_bulk_import_books.py"""
import ast, os, re, sys, types, uuid
from datetime import datetime
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(os.path.dirname(HERE), "features.py"), encoding="utf-8").read()
failed = 0


def check(c, label):
    global failed
    print(("ok   " if c else "FAIL ") + label)
    if not c:
        failed += 1


m = types.ModuleType("extensions"); m.rank_for_year = lambda y: 1000.5 + (2030 - int(y)); sys.modules["extensions"] = m
from typing import Optional
ns = {"datetime": datetime, "uuid": uuid, "re": re, "Optional": Optional}
for node in ast.parse(SRC).body:
    if (isinstance(node, ast.FunctionDef) and node.name in ("_csv_row_to_book_doc", "_csv_binding", "_csv_int", "_csv_float", "_csv_bool")) or \
       (isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "_BINDING_CODES" for t in node.targets)):
        exec(compile(ast.Module([node], []), "features.py", "exec"), ns)
row = {"title": "Bihar At a Glance", "author": "Surendra Raut", "isbn": "9788193917114", "category": "academic", "subject": "Academic",
       "description": "d", "price": "220", "original_price": "275", "cover_image": "/logo.jpg", "stock": "0",
       "binding": "HB (DJ)", "size": "24 x 18.5", "edition": "1", "publication_year": "2018"}
d = ns["_csv_row_to_book_doc"](row)
check(d["binding"] == "Hardback with Dust Jacket" and d["size"] == "24 x 18.5" and d["edition"] == "1", "binding code / size / edition imported")
check(d["price"] == 220 and d["original_price"] == 275 and d["stock"] == 0, "price, MRP and stock 0 kept")
check(d["release_rank"] == m.rank_for_year(2018), "release rank set from the year (sorts under Newest)")
check(ns["_csv_binding"]("pb") == "Paperback" and ns["_csv_binding"]("PB(GF)") == "Paperback" and ns["_csv_binding"]("") is None
      and ns["_csv_binding"]("Spiral") == "Spiral", "PB / HB codes mapped, anything else kept")
imp = SRC[SRC.index("async def admin_bulk_import"):SRC.index("# ====== eBook price list")]
check("is already in the catalogue — skipped" in imp and "have.add(key)" in imp, "an ISBN already on the site (or twice in the file) is skipped, not duplicated")
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED")); sys.exit(1 if failed else 0)
