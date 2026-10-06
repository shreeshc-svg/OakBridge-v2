"""
Warehouse system — the pure decisions, with no I/O and no app imports.

Kept apart from warehouse.py so everything that decides which book and how many
copies can be tested without FastAPI, Mongo, S3 or Textract:

  * reading a Tally invoice PDF's text layer (outgoing cartons),
  * reading Textract's table output for a photographed bill (printer bills),
  * matching a document line to a catalogue book (ISBN first, then title),
  * scoring what the system read against what the warehouse person confirmed,
    which is the error rate the trial exists to measure.

Two real documents shaped this file:
  - Saurabh Printers' tax invoice (incoming): NO ISBN on it — title, "Pages
    216 / Size 6.25x9.5" in the same cell, "150 Nos.", and a "Box Charge" line
    carrying the same HSN as the books, so HSN cannot be used to filter.
  - Oakbridge's own Tally invoice (outgoing): computer-generated PDF with a text
    layer, an ISBN and an author column on every line, and a "Total 43 Nos."
    that the lines must add up to. The "Author name" column is each BOOK's
    author; whether a carton is an author copy is decided by the consignee.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Iterable, Optional

OUR_GSTIN = "06AACCO5406D1ZW"  # Oakbridge — never mistaken for the supplier

ISBN13_RE = re.compile(r"\b97[89][\s-]?(?:\d[\s-]?){9}\d\b")
QTY_RE = re.compile(r"(\d[\d,]*)\s*(?:nos?\.?|pcs\.?|copies|units?)\b", re.I)
GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b")
INVOICE_NO_RE = re.compile(r"Invoice\s*No\.?\s*[:\-]?\s*([A-Z0-9]+(?:\s?[/-]\s?[A-Z0-9]+)+)", re.I)
TOTAL_QTY_RE = re.compile(r"\bTotal\b[^\n\d]{0,40}?(\d[\d,]*)\s*Nos", re.I)
# Description cells repeat specs after the title ("Pages 216 Size 6.25x9.5").
SPEC_CUT_RE = re.compile(r"\s+(?:pages?|pp\.?|size|binding|isbn)\b.*$", re.I)
PAGES_RE = re.compile(r"\bpages?\s*[:\-]?\s*(\d{2,4})\b", re.I)
# Lines that sit in the goods table but are not goods.
NOT_GOODS_RE = re.compile(
    r"^(?:total|sub\s*total|output|input|igst|cgst|sgst|round\s*off|less|discount|freight|"
    r"amount|tax|e\.?\s*&\s*o\.?e|hsn)", re.I)

_STOP = {"the", "a", "an", "of", "and", "on", "in", "to", "for", "&", "with", "by", "edition", "ed"}


# ------------------------------------------------------------- helpers ---
def norm_isbn(v) -> str:
    return re.sub(r"[^0-9Xx]", "", str(v or "")).upper()


def isbn13_valid(s: str) -> bool:
    if len(s) != 13 or not s.isdigit():
        return False
    t = sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(s[:12]))
    return (10 - t % 10) % 10 == int(s[12])


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    s = re.sub(r"(\d)\s*/\s*e\b", r"\1e", s)  # "12 /e", "2/E" -> "12e", "2e"
    # Courier sheets write editions out: "6th ed", "2nd Ed", "1st edition".
    s = re.sub(r"(\d+)\s*(?:st|nd|rd|th)\s*(?:edn|ed|edition)\b\.?", r"\1e", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tokens(s: str) -> list:
    # "1e" (first edition) is the default and never printed in titles, so it
    # cannot be required for a match.
    return [t for t in fold(s).split() if t not in _STOP and len(t) > 1 and t != "1e"]


def to_int(s) -> Optional[int]:
    m = re.search(r"\d[\d,]*", str(s or ""))
    if not m:
        return None
    try:
        return int(m.group(0).replace(",", ""))
    except ValueError:
        return None


def clean_title(desc: str) -> str:
    """'Gendering Climate Futures Pages 216 Size 6.25x9.5' -> 'Gendering Climate Futures'."""
    t = re.sub(r"\s+", " ", desc or "").strip()
    t = re.sub(r"^\d{1,3}[.)]?\s+", "", t)  # serial number
    return SPEC_CUT_RE.sub("", t).strip(" -,:")


def header_fields(text: str, direction: str) -> dict:
    """Invoice number, other party, total quantity — from the document's text."""
    out = {"doc_number": "", "party_gstin": "", "party_name": "", "total_qty": None}
    m = INVOICE_NO_RE.search(text or "")
    if m:
        out["doc_number"] = re.sub(r"\s+", "", m.group(1))
    gstins = [g for g in GSTIN_RE.findall(text or "") if g != OUR_GSTIN]
    if gstins:
        out["party_gstin"] = gstins[0]
    lines = [ln.strip() for ln in (text or "").splitlines()]
    if direction == "out":
        for i, ln in enumerate(lines):
            if re.match(r"consignee", ln, re.I):
                nxt = next((x for x in lines[i + 1:i + 4] if x and not re.match(r"\d", x)), "")
                out["party_name"] = nxt
                break
    else:
        # The supplier is the first company line on the bill, before "Consignee".
        for ln in lines:
            if re.search(r"\b(pvt|private|ltd|limited|printers?|press|llp)\b", ln, re.I) \
                    and "oakbridge" not in ln.lower():
                out["party_name"] = re.sub(r"\s*\(.*?\)\s*$", "", ln).strip()
                break
    t = TOTAL_QTY_RE.search(text or "")
    if t:
        out["total_qty"] = to_int(t.group(1))
    return out


# --------------------------------------------------- Tally PDF text layer ---
def parse_tally_text(text: str) -> list:
    """Goods lines from a computer-generated invoice's text.

    Every goods line carries an ISBN, so the ISBN anchors the line: the
    quantity is the first "N Nos." after it, the title is what precedes it
    back to the previous line's end. The title is for display only — the ISBN
    decides the book.
    """
    rows, buf, started = [], [], False
    for raw in (text or "").splitlines():
        ln = raw.strip()
        if not ln:
            continue
        if not started:
            if re.search(r"description\s+of\s+goods", ln, re.I):
                started = True
            continue
        if re.match(r"^total\b", ln, re.I):
            break
        m = ISBN13_RE.search(ln)
        if not m:
            if ln.lower() not in ("no.", "sl", "sl no.") and not re.fullmatch(r"[\d\s]+", ln):
                buf.append(ln)
            continue
        isbn = norm_isbn(m.group(0))
        before = ln[: m.start()].strip()
        after = ln[m.end():]
        q = QTY_RE.search(after)
        title = clean_title(" ".join(buf + ([before] if before else [])))
        rows.append({
            "raw": re.sub(r"\s+", " ", " ".join(buf + [ln]))[:300],
            "title": title,
            "isbn": isbn,
            "qty": to_int(q.group(1)) if q else None,
            "pages": None,
        })
        buf = []
    return rows


# ------------------------------------------------------- Textract tables ---
def textract_tables(blocks: list) -> list:
    """Textract blocks -> list of tables, each a list of rows of cell texts."""
    by_id = {b["Id"]: b for b in blocks}

    def text_of(block) -> str:
        words = []
        for rel in block.get("Relationships") or []:
            if rel["Type"] != "CHILD":
                continue
            for cid in rel["Ids"]:
                c = by_id.get(cid, {})
                if c.get("BlockType") == "WORD":
                    words.append(c.get("Text", ""))
                elif c.get("BlockType") == "SELECTION_ELEMENT":
                    pass
        return " ".join(words)

    tables = []
    for b in blocks:
        if b.get("BlockType") != "TABLE":
            continue
        cells = {}
        for rel in b.get("Relationships") or []:
            if rel["Type"] != "CHILD":
                continue
            for cid in rel["Ids"]:
                c = by_id.get(cid, {})
                if c.get("BlockType") == "CELL":
                    cells[(c["RowIndex"], c["ColumnIndex"])] = text_of(c)
        if not cells:
            continue
        nrows = max(r for r, _ in cells)
        ncols = max(c for _, c in cells)
        tables.append([[cells.get((r, c), "") for c in range(1, ncols + 1)] for r in range(1, nrows + 1)])
    return tables


def textract_text(blocks: list) -> str:
    return "\n".join(b.get("Text", "") for b in blocks if b.get("BlockType") == "LINE")


def parse_goods_tables(tables: list) -> list:
    """Goods lines from the table whose header has Description and Quantity."""
    for table in tables:
        head_row, cols = None, {}
        for ri, row in enumerate(table[:4]):
            low = [fold(c) for c in row]
            d = next((i for i, c in enumerate(low) if "description" in c or "particular" in c), None)
            q = next((i for i, c in enumerate(low) if "quantity" in c or c in ("qty", "qty nos")), None)
            if d is not None and q is not None:
                head_row = ri
                cols = {"desc": d, "qty": q,
                        "isbn": next((i for i, c in enumerate(low) if "isbn" in c), None)}
                break
        if head_row is None:
            continue
        rows = []
        for row in table[head_row + 1:]:
            desc = (row[cols["desc"]] if cols["desc"] < len(row) else "").strip()
            qty_cell = row[cols["qty"]] if cols["qty"] < len(row) else ""
            if not desc or NOT_GOODS_RE.match(clean_title(desc)):
                continue
            qty = to_int(qty_cell)
            if qty is None:
                continue
            isbn = ""
            src = row[cols["isbn"]] if cols["isbn"] is not None and cols["isbn"] < len(row) else " ".join(row)
            m = ISBN13_RE.search(src)
            if m:
                isbn = norm_isbn(m.group(0))
            pg = PAGES_RE.search(desc)
            rows.append({
                "raw": re.sub(r"\s+", " ", " | ".join(row))[:300],
                "title": clean_title(desc),
                "isbn": isbn,
                "qty": qty,
                "pages": int(pg.group(1)) if pg else None,
            })
        if rows:
            return rows
    return []


# ---------------------------------------------------------------- match ---
def match_line(line: dict, books: list, aliases: Optional[dict] = None) -> dict:
    """Pick the catalogue book for one document line.

    books: [{id, title, isbn, pages?}]. Returns
      {book_id, method: isbn|title|none, score, candidates:[{book_id,title,score}]}
    A line is only auto-matched when the choice is clear; anything ambiguous
    comes back unmatched with candidates, for the person to pick.

    aliases: fold(title as written on a document) -> book_id, learned from
    earlier confirmations ("LA/LR, 2nd Ed" -> the LA/LR 2/e book). Checked
    after ISBN and before fuzzy matching, so a title someone has already
    resolved once is never asked about again.
    """
    isbn = norm_isbn(line.get("isbn"))
    if isbn:
        hit = next((b for b in books if norm_isbn(b.get("isbn")) == isbn), None)
        if hit:
            return {"book_id": hit["id"], "method": "isbn", "score": 1.0, "candidates": []}
    if aliases:
        bid = aliases.get(fold(line.get("title") or ""))
        if bid and any(b["id"] == bid for b in books):
            return {"book_id": bid, "method": "alias", "score": 1.0, "candidates": []}
    want = tokens(line.get("title") or "")
    if not want:
        return {"book_id": None, "method": "none", "score": 0.0, "candidates": []}
    wf = fold(line.get("title") or "")
    scored = []
    for b in books:
        # Author included: courier sheets name a book by its author when two
        # share a title ("International Relations (Achal Priyadarshy)").
        have = set(tokens(f'{b.get("title") or ""} {b.get("author") or ""}'))
        if not have:
            continue
        cover = sum(1 for t in want if t in have) / len(want)
        if cover < 0.5:
            continue
        bf = fold(b.get("title") or "")
        score = cover * 0.8 + SequenceMatcher(None, wf, bf[: len(wf) + 10]).ratio() * 0.2
        if bf.startswith(wf):
            score += 0.1
        pages = line.get("pages")
        if pages and b.get("pages"):
            if abs(int(b["pages"]) - int(pages)) <= max(10, int(pages) * 0.05):
                score += 0.05
        scored.append((round(score, 3), b))
    scored.sort(key=lambda x: -x[0])
    cands = [{"book_id": b["id"], "title": b.get("title", ""), "score": s} for s, b in scored[:3]]
    if scored and scored[0][0] >= 0.85 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.08):
        return {"book_id": scored[0][1]["id"], "method": "title", "score": scored[0][0], "candidates": cands}
    return {"book_id": None, "method": "none", "score": scored[0][0] if scored else 0.0, "candidates": cands}


def match_party_author(party_name: str, authors: Iterable[str]) -> Optional[str]:
    """The author a carton is addressed to, if the consignee is one of ours."""
    p = fold(party_name).replace(" ", "")
    if len(p) < 4:
        return None
    for name in authors:
        n = fold(re.sub(r"^(dr|prof|ca|cs|adv|mr|mrs|ms)\.?\s+", "", name or "", flags=re.I)).replace(" ", "")
        if n and len(n) >= 4 and (n == p or n in p):
            return name
    return None


# --------------------------------------------------------------- scoring ---
def score_corrections(read: list, confirmed: list) -> dict:
    """Compare what the system read with what the person confirmed.

    read:      [{line_no, book_id, qty, include}]   — the suggestion shown
    confirmed: [{line_no?, book_id, qty, include}]  — what was synced
               (line_no None = a line the person added by hand)
    Per line: correct | wrong_book | wrong_qty | extra (suggested, removed) |
    missed (added by hand). Accuracy = correct / every line that mattered.
    """
    by_no = {r["line_no"]: r for r in read}
    out = {"correct": 0, "wrong_book": 0, "wrong_qty": 0, "extra": 0, "missed": 0, "details": []}
    seen = set()
    for c in confirmed:
        n = c.get("line_no")
        r = by_no.get(n) if n is not None else None
        if n is not None:
            seen.add(n)
        if not c.get("include"):
            if r and r.get("include"):
                out["extra"] += 1
                out["details"].append({"line_no": n, "kind": "extra"})
            continue
        if r is None:
            out["missed"] += 1
            out["details"].append({"line_no": None, "kind": "missed", "book_id": c.get("book_id")})
        elif r.get("book_id") != c.get("book_id") or not r.get("include"):
            out["wrong_book"] += 1
            out["details"].append({"line_no": n, "kind": "wrong_book",
                                   "read": r.get("book_id"), "confirmed": c.get("book_id")})
        elif int(r.get("qty") or 0) != int(c.get("qty") or 0):
            out["wrong_qty"] += 1
            out["details"].append({"line_no": n, "kind": "wrong_qty",
                                   "read": r.get("qty"), "confirmed": c.get("qty")})
        else:
            out["correct"] += 1
    for n, r in by_no.items():
        if n not in seen and r.get("include"):
            out["extra"] += 1
            out["details"].append({"line_no": n, "kind": "extra"})
    total = out["correct"] + out["wrong_book"] + out["wrong_qty"] + out["extra"] + out["missed"]
    out["lines"] = total
    out["accuracy"] = round(out["correct"] / total, 4) if total else None
    return out


# ------------------------------------------------------------ courier sheet ---
# A sheet of address labels for one courier run (e.g. "Courier 05.10.pdf"):
# per parcel, the book lines come FIRST ("Compulsory English, 6th ed- 1 copy",
# "In-House Matters -1"), then the recipient's address, then a "From" block
# with Oakbridge's own address. One sheet mixes paid website orders with free
# copies to teachers and academies.
COURIER_BOOK_RE = re.compile(r"^(?P<title>.+?)\s*[-\u2013\u2014]\s*(?P<qty>\d{1,3})\s*(?:cop(?:y|ies)|nos?\.?|pcs\.?)?\s*$", re.I)
PHONE_LINE_RE = re.compile(r"\b(?:mob(?:ile)?|tel|ph(?:one)?|m)\b\.?\s*[:\-]?\s*([+\d][\d\s-]{7,})", re.I)
PIN_RE = re.compile(r"\b(\d{6})\b")


def _is_book_line(ln: str) -> Optional[dict]:
    m = COURIER_BOOK_RE.match(ln.strip())
    if not m:
        return None
    title, qty = m.group("title").strip(" ,-"), int(m.group("qty"))
    # "Varanasi- 221010" and "New Delhi - 110068" end in a number too; a pin
    # code is six digits and a city is not a book.
    if not (0 < qty <= 500) or len(tokens(title)) == 0 or re.search(r"\d{5,}", ln):
        return None
    return {"title": title, "qty": qty, "raw": ln.strip()}


def parse_courier_text(text: str) -> list:
    """Courier label sheet -> parcels [{no, lines, name, org, phone, pincode, address}]."""
    parcels, cur, state = [], None, "books"
    for raw in (text or "").splitlines():
        ln = raw.strip()
        if not ln:
            continue
        book = _is_book_line(ln)
        if book:
            if cur is None or state != "books":
                cur = {"lines": [], "address": [], "name": "", "org": "", "phone": "", "pincode": ""}
                parcels.append(cur)
                state = "books"
            cur["lines"].append(book)
            continue
        if cur is None:
            continue
        if re.match(r"^from\b", ln, re.I):
            state = "from"
            continue
        if state == "from":
            continue  # our own return address
        state = "address"
        ph = PHONE_LINE_RE.search(ln)
        if ph:
            cur["phone"] = re.sub(r"\D", "", ph.group(1))[-10:]
            continue
        pin = PIN_RE.search(ln)
        if pin and not cur["pincode"]:
            cur["pincode"] = pin.group(1)
        if not cur["name"]:
            cur["name"] = re.sub(r",\s*(director|principal|owner|manager)\b.*$", "", ln, flags=re.I).strip(" ,")
        elif not cur["org"] and not re.search(r"\d", ln):
            cur["org"] = ln.strip(" ,")
        cur["address"].append(ln.strip(" ,"))
    for i, p in enumerate(parcels, start=1):
        p["no"] = i
    return parcels


def match_order(parcel: dict, orders: list) -> Optional[dict]:
    """The paid website order a parcel ships, or None (then it is a free copy).

    orders: paid, not yet shipped — [{id, order_number, full_name, phone,
    pincode, delivery_*, item_book_ids}]. A phone number match is decisive;
    otherwise the pin code AND part of the name must agree. Ambiguity (two
    orders fit equally) returns None: a parcel wrongly treated as a website
    order would leave its copies on the shelf in the count.
    """
    phone = (parcel.get("phone") or "")[-10:]
    pin = parcel.get("pincode") or ""
    name_toks = set(tokens(parcel.get("name") or "")) - {"mr", "ms", "mrs", "dr"}
    scored = []
    for o in orders:
        phones = {re.sub(r"\D", "", o.get(k) or "")[-10:] for k in ("phone", "delivery_phone")} - {""}
        pins = {o.get(k) or "" for k in ("pincode", "delivery_pincode")} - {""}
        names = set(tokens(f'{o.get("full_name") or ""} {o.get("delivery_name") or ""}'))
        score = 0
        if phone and phone in phones:
            score += 3
        if pin and pin in pins:
            score += 1
            if name_toks & names:
                score += 1
        if score >= 2:
            scored.append((score, o))
    scored.sort(key=lambda x: -x[0])
    if not scored or (len(scored) > 1 and scored[0][0] == scored[1][0]):
        return None
    return scored[0][1]
