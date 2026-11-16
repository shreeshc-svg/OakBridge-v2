"""Search that learns (search_learning_core.py + search_learning.py) on the
fake DB with a fake AI. Run: python backend/tests/test_search_learning.py"""
import asyncio
import json
import os
import sys
import types
from datetime import datetime, timezone

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


import search_learning_core as C  # noqa: E402

BOOKS = [{"id": "ce", "title": "Compulsory English for IAS (Mains) Examination 6/e", "author": "Arvind", "subject": "UPSC"},
         {"id": "pl", "title": "Ramanujan's Patent Law", "author": "Adarsh Ramanujan", "subject": "IP"},
         {"id": "cl", "title": "Company Law Handbook", "author": "X", "subject": "Corporate"}]
print("-- rules --")
check(C.norm("  Compulsary  English, for CIVIL & judicial!! ") == "compulsary english for civil judicial", "search key normalised")
asked = {C.norm(q): q for q in ("compulsory english for civil and judicial services examinations", "patent law cases and materials", "dissent")}
items = [{"q": "compulsory english for civil and judicial services examinations", "kind": "title", "books": [1], "confidence": 0.95, "reason": "Same author's English book"},
         {"q": "patent law cases and materials", "kind": "related", "books": [2, 99, "x"], "confidence": 0.7, "reason": "Patent law"},
         {"q": "dissent", "kind": "not_ours", "books": [3], "confidence": 0.9},
         {"q": "something we never asked", "kind": "title", "books": [1]},
         {"q": "dissent", "kind": "hack", "books": [1]}, "garbage"]
v = [C.validate(i, asked, BOOKS) for i in items]
check(v[0]["book_ids"] == ["ce"] and v[1]["book_ids"] == ["pl"], "book numbers mapped to OUR ids; invented numbers dropped")
check(v[2]["kind"] == "not_ours" and v[2]["book_ids"] == [], "not_ours carries no books")
check(v[3] is None and v[4] is None and v[5] is None, "unasked searches, unknown kinds and junk are dropped")
check(C.validate({"q": "dissent", "kind": "title", "books": [77]}, asked, BOOKS)["kind"] == "not_ours", "'title' pointing at nothing real becomes not_ours")
title_of = {b["id"]: b["title"] for b in BOOKS}
check(not C.auto_ok(v[0], title_of), "'civil and judicial services' ≠ 'IAS' title words -> waits for a person")
check(C.auto_ok({"kind": "title", "book_ids": ["ce"], "confidence": 0.95, "q": "compulsry english ias mains examination"}, title_of),
      "near-title typo, model sure, words checked -> applied automatically")
check(not C.auto_ok({"kind": "title", "book_ids": ["ce"], "confidence": 0.6, "q": "compulsory english ias mains"}, title_of), "not sure enough -> waits")
check(C.parse('Sure! ```json\n[{"q":"a"}]\n``` hope that helps') == [{"q": "a"}] and C.parse("no json") == [], "answer parsed out of prose")
check("We don't list" in C.note_for("related", "dissent", 2) and C.note_for("not_ours", "x", 0) == "", "visitor note written by our code")
check(C.needs_review({"hits": 20, "clicks": 0}) and not C.needs_review({"hits": 20, "clicks": 1}), "fires a lot, never clicked -> review")


# ------------------------------------------------------------- the loop ---
class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(str(detail))
        self.status_code = status_code


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return lambda *a, **k: (lambda f: f)


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _mod(n, **a):
    m = types.ModuleType(n)
    m.__dict__.update(a)
    sys.modules[n] = m


async def _anoop(*a, **k):
    return None

db = DB()
REPLY = {"text": ""}


async def _gen(system, prompt, temp=0.7):
    REPLY["prompt"] = prompt
    return REPLY["fn"](prompt) if REPLY.get("fn") else REPLY["text"]


def num(prompt, title_start):
    """The number the job gave a book in the list it sent (sorted by title)."""
    for line in prompt.splitlines():
        if " | " in line and line.split(" | ")[1].startswith(title_start):
            return int(line.split(" | ")[0])

_mod("fastapi", APIRouter=_Router, Depends=lambda *a, **k: None, HTTPException=HTTPException)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, require_admin=None, require_superadmin=None)
_mod("audit", audit_log=_anoop)
_mod("features", _CRAWLER_QUERIES={"search_term_string"}, _is_isbn=lambda q: q.replace("-", "").isdigit() and len(q.replace("-", "")) in (10, 13))
_mod("llm", generate=_gen, describe=lambda: "test-model")
_mod("ai_insights", _enabled=lambda: _true())


async def _true():
    return True

import search_learning as SL  # noqa: E402


async def flow():
    for b in BOOKS:
        await db.books.insert_one({**b, "enabled": True})
    now = datetime.now(timezone.utc)
    for q, n, res, fixed in (("compulsory english for civil and judicial services examinations", 2, 0, None), ("dissent", 3, 0, None),
                             ("patent law cases and materials", 1, 0, None), ("tips and trivks", 1, 0, "tips and tricks"),
                             ("law", 5, 4, None), ("9789395764957", 1, 0, None)):
        for _ in range(n):
            await db.search_logs.insert_one({"q": q, "q_lower": q, "results": res, "corrected_to": fixed, "at": now})
    dead = await SL._dead_searches()
    check([d["q"] for d in dead] == ["dissent", "compulsory english for civil and judicial services examinations", "patent law cases and materials"],
          "only true dead ends go to the AI (not typo-rescued, not found-elsewhere, not ISBNs), most searched first")
    REPLY["fn"] = lambda p: json.dumps([{"q": "dissent", "kind": "not_ours", "books": [], "confidence": 0.8},
                                        {"q": "compulsory english for civil and judicial services examinations", "kind": "title",
                                         "books": [num(p, "Compulsory English")], "confidence": 0.95},
                                        {"q": "patent law cases and materials", "kind": "related", "books": [num(p, "Ramanujan")], "confidence": 0.7}])
    r = await SL.learn()
    check(r == {"asked": 3, "proposed": 3, "auto": 0}, "3 proposals saved, none auto-applied")
    check(" | Compulsory English for IAS" in REPLY["prompt"] and "| ce" not in REPLY["prompt"] and "ce |" not in REPLY["prompt"],
          "the AI sees numbered titles, never our ids")
    check(await SL.lookup("compulsory english for civil and judicial services examinations") is None, "nothing goes live before a person approves")
    lst = await SL.sl_list()
    check(len(lst["suggested"]) == 3 and [a["q"] for a in lst["asked_for"]] == ["dissent"], "admin sees proposals and 'titles people ask for'")
    rid = next(x["id"] for x in lst["suggested"] if x["kind"] == "title")
    await SL.sl_approve(rid, {"email": "boss@o.in", "role": "superadmin"})
    hit = await SL.lookup("Compulsory  English for Civil and Judicial Services Examinations")
    check(hit and hit["book_ids"] == ["ce"] and "closest match" in hit["note"], "approved: the same search (any case/spacing) now finds our book")
    nid = next(x["id"] for x in lst["suggested"] if x["kind"] == "not_ours")
    try:
        await SL.sl_approve(nid, {"email": "b"})
        check(False, "approving a not_ours")
    except HTTPException as e:
        check(e.status_code == 400, "a 'not ours' signal has nothing to approve")
    await SL.rewrite_click(SL.ClickBody(rewrite_id=rid, book_id="ce"))
    await SL.rewrite_click(SL.ClickBody(rewrite_id=rid, book_id="pl"))
    check((await db.search_rewrites.find_one({"id": rid}))["clicks"] == 1, "clicks counted only for books the fix showed")
    await SL.sl_disable(rid, {"email": "b"})
    SL._cache["at"] = 0
    check(await SL.lookup("compulsory english for civil and judicial services examinations") is None, "disabled: off the site at once")
    check((await SL.learn())["asked"] == 0, "nothing is asked twice")
    REPLY["fn"] = None
    REPLY["text"] = "the model is having a bad day"
    await db.search_logs.insert_one({"q": "new dead end", "q_lower": "new dead end", "results": 0, "corrected_to": None, "at": now})
    check((await SL.learn())["proposed"] == 0, "a useless answer changes nothing")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
