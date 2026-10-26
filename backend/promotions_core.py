"""Festive promotions — the pure rules (no database, no web framework).

Admin → Coupons & Promotions lets the office switch on a store-wide offer for
an occasion ("Diwali Sale — 10% off every book, up to ₹500, on orders over
₹999", 28 Oct 00:00 → 3 Nov 23:59 IST). Decisions taken with the business
(Oct 2026):

  * TAKEN OFF AT THE CART, not by changing book prices. Book prices, the
    Google Merchant feed and per-line invoice rates stay exactly as they are;
    the order carries one discount line named after the occasion. Changing
    every price would ripple into the feed, invoices and GST for a week-long
    offer.
  * BETTER OF THE TWO with a coupon — never both. The customer gets whichever
    saves more, decided on the server at order time (the browser's figure is
    only a preview). A tie goes to the promotion, so a coupon's limited uses
    aren't spent for nothing.
  * ALL BOOKS AND PACKS. Gift hampers are excluded (already priced as offers)
    and so are live pre-orders (sold before they exist). Their value does not
    earn a discount, but does count towards the minimum order.
  * Start and end are India time; a date without a time means the whole day
    (start 00:00, end 23:59:59 IST). Only one promotion can be live at a time —
    overlapping active promotions are refused when saved, so "which offer
    applies" never has two answers.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30), "IST")
EXCLUDED_TYPES = ("hamper",)
MAX_PERCENT = 90
MAX_FLAT = 100000


def _txt(v, n: int) -> str:
    s = re.sub(r"[\x00-\x1f\x7f<>]", "", str(v or ""))
    return re.sub(r"\s+", " ", s).strip()[:n]


def parse_when(raw, end: bool = False) -> Optional[datetime]:
    """'2026-10-28T00:00' (India time) / '2026-10-28' (the whole day) / an
    ISO time with an offset -> an aware datetime, or None."""
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is not None:
        return d
    if len(s) <= 10:   # a bare date: the start or the end of that day in India
        d = d.replace(hour=23, minute=59, second=59) if end else d
    return d.replace(tzinfo=IST)


def clean(p: dict) -> tuple[dict, list]:
    """Admin input -> stored promotion, plus problems in plain words."""
    errs = []
    kind = p.get("kind") if p.get("kind") in ("percent", "flat") else ""
    try:
        value = float(p.get("value") or 0)
    except (TypeError, ValueError):
        value = 0.0
    try:
        cap = float(p.get("max_discount") or 0)
    except (TypeError, ValueError):
        cap = 0.0
    try:
        min_order = float(p.get("min_order") or 0)
    except (TypeError, ValueError):
        min_order = 0.0
    doc = {
        "label": _txt(p.get("label"), 40),
        "message": _txt(p.get("message"), 140),
        "kind": kind, "value": round(value, 2),
        "max_discount": round(max(cap, 0), 2) if kind == "percent" else 0,
        "min_order": round(max(min_order, 0), 2),
        "starts_at": _txt(p.get("starts_at"), 32), "ends_at": _txt(p.get("ends_at"), 32),
        "active": bool(p.get("active", True)), "banner": bool(p.get("banner", True)),
    }
    if not doc["label"]:
        errs.append("Give the occasion a name, e.g. “Diwali Sale”.")
    if not kind:
        errs.append("Choose % off or flat ₹ off.")
    elif kind == "percent" and not (0 < value <= MAX_PERCENT):
        errs.append(f"The percentage must be between 1 and {MAX_PERCENT}.")
    elif kind == "flat" and not (0 < value <= MAX_FLAT):
        errs.append("Enter the rupees off.")
    if kind == "flat" and doc["min_order"] and value >= doc["min_order"]:
        errs.append("A flat amount off should be smaller than the minimum order.")
    a, b = parse_when(doc["starts_at"]), parse_when(doc["ends_at"], end=True)
    if not a or not b:
        errs.append("Set when the offer starts and ends.")
    elif b <= a:
        errs.append("The end must be after the start.")
    return doc, errs


def window(p: dict) -> tuple[Optional[datetime], Optional[datetime]]:
    return parse_when(p.get("starts_at")), parse_when(p.get("ends_at"), end=True)


def is_live(p: Optional[dict], now: datetime) -> bool:
    if not p or not p.get("active"):
        return False
    a, b = window(p)
    return bool(a and b and a <= now <= b)


def status(p: dict, now: datetime) -> str:
    a, b = window(p)
    if not p.get("active"):
        return "off"
    if b and now > b:
        return "ended"
    if a and now < a:
        return "scheduled"
    return "live" if is_live(p, now) else "off"


def overlaps(a: dict, b: dict) -> bool:
    """Two ACTIVE promotions whose windows share any moment."""
    if not (a.get("active") and b.get("active")):
        return False
    a1, a2 = window(a)
    b1, b2 = window(b)
    return bool(a1 and a2 and b1 and b2 and a1 <= b2 and b1 <= a2)


def eligible_subtotal(items: list) -> float:
    """items: [{price, quantity, product_type, preorder}] — hampers and live
    pre-orders don't earn the festive discount."""
    return round(sum(float(i.get("price") or 0) * int(i.get("quantity") or 0) for i in items
                     if (i.get("product_type") or "book") not in EXCLUDED_TYPES and not i.get("preorder")), 2)


def discount(p: Optional[dict], eligible: float, subtotal: float) -> float:
    """Rupees off for this cart (0 when not reached). Whole rupees, never more
    than the eligible books are worth."""
    if not p or eligible <= 0:
        return 0.0
    if subtotal < float(p.get("min_order") or 0):
        return 0.0
    if p["kind"] == "percent":
        d = round(eligible * float(p["value"]) / 100.0)
        cap = float(p.get("max_discount") or 0)
        if cap > 0:
            d = min(d, cap)
    else:
        d = float(p["value"])
    return float(min(d, eligible))


def choose(promo_off: float, coupon_off: float) -> str:
    """'promo', 'coupon' or '' — the better of the two, never both. A tie
    goes to the promotion so a coupon's limited uses aren't spent for nothing."""
    if promo_off <= 0 and coupon_off <= 0:
        return ""
    return "promo" if promo_off >= coupon_off else "coupon"


def offer_text(p: dict) -> str:
    """'10% off every book, up to ₹500, on orders over ₹999' — one sentence,
    the same on the banner, the book page and the cart."""
    if p["kind"] == "percent":
        s = f"{p['value']:g}% off every book"
        if p.get("max_discount"):
            s += f", up to ₹{p['max_discount']:,.0f}"
    else:
        s = f"₹{p['value']:,.0f} off your order"
    if p.get("min_order"):
        s += f" on orders over ₹{p['min_order']:,.0f}"
    return s


def public_view(p: dict) -> dict:
    """What the storefront may see — no internal fields."""
    return {"id": p.get("id"), "label": p["label"], "message": p.get("message") or "", "kind": p["kind"],
            "value": p["value"], "max_discount": p.get("max_discount") or 0, "min_order": p.get("min_order") or 0,
            "ends_at": (window(p)[1] or datetime.now(timezone.utc)).isoformat(), "banner": bool(p.get("banner")),
            "offer": offer_text(p)}
