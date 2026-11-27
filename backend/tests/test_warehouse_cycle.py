"""Count today + reprint soon (warehouse_cycle.py) on the fake DB, with the
REAL warehouse._inventory_rows underneath. Run: python backend/tests/test_warehouse_cycle.py"""
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(str(detail))
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: (lambda fn: fn)


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self):
        return dict(self.__dict__)


def _noop(*a, **k):
    return None


async def _anoop(*a, **k):
    return None

AUDIT = []


async def _audit(db, action, **k):
    AUDIT.append((action, k.get("meta")))

fastapi = _mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=_noop,
               File=_noop, Form=_noop, UploadFile=object, Header=_noop)
_mod("fastapi.responses", Response=object)
fastapi.responses = sys.modules["fastapi.responses"]
_mod("pydantic", BaseModel=BaseModel)
db = DB()
_mod("extensions", db=db, _notify_back_in_stock=_anoop, get_current_user=_noop, require_admin=_noop, require_superadmin=_noop)


async def _threshold():
    return 10

_mod("features", APP_NAME="oakbridge", delete_object=_noop, get_object=_noop, put_object=_noop, _low_stock_threshold=_threshold)
_mod("uploads_guard", is_pdf=_noop, read_limited=_anoop, sniff_image=_noop, require_safe_pdf=_noop)
_mod("audit", audit_log=_audit)
_mod("rbac", ADMIN_ROLES=("admin", "superadmin"), effective_sections=lambda u: ["warehouse"])

import order_stock  # noqa: E402
import warehouse as wh  # noqa: E402
import warehouse_cycle as C  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402


async def _owed(db, *a, **k):
    return {}

order_stock.owed_by_book = _owed


def ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def main():
    state = await wh.get_state()

    async def _live():
        return {**state, "mode": "live", "started_at": "2026-10-01T00:00:00+00:00"}
    wh.get_state = _live
    books = [
        {"id": "new", "title": "Never Counted", "stock": 0},
        {"id": "neg", "title": "Contract Drafting", "stock": 0, "wh_stock": -1},
        {"id": "mis", "title": "Mismatch", "stock": 96, "wh_stock": 0},
        {"id": "busy", "title": "Internal Security", "stock": 120, "wh_stock": 120},
        {"id": "fresh", "title": "Counted Last Week", "stock": 50, "wh_stock": 50},
        {"id": "quiet", "title": "Quiet Title", "stock": 400, "wh_stock": 400},
        {"id": "pre", "title": "A Pre-order", "stock": 0, "coming_soon": True, "launch_at": "2099-01-01T00:00:00+05:30"},
        {"id": "pk", "title": "A Pack", "product_type": "pack", "stock": 9},
    ]
    for b in books:
        await db.books.insert_one(dict(b))
    mv = [("busy", -60, "website_order", 20, ""), ("busy", -30, "amazon_mp", 40, ""), ("busy", 200, "correction_in", 80, "Counted in Admin: big count"),
          ("fresh", -10, "website_order", 5, ""), ("fresh", 0, "correction_in", 7, "Counted in Admin: weekly"),
          ("quiet", -500, "correction_out", 3, "Counted in Admin: miscount")]
    for i, (bid, q, r, d, note) in enumerate(mv):
        await db.stock_movements.insert_one({"id": f"m{i}", "book_id": bid, "qty": q, "reason": r, "at": ago(d), "note": note, "undone": False})

    print("-- count today --")
    r = await C.count_today(10)
    ids = [x["id"] for x in r["rows"]]
    whys = {x["id"]: x["why"] for x in r["rows"]}
    check(ids[:3] == ["new", "neg", "mis"], "never counted, then below zero, then website ≠ shelf")
    check(whys.get("busy", "").startswith("Busy title — 90 out in 90 days"), "a busy title not counted in 30 days is suggested")
    check("fresh" not in ids, "a title counted last week is not")
    check("pre" not in ids and "pk" not in ids and "quiet" not in ids, "pre-orders, packs and titles with nothing going out are left alone")
    check((await C.count_today(2))["rows"] == r["rows"][:2], "n limits the list")

    print("-- reprint soon --")
    r = await C.reprint(45)
    rows = {x["id"]: x for x in r["rows"]}
    # busy: 90 out in 60 days (the -60 at day 20 and -30 at day 40) -> 1.5/day; 120 on shelf -> 80 days: not within 45.
    check("busy" not in rows, "80 days of stock left is not flagged at 45")
    r = await C.reprint(90)
    rows = {x["id"]: x for x in r["rows"]}
    check(rows.get("busy", {}).get("days_left") == 80 and rows["busy"]["per_month"] == 45, "1.5 a day -> 45 a month, 80 days left")
    check("quiet" not in rows, "a count correction is not demand")
    check("fresh" not in rows, "300 days left is not flagged at 90")
    rows = {x["id"]: x for x in (await C.reprint(365))["rows"]}
    check(rows.get("fresh", {}).get("days_left") == 300, "10 out in 60 days, 50 on shelf -> 300 days")
    check("pre" not in rows and "pk" not in rows, "pre-orders and packs excluded")


asyncio.run(main())
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
