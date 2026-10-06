"""
Selling a hamper takes its component titles off the shelf too.

    python backend/tests/test_hamper_stock.py

_apply_stock_decrement is the one place that runs exactly once per paid order,
so it is where the expansion belongs — and it is also the place where a mistake
oversells a book or double-decrements one. No Mongo here: the function is
pulled out with ast and handed a stub db that records what it was asked to do.
"""
import ast
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

failures = []


def check(cond, label):
    print(("ok   " if cond else "FAIL "), label)
    if not cond:
        failures.append(label)


# --------------------------------------------------------------------------
# A stub standing in for motor. Only the calls this function makes.
# --------------------------------------------------------------------------
class Coll:
    def __init__(self, docs=None, name=""):
        self.docs = docs or {}
        self.name = name
        self.incs = []          # (id, delta) in the order applied
        self.updates = []       # every update_one filter/patch pair

    async def update_one(self, flt, patch):
        self.updates.append((flt, patch))
        inc = patch.get("$inc", {})
        if "stock" in inc:
            doc = self.docs.get(flt.get("id"))
            have = (doc or {}).get("stock", 0)
            need = flt.get("stock", {}).get("$gte", 0)
            if doc is None or have < need:
                return type("R", (), {"modified_count": 0})()
            doc["stock"] = have + inc["stock"]
            self.incs.append((flt["id"], inc["stock"]))
            return type("R", (), {"modified_count": 1})()
        # the stock_decremented claim, and the backorder flag
        if self.name == "orders" and flt.get("stock_decremented") == {"$ne": True}:
            doc = self.docs.get(flt["id"])
            if not doc or doc.get("stock_decremented"):
                return type("R", (), {"modified_count": 0})()
            doc["stock_decremented"] = True
            return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 1})()

    async def find_one(self, flt, proj=None):
        doc = self.docs.get(flt.get("id"))
        if doc is None:
            return None
        for k, v in flt.items():
            if k == "id":
                continue
            if isinstance(v, dict):
                continue
            if doc.get(k) != v:
                return None
        return doc


class DB:
    def __init__(self, books, orders):
        self.books = Coll(books, "books")
        self.orders = Coll(orders, "orders")
        self.coupons = Coll({}, "coupons")


def load(db):
    tree = ast.parse(open(os.path.join(BACKEND, "payments.py"), encoding="utf-8").read())
    fn = [n for n in tree.body
          if isinstance(n, ast.AsyncFunctionDef) and n.name == "_apply_stock_decrement"]
    assert fn, "could not find _apply_stock_decrement in payments.py"

    class Log:
        def __getattr__(self, _):
            return lambda *a, **k: None

    ns = {"db": db, "logger": Log()}
    exec(compile(ast.Module(body=fn, type_ignores=[]), "<payments>", "exec"), ns)
    return ns["_apply_stock_decrement"]


BOOKS = lambda: {                                                   # noqa: E731
    "hamper-1": {"id": "hamper-1", "stock": 40, "product_type": "hamper",
                 "hamper_items": [
                     {"book_id": "bk-a", "qty": 1},
                     {"book_id": "bk-b", "qty": 2},
                     {"label": "Brass bookmarks, set of 4"},        # no book_id
                     {"label": "Cotton carry bag"},
                     {"label": "Rakhi card"},
                 ]},
    "bk-a": {"id": "bk-a", "stock": 100},
    "bk-b": {"id": "bk-b", "stock": 100},
    "bk-c": {"id": "bk-c", "stock": 100},
}


def run(items, books=None, orders=None):
    db = DB(books or BOOKS(), orders or {"o1": {"id": "o1", "items": items}})
    asyncio.run(load(db)("o1"))
    return db


# --------------------------------------------------------------------------
print("-- one hamper --")
db = run([{"book_id": "hamper-1", "quantity": 1}])
check(dict(db.books.incs) == {"hamper-1": -1, "bk-a": -1, "bk-b": -2},
      f"the box and everything in it come off the shelf {dict(db.books.incs)}")
check(db.books.docs["bk-b"]["stock"] == 98, "a component with qty 2 moves by 2, not 1")
check(len(db.books.incs) == 3, "the three non-book goods decrement nothing")

print("\n-- three hampers in one line --")
db = run([{"book_id": "hamper-1", "quantity": 3}])
check(dict(db.books.incs) == {"hamper-1": -3, "bk-a": -3, "bk-b": -6},
      f"component quantities multiply by the line quantity {dict(db.books.incs)}")

print("\n-- a hamper and a loose copy of a book inside it --")
db = run([{"book_id": "hamper-1", "quantity": 1}, {"book_id": "bk-a", "quantity": 1}])
check(db.books.docs["bk-a"]["stock"] == 98,
      "bk-a drops twice: once boxed, once loose — this is the overselling the fix exists to stop")

print("\n-- an ordinary book order is untouched --")
db = run([{"book_id": "bk-c", "quantity": 2}])
check(dict(db.books.incs) == {"bk-c": -2}, "no hamper lookup changes a plain order")

print("\n-- idempotence: the webhook and /verify both fire --")
books, orders = BOOKS(), {"o1": {"id": "o1", "items": [{"book_id": "hamper-1", "quantity": 1}]}}
dec = None
db = DB(books, orders)
fn = load(db)
asyncio.run(fn("o1"))
first = dict(db.books.incs)
asyncio.run(fn("o1"))          # Razorpay retries, or /verify races the webhook
check(dict(db.books.incs) == first,
      "the second call decrements nothing — the stock_decremented claim still holds")
check(books["bk-a"]["stock"] == 99, "component stock moved once, not twice")

print("\n-- a component that has run out --")
books = BOOKS(); books["bk-b"]["stock"] = 1     # needs 2
db = DB(books, {"o1": {"id": "o1", "items": [{"book_id": "hamper-1", "quantity": 1}]}})
asyncio.run(load(db)("o1"))
check(books["bk-b"]["stock"] == 1, "a short component is never driven negative")
flagged = [u for u in db.orders.updates if "$addToSet" in u[1]]
check(any(u[1]["$addToSet"].get("backorder_items") == "bk-b" for u in flagged),
      "and the order is flagged for attention naming the component, not the hamper")

print("\n-- a hamper with no contents behaves like a plain product --")
books = BOOKS(); books["hamper-1"]["hamper_items"] = []
db = DB(books, {"o1": {"id": "o1", "items": [{"book_id": "hamper-1", "quantity": 1}]}})
asyncio.run(load(db)("o1"))
check(dict(db.books.incs) == {"hamper-1": -1}, "empty contents is not an error")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
