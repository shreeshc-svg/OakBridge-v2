"""Website stock back in step with the warehouse count (warehouse_match.py),
on the fake DB with the REAL warehouse state / adm_set_count alongside.
The 19 Nov 2026 case: Man & The Judge (HB) website 96, warehouse 0.
Run: python backend/tests/test_warehouse_match.py"""
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
import warehouse_match as M  # noqa: E402

SUPER = {"email": "boss@oakbridge.in", "role": "superadmin"}
PHONE = {"email": "warehouse@oakbridge.in", "role": "warehouse"}
OWED = {}


async def _owed(db, *a, **k):
    return dict(OWED)

order_stock.owed_by_book = _owed


async def expect(coro, status, label):
    try:
        await coro
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")
        return
    check(False, f"{label} (no error)")


async def main():
    check(M.target_stock(0, 0, False) == 0 and M.target_stock(5, 2, False) == 7 and M.target_stock(-2, 2, False) == 0
          and M.target_stock(-5, 2, False) == 0 and M.target_stock(10, 0, True) == 0,
          "website = warehouse + owed to waiting orders, never below 0, 0 for a pre-order")
    await db.books.insert_one({"id": "hb", "title": "Justice M N Venkatachaliah - The Man & The Judge", "isbn": "9788194991120",
                               "binding": "Hardback", "stock": 96, "wh_stock": 0})
    state = await wh.get_state()
    # Live mode (the real state lives in settings; set it for both modules).
    async def _live():
        return {**state, "mode": "live", "started_at": "2026-10-01T00:00:00+00:00"}
    M.get_state = _live
    wh.get_state = _live

    print("-- the loop the admin was stuck in (both tools move both numbers) --")
    await wh.record_admin_stock_edit("hb", 96, 0)               # Admin → Inventory: typed 0
    await db.books.update_one({"id": "hb"}, {"$set": {"stock": 0}})
    b = await db.books.find_one({"id": "hb"})
    check(b["stock"] == 0 and b["wh_stock"] == -96, "typing 0 on the website pushes the warehouse to -96")
    await wh.adm_set_count("hb", wh.CountBody(count=0, note="shelf counted"), SUPER)   # Warehouse: counted 0
    b = await db.books.find_one({"id": "hb"})
    check(b["stock"] == 96 and b["wh_stock"] == 0, "counting 0 adds 96 to BOTH: website back to 96 — never 0 / 0")

    print("-- the fix --")
    await expect(M.match_website("hb", M.MatchBody(note="x"), SUPER), 400, "a reason is required")
    await expect(M.match_website("hb", M.MatchBody(note="website showed 96, shelf has none"), PHONE), 403, "not from the warehouse phone login")
    moves_before = len(db.stock_movements.docs)
    r = await M.match_website("hb", M.MatchBody(note="website showed 96, shelf has none"), SUPER)
    b = await db.books.find_one({"id": "hb"})
    check(r["before"] == 96 and r["stock"] == 0 and b["stock"] == 0 and b["wh_stock"] == 0, "website 0 and warehouse 0 — in step")
    check(len(db.stock_movements.docs) == moves_before, "no ledger movement written (nothing physical moved)")
    check(AUDIT[-1][0] == "WAREHOUSE_WEBSITE_MATCHED" and AUDIT[-1][1]["website_before"] == 96 and AUDIT[-1][1]["website_after"] == 0, "audited: before / after / why")
    r = await M.match_website("hb", M.MatchBody(note="again"), SUPER)
    check(r.get("unchanged"), "already in step: nothing changes")

    print("-- set both in one go (19 Nov: warehouse -96, website 0) --")
    await db.books.update_one({"id": "hb"}, {"$set": {"stock": 0, "wh_stock": -96}})
    M.get_state = _live
    await expect(M.set_both("hb", M.BothBody(count=0, note="x"), SUPER), 400, "a reason is required")
    await expect(M.set_both("hb", M.BothBody(count=-1, note="none on the shelf"), SUPER), 400, "no negative counts")
    r = await M.set_both("hb", M.BothBody(count=0, note="none on the shelf"), SUPER)
    b = await db.books.find_one({"id": "hb"})
    check(b["wh_stock"] == 0 and b["stock"] == 0 and r["stock"] == 0 and r["wh_stock"] == 0, "warehouse 0 AND website 0")
    check([a for a, _ in AUDIT[-2:]] == ["WAREHOUSE_COUNT_SET", "WAREHOUSE_WEBSITE_MATCHED"], "both steps logged")
    r = await M.set_both("hb", M.BothBody(count=12, note="12 found in the back room"), SUPER)
    b = await db.books.find_one({"id": "hb"})
    check(b["wh_stock"] == 12 and b["stock"] == 12, "and any other number: both 12")

    print("-- waiting orders and pre-orders --")
    await db.books.insert_one({"id": "w", "title": "Waiting", "stock": 9, "wh_stock": -2})
    OWED["w"] = 2
    r = await M.match_website("w", M.MatchBody(note="mismatch"), SUPER)
    check(r["stock"] == 0, "-2 that is 2 owed copies -> website 0, not negative")
    await db.books.insert_one({"id": "p", "title": "Pre", "stock": 4, "wh_stock": 10, "coming_soon": True})
    check((await M.match_website("p", M.MatchBody(note="mismatch"), SUPER))["stock"] == 0, "pre-order stays at 0")
    await db.books.insert_one({"id": "n", "title": "Never counted", "stock": 4})
    await expect(M.match_website("n", M.MatchBody(note="mismatch"), SUPER), 409, "never counted: count it first")

    async def _trial():
        return {**state, "mode": "trial"}
    M.get_state = _trial
    await expect(M.match_website("hb", M.MatchBody(note="mismatch"), SUPER), 409, "trial mode: the website follows the sheet")


asyncio.run(main())
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
