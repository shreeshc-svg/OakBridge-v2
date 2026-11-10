"""HRM release 3 — annual goals, quarterly check-ins, year-end rating (Nov 2026).
Rules: hr_goals_core.py. Access: hr_core.access_of (employee: self, manager:
team, HR: all). The approver is the reporting manager (HR if none) — the same
rule as leave (hr_leave_core.approver_for).

    GET  /api/hrm/goals/plan?emp_id=&fy=          the plan (+ what the caller may do)
    PUT  /api/hrm/goals/plan                      owner saves a draft
    POST /api/hrm/goals/plan/submit               owner submits for approval
    POST /api/hrm/goals/plan/{id}/decide          approver: approve (may edit) / return with a note
    POST /api/hrm/goals/plan/{id}/reopen          owner or approver: unlock for changes (re-approval needed)
    POST /api/hrm/goals/plan/{id}/checkin         owner: quarter self check-in (progress % + note)
    POST /api/hrm/goals/plan/{id}/review          approver: quarter review (status per goal + comment)
    POST /api/hrm/goals/plan/{id}/rating          approver: year-end rating 1–5 + summary
    GET  /api/hrm/goals/team?fy=                  manager: team; HR: everyone — status at a glance
    POST /api/hrm/goals/release                   HR: show this year's ratings to employees

Ratings are never sent to the employee before release (hr_goals_core.view_for).
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import hr_core
import hr_goals_core as core
from audit import audit_log
from extensions import db, get_current_user
from hr_leave_core import approver_for
from hrm import _ctx, _member, require_hr

log = logging.getLogger("oakbridge.hrm.goals")
router = APIRouter(prefix="/api/hrm/goals", tags=["hrm"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return (_now() + timedelta(hours=5, minutes=30)).date()


async def _released(fy: str) -> bool:
    return bool(await db.hr_goal_release.find_one({"fy": fy}, {"_id": 1}))


async def _mail(to: str, subject: str, lines: list) -> None:
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
        log.exception("hrm goals: mail failed")


async def _approvers(emp: dict, people: dict) -> list:
    """_approver_email, falling back to the site's super admins if empty."""
    out = [t for t in _approver_email(emp, people) if t]
    if not out:
        from hrm import superadmin_emails
        out = await superadmin_emails()
    return out


def _approver_email(emp: dict, people: dict) -> list:
    a = approver_for(emp, people)
    if a:
        return [people[a].get("work_email")]
    return [p["work_email"] for p in people.values() if p.get("hr_access") and p.get("status") == "active" and p["id"] != emp["id"]]


async def _load(pid_or_plan: str, user: dict, *, plan_id: bool = True):
    """(people, me, acc, plan, emp, is_owner, can_decide) for a plan id."""
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    plan = await db.hr_goals.find_one({"id": pid_or_plan}, {"_id": 0})
    if not plan or not hr_core.can_see(acc, plan["emp_id"]):
        raise HTTPException(status_code=404, detail="Not found")
    emp = people.get(plan["emp_id"]) or {}
    owner = bool(me and me["id"] == plan["emp_id"])
    decide = not owner and (acc["hr"] or (me and approver_for(emp, people) == me["id"]))
    return people, me, acc, plan, emp, owner, bool(decide)


async def _save(plan: dict, upd: dict, user: dict, what: str, expect_status: Optional[str] = None) -> dict:
    q = {"id": plan["id"]}
    if expect_status:
        q["status"] = expect_status
    step = {"at": _now().isoformat(), "by": user.get("email", ""), "what": what}
    res = await db.hr_goals.update_one(q, {"$set": {**upd, "updated_at": step["at"]}, "$push": {"history": step}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="This changed a moment ago — refresh and try again.")
    await audit_log(db, f"HRM_GOALS_{what.upper().replace(' ', '_')}", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"plan": plan["id"], "person": plan["emp_id"], "fy": plan["fy"]})
    return await db.hr_goals.find_one({"id": plan["id"]}, {"_id": 0})


def _out(plan: dict, owner: bool, decide: bool, released: bool, today: date) -> dict:
    return {**core.view_for(plan, is_owner=owner, released=released), "can": {
        "edit": owner and plan["status"] in ("draft", "returned"),
        "submit": owner and plan["status"] in ("draft", "returned"),
        "decide": decide and plan["status"] == "submitted",
        "reopen": (owner or decide) and plan["status"] == "approved",
        "checkin": owner and plan["status"] == "approved",
        "review": decide and plan["status"] == "approved",
        "rate": decide and plan["status"] == "approved" and core.rating_open(plan["fy"], today),
    }, "open_quarters": core.open_quarters(plan["fy"], today), "rating_open": core.rating_open(plan["fy"], today),
        "released": released}


# ------------------------------------------------------------------- plan ---
@router.get("/plan")
async def goals_plan(emp_id: Optional[str] = None, fy: Optional[str] = None, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    pid = emp_id or (me or {}).get("id")
    if not pid or pid not in people or not hr_core.can_see(acc, pid):
        raise HTTPException(status_code=404, detail="Not found")
    fy = fy or hr_core.fiscal_year(_today())
    try:
        hr_core.fy_bounds(fy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    plan = await db.hr_goals.find_one({"emp_id": pid, "fy": fy}, {"_id": 0})
    owner = bool(me and me["id"] == pid)
    if not plan:
        plan = {"id": None, "emp_id": pid, "fy": fy, "status": "draft", "goals": [], "checkins": {}, "year_end": None, "history": []}
    decide = not owner and (acc["hr"] or (me and approver_for(people[pid], people) == me["id"]))
    return {**_out(plan, owner, bool(decide), await _released(fy), _today()), "name": people[pid].get("name", ""),
            "quarters": {q: [d.isoformat() for d in core.quarter_bounds(fy, q)] for q in core.QUARTERS},
            "ratings": core.RATINGS}


class DraftBody(BaseModel):
    fy: Optional[str] = None
    goals: list


@router.put("/plan")
async def goals_save_draft(body: DraftBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=403, detail="Only employees have goals.")
    fy = body.fy or hr_core.fiscal_year(_today())
    try:
        hr_core.fy_bounds(fy)
        goals = core.clean_goals(body.goals, strict=False)
    except (ValueError, core.Refused) as e:
        raise HTTPException(status_code=400, detail=str(e))
    plan = await db.hr_goals.find_one({"emp_id": me["id"], "fy": fy}, {"_id": 0})
    if plan and plan["status"] not in ("draft", "returned"):
        raise HTTPException(status_code=409, detail="These goals are submitted or approved — reopen them to change.")
    if not plan:
        plan = {"id": str(uuid.uuid4()), "emp_id": me["id"], "fy": fy, "status": "draft", "goals": goals, "checkins": {},
                "year_end": None, "history": [{"at": _now().isoformat(), "by": user.get("email", ""), "what": "created"}],
                "created_at": _now().isoformat()}
        try:
            await db.hr_goals.insert_one(dict(plan))
        except Exception:  # noqa: BLE001 — unique (emp_id, fy): a second tab created it first
            raise HTTPException(status_code=409, detail="Refresh — your goals for this year already exist.")
        return _out(plan, True, False, await _released(fy), _today())
    saved = await _save(plan, {"goals": goals}, user, "draft saved", expect_status=plan["status"])
    return _out(saved, True, False, await _released(fy), _today())


class SubmitBody(BaseModel):
    fy: Optional[str] = None


@router.post("/plan/submit")
async def goals_submit(body: SubmitBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    fy = body.fy or hr_core.fiscal_year(_today())
    plan = await db.hr_goals.find_one({"emp_id": (me or {}).get("id"), "fy": fy}, {"_id": 0}) if me else None
    if not plan:
        raise HTTPException(status_code=404, detail="Save your goals first.")
    if plan["status"] not in ("draft", "returned"):
        raise HTTPException(status_code=409, detail="Already submitted.")
    try:
        core.clean_goals(plan["goals"], strict=True)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    saved = await _save(plan, {"status": "submitted", "submitted_at": _now().isoformat()}, user, "submitted", plan["status"])
    for to in await _approvers(me, people):
        await _mail(to, f"Goals to approve: {me['name']} ({fy})", [f"{me['name']} has submitted {len(plan['goals'])} goals for {fy}."])
    return _out(saved, True, False, await _released(fy), _today())


class DecideBody(BaseModel):
    approve: bool
    note: Optional[str] = ""
    goals: Optional[list] = None       # approver's edits, applied when approving


@router.post("/plan/{plan_id}/decide")
async def goals_decide(plan_id: str, body: DecideBody, user: dict = Depends(get_current_user)):
    people, me, acc, plan, emp, owner, decide = await _load(plan_id, user)
    if not decide or plan["status"] != "submitted":
        raise HTTPException(status_code=404, detail="Nothing waiting for you here.")
    note = (body.note or "").strip()[:core.TEXT]
    if body.approve:
        try:
            goals = core.clean_goals(body.goals if body.goals is not None else plan["goals"], strict=True)
        except core.Refused as e:
            raise HTTPException(status_code=400, detail=str(e))
        upd = {"status": "approved", "goals": goals, "approved_at": _now().isoformat(), "approved_by": user.get("email", ""),
               "decision_note": note}
    else:
        if len(note) < 5:
            raise HTTPException(status_code=400, detail="Say what to change (at least 5 characters).")
        upd = {"status": "returned", "decision_note": note}
    saved = await _save(plan, upd, user, "approved" if body.approve else "returned", "submitted")
    await _mail(emp.get("work_email"), f"Your {plan['fy']} goals were {'approved' if body.approve else 'returned'}",
                [f"Your goals for {plan['fy']} were {'approved' if body.approve else 'sent back for changes'} by {user.get('email', '')}.",
                 f"Note: {note}" if note else ""])
    return _out(saved, owner, decide, await _released(plan["fy"]), _today())


@router.post("/plan/{plan_id}/reopen")
async def goals_reopen(plan_id: str, user: dict = Depends(get_current_user)):
    people, me, acc, plan, emp, owner, decide = await _load(plan_id, user)
    if not (owner or decide) or plan["status"] != "approved":
        raise HTTPException(status_code=400, detail="Only approved goals can be reopened.")
    saved = await _save(plan, {"status": "draft"}, user, "reopened", "approved")
    if owner:
        for to in await _approvers(emp, people):
            await _mail(to, f"Goals reopened: {emp.get('name')} ({plan['fy']})", [f"{emp.get('name')} reopened their goals to change them; they'll need your approval again."])
    else:
        await _mail(emp.get("work_email"), f"Your {plan['fy']} goals were reopened", [f"{user.get('email', '')} reopened your goals for changes. Update and submit them again."])
    return _out(saved, owner, decide, await _released(plan["fy"]), _today())


class CheckinBody(BaseModel):
    q: str
    progress: dict
    note: Optional[str] = ""


@router.post("/plan/{plan_id}/checkin")
async def goals_checkin(plan_id: str, body: CheckinBody, user: dict = Depends(get_current_user)):
    people, me, acc, plan, emp, owner, decide = await _load(plan_id, user)
    if not owner or plan["status"] != "approved":
        raise HTTPException(status_code=403, detail="Check-ins are by the employee, on approved goals.")
    if body.q not in core.open_quarters(plan["fy"], _today()):
        raise HTTPException(status_code=400, detail=f"{body.q} isn't open for check-in now.")
    if ((plan.get("checkins") or {}).get(body.q) or {}).get("review"):
        raise HTTPException(status_code=409, detail="Your manager has already reviewed this quarter.")
    try:
        prog = core.clean_progress(plan["goals"], body.progress)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    entry = {"progress": prog, "note": (body.note or "").strip()[:1000], "at": _now().isoformat(), "by": user.get("email", "")}
    ck = {**(plan.get("checkins") or {})}
    ck[body.q] = {**(ck.get(body.q) or {}), "self": entry}
    saved = await _save(plan, {"checkins": ck}, user, f"checkin {body.q}", "approved")
    for to in await _approvers(emp, people):
        await _mail(to, f"Check-in to review: {emp.get('name')} — {body.q} {plan['fy']}",
                    [f"{emp.get('name')} checked in for {body.q}: overall {core.overall(plan['goals'], prog)}%."])
    return _out(saved, owner, decide, await _released(plan["fy"]), _today())


class ReviewBody(BaseModel):
    q: str
    status: dict
    comment: str


@router.post("/plan/{plan_id}/review")
async def goals_review(plan_id: str, body: ReviewBody, user: dict = Depends(get_current_user)):
    people, me, acc, plan, emp, owner, decide = await _load(plan_id, user)
    if not decide or plan["status"] != "approved":
        raise HTTPException(status_code=403, detail="Reviews are by the reporting manager or HR.")
    if body.q not in core.QUARTERS:
        raise HTTPException(status_code=400, detail="Unknown quarter.")
    if body.q not in core.open_quarters(plan["fy"], _today()) and not acc["hr"]:
        raise HTTPException(status_code=400, detail=f"{body.q} is closed — HR can still add a late review.")
    try:
        st = core.clean_status(plan["goals"], body.status)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    if len((body.comment or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="Add a comment (at least 5 characters).")
    entry = {"status": st, "comment": body.comment.strip()[:1000], "at": _now().isoformat(), "by": user.get("email", "")}
    ck = {**(plan.get("checkins") or {})}
    ck[body.q] = {**(ck.get(body.q) or {}), "review": entry}
    saved = await _save(plan, {"checkins": ck}, user, f"review {body.q}", "approved")
    await _mail(emp.get("work_email"), f"Your {body.q} goals review", [f"{user.get('email', '')} reviewed your {body.q} check-in.", entry["comment"]])
    return _out(saved, owner, decide, await _released(plan["fy"]), _today())


class RatingBody(BaseModel):
    rating: int
    summary: str


@router.post("/plan/{plan_id}/rating")
async def goals_rating(plan_id: str, body: RatingBody, user: dict = Depends(get_current_user)):
    people, me, acc, plan, emp, owner, decide = await _load(plan_id, user)
    if not decide or plan["status"] != "approved":
        raise HTTPException(status_code=403, detail="Ratings are by the reporting manager or HR.")
    if not core.rating_open(plan["fy"], _today()) and not acc["hr"]:
        raise HTTPException(status_code=400, detail="Year-end ratings open in mid-February.")
    if body.rating not in core.RATINGS:
        raise HTTPException(status_code=400, detail="Rate 1–5.")
    if len((body.summary or "").strip()) < 20:
        raise HTTPException(status_code=400, detail="Write a short summary (at least 20 characters).")
    entry = {"rating": body.rating, "label": core.RATINGS[body.rating], "summary": body.summary.strip()[:3000],
             "at": _now().isoformat(), "by": user.get("email", "")}
    saved = await _save(plan, {"year_end": entry}, user, "rated", "approved")
    return _out(saved, owner, decide, await _released(plan["fy"]), _today())


# ------------------------------------------------------------------- team ---
@router.get("/team")
async def goals_team(fy: Optional[str] = None, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not (acc["hr"] or acc["manager"]):
        raise HTTPException(status_code=403, detail="For managers and HR.")
    fy = fy or hr_core.fiscal_year(_today())
    plans = {p["emp_id"]: p async for p in db.hr_goals.find({"fy": fy}, {"_id": 0})}
    rows = []
    for pid, p in people.items():
        if p.get("status") != "active" or not hr_core.can_see(acc, pid) or (me and pid == me["id"]):
            continue
        plan = plans.get(pid) or {}
        ck = plan.get("checkins") or {}
        rows.append({"emp_id": pid, "name": p.get("name"), "emp_code": p.get("emp_code", ""), "department": p.get("department", ""),
                     "plan_id": plan.get("id"), "status": plan.get("status") or "not started",
                     "goals": len(plan.get("goals") or []), "overall": core.overall(plan.get("goals") or [], core.latest_progress(plan)) if plan else None,
                     "quarters": {q: ("reviewed" if (ck.get(q) or {}).get("review") else "checked in" if (ck.get(q) or {}).get("self") else "")
                                  for q in core.QUARTERS},
                     "rating": (plan.get("year_end") or {}).get("rating") if acc["hr"] or approver_for(p, people) == (me or {}).get("id") else None,
                     "waiting_for_me": bool(plan) and (acc["hr"] or approver_for(p, people) == (me or {}).get("id"))
                     and (plan.get("status") == "submitted" or any((ck.get(q) or {}).get("self") and not (ck.get(q) or {}).get("review")
                                                                    for q in core.QUARTERS))})
    rows.sort(key=lambda r: (not r["waiting_for_me"], r["name"] or ""))
    return {"fy": fy, "rows": rows, "released": await _released(fy)}


class ReleaseBody(BaseModel):
    fy: str


@router.post("/release")
async def goals_release(body: ReleaseBody, user: dict = Depends(require_hr)):
    try:
        hr_core.fy_bounds(body.fy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.hr_goal_release.update_one({"fy": body.fy}, {"$set": {"fy": body.fy, "at": _now().isoformat(), "by": user.get("email", "")}}, upsert=True)
    await audit_log(db, "HRM_GOALS_RATINGS_RELEASED", email=user.get("email", ""), role=user.get("role", ""), meta={"fy": body.fy})
    return {"ok": True}


# -------------------------------------------------------------- reminders ---
async def quarterly_reminders(today: Optional[date] = None) -> int:
    """First working week after a quarter ends: remind everyone with approved
    goals to check in; in April, also remind people without goals to set
    them. Called daily from the worker tick; sends once per quarter (key)."""
    today = today or _today()
    if today.day > 3 or today.month not in (4, 7, 10, 1):
        return 0
    key = f"{today.year}-{today.month:02d}"
    if await db.hr_goal_reminders.find_one({"key": key}, {"_id": 1}):
        return 0
    await db.hr_goal_reminders.insert_one({"key": key, "at": _now().isoformat()})
    prev = today - timedelta(days=5)
    fy, q = hr_core.fiscal_year(prev), core.QUARTERS[((prev.month - 4) % 12) // 3]
    sent = 0
    async for p in db.hr_employees.find({"status": "active"}, {"_id": 0}):
        plan = await db.hr_goals.find_one({"emp_id": p["id"], "fy": fy}, {"_id": 0, "status": 1, "checkins": 1})
        if plan and plan.get("status") == "approved" and not ((plan.get("checkins") or {}).get(q) or {}).get("self"):
            await _mail(p.get("work_email"), f"Time for your {q} goals check-in", [f"{q} of {fy} has ended — update your progress in the HRM within 30 days."])
            sent += 1
        if today.month == 4:
            new_fy = hr_core.fiscal_year(today)
            if not await db.hr_goals.find_one({"emp_id": p["id"], "fy": new_fy}, {"_id": 1}):
                await _mail(p.get("work_email"), f"Set your goals for {new_fy}", ["The new year has started — draft your goals in the HRM and submit them to your manager."])
                sent += 1
    return sent


def schedule_tick() -> None:
    from marketing import dispatch
    n = _now() + timedelta(hours=5, minutes=30)
    dispatch("hrm_goal_reminders", dedupe=n.strftime("%Y%m%d"))


try:
    import jobs as _jobs

    @_jobs.handler("hrm_goal_reminders")
    async def _job(p: dict) -> None:
        await quarterly_reminders()
except Exception:  # noqa: BLE001 — tests import without the job system
    pass


async def ensure_indexes() -> None:
    try:
        await db.hr_goals.create_index("id", unique=True)
        await db.hr_goals.create_index([("emp_id", 1), ("fy", 1)], unique=True)
        await db.hr_goal_release.create_index("fy", unique=True)
        await db.hr_goal_reminders.create_index("key", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("hrm goals: index creation failed", exc_info=True)
