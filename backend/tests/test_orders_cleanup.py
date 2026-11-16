"""Bulk delete / archive orders (orders_cleanup.py). Run: python backend/tests/test_orders_cleanup.py"""
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
        self.status_code = status_code


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return lambda *a, **k: (lambda f: f)


class BaseModel:
    def __init__(self, **kw):
        for k in getattr(type(self), "__annotations__", {}):
            setattr(self, k, getattr(type(self), k, None))
        self.__dict__.update(kw)


def _mod(n, **a):
    m = types.ModuleType(n)
    m.__dict__.update(a)
    sys.modules[n] = m


audits, alerts = [], []


async def _audit(db, action, **k):
    audits.append((action, k.get("meta")))


async def _alert(kind, msg, key=""):
    alerts.append(msg)

db = DB()
_mod("fastapi", APIRouter=_Router, Depends=lambda *a, **k: None, HTTPException=HTTPException)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, require_superadmin=None)
_mod("audit", audit_log=_audit)
_mod("marketing", raise_alert=_alert)
import orders_cleanup as OC  # noqa: E402

SUPER = {"email": "boss@o.in", "role": "superadmin"}


async def flow():
    for o in ({"id": "f1", "order_number": "OAK-F1", "payment_status": "failed", "rzp_order_id": "order_f1"},
              {"id": "f2", "order_number": "OAK-F2", "payment_status": "pending", "rzp_order_id": "order_f2"},
              {"id": "p1", "order_number": "OAK-P1", "payment_status": "paid", "stock_decremented": True},
              {"id": "s1", "order_number": "OAK-S1", "payment_status": "pending", "stock_decremented": True},
              {"id": "w1", "order_number": "OAK-W1", "payment_status": "pending", "warehouse_packed_at": "x"}):
        await db.orders.insert_one(o)
    try:
        await OC.orders_bulk_delete(OC.BulkBody(ids=["f1"], reason=""), SUPER)
        check(False, "reason required")
    except HTTPException as e:
        check(e.status_code == 400, "a reason is required")
    r = await OC.orders_bulk_delete(OC.BulkBody(ids=["f1", "f2", "p1", "s1", "w1"], reason="failed payments"), SUPER)
    why = {s["order_number"]: s["why"] for s in r["skipped"]}
    check(r["deleted"] == 2 and set(r["deleted_numbers"]) == {"OAK-F1", "OAK-F2"}, "failed / unpaid orders deleted")
    check("archive" in why["OAK-P1"] and "Stock" in why["OAK-S1"] and "shipped" in why["OAK-W1"], "paid, stock-taken and packed orders refused with a reason")
    check(not await db.orders.find_one({"id": "f1"}) and await db.deleted_orders.find_one({"order_id": "f1"}), "deleted, but kept whole in deleted_orders")
    check(audits[-1][0] == "ORDERS_BULK_DELETED" and "OAK-F1" in audits[-1][1]["deleted"], "audited with the order numbers")

    print("-- late payment on a deleted order --")
    back = await OC.restore_deleted("order_f2")
    check(back and back["id"] == "f2" and await db.orders.find_one({"id": "f2"}) and not await db.deleted_orders.find_one({"order_id": "f2"}),
          "payment arrives -> the order is put back so the money settles onto it")
    check(alerts and "OAK-F2" in alerts[0], "and the office is alerted to ship it")
    check(await OC.restore_deleted("order_unknown") is None, "unknown payment: nothing invented")

    print("-- archive --")
    r = await OC.orders_bulk_archive(OC.ArchiveBody(ids=["p1"], archive=True), SUPER)
    p1 = await db.orders.find_one({"id": "p1"})
    check(r["changed"] == 1 and p1["archived"] and p1["payment_status"] == "paid", "paid order archived (hidden), nothing else changes")
    await OC.orders_bulk_archive(OC.ArchiveBody(ids=["p1"], archive=False), SUPER)
    check(not (await db.orders.find_one({"id": "p1"}))["archived"], "and can be brought back")
    src = open(os.path.join(os.path.dirname(HERE), "orders_cleanup.py"), encoding="utf-8").read()
    check("async def orders_bulk_delete(body: BulkBody, user: dict = Depends(require_superadmin))" in src
          and "async def orders_bulk_archive(body: ArchiveBody, user: dict = Depends(require_superadmin))" in src, "super admin only")
    pay = open(os.path.join(os.path.dirname(HERE), "payments.py"), encoding="utf-8").read()
    check(pay.count("restore_deleted(") == 2, "both payment paths (verify + webhook) restore a deleted order before giving up")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
