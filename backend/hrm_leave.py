"""HRM release 2 — leave (Nov 2026). Rules: hr_leave_core.py. Access: the same
hr_core.access_of as release 1 (employee: self, manager: team, HR: all).

    GET  /api/hrm/leave/summary?emp_id=&fy=         balances + requests (self / team / all)
    POST /api/hrm/leave/requests                    apply (HR may apply on someone's behalf)
    POST /api/hrm/leave/requests/{id}/cancel        withdraw (own pending or future; HR any)
    GET  /api/hrm/leave/approvals                   what is waiting for ME
    POST /api/hrm/leave/requests/{id}/decide        approve / reject (manager, then HR when needed)
    GET  /api/hrm/leave/team?start=&end=            who is off (manager: team, HR: all)
    GET/POST /api/hrm/leave/adjustments             HR: opening balances and corrections
    GET  /api/hrm/leave/export.csv?month=2026-11    HR: loss-of-pay days + joiners for RazorpayX Payroll

APPROVAL: the reporting manager decides first ("stage: manager"). Requests the
policy sends to HR as well (loss of pay beyond 10 days a year, maternity,
bereavement over 3 days) then go to "stage: hr". No active manager -> HR.
Nobody approves their own leave. Every step is in the audit log and emailed.
"""
from __future__ import annotations

import html
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import hr_core
import hr_leave_core as core
from audit import audit_log
from extensions import db, get_current_user
from hrm import _ctx, _member, get_settings, require_hr, require_superadmin_hrm

log = logging.getLogger("oakbridge.hrm.leave")
router = APIRouter(prefix="/api/hrm/leave", tags=["hrm"])
LABEL = {**{k: v["label"] for k, v in core.TYPES.items()}, "COMP_EARN": "Comp-off (worked a day off)"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    # India's date: someone applying at 1 am IST must not be a day behind.
    return (_now() + timedelta(hours=5, minutes=30)).date()


async def _calendar(fy: str, emp: Optional[dict] = None) -> tuple[list, list, dict]:
    """(days off, optional holidays, weekly off) for THIS person: company
    holidays + special days off that apply to them, and their own weekly off
    if a super admin set one (hr_core.days_off_for / weekly_off_for)."""
    doc = await db.hr_holidays.find_one({"fy": fy}, {"_id": 0}) or {}
    rows = doc.get("rows") or []
    st = await get_settings()
    return (hr_core.days_off_for(rows, emp), [r["date"] for r in rows if r["kind"] == "optional"],
            hr_core.weekly_off_for(emp, st["weekly_off"]))


async def _all_requests(emp_id: Optional[str] = None) -> list:
    q = {"emp_id": emp_id} if emp_id else {}
    return await db.hr_leave.find(q, {"_id": 0}).to_list(20000)


async def _adjustments(emp_id: Optional[str] = None) -> list:
    q = {"emp_id": emp_id} if emp_id else {}
    return await db.hr_leave_adjust.find(q, {"_id": 0}).to_list(20000)


async def _mail(to: str, subject: str, lines: list, link: str = "") -> None:
    if not to:
        return
    try:
        from emailer import send_email
        site = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")
        body = "".join(f"<p style='margin:0 0 10px;font-size:15px;line-height:1.5'>{html.escape(x)}</p>" for x in lines if x)
        btn = f"<p><a href='{site}/hrm' style='background:#002B5C;color:#fff;padding:10px 20px;text-decoration:none'>{html.escape(link or 'Open the HRM')}</a></p>"
        await send_email(to=to, subject=subject, html=f"<div style='font-family:Arial,sans-serif;color:#002B5C;max-width:560px'>{body}{btn}</div>")
    except Exception:  # noqa: BLE001 — a mail failure never blocks the leave itself
        log.exception("hrm leave: mail failed")


def _hr_emails(people: dict, skip: str = "") -> list:
    """Everyone with HR / founder access (active), except `skip` (the person
    whose leave it is — HR never gets mailed to approve their own leave)."""
    return [p["work_email"] for p in people.values()
            if p.get("hr_access") and p.get("status") == "active" and p.get("work_email") and p["id"] != skip]


async def _mail_many(tos: list, subject: str, lines: list, link: str = "") -> None:
    tos = [t for t in tos if t]
    if not tos:
        # Nobody with HR access to tell (e.g. the only HR person is the one on
        # leave): the site's super admins get it instead of nobody.
        from hrm import superadmin_emails
        tos = await superadmin_emails()
    for to in dict.fromkeys(tos):
        await _mail(to, subject, lines, link)


def _span(r: dict) -> str:
    s, e = core.d(r["start"]), core.d(r["end"])
    f = lambda x: x.strftime("%d %b %Y")  # noqa: E731
    return f(s) if s == e else f"{f(s)} – {f(e)}"


# ---------------------------------------------------------------- summary ---
@router.get("/summary")
async def leave_summary(emp_id: Optional[str] = None, fy: Optional[str] = None, user: dict = Depends(get_current_user)):
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
    reqs, adjs = await _all_requests(pid), await _adjustments(pid)
    emp = people[pid]
    _, optional, _ = await _calendar(fy)
    rows = sorted((r for r in reqs if hr_core.fiscal_year(core.d(r["start"])) == fy or r["status"] == "pending"),
                  key=lambda r: r["start"], reverse=True)
    st = await get_settings()
    return {"emp": {"id": pid, "name": emp.get("name"), "confirmed_on": emp.get("confirmed_on"), "gender": emp.get("gender"),
                    "weekly_off": hr_core.weekly_off_for(emp, st["weekly_off"]), "own_weekly_off": bool(emp.get("weekly_off"))},
            "fy": fy, "balances": core.balances(emp, fy, _today(), reqs, adjs), "requests": rows,
            "optional_days": optional, "types": {k: v["label"] for k, v in core.TYPES.items()},
            "comp_credits": [{"worked_on": c["worked_on"].isoformat(), "expires": c["expires"].isoformat()}
                             for c in core.comp_available(reqs, pid, _today())]}


# ------------------------------------------------------------------ apply ---
class LeaveBody(BaseModel):
    type: str
    start: Optional[str] = None
    end: Optional[str] = None
    reason: Optional[str] = ""
    child_birth: Optional[str] = None
    expected_delivery: Optional[str] = None
    worked_on: Optional[str] = None
    emp_id: Optional[str] = None      # HR applying on someone's behalf
    preview: bool = False             # check only: "this will use 3 days (2 left after)" — nothing saved


@router.post("/requests")
async def leave_apply(body: LeaveBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    pid = body.emp_id or (me or {}).get("id")
    if not pid or pid not in people:
        raise HTTPException(status_code=404, detail="Not found")
    if pid != (me or {}).get("id") and not acc["hr"]:
        raise HTTPException(status_code=403, detail="Only HR can apply on someone else's behalf.")
    emp = people[pid]
    if emp.get("status") != "active":
        raise HTTPException(status_code=400, detail="This person has left.")
    last = emp.get("exited_on")
    if last and (body.end or body.start or body.worked_on or "") > last:
        raise HTTPException(status_code=400, detail=f"That's after their last working day ({last}).")
    start = body.worked_on if body.type == "COMP_EARN" else body.start
    if not start:
        raise HTTPException(status_code=400, detail="Choose the date(s).")
    try:
        fy = hr_core.fiscal_year(core.d(start))
        national, optional, weekly = await _calendar(fy, emp)
        req = {"type": body.type, "start": start, "end": body.end or start, "reason": (body.reason or "").strip()[:500],
               "child_birth": body.child_birth, "expected_delivery": body.expected_delivery, "worked_on": body.worked_on}
        st = await db.integrations.find_one({"key": "hr_settings"}, {"_id": 0, "mat_min_days": 1}) or {}
        res = core.check_request(emp, req, _today(), await _all_requests(pid), await _adjustments(pid),
                                 holidays=national, optional_days=optional, weekly_off=weekly,
                                 mat_min_days=int(st.get("mat_min_days") or core.DEFAULT_MAT_MIN_DAYS))
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be valid.")
    approver = core.approver_for(emp, people)
    if body.preview:
        # The same checks as a real request, so what the form promises is what
        # applying will do. Balance "left after" for the types that have one.
        left = None
        if body.type in ("CL", "SL", "EL", "OPT", "COMP"):
            b = core.balances(emp, fy, _today(), await _all_requests(pid), await _adjustments(pid))[body.type]
            left = max(0.0, b["available"] - res["days"])
        elif body.type == "LOP":
            left = max(0.0, core.LOP_CAP - core.used(await _all_requests(pid), pid, "LOP", fy) - res["days"])
        return {"ok": True, "days": res["days"], "left_after": left, "flags": res["flags"], "needs_hr": res["needs_hr"],
                "approver": (people.get(approver) or {}).get("name") or "HR"}
    doc = {"id": str(uuid.uuid4()), "emp_id": pid, "type": body.type,
           "start": core.d(req["start"]).isoformat(), "end": core.d(req["end"]).isoformat(),
           "days": res["days"], "reason": req["reason"], "flags": res["flags"], "needs_hr": res["needs_hr"],
           "credits": res["credits"], "status": "pending", "stage": "manager" if approver else "hr",
           "approver_id": approver, "applied_at": _now().isoformat(), "applied_by": user.get("email", ""),
           "child_birth": req["child_birth"], "expected_delivery": req["expected_delivery"],
           "worked_on": core.d(body.worked_on).isoformat() if body.worked_on else None, "history": []}
    await db.hr_leave.insert_one(dict(doc))
    await audit_log(db, "HRM_LEAVE_APPLIED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"request": doc["id"], "person": pid, "type": body.type, "days": doc["days"]})
    # Who hears about it (Nov 2026): the approver — the reporting manager, or
    # HR when there is no manager — and the employee gets a receipt.
    what = f"{LABEL.get(body.type)}: {_span(doc)} ({doc['days']} day(s))" if body.type != "COMP_EARN" else \
        f"{LABEL.get(body.type)}: working {_span(doc)}"
    approvers = [(people.get(approver) or {}).get("work_email")] if approver else _hr_emails(people, pid)
    await _mail_many(approvers, f"Leave request: {emp['name']} — {LABEL.get(body.type)}",
                     [f"{emp['name']} asked for {what}.", f"Reason: {doc['reason'] or '—'}"], "Review it in the HRM")
    await _mail(emp.get("work_email", ""), f"Leave request received — {LABEL.get(body.type)}",
                [f"Your request for {what} is with {(people.get(approver) or {}).get('name') or 'HR'} for approval.",
                 "You'll get an email when it's decided."])
    return doc


@router.post("/requests/{rid}/cancel")
async def leave_cancel(rid: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    r = await db.hr_leave.find_one({"id": rid}, {"_id": 0})
    if not r or not _member(me, acc) or not hr_core.can_see(acc, r["emp_id"]):
        raise HTTPException(status_code=404, detail="Not found")
    own = me and r["emp_id"] == me["id"]
    if not acc["hr"]:
        if not own:
            raise HTTPException(status_code=403, detail="Only the person or HR can withdraw this.")
        if r["status"] == "approved" and core.d(r["start"]) <= _today():
            raise HTTPException(status_code=400, detail="This leave has started — ask HR to change it.")
    if r["status"] not in core.ACTIVE:
        raise HTTPException(status_code=400, detail="Already closed.")
    await db.hr_leave.update_one({"id": rid, "status": {"$in": list(core.ACTIVE)}}, {
        "$set": {"status": "cancelled", "cancelled_at": _now().isoformat(), "cancelled_by": user.get("email", "")},
        "$push": {"history": {"at": _now().isoformat(), "by": user.get("email", ""), "what": "cancelled"}}})
    await audit_log(db, "HRM_LEAVE_CANCELLED", email=user.get("email", ""), role=user.get("role", ""), meta={"request": rid})
    emp = people.get(r["emp_id"]) or {}
    if r["status"] == "approved" or r.get("stage") == "manager":
        # Whoever approved / was about to approve shouldn't plan around leave that's gone.
        mgr = (people.get(r.get("approver_id")) or {}).get("work_email")
        await _mail_many([mgr] if mgr else _hr_emails(people, r["emp_id"]), f"Leave withdrawn: {emp.get('name')} — {LABEL.get(r['type'])}",
                         [f"{emp.get('name')}'s {LABEL.get(r['type'])} {_span(r)} was withdrawn by {user.get('email', '')}."])
    if not own:
        await _mail(emp.get("work_email", ""), f"Your leave was cancelled by HR — {LABEL.get(r['type'])}",
                    [f"{LABEL.get(r['type'])}: {_span(r)} was cancelled by {user.get('email', '')}."])
    return {"ok": True}


# -------------------------------------------------------------- approvals ---
def _waiting_for(r: dict, me: Optional[dict], acc: dict) -> bool:
    if r["status"] != "pending" or (me and r["emp_id"] == me["id"]):
        return False                       # nobody approves their own leave
    if r["stage"] == "manager":
        return bool(me and r.get("approver_id") == me["id"]) or acc["hr"]
    return acc["hr"]


@router.get("/approvals")
async def leave_approvals(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    reqs = [r for r in await _all_requests() if _waiting_for(r, me, acc)]
    names = {p["id"]: p.get("name", "") for p in people.values()}
    reqs.sort(key=lambda r: r["start"])
    return {"rows": [{**r, "name": names.get(r["emp_id"], ""), "label": LABEL.get(r["type"], r["type"])} for r in reqs]}


class DecideBody(BaseModel):
    approve: bool
    note: Optional[str] = ""
    cert_seen: Optional[bool] = None
    days: Optional[int] = None         # HR only: bereavement days granted


@router.post("/requests/{rid}/decide")
async def leave_decide(rid: str, body: DecideBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    r = await db.hr_leave.find_one({"id": rid}, {"_id": 0})
    if not r or not _member(me, acc) or not _waiting_for(r, me, acc):
        raise HTTPException(status_code=404, detail="Nothing waiting for you here.")
    emp = people.get(r["emp_id"]) or {}
    now = _now().isoformat()
    step = {"at": now, "by": user.get("email", ""), "stage": r["stage"], "approve": body.approve, "note": (body.note or "")[:300]}
    upd: dict = {}
    if body.approve and "medical_certificate_needed" in (r.get("flags") or []) and not body.cert_seen and not r.get("cert_seen"):
        raise HTTPException(status_code=400, detail="Sick leave over 3 days needs the medical certificate — tick “certificate seen”.")
    if body.cert_seen:
        upd["cert_seen"] = True
    if body.days is not None:
        if not acc["hr"] or r["type"] != "BER":
            raise HTTPException(status_code=403, detail="Only HR can change the days, and only for bereavement leave.")
        if not 1 <= body.days <= 30:
            raise HTTPException(status_code=400, detail="Bereavement days must be 1–30.")
        upd["days"] = body.days
        step["days"] = body.days
    if not body.approve:
        upd.update(status="rejected", decided_at=now, decided_by=user.get("email", ""), decision_note=step["note"])
    elif r["stage"] == "manager" and r.get("needs_hr") and not acc["hr"]:
        upd.update(stage="hr")             # manager said yes; HR has the last word on these
    else:
        upd.update(status="approved", decided_at=now, decided_by=user.get("email", ""), decision_note=step["note"])
    res = await db.hr_leave.update_one({"id": rid, "status": "pending", "stage": r["stage"]}, {"$set": upd, "$push": {"history": step}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="Someone else decided this a moment ago — refresh.")
    await audit_log(db, "HRM_LEAVE_DECIDED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"request": rid, "approve": body.approve, "result": upd.get("status") or "to HR"})
    if upd.get("status"):
        await _mail(emp.get("work_email", ""), f"Your leave was {upd['status']} — {LABEL.get(r['type'])}",
                    [f"{LABEL.get(r['type'])}: {_span(r)} — {upd['status']} by {user.get('email', '')}.",
                     f"Note: {step['note']}" if step["note"] else ""])
        if r.get("needs_hr") or upd["status"] == "approved" and r["type"] in ("MAT", "BER", "LOP"):
            # HR keeps track of the long / unpaid ones even when a manager closed them.
            await _mail_many(_hr_emails(people, r["emp_id"]), f"FYI: {emp.get('name')} — {LABEL.get(r['type'])} {upd['status']}",
                             [f"{LABEL.get(r['type'])}: {_span(r)} ({upd.get('days', r['days'])} day(s)) — {upd['status']} by {user.get('email', '')}."])
    elif upd.get("stage") == "hr":
        # Manager said yes; HR has the final word — tell HR it's waiting, and the employee where it is.
        await _mail_many(_hr_emails(people, r["emp_id"]), f"Leave needs HR approval: {emp.get('name')} — {LABEL.get(r['type'])}",
                         [f"{emp.get('name')}: {LABEL.get(r['type'])}, {_span(r)} ({r['days']} day(s)). Their manager approved; it needs HR's OK.",
                          *[f"⚠ {f}" for f in r.get("flags") or []]], "Review it in the HRM")
        await _mail(emp.get("work_email", ""), f"Your leave is with HR — {LABEL.get(r['type'])}",
                    [f"{LABEL.get(r['type'])}: {_span(r)} — your manager approved it; HR gives the final OK."])
    return {"ok": True, **upd}


# ------------------------------------------------------------ who is off ---
@router.get("/team")
async def leave_team(start: Optional[str] = None, end: Optional[str] = None, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not (acc["hr"] or acc["manager"]):
        raise HTTPException(status_code=403, detail="For managers and HR.")
    try:
        s = core.d(start) if start else _today()
        # default: to the end of the start date's month
        e = core.d(end) if end else date(s.year + (s.month == 12), s.month % 12 + 1, 1) - timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be valid.")
    rows = [r for r in await _all_requests() if r["status"] in core.ACTIVE and r["type"] != "COMP_EARN"
            and hr_core.can_see(acc, r["emp_id"]) and core.d(r["start"]) <= e and s <= core.d(r["end"])]
    names = {p["id"]: p.get("name", "") for p in people.values()}
    rows.sort(key=lambda r: r["start"])
    return {"start": s.isoformat(), "end": e.isoformat(),
            "rows": [{"id": r["id"], "name": names.get(r["emp_id"], ""), "type": r["type"], "label": LABEL.get(r["type"]),
                      "start": r["start"], "end": r["end"], "days": r["days"], "status": r["status"]} for r in rows]}


# ------------------------------------------------------------ HR corrections ---
class AdjustBody(BaseModel):
    emp_id: str
    fy: str
    type: str
    days: float
    note: str


@router.get("/adjustments")
async def leave_adjustments(emp_id: Optional[str] = None, user: dict = Depends(require_hr)):
    return {"rows": sorted(await _adjustments(emp_id), key=lambda a: a["at"], reverse=True)}


@router.post("/adjustments")
async def leave_adjust(body: AdjustBody, user: dict = Depends(require_hr)):
    """Opening balances when the HRM starts (EL carried in, CL/SL already
    taken this year as negatives) and one-off corrections. Always with a note."""
    if body.type not in ("CL", "SL", "EL", "OPT"):
        raise HTTPException(status_code=400, detail="Adjust CL, SL, EL or the optional holiday.")
    try:
        hr_core.fy_bounds(body.fy)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not -60 <= body.days <= 60 or body.days == 0 or (body.days * 2) != int(body.days * 2):
        raise HTTPException(status_code=400, detail="Days must be a non-zero whole or half number between −60 and 60.")
    if len((body.note or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="Say why (at least 5 characters) — it's in the record.")
    if not await db.hr_employees.find_one({"id": body.emp_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Not found")
    doc = {"id": str(uuid.uuid4()), "emp_id": body.emp_id, "fy": body.fy, "type": body.type, "days": float(body.days),
           "note": body.note.strip()[:300], "by": user.get("email", ""), "at": _now().isoformat()}
    await db.hr_leave_adjust.insert_one(dict(doc))
    await audit_log(db, "HRM_LEAVE_ADJUSTED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"person": body.emp_id, "fy": body.fy, "type": body.type, "days": body.days})
    return doc


class SetBalanceBody(BaseModel):
    emp_id: str
    type: str
    to: float
    note: str
    fy: Optional[str] = None


@router.post("/set-balance")
async def leave_set_balance(body: SetBalanceBody, user: dict = Depends(require_superadmin_hrm)):
    """Super admin: set what is LEFT of a leave type to an exact number (to
    match the paper register, zero it out, grant extra). Recorded as an
    adjustment of the difference, so the history still adds up. Comp-off is
    set by granting or voiding comp-off days (granted ones last 2 months)."""
    if body.type not in ("CL", "SL", "EL", "OPT", "COMP"):
        raise HTTPException(status_code=400, detail="Choose CL, SL, EL, optional holiday or comp-off.")
    if not 0 <= body.to <= 60 or (body.to * 2) != int(body.to * 2):
        raise HTTPException(status_code=400, detail="Set a whole or half number between 0 and 60.")
    if len((body.note or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="Say why (at least 5 characters) — it's in the record.")
    emp = await db.hr_employees.find_one({"id": body.emp_id}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Not found")
    fy = body.fy or hr_core.fiscal_year(_today())
    reqs, adjs = await _all_requests(body.emp_id), await _adjustments(body.emp_id)
    now = _now().isoformat()
    note = f"Set to {body.to:g} by super admin: {body.note.strip()}"[:300]
    if body.type == "COMP":
        if body.to != int(body.to):
            raise HTTPException(status_code=400, detail="Comp-off is whole days.")
        avail = core.comp_available(reqs, body.emp_id, _today())
        diff = int(body.to) - len(avail)
        if diff > 0:
            for _ in range(diff):
                await db.hr_leave.insert_one({"id": str(uuid.uuid4()), "emp_id": body.emp_id, "type": "COMP_EARN", "status": "approved",
                                              "worked_on": _today().isoformat(), "start": _today().isoformat(), "end": _today().isoformat(),
                                              "days": 0, "granted": True, "reason": note, "applied_at": now,
                                              "applied_by": user.get("email", ""), "decided_by": user.get("email", ""), "decided_at": now,
                                              "flags": [], "history": []})
        for c in sorted(avail, key=lambda c: c["expires"])[:max(0, -diff)]:
            await db.hr_leave.update_one({"id": c["id"]}, {"$set": {"status": "voided", "voided_by": user.get("email", ""), "voided_at": now,
                                                                    "decision_note": note}})
    else:
        b = core.balances(emp, fy, _today(), reqs, adjs)[body.type]
        cur = b["available"] if body.type == "EL" else b["entitled"] - b["used"] - b["pending"]
        diff = round(body.to - cur, 1)
        if diff:
            await db.hr_leave_adjust.insert_one({"id": str(uuid.uuid4()), "emp_id": body.emp_id, "fy": fy, "type": body.type,
                                                 "days": float(diff), "note": note, "by": user.get("email", ""), "at": now})
    await audit_log(db, "HRM_LEAVE_BALANCE_SET", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"person": body.emp_id, "type": body.type, "to": body.to, "fy": fy})
    after = core.balances(emp, fy, _today(), await _all_requests(body.emp_id), await _adjustments(body.emp_id))
    return {"ok": True, "balances": after}


# ---------------------------------------------------------- payroll export ---
@router.get("/export.csv")
async def leave_export(month: str, user: dict = Depends(require_hr)):
    """For RazorpayX Payroll: per person, loss-of-pay days in the month
    (approved only), plus joining in the month. Upload / copy into RazorpayX."""
    from csv_export import csv_response
    try:
        y, m = (int(x) for x in month.split("-"))
        first = date(y, m, 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Month must look like 2026-11")
    people = {p["id"]: p async for p in db.hr_employees.find({}, {"_id": 0})}
    lop: dict = {}
    for r in await _all_requests():
        if r["type"] == "LOP" and r["status"] == "approved":
            lop[r["emp_id"]] = lop.get(r["emp_id"], 0) + core.days_in_month(r, month)
    rows = []
    for p in sorted(people.values(), key=lambda p: p.get("name", "")):
        joined = (p.get("joined_on") or "")[:7] == month
        leaving = (p.get("exited_on") or "")[:7] == month
        if p.get("status") != "active" and not lop.get(p["id"]) and not leaving:
            continue
        enc = ((p.get("exit") or {}).get("encashment") or {}) if leaving else {}
        rows.append([p.get("emp_code", ""), p.get("name", ""), p.get("work_email", ""), lop.get(p["id"], 0),
                     p.get("joined_on", "") if joined else "", p.get("exited_on", "") if leaving else "",
                     enc.get("days", "") if leaving else ""])
    await audit_log(db, "HRM_PAYROLL_EXPORT", email=user.get("email", ""), role=user.get("role", ""), meta={"month": month})
    return csv_response(f"razorpayx-leave-{month}.csv",
                        ["Employee code", "Name", "Work email", "Loss of pay days", "Joined this month", "Last working day",
                         "Earned leave to encash (days)"], rows)


async def ensure_indexes() -> None:
    try:
        await db.hr_leave.create_index("id", unique=True)
        await db.hr_leave.create_index([("emp_id", 1), ("start", 1)])
        await db.hr_leave.create_index([("status", 1), ("stage", 1)])
        await db.hr_leave_adjust.create_index("emp_id")
    except Exception:  # noqa: BLE001
        log.warning("hrm leave: index creation failed", exc_info=True)
