"""A shipped carton that came back undelivered (warehouse_undeliver.py), on
the fake DB with the REAL warehouse.adm_delete_doc / _reverse underneath.
Run: python backend/tests/test_warehouse_undeliver.py"""
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

import warehouse_undeliver as U  # noqa: E402

SUPER = {"email": "boss@oakbridge.in", "role": "superadmin"}
PHONE = {"email": "warehouse@oakbridge.in", "role": "warehouse"}
NOTE = U.NotDeliveredBody(note="Delivery missed at the last moment — sending by courier instead.")


async def expect(coro, status, label):
    try:
        await coro
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")
        return
    check(False, f"{label} (no error)")


async def main():
    # Commercial Mediation Monograph: 20 on the shelf before the carton; 3 went out.
    await db.books.insert_one({"id": "cmm", "title": "The Commercial Mediation Monograph", "stock": 17, "wh_stock": 17})
    await db.warehouse_docs.insert_one({"id": "d1", "doc_number": "P/2026-27/0634", "direction": "out", "status": "confirmed",
                                        "party_name": "Standard Book Agency", "approved_at": "2026-11-18T06:51:16+00:00",
                                        "confirmed_at": "2026-11-18T06:51:16+00:00", "shipped_at": "2026-11-18T07:00:00+00:00",
                                        "shipped_by": "warehouse@oakbridge.in", "lines": [{"book_id": "cmm", "qty": 3}]})
    await db.stock_movements.insert_one({"id": "m1", "doc_id": "d1", "book_id": "cmm", "qty": -3, "undone": False, "touched_stock": True})
    await db.warehouse_docs.insert_one({"id": "d2", "direction": "out", "status": "confirmed", "shipped_at": "", "lines": []})

    await expect(U.not_delivered("d1", U.NotDeliveredBody(note="missed"), SUPER), 400, "a real reason is required")
    await expect(U.not_delivered("d1", NOTE, PHONE), 403, "not from the warehouse phone login")
    await expect(U.not_delivered("d2", NOTE, SUPER), 409, "only a SHIPPED carton out")
    check((await db.warehouse_docs.find_one({"id": "d1"}))["shipped_at"], "refusals change nothing")

    r = await U.not_delivered("d1", NOTE, SUPER)
    b = await db.books.find_one({"id": "cmm"})
    check(r["not_delivered"] and r["reversed"] == 1, "the carton's movement is reversed")
    check(b["stock"] == 20 and b["wh_stock"] == 20, "3 copies back: website and warehouse stock 17 -> 20")
    d = await db.warehouse_docs.find_one({"id": "d1"})
    check(d["archived"] and d["status"] == "undone" and d["shipped_at"] == "", "document archived (kept), no longer shipped")
    check(d["not_delivered"]["note"].startswith("Delivery missed") and d["not_delivered"]["was_shipped_at"] == "2026-11-18T07:00:00+00:00",
          "the reason and the original shipped time are kept on it")
    check((await db.stock_movements.find_one({"id": "m1"}))["undone"], "the stock history shows the movement undone, not erased")
    check(AUDIT[-1][0] == "WAREHOUSE_CARTON_NOT_DELIVERED" and AUDIT[-1][1]["number"] == "P/2026-27/0634", "audited")

    await expect(U.not_delivered("d1", NOTE, SUPER), 409, "a second click can't add the copies back twice")
    check((await db.books.find_one({"id": "cmm"}))["stock"] == 20, "…stock still 20")


asyncio.run(main())
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
