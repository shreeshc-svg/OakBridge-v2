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

print("-- the 22 Oct 2026 sheet (3 labels, photographed with a shadow) --")
# What the phone showed: "Compulsory English, Gth ed" and "LA/LR, 2 Ed"
# unmatched, and the middle label (Dr …, Amritsar) missing altogether.
REAL = [
    {"id": "ce", "title": "Compulsory English for IAS (Mains) Examination 6/e"},
    {"id": "la2", "title": "Legal Aptitude & Reasoning LA/LR  2/e (2026-27)"},
    {"id": "la1", "title": "Legal Aptitude & Reasoning LA/LR"},
    {"id": "ugc7", "title": "Master Guide to NTA UGC NET | SET | JRF | PhD Paper 1 (Teaching and Research Aptitude),7/e"},
]
check(w.match_line({"title": "Compulsory English, Gth ed"}, REAL)["book_id"] == "ce", "'6th' read as 'Gth' -> 6th edition")
check(w.match_line({"title": "LA/LR, 2 Ed"}, REAL)["book_id"] == "la2", "'2nd' with the raised 'nd' lost ('2 Ed') -> 2nd edition")
check(w.match_line({"title": "LA/LR, 2\u201c Ed"}, REAL)["book_id"] == "la2", "'2\u201c Ed' (superscript read as a quote) -> 2nd edition")
check(w.fold("Bright Gth Street") == "bright gth street", "a word like 'Gth' outside an edition is left alone")
FROM = "From\nOakbridge Publishing Pvt. Ltd.\n934, 9th Floor, Tower B3\nPh. +91 124 430 5970, +91 8800337299\n"
SHEET = ("Compulsory English, 6th ed- 1 copy\nUGC-NET, 7th ed- 1 copy\nLA/LR, 2 Ed- 1 copy\nMr A Sample, Director\nSample Tutorials\n"
         "Prayagraj- 211002\nMob- 9000000021\n" + FROM +
         "Dr B Sample\nSample Institute of Law\nAmritsar- 143105\nMob- 9000000022\n" + FROM +  # its book lines lost in the shadow
         "Compulsory English, Gth ed- 1 copy\nUGC-NET, 7th ed- 1 copy\nLA/LR, 2 Ed- 1 copy\nMs C Sample\nSample Academy\n"
         "Amritsar-143002\nMob- 9000000023\n" + FROM)
ps = w.parse_courier_text(SHEET, w.title_matcher(REAL))
check(w.count_labels(SHEET) == 3, "3 labels counted on the sheet (one per 'From' block)")
check([(p["name"], len(p["lines"]), bool(p.get("books_unread"))) for p in ps]
      == [("Mr A Sample", 3, False), ("Dr B Sample", 0, True), ("Ms C Sample", 3, False)],
      "the label whose books were lost is still a parcel, flagged 'books not read'")
check(all(w.match_line(l, REAL)["book_id"] for p in ps for l in p["lines"]), "every book line on the sheet matched")

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
check("missingLabels" in cf and "wh-labels-missing" in cf and "p.books_unread" in cf,
      "phone: 'N labels, M read' warning + 'books not read' parcel; Done asks before going on")
check("const empty = parcels.filter((p) => p.kind !== \"skip\"" in cf, "a sending parcel with no book can't be confirmed")
check("wh-line-suggestions" in cf and "wh-courier-tips" in cf, "one-tap suggested books; photo tips")
check('doc["labels_seen"] = core.count_labels(res["text"])' in code and 'doc["read_text"] = core.masked_text(res["text"], 8000)' in code,
      "labels counted and what the photo said kept for Admin")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
