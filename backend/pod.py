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
SETTINGS_KEY = "pod_settings"
# The "NEW" labels and the Bookstore "Explore" strip announce the service
# while it is new; the office switches them off (or sets an end date) here.
SETTINGS_DEFAULT = {"show_new": True, "new_until": "", "explore_strip": True}
public_router = APIRouter(prefix="/api/pod", tags=["pod"])
admin_router = APIRouter(prefix="/api/admin/orders/pod-holidays", tags=["pod-admin"], dependencies=[Depends(require_admin)])


async def holidays() -> list:
    d = await db.integrations.find_one({"key": KEY}, {"_id": 0, "holidays": 1}) or {}
    return d.get("holidays") or []


async def window_now(now=None) -> tuple:
    """(from, to) ISO dates for an order paid now."""
    a, b = pc.dispatch_window(now or datetime.now(timezone.utc), await holidays())
    return a.isoformat(), b.isoformat()


async def pod_settings() -> dict:
    d = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
    return {k: d.get(k, v) for k, v in SETTINGS_DEFAULT.items()}


@public_router.get("/schedule")
async def schedule():
    today = datetime.now(timezone.utc).date().isoformat()
    st = await pod_settings()
    show_new = bool(st["show_new"]) and (not st["new_until"] or today <= st["new_until"])
    return {"holidays": [h for h in await holidays() if h["date"] >= today][:60], "cutoff_hour": pc.CUTOFF_HOUR,
            "min_days": pc.MIN_DAYS, "max_days": pc.MAX_DAYS, "max_qty": pc.MAX_QTY,
            "show_new": show_new, "explore_strip": bool(st["explore_strip"])}


class HolidaysBody(BaseModel):
    holidays: list


class PodSettingsBody(BaseModel):
    show_new: bool = True
    new_until: str = ""
    explore_strip: bool = True


@admin_router.get("/settings")
async def get_pod_settings():
    return await pod_settings()


@admin_router.put("/settings")
async def put_pod_settings(body: PodSettingsBody, user: dict = Depends(require_admin)):
    until = (body.new_until or "").strip()[:10]
    if until:
        try:
            datetime.strptime(until, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="The end date must be a date (YYYY-MM-DD).")
    doc = {"show_new": body.show_new, "new_until": until, "explore_strip": body.explore_strip}
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, **doc, "by": user.get("email", ""),
                                                                     "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await audit_log(db, "POD_SETTINGS_SAVED", email=user.get("email", ""), role=user.get("role", ""), meta=doc)
    return doc


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
