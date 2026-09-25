"""
Packs — a fixed trio (or 2–6) of titles sold as ONE physical, shrink-wrapped
product with its own ISBN, its own stock and one line on the invoice.

WHY A PRODUCT TYPE AND NOT A CHECKBOX

Structurally a pack is what a volume set already is — one record, one ISBN, one
stock count. It gets its own `product_type` and its own admin screen anyway,
because the admin asked for packs to be managed separately so that nobody editing
the Books tab can mistake a pack for a title, and because the items are REAL
catalogue books (a volume set's volumes are free text).

Like hampers, a pack is a document in db.books, so cart, Razorpay, orders,
invoices, coupons and stock work with no new code path. Unlike hampers:

  * a pack has its own ISBN and is NOT excluded from the storefront — the
    bookstore's filter excludes only hampers, so packs list and search like
    books;
  * stock is the pack's own. The component books are listed for information
    only and their stock is never touched (payments.py only fans out stock for
    product_type="hamper");
  * there are no gift messages, occasions or deliver-to fields.

PRICING — WHY "% OFF" IS APPLIED TO THE PACK'S OWN MRP

The admin chooses a fixed price, or a percentage off. The percentage is applied
to an MRP entered FOR THE PACK (`original_price`), never to the sum of the three
books' prices. From 1 January 2027 the Consumer Protection (E-Commerce)
Amendment Rules require a struck-through "prior price" to be the lowest price
the item sold at in the 30 days before the reduction; a summed figure is a
price nobody was ever charged for the pack. `price` is always computed and
stored here, so every downstream consumer keeps reading one number.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from extensions import db, require_admin

log = logging.getLogger(__name__)

MIN_ITEMS = 2
MAX_ITEMS = 6
_NOT_PACKABLE = ("pack", "hamper")


# ------------------------------------------------------------------ pricing --
def compute_price(mrp: float, mode: str, value: float) -> float:
    """The selling price, from the pack's MRP and the admin's pricing choice.

    Raises ValueError with a message fit to show the admin.
    """
    mrp = float(mrp or 0)
    if mrp <= 0:
        raise ValueError("MRP must be greater than 0.")
    value = float(value or 0)
    if mode == "fixed":
        if value <= 0:
            raise ValueError("Price must be greater than 0.")
        if value > mrp:
            raise ValueError("Price cannot be higher than the MRP.")
        return round(value, 2)
    if mode == "percent":
        if not 0 < value < 100:
            raise ValueError("Percentage off must be between 0 and 100.")
        return float(round(mrp * (100 - value) / 100))
    raise ValueError("Pricing mode must be 'fixed' or 'percent'.")


def normalise_items(raw: Any) -> List[str]:
    """Book ids, de-duplicated, order kept."""
    out: List[str] = []
    for x in raw or []:
        bid = str(x.get("book_id") if isinstance(x, dict) else x or "").strip()
        if bid and bid not in out:
            out.append(bid)
    return out


# ------------------------------------------------------------------- models --
class PackBase(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    isbn: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None
    cover_image: Optional[str] = None
    original_price: Optional[float] = None  # the pack's own MRP
    pricing_mode: Optional[str] = None      # "fixed" | "percent"
    pricing_value: Optional[float] = None   # price, or % off
    stock: Optional[int] = Field(default=None, ge=0)
    pack_items: Optional[list] = None
    enabled: Optional[bool] = None
    language: Optional[str] = None
    publisher: Optional[str] = None
    binding: Optional[str] = None


class PackCreate(PackBase):
    title: str = Field(min_length=1, max_length=240)
    isbn: str = Field(min_length=10, max_length=20)
    category: str
    description: str = ""
    cover_image: str = ""
    original_price: float
    pricing_mode: str = "fixed"
    pricing_value: float
    stock: int = Field(default=0, ge=0)
    pack_items: list
    enabled: bool = True


class ReorderRequest(BaseModel):
    ids: list


# ------------------------------------------------------------------ helpers --
def _isbn_key(v: str) -> str:
    return "".join(ch for ch in str(v or "") if ch.isalnum()).upper()


async def _check_isbn_unique(isbn: str, self_id: Optional[str]) -> None:
    """ISBN is the join key for the inventory sheet and the eBook price list —
    both do find_one({"isbn": ...}). A pack sharing a book's ISBN would make
    both of them match the wrong record, silently."""
    key = _isbn_key(isbn)
    if not key:
        raise HTTPException(status_code=400, detail="ISBN is required.")
    async for d in db.books.find({}, {"_id": 0, "id": 1, "isbn": 1, "title": 1}):
        if d.get("id") != self_id and _isbn_key(d.get("isbn")) == key:
            raise HTTPException(
                status_code=400,
                detail=f"ISBN already used by “{d.get('title')}”.",
            )


async def _resolve_items(ids: List[str]) -> List[dict]:
    """The real catalogue books, in the admin's order. Refuses anything else."""
    if not MIN_ITEMS <= len(ids) <= MAX_ITEMS:
        raise HTTPException(
            status_code=400,
            detail=f"A pack needs {MIN_ITEMS}–{MAX_ITEMS} different books.",
        )
    docs = await db.books.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "title": 1, "author": 1, "pages": 1, "product_type": 1},
    ).to_list(None)
    by_id = {d["id"]: d for d in docs}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise HTTPException(status_code=400, detail="One or more books no longer exist.")
    bad = [by_id[i]["title"] for i in ids if by_id[i].get("product_type") in _NOT_PACKABLE]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"A pack can only contain books, not: {', '.join(bad)}.",
        )
    return [by_id[i] for i in ids]


def _derived(items: List[dict]) -> dict:
    """Fields the book-shaped parts of the site read, derived from the items.

    `author` feeds the "by …" line and search; `pages` feeds Specifications.
    Derived on every save so they cannot drift from the items listed.
    """
    authors: List[str] = []
    for b in items:
        a = (b.get("author") or "").strip()
        if a and a not in authors:
            authors.append(a)
    return {
        "author": ", ".join(authors),
        "pages": sum(int(b.get("pages") or 0) for b in items),
    }


def _price_or_400(mrp, mode, value) -> float:
    try:
        return compute_price(mrp, mode, value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------------- public --
public_router = APIRouter(prefix="/api", tags=["packs"])


@public_router.get("/packs/{pack_id}/items")
async def pack_items(pack_id: str):
    """The books inside a pack, read live, for the "Included in this pack" block.

    Deliberately NOT under /books/: server.py's api_router owns /books/{book_id}
    and would swallow the path.
    """
    pack = await db.books.find_one(
        {"id": pack_id, "product_type": "pack", "enabled": {"$ne": False}},
        {"_id": 0, "pack_items": 1},
    )
    if not pack:
        raise HTTPException(status_code=404, detail="Pack not found")
    ids = normalise_items(pack.get("pack_items"))
    docs = await db.books.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "title": 1, "author": 1, "cover_image": 1,
         "isbn": 1, "pages": 1, "original_price": 1, "price": 1},
    ).to_list(None)
    by_id = {d["id"]: d for d in docs}
    return {"items": [by_id[i] for i in ids if i in by_id]}


# -------------------------------------------------------------------- admin --
admin_router = APIRouter(
    prefix="/api/admin", tags=["admin-packs"], dependencies=[Depends(require_admin)]
)

_SORTS = {
    "order": ("order", 1),
    "title": ("title", 1),
    "price_asc": ("price", 1),
    "price_desc": ("price", -1),
    "stock": ("stock", 1),
    "newest": ("created_at", -1),
}


@admin_router.get("/packs")
async def admin_list_packs(q: str = "", enabled: str = "all", sort: str = "order"):
    query: dict[str, Any] = {"product_type": "pack"}
    if enabled == "on":
        query["enabled"] = {"$ne": False}
    elif enabled == "off":
        query["enabled"] = False
    field, direction = _SORTS.get(sort, _SORTS["order"])
    docs = await db.books.find(query, {"_id": 0}).sort(field, direction).to_list(None)
    needle = q.strip().lower()
    if needle:
        docs = [
            d for d in docs
            if needle in " ".join(
                str(d.get(k) or "") for k in ("title", "isbn", "author")
            ).lower()
        ]
    return {"count": len(docs), "packs": docs}


@admin_router.post("/packs")
async def admin_create_pack(payload: PackCreate):
    await _check_isbn_unique(payload.isbn, None)
    ids = normalise_items(payload.pack_items)
    items = await _resolve_items(ids)
    price = _price_or_400(payload.original_price, payload.pricing_mode, payload.pricing_value)
    top = await db.books.find_one(
        {"product_type": "pack"}, {"_id": 0, "order": 1}, sort=[("order", -1)]
    )
    doc = {
        "id": str(uuid.uuid4()),
        "product_type": "pack",
        "title": payload.title.strip(),
        "subtitle": (payload.subtitle or "").strip() or None,
        "isbn": payload.isbn.strip(),
        "category": payload.category,
        "subject": (payload.subject or "Pack").strip(),
        "description": payload.description or "",
        "cover_image": payload.cover_image or "",
        "original_price": float(payload.original_price),
        "price": price,
        "pack_pricing": {"mode": payload.pricing_mode, "value": float(payload.pricing_value)},
        "stock": int(payload.stock),
        "pack_items": [{"book_id": i} for i in ids],
        "enabled": bool(payload.enabled),
        "order": int((top or {}).get("order", -1)) + 1,
        "language": payload.language or "English",
        "publisher": payload.publisher or "Oakbridge Publishing",
        "binding": payload.binding or None,
        "rating": 4.5,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **_derived(items),
    }
    await db.books.insert_one(dict(doc))
    log.info("Pack created: %s (%s)", doc["title"], doc["id"])
    return doc


@admin_router.patch("/packs/{pack_id}")
async def admin_update_pack(pack_id: str, payload: PackBase):
    prev = await db.books.find_one({"id": pack_id, "product_type": "pack"}, {"_id": 0})
    if not prev:
        raise HTTPException(status_code=404, detail="Pack not found")
    updates = {
        k: v for k, v in payload.model_dump().items()
        if v is not None and k not in ("pricing_mode", "pricing_value", "pack_items")
    }
    if "isbn" in updates:
        await _check_isbn_unique(updates["isbn"], pack_id)

    if payload.pack_items is not None:
        ids = normalise_items(payload.pack_items)
        items = await _resolve_items(ids)
        updates["pack_items"] = [{"book_id": i} for i in ids]
        updates.update(_derived(items))

    # Re-price against the MERGED state: changing only the MRP must re-apply
    # the stored percentage, and changing only the mode must use the stored MRP.
    old = prev.get("pack_pricing") or {}
    mode = payload.pricing_mode or old.get("mode") or "fixed"
    value = payload.pricing_value if payload.pricing_value is not None else old.get("value", prev.get("price"))
    mrp = updates.get("original_price", prev.get("original_price"))
    if any(v is not None for v in (payload.pricing_mode, payload.pricing_value, payload.original_price)):
        updates["price"] = _price_or_400(mrp, mode, value)
        updates["pack_pricing"] = {"mode": mode, "value": float(value)}

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    # A duplicate is created with no ISBN; it must not go live that way.
    if updates.get("enabled", prev.get("enabled")) is not False and not _isbn_key(
        updates.get("isbn", prev.get("isbn"))
    ):
        raise HTTPException(status_code=400, detail="Add an ISBN before enabling this pack.")
    await db.books.update_one({"id": pack_id, "product_type": "pack"}, {"$set": updates})
    return await db.books.find_one({"id": pack_id}, {"_id": 0})


@admin_router.post("/packs/{pack_id}/duplicate")
async def admin_duplicate_pack(pack_id: str):
    """A copy to edit, disabled, with the ISBN cleared — two live records with
    one ISBN is exactly what _check_isbn_unique exists to prevent."""
    src = await db.books.find_one({"id": pack_id, "product_type": "pack"}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Pack not found")
    top = await db.books.find_one(
        {"product_type": "pack"}, {"_id": 0, "order": 1}, sort=[("order", -1)]
    )
    doc = {
        **src,
        "id": str(uuid.uuid4()),
        "title": f"{src.get('title', '')} (copy)",
        "isbn": "",
        "enabled": False,
        "stock": 0,
        "order": int((top or {}).get("order", -1)) + 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.books.insert_one(dict(doc))
    return doc


@admin_router.delete("/packs/{pack_id}")
async def admin_delete_pack(pack_id: str):
    # Scoped to product_type so a mistyped id can never reach a book. Orders
    # keep their own snapshot of what was bought. require_admin promotes DELETE
    # to superadmin.
    res = await db.books.delete_one({"id": pack_id, "product_type": "pack"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pack not found")
    log.info("Pack deleted: %s", pack_id)
    return {"deleted": True, "id": pack_id}


@admin_router.post("/packs/reorder")
async def admin_reorder_packs(payload: ReorderRequest):
    for i, pid in enumerate(payload.ids):
        await db.books.update_one(
            {"id": str(pid), "product_type": "pack"}, {"$set": {"order": i}}
        )
    return {"ok": True, "count": len(payload.ids)}
