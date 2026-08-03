"""
Oakbridge Publishing — Extensions module.
Bundles:
  - JWT auth (register/login/me/logout) with bcrypt + role-based access
  - Admin router (books CRUD, orders, desk copies, dashboard stats)
  - Public extras router (authors, desk-copy requests, reviews, my-orders)
  - Seeders for admin user + authors
"""
from __future__ import annotations

import os
import re
import uuid
import logging
import secrets
import unicodedata
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt
import rbac
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security.utils import get_authorization_scheme_param
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, EmailStr, Field

log = logging.getLogger(__name__)

# ============== DB ==============
_mongo_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _mongo_client[os.environ["DB_NAME"]]

# ============== CONSTANTS ==============
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60 * 24 * 7  # 7 days — bearer token in localStorage


def _secret() -> str:
    return os.environ["JWT_SECRET"]


# ============== PASSWORDS ==============
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


# ============== JWT ==============
def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


# ============== MODELS ==============
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=20)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    phone: Optional[str] = None
    role: str = "customer"
    created_at: str
    email_verified: bool = False


class AuthResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"


class BookAdminCreate(BaseModel):
    title: str
    subtitle: Optional[str] = None
    author: str
    author_bio: Optional[str] = None
    author_photo: Optional[str] = None
    isbn: str
    category: str
    subject: str
    grade: Optional[str] = None
    binding: Optional[str] = None
    size: Optional[str] = None
    description: str
    price: float
    original_price: Optional[float] = None
    cover_image: str
    pages: int = 100
    language: str = "English"
    publisher: str = "Oakbridge Publishing"
    publication_year: int = 2024
    bestseller: bool = False
    new_release: bool = False
    rating: float = 4.5
    stock: int = 100
    variants: Optional[list] = None


class BookAdminUpdate(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    author: Optional[str] = None
    author_bio: Optional[str] = None
    author_photo: Optional[str] = None
    isbn: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    grade: Optional[str] = None
    binding: Optional[str] = None
    size: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    original_price: Optional[float] = None
    cover_image: Optional[str] = None
    pages: Optional[int] = None
    bestseller: Optional[bool] = None
    new_release: Optional[bool] = None
    stock: Optional[int] = None
    variants: Optional[list] = None


class DeskCopyCreate(BaseModel):
    book_id: str
    name: str
    email: EmailStr
    institution: str
    role: str  # teacher | professor | librarian | admin
    course: Optional[str] = ""
    enrolment: Optional[int] = 0
    message: Optional[str] = ""


class DeskCopy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    book_id: str
    book_title: str
    name: str
    email: str
    institution: str
    role: str
    course: str = ""
    enrolment: int = 0
    message: str = ""
    status: str = "pending"  # pending | approved | shipped | rejected
    created_at: str


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    title: str = Field(min_length=1, max_length=120)
    comment: str = Field(min_length=1, max_length=2000)


class Review(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    book_id: str
    user_id: str
    user_name: str
    rating: int
    title: str
    comment: str
    created_at: str


class Author(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    bio: str
    photo: str
    affiliation: str
    specialty: str
    category: str = ""
    title_count: int = 0
    enabled: bool = True
    order: int = 0


class AuthorWrite(BaseModel):
    # All optional so PATCH can send just the changed fields.
    name: Optional[str] = None
    bio: Optional[str] = None
    photo: Optional[str] = None
    affiliation: Optional[str] = None
    specialty: Optional[str] = None
    category: Optional[str] = None
    enabled: Optional[bool] = None
    order: Optional[int] = None


class AuthorOrder(BaseModel):
    ids: List[str]


class OrderStatusUpdate(BaseModel):
    status: str  # confirmed | processing | shipped | delivered | cancelled
    reason: Optional[str] = None  # optional note, emailed to the customer on cancellation


# ============== AUTH DEPENDENCIES ==============
async def _decode_token(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    scheme, token = get_authorization_scheme_param(auth)
    if not token or scheme.lower() != "bearer":
        return None
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            return None
        return payload
    except jwt.PyJWTError:
        return None


async def get_current_user(request: Request) -> dict:
    payload = await _decode_token(request)
    if not payload:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_current_user_optional(request: Request) -> Optional[dict]:
    payload = await _decode_token(request)
    if not payload:
        return None
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    return user


async def require_admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Gate every /api/admin/* route on the caller's role tier.

    Area is derived from the request path (see rbac.resolve_area), so this single
    dependency covers all admin endpoints — including ones added later — and
    unknown paths fall back to superadmin-only rather than being left open.
    """
    role = user.get("role")
    if role not in rbac.ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    if not rbac.can_path(user, request.url.path):
        raise HTTPException(
            status_code=403,
            detail="You don't have access to this section. Ask a superadmin to enable it.",
        )
    return user


async def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    """For user management: creating admins and changing roles."""
    if not rbac.is_superadmin(user.get("role")):
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


# ============== SEEDERS ==============
AUTHORS_SEED = [
    {
        "id": "ananya-ghosh",
        "name": "Prof. Ananya Ghosh",
        "bio": "Historian and editor-in-chief of Oakbridge Publishing. Former faculty at Jadavpur University. Author of three critically acclaimed surveys of modern Indian history.",
        "photo": "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=600&q=80",
        "affiliation": "Oakbridge Publishing",
        "specialty": "Modern Indian History",
    },
    {
        "id": "kaushik-banerjee",
        "name": "Prof. Kaushik Banerjee",
        "bio": "Development economist with two decades of teaching experience across IIM Calcutta and Ashoka University. Author of Oakbridge's Principles of Economics.",
        "photo": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80",
        "affiliation": "Ashoka University",
        "specialty": "Economics",
    },
    {
        "id": "neha-saxena",
        "name": "Dr. Neha Saxena",
        "bio": "Organic chemist and pedagogy researcher. Her textbooks are adopted across 40+ Indian universities.",
        "photo": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80",
        "affiliation": "IIT Kanpur",
        "specialty": "Organic Chemistry",
    },
    {
        "id": "vikram-iyer",
        "name": "Dr. Vikram Iyer",
        "bio": "Scholar of English literature and pedagogy. Former CBSE curriculum reviewer for Grades 9–12.",
        "photo": "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=600&q=80",
        "affiliation": "Delhi University",
        "specialty": "English Literature",
    },
    {
        "id": "sunita-rao",
        "name": "Dr. Sunita Rao",
        "bio": "Biologist and NEET preparation specialist. Her structured MCQ banks have helped over 200,000 aspirants.",
        "photo": "https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=600&q=80",
        "affiliation": "AIIMS Delhi (visiting)",
        "specialty": "Biology / NEET",
    },
    {
        "id": "tara-banerjee",
        "name": "Tara Banerjee",
        "bio": "Award-winning children's author and illustrator. Her picture books draw on Bengali folk traditions.",
        "photo": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=600&q=80",
        "affiliation": "Independent",
        "specialty": "Children's Literature",
    },
]


async def seed_admin():
    email = os.environ.get("ADMIN_EMAIL", "admin@oakbridge.in").lower()
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        log.warning("ADMIN_PASSWORD not set — skipping admin seed. Set it to create/rotate the admin account.")
        return
    existing = await db.users.find_one({"email": email})
    now_iso = datetime.now(timezone.utc).isoformat()
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(password),
            "name": "Oakbridge Admin",
            "role": "admin",
            "created_at": now_iso,
            "email_verified": True,
        })
        log.info(f"Seeded admin user: {email}")
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one(
            {"email": email},
            {"$set": {"password_hash": hash_password(password)}},
        )
        log.info(f"Updated admin password for: {email}")


async def seed_authors():
    cnt = await db.authors.count_documents({})
    if cnt > 0:
        return
    docs = []
    for a in AUTHORS_SEED:
        count = await db.books.count_documents({"author": {"$regex": a["name"].replace("Prof. ", "").replace("Dr. ", ""), "$options": "i"}})
        docs.append({**a, "title_count": count})
    await db.authors.insert_many(docs)
    log.info(f"Seeded {len(docs)} authors")


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.reviews.create_index("book_id")
    await db.desk_copies.create_index("status")


# ============== AUTH ROUTER ==============
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/register", response_model=AuthResponse)
async def register(payload: UserCreate):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    otp = f"{secrets.randbelow(1000000):06d}"
    doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "role": "customer",
        "created_at": now,
        "email_verified": False,
        "otp_hash": hash_password(otp),
        "otp_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        "otp_attempts": 0,
    }
    await db.users.insert_one({**doc})
    try:
        from sms import send_otp_sms, sms_configured
        if sms_configured():
            await send_otp_sms(doc["phone"], otp, doc["name"])
        else:
            from emailer import send_verification_otp
            await send_verification_otp(email, doc["name"], otp)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("verification OTP send failed for %s", email)
    try:
        from emailer import send_account_welcome
        await send_account_welcome(email, doc["name"])
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("welcome email failed for %s", email)
    token = create_access_token(user_id, email, "customer")
    return AuthResponse(
        user=UserPublic(id=user_id, email=email, name=doc["name"], phone=doc["phone"], role="customer", created_at=now, email_verified=False),
        access_token=token,
    )


@auth_router.post("/login", response_model=AuthResponse)
async def login(payload: UserLogin):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user.get("role", "customer"))
    return AuthResponse(
        user=UserPublic(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            phone=user.get("phone"),
            role=user.get("role", "customer"),
            created_at=user["created_at"],
            email_verified=user.get("email_verified", False),
        ),
        access_token=token,
    )


@auth_router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return UserPublic(**user)


@auth_router.post("/logout")
async def logout():
    # Client-side token removal is sufficient for bearer tokens
    return {"ok": True}


class OtpVerify(BaseModel):
    code: str


@auth_router.post("/verify-otp")
async def verify_otp(payload: OtpVerify, user: dict = Depends(get_current_user)):
    doc = await db.users.find_one({"id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    if doc.get("email_verified"):
        return {"ok": True, "already_verified": True}
    if not doc.get("otp_hash"):
        raise HTTPException(status_code=400, detail="No verification pending. Request a new code.")
    exp = doc.get("otp_expires_at")
    if exp and datetime.fromisoformat(exp) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired. Request a new one.")
    if int(doc.get("otp_attempts", 0)) >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")
    if not verify_password(payload.code.strip(), doc["otp_hash"]):
        await db.users.update_one({"id": user["id"]}, {"$inc": {"otp_attempts": 1}})
        raise HTTPException(status_code=400, detail="Incorrect code. Please try again.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"email_verified": True}, "$unset": {"otp_hash": "", "otp_expires_at": "", "otp_attempts": ""}},
    )
    return {"ok": True}


@auth_router.post("/resend-otp")
async def resend_otp(user: dict = Depends(get_current_user)):
    doc = await db.users.find_one({"id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    if doc.get("email_verified"):
        return {"ok": True, "already_verified": True}
    otp = f"{secrets.randbelow(1000000):06d}"
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "otp_hash": hash_password(otp),
            "otp_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "otp_attempts": 0,
        }},
    )
    try:
        from sms import send_otp_sms, sms_configured
        if sms_configured():
            await send_otp_sms(doc.get("phone", ""), otp, doc.get("name", ""))
        else:
            from emailer import send_verification_otp
            await send_verification_otp(doc["email"], doc.get("name", ""), otp)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("resend OTP failed for %s", doc.get("email"))
    return {"ok": True, "message": "A new code is on its way."}


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=6, max_length=128)


@auth_router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest):
    import hashlib
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # Always return ok — never reveal whether an account exists.
    if user:
        raw = secrets.token_urlsafe(32)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "reset_token_hash": hashlib.sha256(raw.encode()).hexdigest(),
                "reset_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
            }},
        )
        site = os.environ.get("SITE_URL", "http://localhost:3000").rstrip("/")
        reset_url = f"{site}/reset-password?token={raw}"
        try:
            from emailer import send_password_reset
            await send_password_reset(user["email"], user.get("name", ""), reset_url)
        except Exception:  # noqa: BLE001
            logging.getLogger(__name__).exception("password reset email failed for %s", email)
    return {"ok": True, "message": "If that email is registered, a reset link is on its way."}


@auth_router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    import hashlib
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
    thash = hashlib.sha256(token.encode()).hexdigest()
    user = await db.users.find_one({"reset_token_hash": thash})
    if not user:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Please request a new one.")
    exp = user.get("reset_expires_at")
    if exp and datetime.fromisoformat(exp) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {"password_hash": hash_password(payload.password)},
            "$unset": {"reset_token_hash": "", "reset_expires_at": ""},
        },
    )
    return {"ok": True}


# ============== PUBLIC EXTRAS ROUTER ==============
extras_router = APIRouter(prefix="/api", tags=["extras"])


async def _authors_order_mode() -> str:
    doc = await db.settings.find_one({"key": "authors_order"}, {"_id": 0, "value": 1})
    return (doc or {}).get("value") or "alpha"


@extras_router.get("/authors", response_model=List[Author])
async def list_authors():
    # Public page: hidden authors excluded, ordered per admin choice.
    # No cap — the roster is 140+ and grows.
    authors = await db.authors.find({"enabled": {"$ne": False}}, {"_id": 0}).to_list(None)
    if await _authors_order_mode() == "custom":
        authors.sort(key=lambda a: (a.get("order", 10**6), (a.get("name") or "").lower()))
    else:
        authors.sort(key=lambda a: (a.get("name") or "").lower())
    return authors


@extras_router.get("/authors/{author_id}", response_model=Author)
async def get_author(author_id: str):
    author = await db.authors.find_one({"id": author_id}, {"_id": 0})
    if not author:
        raise HTTPException(status_code=404, detail="Author not found")
    return author


@extras_router.get("/authors/{author_id}/books")
async def author_books(author_id: str):
    author = await db.authors.find_one({"id": author_id}, {"_id": 0})
    if not author:
        raise HTTPException(status_code=404, detail="Author not found")
    # Strip honorifics for matching
    name_core = author["name"].replace("Prof. ", "").replace("Dr. ", "")
    books = await db.books.find(
        {"author": {"$regex": name_core, "$options": "i"}},
        {"_id": 0},
    ).to_list(50)
    return books


@extras_router.post("/desk-copies", response_model=DeskCopy)
async def request_desk_copy(payload: DeskCopyCreate):
    book = await db.books.find_one({"id": payload.book_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    doc = {
        "id": str(uuid.uuid4()),
        "book_id": payload.book_id,
        "book_title": book["title"],
        "name": payload.name.strip(),
        "email": payload.email.lower(),
        "institution": payload.institution.strip(),
        "role": payload.role,
        "course": (payload.course or "").strip(),
        "enrolment": int(payload.enrolment or 0),
        "message": (payload.message or "").strip(),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.desk_copies.insert_one({**doc})
    return DeskCopy(**doc)


@extras_router.get("/books/{book_id}/reviews", response_model=List[Review])
async def list_reviews(book_id: str):
    reviews = await db.reviews.find({"book_id": book_id}, {"_id": 0}).sort([("created_at", -1)]).to_list(200)
    return reviews


@extras_router.post("/books/{book_id}/reviews", response_model=Review)
async def create_review(book_id: str, payload: ReviewCreate, user: dict = Depends(get_current_user)):
    book = await db.books.find_one({"id": book_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    # Require a purchase: the user must have a paid order containing this book.
    purchased = await db.orders.find_one(
        {"user_id": user["id"], "payment_status": "paid", "items.book_id": book_id},
        {"_id": 0, "id": 1},
    )
    if not purchased:
        raise HTTPException(status_code=403, detail="You can only review a book you've purchased.")
    # One review per user per book
    existing = await db.reviews.find_one({"book_id": book_id, "user_id": user["id"]})
    if existing:
        raise HTTPException(status_code=400, detail="You have already reviewed this book")
    doc = {
        "id": str(uuid.uuid4()),
        "book_id": book_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "rating": payload.rating,
        "title": payload.title.strip(),
        "comment": payload.comment.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.reviews.insert_one({**doc})
    try:
        from emailer import send_review_submitted
        await send_review_submitted(user.get("email"), user.get("name", ""), book.get("title", "your book"), payload.rating)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("review confirmation email failed")
    return Review(**doc)


@extras_router.get("/my/orders")
async def my_orders(user: dict = Depends(get_current_user)):
    orders = await db.orders.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort([("created_at", -1)]).to_list(200)
    return orders


# ============== ADMIN ROUTER ==============
admin_router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---- Authors management ----
def _author_slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "author"


@admin_router.get("/authors")
async def admin_list_authors():
    """Full roster including hidden authors, in the site's current order."""
    authors = await db.authors.find({}, {"_id": 0}).to_list(None)
    mode = await _authors_order_mode()
    if mode == "custom":
        authors.sort(key=lambda a: (a.get("order", 10**6), (a.get("name") or "").lower()))
    else:
        authors.sort(key=lambda a: (a.get("name") or "").lower())
    return {"authors": authors, "order_mode": mode}


@admin_router.put("/authors-order-mode")
async def admin_set_author_order_mode(mode: str = "alpha"):
    mode = "custom" if mode == "custom" else "alpha"
    await db.settings.update_one(
        {"key": "authors_order"}, {"$set": {"key": "authors_order", "value": mode}}, upsert=True
    )
    return {"ok": True, "order_mode": mode}


@admin_router.put("/authors-order")
async def admin_reorder_authors(payload: AuthorOrder):
    """Persist a custom order and switch the site to custom ordering."""
    for i, aid in enumerate(payload.ids):
        await db.authors.update_one({"id": aid}, {"$set": {"order": i}})
    await db.settings.update_one(
        {"key": "authors_order"}, {"$set": {"key": "authors_order", "value": "custom"}}, upsert=True
    )
    return {"ok": True, "count": len(payload.ids)}


@admin_router.post("/authors")
async def admin_create_author(payload: AuthorWrite):
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="Name is required")
    base = _author_slug(payload.name)
    aid = base
    n = 2
    while await db.authors.find_one({"id": aid}):
        aid = f"{base}-{n}"
        n += 1
    last = await db.authors.find({}, {"_id": 0, "order": 1}).sort("order", -1).limit(1).to_list(1)
    nxt = (last[0].get("order", 0) + 1) if last else 0
    doc = {
        "id": aid,
        "name": payload.name.strip(),
        "bio": (payload.bio or "").strip(),
        "photo": (payload.photo or "").strip(),
        "affiliation": (payload.affiliation or "").strip(),
        "specialty": (payload.specialty or "").strip(),
        "category": (payload.category or "").strip(),
        "title_count": 0,
        "enabled": True if payload.enabled is None else payload.enabled,
        "order": nxt,
    }
    await db.authors.insert_one(doc)
    doc.pop("_id", None)
    return doc


@admin_router.patch("/authors/{author_id}")
async def admin_update_author(author_id: str, payload: AuthorWrite):
    existing = await db.authors.find_one({"id": author_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Author not found")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    for str_field in ("name", "bio", "photo", "affiliation", "specialty", "category"):
        if str_field in updates:
            updates[str_field] = str(updates[str_field]).strip()
    if updates:
        await db.authors.update_one({"id": author_id}, {"$set": updates})
    doc = await db.authors.find_one({"id": author_id}, {"_id": 0})
    return doc


@admin_router.delete("/authors/{author_id}")
async def admin_delete_author(author_id: str):
    res = await db.authors.delete_one({"id": author_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Author not found")
    return {"ok": True}


@admin_router.get("/stats")
async def admin_stats():
    books = await db.books.count_documents({})
    orders = await db.orders.count_documents({})
    customers = await db.users.count_documents({"role": "customer"})
    desk_pending = await db.desk_copies.count_documents({"status": "pending"})
    recent = await db.orders.find({}, {"_id": 0}).sort([("created_at", -1)]).limit(5).to_list(5)

    # ===== Revenue is money RECEIVED =====
    #
    # This aggregation used to sum every order regardless of payment state, so
    # the headline Revenue tile included abandoned checkouts. An order document
    # is written BEFORE the customer reaches Razorpay — it has to be, since the
    # payment needs something to attach to — which means a closed payment window
    # leaves behind a full-looking order carrying a rupee figure that was never
    # collected. Roughly 40% of recent orders are in that state, so the overstatement
    # was not marginal.
    #
    # Grouping by payment_status in one pass gives paid and unpaid separately at
    # the cost of a single round trip. There is no refund path in the backend yet
    # — payments.py only ever writes pending/paid/failed — so no "refunded" bucket
    # is reported here. When refunds land, they belong in this same aggregation.
    #
    # $ifNull guards documents predating the field. Order.payment_status has
    # defaulted to "pending" since server.py:183, so this should never fire — but
    # if it ever did, the safe place for an unknown order is unpaid, not revenue.
    by_state = await db.orders.aggregate([
        {"$group": {
            "_id": {"$ifNull": ["$payment_status", "pending"]},
            "total": {"$sum": "$total"},
            "count": {"$sum": 1},
        }},
    ]).to_list(20)
    # Accumulate rather than assign. Mongo groups case-sensitively, so "Paid" and
    # "paid" would arrive as two rows; a dict comprehension keyed on the lowercased
    # status would silently keep only the last one and drop the other bucket's
    # money. Every writer is lowercase today, so this cannot fire — but the failure
    # mode is an understated revenue figure with no error, on the very tile this
    # change exists to make trustworthy.
    totals: dict = {}
    for r in by_state:
        acc = totals.setdefault(str(r["_id"] or "pending").lower(), {"total": 0, "count": 0})
        acc["total"] += r.get("total") or 0
        acc["count"] += r.get("count") or 0

    def _sum(state: str, field: str) -> int:
        return (totals.get(state) or {}).get(field, 0) or 0

    revenue = _sum("paid", "total")
    paid_orders = _sum("paid", "count")
    pending_revenue = _sum("pending", "total")
    pending_orders = _sum("pending", "count")
    failed_orders = _sum("failed", "count")

    # ===== "Last 7 days" activity snapshot =====
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    week_ago = (_dt.now(_tz.utc) - _td(days=7)).isoformat()

    new_orders_7d = await db.orders.count_documents({"created_at": {"$gte": week_ago}})
    paid_orders_7d = await db.orders.count_documents({
        "created_at": {"$gte": week_ago},
        "payment_status": "paid",
    })
    rev_agg = await db.orders.aggregate([
        {"$match": {"created_at": {"$gte": week_ago}, "payment_status": "paid"}},
        {"$group": {"_id": None, "revenue": {"$sum": "$total"}}},
    ]).to_list(1)
    revenue_7d = rev_agg[0]["revenue"] if rev_agg else 0
    waitlist_7d = await db.newsletter.count_documents({"created_at": {"$gte": week_ago}})
    submissions_7d = await db.submissions.count_documents({"created_at": {"$gte": week_ago}})
    low_stock_count = await db.books.count_documents({"stock": {"$lte": 5, "$gt": 0}})
    out_of_stock_count = await db.books.count_documents({"stock": {"$lte": 0}})

    return {
        "books": books,
        "orders": orders,
        "customers": customers,
        "desk_copies_pending": desk_pending,
        "revenue": revenue,              # paid only — see the aggregation above
        "paid_orders": paid_orders,
        "pending_orders": pending_orders,
        "pending_revenue": pending_revenue,
        "failed_orders": failed_orders,
        "recent_orders": recent,
        "last_7_days": {
            "new_orders": new_orders_7d,
            "paid_orders": paid_orders_7d,
            "revenue": revenue_7d,
            "waitlist_signups": waitlist_7d,
            "submissions": submissions_7d,
            "low_stock_books": low_stock_count,
            "out_of_stock_books": out_of_stock_count,
        },
    }


@admin_router.post("/books")
async def admin_create_book(payload: BookAdminCreate):
    doc = {"id": str(uuid.uuid4()), **payload.model_dump()}
    await db.books.insert_one({**doc})
    return doc


async def _notify_back_in_stock(book: dict) -> None:
    """Email everyone waiting on this title, then clear the waitlist (one-shot)."""
    try:
        subs = await db.stock_notifications.find({"book_id": book["id"]}, {"_id": 0}).to_list(2000)
        if not subs:
            return
        from emailer import send_back_in_stock  # late import avoids circular import
        for s in subs:
            try:
                await send_back_in_stock(s["email"], book)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception("back-in-stock email failed for %s", s.get("email"))
        await db.stock_notifications.delete_many({"book_id": book["id"]})
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("back-in-stock processing failed for book %s", book.get("id"))


@admin_router.patch("/books/{book_id}")
async def admin_update_book(book_id: str, payload: BookAdminUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    prev = await db.books.find_one({"id": book_id}, {"_id": 0, "stock": 1})
    if prev is None:
        raise HTTPException(status_code=404, detail="Book not found")
    await db.books.update_one({"id": book_id}, {"$set": updates})
    book = await db.books.find_one({"id": book_id}, {"_id": 0})
    # Back-in-stock: if stock crossed from 0 -> positive, notify everyone waiting.
    if int(prev.get("stock", 0) or 0) <= 0 and int((book or {}).get("stock", 0) or 0) > 0:
        await _notify_back_in_stock(book)
    return book


@admin_router.delete("/books/{book_id}")
async def admin_delete_book(book_id: str):
    result = await db.books.delete_one({"id": book_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"ok": True}


@admin_router.get("/orders")
async def admin_list_orders():
    """Orders newest-first, with each line item enriched for fulfilment.

    Order items only persist book_id/title/author/price/qty (a snapshot taken at
    checkout), so ISBN and edition — what a packer actually needs to pick the
    right stock — are joined from the catalogue here. Done server-side in one
    query so it also applies to orders placed before these fields existed.
    """
    orders = await db.orders.find({}, {"_id": 0}).sort([("created_at", -1)]).to_list(500)

    ids = {
        it.get("book_id")
        for o in orders
        for it in (o.get("items") or [])
        if it.get("book_id")
    }
    if ids:
        books = await db.books.find(
            {"id": {"$in": list(ids)}},
            {"_id": 0, "id": 1, "isbn": 1, "edition": 1, "author": 1},
        ).to_list(None)
        by_id = {b["id"]: b for b in books}
        for o in orders:
            for it in o.get("items") or []:
                b = by_id.get(it.get("book_id"))
                if not b:
                    continue
                it.setdefault("isbn", b.get("isbn"))
                it.setdefault("edition", b.get("edition"))
                if not it.get("author"):
                    it["author"] = b.get("author")
    return orders


@admin_router.patch("/orders/{order_id}")
async def admin_update_order(order_id: str, payload: OrderStatusUpdate):
    allowed = {"confirmed", "processing", "shipped", "delivered", "cancelled"}
    if payload.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use one of {sorted(allowed)}")
    updates = {"status": payload.status}
    if payload.status == "cancelled" and payload.reason:
        updates["cancel_reason"] = payload.reason.strip()
    result = await db.orders.update_one({"id": order_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    try:
        if payload.status == "cancelled":
            from emailer import send_order_cancelled
            await send_order_cancelled(order, payload.reason or "")
        else:
            from emailer import send_order_status_update
            await send_order_status_update(order)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("order status email failed for %s", order_id)
    return order


@admin_router.get("/desk-copies")
async def admin_list_desk_copies():
    items = await db.desk_copies.find({}, {"_id": 0}).sort([("created_at", -1)]).to_list(500)
    return items


@admin_router.patch("/desk-copies/{req_id}")
async def admin_update_desk_copy(req_id: str, payload: OrderStatusUpdate):
    allowed = {"pending", "approved", "shipped", "rejected"}
    if payload.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use one of {sorted(allowed)}")
    result = await db.desk_copies.update_one({"id": req_id}, {"$set": {"status": payload.status}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Desk copy request not found")
    item = await db.desk_copies.find_one({"id": req_id}, {"_id": 0})
    return item


@admin_router.get("/users")
async def admin_list_users():
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort([("created_at", -1)]).to_list(500)
    return users


@admin_router.get("/roles")
async def admin_list_roles(user: dict = Depends(get_current_user)):
    """Role vocabulary + the caller's own permissions, so the UI can hide what it
    cannot use instead of showing sections that 403 on click."""
    return {
        "sections": list(rbac.SECTIONS),
        "section_labels": rbac.SECTION_LABELS,
        "shared_content_sections": sorted(rbac.SHARED_CONTENT_SECTIONS),
        "assignable": list(rbac.ASSIGNABLE_ROLES),
        "role_presets": {r: list(s) for r, s in rbac.ROLE_PRESETS.items()},
        "me": {
            "role": user.get("role"),
            "sections": sorted(rbac.effective_sections(user)),
            "is_superadmin": rbac.is_superadmin(user.get("role")),
        },
    }


class AdminUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str = Field(default="", max_length=20)
    role: str = "fulfilment"
    # Optional explicit section list. Omit to inherit the role's preset.
    sections: Optional[List[str]] = None


class AdminUserRole(BaseModel):
    role: str


class AdminUserSections(BaseModel):
    sections: List[str]


@admin_router.post("/users")
async def admin_create_user(
    payload: AdminUserCreate, actor: dict = Depends(require_superadmin)
):
    """Create a staff account with a restricted role. Superadmin only."""
    if payload.role not in rbac.ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Use one of {list(rbac.ASSIGNABLE_ROLES)}",
        )
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A user with that email already exists")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": payload.name.strip(),
        "phone": (payload.phone or "").strip(),
        "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(),
        "role": payload.role,
        "created_at": now,
        "email_verified": True,  # created by a superadmin, no self-verification needed
        "created_by": actor.get("email"),
    }
    if payload.sections is not None and payload.role != "customer":
        doc["sections"] = [s for s in payload.sections if s in rbac.SECTIONS]
    await db.users.insert_one(doc)
    log.info("Staff account created: %s (%s) by %s", email, payload.role, actor.get("email"))
    return {"ok": True, "id": doc["id"], "email": email, "role": payload.role}


@admin_router.patch("/users/{user_id}/role")
async def admin_set_user_role(
    user_id: str, payload: AdminUserRole, actor: dict = Depends(require_superadmin)
):
    """Change a user's role. Superadmin only.

    Refuses to remove the last superadmin — including yourself — so the admin can
    never end up with nobody able to manage users.
    """
    if payload.role not in rbac.ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Use one of {list(rbac.ASSIGNABLE_ROLES)}",
        )
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if rbac.is_superadmin(target.get("role")) and not rbac.is_superadmin(payload.role):
        remaining = await db.users.count_documents(
            {"role": {"$in": list(rbac.SUPERADMIN_ROLES)}, "id": {"$ne": user_id}}
        )
        if remaining == 0:
            raise HTTPException(
                status_code=400,
                detail="This is the only superadmin — promote someone else first.",
            )

    # Changing role resets any bespoke section list back to that role's preset,
    # so a demoted account cannot keep permissions from its old tier.
    await db.users.update_one(
        {"id": user_id}, {"$set": {"role": payload.role}, "$unset": {"sections": ""}}
    )
    log.info(
        "Role changed: %s -> %s by %s", target.get("email"), payload.role, actor.get("email")
    )
    return {
        "ok": True,
        "id": user_id,
        "role": payload.role,
        "sections": list(rbac.ROLE_PRESETS.get(payload.role, ())),
    }


@admin_router.patch("/users/{user_id}/sections")
async def admin_set_user_sections(
    user_id: str, payload: AdminUserSections, actor: dict = Depends(require_superadmin)
):
    """Set exactly which admin sections a user can open. Superadmin only.

    Superadmins always hold every section, so their list is not editable — that
    keeps at least one account able to restore everyone else's access.
    """
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if rbac.is_superadmin(target.get("role")):
        raise HTTPException(
            status_code=400,
            detail="Superadmins always have every section. Change the role first to restrict them.",
        )

    clean = [s for s in payload.sections if s in rbac.SECTIONS]
    if "dashboard" not in clean:
        clean.append("dashboard")  # always needed for a usable landing page
    await db.users.update_one({"id": user_id}, {"$set": {"sections": clean}})
    log.info("Sections set for %s by %s: %s", target.get("email"), actor.get("email"), clean)
    return {"ok": True, "id": user_id, "sections": clean}


# ============== Contact / enquiry messages ==============

@admin_router.get("/messages")
async def admin_list_messages():
    return await db.contact_messages.find({}, {"_id": 0}).sort([("created_at", -1)]).to_list(1000)


@admin_router.delete("/messages/{msg_id}")
async def admin_delete_message(msg_id: str):
    r = await db.contact_messages.delete_one({"id": msg_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True}


# ============== Waitlists ==============

@admin_router.get("/waitlists")
async def admin_list_waitlists(source: Optional[str] = None):
    query = {"source": source} if source else {}
    entries = (
        await db.newsletter.find(query, {"_id": 0})
        .sort([("created_at", -1)])
        .to_list(2000)
    )
    counts = await db.newsletter.aggregate(
        [
            {"$group": {"_id": "$source", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
    ).to_list(50)
    summary = [{"source": (c["_id"] or "newsletter"), "count": c["count"]} for c in counts]
    return {"summary": summary, "entries": entries}


@admin_router.get("/waitlists/export.csv")
async def admin_export_waitlists(source: Optional[str] = None):
    from fastapi.responses import StreamingResponse  # local import (kept light)
    import csv  # noqa
    import io as _io  # noqa

    query = {"source": source} if source else {}
    entries = (
        await db.newsletter.find(query, {"_id": 0})
        .sort([("created_at", -1)])
        .to_list(10000)
    )

    buf = _io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["email", "source", "created_at"])
    for e in entries:
        writer.writerow([e.get("email", ""), e.get("source", ""), e.get("created_at", "")])
    buf.seek(0)
    filename = f"oakbridge-waitlist-{source or 'all'}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============== Resend receipt ==============

@admin_router.post("/orders/{order_id}/resend-receipt")
async def admin_resend_receipt(order_id: str):
    """Re-send the order receipt email to the customer on the order."""
    from emailer import send_order_receipt
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        order = await db.orders.find_one({"order_number": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if not order.get("email"):
        raise HTTPException(status_code=400, detail="Order has no email on file")
    pdf = None
    try:  # invoice is best-effort — never let it block the receipt email
        from invoice import build_order_invoice

        pdf = await build_order_invoice(db, order)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Invoice build failed for %s", order_id)
    ok = await send_order_receipt(order, invoice_pdf=pdf or None)
    return {"ok": ok, "to": order["email"]}


@admin_router.get("/orders/{order_id}/invoice.pdf")
async def admin_download_invoice(order_id: str):
    """Generate (or regenerate) the tax invoice PDF for an order and return it."""
    from fastapi.responses import Response

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        order = await db.orders.find_one({"order_number": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    pdf = b""
    try:
        from invoice import build_order_invoice

        pdf = await build_order_invoice(db, order)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Invoice generation failed for %s", order_id)
    if not pdf:
        raise HTTPException(
            status_code=503,
            detail="Invoice generator unavailable — is 'reportlab' installed on the server?",
        )
    inv = order.get("invoice_no") or order.get("order_number", "invoice")
    filename = f"Invoice-{str(inv).replace('/', '-')}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============== AI-drafted author bios ==============

@admin_router.post("/books/{book_id}/draft-author-bio")
async def admin_draft_author_bio(book_id: str):
    """Generate a polished 3-4 sentence author bio using the configured LLM (Ollama by default)."""
    bio = await _draft_bio_for_book_id(book_id)
    return {"author_bio": bio}


async def _draft_bio_for_book_id(book_id: str) -> str:
    book = await db.books.find_one({"id": book_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    from llm import generate as llm_generate, LLMError  # provider-agnostic (Ollama/Groq/OpenAI)

    system = (
        "You are a senior editorial copywriter for Oakbridge Publishing, a scholarly "
        "press in Gurugram, India. Draft polished, factual-sounding author bios of about "
        "60-90 words (3-4 sentences) for the back-flap of a serious reference title. "
        "Use formal but readable Indian English. Mention plausible academic or "
        "professional affiliations consistent with the subject. NEVER fabricate "
        "specific awards, university appointments or institutional affiliations that "
        "cannot be verified — keep claims general and plausible. End with a one-line "
        "statement of editorial focus. Return ONLY the bio paragraph as plain text — "
        "no quotation marks, no headings, no notes."
    )
    prompt = (
        f"Draft an author bio for the following book.\n\n"
        f"Title: {book.get('title', '')}\n"
        f"Subtitle: {book.get('subtitle') or '—'}\n"
        f"Author: {book.get('author', '')}\n"
        f"Subject area: {book.get('subject', '')} ({book.get('category', '')})\n"
        f"Description: {book.get('description', '')}\n"
    )
    try:
        bio = await llm_generate(system, prompt)
    except LLMError as e:
        log.exception("LLM bio drafting failed")
        raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    return (bio or "").strip().strip('"').strip("'")


@admin_router.post("/books/bulk-draft-author-bios")
async def admin_bulk_draft_author_bios(limit: int = 999, overwrite: bool = False):
    """
    Draft author bios for every book missing one (or all books if overwrite=true).
    Sequential to avoid overwhelming the LLM provider. Returns per-book results.
    """
    query = {} if overwrite else {
        "$or": [{"author_bio": None}, {"author_bio": ""}, {"author_bio": {"$exists": False}}],
    }
    books = await db.books.find(query, {"_id": 0, "id": 1, "title": 1}).limit(limit).to_list(limit)

    drafted, failed = 0, 0
    sample: list = []
    for b in books:
        try:
            bio = await _draft_bio_for_book_id(b["id"])
            if bio:
                await db.books.update_one({"id": b["id"]}, {"$set": {"author_bio": bio}})
                drafted += 1
                if len(sample) < 3:
                    sample.append({"title": b["title"], "bio": bio[:140] + "…"})
            else:
                failed += 1
        except Exception:  # noqa: BLE001
            log.exception("Bulk-bio failed for %s", b["id"])
            failed += 1

    return {
        "drafted": drafted,
        "failed": failed,
        "total_processed": len(books),
        "sample": sample,
    }
