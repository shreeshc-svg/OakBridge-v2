"""Per-book store links ("Also available on") — extensions.clean_store_links and
the bulk sheet import (features.admin_import_store_links), pulled out with ast
because both modules need the whole app to import.

* only https links survive (no javascript:, relative paths or spaces); keys are
  slugged; at most 12 per book;
* the import matches store columns by name OR id, merges into existing links,
  reports unknown ISBNs and rejected links, and writes nothing on a dry run;
* the create route is still decorated (a helper once slipped between the
  decorator and admin_create_book, which silently unrouted POST /admin/books).

Run: python backend/tests/test_store_links.py
"""
import ast
import asyncio
import csv
import io
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
BACK = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def pull(path, names):
    tree = ast.parse(open(os.path.join(BACK, path), encoding="utf-8").read())
    out = []
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names:
            n.decorator_list = []
            out.append(n)
    assert {f.name for f in out} == set(names), (path, names)
    return ast.Module(body=out, type_ignores=[]), tree


ext_mod, ext_tree = pull("extensions.py", ["clean_store_links"])
ns = {"re": re}
exec(compile(ext_mod, "extensions.py", "exec"), ns)
clean = ns["clean_store_links"]

print("-- route wiring --")
create = next(n for n in ext_tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "admin_create_book")
check(any(ast.unparse(d) == "admin_router.post('/books')" for d in create.decorator_list), "POST /admin/books still routes to admin_create_book")
helper = next(n for n in ext_tree.body if isinstance(n, ast.FunctionDef) and n.name == "clean_store_links")
check(not helper.decorator_list, "clean_store_links is a plain helper, not a route")

print("-- clean_store_links --")
got = clean({
    "Amazon": "https://amzn.in/d/abc",
    "flipkart": "http://flipkart.com/x",
    "kindle": "javascript:alert(1)",
    "x": "https://a.b",
    "evil": "https://a.b/ c",
    "relative": "/books/1",
    "empty": "",
})
check(got == {"amazon": "https://amzn.in/d/abc"}, f"https only, keys slugged, 1-char key / spaces / http / js dropped ({got})")
check(clean(None) == {} and clean("https://x") == {} and clean([1]) == {}, "non-dict input -> {}")
check(len(clean({f"s{i:02d}": "https://x.in" for i in range(20)})) == 12, "capped at 12 links")
check(clean({"a" * 50: "https://x.in"}) == {"a" * 30: "https://x.in"}, "key cut to 30 chars")
check(clean({"amazon": "https://x.in/" + "a" * 600}) == {}, "over-long URL dropped")

print("-- import --")
feat_mod, _ = pull("features.py", ["_store_link_rows", "admin_import_store_links"])


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


STORES = [{"id": "amazon", "name": "Amazon"}, {"id": "flipkart", "name": "Flipkart"}, {"id": "kindle", "name": "Kindle"}]


async def get_collection(key):
    assert key == "home_stores"
    return {"items": STORES}


async def read_limited(f, limit, label):
    return f.data


fake_ext = types.ModuleType("extensions")
fake_ext.clean_store_links = clean
sys.modules["extensions"] = fake_ext
db = DB()
fns = {"re": re, "io": io, "csv": csv, "HTTPException": HTTPException, "File": lambda *a, **k: None,
       "UploadFile": object, "get_collection": get_collection, "db": db, "load_workbook": None,
       "uploads_guard": types.SimpleNamespace(read_limited=read_limited, require_not_zip_bomb=lambda *a: None)}
exec(compile(feat_mod, "features.py", "exec"), fns)
imp = fns["admin_import_store_links"]


class F:
    def __init__(self, text, name="links.csv"):
        self.data, self.filename = text.encode("utf-8"), name


async def main():
    await db.books.insert_one({"id": "b1", "isbn": "9788199305229", "title": "A", "store_links": {"kindle": "https://k.in/1"}})
    await db.books.insert_one({"id": "b2", "isbn": "978-81-993052-1-2", "title": "B", "store_links": {}})
    sheet = ("ISBN,Amazon,flipkart,Notes\n"
             "9788199305229,https://amzn.in/a,,x\n"
             "9788199305212,https://amzn.in/b,javascript:1,\n"
             "9780000000000,https://amzn.in/c,,\n"
             ",https://amzn.in/d,,\n")
    r = await imp(F(sheet), dry_run=True)
    check(r["books_updated"] == 2 and r["links_set"] == 2 and r["rejected_links"] == 1, f"dry run counts ({r})")
    check(r["unknown_isbns"] == ["9780000000000"] and r["unknown_count"] == 1, "unknown ISBN reported; blank ISBN row skipped")
    check(r["store_columns"] == {"Amazon": "amazon", "flipkart": "flipkart"}, "columns matched by name or id; 'Notes' ignored")
    b1 = await db.books.find_one({"id": "b1"})
    check(b1["store_links"] == {"kindle": "https://k.in/1"}, "dry run wrote nothing")

    r = await imp(F(sheet), dry_run=False)
    b1, b2 = await db.books.find_one({"id": "b1"}), await db.books.find_one({"id": "b2"})
    check(b1["store_links"] == {"kindle": "https://k.in/1", "amazon": "https://amzn.in/a"}, "merged into existing links (kindle kept)")
    check(b2["store_links"] == {"amazon": "https://amzn.in/b"}, "hyphenated ISBN matched; javascript: link refused")
    r = await imp(F(sheet), dry_run=False)
    check(r["books_updated"] == 0, "re-running the same sheet changes nothing")

    for text, want in [("Title,Amazon\nx,https://a.in\n", "No ISBN column"), ("ISBN,Price\n1,2\n", "No store columns"), ("ISBN,Amazon\n", "no rows")]:
        try:
            await imp(F(text), dry_run=True)
            check(False, f"rejects: {want}")
        except HTTPException as e:
            check(e.status_code == 400 and want in e.detail, f"rejects: {want}")
    try:
        await imp(F("x", name="links.pdf"), dry_run=True)
        check(False, "rejects non-CSV/XLSX")
    except HTTPException as e:
        check(e.status_code == 400, "rejects non-CSV/XLSX")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
