"""
Multi-volume sets: the derivation, the renumbering and the refusals.

    pytest backend/tests/test_volume_sets.py

These are real unit tests, not source-text assertions. volume_sets.py imports
nothing from the app — no Mongo, no FastAPI, no settings — precisely so the
arithmetic that decides a published page count can be exercised directly rather
than inferred from a regex over a handler.

WHAT IS ACTUALLY AT RISK

A set's `pages` is the sum of its volumes. It is the only number on the product
page that no human types, so nothing will look wrong if the derivation breaks —
the specs tab would simply print a total that disagrees with the rows printed
underneath it, on a live storefront, indefinitely. That is the failure these
tests exist for, and it is why test_apply_overrides_a_stale_stored_total below
matters more than it looks.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import volume_sets as vs  # noqa: E402


# --------------------------------------------------------------------------
# normalise
# --------------------------------------------------------------------------

def test_normalise_renumbers_from_one():
    """The client's `no` is not trusted. Deleting a row from the middle of the
    admin repeater leaves 1, 3 — an artefact of the deletion, not a fact about
    the book."""
    out = vs.normalise([
        {"no": 1, "title": "Bala Kanda", "pages": 480},
        {"no": 3, "title": "Aranya Kanda", "pages": 448},
    ])
    assert [v["no"] for v in out] == [1, 2]
    assert [v["title"] for v in out] == ["Bala Kanda", "Aranya Kanda"]


def test_normalise_drops_entirely_blank_rows():
    """Clicking '+ Add volume' once too often is not an error worth a toast."""
    out = vs.normalise([
        {"title": "Bala Kanda", "pages": 480},
        {"title": "", "pages": "", "blurb": ""},
        {"title": "Ayodhya Kanda", "pages": 512},
    ])
    assert len(out) == 2
    assert [v["no"] for v in out] == [1, 2]


def test_normalise_keeps_a_row_that_has_only_a_title():
    """A half-filled row is a mistake to REPORT, not one to silently discard —
    dropping it would turn 'you forgot a page count' into 'your volume
    vanished'. validate() is what refuses it."""
    out = vs.normalise([{"title": "Bala Kanda"}, {"title": "Ayodhya Kanda"}])
    assert len(out) == 2
    assert out[0]["pages"] == 0


def test_normalise_coerces_form_strings():
    """Number inputs arrive as strings; blank arrives as ''."""
    out = vs.normalise([{"title": "One", "pages": "480"}, {"title": "Two", "pages": ""}])
    assert out[0]["pages"] == 480
    assert out[1]["pages"] == 0


def test_normalise_survives_junk():
    assert vs.normalise(None) == []
    assert vs.normalise("three volumes") == []
    assert vs.normalise([None, "x", 7]) == []


def test_normalise_caps_runaway_input():
    out = vs.normalise([{"title": f"V{i}", "pages": 10} for i in range(vs.MAX_VOLUMES + 25)])
    assert len(out) == vs.MAX_VOLUMES


def test_normalise_never_emits_negative_pages():
    out = vs.normalise([{"title": "One", "pages": -400}])
    assert out[0]["pages"] == 0


# --------------------------------------------------------------------------
# total_pages
# --------------------------------------------------------------------------

def test_total_pages_sums():
    assert vs.total_pages([{"pages": 480}, {"pages": 512}, {"pages": 448}]) == 1440


def test_total_pages_of_nothing_is_zero():
    assert vs.total_pages([]) == 0
    assert vs.total_pages(None) == 0


# --------------------------------------------------------------------------
# validate
# --------------------------------------------------------------------------

def test_a_set_of_one_is_refused():
    """Otherwise the card reads 'Set of 1 volume', which is a book."""
    err = vs.validate(True, vs.normalise([{"title": "Only", "pages": 300}]))
    assert err is not None
    assert str(vs.MIN_VOLUMES) in err


def test_a_volume_without_a_page_count_is_refused_by_number():
    """Named, because 'a volume is missing pages' on a six-volume set means
    opening all six."""
    err = vs.validate(True, vs.normalise([
        {"title": "One", "pages": 480},
        {"title": "Two"},
        {"title": "Three", "pages": 448},
    ]))
    assert err is not None
    assert "2" in err


def test_a_well_formed_set_passes():
    assert vs.validate(True, vs.normalise([
        {"title": "One", "pages": 480},
        {"title": "Two", "pages": 512},
    ])) is None


def test_an_ordinary_book_is_never_judged_on_its_volumes():
    """Unticking keeps the rows so that re-ticking restores them, so an
    ordinary book carrying a single leftover row must still save."""
    assert vs.validate(False, vs.normalise([{"title": "Leftover", "pages": 0}])) is None
    assert vs.validate(False, []) is None


# --------------------------------------------------------------------------
# apply — the derivation
# --------------------------------------------------------------------------

def test_apply_derives_the_total():
    doc = {
        "is_volume_set": True,
        "pages": 0,
        "volumes": [{"title": "One", "pages": 480}, {"title": "Two", "pages": 512}],
    }
    vs.apply(doc)
    assert doc["pages"] == 992


def test_apply_overrides_a_stale_stored_total():
    """THE ONE THAT MATTERS.

    The bulk CSV importer writes `pages` from a column, so a hand-edited backup
    can put a total into Mongo that disagrees with the volumes beside it. apply()
    runs in _decorate_book on the way out, which is why the product page cannot
    print a total contradicting the rows underneath it.
    """
    doc = {
        "is_volume_set": True,
        "pages": 99999,
        "volumes": [{"title": "One", "pages": 480}, {"title": "Two", "pages": 512}],
    }
    vs.apply(doc)
    assert doc["pages"] == 992


def test_apply_is_a_no_op_on_an_ordinary_book():
    """Called unconditionally on every book response, so this is the common
    case, not the edge case."""
    doc = {"is_volume_set": False, "pages": 320, "volumes": [{"title": "x", "pages": 9}]}
    vs.apply(doc)
    assert doc["pages"] == 320
    assert doc["volumes"] == [{"title": "x", "pages": 9}]


def test_apply_leaves_pages_alone_when_a_set_has_no_usable_volumes():
    """Better a stale number than zero: 0 would render as 'Pages: 0' on a live
    product page, which reads as a defect rather than as missing data."""
    doc = {"is_volume_set": True, "pages": 320, "volumes": []}
    vs.apply(doc)
    assert doc["pages"] == 320


def test_apply_tolerates_junk():
    assert vs.apply(None) is None
    assert vs.apply({}) == {}


def test_apply_renumbers_as_well_as_totals():
    doc = {
        "is_volume_set": True,
        "volumes": [{"no": 7, "title": "One", "pages": 10}, {"no": 9, "title": "Two", "pages": 20}],
    }
    vs.apply(doc)
    assert [v["no"] for v in doc["volumes"]] == [1, 2]
    assert doc["pages"] == 30


# --------------------------------------------------------------------------
# The Penguin reference set, end to end
# --------------------------------------------------------------------------

def test_the_reference_set():
    """The Valmiki Ramayana, Premium Collectors' Edition: three volumes, one
    ISBN, 1440 pages — the example the feature was specified against."""
    doc = {
        "is_volume_set": True,
        "isbn": "9780143477471",
        "pages": 0,
        "volumes": [
            {"no": 1, "title": "Volume 1", "pages": 480},
            {"no": 2, "title": "Volume 2", "pages": 512},
            {"no": 3, "title": "Volume 3", "pages": 448},
        ],
    }
    assert vs.validate(True, vs.normalise(doc["volumes"])) is None
    vs.apply(doc)
    assert doc["pages"] == 1440
    assert len(doc["volumes"]) == 3
    # One ISBN, untouched: inventory_sync and the eBook price-list uploader both
    # match on it with find_one, and this feature adds no second record to
    # compete for it.
    assert doc["isbn"] == "9780143477471"


# --------------------------------------------------------------------------
# Runnable without pytest.
#
#     python backend/tests/test_volume_sets.py
#
# pytest is not in requirements-local.txt, and a test that cannot be run on the
# machine the code is written on is a test that does not get run. Nothing here
# uses a fixture, a mark or a parametrisation, so there is nothing to give up.
# `pytest backend/tests/test_volume_sets.py` still works unchanged.
# --------------------------------------------------------------------------
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
