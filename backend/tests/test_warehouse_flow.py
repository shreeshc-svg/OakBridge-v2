"""warehouse.py end to end on the in-memory fake DB (tests/_fakedb.py), with
FastAPI / pydantic / extensions / S3 stubbed — the real ledger code runs.

Covers the 13 Oct 2026 audit fixes:
  * hampers and packs never enter the warehouse ledger, and Go live leaves
    their website stock alone (it used to zero every hamper sold in trial);
  * pre-orders/backorders: arriving copies go to waiting orders first, and Go
    live neither double-subtracts nor forgets orders paid before the trial;
  * below-zero counts are reported with what waiting orders explain;
  * a second photo of the same carton (same party, same books, no number) is
    stopped once and can be confirmed deliberately;
  * undoing a delivery never drives website stock below zero.

Run: python backend/tests/test_warehouse_flow.py
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


# ---- stubs -------------------------------------------------------------
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


fastapi = _mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=_noop,
               File=_noop, Form=_noop, UploadFile=object, Header=_noop)
_mod("fastapi.responses", Response=object)
fastapi.responses = sys.modules["fastapi.responses"]
_mod("pydantic", BaseModel=BaseModel)
db = DB()
notified = []


async def _notify(book):
    notified.append(book["id"])

_mod("extensions", db=db, _notify_back_in_stock=_notify, get_current_user=_noop,
     require_admin=_noop, require_superadmin=_noop)
_mod("features", APP_NAME="oakbridge", delete_object=_noop, get_object=_noop, put_object=_noop)
_mod("uploads_guard", is_pdf=_noop, read_limited=_anoop, sniff_image=_noop, require_safe_pdf=_noop)
_mod("audit", audit_log=_anoop)
_mod("rbac", ADMIN_ROLES=("admin", "superadmin"), effective_sections=lambda u: ["warehouse"])

import warehouse as wh  # noqa: E402
import order_stock  # noqa: E402

SUPER = {"email": "boss@oakbridge.in", "role": "superadmin"}
PACKER = {"email": "warehouse@oakbridge.in", "role": "admin"}


def book(bid):
    return next(b for b in db.books.docs if b["id"] == bid)


def paid_order(oid, items, taken, created):
    return {"id": oid, "order_number": oid.upper(), "payment_status": "paid", "status": "confirmed",
            "stock_decremented": True, "items": [{"book_id": b, "quantity": q} for b, q in items],
            "stock_taken": [{"book_id": b, "qty": q} for b, q in taken], "created_at": created}


async def main():
    for b in ({"id": "a", "title": "Applied Psychology", "isbn": "9788194031239", "stock": 40},
              {"id": "g", "title": "Gendering Climate Futures", "isbn": "9788169999045", "stock": 0, "coming_soon": True},
              {"id": "h", "title": "Gift Hamper", "product_type": "hamper", "stock": 12,
               "hamper_items": [{"book_id": "a", "qty": 1}]},
              {"id": "p", "title": "UPSC Pack", "product_type": "pack", "stock": 7}):
        await db.books.insert_one(b)
    # An order paid BEFORE the trial, still waiting for 5 copies of a.
    await db.orders.insert_one(paid_order("pre", [("a", 5)], [], "2026-10-01T00:00:00+00:00"))

    print("-- trial start --")
    await wh.adm_mode(wh.ModeBody(mode="trial"), SUPER)
    started = (await wh.get_state())["started_at"]
    check(book("a")["wh_stock"] == 40 and "wh_stock" not in book("h") and "wh_stock" not in book("p"),
          "opening count for books only")

    print("-- website sales during the trial --")
    o = paid_order("t1", [("h", 2), ("g", 2), ("a", 10)], [("h", 2), ("a", 2)], started)
    await db.orders.insert_one(o)
    lines = await order_stock.expand_order_lines(db, o["items"])
    await wh.record_website_sale(o, lines)
    check("wh_stock" not in book("h"), "a hamper sale never touches the hamper's warehouse count")
    check(book("a")["wh_stock"] == 40 - 2 - 10, f"its books do (2 inside hampers + 10 loose) -> {book('a')['wh_stock']}")
    check(book("g")["wh_stock"] == -2, "a pre-order takes its copies off the count when paid")
    # a hamper count left below zero by the old code must not survive Go live
    book("h")["wh_stock"] = -3

    print("-- below zero is explained --")
    ov = await wh.adm_overview()
    g = next((x for x in ov["below_zero"] if x["id"] == "g"), None)
    check(g and g["owed"] == 2 and g["unexplained"] == 0, f"g: owed 2, nothing unexplained {g}")
    book("g")["wh_stock"] = -5
    ov = await wh.adm_overview()
    g = next(x for x in ov["below_zero"] if x["id"] == "g")
    check(g["unexplained"] == 3 and ov["below_zero_unexplained"] == 1 and "Count" in g["note"],
          f"3 copies nobody can explain -> count the shelf ({g['note']})")
    book("g")["wh_stock"] = -2

    print("-- go live --")
    # t1 still owes 8 of a (took 2 of 10 loose... plus 2 inside hampers) — the
    # warehouse already took all of it off; "pre" owes 5 the warehouse never saw.
    owed_before = await order_stock.owed_by_book(db)
    # Pre-launch checklist (Oct 2026): this fixture has a real mismatch and a
    # 0-day trial, so Go live is refused — then the checklist is stubbed to
    # "ready" to test what going live itself does.
    chk = await wh.go_live_checks()
    check(not chk["ready"] and "match" in chk["must_open"] and "trial_length" in chk["should_open"],
          f"checklist blocks a mismatched count and flags a short trial ({chk['must_open']}, {chk['should_open']})")
    try:
        await wh.adm_mode(wh.ModeBody(mode="live"), SUPER)
        check(False, "Go live refused while a 'must' item is open")
    except Exception as e:  # noqa: BLE001
        check("go_live_blocked" in str(getattr(e, "detail", e)), "Go live refused while a 'must' item is open")
    real_checks = wh.go_live_checks

    async def ready():
        return {"checks": [], "ready": True, "must_open": [], "should_open": ["trial_length"]}
    wh.go_live_checks = ready
    try:
        await wh.adm_mode(wh.ModeBody(mode="live"), SUPER)
        check(False, "a 'should' item needs a written reason")
    except Exception as e:  # noqa: BLE001
        check("go_live_needs_reason" in str(getattr(e, "detail", e)), "a 'should' item needs a written reason")
    await wh.adm_mode(wh.ModeBody(mode="live", override_reason="Full shelf count done, test fixture"), SUPER)
    wh.go_live_checks = real_checks
    check(book("h")["stock"] == 12 and book("p")["stock"] == 7, "hamper and pack keep their website stock")
    check(book("a")["stock"] == book("a")["wh_stock"],
          f"website = warehouse for a ({book('a')['stock']} vs {book('a')['wh_stock']})")
    pre = next(x for x in db.orders.docs if x["id"] == "pre")
    t1 = next(x for x in db.orders.docs if x["id"] == "t1")
    check(sum(t["qty"] for t in pre["stock_taken"] if t["book_id"] == "a") == 5, "the pre-trial order got its 5")
    check(sum(t["qty"] for t in t1["stock_taken"] if t["book_id"] == "a") == 12, "the trial order got the rest of its 12")
    check(owed_before.get("a") == 15 and (await order_stock.owed_by_book(db)).get("a") is None, "nothing owed for a afterwards")
    check(book("g")["stock"] == 0, "pre-order still has no copies")

    print("-- copies arrive for the pre-order --")
    notified.clear()
    await wh._apply("g", 150, "printer", actor=PACKER)
    check(book("g")["stock"] == 148 and book("g")["wh_stock"] == 148, f"148 on sale, not 150 ({book('g')['stock']})")
    check(not book("g")["coming_soon"] and notified == ["g"], "released and back-in-stock sent once")
    t1 = next(x for x in db.orders.docs if x["id"] == "t1")
    check({"book_id": "g", "qty": 2} in t1["stock_taken"], "the pre-order got its 2 copies")

    print("-- undoing a delivery after some were sold --")
    mv = await wh._apply("a", 10, "printer", actor=PACKER)
    have = book("a")["stock"]
    book("a")["stock"] = 3                        # sold most of it meanwhile
    await wh._reverse(mv, PACKER)
    check(book("a")["stock"] == 0, f"website stock stops at 0, never negative ({book('a')['stock']})")
    book("a")["stock"] = have - 10                # back to a consistent state for the rest

    print("-- the same carton photographed twice --")
    L = wh.ConfirmLine

    async def draft(did):
        await db.warehouse_docs.insert_one({
            "id": did, "direction": "out", "practice": False, "status": "draft", "source": "manual",
            "created_at": "2026-10-13T05:00:00+00:00", "read_lines": [], "sha256": did,
            "doc_number": "", "party_name": "Commercial House", "party_gstin": "", "party_kind": "sale_offline"})

    def body(**k):
        return wh.ConfirmBody(lines=[L(line_no=None, book_id="a", qty=2, include=True, invoiced=2)],
                              parcels=None, doc_number=None, party_name=None, party_kind=None,
                              allow_duplicate=False, note=None, **k)

    await draft("d1")
    await draft("d2")
    r = await wh.wh_confirm("d1", body(confirm_similar=False), PACKER)
    check(r["ok"], "first carton counted")
    before = book("a")["wh_stock"]
    try:
        await wh.wh_confirm("d2", body(confirm_similar=False), PACKER)
        check(False, "second identical carton should be stopped")
    except HTTPException as e:
        check(e.status_code == 409 and e.detail["code"] == "similar_doc" and "Commercial House" in e.detail["msg"],
              f"second photo stopped with a clear question ({e.detail['msg'][:70]}…)")
    check(book("a")["wh_stock"] == before, "and nothing was counted")
    r = await wh.wh_confirm("d2", body(confirm_similar=True), PACKER)
    check(r["ok"] and book("a")["wh_stock"] == before - 2, "'yes, a second carton' counts it")

    print("-- courier sheet: website orders never deducted twice; free copies deducted once --")
    await db.warehouse_docs.insert_one({
        "id": "cs1", "direction": "courier", "practice": False, "status": "draft", "source": "manual",
        "created_at": "2026-10-13T05:00:00+00:00", "read_lines": [], "sha256": "cs1", "parcels": [],
        "doc_number": "", "party_name": "", "party_gstin": "", "party_kind": ""})
    await db.orders.insert_one({"id": "w1", "order_number": "OAK-261013-AAAAAA", "payment_status": "paid", "status": "confirmed"})
    P = wh.ConfirmParcel

    def cbody(kind, order_id=None):
        return wh.ConfirmBody(lines=[], parcels=[P(no=1, kind=kind, order_id=order_id,
                              lines=[L(line_no=None, book_id="a", qty=2, include=True, invoiced=None)])],
                              doc_number=None, party_name=None, party_kind=None, allow_duplicate=False,
                              confirm_similar=False, note=None)
    before = book("a")["wh_stock"], book("a")["stock"]
    try:
        await wh.wh_confirm("cs1", cbody("website_order", None), PACKER)
        check(False, "a website order with no order picked should be refused")
    except HTTPException as e:
        check(e.status_code == 400, "a website order with no order picked is refused")
    r = await wh.wh_confirm("cs1", cbody("website_order", "w1"), PACKER)
    check(r["ok"] and (book("a")["wh_stock"], book("a")["stock"]) == before, "a linked website order deducts nothing again")
    check(next(o for o in db.orders.docs if o["id"] == "w1").get("warehouse_doc_id") == "cs1", "…and the order is marked packed")
    await db.warehouse_docs.insert_one({
        "id": "cs2", "direction": "courier", "practice": False, "status": "draft", "source": "manual",
        "created_at": "2026-10-13T05:00:00+00:00", "read_lines": [], "sha256": "cs2", "parcels": [],
        "doc_number": "", "party_name": "", "party_gstin": "", "party_kind": ""})
    wh_before = book("a")["wh_stock"]
    r = await wh.wh_confirm("cs2", cbody("free_copy"), PACKER)
    check(r["ok"] and book("a")["wh_stock"] == wh_before - 2, "a free copy on the same kind of sheet is deducted once, as a sample")
    for n, (kind, reason) in enumerate((("dealer_order", "sale_offline"), ("author_copy", "author_copy")), start=3):
        await db.warehouse_docs.insert_one({
            "id": f"cs{n}", "direction": "courier", "practice": False, "status": "draft", "source": "manual",
            "created_at": "2026-10-13T05:00:00+00:00", "read_lines": [], "sha256": f"cs{n}", "parcels": [],
            "doc_number": "", "party_name": "", "party_gstin": "", "party_kind": ""})
        before_n = book("a")["wh_stock"]
        await wh.wh_confirm(f"cs{n}", cbody(kind), PACKER)
        mv = [m for m in db.stock_movements.docs if m.get("doc_id") == f"cs{n}"]
        check(book("a")["wh_stock"] == before_n - 2 and mv and mv[0]["reason"] == reason,
              f"{kind}: deducted once and recorded as '{reason}' (DTDC phone/dealer orders are sales, not samples)")

    print("-- record_fill never records twice --")
    n = len(db.stock_movements.docs)
    await wh.record_fill({"order_number": "T1"}, "a", 3)       # T1 already has a website_order movement for a
    check(len(db.stock_movements.docs) == n, "an order with a movement for the book is not recorded again")
    await wh.record_fill({"order_number": "T1"}, "h", 1)
    check(len(db.stock_movements.docs) == n, "hampers are never recorded")




async def reset_tests():
    print("-- reset warehouse counts from the stock sheet (trial) --")
    await db.integrations.update_one({"key": wh.STATE_KEY}, {"$set": {"mode": "trial"}})
    await db.books.insert_one({"id": "z1", "title": "Sheet Book", "isbn": "9780000000901", "stock": 10, "wh_stock": 3})
    await db.books.insert_one({"id": "z2", "title": "New since trial", "isbn": "9780000000902", "stock": 4})
    prev = await wh.adm_reset_from_sheet(wh.ResetBody(dry_run=True, expected=None), SUPER)
    z = {c["id"]: c for c in prev["changes"]}
    check(z["z1"]["target"] == 10 and z["z1"]["diff"] == 7, "preview: warehouse 3 → sheet 10 (+7)")
    check(z["z2"]["target"] == 4, "a book added after the trial started gets its count too")
    check(all(c["id"] not in ("h", "p") for c in prev["changes"]), "hampers and packs are left alone")
    try:
        await wh.adm_reset_from_sheet(wh.ResetBody(dry_run=False, expected=prev["count"] + 1), SUPER)
        check(False, "a stale preview should be refused")
    except HTTPException as e:
        check(e.status_code == 409, "a stale preview is refused (numbers changed)")
    r = await wh.adm_reset_from_sheet(wh.ResetBody(dry_run=False, expected=prev["count"]), SUPER)
    check(r["reset"] == prev["count"] and book("z1")["wh_stock"] == 10 and book("z2")["wh_stock"] == 4, "counts now equal the sheet")
    mv = [m for m in db.stock_movements.docs if m["book_id"] == "z1" and m["reason"] == "correction_in"]
    check(mv and mv[-1]["qty"] == 7 and "Reset from the stock sheet" in mv[-1]["note"] and not mv[-1]["touched_stock"],
          "saved as a correction with the reason; website stock untouched")
    again = await wh.adm_reset_from_sheet(wh.ResetBody(dry_run=True, expected=None), SUPER)
    check(not any(c["id"] in ("z1", "z2") for c in again["changes"]), "running it again changes nothing for them")
    await db.integrations.update_one({"key": wh.STATE_KEY}, {"$set": {"mode": "live"}})
    try:
        await wh.adm_reset_from_sheet(wh.ResetBody(dry_run=True, expected=None), SUPER)
        check(False, "reset should be refused once live")
    except HTTPException as e:
        check(e.status_code == 409, "refused once live (the warehouse IS the stock then)")


asyncio.run(main())
asyncio.run(reset_tests())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
