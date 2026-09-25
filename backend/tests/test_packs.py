"""
Packs: pricing and item validation.

    python backend/tests/test_packs.py   (or pytest)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "oakbridge_test")
os.environ.setdefault("JWT_SECRET", "test-only-not-a-real-secret")

import packs  # noqa: E402


def _raises(fn, *a):
    try:
        fn(*a)
    except ValueError as e:
        return str(e)
    return None


def test_fixed_price():
    assert packs.compute_price(1500, "fixed", 1199) == 1199


def test_fixed_price_cannot_exceed_mrp():
    assert _raises(packs.compute_price, 1000, "fixed", 1200)


def test_percent_off_the_packs_own_mrp():
    assert packs.compute_price(2000, "percent", 25) == 1500


def test_percent_rounds_to_whole_rupees():
    assert packs.compute_price(999, "percent", 10) == 899


def test_percent_bounds():
    assert _raises(packs.compute_price, 1000, "percent", 0)
    assert _raises(packs.compute_price, 1000, "percent", 100)
    assert _raises(packs.compute_price, 1000, "percent", -5)


def test_mrp_required():
    assert _raises(packs.compute_price, 0, "fixed", 100)


def test_unknown_mode_refused():
    assert _raises(packs.compute_price, 1000, "bogo", 1)


def test_items_deduplicated_and_ordered():
    assert packs.normalise_items(["b", "a", "b", {"book_id": "c"}, "", None]) == ["b", "a", "c"]


if __name__ == "__main__":
    bad = 0
    for n, fn in sorted(globals().items()):
        if n.startswith("test_") and callable(fn):
            try:
                fn(); print("ok   ", n)
            except Exception as e:  # noqa: BLE001
                bad += 1; print("FAIL ", n, e)
    print(); print(f"{bad} failed" if bad else "all tests passed")
    raise SystemExit(1 if bad else 0)
