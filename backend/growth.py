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
from extensions import db, get_current_user, require_admin, require_superadmin

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
SETTINGS_KEY = "growth_settings"
# Visit tallies written by the Oct 2026 counting rules carry v=2. Earlier ones
# (substring channel rules, staff and office included) stay in the database
# but are never read for the funnel: the window simply starts at the first v=2
# day, so no inaccurate count is ever mixed in and nothing has to be deleted.
VISIT_V = 2
_SETTINGS_CACHE: dict = {"at": 0.0, "v": None}


async def growth_settings(fresh: bool = False) -> dict:
    """Office networks to leave out of the counts (Admin → Marketing → Growth)."""
    import time
    if not fresh and _SETTINGS_CACHE["v"] is not None and time.monotonic() - _SETTINGS_CACHE["at"] < 60:
        return _SETTINGS_CACHE["v"]
    doc = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
    v = {"office_ips": gc.clean_nets(doc.get("office_ips") or [])}
    _SETTINGS_CACHE.update(at=time.monotonic(), v=v)
    return v


_INDEXED = {"done": False}


async def _ensure_indexes() -> None:
    """Every beacon upserts on (day, …); without these each one scans the
    whole tally collection, which grows by a few thousand rows a month."""
    if _INDEXED["done"]:
        return
    try:
        await db.visit_stats.create_index([("day", 1), ("channel", 1), ("ref", 1)])
        await db.visit_dims.create_index([("day", 1), ("dim", 1), ("key", 1)])
        await db.step_stats.create_index([("day", 1), ("channel", 1), ("step", 1)])
    except Exception:  # noqa: BLE001 — counting must never fail on an index
        log.exception("growth: index creation failed")
    _INDEXED["done"] = True


async def _beacon(request: Request) -> Optional[tuple]:
    """Shared by every counter: (body, attribution, channel, user-agent), or
    None when this request must not be counted — a bot, our prerenderer, or a
    browser on the office network. The IP is compared, never stored."""
    ua = request.headers.get("user-agent", "")
    if gc.is_bot(ua):
        return None
    await _ensure_indexes()
    from antispam import client_ip
    if gc.ip_in(client_ip(request), (await growth_settings())["office_ips"]):
        return None
    try:
        raw = (await request.body())[:2000]
        d = json.loads(raw or b"{}")
        if not isinstance(d, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return None
    attr = {k: str(d.get(k) or "")[:120] for k in ("utm_source", "utm_medium", "utm_campaign", "ref", "referrer")}
    # In-app browsers (Instagram, Facebook, LinkedIn…) send no referrer; the
    # server reads the app from the user agent rather than trusting the body.
    attr["in_app"] = gc.in_app(ua)
    channel = gc.channel_of(attr, partner_codes=await _partner_codes())
    return d, attr, channel, ua


@public_router.post("/t/visit")
async def track_visit(request: Request):
    """One count per browser session (sent by the site with sendBeacon as
    text/plain, so no CORS preflight). Bots, our prerenderer, signed-in staff
    (the site never sends it for them) and the office network are ignored.

    Besides the channel count it keeps three cookie-free tallies per day:
    landing page, referring site (host only) and device type. Nothing that
    identifies a person is stored."""
    b = await _beacon(request)
    if not b:
        return Response(status_code=204)
    d, attr, channel, ua = b
    day = _now().strftime("%Y-%m-%d")
    key = {"day": day, "channel": channel, "ref": gc.norm_code(attr.get("ref")) if channel == "Partner" else "", "v": VISIT_V}
    await db.visit_stats.update_one(key, {"$inc": {"n": 1}, "$setOnInsert": key}, upsert=True)
    dims = [("device", gc.device_of(ua)), ("landing", gc.landing_key(str(d.get("path") or "/")))]
    host = gc.referrer_host(attr.get("referrer") or "")
    if host and not host.endswith("oakbridge.in"):
        dims.append(("referrer", host[:80]))
    for dim, k in dims:
        await db.visit_dims.update_one({"day": day, "dim": dim, "key": k}, {"$inc": {"n": 1}}, upsert=True)
    return Response(status_code=204)


class UnvisitBody(BaseModel):
    at: str
    utm_source: Optional[str] = ""
    utm_medium: Optional[str] = ""
    utm_campaign: Optional[str] = ""
    ref: Optional[str] = ""
    referrer: Optional[str] = ""
    path: Optional[str] = "/"
    steps: Optional[list] = None


@public_router.post("/t/unvisit")
async def untrack_visit(body: UnvisitBody, request: Request, user: dict = Depends(get_current_user)):
    """Take back this session's visit (and any shopping steps) when the person
    turns out to be staff — they signed in during a visit that was already
    counted. Only a signed-in STAFF account can call it, so it cannot be used
    to pull numbers down; and it only subtracts what is there (never below 0)."""
    import rbac
    if user.get("role") not in rbac.ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Staff only")
    try:
        when = datetime.fromisoformat(body.at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad time")
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if not (_now() - timedelta(days=2) <= when <= _now() + timedelta(minutes=5)):
        return {"ok": True, "undone": 0}
    day = when.astimezone(timezone.utc).strftime("%Y-%m-%d")
    ua = request.headers.get("user-agent", "")
    attr = {k: str(getattr(body, k) or "")[:120] for k in ("utm_source", "utm_medium", "utm_campaign", "ref", "referrer")}
    attr["in_app"] = gc.in_app(ua)
    channel = gc.channel_of(attr, partner_codes=await _partner_codes())
    key = {"day": day, "channel": channel, "ref": gc.norm_code(attr.get("ref")) if channel == "Partner" else "", "v": VISIT_V}
    undone = 0
    r = await db.visit_stats.update_one({**key, "n": {"$gt": 0}}, {"$inc": {"n": -1}})
    undone += getattr(r, "modified_count", 0) or 0
    dims = [("device", gc.device_of(ua)), ("landing", gc.landing_key(body.path or "/"))]
    host = gc.referrer_host(attr.get("referrer") or "")
    if host and not host.endswith("oakbridge.in"):
        dims.append(("referrer", host[:80]))
    for dim, k in dims:
        await db.visit_dims.update_one({"day": day, "dim": dim, "key": k, "n": {"$gt": 0}}, {"$inc": {"n": -1}})
    for step in (body.steps or [])[:len(gc.STEPS)]:
        if step in gc.STEPS:
            await db.step_stats.update_one({"day": day, "channel": channel, "step": step, "n": {"$gt": 0}}, {"$inc": {"n": -1}})
    return {"ok": True, "undone": undone}


@public_router.post("/t/step")
async def track_step(request: Request):
    """One count per session per shopping step (viewed a book, added to cart,
    opened checkout, opened payment), per channel — so the funnel shows WHERE
    buyers drop out, still without cookies."""
    b = await _beacon(request)
    if not b:
        return Response(status_code=204)
    d, _attr, channel, _ua = b
    step = str(d.get("step") or "")
    if step not in gc.STEPS:
        return Response(status_code=204)
    key = {"day": _now().strftime("%Y-%m-%d"), "channel": channel, "step": step}
    await db.step_stats.update_one(key, {"$inc": {"n": 1}, "$setOnInsert": key}, upsert=True)
    return Response(status_code=204)


# --------------------------------------------------------------- funnel ---
async def _window(days: int) -> tuple:
    """(start_day, start_iso, clamped). Visits only exist from the day counting
    began, so the window starts no earlier than that — otherwise 30 days of
    orders are divided by 4 days of visits and every rate is inflated (the
    live funnel showed Search at 9.7% this way, Oct 2026)."""
    days = max(1, min(int(days), 365))
    want = (_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    first = await db.visit_stats.find_one({"v": VISIT_V}, {"_id": 0, "day": 1}, sort=[("day", 1)])
    start = max(want, first["day"]) if first and first.get("day") else want
    return start, f"{start}T00:00:00", start != want


async def _staff() -> tuple:
    """Staff user ids and emails: their own orders (tests, demos) stay out of the funnel."""
    import rbac
    ids, emails = set(), set()
    async for u in db.users.find({"role": {"$in": list(rbac.ADMIN_ROLES)}}, {"_id": 0, "id": 1, "email": 1}):
        if u.get("id"):
            ids.add(u["id"])
        if u.get("email"):
            emails.add(str(u["email"]).lower())
    return ids, emails


async def _funnel_orders(start_iso: str) -> list:
    codes = await _partner_codes()
    ids, emails = await _staff()
    out = []
    async for o in db.orders.find({"created_at": {"$gte": start_iso}},
                                  {"_id": 0, "attribution": 1, "coupon_code": 1, "payment_status": 1, "total": 1,
                                   "user_id": 1, "email": 1, "created_at": 1}):
        if o.get("user_id") in ids or str(o.get("email") or "").lower() in emails:
            continue
        out.append({"channel": gc.channel_of(o.get("attribution"), o.get("coupon_code") or "", codes),
                    "paid": o.get("payment_status") == "paid", "total": o.get("total"),
                    "day": str(o.get("created_at") or "")[:10]})
    return out


@admin_router.get("/funnel")
async def adm_funnel(days: int = 30):
    """Visits → viewed a book → cart → checkout → payment → paid, per channel."""
    start_day, start_iso, clamped = await _window(days)
    visits: dict = {}
    async for v in db.visit_stats.find({"day": {"$gte": start_day}, "v": VISIT_V}, {"_id": 0, "channel": 1, "n": 1}):
        visits[v["channel"]] = visits.get(v["channel"], 0) + int(v.get("n") or 0)
    steps: dict = {}
    async for x in db.step_stats.find({"day": {"$gte": start_day}}, {"_id": 0, "channel": 1, "step": 1, "n": 1}):
        steps.setdefault(x["channel"], {}).setdefault(x["step"], 0)
        steps[x["channel"]][x["step"]] += int(x.get("n") or 0)
    orders = await _funnel_orders(start_iso)
    rows = gc.funnel_rows(visits, orders)
    for r in rows:
        r["steps"] = {k: steps.get(r["channel"], {}).get(k, 0) for k in gc.STEPS}
    tot = {k: sum(r[k] for r in rows) for k in ("visits", "checkouts", "paid", "revenue")}
    tot["visit_to_paid"] = round(tot["paid"] / tot["visits"], 4) if tot["visits"] else None
    tot["steps"] = {k: sum(r["steps"][k] for r in rows) for k in gc.STEPS}
    return {"days": days, "since": start_day, "clamped": clamped, "rows": rows, "total": tot,
            "step_labels": gc.STEP_LABELS, "steps_since": await _first_day(db.step_stats)}


async def _first_day(coll) -> Optional[str]:
    d = await coll.find_one({}, {"_id": 0, "day": 1}, sort=[("day", 1)])
    return d.get("day") if d else None


@admin_router.get("/insights")
async def adm_insights(days: int = 30):
    """Top landing pages and referring sites, device split, and a daily
    visits / paid-orders trend — same window as the funnel."""
    start_day, start_iso, clamped = await _window(days)
    dims: dict = {"landing": {}, "referrer": {}, "device": {}}
    async for x in db.visit_dims.find({"day": {"$gte": start_day}}, {"_id": 0, "dim": 1, "key": 1, "n": 1}):
        if x.get("dim") in dims:
            dims[x["dim"]][x["key"]] = dims[x["dim"]].get(x["key"], 0) + int(x.get("n") or 0)
    top = lambda d, n: [{"key": k, "n": v} for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:n]]  # noqa: E731
    daily: dict = {}
    async for v in db.visit_stats.find({"day": {"$gte": start_day}, "v": VISIT_V}, {"_id": 0, "day": 1, "n": 1}):
        daily.setdefault(v["day"], {"visits": 0, "paid": 0})["visits"] += int(v.get("n") or 0)
    for o in await _funnel_orders(start_iso):
        if o["paid"] and o["day"]:
            daily.setdefault(o["day"], {"visits": 0, "paid": 0})["paid"] += 1
    return {"since": start_day, "clamped": clamped, "landing": top(dims["landing"], 12), "referrer": top(dims["referrer"], 12),
            "device": dims["device"], "daily": daily, "dims_since": await _first_day(db.visit_dims)}


class GrowthSettingsBody(BaseModel):
    office_ips: Optional[list] = None


@admin_router.get("/settings")
async def adm_growth_settings():
    return await growth_settings(fresh=True)


@admin_router.put("/settings")
async def adm_save_growth_settings(body: GrowthSettingsBody, user: dict = Depends(require_admin)):
    nets = gc.clean_nets(body.office_ips or [])
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "office_ips": nets}}, upsert=True)
    _SETTINGS_CACHE.update(at=0.0, v=None)
    await audit_log(db, "GROWTH_SETTINGS_SAVED", email=user.get("email", ""), role=user.get("role", ""), meta={"office_ips": len(nets)})
    return {"office_ips": nets}


@admin_router.get("/my-ip")
async def adm_my_ip(request: Request):
    """The address this admin is browsing from, to add as the office network."""
    from antispam import client_ip
    return {"ip": client_ip(request)}


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
