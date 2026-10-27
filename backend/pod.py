"""Print on Demand — holidays + the public schedule. Rules: pod_core.py.

  GET /api/pod/schedule                    holidays + cut-off, for the storefront's dates
  GET /api/admin/orders/pod-holidays       the list (Admin → Orders)
  PUT /api/admin/orders/pod-holidays       replace the list

Under /api/admin/orders/… so whoever runs Orders (fulfilment) can keep the
holiday list, without needing Settings access.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import pod_core as pc
from audit import audit_log
from extensions import db, require_admin

KEY = "pod_holidays"
public_router = APIRouter(prefix="/api/pod", tags=["pod"])
admin_router = APIRouter(prefix="/api/admin/orders/pod-holidays", tags=["pod-admin"], dependencies=[Depends(require_admin)])


async def holidays() -> list:
    d = await db.integrations.find_one({"key": KEY}, {"_id": 0, "holidays": 1}) or {}
    return d.get("holidays") or []


async def window_now(now=None) -> tuple:
    """(from, to) ISO dates for an order paid now."""
    a, b = pc.dispatch_window(now or datetime.now(timezone.utc), await holidays())
    return a.isoformat(), b.isoformat()


@public_router.get("/schedule")
async def schedule():
    today = datetime.now(timezone.utc).date().isoformat()
    return {"holidays": [h for h in await holidays() if h["date"] >= today][:60], "cutoff_hour": pc.CUTOFF_HOUR,
            "min_days": pc.MIN_DAYS, "max_days": pc.MAX_DAYS, "max_qty": pc.MAX_QTY}


class HolidaysBody(BaseModel):
    holidays: list


@admin_router.get("")
async def get_holidays():
    return {"holidays": await holidays()}


@admin_router.put("")
async def put_holidays(body: HolidaysBody, user: dict = Depends(require_admin)):
    rows, errs = pc.clean_holidays(body.holidays)
    if errs:
        raise HTTPException(status_code=400, detail=" ".join(errs[:3]))
    await db.integrations.update_one({"key": KEY}, {"$set": {"key": KEY, "holidays": rows, "by": user.get("email", ""),
                                                            "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await audit_log(db, "POD_HOLIDAYS_SAVED", email=user.get("email", ""), role=user.get("role", ""), meta={"count": len(rows)})
    return {"holidays": rows}
