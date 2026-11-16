"""Search that learns — the rules (Nov 2026). Pure, no I/O; tested by
tests/test_search_learning.py. search_learning.py moves the data.

THE LOOP
  1. Every night the AI reads searches that found NOTHING (on any attempt —
     typo fixes and word-dropping already ran and failed) next to a compact
     list of the catalogue, and proposes for each search:
        title    the visitor meant one of OUR books (another edition, a
                 differently-worded title, an author's other book)
        related  we don't have it, but these titles are what they'd want
        not_ours we don't have it and nothing close — a "titles people ask
                 for" signal for the publishing / listing team
  2. A proposal only ever refers to books BY THEIR NUMBER IN THE LIST WE SENT
     — the model never invents an id, a URL or a sentence the visitor sees.
     Anything else in its answer is dropped (validate()).
  3. Most proposals wait for a person (Admin → Dashboard → Search). Only an
     obvious one is applied by itself (auto_ok): one book, model confident,
     AND the search shares most of its words with that book's title — checked
     here, deterministically, not taken on the model's word.
  4. Applied fixes are measured: how often they fired, how often the visitor
     then clicked a book. A fix that fires a lot and is never clicked is
     flagged for review (needs_review) — the system unlearns bad fixes too.

The visitor-facing note is written by US from the kind and the book titles
(note_for), never by the model.
"""
from __future__ import annotations

import json
import re
from typing import Optional

KINDS = ("title", "related", "not_ours")
MAX_BOOKS = 6
AUTO_CONFIDENCE = 0.9
AUTO_OVERLAP = 0.6
REVIEW_AFTER_HITS = 15            # fired this often with zero clicks -> review
STOP = {"the", "a", "an", "of", "and", "for", "to", "in", "on", "with", "by", "its", "edition", "ed", "vol", "volume", "book", "books"}


def norm(q: str) -> str:
    """The key a search is stored and looked up by."""
    s = re.sub(r"[^0-9a-z]+", " ", str(q or "").lower()).strip()
    return re.sub(r"\s+", " ", s)[:120]


def words(s: str) -> set:
    return {w for w in norm(s).split() if len(w) > 1 and w not in STOP and not w.isdigit()}


def overlap(q: str, title: str) -> float:
    """Share of the search's meaningful words found in the title."""
    qw = words(q)
    if not qw:
        return 0.0
    tw = words(title)
    # prefix match, so "psycology" vs "psychology" does not count, but
    # "contracts" vs "contract" does
    hit = sum(1 for w in qw if any(t.startswith(w[:max(4, len(w) - 2)]) or w.startswith(t[:max(4, len(t) - 2)]) for t in tw))
    return hit / len(qw)


def catalogue_lines(books: list) -> list:
    """Numbered list sent to the model: 'n | title | author | subject'."""
    out = []
    for i, b in enumerate(books, 1):
        bits = [b.get("title") or "", b.get("author") or "", b.get("subject") or b.get("category") or ""]
        out.append(f"{i} | " + " | ".join(re.sub(r"\s+", " ", x).strip()[:90] for x in bits))
    return out


SYSTEM = (
    "You help a book publisher's website search. You are given the publisher's catalogue as numbered lines "
    "and a list of searches that found nothing. For EACH search decide what the visitor wanted. "
    "Answer ONLY with a JSON array, one object per search, in the same order: "
    '{"q": <the search exactly as given>, "kind": "title"|"related"|"not_ours", "books": [catalogue numbers], '
    '"confidence": 0..1, "reason": <one short sentence for the publisher>}. '
    '"title" = they meant this specific book of ours (another edition, a differently-worded title, the author\'s book). '
    '"related" = we do not have it, but these books cover the same subject (max 6). '
    '"not_ours" = nothing in the catalogue fits; books must be []. '
    "Never invent books or numbers. If unsure, use not_ours."
)


def prompt(queries: list, lines: list) -> str:
    return ("CATALOGUE:\n" + "\n".join(lines) + "\n\nSEARCHES THAT FOUND NOTHING:\n"
            + "\n".join(f"- {q}" for q in queries))


def parse(reply: str) -> list:
    """The first JSON array in the reply (models wrap answers in prose / ```)."""
    m = re.search(r"\[[\s\S]*\]", reply or "")
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except (ValueError, TypeError):
        return []
    return data if isinstance(data, list) else []


def validate(item, asked: dict, books: list) -> Optional[dict]:
    """One model answer -> a clean proposal, or None.
    asked: {norm(q): q as searched}; books: the list whose numbers we sent."""
    if not isinstance(item, dict):
        return None
    key = norm(item.get("q"))
    if key not in asked:
        return None
    kind = item.get("kind")
    if kind not in KINDS:
        return None
    ids = []
    for n in item.get("books") or []:
        try:
            n = int(n)
        except (TypeError, ValueError):
            continue
        if 1 <= n <= len(books) and books[n - 1]["id"] not in ids:
            ids.append(books[n - 1]["id"])
    ids = ids[:MAX_BOOKS]
    if kind == "not_ours":
        ids = []
    elif not ids:
        kind = "not_ours"                      # pointed at nothing real
    if kind == "title" and len(ids) > 1:
        kind = "related"
    try:
        conf = max(0.0, min(1.0, float(item.get("confidence") or 0)))
    except (TypeError, ValueError):
        conf = 0.0
    return {"key": key, "q": asked[key], "kind": kind, "book_ids": ids, "confidence": round(conf, 2),
            "reason": re.sub(r"\s+", " ", str(item.get("reason") or "")).strip()[:240]}


def auto_ok(p: dict, title_of: dict) -> bool:
    """Apply without waiting for a person only when it is obvious: one of our
    books, the model sure, and the words checked here."""
    if p["kind"] != "title" or len(p["book_ids"]) != 1 or p["confidence"] < AUTO_CONFIDENCE:
        return False
    return overlap(p["q"], title_of.get(p["book_ids"][0], "")) >= AUTO_OVERLAP


def note_for(kind: str, q: str, n: int) -> str:
    """What the visitor reads above the results — ours, not the model's."""
    q = q.strip()[:60]
    if kind == "title":
        return f"Showing the closest match for “{q}”"
    if kind == "related":
        return f"We don't list “{q}” — {'this title covers' if n == 1 else 'these titles cover'} the same subject"
    return ""


def needs_review(r: dict) -> bool:
    return int(r.get("hits") or 0) >= REVIEW_AFTER_HITS and int(r.get("clicks") or 0) == 0
