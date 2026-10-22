"""Courier runs: the office's label sheet and its hand-over to the phone.

Run: python backend/tests/test_courier_runs.py

* drafts are stored leniently, sending is checked strictly (every parcel has
  a type, a name, an address, books from the catalogue and copies);
* the labels come out as a PDF and a Word file with every parcel, books
  first, then the recipient, then our "From" block — escaped, never split;
* the phone gets every parcel already matched (nothing to read or pick), in
  the shape wh_confirm expects, so stock follows the warehouse's own rules.
"""
import io
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import courier_labels as cl  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


BOOKS = {"ce": {"id": "ce", "title": "Compulsory English for IAS (Mains) Examination 6/e", "isbn": "9780000000011"},
         "la2": {"id": "la2", "title": "Legal Aptitude & Reasoning LA/LR 2/e", "isbn": "9780000000028"},
         "pk": {"id": "pk", "title": "Law & Laughter - Collector's Edition", "product_type": "pack"}}

print("-- drafts and checks --")
raw = {"kind": "free_copy", "name": "  Ms A   Sample\x07 ", "org": "Sample Academy",
       "address": "22 Sample Road,\n\nAmritsar-143002\nPunjab", "pincode": "143 002", "phone": "+91 90000 00023",
       "lines": [{"book_id": "ce", "label": "Compulsory English, 6th ed", "qty": "1"},
                 {"book_id": "la2", "label": "LA/LR, 2nd Ed", "qty": 2}]}
p = cl.clean_parcel(raw, 1)
check(p["name"] == "Ms A Sample" and p["pincode"] == "143002" and p["address"].count("\n") == 2,
      "text tidied: control chars out, spaces collapsed, blank address lines dropped, PIN digits only")
check(p["lines"][0]["qty"] == 1 and p["order_id"] == "", "quantities are numbers; no order on a free copy")
check(cl.problems([p], BOOKS) == [], "a complete parcel has no problems")
bad = cl.clean_parcel({"kind": "nope", "lines": [{"book_id": "zz", "label": "Mystery", "qty": 0},
                                                 {"book_id": "pk", "label": "Pack", "qty": 1}]}, 2)
msgs = " | ".join(cl.problems([bad], BOOKS))
check(all(x in msgs for x in ("choose what it is", "who is it for", "address is empty", "pick the book",
                               "no number of copies")) and bad["kind"] == "", "every missing piece is named")
check("pack/hamper" in " | ".join(cl.problems([{**bad, "kind": "free_copy"}], BOOKS)),
      "a pack can't be sent as a free copy (its books are what leave the shelf)")
web = cl.clean_parcel({"kind": "website_order", "name": "B", "address": "x", "lines": [{"book_id": "pk", "label": "Pack", "qty": 1}]}, 3)
check(any("pick the website order" in m for m in cl.problems([web], BOOKS)) and not any("pack/hamper" in m for m in cl.problems([web], BOOKS)),
      "website order needs its order; a pack bought on the website is fine")
check(cl.problems([], BOOKS) == ["Add at least one parcel."], "an empty run can't be sent")

print("-- the label --")
L = cl.label_lines({**p, "kind": "website_order", "order_number": "OAK-261022-ABC123"}, cl.DEFAULT_FROM)
texts = [t for t, _ in L]
check(texts[0] == "Compulsory English, 6th ed - 1 copy" and texts[1] == "LA/LR, 2nd Ed - 2 copies", "books first, 'copy'/'copies'")
check("Order OAK-261022-ABC123" in texts and texts.index("Ms A Sample") < texts.index("From"), "order number, then recipient, then From")
check("PIN 143002" not in texts, "PIN not repeated when the address already has it")
check("Mob- +91 90000 00023" in texts and texts[-3:] == cl.DEFAULT_FROM, "phone, then our address")

print("-- PDF and Word files --")
nasty = cl.clean_parcel({**raw, "name": "<b>R&D</b> \"Lab\""}, 4)
many = [cl.clean_parcel({**raw, "name": f"Recipient {i}"}, i) for i in range(1, 8)] + [nasty]
pdf = cl.labels_pdf(many, cl.DEFAULT_FROM, "Courier 22.10")
check(pdf[:5] == b"%PDF-" and len(pdf) > 2000, f"PDF built ({len(pdf)} bytes) — markup in a name doesn't break it")
try:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf)
    text = "\n".join(pg.get_textpage().get_text_range() for pg in doc)
    check(len(doc) >= 3 and all(f"Recipient {i}" in text for i in range(1, 8)) and "<b>R&D</b>" in text,
          f"every label is in the PDF ({len(doc)} pages), text shown literally")
except ImportError:
    print("     (pypdfium2 not installed here — PDF text not checked)")
docx = cl.labels_docx(many, cl.DEFAULT_FROM)
z = zipfile.ZipFile(io.BytesIO(docx))
xml = z.read("word/document.xml").decode()
check(set(z.namelist()) >= {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}, "Word file has the parts Word needs")
check(xml.count("<w:cantSplit/>") == len(many) and "&lt;b&gt;R&amp;D&lt;/b&gt;" in xml and "Recipient 7" in xml,
      "one unsplittable box per label; text escaped")

print("-- hand-over to the phone --")
parcels, read = cl.warehouse_parcels(
    [p, {**cl.clean_parcel({**raw, "kind": "website_order", "order_id": "o1", "order_number": "OAK-1"}, 2)}],
    BOOKS, {"o1": [{"book_id": "ce", "title": "x", "qty": 1}]})
check([ln["line_no"] for ln in read] == [1, 2, 3, 4] and all(ln["match"] == "office" and ln["include"] for ln in read),
      "every line pre-matched and ticked, numbered across the run")
check(parcels[0]["kind"] == "free_copy" and parcels[1]["order_id"] == "o1" and parcels[1]["order_items"],
      "parcel types and the website order travel with it")
check(all(not x["needs_order"] and not x["books_unread"] for x in parcels), "nothing for the phone to resolve")

print("-- wiring (code, comments stripped) --")
import re  # noqa: E402
ROOT = os.path.dirname(os.path.dirname(HERE))


def code(rel):
    src = open(os.path.join(ROOT, rel), encoding="utf-8").read()
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return "\n".join(x for x in src.splitlines() if not x.strip().startswith(("#", "//")))


runs, srv, wh = code("backend/courier_runs.py"), code("backend/server.py"), code("backend/warehouse.py")
check("app.include_router(courier_runs_admin_router)" in srv and "app.include_router(courier_runs_phone_router)" in srv, "routers mounted")
check('prefix="/api/admin/warehouse/courier-runs"' in runs and "dependencies=[Depends(require_admin)]" in runs,
      "office endpoints sit under Admin → Warehouse (same permission)")
check("Depends(require_warehouse)" in runs and '"source": "office_run"' in runs, "phone prints labels only for office jobs, with warehouse access")
check('if p["order_id"] not in open_by_id' in runs and "in taken" in runs, "a website order already packed / on another run can't be sent twice")
check('automated = doc.get("source") not in ("manual", "office_run")' in wh, "office runs are not scored as 'reading accuracy'")
# JSX holds "image/*" in attribute strings, so this file is read raw.
app = open(os.path.join(ROOT, "frontend/src/pages/warehouse/WarehouseApp.jsx"), encoding="utf-8").read()
check("office && packedCount < parcels.length" in app and "<OfficeParcel" in app and "whLabels(doc.id, fmt)" in app,
      "phone: filled-in parcels, a 'Packed' tick each, Done only when all ticked, print PDF/Word")
adm = code("frontend/src/pages/admin/AdminWarehouse.jsx")
check('["courier", "Courier labels"]' in adm and "<CourierRuns />" in adm, "Admin → Warehouse → Courier labels tab")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
