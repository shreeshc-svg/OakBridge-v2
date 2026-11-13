"""HRM separation: resignation (employee-initiated) and termination (HR /
Director), Nov 2026. Rules: hr_separation_core.py. Both end in the same exit
as HR's "Record exit" (hrm_lifecycle.record_exit) and a Full & Final
settlement due 14 days after the last working day.

    GET  /api/hrm/separation/mine                 my resignation + anything addressed to me (PIP, show-cause, outcome)
    POST /api/hrm/separation/resign               employee: resign (reason, proposed last day)
    POST /api/hrm/separation/{id}/withdraw        employee: withdraw (until HR accepts)
    POST /api/hrm/separation/{id}/manager         reporting manager: comment + accept & forward to HR
    POST /api/hrm/separation/{id}/accept          HR: final last day, notice waived / early release -> exit
    GET  /api/hrm/separation/board                manager: team resignations; HR: everything + F&F
    POST /api/hrm/separation/cases                HR: open a termination case (ground)
    POST /api/hrm/separation/cases/{id}/{step}    HR: pip | pip-outcome | show-cause | absence | note | terminate | close
    POST /api/hrm/separation/cases/{id}/reply     employee: reply to a show-cause notice
    POST /api/hrm/separation/{id}/fnf             HR: mark Full & Final paid
    GET  /api/hrm/separation/{id}/letter.pdf      acceptance / termination letter (employee or HR)

Every step is audited and emailed to whoever has to act next.
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

import hr_separation_core as core
from audit import audit_log
from extensions import db, get_current_user
from hr_leave_core import approver_for
from hrm import _ctx, _member, require_hr, superadmin_emails

log = logging.getLogger("oakbridge.hrm.separation")
router = APIRouter(prefix="/api/hrm/separation", tags=["hrm"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return (_now() + timedelta(hours=5, minutes=30)).date()


async def _audit(user: dict, action: str, meta: dict) -> None:
    await audit_log(db, action, email=user.get("email", ""), role=user.get("role", ""), meta=meta)


async def _mail(tos: list, subject: str, lines: list, *, fallback: bool = False, attachments: Optional[list] = None) -> None:
    tos = [t for t in tos if t]
    if not tos and fallback:
        tos = await superadmin_emails()
    try:
        import html
        import os
        from emailer import send_email
        site = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")
        body = "".join(f"<p style='margin:0 0 10px;font-size:15px;line-height:1.5'>{html.escape(x)}</p>" for x in lines if x)
        for to in dict.fromkeys(tos):
            await send_email(to=to, subject=subject, html=f"<div style='font-family:Arial,sans-serif;color:#002B5C;max-width:560px'>{body}"
                             f"<p><a href='{site}/hrm' style='background:#002B5C;color:#fff;padding:10px 20px;text-decoration:none'>Open the HRM</a></p></div>",
                             attachments=attachments)
    except Exception:  # noqa: BLE001 — mail never blocks the step
        log.exception("hrm separation: mail failed")


def _hr_emails(people: dict, skip: str = "") -> list:
    return [p["work_email"] for p in people.values()
            if p.get("hr_access") and p.get("status") == "active" and p.get("work_email") and p["id"] != skip]


def _first(p: Optional[dict]) -> str:
    return ((p or {}).get("name") or "there").split(" ")[0]


def _fmt(s) -> str:
    return core.d(s).strftime("%d %b %Y") if s else "—"


async def _step(doc: dict, upd: dict, user: dict, what: str, expect: dict) -> dict:
    res = await db.hr_separations.update_one({"id": doc["id"], **expect},
                                             {"$set": {**upd, "updated_at": _now().isoformat()},
                                              "$push": {"history": {"at": _now().isoformat(), "by": user.get("email", ""), "what": what}}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="This changed a moment ago — please refresh.")
    await _audit(user, f"HRM_SEPARATION_{what.upper().replace(' ', '_').replace('-', '_')}",
                 {"separation": doc["id"], "person": doc["emp_id"], "kind": doc["kind"]})
    return await db.hr_separations.find_one({"id": doc["id"]}, {"_id": 0})


async def _leaver_emails(emp: dict) -> list:
    """Work email AND the personal email from their profile: the work inbox
    closes after the last day, so the letter must also reach them outside it
    (they lose HRM access too — the emailed PDF is their copy to keep)."""
    prof = await db.hr_profiles.find_one({"emp_id": emp.get("id")}, {"_id": 0, "personal_email": 1}) or {}
    return [e for e in (emp.get("work_email"), prof.get("personal_email")) if e]


def _letter_args(doc: dict, emp: dict) -> Optional[dict]:
    """The acceptance / termination letter for this separation, or None if
    there isn't one yet. Used by the download AND the email attachment, so
    both are always the same letter."""
    rows = [["Employee ID", emp.get("emp_code") or "-"], ["Designation", emp.get("designation") or "-"]]
    if doc["kind"] == "resignation" and doc.get("status") == "accepted":
        return dict(title="Acceptance of resignation", heading="Acceptance of resignation", to_name=emp.get("name", ""), rows=rows,
                    paragraphs=[f"We acknowledge receipt of your resignation dated {_fmt(doc['submitted_on'])} and accept it.",
                                f"Your last working day with the company will be {_fmt(doc['last_day'])}. Please complete the handover "
                                "and return company property before then.",
                                f"Your Full & Final settlement will be processed by {_fmt(doc['fnf']['due'])}.",
                                "We thank you for your contribution and wish you success in the future."])
    if doc["kind"] == "termination" and doc.get("status") == "terminated":
        return dict(title="Termination of employment", heading="Termination of employment", to_name=emp.get("name", ""), rows=rows,
                    paragraphs=[f"This is to inform you that your employment with the company is terminated, with your last working day "
                                f"being {_fmt(doc['last_day'])}.",
                                f"Ground: {core.GROUNDS.get(doc['ground'], '')}. Notice: {core.NOTICE_MODES.get(doc['notice'], '')}.",
                                "Please return all company property and complete the handover with HR.",
                                f"Your Full & Final settlement will be processed by {_fmt(doc['fnf']['due'])}."])
    return None


async def _letter_attachment(doc: dict, emp: dict) -> Optional[list]:
    args = _letter_args(doc, emp)
    if not args:
        return None
    try:
        from hr_letters import letter_pdf
        pdf = await asyncio.to_thread(letter_pdf, **args)
        return [(f"{args['title']} - {emp.get('name', '')}.pdf", pdf)]
    except Exception:  # noqa: BLE001 — the email still goes; the letter is downloadable until the last day
        log.exception("hrm separation: letter PDF failed")
        return None


def _res_view(r: dict, people: dict) -> dict:
    emp = people.get(r["emp_id"]) or {}
    v = {k: r.get(k) for k in ("id", "kind", "emp_id", "status", "reason", "requested_last_day", "submitted_at", "manager",
                               "hr_decision", "last_day", "fnf", "withdrawn_at", "notice_days", "shortfall_days")}
    v.update(name=emp.get("name", ""), emp_code=emp.get("emp_code", ""), department=emp.get("department", ""),
             designation=emp.get("designation", ""), status_label=core.RES_STATUS.get(r["status"], r["status"]),
             manager_name=(people.get(r.get("manager_id")) or {}).get("name", "") if r.get("manager_id") else "")
    return v


def _case_view(c: dict, people: dict) -> dict:
    emp = people.get(c["emp_id"]) or {}
    return {**{k: v for k, v in c.items() if k not in ("history",)}, "history": c.get("history", [])[-20:],
            "name": emp.get("name", ""), "emp_code": emp.get("emp_code", ""), "department": emp.get("department", ""),
            "confirmed": bool(emp.get("confirmed_on")), "ground_label": core.GROUNDS.get(c.get("ground"), ""),
            "status_label": core.TERM_STATUS.get(c["status"], c["status"])}


# ------------------------------------------------------------------- mine ---
@router.get("/mine")
async def sep_mine(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not set up in the HRM.")
    res = await db.hr_separations.find_one({"emp_id": me["id"], "kind": "resignation", "status": {"$ne": "withdrawn"}},
                                           {"_id": 0}, sort=[("submitted_at", -1)])
    cases = [core.employee_view(c) async for c in db.hr_separations.find({"emp_id": me["id"], "kind": "termination"}, {"_id": 0})]
    today = _today()
    return {"resignation": _res_view(res, people) if res else None, "notices": [c for c in cases if c],
            "notice_days": core.NOTICE_DAYS, "default_last_day": core.default_last_day(today).isoformat(),
            "exit_recorded": bool(me.get("exited_on")), "manager_name": (people.get(approver_for(me, people)) or {}).get("name", "")}


# ------------------------------------------------------------ resignation ---
class ResignBody(BaseModel):
    reason: str
    last_day: Optional[str] = None


@router.post("/resign")
async def sep_resign(body: ResignBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not set up in the HRM.")
    if me.get("exited_on"):
        raise HTTPException(status_code=409, detail="Your exit is already recorded.")
    if await db.hr_separations.find_one({"emp_id": me["id"], "kind": "resignation", "status": {"$in": ["manager", "hr"]}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="You already have a resignation in progress.")
    today = _today()
    try:
        last = core.check_resignation(body.reason, body.last_day or core.default_last_day(today).isoformat(), today, me.get("joined_on"))
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    mgr = approver_for(me, people)
    doc = {"id": str(uuid.uuid4()), "kind": "resignation", "emp_id": me["id"], "status": "manager" if mgr else "hr",
           "manager_id": mgr, "reason": core.txt(body.reason), "requested_last_day": last.isoformat(),
           "notice_days": core.NOTICE_DAYS, "submitted_at": _now().isoformat(), "submitted_on": today.isoformat(),
           "history": [{"at": _now().isoformat(), "by": user.get("email", ""), "what": "submitted"}]}
    await db.hr_separations.insert_one(dict(doc))
    await _audit(user, "HRM_RESIGNATION_SUBMITTED", {"separation": doc["id"], "last_day": last.isoformat()})
    lines = [f"{me['name']} has submitted their resignation.", f"Proposed last working day: {_fmt(last)}.", f"Reason: “{doc['reason']}”"]
    if mgr:
        await _mail([people[mgr].get("work_email")], f"Resignation: {me['name']}",
                    [f"Hi {_first(people[mgr])},", *lines, "Please have a conversation with them, then add your comments and forward it to HR in the HRM."])
    await _mail(_hr_emails(people, me["id"]), f"Resignation received: {me['name']}",
                [*lines, "With their manager first." if mgr else "There's no reporting manager, so it's with HR to accept."], fallback=True)
    await _mail([me.get("work_email")], "We've received your resignation",
                [f"Hi {_first(me)},", f"Your resignation has been received{' and sent to ' + people[mgr]['name'] if mgr else ' by HR'}.",
                 f"Proposed last working day: {_fmt(last)}. You can withdraw it in the HRM until HR accepts it."])
    return _res_view(doc, people)


async def _load(sid: str, kind: str) -> dict:
    doc = await db.hr_separations.find_one({"id": sid, "kind": kind}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@router.post("/{sid}/withdraw")
async def sep_withdraw(sid: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    doc = await _load(sid, "resignation")
    if not me or doc["emp_id"] != me["id"]:
        raise HTTPException(status_code=404, detail="Not found")
    if doc["status"] not in ("manager", "hr"):
        raise HTTPException(status_code=409, detail="It's already been accepted — please speak to HR.")
    saved = await _step(doc, {"status": "withdrawn", "withdrawn_at": _now().isoformat()}, user, "withdrawn", {"status": doc["status"]})
    tos = _hr_emails(people, me["id"]) + ([people[doc["manager_id"]].get("work_email")] if doc.get("manager_id") in people else [])
    await _mail(tos, f"Resignation withdrawn: {me['name']}", [f"{me['name']} has withdrawn their resignation. No action needed."], fallback=True)
    return _res_view(saved, people)


class ManagerBody(BaseModel):
    comment: str
    suggested_last_day: Optional[str] = None


@router.post("/{sid}/manager")
async def sep_manager(sid: str, body: ManagerBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    doc = await _load(sid, "resignation")
    if not me or doc.get("manager_id") != me["id"] or doc["status"] != "manager":
        raise HTTPException(status_code=404, detail="Nothing waiting for you here.")
    if len(core.txt(body.comment)) < 10:
        raise HTTPException(status_code=400, detail="Add a short comment for HR (e.g. handover plan, whether you tried to retain them).")
    sug = None
    if body.suggested_last_day:
        try:
            sug = core.d(body.suggested_last_day).isoformat()
        except core.Refused as e:
            raise HTTPException(status_code=400, detail=str(e))
    m = {"by": user.get("email", ""), "name": me.get("name", ""), "at": _now().isoformat(), "comment": core.txt(body.comment, 1000),
         "suggested_last_day": sug}
    saved = await _step(doc, {"status": "hr", "manager": m}, user, "manager forwarded", {"status": "manager"})
    emp = people.get(doc["emp_id"]) or {}
    await _mail(_hr_emails(people, doc["emp_id"]), f"Resignation to accept: {emp.get('name')}",
                [f"{me['name']} has spoken with {emp.get('name')} and forwarded the resignation.", f"Their comment: “{m['comment']}”",
                 f"Suggested last day: {_fmt(sug)}" if sug else "", "Please confirm the final last working day in the HRM."], fallback=True)
    await _mail([emp.get("work_email")], "Your resignation is with HR",
                [f"Hi {_first(emp)},", f"{me['name']} has reviewed your resignation and passed it to HR, who will confirm your last working day."])
    return _res_view(saved, people)


class AcceptBody(BaseModel):
    last_day: str
    waive_shortfall: bool = False
    note: Optional[str] = ""


@router.post("/{sid}/accept")
async def sep_accept(sid: str, body: AcceptBody, user: dict = Depends(require_hr)):
    people, me, acc = await _ctx(user)
    doc = await _load(sid, "resignation")
    if doc["status"] != "hr":
        raise HTTPException(status_code=409, detail="This resignation is with the manager, or already handled.")
    emp = people.get(doc["emp_id"])
    if not emp or emp.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not found")
    try:
        last = core.d(body.last_day)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    if last < core.d(doc["submitted_on"]):
        raise HTTPException(status_code=400, detail="The last day can't be before they resigned.")
    short = core.shortfall(core.d(doc["submitted_on"]), last, doc.get("notice_days") or core.NOTICE_DAYS)
    fnf = {"due": core.fnf_due(last), "status": "pending"}
    from hrm_lifecycle import record_exit
    await record_exit(emp, last, "resigned", body.note or doc["reason"], user,
                      extra={"separation_id": sid, "notice_shortfall_days": short, "shortfall_waived": body.waive_shortfall})
    hr = {"by": user.get("email", ""), "at": _now().isoformat(), "last_day": last.isoformat(), "waive_shortfall": body.waive_shortfall,
          "note": core.txt(body.note, 1000)}
    saved = await _step(doc, {"status": "accepted", "hr_decision": hr, "last_day": last.isoformat(), "shortfall_days": short, "fnf": fnf},
                        user, "accepted", {"status": "hr"})
    await _mail(await _leaver_emails(emp), "Your resignation has been accepted",
                [f"Hi {_first(emp)},", f"Your resignation has been accepted. Your last working day is {_fmt(last)}.",
                 "Your acceptance letter is attached — please keep it; HRM access closes after your last day.",
                 (f"Your notice is {short} day(s) short of {core.NOTICE_DAYS}; this has been waived." if short and body.waive_shortfall
                  else f"Your notice is {short} day(s) short of {core.NOTICE_DAYS}; HR will settle this in your Full & Final." if short else ""),
                 f"Your Full & Final settlement is due by {_fmt(fnf['due'])}. Please complete your handover checklist with HR.",
                 "Thank you for everything you've done at Oakbridge — we wish you the very best."],
                attachments=await _letter_attachment(saved, emp))
    if doc.get("manager_id") in people:
        await _mail([people[doc["manager_id"]].get("work_email")], f"Resignation accepted: {emp.get('name')}",
                    [f"HR has accepted {emp.get('name')}'s resignation. Last working day: {_fmt(last)}. Please plan the handover."])
    return _res_view(saved, people)


# ------------------------------------------------------------------- board ---
@router.get("/board")
async def sep_board(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not (acc["hr"] or acc["manager"]):
        raise HTTPException(status_code=403, detail="For managers and HR.")
    res, cases = [], []
    async for s in db.hr_separations.find({}, {"_id": 0}):
        if me and s["emp_id"] == me["id"]:
            continue                         # nobody handles their own
        if s["kind"] == "resignation":
            if acc["hr"] or (me and s.get("manager_id") == me["id"]):
                res.append(_res_view(s, people))
        elif acc["hr"]:
            cases.append(_case_view(s, people))
    res.sort(key=lambda r: ({"manager": 0, "hr": 1, "accepted": 2}.get(r["status"], 3), r.get("submitted_at") or ""))
    cases.sort(key=lambda c: (c["status"] != "open", c.get("opened_at") or ""), reverse=False)
    fnf = [x for x in res + cases if (x.get("fnf") or {}).get("status") == "pending"] if acc["hr"] else []
    return {"resignations": res, "cases": cases, "fnf": fnf, "today": _today().isoformat(),
            "grounds": core.GROUNDS, "notice_modes": core.NOTICE_MODES, "hr": acc["hr"]}


# ------------------------------------------------------------- termination ---
class CaseBody(BaseModel):
    emp_id: str
    ground: str
    note: Optional[str] = ""


@router.post("/cases")
async def case_open(body: CaseBody, user: dict = Depends(require_hr)):
    people, me, acc = await _ctx(user)
    emp = people.get(body.emp_id)
    if not emp or emp.get("status") != "active" or emp.get("exited_on"):
        raise HTTPException(status_code=404, detail="Not found (or already leaving).")
    if me and emp["id"] == me["id"]:
        raise HTTPException(status_code=400, detail="You can't open a case about yourself.")
    if body.ground not in core.GROUNDS:
        raise HTTPException(status_code=400, detail="Choose a ground.")
    if await db.hr_separations.find_one({"emp_id": emp["id"], "kind": "termination", "status": "open"}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="There's already an open case for them.")
    doc = {"id": str(uuid.uuid4()), "kind": "termination", "emp_id": emp["id"], "status": "open", "ground": body.ground,
           "note": core.txt(body.note, 2000), "steps": {}, "opened_at": _now().isoformat(), "opened_by": user.get("email", ""),
           "history": [{"at": _now().isoformat(), "by": user.get("email", ""), "what": f"opened ({core.GROUNDS[body.ground]})"}]}
    await db.hr_separations.insert_one(dict(doc))
    await _audit(user, "HRM_CASE_OPENED", {"separation": doc["id"], "person": emp["id"], "ground": body.ground})
    return _case_view(doc, people)


class StepBody(BaseModel):
    expectations: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    outcome: Optional[str] = None
    text: Optional[str] = None
    deadline: Optional[str] = None
    since: Optional[str] = None
    notice_sent_on: Optional[str] = None
    note: Optional[str] = ""
    last_day: Optional[str] = None
    notice: Optional[str] = None


@router.post("/cases/{cid}/{step}")
async def case_step(cid: str, step: str, body: StepBody, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if step == "reply":
        return await _case_reply(cid, body, user, people, me)
    if not acc["hr"]:
        raise HTTPException(status_code=403, detail="Only HR / Directors can do this.")
    c = await _load(cid, "termination")
    emp = people.get(c["emp_id"]) or {}
    if me and c["emp_id"] == me["id"]:
        raise HTTPException(status_code=404, detail="Not found")
    if c["status"] != "open":
        raise HTTPException(status_code=409, detail="This case is closed.")
    today = _today()
    steps = dict(c.get("steps") or {})
    try:
        if step == "pip":
            steps["pip"] = core.clean_pip(body.model_dump(), today)
            saved = await _step(c, {"steps": steps}, user, "pip started", {"status": "open"})
            await _mail([emp.get("work_email")], "Your performance improvement plan",
                        [f"Hi {_first(emp)},", f"HR has set up a performance improvement plan for you, from {_fmt(steps['pip']['start'])} to {_fmt(steps['pip']['end'])}.",
                         "What's expected:", steps["pip"]["expectations"], "Your manager and HR are here to help you meet it — please reach out with any questions."])
        elif step == "pip-outcome":
            pip = steps.get("pip")
            if not pip:
                raise core.Refused("There's no PIP on this case.")
            if body.outcome not in ("met", "not_met"):
                raise core.Refused("Choose met or not met.")
            if core.d(pip["end"]) > today:
                raise core.Refused(f"The PIP runs until {pip['end']}.")
            steps["pip"] = {**pip, "outcome": body.outcome, "outcome_note": core.txt(body.note, 1000), "outcome_at": _now().isoformat()}
            saved = await _step(c, {"steps": steps}, user, f"pip {body.outcome}", {"status": "open"})
        elif step == "show-cause":
            if steps.get("show_cause") and not steps["show_cause"].get("reply") and core.d(steps["show_cause"]["deadline"]) >= today:
                raise core.Refused("A show-cause notice is already waiting for a reply.")
            steps["show_cause"] = core.clean_show_cause(body.model_dump(), today)
            saved = await _step(c, {"steps": steps}, user, "show cause issued", {"status": "open"})
            await _mail([emp.get("work_email")], "Show-cause notice — please reply in the HRM",
                        [f"Hi {_first(emp)},", "HR has issued you a show-cause notice. Please read it and give your side in the HRM "
                         f"by {_fmt(steps['show_cause']['deadline'])}.", "Your reply will be considered before any decision is made."])
        elif step == "absence":
            steps["absence"] = core.clean_absence(body.model_dump(), today)
            saved = await _step(c, {"steps": steps}, user, "absence recorded", {"status": "open"})
        elif step == "note":
            if len(core.txt(body.note)) < 5:
                raise core.Refused("Write the note.")
            saved = await _step(c, {"note": core.txt(body.note, 2000)}, user, "note", {"status": "open"})
        elif step == "close":
            if len(core.txt(body.note)) < 10:
                raise core.Refused("Say why it's closed (e.g. PIP met).")
            saved = await _step(c, {"status": "closed", "closed_note": core.txt(body.note, 1000), "closed_at": _now().isoformat()},
                                user, "closed", {"status": "open"})
            if steps.get("pip") or steps.get("show_cause"):
                await _mail([emp.get("work_email")], "Update from HR",
                            [f"Hi {_first(emp)},", "HR has closed the matter that was open with you. No further action will be taken. Thank you."])
        elif step == "terminate":
            last = core.check_terminate(c, emp, today, notice=body.notice or "", last_day=body.last_day or "", note=body.note or "")
            from hrm_lifecycle import record_exit
            reason = "absconded" if c["ground"] == "absconding" else "terminated"
            await record_exit(emp, last, reason, body.note or "", user, extra={"separation_id": cid, "ground": c["ground"], "notice": body.notice})
            fnf = {"due": core.fnf_due(last), "status": "pending"}
            saved = await _step(c, {"status": "terminated", "last_day": last.isoformat(), "notice": body.notice, "decision_note": core.txt(body.note, 2000),
                                    "decided_by": user.get("email", ""), "decided_at": _now().isoformat(), "fnf": fnf},
                                user, "terminated", {"status": "open"})
            await _mail(await _leaver_emails(emp), "Important: your employment with Oakbridge",
                        [f"Dear {emp.get('name')},", f"This is to inform you that your employment ends with your last working day on {_fmt(last)} "
                         f"({core.NOTICE_MODES[body.notice].lower()}).", "Your letter is attached — please keep it; HRM access closes after your last day. "
                         f"Your Full & Final settlement will be completed by {_fmt(fnf['due'])}. Please contact HR for the handover."],
                        attachments=await _letter_attachment(saved, emp))
        else:
            raise HTTPException(status_code=404, detail="Unknown step")
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _case_view(saved, people)


async def _case_reply(cid: str, body: StepBody, user: dict, people: dict, me: Optional[dict]) -> dict:
    c = await _load(cid, "termination")
    if not me or c["emp_id"] != me["id"]:
        raise HTTPException(status_code=404, detail="Not found")
    sc = (c.get("steps") or {}).get("show_cause")
    if not sc or c["status"] != "open":
        raise HTTPException(status_code=409, detail="There's nothing to reply to.")
    if sc.get("reply"):
        raise HTTPException(status_code=409, detail="You've already replied.")
    if len(core.txt(body.text)) < 10:
        raise HTTPException(status_code=400, detail="Please write your reply (a few sentences).")
    steps = {**c["steps"], "show_cause": {**sc, "reply": core.txt(body.text, 4000), "reply_at": _now().isoformat()}}
    saved = await _step(c, {"steps": steps}, user, "show cause replied", {"status": "open"})
    await _mail(_hr_emails(people, me["id"]), f"Show-cause reply received: {me.get('name')}",
                [f"{me.get('name')} has replied to the show-cause notice. Read it in the HRM → Exit."], fallback=True)
    return core.employee_view(saved)


# --------------------------------------------------------------- F&F, letter ---
class FnfBody(BaseModel):
    note: Optional[str] = ""


@router.post("/{sid}/fnf")
async def sep_fnf(sid: str, body: FnfBody, user: dict = Depends(require_hr)):
    people, me, acc = await _ctx(user)
    doc = await db.hr_separations.find_one({"id": sid}, {"_id": 0})
    if not doc or (doc.get("fnf") or {}).get("status") != "pending":
        raise HTTPException(status_code=404, detail="No pending Full & Final here.")
    if me and doc["emp_id"] == me["id"]:
        raise HTTPException(status_code=400, detail="Another HR person marks your own Full & Final.")
    fnf = {**doc["fnf"], "status": "paid", "paid_on": _today().isoformat(), "by": user.get("email", ""), "note": core.txt(body.note, 600)}
    saved = await _step(doc, {"fnf": fnf}, user, "fnf paid", {"fnf.status": "pending"})
    emp = people.get(doc["emp_id"]) or {}
    await _mail(await _leaver_emails(emp), "Your Full & Final settlement is complete",
                [f"Hi {_first(emp)},", "Your Full & Final settlement has been processed. Thank you, and all the best."])
    return _res_view(saved, people) if saved["kind"] == "resignation" else _case_view(saved, people)


async def fnf_reminders(today: Optional[date] = None) -> int:
    """Daily (hrm_lifecycle.daily): F&F past its 14-day due date and still
    pending -> HR is emailed once."""
    today = today or _today()
    n = 0
    people = None
    async for s in db.hr_separations.find({"fnf.status": "pending", "fnf.reminded": {"$in": [None, False]}}, {"_id": 0}):
        if s["fnf"]["due"] >= today.isoformat():
            continue
        if people is None:
            people = {p["id"]: p async for p in db.hr_employees.find({}, {"_id": 0})}
        emp = people.get(s["emp_id"]) or {}
        await _mail(_hr_emails(people), f"Full & Final overdue: {emp.get('name')}",
                    [f"{emp.get('name')}'s Full & Final settlement was due on {_fmt(s['fnf']['due'])} (14 days after their last day). "
                     "Mark it paid in the HRM → Exit once it's done."], fallback=True)
        await db.hr_separations.update_one({"id": s["id"]}, {"$set": {"fnf": {**s["fnf"], "reminded": True}}})
        n += 1
    return n


@router.get("/{sid}/letter.pdf")
async def sep_letter(sid: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    doc = await db.hr_separations.find_one({"id": sid}, {"_id": 0})
    if not doc or not (acc["hr"] or (me and doc["emp_id"] == me["id"])) or not _member(me, acc):
        raise HTTPException(status_code=404, detail="Not found")
    emp = people.get(doc["emp_id"]) or {}
    from hr_letters import letter_pdf
    args = _letter_args(doc, emp)
    if not args:
        raise HTTPException(status_code=404, detail="The letter is available once it's accepted / decided.")
    pdf = await asyncio.to_thread(letter_pdf, **args)
    await _audit(user, "HRM_SEPARATION_LETTER", {"separation": sid, "person": doc["emp_id"]})
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{args["title"]}.pdf"', "Cache-Control": "private, no-store"})


async def ensure_indexes() -> None:
    try:
        await db.hr_separations.create_index("id", unique=True)
        await db.hr_separations.create_index([("emp_id", 1), ("kind", 1)])
        await db.hr_recognitions.create_index("id", unique=True)
        await db.hr_recognitions.create_index([("emp_id", 1), ("at", -1)])
        await db.hr_rec_congrats.create_index([("rec_id", 1), ("by_key", 1)], unique=True)
        await db.hr_rec_congrats.create_index("to_emp_id")
    except Exception:  # noqa: BLE001
        log.warning("hrm separation: index creation failed", exc_info=True)
