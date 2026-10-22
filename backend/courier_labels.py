"""Courier labels — the pure half of courier_runs.py (no web framework, no
database), so the label sheet and the hand-over to the phone can be tested on
their own: python backend/tests/test_courier_runs.py

See courier_runs.py for why the office now makes the label sheet in Admin.
"""
from __future__ import annotations

import io
import re
import zipfile
from xml.sax.saxutils import escape

RUN_KINDS = {"website_order", "dealer_order", "author_copy", "free_copy"}
NOT_COUNTED = ("hamper", "pack")   # same as warehouse.NOT_COUNTED
MAX_PARCELS = 200
MAX_LINES = 30
# The return address exactly as on the office's Word sheet (Oct 2026).
DEFAULT_FROM = [
    "Oakbridge Publishing Pvt. Ltd.",
    "934, 9th Floor, Tower B3, Spaze Itech Park, Sector 49, Gurgaon 122018",
    "Ph. +91 124 430 5970, +91 8800337299",
]


# ------------------------------------------------------------- pure parts ---
def _txt(v, n: int) -> str:
    """One line of label text: control characters out, spaces collapsed, capped."""
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", str(v or ""))
    return re.sub(r"[ \t]+", " ", s).strip()[:n]


def clean_parcel(p: dict, no: int) -> dict:
    """A parcel as the office typed it -> stored shape. Lenient (drafts may be
    half-filled); `problems()` is the strict check before sending."""
    lines = []
    for ln in (p.get("lines") or [])[:MAX_LINES]:
        try:
            qty = int(ln.get("qty") or 0)
        except (TypeError, ValueError):
            qty = 0
        lines.append({"book_id": _txt(ln.get("book_id"), 64) or None,
                      "label": _txt(ln.get("label"), 120), "qty": max(0, min(qty, 500))})
    address = "\n".join(x for x in (_txt(a, 120) for a in str(p.get("address") or "").splitlines()) if x)
    kind = p.get("kind") if p.get("kind") in RUN_KINDS else ""
    return {
        "no": no, "kind": kind,
        "order_id": _txt(p.get("order_id"), 64) if kind == "website_order" else "",
        "order_number": _txt(p.get("order_number"), 32) if kind == "website_order" else "",
        "name": _txt(p.get("name"), 100), "org": _txt(p.get("org"), 120),
        "address": "\n".join(address.splitlines()[:8]),
        "pincode": re.sub(r"\D", "", str(p.get("pincode") or ""))[:6],
        "phone": _txt(p.get("phone"), 40),
        "lines": lines, "note": _txt(p.get("note"), 300),
    }


def problems(parcels: list, books: dict) -> list:
    """What must be fixed before the run can go to the warehouse, in words."""
    out = []
    if not parcels:
        out.append("Add at least one parcel.")
    for p in parcels:
        who = f"Parcel {p['no']}" + (f" ({p['name']})" if p.get("name") else "")
        if not p.get("kind"):
            out.append(f"{who}: choose what it is (website order, dealer order, author copy or free copy).")
        if p.get("kind") == "website_order" and not p.get("order_id"):
            out.append(f"{who}: pick the website order.")
        if not p.get("name"):
            out.append(f"{who}: who is it for?")
        if not p.get("address"):
            out.append(f"{who}: the address is empty.")
        if p.get("pincode") and len(p["pincode"]) != 6:
            out.append(f"{who}: the PIN code must be 6 digits.")
        if not p.get("lines"):
            out.append(f"{who}: no books.")
        for ln in p.get("lines") or []:
            if not ln.get("book_id") or ln["book_id"] not in books:
                out.append(f"{who}: “{ln.get('label') or '?'}” — pick the book from the catalogue.")
            elif p.get("kind") != "website_order" and books[ln["book_id"]].get("product_type") in NOT_COUNTED:
                out.append(f"{who}: “{books[ln['book_id']].get('title')}” is a pack/hamper — add its books instead.")
            if not ln.get("qty"):
                out.append(f"{who}: “{ln.get('label') or '?'}” has no number of copies.")
    return out


def label_lines(p: dict, from_lines: list) -> list:
    """[(text, bold)] for one label, in the order the Word sheet used."""
    out = []
    for ln in p.get("lines") or []:
        q = int(ln.get("qty") or 0)
        out.append((f"{ln.get('label') or ''} - {q} {'copy' if q == 1 else 'copies'}", True))
    if p.get("order_number"):
        out.append((f"Order {p['order_number']}", False))
    out.append(("", False))
    out.append((p.get("name") or "", True))
    if p.get("org"):
        out.append((p["org"], False))
    addr = (p.get("address") or "").splitlines()
    out.extend((a, False) for a in addr)
    if p.get("pincode") and not any(p["pincode"] in a for a in addr):
        out.append((f"PIN {p['pincode']}", False))
    if p.get("phone"):
        out.append((f"Mob- {p['phone']}", False))
    out.append(("", False))
    out.append(("From", True))
    out.extend((f, False) for f in from_lines)
    return out


def labels_pdf(parcels: list, from_lines: list, title: str = "") -> bytes:
    """A4, one label per dashed box (cut along it), a box never split across
    pages. Helvetica: Latin text only — the Word file is the one to use for
    an address in Hindi."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    normal = ParagraphStyle("l", fontName="Helvetica", fontSize=10.5, leading=12.5)  # 3 labels per A4, as the Word sheet
    bold = ParagraphStyle("b", parent=normal, fontName="Helvetica-Bold")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=9 * mm, bottomMargin=9 * mm, title=title or "Courier labels")
    flow = []
    for p in parcels:
        cell = [Paragraph(escape(t) or "&nbsp;", bold if b else normal) for t, b in label_lines(p, from_lines)]
        t = Table([[cell]], colWidths=[doc.width])
        t.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.8, colors.grey, 1, (4, 3)),
            ("LEFTPADDING", (0, 0), (-1, -1), 8 * mm), ("RIGHTPADDING", (0, 0), (-1, -1), 8 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 3 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]))
        flow += [t, Spacer(1, 3 * mm)]
    doc.build(flow)
    return buf.getvalue()


_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _wp(text: str, bold: bool) -> str:
    rpr = "<w:rPr>" + ("<w:b/>" if bold else "") + '<w:sz w:val="21"/></w:rPr>'
    run = f'<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>' if text else ""
    return f'<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>{run}</w:p>'


def labels_docx(parcels: list, from_lines: list) -> bytes:
    """The same sheet as a Word file the office can still tweak. Written as
    raw WordprocessingML (no python-docx dependency): one single-cell table
    per label with a dashed border, rows that may not split across pages."""
    dash = '<w:{s} w:val="dashed" w:sz="8" w:space="0" w:color="808080"/>'
    borders = "".join(dash.format(s=s) for s in ("top", "left", "bottom", "right"))
    body = []
    for p in parcels:
        paras = "".join(_wp(t, b) for t, b in label_lines(p, from_lines))
        body.append(
            "<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/>"
            f"<w:tblBorders>{borders}</w:tblBorders>"
            "<w:tblCellMar><w:top w:w=\"140\" w:type=\"dxa\"/><w:left w:w=\"400\" w:type=\"dxa\"/>"
            "<w:bottom w:w=\"140\" w:type=\"dxa\"/><w:right w:w=\"400\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr>"
            "<w:tblGrid><w:gridCol w:w=\"10200\"/></w:tblGrid>"
            "<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w=\"5000\" w:type=\"pct\"/></w:tcPr>"
            f"{paras}</w:tc></w:tr></w:tbl>{_wp('', False)}")
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {_W}><w:body>'
           + "".join(body) +
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
           '<w:pgMar w:top="510" w:right="850" w:bottom="510" w:left="850" w:header="0" w:footer="0" w:gutter="0"/>'
           "</w:sectPr></w:body></w:document>")
    types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
             '<Default Extension="xml" ContentType="application/xml"/>'
             '<Override PartName="/word/document.xml" '
             'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


def warehouse_parcels(parcels: list, books: dict, order_items: dict) -> tuple[list, list]:
    """Run parcels -> the courier job's parcels + read_lines, already matched,
    in the shape the phone's courier screen and wh_confirm expect."""
    out, read, n = [], [], 1
    for p in parcels:
        lines = []
        for ln in p["lines"]:
            b = books.get(ln["book_id"]) or {}
            row = {"line_no": n, "raw": "", "doc_title": ln.get("label") or b.get("title", ""), "doc_isbn": b.get("isbn", ""),
                   "pages": None, "qty": ln["qty"], "book_id": ln["book_id"], "match": "office", "score": 1.0,
                   "candidates": [], "include": True, "qty_read": True}
            lines.append(row)
            read.append(row)
            n += 1
        items = order_items.get(p.get("order_id")) if p.get("kind") == "website_order" else None
        out.append({
            "no": p["no"], "name": p.get("name", ""), "org": p.get("org", ""), "phone": p.get("phone", ""),
            "pincode": p.get("pincode", ""), "address": (p.get("address") or "").splitlines()[:8], "lines": lines,
            "kind": p["kind"], "author": "", "order_id": p.get("order_id", "") if items is not None else "",
            "order_number": p.get("order_number", ""), "order_items": items or [],
            "written_order": "", "web_tag": False, "needs_order": False, "books_unread": False,
        })
    return out, read


