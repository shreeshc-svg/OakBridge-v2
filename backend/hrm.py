"""HRM API — release 1: people, logins, leave year and company calendar (Nov 2026).

Rules live in hr_core.py; this file only reads/writes MongoDB and enforces
who may do what. Everything is under /api/hrm (NOT /api/admin): employees are
ordinary site accounts, not admin staff, so the admin RBAC does not apply —
access is decided here, per request, from the employee records
(hr_core.access_of), never from anything the browser sends.

    GET  /api/hrm/me                    my record + what I may see/do
    GET  /api/hrm/people                people I may see (HR: all, manager: my team, me)
    GET  /api/hrm/people/{id}
    POST /api/hrm/people                HR: add an employee
    PATCH /api/hrm/people/{id}          HR: change details / manager / HR access
    POST /api/hrm/people/{id}/invite    HR: create or link their login, email a set-password link
    GET  /api/hrm/calendar?fy=2026-27   holidays + weekly offs + working days in the year
    PUT  /api/hrm/calendar/{fy}         HR: replace that year's holiday list
    GET/PUT /api/hrm/settings           weekly offs (HR to change)

Collections: hr_employees, hr_holidays ({fy, rows}), integrations key hr_settings.

PRIVACY (company decision + DPDP): only work details are stored — no ID
numbers, documents or bank details. Every change is in the audit log.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import hr_core as core
import rbac
from audit import audit_log
from extensions import db, get_current_user

log = logging.getLogger("oakbridge.hrm")
router = APIRouter(prefix="/api/hrm", tags=["hrm"])
SETTINGS_KEY = "hr_settings"
INVITE_DAYS = 7
PUBLIC = ("id", "emp_code", "name", "work_email", "phone", "designation", "department", "location", "manager_id",
          "joined_on", "confirmed_on", "status", "hr_access", "gender", "user_id", "invited_at", "exited_on", "photo_at")
PHOTO_MAX = 8 * 1024 * 1024
PHOTO_PX = 480


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ access ---
async def _people() -> dict:
    return {p["id"]: p async for p in db.hr_employees.find({}, {"_id": 0})}


async def _me(user: dict, people: dict) -> Optional[dict]:
    """The caller's employee record: linked by user id, else by work email
    (then linked, so a later email change on the account can't detach it)."""
    me = next((p for p in people.values() if p.get("user_id") == user["id"]), None)
    if me:
        return me
    email = (user.get("email") or "").lower()
    me = next((p for p in people.values() if p.get("work_email") == email and not p.get("user_id")), None)
    if me:
        await db.hr_employees.update_one({"id": me["id"], "user_id": {"$in": [None, ""]}}, {"$set": {"user_id": user["id"]}})
        me["user_id"] = user["id"]
    return me


async def _ctx(user: dict) -> tuple[dict, Optional[dict], dict]:
    people = await _people()
    me = await _me(user, people)
    acc = core.access_of(me, people, superadmin=rbac.is_superadmin(user.get("role")))
    return people, me, acc


async def require_hr(user: dict = Depends(get_current_user)) -> dict:
    _, _, acc = await _ctx(user)
    if not acc["hr"]:
        raise HTTPException(status_code=403, detail="Only HR / founders can do this.")
    return user


def _member(me: Optional[dict], acc: dict) -> bool:
    """In the HRM at all: HR/superadmin, or an ACTIVE employee. Someone who has
    left keeps their site account (orders etc.) but loses the HRM entirely."""
    return acc["hr"] or bool(me and me.get("status") == "active")


def _view(p: dict) -> dict:
    return {k: p.get(k) for k in PUBLIC}


async def _audit(user: dict, action: str, meta: dict) -> None:
    await audit_log(db, action, email=user.get("email", ""), role=user.get("role", ""), meta=meta)


# -------------------------------------------------------------------- me ---
@router.get("/me")
async def hrm_me(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Your account isn't set up in the HRM yet — ask HR to add you.")
    active = {pid for pid, p in people.items() if p.get("status") == "active"}
    visible = active if acc["ids"] is None else (acc["ids"] & active)
    return {"me": _view(me) if me else None, "hr": acc["hr"], "manager": acc["manager"],
            "team_size": len(visible - ({me["id"]} if me else set())),
            "manager_name": (people.get((me or {}).get("manager_id")) or {}).get("name", "")}


# ---------------------------------------------------------------- people ---
@router.get("/people")
async def hrm_people(include_exited: bool = False, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    rows = [p for p in people.values() if core.can_see(acc, p["id"]) and (include_exited or p.get("status") == "active")]
    names = {p["id"]: p.get("name", "") for p in people.values()}
    rows.sort(key=lambda p: (p.get("department") or "", p.get("name") or ""))
    return {"rows": [{**_view(p), "manager_name": names.get(p.get("manager_id"), "")} for p in rows]}


@router.get("/people/{pid}")
async def hrm_person(pid: str, user: dict = Depends(get_current_user)):
    people, _, acc = await _ctx(user)
    if pid not in people or not core.can_see(acc, pid):
        raise HTTPException(status_code=404, detail="Not found")   # 404, not 403: don't confirm who exists
    p = people[pid]
    return {**_view(p), "manager_name": (people.get(p.get("manager_id")) or {}).get("name", "")}


class PersonBody(BaseModel):
    name: Optional[str] = None
    work_email: Optional[str] = None
    phone: Optional[str] = None
    emp_code: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    location: Optional[str] = None
    manager_id: Optional[str] = None
    joined_on: Optional[str] = None
    confirmed_on: Optional[str] = None
    hr_access: Optional[bool] = None
    gender: Optional[str] = None


def _check_manager(people: dict, pid: str, mid: Optional[str]) -> None:
    if not mid:
        return
    if mid not in people or people[mid].get("status") != "active":
        raise HTTPException(status_code=400, detail="Reporting manager not found (or has left).")
    if core.manager_cycle(people, pid, mid):
        raise HTTPException(status_code=400, detail="That would make a reporting loop (someone managing their own manager).")


@router.post("/people")
async def hrm_add(body: PersonBody, user: dict = Depends(require_hr)):
    raw = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        doc = core.clean_person(raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if await db.hr_employees.find_one({"work_email": doc["work_email"]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Someone with that work email is already in the HRM.")
    people = await _people()
    pid = str(uuid.uuid4())
    _check_manager(people, pid, doc.get("manager_id"))
    doc.update(id=pid, status="active", hr_access=bool(doc.get("hr_access")), user_id=None,
               created_at=_now().isoformat(), created_by=user.get("email", ""))
    # An existing site account with this email is linked straight away.
    acct = await db.users.find_one({"email": doc["work_email"]}, {"_id": 0, "id": 1})
    if acct:
        doc["user_id"] = acct["id"]
    await db.hr_employees.insert_one(dict(doc))
    await _audit(user, "HRM_PERSON_ADDED", {"person": pid, "name": doc["name"], "hr_access": doc["hr_access"]})
    return _view(doc)


@router.patch("/people/{pid}")
async def hrm_edit(pid: str, body: PersonBody, user: dict = Depends(require_hr)):
    people = await _people()
    if pid not in people:
        raise HTTPException(status_code=404, detail="Not found")
    raw = {k: v for k, v in body.model_dump().items() if v is not None}
    if "manager_id" in body.model_fields_set and body.manager_id in (None, ""):
        raw["manager_id"] = ""    # explicit clear
    try:
        upd = core.clean_person(raw, partial=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if "work_email" in upd and upd["work_email"] != people[pid].get("work_email"):
        if await db.hr_employees.find_one({"work_email": upd["work_email"], "id": {"$ne": pid}}, {"_id": 1}):
            raise HTTPException(status_code=409, detail="Someone else already has that work email.")
    if "manager_id" in upd:
        if upd["manager_id"] == pid:
            raise HTTPException(status_code=400, detail="Someone can't report to themselves.")
        _check_manager(people, pid, upd["manager_id"])
    merged = {**people[pid], **upd}
    if merged.get("joined_on") and merged.get("confirmed_on") and merged["confirmed_on"] < merged["joined_on"]:
        raise HTTPException(status_code=400, detail="Confirmation can't be before joining.")
    if not upd:
        return _view(people[pid])
    upd.update(updated_at=_now().isoformat(), updated_by=user.get("email", ""))
    await db.hr_employees.update_one({"id": pid}, {"$set": upd})
    await _audit(user, "HRM_PERSON_EDITED", {"person": pid, "fields": sorted(k for k in upd if k not in ("updated_at", "updated_by"))})
    return _view({**people[pid], **upd})


# ---------------------------------------------------------------- logins ---
@router.post("/people/{pid}/invite")
async def hrm_invite(pid: str, user: dict = Depends(require_hr)):
    """Give this person a login: link an existing site account with their work
    email, or create one (an ordinary account, NOT admin) and email a link to
    set their password, valid INVITE_DAYS days. The password is never seen by HR."""
    from extensions import hash_password
    p = await db.hr_employees.find_one({"id": pid}, {"_id": 0})
    if not p or p.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not found (or has left).")
    acct = await db.users.find_one({"email": p["work_email"]}, {"_id": 0, "id": 1, "name": 1})
    created = False
    if not acct:
        acct = {"id": str(uuid.uuid4()), "email": p["work_email"], "name": p["name"], "phone": p.get("phone") or "",
                "password_hash": hash_password(secrets.token_urlsafe(24)), "role": "customer",
                "created_at": _now().isoformat(), "email_verified": True, "source": "hrm",
                # Created by the employer to run employment (DPDP "legitimate use"
                # for employment, s.7(i)); no marketing consent is implied.
                "consents": {"account": {"given": True, "at": _now().isoformat(), "source": "hrm-invite",
                                         "purpose": "staff login to the Oakbridge HRM (leave, goals, calendar)"}}}
        await db.users.insert_one(dict(acct))
        created = True
    site = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")
    set_url = ""
    if created:
        # Only a NEW account gets a set-password link. Someone who already has
        # an account (a customer, or admin staff) keeps their password and is
        # simply told where the HRM is — HR must never be able to trigger a
        # password reset on an existing (possibly admin) account.
        raw = secrets.token_urlsafe(32)
        await db.users.update_one({"id": acct["id"]}, {"$set": {
            "reset_token_hash": hashlib.sha256(raw.encode()).hexdigest(),
            "reset_expires_at": (_now() + timedelta(days=INVITE_DAYS)).isoformat()}})
        set_url = f"{site}/reset-password?token={raw}"
    await db.hr_employees.update_one({"id": pid}, {"$set": {"user_id": acct["id"], "invited_at": _now().isoformat()}})
    sent = False
    try:
        from emailer import send_hrm_invite
        sent = await send_hrm_invite(p["work_email"], p["name"], set_url, f"{site}/hrm", INVITE_DAYS)
    except Exception:  # noqa: BLE001
        log.exception("hrm: invite email failed for %s", pid)
    await _audit(user, "HRM_LOGIN_INVITED", {"person": pid, "account_created": created, "emailed": sent})
    return {"ok": True, "account_created": created, "emailed": sent}


# ---------------------------------------------------------------- photos ---
# A face for the People list (Nov 2026, asked for by HR). Private: stored
# under the "hr-photos" segment that /api/files never serves, and only
# returned here to someone allowed to see that person. Re-encoded to a small
# JPEG, which also drops any location / camera data the phone put in it.
def _shrink_photo(data: bytes) -> bytes:
    from io import BytesIO
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(BytesIO(data)))
    im = im.convert("RGB")
    w, h = im.size
    side = min(w, h)                     # centre square crop
    im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
    im.thumbnail((PHOTO_PX, PHOTO_PX))
    out = BytesIO()
    im.save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue()


@router.post("/people/{pid}/photo")
async def hrm_photo_upload(pid: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    import asyncio
    import uploads_guard
    from features import APP_NAME, put_object
    people, me, acc = await _ctx(user)
    if pid not in people or not (acc["hr"] or (me and me["id"] == pid and me.get("status") == "active")):
        raise HTTPException(status_code=403, detail="Only HR or the person themselves can change this photo.")
    data = await uploads_guard.read_limited(file, PHOTO_MAX, "Photo")
    uploads_guard.require_image(data, "Photo")
    try:
        jpg = await asyncio.to_thread(_shrink_photo, data)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="That image couldn't be read — use a JPEG or PNG.")
    path = f"{APP_NAME}/hr-photos/{pid}-{uuid.uuid4().hex[:8]}.jpg"
    await asyncio.to_thread(put_object, path, jpg, "image/jpeg")
    await db.hr_employees.update_one({"id": pid}, {"$set": {"photo_path": path, "photo_at": _now().isoformat()}})
    await _audit(user, "HRM_PHOTO_SET", {"person": pid})
    return {"ok": True, "photo_at": _now().isoformat()}


@router.post("/people/{pid}/photo/remove")
async def hrm_photo_remove(pid: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if pid not in people or not (acc["hr"] or (me and me["id"] == pid)):
        raise HTTPException(status_code=403, detail="Only HR or the person themselves can remove this photo.")
    await db.hr_employees.update_one({"id": pid}, {"$unset": {"photo_path": "", "photo_at": ""}})
    await _audit(user, "HRM_PHOTO_REMOVED", {"person": pid})
    return {"ok": True}


@router.get("/people/{pid}/photo")
async def hrm_photo(pid: str, user: dict = Depends(get_current_user)):
    import asyncio
    from features import get_object
    people, me, acc = await _ctx(user)
    p = people.get(pid)
    if not p or not _member(me, acc) or not core.can_see(acc, pid) or not p.get("photo_path"):
        raise HTTPException(status_code=404, detail="Not found")
    data, _ = await asyncio.to_thread(get_object, p["photo_path"])
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


# -------------------------------------------------------------- calendar ---
async def get_settings() -> dict:
    d = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
    return {"weekly_off": core.clean_weekly_off(d.get("weekly_off"))}


@router.get("/settings")
async def hrm_settings(user: dict = Depends(get_current_user)):
    _, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    return await get_settings()


class SettingsBody(BaseModel):
    weekly_off: dict


@router.put("/settings")
async def hrm_put_settings(body: SettingsBody, user: dict = Depends(require_hr)):
    w = core.clean_weekly_off(body.weekly_off)
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "weekly_off": w}}, upsert=True)
    await _audit(user, "HRM_SETTINGS", {"weekly_off": w})
    return {"weekly_off": w}


@router.get("/calendar")
async def hrm_calendar(fy: Optional[str] = None, user: dict = Depends(get_current_user)):
    _, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    fy = fy or core.fiscal_year(date.today())
    try:
        start, end = core.fy_bounds(fy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    doc = await db.hr_holidays.find_one({"fy": fy}, {"_id": 0}) or {}
    rows = doc.get("rows") or []
    st = await get_settings()
    national = [r["date"] for r in rows if r["kind"] == "national"]
    return {"fy": fy, "start": start.isoformat(), "end": end.isoformat(), "rows": rows, "weekly_off": st["weekly_off"],
            "working_days": core.working_days(start, end, national, st["weekly_off"]),
            "current_fy": core.fiscal_year(date.today())}


class CalendarBody(BaseModel):
    rows: list


@router.put("/calendar/{fy}")
async def hrm_put_calendar(fy: str, body: CalendarBody, user: dict = Depends(require_hr)):
    try:
        start, end = core.fy_bounds(fy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    rows = core.clean_holidays(body.rows)
    outside = [r["date"] for r in rows if not (start.isoformat() <= r["date"] <= end.isoformat())]
    if outside:
        raise HTTPException(status_code=400, detail=f"{len(outside)} date(s) fall outside {fy} (1 Apr – 31 Mar): {', '.join(outside[:3])}")
    await db.hr_holidays.update_one({"fy": fy}, {"$set": {"fy": fy, "rows": rows, "updated_at": _now().isoformat(),
                                                          "updated_by": user.get("email", "")}}, upsert=True)
    await _audit(user, "HRM_CALENDAR", {"fy": fy, "holidays": len(rows)})
    return {"fy": fy, "rows": rows}


async def ensure_indexes() -> None:
    try:
        await db.hr_employees.create_index("id", unique=True)
        await db.hr_employees.create_index("work_email", unique=True)
        await db.hr_employees.create_index("user_id")
        await db.hr_holidays.create_index("fy", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("hrm: index creation failed", exc_info=True)
