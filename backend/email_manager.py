"""Email Manager — every email a customer receives, in one place.

Admin → Email Manager (frontend/src/pages/admin/AdminEmails.jsx). It lets the
team decide WHO customers hear from (a named person who signs every email, the
inbox replies go to, WhatsApp and opening hours) and, per email: whether it is
sent, its subject line, and the short personal note it carries.

HOW IT PLUGS IN
    emailer.send_email(..., kind="receipt", ctx={...}) — every customer email
    names its `kind`. send_email then asks this module to:
      1. skip it if the email is switched off here (never the security ones —
         sign-up code and password reset are LOCKED on);
      2. use the subject override, if one is set;
      3. add the personal layer (personalise): the signed note + any extra
         block (e.g. "you might also like" on the delivered email), and tag our
         own links with utm_* so Marketing → Growth can count what these
         emails sell;
      4. set Reply-To to the real inbox, so "reply to this email" reaches a
         person;
      5. log the send (email_log, 90 days) for the counts on the admin page.

    The renderers in emailer.py stay the single source of each email's body;
    this is a layer over them, so an email that is never touched here looks
    exactly as before apart from the signature.

WHAT IS NOT HERE
    Marketing campaigns, the newsletter and the Growth automations (abandoned
    checkout, review request) have their own editor and consent rules in
    Admin → Marketing; the page links there instead of duplicating them.

SAFETY
    Everything an admin types is HTML-escaped before it goes into an email, and
    merge fields are filled from a fixed list ({first_name}, {order_number},
    {books}, {signer}, {dispatch_promise}) — no template language, nothing
    evaluated. A test send only ever goes to the signed-in admin's own address.
"""
from __future__ import annotations

import html as _html
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------ catalogue
# key -> label, group, when it is sent, locked (cannot be switched off),
# note (default personal note; "" = this email carries no note).
KINDS: list[dict] = [
    # Account
    {"key": "otp", "label": "Sign-up verification code", "group": "Account", "trigger": "At sign-up (by email when SMS is not set up)",
     "locked": True, "note": ""},
    {"key": "welcome", "label": "Welcome", "group": "Account", "trigger": "Right after sign-up", "locked": False,
     "note": "Welcome to Oakbridge, {first_name}. I look after our readers here — if you are looking for a particular "
             "title, an edition for your course, or copies for your institution, reply to this email and I will help "
             "you find it."},
    {"key": "password_reset", "label": "Password reset", "group": "Account", "trigger": "When a customer asks to reset", "locked": True, "note": ""},
    # Orders
    {"key": "receipt", "label": "Order receipt + invoice", "group": "Orders", "trigger": "When payment succeeds", "locked": True,
     "note": "Thank you for choosing Oakbridge, {first_name}. Every order is checked by our own team before it leaves us, "
             "and yours will be dispatched {dispatch_promise}. If anything about it isn't right — an address, an edition, "
             "an extra copy — just reply to this email and I will sort it out personally."},
    {"key": "payment_failed", "label": "Payment didn't go through", "group": "Orders", "trigger": "When Razorpay reports a failed payment", "locked": False,
     "note": "Payments sometimes fail for reasons that have nothing to do with you — a bank timeout, an OTP that came late. "
             "Your books are still set aside. If it keeps happening, reply here and I can send you a fresh payment link "
             "or arrange another way to pay."},
    {"key": "payment_link", "label": "Payment link (order waiting)", "group": "Orders", "trigger": "Sent from Admin → Orders, or when an order is marked bounced", "locked": False,
     "note": "I've kept order {order_number} open for you. If you have a question before paying — delivery time, "
             "a bulk quantity, a GST invoice in your institution's name — reply and I'll answer it first."},
    {"key": "dispatched", "label": "Dispatched (with tracking)", "group": "Orders", "trigger": "Order marked Shipped with a tracking number", "locked": False,
     "note": "Your parcel is with our courier now, {first_name}. If the tracking hasn't moved in two working days, "
             "or anything arrives damaged, reply to this email — you won't need to explain twice."},
    {"key": "status_update", "label": "Order status update", "group": "Orders", "trigger": "Any other status change with “notify” ticked", "locked": False,
     "note": "If you have any question about order {order_number}, reply to this email — it comes straight to me."},
    {"key": "delivered", "label": "Delivered — thank you", "group": "Orders", "trigger": "Order marked Delivered with “notify” ticked", "locked": False,
     "note": "I hope {books} arrived in perfect condition. If anything is wrong with your copy, reply and we will replace it. "
             "And if you have a minute, a short review on the book's page helps other readers choose — it means a great deal "
             "to our authors."},
    {"key": "cancelled", "label": "Order cancelled", "group": "Orders", "trigger": "Order marked Cancelled", "locked": False,
     "note": "I'm sorry this order didn't work out. If the cancellation wasn't what you expected, or you'd like us to "
             "reserve the books for you again, reply to this email and I'll take care of it."},
    # Cart & stock
    {"key": "cart_reminder", "label": "Cart reminder (12 h · 1 week · month end)", "group": "Cart & stock",
     "trigger": "Signed-in customers with books left in their cart (skipped while a checkout is open — the Growth email covers that)", "locked": False,
     "note": "If something stopped you — delivery time, the right edition, paying by another method — reply and tell me. "
             "We help readers with exactly these questions every day."},
    {"key": "stock_signup", "label": "Back-in-stock sign-up confirmed", "group": "Cart & stock", "trigger": "When someone asks to be told about a restock", "locked": False,
     "note": "I've noted your interest. You'll hear from us the moment it is back. If you need it by a particular "
             "date, reply and let me know — sometimes we can help."},
    {"key": "back_in_stock", "label": "Back in stock", "group": "Cart & stock", "trigger": "When a watched title is restocked", "locked": False,
     "note": "As promised — it's back on our shelves. If you need several copies for a class or a library, reply and "
             "I'll arrange them for you."},
    # Replies to people who wrote to us
    {"key": "contact_ack", "label": "We've received your message", "group": "Replies", "trigger": "Contact form (every subject except “Manuscript Submission”)", "locked": False,
     "note": "Thank you for writing to us, {first_name}. A member of our team will reply personally, usually within one "
             "working day. If it's about an order, keep your order number handy — it helps us help you faster."},
    # A manuscript submission gets THIS email, not a separate "received" ack —
    # deliberately (features.py: two automatic emails for one submission read
    # as noise). It is already a signed editorial letter, so it carries no
    # extra note.
    {"key": "publishing_enquiry", "label": "Manuscript / publishing enquiry — reply with proposal form", "group": "Replies",
     "trigger": "Every manuscript submission, and contact messages with subject “Manuscript Submission”", "locked": False,
     "note": ""},
    {"key": "review_thanks", "label": "Thanks for your review", "group": "Replies", "trigger": "When a customer posts a review", "locked": False,
     "note": "Thank you, {first_name}. Our authors read what readers say — your review genuinely reaches them."},
    {"key": "waitlist_welcome", "label": "Waitlist welcome", "group": "Replies", "trigger": "Joining the Academy / Digital Solutions waitlist", "locked": False,
     "note": "You're on the list, and I'll make sure you hear first. If you'd like to talk about it for your "
             "team or institution before launch, reply to this email."},
    {"key": "purchase_nudge", "label": "Purchase nudge (sent by an admin)", "group": "Replies", "trigger": "Admin → Users → send purchase nudge", "locked": False,
     "note": "Picking the right title can take a moment. If you tell me what you're studying or working on, I'll "
             "suggest where to start."},
]
KIND_KEYS = {k["key"] for k in KINDS}
_BY_KEY = {k["key"]: k for k in KINDS}
MERGE_FIELDS = ("first_name", "order_number", "books", "signer", "dispatch_promise")

DEFAULT_CFG: dict[str, Any] = {
    "signer_name": "",                 # e.g. "Shreesh" — blank signs as the team
    "signer_role": "Reader Care",
    "team_name": "Oakbridge Publishing",
    "signer_photo": "",                # https URL; blank shows the initial
    "reply_to": "info@oakbridge.in",
    "whatsapp": "",                    # shown only when set
    "hours": "Mon–Sat, 10am–6pm",
    "dispatch_promise": "within 1–2 working days",
    "signoff": "Warm regards",
    "utm": True,
    "kinds": {},                       # key -> {"enabled": bool, "subject": str, "note": str}
}

_EMAIL_RX = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[A-Za-z]{2,}$")
_PHONE_RX = re.compile(r"^\+?[0-9][0-9 \-]{6,18}$")


def _s(v, n: int) -> str:
    return str(v or "").replace("\r", "").strip()[:n]


def clean_cfg(raw: Any) -> dict:
    """Admin input -> a config that is safe to use. Unknown keys dropped,
    lengths capped, addresses and URLs checked; bad values fall back."""
    r = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_CFG)
    out["signer_name"] = _s(r.get("signer_name"), 60)
    out["signer_role"] = _s(r.get("signer_role", DEFAULT_CFG["signer_role"]), 60)
    out["team_name"] = _s(r.get("team_name"), 80) or DEFAULT_CFG["team_name"]
    photo = _s(r.get("signer_photo"), 500)
    out["signer_photo"] = photo if photo.startswith("https://") and " " not in photo else ""
    reply = _s(r.get("reply_to"), 120)
    out["reply_to"] = reply if _EMAIL_RX.match(reply) else DEFAULT_CFG["reply_to"]
    wa = _s(r.get("whatsapp"), 20)
    out["whatsapp"] = wa if _PHONE_RX.match(wa) else ""
    out["hours"] = _s(r.get("hours", DEFAULT_CFG["hours"]), 60)
    out["dispatch_promise"] = _s(r.get("dispatch_promise"), 60) or DEFAULT_CFG["dispatch_promise"]
    out["signoff"] = _s(r.get("signoff"), 40) or DEFAULT_CFG["signoff"]
    out["utm"] = r.get("utm") is not False
    kinds = {}
    for key, v in (r.get("kinds") or {}).items() if isinstance(r.get("kinds"), dict) else []:
        if key not in KIND_KEYS or not isinstance(v, dict):
            continue
        kinds[key] = {
            "enabled": True if _BY_KEY[key]["locked"] else v.get("enabled") is not False,
            "subject": _s(v.get("subject"), 150),
            "note": _s(v.get("note"), 900),
        }
    out["kinds"] = kinds
    return out


def enabled(kind: str, cfg: dict) -> bool:
    k = _BY_KEY.get(kind)
    if not k:
        return True
    if k["locked"]:
        return True
    return (cfg.get("kinds") or {}).get(kind, {}).get("enabled", True) is not False


def note_text(kind: str, cfg: dict) -> str:
    """The note for this email: the admin's text, else the default. A note the
    admin cleared to a single "-" means "no note on this email"."""
    k = _BY_KEY.get(kind)
    if not k:
        return ""
    custom = (cfg.get("kinds") or {}).get(kind, {}).get("note", "")
    if custom.strip() == "-":
        return ""
    return custom or k["note"]


def merge(text: str, ctx: dict, cfg: dict, *, escape: bool = True) -> str:
    """Fill {merge} fields. Only the fixed list; anything else is left as typed."""
    vals = {
        "first_name": ctx.get("first_name") or "there",
        "order_number": ctx.get("order_number") or "",
        "books": ctx.get("books") or "your books",
        "signer": cfg.get("signer_name") or cfg.get("team_name") or "Oakbridge",
        "dispatch_promise": cfg.get("dispatch_promise") or DEFAULT_CFG["dispatch_promise"],
    }
    def rep(m):
        v = vals.get(m.group(1))
        if v is None:
            return m.group(0)
        return _html.escape(str(v)) if escape else str(v)
    src = _html.escape(text) if escape else text
    return re.sub(r"\{(" + "|".join(MERGE_FIELDS) + r")\}", rep, src)


def subject_for(kind: str, default: str, ctx: dict, cfg: dict) -> str:
    custom = (cfg.get("kinds") or {}).get(kind, {}).get("subject", "")
    if not custom:
        return default
    # A subject is plain text, not HTML: merge without escaping, then strip
    # line breaks so nothing can be smuggled into the mail headers.
    return re.sub(r"[\r\n]+", " ", merge(custom, ctx, cfg, escape=False))[:150]


def first_name(name: Any) -> str:
    s = str(name or "").strip().split(" ")[0]
    return s[:40]


def books_phrase(items: list) -> str:
    titles = [str((i or {}).get("title") or "").strip() for i in (items or [])]
    titles = [t for t in titles if t]
    if not titles:
        return ""
    if len(titles) == 1:
        return titles[0]
    if len(titles) == 2:
        return f"{titles[0]} and {titles[1]}"
    return f"{titles[0]}, {titles[1]} and {len(titles) - 2} more"


def order_ctx(order: dict) -> dict:
    return {
        "first_name": first_name(order.get("full_name") or order.get("name")),
        "order_number": str(order.get("order_number") or ""),
        "books": books_phrase(order.get("items") or []),
    }


# ------------------------------------------------------------- the HTML layer
NAVY, RED, GREY = "#002B5C", "#CC0033", "#4B5563"
NO_TRACKING = frozenset({"otp", "password_reset"})
MARKER = "<!--OB:PERSONAL-->"


def note_block(kind: str, ctx: dict, cfg: dict) -> str:
    text = note_text(kind, cfg)
    if not text:
        return ""
    body = merge(text, ctx, cfg).replace("\n", "<br>")
    name = cfg.get("signer_name") or ""
    role = cfg.get("signer_role") or ""
    team = cfg.get("team_name") or "Oakbridge Publishing"
    esc = _html.escape
    avatar = (
        f'<img src="{esc(cfg["signer_photo"])}" width="44" height="44" alt="" '
        f'style="width:44px;height:44px;border-radius:22px;display:block;object-fit:cover;">'
        if cfg.get("signer_photo")
        else f'<div style="width:44px;height:44px;border-radius:22px;background:{NAVY};color:#fff;'
             f'font:700 16px/44px Arial,sans-serif;text-align:center;">{esc((name or team)[:1].upper())}</div>'
    )
    who_line = (
        f'<span style="font-family:Georgia,serif;font-style:italic;font-size:19px;color:{NAVY};">{esc(name)}</span><br>'
        f'{esc(role)}{", " if role else ""}{esc(team)}'
        if name
        else f'<strong style="color:{NAVY};">{esc(team)}</strong>{("<br>" + esc(role)) if role else ""}'
    )
    contact = ["Just reply to this email"]
    if cfg.get("whatsapp"):
        wa = re.sub(r"[^0-9]", "", cfg["whatsapp"])
        contact.append(f'WhatsApp <a href="https://wa.me/{wa}" style="color:{NAVY};">{esc(cfg["whatsapp"])}</a>')
    if cfg.get("hours"):
        contact.append(esc(cfg["hours"]))
    return f"""
      <tr><td style="padding:24px 36px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#FBF8F1;">
          <tr>
            <td width="3" style="width:3px;background-color:{RED};font-size:0;line-height:0;">&nbsp;</td>
            <td style="padding:18px 20px;">
              <p style="margin:0;font-family:Georgia,serif;font-size:15px;line-height:1.7;color:#374151;">{body}</p>
              <p style="margin:14px 0 0;font-size:14px;color:#374151;">{esc(cfg.get("signoff") or "Warm regards")},</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>
                <td valign="middle" style="width:44px;">{avatar}</td>
                <td valign="middle" style="padding-left:12px;font-size:13px;line-height:1.45;color:{GREY};">{who_line}</td>
              </tr></table>
              <p style="margin:12px 0 0;font-size:12px;color:{GREY};">{" &middot; ".join(contact)}</p>
            </td>
          </tr>
        </table>
      </td></tr>"""


def _insert_layer(html: str, block: str) -> str:
    """Put the personal block where the email asks for it (MARKER), else just
    above the email card's last row (its footer, in every customer email)."""
    if not block:
        return html.replace(MARKER, "")
    if MARKER in html:
        return html.replace(MARKER, block, 1)
    outer = html.rfind("</table>")
    card = html.rfind("</table>", 0, outer) if outer != -1 else -1
    row = html.rfind("<tr", 0, card) if card != -1 else -1
    if row == -1:
        return html
    return html[:row] + block + "\n      " + html[row:]


_HREF_RX = re.compile(r'href="(https?://(?:www\.)?oakbridge\.in[^"]*)"', re.I)


def tag_links(html: str, kind: str) -> str:
    """utm_source=email so Marketing → Growth credits these emails with the
    visits and orders they bring; existing utm_* on a link are left alone."""
    def rep(m):
        url = _html.unescape(m.group(1))
        parts = urlsplit(url)
        q = dict(parse_qsl(parts.query, keep_blank_values=True))
        if any(k.startswith("utm_") for k in q):
            return m.group(0)
        q.update({"utm_source": "email", "utm_medium": "lifecycle", "utm_campaign": kind})
        return 'href="' + _html.escape(urlunsplit(parts._replace(query=urlencode(q))), quote=True) + '"'
    return _HREF_RX.sub(rep, html)


def personalise(html: str, kind: str, ctx: Optional[dict], cfg: dict) -> str:
    ctx = ctx or {}
    block = (ctx.get("extra_html") or "") + note_block(kind, ctx, cfg)
    out = _insert_layer(html, block)
    # Security emails (sign-up code, password reset) are left exactly as they
    # are: no tracking parameters on a one-time link.
    if cfg.get("utm", True) and kind not in NO_TRACKING:
        out = tag_links(out, kind)
    return out


# ------------------------------------------------------------ config + logging
_CACHE: dict = {"at": 0.0, "cfg": None}


def _db():
    from extensions import db  # late: extensions imports emailer lazily too
    return db


async def get_config(fresh: bool = False) -> dict:
    if not fresh and _CACHE["cfg"] is not None and time.monotonic() - _CACHE["at"] < 30:
        return _CACHE["cfg"]
    try:
        doc = await _db().email_manager.find_one({"key": "config"}, {"_id": 0}) or {}
        cfg = clean_cfg(doc.get("value") or {})
    except Exception:  # noqa: BLE001 — a config read must never stop an email
        logger.exception("email_manager: config read failed; using defaults")
        cfg = clean_cfg({})
    _CACHE.update(at=time.monotonic(), cfg=cfg)
    return cfg


async def save_config(raw: Any) -> dict:
    cfg = clean_cfg(raw)
    await _db().email_manager.update_one({"key": "config"}, {"$set": {"key": "config", "value": cfg}}, upsert=True)
    _CACHE.update(at=0.0, cfg=None)
    return cfg


_LOG_INDEXED = {"done": False}


async def log_send(kind: str, to: Any, subject: str, status: str) -> None:
    """One line per customer email. Kept 90 days (TTL index) — long enough to
    answer "did they get it?", short enough not to become a mailing list."""
    try:
        db = _db()
        if not _LOG_INDEXED["done"]:
            await db.email_log.create_index("at_dt", expireAfterSeconds=90 * 86400)
            await db.email_log.create_index([("kind", 1), ("at_dt", -1)])
            _LOG_INDEXED["done"] = True
        now = datetime.now(timezone.utc)
        rcpt = to if isinstance(to, str) else ", ".join(map(str, to or []))
        await db.email_log.insert_one({"kind": kind, "to": rcpt[:200], "subject": subject[:200], "status": status,
                                       "at": now.isoformat(), "at_dt": now})
    except Exception:  # noqa: BLE001
        logger.exception("email_manager: log write failed")


async def counts_30d() -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    out: dict = {}
    async for r in _db().email_log.aggregate([
            {"$match": {"at_dt": {"$gte": since}}},
            {"$group": {"_id": {"k": "$kind", "s": "$status"}, "n": {"$sum": 1}}}]):
        k, s = r["_id"]["k"], r["_id"]["s"]
        out.setdefault(k, {"sent": 0, "failed": 0, "skipped": 0})
        out[k][s if s in ("sent", "failed", "skipped") else "failed"] += r["n"]
    return out


# ------------------------------------------------------- recommendations block
async def recommendations_html(order: dict, limit: int = 3) -> str:
    """'Readers who chose these also read' — up to three in-stock titles from
    the same categories as the order, never one already bought. Empty when
    nothing fits (no padding with unrelated books)."""
    try:
        import emailer
        db = _db()
        items = order.get("items") or []
        bought = {str(i.get("book_id") or i.get("id") or "") for i in items}
        books = []
        ids = [b for b in bought if b]
        cats = set()
        if ids:
            async for b in db.books.find({"id": {"$in": ids}}, {"_id": 0, "category": 1}):
                if b.get("category"):
                    cats.add(b["category"])
        if not cats:
            return ""
        q = {"category": {"$in": list(cats)}, "enabled": {"$ne": False}, "stock": {"$gt": 0}, "id": {"$nin": ids}}
        async for b in db.books.find(q, {"_id": 0, "id": 1, "title": 1, "author": 1, "price": 1, "cover_image": 1}) \
                .sort([("bestseller", -1), ("publication_year", -1)]).limit(limit):
            books.append(b)
        if not books:
            return ""
        esc = _html.escape
        cells = []
        for b in books:
            url = f"{emailer.SITE_URL}/books/{b['id']}" if emailer.SITE_URL else "#"
            cover = emailer.media_url(b.get("cover_image"))
            img = (f'<img src="{esc(cover)}" alt="{esc(b.get("title") or "")}" width="96" '
                   f'style="width:96px;border:1px solid #E5E7EB;display:block;margin:0 auto 8px;">') if cover else ""
            cells.append(
                f'<td valign="top" width="33%" style="padding:0 6px;text-align:center;">'
                f'<a href="{esc(url)}" style="text-decoration:none;color:{NAVY};">{img}'
                f'<div style="font-family:Georgia,serif;font-size:13px;line-height:1.35;">{esc(b.get("title") or "")}</div>'
                f'<div style="font-size:11px;color:{GREY};margin-top:2px;">{esc(b.get("author") or "")}</div>'
                f'<div style="font-size:13px;margin-top:4px;">{emailer._money(b.get("price", 0))}</div></a></td>')
        return f"""
      <tr><td style="padding:24px 36px 0;">
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{GREY};">Readers who chose these also read</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;"><tr>{"".join(cells)}</tr></table>
      </td></tr>"""
    except Exception:  # noqa: BLE001 — a nice-to-have must never cost the email
        logger.exception("email_manager: recommendations failed")
        return ""


# ------------------------------------------------------------------ samples
def sample(kind: str) -> tuple[str, str, dict]:
    """(subject, html, ctx) for the admin preview — the real renderers fed
    with a made-up order, so what you preview is what customers get."""
    import emailer
    order = {
        "order_number": "OB-10482", "full_name": "Ananya Sharma", "email": "ananya@example.com",
        "items": [{"title": "Compulsory English 6/e", "quantity": 1, "price": 500},
                  {"title": "Practical Guide to the DPDP Act, 2023", "quantity": 1, "price": 895}],
        "subtotal": 1395, "shipping": 0, "total": 1395, "status": "paid", "rzp_payment_id": "pay_SAMPLE",
    }
    ctx = order_ctx(order)
    book = {"id": "sample", "title": "Compulsory English 6/e", "author": "A P Bhardwaj", "price": 500}
    R = {
        "otp": ("Your Oakbridge verification code", lambda: emailer.render_verification_otp_html("Ananya", "482913")),
        "welcome": ("Welcome to Oakbridge Publishing", lambda: emailer.render_account_welcome_html("Ananya Sharma")),
        "password_reset": ("Reset your Oakbridge password", lambda: emailer.render_password_reset_html("Ananya", "https://www.oakbridge.in/reset")),
        "receipt": ("Your Oakbridge order — OB-10482", lambda: emailer.render_order_receipt_html(order)),
        "payment_failed": ("Your payment didn't go through", lambda: emailer.render_order_failed_html({**order, "status": "failed"}, "")),
        "payment_link": ("Your Oakbridge order is waiting — OB-10482", lambda: emailer.render_payment_link_html(order, "https://rzp.io/sample")),
        "dispatched": ("Your Oakbridge order has been dispatched — OB-10482", lambda: emailer.render_order_dispatched_html({**order, "status": "shipped", "courier": "DTDC", "tracking_id": "D1234567890"}, "")),
        "status_update": ("Your Oakbridge order OB-10482 — processing", lambda: emailer.render_order_status_update_html({**order, "status": "processing"}, "")),
        "delivered": ("Your Oakbridge order OB-10482 — delivered", lambda: emailer.render_order_status_update_html({**order, "status": "delivered"}, "")),
        "cancelled": ("Your Oakbridge order OB-10482 was cancelled", lambda: emailer.render_order_cancelled_html({**order, "status": "cancelled"}, "")),
        "cart_reminder": ("Still deciding? Your books are saved", lambda: emailer.render_cart_reminder_html("Ananya", order["items"], "12h")),
        "stock_signup": ("We'll tell you when it's back", lambda: emailer.render_stock_signup_html(book)),
        "back_in_stock": ("Back in stock — Compulsory English 6/e", lambda: emailer.render_back_in_stock_html(book)),
        "contact_ack": ("We've received your message — Oakbridge Publishing",
                        lambda: emailer.render_contact_ack_html({"name": "Ananya Sharma", "message": "Do you ship to Pune?"})),
        "publishing_enquiry": (emailer.PUBLISHING_ENQUIRY_SUBJECT, lambda: emailer.render_publishing_enquiry_html()),
        "review_thanks": ("Thanks for your review", lambda: emailer.render_review_submitted_html("Ananya", "Compulsory English 6/e", 5)),
        "waitlist_welcome": ("Welcome — you're on the list", lambda: emailer.render_waitlist_welcome_html(emailer.WAITLIST_PROGRAMS["academy-waitlist"], "ananya@example.com")),
        "purchase_nudge": (emailer._NUDGE_SUBJECT, lambda: emailer.render_purchase_nudge_html("Ananya", [book])),
    }
    subj, fn = R[kind]
    return subj, fn(), ctx
