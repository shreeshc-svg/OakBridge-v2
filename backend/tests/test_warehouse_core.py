"""
Warehouse system — the pure decisions (backend/warehouse_core.py).

Fixtures are taken from the two real documents the design is built on (bank
details and other parties' contact lines left out on purpose):
  * Oakbridge Tally invoice P/2026-27/0512 to Student Book Centre (text layer),
  * Saurabh Printers tax invoice S/3868/2026-27 (as Textract's table blocks).

Run:  python backend/tests/test_warehouse_core.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import warehouse_core as w  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


CATALOGUE = [
    {"id": "dpdp", "title": "Practical Guide to Digital Personal Data Protection Act, 2023 – Law and Compliance",
     "isbn": "9788169999090", "pages": 266},
    {"id": "posh", "title": "Treatise on the POSH Act - A Critical and Comparative Commentary on the Sexual "
     "Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013",
     "isbn": "9788197939266", "pages": 768},
    {"id": "clr", "title": "Corporate Law Referencer 12/e", "isbn": "9788199888173", "pages": 2738},
    {"id": "gcf", "title": "GENDERING CLIMATE FUTURES - Power, Finance, and Justice in a Warming World",
     "isbn": "9788169999045", "pages": 208},
    {"id": "cg1", "title": "Capital Gains Tax Law and Practice", "isbn": "9788197413537", "pages": 552},
    {"id": "cg2", "title": "Capital Gains Tax Law and Practice", "isbn": "9789395764551", "pages": 532},
]

TALLY_TEXT = (
    "INVOICE\r\nOakbridge Publishing Pvt. Ltd.\r\nGSTIN/UIN: 06AACCO5406D1ZW\r\n"
    "Consignee (Ship to)\r\nStudent Book Centre\r\n527,\r\nKalbadevi Road\r\n"
    "Buyer (Bill to)\r\nStudent Book Centre\r\nInvoice No.\r\nP/2026-27/0512\r\nDelivery Note\r\n"
    "Dispatched through\r\nABC Transport\r\nDated\r\n29-Sep-26\r\n"
    "Sl Description of Goods ISBN Author name Quantity Rate per Disc. % Amount\r\nNo.\r\n"
    "1 Practical Guide to DPDP Act, \r\n2023 2/E\r\n"
    "9788169999090 Puneet Bhasin 35 Nos. 895.00 Nos. 50 % 15,662.50\r\n"
    "2 Treatise on POSH ACT 9788197939266 Dhana Madhri Guruswamy 3 Nos. 1,695.00 Nos. 50 % 2,542.50\r\n"
    "3 Corporate Law Referencer 12\r\n/e\r\n"
    "9788199888173 Dr Sumit Pahwa 5 Nos. 4,800.00 Nos. 50 % 12,000.00\r\n"
    "Total 43 Nos. ī 30,205.00\r\nAmount Chargeable (in words)\r\n"
)

print("-- Tally invoice (outgoing carton) --")
rows = w.parse_tally_text(TALLY_TEXT)
check([(r["isbn"], r["qty"]) for r in rows] == [("9788169999090", 35), ("9788197939266", 3), ("9788199888173", 5)],
      "three lines, ISBN and quantity each")
check(rows[0]["title"] == "Practical Guide to DPDP Act, 2023 2/E", "a title split over two lines is rejoined")
hdr = w.header_fields(TALLY_TEXT, "out")
check(hdr["doc_number"] == "P/2026-27/0512", "invoice number read")
check(hdr["party_name"] == "Student Book Centre", "consignee read")
check(hdr["total_qty"] == 43 and sum(r["qty"] for r in rows) == 43, "lines add up to the invoice total")
check(all(w.match_line(r, CATALOGUE)["method"] == "isbn" for r in rows), "every line matched by ISBN")
check(w.match_line(rows[0], CATALOGUE)["book_id"] == "dpdp", "short invoice title, right book via ISBN")


def blocks_for(table, lines):
    """Minimal Textract response: one TABLE of CELLs (each with WORDs) + LINEs."""
    out, cells, n = [], [], 0
    for ri, row in enumerate(table, start=1):
        for ci, text in enumerate(row, start=1):
            wids = []
            for word in text.split():
                n += 1
                out.append({"Id": f"w{n}", "BlockType": "WORD", "Text": word})
                wids.append(f"w{n}")
            n += 1
            out.append({"Id": f"c{n}", "BlockType": "CELL", "RowIndex": ri, "ColumnIndex": ci,
                        "Relationships": [{"Type": "CHILD", "Ids": wids}] if wids else []})
            cells.append(f"c{n}")
    out.append({"Id": "t1", "BlockType": "TABLE", "Relationships": [{"Type": "CHILD", "Ids": cells}]})
    out += [{"Id": f"l{i}", "BlockType": "LINE", "Text": t} for i, t in enumerate(lines)]
    return out


PRINTER_TABLE = [
    ["SI No", "Description of Goods", "HSN/SAC", "Quantity", "Rate (Incl. of Tax)", "Rate", "per", "Amount"],
    ["1", "Gendering Climate Futures Pages 216 Size 6.25x9.5", "49011010", "150 Nos.", "114.00", "96.61", "Nos", "14,491.52"],
    ["2", "Box Charge", "49011010", "3 no", "94.40", "80.00", "no", "240.00"],
    ["", "Output IGST 18% Less: Round Off", "", "", "", "18", "%", "2,651.67"],
]
PRINTER_LINES = ["Tax Invoice", "Saurabh Printers Pvt Ltd (HO)", "GSTIN/UIN: 09AAFCS5738K1ZT",
                 "Invoice No. S/3868/2026-27", "Consignee", "Oakbridge Publishing Pvt Ltd",
                 "GSTIN/UIN : 06AACCO5406D1ZW"]

print("-- printer bill photo (incoming, via Textract) --")
blocks = blocks_for(PRINTER_TABLE, PRINTER_LINES)
prow = w.parse_goods_tables(w.textract_tables(blocks))
check([(r["title"], r["qty"]) for r in prow] == [("Gendering Climate Futures", 150), ("Box Charge", 3)],
      "goods rows read, tax row skipped, specs cut from the title")
check(prow[0]["pages"] == 216, "page count kept as a hint")
m = w.match_line(prow[0], CATALOGUE)
check(m["book_id"] == "gcf" and m["method"] == "title", "no ISBN on the bill: matched by title")
check(w.match_line(prow[1], CATALOGUE)["book_id"] is None, "Box Charge matches no book (starts unticked)")
ph = w.header_fields(w.textract_text(blocks), "in")
check(ph["doc_number"] == "S/3868/2026-27", "printer invoice number read")
check(ph["party_gstin"] == "09AAFCS5738K1ZT", "supplier GSTIN read, ours ignored")
check(ph["party_name"] == "Saurabh Printers Pvt Ltd", "supplier name read")

print("-- ambiguous titles are never guessed --")
amb = w.match_line({"title": "Capital Gains Tax Law and Practice", "isbn": ""}, CATALOGUE)
check(amb["book_id"] is None and len(amb["candidates"]) == 2, "two editions, same title: offered, not picked")
pick = w.match_line({"title": "Capital Gains Tax Law and Practice", "isbn": "", "pages": 532}, CATALOGUE)
check(pick["book_id"] is None, "a page-count hint alone does not force a pick between near-identical titles")

print("-- author copies --")
check(w.match_party_author("Dr. Sumit Pahwa", ["Dr Sumit Pahwa", "Bhumesh Verma"]) == "Dr Sumit Pahwa",
      "consignee matching an author -> author copy")
check(w.match_party_author("Student Book Centre", ["Dr Sumit Pahwa", "Bhumesh Verma"]) is None,
      "a bookshop is a sale")

print("-- error-rate scoring --")
read = [{"line_no": 1, "book_id": "gcf", "qty": 150, "include": True},
        {"line_no": 2, "book_id": None, "qty": 3, "include": False},
        {"line_no": 3, "book_id": "cg1", "qty": 10, "include": True}]
conf = [{"line_no": 1, "book_id": "gcf", "qty": 150, "include": True},
        {"line_no": 2, "book_id": None, "qty": 3, "include": False},
        {"line_no": 3, "book_id": "cg2", "qty": 10, "include": True},
        {"line_no": None, "book_id": "clr", "qty": 2, "include": True}]
s = w.score_corrections(read, conf)
check((s["correct"], s["wrong_book"], s["missed"], s["extra"]) == (1, 1, 1, 0), "correct / wrong book / missed counted")
check(s["accuracy"] == round(1 / 3, 4), "accuracy = correct lines / lines that mattered")
s2 = w.score_corrections(read[:1], [{"line_no": 1, "book_id": "gcf", "qty": 140, "include": True}])
check(s2["wrong_qty"] == 1 and s2["accuracy"] == 0.0, "a changed quantity counts as an error")
s3 = w.score_corrections(read[:1], [{"line_no": 1, "book_id": "gcf", "qty": 150, "include": False}])
check(s3["extra"] == 1, "a suggested line the person untick is an 'extra' read")

print("-- helpers --")
check(w.isbn13_valid("9788169999090") and not w.isbn13_valid("9788196413513"), "ISBN check digit")
check(w.norm_isbn("978-81-6999-912-0") == "9788169999120", "hyphenated ISBN normalised")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
