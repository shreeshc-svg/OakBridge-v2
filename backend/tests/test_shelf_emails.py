"""Admin → Users → Email all customers: "Bestsellers" and "Hot off the
press" drafts (marketing.py shelf_template, Nov 2026). The shelf helpers are
extracted by name and fed the homepage endpoints' output through a stub
`server` module. Run: python backend/tests/test_shelf_emails.py"""
import ast
import asyncio
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    failed += 0 if cond else 1


class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


BEST = [{"id": "b1", "title": "Sold Out Hit", "author": "A", "price": 400, "stock": 0, "cover_image": "/api/files/c1.jpg"},
        {"id": "b2", "title": "Top Seller", "author": "B", "price": 1036.0, "stock": 5, "cover_image": "/api/files/c2.jpg"}] + \
       [{"id": f"x{i}", "title": f"T{i}", "author": "C", "price": 300, "stock": 3, "cover_image": ""} for i in range(8)]
NEW = [{"id": "n1", "title": "Pre-order", "author": "D", "price": 500, "stock": 0, "coming_soon": True, "cover_image": ""},
       {"id": "n2", "title": "Gone", "author": "E", "price": 500, "stock": 0, "cover_image": ""}]
srv = types.ModuleType("server")


async def _best(limit=12, days=90):
    return BEST


async def _new(limit=8):
    return NEW

srv.bestseller_books, srv.new_release_books = _best, _new
sys.modules["server"] = srv
ns = {"HTTPException": HTTPException, "SITE": "https://www.oakbridge.in", "_abs_media": lambda u: ("https://cdn.x" + u) if u else ""}
for node in ast.parse(SRC).body:
    name = getattr(node, "name", None) or next((getattr(t, "id", "") for t in getattr(node, "targets", [])), "")
    if name in ("SHELF_EMAILS", "SHELF_EMAIL_BOOKS", "_buyable", "shelf_books", "shelf_template"):
        exec(compile(ast.Module([node], []), "marketing.py", "exec"), ns)


async def main():
    t = await ns["shelf_template"]("bestsellers")
    books = [b for b in t["blocks"] if b["type"] == "book"]
    check(len(books) == 6 and books[0]["book_id"] == "b2", "up to 6, in the site's order, sold-out skipped")
    check(books[0]["price"] == "₹1,036" and books[0]["url"] == "https://www.oakbridge.in/books/b2" and books[0]["cover"] == "https://cdn.x/api/files/c2.jpg",
          "a normal book block: price, link, absolute cover — editable in the draft")
    check(t["blocks"][-1]["url"] == "https://www.oakbridge.in/books?bestseller=true", "button goes to all bestsellers")
    h = await ns["shelf_template"]("hot-press")
    hb = [b for b in h["blocks"] if b["type"] == "book"]
    check([b["book_id"] for b in hb] == ["n1"] and "new_release=true" in h["blocks"][-1]["url"], "hot off the press: a live pre-order counts, sold-out doesn't")
    NEW[0]["coming_soon"] = False
    try:
        await ns["shelf_template"]("hot-press")
        check(False, "nothing buyable -> refused")
    except HTTPException as e:
        check(e.status_code == 409, "nothing in stock to send -> a clear refusal, not an empty email")

asyncio.run(main())
code = re.sub(r'"""[\s\S]*?"""', "", SRC)
fn = code[code.index("async def adm_list_from_users"):code.index("people: dict = {}", code.index("async def adm_list_from_users"))]
check("shelf = await shelf_template(tmpl) if tmpl in SHELF_EMAILS else None" in fn and 'raise HTTPException(status_code=400, detail="Unknown email type.")' in fn,
      "checked BEFORE the list is made: no half-done list when there's nothing to send")
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
