"""'Latest releases — picked for each reader' (Admin → Users → Email selected).

Run: python backend/tests/test_for_you.py

- pick_for_you: never a book already bought; cart / notify-me first, then same
  author, subject, category; topped up with the newest so nobody gets an empty email;
- reader_profile / attach_picks against a fake database (pulled out of
  marketing.py with ast — it needs the whole app to import);
- the for_you block renders each reader's own picks, and nothing without them.
"""
import ast
import asyncio
import os
import re
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from _fakedb import DB  # noqa: E402
import marketing_core as core  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


POOL = [  # newest first
    {"id": "n1", "title": "Tax Today", "author": "A Rao", "subject": "Tax", "category": "tax", "price": 500},
    {"id": "n2", "title": "Contracts 4/e", "author": "Bhumesh Verma", "subject": "Law", "category": "law", "price": 900},
    {"id": "n3", "title": "UPSC History", "author": "M Rai", "subject": "Academic", "category": "academic", "price": 400},
    {"id": "n4", "title": "Arbitration", "author": "K Kannan", "subject": "Law", "category": "law", "price": 700},
    {"id": "n5", "title": "Old favourite", "author": "Bhumesh Verma", "subject": "Law", "category": "law", "price": 300},
]
print("-- pick_for_you --")
p = core.pick_for_you({"bought": {"n5"}, "interest": set(), "authors": {"bhumesh verma": 1}, "subjects": {"law": 1}, "categories": {"law": 1}}, POOL, 3)
check([b["id"] for b in p] == ["n2", "n4", "n1"], f"same author first, then same subject; never the one bought; topped up newest ({[b['id'] for b in p]})")
p = core.pick_for_you({"bought": set(), "interest": {"n3"}, "authors": {}, "subjects": {}, "categories": {}}, POOL, 2)
check([b["id"] for b in p] == ["n3", "n1"], "a book in their cart / notify-me list leads")
p = core.pick_for_you({}, POOL, 3)
check([b["id"] for b in p] == ["n1", "n2", "n3"], "no history: the newest releases")
check(core.pick_for_you({"bought": {b["id"] for b in POOL}}, POOL, 3) == [], "bought everything: nothing to suggest")

print("-- render --")
contact = {"name": "Asha", "_picks": [{"title": "Contracts 4/e", "author": "Bhumesh Verma", "price": "₹900", "cover": "",
                                       "url": "https://www.oakbridge.in/books/n2", "why": "Because you read Bhumesh Verma"}]}
html_doc, text_doc = core.render_email([{"type": "for_you", "text": "Picked for you"}], brand={}, contact=contact,
                                       link_for=lambda u: "https://track/" + str(len(u)))
check("Contracts 4/e" in html_doc and "Because you read Bhumesh Verma" in html_doc and "https://track/" in html_doc, "renders the reader's own picks, tracked")
html2, _ = core.render_email([{"type": "for_you", "text": "Picked for you"}], brand={}, contact={"name": "X"}, link_for=lambda u: u)
check("Picked for you" not in html2, "no picks: the block renders nothing")
check(any(t["key"] == "for-you" for t in core.STARTER_TEMPLATES), "starter template exists")

print("-- profile from our records --")
src = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
want = {"_for_you_count", "release_pool", "reader_profile", "attach_picks", "_abs_media"}
fns = [n for n in ast.parse(src).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want]
assert {f.name for f in fns} == want
db = DB()
sys.modules["emailer"] = types.SimpleNamespace(media_url=lambda u: ("https://cdn" + u) if u else "")
ns = {"db": db, "core": core, "re": re, "SITE": "https://www.oakbridge.in", "Optional": __import__("typing").Optional}
exec(compile(ast.Module(body=fns, type_ignores=[]), "marketing.py", "exec"), ns)


async def main():
    for i, b in enumerate(POOL):
        await db.books.insert_one({**b, "cover_image": f"/c/{b['id']}.jpg", "stock": 5, "enabled": True, "release_rank": i, "new_release": True})
    await db.books.insert_one({"id": "hid", "title": "Hidden", "enabled": False, "stock": 5, "cover_image": "/c/h.jpg"})
    await db.users.insert_one({"id": "u1", "email": "asha@example.com", "email_normalised": "asha@example.com"})
    await db.orders.insert_one({"user_id": "u1", "email": "Asha@Example.com", "payment_status": "paid", "items": [{"book_id": "n5"}]})
    await db.orders.insert_one({"user_id": "u1", "email": "asha@example.com", "payment_status": "pending", "items": [{"book_id": "n1"}]})
    await db.carts.insert_one({"user_id": "u1", "items": [{"book_id": "n3"}]})
    prof = await ns["reader_profile"]("asha@example.com")
    check(prof["bought"] == {"n5"} and prof["interest"] == {"n3"}, "paid orders only count as bought; the cart is interest")
    check(prof["authors"].get("bhumesh verma") == 1 and prof["subjects"].get("law") == 1, "author / subject learned from what they bought")
    pool = await ns["release_pool"]()
    check("hid" not in {b["id"] for b in pool}, "hidden titles never suggested")
    camp = {"blocks": [{"type": "for_you", "count": 3}]}
    c = {"email": "asha@example.com", "email_norm": "asha@example.com"}
    urls = await ns["attach_picks"](c, camp, pool)
    ids = [u.rsplit("/", 1)[-1] for u in urls]
    check(ids[0] == "n3" and "n5" not in ids and len(ids) == 3, f"cart book first, bought book never ({ids})")
    check(all(p["cover"].startswith("https://cdn") for p in c["_picks"]) and c["_picks"][0]["why"] == "You asked about this one", "absolute covers + a reason")
    check(await ns["attach_picks"]({"email": "x@y.z"}, {"blocks": [{"type": "text"}]}, pool) == [], "no for_you block: no picks work at all")

asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
