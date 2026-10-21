"""Hot Off the Press order: pre-orders first, then normal books, newest ADDED first.

Run: python backend/tests/test_hot_press.py

Uses real ObjectIds when pymongo's bson is installed (it is on the server),
else a stand-in with the same two things hot_press reads: generation_time and
a hex string that sorts in insert order.
"""
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from hot_press import hot_order  # noqa: E402

try:
    from bson import ObjectId

    def oid(t, n):
        return ObjectId(ObjectId.from_datetime(t).binary[:4] + n.to_bytes(8, "big"))
except ImportError:  # sandbox
    class ObjectId:
        def __init__(self, t, n):
            self.generation_time = t.replace(microsecond=0)
            self._hex = f"{int(t.timestamp()):08x}{n:016x}"

        def __str__(self):
            return self._hex

    def oid(t, n):
        return ObjectId(t, n)

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


T0 = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
seq = [0]


def book(title, at, rank=None, pre=False):
    seq[0] += 1
    return {"_id": oid(at, seq[0]), "title": title, "release_rank": rank, "pre": pre}


def is_pre(d):
    return d["pre"]


def titles(docs):
    return [d["title"] for d in docs]


# The original catalogue: one burst inside a few seconds, in file order that
# is NOT release order.
seed = [book(f"seed-r{r}", T0 + timedelta(seconds=i // 100), rank=r) for i, r in enumerate([5, 1, 3, 2, 4])]
# Added later by an admin, days apart (all rank 0.5 from rank_for_year).
a1 = book("added-1", T0 + timedelta(days=3), rank=0.5)
a2 = book("added-2", T0 + timedelta(days=5), rank=0.5)
a3 = book("added-3-older-year", T0 + timedelta(days=6), rank=40.5)
# Pre-orders added at different times.
p1 = book("pre-1", T0 + timedelta(days=2), rank=0.5, pre=True)
p2 = book("pre-2", T0 + timedelta(days=7), rank=0.5, pre=True)
# Two added in the same minute: later insert first on equal rank.
b1 = book("same-min-1", T0 + timedelta(days=8), rank=0.5)
b2 = book("same-min-2", T0 + timedelta(days=8, seconds=20), rank=0.5)

docs = seed + [a1, p1, a2, a3, p2, b1, b2]
out = titles(hot_order(list(reversed(docs)), is_pre))
print("   ", out)

check(out[:2] == ["pre-2", "pre-1"], "pre-orders on top, latest added pre-order first")
check(out[2:4] == ["same-min-2", "same-min-1"], "normal books: latest added first (even a minute apart)")
check(out[4:7] == ["added-3-older-year", "added-2", "added-1"], "added date beats publication year / rank")
check(out[7:] == ["seed-r1", "seed-r2", "seed-r3", "seed-r4", "seed-r5"], "a bulk load keeps release order among itself")
check(titles(hot_order(docs, is_pre)) == out, "same answer whatever order the database returns")

# The day a pre-order launches it is a normal book at its added position.
p2["pre"] = False
out2 = titles(hot_order(docs, is_pre))
check(out2[0] == "pre-1" and out2[1:3] == ["same-min-2", "same-min-1"] and out2[3] == "pre-2",
      "launched pre-order joins normal books where its add date puts it")

check(titles(hot_order([{"_id": "not-an-oid", "title": "x", "release_rank": 2, "pre": False}, seed[1]], is_pre)) == ["seed-r1", "x"],
      "no ObjectId: oldest, release order, no crash")

print("-- wiring (code, comments stripped) --")
src = open(os.path.join(os.path.dirname(HERE), "server.py"), encoding="utf-8").read()
code = "\n".join(line for line in src.splitlines() if not line.strip().startswith("#"))
code = re.sub(r'"""[\s\S]*?"""', "", code)
home = code[code.index("async def new_release_books"):code.index("async def new_release_books") + 1500]
check("hot_order(docs, _preorder_active)" in home and 'd.pop("_id"' in home, "homepage row uses hot_order and strips _id")
check('"enabled": {"$ne": False}' in home and "_new_release_clause()" in home, "homepage row: switched-off packs excluded; shared clause")
lst = code[code.index("async def list_books"):code.index("async def _drop_dead_words")]
check('hot = bool(new_release) and sort in (None, "featured")' in lst and "hot_order(docs, _preorder_active)[skip:skip + limit]" in lst,
      "View all (default sort) uses the same order, paginated after ordering")
check(lst.count("to_list(fetch_n)") == 3, "search-fallback paths fetch the whole set too")
check('"coming_soon": True, "launch_at": {"$gte": today}' in code, "unlaunched pre-orders qualify for the row")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
