"""
Pure logic for the Zoho Inventory link — no I/O and no imports from the app.

Kept apart from zoho_inventory.py so the decisions that move real stock can be
tested without FastAPI, Motor or a Zoho account: which Zoho field counts as
"available", how a Zoho item is matched to a book, which books a sync may touch,
and what a sales order looks like. zoho_inventory.py does the talking; this
file decides what the talking means.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

MODES = ("test", "live")
DEFAULT_PULL_MINUTES = 15

# Which Zoho number becomes the website's stock, in order of preference.
#
# The website must sell only what is actually free to sell, which is stock on
# hand MINUS copies already promised to confirmed sales orders. Zoho exposes
# that as "actual_available_stock" (physical) and "available_stock"
# (accounting); stock_on_hand alone would let the site resell copies that a
# confirmed website order is waiting to ship. stock_on_hand is the last resort
# only, for a plan or item type that returns nothing else — and the sync result
# records WHICH field was used, so a fallback is visible, not silent.
AVAILABLE_FIELDS = ("actual_available_stock", "available_stock", "stock_on_hand")


def norm_isbn(value) -> str:
    """'978-93-95764-54-4' and 9789395764544.0 both become '9789395764544'."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"[^0-9Xx]", "", str(value)).upper()


def zoho_available(item: dict) -> tuple[Optional[int], Optional[str]]:
    """(units free to sell, field it came from) — or (None, None) if Zoho sent none."""
    for field in AVAILABLE_FIELDS:
        raw = item.get(field)
        if raw in (None, ""):
            continue
        try:
            return max(0, int(float(raw))), field
        except (TypeError, ValueError):
            continue
    return None, None


def item_key(item: dict) -> str:
    """The ISBN a Zoho item stands for. SKU first: the import set SKU = ISBN."""
    return norm_isbn(item.get("sku")) or norm_isbn(item.get("isbn"))


def plan_stock_changes(
    books: Iterable[dict],
    zoho_items: Iterable[dict],
    skip_book_ids: Iterable[str] = (),
) -> dict:
    """What a pull from Zoho would do. Changes nothing; the caller applies it.

    books           [{id, isbn, stock, zoho_item_id?, title?}]
    zoho_items      Zoho /items rows
    skip_book_ids   books with a website order still on its way to Zoho. Zoho
                    has not seen that sale yet, so its number is HIGHER than the
                    truth; copying it would put sold copies back on sale.
    """
    skip = set(skip_book_ids)
    by_isbn: dict[str, dict] = {}
    duplicate_skus: list[str] = []
    for it in zoho_items:
        key = item_key(it)
        if not key:
            continue
        if key in by_isbn:
            duplicate_skus.append(key)
            continue
        by_isbn[key] = it

    changes, mappings, skipped_pending, unmapped_books, no_stock_field = [], [], [], [], []
    fields_used: dict[str, int] = {}
    matched: set[str] = set()
    for b in books:
        isbn = norm_isbn(b.get("isbn"))
        it = by_isbn.get(isbn)
        if not it:
            unmapped_books.append(isbn or b.get("id"))
            continue
        matched.add(isbn)
        item_id = str(it.get("item_id") or "")
        if item_id and item_id != str(b.get("zoho_item_id") or ""):
            mappings.append({"book_id": b["id"], "zoho_item_id": item_id})
        qty, field = zoho_available(it)
        if qty is None:
            no_stock_field.append(isbn)
            continue
        fields_used[field] = fields_used.get(field, 0) + 1
        if b["id"] in skip:
            skipped_pending.append(isbn)
            continue
        prev = int(b.get("stock") or 0)
        if prev != qty:
            changes.append({
                "book_id": b["id"], "isbn": isbn, "title": (b.get("title") or "")[:80],
                "from": prev, "to": qty,
            })

    unmatched_zoho = sorted(k for k in by_isbn if k not in matched)
    return {
        "changes": changes,
        "mappings": mappings,
        "skipped_pending": skipped_pending,
        "unmapped_books": unmapped_books,
        "unmatched_zoho": unmatched_zoho,
        "duplicate_skus": duplicate_skus,
        "no_stock_field": no_stock_field,
        "fields_used": fields_used,
    }


def build_salesorder(
    order_number: str,
    date: str,
    customer_id: str,
    lines: Iterable[dict],
    zoho_ids: dict,
) -> tuple[Optional[dict], list]:
    """Zoho sales-order body for a website order, plus the lines it had to drop.

    lines     [{book_id, qty, rate}] — hamper contents already expanded
    zoho_ids  book_id -> Zoho item_id

    A line with no Zoho item (a hamper or pack wrapper, a title never imported)
    is dropped and reported rather than failing the whole order: the copies
    that ARE in Zoho still have to be committed, or Zoho over-reports stock.
    The same book on two lines (bought alone and inside a hamper) is merged,
    because Zoho commits per item and two lines would read as two products.
    """
    merged: dict[str, dict] = {}
    missing: list = []
    for ln in lines:
        bid, qty = ln.get("book_id"), int(ln.get("qty") or 0)
        if not bid or qty <= 0:
            continue
        zid = zoho_ids.get(bid)
        if not zid:
            missing.append(bid)
            continue
        row = merged.setdefault(zid, {"item_id": zid, "quantity": 0, "rate": float(ln.get("rate") or 0)})
        row["quantity"] += qty
    if not merged:
        return None, missing
    return {
        "customer_id": customer_id,
        "reference_number": order_number,
        "date": date,
        "line_items": list(merged.values()),
    }, missing


def shortages(requested: dict, local: dict, live: dict, titles: dict) -> list:
    """Lines the cart cannot have. requested/local/live: book_id -> units.

    The lower of the two counts wins: the website's own number already reflects
    paid orders Zoho may not have seen, and Zoho's reflects warehouse changes
    the website has not pulled yet. A book Zoho did not answer for is judged on
    the website's number alone — a slow Zoho must never block a sale on its own.
    """
    out = []
    for bid, want in requested.items():
        avail = int(local.get(bid, 0) or 0)
        if bid in live and live[bid] is not None:
            avail = min(avail, int(live[bid]))
        if want > avail:
            out.append({"title": titles.get(bid, "Item"), "requested": want, "available": avail})
    return out


def backoff_minutes(attempts: int) -> int:
    """1, 2, 4, 8 … capped at 60 — a Zoho outage is retried, not hammered."""
    return min(60, 2 ** max(0, attempts - 1))
