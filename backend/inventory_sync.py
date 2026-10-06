"""
Daily stock sync — Google Sheet (master) -> website.

Model: the Google Sheet is the source of truth. It's published to the web as a
CSV (a single stock tab), we fetch it, match each row to a book by ISBN, and set
books.stock to the sheet's value. Back-in-stock emails fire automatically when a
title crosses 0 -> available. The site's own live decrements protect against
overselling between syncs; each sync resets stock to the sheet's truth.

Config (environment variables):
- INVENTORY_SHEET_CSV_URL   published-to-web CSV url of the stock tab (required)
- INVENTORY_ISBN_COL        exact header for the ISBN column   (optional; auto-detected)
- INVENTORY_STOCK_COL       exact header for the quantity column (optional; auto-detected)
- TASK_TOKEN                shared secret for the daily cron endpoint

Endpoints:
- POST /api/admin/inventory/sync-from-sheet   (admin) — run a sync now
- POST /api/tasks/inventory-sync              (x-task-token) — daily cron target
- GET  /api/admin/inventory/sold-today        (admin) — units sold online today,
                                                to reconcile the master sheet
"""

from __future__ import annotations

import csv
import io
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Header, HTTPException

from extensions import db, require_admin, _notify_back_in_stock

log = logging.getLogger(__name__)

inventory_router = APIRouter(prefix="/api", tags=["inventory-sync"])

_ISBN_HEADERS = ("isbn13", "isbn_13", "isbn-13", "isbn")
_STOCK_HEADERS = ("stock", "quantity", "qty", "available", "on_hand", "onhand", "units")


def _norm_isbn(v: str) -> str:
    """Strip hyphens/spaces so 978-93-... matches 97893...."""
    return re.sub(r"[^0-9Xx]", "", v or "").upper()


def _pick_col(headers: list, wanted: tuple, override: Optional[str]) -> Optional[str]:
    if override:
        for h in headers:
            if h.strip().lower() == override.strip().lower():
                return h
    lowered = {h.strip().lower(): h for h in headers}
    for w in wanted:
        if w in lowered:
            return lowered[w]
    for h in headers:  # loose "contains" fallback
        hl = h.strip().lower()
        if any(w in hl for w in wanted):
            return h
    return None


async def sync_stock_from_sheet(csv_text: Optional[str] = None) -> dict:
    """Fetch the master sheet and reconcile books.stock to it. Returns a summary."""
    if csv_text is None:
        url = os.environ.get("INVENTORY_SHEET_CSV_URL")
        if not url:
            raise HTTPException(status_code=400, detail="INVENTORY_SHEET_CSV_URL is not configured")
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            csv_text = resp.text
        except requests.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Could not fetch the sheet: {e}")

    reader = csv.DictReader(io.StringIO(csv_text))
    headers = reader.fieldnames or []
    isbn_col = _pick_col(headers, _ISBN_HEADERS, os.environ.get("INVENTORY_ISBN_COL"))
    stock_col = _pick_col(headers, _STOCK_HEADERS, os.environ.get("INVENTORY_STOCK_COL"))
    if not isbn_col or not stock_col:
        raise HTTPException(
            status_code=400,
            detail=f"Could not find an ISBN and a stock column. Found headers: {headers}. "
                   f"Set INVENTORY_ISBN_COL / INVENTORY_STOCK_COL to the exact names.",
        )

    updated = 0
    restocked = 0
    invalid = 0
    unmatched: list = []
    for row in reader:
        isbn = _norm_isbn(row.get(isbn_col, ""))
        raw = (row.get(stock_col, "") or "").strip().replace(",", "")
        if not isbn:
            continue
        try:
            qty = max(0, int(float(raw)))
        except (ValueError, TypeError):
            invalid += 1
            continue
        book = await db.books.find_one({"isbn": isbn}, {"_id": 0, "id": 1, "stock": 1})
        if not book:
            unmatched.append(isbn)
            continue
        prev = int(book.get("stock", 0) or 0)
        if prev == qty:
            continue
        await db.books.update_one({"id": book["id"]}, {"$set": {"stock": qty}})
        updated += 1
        if prev <= 0 < qty:
            full = await db.books.find_one({"id": book["id"]}, {"_id": 0})
            if full:
                await _notify_back_in_stock(full)
            restocked += 1

    result = {
        "ok": True,
        "isbn_column": isbn_col,
        "stock_column": stock_col,
        "updated": updated,
        "restocked": restocked,
        "invalid_rows": invalid,
        "unmatched_count": len(unmatched),
        "unmatched_isbns": unmatched[:50],
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }
    log.info("inventory sync: updated=%s restocked=%s unmatched=%s invalid=%s",
             updated, restocked, len(unmatched), invalid)
    return result


@inventory_router.post("/admin/inventory/sync-from-sheet")
async def admin_sync_from_sheet(_: dict = Depends(require_admin)):
    """Run a stock sync from the master sheet right now (admin-triggered)."""
    return await sync_stock_from_sheet()


@inventory_router.post("/tasks/inventory-sync")
async def task_inventory_sync(x_task_token: Optional[str] = Header(None)):
    """Scheduled cron target. Protected by the shared TASK_TOKEN secret.

    Alerts on trouble, and only on trouble. Nobody is watching this run, so a
    silent failure means the site keeps selling from stock figures that stopped
    updating days ago — but a mail on every success trains the inbox to ignore
    the sender, and then the one that matters is missed too.

    Alerting lives HERE rather than in sync_stock_from_sheet() so that an admin
    pressing "Sync from sheet" and watching the result panel does not also
    generate an email about what they can already see.
    """
    from emailer import send_admin_inventory_alert

    token = os.environ.get("TASK_TOKEN")
    if not token or x_task_token != token:
        raise HTTPException(status_code=401, detail="Invalid task token")

    try:
        result = await sync_stock_from_sheet()
    except HTTPException as e:
        # The sheet was unreachable or unparseable. Tell someone, then re-raise
        # so the cron run is recorded as failed rather than quietly succeeding.
        await send_admin_inventory_alert({}, error=str(e.detail))
        raise
    except Exception as e:  # noqa: BLE001
        await send_admin_inventory_alert({}, error=f"Unexpected error: {e}")
        raise

    # Unmatched ISBNs are NOT a fault: the sheet tracks the full master list
    # while the site sells a deliberate subset, so a large unmatched count is
    # the normal steady state. Unreadable stock values are different — those
    # rows were skipped, so those titles are still on sale at a stale number.
    if int(result.get("invalid_rows") or 0) > 0:
        await send_admin_inventory_alert(result)

    return result


@inventory_router.get("/admin/inventory/sold-today")
async def admin_sold_today(_: dict = Depends(require_admin)):
    """Units sold online since UTC midnight, per title — to reconcile the master sheet."""
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    cursor = db.orders.find(
        {"payment_status": "paid", "created_at": {"$gte": start}},
        {"_id": 0, "items": 1},
    )
    tally: dict = {}
    async for o in cursor:
        for it in (o.get("items") or []):
            bid = it.get("book_id")
            qty = int(it.get("quantity", 0) or 0)
            if bid and qty:
                tally[bid] = tally.get(bid, 0) + qty
    rows = []
    for bid, qty in tally.items():
        b = await db.books.find_one({"id": bid}, {"_id": 0, "isbn": 1, "title": 1})
        rows.append({"isbn": (b or {}).get("isbn"), "title": (b or {}).get("title"), "units_sold": qty})
    rows.sort(key=lambda r: r["units_sold"], reverse=True)
    return {"since": start, "titles": len(rows), "rows": rows}
