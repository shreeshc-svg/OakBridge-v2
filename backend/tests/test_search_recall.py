"""
Two ways a search for a book we DO sell returned nothing.

    python backend/tests/test_search_recall.py
    (or: pytest backend/tests/test_search_recall.py)

Both were found in the zero-result search log, not in code review, and both are
invisible from the inside: the endpoint returns 200 with an empty list, the page
says "no titles found", and the only trace is a line in a report nobody reads
daily.

THE TWO

1. "praveen kumar" — 5 searches in a month, 0 results. The catalogue carries
   "Disaster Management, 2/e" credited to "P Kumar", and AUTHOR_ALIASES has said
   since 2026-08-25 that they are one man. But that table was only ever read by
   the author index, which answers "who wrote this book"; book search asks a
   different question of a different collection and never consulted it.

2. "environment and ecology with disaster management, 5th ed" — 0 results, while
   the same query WITHOUT the suffix returns three titles, one of them the fifth
   edition being asked for. Search AND-s every token, the catalogue spells it
   "5/e", and so the two words the shopper added to be more specific were the
   two that emptied the shelf.

These tests import server.py's own helpers rather than restating the regexes, so
they check the behaviour and not a copy of it.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# server.py builds a Mongo client at import time from the environment. These are
# never connected to — nothing below awaits a query — but they have to parse.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "oakbridge_test")
os.environ.setdefault("JWT_SECRET", "test-only-not-a-real-secret")

import server  # noqa: E402


# --------------------------------------------------------------------------
# Edition suffixes
# --------------------------------------------------------------------------

def test_the_logged_query_loses_only_its_suffix():
    assert server._strip_edition(
        "environment and ecology with disaster management, 5th ed"
    ) == "environment and ecology with disaster management"


def test_every_way_a_shopper_writes_an_edition():
    for suffix in ("5th ed", "5th edition", "5 ed", "5th edn", "5TH ED", "5th ed."):
        got = server._strip_edition(f"disaster management {suffix}")
        assert got == "disaster management", f"{suffix!r} left {got!r}"


def test_a_real_word_edition_is_left_alone():
    """"Premium Collectors' Edition" is part of a title, not a suffix. The rule
    only fires on a DIGIT followed by ed/edn/edition, which is why."""
    q = "valmiki ramayana premium collectors edition"
    assert server._strip_edition(q) == q


def test_a_bare_number_is_left_alone():
    """Otherwise "Article 370" and "Yearbook of India 2026" lose their point."""
    assert server._strip_edition("article 370") == "article 370"
    assert server._strip_edition("yearbook of india 2026") == "yearbook of india 2026"


def test_stripping_never_returns_nothing():
    """A query that is ONLY an edition still has to search for something, or
    typing "2nd ed" turns into a match-everything empty query."""
    assert server._strip_edition("2nd ed") == "2nd ed"


def test_the_stripped_query_is_what_gets_searched():
    """The clause builder must consume the stripped form, not merely have a
    helper available that nothing calls."""
    with_suffix = server._search_clauses("disaster management 5th ed")
    without = server._search_clauses("disaster management")
    assert with_suffix == without


# --------------------------------------------------------------------------
# Author aliases
# --------------------------------------------------------------------------

def test_the_alias_table_is_still_the_source():
    """If this key is ever removed, the test below would pass vacuously."""
    assert "p-kumar" in server.AUTHOR_ALIASES
    assert "Praveen Kumar" in server.AUTHOR_ALIASES["p-kumar"]


def test_praveen_kumar_also_searches_for_p_kumar():
    matches = server._alias_matches("praveen kumar")
    assert ("", "p kumar") in matches, matches


def test_and_the_other_direction():
    """We cannot know which spelling the shopper has seen, so both work."""
    matches = server._alias_matches("p kumar")
    assert ("", "praveen kumar") in matches, matches


def test_a_name_inside_a_longer_query_keeps_the_rest():
    """The subject must stay AND-ed, or the branch widens to every title the
    man ever wrote."""
    matches = server._alias_matches("disaster management praveen kumar")
    assert ("disaster management", "p kumar") in matches, matches


def test_an_unrelated_query_produces_no_matches():
    """Cheap assurance that this does not quietly widen every search."""
    assert server._alias_matches("mediation") == []


def test_an_alias_must_be_whole_words():
    """"p kumar" sits inside "deep kumar" as a substring."""
    assert server._alias_matches("deep kumar") == []


# --------------------------------------------------------------------------
# Initials — the bug that shipped
# --------------------------------------------------------------------------

def test_an_initial_is_never_searched_as_a_token():
    """THE REGRESSION THIS FILE EXISTS FOR.

    The first version swapped the spelling and handed the result to the
    ordinary tokeniser, which AND-s words across all fields. "P Kumar" became
    "p" AND "kumar" — and "p" is a ONE-CHARACTER pattern matching any field
    containing the letter p. Live, that returned Sacred Tiger Tales by Dr Manoj
    Kumar and never surfaced the book credited to P Kumar at all.

    Worse than the empty shelf it replaced: an empty result says "we don't have
    it", a wrong result says "this is what we have".
    """
    clauses = server._alias_aware_clauses("praveen kumar")
    blob = repr(clauses)
    # A bare single-character alternative, e.g. {"title": {"$regex": "p", ...}}
    assert '"$regex": "p"' not in blob and "'$regex': 'p'" not in blob, blob


def test_the_alias_branch_matches_the_author_field_as_a_phrase():
    clauses = server._alias_aware_clauses("praveen kumar")
    branches = clauses[0]["$or"]
    alias_branch = branches[-1]["$and"]
    assert len(alias_branch) == 1
    cond = alias_branch[0]
    assert set(cond) == {"author"}, cond
    assert "kumar" in cond["author"]["$regex"]


def test_the_phrase_matches_the_initial_but_not_a_longer_name():
    import re as _re

    rx = _re.compile(server._name_phrase("p kumar"), _re.IGNORECASE)
    assert rx.search("P Kumar")
    assert rx.search("Dr P. Kumar")
    assert rx.search("P.Kumar")
    # The ones that polluted the live results.
    assert not rx.search("Dr Manoj Kumar")
    assert not rx.search("Dr Prabhat Kumar & D")
    assert not rx.search("Deep Kumar")


def test_the_phrase_is_empty_for_an_empty_name():
    assert server._name_phrase("") == ""
    assert server._name_phrase("   ") == ""


def test_single_word_aliases_are_refused():
    """A one-word alias would match inside half the catalogue — the same trap
    author_match_key guards against when it refuses to collapse "Rao, IAS"."""
    for a, b in server._alias_pairs():
        assert len(a.split()) >= 2 and len(b.split()) >= 2, (a, b)


def test_pairs_are_symmetric():
    pairs = set(server._alias_pairs())
    for a, b in pairs:
        assert (b, a) in pairs, f"{a!r} -> {b!r} has no return direction"


# --------------------------------------------------------------------------
# The clause shape — where this could go wrong silently
# --------------------------------------------------------------------------

def test_variants_are_or_ed_but_words_stay_and_ed():
    """THE ONE THAT MATTERS.

    The lazy version ORs the individual word clauses together, which drops the
    AND between the words: "praveen kumar" would become "anything containing
    praveen OR anything containing kumar" and return most of the Kumars in the
    catalogue. Each SPELLING is a complete AND-ed query; the spellings are what
    get OR-ed.
    """
    clauses = server._alias_aware_clauses("praveen kumar")
    assert len(clauses) == 1
    branches = clauses[0]["$or"]
    assert len(branches) >= 2
    # Branch 1 is what was typed: two words in, two AND-ed conditions out.
    assert len(branches[0]["$and"]) == 2
    # Branch 2 is the alias: one phrase condition, not two loose tokens.
    assert len(branches[-1]["$and"]) == 1


def test_a_query_with_no_alias_is_unchanged():
    """No wrapper, no behaviour change, for the overwhelming majority of
    searches — this must not become an $or of one."""
    assert server._alias_aware_clauses("mediation") == server._search_clauses("mediation")


def test_an_empty_search_produces_no_clauses():
    assert server._alias_aware_clauses("") == []
    assert server._alias_aware_clauses("   ") == []


def test_clauses_are_still_injection_safe():
    """Every pattern must compile — a query containing "(2 Vol. Set)*+" used to
    reach the regex engine as a PATTERN and could 500 the endpoint.

    Compiling is the real assertion: a metacharacter that survived unescaped
    either raises here or silently means something, and both are the bug.
    """
    import re as _re

    for clause in server._alias_aware_clauses("(2 Vol. Set)*+ [a-z] praveen kumar"):
        for cond in clause.get("$or", [clause]):
            for branch in cond.get("$and", [cond]):
                for field_q in branch.get("$or", [branch]):
                    for spec in field_q.values():
                        if isinstance(spec, dict) and "$regex" in spec:
                            _re.compile(spec["$regex"])


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {name}: {exc or 'assertion failed'}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"ERROR {name}: {type(exc).__name__}: {exc}")
        else:
            print(f"ok    {name}")
    print()
    if failures:
        print(f"{failures} test(s) failed")
        raise SystemExit(1)
    print("all tests passed")
