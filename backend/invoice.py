"""
GST-style PDF invoice generator for Oakbridge Publishing.

Modelled on the company's existing Tally sales invoice (seller block, buyer/
consignee, itemised table with ISBN + author + rate + discount, totals, amount
in words, bank details, declaration, authorised signatory).

`build_invoice_pdf(order, isbn_map)` is pure (reportlab only) and returns bytes.
`ensure_invoice_no(db, order)` allocates a stable per-financial-year number the
first time an order is invoiced and persists it, so re-sends reuse it.
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Invoice logo. Drop a PNG/JPG here to change it — a transparent PNG looks best
# on the white invoice. First existing path wins.
_HERE = os.path.dirname(os.path.abspath(__file__))
LOGO_CANDIDATES = [
    os.path.join(_HERE, "assets", "invoice_logo.png"),
    os.path.join(_HERE, "assets", "invoice_logo.jpg"),
]


def _logo_flowable(max_w_mm: float = 34.0):
    """Return a scaled logo Image flowable, or None if no logo file is present."""
    for path in LOGO_CANDIDATES:
        if os.path.exists(path):
            try:
                iw, ih = ImageReader(path).getSize()
                w = max_w_mm * mm
                h = w * (ih / iw)
                return Image(path, width=w, height=h)
            except Exception:  # noqa: BLE001
                return None
    return None

# ------------------------------------------------------------------ constants
# Seller + bank details taken from the company's existing invoice. If you ever
# move offices or change GSTIN, edit here (or lift into Settings later).
SELLER = {
    "name": "Oakbridge Publishing Pvt. Ltd.",
    "address": [
        "934, 9th Floor, Tower B3,",
        "Spaze iTech Park, Sector 49,",
        "Gurgaon 122018",
    ],
    "gstin": "06AACCO5406D1ZW",
    "state": "Haryana",
    "state_code": "06",
    "contact": "01244305970, 8800337299",
    "email": "fpa@oakbridge.in",
}
BANK = {
    "name": "HDFC BANK - Current Account",
    "acc": "50200026419143",
    "branch_ifsc": "FIRST INDIA BRANCH & HDFC0000280",
}

NAVY = colors.HexColor("#002B5C")
GREY = colors.HexColor("#4B5563")
LIGHT = colors.HexColor("#F5F7FA")
LINE = colors.HexColor("#C9CFD8")

# ------------------------------------------------------------------ words
_ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")).strip()


def _three(n: int) -> str:
    h, r = n // 100, n % 100
    parts = []
    if h:
        parts.append(_ONES[h] + " Hundred")
    if r:
        parts.append(_two(r))
    return " ".join(parts)


def _num_words_indian(n: int) -> str:
    n = int(n)
    if n == 0:
        return "Zero"
    crore, n = n // 10000000, n % 10000000
    lakh, n = n // 100000, n % 100000
    thou, n = n // 1000, n % 1000
    hund = n
    out = []
    if crore:
        out.append(_three(crore) + " Crore")
    if lakh:
        out.append(_two(lakh) + " Lakh")
    if thou:
        out.append(_two(thou) + " Thousand")
    if hund:
        out.append(_three(hund))
    return " ".join(out).strip()


def amount_in_words(amount: float) -> str:
    rupees = int(amount)
    paise = int(round((float(amount) - rupees) * 100))
    words = "INR " + _num_words_indian(rupees)
    if paise:
        words += " and " + _num_words_indian(paise) + " Paise"
    return words + " Only"


# ------------------------------------------------------------------ helpers
def _money(x) -> str:
    try:
        return f"{float(x):,.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _fy(dt: datetime) -> str:
    """Indian financial year (Apr–Mar) for a date, e.g. 2026-27."""
    y = dt.year
    return f"{y}-{(y + 1) % 100:02d}" if dt.month >= 4 else f"{y - 1}-{y % 100:02d}"


def _parse_dt(order: dict) -> datetime:
    raw = order.get("paid_at") or order.get("created_at")
    if raw:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass
    return datetime.now(timezone.utc)


async def ensure_invoice_no(db, order: dict) -> str:
    """Allocate + persist a stable FY-based invoice number for this order."""
    if order.get("invoice_no"):
        return order["invoice_no"]
    from pymongo import ReturnDocument

    dt = _parse_dt(order)
    fy = _fy(dt)
    doc = await db.counters.find_one_and_update(
        {"_id": f"invoice_{fy}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    no = f"OAK/{fy}/{int(doc['seq']):04d}"
    await db.orders.update_one({"id": order["id"]}, {"$set": {"invoice_no": no}})
    order["invoice_no"] = no
    return no


async def build_order_invoice(db, order: dict) -> bytes:
    """DB-aware wrapper: allocate the invoice number, look up each line's ISBN,
    then render the PDF. Returns b'' on any failure (never raises)."""
    try:
        await ensure_invoice_no(db, order)
        ids = [it.get("book_id") for it in order.get("items", []) if it.get("book_id")]
        isbn_map = {}
        if ids:
            async for b in db.books.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "isbn": 1}):
                isbn_map[b["id"]] = b.get("isbn", "")
        return build_invoice_pdf(order, isbn_map)
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).exception("invoice PDF build failed for %s", order.get("order_number"))
        return b""


# ------------------------------------------------------------------ builder
def build_invoice_pdf(order: dict, isbn_map: dict | None = None) -> bytes:
    isbn_map = isbn_map or {}
    dt = _parse_dt(order)
    invoice_no = order.get("invoice_no") or order.get("order_number", "")

    p_small = ParagraphStyle("s", fontName="Helvetica", fontSize=8, leading=10, textColor=GREY)
    p_body = ParagraphStyle("b", fontName="Helvetica", fontSize=9, leading=12, textColor=NAVY)
    p_bold = ParagraphStyle("bb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=NAVY)
    p_head = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=8, leading=10,
                            textColor=colors.white, alignment=TA_LEFT)
    p_headr = ParagraphStyle("hr", parent=p_head, alignment=TA_RIGHT)
    p_title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=15, leading=18,
                             textColor=NAVY, alignment=TA_CENTER)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
        title=f"Invoice {invoice_no}",
    )
    W = doc.width
    story = []

    story.append(Paragraph("INVOICE", p_title))
    story.append(Spacer(1, 6))

    # ---- seller (left) + invoice meta (right) ----
    seller = []
    _logo = _logo_flowable()
    if _logo is not None:
        seller.append(_logo)
        seller.append(Spacer(1, 4))
    seller.append(Paragraph(SELLER["name"], p_bold))
    for ln in SELLER["address"]:
        seller.append(Paragraph(ln, p_small))
    seller.append(Paragraph(f"GSTIN/UIN: {SELLER['gstin']}", p_small))
    seller.append(Paragraph(f"State Name: {SELLER['state']}, Code: {SELLER['state_code']}", p_small))
    seller.append(Paragraph(f"Contact: {SELLER['contact']}", p_small))
    seller.append(Paragraph(f"E-Mail: {SELLER['email']}", p_small))

    meta = Table(
        [
            [Paragraph("Contact", p_small), Paragraph(f"<b>{SELLER['contact']}</b>", p_body)],
            [Paragraph("Invoice No.", p_small), Paragraph(f"<b>{invoice_no}</b>", p_body)],
            [Paragraph("Dated", p_small), Paragraph(f"<b>{dt.strftime('%d-%b-%y')}</b>", p_body)],
            [Paragraph("Order No.", p_small), Paragraph(order.get("order_number", ""), p_body)],
            [Paragraph("Payment Ref", p_small), Paragraph(order.get("rzp_payment_id", "") or "—", p_body)],
            [Paragraph("Mode of Payment", p_small),
             Paragraph("Prepaid (Razorpay)" if order.get("rzp_payment_id") else "Prepaid", p_body)],
        ],
        colWidths=[W * 0.22, W * 0.28],
    )
    meta.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))

    top = Table([[seller, meta]], colWidths=[W * 0.5, W * 0.5])
    top.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (0, 0), 8), ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (1, 0), (1, 0), 8),
    ]))
    story.append(top)

    # ---- bill to / ship to ----
    addr_lines = [
        order.get("address_line1", ""),
        order.get("address_line2", ""),
        f"{order.get('city', '')} - {order.get('pincode', '')}",
        f"Tel: {order.get('phone', '')}",
        f"State Name: {order.get('state', '')}",
    ]
    addr_lines = [x for x in addr_lines if x and x.strip(" -")]

    # Consignee is only the buyer when the parcel is going to the buyer. On a
    # gift order the two genuinely differ, and printing the buyer in both boxes
    # is how a courier delivers a present back to the person who sent it.
    from emailer import shipping_address

    _ship = shipping_address(order)
    ship_lines = [
        _ship["line1"],
        _ship["line2"],
        f"{_ship['city']} - {_ship['pincode']}",
        f"Tel: {_ship['phone']}" if _ship["phone"] else "",
        f"State Name: {_ship['state']}",
    ]
    ship_lines = [x for x in ship_lines if x and x.strip(" -")]

    def _party(title, name=None, lines=None):
        cell = [Paragraph(title, p_small),
                Paragraph(name if name is not None else order.get("full_name", ""), p_bold)]
        for ln in (lines if lines is not None else addr_lines):
            cell.append(Paragraph(ln, p_small))
        return cell

    parties = Table([[
        _party("Buyer (Bill to)"),
        _party("Consignee (Ship to)", _ship["name"], ship_lines),
    ]], colWidths=[W * 0.5, W * 0.5])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEAFTER", (0, 0), (0, 0), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(parties)
    story.append(Paragraph(f"Place of Supply: {order.get('state', '')}", p_small))
    story.append(Spacer(1, 6))

    # ---- items table ----
    header = [
        Paragraph("Sl", p_head), Paragraph("Description of Goods", p_head),
        Paragraph("ISBN", p_head), Paragraph("Author", p_head),
        Paragraph("Qty", p_headr), Paragraph("Rate", p_headr),
        Paragraph("Disc%", p_headr), Paragraph("Amount", p_headr),
    ]
    rows = [header]
    p_amt = ParagraphStyle("a", parent=p_body, alignment=TA_RIGHT)
    for i, it in enumerate(order.get("items", []), start=1):
        qty = int(it.get("quantity", 1))
        rate = float(it.get("price", 0))
        amount = rate * qty
        variant = " / ".join([x for x in [it.get("binding"), it.get("size")] if x])
        desc = it.get("title", "")
        if variant:
            desc += f'<br/><font size="7" color="#4B5563">{variant}</font>'
        rows.append([
            Paragraph(str(i), p_body),
            Paragraph(desc, p_body),
            Paragraph(isbn_map.get(it.get("book_id"), "") or "", p_small),
            Paragraph(it.get("author", ""), p_small),
            Paragraph(f"{qty} Nos.", p_amt),
            Paragraph(_money(rate), p_amt),
            Paragraph("", p_amt),
            Paragraph(_money(amount), p_amt),
        ])

    items = Table(rows, colWidths=[
        W * 0.05, W * 0.30, W * 0.14, W * 0.17, W * 0.09, W * 0.09, W * 0.06, W * 0.10,
    ], repeatRows=1)
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ]))
    story.append(items)

    # ---- totals (right aligned) ----
    def trow(label, value, bold=False, red=False):
        ls = p_bold if bold else p_small
        vs = ParagraphStyle("v", parent=(p_bold if bold else p_body), alignment=TA_RIGHT,
                            textColor=(colors.HexColor("#CC0033") if red else NAVY))
        return [Paragraph(label, ls), Paragraph(value, vs)]

    tdata = [trow("Subtotal", _money(order.get("subtotal", 0)))]
    if order.get("discount"):
        code = order.get("coupon_code") or "Discount"
        tdata.append(trow(f"Less: Discount ({code})", "(-) " + _money(order.get("discount", 0)), red=True))
    if float(order.get("shipping", 0) or 0) > 0:
        tdata.append(trow("Shipping", _money(order.get("shipping", 0))))
    if float(order.get("tax", 0) or 0) > 0:
        tdata.append(trow("Tax", _money(order.get("tax", 0))))
    tdata.append(trow("Total", "INR " + _money(order.get("total", 0)), bold=True))

    totals = Table(tdata, colWidths=[W * 0.35, W * 0.25])
    totals.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEABOVE", (0, -1), (-1, -1), 0.8, NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    wrap = Table([[totals]], colWidths=[W])
    wrap.setStyle(TableStyle([("ALIGN", (0, 0), (0, 0), "RIGHT"),
                              ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 0)]))
    story.append(wrap)
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"<b>Amount Chargeable (in words):</b> {amount_in_words(order.get('total', 0))}", p_body))
    story.append(Spacer(1, 10))

    # ---- bank + declaration ----
    bank = [
        Paragraph("<b>Company's Bank Details</b>", p_body),
        Paragraph(f"Bank Name: {BANK['name']}", p_small),
        Paragraph(f"A/c No.: {BANK['acc']}", p_small),
        Paragraph(f"Branch & IFS Code: {BANK['branch_ifsc']}", p_small),
    ]
    decl = [
        Paragraph("<b>Declaration</b>", p_body),
        Paragraph("We declare that this invoice shows the actual price of the goods "
                  "described and that all particulars are true and correct.", p_small),
        Spacer(1, 16),
        Paragraph(f"for {SELLER['name']}", p_small),
        Spacer(1, 14),
        Paragraph("Authorised Signatory", p_small),
    ]
    foot = Table([[decl, bank]], colWidths=[W * 0.55, W * 0.45])
    foot.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEAFTER", (0, 0), (0, 0), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(foot)
    story.append(Spacer(1, 8))
    story.append(Paragraph("This is a Computer Generated Invoice",
                           ParagraphStyle("cg", parent=p_small, alignment=TA_CENTER)))

    doc.build(story)
    return buf.getvalue()
