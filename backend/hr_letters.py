"""Simple company letters for the HRM (Nov 2026): appreciation, resignation
acceptance, termination. One layout so every letter looks the same. The
built-in PDF fonts are Latin-1 only, so text goes through
inventory_reports.latin (₹ -> Rs, curly quotes -> straight) — never a
missing-glyph box on an official letter."""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from typing import Optional

COMPANY = "Oakbridge Publishing Pvt. Ltd."


def letter_pdf(*, title: str, to_name: str, paragraphs: list, rows: Optional[list] = None,
               sign_off: str = "Human Resources", heading: str = "") -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape
    from inventory_reports import latin

    navy = colors.HexColor("#002B5C")
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=navy)
    h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=navy)
    p = ParagraphStyle("p", fontName="Helvetica", fontSize=10.5, leading=15)
    small = ParagraphStyle("s", fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#4B5563"))
    E = lambda s: escape(latin(str(s or "")))  # noqa: E731
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=latin(title), author=COMPANY)
    today = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%d %B %Y")
    flow = [Paragraph(COMPANY, h1), Spacer(1, 2 * mm), Paragraph(today, small), Spacer(1, 8 * mm)]
    if heading:
        flow += [Paragraph(E(heading), h2), Spacer(1, 4 * mm)]
    flow += [Paragraph(f"Dear {E(to_name)},", p), Spacer(1, 3 * mm)]
    for para in paragraphs:
        if para:
            flow += [Paragraph(E(para).replace("\n", "<br/>"), p), Spacer(1, 3 * mm)]
    if rows:
        t = Table([[latin(a), latin(b)] for a, b in rows], colWidths=[55 * mm, 110 * mm])
        t.setStyle(TableStyle([("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10), ("FONT", (1, 0), (1, -1), "Helvetica", 10),
                               ("TEXTCOLOR", (0, 0), (0, -1), navy), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
                               ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        flow += [Spacer(1, 2 * mm), t, Spacer(1, 4 * mm)]
    flow += [Spacer(1, 10 * mm), Paragraph(f"For {COMPANY}", p), Spacer(1, 10 * mm), Paragraph(E(sign_off), p),
             Spacer(1, 10 * mm), Paragraph("Generated from the Oakbridge HRM.", small)]
    doc.build(flow)
    return buf.getvalue()
