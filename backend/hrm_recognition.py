"""HRM recognition: appreciation letters, awards and rewards (Nov 2026).

  * Given by HR / founders / Directors (HR access).
  * The employee sees their own on their screen (with a PDF letter) and is
    emailed; their manager sees the team's; HR sees all.
  * "Share with the team" = a shout-out on everyone's Home: name, title and
    kind ONLY — never the message's private parts or any money.
  * A reward may carry an amount (₹). Only the employee and HR see it.
  * HR can withdraw one given by mistake (kept, hidden, audited).

    GET  /api/hrm/recognition/mine
    GET  /api/hrm/recognition/team          manager: team; HR: everyone
    GET  /api/hrm/recognition/shoutouts     everyone in the HRM (last 90 days)
    POST /api/hrm/recognition               HR: give one
    POST /api/hrm/recognition/{id}/seen     owner: mark as seen (for the celebration pop-up)
    POST /api/hrm/recognition/{id}/withdraw HR
    GET  /api/hrm/recognition/{id}/letter.pdf   owner or HR
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

from audit import audit_log
from extensions import db, get_current_user
from hr_leave_core import approver_for
from hrm import _ctx, _member, require_hr

log = logging.getLogger("oakbridge.hrm.recognition")
router = APIRouter(prefix="/api/hrm/recognition", tags=["hrm"])

KINDS = {"appreciation": "Appreciation letter", "award": "Award", "reward": "Reward"}
BADGES = ("star", "trophy", "rocket", "heart", "medal", "sparkles")   # the icon shown on the card
MAX_AMOUNT = 10_000_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return (_now() + timedelta(hours=5, minutes=30)).date()


def view(r: dict, *, role: str, people: dict) -> dict:
    """owner / hr see everything; manager sees it without the amount;
    shout-out (everyone) sees name + title + kind + badge + date only."""
    emp = people.get(r["emp_id"]) or {}
    base = {"id": r["id"], "emp_id": r["emp_id"], "name": emp.get("name", ""), "kind": r["kind"], "kind_label": KINDS[r["kind"]],
            "title": r["title"], "badge": r.get("badge") or "star", "date": r["date"], "by_name": r.get("by_name", "")}
    if role == "public":
        return {**base, "department": emp.get("department", "")}
    out = {**base, "message": r.get("message", ""), "shout_out": bool(r.get("shout_out")), "seen_at": r.get("seen_at"),
           "designation": emp.get("designation", ""), "department": emp.get("department", "")}
    if role in ("owner", "hr") and r.get("amount"):
        out["amount"] = r["amount"]
    if role == "hr":
        out["by"] = r.get("by")
    return out


@router.get("/mine")
async def rec_mine(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me or me.get("status") != "active":
        return {"rows": []}
    rows = [view(r, role="owner", people=people)
            async for r in db.hr_recognitions.find({"emp_id": me["id"], "withdrawn": {"$in": [None, False]}}, {"_id": 0})]
    rows.sort(key=lambda r: r["date"], reverse=True)
    return {"rows": rows}


@router.get("/team")
async def rec_team(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not (acc["hr"] or acc["manager"]):
        raise HTTPException(status_code=403, detail="For managers and HR.")
    rows = []
    async for r in db.hr_recognitions.find({"withdrawn": {"$in": [None, False]}}, {"_id": 0}):
        if me and r["emp_id"] == me["id"]:
            continue
        emp = people.get(r["emp_id"]) or {}
        if acc["hr"]:
            rows.append(view(r, role="hr", people=people))
        elif me and approver_for(emp, people) == me["id"]:
            rows.append(view(r, role="manager", people=people))
    rows.sort(key=lambda r: r["date"], reverse=True)
    return {"rows": rows, "kinds": KINDS, "badges": BADGES}


@router.get("/shoutouts")
async def rec_shoutouts(user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not _member(me, acc):
        raise HTTPException(status_code=403, detail="Not set up in the HRM.")
    since = (_today() - timedelta(days=90)).isoformat()
    rows = [view(r, role="public", people=people)
            async for r in db.hr_recognitions.find({"shout_out": True, "withdrawn": {"$in": [None, False]}, "date": {"$gte": since}}, {"_id": 0})
            if (people.get(r["emp_id"]) or {}).get("status") == "active"]
    rows.sort(key=lambda r: r["date"], reverse=True)
    return {"rows": rows[:12]}


class GiveBody(BaseModel):
    emp_id: str
    kind: str
    title: str
    message: str
    badge: Optional[str] = "star"
    amount: Optional[float] = None
    shout_out: bool = False
    date: Optional[str] = None


@router.post("")
async def rec_give(body: GiveBody, user: dict = Depends(require_hr)):
    people, me, acc = await _ctx(user)
    emp = people.get(body.emp_id)
    if not emp or emp.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not found")
    if me and emp["id"] == me["id"]:
        raise HTTPException(status_code=400, detail="You can't give yourself one — ask another HR person or founder.")
    if body.kind not in KINDS:
        raise HTTPException(status_code=400, detail="Choose appreciation letter, award or reward.")
    title, msg = " ".join((body.title or "").split())[:120], (body.message or "").strip()[:3000]
    if len(title) < 3:
        raise HTTPException(status_code=400, detail="Give it a title, e.g. “Star of the month”.")
    if len(msg) < 20:
        raise HTTPException(status_code=400, detail="Write a few words of appreciation (20+ characters) — it's what they'll remember.")
    amount = None
    if body.amount not in (None, 0):
        if body.kind != "reward":
            raise HTTPException(status_code=400, detail="Only a reward carries an amount.")
        if not (0 < float(body.amount) <= MAX_AMOUNT) or float(body.amount) != int(body.amount):
            raise HTTPException(status_code=400, detail="Amount must be whole rupees.")
        amount = int(body.amount)
    try:
        on = date.fromisoformat((body.date or _today().isoformat())[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Check the date.")
    doc = {"id": str(uuid.uuid4()), "emp_id": emp["id"], "kind": body.kind, "title": title, "message": msg,
           "badge": body.badge if body.badge in BADGES else "star", "amount": amount, "shout_out": bool(body.shout_out),
           "date": on.isoformat(), "by": user.get("email", ""), "by_name": (me or {}).get("name") or "Oakbridge HR", "at": _now().isoformat()}
    await db.hr_recognitions.insert_one(dict(doc))
    await audit_log(db, "HRM_RECOGNITION_GIVEN", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"recognition": doc["id"], "person": emp["id"], "kind": body.kind, "amount": amount, "shout_out": doc["shout_out"]})
    try:
        import html
        import os
        from emailer import send_email
        site = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")
        first = (emp.get("name") or "there").split(" ")[0]
        await send_email(to=emp.get("work_email"), subject=f"🎉 {title} — well done, {first}!",
                         html=f"<div style='font-family:Arial,sans-serif;color:#002B5C;max-width:560px'>"
                              f"<p style='font-size:15px'>Hi {html.escape(first)},</p>"
                              f"<p style='font-size:15px;line-height:1.5'>{html.escape(doc['by_name'])} has recognised you with "
                              f"<b>{html.escape(KINDS[body.kind].lower())}: {html.escape(title)}</b>.</p>"
                              f"<blockquote style='border-left:4px solid #F5B841;margin:0;padding:6px 14px;font-size:15px;line-height:1.5'>{html.escape(msg)}</blockquote>"
                              f"<p><a href='{site}/hrm' style='background:#002B5C;color:#fff;padding:10px 20px;text-decoration:none;display:inline-block;margin-top:14px'>See it in the HRM</a></p></div>")
    except Exception:  # noqa: BLE001
        log.exception("hrm recognition: mail failed")
    return view(doc, role="hr", people=people)


@router.post("/{rid}/seen")
async def rec_seen(rid: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    if not me:
        raise HTTPException(status_code=404, detail="Not found")
    await db.hr_recognitions.update_one({"id": rid, "emp_id": me["id"], "seen_at": None}, {"$set": {"seen_at": _now().isoformat()}})
    return {"ok": True}


@router.post("/{rid}/withdraw")
async def rec_withdraw(rid: str, user: dict = Depends(require_hr)):
    r = await db.hr_recognitions.find_one({"id": rid}, {"_id": 0})
    if not r or r.get("withdrawn"):
        raise HTTPException(status_code=404, detail="Not found")
    await db.hr_recognitions.update_one({"id": rid}, {"$set": {"withdrawn": True, "withdrawn_by": user.get("email", ""), "withdrawn_at": _now().isoformat()}})
    await audit_log(db, "HRM_RECOGNITION_WITHDRAWN", email=user.get("email", ""), role=user.get("role", ""), meta={"recognition": rid})
    return {"ok": True}


@router.get("/{rid}/letter.pdf")
async def rec_letter(rid: str, user: dict = Depends(get_current_user)):
    people, me, acc = await _ctx(user)
    r = await db.hr_recognitions.find_one({"id": rid, "withdrawn": {"$in": [None, False]}}, {"_id": 0})
    if not r or not _member(me, acc) or not (acc["hr"] or (me and r["emp_id"] == me["id"])):
        raise HTTPException(status_code=404, detail="Not found")
    emp = people.get(r["emp_id"]) or {}
    from hr_letters import letter_pdf
    rows = [["Recognition", f"{KINDS[r['kind']]}: {r['title']}"], ["Date", date.fromisoformat(r["date"]).strftime("%d %B %Y")]]
    if r.get("amount"):
        rows.append(["Reward", f"Rs {r['amount']:,}"])
    pdf = await asyncio.to_thread(letter_pdf, title=f"Letter of appreciation - {r['title']}", heading="Letter of appreciation",
                                  to_name=emp.get("name", ""), paragraphs=[r.get("message", ""), "Thank you for your dedication — keep up the great work."],
                                  rows=rows, sign_off=r.get("by_name") or "Human Resources")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="Appreciation letter.pdf"', "Cache-Control": "private, no-store"})
