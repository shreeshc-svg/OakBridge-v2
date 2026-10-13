"""Pack specifications (backend/packs.py) on the in-memory fake DB, with
FastAPI / pydantic / extensions stubbed — the real create/update code runs.

A pack made this year can hold books published years ago: its publication
year, pages, size, binding, language and publisher are the admin's to set.

Run: python backend/tests/test_pack_specs.py
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


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self):
        # Every declared field, like pydantic: unset ones come back as None.
        out = {}
        for klass in reversed(type(self).__mro__):
            for k, v in getattr(klass, "__annotations__", {}).items():
                out[k] = getattr(self, k, None)
        return out


def Field(default=None, **k):
    return None if default is ... else default


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m


_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None)
_mod("pydantic", BaseModel=BaseModel, Field=Field)
db = DB()
_mod("extensions", db=db, require_admin=None, rank_for_year=lambda y: (2100 - int(y)) + 0.5 if y else 0.5)

import packs  # noqa: E402


async def main():
    for b in ({"id": "a", "title": "Old Law Book", "author": "A", "pages": 300, "publication_year": 2019},
              {"id": "b", "title": "Tax Guide", "author": "B", "pages": 200, "publication_year": 2022},
              {"id": "c", "title": "Third", "author": "C", "pages": 100, "publication_year": 2024}):
        await db.books.insert_one(b)

    base = dict(title="Law Pack", isbn="9780000000017", category="law", original_price=1000,
                pricing_mode="fixed", pricing_value=900, stock=5, pack_items=["a", "b"], enabled=True,
                subtitle=None, subject=None, description="", cover_image="", language=None, publisher=None,
                binding=None, publication_year=None, pages=None, size=None)

    print("-- create --")
    p = await packs.admin_create_pack(packs.PackCreate(**base))
    check(p["publication_year"] == packs._this_year(), f"year defaults to the year the pack is made ({p['publication_year']}), not a book's")
    check(p["pages"] == 500 and p["pages_manual"] is None, "pages add up the books by default")
    check(p.get("release_rank") is not None, "it gets a 'Newest' rank")
    p2 = await packs.admin_create_pack(packs.PackCreate(**{**base, "isbn": "9780000000024", "publication_year": 2025,
                                                           "pages": 640, "size": " Royal · 24 × 16 cm ", "binding": "Paperback"}))
    check(p2["publication_year"] == 2025 and p2["pages"] == 640 and p2["pages_manual"] == 640, "admin's year and pages kept")
    check(p2["size"] == "Royal · 24 × 16 cm" and p2["binding"] == "Paperback", "size and binding saved (trimmed)")
    try:
        await packs.admin_create_pack(packs.PackCreate(**{**base, "isbn": "9780000000031", "publication_year": 1850}))
        check(False, "a year of 1850 should be refused")
    except HTTPException as e:
        check(e.status_code == 400 and "1900" in e.detail, "impossible year refused")

    print("-- edit --")
    pid = p["id"]
    u = await packs.admin_update_pack(pid, packs.PackBase(publication_year=2026, size="Demy", language="Hindi",
                                                          publisher="Oakbridge", binding="Hardback"))
    check(u["publication_year"] == 2026 and u["size"] == "Demy" and u["language"] == "Hindi" and u["binding"] == "Hardback",
          "every specification is editable")
    check(u["pages"] == 500, "untouched pages stay automatic")
    u = await packs.admin_update_pack(pid, packs.PackBase(pages=720))
    check(u["pages"] == 720 and u["pages_manual"] == 720, "admin sets pages")
    u = await packs.admin_update_pack(pid, packs.PackBase(pack_items=["a", "b", "c"]))
    check(u["pages"] == 720, "adding a book does not overwrite the admin's page count")
    u = await packs.admin_update_pack(pid, packs.PackBase(pages=0))
    check(u["pages"] == 600 and u["pages_manual"] is None, "0 hands pages back to the sum (300+200+100)")
    u = await packs.admin_update_pack(pid, packs.PackBase(pack_items=["a", "c"]))
    check(u["pages"] == 400, "automatic pages follow the books")
    u = await packs.admin_update_pack(pid, packs.PackBase(enabled=False))
    check(u["publication_year"] == 2026 and u["pages"] == 400, "a show/hide toggle changes no specification")
    rank_before = u["release_rank"]
    u = await packs.admin_update_pack(pid, packs.PackBase(publication_year=2024))
    check(u["release_rank"] != rank_before, "changing the year re-slots it under 'Newest'")

    print("-- the books inside keep their own years --")
    items = (await packs.pack_items(p2["id"]))["items"]
    check([i.get("publication_year") for i in items] == [2019, 2022], "pack page lists each book's own year")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
