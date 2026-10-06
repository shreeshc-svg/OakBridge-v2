"""
Sheet sync releases a pre-order when its stock arrives (inventory_sync.py).

Runs the real sync_stock_from_sheet(), pulled out with ast and handed a stub
db, so it needs neither FastAPI nor Mongo:  python backend/tests/test_sheet_preorder_release.py
"""
import ast
import asyncio
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

failures = []


def check(cond, label):
    print(("ok   " if cond else "FAIL "), label)
    if not cond:
        failures.append(label)


class R:
    def __init__(self, n=1):
        self.modified_count = n


class Books:
    def __init__(self, docs):
        self.docs = {d["isbn"]: d for d in docs}

    def _by_id(self, i):
        return next((d for d in self.docs.values() if d["id"] == i), None)

    async def find_one(self, flt, proj=None):
        if "isbn" in flt:
            return self.docs.get(flt["isbn"])
        return self._by_id(flt.get("id"))

    async def update_one(self, flt, patch):
        self._by_id(flt["id"]).update(patch["$set"])
        return R()


class DB(dict):
    def __init__(self, books):
        super().__init__()
        self.books = Books(books)
        self.events = []
        self["audit_events"] = self

    async def insert_one(self, doc):  # audit_log writes here
        self.events.append(doc)


def load(db, notified):
    tree = ast.parse(open(os.path.join(BACKEND, "inventory_sync.py"), encoding="utf-8").read())
    keep = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name in ("_norm_isbn", "_pick_col", "sync_stock_from_sheet")]

    async def notify(book):
        notified.append(book["isbn"])

    import csv, io, logging  # noqa: E401
    from datetime import datetime, timezone
    from typing import Optional
    ns = {"db": db, "_notify_back_in_stock": notify, "csv": csv, "io": io, "re": re, "os": os,
          "datetime": datetime, "timezone": timezone, "log": logging.getLogger("t"),
          "Optional": Optional, "HTTPException": Exception,
          "_ISBN_HEADERS": ("isbn",), "_STOCK_HEADERS": ("stock",)}
    exec(compile(ast.Module(body=keep, type_ignores=[]), "<inventory_sync>", "exec"), ns)
    return ns["sync_stock_from_sheet"]


books = [
    {"id": "pre-new", "isbn": "9788169999120", "title": "A Reasonable Man", "stock": 0, "coming_soon": True},
    {"id": "pre-held", "isbn": "9780000000001", "title": "Held from an older sync", "stock": 40, "coming_soon": True},
    {"id": "pre-none", "isbn": "9780000000002", "title": "Still at the printer", "stock": 0, "coming_soon": True},
    {"id": "normal", "isbn": "9789395764544", "title": "Drafting", "stock": 169},
]
csv_text = "ISBN,Stock\n978-81-6999-912-0,250\n9780000000001,40\n9780000000002,0\n9789395764544,169\n"
db, notified = DB(books), []
res = asyncio.run(load(db, notified)(csv_text))
B = {b["id"]: b for b in db.books.docs.values()}

print("-- stock arrives for a pre-order --")
check(B["pre-new"]["coming_soon"] is False and B["pre-new"]["stock"] == 250,
      "pre-order with fresh sheet stock becomes an ordinary book with that stock")
check(B["pre-held"]["coming_soon"] is False and B["pre-held"]["stock"] == 40,
      "released even when the stored number already equals the sheet (not skipped as 'no change')")
check(B["pre-none"]["coming_soon"] is True and B["pre-none"]["stock"] == 0,
      "a pre-order the sheet still shows at 0 stays a pre-order")
check(B["normal"]["stock"] == 169 and "coming_soon" not in B["normal"], "ordinary books are untouched")
check(sorted(r["isbn"] for r in res["released_preorders"]) == ["9780000000001", "9788169999120"],
      "the sync result lists exactly the released pre-orders")
check(sorted(notified) == ["9780000000001", "9788169999120"], "waitlist emails go out for released books")
check(any(e["action"] == "PREORDER_RELEASED_BY_SHEET" for e in db.events), "the release is written to the audit log")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
