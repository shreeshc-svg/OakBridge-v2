"""Book formats (book_formats.py) on the fake DB.
Run: python backend/tests/test_book_formats.py"""
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
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return lambda *a, **k: (lambda f: f)


class BaseModel:
    def __init__(self, **kw):
        for k, v in type(self).__dict__.items():
            if not k.startswith("_") and not callable(v):
                setattr(self, k, v)
        self.__dict__.update(kw)

    def model_dump(self):
        return dict(self.__dict__)


def _mod(n, **a):
    m = types.ModuleType(n)
    m.__dict__.update(a)
    sys.modules[n] = m


AUDIT = []


async def _audit(db, action, **k):
    AUDIT.append(action)

db = DB()
_mod("fastapi", APIRouter=_Router, Depends=lambda *a, **k: None, HTTPException=HTTPException)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, require_admin=None)
_mod("audit", audit_log=_audit)

import book_formats as F  # noqa: E402

ADMIN = {"email": "a@oakbridge.in", "role": "superadmin"}
PB = "9788198751270"   # Story of the Clan, paperback (real, valid check digit)
HB = "9789391032661"   # Story of the Clan, hardback


def row(**k):
    return F.FormatRow(**k)


def body(rows, primary_index=0):
    return F.FormatsBody(formats=rows, primary_index=primary_index)


async def err(coro):
    try:
        await coro
    except HTTPException as e:
        return e
    return None


def listed(docs):
    from _fakedb import _match
    return [d for d in docs if _match(d, F.LISTED)]


async def main():
    print("-- rules --")
    check(F.isbn_ok(PB) and F.isbn_ok(HB), "real ISBN-13s pass the check digit")
    check(not F.isbn_ok("9788198751271"), "one mistyped digit is refused")
    check(F.isbn_ok("080442957X") and not F.isbn_ok("0804429579"), "ISBN-10 with X accepted")
    check(F.norm_isbn("978-93-91032-66-1") == HB, "hyphens / spaces stripped")
    e = F.validate([{"book_id": "a", "label": "Paperback", "price": 595}], "a")
    check(e and "two formats" in e[0], "one format alone is refused (switch off instead)")
    e = F.validate([{"book_id": "a", "label": "Paperback", "price": 595},
                    {"isbn": HB, "label": "paperback", "price": 995}], "a")
    check(any("both called" in x for x in e), "labels unique, case-insensitive")
    e = F.validate([{"book_id": "a", "label": "Paperback", "price": 595, "original_price": 500},
                    {"isbn": "123", "label": "Hardback", "price": 0}], "a")
    check(any("MRP" in x for x in e) and any("valid ISBN" in x for x in e) and any("price must" in x for x in e),
          "MRP below price, bad ISBN, zero price all reported")
    e = F.validate([{"book_id": "b", "label": "Paperback", "price": 595},
                    {"isbn": HB, "label": "Hardback", "price": 995}], "a")
    check(any("own list" in x for x in e), "the book being edited must stay in its list")

    print("-- create a Hardback from the Paperback --")
    await db.books.insert_one({"id": "pb", "title": "Story of the Clan", "author": "A", "isbn": PB, "price": 595,
                               "category": "trade", "subject": "History", "description": "d", "cover_image": "c.jpg",
                               "stock": 40, "ebook_path": "secret.pdf", "store_links": {"amazon": "https://amzn/pb"},
                               "review_count": 7, "rating_avg": 4.8, "binding": "Paperback"})
    await db.books.insert_one({"id": "x", "title": "Other", "isbn": "9789395764957", "price": 300, "stock": 5})
    out = await F.bf_save("pb", body([row(book_id="pb", label="Paperback", price=595, original_price=695),
                                      row(isbn="978-93-91032-66-1", label="Hardback", price=995)]), ADMIN)
    check(out["enabled"] and len(out["formats"]) == 2 and len(out["created"]) == 1, "saved: two formats, one created")
    hb = await db.books.find_one({"isbn": HB}, {"_id": 0})
    check(hb and hb["title"] == "Story of the Clan" and hb["cover_image"] == "c.jpg" and hb["binding"] == "Hardback",
          "new format copies title / cover, binding = label")
    check(hb["stock"] == 0 and hb["price"] == 995 and not hb.get("pod"), "new format: 0 stock (warehouse brings copies), its own price")
    check("ebook_path" not in hb and hb["store_links"] == {} and hb["review_count"] == 0,
          "never shares files, marketplace links or reviews")
    pb = await db.books.find_one({"id": "pb"}, {"_id": 0})
    check(pb["format_primary"] is True and hb["format_primary"] is False and pb["format_group"] == hb["format_group"],
          "Paperback is listed, Hardback grouped behind it")
    check(pb["stock"] == 40 and pb["original_price"] == 695, "existing stock untouched; MRP set")
    check(HB in pb["format_isbns"] and "format_isbns" not in hb, "listed record carries the Hardback's ISBN for search")
    allb = await db.books.find({}, {"_id": 0}).to_list(50)
    check(sorted(d["id"] for d in listed(allb)) == ["pb", "x"], "LISTED: one card per title, ordinary books unaffected")
    check(AUDIT[-1] == "BOOK_FORMATS_SAVE", "audited")

    print("-- storefront --")
    docs = await F.attach([dict(pb), {"id": "x"}])
    f = docs[0]["formats"]
    check([x["label"] for x in f] == ["Paperback", "Hardback"] and f[1]["price"] == 995 and f[1]["stock"] == 0,
          "attach: siblings in order with price / stock")
    check(docs[1]["formats"] == [], "ordinary book: formats = []")
    ranked = await F.to_primaries([dict(hb), dict(pb), {"id": "x"}])
    check([d["id"] for d in ranked] == ["pb", "x"], "bestsellers: Hardback's sales shown as the title, once")

    print("-- link an existing book, change primary --")
    await db.books.insert_one({"id": "dj", "title": "Story of the Clan (DJ)", "isbn": "9780306406157", "price": 1200, "stock": 3})
    lk = await F.bf_lookup("9780306406157", book_id="pb")
    check(lk["action"] == "link" and not lk["in_other_group"], "lookup: an existing ISBN would be linked")
    check((await F.bf_lookup("9780000000002", book_id="pb"))["action"] == "create", "lookup: unknown ISBN would be created")
    out = await F.bf_save("pb", body([row(book_id="pb", label="Paperback", price=595),
                                      row(book_id=hb["id"], label="Hardback", price=950),
                                      row(isbn="9780306406157", label="Hardback with dust jacket", price=1200)], primary_index=1), ADMIN)
    dj = await db.books.find_one({"id": "dj"}, {"_id": 0})
    check(dj["stock"] == 3 and dj["format_label"] == "Hardback with dust jacket" and dj["title"] == "Story of the Clan (DJ)",
          "existing book linked as-is (stock, title kept)")
    hb = await db.books.find_one({"id": hb["id"]}, {"_id": 0})
    pb = await db.books.find_one({"id": "pb"}, {"_id": 0})
    check(hb["format_primary"] is True and pb["format_primary"] is False and hb["price"] == 950, "primary moved to Hardback; its price edited")
    check("format_isbns" not in pb and PB in hb["format_isbns"], "search ISBNs moved with the primary")
    e = await err(F.bf_save("x", body([row(book_id="x", label="Paperback", price=300),
                                       row(isbn="9780306406157", label="Hardback", price=900)]), ADMIN))
    check(e and e.status_code == 400 and "another title" in e.detail, "a format already in another title can't be stolen")
    e = await err(F.bf_save("pb", body([row(book_id="pb", label="Paperback", price=595),
                                        row(book_id="x", label="Hardback", price=900)]), ADMIN))
    check(e and e.status_code == 409, "a book id that isn't in this title is refused")
    await db.books.insert_one({"id": "pk", "product_type": "pack", "title": "Pack", "isbn": "9780306406157"})
    e = await err(F.bf_save("pk", body([]), ADMIN))
    check(e and e.status_code == 400, "packs / hampers can't have formats")

    print("-- remove one, heal after delete, switch off --")
    await F.bf_save("pb", body([row(book_id="pb", label="Paperback", price=595),
                                row(book_id=hb["id"], label="Hardback", price=950)], primary_index=1), ADMIN)
    dj = await db.books.find_one({"id": "dj"}, {"_id": 0})
    check(dj and "format_group" not in dj and "format_primary" not in dj, "removed row is unlinked, not deleted — back as its own card")
    await db.books.delete_one({"id": hb["id"]})          # the LISTED format deleted in Books
    r = await F.heal()
    pb = await db.books.find_one({"id": "pb"}, {"_id": 0})
    check(r["unlinked"] == 1 and "format_group" not in pb, "last format standing becomes an ordinary book again")
    allb = await db.books.find({}, {"_id": 0}).to_list(50)
    check("pb" in [d["id"] for d in listed(allb)], "…so it is back on the shelf, not lost")

    await F.bf_save("pb", body([row(book_id="pb", label="Paperback", price=595),
                                row(isbn="9780306406157", label="Hardback", price=1100),
                                row(isbn="9780000000002", label="Spiral bound", price=450)]), ADMIN)
    await db.books.delete_one({"id": "pb"})
    await F.heal()
    grp = [d for d in await db.books.find({"format_group": {"$exists": True}}, {"_id": 0}).to_list(50)]
    check(len(grp) == 2 and sum(1 for d in grp if d.get("format_primary") is True) == 1,
          "primary deleted: another format is promoted, the title stays listed")
    anyone = grp[0]["id"]
    out = await F.bf_save(anyone, body([]), ADMIN)
    left = await db.books.find({"format_group": {"$exists": True}}, {"_id": 0}).to_list(50)
    check(not out["enabled"] and left == [] and len(await db.books.find({"id": {"$in": [g["id"] for g in grp]}}, {"_id": 0}).to_list(9)) == 2,
          "switch off: every format unlinked, none deleted")
    check(AUDIT[-1] == "BOOK_FORMATS_OFF", "switch-off audited")


asyncio.run(main())
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
