"""Admin → Orders: remove orders in bulk (Nov 2026).

WHAT CAN BE DELETED
  Only orders that never took money: payment not "paid", stock never taken,
  never shipped (failed / abandoned / unpaid checkouts, test orders).
  A PAID order is a financial record — its GST invoice must be kept (CGST Act
  s.36: accounts kept for 72 months), and revenue, reports and the customer's
  account all point at it. Paid orders are ARCHIVED instead: hidden from the
  orders list, nothing else changes, restorable any time.

A LATE PAYMENT IS NEVER LOST
  Razorpay can still capture a payment on a checkout we have given up on
  (customer retries an hour later; a webhook arrives late). Every deleted
  order is kept whole in `deleted_orders`; payments.order_by_rzp() looks there
  when an order is missing and PUTS IT BACK before settling, with an audit
  line and an admin alert — so a deleted order can come back as a paid one,
  but money can never land on an order that no longer exists.

Super admin only (POST — rbac's DELETE-only auto-promotion does not cover
these). Every delete / archive is audited with the order numbers.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from audit import audit_log
from extensions import db, require_superadmin

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/orders", tags=["admin"])
MAX_IDS = 500


def deletable(o: dict) -> str:
    """'' if the order may be deleted, else why not (shown to the admin)."""
    if o.get("payment_status") == "paid":
        return "Paid — archive it instead (it's a financial record)"
    if o.get("stock_decremented") or o.get("stock_taken"):
        return "Stock was taken for it — cancel it first so copies go back"
    if o.get("status") in ("shipped", "delivered") or o.get("warehouse_packed_at"):
        return "Already packed / shipped"
    return ""


class BulkBody(BaseModel):
    ids: list
    reason: str = ""


@router.post("/bulk-delete")
async def orders_bulk_delete(body: BulkBody, user: dict = Depends(require_superadmin)):
    ids = [str(i) for i in (body.ids or [])][:MAX_IDS]
    if not ids:
        raise HTTPException(status_code=400, detail="Tick at least one order.")
    if len((body.reason or "").strip()) < 3:
        raise HTTPException(status_code=400, detail="Say why (e.g. 'failed payments', 'test orders').")
    deleted, skipped = [], []
    now = datetime.now(timezone.utc).isoformat()
    for o in await db.orders.find({"id": {"$in": ids}}, {"_id": 0}).to_list(MAX_IDS):
        why = deletable(o)
        if why:
            skipped.append({"id": o["id"], "order_number": o.get("order_number", ""), "why": why})
            continue
        await db.deleted_orders.insert_one({"at": now, "by": user.get("email", ""), "reason": body.reason.strip()[:200],
                                            "order_id": o["id"], "rzp_order_id": o.get("rzp_order_id"), "row": o})
        # Conditional: if a payment landed in the meantime, the order is no
        # longer unpaid and stays.
        res = await db.orders.delete_one({"id": o["id"], "payment_status": {"$ne": "paid"}, "stock_decremented": {"$ne": True}})
        if res.deleted_count:
            deleted.append(o.get("order_number") or o["id"])
        else:
            await db.deleted_orders.delete_one({"order_id": o["id"], "at": now})
            skipped.append({"id": o["id"], "order_number": o.get("order_number", ""), "why": "Paid a moment ago — kept"})
    await audit_log(db, "ORDERS_BULK_DELETED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"deleted": deleted, "skipped": len(skipped), "reason": body.reason.strip()[:200]})
    return {"deleted": len(deleted), "deleted_numbers": deleted, "skipped": skipped}


class ArchiveBody(BaseModel):
    ids: list
    archive: bool = True


@router.post("/bulk-archive")
async def orders_bulk_archive(body: ArchiveBody, user: dict = Depends(require_superadmin)):
    """Hide orders from the list (paid ones included). Reports, revenue,
    invoices and the customer's account are unchanged."""
    ids = [str(i) for i in (body.ids or [])][:MAX_IDS]
    if not ids:
        raise HTTPException(status_code=400, detail="Tick at least one order.")
    now = datetime.now(timezone.utc).isoformat()
    upd = {"$set": {"archived": True, "archived_at": now, "archived_by": user.get("email", "")}} if body.archive \
        else {"$set": {"archived": False}, "$unset": {"archived_at": "", "archived_by": ""}}
    res = await db.orders.update_many({"id": {"$in": ids}}, upd)
    await audit_log(db, "ORDERS_ARCHIVED" if body.archive else "ORDERS_UNARCHIVED", email=user.get("email", ""),
                    role=user.get("role", ""), meta={"count": res.modified_count, "ids": ids[:100]})
    return {"changed": res.modified_count}


async def restore_deleted(rzp_order_id: str):
    """A payment arrived for an order we deleted: put it back (whole, as it
    was) so the payment settles onto it. Returns the order or None."""
    if not rzp_order_id:
        return None
    tomb = await db.deleted_orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0}, sort=[("at", -1)])
    if not tomb:
        return None
    row = tomb["row"]
    if not await db.orders.find_one({"id": row["id"]}, {"_id": 1}):
        await db.orders.insert_one({**row, "restored_from_deleted_at": datetime.now(timezone.utc).isoformat()})
        await db.deleted_orders.delete_many({"order_id": row["id"]})
        await audit_log(db, "ORDER_RESTORED_LATE_PAYMENT", email="system", role="system",
                        meta={"order": row.get("order_number"), "rzp_order_id": rzp_order_id})
        try:
            from marketing import raise_alert
            await raise_alert("orders", f"Order {row.get('order_number')} was deleted as unpaid, but a payment has now arrived — it has been restored. Check and ship it.",
                              key=f"restored:{row['id']}")
        except Exception:  # noqa: BLE001
            log.warning("restore alert failed", exc_info=True)
    return await db.orders.find_one({"id": row["id"]}, {"_id": 0})
