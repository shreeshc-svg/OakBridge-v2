"""Festive promotions — storage and endpoints. Rules: promotions_core.py.

  GET    /api/promotions/current                    the live offer, or null (storefront)
  GET    /api/admin/coupons/promotions              every promotion with its status
  POST   /api/admin/coupons/promotions              create
  PUT    /api/admin/coupons/promotions/{id}         edit / switch off
  DELETE /api/admin/coupons/promotions/{id}         remove (superadmin, as every DELETE)

Under /api/admin/coupons/… on purpose: the "Coupons & Promotions" section
grants it (rbac.SECTION_PATHS "coupons"), so whoever may run coupons may run
promotions, and nobody else.

The order endpoint (server.create_order) calls `live_promotion()` and
promotions_core to decide the discount itself; the storefront's figure is
only a preview.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import promotions_core as pc
from audit import audit_log
from extensions import db, require_admin

public_router = APIRouter(prefix="/api/promotions", tags=["promotions"])
admin_router = APIRouter(prefix="/api/admin/coupons/promotions", tags=["promotions-admin"],
                         dependencies=[Depends(require_admin)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def live_promotion(now: Optional[datetime] = None) -> Optional[dict]:
    now = now or _now()
    async for p in db.promotions.find({"active": True, "deleted": {"$ne": True}}, {"_id": 0}):
        if pc.is_live(p, now):
            return p
    return None


@public_router.get("/current")
async def current():
    p = await live_promotion()
    return {"promotion": pc.public_view(p) if p else None}


@admin_router.get("")
async def list_promotions():
    now = _now()
    out = []
    async for p in db.promotions.find({"deleted": {"$ne": True}}, {"_id": 0}).sort("starts_at", -1).limit(200):
        used = await db.orders.count_documents({"promo_id": p["id"], "payment_status": "paid"})
        out.append({**p, "status": pc.status(p, now), "offer": pc.offer_text(p) if p.get("kind") else "", "paid_orders": used})
    return {"promotions": out}


async def _save(body: dict, user: dict, pid: Optional[str] = None) -> dict:
    doc, errs = pc.clean(body)
    if errs:
        raise HTTPException(status_code=400, detail=" ".join(errs))
    if doc["active"]:
        async for other in db.promotions.find({"active": True, "deleted": {"$ne": True}, "id": {"$ne": pid}}, {"_id": 0}):
            if pc.overlaps(doc, other):
                raise HTTPException(status_code=400, detail=(
                    f"It overlaps “{other['label']}” ({other['starts_at']} → {other['ends_at']}). Only one festive offer "
                    "can run at a time — change the dates or switch the other one off."))
    now = _now().isoformat()
    if pid:
        res = await db.promotions.update_one({"id": pid, "deleted": {"$ne": True}},
                                             {"$set": {**doc, "updated_at": now, "updated_by": user.get("email", "")}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Promotion not found")
    else:
        pid = str(uuid.uuid4())
        await db.promotions.insert_one({**doc, "id": pid, "created_at": now, "created_by": user.get("email", "")})
    await audit_log(db, "PROMOTION_SAVED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"id": pid, "label": doc["label"], "kind": doc["kind"], "value": doc["value"],
                          "active": doc["active"], "from": doc["starts_at"], "to": doc["ends_at"]})
    return await db.promotions.find_one({"id": pid}, {"_id": 0})


@admin_router.post("")
async def create_promotion(body: dict, user: dict = Depends(require_admin)):
    return await _save(body, user)


@admin_router.put("/{pid}")
async def update_promotion(pid: str, body: dict, user: dict = Depends(require_admin)):
    return await _save(body, user, pid)


@admin_router.delete("/{pid}")
async def delete_promotion(pid: str, user: dict = Depends(require_admin)):
    # Soft delete: orders keep pointing at it (promo_id) for reports.
    res = await db.promotions.update_one({"id": pid}, {"$set": {"deleted": True, "active": False,
                                                                 "deleted_at": _now().isoformat()}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Promotion not found")
    await audit_log(db, "PROMOTION_DELETED", email=user.get("email", ""), role=user.get("role", ""), meta={"id": pid})
    return {"ok": True}
