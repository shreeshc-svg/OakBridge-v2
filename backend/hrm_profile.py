"""HRM → My profile (Nov 2026): the personal details a company needs, kept
up to date by the employee themselves.

WHAT (decided with the founders): personal email, mobile, date of birth,
current + permanent address, blood group, marital status, and 1–2 emergency
contacts. NOT stored, by decision: bank, PAN, Aadhaar, documents — RazorpayX
Payroll already holds those (see hr_core.clean_person).

WHO SEES WHAT
  employee   their own profile — add, change or clear any field; saves at once
  HR         everyone's full profile (each view is audited)
  manager    their team's EMERGENCY CONTACTS only (for an emergency at work)
  others     nothing

Mobile lives on the employee record (`phone`, the number HR already enters);
everything else in `hr_profiles`, one document per person. Each save is
audited with the NAMES of the fields that changed (never the values), and HR
gets a short "Asha updated: mobile, address" email.

    GET /api/hrm/profile/me      PUT /api/hrm/profile/me      GET /api/hrm/profile/{emp_id}
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from audit import audit_log
from extensions import db, get_current_user
from hr_leave_core import approver_for
from hrm import _ctx, superadmin_emails

log = logging.getLogger("oakbridge.hrm.profile")
router = APIRouter(prefix="/api/hrm/profile", tags=["hrm"])

BLOOD = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
MARITAL = ("single", "married", "divorced", "widowed", "prefer_not")
RELATIONS = ("Spouse", "Parent", "Sibling", "Child", "Friend", "Relative", "Other")
FIELDS = ("personal_email", "dob", "current_address", "permanent_address", "blood_group", "marital_status", "emergency")
LABEL = {"phone": "mobile", "personal_email": "personal email", "dob": "date of birth", "current_address": "current address",
         "permanent_address": "permanent address", "blood_group": "blood group", "marital_status": "marital status",
         "emergency": "emergency contacts"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Refused(ValueError):
    pass


def _today() -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()


def clean_phone(v, what="Mobile") -> str:
    """Indian mobile: 10 digits starting 6–9, with or without +91 / 0 /
    spaces / dashes. Stored as the 10 digits. '' clears it."""
    s = re.sub(r"[\s\-()]", "", str(v or ""))
    if not s:
        return ""
    s = re.sub(r"^(\+?91|0)(?=\d{10}$)", "", s)
    if not re.fullmatch(r"[6-9]\d{9}", s):
        raise Refused(f"{what}: enter a 10-digit Indian mobile number.")
    return s


def clean_profile(raw: dict, today: date) -> dict:
    """Validate what the employee sent. Every field is optional; an empty
    value clears it. Returns the cleaned profile fields (phone separately)."""
    out: dict = {}
    t = lambda k, n=300: re.sub(r"[ \t]+", " ", str(raw.get(k) or "")).strip()[:n]  # noqa: E731
    if "personal_email" in raw:
        e = t("personal_email", 120).lower()
        if e and not EMAIL_RE.match(e):
            raise Refused("Personal email doesn't look right.")
        out["personal_email"] = e
    if "dob" in raw:
        v = t("dob", 10)
        if v:
            try:
                dob = date.fromisoformat(v)
            except ValueError:
                raise Refused("Date of birth must be a date.") from None
            age = (today - dob).days / 365.25
            if not 16 <= age <= 100:
                raise Refused("Check the date of birth (age must be 16–100).")
        out["dob"] = v
    for k in ("current_address", "permanent_address"):
        if k in raw:
            out[k] = re.sub(r"\n{3,}", "\n\n", str(raw.get(k) or "").strip())[:400]
    if "blood_group" in raw:
        b = t("blood_group", 4).upper()
        if b and b not in BLOOD:
            raise Refused("Choose a blood group from the list.")
        out["blood_group"] = b
    if "marital_status" in raw:
        m = t("marital_status", 20).lower()
        if m and m not in MARITAL:
            raise Refused("Choose a marital status from the list.")
        out["marital_status"] = m
    if "emergency" in raw:
        rows = []
        for i, c in enumerate((raw.get("emergency") or [])[:2]):
            c = c or {}
            name, rel = re.sub(r"\s+", " ", str(c.get("name") or "")).strip()[:80], str(c.get("relation") or "").strip()[:30]
            ph = str(c.get("phone") or "").strip()
            if not (name or ph):
                continue                              # an empty row = removed
            if not name or not ph:
                raise Refused(f"Emergency contact {i + 1}: add both a name and a phone number.")
            rows.append({"name": name, "relation": rel if rel in RELATIONS else ("Other" if rel else ""),
                         "phone": clean_phone(ph, f"Emergency contact {i + 1}")})
        out["emergency"] = rows
    return out


def completeness(emp: dict, prof: dict) -> int:
    """% of the profile filled in — the ring on the screen."""
    checks = [emp.get("phone"), prof.get("personal_email"), prof.get("dob"), prof.get("current_address"),
              prof.get("permanent_address"), prof.get("blood_group"), prof.get("marital_status"), prof.get("emergency")]
    return round(100 * sum(1 for c in checks if c) / len(checks))


def _view(emp: dict, prof: dict, *, full: bool) -> dict:
    v = {"emp_id": emp["id"], "name": emp.get("name", ""), "emergency": prof.get("emergency") or []}
    if full:
        v.update({k: prof.get(k) or "" for k in FIELDS if k != "emergency"}, phone=emp.get("phone") or "",
                 work={k: emp.get(k) or "" for k in ("emp_code", "designation", "department", "work_email", "joined_on", "confirmed_on")},
                 updated_at=prof.get("updated_at"), complete=completeness(emp, prof))
    return v


@router.get("/me")
async def profile_me(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="Your account isn't set up in the HRM.")
    prof = await db.hr_profiles.find_one({"emp_id": me["id"]}, {"_id": 0}) or {}
    return {**_view(me, prof, full=True), "manager_name": (people.get(approver_for(me, people)) or {}).get("name", ""),
            "options": {"blood_group": BLOOD, "marital_status": MARITAL, "relations": RELATIONS}}


class ProfileBody(BaseModel):
    phone: Optional[str] = None
    personal_email: Optional[str] = None
    dob: Optional[str] = None
    current_address: Optional[str] = None
    permanent_address: Optional[str] = None
    blood_group: Optional[str] = None
    marital_status: Optional[str] = None
    emergency: Optional[list] = None


@router.put("/me")
async def profile_save(body: ProfileBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="Your account isn't set up in the HRM.")
    raw = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        upd = clean_profile(raw, _today())
        phone = clean_phone(raw["phone"]) if "phone" in raw else None
    except Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    prof = await db.hr_profiles.find_one({"emp_id": me["id"]}, {"_id": 0}) or {}
    changed = [k for k, v in upd.items() if (prof.get(k) or ("" if k != "emergency" else [])) != v]
    if phone is not None and phone != (me.get("phone") or ""):
        changed.insert(0, "phone")
        await db.hr_employees.update_one({"id": me["id"]}, {"$set": {"phone": phone}})
    if not changed:
        return await profile_me(user)
    now = datetime.now(timezone.utc).isoformat()
    await db.hr_profiles.update_one({"emp_id": me["id"]}, {"$set": {**upd, "emp_id": me["id"], "updated_at": now,
                                                                   "updated_by": user.get("email", "")}}, upsert=True)
    names = [LABEL[k] for k in changed]
    await audit_log(db, "HRM_PROFILE_UPDATED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"person": me["id"], "fields": changed})
    try:
        import html
        from emailer import send_email
        hr = [p["work_email"] for p in people.values() if p.get("hr_access") and p.get("status") == "active"
              and p.get("work_email") and p["id"] != me["id"]] or await superadmin_emails()
        for to in dict.fromkeys(hr):
            await send_email(to=to, subject=f"Profile updated: {me.get('name')}",
                             html=f"<p style='font-family:Arial,sans-serif;color:#002B5C'>{html.escape(me.get('name', ''))} updated their "
                                  f"{html.escape(', '.join(names))}. See it in the HRM → People.</p>")
    except Exception:  # noqa: BLE001 — never blocks the save
        log.exception("hrm profile: mail failed")
    return await profile_me(user)


@router.get("/{emp_id}")
async def profile_of(emp_id: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    emp = people.get(emp_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Not found")
    is_mgr = bool(me and approver_for(emp, people) == me["id"])
    if not (acc["hr"] or is_mgr) or (me and emp_id == me["id"] and not acc["hr"]):
        raise HTTPException(status_code=404, detail="Not found")
    prof = await db.hr_profiles.find_one({"emp_id": emp_id}, {"_id": 0}) or {}
    full = bool(acc["hr"])
    if full:
        await audit_log(db, "HRM_PROFILE_VIEWED", email=user.get("email", ""), role=user.get("role", ""), meta={"person": emp_id})
    return {**_view(emp, prof, full=full), "scope": "full" if full else "emergency"}


# ------------------------------------------------------- DPDP retention ---
PURGE_AFTER_DAYS = 365        # after the Full & Final is paid


def purge_due_on(emp: dict, sep: Optional[dict]) -> Optional[str]:
    """When a leaver's PERSONAL details (this profile, mobile, photo) are
    deleted: 1 year after their Full & Final was paid. Exits recorded straight
    by HR (no F&F tracked) count from last day + 14 days (the F&F due date).
    F&F still unpaid -> not yet (None): it may still be needed to pay them.
    The WORK record (name, code, designation, dates, exit) is kept — it's an
    employment record the company must keep."""
    if emp.get("status") != "exited" or emp.get("personal_purged_at"):
        return None
    fnf = (sep or {}).get("fnf") or {}
    if fnf.get("status") == "paid" and fnf.get("paid_on"):
        start = date.fromisoformat(fnf["paid_on"][:10])
    elif fnf.get("status") == "pending":
        return None
    elif emp.get("exited_on"):
        start = date.fromisoformat(emp["exited_on"][:10]) + timedelta(days=14)
    else:
        return None
    return (start + timedelta(days=PURGE_AFTER_DAYS)).isoformat()


async def purge_leavers(today: Optional[date] = None) -> int:
    """Daily (hrm_lifecycle.daily): delete leavers' personal details once due."""
    today = today or _today()
    n = 0
    async for emp in db.hr_employees.find({"status": "exited", "personal_purged_at": None}, {"_id": 0}):
        sep = await db.hr_separations.find_one({"emp_id": emp["id"], "fnf": {"$exists": True}}, {"_id": 0}, sort=[("updated_at", -1)])
        due = purge_due_on(emp, sep)
        if not due or due > today.isoformat():
            continue
        await db.hr_profiles.delete_one({"emp_id": emp["id"]})
        if emp.get("photo_path"):
            try:
                import asyncio
                from features import delete_object
                await asyncio.to_thread(delete_object, emp["photo_path"])
            except Exception:  # noqa: BLE001 — the record is cleared either way
                log.warning("hrm profile: photo delete failed for %s", emp["id"], exc_info=True)
        await db.hr_employees.update_one({"id": emp["id"]}, {"$set": {"personal_purged_at": datetime.now(timezone.utc).isoformat()},
                                                            "$unset": {"phone": "", "photo_path": "", "photo_at": ""}})
        await audit_log(db, "HRM_PERSONAL_DATA_PURGED", email="system", role="system", meta={"person": emp["id"], "due": due})
        n += 1
    return n


async def ensure_indexes() -> None:
    try:
        await db.hr_profiles.create_index("emp_id", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("hrm profile: index creation failed", exc_info=True)
