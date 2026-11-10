"""HRM annual appraisal (Nov 2026). Rules: hr_appraisal_core.py. CTC is
encrypted (hr_crypto.py) and shown only to HR / founders and — after release —
to the employee themselves; every CTC view and change is in the audit log.

    GET  /api/hrm/appraisal/cycle?fy=          the year's cycle (+ HR progress)
    POST /api/hrm/appraisal/cycle              HR: start the appraisal for a year
    POST /api/hrm/appraisal/cycle/remind       HR: email everyone with something left to do
    POST /api/hrm/appraisal/cycle/add          HR: add someone (joined late, confirmed late)
    GET  /api/hrm/appraisal/mine?fy=           my appraisal
    GET  /api/hrm/appraisal/team?fy=           manager: my team; HR: everyone (no CTC in lists)
    GET  /api/hrm/appraisal/{id}               one appraisal, as this person may see it
    PUT  /api/hrm/appraisal/{id}/self          employee: save / submit self-review
    PUT  /api/hrm/appraisal/{id}/manager       reporting manager (HR if none): save / submit
    PUT  /api/hrm/appraisal/{id}/hr            HR: adjust (with reasons), CTC, effective date
    POST /api/hrm/appraisal/{id}/release       HR: approve and share with the employee
    POST /api/hrm/appraisal/{id}/reopen        HR: send a part back (before release)
    POST /api/hrm/appraisal/{id}/ack           employee: acknowledge (+ comment / disagree)
    GET  /api/hrm/appraisal/{id}/letter.pdf    employee (after release) / HR

Daily (hrm_lifecycle.daily -> apply_due): on the effective date the new
designation is written to the employee record.
"""
from __future__ import annotations

import asyncio
import io
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import hr_appraisal_core as core
import hr_core
import hr_crypto
from audit import audit_log
from extensions import db, get_current_user
from hr_leave_core import approver_for
from hrm import _ctx, _member, require_hr, superadmin_emails

log = logging.getLogger("oakbridge.hrm.appraisal")
router = APIRouter(prefix="/api/hrm/appraisal", tags=["hrm"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return (_now() + timedelta(hours=5, minutes=30)).date()


async def _audit(user: dict, action: str, meta: dict) -> None:
    await audit_log(db, action, email=user.get("email", ""), role=user.get("role", ""), meta=meta)


async def _mail(tos: list, subject: str, lines: list, *, fallback: bool = False) -> None:
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
                             f"<p><a href='{site}/hrm' style='background:#002B5C;color:#fff;padding:10px 20px;text-decoration:none'>Open the HRM</a></p></div>")
    except Exception:  # noqa: BLE001 — mail never blocks the appraisal
        log.exception("hrm appraisal: mail failed")


def _hr_emails(people: dict, skip: str = "") -> list:
    return [p["work_email"] for p in people.values()
            if p.get("hr_access") and p.get("status") == "active" and p.get("work_email") and p["id"] != skip]


def _role(app: dict, me: Optional[dict], acc: dict, people: dict) -> Optional[str]:
    """owner / manager / hr — or None (no access). HR on their OWN appraisal
    is the owner: nobody approves their own appraisal or sees it early."""
    if me and app["emp_id"] == me["id"]:
        return "owner"
    if acc["hr"]:
        return "hr"
    emp = people.get(app["emp_id"]) or {}
    if me and approver_for(emp, people) == me["id"]:
        return "manager"
    return None


def _fills_manager_part(app: dict, me: Optional[dict], acc: dict, people: dict) -> bool:
    """Who writes the manager review: the ACTIVE reporting manager — even when
    they also have HR access — and HR only when there is no such manager.
    (HR changes a manager's proposal in the HR step, with reasons, instead.)"""
    if me and app["emp_id"] == me["id"]:
        return False
    mgr = approver_for(people.get(app["emp_id"]) or {}, people)
    return bool((me and mgr == me["id"]) or (acc["hr"] and not mgr))


async def _load(aid: str, user: dict):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    app = await db.hr_appraisals.find_one({"id": aid}, {"_id": 0})
    role = _role(app, me, acc, people) if app else None
    if not role:
        raise HTTPException(status_code=404, detail="Not found")
    return people, me, acc, app, role


CTC_KEY_ERROR = "CTC can't be read — HRM_DATA_KEY is missing or was changed in Render."


def _decrypt_ctc(app: dict) -> Optional[dict]:
    """{current, revised} in rupees, or {error}, or None (no CTC entered).
    Before release the revised figure is ALWAYS worked out fresh from the
    current CTC and the final % — so a manager review that was sent back and
    changed can never leave a stale revised CTC behind. At release it is
    frozen (revised_ctc_enc) and that stored figure is what the letter and
    payroll use from then on."""
    h = app.get("hr") or {}
    if not h.get("current_ctc_enc"):
        return None
    try:
        cur = hr_crypto.decrypt_amount(h["current_ctc_enc"])
        if app.get("stage") == "released" and h.get("revised_ctc_enc"):
            rev = hr_crypto.decrypt_amount(h["revised_ctc_enc"])
        else:
            pct = core.final_outcome(app)["increment_pct"]
            rev = core.revised_ctc(cur, pct) if pct is not None else None
        return {"current": cur, "revised": rev}
    except Exception:  # noqa: BLE001 — wrong / missing key: say so, never guess
        return {"error": CTC_KEY_ERROR}


async def _out(app: dict, role: str, people: dict, user: dict, me: Optional[dict], acc: dict, *, with_ctc: bool) -> dict:
    ctc = None
    if with_ctc and (role == "hr" or (role == "owner" and app.get("stage") == "released")):
        ctc = _decrypt_ctc(app)
        if ctc and "error" not in ctc:
            await _audit(user, "HRM_CTC_VIEWED", {"appraisal": app["id"], "person": app["emp_id"], "as": role})
    v = core.view(app, role=role, ctc=ctc)
    emp = people.get(app["emp_id"]) or {}
    mgr = approver_for(emp, people)
    v.update(name=emp.get("name", ""), emp_code=emp.get("emp_code", ""), designation=emp.get("designation", ""),
             department=emp.get("department", ""), role=role, manager_name=(people.get(mgr) or {}).get("name", "") if mgr else "HR",
             goals=await _goals(app["emp_id"], app["fy"], role, app.get("stage") == "released"),
             reopen_note=app.get("reopen_note") if role != "owner" or app["stage"] == "self" else None,
             can={"self": role == "owner" and app["stage"] == "self",
                  "manager": app["stage"] == "manager" and _fills_manager_part(app, me, acc, people),
                  "hr": role == "hr" and app["stage"] == "hr",
                  "release": role == "hr" and app["stage"] == "hr",
                  "ack": role == "owner" and app["stage"] == "released" and not app.get("ack"),
                  "letter": app["stage"] == "released" and role in ("owner", "hr"),
                  "reopen": role == "hr" and app["stage"] in ("manager", "hr")},
             ctc_ready=hr_crypto.configured())
    return v


async def _goals(emp_id: str, fy: str, role: str, released: bool) -> Optional[dict]:
    """The year's goal results, pulled in from Goals. The goals year-end
    rating follows its own release rule for the employee."""
    import hr_goals_core
    plan = await db.hr_goals.find_one({"emp_id": emp_id, "fy": fy}, {"_id": 0})
    if not plan:
        return None
    goals_released = bool(await db.hr_goal_release.find_one({"fy": fy}, {"_id": 1}))
    ye = plan.get("year_end") or {}
    return {"count": len(plan.get("goals") or []), "status": plan.get("status"),
            "overall": hr_goals_core.overall(plan.get("goals") or [], hr_goals_core.latest_progress(plan)),
            "items": [{"title": g["title"], "weight": g["weight"]} for g in plan.get("goals") or []],
            "rating": ye.get("rating") if (role != "owner" or goals_released or released) else None}


# ------------------------------------------------------------------- cycle ---
@router.get("/cycle")
async def cycle_get(fy: Optional[str] = None, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    fy = fy or await _default_fy()
    c = await db.hr_appraisal_cycles.find_one({"fy": fy}, {"_id": 0})
    out = {"fy": fy, "cycle": c, "skills": [{"key": k, "label": l, "hint": h} for k, l, h in core.SKILLS],
           "scale": core.SCALE, "questions": [{"key": k, "label": l} for k, l in core.QUESTIONS],
           "stages": core.STAGE_LABEL, "ctc_ready": hr_crypto.configured(), "default_effective": core.default_effective(fy)}
    if acc["hr"] and c:
        counts = {s: 0 for s in core.STAGES}
        async for a in db.hr_appraisals.find({"fy": fy}, {"_id": 0, "stage": 1, "ack": 1}):
            counts[a["stage"]] = counts.get(a["stage"], 0) + 1
        out["progress"] = counts
    return out


async def _default_fy() -> str:
    """The year everyone lands on: the most recently STARTED appraisal (so an
    April 2027 cycle for FY 2026-27 stays the default all through the
    season), else the current financial year."""
    latest = await db.hr_appraisal_cycles.find_one({}, {"_id": 0, "fy": 1}, sort=[("fy", -1)])
    return (latest or {}).get("fy") or hr_core.fiscal_year(_today())


class CycleBody(BaseModel):
    fy: str
    self_due: str
    manager_due: str


@router.post("/cycle")
async def cycle_start(body: CycleBody, user: dict = Depends(require_hr)):
    try:
        hr_core.fy_bounds(body.fy)
        sd, md = date.fromisoformat(body.self_due[:10]), date.fromisoformat(body.manager_due[:10])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e) or "Check the dates.")
    if md < sd:
        raise HTTPException(status_code=400, detail="The manager deadline must be after the self-review deadline.")
    if await db.hr_appraisal_cycles.find_one({"fy": body.fy}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=f"The {body.fy} appraisal has already started.")
    await db.hr_appraisal_cycles.insert_one({"fy": body.fy, "self_due": sd.isoformat(), "manager_due": md.isoformat(),
                                             "started_at": _now().isoformat(), "started_by": user.get("email", "")})
    people, _, _ = await _ctx(user)
    n = 0
    for p in people.values():
        if p.get("status") == "active" and p.get("confirmed_on"):
            n += await _create(p, body.fy, sd.isoformat(), md.isoformat())
    await _audit(user, "HRM_APPRAISAL_STARTED", {"fy": body.fy, "people": n})
    for p in people.values():
        if p.get("status") == "active" and p.get("confirmed_on"):
            await _mail([p.get("work_email")], f"Your {body.fy} appraisal has started",
                        [f"Hi {p.get('name', '').split(' ')[0]}, it's appraisal time.",
                         f"Please fill in your self-review in the HRM by {sd.strftime('%d %b %Y')} — it takes about 10 minutes."])
    return {"ok": True, "people": n}


async def _create(p: dict, fy: str, self_due: str, manager_due: str) -> int:
    if await db.hr_appraisals.find_one({"emp_id": p["id"], "fy": fy}, {"_id": 1}):
        return 0
    try:
        await db.hr_appraisals.insert_one({"id": str(uuid.uuid4()), "emp_id": p["id"], "fy": fy, "stage": "self",
                                           "self": {}, "manager": {}, "hr": {}, "self_due": self_due, "manager_due": manager_due,
                                           "created_at": _now().isoformat(), "history": []})
        return 1
    except Exception:  # noqa: BLE001 — unique (emp_id, fy): created by a parallel request
        return 0


class FyBody(BaseModel):
    fy: str


@router.post("/cycle/remind")
async def cycle_remind(body: FyBody, user: dict = Depends(require_hr)):
    people, _, _ = await _ctx(user)
    sent = 0
    async for a in db.hr_appraisals.find({"fy": body.fy, "stage": {"$in": ["self", "manager"]}}, {"_id": 0}):
        emp = people.get(a["emp_id"]) or {}
        if a["stage"] == "self":
            await _mail([emp.get("work_email")], f"Reminder: your {body.fy} self-review", [f"Please complete your self-review in the HRM (due {a.get('self_due')})."])
        else:
            mgr = approver_for(emp, people)
            await _mail([(people.get(mgr) or {}).get("work_email")] if mgr else _hr_emails(people, emp.get("id", "")),
                        f"Reminder: {emp.get('name')}'s appraisal is waiting for you", [f"Please complete the manager review (due {a.get('manager_due')})."], fallback=True)
        sent += 1
    await _audit(user, "HRM_APPRAISAL_REMINDED", {"fy": body.fy, "count": sent})
    return {"ok": True, "sent": sent}


class AddBody(BaseModel):
    fy: str
    emp_id: str


@router.post("/cycle/add")
async def cycle_add(body: AddBody, user: dict = Depends(require_hr)):
    c = await db.hr_appraisal_cycles.find_one({"fy": body.fy}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Start the appraisal for that year first.")
    people, _, _ = await _ctx(user)
    p = people.get(body.emp_id)
    if not p or p.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not found")
    if not await _create(p, body.fy, c["self_due"], c["manager_due"]):
        raise HTTPException(status_code=409, detail="They're already in this appraisal.")
    await _audit(user, "HRM_APPRAISAL_ADDED", {"fy": body.fy, "person": body.emp_id})
    return {"ok": True}


# ------------------------------------------------------------------- reads ---
@router.get("/mine")
async def appraisal_mine(fy: Optional[str] = None, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="No appraisal.")
    fy = fy or await _default_fy()
    app = await db.hr_appraisals.find_one({"emp_id": me["id"], "fy": fy}, {"_id": 0})
    if not app:
        return {"fy": fy, "appraisal": None}
    return {"fy": fy, "appraisal": await _out(app, "owner", people, user, me, acc, with_ctc=True)}


@router.get("/team")
async def appraisal_team(fy: Optional[str] = None, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not (acc["hr"] or acc["manager"]):
        raise HTTPException(status_code=403, detail="For managers and HR.")
    fy = fy or await _default_fy()
    rows = []
    async for a in db.hr_appraisals.find({"fy": fy}, {"_id": 0}):
        role = _role(a, me, acc, people)
        if role not in ("manager", "hr"):
            continue
        emp = people.get(a["emp_id"]) or {}
        out = core.final_outcome(a) if role == "hr" or a["stage"] == "released" else {}
        rows.append({"id": a["id"], "name": emp.get("name", ""), "emp_code": emp.get("emp_code", ""), "department": emp.get("department", ""),
                     "stage": a["stage"], "self_done": bool(a.get("self_submitted_at")), "manager_done": bool(a.get("manager_submitted_at")),
                     "overall": out.get("overall"), "increment_pct": out.get("increment_pct"),
                     "acknowledged": bool(a.get("ack")), "disagreed": bool((a.get("ack") or {}).get("disagree")),
                     "my_turn": (a["stage"] == "manager" and _fills_manager_part(a, me, acc, people)) or (role == "hr" and a["stage"] == "hr")})
    rows.sort(key=lambda r: (not r["my_turn"], core.STAGES.index(r["stage"]), r["name"]))
    return {"fy": fy, "rows": rows}


@router.get("/{aid}")
async def appraisal_get(aid: str, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    return await _out(app, role, people, user, me, acc, with_ctc=True)


# ------------------------------------------------------------------- edits ---
async def _save(app: dict, upd: dict, user: dict, what: str, expect_stage: str) -> dict:
    step = {"at": _now().isoformat(), "by": user.get("email", ""), "what": what}
    res = await db.hr_appraisals.update_one({"id": app["id"], "stage": expect_stage}, {"$set": upd, "$push": {"history": step}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="This appraisal moved on a moment ago — refresh.")
    await _audit(user, f"HRM_APPRAISAL_{what.upper().replace(' ', '_')}", {"appraisal": app["id"], "person": app["emp_id"], "fy": app["fy"]})
    return await db.hr_appraisals.find_one({"id": app["id"]}, {"_id": 0})


class SelfBody(BaseModel):
    skills: dict = {}
    achievements: Optional[str] = ""
    challenges: Optional[str] = ""
    support: Optional[str] = ""
    submit: bool = False


@router.put("/{aid}/self")
async def appraisal_self(aid: str, body: SelfBody, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    if role != "owner" or app["stage"] != "self":
        raise HTTPException(status_code=409, detail="Your self-review is already submitted.")
    try:
        part = core.clean_self(body.model_dump(), submit=body.submit)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    upd = {"self": part}
    if body.submit:
        upd.update(stage="manager", self_submitted_at=_now().isoformat(), reopen_note=None)
    saved = await _save(app, upd, user, "self submitted" if body.submit else "self saved", "self")
    if body.submit:
        emp = people[app["emp_id"]]
        mgr = approver_for(emp, people)
        await _mail([(people.get(mgr) or {}).get("work_email")] if mgr else _hr_emails(people, emp["id"]),
                    f"Appraisal ready for your review: {emp.get('name')}", [f"{emp.get('name')} has completed their {app['fy']} self-review."], fallback=True)
    return await _out(saved, role, people, user, me, acc, with_ctc=False)


class ManagerBody(BaseModel):
    skills: dict = {}
    overall: Optional[int] = None
    increment_pct: Optional[float] = None
    designation: Optional[str] = ""
    summary: Optional[str] = ""
    submit: bool = False


@router.put("/{aid}/manager")
async def appraisal_manager(aid: str, body: ManagerBody, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    emp = people[app["emp_id"]]
    if not _fills_manager_part(app, me, acc, people):
        raise HTTPException(status_code=403, detail="The reporting manager fills this part.")
    if app["stage"] != "manager":
        raise HTTPException(status_code=409, detail="Not waiting for the manager review.")
    try:
        part = core.clean_manager(body.model_dump(), submit=body.submit)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    part["by"] = user.get("email", "")
    upd = {"manager": part}
    if body.submit:
        upd.update(stage="hr", manager_submitted_at=_now().isoformat(), reopen_note=None)
    saved = await _save(app, upd, user, "manager submitted" if body.submit else "manager saved", "manager")
    if body.submit:
        await _mail(_hr_emails(people, emp["id"]), f"Appraisal to approve: {emp.get('name')} ({app['fy']})",
                    [f"{emp.get('name')}'s manager has proposed a rating of {part['overall']}/5 and an increment of {part['increment_pct']}%."], fallback=True)
    return await _out(saved, role, people, user, me, acc, with_ctc=False)


class HrBody(BaseModel):
    overall: Optional[int] = None
    increment_pct: Optional[float] = None
    designation: Optional[str] = None
    effective_from: Optional[str] = None
    current_ctc: Optional[str] = None
    reason: Optional[str] = ""


@router.put("/{aid}/hr")
async def appraisal_hr(aid: str, body: HrBody, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    if role != "hr" or app["stage"] != "hr":
        raise HTTPException(status_code=403, detail="HR reviews this once the manager has submitted.")
    m, h = app.get("manager") or {}, dict(app.get("hr") or {})
    try:
        if body.overall is not None:
            h["overall"] = core._rating(body.overall, "the overall rating")
        if body.increment_pct is not None:
            h["increment_pct"] = core.clean_pct(body.increment_pct)
        if body.designation is not None:
            h["designation"] = core._txt(body.designation, 120)
        if body.effective_from:
            h["effective_from"] = date.fromisoformat(body.effective_from[:10]).isoformat()
        changed = core.changed_fields(m, h)
        if changed and len((body.reason or h.get("reason") or "").strip()) < 10:
            raise core.Refused("You changed the manager's proposal — say why (at least 10 characters). It's kept on record.")
        if body.reason:
            h["reason"] = core._txt(body.reason, 600)
        if body.current_ctc not in (None, ""):
            if not hr_crypto.configured():
                raise core.Refused("CTC can't be saved yet: HRM_DATA_KEY isn't set in Render (see the HRM guide).")
            cur = core.clean_ctc(body.current_ctc)
            h["current_ctc_enc"] = hr_crypto.encrypt_amount(cur)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError:
        raise HTTPException(status_code=400, detail="Check the effective date.")
    # The revised CTC is NOT stored here: _decrypt_ctc works it out fresh
    # from the current CTC and the final % until release freezes it.
    h.pop("revised_ctc_enc", None)
    h["by"] = user.get("email", "")
    h["at"] = _now().isoformat()
    adj = [{"field": k, "from": m.get(k), "to": h.get(k), "by": user.get("email", ""), "at": h["at"]} for k in core.changed_fields(m, h)]
    h["changes"] = adj
    saved = await _save(app, {"hr": h}, user, "hr saved", "hr")
    if body.current_ctc not in (None, ""):
        await _audit(user, "HRM_CTC_SET", {"appraisal": aid, "person": app["emp_id"]})
    return await _out(saved, role, people, user, me, acc, with_ctc=True)


@router.post("/{aid}/release")
async def appraisal_release(aid: str, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    if role != "hr":
        raise HTTPException(status_code=403, detail="HR / founders approve appraisals.")
    try:
        core.check_release(app)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    h = dict(app.get("hr") or {})
    out = core.final_outcome(app)
    if h.get("current_ctc_enc"):
        # Freeze the revised CTC now, from the final % — this is the figure
        # on the letter and the payroll export from here on.
        ctc = _decrypt_ctc(app)
        if not ctc or "error" in ctc:
            raise HTTPException(status_code=400, detail=CTC_KEY_ERROR)
        h["revised_ctc_enc"] = hr_crypto.encrypt_amount(ctc["revised"])
    h.setdefault("effective_from", out["effective_from"])
    emp = people[app["emp_id"]]
    upd = {"stage": "released", "released_at": _now().isoformat(), "released_by": user.get("email", ""), "hr": h,
           "designation_at_release": emp.get("designation", "")}
    saved = await _save(app, upd, user, "released", "hr")
    await _mail([emp.get("work_email")], f"Your {app['fy']} appraisal is ready",
                ["Your appraisal has been finalised. Open the HRM to see your review and download your letter."])
    await apply_due()
    saved = await db.hr_appraisals.find_one({"id": aid}, {"_id": 0})
    return await _out(saved, role, people, user, me, acc, with_ctc=True)


class ReopenBody(BaseModel):
    part: str           # self | manager
    note: str


@router.post("/{aid}/reopen")
async def appraisal_reopen(aid: str, body: ReopenBody, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    if role != "hr" or app["stage"] not in ("manager", "hr"):
        raise HTTPException(status_code=403, detail="HR can send a part back before the appraisal is shared.")
    if body.part not in ("self", "manager") or (body.part == "manager" and app["stage"] != "hr"):
        raise HTTPException(status_code=400, detail="Send back the self-review, or (once submitted) the manager review.")
    if len((body.note or "").strip()) < 5:
        raise HTTPException(status_code=400, detail="Say what to change.")
    # Sending back keeps what was typed (drafts), just unlocks it again.
    upd = {"stage": body.part, "reopen_note": body.note.strip()[:600], "manager_submitted_at": None}
    if body.part == "self":
        upd["self_submitted_at"] = None
    saved = await _save(app, upd, user, f"reopened {body.part}", app["stage"])
    emp = people[app["emp_id"]]
    mgr = approver_for(emp, people)
    to = [emp.get("work_email")] if body.part == "self" else ([(people.get(mgr) or {}).get("work_email")] if mgr else [])
    await _mail(to, f"Appraisal sent back: {emp.get('name')}", [f"HR sent the {'self-review' if body.part == 'self' else 'manager review'} back: {body.note.strip()}"],
                fallback=body.part == "manager")
    return await _out(saved, role, people, user, me, acc, with_ctc=True)


class AckBody(BaseModel):
    comment: Optional[str] = ""
    disagree: bool = False


@router.post("/{aid}/ack")
async def appraisal_ack(aid: str, body: AckBody, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    if role != "owner" or app["stage"] != "released" or app.get("ack"):
        raise HTTPException(status_code=409, detail="Nothing to acknowledge.")
    if body.disagree and len((body.comment or "").strip()) < 10:
        raise HTTPException(status_code=400, detail="Tell HR what you disagree with (a sentence or two).")
    ack = {"at": _now().isoformat(), "comment": (body.comment or "").strip()[:1000], "disagree": bool(body.disagree)}
    res = await db.hr_appraisals.update_one({"id": aid, "ack": None}, {"$set": {"ack": ack}})   # null or missing
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="Already acknowledged.")
    await _audit(user, "HRM_APPRAISAL_ACKNOWLEDGED", {"appraisal": aid, "disagree": ack["disagree"]})
    if ack["disagree"] or ack["comment"]:
        emp = people[app["emp_id"]]
        await _mail(_hr_emails(people, emp["id"]), f"{'Disagreement' if ack['disagree'] else 'Comment'} on appraisal: {emp.get('name')}",
                    [f"{emp.get('name')} {'disagrees with' if ack['disagree'] else 'commented on'} their {app['fy']} appraisal:", ack["comment"]], fallback=True)
    return {"ok": True, "ack": ack}


# ------------------------------------------------------------------ letter ---
@router.get("/{aid}/letter.pdf")
async def appraisal_letter(aid: str, user: dict = Depends(get_current_user)):
    people, me, acc, app, role = await _load(aid, user)
    if app["stage"] != "released" or role not in ("owner", "hr"):
        raise HTTPException(status_code=404, detail="The letter is available once the appraisal is shared.")
    emp = people.get(app["emp_id"]) or {}
    ctc = _decrypt_ctc(app)
    pdf = await asyncio.to_thread(letter_pdf, app, emp, ctc if ctc and "error" not in ctc else None)
    await _audit(user, "HRM_APPRAISAL_LETTER", {"appraisal": aid, "person": app["emp_id"], "as": role})
    safe = "".join(ch for ch in emp.get("name", "employee") if ch.isalnum() or ch in " -_")[:60].strip() or "employee"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Appraisal {app["fy"]} - {safe}.pdf"', "Cache-Control": "private, no-store"})


def _inr(n: int) -> str:
    """Indian grouping: 1234567 -> 12,34,567."""
    s = str(int(n))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def letter_pdf(app: dict, emp: dict, ctc: Optional[dict]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape
    from inventory_reports import latin

    out = core.final_outcome(app)
    navy = colors.HexColor("#002B5C")
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=navy)
    p = ParagraphStyle("p", fontName="Helvetica", fontSize=10.5, leading=15)
    small = ParagraphStyle("s", fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#4B5563"))
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"Appraisal {app['fy']}", author="Oakbridge Publishing")
    name = escape(latin(emp.get("name", "")))
    eff = date.fromisoformat(out["effective_from"]).strftime("%d %B %Y")
    rows = [["Employee", latin(emp.get("name", ""))], ["Employee ID", emp.get("emp_code") or "-"],
            ["Designation during the year", latin(app.get("designation_at_release") or emp.get("designation") or "-")],
            ["Appraisal year", f"FY {app['fy']}"], ["Overall rating", f"{out['overall']} / 5 - {core.SCALE[out['overall']]}"],
            ["Increment", f"{out['increment_pct']:g}%"]]
    if out["designation"]:
        rows.append(["New designation", latin(out["designation"])])
    if ctc and ctc.get("revised"):
        rows.append(["Revised annual CTC", f"Rs {_inr(ctc['revised'])}"])
    rows.append(["Effective from", eff])
    t = Table(rows, colWidths=[55 * mm, 110 * mm])
    t.setStyle(TableStyle([("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10), ("FONT", (1, 0), (1, -1), "Helvetica", 10),
                           ("TEXTCOLOR", (0, 0), (0, -1), navy), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    summary = escape(latin((app.get("manager") or {}).get("summary") or ""))
    flow = [Paragraph("Oakbridge Publishing Pvt. Ltd.", h1), Spacer(1, 2 * mm),
            Paragraph(_now().strftime("%d %B %Y"), small), Spacer(1, 8 * mm),
            Paragraph(f"Dear {name},", p), Spacer(1, 3 * mm),
            Paragraph(f"Thank you for your contribution during FY {app['fy']}. Following your annual appraisal, "
                      f"we are pleased to confirm the outcome below.", p), Spacer(1, 5 * mm), t, Spacer(1, 6 * mm)]
    if summary:
        flow += [Paragraph("<b>Your manager's summary</b>", p), Spacer(1, 1.5 * mm), Paragraph(summary, p), Spacer(1, 6 * mm)]
    flow += [Paragraph("All other terms of your employment remain unchanged. This letter is confidential.", p), Spacer(1, 14 * mm),
             Paragraph("For Oakbridge Publishing Pvt. Ltd.", p), Spacer(1, 10 * mm), Paragraph("Human Resources", p),
             Spacer(1, 10 * mm), Paragraph("Generated from the Oakbridge HRM.", small)]
    doc.build(flow)
    return buf.getvalue()


# --------------------------------------------------------------- applying ---
async def apply_due(today: Optional[date] = None) -> int:
    """Released appraisals whose effective date has come: write the new
    designation to the employee record (once — applied_at)."""
    today = today or _today()
    n = 0
    async for a in db.hr_appraisals.find({"stage": "released", "applied_at": {"$in": [None]}}, {"_id": 0}):
        out = core.final_outcome(a)
        if out["effective_from"] > today.isoformat():
            continue
        emp = await db.hr_employees.find_one({"id": a["emp_id"]}, {"_id": 0, "designation": 1})
        upd = {"applied_at": _now().isoformat()}
        if out["designation"] and emp:
            upd["designation_before"] = emp.get("designation", "")
            await db.hr_employees.update_one({"id": a["emp_id"]}, {"$set": {"designation": out["designation"]}})
        res = await db.hr_appraisals.update_one({"id": a["id"], "applied_at": {"$in": [None]}}, {"$set": upd})
        n += res.modified_count
    if n:
        await audit_log(db, "HRM_APPRAISALS_APPLIED", email="system", role="system", meta={"count": n})
    return n


async def payroll_rows(month: str) -> dict:
    """{emp_id: (increment %, revised CTC or "")} for appraisals effective in
    `month` — for the RazorpayX export (HR only)."""
    out = {}
    async for a in db.hr_appraisals.find({"stage": "released"}, {"_id": 0}):
        o = core.final_outcome(a)
        if o["effective_from"][:7] == month:
            c = _decrypt_ctc(a) or {}
            out[a["emp_id"]] = (o["increment_pct"], c.get("revised") or "")
    return out


async def ensure_indexes() -> None:
    try:
        await db.hr_appraisals.create_index("id", unique=True)
        await db.hr_appraisals.create_index([("emp_id", 1), ("fy", 1)], unique=True)
        await db.hr_appraisal_cycles.create_index("fy", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("hrm appraisal: index creation failed", exc_info=True)
