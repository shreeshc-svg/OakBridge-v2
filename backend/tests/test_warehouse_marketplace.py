"""Warehouse → Amazon / Flipkart daily sheet (warehouse_marketplace.py) on the
fake DB, with a sheet in the warehouse person's real format.

Run: python backend/tests/test_warehouse_marketplace.py
"""
import asyncio
import io
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


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self):
        return dict(self.__dict__)


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


def _noop(*a, **k):
    return None


async def _anoop(*a, **k):
    return None

UPLOAD = {}


async def _read_limited(file, limit, label):
    return UPLOAD["data"]

fastapi = _mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=_noop, File=_noop, Form=_noop, UploadFile=object, Header=_noop)
_mod("fastapi.responses", Response=object)
fastapi.responses = sys.modules["fastapi.responses"]
_mod("pydantic", BaseModel=BaseModel)
db = DB()
_mod("extensions", db=db, _notify_back_in_stock=_anoop, get_current_user=_noop, require_admin=_noop, require_superadmin=_noop)
_mod("features", APP_NAME="oakbridge", delete_object=_noop, get_object=_noop, put_object=_noop)
_mod("uploads_guard", is_pdf=_noop, read_limited=_read_limited, sniff_image=_noop, require_safe_pdf=_noop)
_mod("audit", audit_log=_anoop)
_mod("rbac", ADMIN_ROLES=("admin", "superadmin"), effective_sections=lambda u: ["warehouse"])

import warehouse as wh  # noqa: E402
import warehouse_marketplace as MP  # noqa: E402
from datetime import date  # noqa: E402

MP._today = lambda: date(2026, 11, 20)   # fixed "today" so the dates in these sheets are never "in the future"
from openpyxl import Workbook  # noqa: E402

SUPER = {"email": "boss@oakbridge.in", "role": "superadmin"}
PACKER = {"email": "warehouse@oakbridge.in", "role": "admin"}


def sheet(rows, title="TODAY ONLINE ORDER DATE-13-NOV-2026, FRIDAY"):
    wb = Workbook()
    ws = wb.active
    ws.append([title])
    ws.append(["S.NO", "BOOKS NAME ", "ISBN CODE", "QTY", "CHANNEL"])
    for i, r in enumerate(rows, 1):
        ws.append([i, *r])
    ws.append([None, "TOTAL", None, sum(r[2] for r in rows if isinstance(r[2], int)), None])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class F:
    def __init__(self, name):
        self.filename = name


def stock(bid):
    return next(b for b in db.books.docs if b["id"] == bid)["wh_stock"]


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code}: {e.detail})")


async def main():
    for b in ({"id": "ap", "title": "Applied Psychology", "isbn": "978-8194031239", "stock": 426},
              {"id": "na", "title": "Nadumuttam", "isbn": "9788169999069", "stock": 52},
              {"id": "fl", "title": "Practitioner's Guide to International Family Law", "isbn": "9788198348845", "stock": 69},
              {"id": "ce", "title": "Compulsory English for IAS", "isbn": "9788199305229", "stock": 2011},
              {"id": "cw", "title": "Courtroom Wit and Wisdom", "isbn": "9789391032975", "stock": 1},
              {"id": "pk", "title": "UPSC Pack", "isbn": "9780000000002", "product_type": "pack", "stock": 7}):
        await db.books.insert_one(b)
    await wh.adm_mode(wh.ModeBody(mode="trial"), SUPER)   # opening count = stock; the trial counts wh_stock

    print("-- reading his sheet --")
    rows = [("Applied Psycology for UPSC | Third Edition |", "978-8194031239", 3, "AMAZON"),
            ("Nadumuttam - The Courtyard of Stories and Memories", "978-8169999069", 6, "AMAZON"),
            ("Practitioner’s Guide to International Family Law, Practical Guide to Drafting Commercial Contracts", "978-8198348845 ", 1, "AMAZON"),
            ("Courtroom Wit and Wisdom", "978-9391032975", 2, "AMAZON"),
            ("Compulsory English 6th Edition for IAS", "978-8199305229", 1, "FLIPKART"),
            ("Nadumuttam - The Courtyard of Stories and Memories", "978-8169999069", 8, "COURIER"),
            ("Kindle book", "978-8199305229", 1, "KINDLE"),
            ("Mystery", "978-1111111111", 1, "AMAZON"),
            ("UPSC Pack", "978-0000000002", 1, "FLIPKART"),
            ("No qty", "978-8194031239", None, "AMAZON")]
    UPLOAD["data"] = sheet(rows)
    p = await MP.mp_preview(F("13-NOV-2026, FRIDAY.xlsx"), None, PACKER)
    check(p["date"] == "2026-11-13", "date read from the top row (13-NOV-2026)")
    check(p["totals"] == {"Amazon": 12, "Flipkart": 1}, "Amazon 12 copies, Flipkart 1")
    check({i["channel"] for i in p["ignored"]} == {"COURIER", "KINDLE"}, "COURIER and KINDLE rows ignored (not Amazon/Flipkart)")
    whys = " | ".join(e["why"] for e in p["errors"])
    check("No book with this ISBN" in whys and "pack" in whys and "whole number" in whys, "unknown ISBN, pack ISBN and missing qty flagged")
    fl = next(r for r in p["rows"] if r["book_id"] == "fl")
    check("Two titles" in fl["warn"], "a row naming two books is flagged")
    cw = next(r for r in p["rows"] if r["book_id"] == "cw")
    check("Only 1 in stock" in cw["warn"], "more than the count -> warning (still applied: it was shipped)")
    check(stock("ap") == 426, "the check screen changes nothing")

    print("-- confirm --")
    r = await MP.mp_confirm(p["id"], PACKER)
    check(stock("ap") == 423 and stock("na") == 46 and stock("ce") == 2010 and stock("cw") == -1, "copies came off (COURIER Nadumuttam not counted)")
    mv = [m for m in db.stock_movements.docs if m["doc_id"] == "MP-2026-11-13"]
    check({m["reason"] for m in mv} == {"amazon_mp", "flipkart_mp"} and all(m["note"].startswith("13-NOV-2026") for m in mv),
          "movements labelled Amazon / Flipkart, with the sheet name and date")
    await expect(MP.mp_confirm(p["id"], PACKER), 404, "the same check can't be applied twice")

    print("-- re-upload the same day --")
    UPLOAD["data"] = sheet(rows)
    p2 = await MP.mp_preview(F("13-NOV-2026, FRIDAY.xlsx"), None, PACKER)
    check(p2["changes"] == [] and all(x["status"] == "unchanged" for x in p2["rows"]) and p2["already"], "same sheet again: nothing to change")
    await MP.mp_confirm(p2["id"], PACKER)
    check(stock("ap") == 423, "…and confirming it changes nothing")
    rows2 = [("Applied Psychology", "978-8194031239", 4, "AMAZON"),            # 3 -> 4
             ("Practitioner's Guide", "978-8198348845", 1, "AMAZON"),
             ("Courtroom", "978-9391032975", 2, "AMAZON"),
             ("Compulsory English", "978-8199305229", 1, "FLIPKART")]          # Nadumuttam row removed
    UPLOAD["data"] = sheet(rows2)
    p3 = await MP.mp_preview(F("13-NOV-2026, FRIDAY (corrected).xlsx"), None, PACKER)
    ch = {c["book_id"]: c["delta"] for c in p3["changes"]}
    check(ch == {"ap": 1, "na": -6}, "corrected sheet: Applied +1 out, Nadumuttam's 6 put back")
    await MP.mp_confirm(p3["id"], PACKER)
    check(stock("ap") == 422 and stock("na") == 52, "only the difference applied")

    print("-- office: undo a whole sheet --")
    sh = (await MP.mp_sheets())["rows"]
    check(sh[0]["date"] == "2026-11-13" and sh[0]["Amazon"] == 7 and sh[0]["Flipkart"] == 1, "office sees the sheet by date with its totals")
    one = next(m for m in db.stock_movements.docs if m["doc_id"] == "MP-2026-11-13" and not m["undone"])
    await expect(wh.adm_undo_move(one["id"], SUPER), 409, "a single sheet line can't be undone in Movements (ledger would drift)")
    r = await MP.mp_undo("2026-11-13", SUPER)
    check(stock("ap") == 426 and stock("ce") == 2011 and stock("na") == 52 and stock("cw") == 1, "undo puts every copy back")
    UPLOAD["data"] = sheet(rows2)
    p6 = await MP.mp_preview(F("13-NOV-2026, FRIDAY.xlsx"), None, PACKER)
    check(not p6["already"] and {c["book_id"]: c["delta"] for c in p6["changes"]} == {"ap": 4, "fl": 1, "cw": 2, "ce": 1}, "after undo the date starts from zero")
    await expect(MP.mp_undo("2026-11-13", {"email": "w@o.in", "role": "warehouse"}), 403, "the warehouse login can't undo")

    print("-- other checks --")
    UPLOAD["data"] = sheet(rows, title="ONLINE ORDERS")
    await expect(MP.mp_preview(F("orders.xlsx"), None, PACKER), 400, "no date anywhere -> asks for it")
    p4 = await MP.mp_preview(F("orders.xlsx"), "2026-11-12", PACKER)
    check(p4["date"] == "2026-11-12" and not p4["already"], "date picked on the phone works, and is a separate day")
    await expect(MP.mp_preview(F("orders.pdf"), None, PACKER), 400, "only .xlsx / .csv")
    UPLOAD["data"] = b"S.NO,BOOKS NAME,ISBN CODE,QTY,CHANNEL\n1,Applied,9788194031239,2,amazon\n"
    p5 = await MP.mp_preview(F("14-NOV-2026.csv"), None, PACKER)
    check(p5["date"] == "2026-11-14" and p5["totals"]["Amazon"] == 2, "CSV works too; date from the file name; channel in any case")
    check(MP.isbn_key("8194031235") == "9788194031239", "ISBN-10 matches its ISBN-13")

asyncio.run(main())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
