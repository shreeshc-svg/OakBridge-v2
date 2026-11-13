"""Short shipments — "the label says 9, only 7 went" (Nov 2026).

Any courier parcel (website order, phone / dealer / university order, author
copy, free copy) can go out short. On the phone each book now has SENT next to
the label's quantity; when sent < ordered the difference becomes an OWED line
(`wh_owed`) that sits on the warehouse home screen and in Admin → Warehouse →
Still to send until somebody resolves it:

  SEND THE REST   the follow-up parcel went. Phone or office.
  CANCEL          the rest will not be sent. Office only (it can mean money).

STOCK — WHY IT DEPENDS ON THE KIND OF PARCEL
  website order   The site took ALL copies off when the customer paid. The
                  copies not sent are still the customer's, so nothing moves
                  when the parcel goes short (they stay set aside on the
                  shelf). "Send the rest" moves nothing either. "Cancel" puts
                  them back into stock (warehouse and website count) and
                  records a refund reminder with the amount — the site never
                  moves money; the office refunds in Razorpay and ticks
                  "Refund done".
  dealer / author / free
                  Only the copies SENT came off (warehouse.wh_confirm). "Send
                  the rest" takes the rest off then, with the same reason;
                  "Cancel" moves nothing — they never left stock.
  Amazon / Flipkart come through the daily sheet: he enters what he sent.

Each owed line is resolved exactly once (a conditional update on status), so
two taps — phone and office at once — can never move stock twice.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from extensions import db, require_admin
from warehouse import COURIER_DEDUCT, _apply, _office_only, require_warehouse

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/warehouse/owed", tags=["warehouse"])
admin_router = APIRouter(prefix="/api/admin/warehouse/owed", tags=["warehouse-admin"], dependencies=[Depends(require_admin)])

KIND_LABEL = {"website_order": "Website order", "dealer_order": "Phone / dealer order", "author_copy": "Author copy", "free_copy": "Free copy"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def record_shorts(doc_id: str, shorts: list, user: dict) -> int:
    """Called by warehouse.wh_confirm for every courier line sent short.
    shorts: [(parcel, line, who)] with line.ordered > line.qty."""
    n = 0
    for p, ln, who in shorts:
        owed = int(ln.ordered) - int(ln.qty)
        if owed <= 0:
            continue
        book = await db.books.find_one({"id": ln.book_id}, {"_id": 0, "title": 1, "isbn": 1}) or {}
        order = None
        unit = None
        if p.kind == "website_order" and p.order_id:
            order = await db.orders.find_one({"id": p.order_id}, {"_id": 0, "id": 1, "order_number": 1, "items": 1, "email": 1,
                                                                 "full_name": 1, "delivery_name": 1})
            it = next((i for i in (order or {}).get("items") or [] if i.get("book_id") == ln.book_id), None)
            unit = float(it.get("price") or 0) if it else None
        doc = {"id": str(uuid.uuid4()), "doc_id": doc_id, "parcel_no": p.no, "kind": p.kind, "party": who,
               "order_id": p.order_id if order else None, "order_number": (order or {}).get("order_number", ""),
               "book_id": ln.book_id, "title": (book.get("title") or "")[:160], "isbn": book.get("isbn", ""),
               "ordered": int(ln.ordered), "sent": int(ln.qty), "owed": owed, "unit_price": unit,
               "status": "open", "created_at": _now(), "created_by": user.get("email", "")}
        await db.wh_owed.insert_one(dict(doc))
        n += 1
        if order:
            await db.orders.update_one({"id": order["id"]}, {"$set": {"short_open": True}})
            await _mail_customer(order, f"Part of your order {order.get('order_number', '')} is on its way",
                                 [f"Your parcel has left with {int(ln.qty)} of {int(ln.ordered)} copies of “{doc['title']}”.",
                                  f"The remaining {owed} cop{'y' if owed == 1 else 'ies'} will follow in a separate parcel — we'll email you when it ships.",
                                  "Sorry for the wait, and thank you for your patience."])
    if n:
        from audit import audit_log
        await audit_log(db, "WAREHOUSE_SHORT_SHIPPED", email=user.get("email", ""), role=user.get("role", ""),
                        meta={"doc": doc_id, "lines": n, "copies_owed": sum(int(l.ordered) - int(l.qty) for _, l, _ in shorts)})
    return n


async def _mail_customer(order: dict, subject: str, lines: list) -> None:
    if not order or not order.get("email"):
        return
    try:
        import html
        from emailer import send_email
        name = (order.get("delivery_name") or order.get("full_name") or "there").split(" ")[0]
        body = "".join(f"<p style='margin:0 0 10px;font-size:15px;line-height:1.5'>{html.escape(x)}</p>" for x in lines)
        await send_email(to=order["email"], subject=subject,
                         html=f"<div style='font-family:Arial,sans-serif;color:#002B5C;max-width:560px'>"
                              f"<p style='font-size:15px'>Hi {html.escape(name)},</p>{body}<p style='font-size:15px'>— Oakbridge Publishing</p></div>")
    except Exception:  # noqa: BLE001 — never blocks the stock step
        log.exception("short shipment: customer mail failed")


def _view(o: dict) -> dict:
    v = {k: o.get(k) for k in ("id", "doc_id", "parcel_no", "kind", "party", "order_id", "order_number", "book_id", "title", "isbn",
                               "ordered", "sent", "owed", "status", "created_at", "created_by", "resolved_at", "resolved_by",
                               "note", "refund_due", "refund_done", "refund_done_at")}
    v["kind_label"] = KIND_LABEL.get(o.get("kind"), o.get("kind"))
    return v


async def _resolve(oid: str, status: str, user: dict, note: str = "", extra: Optional[dict] = None) -> dict:
    o = await db.wh_owed.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Not found")
    res = await db.wh_owed.update_one({"id": oid, "status": "open"},
                                      {"$set": {"status": status, "resolved_at": _now(), "resolved_by": user.get("email", ""),
                                                "note": (note or "")[:300], **(extra or {})}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="Already done — refresh.")
    return o


async def _order_still_short(order_id: Optional[str]) -> None:
    if order_id and not await db.wh_owed.find_one({"order_id": order_id, "status": "open"}, {"_id": 1}):
        await db.orders.update_one({"id": order_id}, {"$set": {"short_open": False}})


# ---------------------------------------------------------------- phone ---
@router.get("")
async def owed_list(_: dict = Depends(require_warehouse)):
    rows = [_view(o) async for o in db.wh_owed.find({"status": "open"}, {"_id": 0})]
    rows.sort(key=lambda o: o["created_at"])
    return {"rows": rows}


class NoteBody(BaseModel):
    note: Optional[str] = ""


@router.post("/{oid}/sent")
async def owed_sent(oid: str, body: NoteBody, user: dict = Depends(require_warehouse)):
    """The follow-up parcel went: dealer / author / free copies come off
    stock now; a website order's were taken at payment, so nothing moves."""
    o = await _resolve(oid, "sent", user, body.note or "")
    moved = 0
    if o["kind"] in COURIER_DEDUCT:
        await _apply(o["book_id"], -o["owed"], COURIER_DEDUCT[o["kind"]], actor=user, doc_id=o["doc_id"],
                     party=o.get("party", ""), note=f"Rest of a short parcel ({o['sent']} of {o['ordered']} went first)")
        moved = o["owed"]
    if o.get("order_id"):
        order = await db.orders.find_one({"id": o["order_id"]}, {"_id": 0})
        await _mail_customer(order, f"The rest of your order {o.get('order_number', '')} is on its way",
                             [f"The remaining {o['owed']} cop{'y' if o['owed'] == 1 else 'ies'} of “{o['title']}” have now been sent.",
                              "Thank you for your patience."])
    await _order_still_short(o.get("order_id"))
    from audit import audit_log
    await audit_log(db, "WAREHOUSE_SHORT_REST_SENT", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"owed": oid, "book": o["book_id"], "copies": o["owed"], "kind": o["kind"], "stock_moved": moved})
    return {"ok": True, "stock_moved": moved}


# --------------------------------------------------------------- office ---
@admin_router.get("")
async def adm_owed(status: str = "open"):
    q = {} if status == "all" else {"status": status} if status != "refund" else {"refund_due": {"$gt": 0}, "refund_done": {"$in": [None, False]}}
    rows = [_view(o) async for o in db.wh_owed.find(q, {"_id": 0})]
    rows.sort(key=lambda o: o["created_at"], reverse=status != "open")
    refunds = await db.wh_owed.count_documents({"refund_due": {"$gt": 0}, "refund_done": {"$in": [None, False]}})
    return {"rows": rows[:500], "refunds_pending": refunds}


@admin_router.post("/{oid}/sent")
async def adm_owed_sent(oid: str, body: NoteBody, user: dict = Depends(require_admin)):
    _office_only(user)
    return await owed_sent(oid, body, user)


@admin_router.post("/{oid}/cancel")
async def adm_owed_cancel(oid: str, body: NoteBody, user: dict = Depends(require_admin)):
    """The rest will not be sent. Website order: the copies go back into stock
    and a refund reminder is recorded (the office refunds in Razorpay). Other
    kinds: nothing to put back — those copies never left."""
    _office_only(user)
    o = await db.wh_owed.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Not found")
    refund = round(o["unit_price"] * o["owed"], 2) if o.get("kind") == "website_order" and o.get("unit_price") else 0
    o = await _resolve(oid, "cancelled", user, body.note or "", {"refund_due": refund, "refund_done": False if refund else None})
    restocked = 0
    if o["kind"] == "website_order":
        await _apply(o["book_id"], o["owed"], "short_cancelled", actor=user, doc_id=o["doc_id"],
                     party=o.get("party", ""), note=f"Not sent: {o['owed']} of {o['ordered']} on order {o.get('order_number', '')}")
        restocked = o["owed"]
        order = await db.orders.find_one({"id": o["order_id"]}, {"_id": 0}) if o.get("order_id") else None
        if order:
            await db.orders.update_one({"id": order["id"]}, {"$push": {"short_cancelled": {
                "book_id": o["book_id"], "title": o["title"], "copies": o["owed"], "refund_due": refund, "at": _now(),
                "by": user.get("email", "")}}})
            await _mail_customer(order, f"An update on your order {o.get('order_number', '')}",
                                 [f"We're sorry — we couldn't send {o['owed']} cop{'y' if o['owed'] == 1 else 'ies'} of “{o['title']}” from your order.",
                                  "We're refunding you for those copies; the refund will reach your original payment method in a few working days.",
                                  "The rest of your order has been delivered as planned. We apologise for the inconvenience."])
    await _order_still_short(o.get("order_id"))
    from audit import audit_log
    await audit_log(db, "WAREHOUSE_SHORT_CANCELLED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"owed": oid, "book": o["book_id"], "copies": o["owed"], "kind": o["kind"], "restocked": restocked, "refund_due": refund})
    return {"ok": True, "restocked": restocked, "refund_due": refund}


@admin_router.post("/{oid}/refund-done")
async def adm_owed_refund_done(oid: str, body: NoteBody, user: dict = Depends(require_admin)):
    _office_only(user)
    res = await db.wh_owed.update_one({"id": oid, "refund_due": {"$gt": 0}, "refund_done": False},
                                      {"$set": {"refund_done": True, "refund_done_at": _now(), "refund_done_by": user.get("email", ""),
                                                "refund_ref": (body.note or "")[:120]}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="No refund pending here.")
    from audit import audit_log
    await audit_log(db, "WAREHOUSE_SHORT_REFUND_DONE", email=user.get("email", ""), role=user.get("role", ""), meta={"owed": oid, "ref": body.note})
    return {"ok": True}


async def ensure_indexes() -> None:
    try:
        await db.wh_owed.create_index("id", unique=True)
        await db.wh_owed.create_index([("status", 1), ("created_at", 1)])
        await db.wh_owed.create_index("order_id")
    except Exception:  # noqa: BLE001
        log.warning("short shipments: index creation failed", exc_info=True)
