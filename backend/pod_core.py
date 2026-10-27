"""Print on Demand (POD) — the pure rules (no database, no web framework).

A title that is OUT OF STOCK can be ticked "Print on demand" in Admin → Books.
While it has no stock, customers can still buy it at its listed price; the
copy is printed for their order and dispatched in 5–7 WORKING days. Decided
with the business (Oct 2026):

  * Working days are Monday–Friday, minus the public holidays the office
    lists in Admin → Orders → POD holidays.
  * Cut-off 2 pm India time: an order paid before 2 pm on a working day starts
    that day; after 2 pm, or on a weekend/holiday, it starts on the next
    working day. Dispatch is then between start + 5 and start + 7 working days.
  * The tick only matters at zero stock: put copies on the shelf and the book
    sells normally again (the tick stays saved for next time). A pre-order is
    never POD — it is a different promise.
  * A cart with a POD book ships as ONE parcel when the POD copy is ready, so
    the whole order carries the 5–7 working-day dates.
  * No cancellation or return once paid, except damaged or misprinted copies;
    the customer confirms that at checkout.

frontend/src/lib/pod.js applies the same date rule (and is tested against the
same cases) so the dates on the page are the dates on the invoice.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

IST = timezone(timedelta(hours=5, minutes=30), "IST")
CUTOFF_HOUR = 14
MIN_DAYS = 5
MAX_DAYS = 7
MAX_QTY = 10          # per order, as pre-orders; bigger runs go through bulk enquiry


def pod_active(book: dict, preorder: bool = False) -> bool:
    """True when this title is sold as print-on-demand right now."""
    return bool(book.get("pod")) and int(book.get("stock") or 0) <= 0 and not preorder \
        and book.get("product_type") not in ("hamper",)


def _holidays(hs: Optional[Iterable]) -> set:
    out = set()
    for h in hs or []:
        d = h.get("date") if isinstance(h, dict) else h
        try:
            out.add(date.fromisoformat(str(d)[:10]))
        except ValueError:
            pass
    return out


def is_working_day(d: date, holidays: set) -> bool:
    return d.weekday() < 5 and d not in holidays


def add_working_days(d: date, n: int, holidays: set) -> date:
    while n > 0:
        d += timedelta(days=1)
        if is_working_day(d, holidays):
            n -= 1
    return d


def start_day(paid_at: datetime, holidays: set) -> date:
    """The working day printing starts: today before 2 pm IST on a working
    day, otherwise the next working day."""
    t = paid_at.astimezone(IST) if paid_at.tzinfo else paid_at.replace(tzinfo=timezone.utc).astimezone(IST)
    d = t.date()
    if is_working_day(d, holidays) and t.hour < CUTOFF_HOUR:
        return d
    d += timedelta(days=1)
    while not is_working_day(d, holidays):
        d += timedelta(days=1)
    return d


def dispatch_window(paid_at: datetime, holidays=None) -> tuple[date, date]:
    hs = _holidays(holidays)
    s = start_day(paid_at, hs)
    return add_working_days(s, MIN_DAYS, hs), add_working_days(s, MAX_DAYS, hs)


def clean_holidays(rows) -> tuple[list, list]:
    """Admin input -> sorted [{date, name}], plus problems."""
    out, errs, seen = [], [], set()
    for r in (rows or [])[:200]:
        d = str((r or {}).get("date") or "").strip()[:10]
        name = str((r or {}).get("name") or "").strip()[:60]
        try:
            dd = date.fromisoformat(d)
        except ValueError:
            errs.append(f"“{d or '(blank)'}” is not a date (use YYYY-MM-DD).")
            continue
        if dd in seen:
            continue
        seen.add(dd)
        out.append({"date": dd.isoformat(), "name": name})
    return sorted(out, key=lambda x: x["date"]), errs


def fmt_day(d: date) -> str:
    return d.strftime("%a %d %b").replace(" 0", " ")
