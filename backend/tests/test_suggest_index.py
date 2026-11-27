"""Search-box suggestions put books a visitor can buy first (features.
suggest_index, 27 Nov 2026). Extracted by name and run on the fake DB.
Run: python backend/tests/test_suggest_index.py"""
import ast
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    failed += 0 if cond else 1


SRC = open(os.path.join(os.path.dirname(HERE), "features.py"), encoding="utf-8").read()
db = DB()
ns = {"db": db}
for node in ast.parse(SRC).body:
    if isinstance(node, ast.AsyncFunctionDef) and node.name == "suggest_index":
        node.decorator_list = []
        exec(compile(ast.Module([node], []), "features.py", "exec"), ns)


async def main():
    for b in [
        {"id": "sold-new", "title": "Tax Guide 2026", "release_rank": 1, "stock": 0},
        {"id": "stock-old", "title": "Tax Basics", "release_rank": 9, "stock": 4},
        {"id": "pre", "title": "Tax Reform", "release_rank": 5, "stock": 0, "coming_soon": True},
        {"id": "pod", "title": "Tax Cases", "release_rank": 7, "stock": 0, "pod": True},
        {"id": "unranked", "title": "Tax Notes", "stock": 2},
        {"id": "hb", "title": "Tax Basics", "release_rank": 9, "stock": 9, "format_primary": False},
    ]:
        await db.books.insert_one(b)
    ids = [b["id"] for b in (await ns["suggest_index"]())["books"]]
    check(ids == ["pre", "pod", "stock-old", "unranked", "sold-new"], f"buyable first, newest first within; sold-out last ({ids})")
    check("hb" not in ids, "a second format is still not suggested twice")


asyncio.run(main())
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
