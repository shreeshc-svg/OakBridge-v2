"""book_clean.clean_book_fields — tabs in ISBNs, double spaces in titles,
float-noise prices (all found live 27 Nov 2026). Run: python backend/tests/test_book_clean.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from book_clean import clean_book_fields  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    failed += 0 if cond else 1


d = clean_book_fields({"title": "Insights into  the Act, 2002 ", "isbn": "9788169999083\t", "price": 395.20000000000005, "original_price": 494})
check(d["title"] == "Insights into the Act, 2002", "double / trailing spaces gone")
check(d["isbn"] == "9788169999083", "a tab copied from a sheet is not part of the ISBN")
check(d["price"] == 395.2 and d["original_price"] == 494, "float noise rounded to paise; whole rupees untouched")
check(clean_book_fields({"stock": 3}) == {"stock": 3}, "an edit without these fields is left alone")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extensions.py"), encoding="utf-8").read()
check("doc = clean_book_fields({\"id\": str(uuid.uuid4()), **payload.model_dump()})" in src
      and "updates = clean_book_fields({k: v for k, v in payload.model_dump().items() if v is not None})" in src, "create and edit both clean")
fsrc = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "features.py"), encoding="utf-8").read()
check("clean = clean_book_fields(dict(clean))" in fsrc, "CSV import cleans too")
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
