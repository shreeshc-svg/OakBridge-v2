"""
Automated newsletter — Admin -> Marketing -> Newsletter.

The admin sets how often (weekly / every two weeks / monthly), which day and
time (IST), and whether each issue needs approval. The background tick
(nl_tick, every ~10 minutes, run by the worker) then, for the next slot:

  1. `lead_days` before it, builds the issue from the catalogue (new releases
     since the last issue, readers' favourites, optional announcement) as an
     ordinary DRAFT campaign — editable in Campaigns like any other;
  2. if there is nothing new, SKIPS the issue (never an empty newsletter) and
     tells the admin;
  3. approve mode: waits for an admin's Approve; autopilot: approves itself;
  4. approved issues go through marketing.queue_send — the same checks as the
     Send button (consent, suppression, mailbox checks, risk rules, bounce
     guard) — scheduled for the slot;
  5. a draft nobody approved before its slot is marked MISSED, never sent late.

DPDP: only contacts with marketing consent receive it (audience_filter always
applies consent + suppression); waitlist sign-ups are not newsletter consent
(marketing.is_waitlist_source); every email carries one-click unsubscribe.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import jobs as _jobs
import marketing as mk
import newsletter_core as core
from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/marketing/newsletter", tags=["newsletter"], dependencies=[Depends(require_admin)])
NOT_A_BOOK = {"product_type": {"$nin": ["hamper", "pack"]}}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


async def get_config() -> dict:
    doc = await db.integrations.find_one({"key": "newsletter"}, {"_id": 0}) or {}
    try:
        return core.validate(doc)
    except ValueError:
        return core.validate({})


_indexed = False


async def _ensure() -> None:
    global _indexed
    if not _indexed:
        _indexed = True
        try:
            await db.newsletter_issues.create_index("slot", unique=True)  # one issue per send slot, even with 2 ticks
            await db.newsletter_issues.create_index("created_at")
        except Exception:  # noqa: BLE001
            log.warning("newsletter: index creation failed", exc_info=True)


async def _last_issue() -> Optional[dict]:
    return await db.newsletter_issues.find_one({}, {"_id": 0}, sort=[("slot", -1)])


async def _content(since: Optional[str], cfg: dict) -> tuple:
    """(new releases since the last issue, curated bestsellers) — public,
    enabled books only, never hampers/packs."""
    featured = set()
    async for i in db.newsletter_issues.find({"status": {"$in": ["approved", "sent"]}}, {"_id": 0, "new_ids": 1}):
        featured.update(i.get("new_ids") or [])
    base = {**NOT_A_BOOK, "enabled": {"$ne": False}}
    new_q = {**base, "$or": [{"new_release": True}] + ([{"created_at": {"$gte": since}}] if since else [])}
    proj = {"_id": 0, "id": 1, "title": 1, "author": 1, "price": 1, "cover_image": 1, "created_at": 1}
    new_books = [b for b in await db.books.find(new_q, proj).sort("created_at", -1).limit(40).to_list(40)
                 if b.get("id") not in featured][: cfg["max_books"]]
    doc = await db.settings.find_one({"key": "home_bestsellers"}, {"_id": 0, "value": 1})
    ids = [str(x) for x in ((doc or {}).get("value") or []) if x][:20]
    best = {b["id"]: b async for b in db.books.find({**base, "id": {"$in": ids}}, proj)} if ids else {}
    return new_books, [best[i] for i in ids if i in best]


async def build_draft(slot: datetime, cfg: dict, *, by: str = "system") -> dict:
    """Create the issue for `slot`: a draft campaign, or a skipped record."""
    await _ensure()
    last = await db.newsletter_issues.find_one({"status": {"$in": ["approved", "sent"]}}, {"_id": 0, "slot": 1}, sort=[("slot", -1)])
    new_books, best = await _content((last or {}).get("slot"), cfg)
    iss = core.build_issue(cfg, new_books=new_books, best_books=best, slot=slot, site=mk.SITE, cover_base=mk.PUBLIC_API)
    issue = {"id": str(uuid.uuid4()), "slot": slot.isoformat(), "created_at": mk._iso(), "created_by": by,
             "counts": iss["counts"], "new_ids": iss["new_ids"], "book_ids": iss["book_ids"], "campaign_id": None}
    if not iss["enough"]:
        issue.update(status="skipped", reason=iss["reason"])
    else:
        name = f"Newsletter — {slot.astimezone(core.IST).strftime('%d %b %Y')}"
        audience = {"list_ids": [], "rules": [{"type": "source", "value": "newsletter"}] if cfg["audience"] == "newsletter_only" else [],
                    "statuses": ["verified", "valid", "risky"]}
        cid = str(uuid.uuid4())
        await db.mk_campaigns.insert_one({
            "id": cid, "name": name, "channel": "email", "kind": "newsletter", "subject": iss["subject"],
            "preheader": iss["preheader"], "blocks": iss["blocks"], "links": mk.core.collect_links(iss["blocks"]),
            "audience": audience, "wa_template": "", "wa_language": "en", "wa_variables": [], "status": "draft",
            "created_at": mk._iso(), "created_by": by, "stats": {}, "newsletter_issue": issue["id"]})
        issue.update(status="drafted", campaign_id=cid)
    try:
        await db.newsletter_issues.insert_one(dict(issue))
    except Exception as e:  # noqa: BLE001 — another tick built this slot first
        if "E11000" in str(e) or "duplicate key" in str(e).lower():
            if issue.get("campaign_id"):
                await db.mk_campaigns.delete_one({"id": issue["campaign_id"], "status": "draft"})
            return await db.newsletter_issues.find_one({"slot": issue["slot"]}, {"_id": 0})
        raise
    when = slot.astimezone(core.IST).strftime("%a %d %b, %H:%M IST")
    if issue["status"] == "skipped":
        await mk.raise_alert("newsletter", f"Newsletter for {when} skipped: {issue['reason']}.", key=f"newsletter:{issue['id']}")
    elif cfg["mode"] == "approve":
        await mk.raise_alert("newsletter", f"Newsletter for {when} is ready — review and approve it in Marketing → Newsletter.",
                             key=f"newsletter:{issue['id']}")
    await audit_log(db, "NEWSLETTER_ISSUE_BUILT", email=by, role="system" if by == "system" else "admin",
                    meta={"issue": issue["id"], "status": issue["status"], "slot": issue["slot"]})
    return issue


async def approve(issue: dict, *, by_email: str, by_role: str) -> dict:
    slot = _dt(issue["slot"])
    if slot <= _now():
        raise HTTPException(status_code=409, detail="Its send time has passed — duplicate the campaign and send it manually if you still want it")
    c = await db.mk_campaigns.find_one({"id": issue.get("campaign_id")}, {"_id": 0})
    if not c or c.get("status") != "draft":
        raise HTTPException(status_code=409, detail="The issue's campaign is no longer a draft")
    r = await mk.queue_send(c, slot.isoformat(), by_email=by_email, by_role=by_role)
    await db.newsletter_issues.update_one({"id": issue["id"]}, {"$set": {"status": "approved", "approved_by": by_email, "approved_at": mk._iso(),
                                                                         "recipients": r.get("recipients")}})
    await db.mk_alerts.update_many({"key": f"newsletter:{issue['id']}", "resolved": False}, {"$set": {"resolved": True, "resolved_at": mk._iso()}})
    return r


async def tick() -> dict:
    """Run by the worker every ~10 minutes (marketing.periodic -> nl_tick)."""
    cfg = await get_config()
    await _ensure()
    out = {"enabled": cfg["enabled"]}
    now = _now()
    # Drafts nobody approved before their slot: missed, never sent late.
    async for i in db.newsletter_issues.find({"status": "drafted", "slot": {"$lte": now.isoformat()}}, {"_id": 0}):
        await db.newsletter_issues.update_one({"id": i["id"], "status": "drafted"}, {"$set": {"status": "missed"}})
        await mk.raise_alert("newsletter", "A newsletter issue was not approved before its send time and was not sent.",
                             key=f"newsletter:{i['id']}")
    # Approved issues: mark sent once their campaign has finished.
    async for i in db.newsletter_issues.find({"status": "approved"}, {"_id": 0, "id": 1, "campaign_id": 1}):
        c = await db.mk_campaigns.find_one({"id": i.get("campaign_id")}, {"_id": 0, "status": 1})
        if c and c.get("status") in ("sent", "cancelled"):
            await db.newsletter_issues.update_one({"id": i["id"]}, {"$set": {"status": "sent" if c["status"] == "sent" else "cancelled"}})
    if not cfg["enabled"]:
        return out
    last = await _last_issue()
    slot = core.next_slot(cfg, now, last_slot=_dt((last or {}).get("slot")))
    out["next_slot"] = slot.isoformat()
    existing = await db.newsletter_issues.find_one({"slot": slot.isoformat()}, {"_id": 0})
    if not existing and now >= slot - timedelta(days=cfg["lead_days"]):
        existing = await build_draft(slot, cfg)
        out["built"] = existing.get("status") if existing else None
    if existing and existing.get("status") == "drafted" and cfg["mode"] == "autopilot":
        try:
            await approve(existing, by_email="autopilot", by_role="system")
            out["approved"] = True
        except HTTPException as e:
            await mk.raise_alert("newsletter", f"Autopilot could not send the newsletter: {e.detail}", key=f"newsletter:{existing['id']}")
    return out


@_jobs.handler("nl_tick")
async def _job_tick(p: dict) -> None:
    await tick()


# ------------------------------------------------------------------ admin ---
class ConfigBody(BaseModel):
    enabled: Optional[bool] = None
    frequency: Optional[str] = None
    weekday: Optional[int] = None
    week_of_month: Optional[int] = None
    time: Optional[str] = None
    lead_days: Optional[int] = None
    mode: Optional[str] = None
    audience: Optional[str] = None
    sections: Optional[dict] = None
    max_books: Optional[int] = None
    min_items: Optional[int] = None
    subject: Optional[str] = None
    preheader: Optional[str] = None
    intro: Optional[str] = None
    announcement: Optional[dict] = None


@router.get("")
async def nl_overview():
    cfg = await get_config()
    await _ensure()
    last = await _last_issue()
    nxt = core.next_slot(cfg, _now(), last_slot=_dt((last or {}).get("slot")))
    issues = await db.newsletter_issues.find({}, {"_id": 0}).sort("slot", -1).limit(12).to_list(12)
    for i in issues:
        c = await db.mk_campaigns.find_one({"id": i.get("campaign_id")}, {"_id": 0, "status": 1, "stats": 1, "name": 1}) if i.get("campaign_id") else None
        i["campaign"] = c
    audience = await db.mk_contacts.count_documents({"email_consent.status": "subscribed", "suppressed": {"$in": [None, ""]},
                                                    **({"source": "newsletter"} if cfg["audience"] == "newsletter_only" else {})})
    return {"config": cfg, "describe": core.describe(cfg), "next_slot": nxt.isoformat(),
            "draft_at": (nxt - timedelta(days=cfg["lead_days"])).isoformat(), "issues": issues, "audience_now": audience}


@router.put("")
async def nl_save(body: ConfigBody, user: dict = Depends(require_superadmin)):
    """Superadmin: this decides what goes to every subscriber, and how often."""
    cur = await get_config()
    try:
        cfg = core.validate({**cur, **{k: v for k, v in body.model_dump().items() if v is not None}})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.integrations.update_one({"key": "newsletter"}, {"$set": {"key": "newsletter", **cfg, "updated_at": mk._iso(),
                                                                     "updated_by": user.get("email", "")}}, upsert=True)
    await audit_log(db, "NEWSLETTER_SETTINGS", email=user.get("email", ""), role=user.get("role", ""),
                    meta={k: cfg[k] for k in ("enabled", "frequency", "weekday", "week_of_month", "time", "mode", "audience")})
    return await nl_overview()


@router.post("/draft-now")
async def nl_draft_now(user: dict = Depends(require_admin)):
    """Build the next issue's draft right away (to preview it early)."""
    cfg = await get_config()
    last = await _last_issue()
    slot = core.next_slot(cfg, _now(), last_slot=_dt((last or {}).get("slot")))
    existing = await db.newsletter_issues.find_one({"slot": slot.isoformat()}, {"_id": 0})
    return existing or await build_draft(slot, cfg, by=user.get("email", ""))


@router.post("/issues/{iid}/approve")
async def nl_approve(iid: str, user: dict = Depends(require_admin)):
    i = await db.newsletter_issues.find_one({"id": iid}, {"_id": 0})
    if not i:
        raise HTTPException(status_code=404, detail="Issue not found")
    if i.get("status") != "drafted":
        raise HTTPException(status_code=409, detail=f"This issue is {i.get('status')}, not waiting for approval")
    return await approve(i, by_email=user.get("email", ""), by_role=user.get("role", ""))


@router.post("/issues/{iid}/skip")
async def nl_skip(iid: str, user: dict = Depends(require_admin)):
    i = await db.newsletter_issues.find_one({"id": iid}, {"_id": 0})
    if not i or i.get("status") != "drafted":
        raise HTTPException(status_code=409, detail="Only an issue waiting for approval can be skipped")
    await db.newsletter_issues.update_one({"id": iid}, {"$set": {"status": "skipped", "reason": f"skipped by {user.get('email', '')}"}})
    await db.mk_campaigns.update_one({"id": i.get("campaign_id"), "status": "draft"}, {"$set": {"deleted": True, "deleted_at": mk._iso()}})
    await db.mk_alerts.update_many({"key": f"newsletter:{iid}", "resolved": False}, {"$set": {"resolved": True}})
    await audit_log(db, "NEWSLETTER_ISSUE_SKIPPED", email=user.get("email", ""), role=user.get("role", ""), meta={"issue": iid})
    return {"ok": True}
