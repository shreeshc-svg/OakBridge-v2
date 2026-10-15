"""
Growth tools (Marketing → Growth): where buyers come from, partner links with
personal discount codes, the Google Merchant Center feed, and two automated
emails (abandoned checkout, review request). Pure rules: growth_core.py.

PRIVACY
* Visits are counted with a cookie-free beacon, once per browser session:
  channel, partner code and landing path only — no IP, no identifier, no
  referrer path (host only). Nothing about a person is stored, so it needs no
  consent banner (same reasoning as lib/attribution.js).
* The abandoned-checkout email goes ONLY to people with marketing consent (a
  subscribed contact, or the "email me" box ticked on that checkout). The
  review request goes to buyers who have not unsubscribed or bounced. Both
  carry the one-click unsubscribe, and each order gets at most one of each.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

import growth_core as gc
import jobs as _jobs
import marketing as mk
import marketing_core as core
from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger(__name__)
SITE = mk.SITE
AUTO_KEY = "mk_automations"
AUTO_DEFAULTS = {"abandoned": {"enabled": False, "delay_hours": 2},
                 "review": {"enabled": False, "days_after_delivery": 10}}
AUTO_CAMPAIGNS = {
    "abandoned": {"id": "auto-abandoned", "name": "Automation: abandoned checkout",
                  "subject": "{{first_name|You}}, your books are waiting"},
    "review": {"id": "auto-review", "name": "Automation: review request",
               "subject": "How are you finding your book, {{first_name|reader}}?"},
}

public_router = APIRouter(prefix="/api", tags=["growth-public"])
admin_router = APIRouter(prefix="/api/admin/marketing/growth", tags=["growth-admin"], dependencies=[Depends(require_admin)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


async def _partner_codes() -> set:
    return {p["code"] async for p in db.partners.find({}, {"_id": 0, "code": 1})}


# -------------------------------------------------------------- visits ---
@public_router.post("/t/visit")
async def track_visit(request: Request):
    """One count per browser session (sent by the site with sendBeacon as
    text/plain, so no CORS preflight). Bots and our prerenderer are ignored."""
    if gc.is_bot(request.headers.get("user-agent", "")):
        return Response(status_code=204)
    try:
        raw = (await request.body())[:2000]
        d = json.loads(raw or b"{}")
        if not isinstance(d, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return Response(status_code=204)
    attr = {k: str(d.get(k) or "")[:120] for k in ("utm_source", "utm_medium", "utm_campaign", "ref", "referrer")}
    channel = gc.channel_of(attr, partner_codes=await _partner_codes())
    day = _now().strftime("%Y-%m-%d")
    key = {"day": day, "channel": channel, "ref": gc.norm_code(attr.get("ref")) if channel == "Partner" else ""}
    await db.visit_stats.update_one(key, {"$inc": {"n": 1}, "$setOnInsert": key}, upsert=True)
    return Response(status_code=204)


# --------------------------------------------------------------- funnel ---
@admin_router.get("/funnel")
async def adm_funnel(days: int = 30):
    """Visits → checkouts started → paid, per channel, for the last N days."""
    days = max(1, min(int(days), 365))
    since_day = (_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    since = (_now() - timedelta(days=days)).isoformat()
    visits: dict = {}
    async for v in db.visit_stats.find({"day": {"$gte": since_day}}, {"_id": 0, "channel": 1, "n": 1}):
        visits[v["channel"]] = visits.get(v["channel"], 0) + int(v.get("n") or 0)
    codes = await _partner_codes()
    orders = []
    async for o in db.orders.find({"created_at": {"$gte": since}},
                                  {"_id": 0, "attribution": 1, "coupon_code": 1, "payment_status": 1, "total": 1}):
        orders.append({"channel": gc.channel_of(o.get("attribution"), o.get("coupon_code") or "", codes),
                       "paid": o.get("payment_status") == "paid", "total": o.get("total")})
    rows = gc.funnel_rows(visits, orders)
    tot = {k: sum(r[k] for r in rows) for k in ("visits", "checkouts", "paid", "revenue")}
    tot["visit_to_paid"] = round(tot["paid"] / tot["visits"], 4) if tot["visits"] else None
    return {"days": days, "rows": rows, "total": tot}


# ------------------------------------------------------------- partners ---
class PartnerBody(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    email: Optional[str] = None
    code: Optional[str] = None
    discount_percent: Optional[float] = None
    active: Optional[bool] = None
    author_id: Optional[str] = None


def _share_link(p: dict) -> str:
    base = f"{SITE}/authors/{p['author_id']}" if p.get("author_id") else f"{SITE}/"
    return f"{base}?ref={p['code']}"


@admin_router.get("/partners")
async def adm_partners(days: int = 90):
    """Each partner with their link and what it produced (visits, paid orders,
    revenue, copies) in the last N days."""
    since = (_now() - timedelta(days=max(1, min(days, 365)))).isoformat()
    since_day = since[:10]
    out = []
    for p in await db.partners.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000):
        code = p["code"]
        v = sum([int(x.get("n") or 0) async for x in db.visit_stats.find({"ref": code, "day": {"$gte": since_day}}, {"_id": 0, "n": 1})])
        paid = await db.orders.find({"created_at": {"$gte": since}, "payment_status": "paid",
                                     "$or": [{"coupon_code": code}, {"attribution.ref": code}]},
                                    {"_id": 0, "total": 1, "items": 1}).to_list(5000)
        out.append({**p, "link": _share_link(p), "visits": v, "orders": len(paid),
                    "revenue": round(sum(float(o.get("total") or 0) for o in paid), 2),
                    "copies": sum(int(i.get("quantity") or 0) for o in paid for i in o.get("items") or [])})
    return {"partners": out, "kinds": gc.PARTNER_KINDS}


@admin_router.post("/partners")
async def adm_new_partner(body: PartnerBody, user: dict = Depends(require_admin)):
    """A partner = a share link + a personal discount code (a normal coupon,
    so checkout and invoices need nothing new)."""
    name = (body.name or "").strip()[:120]
    code = gc.norm_code(body.code or "")
    if not name or not gc.CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="Give a name and a code of 3–24 letters or numbers (e.g. KANNAN10).")
    kind = body.kind if body.kind in gc.PARTNER_KINDS else "other"
    pct = float(body.discount_percent if body.discount_percent is not None else 10)
    if not 0 <= pct <= 50:
        raise HTTPException(status_code=400, detail="Discount must be between 0 and 50%.")
    if await db.partners.find_one({"code": code}) or await db.coupons.find_one({"code": code}):
        raise HTTPException(status_code=409, detail=f"The code {code} is already used.")
    now = _iso()
    if pct > 0:
        await db.coupons.insert_one({"id": str(uuid.uuid4()), "code": code, "kind": "percent", "value": pct, "min_order": 0,
                                     "max_uses": 0, "used_count": 0, "active": True, "expires_at": None,
                                     "description": f"Partner: {name}", "created_at": now, "partner": True})
    p = {"id": str(uuid.uuid4()), "name": name, "kind": kind, "email": (body.email or "").strip()[:200], "code": code,
         "discount_percent": pct, "active": True, "author_id": (body.author_id or "").strip() or None,
         "created_at": now, "created_by": user.get("email", "")}
    await db.partners.insert_one(dict(p))
    await audit_log(db, "GROWTH_PARTNER_CREATED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"partner": p["id"], "code": code, "kind": kind, "discount": pct})
    return {**p, "link": _share_link(p)}


@admin_router.patch("/partners/{pid}")
async def adm_save_partner(pid: str, body: PartnerBody, user: dict = Depends(require_admin)):
    p = await db.partners.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    upd = {}
    if body.name is not None and body.name.strip():
        upd["name"] = body.name.strip()[:120]
    if body.kind in gc.PARTNER_KINDS:
        upd["kind"] = body.kind
    if body.email is not None:
        upd["email"] = body.email.strip()[:200]
    if body.active is not None:
        upd["active"] = bool(body.active)
        # Switching a partner off also stops their discount code.
        await db.coupons.update_one({"code": p["code"]}, {"$set": {"active": bool(body.active)}})
    if body.discount_percent is not None:
        pct = float(body.discount_percent)
        if not 0 <= pct <= 50:
            raise HTTPException(status_code=400, detail="Discount must be between 0 and 50%.")
        upd["discount_percent"] = pct
        await db.coupons.update_one({"code": p["code"]}, {"$set": {"value": pct}})
    if upd:
        await db.partners.update_one({"id": pid}, {"$set": upd})
    p = await db.partners.find_one({"id": pid}, {"_id": 0})
    return {**p, "link": _share_link(p)}


# --------------------------------------------------------- merchant feed ---
@public_router.get("/feeds/google-merchant.xml")
async def merchant_feed():
    """Google Merchant Center product feed (free listings). Add this URL once
    in Merchant Center → Products → Feeds → Scheduled fetch (daily)."""
    from emailer import media_url
    items = []
    async for b in db.books.find({"enabled": {"$ne": False}}, {"_id": 0}):
        it = gc.merchant_item(b, site=SITE, image_url=media_url(b.get("cover_image") or ""))
        if it:
            items.append(it)
    return Response(content=gc.feed_xml(items, site=SITE), media_type="application/xml; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=3600"})


# ----------------------------------------------------------- automations ---
async def get_automations() -> dict:
    doc = await db.integrations.find_one({"key": AUTO_KEY}, {"_id": 0}) or {}
    out = {}
    for k, d in AUTO_DEFAULTS.items():
        out[k] = {**d, **(doc.get(k) or {})}
    return out


class AutomationsBody(BaseModel):
    abandoned: Optional[dict] = None
    review: Optional[dict] = None


@admin_router.get("/automations")
async def adm_automations():
    cfg = await get_automations()
    stats = {}
    for k, c in AUTO_CAMPAIGNS.items():
        stats[k] = {"sent": await db.mk_sends.count_documents({"campaign_id": c["id"], "status": {"$in": ["sent", "bounced", "complained"]}}),
                    "campaign_id": c["id"]}
    return {"config": cfg, "stats": stats}


@admin_router.put("/automations")
async def adm_save_automations(body: AutomationsBody, user: dict = Depends(require_superadmin)):
    cur = await get_automations()
    if body.abandoned is not None:
        a = body.abandoned
        cur["abandoned"] = {"enabled": bool(a.get("enabled", cur["abandoned"]["enabled"])),
                            "delay_hours": max(1, min(int(a.get("delay_hours", cur["abandoned"]["delay_hours"]) or 2), 24))}
    if body.review is not None:
        r = body.review
        cur["review"] = {"enabled": bool(r.get("enabled", cur["review"]["enabled"])),
                         "days_after_delivery": max(3, min(int(r.get("days_after_delivery", cur["review"]["days_after_delivery"]) or 10), 30))}
    await db.integrations.update_one({"key": AUTO_KEY}, {"$set": {"key": AUTO_KEY, **cur}}, upsert=True)
    await audit_log(db, "GROWTH_AUTOMATIONS_SAVED", email=user.get("email", ""), role=user.get("role", ""), meta=cur)
    return {"config": cur}


async def _auto_campaign(kind: str) -> dict:
    """The campaign record an automation's sends belong to, so opens, clicks,
    unsubscribes and orders show in Campaigns like any other email."""
    c = AUTO_CAMPAIGNS[kind]
    await db.mk_campaigns.update_one(
        {"id": c["id"]},
        {"$setOnInsert": {"id": c["id"], "name": c["name"], "channel": "email", "kind": "automation",
                          "status": "automation", "subject": c["subject"], "preheader": "", "blocks": [], "links": [],
                          "audience": {}, "created_at": _iso(), "created_by": "system", "stats": {}}},
        upsert=True)
    return c


def _book_block(item: dict, book: dict) -> dict:
    from emailer import media_url
    return {"type": "book", "title": book.get("title") or item.get("title", ""), "author": book.get("author", ""),
            "cover": media_url(book.get("cover_image") or item.get("cover_image") or ""),
            "price": f"₹{float(book.get('price') or item.get('price') or 0):.0f}", "url": f"{SITE}/books/{book.get('id') or item.get('book_id')}"}


async def _send_auto(kind: str, contact: dict, order: dict, subject: str, blocks: list) -> bool:
    """One automated email through SES, tracked like a campaign email (its own
    links kept on the send, so each recipient's book links are tracked)."""
    st = await mk.get_settings()
    camp = await _auto_campaign(kind)
    links = core.collect_links(blocks)
    sid = str(uuid.uuid4())
    await db.mk_sends.insert_one({"id": sid, "campaign_id": camp["id"], "contact_id": contact["id"], "to": contact["email"],
                                  "status": "queued", "queued_at": _iso(), "priority": 1, "links": links,
                                  "order_id": order.get("id"), "automation": kind})
    L = mk._links(sid)
    html_doc, text_doc = core.render_email(
        blocks, brand={"name": "Oakbridge Publishing", "logo": st.get("logo"), "footer": st.get("footer")},
        contact=contact, link_for=lambda u: L["click"](links.index(u)) if u in links else u,
        open_pixel=L["open"], unsubscribe_url=L["unsub_page"])
    raw = mk.build_mime(st=st, to=contact["email"], subject=core.personalise(subject, contact),
                        html_doc=html_doc, text_doc=text_doc, unsub_post=L["unsub_post"])
    try:
        mid = await asyncio.to_thread(mk._send_raw, raw)
    except Exception as e:  # noqa: BLE001
        await db.mk_sends.update_one({"id": sid}, {"$set": {"status": "failed", "error": str(e)[:300]}})
        log.warning("growth: %s email failed for order %s: %s", kind, order.get("order_number"), e)
        return False
    await db.mk_sends.update_one({"id": sid}, {"$set": {"status": "sent", "message_id": mid, "sent_at": _iso()}})
    await db.mk_contacts.update_one({"id": contact["id"]}, {"$inc": {"stats.sent": 1}, "$set": {"last_sent_at": _iso()}})
    return True


def _mailable(c: Optional[dict], *, need_consent: bool) -> bool:
    if not c or c.get("suppressed") or c.get("email_status") in ("invalid", "suppressed"):
        return False
    cs = (c.get("email_consent") or {}).get("status")
    if cs in ("unsubscribed", "complained", "lapsed"):
        return False
    return cs == "subscribed" if need_consent else True


async def run_automations(dry_run: bool = False, force: bool = False) -> dict:
    """Hourly (job "mk_auto"). Each order gets at most one of each email.
    dry_run counts what would go out (nothing sent or marked); force runs the
    count even for an automation that is switched off (the preview)."""
    cfg = await get_automations()
    now = _now()
    out = {"abandoned": {"sent": 0, "skipped": {}}, "review": {"sent": 0, "skipped": {}}}

    def skip(kind, why):
        out[kind]["skipped"][why] = out[kind]["skipped"].get(why, 0) + 1

    if cfg["abandoned"]["enabled"] or force:
        since = (now - timedelta(hours=48)).isoformat()
        async for o in db.orders.find({"created_at": {"$gte": since}, "payment_status": {"$ne": "paid"},
                                       "abandoned_email_at": {"$exists": False}}, {"_id": 0}):
            if not gc.abandoned_due(o, now, cfg["abandoned"]["delay_hours"]):
                continue
            email = (o.get("email") or "").strip().lower()
            # Bought since (a second attempt that worked)? Then nothing to remind.
            if await db.orders.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
                                         "payment_status": "paid", "created_at": {"$gte": o["created_at"]}}, {"_id": 1}):
                if not dry_run:
                    await db.orders.update_one({"id": o["id"]}, {"$set": {"abandoned_email_at": "skipped: paid later"}})
                skip("abandoned", "paid later")
                continue
            if dry_run:
                ex = await db.mk_contacts.find_one({"email_norm": core.normalise_email(email)}, {"_id": 0})
                if o.get("email_marketing_optin") and not (ex and (ex.get("suppressed") or (ex.get("email_consent") or {}).get("status") in ("unsubscribed", "complained"))):
                    out["abandoned"]["sent"] += 1
                elif _mailable(ex, need_consent=True):
                    out["abandoned"]["sent"] += 1
                else:
                    skip("abandoned", "no marketing consent")
                continue
            c = await mk.upsert_contact(email, name=o.get("full_name", ""), phone=o.get("phone", ""), source="checkout",
                                        email_consent="subscribed" if o.get("email_marketing_optin") else None)
            c = await db.mk_contacts.find_one({"id": (c or {}).get("id")}, {"_id": 0}) if c else None
            if not _mailable(c, need_consent=True):
                await db.orders.update_one({"id": o["id"]}, {"$set": {"abandoned_email_at": "skipped: no marketing consent"}})
                skip("abandoned", "no marketing consent")
                continue
            recent = await db.mk_sends.find_one({"campaign_id": AUTO_CAMPAIGNS["abandoned"]["id"], "contact_id": c["id"],
                                                 "sent_at": {"$gte": (now - timedelta(days=7)).isoformat()}}, {"_id": 1})
            if recent:
                await db.orders.update_one({"id": o["id"]}, {"$set": {"abandoned_email_at": "skipped: reminded this week"}})
                skip("abandoned", "already reminded this week")
                continue
            books = []
            for it in (o.get("items") or [])[:6]:
                b = await db.books.find_one({"id": it.get("book_id")}, {"_id": 0}) or {}
                books.append(_book_block(it, {**b, "id": it.get("book_id")}))
            blocks = [{"type": "heading", "text": "Your order isn't finished yet"},
                      {"type": "text", "text": "Hi {{first_name}}, you were checking out but the payment didn't go through. "
                                               "Your books are still available — it takes a minute to finish."},
                      *books,
                      {"type": "button", "label": "Complete my order", "url": f"{SITE}/cart"},
                      {"type": "text", "text": "Questions about the order or payment? Just reply to this email."}]
            # Claimed first, so a second worker can never send it twice.
            claim = await db.orders.update_one({"id": o["id"], "abandoned_email_at": {"$exists": False}},
                                               {"$set": {"abandoned_email_at": _iso()}})
            if claim.modified_count != 1:
                continue
            if await _send_auto("abandoned", c, o, AUTO_CAMPAIGNS["abandoned"]["subject"], blocks):
                out["abandoned"]["sent"] += 1

    if cfg["review"]["enabled"] or force:
        days = cfg["review"]["days_after_delivery"]
        async for o in db.orders.find({"payment_status": "paid", "status": "delivered", "review_email_at": {"$exists": False}},
                                      {"_id": 0}):
            if not gc.review_due(o, now, days):
                continue
            ids = [it.get("book_id") for it in o.get("items") or [] if it.get("book_id")]
            done = {r["book_id"] async for r in db.reviews.find({"user_id": o.get("user_id"), "book_id": {"$in": ids}},
                                                                 {"_id": 0, "book_id": 1})} if o.get("user_id") else set()
            todo = [i for i in ids if i not in done][:4]
            if not todo:
                if not dry_run:
                    await db.orders.update_one({"id": o["id"]}, {"$set": {"review_email_at": "skipped: already reviewed"}})
                skip("review", "already reviewed")
                continue
            if dry_run:
                ex = await db.mk_contacts.find_one({"email_norm": core.normalise_email(o.get("email", ""))}, {"_id": 0})
                if ex is None or _mailable(ex, need_consent=False):
                    out["review"]["sent"] += 1
                else:
                    skip("review", "unsubscribed or bounced")
                continue
            c = await mk.upsert_contact(o.get("email", ""), name=o.get("full_name", ""), source="order")
            c = await db.mk_contacts.find_one({"id": (c or {}).get("id")}, {"_id": 0}) if c else None
            if not _mailable(c, need_consent=False):
                await db.orders.update_one({"id": o["id"]}, {"$set": {"review_email_at": "skipped: unsubscribed or bounced"}})
                skip("review", "unsubscribed or bounced")
                continue
            blocks = [{"type": "heading", "text": "How are you finding it?"},
                      {"type": "text", "text": "Hi {{first_name}}, your order arrived a little while ago. A short review helps other "
                                               "readers choose — and tells our authors what worked. It takes a minute."}]
            for bid in todo:
                b = await db.books.find_one({"id": bid}, {"_id": 0}) or {"id": bid}
                blk = _book_block({"book_id": bid}, b)
                blk["url"] = f"{SITE}/books/{bid}#reviews"
                blocks.append(blk)
            blocks.append({"type": "text", "text": "Sign in with this email address to post your review."})
            claim = await db.orders.update_one({"id": o["id"], "review_email_at": {"$exists": False}},
                                               {"$set": {"review_email_at": _iso()}})
            if claim.modified_count != 1:
                continue
            if await _send_auto("review", c, o, AUTO_CAMPAIGNS["review"]["subject"], blocks):
                out["review"]["sent"] += 1
    return out


@_jobs.handler("mk_auto")
async def _job_auto(p: dict) -> None:
    r = await run_automations()
    if r["abandoned"]["sent"] or r["review"]["sent"]:
        log.info("growth automations: %s", r)


@admin_router.post("/automations/preview")
async def adm_automations_preview():
    """How many emails would go out right now (nothing is sent or marked)."""
    return await run_automations(dry_run=True, force=True)
