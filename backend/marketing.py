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
    # Amazon SES Email Validation (paid, ~$0.01 per address): checks whether
    # the mailbox exists before anyone is mailed. The monthly ₹ budget stops a
    # big import from running up a bill; anyone left unchecked is skipped
    # (with the reason shown), never mailed blind.
    "ses_validation": True,
    "ses_budget_inr": 850,       # ≈ 1,000 checks a month
    "usd_inr": 88,               # for ₹ estimates of $-priced AWS charges
    # What happens to each kind of 'risky' address when a campaign is sent:
    # send | tail (last, stops itself if it bounces) | skip.
    "risk_policy": dict(core.DEFAULT_RISK_POLICY),
    "tail_max_bounce": 0.03,
}
SES_CHECK_TTL_DAYS = 180  # a mailbox verdict is reused for 6 months, never paid for twice
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
    # SES_EVENTS_TOKEN lets the SNS endpoint be rotated on its own (e.g. after
    # the URL shows up in a screenshot) without touching JWT_SECRET, which
    # would sign everyone out and break every unsubscribe link already sent.
    # Ignored when shorter than 24 characters so a typo can't make it guessable.
    override = (os.environ.get("SES_EVENTS_TOKEN") or "").strip()
    if len(override) >= 24:
        return override
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
        await db.mk_ses_checks.create_index("email_norm", unique=True)
        await db.mk_ses_usage.create_index("month", unique=True)
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


# ------------------------------------------------ SES email validation ---
_SES_STOP: dict = {}  # last time live checks stopped early: {"why", "at"}


def _month() -> str:
    return _now().strftime("%Y-%m")


_SES_SUPPORTED: Optional[bool] = None


def ses_validation_supported() -> bool:
    """The sesv2 GetEmailAddressInsights call only exists in boto3/botocore
    released after SES Email Validation launched (Jan 2026). An older cached
    install on Render would raise AttributeError mid-import, so check first.
    The installed SDK can't change while the process runs, so check once."""
    global _SES_SUPPORTED
    if _SES_SUPPORTED is None:
        try:
            _SES_SUPPORTED = hasattr(_ses(), "get_email_address_insights")
        except Exception:  # noqa: BLE001
            return False
    return _SES_SUPPORTED


def _cap(st: dict) -> int:
    return core.checks_for_budget(float(st.get("ses_budget_inr") or 0), float(st.get("usd_inr") or 0))


async def ses_usage() -> dict:
    st = await get_settings()
    d = await db.mk_ses_usage.find_one({"month": _month()}, {"_id": 0}) or {}
    used = int(d.get("n", 0))
    cap = _cap(st)
    rate = float(st.get("usd_inr") or 0)
    return {"month": _month(), "used": used, "cap": cap, "left": max(0, cap - used),
            "enabled": bool(st.get("ses_validation")), "supported": ses_validation_supported(),
            "budget_inr": float(st.get("ses_budget_inr") or 0), "spent_inr": round(used * 0.01 * rate, 2),
            "per_check_inr": round(0.01 * rate, 2), "near_limit": cap > 0 and used >= 0.8 * cap,
            "last_stop": _SES_STOP or None}


# --------------------------------------------------------------- alerts ---
async def raise_alert(kind: str, message: str, *, campaign_id: Optional[str] = None, key: Optional[str] = None) -> None:
    """Something an admin should look at, shown on the Marketing dashboard.
    One open alert per key, refreshed rather than repeated."""
    try:
        key = key or f"{kind}:{campaign_id or ''}"
        await db.mk_alerts.update_one(
            {"key": key, "resolved": False},
            {"$set": {"kind": kind, "message": message[:300], "campaign_id": campaign_id, "at": _iso()},
             "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _iso()}}, upsert=True)
    except Exception:  # noqa: BLE001
        log.warning("marketing: could not store alert %s", kind, exc_info=True)


_bg_tasks: set = set()


def _bg(coro) -> None:
    """Fire-and-forget, kept referenced so it can't be garbage-collected mid-run."""
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


async def _reserve_check(cap: int) -> bool:
    """Count one paid check against this month's cap, atomically, BEFORE the
    call — two workers can't both take the last slot."""
    m = _month()
    await db.mk_ses_usage.update_one({"month": m}, {"$setOnInsert": {"month": m, "n": 0}}, upsert=True)
    r = await db.mk_ses_usage.update_one({"month": m, "n": {"$lt": cap}}, {"$inc": {"n": 1}})
    return r.modified_count == 1


async def _release_check() -> None:
    await db.mk_ses_usage.update_one({"month": _month(), "n": {"$gt": 0}}, {"$inc": {"n": -1}})


async def _ses_cached(norms: list) -> dict:
    fresh = (_now() - timedelta(days=SES_CHECK_TTL_DAYS)).isoformat()
    out = {}
    async for d in db.mk_ses_checks.find({"email_norm": {"$in": norms}, "at": {"$gte": fresh}}, {"_id": 0}):
        # Re-derive from the stored SES levels so a rule fix (e.g. "mailbox
        # does not exist" -> invalid) applies to verdicts already paid for.
        d["status"] = core.ses_status(d.get("overall", ""), d.get("mailbox", "")) or d.get("status")
        out[d["email_norm"]] = d
    return out


async def ses_check(emails: list, *, refresh: bool = False) -> dict:
    """Live SES Email Validation for addresses with no fresh verdict yet.
    Paid, so: only when switched on, only within the monthly cap, never twice
    for one mailbox within SES_CHECK_TTL_DAYS. Returns {email_norm: verdict};
    an address that could not be checked is simply absent (and stays
    'waiting' — campaigns don't mail it)."""
    st = await get_settings()
    norms = {}
    for e in emails:
        n = core.normalise_email(e)
        if n:
            norms.setdefault(n, e)
    # refresh=True: ask SES again even if we have a verdict (used when a
    # campaign recovers from a bounce spike and old verdicts are suspect).
    out = {} if refresh else await _ses_cached(list(norms))
    if not st.get("ses_validation") or not ses_validation_supported():
        return out
    cap = _cap(st)
    todo = [(n, e) for n, e in norms.items() if n not in out]
    sem = asyncio.Semaphore(4)   # gentle on the API; throttling is retried below
    stop = {"why": ""}
    client = _ses() if todo else None  # boto3 clients are thread-safe; one per batch

    async def one(n: str, e: str) -> None:
        async with sem:
            if stop["why"]:
                return
            if not await _reserve_check(cap):
                stop["why"] = f"this month's SES check budget (₹{st.get('ses_budget_inr')}, {cap} checks) is used up"
                return
            resp = None
            for attempt in range(3):
                try:
                    resp = await asyncio.to_thread(lambda: client.get_email_address_insights(EmailAddress=e))
                    break
                except Exception as ex:  # noqa: BLE001
                    code = ((getattr(ex, "response", None) or {}).get("Error") or {}).get("Code", "")
                    if code in ("ThrottlingException", "TooManyRequestsException", "Throttling") and attempt < 2:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    await _release_check()   # failed calls aren't billed; give the slot back
                    if code in ("AccessDeniedException", "AccessDenied", "UnrecognizedClientException",
                                "InvalidClientTokenId", "SignatureDoesNotMatch"):
                        stop["why"] = f"SES refused the check ({code}) — is ses:GetEmailAddressInsights allowed?"
                    else:
                        log.warning("marketing: SES validation failed for one address: %s", str(ex)[:200])
                    return
            if resp is None:
                await _release_check()
                return
            status, reasons = core.ses_verdict(resp)
            if not status:
                return  # billed but no verdict: leave unchecked rather than guess
            doc = {"email_norm": n, "status": status, "reasons": reasons, "at": _iso(), **core.ses_details(resp)}
            await db.mk_ses_checks.update_one({"email_norm": n}, {"$set": doc}, upsert=True)
            out[n] = doc

    await asyncio.gather(*(one(n, e) for n, e in todo))
    if stop["why"]:
        _SES_STOP.update(why=stop["why"], at=_iso())
        log.warning("marketing: SES validation stopped early: %s", stop["why"])
        await raise_alert("ses_checks", f"Mailbox checks stopped: {stop['why']}. Unchecked addresses are skipped, not mailed.",
                          key=f"ses_checks:{_month()}")
    return out


async def verify_emails(raw: list, *, autofix: bool = True, ses: str = "cache") -> list:
    """Full verification for a batch of raw strings. One result per input row:
    {input, email, email_norm, status, reasons[], fixed_from, ses_checked}.

    ses="cache" applies SES verdicts we already paid for (free);
    ses="live" also asks SES about addresses without one (paid, capped);
    ses="refresh" asks SES again even where we have a verdict;
    ses="off" uses only our own free checks.
    Risky rows also get risk_kind (role / catch_all / unconfirmed)."""
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
    bad_domains = {d["domain"] async for d in db.mk_domains.find({"domain": {"$in": list(domains)}, "bad": True}, {"_id": 0, "domain": 1})}
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
        dom = s["email"].split("@")[-1] if s["ok"] else ""
        bad = dom in bad_domains and status == "valid"
        if bad:
            # Several different addresses at this company domain hard-bounced.
            status = "risky"
            reasons.append("3+ addresses at this domain bounced")
        out.append({"input": x["input"], "email": s["email"], "email_norm": n, "status": status,
                    "reasons": reasons, "fixed_from": x["fixed_from"], "role": s.get("role", False), "ses_checked": False,
                    "_bad_domain": bad, "_ses": None})
    if ses in ("cache", "live", "refresh"):
        # Only addresses our free checks couldn't settle are worth an SES look:
        # verified ones are proven, invalid/suppressed ones are never sent.
        need = [r for r in out if r["status"] in ("valid", "risky") and r["email_norm"]]
        if ses == "cache":
            verdicts = await _ses_cached([r["email_norm"] for r in need])
        else:
            verdicts = await ses_check([r["email"] for r in need], refresh=ses == "refresh")
        for r in need:
            v = verdicts.get(r["email_norm"])
            if v:
                r["status"] = core.worse(r["status"], v["status"])
                r["reasons"] = r["reasons"] + [x for x in v.get("reasons") or [] if x not in r["reasons"]]
                r["ses_checked"] = True
                r["_ses"] = v
    for r in out:
        v = r.pop("_ses") or {}
        bad = r.pop("_bad_domain")
        r["ses_overall"] = v.get("overall", "")
        r["risk_kind"] = "" if r["status"] != "risky" else (
            "unconfirmed" if bad else core.risk_kind(role=bool(r["role"] or v.get("role")), domain=r["email"].split("@")[-1],
                                                     ses_overall=v.get("overall", ""), mailbox=v.get("mailbox", "")))
    return out


def _status_update(v: dict) -> dict:
    """Contact fields from one verify_emails() row."""
    upd = {"email_status": v["status"], "reasons": v["reasons"][:6], "verified_at": _iso(), "risk_kind": v.get("risk_kind", "")}
    if v.get("ses_checked"):
        upd.update(ses_checked=True, ses_overall=v.get("ses_overall", ""))
    return upd


_validating = False


async def validate_pending(max_n: int = 5000) -> dict:
    """Background pass over saved contacts: website contacts that arrived
    without any check ('unknown') get the free checks, and — with SES
    validation on — every not-yet-proven address gets its SES mailbox check
    (within the budget). Campaigns don't depend on it — sending checks its own
    recipients first — it just spreads the work and keeps the Contacts page current."""
    global _validating
    if _validating:
        return {"running": True}
    _validating = True
    started = _iso()
    done = 0
    try:
        st = await get_settings()
        use = await ses_usage()
        if st.get("ses_validation") and use["supported"] and use["used"] < use["cap"]:
            flt = {"email_status": {"$in": ["unknown", "valid", "risky"]}, "ses_checked": {"$ne": True}}
        else:
            flt = {"email_status": "unknown"}
        contacts = await db.mk_contacts.find(flt, {"_id": 0, "id": 1, "email": 1}).limit(max_n).to_list(max_n)
        for i in range(0, len(contacts), 100):
            chunk = contacts[i:i + 100]
            res = await verify_emails([c["email"] for c in chunk], autofix=False, ses="live")
            for c, v in zip(chunk, res):
                await db.mk_contacts.update_one({"id": c["id"]}, {"$set": _status_update(v)})
                done += 1
            if _SES_STOP.get("at", "") >= started:
                break  # cap reached or SES refused: the rest wait for next time
    except Exception:  # noqa: BLE001
        log.exception("marketing: validate_pending failed")
    finally:
        _validating = False
    return {"processed": done}


def kick_validation() -> None:
    """Fire-and-forget validate_pending() after an import / sync / re-verify / sign-up."""
    _bg(validate_pending())


# ------------------------------------------------------------- contacts ---
def _consent(status: str, source: str, by: str = "") -> dict:
    return {"status": status, "source": source[:120], "at": _iso(), "by": by}


async def upsert_contact(email: str, *, name: str = "", phone: str = "", source: str = "",
                         email_consent: Optional[str] = None, wa_consent: Optional[str] = None,
                         lists: Optional[list] = None, status: Optional[str] = None, reasons: Optional[list] = None,
                         proven: Optional[bool] = None, customer: Optional[bool] = None, by: str = "",
                         ses_checked: Optional[bool] = None, extra: Optional[dict] = None) -> Optional[dict]:
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
    if ses_checked:
        upd["ses_checked"] = True
    if extra:
        upd.update({k: v for k, v in extra.items() if k in ("risk_kind", "ses_overall")})
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
            # Check the address the moment it arrives: a bot or a typo'd
            # sign-up would otherwise cost us a bounce on the confirmation email.
            v = (await verify_emails([email], autofix=False, ses="live"))[0]
            c = await upsert_contact(email, source=source or "newsletter", email_consent="pending", status=v["status"],
                                     reasons=v["reasons"], ses_checked=v.get("ses_checked") or None,
                                     extra={"risk_kind": v.get("risk_kind", ""), "ses_overall": v.get("ses_overall", "")})
            if v["status"] in ("invalid", "suppressed"):
                return  # kept as a record, but no email to a dead / bounced address
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
        if order.get("email_marketing_optin"):
            kick_validation()  # check the new subscriber now, not on the next campaign
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
    """Mongo filter for who a campaign MAY go to. Consent and suppression are
    applied here, always — no option skips them. For email, which of these
    candidates are actually sent is decided when the campaign is prepared
    (mailbox checks + risk rules, core.send_decision)."""
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
        # Only the statuses ticked for this campaign (+ not-yet-checked, which
        # are checked on Send and then filtered by the same ticks).
        flt["email_status"] = {"$in": sorted(core.selected_statuses(aud)) + ["unknown"]}
    return flt


def _policy(st: dict, campaign: dict) -> dict:
    pol = {**core.DEFAULT_RISK_POLICY, **{k: v for k, v in (st.get("risk_policy") or {}).items()
                                          if k in core.RISK_KINDS and v in ("send", "tail", "skip")}}
    if (campaign.get("audience") or {}).get("include_risky") and pol["unconfirmed"] == "skip":
        pol["unconfirmed"] = "tail"  # older campaigns that ticked "include risky"
    return pol


# -------------------------------------------------------------- sending ---
WORKER_STALE = 120  # seconds without a heartbeat before another tick takes over
_running: set = set()


_preparing: set = set()
PREPARE_STALE = 180  # seconds without progress before the cron restarts a preparation


def start_prepare(cid: str) -> None:
    if cid not in _preparing:
        _bg(_prepare_campaign(cid))


async def _prepare_campaign(cid: str) -> None:
    """Send = check, then send. Every not-yet-proven recipient gets the free
    checks and (if on) its SES mailbox check — within the budget — then each
    recipient is queued, put in the tail, or skipped WITH the reason, by the
    risk rules in Settings. Idempotent: a restart re-runs it safely (cached
    verdicts cost nothing, sends are unique per contact)."""
    _preparing.add(cid)
    try:
        c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0})
        if not c or c.get("status") != "preparing":
            return
        st = await get_settings()
        contacts = await db.mk_contacts.find(await audience_filter(c), {"_id": 0, "id": 1, "email": 1, "phone": 1, "email_status": 1,
                                                                        "risk_kind": 1, "email_norm": 1}).to_list(200000)
        is_email = c["channel"] == "email"
        ses_on = is_email and bool(st.get("ses_validation")) and ses_validation_supported()
        if is_email:
            todo = [x for x in contacts if x.get("email_status") != "verified"]
            for i in range(0, len(todo), 100):
                chunk = todo[i:i + 100]
                res = await verify_emails([x["email"] for x in chunk], autofix=False, ses="live" if ses_on else "cache")
                for x, v in zip(chunk, res):
                    await db.mk_contacts.update_one({"id": x["id"]}, {"$set": _status_update(v)})
                    x.update(email_status=v["status"], risk_kind=v.get("risk_kind", ""), _ses=v.get("ses_checked"))
                cur = await db.mk_campaigns.find_one_and_update(
                    {"id": cid}, {"$set": {"prepare.checked": min(i + 100, len(todo)), "prepare.to_check": len(todo),
                                          "prepare_heartbeat": _iso()}}, projection={"_id": 0, "status": 1})
                if not cur or cur.get("status") != "preparing":
                    return  # cancelled while checking
        pol = _policy(st, c)
        allowed = core.selected_statuses(c.get("audience"))
        now = _iso()
        docs, skipped = [], {}
        for x in contacts:
            if is_email:
                act, prio, why = core.send_decision(x.get("email_status") or "unknown", x.get("risk_kind") or "", pol,
                                                    needs_ses=ses_on and x.get("email_status") != "verified",
                                                    has_ses=bool(x.get("_ses")), allowed=allowed)
            else:
                act, prio, why = "send", 1, ""
            doc = {"id": str(uuid.uuid4()), "campaign_id": cid, "contact_id": x["id"], "priority": prio, "queued_at": now,
                   "to": x.get("email") if is_email else x.get("phone")}
            if act == "skip":
                doc.update(status="skipped", error=why)
                skipped[why] = skipped.get(why, 0) + 1
            else:
                doc.update(status="queued", tail=act == "tail")
            docs.append(doc)
        if (await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "status": 1}) or {}).get("status") != "preparing":
            return
        for i in range(0, len(docs), 1000):
            try:
                await db.mk_sends.insert_many(docs[i:i + 1000], ordered=False)
            except Exception:  # noqa: BLE001 — duplicates from a restarted preparation are fine (unique index)
                pass
        queued = await db.mk_sends.count_documents({"campaign_id": cid, "status": "queued"})
        when = c.get("schedule_at") or ""
        now = _iso()
        if not queued:
            status, extra = "sent", {"finished_at": now, "note": "Nobody passed the checks — see the skipped list."}
        elif when and when > now:
            status, extra = "scheduled", {}
        else:
            status, extra = "sending", {"started_at": now, "schedule_at": now}
        await db.mk_campaigns.update_one({"id": cid, "status": "preparing"}, {"$set": {
            "status": status, "queued": queued, "prepare.finished_at": now, "prepare.skipped": skipped, **extra}})
        await refresh_campaign_stats(cid)
        if status == "sending":
            await start_campaign(cid)
    except Exception as e:  # noqa: BLE001
        log.exception("marketing: preparing campaign %s failed", cid)
        await db.mk_campaigns.update_one({"id": cid, "status": "preparing"},
                                         {"$set": {"status": "draft", "prepare_error": str(e)[:300]}})
        await raise_alert("prepare", f"A campaign could not be prepared and went back to draft: {str(e)[:160]}", campaign_id=cid)
    finally:
        _preparing.discard(cid)


async def _window_stats(cid: str, since: str) -> dict:
    """sent / bounced / complained for this campaign's sends since a moment —
    after a recovery the bounce guard judges only what was sent since."""
    base = {"campaign_id": cid, "sent_at": {"$gte": since}}
    return {"sent": await db.mk_sends.count_documents({**base, "status": {"$in": ["sent", "bounced", "complained"]}}),
            "bounced": await db.mk_sends.count_documents({**base, "status": "bounced"}),
            "complained": await db.mk_sends.count_documents({**base, "status": "complained"})}


async def _recover(cid: str, why: str) -> dict:
    """First bounce spike: instead of stopping, keep only proven addresses
    and ones SES rated HIGH (re-asking SES where that verdict is over 30
    days old); drop the rest, with the reason, and carry on."""
    fresh_cut = (_now() - timedelta(days=30)).isoformat()
    queued = await db.mk_sends.find({"campaign_id": cid, "status": "queued"}, {"_id": 0, "id": 1, "contact_id": 1}).to_list(200000)
    contacts = {x["id"]: x async for x in db.mk_contacts.find({"id": {"$in": [q["contact_id"] for q in queued]}},
                                                              {"_id": 0, "id": 1, "email": 1, "email_norm": 1, "email_status": 1})}
    cached = await _ses_cached([x["email_norm"] for x in contacts.values() if x.get("email_status") != "verified"])
    drop, recheck = [], []
    for q in queued:
        x = contacts.get(q["contact_id"])
        if not x:
            drop.append(q["id"])
        elif x.get("email_status") == "verified":
            continue
        elif (cached.get(x["email_norm"]) or {}).get("overall") != "HIGH":
            drop.append(q["id"])
        elif cached[x["email_norm"]].get("at", "") < fresh_cut:
            recheck.append((q, x))
    if recheck:
        res = await verify_emails([x["email"] for _, x in recheck], autofix=False, ses="refresh")
        for (q, x), v in zip(recheck, res):
            await db.mk_contacts.update_one({"id": x["id"]}, {"$set": _status_update(v)})
            if not (v["status"] == "valid" and v.get("ses_overall") == "HIGH"):
                drop.append(q["id"])
    if drop:
        await db.mk_sends.update_many({"id": {"$in": drop}, "status": "queued"},
                                      {"$set": {"status": "skipped", "error": "dropped after a bounce spike (not proven / not high-confidence)"}})
    info = {"at": _iso(), "reason": why, "dropped": len(drop), "rechecked": len(recheck)}
    await db.mk_campaigns.update_one({"id": cid}, {"$set": {"recovered_at": info["at"], "recovery": info}})
    log.warning("marketing: campaign %s recovered from a bounce spike: %s", cid, info)
    return info


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
            camp = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "stats": 1, "channel": 1, "recovered_at": 1, "name": 1})
            if camp["channel"] == "email":
                # The catch-all tail stops itself if it bounces; the campaign carries on.
                tail_base = {"campaign_id": cid, "tail": True}
                t_sent = await db.mk_sends.count_documents({**tail_base, "status": {"$in": ["sent", "bounced", "complained"]}})
                t_bounced = await db.mk_sends.count_documents({**tail_base, "status": "bounced"})
                if core.tail_should_stop(t_sent, t_bounced, max_rate=float(st.get("tail_max_bounce") or 0.03)):
                    r = await db.mk_sends.update_many({**tail_base, "status": "queued"},
                                                      {"$set": {"status": "skipped", "error": "catch-all tail stopped: too many bounces"}})
                    if r.modified_count:
                        await db.mk_campaigns.update_one({"id": cid}, {"$set": {"tail_stopped_at": _iso()}})
                since = camp.get("recovered_at")
                s_ = await _window_stats(cid, since) if since else (camp.get("stats") or {})
                why = core.should_pause(s_.get("sent", 0), s_.get("bounced", 0), s_.get("complained", 0),
                                        max_bounce=float(st.get("max_bounce") or 0.02))
                if why and not since:
                    await _recover(cid, why)   # first spike: clean the queue and carry on
                elif why:
                    await db.mk_campaigns.update_one({"id": cid, "status": "sending"},
                                                     {"$set": {"status": "paused", "paused_reason": f"Auto-paused again after recovering: {why}", "paused_at": _iso()}})
                    await raise_alert("paused", f"“{camp.get('name', '')}” paused: {why}, even after dropping unproven addresses. Check the bounce list before resuming.",
                                      campaign_id=cid)
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
    agg = {"queued": counts.get("queued", 0), "failed": counts.get("failed", 0), "skipped": counts.get("skipped", 0),
           "blocked": counts.get("blocked", 0)}
    # "blocked" = SES Auto Validation refused it before sending: not sent, and
    # not a bounce, so it must not push the campaign towards auto-pause.
    sent_like = sum(v for k, v in counts.items() if k not in ("queued", "failed", "skipped", "blocked"))
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
    elif kind == "Bounce" and (msg.get("bounce") or {}).get("bounceSubType") == "EmailValidationSuppressed":
        # SES Auto Validation stopped it before sending. Never mail it again,
        # but it never reached a mailbox provider, so it is not a bounce.
        for r in (msg.get("bounce") or {}).get("bouncedRecipients") or []:
            await suppress({"email_norm": core.normalise_email(r.get("emailAddress"))}, "invalid (SES validation)")
        if s:
            await db.mk_sends.update_one({"id": s["id"]}, {"$set": {"status": "blocked", "error": "SES validation: address unlikely to exist"}})
    elif kind == "Bounce":
        b = msg.get("bounce") or {}
        permanent = b.get("bounceType") == "Permanent"
        for r in b.get("bouncedRecipients") or []:
            norm = core.normalise_email(r.get("emailAddress"))
            if permanent:
                await suppress({"email_norm": norm}, "bounced")
                dom = norm.split("@")[-1] if "@" in norm else ""
                if dom and dom not in core.WEBMAIL:
                    d = await db.mk_domains.find_one_and_update({"domain": dom}, {"$addToSet": {"hard_bounced": norm}},
                                                                upsert=True, return_document=True, projection={"_id": 0, "hard_bounced": 1})
                    if core.is_bad_domain(dom, len((d or {}).get("hard_bounced") or [])):
                        await db.mk_domains.update_one({"domain": dom}, {"$set": {"bad": True, "bad_at": _iso()}})
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


async def sync_aws_suppression(force: bool = False) -> dict:
    """Once a day: copy AWS's own suppression list (addresses SES itself
    refuses after a hard bounce / complaint) into Contacts, so the two never
    drift apart. Needs ses:ListSuppressedDestinations."""
    state = await db.integrations.find_one({"key": "marketing_state"}, {"_id": 0}) or {}
    last = state.get("suppression_synced_at") or ""
    if not force and last and last > (_now() - timedelta(hours=24)).isoformat():
        return {"skipped": True}
    start = datetime.fromisoformat(last) if last else datetime(2020, 1, 1, tzinfo=timezone.utc)
    n, token = 0, None
    try:
        client = _ses()
        while True:
            kw = {"PageSize": 1000, "StartDate": start}
            if token:
                kw["NextToken"] = token
            r = await asyncio.to_thread(lambda: client.list_suppressed_destinations(**kw))
            for d in r.get("SuppressedDestinationSummaries") or []:
                norm = core.normalise_email(d.get("EmailAddress"))
                c = await db.mk_contacts.find_one({"email_norm": norm, "suppressed": {"$in": [None, ""]}}, {"_id": 0, "id": 1})
                if c:
                    await suppress({"id": c["id"]}, "complained" if d.get("Reason") == "COMPLAINT" else "bounced")
                    n += 1
            token = r.get("NextToken")
            if not token:
                break
    except Exception as e:  # noqa: BLE001
        code = ((getattr(e, "response", None) or {}).get("Error") or {}).get("Code", "") or str(e)[:120]
        await raise_alert("aws_suppression", f"Could not read the AWS suppression list ({code}). "
                                             "Allow ses:ListSuppressedDestinations for the site's AWS user.", key="aws_suppression")
        return {"ok": False, "error": code}
    await db.integrations.update_one({"key": "marketing_state"}, {"$set": {"key": "marketing_state", "suppression_synced_at": _iso(),
                                                                           "suppression_last_added": n}}, upsert=True)
    await db.mk_alerts.update_many({"key": "aws_suppression", "resolved": False}, {"$set": {"resolved": True, "resolved_at": _iso()}})
    return {"ok": True, "suppressed": n}


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
            "last_ses_event": await db.mk_events.find_one({}, {"_id": 0, "at": 1, "type": 1}, sort=[("at", -1)]),
            "ses_usage": await ses_usage(),
            "waiting_checks": await db.mk_contacts.count_documents({"email_status": {"$in": ["unknown", "valid", "risky"]},
                                                                     "ses_checked": {"$ne": True}}),
            "suppression_sync": await db.integrations.find_one({"key": "marketing_state"}, {"_id": 0, "suppression_synced_at": 1,
                                                                                             "suppression_last_added": 1})}


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
    ses_validation: Optional[bool] = None
    ses_budget_inr: Optional[float] = None
    usd_inr: Optional[float] = None
    risk_policy: Optional[dict] = None
    tail_max_bounce: Optional[float] = None


@admin_router.put("/settings")
async def adm_put_settings(body: SettingsBody, user: dict = Depends(require_superadmin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    for k in ("from_email", "reply_to"):
        if upd.get(k) and not core.check_syntax(upd[k])["ok"]:
            raise HTTPException(status_code=400, detail=f"{k.replace('_', ' ')} is not a valid email address")
    if "max_bounce" in upd and not (0.005 <= upd["max_bounce"] <= 0.05):
        raise HTTPException(status_code=400, detail="Auto-pause must be between 0.5% and 5% bounces")
    if "ses_budget_inr" in upd and not (0 <= upd["ses_budget_inr"] <= 100000):
        raise HTTPException(status_code=400, detail="Monthly mailbox-check budget must be between ₹0 and ₹1,00,000")
    if "usd_inr" in upd and not (50 <= upd["usd_inr"] <= 200):
        raise HTTPException(status_code=400, detail="USD→INR rate looks wrong (50–200)")
    if "tail_max_bounce" in upd and not (0.005 <= upd["tail_max_bounce"] <= 0.1):
        raise HTTPException(status_code=400, detail="Tail bounce limit must be between 0.5% and 10%")
    if "risk_policy" in upd:
        pol = upd["risk_policy"] or {}
        if any(k not in core.RISK_KINDS or v not in ("send", "tail", "skip") for k, v in pol.items()):
            raise HTTPException(status_code=400, detail="Risk rules: each kind must be send, tail or skip")
        upd["risk_policy"] = {**core.DEFAULT_RISK_POLICY, **pol}
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
    ses: bool = True   # also ask SES whether each mailbox exists (paid, capped)


@admin_router.post("/verify")
async def adm_verify(body: VerifyBody):
    """Check up to 200 typed / pasted addresses without saving anything."""
    rows = await verify_emails([e for e in body.emails if str(e).strip()][:200], autofix=body.autofix,
                               ses="live" if body.ses else "cache")
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
    statuses: str = Form("verified,valid,risky"),
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
    # Cached SES verdicts only: a dry run must never spend money, and a real
    # import hands the paid checks to the capped background pass (kick_validation).
    results = await verify_emails([r.get(ecol, "") for r in unique_rows], autofix=autofix, ses="cache")
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
        wanted = core.selected_statuses({"statuses": [x.strip() for x in statuses.split(",")]})
        for r, v in zip(unique_rows, results):
            if v["status"] in ("invalid", "suppressed") or v["status"] not in wanted:
                continue
            if v["status"] == "risky" and v.get("role") and not st["include_role_addresses"]:
                pass  # kept, but campaigns skip risky unless asked
            await upsert_contact(v["email"], name=r.get(ncol, "") if ncol else "", phone=r.get(pcol, "") if pcol else "",
                                 source=src, lists=[lid], status=v["status"], reasons=v["reasons"],
                                 proven=v["status"] == "verified" or None, ses_checked=v.get("ses_checked") or None,
                                 extra={"risk_kind": v.get("risk_kind", ""), "ses_overall": v.get("ses_overall", "")},
                                 email_consent="subscribed" if consent_email else None,
                                 wa_consent="subscribed" if consent_whatsapp else None, by=user.get("email", ""))
            saved += 1
        await db.mk_imports.insert_one({"id": str(uuid.uuid4()), "at": _iso(), "by": user.get("email", ""), "file": file.filename,
                                        "list_id": lid, "counts": counts, "saved": saved, "consent_source": consent_source})
        await audit_log(db, "MARKETING_IMPORT", email=user.get("email", ""), role=user.get("role", ""),
                        meta={"file": file.filename, "saved": saved, "counts": counts, "consent_email": consent_email,
                              "consent_whatsapp": consent_whatsapp})
        kick_validation()
    sample: dict = {}
    for v in results:
        sample.setdefault(v["status"], [])
        if len(sample[v["status"]]) < 25:
            sample[v["status"]].append({k: v[k] for k in ("input", "email", "reasons", "fixed_from")})
    ses_todo = sum(1 for v in results if v["status"] in ("valid", "risky") and not v.get("ses_checked"))
    return {"columns": {"email": ecol, "name": ncol, "phone": pcol}, "counts": counts, "sample": sample,
            "saved": saved, "list_id": lid, "dry_run": dry_run,
            "ses": {**(_u := await ses_usage()), "to_check": ses_todo, "est_inr": round(ses_todo * _u["per_check_inr"], 2)}}


@admin_router.post("/alerts/{aid}/dismiss")
async def adm_dismiss_alert(aid: str, user: dict = Depends(require_admin)):
    await db.mk_alerts.update_one({"id": aid}, {"$set": {"resolved": True, "resolved_at": _iso(), "resolved_by": user.get("email", "")}})
    return {"ok": True}


@admin_router.post("/suppression-sync")
async def adm_suppression_sync():
    """Copy AWS's suppression list into Contacts now (the cron does it daily)."""
    return await sync_aws_suppression(force=True)


@admin_router.post("/validate-pending")
async def adm_validate_pending():
    """'Check now': run the mailbox checks for waiting contacts immediately
    (the cron does the same every few minutes)."""
    kick_validation()
    return {"ok": True, "usage": await ses_usage()}


@admin_router.post("/reverify")
async def adm_reverify(list_id: Optional[str] = None):
    """Run verification again over saved contacts (e.g. after 6 months)."""
    flt = {"lists": list_id} if list_id else {}
    contacts = await db.mk_contacts.find(flt, {"_id": 0, "id": 1, "email": 1}).to_list(50000)
    res = await verify_emails([c["email"] for c in contacts], autofix=False)
    for c, v in zip(contacts, res):
        await db.mk_contacts.update_one({"id": c["id"]}, {"$set": _status_update(v)})
    kick_validation()
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
    kick_validation()
    return {"ok": True, "processed": n, "contacts": await db.mk_contacts.count_documents({})}


# ---- contacts ----
def _contact_filter(q: Optional[str] = None, status: Optional[str] = None, list_id: Optional[str] = None,
                    consent: Optional[str] = None) -> dict:
    """One filter for the Contacts page AND its "select all N matching" bulk
    actions, so a bulk action can never hit more people than the admin saw."""
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
    return flt


@admin_router.get("/contacts")
async def adm_contacts(q: Optional[str] = None, status: Optional[str] = None, list_id: Optional[str] = None,
                       consent: Optional[str] = None, page: int = 1, per: int = 50):
    flt = _contact_filter(q, status, list_id, consent)
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


class ContactBulk(BaseModel):
    action: str                         # unsubscribe | erase
    ids: Optional[list[str]] = None     # the ticked rows, or…
    all_matching: Optional[dict] = None  # {q, status, list_id, consent}: everyone the filter shows
    expected: int                       # how many the admin confirmed — must still match


BULK_MAX = 50000


@admin_router.post("/contacts/bulk")
async def adm_contacts_bulk(body: ContactBulk, user: dict = Depends(require_admin)):
    """Bulk unsubscribe (admin) or erase (superadmin — the same rule as the
    single erase, which is a DELETE). Unsubscribe is reversible only by the
    person opting in again; erase keeps just a hash so they can't be re-added."""
    from rbac import is_superadmin
    if body.action not in ("unsubscribe", "erase"):
        raise HTTPException(status_code=400, detail="Unknown action")
    if body.action == "erase" and not is_superadmin(user.get("role")):
        raise HTTPException(status_code=403, detail="Only a superadmin can erase contacts")
    if body.ids:
        flt = {"id": {"$in": [str(x) for x in body.ids][:BULK_MAX]}}
    elif body.all_matching is not None:
        m = body.all_matching
        flt = _contact_filter(m.get("q"), m.get("status"), m.get("list_id"), m.get("consent"))
    else:
        raise HTTPException(status_code=400, detail="Nothing selected")
    n = await db.mk_contacts.count_documents(flt)
    if n > BULK_MAX:
        raise HTTPException(status_code=400, detail=f"{n} contacts — narrow the filter (max {BULK_MAX} at a time)")
    if n != body.expected:
        raise HTTPException(status_code=409, detail=f"The selection changed to {n} — check it again")
    done = 0
    if body.action == "unsubscribe":
        r = await db.mk_contacts.update_many({**flt, "email_consent.status": {"$nin": ["unsubscribed", "complained"]}},
                                             {"$set": {"email_consent": _consent("unsubscribed", "admin (bulk)", user.get("email", ""))}})
        done = r.modified_count
    else:
        async for c in db.mk_contacts.find(flt, {"_id": 0, "id": 1, "email_norm": 1}):
            await db.mk_erased.update_one({"h": hashlib.sha256(c["email_norm"].encode()).hexdigest()}, {"$set": {"at": _iso()}}, upsert=True)
            await db.mk_contacts.delete_one({"id": c["id"]})
            done += 1
    await audit_log(db, f"MARKETING_CONTACTS_BULK_{body.action.upper()}", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"count": done, "by_filter": body.all_matching is not None})
    return {"ok": True, "done": done}


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


class IdsBody(BaseModel):
    ids: list[str]


@admin_router.post("/lists/bulk-delete")
async def adm_lists_bulk_delete(body: IdsBody, user: dict = Depends(require_superadmin)):
    """Delete several lists / segments. The contacts in them stay."""
    ids = [str(x) for x in body.ids][:500]
    r = await db.mk_lists.delete_many({"id": {"$in": ids}})
    await db.mk_contacts.update_many({"lists": {"$in": ids}}, {"$pull": {"lists": {"$in": ids}}})
    await audit_log(db, "MARKETING_LISTS_DELETED", email=user.get("email", ""), role=user.get("role", ""), meta={"count": r.deleted_count})
    return {"ok": True, "deleted": r.deleted_count}


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
    return await db.mk_campaigns.find({"deleted": {"$ne": True}}, {"_id": 0, "blocks": 0}).sort("created_at", -1).to_list(500)


@admin_router.post("/campaigns/bulk-delete")
async def adm_campaigns_bulk_delete(body: IdsBody, user: dict = Depends(require_superadmin)):
    """Drafts (nothing sent) are deleted outright. Anything that reached a
    mailbox is ARCHIVED instead — hidden everywhere, but its send records are
    kept so the unsubscribe links in those emails keep working (a legal
    requirement) and tracking links still land on the site. A campaign that
    is preparing / sending must be cancelled first."""
    deleted, archived, refused = 0, 0, []
    for cid in [str(x) for x in body.ids][:500]:
        c = await db.mk_campaigns.find_one({"id": cid, "deleted": {"$ne": True}}, {"_id": 0, "id": 1, "status": 1, "name": 1})
        if not c:
            continue
        if c["status"] in ("preparing", "sending"):
            refused.append({"id": cid, "name": c.get("name", ""), "reason": "still sending — cancel it first"})
            continue
        # scheduled / paused: nothing more may go out
        await db.mk_sends.update_many({"campaign_id": cid, "status": "queued"}, {"$set": {"status": "skipped", "error": "campaign deleted"}})
        reached = await db.mk_sends.count_documents({"campaign_id": cid, "status": {"$in": ["sent", "bounced", "complained", "blocked"]}})
        if reached:
            await db.mk_campaigns.update_one({"id": cid}, {"$set": {"deleted": True, "deleted_at": _iso(), "deleted_by": user.get("email", ""),
                                                                    "status": c["status"] if c["status"] in ("sent", "cancelled") else "cancelled"}})
            archived += 1
        else:
            await db.mk_sends.delete_many({"campaign_id": cid})
            await db.mk_campaigns.delete_one({"id": cid})
            deleted += 1
    await audit_log(db, "MARKETING_CAMPAIGNS_DELETED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"deleted": deleted, "archived": archived, "refused": len(refused)})
    return {"ok": True, "deleted": deleted, "archived": archived, "refused": refused}


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
    if "audience" in upd and "statuses" in (upd["audience"] or {}):
        upd["audience"]["statuses"] = sorted(core.selected_statuses(upd["audience"]))
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
    rows = await db.mk_contacts.find(flt, {"_id": 0, "email_norm": 1, "email_status": 1, "risk_kind": 1}).to_list(200000)
    total = len(rows)
    by: dict = {}
    for r in rows:
        by[r.get("email_status") or "unknown"] = by.get(r.get("email_status") or "unknown", 0) + 1
    st = await get_settings()
    rate = float(st.get("usd_inr") or 88)
    out = {"total": total, "by_status": by}
    if c["channel"] == "whatsapp":
        out["estimated_cost_inr"] = round(total * float(st["wa_rate_marketing"]) * 1.18, 2)
        return out
    out["estimated_cost_inr"] = round(total / 1000 * 0.10 * rate, 2)
    use = await ses_usage()
    ses_on = use["enabled"] and use["supported"]
    unproven = [r["email_norm"] for r in rows if r.get("email_status") in ("valid", "risky", "unknown") and r.get("email_norm")]
    cached = await _ses_cached(unproven) if ses_on else {}
    needs = sum(1 for n in unproven if n not in cached) if ses_on else 0
    pol = _policy(st, c)
    kinds: dict = {}
    for r in rows:
        if r.get("email_status") == "risky":
            k = r.get("risk_kind") or "unconfirmed"
            kinds.setdefault(k, {"n": 0, "action": pol.get(k, "skip")})
            kinds[k]["n"] += 1
    out.update(needs_check=needs, check_cost_inr=round(needs * use["per_check_inr"], 2), checks_left=use["left"],
               ses_on=ses_on, risky_by_kind=kinds, selected=sorted(core.selected_statuses(c.get("audience"))))
    return out


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
    n = await db.mk_contacts.count_documents(await audience_filter(c))
    if not n:
        raise HTTPException(status_code=400, detail="Nobody in this audience can be sent to (no one has opted in, or all are unsubscribed / bounced)")
    if abs(n - body.confirm_count) > max(5, n // 50):
        raise HTTPException(status_code=409, detail=f"The audience changed to {n} — check it again before sending")
    await _ensure_indexes()
    now = _iso()
    # Status guard: a double click can't start two preparations.
    r = await db.mk_campaigns.update_one({"id": cid, "status": {"$in": ["draft", "scheduled"]}}, {"$set": {
        "status": "preparing", "schedule_at": body.schedule_at or "", "sent_by": user.get("email", ""), "prepare_error": "",
        "prepare": {"started_at": now, "candidates": n, "checked": 0}, "prepare_heartbeat": now}})
    if not r.modified_count:
        raise HTTPException(status_code=409, detail="This campaign is already being sent")
    await audit_log(db, "MARKETING_CAMPAIGN_SEND", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"campaign": cid, "channel": c["channel"], "candidates": n, "schedule_at": body.schedule_at or ""})
    start_prepare(cid)
    return {"ok": True, "status": "preparing", "recipients": n}


@admin_router.post("/campaigns/{cid}/{action}")
async def adm_campaign_action(cid: str, action: str, user: dict = Depends(require_admin)):
    if action not in ("pause", "resume", "cancel"):
        raise HTTPException(status_code=404, detail="Unknown action")
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "status": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    allowed = {"pause": ("sending", "scheduled"), "resume": ("paused",), "cancel": ("preparing", "sending", "scheduled", "paused")}[action]
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
    problems = await db.mk_sends.find({"campaign_id": cid, "status": {"$in": ["bounced", "complained", "failed", "blocked"]}},
                                      {"_id": 0, "to": 1, "status": 1, "bounce_type": 1, "error": 1}).limit(200).to_list(200)
    skipped = [{"reason": r["_id"] or "skipped", "n": r["n"]} async for r in db.mk_sends.aggregate([
        {"$match": {"campaign_id": cid, "status": "skipped"}}, {"$group": {"_id": "$error", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}])]
    return {"campaign": {k: c.get(k) for k in ("id", "name", "channel", "subject", "status", "started_at", "finished_at", "paused_reason",
                                               "prepare", "prepare_error", "recovery", "tail_stopped_at", "note")},
            "skipped": skipped,
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
    camps = await db.mk_campaigns.find({"started_at": {"$gte": since}, "deleted": {"$ne": True}}, {"_id": 0, "blocks": 0}).sort("started_at", -1).to_list(200)
    gone = {c["id"] async for c in db.mk_campaigns.find({"deleted": True}, {"_id": 0, "id": 1})}
    gone_tags = {core.campaign_tag(x) for x in gone}
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
        if s.get("campaign_id") in gone:
            continue  # archived (deleted) campaigns drop out of the charts too
        bump(s["sent_at"][:10], "sent")
        if s.get("opened_at"):
            bump(s["opened_at"][:10], "opened")
        if s.get("clicked_at"):
            bump(s["clicked_at"][:10], "clicked")
        if s.get("status") == "bounced":
            bump(s["sent_at"][:10], "bounced")
    async for o in db.orders.find({"created_at": {"$gte": since}, "payment_status": "paid",
                                   "attribution.utm_campaign": {"$regex": "^mk-"}}, {"_id": 0, "created_at": 1, "total": 1, "attribution": 1}):
        if (o.get("attribution") or {}).get("utm_campaign") in gone_tags:
            continue
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
            "verification": by_status,
            "alerts": await db.mk_alerts.find({"resolved": False}, {"_id": 0}).sort("at", -1).limit(20).to_list(20),
            "ses_usage": await ses_usage()}


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
    stale_prep = (_now() - timedelta(seconds=PREPARE_STALE)).isoformat()
    async for c in db.mk_campaigns.find({"status": "preparing", "prepare_heartbeat": {"$lt": stale_prep}}, {"_id": 0, "id": 1}):
        start_prepare(c["id"])   # e.g. a deploy restarted the server mid-check
        started.append(c["id"])
    kick_validation()
    _bg(sync_aws_suppression())  # no-op unless 24h have passed
    return {"ok": True, "started": started}


async def resume_on_startup() -> None:
    """After a deploy, carry on with anything that was mid-send."""
    try:
        await asyncio.sleep(10)
        async for c in db.mk_campaigns.find({"status": "sending"}, {"_id": 0, "id": 1}):
            await start_campaign(c["id"])
        async for c in db.mk_campaigns.find({"status": "preparing"}, {"_id": 0, "id": 1}):
            start_prepare(c["id"])
    except Exception:  # noqa: BLE001
        log.exception("marketing: resume on startup failed")
