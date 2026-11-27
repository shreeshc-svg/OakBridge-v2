"""Keeping counts honest, and seeing reprints coming (Nov 2026).

    GET /api/admin/warehouse/count-today?n=10   the books to count today, and why
    GET /api/admin/warehouse/reprint            books that will run out soon at the recent pace

COUNT TODAY. A warehouse count drifts — a miscounted carton, a copy taken for
the office — and nobody notices until a website order can't be packed. Rather
than one big stock-take, a short list every day:
    1. never counted (the website can't sell what was never counted);
    2. below zero (the count is certainly wrong);
    3. website and shelf disagree;
    4. the busiest titles (most copies out in the last 90 days) not counted
       in the last 30 days — where a wrong number costs the most sales.
The list is a suggestion; the count itself is the Stock page's "Counted the
shelf" (warehouse_match.set_both), logged as always.

REPRINT SOON. Days of stock left = copies on the shelf ÷ the average copies
going out per day over the last 60 days. "Going out" is every movement out —
website orders, Amazon / Flipkart, dealer cartons, samples, damaged — because
every one of them has to be replaced; only count corrections are left out (a
miscount is not demand). Pre-orders and print-on-demand titles are excluded.

Read-only. Office side (Warehouse section), same as the Stock page.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from extensions import db, require_admin
from warehouse import _inventory_rows

router = APIRouter(prefix="/api/admin/warehouse", tags=["warehouse-admin"], dependencies=[Depends(require_admin)])

NOT_DEMAND = {"correction_out"}
RECOUNT_AFTER_DAYS = 30
BUSY_WINDOW_DAYS = 90
PACE_WINDOW_DAYS = 60


def _iso_days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


async def _out_by_book(days: int) -> dict:
    """{book_id: copies out in the last `days`} (corrections excluded)."""
    out: dict = {}
    async for m in db.stock_movements.find({"at": {"$gte": _iso_days_ago(days)}, "undone": {"$ne": True}, "qty": {"$lt": 0}},
                                           {"_id": 0, "book_id": 1, "qty": 1, "reason": 1}):
        if m.get("reason") in NOT_DEMAND:
            continue
        out[m["book_id"]] = out.get(m["book_id"], 0) + (-int(m.get("qty") or 0))
    return out


async def _last_counted() -> dict:
    """{book_id: ISO time of the last shelf count} (Save count / Set both / opening)."""
    last: dict = {}
    async for m in db.stock_movements.find({"undone": {"$ne": True}, "$or": [
            {"reason": "opening"}, {"note": {"$regex": "^Counted in Admin"}}]}, {"_id": 0, "book_id": 1, "at": 1}):
        if m.get("at") and m["at"] > last.get(m["book_id"], ""):
            last[m["book_id"]] = m["at"]
    return last


def pick_count_today(rows: list, busy: dict, last: dict, n: int, recount_iso: str) -> list:
    """Pure: the ordered list with a reason for each (tested directly)."""
    chosen, seen = [], set()

    def add(r, why):
        if r["id"] not in seen and len(chosen) < n:
            seen.add(r["id"])
            chosen.append({**r, "why": why, "last_counted": last.get(r["id"]), "out_90d": busy.get(r["id"], 0)})

    books = [r for r in rows if (r.get("kind") or "book") in ("book", "launched_empty")]
    for r in books:
        if r.get("wh_stock") is None:
            add(r, "Never counted")
    for r in sorted(books, key=lambda r: r.get("wh_stock") or 0):
        if (r.get("wh_stock") or 0) < 0:
            add(r, "Below zero")
    for r in books:
        if r.get("diff"):
            add(r, "Website and shelf disagree")
    for r in sorted(books, key=lambda r: -busy.get(r["id"], 0)):
        if busy.get(r["id"], 0) > 0 and (last.get(r["id"]) or "") < recount_iso:
            add(r, f"Busy title — {busy[r['id']]} out in 90 days, not counted in {RECOUNT_AFTER_DAYS} days")
    return chosen


def pick_reprint(rows: list, out60: dict, within_days: int) -> list:
    """Pure: books that run out within `within_days` at the 60-day pace."""
    res = []
    for r in rows:
        if (r.get("kind") or "book") not in ("book", "launched_empty"):
            continue
        out = out60.get(r["id"], 0)
        if out <= 0:
            continue
        per_day = out / PACE_WINDOW_DAYS
        shelf = max(0, int(r.get("wh_stock") or 0))
        days_left = int(shelf / per_day) if per_day else None
        if days_left is not None and days_left <= within_days:
            res.append({**r, "out_60d": out, "per_month": round(per_day * 30), "days_left": days_left})
    res.sort(key=lambda x: (x["days_left"], -x["out_60d"]))
    return res


@router.get("/count-today")
async def count_today(n: int = 10):
    rows, threshold, state = await _inventory_rows()
    picks = pick_count_today(rows, await _out_by_book(BUSY_WINDOW_DAYS), await _last_counted(), max(1, min(n, 50)),
                             _iso_days_ago(RECOUNT_AFTER_DAYS))
    return {"rows": picks, "threshold": threshold, "mode": state.get("mode")}


@router.get("/reprint")
async def reprint(within: int = 45):
    rows, threshold, state = await _inventory_rows()
    return {"rows": pick_reprint(rows, await _out_by_book(PACE_WINDOW_DAYS), max(1, min(within, 365))),
            "window_days": PACE_WINDOW_DAYS, "within": within, "mode": state.get("mode")}
