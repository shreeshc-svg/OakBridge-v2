"""Website order stock: what a paid order took off the shelf, and putting it back.

payments._apply_stock_decrement takes copies off once per paid order and now
records exactly what it took (order.stock_taken). Before this module nothing
ever put them back: a cancelled order left its copies missing from the
website for good, and — once the warehouse system is live — from the
warehouse count too.

The rules (cancel_restock_decision):
  * cancelled before shipping            -> put back automatically
  * cancelled after it was shipped       -> held; the books are with the
    courier, not on the shelf. Admin -> Orders "Returned — put back in stock"
    when the parcel actually comes back.
  * cancelled after the warehouse packed it onto a courier sheet -> held; the
    warehouse phone asks "is the parcel still here?" (it may already be gone)
  * un-cancelled (Cancelled -> any other status) -> taken off again

Every function takes db as an argument and imports nothing heavy at module
level, so the tests can run it against a stub without motor or fastapi.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

SHIPPED = frozenset({"shipped", "delivered"})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def expand_order_lines(db, items) -> list:
    """Order items -> (book_id, qty) lines, hamper contents expanded.

    A hamper holds real copies of real titles, so selling one moves the box
    AND each book inside it. Non-book goods in a hamper (bookmarks, carry
    bags) have no book_id and move nothing.
    """
    lines: list = []
    for it in items or []:
        bid = it.get("book_id")
        qty = int(it.get("quantity", 0) or 0)
        if not bid or qty <= 0:
            continue
        lines.append((bid, qty))
        hamper = await db.books.find_one(
            {"id": bid, "product_type": "hamper"}, {"_id": 0, "hamper_items": 1}
        )
        for comp in (hamper or {}).get("hamper_items", []):
            cid = comp.get("book_id")
            if not cid:
                continue
            lines.append((cid, qty * int(comp.get("qty", 1) or 1)))
    return lines


def cancel_restock_decision(prev_status: str, order: dict) -> str:
    """What cancelling this order should do to stock.

    restore         put the copies back now
    hold_shipped    it left the building; wait for the parcel to come back
    hold_warehouse  packed onto a courier sheet; the warehouse must say
                    whether the parcel is still there
    none            nothing was taken (unpaid, pre-payment) or already back
    """
    if order.get("payment_status") != "paid" or not order.get("stock_decremented"):
        return "none"
    if order.get("stock_restored"):
        return "none"
    if (prev_status or "") in SHIPPED:
        return "hold_shipped"
    if order.get("warehouse_doc_id"):
        return "hold_warehouse"
    return "restore"


async def _lines_to_restore(db, order: dict) -> list:
    """Exactly what this order took off website stock.

    Orders paid after this change carry stock_taken. Older ones do not, so the
    lines are rebuilt from the items, leaving out what certainly was NOT
    taken: lines flagged as backorders (the guarded decrement missed) and
    books still on pre-order (a pre-order has no stock to take).
    """
    if isinstance(order.get("stock_taken"), list):
        return [(ln["book_id"], int(ln["qty"])) for ln in order["stock_taken"]
                if ln.get("book_id") and int(ln.get("qty") or 0) > 0]
    skip = set(order.get("backorder_items") or [])
    out = []
    for bid, qty in await expand_order_lines(db, order.get("items")):
        if bid in skip:
            continue
        book = await db.books.find_one({"id": bid}, {"_id": 0, "coming_soon": 1})
        if (book or {}).get("coming_soon"):
            continue
        out.append((bid, qty))
    return out


async def restore_order_stock(db, order_id: str, *, by: str, why: str) -> dict:
    """Put a paid order's copies back on website stock. At most once.

    The claim (stock_restored False -> True) is the update itself and carries
    the lines, so two clicks, or Admin and the warehouse at the same moment,
    cannot both add the copies back, and a later un-cancel knows exactly what
    to take off again.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order or order.get("payment_status") != "paid" or not order.get("stock_decremented") \
            or order.get("stock_restored"):
        return {"copies": 0, "lines": []}
    lines = await _lines_to_restore(db, order)
    claim = await db.orders.update_one(
        {"id": order_id, "stock_decremented": True, "stock_restored": {"$ne": True}},
        {"$set": {"stock_restored": True, "stock_restored_at": _now(), "stock_restored_by": by,
                  "stock_restored_why": why[:200], "wh_cancel_pending": False,
                  "stock_restored_lines": [{"book_id": b, "qty": q} for b, q in lines]}},
    )
    if claim.modified_count != 1:
        return {"copies": 0, "lines": []}
    for bid, qty in lines:
        await db.books.update_one({"id": bid}, {"$inc": {"stock": qty}})
    try:
        from warehouse import sync_order_ledger
        await sync_order_ledger(order, out=False, lines=lines, by=by, note=why)
    except Exception:  # noqa: BLE001 — stock is back; the ledger must not undo that
        log.exception("warehouse: could not record return for %s", order.get("order_number"))
    return {"copies": sum(q for _, q in lines), "lines": lines}


async def retake_order_stock(db, order_id: str, *, by: str) -> dict:
    """Un-cancelled: take the copies that were put back off again."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order or not order.get("stock_restored"):
        return {"copies": 0, "short": []}
    lines = [(ln["book_id"], int(ln["qty"])) for ln in order.get("stock_restored_lines") or []]
    claim = await db.orders.update_one(
        {"id": order_id, "stock_restored": True},
        {"$set": {"stock_restored": False, "stock_retaken_at": _now(), "stock_retaken_by": by,
                  "stock_restored_lines": []}},
    )
    if claim.modified_count != 1:
        return {"copies": 0, "short": []}
    taken, short = [], []
    for bid, qty in lines:
        res = await db.books.update_one({"id": bid, "stock": {"$gte": qty}}, {"$inc": {"stock": -qty}})
        if res.modified_count:
            taken.append((bid, qty))
        else:
            # Sold to someone else meanwhile: same backorder flag the payment
            # path raises, so it surfaces in Admin -> Orders.
            short.append(bid)
    patch = {"$set": {"stock_taken": [{"book_id": b, "qty": q} for b, q in taken]}}
    if short:
        patch["$addToSet"] = {"backorder_items": {"$each": short}}
        patch["$set"]["needs_attention"] = True
    await db.orders.update_one({"id": order_id}, patch)
    try:
        from warehouse import sync_order_ledger
        await sync_order_ledger(order, out=True, lines=lines, by=by, note="Order un-cancelled")
    except Exception:  # noqa: BLE001
        log.exception("warehouse: could not record re-take for %s", order.get("order_number"))
    return {"copies": sum(q for _, q in taken), "short": short}
