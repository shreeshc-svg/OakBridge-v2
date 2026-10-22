"""
Growth: where buyers come from, partner links, the Google Merchant feed and
the two automated emails — the pure decisions, no I/O (tested in
tests/test_growth_core.py). growth.py does the database and HTTP.

CHANNELS
Every visit (a cookie-free beacon, once per browser session) and every order
(its stored first-touch attribution) is put in exactly one channel, by the same
function, so "visits → checkouts → paid" lines up per channel. A partner code
(?ref=CODE on the link, or the code typed at checkout) wins over everything:
it is the most specific thing we know about who sent the buyer.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

CHANNELS = ["Partner", "Email", "WhatsApp", "Google Shopping", "Search (organic)", "AI assistants", "Social",
            "Paid ads", "Referral sites", "Direct"]

# Referring sites, matched by EXACT domain (the host itself or a subdomain of
# it) — never by substring. Substring matching was live until Oct 2026 and
# misfiled real traffic: "t.co" matched chatgpt.com and microsoft.com,
# "x.com" matched netflix.com, and "google." sent Gmail to Search.
# "android-app://com.google.android.gm" is what Android apps send as referrer;
# urlparse gives its package name as the host, so packages are listed too.
_EMAIL_HOSTS = ("mail.google.com", "com.google.android.gm", "outlook.live.com", "outlook.office.com",
                "outlook.office365.com", "com.microsoft.office.outlook", "mail.yahoo.com", "mail.zoho.com",
                "mail.zoho.in", "mail.rediffmail.com", "mail.proton.me", "mail.aol.com")
_WHATSAPP_HOSTS = ("whatsapp.com", "wa.me", "com.whatsapp", "com.whatsapp.w4b")
_AI_HOSTS = ("chatgpt.com", "chat.openai.com", "openai.com", "perplexity.ai", "gemini.google.com", "bard.google.com",
             "copilot.microsoft.com", "claude.ai", "you.com", "phind.com", "meta.ai", "chat.deepseek.com", "grok.com")
_SEARCH_HOSTS = ("bing.com", "duckduckgo.com", "search.yahoo.com", "yahoo.com", "yandex.ru", "yandex.com",
                 "ecosia.org", "baidu.com", "search.brave.com", "startpage.com", "com.google.android.googlequicksearchbox")
# google.com / google.co.in / google.com.au … only — docs.google.com,
# mail.google.com and gemini.google.com are not search (www. is stripped).
_GOOGLE_SEARCH_RE = re.compile(r"^google\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$")
_SOCIAL_HOSTS = ("facebook.com", "fb.com", "fb.me", "instagram.com", "linkedin.com", "lnkd.in", "t.co", "twitter.com",
                 "x.com", "youtube.com", "youtu.be", "telegram.org", "t.me", "reddit.com", "quora.com", "threads.net",
                 "pinterest.com", "pin.it", "snapchat.com", "com.linkedin.android", "com.instagram.android",
                 "com.facebook.katana", "com.twitter.android", "com.google.android.youtube")
# utm_source values that name a source rather than a medium.
_AI_SOURCES = ("chatgpt.com", "chatgpt", "openai", "perplexity", "perplexity.ai", "gemini", "copilot", "claude", "claude.ai")
_SOCIAL_SOURCES = ("facebook", "instagram", "linkedin", "twitter", "x", "youtube", "telegram", "fb", "ig", "threads",
                   "pinterest", "reddit", "quora")
# In-app browsers drop the referrer, so a tap on a link inside Instagram
# arrives looking "Direct". Their user agent still says which app it is.
_INAPP_RE = re.compile(r"\b(Instagram|FBAN|FBAV|FB_IAB|LinkedInApp|Snapchat|Pinterest|Twitter|musical_ly|Line/)", re.I)


def _host_in(host: str, domains) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def in_app(user_agent: str) -> str:
    """'social' when the UA is a social app's in-app browser, else ''."""
    return "social" if _INAPP_RE.search(user_agent or "") else ""
_BOT_RE = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse|puppeteer|prerender|preview|facebookexternalhit|"
                     r"whatsapp/|monitor|pingdom|uptime|curl|wget|python-requests|httpclient", re.I)
PARTNER_KINDS = {"author": "Author", "educator": "Educator / teacher", "institution": "Coaching / university",
                 "dealer": "Dealer / bookshop", "other": "Other"}
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,23}$")


def is_bot(user_agent: str) -> bool:
    """Crawlers, link previews and our own prerenderer must not count as visits."""
    ua = user_agent or ""
    return not ua or bool(_BOT_RE.search(ua))


def norm_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (code or "").strip().upper())[:24]


def referrer_host(ref: str) -> str:
    try:
        h = (urlparse(ref or "").hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def channel_of(attr: Optional[dict], coupon_code: str = "", partner_codes: Optional[set] = None) -> str:
    """One channel for a visit or an order.

    attr: {utm_source, utm_medium, utm_campaign, ref, referrer} (any may be missing).
    coupon_code: the order's coupon, if any — a partner's code counts as the partner.
    """
    a = attr or {}
    codes = partner_codes or set()
    ref = norm_code(a.get("ref") or "")
    if (ref and ref in codes) or (coupon_code and norm_code(coupon_code) in codes):
        return "Partner"
    src = (a.get("utm_source") or "").lower()
    med = (a.get("utm_medium") or "").lower()
    camp = (a.get("utm_campaign") or "").lower()
    if src == "whatsapp" or med == "whatsapp":
        return "WhatsApp"
    if med in ("email", "newsletter") or src in ("email", "newsletter", "gmail") or camp.startswith("mk-"):
        return "Email"
    if src == "google" and med in ("shopping", "merchant", "free_listing"):
        return "Google Shopping"
    if med in ("cpc", "ppc", "paid", "paid_social", "display", "ads"):
        return "Paid ads"
    if src in _AI_SOURCES:
        return "AI assistants"
    if src in _SOCIAL_SOURCES or med == "social":
        return "Social"
    if src or med:
        return "Referral sites"
    host = referrer_host(a.get("referrer") or "")
    if host:
        if _host_in(host, ("oakbridge.in",)):
            return "Direct"
        if _host_in(host, _EMAIL_HOSTS):
            return "Email"
        if _host_in(host, _WHATSAPP_HOSTS):
            return "WhatsApp"
        if _host_in(host, _AI_HOSTS):
            return "AI assistants"
        if _GOOGLE_SEARCH_RE.match(host) or _host_in(host, _SEARCH_HOSTS):
            return "Search (organic)"
        if _host_in(host, _SOCIAL_HOSTS):
            return "Social"
        return "Referral sites"
    # No referrer and no tags — but an Instagram/Facebook/LinkedIn in-app
    # browser still says so in its user agent (sent as "in_app").
    if (a.get("in_app") or "") == "social":
        return "Social"
    return "Direct"


_TABLET_RE = re.compile(r"iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))", re.I)
_MOBILE_RE = re.compile(r"Mobi|iPhone|iPod|Android.*Mobile|Opera Mini|IEMobile", re.I)


def device_of(user_agent: str) -> str:
    ua = user_agent or ""
    if _TABLET_RE.search(ua):
        return "Tablet"
    if _MOBILE_RE.search(ua):
        return "Mobile"
    return "Desktop"


def landing_key(path: str) -> str:
    """A landing page, tidy enough to group: no query string, no trailing
    slash, capped. Book pages keep their id — which book brought people in is
    the point."""
    p = (path or "/").split("?")[0].split("#")[0].strip()[:80] or "/"
    if not p.startswith("/"):
        p = "/" + p
    return p.rstrip("/") or "/"


STEPS = ("view_item", "add_to_cart", "checkout", "payment")
STEP_LABELS = {"visit": "Visited", "view_item": "Viewed a book", "add_to_cart": "Added to cart",
               "checkout": "Opened checkout", "payment": "Opened payment", "paid": "Paid"}


def ip_in(ip: str, nets: list) -> bool:
    """Is this address one of the office networks? Addresses are compared,
    never stored."""
    import ipaddress
    try:
        a = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return False
    for n in nets or []:
        try:
            if a in ipaddress.ip_network(str(n).strip(), strict=False):
                return True
        except ValueError:
            continue
    return False


def clean_nets(raw) -> list:
    """Admin-typed office IPs / CIDR ranges -> the valid ones, normalised, max 20."""
    import ipaddress
    out = []
    items = raw if isinstance(raw, list) else re.split(r"[\s,;]+", str(raw or ""))
    for x in items:
        x = str(x).strip()
        if not x:
            continue
        try:
            out.append(str(ipaddress.ip_network(x, strict=False)))
        except ValueError:
            continue
        if len(out) >= 20:
            break
    return out


def funnel_rows(visits: dict, orders: list) -> list:
    """visits: {channel: n}; orders: [{channel, paid: bool, total}] ->
    one row per channel with visits, checkouts, paid, revenue and rates."""
    rows = {c: {"channel": c, "visits": 0, "checkouts": 0, "paid": 0, "revenue": 0.0} for c in CHANNELS}
    for c, n in (visits or {}).items():
        rows.setdefault(c, {"channel": c, "visits": 0, "checkouts": 0, "paid": 0, "revenue": 0.0})["visits"] += int(n)
    for o in orders or []:
        r = rows.setdefault(o["channel"], {"channel": o["channel"], "visits": 0, "checkouts": 0, "paid": 0, "revenue": 0.0})
        r["checkouts"] += 1
        if o.get("paid"):
            r["paid"] += 1
            r["revenue"] += float(o.get("total") or 0)
    out = []
    for r in rows.values():
        r["revenue"] = round(r["revenue"], 2)
        r["visit_to_paid"] = round(r["paid"] / r["visits"], 4) if r["visits"] else None
        r["checkout_to_paid"] = round(r["paid"] / r["checkouts"], 4) if r["checkouts"] else None
        out.append(r)
    out.sort(key=lambda r: (-r["paid"], -r["visits"], CHANNELS.index(r["channel"]) if r["channel"] in CHANNELS else 99))
    return out


# ---------------------------------------------------------- automations ---
def _dt(s) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def abandoned_due(order: dict, now: datetime, delay_hours: float, window_hours: float = 48) -> bool:
    """An order that reached checkout, was not paid, and is old enough for a
    reminder but not so old that a reminder is odd. One per order."""
    if order.get("payment_status") == "paid" or order.get("abandoned_email_at") or not order.get("email"):
        return False
    if (order.get("status") or "") == "cancelled":
        return False
    at = _dt(order.get("created_at"))
    if not at:
        return False
    age = now - at
    return timedelta(hours=delay_hours) <= age <= timedelta(hours=window_hours)


def delivered_at(order: dict) -> Optional[datetime]:
    """When the order was marked delivered (last such status change)."""
    best = None
    for h in order.get("status_history") or []:
        if (h.get("status") or "") == "delivered":
            d = _dt(h.get("at"))
            if d and (best is None or d > best):
                best = d
    return best


def review_due(order: dict, now: datetime, days: int) -> bool:
    if order.get("payment_status") != "paid" or order.get("review_email_at") or not order.get("email"):
        return False
    if (order.get("status") or "") != "delivered":
        return False
    d = delivered_at(order)
    return bool(d) and now - d >= timedelta(days=days) and now - d <= timedelta(days=days + 30)


# --------------------------------------------------------- merchant feed ---
def _isbn13_ok(s: str) -> bool:
    s = re.sub(r"[^0-9]", "", s or "")
    if len(s) != 13:
        return False
    t = sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(s[:12]))
    return (10 - t % 10) % 10 == int(s[12])


def _plain(text: str, limit: int = 5000) -> str:
    t = re.sub(r"<[^>]+>", " ", text or "")
    t = re.sub(r"[*_`#>]+", "", t)
    return re.sub(r"\s+", " ", t).strip()[:limit]


def merchant_item(book: dict, *, site: str, image_url: str) -> Optional[dict]:
    """One Google Merchant Center item, or None when the book can't be listed
    (no price, no image, hidden). Prices are what the site charges now;
    original_price above it is sent as the regular price with a sale_price."""
    if book.get("enabled") is False or not image_url:
        return None
    price = float(book.get("price") or 0)
    if price <= 0:
        return None
    mrp = float(book.get("original_price") or 0)
    if book.get("coming_soon"):
        availability = "preorder"
    else:
        availability = "in_stock" if int(book.get("stock") or 0) > 0 else "out_of_stock"
    isbn = re.sub(r"[^0-9Xx]", "", book.get("isbn") or "")
    item = {
        "id": isbn or book["id"],
        "title": _plain((book.get("title") or "") + (f" by {book['author'].strip()}" if (book.get("author") or "").strip() and book.get("product_type") != "hamper" else ""), 150),
        "description": _plain(book.get("description") or book.get("title") or ""),
        "link": f"{site}/books/{book['id']}?utm_source=google&utm_medium=shopping&utm_campaign=merchant",
        "image_link": image_url,
        "availability": availability,
        "price": f"{(mrp if mrp > price else price):.2f} INR",
        "brand": (book.get("publisher") or "Oakbridge Publishing").strip(),
        "condition": "new",
        "google_product_category": "784",   # Media > Books
        "product_type": (book.get("category") or "Books").strip(),
    }
    if mrp > price:
        item["sale_price"] = f"{price:.2f} INR"
    if _isbn13_ok(isbn):
        item["gtin"] = isbn
    else:
        item["identifier_exists"] = "no"
    if availability == "preorder" and book.get("launch_at"):
        # Not _dt: a time typed in Admin is India time, not UTC (launch_time.py).
        from launch_time import parse_launch_at

        d = parse_launch_at(book["launch_at"])
        if d:
            item["availability_date"] = d.isoformat()
    return item


def feed_xml(items: list, *, site: str) -> str:
    """RSS 2.0 with the g: namespace — the format Merchant Center fetches."""
    def x(v):
        return html.escape(str(v), quote=False)
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>',
             f"<title>Oakbridge Publishing</title><link>{x(site)}</link>"
             "<description>Books from Oakbridge Publishing</description>"]
    for it in items:
        parts.append("<item>")
        for k in ("title", "description", "link"):
            parts.append(f"<{k}>{x(it[k])}</{k}>")
        for k, v in it.items():
            if k in ("title", "description", "link"):
                continue
            parts.append(f"<g:{k}>{x(v)}</g:{k}>")
        parts.append("</item>")
    parts.append("</channel></rss>")
    return "".join(parts)
