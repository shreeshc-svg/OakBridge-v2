"""
Oakbridge Publishing — Features module (iteration 3).
Adds:
  - Coupon codes (public validate + admin CRUD)
  - eBook downloads (admin upload via object storage, authenticated gated download)
  - Inventory / low-stock endpoints
  - Manuscript submissions portal (public create + admin manage)
"""
from __future__ import annotations

import csv
import io
import os
import uuid
import logging
import calendar
from datetime import datetime, timezone, timedelta
from typing import Any, List, Optional

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, Header, UploadFile
from fastapi.responses import Response, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from extensions import db, get_current_user, require_admin

log = logging.getLogger(__name__)

# ============== OBJECT STORAGE ==============
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "oakbridge"
_storage_key: Optional[str] = None


def _storage_ready() -> bool:
    return bool(os.environ.get("EMERGENT_LLM_KEY"))


def init_storage() -> Optional[str]:
    global _storage_key
    if _storage_key:
        return _storage_key
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        log.warning("EMERGENT_LLM_KEY not set; object storage disabled")
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": key}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        log.info("Object storage initialized")
        return _storage_key
    except Exception as e:  # noqa: BLE001
        log.error(f"Storage init failed: {e}")
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=503, detail="Object storage unavailable")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    r.raise_for_status()
    return r.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=503, detail="Object storage unavailable")
    r = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ============== COUPON MODELS ==============
class CouponCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    kind: str  # percent | flat
    value: float
    min_order: float = 0
    max_uses: int = 0  # 0 = unlimited
    active: bool = True
    expires_at: Optional[str] = None  # ISO date string
    description: str = ""


class CouponUpdate(BaseModel):
    kind: Optional[str] = None
    value: Optional[float] = None
    min_order: Optional[float] = None
    max_uses: Optional[int] = None
    active: Optional[bool] = None
    expires_at: Optional[str] = None
    description: Optional[str] = None


class Coupon(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    code: str
    kind: str
    value: float
    min_order: float = 0
    max_uses: int = 0
    used_count: int = 0
    active: bool = True
    expires_at: Optional[str] = None
    description: str = ""
    created_at: str


class CouponValidateRequest(BaseModel):
    code: str
    subtotal: float


class CouponValidateResponse(BaseModel):
    valid: bool
    code: Optional[str] = None
    discount: float = 0
    message: str
    kind: Optional[str] = None
    value: Optional[float] = None


# ============== SUBMISSION MODELS ==============
class SubmissionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: Optional[str] = ""
    affiliation: Optional[str] = ""
    working_title: str = Field(min_length=1, max_length=240)
    category: str  # school | higher-ed | professional | test-prep | children | other
    word_count: Optional[int] = 0
    synopsis: str = Field(min_length=10, max_length=4000)
    bio: Optional[str] = ""


class Submission(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    email: str
    phone: str = ""
    affiliation: str = ""
    working_title: str
    category: str
    word_count: int = 0
    synopsis: str
    bio: str = ""
    status: str = "received"  # received | reviewing | shortlisted | declined | accepted
    created_at: str


class StatusUpdate(BaseModel):
    status: str


class NotifyRequest(BaseModel):
    email: EmailStr


# ============== PUBLIC ROUTER ==============
public_router = APIRouter(prefix="/api", tags=["features"])


@public_router.post("/coupons/validate", response_model=CouponValidateResponse)
async def validate_coupon(payload: CouponValidateRequest):
    code = payload.code.strip().upper()
    if not code:
        return CouponValidateResponse(valid=False, message="Enter a coupon code")
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon or not coupon.get("active"):
        return CouponValidateResponse(valid=False, message="Invalid or inactive code")
    if coupon.get("expires_at"):
        try:
            if datetime.fromisoformat(coupon["expires_at"]).replace(tzinfo=None) < datetime.utcnow():
                return CouponValidateResponse(valid=False, message="Coupon expired")
        except ValueError:
            pass
    if coupon.get("max_uses") and coupon["used_count"] >= coupon["max_uses"]:
        return CouponValidateResponse(valid=False, message="Coupon limit reached")
    if payload.subtotal < coupon.get("min_order", 0):
        return CouponValidateResponse(
            valid=False,
            message=f"Minimum order ₹{coupon.get('min_order', 0):.0f} required",
        )
    if coupon["kind"] == "percent":
        discount = round(payload.subtotal * (coupon["value"] / 100.0))
    else:  # flat
        discount = min(coupon["value"], payload.subtotal)
    return CouponValidateResponse(
        valid=True,
        code=coupon["code"],
        discount=discount,
        kind=coupon["kind"],
        value=coupon["value"],
        message=f"Applied {coupon['code']} — you save ₹{discount:.0f}",
    )


@public_router.get("/files/{path:path}")
async def public_file(path: str):
    """Proxy public assets (book covers etc.) from object storage."""
    try:
        data, content_type = get_object(path)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@public_router.post("/submissions", response_model=Submission)
async def create_submission(payload: SubmissionCreate):
    doc = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "email": payload.email.lower(),
        "phone": payload.phone or "",
        "affiliation": payload.affiliation or "",
        "word_count": int(payload.word_count or 0),
        "bio": payload.bio or "",
        "status": "received",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.submissions.insert_one({**doc})
    return Submission(**doc)


@public_router.post("/books/{book_id}/notify-me")
async def notify_when_in_stock(book_id: str, payload: NotifyRequest):
    """Register an email to be alerted when an out-of-stock title is restocked."""
    book = await db.books.find_one({"id": book_id}, {"_id": 0, "title": 1, "stock": 1})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if int(book.get("stock", 0) or 0) > 0:
        return {"already_in_stock": True, "message": "Good news — this title is in stock now."}
    email = payload.email.strip().lower()
    await db.stock_notifications.update_one(
        {"book_id": book_id, "email": email},
        {"$setOnInsert": {
            "book_id": book_id,
            "email": email,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True, "message": "We'll email you the moment it's back in stock."}


# ============== AUTHENTICATED ROUTER (customer access) ==============
customer_router = APIRouter(prefix="/api", tags=["customer-features"])


async def _user_owns_book(user_id: str, book_id: str) -> bool:
    """Check if the user has a non-cancelled order containing this book."""
    order = await db.orders.find_one(
        {
            "user_id": user_id,
            "status": {"$ne": "cancelled"},
            "items.book_id": book_id,
        },
        {"_id": 0, "id": 1},
    )
    return order is not None


@customer_router.get("/my/books/{book_id}/ebook")
async def download_my_ebook(book_id: str, user: dict = Depends(get_current_user)):
    if not await _user_owns_book(user["id"], book_id):
        raise HTTPException(status_code=403, detail="Purchase this book to download the eBook")
    book = await db.books.find_one({"id": book_id}, {"_id": 0})
    if not book or not book.get("ebook_path"):
        raise HTTPException(status_code=404, detail="No eBook available for this title")
    data, content_type = get_object(book["ebook_path"])
    filename = book.get("ebook_filename") or f"{book['title']}.pdf"
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============== ADMIN ROUTER ==============
admin_router = APIRouter(
    prefix="/api/admin",
    tags=["admin-features"],
    dependencies=[Depends(require_admin)],
)


@admin_router.post("/coupons", response_model=Coupon)
async def admin_create_coupon(payload: CouponCreate):
    code = payload.code.strip().upper()
    if payload.kind not in ("percent", "flat"):
        raise HTTPException(status_code=400, detail="kind must be 'percent' or 'flat'")
    if await db.coupons.find_one({"code": code}):
        raise HTTPException(status_code=400, detail="Coupon code already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "code": code,
        "kind": payload.kind,
        "value": float(payload.value),
        "min_order": float(payload.min_order or 0),
        "max_uses": int(payload.max_uses or 0),
        "used_count": 0,
        "active": bool(payload.active),
        "expires_at": payload.expires_at,
        "description": payload.description or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.coupons.insert_one({**doc})
    return Coupon(**doc)


@admin_router.get("/coupons", response_model=List[Coupon])
async def admin_list_coupons():
    cursor = db.coupons.find({}, {"_id": 0}).sort([("created_at", -1)])
    return await cursor.to_list(500)


@admin_router.patch("/coupons/{coupon_id}", response_model=Coupon)
async def admin_update_coupon(coupon_id: str, payload: CouponUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    r = await db.coupons.update_one({"id": coupon_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Coupon not found")
    doc = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    return Coupon(**doc)


@admin_router.delete("/coupons/{coupon_id}")
async def admin_delete_coupon(coupon_id: str):
    r = await db.coupons.delete_one({"id": coupon_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return {"ok": True}


@admin_router.post("/books/{book_id}/ebook")
async def admin_upload_ebook(book_id: str, file: UploadFile = File(...)):
    book = await db.books.find_one({"id": book_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    data = await file.read()
    if len(data) > 60 * 1024 * 1024:  # 60MB
        raise HTTPException(status_code=400, detail="File too large (max 60 MB)")
    path = f"{APP_NAME}/ebooks/{book_id}/{uuid.uuid4()}.pdf"
    result = put_object(path, data, "application/pdf")
    await db.books.update_one(
        {"id": book_id},
        {
            "$set": {
                "ebook_path": result["path"],
                "ebook_filename": file.filename,
                "ebook_size": result.get("size", len(data)),
                "ebook_uploaded_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return {"ok": True, "path": result["path"], "size": result.get("size", len(data))}


@admin_router.delete("/books/{book_id}/ebook")
async def admin_remove_ebook(book_id: str):
    # Soft-delete by clearing the reference in Mongo (storage has no delete API).
    r = await db.books.update_one(
        {"id": book_id},
        {"$unset": {"ebook_path": "", "ebook_filename": "", "ebook_size": "", "ebook_uploaded_at": ""}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"ok": True}


@admin_router.post("/uploads/cover")
async def admin_upload_cover(file: UploadFile = File(...)):
    """Upload a book cover image. Returns a publicly-readable URL for use as cover_image."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Cover image too large (max 8 MB)")
    ext = (file.filename or "cover").rsplit(".", 1)[-1].lower()[:8] or "jpg"
    path = f"{APP_NAME}/covers/{uuid.uuid4()}.{ext}"
    put_object(path, data, file.content_type)
    # Public URL served by our own proxy below (works across all browsers without auth headers)
    return {"url": f"/api/files/{path}", "path": path, "size": len(data)}


CSV_REQUIRED_COLUMNS = {
    "title", "author", "isbn", "category", "subject", "description", "price", "cover_image",
}

# All columns rendered in the downloadable template (in display order).
TEMPLATE_COLUMNS = [
    ("title", "Book title (required)"),
    ("subtitle", "Optional subtitle"),
    ("author", "Author name (required)"),
    ("author_bio", "Short biography of the author — shown on the book detail page (optional, ~80-150 words)"),
    ("author_photo", "Public URL of author photo, or leave blank and upload later (optional)"),
    ("isbn", "13-digit ISBN, e.g. 978-81-7000-01-1 (required)"),
    ("category", "academic | professional | general | coffee-table | curated-works (required)"),
    ("subject", "Free-form subject, e.g. Economics, GST, Photography (required)"),
    ("description", "1-3 sentence description (required)"),
    ("price", "Selling price in INR (required)"),
    ("original_price", "Original/MRP price (optional)"),
    ("cover_image", "Public URL of cover image (required) — or leave blank and upload a thumbnail per book afterwards"),
    ("pages", "Page count (default: 100)"),
    ("stock", "Inventory on hand (default: 100)"),
    ("bestseller", "TRUE / FALSE — flag for the bestseller carousel"),
    ("new_release", "TRUE / FALSE — flag for the new-release carousel"),
    ("grade", "Optional grade level, e.g. 'Ages 8-12' for children's titles"),
    ("language", "Default: English"),
    ("publisher", "Default: Oakbridge Publishing"),
    ("publication_year", "4-digit year, defaults to current year"),
    ("rating", "Initial rating 0-5, default 4.5"),
]

SAMPLE_ROW = {
    "title": "The GST Guide",
    "subtitle": "For Practitioners",
    "author": "CA Kiran Shah",
    "author_bio": "CA Kiran Shah has 18 years of indirect-tax practice and advises Fortune-500 firms on GST compliance and litigation. She lectures at NLSIU Bangalore and writes for The Hindu BusinessLine.",
    "author_photo": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80",
    "isbn": "978-81-9400-01-1",
    "category": "professional",
    "subject": "GST",
    "description": "Comprehensive practitioner reference for Indian GST.",
    "price": 1995,
    "original_price": 2295,
    "cover_image": "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=600&q=80",
    "pages": 820,
    "stock": 50,
    "bestseller": "TRUE",
    "new_release": "FALSE",
    "grade": "",
    "language": "English",
    "publisher": "Oakbridge Publishing",
    "publication_year": 2026,
    "rating": 4.6,
}


def _build_template_workbook() -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Books"

    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill("solid", fgColor="002B5C")
    required_fill = PatternFill("solid", fgColor="CC0033")
    sample_font = Font(italic=True, color="4B5563")
    center = Alignment(horizontal="left", vertical="center", wrap_text=True)

    for col_idx, (key, helptext) in enumerate(TEMPLATE_COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=key)
        cell.font = header_font
        cell.alignment = center
        cell.fill = header_fill if key not in CSV_REQUIRED_COLUMNS else required_fill
        cell.comment = Comment(helptext, "Oakbridge")
        # Reasonable default widths
        if key in ("description",):
            ws.column_dimensions[get_column_letter(col_idx)].width = 60
        elif key in ("cover_image",):
            ws.column_dimensions[get_column_letter(col_idx)].width = 50
        elif key in ("title", "subtitle", "author", "subject", "publisher"):
            ws.column_dimensions[get_column_letter(col_idx)].width = 28
        else:
            ws.column_dimensions[get_column_letter(col_idx)].width = 16

    # Sample row (italic, gray)
    for col_idx, (key, _) in enumerate(TEMPLATE_COLUMNS, start=1):
        cell = ws.cell(row=2, column=col_idx, value=SAMPLE_ROW.get(key, ""))
        cell.font = sample_font
        cell.alignment = center

    ws.row_dimensions[1].height = 28
    ws.freeze_panes = "A2"

    # Instructions sheet
    info = wb.create_sheet("Instructions")
    info["A1"] = "Oakbridge Publishing — Bulk Book Import"
    info["A1"].font = Font(bold=True, size=14, color="002B5C")
    instructions = [
        "",
        "1. Fill in one book per row on the 'Books' sheet. The first row is the header — DO NOT change it.",
        "2. Required columns (highlighted in red): title, author, isbn, category, subject, description, price, cover_image.",
        "3. Allowed values for `category`: academic, professional, general, coffee-table, curated-works.",
        "4. `bestseller` and `new_release` accept TRUE / FALSE (case-insensitive).",
        "5. `cover_image` should be a public URL. If you'd rather upload covers from your computer, leave this blank and use the per-book drag-and-drop uploader after import.",
        "6. The italic row 2 is a sample — delete it before uploading or it will be imported as a real book.",
        "7. Save the file as .xlsx (Excel) or .csv (UTF-8) and upload via Admin → Books → Import.",
    ]
    for i, line in enumerate(instructions, start=2):
        info.cell(row=i, column=1, value=line).alignment = Alignment(wrap_text=True, vertical="top")
    info.column_dimensions["A"].width = 110
    return wb


@admin_router.get("/books/import-template")
async def admin_import_template():
    """Download a styled Excel (.xlsx) template for the bulk-import flow."""
    wb = _build_template_workbook()
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="oakbridge-books-template.xlsx"',
        },
    )


def _csv_bool(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "y")


def _csv_int(v, default: int = 0) -> int:
    s = str(v).strip() if v is not None else ""
    if not s:
        return default
    try:
        return int(float(s))
    except ValueError:
        return default


def _csv_float(v, default: float = 0.0) -> float:
    s = str(v).strip() if v is not None else ""
    if not s:
        return default
    try:
        return float(s)
    except ValueError:
        return default


def _parse_csv_reader(raw_text: str) -> csv.DictReader:
    reader = csv.DictReader(io.StringIO(raw_text))
    field_set = {f.strip() for f in (reader.fieldnames or [])}
    if not reader.fieldnames or not CSV_REQUIRED_COLUMNS.issubset(field_set):
        missing = sorted(CSV_REQUIRED_COLUMNS - field_set)
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {missing}",
        )
    return reader


def _parse_xlsx_rows(file_bytes: bytes) -> List[dict]:
    """Read an .xlsx workbook and return a list of {column: value} dicts from the 'Books' sheet (or the first sheet)."""
    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read Excel file: {e}")
    ws = wb["Books"] if "Books" in wb.sheetnames else wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    try:
        header = next(rows)
    except StopIteration:
        raise HTTPException(status_code=400, detail="Excel file is empty")
    headers = [str(h).strip() if h is not None else "" for h in header]
    field_set = {h for h in headers if h}
    if not CSV_REQUIRED_COLUMNS.issubset(field_set):
        missing = sorted(CSV_REQUIRED_COLUMNS - field_set)
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {missing}",
        )
    out: List[dict] = []
    for row in rows:
        if row is None:
            continue
        if all((c is None or str(c).strip() == "") for c in row):
            continue  # skip blank rows
        record = {}
        for i, h in enumerate(headers):
            if not h:
                continue
            v = row[i] if i < len(row) else ""
            record[h] = "" if v is None else str(v)
        out.append(record)
    return out


def _csv_row_to_book_doc(clean: dict) -> dict:
    if not clean.get("title") or not clean.get("isbn"):
        raise ValueError("title and isbn are required")
    return {
        "id": str(uuid.uuid4()),
        "title": clean["title"],
        "subtitle": clean.get("subtitle") or None,
        "author": clean["author"],
        "author_bio": clean.get("author_bio") or None,
        "author_photo": clean.get("author_photo") or None,
        "isbn": clean["isbn"],
        "category": clean["category"],
        "subject": clean["subject"],
        "grade": clean.get("grade") or None,
        "description": clean["description"],
        "price": _csv_float(clean["price"]),
        "original_price": _csv_float(clean.get("original_price")) or None,
        "cover_image": clean["cover_image"],
        "pages": _csv_int(clean.get("pages"), default=100),
        "language": clean.get("language") or "English",
        "publisher": clean.get("publisher") or "Oakbridge Publishing",
        "publication_year": _csv_int(clean.get("publication_year"), default=datetime.now().year),
        "bestseller": _csv_bool(clean.get("bestseller")),
        "new_release": _csv_bool(clean.get("new_release")),
        "rating": _csv_float(clean.get("rating")) or 4.5,
        "stock": _csv_int(clean.get("stock"), default=100),
    }


class BulkDeleteRequest(BaseModel):
    ids: Optional[List[str]] = None
    delete_all: bool = False
    confirm: Optional[str] = None  # user must type "DELETE ALL" for delete_all


@admin_router.post("/books/bulk-delete")
async def admin_bulk_delete(payload: BulkDeleteRequest):
    """Delete multiple books by id, or every book (with typed confirmation)."""
    if payload.delete_all:
        if (payload.confirm or "").strip() != "DELETE ALL":
            raise HTTPException(
                status_code=400,
                detail='To delete every book, send confirm="DELETE ALL"',
            )
        result = await db.books.delete_many({})
        return {"deleted": result.deleted_count}

    ids = [i for i in (payload.ids or []) if i]
    if not ids:
        raise HTTPException(status_code=400, detail="No book ids provided")
    result = await db.books.delete_many({"id": {"$in": ids}})
    return {"deleted": result.deleted_count, "requested": len(ids)}


@admin_router.post("/books/bulk-import")
async def admin_bulk_import(file: UploadFile = File(...)):
    """
    Bulk-create books from a CSV or Excel (.xlsx) file.

    Required columns: title, author, isbn, category, subject, description, price, cover_image
    Optional columns: subtitle, grade, pages, original_price, stock, bestseller, new_release,
                      language, publisher, publication_year, rating
    """
    name = (file.filename or "").lower()
    file_bytes = await file.read()
    if name.endswith(".xlsx"):
        rows_iter = enumerate(_parse_xlsx_rows(file_bytes), start=2)
    elif name.endswith(".csv"):
        raw = file_bytes.decode("utf-8-sig", errors="replace")
        rows_iter = enumerate(_parse_csv_reader(raw), start=2)
    else:
        raise HTTPException(status_code=400, detail="Upload a .csv or .xlsx file")

    created: List[dict] = []
    errors: List[dict] = []
    for i, row in rows_iter:  # start=2 to match spreadsheet row numbers
        clean = {k.strip(): (str(v) if v is not None else "").strip() for k, v in row.items() if k}
        try:
            doc = _csv_row_to_book_doc(clean)
            await db.books.insert_one({**doc})
            created.append({"row": i, "id": doc["id"], "title": doc["title"]})
        except Exception as e:  # noqa: BLE001
            errors.append({"row": i, "error": str(e)})
    return {"created": len(created), "errors": errors, "books": created[:25]}



@admin_router.get("/inventory")
async def admin_inventory(threshold: int = 10):
    """Full inventory: every title with its stock, plus summary counts."""
    books = await db.books.find(
        {},
        {"_id": 0, "id": 1, "title": 1, "author": 1, "isbn": 1,
         "cover_image": 1, "price": 1, "stock": 1, "category": 1},
    ).sort([("stock", 1)]).to_list(5000)
    total_units = sum(int(b.get("stock", 0) or 0) for b in books)
    oos = sum(1 for b in books if int(b.get("stock", 0) or 0) <= 0)
    low = sum(1 for b in books if 0 < int(b.get("stock", 0) or 0) <= threshold)
    return {
        "threshold": threshold,
        "total_titles": len(books),
        "total_units": total_units,
        "out_of_stock": oos,
        "low_stock": low,
        "books": books,
    }


@admin_router.get("/inventory/low-stock")
async def admin_low_stock(threshold: int = 10):
    low = await db.books.find(
        {"stock": {"$lte": threshold, "$gt": 0}}, {"_id": 0}
    ).sort([("stock", 1)]).to_list(200)
    out = await db.books.find({"stock": {"$lte": 0}}, {"_id": 0}).to_list(200)
    return {"threshold": threshold, "low_stock": low, "out_of_stock": out}


@admin_router.get("/submissions", response_model=List[Submission])
async def admin_list_submissions():
    cursor = db.submissions.find({}, {"_id": 0}).sort([("created_at", -1)])
    return await cursor.to_list(500)


@admin_router.patch("/submissions/{sub_id}", response_model=Submission)
async def admin_update_submission(sub_id: str, payload: StatusUpdate):
    allowed = {"received", "reviewing", "shortlisted", "declined", "accepted"}
    if payload.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use one of {sorted(allowed)}")
    r = await db.submissions.update_one({"id": sub_id}, {"$set": {"status": payload.status}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")
    doc = await db.submissions.find_one({"id": sub_id}, {"_id": 0})
    return Submission(**doc)


# ============== SEED ==============
async def seed_coupons():
    if await db.coupons.count_documents({}) > 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    samples = [
        {
            "id": str(uuid.uuid4()),
            "code": "WELCOME10",
            "kind": "percent",
            "value": 10.0,
            "min_order": 500.0,
            "max_uses": 0,
            "used_count": 0,
            "active": True,
            "expires_at": None,
            "description": "10% off your first order over ₹500",
            "created_at": now,
        },
        {
            "id": str(uuid.uuid4()),
            "code": "TEACHER100",
            "kind": "flat",
            "value": 100.0,
            "min_order": 800.0,
            "max_uses": 0,
            "used_count": 0,
            "active": True,
            "expires_at": None,
            "description": "Flat ₹100 off for educators",
            "created_at": now,
        },
    ]
    await db.coupons.insert_many(samples)
    log.info(f"Seeded {len(samples)} coupons")


async def ensure_feature_indexes():
    await db.coupons.create_index("code", unique=True)
    await db.submissions.create_index("status")
    await db.stock_notifications.create_index([("book_id", 1), ("email", 1)], unique=True)
    await db.carts.create_index("user_id", unique=True)
    await db.site_content.create_index("key", unique=True)
    await db.media.create_index("uploaded_at")
    await db.content_collections.create_index("key", unique=True)
    await db.settings.create_index("key", unique=True)


# ====== Server-side cart + abandoned-cart reminders ======

class CartItemIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    book_id: str
    title: str = ""
    author: str = ""
    cover_image: str = ""
    price: float = 0
    quantity: int = 1


class CartSync(BaseModel):
    items: List[CartItemIn]


@customer_router.get("/my/cart")
async def get_my_cart(user: dict = Depends(get_current_user)):
    doc = await db.carts.find_one({"user_id": user["id"]}, {"_id": 0})
    return {"items": (doc or {}).get("items", [])}


@customer_router.put("/my/cart")
async def save_my_cart(payload: CartSync, user: dict = Depends(get_current_user)):
    items = [i.model_dump() for i in payload.items]
    await db.carts.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "user_id": user["id"],
            "items": items,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "reminders_sent": [],
        }},
        upsert=True,
    )
    return {"ok": True, "count": len(items)}


def _is_last_day_of_month(dt: datetime) -> bool:
    return dt.day == calendar.monthrange(dt.year, dt.month)[1]


async def process_cart_reminders(force: bool = False) -> dict:
    """Send abandoned-cart FOMO reminders at 12h, 1 week, and end of month."""
    now = datetime.now(timezone.utc)
    result = {"scanned": 0, "sent": 0, "by_stage": {"12h": 0, "1w": 0, "eom": 0}}
    carts = await db.carts.find({"items.0": {"$exists": True}}).to_list(5000)
    from emailer import send_cart_reminder  # late import avoids cycle
    order = ["12h", "1w", "eom"]
    for c in carts:
        result["scanned"] += 1
        try:
            updated = datetime.fromisoformat(c.get("updated_at"))
        except Exception:
            continue
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        age = now - updated
        done = set(c.get("reminders_sent", []))
        stage = None
        if force:
            for st in order:
                if st not in done:
                    stage = st
                    break
        elif "eom" not in done and _is_last_day_of_month(now) and age >= timedelta(hours=12):
            stage = "eom"
        elif "1w" not in done and age >= timedelta(days=7):
            stage = "1w"
        elif "12h" not in done and age >= timedelta(hours=12):
            stage = "12h"
        if not stage:
            continue
        u = await db.users.find_one({"id": c["user_id"]}, {"_id": 0, "email": 1, "name": 1})
        if not u or not u.get("email"):
            continue
        try:
            await send_cart_reminder(u["email"], u.get("name", ""), c.get("items", []), stage)
        except Exception:  # noqa: BLE001
            log.exception("cart reminder email failed for %s", u.get("email"))
            continue
        mark = set(order[: order.index(stage) + 1]) | done
        await db.carts.update_one(
            {"user_id": c["user_id"]},
            {"$set": {"reminders_sent": sorted(mark, key=order.index), "last_reminder_at": now.isoformat()}},
        )
        result["sent"] += 1
        result["by_stage"][stage] += 1
    log.info("cart reminders: %s", result)
    return result


tasks_router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@tasks_router.post("/cart-reminders")
async def run_cart_reminders_task(x_task_token: Optional[str] = Header(None)):
    expected = os.environ.get("TASK_TOKEN")
    if not expected or x_task_token != expected:
        raise HTTPException(status_code=403, detail="Invalid or missing task token")
    return await process_cart_reminders()


@admin_router.post("/cart-reminders/run")
async def admin_run_cart_reminders(force: bool = False):
    return await process_cart_reminders(force=force)


# ====== Media library + editable site imagery ======

APP_MEDIA_MAX = 10 * 1024 * 1024  # 10 MB

SITE_CONTENT_DEFAULTS = {
    "home_hero": "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85",
    "plp_banner": "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=2000&q=85",
    # What We Do / verticals
    "verticals_publishing": "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1600&q=85",
    "verticals_events": "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1400&q=80",
    "verticals_digital-solutions": "https://images.unsplash.com/photo-1551033406-611cf9a28f67?auto=format&fit=crop&w=1400&q=80",
    "verticals_training": "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80",
    # Solutions sub-pages
    "solutions_schools": "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1600&q=80",
    "solutions_higher-ed": "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1600&q=85",
    "solutions_educators": "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1600&q=80",
    # Events flagship banners (also power the rotating hero)
    "events_vidhi_banner": "/api/files/oakbridge/events/vidhi-banner.webp",
    "events_summit_banner": "/api/files/oakbridge/events/summit-banner.webp",
}

COLLECTION_DEFAULTS = {
    "events_vidhi_speakers": [
        {"name": "Arjun Ram Meghwal", "role": "Union Minister for Law & Justice, GoI", "photo": "/api/files/oakbridge/events/vidhi-arjun-meghwal.png"},
        {"name": "Justice A K Sikri", "role": "Former SC Judge \u00b7 Singapore Int'l Commercial Court", "photo": "/api/files/oakbridge/events/vidhi-justice-sikri.png"},
        {"name": "R Venkataramani", "role": "Attorney General for India", "photo": "/api/files/oakbridge/events/vidhi-venkataramani.png"},
        {"name": "Dr Lalit Bhasin", "role": "President, Society of Indian Law Firms", "photo": "/api/files/oakbridge/events/vidhi-lalit-bhasin.png"},
        {"name": "Ravi Kishan", "role": "Member of Parliament & Actor", "photo": "/api/files/oakbridge/events/vidhi-ravi-kishan.png"},
        {"name": "Gaythri Raman", "role": "Managing Director SEA & India, LexisNexis", "photo": "/api/files/oakbridge/events/vidhi-gaythri-raman.png"},
    ],
    "events_summit_speakers": [
        {"name": "Justice Manmohan", "role": "Judge, Supreme Court of India", "photo": "/api/files/oakbridge/events/summit-justice-manmohan.png"},
        {"name": "Dr. Shardul S. Shroff", "role": "Executive Chairman, SAM & Co", "photo": "/api/files/oakbridge/events/summit-shardul-shroff.png"},
        {"name": "Dr Manoj Kumar", "role": "Addl. Secretary, Ministry of Law & Justice", "photo": "/api/files/oakbridge/events/summit-manoj-kumar.jpg"},
        {"name": "Shailesh Haribhakti", "role": "Board Chairperson, leading Indian companies", "photo": "/api/files/oakbridge/events/summit-shailesh-haribhakti.png"},
        {"name": "L Badri Narayanan", "role": "Executive Partner, Lakshmikumaran Sridharan", "photo": "/api/files/oakbridge/events/summit-badri-narayanan.png"},
    ],
}


class MediaUpdate(BaseModel):
    alt: str = ""


class SiteContentSet(BaseModel):
    key: str
    value: str


class CategoryImageSet(BaseModel):
    image: str


@admin_router.post("/media")
async def admin_upload_media(file: UploadFile = File(...), alt: str = Form("")):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted")
    data = await file.read()
    if len(data) > APP_MEDIA_MAX:
        raise HTTPException(status_code=400, detail="Image too large (max 10 MB)")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower()[:8] or "jpg"
    path = f"{APP_NAME}/media/{uuid.uuid4()}.{ext}"
    put_object(path, data, file.content_type)
    doc = {
        "id": str(uuid.uuid4()),
        "url": f"/api/files/{path}",
        "filename": file.filename or "",
        "alt": alt or "",
        "content_type": file.content_type,
        "size": len(data),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.media.insert_one({**doc})
    return doc


@admin_router.get("/media")
async def admin_list_media():
    return await db.media.find({}, {"_id": 0}).sort([("uploaded_at", -1)]).to_list(2000)


@admin_router.patch("/media/{media_id}")
async def admin_update_media(media_id: str, payload: MediaUpdate):
    r = await db.media.update_one({"id": media_id}, {"$set": {"alt": payload.alt}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Media not found")
    return {"ok": True}


@admin_router.delete("/media/{media_id}")
async def admin_delete_media(media_id: str):
    r = await db.media.delete_one({"id": media_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Media not found")
    return {"ok": True}


@public_router.get("/site-content")
async def get_site_content():
    docs = await db.site_content.find({}, {"_id": 0}).to_list(500)
    values = {d["key"]: d["value"] for d in docs if d.get("value")}
    return {**SITE_CONTENT_DEFAULTS, **values}


@admin_router.put("/site-content")
async def set_site_content(payload: SiteContentSet):
    await db.site_content.update_one(
        {"key": payload.key},
        {"$set": {"key": payload.key, "value": payload.value}},
        upsert=True,
    )
    return {"ok": True}


@admin_router.patch("/categories/{category_id}")
async def admin_update_category_image(category_id: str, payload: CategoryImageSet):
    r = await db.categories.update_one({"id": category_id}, {"$set": {"image": payload.image}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"ok": True}


class CollectionSet(BaseModel):
    items: List[dict]


@public_router.get("/collections/{key}")
async def get_collection(key: str):
    doc = await db.content_collections.find_one({"key": key}, {"_id": 0})
    if doc and doc.get("items") is not None:
        return {"key": key, "items": doc["items"]}
    return {"key": key, "items": COLLECTION_DEFAULTS.get(key, [])}


@admin_router.put("/collections/{key}")
async def set_collection(key: str, payload: CollectionSet):
    await db.content_collections.update_one(
        {"key": key}, {"$set": {"key": key, "items": payload.items}}, upsert=True
    )
    return {"ok": True, "count": len(payload.items)}


SETTINGS_DEFAULTS = {
    "tax_percent": 5,
    "free_ship_threshold": 1500,
    "ship_flat": 60,
    "pdp_shipping": "Free shipping on orders over \u20b91,500",
    "pdp_delivery": "3\u20137 business days",
    "pdp_returns": "14-day returns",
    "binding_options": ["Hardcover", "Softcover"],
    "size_options": ["Demi", "Royal", "Crown"],
    # Storefront listing (PLP) — admin-editable sort menu + filter toggles.
    # sort `value` must be one of the server-supported keys:
    # featured | price_asc | price_desc | title | rating_desc | newest
    "plp_sort_options": [
        {"value": "featured", "label": "Featured"},
        {"value": "price_asc", "label": "Price — Low to High"},
        {"value": "price_desc", "label": "Price — High to Low"},
        {"value": "title", "label": "Title A–Z"},
    ],
    "plp_filters": [
        {"key": "bestseller", "label": "Bestsellers", "enabled": True},
        {"key": "new_release", "label": "New Releases", "enabled": True},
    ],
}


class SettingSet(BaseModel):
    key: str
    value: Any


@public_router.get("/settings")
async def get_settings():
    docs = await db.settings.find({}, {"_id": 0}).to_list(200)
    return {**SETTINGS_DEFAULTS, **{d["key"]: d["value"] for d in docs}}


@admin_router.put("/settings")
async def set_setting(payload: SettingSet):
    await db.settings.update_one(
        {"key": payload.key}, {"$set": {"key": payload.key, "value": payload.value}}, upsert=True
    )
    return {"ok": True}
