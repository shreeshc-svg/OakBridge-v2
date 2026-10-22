"""Courier labels read from photos: titles and copies survive OCR slips.

Run: python backend/tests/test_courier_ocr.py

The warehouse team's two complaints (Oct 2026): a scanned label's title did
not appear (they had to search the book by ISBN), and copies were wrong.
Each case below is a way Textract or the office writes a line that the old
pattern ("Title - 2" only) dropped.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import warehouse_core as w  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def one(line):
    b = w._is_book_line(line)
    return (b["title"], b["qty"]) if b else None


print("-- quantity written / read differently --")
for line, want in [
    ("Climate Justice -2", ("Climate Justice", 2)),
    ("Climate Justice -l", ("Climate Justice", 1)),            # 1 read as l
    ("Climate Justice - I", ("Climate Justice", 1)),           # 1 read as I
    ("Climate Justice -|", ("Climate Justice", 1)),            # 1 read as |
    ("Climate Justice ~ 2", ("Climate Justice", 2)),           # dash read as ~
    ("Climate Justice x 2", ("Climate Justice", 2)),
    ("Climate Justice ×2", ("Climate Justice", 2)),
    ("Climate Justice: 3 copies.", ("Climate Justice", 3)),    # full stop
    ("Climate Justice (2)", ("Climate Justice", 2)),
    ("Climate Justice (2 copies)", ("Climate Justice", 2)),
    ("Climate Justice - 1O", ("Climate Justice", 10)),         # 0 read as O
    ("Climate Justice qty 4", ("Climate Justice", 4)),
    ("Climate Justice (ISBN 9789395764575) - 2", ("Climate Justice", 2)),
]:
    check(one(line) == want, f"{line!r} -> {want}")

print("-- never invented --")
check(one("Corporate Tax 2") is None, "'Tax 2': the x of Tax is not 'x 2'")
check(one("Constitution - Part II") is None, "'II' is not 11 copies")
check(one("Varanasi- 221005") is None and one("New Delhi - 110068") is None, "pin codes still not books")
check(one("Flat - O") is None, "a bare O is not a number")

SHELF = [
    {"id": "cj", "title": "Climate Justice", "author": "A Author"},
    {"id": "cle", "title": "Construction Law Explained - PB (Constructive Counsel Series)", "author": "B Author"},
    {"id": "cww", "title": "Courtroom Wit & Wisdom", "author": "Pramod Rao"},
    {"id": "ihm", "title": "In-House Matters", "author": "Pramod Rao, Ritvik Lukose"},
]
is_title = w.title_matcher(SHELF)

print("-- one line split in two by the photo --")
ps = w.parse_courier_text("Climate Justice\n-2\nMs Asha Verma\nGreen Park\nNew Delhi - 110068\nFrom\nOakbridge\n")
check(len(ps) == 1 and [(l["title"], l["qty"]) for l in ps[0]["lines"]] == [("Climate Justice", 2)]
      and ps[0]["name"] == "Ms Asha Verma", "quantity on the next line is joined back")
ps = w.parse_courier_text("Courtroom Wit & Wisdom -1\nConstruction Law Explained - PB (Constructive\nCounsel Series) - 3\n"
                          "Sample Services\nFort, Mumbai 400001\nFrom\nOakbridge\n", is_title)
check(len(ps) == 1 and [(l["title"], l["qty"]) for l in ps[0]["lines"]][1][1] == 3
      and w.match_line(ps[0]["lines"][1], SHELF)["book_id"] == "cle" and ps[0]["name"] == "Sample Services",
      "a wrapped long title is re-joined, parcel not split in two")

print("-- title with no readable number --")
ps = w.parse_courier_text("In-House Matters\nMr Ravi Kumar\nAnand- 388001\nFrom\nOakbridge\n", is_title)
ln = ps[0]["lines"][0] if ps and ps[0]["lines"] else {}
check(ln.get("title") == "In-House Matters" and ln.get("qty") == 1 and ln.get("qty_read") is False,
      "catalogue title alone -> book, 1 copy, flagged to check")
check(ps[0]["name"] == "Mr Ravi Kumar", "the name after it is still the recipient")
check(not is_title("Pramod Rao") and not is_title("Sample Law Academy") and not is_title("Green Park"),
      "an author's own name / an organisation / a street is never a title")
check(w.parse_courier_text("In-House Matters\nMr Ravi Kumar\n") == [], "without the catalogue nothing is guessed (unchanged)")

print("-- OCR slip in the title still matches --")
check(w.match_line({"title": "Courtroorn Wit & Wisdorn"}, SHELF)["book_id"] == "cww", "'Courtroorn Wit & Wisdorn' -> Courtroom Wit & Wisdom")
check(w.match_line({"title": "Climate Justise"}, SHELF)["book_id"] == "cj", "'Climate Justise' -> Climate Justice")

print("-- reading: more pages, plain-text call, phone screen --")
import re  # noqa: E402
src = open(os.path.join(os.path.dirname(HERE), "warehouse.py"), encoding="utf-8").read()
code = re.sub(r'"""[\s\S]*?"""', "", "\n".join(x for x in src.splitlines() if not x.strip().startswith("#")))
check("COURIER_MAX_PAGES = 12" in code and "_pdf_text_and_pages, data, COURIER_MAX_PAGES, 3" in code,
      "scanned courier PDF: up to 12 pages at 3x (was 3 pages at 2x)")
check("detect_document_text" in code and "AccessDenied" in code, "plain-text Textract call, falling back to the table call if not permitted")
check(code.count("await _catalogue() if") == 2, "catalogue passed to the reader on upload and on replay")
app = open(os.path.join(os.path.dirname(HERE), "..", "frontend", "src", "pages", "warehouse", "WarehouseApp.jsx"), encoding="utf-8").read()
cf = app[app.index("function CourierFlow"):app.index("function SingleMove")]
check(cf.count("<BookPicker") == 2 and "{books.map((b) => <option" not in cf, "courier lines + 'add a book': title search, not a 250-row drop-down")
check("l.qty_read === false" in cf and "noCopies" in cf, "unread copies flagged; a ticked book with no copies can't be confirmed")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
