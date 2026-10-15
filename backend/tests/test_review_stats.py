"""Stars on book pages come only from real reviews (extensions.refresh_review_stats).

Every book used to show 4.5 — the value it was created with — next to "No
reviews yet". The function is pulled out of extensions.py with ast (that module
needs the whole app) and run on the in-memory fake DB.

Run: python backend/tests/test_review_stats.py
"""
import ast
import asyncio
import os
import sys
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(os.path.dirname(HERE), "extensions.py"), encoding="utf-8").read()
fn = [n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "refresh_review_stats"]
assert fn, "refresh_review_stats not found"
db = DB()
ns = {"db": db, "Optional": Optional}
exec(compile(ast.Module(body=fn, type_ignores=[]), "<extensions>", "exec"), ns)
refresh = ns["refresh_review_stats"]


async def main():
    for b in ("a", "b", "c"):
        await db.books.insert_one({"id": b, "rating": 4.5})
    for bid, r in (("a", 5), ("a", 4), ("a", 4), ("b", 2)):
        await db.reviews.insert_one({"book_id": bid, "rating": r})
    n = await refresh()
    book = {d["id"]: d for d in db.books.docs}
    check(n == 2, "backfill touches the two reviewed books")
    check(book["a"]["review_count"] == 3 and book["a"]["rating_avg"] == 4.3, f"a: 3 reviews, 4.3 ({book['a'].get('rating_avg')})")
    check(book["b"]["review_count"] == 1 and book["b"]["rating_avg"] == 2.0, "b: 1 review, 2.0")
    check("review_count" not in book["c"], "c has no reviews: nothing written, so nothing is shown")
    db.reviews.docs = [d for d in db.reviews.docs if d["book_id"] != "b"]
    await refresh("b")
    check(book["b"]["review_count"] == 0 and book["b"]["rating_avg"] is None, "last review gone -> back to no stars")
    check(all(d["rating"] == 4.5 for d in db.books.docs), "the old 4.5 field is left untouched (and unused)")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
