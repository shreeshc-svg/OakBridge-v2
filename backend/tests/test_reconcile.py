"""
Payment reconciliation — unit tests.

Runs with no server, no MongoDB and no Razorpay account: `extensions`, `emailer`,
`invoice` and the `razorpay` SDK are stubbed before payments.py is imported, and
a small in-memory store stands in for the collections it touches.

What is being protected here is money. The three properties that matter:

  1. Only a CAPTURED payment marks an order paid. Authorised, failed and absent
     must all leave payment_status alone — recording an authorisation as revenue
     books income that may never arrive.
  2. Running it twice settles once. Reconciliation, the browser and the webhook
     can all reach the same order, so a second pass must not send a second
     receipt or decrement stock again.
  3. A Razorpay outage changes nothing. "We could not ask" and "there is no
     payment" are different answers and must not be confused.

    python -m pytest backend/tests/test_reconcile.py -q
"""
import asyncio
import sys
import types
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


# ---------------------------------------------------------------- fake mongo --
def _match(doc, query):
    """The subset of Mongo query operators payments.py actually uses."""
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            for op, arg in cond.items():
                if op == "$in" and val not in arg:
                    return False
                if op == "$nin" and val in arg:
                    return False
                if op == "$ne" and val == arg:
                    return False
                if op == "$gte" and not (val is not None and val >= arg):
                    return False
        elif val != cond:
            return False
    return True


def _apply(doc, update):
    changed = False
    for op, fields in update.items():
        for k, v in fields.items():
            if op == "$set":
                if doc.get(k) != v:
                    doc[k] = v
                    changed = True
            elif op == "$inc":
                doc[k] = (doc.get(k) or 0) + v
                changed = True
            elif op == "$addToSet":
                doc.setdefault(k, [])
                if v not in doc[k]:
                    doc[k].append(v)
                    changed = True
    return changed


class Result:
    def __init__(self, matched, modified):
        self.matched_count = matched
        self.modified_count = modified


class Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *_a, **_k):
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, *_a, **_k):
        return [dict(d) for d in self._docs]


class Collection:
    def __init__(self):
        self.docs = []

    async def find_one(self, query, _proj=None):
        for d in self.docs:
            if _match(d, query):
                return dict(d)
        return None

    def find(self, query, _proj=None):
        return Cursor([d for d in self.docs if _match(d, query)])

    async def update_one(self, query, update, upsert=False):
        for d in self.docs:
            if _match(d, query):
                return Result(1, 1 if _apply(d, update) else 0)
        if upsert:
            doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            _apply(doc, update)
            self.docs.append(doc)
            return Result(0, 1)
        return Result(0, 0)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=len(self.docs))


class FakeDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        return self._cols.setdefault(name, Collection())

    def __getitem__(self, name):
        return self._cols.setdefault(name, Collection())


# ------------------------------------------------------------------- stubbing --
SENT = {"receipts": [], "admin": []}


def _install_stubs():
    ext = types.ModuleType("extensions")
    ext.db = FakeDB()
    sys.modules["extensions"] = ext

    emailer = types.ModuleType("emailer")

    async def _receipt(order, invoice_pdf=None):
        SENT["receipts"].append(order.get("order_number"))
        return True

    async def _admin_paid(order):
        SENT["admin"].append(order.get("order_number"))
        return True

    async def _noop(*_a, **_k):
        return True

    emailer.send_order_receipt = _receipt
    emailer.send_admin_paid_order = _admin_paid
    emailer.send_order_failed = _noop
    emailer.send_admin_failed_order = _noop
    emailer.send_admin_webhook_alert = _noop
    sys.modules["emailer"] = emailer

    invoice = types.ModuleType("invoice")

    async def _build(_db, _order):
        return b"%PDF-fake"

    invoice.build_order_invoice = _build
    sys.modules["invoice"] = invoice

    # Razorpay SDK: only the shapes payments.py touches.
    rzp = types.ModuleType("razorpay")

    class _Errors:
        class SignatureVerificationError(Exception):
            pass

    class _Client:
        def __init__(self, auth=None):
            self.auth = auth
            self.order = types.SimpleNamespace(payments=lambda *a, **k: {"items": []})
            self.payment = types.SimpleNamespace(fetch=lambda *a, **k: {})
            self.utility = types.SimpleNamespace(verify_payment_signature=lambda *a, **k: True)

        def set_app_details(self, _d):
            pass

    rzp.Client = _Client
    rzp.errors = _Errors
    sys.modules["razorpay"] = rzp

    _stub_web_framework()


def _stub_web_framework():
    """Stand in for FastAPI and Pydantic only if they are not installed.

    payments.py imports both at module scope to declare its routes, but not one
    line of the reconciliation logic under test touches either. On a machine
    with the real packages this does nothing; on a bare checkout it is the
    difference between these tests running and not.
    """
    try:  # pragma: no cover - depends on the environment, not the code
        import fastapi  # noqa: F401
        import pydantic  # noqa: F401

        return
    except ImportError:
        pass

    fastapi = types.ModuleType("fastapi")

    class _Router:
        def __init__(self, *a, **k):
            pass

        def _decorator(self, *_a, **_k):
            def wrap(fn):
                return fn

            return wrap

        get = post = put = patch = delete = _decorator

    class _HTTPException(Exception):
        def __init__(self, status_code=500, detail=""):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    fastapi.APIRouter = _Router
    fastapi.HTTPException = _HTTPException
    fastapi.Header = lambda default=None, **_k: default
    fastapi.Request = object
    fastapi.Depends = lambda fn=None: fn
    sys.modules["fastapi"] = fastapi

    pydantic = types.ModuleType("pydantic")

    class _BaseModel:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    pydantic.BaseModel = _BaseModel
    pydantic.Field = lambda default=None, **_k: default
    sys.modules["pydantic"] = pydantic


import os  # noqa: E402

os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_stub")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "stub_secret")
_install_stubs()

import payments  # noqa: E402


# --------------------------------------------------------------------- setup --
def fresh(**over):
    """A pending order plus the one book it is for, wired into a clean db."""
    payments.db = FakeDB()
    SENT["receipts"].clear()
    SENT["admin"].clear()

    order = {
        "id": "ord-1",
        "order_number": "OAK-260818-972EB3",
        "email": "buyer@example.com",
        "total": 636.0,
        "status": "pending",
        "payment_status": "pending",
        "rzp_order_id": "order_RZP1",
        "created_at": "2026-08-18T12:00:00+00:00",
        "items": [{"book_id": "bk-1", "quantity": 1, "title": "A Book", "price": 636.0}],
    }
    order.update(over)
    payments.db.orders.docs.append(order)
    payments.db.books.docs.append({"id": "bk-1", "stock": 5})
    return dict(order)


def with_attempts(items):
    payments._client.order = types.SimpleNamespace(payments=lambda *a, **k: {"items": items})


def stored():
    return payments.db.orders.docs[0]


def run(coro):
    return asyncio.run(coro)


CAPTURED = {"id": "pay_1", "status": "captured", "amount": 63600, "created_at": 3}
AUTHORIZED = {"id": "pay_2", "status": "authorized", "amount": 63600, "created_at": 2}
FAILED = {"id": "pay_3", "status": "failed", "amount": 63600, "created_at": 1,
          "error_description": "card declined"}


# --------------------------------------------------------------------- tests --
def test_captured_payment_is_settled_end_to_end():
    order = fresh()
    with_attempts([CAPTURED])

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "settled"
    o = stored()
    assert o["payment_status"] == "paid"
    assert o["status"] == "confirmed"
    assert o["rzp_payment_id"] == "pay_1"
    assert o["amount_captured_paise"] == 63600
    assert o["amount_mismatch"] is False
    assert o["paid_at"]
    assert payments.db.books.docs[0]["stock"] == 4, "stock must come down on first settle"
    assert SENT["receipts"] == ["OAK-260818-972EB3"]
    assert SENT["admin"] == ["OAK-260818-972EB3"]


def test_running_twice_settles_once():
    order = fresh()
    with_attempts([CAPTURED])

    run(payments.reconcile_order(order, "test"))
    # Second pass sees the order as it now is, exactly as a webhook arriving
    # late or an admin pressing the button twice would.
    again = run(payments.reconcile_order(stored(), "test"))

    assert again["outcome"] == "already_paid"
    assert payments.db.books.docs[0]["stock"] == 4, "stock must not be decremented twice"
    assert SENT["receipts"] == ["OAK-260818-972EB3"], "customer must not get two receipts"


def test_authorized_is_never_marked_paid():
    order = fresh()
    with_attempts([AUTHORIZED])

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "authorized"
    o = stored()
    assert o["payment_status"] == "pending", "an authorisation is money held, not collected"
    assert o["capture_unconfirmed"] is True
    assert o["needs_attention"] is True
    assert payments.db.books.docs[0]["stock"] == 5
    assert SENT["receipts"] == []


def test_failed_attempt_reports_but_changes_nothing():
    order = fresh()
    with_attempts([FAILED])

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "no_capture"
    assert res["reason"] == "card declined"
    assert stored()["payment_status"] == "pending"
    assert SENT["receipts"] == []


def test_no_attempt_at_all():
    order = fresh()
    with_attempts([])

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "no_attempt"
    assert stored()["payment_status"] == "pending"


def test_gateway_outage_is_not_read_as_unpaid():
    order = fresh()

    def _boom(*_a, **_k):
        raise RuntimeError("connection reset")

    payments._client.order = types.SimpleNamespace(payments=_boom)

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "unavailable"
    assert stored()["payment_status"] == "pending"
    assert SENT["receipts"] == []


def test_order_that_never_reached_the_gateway():
    order = fresh(rzp_order_id=None)

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "never_started"


def test_capture_for_the_wrong_amount_is_flagged_not_hidden():
    order = fresh()
    with_attempts([{**CAPTURED, "amount": 50000}])

    res = run(payments.reconcile_order(order, "test"))

    assert res["outcome"] == "settled", "the money did arrive — it must still be recorded"
    assert res["amount_mismatch"] is True
    o = stored()
    assert o["amount_captured_paise"] == 50000, "record what was taken, not what was asked"
    assert o["amount_expected_paise"] == 63600


def test_settle_does_not_reset_an_order_already_shipped():
    order = fresh(status="shipped")
    with_attempts([CAPTURED])

    run(payments.reconcile_order(order, "test"))

    assert stored()["status"] == "shipped", "fulfilment must not walk backwards"
    assert stored()["payment_status"] == "paid"


def test_sweep_only_touches_unpaid_orders_in_window():
    fresh()
    payments.db.orders.docs.append(
        {"id": "ord-2", "order_number": "OAK-2", "payment_status": "paid",
         "rzp_order_id": "order_RZP2", "created_at": "2026-08-18T12:00:00+00:00",
         "total": 100.0, "items": []}
    )
    payments.db.orders.docs.append(
        {"id": "ord-3", "order_number": "OAK-3", "payment_status": "pending",
         "rzp_order_id": None, "created_at": "2026-08-18T12:00:00+00:00",
         "total": 100.0, "items": []}
    )
    with_attempts([CAPTURED])

    # A window wide enough to include the fixture dates.
    summary = run(payments.reconcile_pending_orders(hours=24 * 365 * 20, limit=50))

    assert summary["checked"] == 1, "paid orders and orders with no gateway id are skipped"
    assert summary["settled_orders"] == ["OAK-260818-972EB3"]


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
