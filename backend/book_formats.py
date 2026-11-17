"""Book formats — one title sold as Paperback, Hardback, … (Nov 2026).

    GET  /api/admin/book-formats/{book_id}         the title's formats, for the Books form
    GET  /api/admin/book-formats/isbn/{isbn}       what an ISBN would link to (before saving)
    PUT  /api/admin/book-formats/{book_id}         save the whole list (empty list = switch off)
    attach(docs) / get_formats(doc)                storefront: sibling formats on cards + product page
    LISTED                                         query clause: one card per title in every listing
    heal()                                         after deletes / ISBN edits: keep every group sound

THE MODEL, AND WHY IT IS NOT A PRICE MATRIX ON ONE RECORD
---------------------------------------------------------
Every format is an ordinary book document with its OWN id, ISBN, price and
stock. They are tied together by three fields:

    format_group    shared opaque id ("fmt-…") — the only link between them
    format_label    "Paperback" / "Hardback" / … — what the switcher shows
    format_primary  True on exactly one member: the one the bookstore lists

The old `variants` matrix (binding × size, one record) could not work for a
publisher: a hardback is a different product with a different ISBN, printed
in a different run, counted on a different shelf. Stock on a variant was never
decremented, the warehouse ledger keys on book id, the Amazon/Flipkart sheets
key on ISBN, invoices print one ISBN per line. Making each format a real book
means all of that — cart, Razorpay, stock checks, warehouse moves, courier
runs, marketplace sheets, print on demand, packs, invoices, reviews — works
unchanged, because to all of it a hardback simply IS a book.

The cost is display-side only: listings must show ONE card per title (LISTED),
and the product page / card must be told about the siblings (attach).

`format_primary` is stored as an explicit False on non-primary members and is
ABSENT on ordinary books, so `{"format_primary": {"$ne": False}}` lists every
existing title unchanged and hides only the secondary formats.

Turning formats off for a title UNLINKS, never deletes: each member stays a
normal book (with its orders, stock and reviews) and reappears as its own card.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from audit import audit_log
from extensions import db, require_admin

log = logging.getLogger("oakbridge.book_formats")
admin_router = APIRouter(prefix="/api/admin/book-formats", tags=["admin"], dependencies=[Depends(require_admin)])

# Listing clause: one card per title. See the module docstring for why $ne.
LISTED = {"format_primary": {"$ne": False}}

# Offered in the form's dropdown; any other label can be typed.
SUGGESTED_LABELS = ["Paperback", "Hardback", "Hardback with dust jacket", "Spiral bound", "Library binding"]
MAX_FORMATS = 6
LABEL_MAX = 40
PRICE_MAX = 200000

FIELDS = ("format_group", "format_label", "format_primary", "format_order", "format_isbns")

# What a NEW format copies from the title it was added to. An allowlist, not
# "everything except": a denylist silently copies the next field anyone adds,
# and some fields must never be shared —
#   * ebook_path / preview files: one S3 object referenced by two books, and
#     deleting either book's file deletes the other's;
#   * store_links: an Amazon / Flipkart listing is per ISBN — the hardback's
#     Amazon page is not the paperback's;
#   * reviews / rating stats: earned per product; the review endpoint keys
#     on book id;
#   * stock, sku, pod: the new format has no copies yet; whether it is printed
#     on demand is a decision for its own row in Books.
COPY_FIELDS = (
    "title", "subtitle", "author", "author_bio", "author_photo", "category", "subject",
    "grade", "edition", "size", "description", "cover_image", "pages", "language",
    "publisher", "publication_year", "publication_date", "release_rank",
    "ebook_url", "ebook_price", "coming_soon", "launch_at", "coming_soon_label",
    "is_volume_set", "volumes",
)

PUBLIC = {"_id": 0, "id": 1, "isbn": 1, "price": 1, "original_price": 1, "stock": 1, "pod": 1,
          "coming_soon": 1, "launch_at": 1, "format_group": 1, "format_label": 1,
          "format_primary": 1, "format_order": 1, "product_type": 1, "title": 1}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def norm_isbn(v) -> str:
    return re.sub(r"[^0-9Xx]", "", str(v or "")).upper()


def isbn_ok(s: str) -> bool:
    """ISBN-13 with a correct check digit, or a 10-character ISBN-10.

    The check digit is enforced on 13s because a single mistyped digit would
    otherwise create a whole new product under somebody else's ISBN, and
    nothing downstream (the marketplace sheets, the warehouse) could tell.
    """
    if len(s) == 13 and s.isdigit():
        t = sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(s[:12]))
        return (10 - t % 10) % 10 == int(s[12])
    if len(s) == 10 and s[:9].isdigit() and (s[9].isdigit() or s[9] == "X"):
        t = sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(s))
        return t % 11 == 0
    return False


# ------------------------------------------------------------------ rules ---
def validate(rows: List[dict], anchor_id: str) -> List[str]:
    """Pure checks on the submitted list. Returns error strings (empty = ok).

    rows: [{book_id?, isbn?, label, price, original_price?}] in display order.
    """
    errs: List[str] = []
    if len(rows) < 2:
        return ["Add at least two formats — or switch Formats off."]
    if len(rows) > MAX_FORMATS:
        errs.append(f"At most {MAX_FORMATS} formats per title.")
    if sum(1 for r in rows if r.get("book_id") == anchor_id) != 1:
        errs.append("This book must stay in its own list. To take it out, open another format and remove it there.")
    seen_labels, seen_isbns, seen_ids = set(), set(), set()
    for i, r in enumerate(rows, 1):
        label = (r.get("label") or "").strip()
        if not label:
            errs.append(f"Row {i}: give the format a name (e.g. Hardback).")
        elif len(label) > LABEL_MAX:
            errs.append(f"Row {i}: the name is too long ({LABEL_MAX} characters max).")
        elif label.lower() in seen_labels:
            errs.append(f"Row {i}: two formats are both called “{label}”.")
        seen_labels.add(label.lower())
        try:
            price = float(r.get("price"))
        except (TypeError, ValueError):
            price = 0.0
        if not (0 < price <= PRICE_MAX):
            errs.append(f"Row {i}: price must be more than ₹0.")
        mrp = r.get("original_price")
        if mrp not in (None, ""):
            try:
                if float(mrp) < price:
                    errs.append(f"Row {i}: MRP can't be lower than the selling price.")
            except (TypeError, ValueError):
                errs.append(f"Row {i}: MRP must be a number.")
        if r.get("book_id"):
            if r["book_id"] in seen_ids:
                errs.append(f"Row {i}: this book is listed twice.")
            seen_ids.add(r["book_id"])
        else:
            isbn = norm_isbn(r.get("isbn"))
            if not isbn_ok(isbn):
                errs.append(f"Row {i}: “{r.get('isbn') or ''}” isn't a valid ISBN — check the digits.")
            elif isbn in seen_isbns:
                errs.append(f"Row {i}: ISBN {isbn} is listed twice.")
            seen_isbns.add(isbn)
    return errs


def new_format_doc(anchor: dict, isbn: str, label: str) -> dict:
    """A brand-new book for a format that has no record yet (see COPY_FIELDS)."""
    doc = {k: anchor[k] for k in COPY_FIELDS if k in anchor}
    doc.update({
        "id": str(uuid.uuid4()),
        "isbn": isbn,
        "binding": label,          # the Specs tab's "Binding" row
        "product_type": "book",
        "stock": 0,                # copies arrive through the warehouse, like any new title
        "pod": False,
        "bestseller": False, "new_release": False, "star_title": False,
        "rating": 4.5, "review_count": 0, "rating_avg": None,
        "store_links": {}, "variants": [],
        "created_at": _now(),
        "created_from_format_of": anchor["id"],
    })
    if doc.get("coming_soon"):
        doc["stock"] = 0
    return doc


def public_row(r: dict) -> dict:
    return {"id": r["id"], "label": r.get("format_label") or "", "isbn": r.get("isbn") or "",
            "price": r.get("price"), "original_price": r.get("original_price"),
            "stock": int(r.get("stock") or 0), "pod": bool(r.get("pod")),
            "coming_soon": bool(r.get("coming_soon")), "launch_at": r.get("launch_at"),
            "primary": r.get("format_primary") is True}


def _order(rows: List[dict]) -> List[dict]:
    return sorted(rows, key=lambda r: (int(r.get("format_order") or 0), r.get("format_label") or ""))


# -------------------------------------------------------------- storefront ---
async def attach(docs: List[dict]) -> List[dict]:
    """Give each listed book its sibling formats (one query for the page).

    `formats` is [] for an ordinary book, so the frontend needs one check.
    """
    gids = list({d.get("format_group") for d in docs if d.get("format_group")})
    by: dict = {}
    if gids:
        async for r in db.books.find({"format_group": {"$in": gids}, "product_type": {"$nin": ["pack", "hamper"]}}, PUBLIC):
            by.setdefault(r["format_group"], []).append(r)
    for d in docs:
        rows = _order(by.get(d.get("format_group"), [])) if d.get("format_group") else []
        d["formats"] = [public_row(r) for r in rows] if len(rows) > 1 else []
    return docs


async def to_primaries(docs: List[dict]) -> List[dict]:
    """Replace any secondary format with its title's listed record, keeping
    order and dropping repeats — for rankings built from order lines
    (bestsellers), where the hardback's sales are the title's sales."""
    want = {d["format_group"] for d in docs if d.get("format_group") and d.get("format_primary") is False}
    prim = {}
    if want:
        async for p in db.books.find({"format_group": {"$in": list(want)}, "format_primary": True}, {"_id": 0}):
            prim[p["format_group"]] = p
    out, seen = [], set()
    for d in docs:
        if d.get("format_group") and d.get("format_primary") is False:
            d = prim.get(d["format_group"])
            if d is None:
                continue
        if d["id"] not in seen:
            seen.add(d["id"])
            out.append(d)
    return out


# ------------------------------------------------------------------ repair ---
async def _write_group(gid: str, members: List[dict], primary_id: str) -> None:
    """Stamp the group fields on every member, in list order."""
    isbns = sorted({norm_isbn(m.get("isbn")) for m in members if m.get("isbn")} |
                   {m.get("isbn") for m in members if m.get("isbn")})
    for i, m in enumerate(members):
        is_p = m["id"] == primary_id
        s = {"format_group": gid, "format_label": m.get("format_label") or "", "format_primary": is_p, "format_order": i}
        upd = {"$set": s}
        # Only the listed record carries the other formats' ISBNs: that is
        # the record search runs against, so typing the HARDBACK's ISBN finds
        # the title's one card (server.SEARCH_FIELDS includes format_isbns).
        if is_p:
            s["format_isbns"] = isbns
        else:
            upd["$unset"] = {"format_isbns": ""}
        await db.books.update_one({"id": m["id"]}, upd)


async def _unlink(ids: List[str]) -> None:
    if ids:
        await db.books.update_many({"id": {"$in": ids}}, {"$unset": {f: "" for f in FIELDS}})


async def heal() -> dict:
    """Make every group sound again after something outside this module
    changed it — a format deleted (single, bulk, delete-all, import undo) or an
    ISBN edited in the Books form.

    Without this, deleting the LISTED format would leave the others all
    marked "not listed" — the whole title would vanish from the bookstore
    while every one of its books still existed. The scan is over formatted
    books only (a handful of documents), so it is cheap enough to run after
    every delete rather than tracking which path deleted what.
    """
    groups: dict = {}
    async for r in db.books.find({"format_group": {"$exists": True, "$nin": [None, ""]}}, PUBLIC):
        groups.setdefault(r["format_group"], []).append(r)
    fixed = unlinked = 0
    for gid, rows in groups.items():
        rows = _order(rows)
        if len(rows) < 2:
            await _unlink([r["id"] for r in rows])
            unlinked += 1
            continue
        prims = [r for r in rows if r.get("format_primary") is True]
        primary = prims[0]["id"] if prims else rows[0]["id"]
        await _write_group(gid, rows, primary)
        fixed += 0 if len(prims) == 1 else 1
    return {"groups": len(groups), "repaired": fixed, "unlinked": unlinked}


async def heal_quietly() -> None:
    try:
        await heal()
    except Exception:  # noqa: BLE001 — a delete must never fail because of this
        log.exception("book formats: heal failed")


# ------------------------------------------------------------------- admin ---
class FormatRow(BaseModel):
    book_id: Optional[str] = None
    isbn: Optional[str] = None
    label: str = ""
    price: Optional[float] = None
    original_price: Optional[float] = None


class FormatsBody(BaseModel):
    formats: List[FormatRow] = []
    primary_index: int = 0


async def _anchor(book_id: str) -> dict:
    b = await db.books.find_one({"id": book_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Book not found")
    if (b.get("product_type") or "book") != "book":
        raise HTTPException(status_code=400, detail="Formats are for books — packs and hampers have their own settings.")
    return b


async def _members(gid: Optional[str]) -> List[dict]:
    if not gid:
        return []
    return _order(await db.books.find({"format_group": gid}, PUBLIC).to_list(50))


async def _view(book_id: str) -> dict:
    b = await _anchor(book_id)
    rows = await _members(b.get("format_group"))
    return {"enabled": len(rows) > 1, "group": b.get("format_group") or None,
            "formats": [{**public_row(r), "title": r.get("title") or ""} for r in rows],
            "suggested_labels": SUGGESTED_LABELS}


@admin_router.get("/isbn/{isbn}")
async def bf_lookup(isbn: str, book_id: Optional[str] = None):
    """What saving this ISBN would do: link an existing book, or create one."""
    n = norm_isbn(isbn)
    if not isbn_ok(n):
        return {"valid": False}
    other = await db.books.find_one({"isbn": {"$in": list({n, isbn.strip()})}, "product_type": {"$nin": ["pack", "hamper"]}}, PUBLIC)
    if not other:
        return {"valid": True, "action": "create"}
    if other["id"] == book_id:
        return {"valid": True, "action": "self", "title": other.get("title")}
    clash = None
    if other.get("format_group") and book_id:
        mine = await db.books.find_one({"id": book_id}, {"_id": 0, "format_group": 1})
        if (mine or {}).get("format_group") != other["format_group"]:
            clash = other["format_group"]
    return {"valid": True, "action": "link", "book": {**public_row(other), "title": other.get("title") or ""},
            "in_other_group": bool(clash)}


@admin_router.get("/{book_id}")
async def bf_get(book_id: str):
    return await _view(book_id)


@admin_router.put("/{book_id}")
async def bf_save(book_id: str, body: FormatsBody, user: dict = Depends(require_admin)):
    anchor = await _anchor(book_id)
    gid = anchor.get("format_group")
    current = await _members(gid)
    current_ids = {r["id"] for r in current}
    rows = [r.model_dump() for r in body.formats]

    # Switch off: unlink everyone, delete no one.
    if not rows:
        await _unlink(list(current_ids))
        await audit_log(db, "BOOK_FORMATS_OFF", email=user.get("email", ""), role=user.get("role", ""),
                        meta={"book": book_id, "unlinked": sorted(current_ids)})
        return await _view(book_id)

    errs = validate(rows, book_id)
    if not (0 <= body.primary_index < len(rows)):
        errs.append("Pick which format the bookstore lists.")
    if errs:
        raise HTTPException(status_code=400, detail=" ".join(errs[:4]))

    # Resolve every row to a book: existing member, an existing book found by
    # ISBN (linked), or a new one (created at the end, once all rows pass).
    to_create, members = [], []
    for i, r in enumerate(rows, 1):
        if r.get("book_id"):
            if r["book_id"] != book_id and r["book_id"] not in current_ids:
                raise HTTPException(status_code=409, detail=f"Row {i} changed a moment ago — reopen the book and try again.")
            doc = anchor if r["book_id"] == book_id else await db.books.find_one({"id": r["book_id"]}, {"_id": 0})
            if not doc:
                raise HTTPException(status_code=409, detail=f"Row {i}: that book no longer exists — remove the row.")
            members.append((doc, r))
            continue
        isbn = norm_isbn(r.get("isbn"))
        found = await db.books.find_one({"isbn": {"$in": list({isbn, (r.get('isbn') or '').strip()})},
                                         "product_type": {"$nin": ["pack", "hamper"]}}, {"_id": 0})
        if found:
            if found["id"] == book_id or found["id"] in {m[0]["id"] for m in members}:
                raise HTTPException(status_code=400, detail=f"Row {i}: ISBN {isbn} is already in this list.")
            if found.get("format_group") and found["format_group"] != gid:
                raise HTTPException(status_code=400, detail=f"Row {i}: ISBN {isbn} (“{found.get('title')}”) is already a format of another title. Remove it there first.")
            members.append((found, r))
        else:
            doc = new_format_doc(anchor, isbn, (r.get("label") or "").strip())
            to_create.append(doc)
            members.append((doc, r))

    # One book, two rows: a typed ISBN that resolves to a format ALREADY
    # listed further down by id. The per-row check above only sees rows
    # before it, so the order "new ISBN row, then the same book's own row"
    # slipped through and stamped one book twice (two format_order values,
    # the label of whichever came last). Checked here, before anything is
    # written, so a refused save creates nothing.
    ids = [d["id"] for d, _ in members]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="The same book appears twice in this list — remove one of the rows.")

    gid = gid or f"fmt-{uuid.uuid4().hex[:12]}"
    for doc in to_create:
        doc["price"] = float(next(r for d, r in members if d is doc)["price"])
        await db.books.insert_one(dict(doc))

    # Prices and labels are set here (the switcher is where the admin sets
    # "Hardback ₹995"); stock is NOT — it belongs to the warehouse ledger.
    stamped = []
    for doc, r in members:
        mrp = r.get("original_price")
        await db.books.update_one({"id": doc["id"]}, {"$set": {
            "price": round(float(r["price"]), 2),
            "original_price": round(float(mrp), 2) if mrp not in (None, "") else None,
        }})
        stamped.append({**doc, "format_label": (r.get("label") or "").strip()})
    primary_id = stamped[body.primary_index]["id"]
    await _write_group(gid, stamped, primary_id)

    removed = sorted(current_ids - {d["id"] for d in stamped})
    await _unlink(removed)
    await audit_log(db, "BOOK_FORMATS_SAVE", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"book": book_id, "group": gid, "formats": [{"id": d["id"], "label": d["format_label"], "isbn": d.get("isbn")} for d in stamped],
                          "created": [d["id"] for d in to_create], "unlinked": removed, "primary": primary_id})
    out = await _view(book_id)
    out["created"] = [{"id": d["id"], "isbn": d["isbn"], "label": d["binding"]} for d in to_create]
    return out


async def ensure_indexes() -> None:
    try:
        await db.books.create_index("format_group", sparse=True)
    except Exception:  # noqa: BLE001
        log.warning("book formats: index creation failed", exc_info=True)
