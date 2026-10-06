"""
In-house warehouse system — Phase 1 (trial).

WHAT IT DOES
A phone screen (/warehouse) for the warehouse person and an admin view
(/admin/warehouse). Every copy that enters or leaves the warehouse becomes a
stock MOVEMENT; a book's warehouse count (`books.wh_stock`) is the running
total of its movements.

  in   printer bills — photographed, read by AWS Textract (title + quantity;
       these bills carry no ISBN), matched to the catalogue, confirmed by him.
  out  Tally invoices — PDF text read directly (ISBN on every line), packed
       into a carton by scanning, then confirmed. A photo of one goes through
       Textract instead. Consignee matching an author => "Author copy".
  any  single movements by ISBN (returns, damaged, samples, corrections), and
       every line can be typed by hand — automation is never the only way.
  web  paid website orders write their own movement (payments.py), so the
       warehouse count tracks website sales too.

TRIAL FIRST (state.mode)
  trial  movements change `wh_stock` only. Website stock (`books.stock`) stays
         with the Google-sheet sync. Admin compares the two daily.
  live   movements change both; the sheet sync stands down (inventory_sync.py);
         stock arriving for a pre-order releases it as a normal listed book.
Going live is a superadmin action that copies the warehouse counts onto the
website in one step, after the comparison shows they agree.

MEASURED, NOT TRUSTED
Every document keeps what the system READ and what the person CONFIRMED; the
difference is scored per line (warehouse_core.score_corrections) and shown as
accuracy by document type and supplier. Confirmed documents can be marked as
test cases and re-read later to check a parser change helps rather than hurts.
Practice mode runs the whole flow without moving stock.

Files (bill photos, invoice PDFs — the latter carry bank details) go to the
PRIVATE bucket under oakbridge/warehouse/ and are served only through
authenticated endpoints here; features.py treats that segment as private.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import rbac
import warehouse_core as core
from audit import audit_log
from extensions import _notify_back_in_stock, db, get_current_user, require_admin, require_superadmin
from features import APP_NAME, get_object, put_object
from uploads_guard import is_pdf, read_limited, sniff_image

log = logging.getLogger(__name__)

MAX_FILE = 15 * 1024 * 1024
STATE_KEY = "warehouse"
UNDO_HOURS = 24
TEXTRACT_REGION = os.environ.get("TEXTRACT_REGION") or os.environ.get("S3_REGION") or "us-east-1"

IN_REASONS = {"printer", "return", "correction_in", "opening"}
OUT_REASONS = {"damaged", "sample", "author_copy", "sale_offline", "correction_out"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ auth ---
async def require_warehouse(user: dict = Depends(get_current_user)) -> dict:
    """The phone screen: anyone whose role or section list grants "warehouse"."""
    if user.get("role") not in rbac.ADMIN_ROLES or "warehouse" not in rbac.effective_sections(user):
        raise HTTPException(status_code=403, detail="Warehouse access required")
    return user


# ----------------------------------------------------------------- state ---
async def get_state() -> dict:
    doc = await db.integrations.find_one({"key": STATE_KEY}, {"_id": 0}) or {}
    return {
        "mode": doc.get("mode") if doc.get("mode") in ("trial", "live") else "off",
        "started_at": doc.get("started_at"),
        "live_at": doc.get("live_at"),
    }


async def warehouse_is_master() -> bool:
    """True once live: the Google-sheet sync must not write stock any more."""
    return (await get_state())["mode"] == "live"


# ------------------------------------------------------------- movements ---
async def _apply(book_id: str, qty: int, reason: str, *, actor: dict, doc_id: str = "",
                 party: str = "", note: str = "", touch_stock: Optional[bool] = None) -> dict:
    """Write one movement and move the counts. qty is signed (+in, -out)."""
    state = await get_state()
    if state["mode"] == "off":
        raise HTTPException(status_code=409, detail="The warehouse trial has not been started yet (Admin → Warehouse).")
    book = await db.books.find_one(
        {"id": book_id}, {"_id": 0, "id": 1, "isbn": 1, "title": 1, "stock": 1, "coming_soon": 1})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    live = state["mode"] == "live"
    touch = live if touch_stock is None else (touch_stock and live)
    inc = {"wh_stock": qty}
    if touch:
        inc["stock"] = qty
    await db.books.update_one({"id": book_id}, {"$inc": inc})
    released = False
    if touch and qty > 0:
        fresh = await db.books.find_one({"id": book_id}, {"_id": 0})
        # Copies have arrived: a pre-order becomes an ordinary listed book,
        # the same rule the sheet sync applies (inventory_sync.py).
        if fresh.get("coming_soon"):
            await db.books.update_one({"id": book_id}, {"$set": {"coming_soon": False}})
            released = True
        if int(book.get("stock") or 0) <= 0 < int(fresh.get("stock") or 0) or released:
            await _notify_back_in_stock(fresh)
    mv = {
        "id": str(uuid.uuid4()), "at": _now().isoformat(), "book_id": book_id,
        "isbn": book.get("isbn", ""), "title": (book.get("title") or "")[:120],
        "qty": qty, "reason": reason, "doc_id": doc_id, "party": party[:120], "note": note[:300],
        "mode": state["mode"], "touched_stock": touch, "released_preorder": released,
        "by": actor.get("email", ""), "undone": False,
    }
    await db.stock_movements.insert_one(dict(mv))
    return mv


async def record_website_sale(order: dict, lines: list) -> None:
    """Paid website order -> movement per book. Never raises (payment path).

    Website stock was already decremented by payments.py, so these only move
    the warehouse count — in live mode too, where it keeps the two equal.
    """
    try:
        if (await get_state())["mode"] == "off":
            return
        for bid, qty in lines:
            await _apply(bid, -int(qty), "website_order", actor={"email": "website"},
                         doc_id=order.get("order_number", ""), touch_stock=False)
    except Exception:  # noqa: BLE001
        log.exception("warehouse: could not record website order %s", order.get("order_number"))


async def record_admin_stock_edit(book_id: str, prev: int, new: int) -> None:
    """Admin typed a new stock number (Books form / Inventory screen).

    Live only: the website count is the warehouse count then, so the edit is
    logged as a correction and the ledger follows it. During the trial a typed
    number is the sheet's world, not the warehouse's, and is left alone.
    Never raises — it runs after the edit has already been saved.
    """
    try:
        if prev == new or (await get_state())["mode"] != "live":
            return
        await _apply(book_id, new - prev, "correction_in" if new > prev else "correction_out",
                     actor={"email": "admin-stock-edit"}, note="Stock typed in Admin", touch_stock=False)
    except Exception:  # noqa: BLE001
        log.exception("warehouse: could not log admin stock edit for %s", book_id)


# ---------------------------------------------------------------- reading ---
def _textract(images: list) -> tuple[list, str]:
    import boto3

    client = boto3.client("textract", region_name=TEXTRACT_REGION)
    rows, texts = [], []
    for img in images:
        res = client.analyze_document(Document={"Bytes": img}, FeatureTypes=["TABLES"])
        blocks = res.get("Blocks") or []
        rows.extend(core.parse_goods_tables(core.textract_tables(blocks)))
        texts.append(core.textract_text(blocks))
    return rows, "\n".join(texts)


def _shrink_image(data: bytes) -> bytes:
    """Phone photos -> JPEG under Textract's 10 MB synchronous limit."""
    from PIL import Image, ImageOps

    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    im.thumbnail((3000, 3000))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=85)
    return out.getvalue()


def _pdf_text_and_pages(data: bytes) -> tuple[str, list]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    text = "\n".join(p.get_textpage().get_text_range() for p in pdf)
    images = []
    if len(text.strip()) < 40:  # scanned PDF: no text layer — render for Textract
        for page in list(pdf)[:3]:
            buf = io.BytesIO()
            page.render(scale=2).to_pil().convert("RGB").save(buf, "JPEG", quality=85)
            images.append(buf.getvalue())
    return text, images


async def read_document(data: bytes, kind: str, direction: str) -> dict:
    """bytes -> {source, text, rows}. kind: pdf|image."""
    if kind == "pdf":
        text, images = await asyncio.to_thread(_pdf_text_and_pages, data)
        if not images:
            rows = core.parse_tally_text(text)
            if rows:
                return {"source": "pdf_text", "text": text, "rows": rows}
            # A text PDF that is not a Tally invoice (e.g. an emailed printer
            # bill): fall through to Textract on its rendered pages.
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(data)
            for page in list(pdf)[:3]:
                buf = io.BytesIO()
                page.render(scale=2).to_pil().convert("RGB").save(buf, "JPEG", quality=85)
                images.append(buf.getvalue())
        rows, ttext = await asyncio.to_thread(_textract, images)
        return {"source": "textract_pdf", "text": text or ttext, "rows": rows}
    img = await asyncio.to_thread(_shrink_image, data)
    rows, text = await asyncio.to_thread(_textract, [img])
    return {"source": "textract_photo", "text": text, "rows": rows}


async def _catalogue() -> list:
    return await db.books.find(
        {}, {"_id": 0, "id": 1, "title": 1, "isbn": 1, "pages": 1, "stock": 1, "wh_stock": 1,
             "coming_soon": 1, "product_type": 1},
    ).to_list(5000)


async def _suggest(rows: list, books: list) -> list:
    out = []
    for i, r in enumerate(rows, start=1):
        m = core.match_line(r, books)
        out.append({
            "line_no": i, "raw": r.get("raw", ""), "doc_title": r.get("title", ""),
            "doc_isbn": r.get("isbn", ""), "pages": r.get("pages"),
            "qty": r.get("qty") or 0, "book_id": m["book_id"], "match": m["method"],
            "score": m["score"], "candidates": m["candidates"],
            # Unmatched lines (Box Charge, tax rows that slipped through) start
            # unticked: the person adds them deliberately, never by accident.
            "include": bool(m["book_id"]),
        })
    return out


# ------------------------------------------------------------ staff API ---
wh_router = APIRouter(prefix="/api/warehouse", tags=["warehouse"])


@wh_router.get("/state")
async def wh_state(_: dict = Depends(require_warehouse)):
    return await get_state()


@wh_router.get("/lookup")
async def wh_lookup(code: str, _: dict = Depends(require_warehouse)):
    """Barcode / typed ISBN -> book with both counts and its last movements."""
    isbn = core.norm_isbn(code)
    books = await db.books.find({}, {"_id": 0, "id": 1, "isbn": 1}).to_list(5000)
    hit = next((b for b in books if core.norm_isbn(b.get("isbn")) == isbn), None)
    if not hit:
        raise HTTPException(status_code=404, detail=f"No book with ISBN {isbn or code}")
    book = await db.books.find_one(
        {"id": hit["id"]},
        {"_id": 0, "id": 1, "title": 1, "isbn": 1, "author": 1, "stock": 1, "wh_stock": 1,
         "coming_soon": 1, "cover_image": 1})
    moves = await db.stock_movements.find({"book_id": hit["id"]}, {"_id": 0}).sort("at", -1).to_list(10)
    return {"book": book, "movements": moves}


@wh_router.get("/books")
async def wh_books(_: dict = Depends(require_warehouse)):
    """Compact catalogue for picking a book by hand."""
    return await db.books.find(
        {"product_type": {"$nin": ["hamper", "pack"]}},
        {"_id": 0, "id": 1, "title": 1, "isbn": 1, "author": 1, "wh_stock": 1, "stock": 1},
    ).sort("title", 1).to_list(5000)


@wh_router.post("/docs")
async def wh_upload_doc(
    direction: str = Form(...),           # in (printer bill) | out (invoice to pack)
    practice: bool = Form(False),
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_warehouse),
):
    """Upload a bill/invoice (or none, for manual entry) -> draft with suggested lines."""
    if direction not in ("in", "out"):
        raise HTTPException(status_code=400, detail="direction must be in or out")
    started = _now()
    doc = {
        "id": str(uuid.uuid4()), "direction": direction, "practice": bool(practice),
        "status": "draft", "created_at": started.isoformat(), "created_by": user.get("email", ""),
        "source": "manual", "file_path": "", "file_type": "", "sha256": "",
        "doc_number": "", "party_name": "", "party_gstin": "", "party_kind": "",
        "total_qty": None, "read_lines": [], "error": "", "test_case": False, "reports": [],
    }
    if file is not None:
        data = await read_limited(file, MAX_FILE, "File")
        kind = "pdf" if is_pdf(data) else ("image" if sniff_image(data) in ("jpg", "png", "webp") else None)
        if not kind:
            raise HTTPException(status_code=400, detail="Send a PDF or a photo (JPG/PNG).")
        sha = hashlib.sha256(data).hexdigest()
        dup = await db.warehouse_docs.find_one(
            {"sha256": sha, "practice": False, "status": {"$in": ["confirmed"]}}, {"_id": 0, "id": 1, "doc_number": 1})
        ext = "pdf" if kind == "pdf" else sniff_image(data)
        path = f"{APP_NAME}/warehouse/{started:%Y/%m}/{doc['id']}.{ext}"
        await asyncio.to_thread(put_object, path, data, "application/pdf" if kind == "pdf" else f"image/{ext}")
        doc.update({"file_path": path, "file_type": kind, "sha256": sha,
                    "duplicate_of": (dup or {}).get("id", "")})
        try:
            res = await read_document(data, kind, direction)
            hdr = core.header_fields(res["text"], direction)
            doc.update({"source": res["source"], **hdr})
            doc["read_lines"] = await _suggest(res["rows"], await _catalogue())
            if not res["rows"]:
                doc["error"] = "No book lines could be read — enter them by hand."
        except Exception as e:  # noqa: BLE001
            # Reading failed (Textract not permitted, blurry photo, odd layout):
            # the photo is kept and the person carries on by hand.
            log.warning("warehouse read failed: %s", e)
            doc["error"] = "Could not read this document automatically — enter the lines by hand."
            doc["read_error"] = str(e)[:300]
        if direction == "out" and doc.get("party_name"):
            authors = [a["name"] async for a in db.authors.find({}, {"_id": 0, "name": 1})]
            who = core.match_party_author(doc["party_name"], authors)
            doc["party_kind"] = "author_copy" if who else "sale_offline"
            doc["party_author"] = who or ""
        if doc.get("doc_number"):
            prior = await db.warehouse_docs.find_one(
                {"doc_number": doc["doc_number"], "direction": direction, "practice": False,
                 "status": "confirmed", "party_gstin": doc.get("party_gstin", "")},
                {"_id": 0, "id": 1, "confirmed_at": 1})
            if prior:
                doc["duplicate_of"] = prior["id"]
        doc["read_ms"] = int((_now() - started).total_seconds() * 1000)
    if direction == "out" and not doc["party_kind"]:
        doc["party_kind"] = "sale_offline"
    await db.warehouse_docs.insert_one(dict(doc))
    return doc


class ConfirmLine(BaseModel):
    line_no: Optional[int] = None
    book_id: Optional[str] = None
    qty: int = 0
    include: bool = True


class ConfirmBody(BaseModel):
    lines: list[ConfirmLine]
    doc_number: Optional[str] = None
    party_name: Optional[str] = None
    party_kind: Optional[str] = None   # out: sale_offline | author_copy
    allow_duplicate: bool = False
    note: Optional[str] = None


@wh_router.post("/docs/{doc_id}/confirm")
async def wh_confirm(doc_id: str, body: ConfirmBody, user: dict = Depends(require_warehouse)):
    """He has checked the lines (and packed the carton) — apply them."""
    doc = await db.warehouse_docs.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc["status"] != "draft":
        raise HTTPException(status_code=409, detail="This document was already synced.")
    if doc.get("duplicate_of") and not doc["practice"] and not body.allow_duplicate:
        raise HTTPException(status_code=409, detail="This bill/invoice was already synced once. Ask a manager before adding it again.")
    kept = [ln for ln in body.lines if ln.include and ln.book_id and ln.qty > 0]
    if not kept and not doc["practice"]:
        raise HTTPException(status_code=400, detail="Tick at least one book with a quantity.")
    if any(ln.qty > 100000 for ln in kept):
        raise HTTPException(status_code=400, detail="That quantity looks wrong (over 1,00,000).")
    doc_number = (body.doc_number if body.doc_number is not None else doc.get("doc_number")) or ""
    party = (body.party_name if body.party_name is not None else doc.get("party_name")) or ""
    party_kind = body.party_kind or doc.get("party_kind") or ""
    if doc["direction"] == "out" and party_kind not in ("sale_offline", "author_copy"):
        party_kind = "sale_offline"

    if not doc["practice"] and (await get_state())["mode"] == "off":
        raise HTTPException(status_code=409, detail="The warehouse trial has not been started yet — use Practice, or ask a manager.")
    if not doc["practice"]:
        sign = 1 if doc["direction"] == "in" else -1
        reason = "printer" if doc["direction"] == "in" else party_kind
        for ln in kept:
            await _apply(ln.book_id, sign * ln.qty, reason, actor=user, doc_id=doc_id,
                         party=party, note=(body.note or "")[:300])

    read = [{"line_no": r["line_no"], "book_id": r.get("book_id"), "qty": r.get("qty"),
             "include": r.get("include")} for r in doc.get("read_lines") or []]
    confirmed = [ln.model_dump() for ln in body.lines]
    automated = doc.get("source") != "manual"
    metrics = core.score_corrections(read, confirmed) if automated else None
    total_ok = None
    if doc.get("total_qty"):
        total_ok = sum(ln.qty for ln in kept) == doc["total_qty"]
    now = _now()
    await db.warehouse_docs.update_one({"id": doc_id}, {"$set": {
        "status": "confirmed", "confirmed_at": now.isoformat(), "confirmed_by": user.get("email", ""),
        "confirmed_lines": confirmed, "doc_number": doc_number, "party_name": party,
        "party_kind": party_kind, "metrics": metrics, "total_matches": total_ok,
        "seconds_to_confirm": int((now - datetime.fromisoformat(doc["created_at"])).total_seconds()),
    }})
    await audit_log(db, "WAREHOUSE_DOC_CONFIRMED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"doc": doc_id, "direction": doc["direction"], "number": doc_number,
                          "practice": doc["practice"], "units": sum(ln.qty for ln in kept)})
    return {"ok": True, "metrics": metrics, "total_matches": total_ok, "practice": doc["practice"]}


class MoveBody(BaseModel):
    code: str
    qty: int
    reason: str
    note: Optional[str] = None
    practice: bool = False


@wh_router.post("/move")
async def wh_move(body: MoveBody, user: dict = Depends(require_warehouse)):
    """One book in or out by ISBN — returns, damaged, samples, corrections."""
    if body.reason not in IN_REASONS | OUT_REASONS or body.reason == "opening":
        raise HTTPException(status_code=400, detail="Unknown reason")
    if body.qty <= 0 or body.qty > 100000:
        raise HTTPException(status_code=400, detail="Enter a quantity above 0.")
    isbn = core.norm_isbn(body.code)
    books = await db.books.find({}, {"_id": 0, "id": 1, "isbn": 1, "title": 1}).to_list(5000)
    hit = next((b for b in books if core.norm_isbn(b.get("isbn")) == isbn), None)
    if not hit:
        raise HTTPException(status_code=404, detail=f"No book with ISBN {isbn or body.code}")
    if body.practice:
        return {"ok": True, "practice": True, "book": hit}
    sign = 1 if body.reason in IN_REASONS else -1
    mv = await _apply(hit["id"], sign * body.qty, body.reason, actor=user, note=body.note or "")
    return {"ok": True, "movement": mv}


@wh_router.post("/docs/{doc_id}/report")
async def wh_report(doc_id: str, payload: dict, user: dict = Depends(require_warehouse)):
    note = str(payload.get("note") or "").strip()[:500]
    if not note:
        raise HTTPException(status_code=400, detail="Write what went wrong.")
    await db.warehouse_docs.update_one({"id": doc_id}, {"$push": {"reports": {
        "at": _now().isoformat(), "by": user.get("email", ""), "line_no": payload.get("line_no"), "note": note}}})
    return {"ok": True}


async def _file_response(doc_id: str) -> Response:
    doc = await db.warehouse_docs.find_one({"id": doc_id}, {"_id": 0, "file_path": 1})
    if not doc or not doc.get("file_path"):
        raise HTTPException(status_code=404, detail="No file for this document")
    data, ctype = await asyncio.to_thread(get_object, doc["file_path"])
    return Response(content=data, media_type=ctype,
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@wh_router.get("/docs/{doc_id}/file")
async def wh_file(doc_id: str, _: dict = Depends(require_warehouse)):
    return await _file_response(doc_id)


# ------------------------------------------------------------ admin API ---
wh_admin_router = APIRouter(prefix="/api/admin/warehouse", tags=["warehouse-admin"],
                            dependencies=[Depends(require_admin)])


@wh_admin_router.get("/overview")
async def adm_overview():
    state = await get_state()
    books = await db.books.find(
        {"product_type": {"$nin": ["hamper", "pack"]}},
        {"_id": 0, "id": 1, "title": 1, "isbn": 1, "stock": 1, "wh_stock": 1, "coming_soon": 1}).to_list(5000)
    diffs = [
        {**b, "diff": int(b.get("wh_stock") or 0) - int(b.get("stock") or 0)}
        for b in books if "wh_stock" in b and int(b.get("wh_stock") or 0) != int(b.get("stock") or 0)
    ]
    diffs.sort(key=lambda d: -abs(d["diff"]))
    return {**state, "books": len(books), "differences": diffs[:300], "difference_count": len(diffs)}


@wh_admin_router.get("/docs")
async def adm_docs(limit: int = 100):
    return await db.warehouse_docs.find(
        {}, {"_id": 0, "read_error": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 500))


@wh_admin_router.get("/docs/{doc_id}")
async def adm_doc(doc_id: str):
    doc = await db.warehouse_docs.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc["movements"] = await db.stock_movements.find({"doc_id": doc_id}, {"_id": 0}).to_list(500)
    return doc


@wh_admin_router.get("/docs/{doc_id}/file")
async def adm_file(doc_id: str):
    return await _file_response(doc_id)


@wh_admin_router.get("/movements")
async def adm_movements(book_id: Optional[str] = None, limit: int = 200):
    q = {"book_id": book_id} if book_id else {}
    return await db.stock_movements.find(q, {"_id": 0}).sort("at", -1).to_list(min(max(limit, 1), 1000))


async def _reverse(mv: dict, user: dict) -> None:
    inc = {"wh_stock": -mv["qty"]}
    if mv.get("touched_stock"):
        inc["stock"] = -mv["qty"]
    await db.books.update_one({"id": mv["book_id"]}, {"$inc": inc})
    await db.stock_movements.update_one({"id": mv["id"]}, {"$set": {
        "undone": True, "undone_by": user.get("email", ""), "undone_at": _now().isoformat()}})


@wh_admin_router.post("/docs/{doc_id}/undo")
async def adm_undo_doc(doc_id: str, user: dict = Depends(require_admin)):
    doc = await db.warehouse_docs.find_one({"id": doc_id}, {"_id": 0})
    if not doc or doc["status"] != "confirmed":
        raise HTTPException(status_code=409, detail="Only a synced document can be undone.")
    if _now() - datetime.fromisoformat(doc["confirmed_at"]) > timedelta(hours=UNDO_HOURS):
        raise HTTPException(status_code=409, detail=f"Undo is only possible within {UNDO_HOURS} hours.")
    for mv in await db.stock_movements.find({"doc_id": doc_id, "undone": False}, {"_id": 0}).to_list(500):
        await _reverse(mv, user)
    await db.warehouse_docs.update_one({"id": doc_id}, {"$set": {"status": "undone", "undone_by": user.get("email", "")}})
    await audit_log(db, "WAREHOUSE_DOC_UNDONE", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"doc": doc_id, "number": doc.get("doc_number")})
    return {"ok": True}


@wh_admin_router.post("/movements/{mv_id}/undo")
async def adm_undo_move(mv_id: str, user: dict = Depends(require_admin)):
    mv = await db.stock_movements.find_one({"id": mv_id}, {"_id": 0})
    if not mv or mv.get("undone") or mv.get("reason") in ("website_order", "opening"):
        raise HTTPException(status_code=409, detail="This movement cannot be undone here.")
    if _now() - datetime.fromisoformat(mv["at"]) > timedelta(hours=UNDO_HOURS):
        raise HTTPException(status_code=409, detail=f"Undo is only possible within {UNDO_HOURS} hours.")
    await _reverse(mv, user)
    return {"ok": True}


@wh_admin_router.post("/docs/{doc_id}/test-case")
async def adm_test_case(doc_id: str, payload: dict):
    await db.warehouse_docs.update_one({"id": doc_id}, {"$set": {"test_case": bool(payload.get("on"))}})
    return {"ok": True}


@wh_admin_router.get("/accuracy")
async def adm_accuracy(days: int = 30):
    """Error rate of the automated reading, from what people had to correct."""
    since = (_now() - timedelta(days=max(1, days))).isoformat()
    docs = await db.warehouse_docs.find(
        {"status": {"$in": ["confirmed", "undone"]}, "confirmed_at": {"$gte": since}},
        {"_id": 0, "id": 1, "direction": 1, "source": 1, "party_name": 1, "metrics": 1,
         "seconds_to_confirm": 1, "confirmed_at": 1, "practice": 1, "doc_number": 1,
         "total_matches": 1, "reports": 1}).to_list(5000)
    groups: dict = {}
    for d in docs:
        if not d.get("metrics"):
            continue
        for key in ("all", f'{d["direction"]}:{d.get("source")}', f'party:{d.get("party_name") or "?"}'):
            g = groups.setdefault(key, {"docs": 0, "lines": 0, "correct": 0, "wrong_book": 0,
                                        "wrong_qty": 0, "missed": 0, "extra": 0, "seconds": 0})
            m = d["metrics"]
            g["docs"] += 1
            g["seconds"] += int(d.get("seconds_to_confirm") or 0)
            for k in ("lines", "correct", "wrong_book", "wrong_qty", "missed", "extra"):
                g[k] += int(m.get(k) or 0)
    for g in groups.values():
        g["accuracy"] = round(g["correct"] / g["lines"], 4) if g["lines"] else None
        g["avg_seconds"] = round(g["seconds"] / g["docs"]) if g["docs"] else None
    recent = [d for d in docs if d.get("metrics") and d["metrics"].get("correct") != d["metrics"].get("lines")]
    recent.sort(key=lambda d: d["confirmed_at"], reverse=True)
    manual = sum(1 for d in docs if not d.get("metrics"))
    return {"days": days, "groups": groups, "manual_docs": manual, "corrections": recent[:30],
            "reports": [d for d in docs if d.get("reports")][:30]}


@wh_admin_router.post("/replay")
async def adm_replay(user: dict = Depends(require_admin)):
    """Re-read every test case with today's parser; score against the confirmed answer."""
    out = []
    for d in await db.warehouse_docs.find({"test_case": True}, {"_id": 0}).to_list(200):
        if not d.get("file_path"):
            continue
        try:
            data, _ = await asyncio.to_thread(get_object, d["file_path"])
            res = await read_document(data, d.get("file_type") or "pdf", d["direction"])
            sugg = await _suggest(res["rows"], await _catalogue())
            m = core.score_corrections(
                [{"line_no": s["line_no"], "book_id": s["book_id"], "qty": s["qty"], "include": s["include"]} for s in sugg],
                d.get("confirmed_lines") or [])
            out.append({"id": d["id"], "doc_number": d.get("doc_number"), "accuracy": m["accuracy"],
                        "was": (d.get("metrics") or {}).get("accuracy"), "details": m["details"]})
        except Exception as e:  # noqa: BLE001
            out.append({"id": d["id"], "doc_number": d.get("doc_number"), "error": str(e)[:200]})
    return {"cases": out}


class ModeBody(BaseModel):
    mode: str  # trial | live | off


@wh_admin_router.post("/mode")
async def adm_mode(body: ModeBody, user: dict = Depends(require_superadmin)):
    """Superadmin: start the trial, go live, or stop."""
    state = await get_state()
    now = _now().isoformat()
    if body.mode == "trial":
        if state["mode"] == "off":
            # Day one: the warehouse count starts from today's website stock,
            # recorded as an "opening" movement per book so the ledger adds up.
            books = await db.books.find(
                {"product_type": {"$nin": ["hamper", "pack"]}}, {"_id": 0, "id": 1, "isbn": 1, "title": 1, "stock": 1}
            ).to_list(5000)
            moves = []
            for b in books:
                qty = int(b.get("stock") or 0)
                await db.books.update_one({"id": b["id"]}, {"$set": {"wh_stock": qty}})
                moves.append({"id": str(uuid.uuid4()), "at": now, "book_id": b["id"], "isbn": b.get("isbn", ""),
                              "title": (b.get("title") or "")[:120], "qty": qty, "reason": "opening", "doc_id": "",
                              "party": "", "note": "Trial start: copied from website stock", "mode": "trial",
                              "touched_stock": False, "released_preorder": False,
                              "by": user.get("email", ""), "undone": False})
            if moves:
                await db.stock_movements.insert_many(moves)
        fields = {"mode": "trial", "started_at": state.get("started_at") or now}
    elif body.mode == "live":
        if state["mode"] != "trial":
            raise HTTPException(status_code=409, detail="Start the trial first.")
        # The warehouse becomes the stock master: its counts go onto the site.
        async for b in db.books.find({"wh_stock": {"$exists": True}}, {"_id": 0, "id": 1, "wh_stock": 1}):
            await db.books.update_one({"id": b["id"]}, {"$set": {"stock": max(0, int(b.get("wh_stock") or 0))}})
        fields = {"mode": "live", "live_at": now}
    elif body.mode == "off":
        fields = {"mode": "off"}
    else:
        raise HTTPException(status_code=400, detail="mode must be trial, live or off")
    await db.integrations.update_one({"key": STATE_KEY}, {"$set": {"key": STATE_KEY, **fields}}, upsert=True)
    await audit_log(db, "WAREHOUSE_MODE_CHANGED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"from": state["mode"], "to": body.mode})
    return await get_state()
