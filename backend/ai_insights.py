"""AI insights + "Do this next" for Admin → Marketing (Oct 2026).

Endpoints (all Admin → Marketing permission):

  GET  /api/admin/marketing/ai/growth?days|start|end   Growth: what changed and why
  GET  /api/admin/marketing/ai/campaign/{id}           one campaign vs your average
  GET  /api/admin/marketing/ai/deliverability          list health, bounces, AWS limits
  POST /api/admin/marketing/ai/subject                 subject-line check + 3 alternatives
  GET  /api/admin/marketing/ai/next-actions            the campaigns most likely to sell now
  POST /api/admin/marketing/ai/next-actions/{key}/create   -> list + draft campaign
  GET/PUT /api/admin/marketing/ai/settings              on / off (PUT: superadmin)

How it stays trustworthy (ai_core.py has the details): code computes every
number and finding; the model only rewrites them in plain English; its reply
is rejected if it contains a number that is not in the facts; only totals are
ever sent to the model (no email addresses, names or phone numbers); when the
model is off, down, slow or wrong, the card shows the code's findings. A
result is reused while the facts are unchanged (24 h), so opening a page does
not call the model again.

"Do this next" is entirely code: who is in each audience is decided by our
orders and consent records, never by the model. Creating one makes a normal
static list and a DRAFT campaign — nothing is sent until someone presses Send
in the campaign, with every existing consent and bounce rule still applied.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import ai_core as ai
import llm
import marketing as mk
import marketing_core as core
from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger("ai_insights")
admin_router = APIRouter(prefix="/api/admin/marketing/ai", tags=["marketing-ai"], dependencies=[Depends(require_admin)])

SETTINGS_KEY = "ai_insights"
CACHE_HOURS = 24
MIN_REGEN_SECONDS = 60
LLM_WAIT = 30                     # the card must not hang on a slow model
NEXT_ACTION_MIN = 5               # don't suggest a campaign for 3 people
RECENTLY_MAILED_DAYS = 3          # nobody gets two marketing emails in 3 days


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _enabled() -> bool:
    d = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0, "enabled": 1}) or {}
    return d.get("enabled", True) is not False


async def _explain(area: str, scope: str, facts: dict, findings: list, actions: list, refresh: bool) -> dict:
    """The model's wording of `findings` if it passes the checks, else the
    findings themselves. Cached by the facts, so unchanged numbers are never
    re-sent."""
    ai.assert_no_pii(facts)
    h = ai.facts_hash(area, facts)
    key = f"{area}:{scope}"
    cached = await db.ai_insights.find_one({"key": key}, {"_id": 0})
    fresh_enough = cached and cached.get("at", "") >= (_now() - timedelta(hours=CACHE_HOURS)).isoformat()
    if cached and cached.get("hash") == h and fresh_enough and not refresh:
        return cached["out"]
    if refresh and cached and cached.get("at", "") >= (_now() - timedelta(seconds=MIN_REGEN_SECONDS)).isoformat():
        return cached["out"]          # double-clicked Regenerate: no second model call
    base = ai.fallback(findings, actions)
    out = {"area": area, "ai": False, "insight": base, "facts": facts, "generated_at": _now().isoformat(), "note": ""}
    if not await _enabled():
        out["note"] = "AI summaries are switched off — showing the figures only."
    else:
        t0 = time.monotonic()
        try:
            reply = await asyncio.wait_for(llm.generate(ai.SYSTEM, ai.prompt_for(area, facts, findings), 0.2), LLM_WAIT)
            good, why = ai.validate_insight(ai.parse_json(reply), facts)
            if good:
                # The code's suggested actions stay if the model gave none.
                good["actions"] = good["actions"] or base["actions"]
                out.update(ai=True, insight=good)
            else:
                out["note"] = "The AI summary didn't pass our checks, so the figures are shown as they are."
                log.info("ai %s rejected: %s", area, why)
        except (asyncio.TimeoutError, llm.LLMError, Exception) as e:  # noqa: BLE001
            out["note"] = "The AI summary is unavailable right now — showing the figures only."
            log.warning("ai %s failed: %s", area, str(e)[:200])
        out["ms"] = int((time.monotonic() - t0) * 1000)
    await db.ai_insights.update_one({"key": key}, {"$set": {"key": key, "area": area, "hash": h, "out": out,
                                                            "at": out["generated_at"], "ai": out["ai"]}}, upsert=True)
    return out


# ---------------------------------------------------------------- growth ---
@admin_router.get("/growth")
async def ai_growth(days: int = 30, start: Optional[str] = None, end: Optional[str] = None, refresh: bool = False):
    import growth as g

    now = await g.adm_funnel(days=days, start=start, end=end)
    ins = await g.adm_insights(days=days, start=start, end=end)
    prev = None
    if not now.get("empty") and now.get("since") and now.get("until"):
        a = datetime.strptime(now["since"], "%Y-%m-%d")
        b = datetime.strptime(now["until"], "%Y-%m-%d")
        span = (b - a).days + 1
        pe = a - timedelta(days=1)
        ps = pe - timedelta(days=span - 1)
        prev = await g.adm_funnel(days=span, start=ps.strftime("%Y-%m-%d"), end=pe.strftime("%Y-%m-%d"))
        if prev.get("since") != ps.strftime("%Y-%m-%d"):
            prev = None   # counting began inside that period: not a like-for-like comparison
    facts = ai.growth_facts(now, prev, ins)
    findings, actions = ai.growth_findings(facts)
    return await _explain("growth", f"{facts['period']['from']}_{facts['period']['to']}", facts, findings, actions, refresh)


# -------------------------------------------------------------- campaign ---
async def _baseline(exclude: str) -> dict:
    tot = {"sent": 0, "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0, "unsubscribed": 0}
    async for c in db.mk_campaigns.find({"channel": "email", "deleted": {"$ne": True}, "id": {"$ne": exclude},
                                         "status": {"$in": ["sent", "sending", "paused"]}, "stats.sent": {"$gte": 20}},
                                        {"_id": 0, "stats": 1}).sort("started_at", -1).limit(20):
        for k in tot:
            tot[k] += int((c.get("stats") or {}).get(k) or 0)
    d = tot["delivered"] or tot["sent"]
    return {"open": ai.pct(tot["opened"], d), "click": ai.pct(tot["clicked"], d), "ctor": ai.pct(tot["clicked"], tot["opened"]),
            "bounce": ai.pct(tot["bounced"], tot["sent"]), "unsubscribe": ai.pct(tot["unsubscribed"], d)}


@admin_router.get("/campaign/{cid}")
async def ai_campaign(cid: str, refresh: bool = False):
    report = await mk.adm_report(cid)
    facts = ai.campaign_facts(report, await _baseline(cid))
    findings, actions = ai.campaign_findings(facts)
    return await _explain("campaign", cid, facts, findings, actions, refresh)


# -------------------------------------------------------- deliverability ---
@admin_router.get("/deliverability")
async def ai_deliverability(refresh: bool = False):
    dash = await mk.adm_dashboard(30)
    try:
        health = await mk.adm_health()
    except Exception:  # noqa: BLE001
        health = {}
    rows = await db.mk_domains.find({"bad_provider": True}, {"_id": 0, "domain": 1, "bad_provider": 1}).to_list(50)
    facts = ai.deliverability_facts(dash.get("kpi") or {}, dash.get("verification") or {}, dash.get("accuracy") or {},
                                    {"rows": rows}, health or {})
    findings, actions = ai.deliverability_findings(facts)
    return await _explain("deliverability", "30d", facts, findings, actions, refresh)


# --------------------------------------------------------------- subject ---
class SubjectBody(BaseModel):
    subject: str
    preheader: Optional[str] = ""
    about: Optional[str] = ""          # e.g. the books in the email


@admin_router.post("/subject")
async def ai_subject(body: SubjectBody):
    subject, pre, about = (body.subject or "")[:200], (body.preheader or "")[:200], (body.about or "")[:400]
    out = {"checks": ai.subject_checks(subject, pre), "suggestions": [], "preheader": "", "ai": False, "note": ""}
    if not subject.strip():
        return out
    if not await _enabled():
        out["note"] = "AI suggestions are switched off."
        return out
    try:
        reply = await asyncio.wait_for(llm.generate("You write honest, specific email subject lines for a book publisher. "
                                                    "Reply with JSON only.", ai.subject_prompt(subject, pre, about), 0.7), LLM_WAIT)
        good, why = ai.validate_subjects(ai.parse_json(reply), subject, pre, about)
        if good:
            out.update(suggestions=good["subjects"], preheader=good["preheader"], ai=True)
        else:
            out["note"] = "No suggestion passed our checks (they may not add offers, prices or deadlines). Try again."
            log.info("ai subject rejected: %s", why)
    except (asyncio.TimeoutError, llm.LLMError, Exception) as e:  # noqa: BLE001
        out["note"] = "AI suggestions are unavailable right now."
        log.warning("ai subject failed: %s", str(e)[:200])
    return out


# ---------------------------------------------------------- next actions ---
def _added_at(doc: dict) -> Optional[datetime]:
    t = getattr(doc.get("_id"), "generation_time", None)
    return t if isinstance(t, datetime) else None


async def _opportunities() -> list:
    """Who would most likely buy now — from our orders and consent only.
    Each: {key, title, why, audience, contact_ids, books}. contact_ids never
    leave the server."""
    now = _now()
    mailable: dict = {}
    async for c in db.mk_contacts.find({"email_consent.status": "subscribed", "suppressed": {"$in": [None, ""]},
                                        "email_status": {"$nin": ["invalid", "suppressed"]}},
                                       {"_id": 0, "id": 1, "email_norm": 1, "created_at": 1}).limit(100000):
        if c.get("email_norm"):
            mailable[c["email_norm"]] = c
    recent = {s["contact_id"] async for s in db.mk_sends.find(
        {"sent_at": {"$gte": (now - timedelta(days=RECENTLY_MAILED_DAYS)).isoformat()}, "contact_id": {"$exists": True}},
        {"_id": 0, "contact_id": 1})}
    books = {}
    async for b in db.books.find({"product_type": {"$nin": ["hamper", "pack"]}, "enabled": {"$ne": False}},
                                 {"id": 1, "title": 1, "subject": 1, "category": 1, "stock": 1, "coming_soon": 1, "launch_at": 1}):
        books[b["id"]] = b
    buyers: dict = {}   # email_norm -> {last, books, subjects}
    since = (now - timedelta(days=730)).isoformat()
    async for o in db.orders.find({"payment_status": "paid", "created_at": {"$gte": since}},
                                  {"_id": 0, "email": 1, "created_at": 1, "items.book_id": 1}):
        e = core.normalise_email(o.get("email") or "")
        if not e:
            continue
        p = buyers.setdefault(e, {"last": "", "books": set(), "subjects": set()})
        p["last"] = max(p["last"], o.get("created_at") or "")
        for it in o.get("items") or []:
            b = books.get(it.get("book_id"))
            p["books"].add(it.get("book_id"))
            if b:
                p["subjects"].add(b.get("subject") or b.get("category") or "")

    def ok(e):
        c = mailable.get(e)
        return c if c and c["id"] not in recent else None

    out = []
    # 1. New books (added in the last 45 days, or live pre-orders) to readers of the same subject.
    from launch_time import parse_launch_at
    fresh = []
    for b in books.values():
        at = _added_at(b)
        la = parse_launch_at(b.get("launch_at"))
        pre = bool(b.get("coming_soon")) and la and la > now
        if ((at and at >= now - timedelta(days=45)) or pre) and ((b.get("stock") or 0) > 0 or pre):
            fresh.append((b, pre))
    by_subject: dict = {}
    for b, pre in fresh:
        subj = b.get("subject") or b.get("category") or ""
        if subj:
            by_subject.setdefault(subj, []).append((b, pre))
    for subj, items in by_subject.items():
        ids = {b["id"] for b, _ in items}
        aud = [ok(e)["id"] for e, p in buyers.items() if subj in p["subjects"] and not (p["books"] & ids) and ok(e)]
        if len(aud) >= NEXT_ACTION_MIN:
            titles = [b["title"] for b, _ in items][:3]
            slug = "".join(ch if ch.isalnum() else "-" for ch in subj.lower()).strip("-")[:40]
            out.append({"key": f"new-{slug}", "kind": "new_release",
                        "title": f"New in {subj}: tell past {subj} readers",
                        "why": f"{len(aud)} subscribed readers bought {subj} before and don't have "
                               f"{', '.join(titles)}{' (pre-order)' if any(p for _, p in items) else ''} yet.",
                        "audience": len(aud), "contact_ids": aud, "books": titles})
    # 2. Lapsed buyers: last paid order 6–18 months ago.
    lo, hi = (now - timedelta(days=540)).isoformat(), (now - timedelta(days=180)).isoformat()
    aud = [ok(e)["id"] for e, p in buyers.items() if lo <= p["last"] <= hi and ok(e)]
    if len(aud) >= NEXT_ACTION_MIN:
        out.append({"key": "win-back", "kind": "win_back", "title": "Win back readers who stopped buying",
                    "why": f"{len(aud)} subscribed readers last ordered 6–18 months ago. A 'Picked for you' email shows each "
                           "one the new books closest to what they bought.", "audience": len(aud), "contact_ids": aud, "books": []})
    # 3. Recent buyers (14–60 days): the next book.
    lo, hi = (now - timedelta(days=60)).isoformat(), (now - timedelta(days=14)).isoformat()
    aud = [ok(e)["id"] for e, p in buyers.items() if lo <= p["last"] <= hi and ok(e)]
    if len(aud) >= NEXT_ACTION_MIN:
        out.append({"key": "next-book", "kind": "cross_sell", "title": "Suggest the next book to recent buyers",
                    "why": f"{len(aud)} subscribed readers bought in the last 2 months — the best moment for a personal "
                           "recommendation.", "audience": len(aud), "contact_ids": aud, "books": []})
    # 4. Subscribed but never bought.
    old = (now - timedelta(days=14)).isoformat()
    aud = [c["id"] for e, c in mailable.items() if e not in buyers and (c.get("created_at") or "") <= old and c["id"] not in recent]
    if len(aud) >= NEXT_ACTION_MIN:
        out.append({"key": "first-order", "kind": "first_order", "title": "Turn subscribers into first-time buyers",
                    "why": f"{len(aud)} people subscribed over 2 weeks ago and have never ordered.",
                    "audience": len(aud), "contact_ids": aud, "books": []})
    out.sort(key=lambda a: -a["audience"])
    return out[:6]


async def _results(key: str) -> Optional[dict]:
    """What the last campaign made from this suggestion brought in."""
    c = await db.mk_campaigns.find_one({"ai_action": key, "deleted": {"$ne": True}, "started_at": {"$exists": True}},
                                       {"_id": 0, "id": 1, "name": 1, "stats": 1, "started_at": 1}, sort=[("started_at", -1)])
    if not c:
        return None
    s = c.get("stats") or {}
    return {"campaign_id": c["id"], "sent": s.get("sent", 0), "opened": s.get("opened", 0), "paid": s.get("paid", 0),
            "revenue": round(float(s.get("revenue") or 0)), "started_at": c.get("started_at")}


@admin_router.get("/next-actions")
async def ai_next_actions():
    acts = await _opportunities()
    return {"actions": [{k: v for k, v in a.items() if k != "contact_ids"} | {"last": await _results(a["key"])} for a in acts]}


@admin_router.post("/next-actions/{key}/create")
async def ai_create_from_action(key: str, user: dict = Depends(require_admin)):
    """Recomputed here — the audience is never taken from the browser."""
    act = next((a for a in await _opportunities() if a["key"] == key), None)
    if not act:
        raise HTTPException(status_code=404, detail="That suggestion is no longer current — refresh the list.")
    stamp = _now().strftime("%d %b %Y")
    lst = {"id": str(uuid.uuid4()), "name": f"{act['title']} · {stamp}", "kind": "static", "rules": [],
           "created_at": mk._iso(), "created_by": user.get("email", ""), "source": "ai-next-action"}
    await db.mk_lists.insert_one(dict(lst))
    await db.mk_contacts.update_many({"id": {"$in": act["contact_ids"]}}, {"$addToSet": {"lists": lst["id"]}})
    t = next((x for x in core.STARTER_TEMPLATES if x["key"] == "for-you"), None) or {}
    blocks = mk._clean_blocks(t.get("blocks") or [])
    # A plain, honest starting subject; the editor's subject coach can improve it.
    subject = (f"Just published: {act['books'][0]}" if act["kind"] == "new_release" and act["books"] else t.get("subject", ""))[:120]
    doc = {"id": str(uuid.uuid4()), "name": f"{act['title']} — {stamp}", "channel": "email", "kind": "standard",
           "reconfirm_days": None, "subject": subject, "preheader": t.get("preheader", ""), "blocks": blocks,
           "links": core.collect_links(blocks), "audience": {"list_ids": [lst["id"]], "rules": []},
           "wa_template": "", "wa_language": "en", "wa_variables": [], "status": "draft", "created_at": mk._iso(),
           "created_by": user.get("email", ""), "stats": {}, "ai_action": key, "note": act["why"]}
    await db.mk_campaigns.insert_one(dict(doc))
    await audit_log(db, "MARKETING_AI_ACTION_DRAFT", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"action": key, "list": lst["id"], "campaign": doc["id"], "audience": act["audience"]})
    return {"campaign_id": doc["id"], "list_id": lst["id"], "audience": act["audience"]}


# -------------------------------------------------------------- settings ---
class AISettings(BaseModel):
    enabled: bool


@admin_router.get("/settings")
async def ai_settings():
    return {"enabled": await _enabled(), "model": llm.LLM_MODEL}


@admin_router.put("/settings")
async def ai_put_settings(body: AISettings, user: dict = Depends(require_superadmin)):
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "enabled": body.enabled,
                                                                     "by": user.get("email", ""), "at": _now().isoformat()}},
                                     upsert=True)
    await audit_log(db, "MARKETING_AI_SETTINGS", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"enabled": body.enabled})
    return {"enabled": body.enabled}
