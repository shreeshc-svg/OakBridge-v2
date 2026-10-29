"""Amazon Easy Ship — the rules, pure (no network, no DB). Oct 2026.

Oakbridge sells its OWN copies on Amazon.in through Seller Central with Easy
Ship: we pick and pack from our shelf, Amazon collects and delivers. So one
pool of copies is sold in two shops (oakbridge.in and Amazon), and two things
must stay true:

  1. Amazon never shows more copies than we can pack     -> target_qty / push_plan
  2. An Amazon order takes its copies off our stock once  -> order_step

Everything here is deterministic and unit-tested (tests/test_amazon_easyship.py);
amazon_easyship.py only moves data between these rules, Amazon and MongoDB.
"""
from __future__ import annotations

import csv
import io
from typing import Optional

DEFAULT_BUFFER = 2          # copies held back from Amazon to cover the 15-min gap between the shops
MAX_BUFFER = 50
MAX_PUSH_QTY = 9999


# ----------------------------------------------------------- listings ---
def _int_or_none(v) -> Optional[int]:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def parse_listings_report(text: str) -> list:
    """GET_MERCHANT_LISTINGS_ALL_DATA (tab-separated, header row) -> rows.

    channel: "mfn" when fulfillment-channel is DEFAULT (we ship: Easy Ship /
    self-ship), "afn" for Fulfilment by Amazon (AMAZON_IN etc.). Amazon shows
    "--"/blank quantity for an offer with no quantity set: qty None.
    Column names are read from the header (Amazon adds/reorders columns)."""
    rows = []
    rd = csv.DictReader(io.StringIO(text.lstrip("﻿")), delimiter="\t")
    for r in rd:
        r = {str(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        sku = r.get("seller-sku") or r.get("sku") or ""
        if not sku:
            continue
        ch = (r.get("fulfillment-channel") or r.get("fulfilment-channel") or "DEFAULT").upper()
        rows.append({
            "sku": sku[:80],
            "asin": (r.get("asin1") or r.get("asin") or "")[:20],
            "title": (r.get("item-name") or "")[:200],
            "qty": _int_or_none(r.get("quantity")),
            "price": r.get("price") or "",
            "status": r.get("status") or "",
            "channel": "mfn" if ch in ("DEFAULT", "MERCHANT", "MFN") else "afn",
            "product_id": r.get("product-id") or "",
        })
    return rows


def clean_buffer(v) -> int:
    n = _int_or_none(v)
    return DEFAULT_BUFFER if n is None else max(0, min(MAX_BUFFER, n))


def target_qty(book: Optional[dict], buffer: int) -> tuple[int, str]:
    """How many copies Amazon should offer for this book, and why.

    0 for anything we cannot pack today: missing/hidden books, hampers and
    packs (assembled to order on our site), pre-orders (not printed yet),
    print-on-demand titles with no copies (Easy Ship needs a 1-2 day
    dispatch; POD is 5-7 working days). Otherwise website stock minus the
    buffer — website stock already has every paid oakbridge.in order and every
    Amazon order (order_step) taken off it."""
    if not book:
        return 0, "book not found"
    if book.get("enabled") is False:
        return 0, "hidden on our site"
    if book.get("product_type") in ("hamper", "pack"):
        return 0, "hamper / pack"
    if book.get("coming_soon"):
        return 0, "pre-order"
    stock = int(book.get("stock") or 0)
    if stock <= 0:
        return 0, "print on demand — no copies" if book.get("pod") else "out of stock"
    q = max(0, min(MAX_PUSH_QTY, stock - max(0, int(buffer))))
    return q, (f"stock {stock} − buffer {buffer}" if q else f"only {stock} left — held for the website (buffer {buffer})")


def push_plan(listings: list, books: dict, buffer: int, no_push: set) -> list:
    """One line per linked Easy Ship listing: what Amazon has, what it will be
    set to, and whether a push is needed. FBA listings are never touched
    (Amazon's warehouse stock is not ours to set); unlinked SKUs are skipped."""
    plan = []
    for l in listings:
        if l.get("channel") != "mfn" or l.get("gone"):
            continue
        bid = l.get("book_id")
        line = {"sku": l["sku"], "book_id": bid, "title": l.get("title", ""), "amazon_qty": l.get("qty"),
                "last_pushed": l.get("pushed_qty"), "status": l.get("status", "")}
        if not bid:
            plan.append({**line, "target": None, "push": False, "why": "not linked to a book"})
            continue
        if l["sku"] in no_push:
            plan.append({**line, "target": None, "push": False, "why": "sync switched off for this SKU"})
            continue
        q, why = target_qty(books.get(bid), buffer)
        known = l.get("pushed_qty") if l.get("pushed_qty") is not None else l.get("qty")
        plan.append({**line, "target": q, "push": known != q, "why": why})
    return plan


# ------------------------------------------------------------- orders ---
CANCELLED = {"Canceled", "Cancelled"}


def order_step(stage: str, status: str) -> str:
    """What to do with one Amazon order now. Stages only move forward, so a
    re-run (or two workers) can never take the same copies twice:

        new ──take──▶ taken ──restore──▶ restored
         └──(cancelled before we saw it)──▶ skipped

    Pending orders are taken too: Amazon already holds the copy for a Pending
    order, and our site must not sell it in the meantime."""
    cancelled = status in CANCELLED
    if stage == "new":
        return "skip" if cancelled else "take"
    if stage == "taken" and cancelled:
        return "restore"
    return "none"


def order_lines(items: list, sku_to_book: dict) -> list:
    """Amazon order items -> [{sku, book_id, qty}] (unlinked SKUs keep book_id None
    and are shown to staff instead of silently ignored)."""
    out = []
    for it in items or []:
        sku = str(it.get("SellerSKU") or "")[:80]
        q = _int_or_none(it.get("QuantityOrdered")) or 0
        if not sku or q <= 0:
            continue
        out.append({"sku": sku, "book_id": sku_to_book.get(sku), "qty": q,
                    "title": str(it.get("Title") or "")[:200]})
    return out
