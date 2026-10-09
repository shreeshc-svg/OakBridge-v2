"""Interakt — WhatsApp Business messages for the store.

What it does
  * SENDS approved WhatsApp templates: order confirmed (on payment), shipped
    (with courier + tracking) and cancelled (when Admin → Orders changes the
    status with "notify" ticked), and one cart reminder per abandoned cart.
  * SYNCS each paying customer to Interakt (name, email, orders, spend) plus an
    "Order Paid" event, so the team can run campaigns there.
  * RECEIVES Interakt's webhooks: delivery reports (sent / delivered / read /
    failed) for every message we sent, and customers' WhatsApp replies, which
    are linked to their latest order by phone number.
  * Everything lands in Admin → WhatsApp (message log, delivery stats, replies).

Safety
  * An Off / Test / Live switch (db.integrations {key: "interakt"}). Off sends
    nothing. Test sends every message to ONE number set in Admin (yours) and
    syncs nobody. Live is live.
  * Nothing here can break checkout, payment, an order update or an email:
    every public function swallows its own errors and only logs.
  * Each message has a dedupe key (e.g. "order_confirmed:<order id>"), claimed
    with an upsert before sending, so the payment webhook and the browser
    confirming the same order, or a double click in Admin, send it once.
  * Consent: order updates go only to orders whose buyer left "WhatsApp me
    order updates" ticked at checkout (order.wa_optin); the cart reminder is
    marketing and goes only to customers who ticked the separate reminders box
    (user.wa_marketing_optin). Orders placed before this existed have neither.
  * The webhook address carries a secret (INTERAKT_WEBHOOK_SECRET) and is
    rejected without it. Interakt also sends a signature header whose scheme
    its documentation does not state; we record whether an HMAC-SHA256 of the
    raw body matches it (sig_ok on each stored event) so it can be enforced
    once confirmed against a real delivery — never guessed into a rejection.

Env (Render): INTERAKT_API_KEY (Developer Settings → API key, used as
"Authorization: Basic <key>"), INTERAKT_WEBHOOK_SECRET (any long random string;
the same value goes in Interakt's webhook "Secret Key").
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger(__name__)

API = "https://api.interakt.ai/v1/public"
PUBLIC_API = (os.environ.get("PUBLIC_API_URL") or "https://api.oakbridge.in").rstrip("/")
SITE = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")

KINDS = ("order_confirmed", "order_shipped", "order_cancelled", "cart_reminder")
DEFAULT_CFG = {
    "mode": "off",              # off | test | live
    "test_phone": "",
    "language": "en",
    "sync_customers": True,
    "templates": {k: k for k in KINDS},   # Interakt template name per message
}
# Status only moves forward; "failed" can land at any point.
_RANK = {"queued": 0, "accepted": 1, "sent": 2, "delivered": 3, "read": 4}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _api_key() -> str:
    return (os.environ.get("INTERAKT_API_KEY") or "").strip()


def _secret() -> str:
    return (os.environ.get("INTERAKT_WEBHOOK_SECRET") or os.environ.get("INTERAKT_SECRET") or "").strip()


async def get_cfg() -> dict:
    doc = await db.integrations.find_one({"key": "interakt"}, {"_id": 0}) or {}
    cfg = {**DEFAULT_CFG, **{k: v for k, v in doc.items() if k in DEFAULT_CFG}}
    cfg["templates"] = {**DEFAULT_CFG["templates"], **(doc.get("templates") or {})}
    return cfg


# ------------------------------------------------------------- helpers ---
def split_phone(raw: str) -> Optional[tuple[str, str]]:
    """'+91 98765 43210' / '09876543210' / '919876543210' -> ('+91', '9876543210').
    None when it is not a plausible mobile number."""
    d = re.sub(r"\D", "", raw or "")
    if d.startswith("00"):
        d = d[2:]
    if len(d) == 11 and d.startswith("0"):
        d = d[1:]
    if len(d) == 10:
        cc, num = "91", d
    elif len(d) == 12 and d.startswith("91"):
        cc, num = "91", d[2:]
    elif 11 <= len(d) <= 15:
        cc, num = d[:-10], d[-10:]
    else:
        return None
    if cc == "91" and not re.match(r"^[6-9]\d{9}$", num):
        return None
    return f"+{cc}", num


def phone_rx(num: str) -> str:
    """Matches a stored phone ending in these 10 digits however it was typed
    ("+91 98765 43210", "98765-43210", "9876543210")."""
    d = re.sub(r"\D", "", num)[-10:]
    return r"\D*".join(d) + r"\D*$"


def _val(v, fallback="-") -> str:
    """WhatsApp rejects empty template variables and newlines in them."""
    s = re.sub(r"\s+", " ", str(v if v is not None else "")).strip()
    return (s or fallback)[:200]


def first_name(name: str) -> str:
    return _val((name or "").split(" ")[0], "there")


def money(x) -> str:
    try:
        return f"₹{float(x):,.0f}"
    except (TypeError, ValueError):
        return "-"


def template_values(kind: str, ctx: dict) -> list[str]:
    """Body variables, in the order the approved templates use them
    (docs/interakt-setup.md has the exact template text)."""
    if kind == "order_confirmed":
        return [first_name(ctx.get("name")), _val(ctx.get("order_number")), money(ctx.get("total")), _val(ctx.get("items"))]
    if kind == "order_shipped":
        return [first_name(ctx.get("name")), _val(ctx.get("order_number")), _val(ctx.get("courier"), "our courier partner"),
                _val(ctx.get("tracking_id"), "shared by email")]
    if kind == "order_cancelled":
        return [first_name(ctx.get("name")), _val(ctx.get("order_number")), _val(ctx.get("reason"), "at your request")]
    if kind == "cart_reminder":
        return [first_name(ctx.get("name")), _val(ctx.get("first_item")), _val(ctx.get("more"), "your picks"), f"{SITE}/cart"]
    raise ValueError(kind)


def items_summary(items: list) -> str:
    titles = [(it.get("title") or "").split(" - ")[0].strip() for it in items or [] if it.get("title")]
    if not titles:
        return "your books"
    head = titles[0][:60]
    return head if len(titles) == 1 else f"{head} + {len(titles) - 1} more"


def _post(path: str, body: dict) -> tuple[bool, dict]:
    try:
        r = requests.post(f"{API}{path}", json=body, timeout=8,
                          headers={"Authorization": f"Basic {_api_key()}", "Content-Type": "application/json"})
        try:
            data = r.json()
        except ValueError:
            data = {"raw": r.text[:300]}
        ok = r.status_code < 300 and data.get("result", True) is not False
        if not ok:
            data.setdefault("http_status", r.status_code)
        return ok, data
    except requests.RequestException as e:
        return False, {"error": str(e)[:300]}


_index_ready = False


async def _ensure_index() -> None:
    global _index_ready
    if not _index_ready:
        try:
            await db.wa_messages.create_index("dedupe", unique=True, sparse=True)
            await db.wa_messages.create_index("interakt_id", sparse=True)
        except Exception:  # noqa: BLE001
            log.warning("interakt: could not create indexes", exc_info=True)
        _index_ready = True


# --------------------------------------------------------------- sending ---
async def send_template(kind: str, *, phone: str, ctx: dict, dedupe: str,
                        order: Optional[dict] = None, user_id: str = "", force_test: bool = False) -> Optional[dict]:
    """Send one approved template. Never raises; returns the log record."""
    try:
        cfg = await get_cfg()
        mode = "test" if force_test else cfg["mode"]
        if mode == "off" or kind not in KINDS:
            return None
        await _ensure_index()
        to_raw = cfg["test_phone"] if mode == "test" else phone
        to = split_phone(to_raw)
        values = template_values(kind, ctx)
        rec = {
            "id": str(uuid.uuid4()), "kind": kind, "template": cfg["templates"].get(kind) or kind,
            "mode": mode, "to": f"{to[0]}{to[1]}" if to else (to_raw or ""), "intended_to": phone or "",
            "order_id": (order or {}).get("id", ""), "order_number": (order or {}).get("order_number", ""),
            "user_id": user_id, "values": values, "status": "queued", "created_at": _now(), "history": [],
        }
        # Test sends carry no dedupe key at all: the unique index is sparse,
        # and a stored null would collide with the next test.
        if not force_test:
            claim = await db.wa_messages.update_one({"dedupe": dedupe}, {"$setOnInsert": rec}, upsert=True)
            if claim.upserted_id is None:
                return None  # already sent (or being sent) — once only
        else:
            await db.wa_messages.insert_one(dict(rec))
        if not _api_key():
            return await _finish(rec["id"], False, {"error": "INTERAKT_API_KEY is not set on the server"})
        if not to:
            return await _finish(rec["id"], False, {"error": f"not a usable mobile number: {to_raw!r}"})
        body = {
            "countryCode": to[0], "phoneNumber": to[1], "type": "Template",
            "callbackData": json.dumps({"m": rec["id"], "k": kind, "o": rec["order_number"]})[:500],
            "template": {"name": rec["template"], "languageCode": cfg["language"] or "en", "bodyValues": values},
        }
        ok, data = await asyncio.to_thread(_post, "/message/", body)
        return await _finish(rec["id"], ok, data)
    except Exception:  # noqa: BLE001
        log.exception("interakt: send %s failed", kind)
        return None


async def send_campaign_message(*, template: str, language: str, values: list, phone: str, dedupe: str,
                                campaign_id: str, force_test: bool = False) -> Optional[dict]:
    """One message of a bulk WhatsApp campaign (marketing.py): any approved
    template, variables already filled in. Same Off/Test/Live switch, logging,
    once-only dedupe and webhook status tracking as the order messages.
    Never raises."""
    try:
        cfg = await get_cfg()
        mode = "test" if force_test else cfg["mode"]
        if mode == "off" or not re.match(r"^[a-z0-9_]+$", template or ""):
            return None
        await _ensure_index()
        to_raw = cfg["test_phone"] if mode == "test" else phone
        to = split_phone(to_raw)
        vals = [_val(v) for v in values or []]
        rec = {"id": str(uuid.uuid4()), "kind": "campaign", "template": template, "mode": mode,
               "to": f"{to[0]}{to[1]}" if to else (to_raw or ""), "intended_to": phone or "", "order_id": "", "order_number": "",
               "user_id": "", "campaign_id": campaign_id, "values": vals, "status": "queued", "created_at": _now(), "history": []}
        if dedupe and not force_test:
            claim = await db.wa_messages.update_one({"dedupe": dedupe}, {"$setOnInsert": rec}, upsert=True)
            if claim.upserted_id is None:
                return await db.wa_messages.find_one({"dedupe": dedupe}, {"_id": 0})
        else:
            await db.wa_messages.insert_one(dict(rec))
        if not _api_key():
            return await _finish(rec["id"], False, {"error": "INTERAKT_API_KEY is not set on the server"})
        if not to:
            return await _finish(rec["id"], False, {"error": f"not a usable mobile number: {to_raw!r}"})
        body = {"countryCode": to[0], "phoneNumber": to[1], "type": "Template",
                "callbackData": json.dumps({"m": rec["id"], "k": "campaign", "c": campaign_id})[:500],
                "template": {"name": template, "languageCode": language or "en", "bodyValues": vals}}
        ok, data = await asyncio.to_thread(_post, "/message/", body)
        return await _finish(rec["id"], ok, data)
    except Exception:  # noqa: BLE001
        log.exception("interakt: campaign send failed")
        return None


async def _finish(mid: str, ok: bool, data: dict) -> dict:
    upd = {"status": "accepted" if ok else "failed", "sent_at": _now(),
           "interakt_id": str(data.get("id") or ""), "response": {k: data.get(k) for k in ("result", "message", "id", "error", "http_status", "raw") if k in data}}
    if not ok:
        upd["error"] = str(data.get("message") or data.get("error") or data.get("raw") or "rejected")[:300]
    await db.wa_messages.update_one({"id": mid}, {"$set": upd})
    return await db.wa_messages.find_one({"id": mid}, {"_id": 0})


async def _track(order: dict) -> None:
    """Customer + "Order Paid" event into Interakt (live only: an event can
    trigger an Interakt campaign, which would message a real customer)."""
    cfg = await get_cfg()
    if cfg["mode"] != "live" or not cfg["sync_customers"] or not _api_key():
        return
    to = split_phone(order.get("phone"))
    if not to:
        return
    paid = [o async for o in db.orders.find({"phone": order.get("phone"), "payment_status": "paid"},
                                            {"_id": 0, "total": 1, "paid_at": 1})]
    traits = {"name": order.get("full_name", ""), "email": order.get("email", ""), "city": order.get("city", ""),
              "total_orders": len(paid), "total_spent": round(sum(float(o.get("total") or 0) for o in paid), 2),
              "last_order": order.get("order_number", ""), "whatsapp_order_updates": bool(order.get("wa_optin"))}
    base = {"countryCode": to[0], "phoneNumber": to[1]}
    await asyncio.to_thread(_post, "/track/users/", {**base, "userId": order.get("user_id") or None, "traits": traits})
    await asyncio.to_thread(_post, "/track/events/", {**base, "event": "Order Paid", "traits": {
        "order_number": order.get("order_number", ""), "total": order.get("total"), "items": items_summary(order.get("items"))}})


# ---- hooks called from payments.py / extensions.py / features.py ----
async def on_order_paid(order: dict) -> None:
    try:
        if order.get("wa_optin"):
            await send_template("order_confirmed", phone=order.get("phone"), order=order, user_id=order.get("user_id") or "",
                                dedupe=f"order_confirmed:{order['id']}",
                                ctx={"name": order.get("full_name"), "order_number": order.get("order_number"),
                                     "total": order.get("total"), "items": items_summary(order.get("items"))})
        await _track(order)
    except Exception:  # noqa: BLE001
        log.exception("interakt: on_order_paid failed for %s", order.get("order_number"))


async def on_order_status(order: dict, status: str, note: str = "") -> Optional[dict]:
    try:
        if not order.get("wa_optin") or status not in ("shipped", "cancelled"):
            return None
        kind = "order_shipped" if status == "shipped" else "order_cancelled"
        return await send_template(kind, phone=order.get("phone"), order=order, user_id=order.get("user_id") or "",
                                   # tracking in the key: a corrected AWB is a new message, a double click is not
                                   dedupe=f"{kind}:{order['id']}:{order.get('tracking_id', '') if kind == 'order_shipped' else ''}",
                                   ctx={"name": order.get("full_name"), "order_number": order.get("order_number"),
                                        "courier": order.get("courier"), "tracking_id": order.get("tracking_id"),
                                        "reason": note or order.get("cancel_reason")})
    except Exception:  # noqa: BLE001
        log.exception("interakt: on_order_status failed for %s", order.get("order_number"))
        return None


async def on_cart_reminder(user_id: str, items: list, cart_updated_at: str) -> None:
    """One WhatsApp per abandoned cart (keyed on the cart's last change), and
    only for customers who opted in to reminders."""
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1, "phone": 1, "wa_marketing_optin": 1})
        if not u or not u.get("wa_marketing_optin"):
            return
        phone = u.get("phone")
        if not phone:
            last = await db.orders.find_one({"user_id": user_id, "phone": {"$nin": [None, ""]}},
                                            {"_id": 0, "phone": 1}, sort=[("created_at", -1)])
            phone = (last or {}).get("phone")
        if not phone:
            return
        sp = split_phone(phone)
        if sp and await db.wa_optouts.find_one({"phone": f"{sp[0]}{sp[1]}"}, {"_id": 1}):
            return  # replied STOP
        titles = [(it.get("title") or "").split(" - ")[0].strip() for it in items or [] if it.get("title")]
        await send_template("cart_reminder", phone=phone, user_id=user_id, dedupe=f"cart_reminder:{user_id}:{cart_updated_at}",
                            ctx={"name": u.get("name"), "first_item": (titles[0][:60] if titles else "your books"),
                                 "more": f"and {len(titles) - 1} more" if len(titles) > 1 else "your pick"})
    except Exception:  # noqa: BLE001
        log.exception("interakt: cart reminder failed for %s", user_id)


# --------------------------------------------------------------- webhook ---
webhook_router = APIRouter(prefix="/api/interakt", tags=["interakt"])


def status_from_type(t: str) -> Optional[str]:
    """'message_api_delivered' / 'message_campaign_read' -> 'delivered' / 'read'."""
    m = re.match(r"^message_(?:api|campaign)_(sent|delivered|read|failed)$", t or "")
    return m.group(1) if m else None


@webhook_router.post("/webhook/{token}")
async def interakt_webhook(token: str, request: Request):
    secret = _secret()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    if not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=404, detail="Not found")
    raw = await request.body()
    if len(raw) > 256_000:
        raise HTTPException(status_code=413, detail="Too large")
    sig = request.headers.get("x-interakt-signature") or request.headers.get("X-Interakt-Signature")
    sig_ok = None
    if sig:
        expect = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        sig_ok = hmac.compare_digest(sig.strip().lower().removeprefix("sha256="), expect)
    try:
        ev = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad JSON")
    etype = str(ev.get("type") or "")[:60]
    data = ev.get("data") or {}
    await db.wa_events.insert_one({"id": str(uuid.uuid4()), "at": _now(), "type": etype, "sig_ok": sig_ok,
                                   "body": raw[:20000].decode("utf-8", "replace")})
    try:
        await handle_event(etype, data)
    except Exception:  # noqa: BLE001 — Interakt only needs the 200; the raw event is kept
        log.exception("interakt: webhook %s not processed", etype)
    return {"ok": True}


async def handle_event(etype: str, data: dict) -> None:
    msg = data.get("message") or {}
    cust = data.get("customer") or {}
    st = status_from_type(etype)
    if st:
        iid = str(msg.get("id") or "")
        rec = None
        if iid:
            rec = await db.wa_messages.find_one({"interakt_id": iid}, {"_id": 0, "id": 1, "status": 1})
        meta = msg.get("meta_data") or {}
        if not rec:
            # Interakt nests our callbackData at message.meta_data.source_data
            # (seen in a real delivery report, 2026-10-08), not at message.*.
            cb_raw = ((meta.get("source_data") or {}).get("callback_data")) or msg.get("callback_data") or "{}"
            try:
                cb = json.loads(cb_raw) if isinstance(cb_raw, str) else (cb_raw or {})
                rec = await db.wa_messages.find_one({"id": cb.get("m")}, {"_id": 0, "id": 1, "status": 1}) if cb.get("m") else None
            except (ValueError, TypeError, AttributeError):
                rec = None
        if not rec:
            return  # a campaign message sent from Interakt itself, not by us
        upd = {f"{st}_at": _now()}
        # What the message actually cost and how Meta classified the template.
        # A utility message approved as MARKETING costs several times more.
        cost = (meta.get("message_cost") or {}).get("actual_message_cost")
        try:
            if cost is not None:
                upd["cost"] = round(float(cost), 4)
        except (TypeError, ValueError):
            pass
        try:
            tpl = json.loads(msg.get("raw_template") or "{}") if isinstance(msg.get("raw_template"), str) else (msg.get("raw_template") or {})
            if tpl.get("category"):
                upd["template_category"] = str(tpl["category"]).upper()[:20]
        except (ValueError, TypeError):
            pass
        if st == "failed":
            upd.update({"status": "failed", "error": str(msg.get("channel_failure_reason") or msg.get("failure_reason") or "failed")[:300]})
        elif _RANK.get(st, 0) > _RANK.get(rec.get("status"), 0) and rec.get("status") != "failed":
            upd["status"] = st
        await db.wa_messages.update_one({"id": rec["id"]}, {"$set": upd, "$push": {"history": {"status": st, "at": _now()}}})
        return
    if etype == "message_received":
        phone_raw = cust.get("channel_phone_number") or cust.get("phone_number") or ""
        if cust.get("country_code") and cust.get("phone_number") and not str(phone_raw).startswith("+"):
            phone_raw = f"{cust['country_code']}{cust['phone_number']}"
        p = split_phone(str(phone_raw))
        text = msg.get("message")
        if isinstance(text, (dict, list)):
            text = json.dumps(text)[:1000]
        order = None
        if p:
            # Same number written any way on an order: match the last 10 digits.
            order = await db.orders.find_one({"phone": {"$regex": phone_rx(p[1])}},
                                             {"_id": 0, "id": 1, "order_number": 1}, sort=[("created_at", -1)])
        rep = {"id": str(uuid.uuid4()), "at": _now(), "phone": f"{p[0]}{p[1]}" if p else str(phone_raw)[:20],
               "name": str((cust.get("traits") or {}).get("name") or cust.get("name") or "")[:120],
               "text": str(text or "")[:2000], "content_type": str(msg.get("message_content_type") or "")[:40],
               # Only an https link is kept: it is shown as a link in Admin, and
               # this field comes from outside (a javascript: URL must never land).
               "media_url": str(msg.get("media_url") or "")[:500] if str(msg.get("media_url") or "").startswith("https://") else "",
               "order_id": (order or {}).get("id", ""), "order_number": (order or {}).get("order_number", ""), "read": False}
        await db.wa_replies.insert_one(dict(rep))
        # "STOP" (as promised at checkout) ends reminders/news for that number.
        if p and re.match(r"^\s*(stop|unsubscribe|stop all)\s*[.!]?\s*$", rep["text"], re.I):
            await db.wa_optouts.update_one({"phone": rep["phone"]}, {"$set": {"phone": rep["phone"], "at": rep["at"]}}, upsert=True)
            async for u in db.users.find({"phone": {"$regex": phone_rx(p[1])}}, {"_id": 0, "id": 1}):
                await db.users.update_one({"id": u["id"]}, {"$set": {"wa_marketing_optin": False, "wa_marketing_optout_at": rep["at"]}})
        if order:
            await db.orders.update_one({"id": order["id"]}, {"$inc": {"wa_replies": 1}, "$set": {"wa_last_reply_at": rep["at"]}})


# ----------------------------------------------------------------- admin ---
admin_router = APIRouter(prefix="/api/admin/interakt", tags=["interakt-admin"], dependencies=[Depends(require_admin)])


@admin_router.get("/status")
async def adm_status(user: dict = Depends(require_admin)):
    from rbac import is_superadmin
    cfg = await get_cfg()
    secret = _secret()
    # Percent-encoded: a "#" or "/" typed into the secret would otherwise cut
    # the address short (everything after "#" is never sent), and every
    # webhook would be refused. The route receives it decoded again.
    url = f"{PUBLIC_API}/api/interakt/webhook/{quote(secret, safe='')}" if secret else ""
    weak = bool(secret) and (len(secret) < 32 or not re.fullmatch(r"[A-Za-z0-9_-]+", secret))
    if url and not is_superadmin(user.get("role")):
        url = f"{PUBLIC_API}/api/interakt/webhook/••••••"   # only a superadmin pastes it into Interakt
    last = await db.wa_events.find_one({}, {"_id": 0, "at": 1, "type": 1, "sig_ok": 1}, sort=[("at", -1)])
    return {**cfg, "api_key_set": bool(_api_key()), "webhook_secret_set": bool(secret), "webhook_secret_weak": weak, "webhook_url": url,
            "category_warnings": await _category_warnings(),
            "last_webhook": last}


class CfgBody(BaseModel):
    mode: Optional[str] = None
    test_phone: Optional[str] = None
    language: Optional[str] = None
    sync_customers: Optional[bool] = None
    templates: Optional[dict] = None


@admin_router.put("/config")
async def adm_config(body: CfgBody, user: dict = Depends(require_superadmin)):
    upd: dict = {}
    if body.mode is not None:
        if body.mode not in ("off", "test", "live"):
            raise HTTPException(status_code=400, detail="mode must be off, test or live")
        upd["mode"] = body.mode
    if body.test_phone is not None:
        if body.test_phone.strip() and not split_phone(body.test_phone):
            raise HTTPException(status_code=400, detail="That is not a usable mobile number.")
        upd["test_phone"] = body.test_phone.strip()
    if body.language is not None:
        if not re.match(r"^[a-z]{2}(_[A-Z]{2})?$", body.language.strip()):
            raise HTTPException(status_code=400, detail="Language code like en or en_US")
        upd["language"] = body.language.strip()
    if body.sync_customers is not None:
        upd["sync_customers"] = bool(body.sync_customers)
    if body.templates is not None:
        t = {k: str(v).strip()[:80] for k, v in body.templates.items() if k in KINDS and str(v).strip()}
        if any(not re.match(r"^[a-z0-9_]+$", v) for v in t.values()):
            raise HTTPException(status_code=400, detail="Template names use lowercase letters, numbers and _ only.")
        upd["templates"] = {**(await get_cfg())["templates"], **t}
    if upd.get("mode") == "test" and not (upd.get("test_phone") or (await get_cfg())["test_phone"]):
        raise HTTPException(status_code=400, detail="Set the test number first — Test mode sends everything there.")
    await db.integrations.update_one({"key": "interakt"}, {"$set": {"key": "interakt", **upd, "updated_at": _now(),
                                                                    "updated_by": user.get("email", "")}}, upsert=True)
    await audit_log(db, "INTERAKT_CONFIG", email=user.get("email", ""), role=user.get("role", ""),
                    meta={k: v for k, v in upd.items() if k != "test_phone"})
    return await get_cfg()


class TestBody(BaseModel):
    kind: str


@admin_router.post("/test")
async def adm_test(body: TestBody, user: dict = Depends(require_superadmin)):
    """Send one sample of a template to the test number, whatever the mode."""
    if body.kind not in KINDS:
        raise HTTPException(status_code=400, detail="Unknown message")
    cfg = await get_cfg()
    if not split_phone(cfg["test_phone"]):
        raise HTTPException(status_code=400, detail="Set the test number first.")
    sample = {"name": "Test Customer", "order_number": "OAK-TEST", "total": 716, "items": "Practical Guide to DPDP Act + 1 more",
              "courier": "Delhivery", "tracking_id": "TEST123456", "reason": "a test", "first_item": "International Relations",
              "more": "and 2 more"}
    rec = await send_template(body.kind, phone=cfg["test_phone"], ctx=sample, dedupe="", force_test=True)
    if not rec:
        raise HTTPException(status_code=502, detail="Not sent — see the server log.")
    return rec


def _rx(q: str) -> dict:
    return {"$regex": re.escape(q.strip()[:80]), "$options": "i"}


@admin_router.get("/messages")
async def adm_messages(q: Optional[str] = None, kind: Optional[str] = None, status: Optional[str] = None,
                       order: Optional[str] = None, limit: int = 200):
    flt: dict = {}
    if kind in KINDS:
        flt["kind"] = kind
    if status:
        flt["status"] = status
    if order:
        flt["$or"] = [{"order_number": order}, {"order_id": order}]
    elif q and q.strip():
        rx = _rx(q)
        flt["$or"] = [{"order_number": rx}, {"to": rx}, {"intended_to": rx}, {"values": rx}, {"template": rx}]
    return await db.wa_messages.find(flt, {"_id": 0, "response": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 1000))


@admin_router.get("/stats")
async def adm_stats(days: int = 30):
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()
    rows = await db.wa_messages.find({"created_at": {"$gte": since}, "mode": {"$ne": "test"}},
                                     {"_id": 0, "kind": 1, "status": 1, "created_at": 1, "cost": 1}).to_list(50000)
    by_kind: dict = {}
    by_day: dict = {}
    for r in rows:
        k = by_kind.setdefault(r["kind"], {"total": 0, "failed": 0, "accepted": 0, "sent": 0, "delivered": 0, "read": 0, "queued": 0})
        k["total"] += 1
        k[r.get("status") or "queued"] = k.get(r.get("status") or "queued", 0) + 1
        k["cost"] = round(k.get("cost", 0) + float(r.get("cost") or 0), 2)
        d = by_day.setdefault(r["created_at"][:10], {"total": 0, "delivered_or_read": 0, "read": 0, "failed": 0})
        d["total"] += 1
        if r.get("status") in ("delivered", "read"):
            d["delivered_or_read"] += 1
        if r.get("status") == "read":
            d["read"] += 1
        if r.get("status") == "failed":
            d["failed"] += 1
    replies = await db.wa_replies.count_documents({"at": {"$gte": since}})
    return {"days": days, "by_kind": by_kind, "by_day": dict(sorted(by_day.items())), "replies": replies, "messages": len(rows),
            "spend": round(sum(float(r.get("cost") or 0) for r in rows), 2), "category_warnings": await _category_warnings()}


# Order messages are UTILITY by nature; the cart reminder is MARKETING.
EXPECTED_CATEGORY = {"order_confirmed": "UTILITY", "order_shipped": "UTILITY", "order_cancelled": "UTILITY", "cart_reminder": "MARKETING"}


async def _category_warnings() -> list:
    """Templates whose latest delivery report shows a different category than
    the message should have (e.g. an order update approved as MARKETING)."""
    out = []
    for kind, want in EXPECTED_CATEGORY.items():
        last = await db.wa_messages.find_one({"kind": kind, "template_category": {"$exists": True}},
                                             {"_id": 0, "template_category": 1, "template": 1}, sort=[("created_at", -1)])
        if last and last.get("template_category") and last["template_category"] != want:
            out.append({"kind": kind, "template": last.get("template", kind), "category": last["template_category"], "expected": want})
    return out


@admin_router.get("/replies")
async def adm_replies(q: Optional[str] = None, order: Optional[str] = None, limit: int = 200):
    flt: dict = {}
    if order:
        flt["$or"] = [{"order_number": order}, {"order_id": order}]
    elif q and q.strip():
        rx = _rx(q)
        flt["$or"] = [{"text": rx}, {"phone": rx}, {"name": rx}, {"order_number": rx}]
    return await db.wa_replies.find(flt, {"_id": 0}).sort("at", -1).to_list(min(max(limit, 1), 1000))


@admin_router.post("/replies/{rid}/read")
async def adm_reply_read(rid: str):
    await db.wa_replies.update_one({"id": rid}, {"$set": {"read": True}})
    return {"ok": True}


@admin_router.get("/events")
async def adm_events(limit: int = 30, user: dict = Depends(require_superadmin)):
    """Raw recent webhooks — for checking Interakt's payloads and signature."""
    return await db.wa_events.find({}, {"_id": 0}).sort("at", -1).to_list(min(max(limit, 1), 100))
