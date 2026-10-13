"""
Newsletter: schedule maths and issue assembly. Pure — no database, no clock of
its own — so it is unit-tested exactly (backend/tests/test_newsletter_core.py).

Times are India Standard Time (UTC+05:30, no daylight saving), because that
is when the admin means "Tuesday 10:30". Everything returned is UTC-aware.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30))
FREQUENCIES = ("weekly", "fortnightly", "monthly")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
ORDINALS = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}

DEFAULTS = {
    "enabled": False,
    "frequency": "monthly",       # weekly | fortnightly | monthly
    "weekday": 1,                 # 0 = Monday … 6 = Sunday
    "week_of_month": 1,           # monthly: 1st…4th <weekday> of the month
    "time": "10:30",              # IST
    "lead_days": 2,               # draft is built this many days before sending
    "mode": "approve",            # approve (admin approves each issue) | autopilot
    "audience": "all_subscribed",  # all_subscribed | newsletter_only
    "sections": {"new_releases": True, "bestsellers": True, "announcement": False},
    "max_books": 4,               # per section
    "min_items": 3,               # fewer books than this (and no announcement) -> skip the issue
    "subject": "New from Oakbridge — {month}",
    "preheader": "New releases, bestsellers and what's coming up.",
    "intro": "Hi {{first_name}}, here's what's new at Oakbridge this {period}.",
    "announcement": {"title": "", "text": "", "button_label": "", "button_url": ""},
}


def parse_time(s: str) -> tuple:
    m = re.fullmatch(r"\s*([01]?\d|2[0-3]):([0-5]\d)\s*", s or "")
    if not m:
        raise ValueError("time must be HH:MM (24-hour, IST)")
    return int(m.group(1)), int(m.group(2))


def validate(cfg: dict) -> dict:
    """Clean an admin's settings; raises ValueError with a readable message."""
    out = {**DEFAULTS, **{k: v for k, v in (cfg or {}).items() if k in DEFAULTS}}
    if out["frequency"] not in FREQUENCIES:
        raise ValueError("frequency must be weekly, fortnightly or monthly")
    out["weekday"] = int(out["weekday"])
    if not 0 <= out["weekday"] <= 6:
        raise ValueError("weekday must be 0 (Monday) to 6 (Sunday)")
    out["week_of_month"] = int(out["week_of_month"])
    if not 1 <= out["week_of_month"] <= 4:
        raise ValueError("week of month must be 1 to 4")
    parse_time(out["time"])
    out["lead_days"] = max(1, min(int(out["lead_days"]), 7))
    if out["mode"] not in ("approve", "autopilot"):
        raise ValueError("mode must be approve or autopilot")
    if out["audience"] not in ("all_subscribed", "newsletter_only"):
        raise ValueError("audience must be all_subscribed or newsletter_only")
    out["sections"] = {**DEFAULTS["sections"], **{k: bool(v) for k, v in (out.get("sections") or {}).items()
                                                  if k in DEFAULTS["sections"]}}
    out["max_books"] = max(1, min(int(out["max_books"]), 8))
    out["min_items"] = max(1, min(int(out["min_items"]), 10))
    out["announcement"] = {**DEFAULTS["announcement"], **{k: str(v or "")[:600] for k, v in (out.get("announcement") or {}).items()
                                                        if k in DEFAULTS["announcement"]}}
    for k in ("subject", "preheader", "intro"):
        out[k] = str(out[k] or DEFAULTS[k]).strip()[:300]
    return out


def _slot(day: datetime, hm: tuple) -> datetime:
    return datetime(day.year, day.month, day.day, hm[0], hm[1], tzinfo=IST).astimezone(timezone.utc)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> datetime:
    first = datetime(year, month, 1, tzinfo=IST)
    delta = (weekday - first.weekday()) % 7
    return first + timedelta(days=delta + 7 * (n - 1))


def next_slot(cfg: dict, after: datetime, last_slot: Optional[datetime] = None) -> datetime:
    """The first send time strictly after `after` (UTC-aware). Fortnightly
    counts from the previous issue's slot so the rhythm survives restarts."""
    hm = parse_time(cfg["time"])
    after = after.astimezone(timezone.utc)
    if cfg["frequency"] == "monthly":
        local = after.astimezone(IST)
        y, m = local.year, local.month
        for _ in range(3):
            cand = _slot(_nth_weekday(y, m, cfg["weekday"], cfg["week_of_month"]), hm)
            if cand > after:
                return cand
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        raise RuntimeError("no monthly slot found")  # unreachable
    if cfg["frequency"] == "fortnightly" and last_slot is not None:
        after = max(after, last_slot.astimezone(timezone.utc) + timedelta(days=13))
    local = after.astimezone(IST)
    delta = (cfg["weekday"] - local.weekday()) % 7
    cand = _slot(local + timedelta(days=delta), hm)
    if cand <= after:
        cand += timedelta(days=7)
    return cand


def describe(cfg: dict) -> str:
    day = WEEKDAYS[cfg["weekday"]]
    if cfg["frequency"] == "monthly":
        return f"Monthly — {ORDINALS[cfg['week_of_month']]} {day} at {cfg['time']} IST"
    return f"{'Weekly' if cfg['frequency'] == 'weekly' else 'Every two weeks'} — {day} at {cfg['time']} IST"


def period_word(cfg: dict) -> str:
    return {"weekly": "week", "fortnightly": "fortnight", "monthly": "month"}[cfg["frequency"]]


def book_block(b: dict, site: str, cover_base: str) -> dict:
    cover = b.get("cover_image") or ""
    if cover.startswith("/api/"):
        cover = cover_base.rstrip("/") + cover
    price = b.get("price")
    return {"type": "book", "book_id": b.get("id"), "title": b.get("title", ""), "author": b.get("author", ""),
            "price": f"₹{price:g}" if isinstance(price, (int, float)) and price else "",
            "cover": cover if cover.startswith("http") else "", "url": f"{site.rstrip('/')}/books/{b.get('id')}"}


def build_issue(cfg: dict, *, new_books: list, best_books: list, slot: datetime, site: str, cover_base: str) -> dict:
    """-> {subject, preheader, blocks, book_ids, counts, enough, reason}.
    `enough` is False when the issue would have nothing new: fewer than
    min_items books AND no announcement, or not a single new release and no
    announcement (we never resend the same bestseller list on its own)."""
    sec = cfg["sections"]
    month = slot.astimezone(IST).strftime("%B %Y")
    news = new_books[: cfg["max_books"]] if sec.get("new_releases") else []
    seen = {b.get("id") for b in news}
    best = [b for b in best_books if b.get("id") not in seen][: cfg["max_books"]] if sec.get("bestsellers") else []
    ann = cfg.get("announcement") or {}
    has_ann = bool(sec.get("announcement") and (ann.get("title") or ann.get("text")))
    blocks = [{"type": "heading", "text": cfg["subject"].replace("{month}", month)},
              {"type": "text", "text": cfg["intro"].replace("{period}", period_word(cfg)).replace("{month}", month)}]
    if has_ann:
        if ann.get("title"):
            blocks.append({"type": "heading", "text": ann["title"]})
        if ann.get("text"):
            blocks.append({"type": "text", "text": ann["text"]})
        if ann.get("button_label") and ann.get("button_url", "").startswith("https://"):
            blocks.append({"type": "button", "label": ann["button_label"], "url": ann["button_url"]})
        blocks.append({"type": "divider"})
    if news:
        blocks.append({"type": "heading", "text": "New releases"})
        blocks += [book_block(b, site, cover_base) for b in news]
        blocks.append({"type": "divider"})
    if best:
        blocks.append({"type": "heading", "text": "Readers' favourites"})
        blocks += [book_block(b, site, cover_base) for b in best]
        blocks.append({"type": "divider"})
    blocks.append({"type": "button", "label": "Browse the bookstore", "url": f"{site.rstrip('/')}/books"})
    counts = {"new_releases": len(news), "bestsellers": len(best), "announcement": int(has_ann)}
    enough, reason = True, ""
    if not news and not has_ann:
        enough, reason = False, "nothing new since the last issue (no new releases, no announcement)"
    elif len(news) + len(best) < cfg["min_items"] and not has_ann:
        enough, reason = False, f"only {len(news) + len(best)} books to show (minimum {cfg['min_items']})"
    return {"subject": cfg["subject"].replace("{month}", month), "preheader": cfg["preheader"], "blocks": blocks,
            "book_ids": [b.get("id") for b in news + best], "new_ids": [b.get("id") for b in news],
            "counts": counts, "enough": enough, "reason": reason}
