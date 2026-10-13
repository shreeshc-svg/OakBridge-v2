"""Copies owed to paid pre-orders/backorders are given to those orders first
when copies arrive (order_stock.fill_waiting_orders / owed_by_book), against
the in-memory fake DB (tests/_fakedb.py).

The bug this guards: 150 printed copies of a pre-order book with 10 paid
pre-orders waiting all went on sale — the site showed 150 although only 140
were free.

Run: python backend/tests/test_waiting_orders.py
"""
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402
import order_stock  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def order(oid, items, taken, created, **kw):
    return {"id": oid, "order_number": oid.upper(), "payment_status": "paid", "status": "confirmed",
            "stock_decremented": True, "items": [{"book_id": b, "quantity": q} for b, q in items],
            "stock_taken": [{"book_id": b, "qty": q} for b, q in taken], "created_at": created, **kw}


async def main():
    # A warehouse module the fill reports to (record_fill), as in the app.
    wh = types.ModuleType("warehouse")
    wh.fills = []

    async def record_fill(o, bid, qty):
        wh.fills.append((o["order_number"], bid, qty))

    wh.record_fill = record_fill
    wh.master = False

    async def warehouse_is_master():
        return wh.master

    async def sync_order_ledger(*a, **k):
        return None

    wh.warehouse_is_master = warehouse_is_master
    wh.sync_order_ledger = sync_order_ledger
    sys.modules["warehouse"] = wh

    print("-- pre-orders get the copies first, oldest first --")
    db = DB()
    await db.books.insert_one({"id": "g", "stock": 0, "title": "Gendering Climate Futures"})
    await db.orders.insert_one(order("o1", [("g", 2)], [], "2026-10-01T10:00:00+00:00"))
    await db.orders.insert_one(order("o2", [("g", 1)], [], "2026-10-02T10:00:00+00:00"))
    await db.orders.insert_one(order("o3", [("g", 5)], [], "2026-10-03T10:00:00+00:00", status="shipped"))
    await db.orders.insert_one(order("o4", [("g", 1)], [], "2026-10-04T10:00:00+00:00", status="cancelled"))
    owed = await order_stock.owed_by_book(db)
    check(owed == {"g": 3}, f"owed counts waiting orders only (not shipped/cancelled) {owed}")
    check(await order_stock.owed_by_book(db, since="2026-10-02T00:00:00+00:00") == {"g": 1}, "since= limits to later orders")

    db.books.docs[0]["stock"] = 150                       # the printer delivered
    r = await order_stock.fill_waiting_orders(db, "g")
    check(r["copies"] == 3 and db.books.docs[0]["stock"] == 147, f"147 left on sale, not 150 ({db.books.docs[0]['stock']})")
    o1 = next(o for o in db.orders.docs if o["id"] == "o1")
    check(o1["stock_taken"] == [{"book_id": "g", "qty": 2}], "the order records what it was given (a cancel puts back exactly that)")
    check(wh.fills == [("O1", "g", 2), ("O2", "g", 1)], f"the warehouse ledger is told, oldest first {wh.fills}")
    r = await order_stock.fill_waiting_orders(db, "g")
    check(r["copies"] == 0 and db.books.docs[0]["stock"] == 147, "running again gives nothing twice")

    print("-- fewer copies than owed --")
    db = DB()
    await db.books.insert_one({"id": "b", "stock": 3})
    await db.orders.insert_one(order("p1", [("b", 2)], [], "2026-10-01T00:00:00+00:00", backorder_items=["b"]))
    await db.orders.insert_one(order("p2", [("b", 4)], [("b", 1)], "2026-10-02T00:00:00+00:00", backorder_items=["b"]))
    r = await order_stock.fill_waiting_orders(db, "b")
    p1 = next(o for o in db.orders.docs if o["id"] == "p1")
    p2 = next(o for o in db.orders.docs if o["id"] == "p2")
    check(db.books.docs[0]["stock"] == 0 and r["copies"] == 3, "never below zero; all 3 copies handed out")
    check("b" not in p1.get("backorder_items", []), "a fully filled backorder is cleared")
    check(p2["stock_taken"] == [{"book_id": "b", "qty": 1}, {"book_id": "b", "qty": 1}] and "b" in p2["backorder_items"],
          "a partly filled one keeps its backorder flag")

    print("-- a book inside a hamper --")
    db = DB()
    await db.books.insert_one({"id": "h", "product_type": "hamper", "stock": 5, "hamper_items": [{"book_id": "c", "qty": 2}]})
    await db.books.insert_one({"id": "c", "stock": 0})
    await db.orders.insert_one(order("q1", [("h", 1)], [("h", 1)], "2026-10-01T00:00:00+00:00"))
    db.books.docs[1]["stock"] = 10
    r = await order_stock.fill_waiting_orders(db, "c")
    check(r["copies"] == 2 and db.books.docs[1]["stock"] == 8, "an order holding the book only via a hamper is found and filled")

    print("-- two runs at once never give one order the same copies twice --")
    db = DB()
    await db.books.insert_one({"id": "x", "stock": 10})
    await db.orders.insert_one(order("r1", [("x", 4)], [], "2026-10-01T00:00:00+00:00"))
    # The fake never yields, so without this the two runs would simply take
    # turns. A yield before every write lets them interleave like real I/O.
    for coll in (db.books, db.orders):
        for name in ("update_one", "find_one"):
            real = getattr(coll, name)

            async def yielding(*a, _real=real, **k):
                await asyncio.sleep(0)
                return await _real(*a, **k)
            setattr(coll, name, yielding)
    await asyncio.gather(order_stock.fill_waiting_orders(db, "x"), order_stock.fill_waiting_orders(db, "x"))
    r1 = db.orders.docs[0]
    check(sum(t["qty"] for t in r1["stock_taken"]) == 4 and db.books.docs[0]["stock"] == 6,
          f"exactly 4 given, 6 left ({r1['stock_taken']}, {db.books.docs[0]['stock']})")

    print("-- orders without stock_taken are left alone --")
    db = DB()
    await db.books.insert_one({"id": "y", "stock": 10})
    old = order("s1", [("y", 2)], [], "2026-01-01T00:00:00+00:00")
    del old["stock_taken"]
    await db.orders.insert_one(old)
    check((await order_stock.fill_waiting_orders(db, "y"))["copies"] == 0, "what an old order took is unknown, so nothing is guessed")

    print("-- a cancellation (warehouse live) passes its copies to waiting orders --")
    db = DB()
    await db.books.insert_one({"id": "z", "stock": 0})
    await db.orders.insert_one(order("t1", [("z", 2)], [("z", 2)], "2026-10-01T00:00:00+00:00"))
    await db.orders.insert_one(order("t2", [("z", 1)], [], "2026-10-02T00:00:00+00:00", backorder_items=["z"]))
    wh.master = True
    res = await order_stock.restore_order_stock(db, "t1", by="admin@x", why="Cancelled before shipping")
    t2 = next(o for o in db.orders.docs if o["id"] == "t2")
    check(res["copies"] == 2 and db.books.docs[0]["stock"] == 1 and t2["stock_taken"] == [{"book_id": "z", "qty": 1}],
          "2 back, 1 goes straight to the waiting order, 1 on sale")
    wh.master = False


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
