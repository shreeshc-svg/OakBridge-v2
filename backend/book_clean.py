"""Tidy book fields on every write path (shared by extensions.py and the
CSV import in features.py; pure, so tests import it as is)."""
import re


def clean_book_fields(d: dict) -> dict:
    """Tidy the fields shoppers and search engines read, on every write path
    (create, edit, CSV import). Found live 27 Nov 2026: an ISBN ending in a
    TAB (copied from a sheet — it never matched a lookup or a barcode), eight
    titles with double / trailing spaces, and prices stored as
    395.20000000000005 (shown with paise; charged rounded, but it looked
    wrong). In place; returns d."""
    if isinstance(d.get("title"), str):
        d["title"] = " ".join(d["title"].split())
    if isinstance(d.get("isbn"), str):
        d["isbn"] = re.sub(r"\s+", "", d["isbn"])
    for k in ("price", "original_price"):
        if isinstance(d.get(k), float):
            d[k] = round(d[k], 2)
    return d
