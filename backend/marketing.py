"""Marketing — contacts, free email verification, campaigns (email via Amazon
SES, WhatsApp via Interakt), tracking and the analytics behind Admin → Marketing.

Pure rules live in marketing_core.py (tested without a database).

EMAIL (Amazon SES)
  * Sent from the address in Settings (info@oakbridge.in) through SES in
    SES_REGION (falls back to S3_REGION / AWS_REGION / ap-south-1), with the
    app's existing AWS keys. Optional SES_CONFIGURATION_SET routes SES's
    delivery / bounce / complaint events to an SNS topic subscribed to
    /api/m/ses-events/<token> (Settings shows the exact URL).
  * Opens and clicks are tracked by US (a 1px image and signed redirect links),
    not by SES, so no SES tracking setup is needed and links are not wrapped
    twice. Leave open/click tracking OFF on the configuration set.
  * Every email carries List-Unsubscribe + one-click (Gmail / Yahoo rules).

VERIFICATION (free, layered — see marketing_core.verdict)
  syntax / typos / role / throwaway  ->  domain MX lookup over DNS-over-HTTPS
  (cached per domain)  ->  "proven" addresses (OTP-confirmed accounts,
  delivered / opened before)  ->  suppression (bounced, complained,
  unsubscribed). Sending goes verified -> valid -> risky (risky only if asked)
  and AUTO-PAUSES above 2% bounces / 0.1% complaints.

CONSENT
  A contact is mailed only with email_consent = subscribed, messaged on
  WhatsApp only with wa_consent = subscribed. Sources: newsletter sign-up,
  checkout tick, or an import where the admin confirms the people agreed.
  Unsubscribe / STOP / complaint switch it off for good.

WHATSAPP campaigns go through interakt.send_campaign_message (Interakt's
mode switch applies: Off refuses, Test sends to the test number).
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid
from typing import Optional
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

import marketing_core as core
from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger(__name__)

PUBLIC_API = (os.environ.get("PUBLIC_API_URL") or "https://api.oakbridge.in").rstrip("/")
SITE = (os.environ.get("SITE_URL") or "https://www.oakbridge.in").rstrip("/")
SES_REGION = (os.environ.get("SES_REGION") or os.environ.get("S3_REGION") or os.environ.get("AWS_REGION") or "ap-south-1").strip()
SES_CONFIG_SET = (os.environ.get("SES_CONFIGURATION_SET") or "").strip()

DEFAULT_SETTINGS = {
    "from_name": "Oakbridge Publishing",
    "from_email": "info@oakbridge.in",
    "reply_to": "",
    "footer": "Oakbridge Publishing Pvt. Ltd. · 934, 9th Floor, Tower B3, Spaze Itech Park, Sector 49, Gurugram 122018",
    "logo": "",
    "double_opt_in": True,
    "include_role_addresses": False,
    "max_bounce": 0.02,
    "wa_rate_marketing": 0.96,   # ₹ per message incl. Interakt markup, before GST
    "wa_rate_utility": 0.13,
    "extra_disposable": [],
}
GIF = (b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,"
       b"\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def _secret() -> str:
    # Derived from the app's JWT secret, so no extra env var is needed; the
    # salt keeps marketing links unusable as anything else.
    return hashlib.sha256((os.environ.get("JWT_SECRET", "") + "|marketing-links-v1").encode()).hexdigest()


def sns_token() -> str:
    return core.sign(_secret(), "ses-events")


async def get_settings() -> dict:
    doc = await db.integrations.find_one({"key": "marketing"}, {"_id": 0}) or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k in DEFAULT_SETTINGS}}


_indexes = False


async def _ensure_indexes() -> None:
    global _indexes
    if _indexes:
        return
    try:
        await db.mk_contacts.create_index("email_norm", unique=True, sparse=True)
        await db.mk_contacts.create_index("lists")
        await db.mk_sends.create_index([("campaign_id", 1), ("status", 1)])
        await db.mk_sends.create_index("message_id", sparse=True)
        await db.mk_sends.create_index([("campaign_id", 1), ("contact_id", 1)], unique=True)
        await db.mk_domains.create_index("domain", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("marketing: index creation failed", exc_info=True)
    _indexes = True


# ------------------------------------------------------- domain lookups ---
def _doh_mx(domain: str) -> Optional[bool]:
    """Does the domain receive mail? DNS-over-HTTPS (Cloudflare, then Google),
    so no DNS library and no UDP from the host. True / False / None
    (could not tell — never treated as invalid)."""
    for url in ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"):
        try:
            r = requests.get(url, params={"name": domain, "type": "MX"}, headers={"accept": "application/dns-json"}, timeout=5)
            if r.status_code != 200:
                continue
            j = r.json()
            status = j.get("Status")
            if status == 3:  # NXDOMAIN: the domain does not exist
                return False
            answers = [a for a in j.get("Answer") or [] if a.get("type") == 15]
            if answers:
                # A "null MX" ("0 .", RFC 7505) means "this domain accepts no mail".
                datas = [str(a.get("data", "")).strip() for a in answers]
                return not all(d in ("0 .", "0", ".") for d in datas)
            # No MX: mail falls back to the A record (RFC 5321).
            r2 = requests.get(url, params={"name": domain, "type": "A"}, headers={"accept": "application/dns-json"}, timeout=5)
            if r2.status_code == 200:
                return bool([a for a in r2.json().get("Answer") or [] if a.get("type") == 1])
        except (requests.RequestException, ValueError):
            continue
    return None


async def domains_mx(domains: set) -> dict:
    """{domain: True/False/None}, cached 30 days in mk_domains."""
    out: dict = {}
    if not domains:
        return out
    fresh_after = (_now() - timedelta(days=30)).isoformat()
    async for d in db.mk_domains.find({"domain": {"$in": list(domains)}, "checked_at": {"$gte": fresh_after}}, {"_id": 0}):
        out[d["domain"]] = d.get("mx")
    todo = [d for d in domains if d not in out]
    sem = asyncio.Semaphore(16)

    async def one(d):
        async with sem:
            v = await asyncio.to_thread(_doh_mx, d)
            out[d] = v
            if v is not None:
                await db.mk_domains.update_one({"domain": d}, {"$set": {"domain": d, "mx": v, "checked_at": _iso()}}, upsert=True)

    await asyncio.gather(*(one(d) for d in todo))
    return out


async def _proven(emails_norm: list) -> set:
    """Addresses already shown to be real mailboxes: an OTP-confirmed account,
    or a campaign email that was delivered / opened / clicked."""
    proven = set()
    async for u in db.users.find({"email_verified": True}, {"_id": 0, "email": 1}):
        proven.add(core.normalise_email(u.get("email")))
    async for c in db.mk_contacts.find({"email_norm": {"$in": emails_norm}, "proven": True}, {"_id": 0, "email_norm": 1}):
        proven.add(c["email_norm"])
    return proven & set(emails_norm)


async def verify_emails(raw: list, *, autofix: bool = True) -> list:
    """Full verification for a batch of raw strings. One result per input row:
    {input, email, email_norm, status, reasons[], fixed_from}."""
    st = await get_settings()
    extra_disp = {d.strip().lower() for d in st.get("extra_disposable") or [] if d.strip()}
    rows = []
    for r in raw:
        s = core.check_syntax(r)
        fixed_from = None
        if autofix and s["ok"] and s["suggestion"]:
            fixed_from = s["email"]
            s = {**core.check_syntax(s["suggestion"]), "reasons": [f"fixed typo from {fixed_from}"]}
        if s["ok"] and s["email"].split("@")[1] in extra_disp:
            s.update(ok=False, disposable=True, reasons=s["reasons"] + ["throwaway domain"])
        rows.append({"input": r, "syntax": s, "fixed_from": fixed_from})
    domains = {x["syntax"]["email"].split("@")[1] for x in rows if x["syntax"]["ok"]}
    mx = await domains_mx(domains)
    norms = [core.normalise_email(x["syntax"]["email"]) for x in rows]
    proven = await _proven([n for n in norms if n])
    supp = {}
    async for c in db.mk_contacts.find({"email_norm": {"$in": norms}, "suppressed": {"$nin": [None, ""]}},
                                       {"_id": 0, "email_norm": 1, "suppressed": 1}):
        supp[c["email_norm"]] = c["suppressed"]
    out = []
    for x, n in zip(rows, norms):
        s = x["syntax"]
        dom_mx = mx.get(s["email"].split("@")[1]) if s["ok"] else None
        status = core.verdict(s, dom_mx, proven=n in proven, suppressed=supp.get(n))
        reasons = list(s["reasons"])
        if s["ok"] and dom_mx is False:
            reasons.append("domain does not receive email")
        if s["ok"] and dom_mx is None:
            reasons.append("domain check did not finish")
        if supp.get(n):
            reasons.append(f"previously {supp[n]}")
        if n in proven:
            reasons.append("proven (confirmed account or delivered before)")
        out.append({"input": x["input"], "email": s["email"], "email_norm": n, "status": status,
                    "reasons": reasons, "fixed_from": x["fixed_from"], "role": s.get("role", False)})
    return out


# ------------------------------------------------------------- contacts ---
def _consent(status: str, source: str, by: str = "") -> dict:
    return {"status": status, "source": source[:120], "at": _iso(), "by": by}


async def upsert_contact(email: str, *, name: str = "", phone: str = "", source: str = "",
                         email_consent: Optional[str] = None, wa_consent: Optional[str] = None,
                         lists: Optional[list] = None, status: Optional[str] = None, reasons: Optional[list] = None,
                         proven: Optional[bool] = None, customer: Optional[bool] = None, by: str = "") -> Optional[dict]:
    """Create or update one contact (keyed on the real mailbox). Consent is
    only ever RAISED to subscribed by a new opt-in, never by an import of an
    already-unsubscribed contact: an unsubscribe is final."""
    await _ensure_indexes()
    s = core.check_syntax(email)
    if not s["email"]:
        return None
    norm = core.normalise_email(s["email"])
    if await db.mk_erased.find_one({"h": hashlib.sha256(norm.encode()).hexdigest()}, {"_id": 1}):
        return None  # erased on request: an old export must not bring them back
    cur = await db.mk_contacts.find_one({"email_norm": norm}, {"_id": 0})
    now = _iso()
    if not cur:
        cur = {"id": str(uuid.uuid4()), "email": s["email"], "email_norm": norm, "name": "", "phone": "", "lists": [],
               "source": source, "created_at": now, "email_status": "unknown", "reasons": [], "suppressed": "",
               "email_consent": _consent("none", source), "wa_consent": _consent("none", source),
               "stats": {"sent": 0, "opened": 0, "clicked": 0}}
        await db.mk_contacts.insert_one(dict(cur))
    upd: dict = {"updated_at": now}
    if name and not cur.get("name"):
        upd["name"] = name.strip()[:120]
    if phone and not cur.get("phone"):
        upd["phone"] = re.sub(r"[^\d+ ]", "", phone)[:20]
    if status:
        upd["email_status"] = status
        upd["reasons"] = (reasons or [])[:6]
        upd["verified_at"] = now
    if proven:
        upd["proven"] = True
    if customer:
        upd["customer"] = True
    final = {"unsubscribed", "complained"}
    if email_consent and cur.get("email_consent", {}).get("status") not in final:
        if not (email_consent == "pending" and cur.get("email_consent", {}).get("status") == "subscribed"):
            upd["email_consent"] = _consent(email_consent, source, by)
    if wa_consent and cur.get("wa_consent", {}).get("status") not in final:
        upd["wa_consent"] = _consent(wa_consent, source, by)
    ops: dict = {"$set": upd}
    if lists:
        ops["$addToSet"] = {"lists": {"$each": lists}}
    await db.mk_contacts.update_one({"id": cur["id"]}, ops)
    return {**cur, **upd}


async def suppress(contact_filter: dict, reason: str) -> None:
    """Never email again: bounced, complained (also unsubscribes)."""
    upd = {"suppressed": reason, "suppressed_at": _iso(), "email_status": "suppressed"}
    if reason in ("complained", "unsubscribed"):
        upd["email_consent"] = _consent("complained" if reason == "complained" else "unsubscribed", reason)
    await db.mk_contacts.update_one(contact_filter, {"$set": upd})


# hooks ------------------------------------------------------------------
async def on_newsletter(email: str, source: str = "newsletter") -> None:
    """Website sign-up. With double opt-in on, the contact waits as 'pending'
    until they click the confirmation link we email them."""
    try:
        st = await get_settings()
        if st["double_opt_in"]:
            c = await upsert_contact(email, source=source or "newsletter", email_consent="pending")
            if c and c.get("email_consent", {}).get("status") == "pending":
                await send_confirmation(c)
        else:
            await upsert_contact(email, source=source or "newsletter", email_consent="subscribed")
    except Exception:  # noqa: BLE001
        log.exception("marketing: newsletter hook failed for %s", email)


async def on_order_paid(order: dict) -> None:
    """Paid customer -> contact (customer + proven deliverable once their
    receipt went out); consent only if they ticked the box at checkout."""
    try:
        await upsert_contact(order.get("email", ""), name=order.get("full_name", ""), phone=order.get("phone", ""),
                             source="checkout", customer=True,
                             email_consent="subscribed" if order.get("email_marketing_optin") else None)
    except Exception:  # noqa: BLE001
        log.exception("marketing: order hook failed for %s", order.get("order_number"))


# ------------------------------------------------------------------ SES ---
def _ses():
    import boto3
    return boto3.client("sesv2", region_name=SES_REGION)


def _send_raw(msg_bytes: bytes) -> str:
    kw = {"Content": {"Raw": {"Data": msg_bytes}}}
    if SES_CONFIG_SET:
        kw["ConfigurationSetName"] = SES_CONFIG_SET
    return _ses().send_email(**kw)["MessageId"]


def build_mime(*, st: dict, to: str, subject: str, html_doc: str, text_doc: str, unsub_post: str) -> bytes:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((st["from_name"], st["from_email"]))
    msg["To"] = to
    if st.get("reply_to"):
        msg["Reply-To"] = st["reply_to"]
    msg["Message-ID"] = make_msgid(domain=st["from_email"].split("@")[-1])
    if unsub_post:
        msg["List-Unsubscribe"] = f"<{unsub_post}>, <mailto:{st['from_email']}?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.attach(MIMEText(text_doc, "plain", "utf-8"))
    msg.attach(MIMEText(html_doc, "html", "utf-8"))
    return msg.as_bytes()


def _links(send_id: str):
    sec = _secret()
    return {
        "open": f"{PUBLIC_API}/api/m/o/{send_id}/{core.sign(sec, 'o', send_id)}.gif",
        "unsub_page": f"{SITE}/unsubscribe?s={send_id}&t={core.sign(sec, 'u', send_id)}",
        "unsub_post": f"{PUBLIC_API}/api/m/u/{send_id}/{core.sign(sec, 'u', send_id)}",
        "click": lambda idx: f"{PUBLIC_API}/api/m/c/{send_id}/{idx}/{core.sign(sec, 'c', send_id, str(idx))}",
    }


def render_for(campaign: dict, contact: dict, send_id: str, st: dict) -> tuple[str, str]:
    links = campaign.get("links") or []
    L = _links(send_id)

    def link_for(u):
        return L["click"](links.index(u)) if u in links else u

    brand = {"name": "Oakbridge Publishing", "logo": st.get("logo"), "footer": st.get("footer"), "navy": "#002B5C", "red": "#CC0033"}
    return core.render_email(campaign.get("blocks") or [], brand=brand, contact=contact, link_for=link_for,
                             open_pixel=L["open"], unsubscribe_url=L["unsub_page"],
                             preheader=core.personalise(campaign.get("preheader") or "", contact))


async def send_confirmation(contact: dict) -> None:
    """Double opt-in email (not tracked, no unsubscribe needed: one email,
    sent because they asked)."""
    st = await get_settings()
    sig = core.sign(_secret(), "confirm", contact["id"])
    url = f"{SITE}/subscribe/confirm?c={contact['id']}&t={sig}"
    blocks = [{"type": "heading", "text": "Please confirm your subscription"},
              {"type": "text", "text": "You asked to hear about new books, events and offers from Oakbridge Publishing. Click below to confirm. If this wasn't you, ignore this email and nothing happens."},
              {"type": "button", "label": "Yes, subscribe me", "url": url}]
    html_doc, text_doc = core.render_email(blocks, brand={"name": "Oakbridge Publishing", "logo": st.get("logo"), "footer": st.get("footer")},
                                           contact=contact, link_for=lambda u: u)
    raw = build_mime(st=st, to=contact["email"], subject="Confirm your subscription to Oakbridge", html_doc=html_doc,
                     text_doc=text_doc, unsub_post="")
    try:
        await asyncio.to_thread(_send_raw, raw)
        await db.mk_contacts.update_one({"id": contact["id"]}, {"$set": {"confirm_sent_at": _iso()}})
    except Exception:  # noqa: BLE001
        log.exception("marketing: confirmation email failed for %s", contact.get("email"))


# ------------------------------------------------------------- audience ---
async def _rule_emails(rule: dict) -> Optional[set]:
    """email_norm set for rules that look outside mk_contacts (orders, carts)."""
    t = rule.get("type")
    if t == "bought_category":
        since = (_now() - timedelta(days=int(rule.get("days") or 180))).isoformat()
        cat = str(rule.get("category") or "")
        ids = [b["id"] async for b in db.books.find({"category": cat}, {"_id": 0, "id": 1})]
        out = set()
        async for o in db.orders.find({"payment_status": "paid", "created_at": {"$gte": since}, "items.book_id": {"$in": ids}},
                                      {"_id": 0, "email": 1}):
            out.add(core.normalise_email(o.get("email")))
        return out
    if t == "customers":
        since = (_now() - timedelta(days=int(rule.get("days") or 3650))).isoformat()
        return {core.normalise_email(o.get("email")) async for o in db.orders.find(
            {"payment_status": "paid", "created_at": {"$gte": since}}, {"_id": 0, "email": 1})}
    if t == "abandoned_cart":
        uids = [c["user_id"] async for c in db.carts.find({"items.0": {"$exists": True}}, {"_id": 0, "user_id": 1})]
        return {core.normalise_email(u.get("email")) async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "email": 1})}
    return None


async def audience_filter(campaign: dict) -> dict:
    """Mongo filter for who a campaign goes to. Consent and suppression are
    applied here, always — no option skips them."""
    aud = campaign.get("audience") or {}
    flt: dict = {}
    ors = []
    if aud.get("list_ids"):
        ors.append({"lists": {"$in": aud["list_ids"]}})
    rules = aud.get("rules") or []
    and_parts = []
    for r in rules:
        if r.get("type") == "source":
            and_parts.append({"source": r.get("value")})
        elif r.get("type") == "status":
            and_parts.append({"email_status": r.get("value")})
        else:
            emails = await _rule_emails(r)
            if emails is not None:
                and_parts.append({"email_norm": {"$in": list(emails)}})
    if ors:
        flt["$or"] = ors
    if and_parts:
        flt["$and"] = and_parts
    if aud.get("exclude_list_ids"):
        flt["lists"] = {"$nin": aud["exclude_list_ids"]}
    if campaign.get("channel") == "whatsapp":
        flt["wa_consent.status"] = "subscribed"
        flt["phone"] = {"$nin": [None, ""]}
    else:
        flt["email_consent.status"] = "subscribed"
        flt["suppressed"] = {"$in": [None, ""]}
        allowed = ["verified", "valid"] + (["risky"] if aud.get("include_risky") else [])
        flt["email_status"] = {"$in": allowed}
    return flt


# -------------------------------------------------------------- sending ---
WORKER_STALE = 120  # seconds without a heartbeat before another tick takes over
_running: set = set()


async def start_campaign(cid: str) -> None:
    if cid in _running:
        return
    asyncio.create_task(_run_campaign(cid))


async def _run_campaign(cid: str) -> None:
    """Send a campaign's queued messages, rate-limited to the SES quota,
    re-checking pause / cancel and the bounce guard after every batch."""
    _running.add(cid)
    try:
        st = await get_settings()
        rate = 1.0
        camp = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
        if not camp:
            return
        if camp["channel"] == "email":
            try:
                acct = await asyncio.to_thread(lambda: _ses().get_account())
                rate = max(1.0, float((acct.get("SendQuota") or {}).get("MaxSendRate") or 1)) * 0.8
            except Exception:  # noqa: BLE001
                log.warning("marketing: could not read SES quota; sending at 1/s", exc_info=True)
        while True:
            camp = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
            if not camp or camp.get("status") != "sending":
                return
            await db.mk_campaigns.update_one({"id": cid}, {"$set": {"heartbeat": _iso()}})
            batch = await db.mk_sends.find({"campaign_id": cid, "status": "queued"}, {"_id": 0}).sort(
                [("priority", 1), ("queued_at", 1)]).limit(25).to_list(25)
            if not batch:
                await db.mk_campaigns.update_one({"id": cid, "status": "sending"}, {"$set": {"status": "sent", "finished_at": _iso()}})
                await refresh_campaign_stats(cid)
                return
            for s in batch:
                contact = await db.mk_contacts.find_one({"id": s["contact_id"]}, {"_id": 0}) or {}
                ok_now = (contact.get("email_consent", {}).get("status") == "subscribed" and not contact.get("suppressed")) \
                    if camp["channel"] == "email" else contact.get("wa_consent", {}).get("status") == "subscribed"
                if not ok_now:  # unsubscribed / bounced since the campaign was queued
                    await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"status": "skipped", "error": "no longer subscribed"}})
                    continue
                if camp["channel"] == "email":
                    try:
                        html_doc, text_doc = render_for(camp, contact, s["id"], st)
                        raw = build_mime(st=st, to=contact["email"], subject=core.personalise(camp["subject"], contact),
                                         html_doc=html_doc, text_doc=text_doc, unsub_post=_links(s["id"])["unsub_post"])
                        mid = await asyncio.to_thread(_send_raw, raw)
                        await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"status": "sent", "message_id": mid, "sent_at": _iso()}})
                        await db.mk_contacts.update_one({"id": contact["id"]}, {"$inc": {"stats.sent": 1}, "$set": {"last_sent_at": _iso()}})
                    except Exception as e:  # noqa: BLE001
                        await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"status": "failed", "error": str(e)[:300]}})
                        if "Throttling" in str(e) or "MaxSendRate" in str(e):
                            await asyncio.sleep(2)
                    await asyncio.sleep(1.0 / rate)
                else:
                    from interakt import send_campaign_message
                    values = [core.personalise(v.get("value", ""), contact) if v.get("source") == "static"
                              else (contact.get("name") or "there").split(" ")[0] if v.get("source") == "first_name"
                              else (contact.get("name") or "there") for v in camp.get("wa_variables") or []]
                    rec = await send_campaign_message(template=camp["wa_template"], language=camp.get("wa_language") or "en",
                                                      values=values, phone=contact.get("phone"),
                                                      dedupe=f"campaign:{cid}:{contact['id']}", campaign_id=cid)
                    upd = {"status": "sent" if rec and rec.get("status") != "failed" else "failed", "sent_at": _iso(),
                           "wa_message_id": (rec or {}).get("id", ""), "error": (rec or {}).get("error", "") if rec else "not sent (WhatsApp is off?)"}
                    await db.mk_sends.update_one({"id": s["id"]}, {"$set": upd})
                    await asyncio.sleep(0.25)
            await refresh_campaign_stats(cid)
            camp = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "stats": 1, "channel": 1})
            if camp["channel"] == "email":
                s_ = camp.get("stats") or {}
                why = core.should_pause(s_.get("sent", 0), s_.get("bounced", 0), s_.get("complained", 0),
                                        max_bounce=float(st.get("max_bounce") or 0.02))
                if why:
                    await db.mk_campaigns.update_one({"id": cid, "status": "sending"},
                                                     {"$set": {"status": "paused", "paused_reason": f"Auto-paused: {why}", "paused_at": _iso()}})
                    return
    except Exception:  # noqa: BLE001
        log.exception("marketing: campaign %s worker crashed", cid)
    finally:
        _running.discard(cid)


async def refresh_campaign_stats(cid: str) -> dict:
    camp = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "channel": 1, "id": 1})
    if not camp:
        return {}
    counts: dict = {}
    async for r in db.mk_sends.aggregate([{"$match": {"campaign_id": cid}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        counts[r["_id"]] = r["n"]
    agg = {"queued": counts.get("queued", 0), "failed": counts.get("failed", 0), "skipped": counts.get("skipped", 0)}
    sent_like = sum(v for k, v in counts.items() if k not in ("queued", "failed", "skipped"))
    agg["sent"] = sent_like
    for fld in ("delivered_at", "opened_at", "clicked_at", "unsubscribed_at"):
        agg[fld.replace("_at", "")] = await db.mk_sends.count_documents({"campaign_id": cid, fld: {"$exists": True}})
    agg["bounced"] = counts.get("bounced", 0)
    agg["complained"] = counts.get("complained", 0)
    if camp["channel"] == "whatsapp":
        wa = {}
        async for r in db.wa_messages.aggregate([{"$match": {"campaign_id": cid}}, {"$group": {"_id": "$status", "n": {"$sum": 1},
                                                                                             "cost": {"$sum": {"$ifNull": ["$cost", 0]}}}}]):
            wa[r["_id"]] = r
        agg["delivered"] = sum(wa.get(k, {}).get("n", 0) for k in ("delivered", "read"))
        agg["read"] = wa.get("read", {}).get("n", 0)
        agg["opened"] = agg["read"]
        agg["failed"] = agg["failed"] + wa.get("failed", {}).get("n", 0)
        agg["cost"] = round(sum(v.get("cost", 0) for v in wa.values()), 2)
    tag = core.campaign_tag(cid)
    orders = await db.orders.find({"attribution.utm_campaign": tag}, {"_id": 0, "payment_status": 1, "total": 1}).to_list(5000)
    agg["orders"] = len(orders)
    agg["paid"] = sum(1 for o in orders if o.get("payment_status") == "paid")
    agg["revenue"] = round(sum(float(o.get("total") or 0) for o in orders if o.get("payment_status") == "paid"), 2)
    await db.mk_campaigns.update_one({"id": cid}, {"$set": {"stats": agg, "stats_at": _iso()}})
    return agg


# =========================================================== public API ===
public_router = APIRouter(prefix="/api/m", tags=["marketing-public"])


@public_router.get("/o/{send_id}/{sig}.gif")
async def track_open(send_id: str, sig: str):
    if core.check_sig(_secret(), sig, "o", send_id):
        s = await db.mk_sends.find_one({"id": send_id}, {"_id": 0, "opened_at": 1, "contact_id": 1})
        if s:
            upd = {"$inc": {"open_count": 1}}
            if not s.get("opened_at"):
                upd["$set"] = {"opened_at": _iso()}
                await db.mk_contacts.update_one({"id": s["contact_id"]}, {"$inc": {"stats.opened": 1}, "$set": {"proven": True}})
            await db.mk_sends.update_one({"id": send_id}, upd)
    return Response(content=GIF, media_type="image/gif", headers={"Cache-Control": "no-store, max-age=0"})


@public_router.get("/c/{send_id}/{idx}/{sig}")
async def track_click(send_id: str, idx: int, sig: str):
    if not core.check_sig(_secret(), sig, "c", send_id, str(idx)):
        return RedirectResponse(SITE, status_code=302)
    s = await db.mk_sends.find_one({"id": send_id}, {"_id": 0})
    camp = await db.mk_campaigns.find_one({"id": (s or {}).get("campaign_id")}, {"_id": 0, "links": 1, "id": 1}) if s else None
    links = (camp or {}).get("links") or []
    if not s or idx < 0 or idx >= len(links):
        return RedirectResponse(SITE, status_code=302)
    upd = {"$inc": {"click_count": 1}, "$push": {"clicks": {"$each": [{"i": idx, "at": _iso()}], "$slice": -50}}}
    sets = {}
    if not s.get("clicked_at"):
        sets["clicked_at"] = _iso()
        await db.mk_contacts.update_one({"id": s["contact_id"]}, {"$inc": {"stats.clicked": 1}, "$set": {"proven": True}})
    if not s.get("opened_at"):
        sets["opened_at"] = _iso()  # a click proves the open (images may be blocked)
    if sets:
        upd["$set"] = sets
    await db.mk_sends.update_one({"id": send_id}, upd)
    return RedirectResponse(core.add_utm(links[idx], camp["id"]), status_code=302)


async def _unsubscribe(send_id: str, how: str) -> Optional[dict]:
    s = await db.mk_sends.find_one({"id": send_id}, {"_id": 0})
    if not s:
        return None
    await db.mk_sends.update_one({"id": send_id, "unsubscribed_at": {"$exists": False}}, {"$set": {"unsubscribed_at": _iso()}})
    c = await db.mk_contacts.find_one({"id": s["contact_id"]}, {"_id": 0, "email": 1, "id": 1})
    if c:
        await db.mk_contacts.update_one({"id": c["id"]}, {"$set": {"email_consent": _consent("unsubscribed", how)}})
    return c


@public_router.get("/u/{send_id}/{sig}")
async def unsub_info(send_id: str, sig: str):
    if not core.check_sig(_secret(), sig, "u", send_id):
        raise HTTPException(status_code=404, detail="This link is not valid.")
    s = await db.mk_sends.find_one({"id": send_id}, {"_id": 0, "contact_id": 1})
    c = await db.mk_contacts.find_one({"id": (s or {}).get("contact_id")}, {"_id": 0, "email": 1, "email_consent": 1}) if s else None
    if not c:
        raise HTTPException(status_code=404, detail="This link is not valid.")
    local, _, dom = c["email"].partition("@")
    return {"email": f"{local[:2]}•••@{dom}", "subscribed": c.get("email_consent", {}).get("status") == "subscribed"}


@public_router.post("/u/{send_id}/{sig}")
async def unsub(send_id: str, sig: str):
    """Both the page's button and the mail app's one-click (RFC 8058) land here."""
    if not core.check_sig(_secret(), sig, "u", send_id):
        raise HTTPException(status_code=404, detail="This link is not valid.")
    c = await _unsubscribe(send_id, "unsubscribe link")
    if not c:
        raise HTTPException(status_code=404, detail="This link is not valid.")
    return {"ok": True}


class ConfirmBody(BaseModel):
    c: str
    t: str


@public_router.post("/confirm")
async def confirm_subscription(body: ConfirmBody):
    if not core.check_sig(_secret(), body.t, "confirm", body.c):
        raise HTTPException(status_code=404, detail="This link is not valid.")
    c = await db.mk_contacts.find_one({"id": body.c}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="This link is not valid.")
    if c.get("email_consent", {}).get("status") in ("unsubscribed", "complained"):
        return {"ok": True, "status": c["email_consent"]["status"]}
    await db.mk_contacts.update_one({"id": c["id"]}, {"$set": {
        "email_consent": _consent("subscribed", "confirmed (double opt-in)"), "proven": True,
        "email_status": "verified", "verified_at": _iso()}})
    return {"ok": True, "status": "subscribed"}


@public_router.post("/ses-events/{token}")
async def ses_events(token: str, request: Request):
    """SNS -> SES delivery / bounce / complaint events.

    Guarded by a secret token in the URL and by the topic ARN (SNS_TOPIC_ARN,
    if set). A subscription confirmation is accepted only from an
    https://sns.<region>.amazonaws.com address — the URL is fetched, so it
    must never be somewhere an attacker chose."""
    import hmac as _h
    if not _h.compare_digest(token, sns_token()):
        raise HTTPException(status_code=404, detail="Not found")
    raw = await request.body()
    try:
        env = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad JSON")
    want_arn = (os.environ.get("SNS_TOPIC_ARN") or "").strip()
    if want_arn and env.get("TopicArn") != want_arn:
        raise HTTPException(status_code=403, detail="Wrong topic")
    typ = env.get("Type")
    await db.mk_events.insert_one({"at": _iso(), "type": typ, "body": raw[:20000].decode("utf-8", "replace")})
    if typ == "SubscriptionConfirmation":
        url = env.get("SubscribeURL") or ""
        host = urlparse(url).hostname or ""
        if url.startswith("https://") and re.fullmatch(r"sns\.[a-z0-9-]+\.amazonaws\.com", host):
            await asyncio.to_thread(lambda: requests.get(url, timeout=10))
            return {"ok": True, "confirmed": True}
        raise HTTPException(status_code=400, detail="Unexpected SubscribeURL")
    if typ != "Notification":
        return {"ok": True}
    try:
        msg = json.loads(env.get("Message") or "{}")
    except ValueError:
        return {"ok": True}
    await handle_ses_event(msg)
    return {"ok": True}


async def handle_ses_event(msg: dict) -> None:
    kind = msg.get("eventType") or msg.get("notificationType") or ""
    mail = msg.get("mail") or {}
    mid = mail.get("messageId")
    s = await db.mk_sends.find_one({"message_id": mid}, {"_id": 0}) if mid else None
    if kind == "Delivery":
        if s:
            await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"delivered_at": _iso()}})
            await db.mk_contacts.update_one({"id": s["contact_id"]}, {"$set": {"proven": True}})
    elif kind == "Bounce":
        b = msg.get("bounce") or {}
        permanent = b.get("bounceType") == "Permanent"
        for r in b.get("bouncedRecipients") or []:
            norm = core.normalise_email(r.get("emailAddress"))
            if permanent:
                await suppress({"email_norm": norm}, "bounced")
            else:
                await db.mk_contacts.update_one({"email_norm": norm}, {"$inc": {"soft_bounces": 1}})
                c = await db.mk_contacts.find_one({"email_norm": norm}, {"_id": 0, "soft_bounces": 1})
                if c and c.get("soft_bounces", 0) >= 3:
                    await suppress({"email_norm": norm}, "bounced")
        if s:
            await db.mk_sends.update_one({"id": s["id"]}, {"$set": {
                "status": "bounced" if permanent else s.get("status"), "bounce_type": b.get("bounceType"),
                "bounce_sub": b.get("bounceSubType"), "bounced_at": _iso(),
                "error": str(((b.get("bouncedRecipients") or [{}])[0]).get("diagnosticCode") or "")[:300]}})
    elif kind == "Complaint":
        for r in (msg.get("complaint") or {}).get("complainedRecipients") or []:
            await suppress({"email_norm": core.normalise_email(r.get("emailAddress"))}, "complained")
        if s:
            await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"status": "complained", "complained_at": _iso()}})
    elif kind in ("Reject", "Rendering Failure"):
        if s:
            await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"status": "failed", "error": kind}})


# ============================================================ admin API ===
admin_router = APIRouter(prefix="/api/admin/marketing", tags=["marketing-admin"], dependencies=[Depends(require_admin)])


# ---- settings + health ----
@admin_router.get("/settings")
async def adm_settings(user: dict = Depends(require_admin)):
    from rbac import is_superadmin
    st = await get_settings()
    url = f"{PUBLIC_API}/api/m/ses-events/{sns_token()}"
    return {**st, "ses_region": SES_REGION, "configuration_set": SES_CONFIG_SET,
            "sns_url": url if is_superadmin(user.get("role")) else f"{PUBLIC_API}/api/m/ses-events/••••••",
            "last_ses_event": await db.mk_events.find_one({}, {"_id": 0, "at": 1, "type": 1}, sort=[("at", -1)])}


class SettingsBody(BaseModel):
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    reply_to: Optional[str] = None
    footer: Optional[str] = None
    logo: Optional[str] = None
    double_opt_in: Optional[bool] = None
    include_role_addresses: Optional[bool] = None
    max_bounce: Optional[float] = None
    wa_rate_marketing: Optional[float] = None
    wa_rate_utility: Optional[float] = None
    extra_disposable: Optional[list] = None


@admin_router.put("/settings")
async def adm_put_settings(body: SettingsBody, user: dict = Depends(require_superadmin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    for k in ("from_email", "reply_to"):
        if upd.get(k) and not core.check_syntax(upd[k])["ok"]:
            raise HTTPException(status_code=400, detail=f"{k.replace('_', ' ')} is not a valid email address")
    if "max_bounce" in upd and not (0.005 <= upd["max_bounce"] <= 0.05):
        raise HTTPException(status_code=400, detail="Auto-pause must be between 0.5% and 5% bounces")
    if "extra_disposable" in upd:
        upd["extra_disposable"] = [str(d).strip().lower() for d in upd["extra_disposable"] if str(d).strip()][:500]
    await db.integrations.update_one({"key": "marketing"}, {"$set": {"key": "marketing", **upd, "updated_at": _iso()}}, upsert=True)
    await audit_log(db, "MARKETING_SETTINGS", email=user.get("email", ""), role=user.get("role", ""), meta={k: v for k, v in upd.items() if k != "footer"})
    return await get_settings()


@admin_router.get("/health")
async def adm_health():
    """Is SES ready to send from our address? Read straight from SES."""
    st = await get_settings()
    out: dict = {"region": SES_REGION}
    try:
        a = await asyncio.to_thread(lambda: _ses().get_account())
        q = a.get("SendQuota") or {}
        out.update({"ok": True, "sending_enabled": a.get("SendingEnabled"), "production": a.get("ProductionAccessEnabled"),
                    "max_24h": q.get("Max24HourSend"), "sent_24h": q.get("SentLast24Hours"), "max_rate": q.get("MaxSendRate"),
                    "enforcement": a.get("EnforcementStatus")})
    except Exception as e:  # noqa: BLE001
        out.update({"ok": False, "error": str(e)[:300]})
    dom = st["from_email"].split("@")[-1]
    for ident in (st["from_email"], dom):
        try:
            i = await asyncio.to_thread(lambda: _ses().get_email_identity(EmailIdentity=ident))
            out["identity"] = {"name": ident, "verified": i.get("VerifiedForSendingStatus"),
                               "dkim": (i.get("DkimAttributes") or {}).get("Status")}
            break
        except Exception:  # noqa: BLE001
            continue
    since = (_now() - timedelta(days=30)).isoformat()
    sent = await db.mk_sends.count_documents({"sent_at": {"$gte": since}, "message_id": {"$exists": True}})
    bounced = await db.mk_sends.count_documents({"sent_at": {"$gte": since}, "status": "bounced"})
    compl = await db.mk_sends.count_documents({"sent_at": {"$gte": since}, "status": "complained"})
    out["last30"] = {"sent": sent, "bounce_rate": core.rate(bounced, sent), "complaint_rate": core.rate(compl, sent)}
    return out


# ---- verification + import ----
class VerifyBody(BaseModel):
    emails: list[str]
    autofix: bool = True


@admin_router.post("/verify")
async def adm_verify(body: VerifyBody):
    """Check up to 200 typed / pasted addresses without saving anything."""
    rows = await verify_emails([e for e in body.emails if str(e).strip()][:200], autofix=body.autofix)
    return {"results": rows, "counts": _count(rows)}


def _count(rows: list) -> dict:
    c = {"total": len(rows)}
    for r in rows:
        c[r["status"]] = c.get(r["status"], 0) + 1
    c["fixed"] = sum(1 for r in rows if r.get("fixed_from"))
    return c


def _read_table(data: bytes, filename: str) -> list[dict]:
    """Rows from .xlsx / .csv as dicts keyed by lower-cased header."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [str(h or "").strip().lower() for h in next(it, [])]
        return [{header[i]: ("" if v is None else str(v)).strip() for i, v in enumerate(r) if i < len(header)} for r in it]
    text = data.decode("utf-8-sig", errors="replace")
    rd = csv.DictReader(io.StringIO(text))
    return [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in rd]


def _pick(cols: list, *names) -> Optional[str]:
    for n in names:
        for c in cols:
            if c == n:
                return c
    for n in names:
        for c in cols:
            if n in c:
                return c
    return None


@admin_router.post("/import")
async def adm_import(
    file: UploadFile = File(...),
    list_name: str = Form(""),
    consent_email: bool = Form(False),
    consent_whatsapp: bool = Form(False),
    consent_source: str = Form(""),
    autofix: bool = Form(True),
    dry_run: bool = Form(True),
    user: dict = Depends(require_admin),
):
    """Upload a sheet -> verification report. dry_run=True only reports;
    dry_run=False saves contacts (sendable + risky; invalid ones are kept out)
    into the named list. Consent can only be marked if the admin confirms it
    and says where it came from."""
    data = await file.read()
    if len(data) > 8_000_000:
        raise HTTPException(status_code=413, detail="File too large (8 MB max)")
    try:
        rows = _read_table(data, file.filename)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read the file: {str(e)[:120]}")
    if not rows:
        raise HTTPException(status_code=400, detail="The file has no rows")
    if len(rows) > 50000:
        raise HTTPException(status_code=400, detail="50,000 rows at a time, please split the file")
    cols = list(rows[0].keys())
    ecol = _pick(cols, "email", "e-mail", "email address", "mail")
    if not ecol:
        raise HTTPException(status_code=400, detail=f"No email column found (columns: {', '.join(cols[:12])})")
    ncol = _pick(cols, "name", "full name", "first name")
    pcol = _pick(cols, "phone", "mobile", "whatsapp", "contact")
    if (consent_email or consent_whatsapp) and len(consent_source.strip()) < 3:
        raise HTTPException(status_code=400, detail="Say where these people agreed to hear from you (e.g. 'Law summit 2026 registration form')")
    # duplicates inside the file (same mailbox)
    seen, unique_rows, dups = set(), [], 0
    for r in rows:
        k = core.normalise_email(core.check_syntax(r.get(ecol, ""))["email"])
        if k and k in seen:
            dups += 1
            continue
        if k:
            seen.add(k)
        unique_rows.append(r)
    results = await verify_emails([r.get(ecol, "") for r in unique_rows], autofix=autofix)
    st = await get_settings()
    counts = _count(results)
    counts["duplicates_in_file"] = dups
    saved = 0
    lid = None
    if not dry_run:
        name = list_name.strip() or f"Import {_now():%d %b %Y %H:%M}"
        lid = str(uuid.uuid4())
        await db.mk_lists.insert_one({"id": lid, "name": name[:80], "kind": "static", "created_at": _iso(), "created_by": user.get("email", "")})
        src = f"import: {consent_source.strip() or name}"[:120]
        for r, v in zip(unique_rows, results):
            if v["status"] in ("invalid", "suppressed"):
                continue
            if v["status"] == "risky" and v.get("role") and not st["include_role_addresses"]:
                pass  # kept, but campaigns skip risky unless asked
            await upsert_contact(v["email"], name=r.get(ncol, "") if ncol else "", phone=r.get(pcol, "") if pcol else "",
                                 source=src, lists=[lid], status=v["status"], reasons=v["reasons"],
                                 proven=v["status"] == "verified" or None,
                                 email_consent="subscribed" if consent_email else None,
                                 wa_consent="subscribed" if consent_whatsapp else None, by=user.get("email", ""))
            saved += 1
        await db.mk_imports.insert_one({"id": str(uuid.uuid4()), "at": _iso(), "by": user.get("email", ""), "file": file.filename,
                                        "list_id": lid, "counts": counts, "saved": saved, "consent_source": consent_source})
        await audit_log(db, "MARKETING_IMPORT", email=user.get("email", ""), role=user.get("role", ""),
                        meta={"file": file.filename, "saved": saved, "counts": counts, "consent_email": consent_email,
                              "consent_whatsapp": consent_whatsapp})
    sample: dict = {}
    for v in results:
        sample.setdefault(v["status"], [])
        if len(sample[v["status"]]) < 25:
            sample[v["status"]].append({k: v[k] for k in ("input", "email", "reasons", "fixed_from")})
    return {"columns": {"email": ecol, "name": ncol, "phone": pcol}, "counts": counts, "sample": sample,
            "saved": saved, "list_id": lid, "dry_run": dry_run}


@admin_router.post("/reverify")
async def adm_reverify(list_id: Optional[str] = None):
    """Run verification again over saved contacts (e.g. after 6 months)."""
    flt = {"lists": list_id} if list_id else {}
    contacts = await db.mk_contacts.find(flt, {"_id": 0, "id": 1, "email": 1}).to_list(50000)
    res = await verify_emails([c["email"] for c in contacts], autofix=False)
    for c, v in zip(contacts, res):
        await db.mk_contacts.update_one({"id": c["id"]}, {"$set": {"email_status": v["status"], "reasons": v["reasons"][:6], "verified_at": _iso()}})
    return {"counts": _count(res)}


@admin_router.post("/sync")
async def adm_sync(user: dict = Depends(require_admin)):
    """Bring website people in as contacts: newsletter sign-ups (subscribed),
    customers with paid orders (contact only; consent only if they ticked it),
    OTP-confirmed accounts (proven)."""
    n = 0
    async for s in db.newsletter.find({}, {"_id": 0, "email": 1, "source": 1}):
        await upsert_contact(s["email"], source=s.get("source") or "newsletter", email_consent="subscribed")
        n += 1
    async for o in db.orders.find({"payment_status": "paid"}, {"_id": 0, "email": 1, "full_name": 1, "phone": 1, "email_marketing_optin": 1}):
        await upsert_contact(o.get("email", ""), name=o.get("full_name", ""), phone=o.get("phone", ""), source="checkout",
                             customer=True, email_consent="subscribed" if o.get("email_marketing_optin") else None)
        n += 1
    async for u in db.users.find({"email_verified": True}, {"_id": 0, "email": 1, "name": 1, "phone": 1, "wa_marketing_optin": 1}):
        await upsert_contact(u.get("email", ""), name=u.get("name", ""), phone=u.get("phone", ""), source="account",
                             proven=True, status="verified", reasons=["confirmed account"],
                             wa_consent="subscribed" if u.get("wa_marketing_optin") else None)
        n += 1
    await audit_log(db, "MARKETING_SYNC", email=user.get("email", ""), role=user.get("role", ""), meta={"rows": n})
    return {"ok": True, "processed": n, "contacts": await db.mk_contacts.count_documents({})}


# ---- contacts ----
@admin_router.get("/contacts")
async def adm_contacts(q: Optional[str] = None, status: Optional[str] = None, list_id: Optional[str] = None,
                       consent: Optional[str] = None, page: int = 1, per: int = 50):
    flt: dict = {}
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()[:80]), "$options": "i"}
        flt["$or"] = [{"email": rx}, {"name": rx}, {"phone": rx}, {"source": rx}]
    if status:
        flt["email_status"] = status
    if list_id:
        flt["lists"] = list_id
    if consent:
        flt["email_consent.status"] = consent
    per = min(max(per, 10), 200)
    total = await db.mk_contacts.count_documents(flt)
    rows = await db.mk_contacts.find(flt, {"_id": 0}).sort("created_at", -1).skip((max(page, 1) - 1) * per).limit(per).to_list(per)
    by_status = {r["_id"]: r["n"] async for r in db.mk_contacts.aggregate([{"$group": {"_id": "$email_status", "n": {"$sum": 1}}}])}
    by_consent = {r["_id"]: r["n"] async for r in db.mk_contacts.aggregate([{"$group": {"_id": "$email_consent.status", "n": {"$sum": 1}}}])}
    return {"rows": rows, "total": total, "page": page, "per": per, "by_status": by_status, "by_consent": by_consent}


class ContactPatch(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email_consent: Optional[str] = None   # unsubscribed only (subscribing needs the person's own action)
    wa_consent: Optional[str] = None
    add_list: Optional[str] = None
    remove_list: Optional[str] = None


@admin_router.patch("/contacts/{cid}")
async def adm_patch_contact(cid: str, body: ContactPatch, user: dict = Depends(require_admin)):
    c = await db.mk_contacts.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    upd: dict = {}
    ops: dict = {}
    if body.name is not None:
        upd["name"] = body.name.strip()[:120]
    if body.phone is not None:
        upd["phone"] = re.sub(r"[^\d+ ]", "", body.phone)[:20]
    for fld in ("email_consent", "wa_consent"):
        v = getattr(body, fld)
        if v is not None:
            if v != "unsubscribed":
                raise HTTPException(status_code=400, detail="Admin can only unsubscribe someone; subscribing needs their own opt-in")
            upd[fld] = _consent("unsubscribed", f"admin ({user.get('email', '')})")
    if body.add_list:
        ops["$addToSet"] = {"lists": body.add_list}
    if body.remove_list:
        ops["$pull"] = {"lists": body.remove_list}
    if upd:
        ops["$set"] = upd
    if ops:
        await db.mk_contacts.update_one({"id": cid}, ops)
    return await db.mk_contacts.find_one({"id": cid}, {"_id": 0})


@admin_router.delete("/contacts/{cid}")
async def adm_delete_contact(cid: str, user: dict = Depends(require_admin)):
    """Erase a person (privacy request). Superadmin (DELETE). Their mailbox is
    kept only as a hash so an old export can never re-add them by accident."""
    c = await db.mk_contacts.find_one({"id": cid}, {"_id": 0, "email_norm": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.mk_contacts.delete_one({"id": cid})
    await db.mk_erased.update_one({"h": hashlib.sha256(c["email_norm"].encode()).hexdigest()}, {"$set": {"at": _iso()}}, upsert=True)
    await audit_log(db, "MARKETING_CONTACT_ERASED", email=user.get("email", ""), role=user.get("role", ""), meta={"contact": cid})
    return {"ok": True}


# ---- lists / segments ----
class ListBody(BaseModel):
    name: str
    kind: str = "static"          # static | segment
    rules: Optional[list] = None  # segment rules (see audience_filter)


@admin_router.get("/lists")
async def adm_lists():
    lists = await db.mk_lists.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for lst in lists:
        if lst.get("kind") == "segment":
            flt = await audience_filter({"channel": "email", "audience": {"rules": lst.get("rules") or []}})
            lst["count"] = await db.mk_contacts.count_documents(flt)
        else:
            lst["count"] = await db.mk_contacts.count_documents({"lists": lst["id"]})
            lst["sendable"] = await db.mk_contacts.count_documents({"lists": lst["id"], "email_consent.status": "subscribed",
                                                                    "suppressed": {"$in": [None, ""]}, "email_status": {"$in": ["verified", "valid"]}})
    return lists


@admin_router.post("/lists")
async def adm_create_list(body: ListBody, user: dict = Depends(require_admin)):
    if body.kind not in ("static", "segment") or not body.name.strip():
        raise HTTPException(status_code=400, detail="Name and kind (static / segment) required")
    doc = {"id": str(uuid.uuid4()), "name": body.name.strip()[:80], "kind": body.kind, "rules": body.rules or [],
           "created_at": _iso(), "created_by": user.get("email", "")}
    await db.mk_lists.insert_one(dict(doc))
    return doc


@admin_router.delete("/lists/{lid}")
async def adm_delete_list(lid: str):
    await db.mk_lists.delete_one({"id": lid})
    await db.mk_contacts.update_many({"lists": lid}, {"$pull": {"lists": lid}})
    return {"ok": True}


# ---- campaigns ----
class CampaignBody(BaseModel):
    name: Optional[str] = None
    channel: Optional[str] = None          # email | whatsapp
    subject: Optional[str] = None
    preheader: Optional[str] = None
    blocks: Optional[list] = None
    audience: Optional[dict] = None        # {list_ids, exclude_list_ids, rules, include_risky}
    wa_template: Optional[str] = None
    wa_language: Optional[str] = None
    wa_variables: Optional[list] = None    # [{source: first_name|name|static, value}]


def _clean_blocks(blocks: list) -> list:
    ok_types = {"heading", "text", "image", "button", "book", "divider", "spacer"}
    out = []
    for b in (blocks or [])[:60]:
        if not isinstance(b, dict) or b.get("type") not in ok_types:
            continue
        c = {k: (str(v)[:5000] if isinstance(v, str) else v) for k, v in b.items()
             if k in ("type", "text", "label", "url", "src", "alt", "title", "author", "cover", "price", "book_id")}
        for k in ("url", "src", "cover"):
            if c.get(k) and not re.match(r"^https?://", str(c[k]), re.I):
                c.pop(k)   # only web links / images
        out.append(c)
    return out


@admin_router.get("/campaigns")
async def adm_campaigns():
    return await db.mk_campaigns.find({}, {"_id": 0, "blocks": 0}).sort("created_at", -1).to_list(500)


@admin_router.post("/campaigns")
async def adm_new_campaign(body: CampaignBody, user: dict = Depends(require_admin)):
    ch = body.channel or "email"
    if ch not in ("email", "whatsapp"):
        raise HTTPException(status_code=400, detail="channel must be email or whatsapp")
    doc = {"id": str(uuid.uuid4()), "name": (body.name or "Untitled campaign").strip()[:120], "channel": ch,
           "subject": "", "preheader": "", "blocks": [], "links": [], "audience": {"list_ids": [], "rules": []},
           "wa_template": "", "wa_language": "en", "wa_variables": [], "status": "draft", "created_at": _iso(),
           "created_by": user.get("email", ""), "stats": {}}
    await db.mk_campaigns.insert_one(dict(doc))
    return doc


@admin_router.get("/campaigns/{cid}")
async def adm_get_campaign(cid: str):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


@admin_router.patch("/campaigns/{cid}")
async def adm_patch_campaign(cid: str, body: CampaignBody):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "status": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if c["status"] not in ("draft", "scheduled"):
        raise HTTPException(status_code=409, detail="Only a draft can be edited — duplicate it to make changes")
    upd = {k: v for k, v in body.model_dump().items() if v is not None and k != "channel"}
    if "blocks" in upd:
        upd["blocks"] = _clean_blocks(upd["blocks"])
        upd["links"] = core.collect_links(upd["blocks"])
    for k in ("name", "subject", "preheader", "wa_template"):
        if k in upd:
            upd[k] = str(upd[k]).strip()[:300]
    upd["updated_at"] = _iso()
    await db.mk_campaigns.update_one({"id": cid}, {"$set": upd})
    return await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})


@admin_router.post("/campaigns/{cid}/duplicate")
async def adm_dup_campaign(cid: str, user: dict = Depends(require_admin)):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    keep = {k: c.get(k) for k in ("channel", "subject", "preheader", "blocks", "links", "audience", "wa_template", "wa_language", "wa_variables")}
    doc = {**keep, "id": str(uuid.uuid4()), "name": f"{c['name']} (copy)"[:120], "status": "draft", "created_at": _iso(),
           "created_by": user.get("email", ""), "stats": {}}
    await db.mk_campaigns.insert_one(dict(doc))
    return doc


@admin_router.get("/campaigns/{cid}/audience")
async def adm_audience(cid: str):
    """Who it would go to, by verification status — shown before sending."""
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    flt = await audience_filter(c)
    total = await db.mk_contacts.count_documents(flt)
    by = {r["_id"]: r["n"] async for r in db.mk_contacts.aggregate([{"$match": flt}, {"$group": {"_id": "$email_status", "n": {"$sum": 1}}}])}
    st = await get_settings()
    est = round(total * float(st["wa_rate_marketing"]) * 1.18, 2) if c["channel"] == "whatsapp" else round(total / 1000 * 0.10 * 88, 2)
    return {"total": total, "by_status": by, "estimated_cost_inr": est}


class TestBody(BaseModel):
    to: str


@admin_router.post("/campaigns/{cid}/test")
async def adm_test_campaign(cid: str, body: TestBody, user: dict = Depends(require_admin)):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    st = await get_settings()
    if c["channel"] == "email":
        if not core.check_syntax(body.to)["ok"]:
            raise HTTPException(status_code=400, detail="Not an email address")
        contact = {"name": user.get("name") or "Test", "email": body.to}
        html_doc, text_doc = core.render_email(c.get("blocks") or [], brand={"name": "Oakbridge Publishing", "logo": st.get("logo"), "footer": st.get("footer")},
                                               contact=contact, link_for=lambda u: core.add_utm(u, cid), unsubscribe_url=f"{SITE}/unsubscribe",
                                               preheader=c.get("preheader") or "")
        raw = build_mime(st=st, to=body.to, subject=f"[TEST] {core.personalise(c.get('subject') or '(no subject)', contact)}",
                         html_doc=html_doc, text_doc=text_doc, unsub_post="")
        try:
            mid = await asyncio.to_thread(_send_raw, raw)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"SES refused it: {str(e)[:250]}")
        return {"ok": True, "message_id": mid}
    from interakt import send_campaign_message
    rec = await send_campaign_message(template=c.get("wa_template"), language=c.get("wa_language") or "en",
                                      values=[v.get("value") if v.get("source") == "static" else "Test" for v in c.get("wa_variables") or []],
                                      phone=body.to, dedupe="", campaign_id="", force_test=True)
    if not rec or rec.get("status") == "failed":
        raise HTTPException(status_code=502, detail=(rec or {}).get("error") or "Not sent")
    return {"ok": True}


@admin_router.get("/campaigns/{cid}/preview")
async def adm_preview(cid: str):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    st = await get_settings()
    html_doc, _ = core.render_email(c.get("blocks") or [], brand={"name": "Oakbridge Publishing", "logo": st.get("logo"), "footer": st.get("footer")},
                                    contact={"name": "Asha Verma"}, link_for=lambda u: u, unsubscribe_url="#", preheader=c.get("preheader") or "")
    return {"html": html_doc}


class SendBody(BaseModel):
    schedule_at: Optional[str] = None   # ISO; empty = now
    confirm_count: int                  # the number the admin saw — must still match


@admin_router.post("/campaigns/{cid}/send")
async def adm_send(cid: str, body: SendBody, user: dict = Depends(require_admin)):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if c["status"] not in ("draft", "scheduled"):
        raise HTTPException(status_code=409, detail="This campaign has already been sent")
    if c["channel"] == "email" and (not c.get("subject") or not c.get("blocks")):
        raise HTTPException(status_code=400, detail="Add a subject and some content first")
    if c["channel"] == "whatsapp" and not c.get("wa_template"):
        raise HTTPException(status_code=400, detail="Choose the approved WhatsApp template first")
    flt = await audience_filter(c)
    contacts = await db.mk_contacts.find(flt, {"_id": 0, "id": 1, "email": 1, "phone": 1, "email_status": 1}).to_list(100000)
    if not contacts:
        raise HTTPException(status_code=400, detail="Nobody in this audience can be sent to (consent / verification)")
    if abs(len(contacts) - body.confirm_count) > max(5, len(contacts) // 50):
        raise HTTPException(status_code=409, detail=f"The audience changed to {len(contacts)} — check it again before sending")
    await _ensure_indexes()
    now = _iso()
    docs = [{"id": str(uuid.uuid4()), "campaign_id": cid, "contact_id": x["id"], "to": x.get("email") if c["channel"] == "email" else x.get("phone"),
             "status": "queued", "priority": core.SEND_ORDER.get(x.get("email_status"), 3), "queued_at": now} for x in contacts]
    for i in range(0, len(docs), 1000):
        try:
            await db.mk_sends.insert_many(docs[i:i + 1000], ordered=False)
        except Exception:  # noqa: BLE001 — duplicates from a retried click are fine (unique index)
            pass
    when = body.schedule_at
    status = "scheduled" if when and when > now else "sending"
    await db.mk_campaigns.update_one({"id": cid}, {"$set": {"status": status, "schedule_at": when or now, "queued": len(docs),
                                                            "started_at": now if status == "sending" else None, "sent_by": user.get("email", "")}})
    await audit_log(db, "MARKETING_CAMPAIGN_SEND", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"campaign": cid, "channel": c["channel"], "recipients": len(docs), "scheduled": status == "scheduled"})
    if status == "sending":
        await start_campaign(cid)
    return {"ok": True, "status": status, "recipients": len(docs)}


@admin_router.post("/campaigns/{cid}/{action}")
async def adm_campaign_action(cid: str, action: str, user: dict = Depends(require_admin)):
    if action not in ("pause", "resume", "cancel"):
        raise HTTPException(status_code=404, detail="Unknown action")
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "status": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    allowed = {"pause": ("sending", "scheduled"), "resume": ("paused",), "cancel": ("sending", "scheduled", "paused")}[action]
    if c["status"] not in allowed:
        raise HTTPException(status_code=409, detail=f"Cannot {action} a campaign that is {c['status']}")
    new = {"pause": "paused", "resume": "sending", "cancel": "cancelled"}[action]
    await db.mk_campaigns.update_one({"id": cid}, {"$set": {"status": new, f"{new}_at": _iso(), "paused_reason": "" if action == "resume" else None}})
    if action == "cancel":
        await db.mk_sends.update_many({"campaign_id": cid, "status": "queued"}, {"$set": {"status": "skipped", "error": "cancelled"}})
    if action == "resume":
        await start_campaign(cid)
    await audit_log(db, f"MARKETING_CAMPAIGN_{action.upper()}", email=user.get("email", ""), role=user.get("role", ""), meta={"campaign": cid})
    return {"ok": True, "status": new}


@admin_router.get("/campaigns/{cid}/report")
async def adm_report(cid: str):
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    stats = await refresh_campaign_stats(cid)
    links = c.get("links") or []
    clicks = [0] * len(links)
    async for s in db.mk_sends.find({"campaign_id": cid, "clicks.0": {"$exists": True}}, {"_id": 0, "clicks": 1}):
        for k in {x["i"] for x in s.get("clicks") or []}:
            if 0 <= k < len(clicks):
                clicks[k] += 1
    timeline: dict = {}
    async for s in db.mk_sends.find({"campaign_id": cid}, {"_id": 0, "opened_at": 1, "clicked_at": 1}):
        for f in ("opened_at", "clicked_at"):
            if s.get(f):
                h = s[f][:13]
                timeline.setdefault(h, {"opened": 0, "clicked": 0})
                timeline[h][f[:-3]] += 1
    problems = await db.mk_sends.find({"campaign_id": cid, "status": {"$in": ["bounced", "complained", "failed"]}},
                                      {"_id": 0, "to": 1, "status": 1, "bounce_type": 1, "error": 1}).limit(200).to_list(200)
    return {"campaign": {k: c.get(k) for k in ("id", "name", "channel", "subject", "status", "started_at", "finished_at", "paused_reason")},
            "stats": stats, "funnel": core.funnel(stats), "links": [{"url": u, "clicks": n} for u, n in zip(links, clicks)],
            "timeline": dict(sorted(timeline.items())), "problems": problems,
            "rates": {"delivery": core.rate(stats.get("delivered", 0), stats.get("sent", 0)),
                      "open": core.rate(stats.get("opened", 0), stats.get("delivered", 0) or stats.get("sent", 0)),
                      "click": core.rate(stats.get("clicked", 0), stats.get("delivered", 0) or stats.get("sent", 0)),
                      "ctor": core.rate(stats.get("clicked", 0), stats.get("opened", 0)),
                      "bounce": core.rate(stats.get("bounced", 0), stats.get("sent", 0)),
                      "unsubscribe": core.rate(stats.get("unsubscribed", 0), stats.get("delivered", 0) or stats.get("sent", 0))}}


# ---- dashboard ----
@admin_router.get("/dashboard")
async def adm_dashboard(days: int = 30):
    days = max(1, min(days, 365))
    since = (_now() - timedelta(days=days)).isoformat()
    camps = await db.mk_campaigns.find({"started_at": {"$gte": since}}, {"_id": 0, "blocks": 0}).sort("started_at", -1).to_list(200)
    for c in camps:
        if c.get("status") in ("sending", "sent", "paused") and (c.get("stats_at") or "") < (_now() - timedelta(minutes=10)).isoformat():
            c["stats"] = await refresh_campaign_stats(c["id"])
    tot = {"email": {}, "whatsapp": {}}
    for c in camps:
        t = tot[c["channel"]]
        for k, v in (c.get("stats") or {}).items():
            if isinstance(v, (int, float)):
                t[k] = round(t.get(k, 0) + v, 2)
    series: dict = {}

    def bump(day, key, n=1):
        series.setdefault(day, {})
        series[day][key] = series[day].get(key, 0) + n

    async for s in db.mk_sends.find({"sent_at": {"$gte": since}}, {"_id": 0, "sent_at": 1, "opened_at": 1, "clicked_at": 1, "status": 1, "campaign_id": 1}):
        bump(s["sent_at"][:10], "sent")
        if s.get("opened_at"):
            bump(s["opened_at"][:10], "opened")
        if s.get("clicked_at"):
            bump(s["clicked_at"][:10], "clicked")
        if s.get("status") == "bounced":
            bump(s["sent_at"][:10], "bounced")
    async for o in db.orders.find({"created_at": {"$gte": since}, "payment_status": "paid",
                                   "attribution.utm_campaign": {"$regex": "^mk-"}}, {"_id": 0, "created_at": 1, "total": 1}):
        bump(o["created_at"][:10], "revenue", round(float(o.get("total") or 0), 2))
    growth: dict = {}
    async for c in db.mk_contacts.find({"created_at": {"$gte": since}}, {"_id": 0, "created_at": 1}):
        growth[c["created_at"][:10]] = growth.get(c["created_at"][:10], 0) + 1
    unsubs: dict = {}
    async for c in db.mk_contacts.find({"email_consent.status": {"$in": ["unsubscribed", "complained"]}, "email_consent.at": {"$gte": since}},
                                       {"_id": 0, "email_consent.at": 1}):
        d = c["email_consent"]["at"][:10]
        unsubs[d] = unsubs.get(d, 0) + 1
    e = tot["email"]
    kpi = {
        "contacts": await db.mk_contacts.count_documents({}),
        "subscribed": await db.mk_contacts.count_documents({"email_consent.status": "subscribed", "suppressed": {"$in": [None, ""]}}),
        "wa_subscribed": await db.mk_contacts.count_documents({"wa_consent.status": "subscribed"}),
        "campaigns": len(camps),
        "email_sent": e.get("sent", 0), "delivery_rate": core.rate(e.get("delivered", 0), e.get("sent", 0)),
        "open_rate": core.rate(e.get("opened", 0), e.get("delivered", 0) or e.get("sent", 0)),
        "click_rate": core.rate(e.get("clicked", 0), e.get("delivered", 0) or e.get("sent", 0)),
        "bounce_rate": core.rate(e.get("bounced", 0), e.get("sent", 0)),
        "complaint_rate": core.rate(e.get("complained", 0), e.get("sent", 0)),
        "unsubscribe_rate": core.rate(e.get("unsubscribed", 0), e.get("delivered", 0) or e.get("sent", 0)),
        "wa_sent": tot["whatsapp"].get("sent", 0), "wa_read_rate": core.rate(tot["whatsapp"].get("read", 0), tot["whatsapp"].get("sent", 0)),
        "wa_cost": tot["whatsapp"].get("cost", 0),
        "revenue": round(sum((c.get("stats") or {}).get("revenue", 0) for c in camps), 2),
        "orders": sum((c.get("stats") or {}).get("paid", 0) for c in camps),
    }
    by_status = {r["_id"]: r["n"] async for r in db.mk_contacts.aggregate([{"$group": {"_id": "$email_status", "n": {"$sum": 1}}}])}
    return {"days": days, "kpi": kpi, "series": dict(sorted(series.items())), "growth": dict(sorted(growth.items())),
            "unsubs": dict(sorted(unsubs.items())), "funnel_email": core.funnel(e), "funnel_whatsapp": core.funnel(tot["whatsapp"]),
            "campaigns": [{k: c.get(k) for k in ("id", "name", "channel", "status", "started_at", "stats")} for c in camps],
            "verification": by_status}


# ================================================================ tasks ===
tasks_router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@tasks_router.post("/marketing-tick")
async def marketing_tick(x_task_token: Optional[str] = Header(None)):
    """Cron (every few minutes): start scheduled campaigns that are due, and
    resume ones whose sender stopped (e.g. a deploy restarted the server)."""
    expected = os.environ.get("TASK_TOKEN")
    if not expected or x_task_token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")
    now = _iso()
    started = []
    async for c in db.mk_campaigns.find({"status": "scheduled", "schedule_at": {"$lte": now}}, {"_id": 0, "id": 1}):
        r = await db.mk_campaigns.update_one({"id": c["id"], "status": "scheduled"}, {"$set": {"status": "sending", "started_at": now}})
        if r.modified_count:
            await start_campaign(c["id"])
            started.append(c["id"])
    stale = (_now() - timedelta(seconds=WORKER_STALE)).isoformat()
    async for c in db.mk_campaigns.find({"status": "sending", "$or": [{"heartbeat": {"$lt": stale}}, {"heartbeat": {"$exists": False}}]}, {"_id": 0, "id": 1}):
        await start_campaign(c["id"])
        started.append(c["id"])
    return {"ok": True, "started": started}


async def resume_on_startup() -> None:
    """After a deploy, carry on with anything that was mid-send."""
    try:
        await asyncio.sleep(10)
        async for c in db.mk_campaigns.find({"status": "sending"}, {"_id": 0, "id": 1}):
            await start_campaign(c["id"])
    except Exception:  # noqa: BLE001
        log.exception("marketing: resume on startup failed")
