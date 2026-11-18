"""A shipped carton that never reached the customer (Nov 2026).

    POST /api/admin/warehouse/docs/{doc_id}/not-delivered   superadmin: {note}

The case: our delivery person took a "Carton out" (it was marked SHIPPED),
missed the delivery at the last moment and brought it back; it now goes by
courier instead. The courier run deducts the copies when it ships, so the
first carton's deduction must be given back — otherwise the same copies leave
the stock twice.

Delete was (rightly) refused for a shipped carton: deleting reverses its stock
movements, which is wrong when the copies really are gone. Here the office
states, with a reason, that they are NOT gone — they came back. Then and only
then is the shipped mark cleared and the normal delete run (warehouse.
adm_delete_doc): movements reversed, the document ARCHIVED (never erased), so
the stock history still shows it went out, came back, and why.

Kept in its own module so it does not touch warehouse.py's held changes.
Superadmin only, office only (not the warehouse phone login), audited.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from audit import audit_log
from extensions import db, require_admin, require_superadmin
from warehouse import _office_only, adm_delete_doc

router = APIRouter(prefix="/api/admin/warehouse", tags=["warehouse-admin"], dependencies=[Depends(require_admin)])


class NotDeliveredBody(BaseModel):
    note: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/docs/{doc_id}/not-delivered")
async def not_delivered(doc_id: str, body: NotDeliveredBody, user: dict = Depends(require_superadmin)):
    _office_only(user)
    note = " ".join((body.note or "").split())[:500]
    if len(note) < 10:
        raise HTTPException(status_code=400, detail="Say what happened (e.g. “Delivery missed — going by courier instead”).")
    doc = await db.warehouse_docs.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("archived"):
        raise HTTPException(status_code=409, detail="This document is already archived.")
    if doc.get("direction") != "out" or not doc.get("shipped_at"):
        raise HTTPException(status_code=409, detail="Only a shipped carton out can be marked not delivered.")

    # Clear the shipped mark only if it is still the one we read (a second
    # click, or someone else doing the same, finds it changed and stops).
    was = {"at": _now(), "by": user.get("email", ""), "note": note,
           "was_shipped_at": doc["shipped_at"], "was_shipped_by": doc.get("shipped_by", "")}
    res = await db.warehouse_docs.update_one({"id": doc_id, "shipped_at": doc["shipped_at"], "archived": {"$ne": True}},
                                             {"$set": {"shipped_at": "", "not_delivered": was}})
    if res.modified_count != 1:
        raise HTTPException(status_code=409, detail="This document has just changed — refresh.")
    try:
        out = await adm_delete_doc(doc_id, user)
    except HTTPException:
        # Nothing half-done: put the shipped mark back if the delete refused.
        await db.warehouse_docs.update_one({"id": doc_id}, {"$set": {"shipped_at": doc["shipped_at"]}, "$unset": {"not_delivered": ""}})
        raise
    await audit_log(db, "WAREHOUSE_CARTON_NOT_DELIVERED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"doc": doc_id, "number": doc.get("doc_number"), "party": doc.get("party_name") or doc.get("party"),
                          "note": note, "movements_reversed": out.get("reversed", 0)})
    return {**out, "not_delivered": True}
