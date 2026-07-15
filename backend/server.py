from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Oakbridge Publishing API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Extensions (auth, admin, authors, desk-copies, reviews)
from extensions import (
    auth_router,
    admin_router,
    extras_router,
    get_current_user_optional,
    seed_admin,
    seed_authors,
    ensure_indexes,
)

# Features (coupons, ebooks, inventory, submissions)
from features import (
    public_router as features_public_router,
    customer_router as features_customer_router,
    admin_router as features_admin_router,
    init_storage,
    seed_coupons,
    ensure_feature_indexes,
    tasks_router as features_tasks_router,
)


def _decorate_book(doc: dict) -> dict:
    """Annotate raw book doc with has_ebook based on presence of ebook_path."""
    if doc is not None:
        doc["has_ebook"] = bool(doc.get("ebook_path"))
    return doc


# ============== MODELS ==============

class Book(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    subtitle: Optional[str] = None
    author: str
    author_bio: Optional[str] = None
    author_photo: Optional[str] = None
    isbn: str
    category: str  # school | higher-ed | professional | test-prep | children
    subject: str
    grade: Optional[str] = None
    binding: Optional[str] = None  # read-only spec (e.g. "Hardcover"), shown in Specs tab
    size: Optional[str] = None     # read-only spec (e.g. "6.5 x 9.5 in"), shown in Specs tab
    description: str
    price: float
    original_price: Optional[float] = None
    cover_image: str
    pages: int
    language: str = "English"
    publisher: str = "Oakbridge Publishing"
    publication_year: int = 2024
    bestseller: bool = False
    new_release: bool = False
    rating: float = 4.5
    stock: int = 100
    has_ebook: bool = False
    variants: list = Field(default_factory=list)  # [{binding,size,price,mrp?,stock?}]


class Category(BaseModel):
    id: str
    name: str
    description: str
    image: str
    book_count: int = 0


class NewsletterSignup(BaseModel):
    email: EmailStr
    source: Optional[str] = None


class NewsletterResponse(BaseModel):
    id: str
    email: str
    created_at: str


class ContactMessage(BaseModel):
    name: str
    email: EmailStr
    subject: str
    message: str


class ContactResponse(BaseModel):
    id: str
    name: str
    email: str
    subject: str
    created_at: str


class CartItem(BaseModel):
    book_id: str
    title: str
    author: str
    cover_image: str
    price: float
    quantity: int
    binding: Optional[str] = None
    size: Optional[str] = None


class OrderCreate(BaseModel):
    full_name: str
    email: EmailStr
    phone: str
    address_line1: str
    address_line2: Optional[str] = ""
    city: str
    state: str
    pincode: str
    items: List[CartItem]
    subtotal: float
    shipping: float
    tax: float
    total: float
    notes: Optional[str] = ""
    coupon_code: Optional[str] = None
    discount: Optional[float] = 0


class Order(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    order_number: str
    user_id: Optional[str] = None
    full_name: str
    email: str
    phone: str
    address_line1: str
    address_line2: str = ""
    city: str
    state: str
    pincode: str
    items: List[CartItem]
    subtotal: float
    shipping: float
    tax: float
    total: float
    notes: str = ""
    coupon_code: Optional[str] = None
    discount: float = 0
    status: str = "pending"
    payment_status: str = "pending"  # pending | paid | failed
    payment_provider: Optional[str] = None
    rzp_order_id: Optional[str] = None
    rzp_payment_id: Optional[str] = None
    paid_at: Optional[str] = None
    created_at: str


# ============== SEED DATA ==============

CATEGORIES_SEED = [
    {
        "id": "academic",
        "name": "Academic",
        "description": "Scholarly textbooks and reference works for Civil Services, UPSC and university programmes — economics, psychology, history, geography, general studies and more.",
        "image": "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=85",
    },
    {
        "id": "professional",
        "name": "Professional",
        "description": "Authoritative law and tax titles — commentaries, treatises and practitioner guides across constitutional, corporate, IP, arbitration and taxation law.",
        "image": "https://images.unsplash.com/photo-1589994965851-a8f479c573a9?auto=format&fit=crop&w=1200&q=85",
    },
    {
        "id": "bgr",
        "name": "Business & General",
        "description": "Business, governance, leadership and general-interest titles — from management and public policy to biographies and general reading.",
        "image": "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1200&q=85",
    },
]

BOOK_COVERS = [
    "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1543002588-bfa74002ed7e?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1491841550275-ad7854e35ca6?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1589829085413-56de8ae18c73?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1621827979802-6d778e161b28?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1531072901881-d644216d4bf9?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1592496431122-2349e0fbc666?auto=format&fit=crop&w=600&q=80",
    "https://images.unsplash.com/photo-1535905557558-afc4877a26fc?auto=format&fit=crop&w=600&q=80",
]


def _cover(i: int) -> str:
    return BOOK_COVERS[i % len(BOOK_COVERS)]


BOOKS_SEED = [
    # Academic
    {"title": "Principles of Economics", "subtitle": "An Indian Perspective", "author": "Prof. Kaushik Banerjee", "category": "academic", "subject": "Economics", "description": "A rigorous introduction to micro and macroeconomics calibrated for Indian undergraduate programmes, with case studies from Indian policy.", "price": 895, "original_price": 1050, "pages": 624, "bestseller": True},
    {"title": "Organic Chemistry", "subtitle": "Mechanisms & Synthesis", "author": "Dr. Neha Saxena", "category": "academic", "subject": "Chemistry", "description": "Graduate-level organic chemistry with deep coverage of reaction mechanisms, retrosynthesis and modern spectroscopic methods.", "price": 1250, "pages": 912},
    {"title": "Engineering Mathematics III", "author": "Dr. Meera Krishnan", "category": "academic", "subject": "Mathematics", "description": "Complex analysis, Fourier series, probability and statistics — structured for the third-semester BE/BTech curriculum.", "price": 649, "pages": 478, "new_release": True},
    {"title": "Introductory Microbiology", "author": "Dr. Harshad Desai", "category": "academic", "subject": "Biology", "description": "A visually rich microbiology textbook covering bacteriology, virology, mycology and the emerging microbiome sciences.", "price": 995, "pages": 680, "bestseller": True},
    {"title": "Modern Indian History", "subtitle": "1857 to the Present", "author": "Prof. Ananya Ghosh", "category": "academic", "subject": "History", "description": "A narrative-driven survey of Indian history from the Revolt of 1857 through the post-liberalisation decades.", "price": 820, "pages": 596},
    {"title": "Data Structures in C++", "author": "Dr. Sanjay Bhatia", "category": "academic", "subject": "Computer Science", "description": "A hands-on textbook for second-year engineering students. Includes 200+ solved problems and a complete STL reference.", "price": 749, "original_price": 899, "pages": 512},

    # Law
    {"title": "Constitutional Law of India", "subtitle": "Commentary & Cases", "author": "Justice R. Venkatachari (Retd.)", "category": "law", "subject": "Constitutional Law", "description": "A definitive commentary on the Constitution of India with over 1200 leading judgments analysed chronologically.", "price": 2450, "original_price": 2795, "pages": 1480, "bestseller": True},
    {"title": "Corporate Law Essentials", "author": "Adv. Pooja Chandra", "category": "law", "subject": "Corporate Law", "description": "Companies Act, SEBI regulations and the evolving compliance landscape — written for in-house counsel and CS aspirants.", "price": 1350, "pages": 720, "bestseller": True},
    {"title": "Criminal Procedure Code", "subtitle": "Practitioner's Guide", "author": "Adv. Harish Narula", "category": "law", "subject": "Criminal Law", "description": "Section-by-section commentary on the CrPC with recent Supreme Court and High Court rulings.", "price": 1895, "pages": 1120},
    {"title": "Intellectual Property Law", "author": "Dr. Shalini Menon", "category": "law", "subject": "IP Law", "description": "Patents, trademarks, copyrights and designs in the Indian and international context.", "price": 1495, "pages": 820, "new_release": True},
    {"title": "Family Law & Succession", "author": "Prof. Kamla Raghavan", "category": "law", "subject": "Family Law", "description": "Hindu, Muslim, Christian and Parsi personal laws alongside the Special Marriage Act, with landmark case law.", "price": 1195, "pages": 680},
    {"title": "Contract Act & Specific Relief", "author": "Adv. Malvika Sinha", "category": "law", "subject": "Contract Law", "description": "A clause-by-clause treatise on the Indian Contract Act and the Specific Relief Act with commercial illustrations.", "price": 1695, "original_price": 1895, "pages": 980},

    # Tax
    {"title": "Direct Tax Law & Practice", "subtitle": "AY 2025-26", "author": "CA Rajiv Khanna", "category": "tax", "subject": "Direct Tax", "description": "Comprehensive Income-tax commentary updated for the latest Finance Act, with 400+ illustrations and rulings.", "price": 1950, "original_price": 2250, "pages": 1620, "bestseller": True},
    {"title": "GST: Complete Commentary", "author": "CA Neeraj Bansal", "category": "tax", "subject": "GST", "description": "Section-by-section CGST/IGST commentary with sector-specific FAQs and departmental notifications.", "price": 2250, "pages": 1780, "bestseller": True},
    {"title": "International Taxation", "subtitle": "Treaties & Transfer Pricing", "author": "Dr. Ashish Goyal", "category": "tax", "subject": "International Tax", "description": "DTAA interpretation, OECD guidelines and Indian transfer pricing practice with 150+ international case studies.", "price": 2895, "pages": 1240, "new_release": True},
    {"title": "Tax Audit Handbook", "author": "CA Meera Iyer", "category": "tax", "subject": "Audit", "description": "Form 3CD clause analysis, audit documentation and reporting standards, with checklists for every business type.", "price": 1295, "pages": 720},
    {"title": "Customs Law & Procedures", "author": "Shri P. K. Mohanty (IRS Retd.)", "category": "tax", "subject": "Customs", "description": "Practical guide to the Customs Act, valuation, classification and SEZ/EOU schemes.", "price": 1595, "pages": 860},

    # Business
    {"title": "Financial Accounting for Managers", "author": "CA Rohit Malhotra", "category": "business", "subject": "Finance", "description": "Practical accounting for non-accountants — written for MBA students and professionals stepping into leadership roles.", "price": 1150, "original_price": 1350, "pages": 544, "bestseller": True},
    {"title": "Strategic Marketing", "subtitle": "Indian Case Studies", "author": "Prof. Ishan Dutta", "category": "business", "subject": "Marketing", "description": "20+ original Indian case studies alongside frameworks for brand, channel and digital strategy.", "price": 1095, "pages": 488, "new_release": True},
    {"title": "Project Management Playbook", "author": "Dr. Aarti Nair", "category": "business", "subject": "Management", "description": "Agile, waterfall and hybrid methodologies — distilled into actionable playbooks for delivery managers.", "price": 999, "pages": 420},
    {"title": "Founder's Guide to Scale", "author": "Nikhil Shetty", "category": "business", "subject": "Entrepreneurship", "description": "From seed to Series B — how Indian founders have built category-defining businesses. 30 practitioner interviews.", "price": 849, "pages": 360, "bestseller": True},
    {"title": "Leadership in Turbulent Times", "author": "Dr. Vandana Murthy", "category": "business", "subject": "Leadership", "description": "Evidence-based playbooks for leaders navigating transformation, layoffs and cultural change.", "price": 895, "pages": 312, "new_release": True},

    # General & Reference
    {"title": "Oakbridge Concise Encyclopedia", "author": "Editorial Board", "category": "general-reference", "subject": "Encyclopedia", "description": "A single-volume, India-first encyclopedia with 12,000+ entries across arts, sciences, biography and history.", "price": 2495, "pages": 1680, "bestseller": True},
    {"title": "English Dictionary & Thesaurus", "author": "Editorial Board", "category": "general-reference", "subject": "Dictionary", "description": "Over 70,000 headwords with pronunciation, etymology and usage notes calibrated for Indian English.", "price": 795, "original_price": 895, "pages": 1280},
    {"title": "Oakbridge World Atlas", "subtitle": "Premium Edition", "author": "Cartographic Team", "category": "general-reference", "subject": "Atlas", "description": "200+ full-colour maps of countries, regions and thematic topics — updated political boundaries and climate data.", "price": 1195, "pages": 320, "new_release": True},
    {"title": "Yearbook of India 2026", "author": "Research Staff", "category": "general-reference", "subject": "Yearbook", "description": "Statistics, profiles and developments across government, economy, sports and culture for the past year.", "price": 595, "pages": 680},
    {"title": "Oxford-style Scientific Terms", "author": "Dr. S. Bhattacharya", "category": "general-reference", "subject": "Reference", "description": "An A-to-Z reference of 15,000 scientific terms across physics, chemistry, biology and earth sciences.", "price": 995, "pages": 780},

    # Professional
    {"title": "Clinical Pharmacology Handbook", "author": "Dr. Vivek Rao, MD", "category": "professional", "subject": "Medical", "description": "A bedside reference for practising clinicians. Drug interactions, dosing guides and differential decision trees.", "price": 1750, "pages": 864},
    {"title": "Machine Learning Engineering", "author": "Abhishek Verma", "category": "professional", "subject": "Technology", "description": "A practitioner's guide to deploying, monitoring and scaling ML systems in production environments.", "price": 1499, "original_price": 1799, "pages": 576, "bestseller": True},
    {"title": "HVAC Systems Design", "author": "Er. Sunil Phadke", "category": "professional", "subject": "Engineering", "description": "A design-first reference for mechanical engineers working on commercial HVAC and refrigeration systems.", "price": 1895, "pages": 720},
    {"title": "Clinical Research in India", "author": "Dr. Nandita Kapoor", "category": "professional", "subject": "Medical", "description": "Regulatory landscape, trial design and site operations for clinical research professionals.", "price": 1395, "pages": 540, "new_release": True},

    # Test Prep
    {"title": "JEE Advanced Physics", "subtitle": "Complete Reference", "author": "HC Mathur & Team", "category": "test-prep", "subject": "Physics", "description": "The definitive JEE Advanced physics reference with 3000+ problems, previous-year solutions and conceptual masterclasses.", "price": 899, "original_price": 1099, "pages": 1024, "bestseller": True},
    {"title": "NEET Biology Master", "author": "Dr. Sunita Rao", "category": "test-prep", "subject": "Biology", "description": "Chapter-wise theory, NCERT mapping and 5000+ NEET-style MCQs with detailed explanations.", "price": 799, "pages": 896, "bestseller": True},
    {"title": "CAT Quantitative Aptitude", "author": "Arun Sharma (Oakbridge ed.)", "category": "test-prep", "subject": "Quantitative", "description": "Structured 12-week CAT preparation across arithmetic, algebra, geometry and modern math.", "price": 725, "pages": 612},
    {"title": "UPSC General Studies Vol. I", "author": "Dr. Rajiv Menon", "category": "test-prep", "subject": "General Studies", "description": "Indian history, geography, polity and economy — curated for UPSC Prelims and Mains aspirants.", "price": 650, "original_price": 799, "pages": 720, "new_release": True},
    {"title": "GRE Verbal Reasoning", "author": "Oakbridge Test Prep", "category": "test-prep", "subject": "Verbal", "description": "A strategy-first approach to GRE Verbal, including reading comprehension drills and a 2000-word high-frequency list.", "price": 599, "pages": 384},
    {"title": "GMAT Focus Edition Guide", "author": "Oakbridge Test Prep", "category": "test-prep", "subject": "GMAT", "description": "Aligned with the GMAT Focus format — quantitative, verbal and data insights — with four full-length practice tests.", "price": 849, "pages": 520, "new_release": True},

    # Children's
    {"title": "The Moonlit Owl", "subtitle": "A Forest Story", "author": "Tara Banerjee", "category": "children", "subject": "Picture Book", "grade": "Ages 4-7", "description": "A lyrical picture book about a curious owlet who discovers the magic of asking questions.", "price": 299, "pages": 32, "bestseller": True},
    {"title": "Maya and the Monsoon", "author": "Rohan Kapoor", "category": "children", "subject": "Early Reader", "grade": "Ages 6-9", "description": "A chapter book about a little girl in Kerala who befriends a cloud during the monsoon.", "price": 349, "original_price": 425, "pages": 96, "new_release": True},
    {"title": "Illustrated Indian Folktales", "author": "Various", "category": "children", "subject": "Folklore", "grade": "Ages 8-12", "description": "Twenty richly illustrated folktales from across India — from Panchatantra to lesser-known regional stories.", "price": 499, "pages": 184, "bestseller": True},
    {"title": "Numbers & Patterns", "subtitle": "Kindergarten Workbook", "author": "Oakbridge Early Learning", "category": "children", "subject": "Mathematics", "grade": "Kindergarten", "description": "A playful workbook with 120 activities to build early numeracy and pattern recognition.", "price": 225, "pages": 108},
    {"title": "My First Atlas", "author": "Dr. Shalini Bose", "category": "children", "subject": "Geography", "grade": "Ages 7-10", "description": "A beautifully illustrated atlas of the world tailored for young readers with cultural highlights from every continent.", "price": 549, "original_price": 649, "pages": 80, "new_release": True},
    {"title": "The Science Detective", "author": "Vikas Naidu", "category": "children", "subject": "Science", "grade": "Ages 9-12", "description": "Puzzle-driven stories that teach children the scientific method through everyday mysteries.", "price": 375, "pages": 156},
]


async def seed_data():
    """Seed books if empty, and reconcile categories to the canonical set on every startup."""
    # Reconcile categories: upsert the canonical set and remove any stale ones.
    # This self-heals databases seeded under an older category taxonomy.
    canonical_ids = [c["id"] for c in CATEGORIES_SEED]
    for c in CATEGORIES_SEED:
        # Update name/description on every boot, but only seed the image on first
        # insert so admin-set category images survive restarts.
        await db.categories.update_one(
            {"id": c["id"]},
            {"$set": {"id": c["id"], "name": c["name"], "description": c["description"]},
             "$setOnInsert": {"image": c["image"]}},
            upsert=True,
        )
    removed = await db.categories.delete_many({"id": {"$nin": canonical_ids}})
    logger.info(
        f"Reconciled {len(CATEGORIES_SEED)} categories "
        f"(removed {removed.deleted_count} stale)"
    )

    book_count = await db.books.count_documents({})
    if book_count == 0:
        docs = []
        for i, b in enumerate(BOOKS_SEED):
            book = Book(
                **b,
                isbn=f"978-81-{7000+i:04d}-{(i*13)%100:02d}-{i%10}",
                cover_image=_cover(i),
            )
            docs.append(book.model_dump())
        await db.books.insert_many(docs)
        logger.info(f"Seeded {len(docs)} books")


@app.on_event("startup")
async def startup_event():
    await seed_data()
    await seed_admin()
    await seed_authors()
    await seed_coupons()
    await ensure_indexes()
    await ensure_feature_indexes()
    init_storage()


# ============== ROUTES ==============

@api_router.get("/")
async def root():
    return {"message": "Oakbridge Publishing API", "status": "ok"}


@api_router.get("/categories", response_model=List[Category])
async def list_categories():
    cats = await db.categories.find({}, {"_id": 0}).to_list(100)
    # Compute book counts
    for c in cats:
        c["book_count"] = await db.books.count_documents({"category": c["id"]})
    return cats


@api_router.get("/books", response_model=List[Book])
async def list_books(
    category: Optional[str] = None,
    subject: Optional[str] = None,
    search: Optional[str] = None,
    bestseller: Optional[bool] = None,
    new_release: Optional[bool] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    sort: Optional[str] = Query("featured", description="featured | price_asc | price_desc | title | rating_desc | newest"),
    limit: int = 60,
    skip: int = 0,
):
    query = {}
    if category:
        query["category"] = category
    if subject:
        query["subject"] = subject
    if bestseller is not None:
        query["bestseller"] = bestseller
    if new_release is not None:
        query["new_release"] = new_release
    price_q = {}
    if min_price is not None:
        price_q["$gte"] = min_price
    if max_price is not None:
        price_q["$lte"] = max_price
    if price_q:
        query["price"] = price_q
    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"author": {"$regex": search, "$options": "i"}},
            {"subject": {"$regex": search, "$options": "i"}},
            {"isbn": {"$regex": search, "$options": "i"}},
        ]

    sort_map = {
        "price_asc": [("price", 1)],
        "price_desc": [("price", -1)],
        "title": [("title", 1)],
        "rating_desc": [("rating", -1)],
        "newest": [("created_at", -1)],
        "new_arrivals": [("new_release", -1), ("created_at", -1)],
        "featured": [("bestseller", -1), ("new_release", -1), ("rating", -1)],
    }
    cursor = db.books.find(query, {"_id": 0}).sort(sort_map.get(sort, sort_map["featured"])).skip(skip).limit(limit)
    docs = await cursor.to_list(limit)
    return [_decorate_book(d) for d in docs]


@api_router.get("/books/featured", response_model=List[Book])
async def featured_books(limit: int = 8):
    cursor = db.books.find({"bestseller": True}, {"_id": 0}).limit(limit)
    docs = await cursor.to_list(limit)
    return [_decorate_book(d) for d in docs]


@api_router.get("/books/new-releases", response_model=List[Book])
async def new_release_books(limit: int = 8):
    cursor = db.books.find({"new_release": True}, {"_id": 0}).limit(limit)
    docs = await cursor.to_list(limit)
    return [_decorate_book(d) for d in docs]


@api_router.get("/books/bestsellers", response_model=List[Book])
async def bestseller_books(limit: int = 12, days: int = 90):
    """Real bestsellers ranked by units actually sold (paid orders in the last `days`).
    Admin curation is layered on top: any `home_bestsellers` ids are pinned to the front
    and `home_bestsellers_excluded` ids are removed. Falls back to bestseller-flagged /
    new / top-rated titles for cold start so the row is never empty."""
    sdocs = await db.settings.find(
        {"key": {"$in": ["home_bestsellers", "home_bestsellers_excluded"]}}, {"_id": 0}
    ).to_list(10)
    smap = {d["key"]: d["value"] for d in sdocs}
    pinned = smap.get("home_bestsellers") or []
    excluded = set(smap.get("home_bestsellers_excluded") or [])

    # Sales ranking from paid orders within the window.
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    ranked_ids = []
    try:
        agg = await db.orders.aggregate([
            {"$match": {"payment_status": "paid", "created_at": {"$gte": since}}},
            {"$unwind": "$items"},
            {"$group": {"_id": "$items.book_id", "units": {"$sum": "$items.quantity"}}},
            {"$sort": {"units": -1}},
            {"$limit": 60},
        ]).to_list(60)
        ranked_ids = [a["_id"] for a in agg if a.get("_id")]
    except Exception:  # noqa: BLE001
        ranked_ids = []

    ordered, seen = [], set()
    for bid in list(pinned) + ranked_ids:
        if bid and bid not in seen and bid not in excluded:
            seen.add(bid)
            ordered.append(bid)

    # Cold-start / top-up fallback.
    if len(ordered) < limit:
        fillers = await db.books.find(
            {"id": {"$nin": list(seen | excluded)}}, {"_id": 0, "id": 1}
        ).sort([("bestseller", -1), ("new_release", -1), ("rating", -1)]).limit(limit * 3).to_list(limit * 3)
        for f in fillers:
            if len(ordered) >= limit:
                break
            if f["id"] not in seen and f["id"] not in excluded:
                seen.add(f["id"])
                ordered.append(f["id"])

    ordered = ordered[:limit]
    docs = await db.books.find({"id": {"$in": ordered}}, {"_id": 0}).to_list(len(ordered) or 1)
    by_id = {d["id"]: d for d in docs}
    return [_decorate_book(by_id[i]) for i in ordered if i in by_id]


@api_router.get("/books/{book_id}", response_model=Book)
async def get_book(book_id: str):
    book = await db.books.find_one({"id": book_id}, {"_id": 0})
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return _decorate_book(book)


@api_router.post("/newsletter", response_model=NewsletterResponse)
async def newsletter_signup(payload: NewsletterSignup):
    existing = await db.newsletter.find_one({"email": payload.email}, {"_id": 0})
    if existing:
        return NewsletterResponse(**existing)
    doc = {
        "id": str(uuid.uuid4()),
        "email": payload.email,
        "source": payload.source or "newsletter",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.newsletter.insert_one({**doc})

    # Best-effort welcome email (never blocks signup if email fails)
    try:
        from emailer import send_waitlist_welcome
        await send_waitlist_welcome(payload.email, doc["source"])
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Welcome email failed for %s", payload.email)

    return NewsletterResponse(**doc)


@api_router.post("/contact", response_model=ContactResponse)
async def contact_submit(payload: ContactMessage):
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "email": payload.email,
        "subject": payload.subject,
        "message": payload.message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.contact_messages.insert_one({**doc})
    try:
        from emailer import send_contact_admin_alert, send_contact_ack

        await send_contact_admin_alert(doc)
        await send_contact_ack(doc)
    except Exception:  # noqa: BLE001
        logger.exception("contact email failed for %s", doc.get("email"))
    return ContactResponse(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        subject=doc["subject"],
        created_at=doc["created_at"],
    )


SETTINGS_DEFAULTS = {
    "tax_percent": 5,
    "free_ship_threshold": 1500,
    "ship_flat": 60,
    "pdp_shipping": "Free shipping on orders over \u20b91,500",
    "pdp_delivery": "3\u20137 business days",
    "pdp_returns": "14-day returns",
    "binding_options": ["Hardcover", "Softcover"],
    "size_options": ["Demi", "Royal", "Crown"],
}


async def _get_settings() -> dict:
    docs = await db.settings.find({}, {"_id": 0}).to_list(200)
    return {**SETTINGS_DEFAULTS, **{d["key"]: d["value"] for d in docs}}


def _variant_price(bdoc: dict, binding, size) -> float:
    base = float(bdoc.get("price", 0) or 0)
    if not (binding or size):
        return base
    for v in (bdoc.get("variants") or []):
        if v.get("binding") == binding and v.get("size") == size and v.get("price") not in (None, ""):
            return float(v["price"])
    return base


@api_router.post("/orders", response_model=Order)
async def create_order(payload: OrderCreate, user: Optional[dict] = Depends(get_current_user_optional)):
    # Fallback verification gate: a signed-in but unverified account must verify
    # (email/phone OTP) before placing an order. Browsing stays fully open.
    if user and not user.get("email_verified"):
        raise HTTPException(
            status_code=403,
            detail="Please verify your account (check for your verification code) before placing an order.",
        )
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    # Load authoritative book data and guard availability. Prices, titles and
    # covers come from the DB, never the client, so totals cannot be tampered with.
    books_by_id = {}
    shortages = []
    for it in payload.items:
        if it.quantity <= 0:
            raise HTTPException(status_code=400, detail="Invalid quantity")
        bdoc = await db.books.find_one(
            {"id": it.book_id},
            {"_id": 0, "id": 1, "title": 1, "author": 1, "cover_image": 1, "price": 1, "stock": 1, "variants": 1},
        )
        if not bdoc:
            raise HTTPException(status_code=404, detail=f"Book not found: {it.book_id}")
        books_by_id[it.book_id] = bdoc
        avail = int(bdoc.get("stock", 0) or 0)
        if it.quantity > avail:
            shortages.append({"title": bdoc.get("title", "Item"), "requested": it.quantity, "available": avail})
    if shortages:
        raise HTTPException(
            status_code=409,
            detail={"message": "Some items are out of stock or exceed available quantity.", "items": shortages},
        )

    # Rebuild line items from DB prices (ignore any client-supplied price/subtotal/total).
    server_items = []
    for it in payload.items:
        b = books_by_id[it.book_id]
        server_items.append(CartItem(
            book_id=it.book_id,
            title=b["title"],
            author=b.get("author", ""),
            cover_image=b.get("cover_image", ""),
            price=_variant_price(b, it.binding, it.size),
            quantity=it.quantity,
            binding=it.binding,
            size=it.size,
        ))
    subtotal = round(sum(i.price * i.quantity for i in server_items), 2)

    # Re-validate the coupon server-side; never trust a client-supplied discount.
    discount = 0.0
    coupon_code = None
    if payload.coupon_code:
        from features import validate_coupon, CouponValidateRequest  # local import avoids import cycle
        cres = await validate_coupon(CouponValidateRequest(code=payload.coupon_code, subtotal=subtotal))
        if cres.valid:
            discount = float(cres.discount)
            coupon_code = cres.code

    settings = await _get_settings()
    tax_pct = float(settings.get("tax_percent", 5) or 0)
    free_thr = float(settings.get("free_ship_threshold", 1500) or 0)
    ship_flat = float(settings.get("ship_flat", 60) or 0)
    discounted = max(0.0, subtotal - discount)
    shipping = 0.0 if discounted <= 0 else (0.0 if discounted > free_thr else ship_flat)
    tax = float(round(discounted * tax_pct / 100.0))
    total = round(discounted + shipping + tax, 2)

    order_number = "OAK-" + datetime.now(timezone.utc).strftime("%y%m%d") + "-" + uuid.uuid4().hex[:6].upper()
    order = Order(
        order_number=order_number,
        user_id=(user or {}).get("id"),
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        address_line1=payload.address_line1,
        address_line2=payload.address_line2 or "",
        city=payload.city,
        state=payload.state,
        pincode=payload.pincode,
        items=server_items,
        subtotal=subtotal,
        shipping=shipping,
        tax=tax,
        total=total,
        coupon_code=coupon_code,
        discount=discount,
        notes=payload.notes or "",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    doc = order.model_dump()
    await db.orders.insert_one({**doc})
    if user:
        await db.carts.update_one(
            {"user_id": user["id"]},
            {"$set": {"items": [], "updated_at": datetime.now(timezone.utc).isoformat(), "reminders_sent": []}},
            upsert=True,
        )
    return order


@api_router.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        order = await db.orders.find_one({"order_number": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


app.include_router(api_router)
app.include_router(auth_router)
app.include_router(extras_router)
app.include_router(admin_router)
app.include_router(features_public_router)
app.include_router(features_customer_router)
from payments import payments_router, webhooks_router  # noqa: E402
app.include_router(payments_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
app.include_router(features_admin_router)
app.include_router(features_tasks_router)
from inventory_sync import inventory_router  # noqa: E402
app.include_router(inventory_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',') if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
