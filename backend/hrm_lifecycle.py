"""HRM release 4 — hiring pipeline, onboarding and exit (Nov 2026).
Rules: hr_lifecycle_core.py. Candidates are the Careers applications
(db.job_applications — the same records Admin → Careers lists).

    GET  /api/hrm/hiring                          HR: all candidates; hiring manager: theirs
    POST /api/hrm/hiring                          HR: add a candidate (walk-in / referral, no CV)
    PATCH /api/hrm/hiring/{id}                    HR: stage, hiring manager, role
    POST /api/hrm/hiring/{id}/note                HR or their hiring manager
    POST /api/hrm/hiring/{id}/feedback            hiring manager (or HR): interview feedback + hire / maybe / no
    GET  /api/hrm/hiring/{id}/cv                  HR or their hiring manager
    POST /api/hrm/hiring/{id}/join                HR: Offer -> Joined: creates the employee (probation) + onboarding list
    GET  /api/hrm/people/{id}/lifecycle           HR: onboarding / exit checklists, exit details, encashment
    POST /api/hrm/people/{id}/checklist           HR: tick / untick / add an item
    POST /api/hrm/people/{id}/exit                HR: last working day + reason (+ exit checklist)
    POST /api/hrm/people/{id}/exit/cancel         HR: they're staying after all
    GET/PUT /api/hrm/lifecycle/settings           HR: the onboarding / exit checklist templates

Daily job (hrm_daily): finalise exits whose last day has passed (HRM closed,
staff role removed, later leave cancelled) and delete applications of people
not hired after RETENTION_DAYS.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import hr_core
import hr_leave_core
import hr_lifecycle_core as core
import rbac
from audit import audit_log
from extensions import db, get_current_user
from hrm import _ctx, _member, require_hr

log = logging.getLogger("oakbridge.hrm.lifecycle")
router = APIRouter(prefix="/api/hrm", tags=["hrm"])
SETTINGS_KEY = "hr_lifecycle"
CAND_FIELDS = {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "created_at": 1, "status": 1, "stage": 1,
               "hiring_manager_id": 1, "notes": 1, "feedback": 1, "stage_history": 1, "closed_at": 1, "employee_id": 1,
               "cv_url": 1, "source": 1}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return (_now() + timedelta(hours=5, minutes=30)).date()


async def _audit(user: dict, action: str, meta: dict) -> None:
    await audit_log(db, action, email=user.get("email", ""), role=user.get("role", ""), meta=meta)


async def _settings() -> dict:
    d = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
    return {"onboarding": core.clean_checklist(d.get("onboarding"), core.DEFAULT_ONBOARDING),
            "exit": core.clean_checklist(d.get("exit"), core.DEFAULT_EXIT)}


# ------------------------------------------------------------------ hiring ---
async def _candidate(cid: str, user: dict, *, hr_only: bool = False):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    c = await db.job_applications.find_one({"id": cid}, CAND_FIELDS)
    mine = bool(c and me and c.get("hiring_manager_id") == me["id"])
    if not c or not (acc["hr"] or (mine and not hr_only)):
        raise HTTPException(status_code=404, detail="Not found")
    return people, me, acc, c


def _cand_view(c: dict, people: dict) -> dict:
    v = {k: c.get(k) for k in CAND_FIELDS if k not in ("_id", "cv_url")}
    v["stage"] = core.legacy_stage(c)
    v["has_cv"] = bool(c.get("cv_url"))
    v["hiring_manager_name"] = (people.get(c.get("hiring_manager_id")) or {}).get("name", "")
    return v


@router.get("/hiring")
async def hiring_list(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    q = {} if acc["hr"] else {"hiring_manager_id": (me or {}).get("id") or "-"}
    rows = [_cand_view(c, people) async for c in db.job_applications.find(q, CAND_FIELDS).sort("created_at", -1).limit(1000)]
    return {"rows": rows, "hr": acc["hr"], "stages": core.STAGE_LABEL}


class NewCandidate(BaseModel):
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    role: Optional[str] = ""
    source: Optional[str] = "referral"


@router.post("/hiring")
async def hiring_add(body: NewCandidate, user: dict = Depends(require_hr)):
    name = (body.name or "").strip()[:120]
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    doc = {"id": str(uuid.uuid4()), "name": name, "email": (body.email or "").strip().lower()[:160], "phone": (body.phone or "").strip()[:20],
           "role": (body.role or "").strip()[:120] or "General", "cv_url": "", "status": "received", "stage": "new",
           "source": (body.source or "referral")[:40], "created_at": _now().isoformat(), "created_by": user.get("email", ""),
           # Added by HR, not through the careers form: recorded so the
           # retention rule and DPDP purpose are the same as for applicants.
           "consent": {"given": False, "source": "added by HR", "purpose": "recruitment", "at": _now().isoformat()},
           "stage_history": [{"stage": "new", "at": _now().isoformat(), "by": user.get("email", "")}]}
    await db.job_applications.insert_one(dict(doc))
    await _audit(user, "HRM_CANDIDATE_ADDED", {"candidate": doc["id"]})
    people, _, _ = await _ctx(user)
    return _cand_view(doc, people)


class CandPatch(BaseModel):
    stage: Optional[str] = None
    hiring_manager_id: Optional[str] = None
    role: Optional[str] = None


@router.patch("/hiring/{cid}")
async def hiring_edit(cid: str, body: CandPatch, user: dict = Depends(require_hr)):
    people, me, acc, c = await _candidate(cid, user, hr_only=True)
    upd: dict = {}
    push: dict = {}
    if body.stage is not None:
        try:
            core.check_move(core.legacy_stage(c), body.stage)
        except core.Refused as e:
            raise HTTPException(status_code=400, detail=str(e))
        upd["stage"] = body.stage
        if body.stage in core.CLOSED:
            upd["closed_at"] = _now().isoformat()
        push = {"stage_history": {"stage": body.stage, "at": _now().isoformat(), "by": user.get("email", "")}}
    if "hiring_manager_id" in body.model_fields_set:
        mid = body.hiring_manager_id or None
        if mid and (people.get(mid) or {}).get("status") != "active":
            raise HTTPException(status_code=400, detail="Hiring manager not found.")
        upd["hiring_manager_id"] = mid
    if body.role is not None:
        upd["role"] = body.role.strip()[:120]
    if not upd:
        return _cand_view(c, people)
    await db.job_applications.update_one({"id": cid}, {"$set": upd, **({"$push": push} if push else {})})
    await _audit(user, "HRM_CANDIDATE_UPDATED", {"candidate": cid, **{k: v for k, v in upd.items() if k != "closed_at"}})
    if upd.get("hiring_manager_id"):
        await _mail(people[upd["hiring_manager_id"]].get("work_email"), f"Candidate to interview: {c.get('name')}",
                    [f"{user.get('email', '')} added you as hiring manager for {c.get('name')} ({c.get('role') or 'role'}).",
                     "Open the HRM → Hiring to see the CV and add your feedback."])
    return _cand_view({**c, **upd}, people)


class NoteBody(BaseModel):
    text: str


@router.post("/hiring/{cid}/note")
async def hiring_note(cid: str, body: NoteBody, user: dict = Depends(get_current_user)):
    people, me, acc, c = await _candidate(cid, user)
    t = (body.text or "").strip()[:1000]
    if not t:
        raise HTTPException(status_code=400, detail="Write a note.")
    note = {"text": t, "by": user.get("email", ""), "at": _now().isoformat()}
    await db.job_applications.update_one({"id": cid}, {"$push": {"notes": note}})
    return {"ok": True, "note": note}


class FeedbackBody(BaseModel):
    recommend: str
    notes: str


@router.post("/hiring/{cid}/feedback")
async def hiring_feedback(cid: str, body: FeedbackBody, user: dict = Depends(get_current_user)):
    people, me, acc, c = await _candidate(cid, user)
    if body.recommend not in core.RECOMMEND:
        raise HTTPException(status_code=400, detail="Choose hire, maybe or no.")
    if len((body.notes or "").strip()) < 10:
        raise HTTPException(status_code=400, detail="Write a few lines of feedback (at least 10 characters).")
    fb = {"recommend": body.recommend, "notes": body.notes.strip()[:2000], "by": user.get("email", ""),
          "by_name": (me or {}).get("name", ""), "at": _now().isoformat()}
    await db.job_applications.update_one({"id": cid}, {"$push": {"feedback": fb}})
    await _audit(user, "HRM_CANDIDATE_FEEDBACK", {"candidate": cid, "recommend": body.recommend})
    if not acc["hr"]:
        hr = [p["work_email"] for p in people.values() if p.get("hr_access") and p.get("status") == "active" and p.get("work_email")]
        for to in hr:
            await _mail(to, f"Interview feedback: {c.get('name')} — {body.recommend}", [f"{fb['by_name'] or fb['by']}: {fb['notes'][:300]}"])
    return {"ok": True, "feedback": fb}


@router.get("/hiring/{cid}/cv")
async def hiring_cv(cid: str, user: dict = Depends(get_current_user)):
    people, me, acc, c = await _candidate(cid, user)
    from features import get_object, storage_path_from_url
    path = storage_path_from_url(c.get("cv_url") or "")
    if not path:
        raise HTTPException(status_code=404, detail="No CV on file.")
    data, _ = await asyncio.to_thread(get_object, path)
    await _audit(user, "HRM_CANDIDATE_CV_VIEWED", {"candidate": cid})
    safe = "".join(ch for ch in (c.get("name") or "candidate") if ch.isalnum() or ch in " -_")[:60].strip() or "candidate"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="CV - {safe}.pdf"', "Cache-Control": "private, no-store"})


class JoinBody(BaseModel):
    work_email: str
    joined_on: str
    designation: Optional[str] = ""
    department: Optional[str] = ""
    manager_id: Optional[str] = None
    emp_code: Optional[str] = ""
    location: Optional[str] = ""
    send_login: bool = True


@router.post("/hiring/{cid}/join")
async def hiring_join(cid: str, body: JoinBody, user: dict = Depends(require_hr)):
    """Offer -> Joined: the employee record (on probation; HR confirms later),
    the onboarding checklist, and — if ticked — their HRM login."""
    import hrm
    people, me, acc, c = await _candidate(cid, user, hr_only=True)
    try:
        core.can_join(core.legacy_stage(c))
        person = hr_core.clean_person({"name": c.get("name"), "work_email": body.work_email, "joined_on": body.joined_on,
                                       "designation": body.designation or c.get("role", ""), "department": body.department,
                                       "manager_id": body.manager_id, "emp_code": body.emp_code, "location": body.location,
                                       "phone": c.get("phone", "")})
    except (core.Refused, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if await db.hr_employees.find_one({"work_email": person["work_email"]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Someone with that work email is already in the HRM.")
    pid = str(uuid.uuid4())
    if person.get("manager_id") and (people.get(person["manager_id"]) or {}).get("status") != "active":
        raise HTTPException(status_code=400, detail="Reporting manager not found.")
    st = await _settings()
    acct = await db.users.find_one({"email": person["work_email"]}, {"_id": 0, "id": 1})
    doc = {**person, "id": pid, "status": "active", "hr_access": False, "confirmed_on": None, "user_id": (acct or {}).get("id"),
           "created_at": _now().isoformat(), "created_by": user.get("email", ""), "hired_from": cid,
           "onboarding": core.new_checklist(st["onboarding"])}
    await db.hr_employees.insert_one(dict(doc))
    await db.job_applications.update_one({"id": cid}, {
        "$set": {"stage": "joined", "closed_at": _now().isoformat(), "employee_id": pid},
        "$push": {"stage_history": {"stage": "joined", "at": _now().isoformat(), "by": user.get("email", "")}}})
    await _audit(user, "HRM_CANDIDATE_JOINED", {"candidate": cid, "person": pid})
    invited = None
    if body.send_login:
        try:
            invited = await hrm.hrm_invite(pid, user)
            await _tick(pid, "onboarding", "HRM login sent", True, user)
        except HTTPException as e:
            invited = {"ok": False, "error": e.detail}
    return {"ok": True, "employee_id": pid, "invited": invited}


# --------------------------------------------------------------- checklists ---
async def _tick(pid: str, kind: str, item: str, done: bool, user: dict) -> list:
    field = "onboarding" if kind == "onboarding" else "exit_checklist"
    p = await db.hr_employees.find_one({"id": pid}, {"_id": 0, field: 1})
    items = list((p or {}).get(field) or [])
    for it in items:
        if it["item"] == item:
            it.update(done=bool(done), by=user.get("email", "") if done else "", at=_now().isoformat() if done else "")
            break
    else:
        return items
    await db.hr_employees.update_one({"id": pid}, {"$set": {field: items}})
    return items


class ChecklistBody(BaseModel):
    kind: str            # onboarding | exit
    item: str
    done: Optional[bool] = None
    add: bool = False


@router.post("/people/{pid}/checklist")
async def people_checklist(pid: str, body: ChecklistBody, user: dict = Depends(require_hr)):
    if body.kind not in ("onboarding", "exit"):
        raise HTTPException(status_code=400, detail="onboarding or exit")
    field = "onboarding" if body.kind == "onboarding" else "exit_checklist"
    p = await db.hr_employees.find_one({"id": pid}, {"_id": 0, field: 1})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    item = (body.item or "").strip()[:120]
    if not item:
        raise HTTPException(status_code=400, detail="Name the item.")
    if body.add:
        items = list(p.get(field) or [])
        if any(i["item"].lower() == item.lower() for i in items):
            raise HTTPException(status_code=409, detail="Already on the list.")
        items.append({"item": item, "done": False, "by": "", "at": ""})
        await db.hr_employees.update_one({"id": pid}, {"$set": {field: items}})
    else:
        items = await _tick(pid, body.kind, item, bool(body.done), user)
    await _audit(user, "HRM_CHECKLIST", {"person": pid, "kind": body.kind, "item": item, "done": body.done, "add": body.add})
    return {"items": items}


@router.get("/people/{pid}/lifecycle")
async def people_lifecycle(pid: str, user: dict = Depends(require_hr)):
    p = await db.hr_employees.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    enc = None
    if p.get("exited_on"):
        enc = p.get("exit", {}).get("encashment")
    cand = await db.job_applications.find_one({"id": p.get("hired_from")}, {"_id": 0, "id": 1, "role": 1, "created_at": 1}) if p.get("hired_from") else None
    return {"onboarding": p.get("onboarding") or [], "exit_checklist": p.get("exit_checklist") or [], "exit": p.get("exit"),
            "exited_on": p.get("exited_on"), "encashment": enc, "hired_from": cand, "reasons": core.EXIT_REASONS}


# -------------------------------------------------------------------- exit ---
class ExitBody(BaseModel):
    last_day: str
    reason: str
    note: Optional[str] = ""


async def _el_available(emp: dict, on: date) -> float:
    reqs = await db.hr_leave.find({"emp_id": emp["id"]}, {"_id": 0}).to_list(5000)
    adjs = await db.hr_leave_adjust.find({"emp_id": emp["id"]}, {"_id": 0}).to_list(5000)
    return hr_leave_core.el_balance(emp, hr_core.fiscal_year(on), on, reqs, adjs)["available"]


@router.post("/people/{pid}/exit")
async def people_exit(pid: str, body: ExitBody, user: dict = Depends(require_hr)):
    p = await db.hr_employees.find_one({"id": pid}, {"_id": 0})
    if not p or p.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not found (or already left).")
    if body.reason not in core.EXIT_REASONS:
        raise HTTPException(status_code=400, detail="Choose a reason.")
    try:
        last = date.fromisoformat(body.last_day[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Last working day must be a date.")
    if p.get("joined_on") and last < date.fromisoformat(p["joined_on"][:10]):
        raise HTTPException(status_code=400, detail="That's before they joined.")
    if last < _today() - timedelta(days=60):
        raise HTTPException(status_code=400, detail="Last day more than 60 days ago — check the date.")
    ex, cancelled = await record_exit(p, last, body.reason, body.note or "", user)
    return {"ok": True, "exit": ex, "leave_cancelled": cancelled}


async def record_exit(p: dict, last: date, reason: str, note: str, user: dict, extra: Optional[dict] = None) -> tuple[dict, int]:
    """The one way an exit is recorded — HR's "Record exit", an accepted
    resignation and a termination (hrm_separation.py) all come here, so the
    guards, checklist, EL encashment and leave clean-up are identical."""
    me_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "id": 1})
    if p.get("user_id") and me_user and p["user_id"] == me_user["id"]:
        raise HTTPException(status_code=400, detail="You can't record your own exit — ask another HR person or a super admin.")
    if p.get("hr_access"):
        import hrm
        if await hrm.hr_left_without(await hrm._people(), p["id"]):
            raise HTTPException(status_code=409, detail="They're the last person with HR access — give someone else HR access first.")
    st = await _settings()
    enc = core.encashment(p, last, await _el_available(p, last))
    ex = {"last_day": last.isoformat(), "reason": reason, "reason_label": core.EXIT_REASONS[reason],
          "note": (note or "").strip()[:1000], "by": user.get("email", ""), "at": _now().isoformat(), "encashment": enc, **(extra or {})}
    upd = {"exited_on": last.isoformat(), "exit": ex}
    if not p.get("exit_checklist"):
        upd["exit_checklist"] = core.new_checklist(st["exit"])
    await db.hr_employees.update_one({"id": p["id"]}, {"$set": upd})
    cancelled = await _cancel_leave_after(p["id"], last, user.get("email", ""))
    await _audit(user, "HRM_EXIT_RECORDED", {"person": p["id"], "last_day": last.isoformat(), "reason": reason,
                                             "encash_days": enc["days"], "leave_cancelled": cancelled})
    if last < _today():
        await finalize_exits()
    return ex, cancelled


@router.post("/people/{pid}/exit/cancel")
async def people_exit_cancel(pid: str, user: dict = Depends(require_hr)):
    p = await db.hr_employees.find_one({"id": pid}, {"_id": 0})
    if not p or not p.get("exited_on"):
        raise HTTPException(status_code=404, detail="No exit recorded.")
    if p.get("status") == "exited":
        raise HTTPException(status_code=409, detail="Their last day has passed and the exit is final — re-add them if they rejoin.")
    await db.hr_employees.update_one({"id": pid}, {"$unset": {"exited_on": "", "exit": ""}})
    await _audit(user, "HRM_EXIT_CANCELLED", {"person": pid})
    return {"ok": True}


async def _cancel_leave_after(pid: str, last: date, by: str) -> int:
    n = 0
    async for r in db.hr_leave.find({"emp_id": pid, "status": {"$in": ["pending", "approved"]}, "start": {"$gt": last.isoformat()}},
                                     {"_id": 0, "id": 1}):
        await db.hr_leave.update_one({"id": r["id"]}, {"$set": {"status": "cancelled", "cancelled_at": _now().isoformat(),
                                                                "cancelled_by": f"{by} (exit)"}})
        n += 1
    return n


# ---------------------------------------------------------------- daily job ---
async def finalize_exits(today: Optional[date] = None) -> int:
    """Last day passed -> status exited; a staff role on their account (admin,
    warehouse…) becomes an ordinary customer account so admin / warehouse
    screens close too. Never demotes the last remaining super admin (an alert
    is raised instead — someone must keep the keys)."""
    today = today or _today()
    n = 0
    async for p in db.hr_employees.find({"status": "active", "exited_on": {"$lt": today.isoformat()}}, {"_id": 0}):
        await db.hr_employees.update_one({"id": p["id"], "status": "active"}, {"$set": {"status": "exited", "exit_finalized_at": _now().isoformat()}})
        n += 1
        acct = await db.users.find_one({"id": p.get("user_id")}, {"_id": 0, "id": 1, "role": 1, "email": 1}) if p.get("user_id") else None
        if acct and acct.get("role") in rbac.ADMIN_ROLES:
            if rbac.is_superadmin(acct["role"]):
                others = await db.users.count_documents({"role": {"$in": list(rbac.SUPERADMIN_ROLES)}, "id": {"$ne": acct["id"]}})
                if not others:
                    log.error("hrm: %s left but is the only super admin — role NOT removed", acct["email"])
                    try:
                        from marketing import raise_alert
                        await raise_alert("hrm", f"{acct['email']} has left but is the only super admin — make someone else super admin, then remove their access.", key=f"hrm-last-super:{acct['id']}")
                    except Exception:  # noqa: BLE001
                        pass
                    continue
            await db.users.update_one({"id": acct["id"]}, {"$set": {"role": "customer", "staff_role_before_exit": acct["role"]},
                                                             "$unset": {"sections": ""}})
            await audit_log(db, "HRM_EXIT_ACCESS_REMOVED", email="system", role="system",
                            meta={"person": p["id"], "account": acct["email"], "role_before": acct["role"]})
    return n


async def purge_old_applications(today: Optional[date] = None) -> int:
    """DPDP: applications of people not hired are deleted RETENTION_DAYS after
    they were turned down / withdrew — the record and the CV file."""
    from features import delete_object, storage_path_from_url
    today = today or _today()
    n = 0
    async for c in db.job_applications.find({"stage": {"$in": ["rejected", "withdrawn"]}}, {"_id": 0, "id": 1, "stage": 1, "closed_at": 1, "cv_url": 1}):
        if core.purge_due(c, today):
            path = storage_path_from_url(c.get("cv_url") or "")
            if path:
                await asyncio.to_thread(delete_object, path)
            await db.job_applications.delete_one({"id": c["id"]})
            n += 1
    if n:
        await audit_log(db, "HRM_APPLICATIONS_PURGED", email="system", role="system", meta={"count": n, "after_days": core.RETENTION_DAYS})
    return n


async def daily() -> dict:
    # Appraisals: on the effective date the new designation lands on the
    # employee record (hrm_appraisal.apply_due — idempotent via applied_at).
    from hrm_appraisal import apply_due
    from hrm_separation import fnf_reminders
    from hrm_recognition import congrats_digest
    from hrm_profile import purge_leavers
    return {"exits": await finalize_exits(), "purged": await purge_old_applications(), "appraisals": await apply_due(),
            "fnf_reminded": await fnf_reminders(), "congrats_emails": await congrats_digest(), "personal_purged": await purge_leavers()}


try:
    import jobs as _jobs

    @_jobs.handler("hrm_daily")
    async def _job(p: dict) -> None:
        await daily()
except Exception:  # noqa: BLE001
    pass


# --------------------------------------------------------------- settings ---
@router.get("/lifecycle/settings")
async def lifecycle_settings(user: dict = Depends(require_hr)):
    return await _settings()


class LifecycleSettings(BaseModel):
    onboarding: list
    exit: list


@router.put("/lifecycle/settings")
async def lifecycle_put_settings(body: LifecycleSettings, user: dict = Depends(require_hr)):
    out = {"onboarding": core.clean_checklist(body.onboarding, core.DEFAULT_ONBOARDING),
           "exit": core.clean_checklist(body.exit, core.DEFAULT_EXIT)}
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, **out}}, upsert=True)
    await _audit(user, "HRM_LIFECYCLE_SETTINGS", {"onboarding": len(out["onboarding"]), "exit": len(out["exit"])})
    return out


async def _mail(to: Optional[str], subject: str, lines: list) -> None:
    if not to:
        return
    try:
        import html
        import os
        from emailer import send_email
        site = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")
        body = "".join(f"<p style='margin:0 0 10px;font-size:15px;line-height:1.5'>{html.escape(x)}</p>" for x in lines if x)
        await send_email(to=to, subject=subject, html=f"<div style='font-family:Arial,sans-serif;color:#002B5C;max-width:560px'>{body}"
                         f"<p><a href='{site}/hrm' style='background:#002B5C;color:#fff;padding:10px 20px;text-decoration:none'>Open the HRM</a></p></div>")
    except Exception:  # noqa: BLE001
        log.exception("hrm lifecycle: mail failed")
