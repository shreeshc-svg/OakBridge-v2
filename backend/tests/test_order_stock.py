"""Cancelled website orders put their stock back — once, and only what was taken.

order_stock.py is run for real against a small stub of motor (it takes db as
an argument and imports nothing heavy). The warehouse hand-off is stubbed so
this test stays about website stock; the ledger arithmetic is tested in
test_warehouse_core.py (order_ledger_diffs).

Run: python backend/tests/test_order_stock.py
"""
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

wh = types.ModuleType("warehouse")
wh.calls = []


async def sync_order_ledger(order, *, out, lines=None, by="", note=""):
    wh.calls.append((out, list(lines or [])))


wh.sync_order_ledger = sync_order_ledger
sys.modules["warehouse"] = wh

import order_stock as os_  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class R:
    def __init__(self, n):
        self.modified_count = n


def _match(doc, flt):
    for k, v in flt.items():
        have = doc.get(k)
        if isinstance(v, dict):
            if "$ne" in v and have == v["$ne"]:
                return False
            if "$gte" in v and (have or 0) < v["$gte"]:
                return False
        elif have != v:
            return False
    return True


class Coll:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, flt, proj=None):
        d = self.docs.get(flt.get("id"))
        return dict(d) if d is not None and _match(d, flt) else None

    async def update_one(self, flt, patch):
        d = self.docs.get(flt.get("id"))
        if d is None or not _match(d, flt):
            return R(0)
        for k, v in patch.get("$set", {}).items():
            d[k] = v
        for k, v in patch.get("$inc", {}).items():
            d[k] = d.get(k, 0) + v
        for k, v in patch.get("$addToSet", {}).items():
            d.setdefault(k, [])
            for x in v.get("$each", [v]):
                if x not in d[k]:
                    d[k].append(x)
        return R(1)


class DB:
    def __init__(self, books, orders):
        self.books = Coll(books)
        self.orders = Coll(orders)


def paid(**kw):
    o = {"id": "o1", "order_number": "OAK-1", "status": "cancelled", "payment_status": "paid",
         "stock_decremented": True, "items": [{"book_id": "a", "quantity": 2}, {"book_id": "p", "quantity": 1}]}
    o.update(kw)
    return {"o1": o}


def books():
    return {"a": {"id": "a", "stock": 5}, "p": {"id": "p", "stock": 0, "coming_soon": True}}


run = asyncio.run
D = os_.cancel_restock_decision

print("-- what cancelling should do --")
check(D("confirmed", paid()["o1"]) == "restore", "cancelled before shipping -> put back")
check(D("processing", paid()["o1"]) == "restore", "…also from processing")
check(D("shipped", paid()["o1"]) == "hold_shipped", "already shipped -> wait for the parcel")
check(D("delivered", paid()["o1"]) == "hold_shipped", "delivered -> wait for the parcel")
check(D("confirmed", paid(warehouse_doc_id="d1")["o1"]) == "hold_warehouse", "on a courier sheet -> ask the warehouse")
check(D("confirmed", paid(payment_status="pending", stock_decremented=False)["o1"]) == "none", "unpaid -> nothing was taken")
check(D("confirmed", paid(stock_restored=True)["o1"]) == "none", "already back -> nothing")

print("-- restore puts back exactly what was taken, once --")
db = DB(books(), paid(stock_taken=[{"book_id": "a", "qty": 2}]))
r = run(os_.restore_order_stock(db, "o1", by="x", why="t"))
check(r["copies"] == 2 and db.books.docs["a"]["stock"] == 7, "the 2 copies taken go back")
check(db.books.docs["p"]["stock"] == 0, "the pre-order line (never taken) is not added")
r2 = run(os_.restore_order_stock(db, "o1", by="x", why="t"))
check(r2["copies"] == 0 and db.books.docs["a"]["stock"] == 7, "a second cancel/click adds nothing")
check(db.orders.docs["o1"]["stock_restored_lines"] == [{"book_id": "a", "qty": 2}], "what was put back is recorded")
check(wh.calls[-1] == (False, [("a", 2)]), "warehouse ledger told: copies back")

print("-- an order paid before stock_taken existed --")
db = DB(books(), paid(backorder_items=["b"], items=[{"book_id": "a", "quantity": 2}, {"book_id": "p", "quantity": 1},
                                                    {"book_id": "b", "quantity": 4}]))
db.books.docs["b"] = {"id": "b", "stock": 0}
r = run(os_.restore_order_stock(db, "o1", by="x", why="t"))
check(r["copies"] == 2, "rebuilt from items, minus backorder and pre-order lines that were never taken")

print("-- nothing to put back --")
db = DB(books(), paid(payment_status="pending", stock_decremented=False))
check(run(os_.restore_order_stock(db, "o1", by="x", why="t"))["copies"] == 0 and db.books.docs["a"]["stock"] == 5,
      "an unpaid order restores nothing")

print("-- un-cancel takes them off again --")
db = DB(books(), paid(stock_taken=[{"book_id": "a", "qty": 2}]))
run(os_.restore_order_stock(db, "o1", by="x", why="t"))
r = run(os_.retake_order_stock(db, "o1", by="x"))
check(r["copies"] == 2 and db.books.docs["a"]["stock"] == 5, "back to where it was")
check(db.orders.docs["o1"]["stock_restored"] is False, "can be cancelled (and restored) again")
check(run(os_.retake_order_stock(db, "o1", by="x"))["copies"] == 0, "a second un-cancel takes nothing more")
check(wh.calls[-1] == (True, [("a", 2)]), "warehouse ledger told: copies out again")

db = DB(books(), paid(stock_taken=[{"book_id": "a", "qty": 2}]))
run(os_.restore_order_stock(db, "o1", by="x", why="t"))
db.books.docs["a"]["stock"] = 1          # sold to someone else meanwhile
r = run(os_.retake_order_stock(db, "o1", by="x"))
check(r["short"] == ["a"] and db.books.docs["a"]["stock"] == 1, "not enough left: stock never goes negative")
check(db.orders.docs["o1"].get("needs_attention") and "a" in db.orders.docs["o1"]["backorder_items"],
      "…and the order is flagged as a backorder")

print("-- hamper expansion is shared with payment --")
db = DB({"h": {"id": "h", "product_type": "hamper", "hamper_items": [{"book_id": "a", "qty": 2}, {"label": "bag"}]},
         "a": {"id": "a"}}, {})
check(run(os_.expand_order_lines(db, [{"book_id": "h", "quantity": 3}])) == [("h", 3), ("a", 6)],
      "box plus contents, non-book goods skipped")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
