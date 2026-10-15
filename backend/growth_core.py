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

CHANNELS = ["Partner", "Email", "WhatsApp", "Google Shopping", "Search (organic)", "Social", "Paid ads",
            "Referral sites", "Direct"]
_SEARCH = ("google.", "bing.", "duckduckgo.", "yahoo.", "yandex.", "ecosia.", "baidu.")
_SOCIAL = ("facebook.", "instagram.", "linkedin.", "lnkd.in", "t.co", "twitter.", "x.com", "youtube.",
           "youtu.be", "whatsapp.", "wa.me", "telegram.", "t.me", "reddit.", "quora.", "threads.")
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
    if med in ("email", "newsletter") or src == "email" or camp.startswith("mk-"):
        return "Email"
    if src == "google" and med in ("shopping", "merchant", "free_listing"):
        return "Google Shopping"
    if med in ("cpc", "ppc", "paid", "paid_social", "display", "ads"):
        return "Paid ads"
    if src in ("facebook", "instagram", "linkedin", "twitter", "x", "youtube", "telegram") or med == "social":
        return "Social"
    if src or med:
        return "Referral sites"
    host = referrer_host(a.get("referrer") or "")
    if host:
        if host.endswith("oakbridge.in"):
            return "Direct"
        if any(s in host for s in _SEARCH):
            return "Search (organic)"
        if any(s in host for s in _SOCIAL):
            return "Social"
        return "Referral sites"
    return "Direct"


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
        d = _dt(book["launch_at"])
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
