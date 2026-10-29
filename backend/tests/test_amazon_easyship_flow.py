"""amazon_easyship.py end to end on the in-memory fake DB (tests/_fakedb.py),
FastAPI / pydantic / extensions stubbed and Amazon replaced by canned
responses — the real order and push code runs.

Proves, on a live store's stock:
  * an Amazon order takes its copies off website stock exactly once, however
    many times the 15-minute run sees it;
  * a cancellation puts back exactly what was taken, once;
  * orders placed before the switch was turned on change nothing;
  * a short order takes what is there, never goes below zero, and is flagged;
  * quantities pushed = website stock − buffer, only for Easy Ship SKUs, and
    only when they changed; a failed order pull stops the push.

Run: python backend/tests/test_amazon_easyship_flow.py
"""
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


def _noop(*a, **k):
    return None


async def _anoop(*a, **k):
    return None


fastapi = _mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=_noop,
               File=_noop, Form=_noop, UploadFile=object, Header=_noop)
_mod("fastapi.responses", Response=object)
fastapi.responses = sys.modules["fastapi.responses"]
_mod("pydantic", BaseModel=BaseModel)
db = DB()
_mod("extensions", db=db, _notify_back_in_stock=_anoop, get_current_user=_noop,
     require_admin=_noop, require_superadmin=_noop)
_mod("features", APP_NAME="oakbridge", delete_object=_noop, get_object=_noop, put_object=_noop)
_mod("uploads_guard", is_pdf=_noop, read_limited=_anoop, sniff_image=_noop, require_safe_pdf=_noop)
_mod("audit", audit_log=_anoop)
_mod("rbac", ADMIN_ROLES=("admin", "superadmin"), effective_sections=lambda u: ["warehouse"])
alerts = []


async def _alert(kind, msg, key=None, campaign_id=None):
    alerts.append(msg)

_mod("marketing", raise_alert=_alert, dispatch=_noop)

import amazon_spapi as sp  # noqa: E402
import amazon_easyship as es  # noqa: E402

sp.configured = lambda: True
sp._cfg = lambda: {"marketplace": "A21TJRUUN4KGV", "seller_id": "SELLER", "region": "eu",
                   "client_id": "x", "client_secret": "x", "refresh_token": "x"}

AMZ = {"orders": [], "items": {}, "fail_orders": False}
PATCHES = []


def fake_orders(after):
    if AMZ["fail_orders"]:
        raise sp.AmazonError("throttled")
    return list(AMZ["orders"])


es._fetch_orders = fake_orders
es._fetch_items = lambda oid: AMZ["items"][oid]
es._patch_qty = lambda sku, qty, pt: (PATCHES.append((sku, qty)) or ("ACCEPTED", [], pt or "ABIS_BOOK"))
REPORT = ("item-name\tseller-sku\tquantity\tasin1\tfulfillment-channel\tstatus\n"
          "Software Protection\t9788193746875\t\t8193746872\tDEFAULT\tActive\n"
          "Applied Psychology\tFBA-1\t0\t8194031230\tAMAZON_IN\tActive\n"
          "Old edition\tOLD-1\t4\t8193746848\tDEFAULT\tActive\n")
es._download_report = lambda: REPORT


async def asleep(*a, **k):
    return None

es.asyncio.sleep = asleep


def book(bid):
    return next(b for b in db.books.docs if b["id"] == bid)


def order(oid, status, purchased):
    return {"AmazonOrderId": oid, "OrderStatus": status, "PurchaseDate": purchased,
            "LastUpdateDate": purchased, "LatestShipDate": purchased}


async def main():
    await db.books.insert_one({"id": "sp", "title": "Software Protection", "isbn": "9788193746875", "stock": 10})
    await db.books.insert_one({"id": "ap", "title": "Applied Psychology", "isbn": "9788194031239", "stock": 3})

    print("-- listings --")
    r = await es.refresh_listings()
    check(r["easy_ship"] == 2 and r["linked"] == 1, "report read: 2 Easy Ship SKUs, 1 linked by ISBN")

    print("-- switch on --")
    await es._set(on=True, buffer=2, orders_from="2026-10-29T10:00:00+00:00", orders_cursor="2026-10-29T10:00:00+00:00")
    AMZ["orders"] = [order("OLD", "Unshipped", "2026-10-29T09:00:00Z"), order("A1", "Unshipped", "2026-10-29T10:05:00Z")]
    AMZ["items"] = {"OLD": [{"SellerSKU": "9788193746875", "QuantityOrdered": 1}],
                    "A1": [{"SellerSKU": "9788193746875", "QuantityOrdered": 2, "Title": "Software Protection"}]}
    out = await es.run_once()
    check(book("sp")["stock"] == 8, "A1 took 2 copies; the order before the switch took none")
    check(PATCHES == [("9788193746875", 6)], "pushed 8 − buffer 2 = 6, Easy Ship SKU only (FBA and unlinked untouched)")
    check(out["orders"]["before_start"] == 1, "older order recorded as before_start")

    print("-- the same orders seen again --")
    PATCHES.clear()
    await es.run_once()
    await es.run_once()
    check(book("sp")["stock"] == 8, "re-runs never take again")
    check(PATCHES == [], "nothing changed -> nothing pushed")

    print("-- cancellation --")
    AMZ["orders"] = [order("A1", "Canceled", "2026-10-29T10:05:00Z")]
    await es.run_once()
    await es.run_once()
    check(book("sp")["stock"] == 10, "cancel put back exactly 2, once")
    check(PATCHES == [("9788193746875", 8)], "Amazon quantity raised back to 8")
    a1 = await db.amazon_orders.find_one({"amazon_order_id": "A1"})
    check(a1["stage"] == "restored", "order stage restored")

    print("-- cancelled before we ever saw it --")
    AMZ["orders"] = [order("A2", "Canceled", "2026-10-29T11:00:00Z")]
    AMZ["items"]["A2"] = [{"SellerSKU": "9788193746875", "QuantityOrdered": 3}]
    await es.run_once()
    check(book("sp")["stock"] == 10, "no stock change for an order cancelled before the first sight")

    print("-- short order --")
    db.books.docs[0]["stock"] = 1
    AMZ["orders"] = [order("A3", "Unshipped", "2026-10-29T12:00:00Z")]
    AMZ["items"]["A3"] = [{"SellerSKU": "9788193746875", "QuantityOrdered": 3}]
    PATCHES.clear()
    await es.run_once()
    a3 = await db.amazon_orders.find_one({"amazon_order_id": "A3"})
    check(book("sp")["stock"] == 0 and a3["lines"][0]["taken"] == 1, "short: took the 1 there was, never below zero")
    check(a3["needs_attention"] and any("A3" in m for m in alerts), "short order flagged and alerted")
    check(PATCHES == [("9788193746875", 0)], "Amazon set to 0")

    print("-- order pull fails --")
    db.books.docs[0]["stock"] = 20
    AMZ["fail_orders"] = True
    PATCHES.clear()
    out = await es.run_once()
    check("orders_error" in out and PATCHES == [], "failed order pull -> no push (could be missing new orders)")
    st = await es.get_settings()
    check(st["last_error"].startswith("orders"), "error recorded for the admin panel")


asyncio.run(main())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
