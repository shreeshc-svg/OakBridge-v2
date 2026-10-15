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


# Tally invoice header labels (right-hand column and box titles) — never a
# party name.
TALLY_LABEL_RE = re.compile(
    r"^(terms of delivery|terms of payment|mode/terms|dispatch(ed)?\s|delivery note|reference no|"
    r"other references?|buyer'?s order|buyer \(bill to\)|bill to|ship to|dated?\b|destination|"
    r"bill of lading|motor vehicle|invoice no|e-way|gstin|state name|place of supply|contact|e-?mail|"
    r"consignee|supplier'?s ref)", re.I)


# Lines that can sit right after "Consignee" in a photo but are not the party.
# Textract interleaves Tally's two columns, so the VALUE of "Dispatched
# through" (the transport company) and the consignee's street address both
# turn up there. Seen live: cartons recorded as going to "American Transport",
# "ABC Transport" and "Ansari Road,".
TRANSPORT_RE = re.compile(
    r"\b(transports?|transporters?|logistics?|roadways|roadlines|road\s*lines|cargo|carriers?|couriers?|"
    r"freight|movers|goods\s+carrier|parcel\s+service)\b", re.I)
ADDRESS_RE = re.compile(
    r"\b(road|rd|street|marg|lane|gali|nagar|colony|sector|block|plot|floor|chowk|near|opp|opposite|"
    r"phase|enclave|vihar|extn|extension|district|dist|pin|pincode|tehsil)\b|\b\d{6}\b", re.I)
# ...but a shop can have one of those words in its name ("Mall Road Book
# Depot"), so a line that also reads like a business is kept.
BUSINESS_RE = re.compile(
    r"\b(house|books?|agenc(?:y|ies)|depot|stores?|distributors?|cent(?:re|er)|publishers?|publications?|"
    r"traders?|enterprises?|services|company|co|pvt|private|ltd|limited|llp|sons|brothers|bros|mart|"
    r"emporium|library|stall|academy|institute|college|school|university|law)\b", re.I)
# A document number on the line(s) after its "Invoice No." label — a photo
# puts "Dated" (the right-hand column label) in between, which the one-line
# INVOICE_NO_RE cannot cross. Every photo on 13 Oct 2026 came back "no number",
# which also switched off duplicate protection for them.
DOCNO_TOKEN_RE = re.compile(r"^[A-Z0-9]{1,12}(?:[/-][A-Z0-9]{1,12}){1,4}$", re.I)
DATE_TOKEN_RE = re.compile(r"^\d{1,2}[-/.](?:[A-Za-z]{3,9}|\d{1,2})[-/.]\d{2,4}$")
FY_TOKEN_RE = re.compile(r"^\d{2,4}-\d{2,4}$")


def is_us(line: str) -> bool:
    """Oakbridge's own name however it is spaced or punctuated — "OAK BRIDGE
    PUBLISHING PVT LTD" slipped through a plain "oakbridge" check and was
    recorded as the printer on two bills."""
    return "oakbridge" in re.sub(r"[^a-z]", "", (line or "").lower())


def _party_candidate(line: str) -> bool:
    x = (line or "").strip(" ,.:;-")
    if len(x) < 3 or re.match(r"\d", x) or TALLY_LABEL_RE.match(x) or is_us(x):
        return False
    if not re.search(r"[A-Za-z]{2}", x):
        return False
    if TRANSPORT_RE.search(x):
        return False
    if ADDRESS_RE.search(x) and not BUSINESS_RE.search(x):
        return False
    if re.search(r"@|\+?\d[\d\s-]{8,}", x):        # e-mail or phone number
        return False
    return True


def _doc_number_after_label(lines: list) -> str:
    for i, ln in enumerate(lines):
        if not re.search(r"invoice\s*no", ln, re.I):
            continue
        tail = re.split(r"invoice\s*no\.?", ln, flags=re.I)[-1]
        for cand_line in [tail] + lines[i + 1:i + 7]:
            for tok in re.split(r"[\s:]+", cand_line or ""):
                tok = tok.strip(".,;")
                if (DOCNO_TOKEN_RE.match(tok) and re.search(r"\d", tok)
                        and not DATE_TOKEN_RE.match(tok) and not FY_TOKEN_RE.match(tok)):
                    return tok
    return ""


def party_key(name: str) -> str:
    """Comparable form of a party name: case, punctuation and M/s. ignored."""
    s = fold(name)
    s = re.sub(r"^(m s|ms|messrs)\s+", "", s)
    return s


def header_fields(text: str, direction: str) -> dict:
    """Invoice number, other party, total quantity — from the document's text."""
    out = {"doc_number": "", "party_gstin": "", "party_name": "", "total_qty": None}
    m = INVOICE_NO_RE.search(text or "")
    lines = [ln.strip() for ln in (text or "").splitlines()]
    num = re.sub(r"\s+", "", m.group(1)) if m else ""
    if not num or DATE_TOKEN_RE.match(num) or FY_TOKEN_RE.match(num):
        # The one-line pattern found nothing, or found the date column.
        num = _doc_number_after_label(lines)
    out["doc_number"] = num
    gstins = [g for g in GSTIN_RE.findall(text or "") if g != OUR_GSTIN]
    if gstins:
        out["party_gstin"] = gstins[0]
    if direction == "out":
        # Consignee (ship to) first; the buyer (bill to) block when the
        # consignee block gave nothing usable.
        for label in (r"consignee", r"buyer"):
            for i, ln in enumerate(lines):
                if re.match(label, ln, re.I):
                    # Same line: "Consignee (Ship to) Acme Book House".
                    same = re.sub(r"^(consignee|buyer)\s*(\((ship|bill) to\))?\s*[:\-]?\s*", "", ln, flags=re.I)
                    pool = ([same] if same and same != ln else []) + lines[i + 1:i + 8]
                    nxt = next((x.strip(" ,") for x in pool if _party_candidate(x)), "")
                    if nxt:
                        out["party_name"] = nxt
                        break
            if out["party_name"]:
                break
    else:
        # The supplier is the first company line on the bill, before "Consignee".
        for ln in lines:
            if re.search(r"\b(pvt|private|ltd|limited|printers?|press|llp)\b", ln, re.I) \
                    and not is_us(ln):
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


# Website order number as the site issues it (server.py): OAK-yymmdd-XXXXXX.
# The office may write it on a label — anywhere in the parcel — to link the
# parcel to that exact order instead of guessing from phone / pin code.
ORDER_NO_RE = re.compile(r"\bOAK-\d{6}-[A-Z0-9]{6}\b", re.I)
# "(ISBN - 9789395764575)" after the quantity, as on the 13 Oct 2026 sheet.
# The line used to be dropped whole, losing that parcel (Pandith Books, 5 copies).
ISBN_TAIL_RE = re.compile(r"\(?\s*ISBN\s*[:\-\u2013]?\s*([0-9Xx\- ]{10,17})\s*\)?\s*$", re.I)
# Words the office may add to say "this is a website order" — never part of a title.
WEB_WORDS_RE = re.compile(r"\[?\s*\b(?:website|web)\s*order\b\s*\]?|\[\s*web\s*\]", re.I)


def _is_book_line(ln: str) -> Optional[dict]:
    raw = ln.strip()
    line = ORDER_NO_RE.sub("", raw)
    line = WEB_WORDS_RE.sub("", line).strip(" ,;:|")
    isbn = ""
    t = ISBN_TAIL_RE.search(line)
    if t:
        cand = norm_isbn(t.group(1))
        if len(cand) in (10, 13):
            isbn = cand
            line = line[:t.start()].strip(" ,;:|")
    m = COURIER_BOOK_RE.match(line)
    if not m:
        return None
    title, qty = m.group("title").strip(" ,-"), int(m.group("qty"))
    # "Varanasi- 221010" and "New Delhi - 110068" end in a number too; a pin
    # code is six digits and a city is not a book.
    if not (0 < qty <= 500) or len(tokens(title)) == 0 or re.search(r"\d{5,}", line):
        return None
    out = {"title": title, "qty": qty, "raw": raw}
    if isbn:
        out["isbn"] = isbn
    return out


def parse_courier_text(text: str) -> list:
    """Courier label sheet -> parcels [{no, lines, name, org, phone, pincode, address}]."""
    parcels, cur, state = [], None, "books"
    pending_order = ""          # an order number written above a parcel's books
    pending_web = False         # "Website order" written above a parcel's books
    for raw in (text or "").splitlines():
        ln = raw.strip()
        if not ln:
            continue
        on = ORDER_NO_RE.search(ln)
        book = _is_book_line(ln)
        if book:
            if cur is None or state != "books":
                cur = {"lines": [], "address": [], "name": "", "org": "", "phone": "", "pincode": "",
                       "order_number": pending_order, "web_tag": bool(pending_order) or pending_web}
                parcels.append(cur)
                state = "books"
                pending_order, pending_web = "", False
            if on:
                cur["order_number"] = on.group(0).upper()
            if on or WEB_WORDS_RE.search(ln):
                cur["web_tag"] = True
            cur["lines"].append(book)
            continue
        if on or WEB_WORDS_RE.fullmatch(ln.strip(" ,;:|")):
            num = on.group(0).upper() if on else ""
            # In a parcel's books or address it is that parcel's; after the
            # "From" block (or before the first parcel) it heads the next one.
            if cur is not None and state in ("books", "address"):
                cur["order_number"] = num or cur["order_number"]
                cur["web_tag"] = True
            else:
                pending_order, pending_web = num, True
            rest = WEB_WORDS_RE.sub("", ORDER_NO_RE.sub("", ln)).strip(" ,;:|-")
            if not rest:
                continue
            ln = rest
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
    # An order number written on the label decides it outright — or, if that
    # order is not open (unpaid, already shipped, a typo), nothing is guessed.
    written = (parcel.get("order_number") or "").upper()
    if written:
        return next((o for o in orders if (o.get("order_number") or "").upper() == written), None)
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


# --------------------------------------------------- carton approval (out) ---
# An outgoing carton goes: packed by the warehouse (copies come off the count
# at once, so the website cannot sell copies already sitting in a carton) ->
# checked by the order-management team -> approved (he may ship it) or sent
# back (copies go back on the count; he repacks) or cancelled (copies go back;
# he unpacks). These two pure functions hold the rules so they can be tested
# without a database.

def inbox_bucket(doc: dict) -> Optional[str]:
    """Which list on the warehouse phone a carton belongs in, or None.

    ready      approved, not yet marked shipped        -> "Shipped" button
    sent_back  the team wants it repacked              -> "Pack again"
    cancelled  not going; he has not confirmed unpacking -> "Unpacked"
    waiting    packed, the team has not looked yet     (no action)
    Practice runs and other document types never notify.
    """
    if doc.get("direction") != "out" or doc.get("practice"):
        return None
    st = doc.get("status")
    if st == "awaiting_approval":
        return "waiting"
    if st == "sent_back":
        return "sent_back"
    if st == "cancelled" and not doc.get("wh_ack_at"):
        return "cancelled"
    # approved_at guards cartons packed before approval existed: they were
    # never "approved", so they must not suddenly appear as ready to ship.
    if st == "confirmed" and doc.get("approved_at") and not doc.get("shipped_at"):
        return "ready"
    return None


def approval_refusal(role: str, sections: Iterable[str], approver: str, packer: str,
                     superadmin: bool) -> Optional[str]:
    """Why this person may NOT approve a carton (None = they may).

    The point of approval is a second pair of eyes, so the person who packed
    a carton cannot approve it (a superadmin can, so one absent colleague
    never blocks shipping). The warehouse role never approves.
    """
    if role == "warehouse":
        return "The warehouse login cannot approve cartons."
    if not superadmin and "orders" not in set(sections):
        return "Approving cartons needs access to Orders."
    if not superadmin and approver and approver.lower() == (packer or "").lower():
        return "Someone other than the packer must approve this carton."
    return None


# ------------------------------------------- website order cancel / re-take ---
RETAKE_NOTE = "Order un-cancelled"


def order_ledger_diffs(moves: list, lines: list, *, out: bool) -> dict:
    """Movements still needed so one website order's ledger is right.

    moves  this order's website_order / website_return movements (not undone)
    lines  (book_id, qty) the order took off website stock
    out    True = the order stands (copies out); False = cancelled (copies back)

    Worked out from what is already recorded rather than replayed, so running
    it twice, or after a half-finished run, changes nothing more.

    A sale made before the warehouse trial started has no movement: the
    opening count was taken after it, so those copies are already outside the
    count. Cancelling it brings them in (+q); un-cancelling takes them out
    again (back to 0).
    """
    sold: dict = {}
    net: dict = {}
    for mv in moves:
        bid, q = mv["book_id"], int(mv["qty"])
        net[bid] = net.get(bid, 0) + q
        # Only the original sale counts as "sold"; a re-take is also a
        # website_order movement but carries RETAKE_NOTE.
        if mv.get("reason") == "website_order" and mv.get("note") != RETAKE_NOTE:
            sold[bid] = sold.get(bid, 0) - q
    pre_trial: dict = {}
    for bid, q in lines:
        if bid not in sold:
            pre_trial[bid] = pre_trial.get(bid, 0) + int(q)
    out_diffs = {}
    for bid in set(sold) | set(net) | set(pre_trial):
        if bid in pre_trial:
            target = 0 if out else pre_trial[bid]
        else:
            target = -sold.get(bid, 0) if out else 0
        d = target - net.get(bid, 0)
        if d:
            out_diffs[bid] = d
    return out_diffs


# ------------------------------------------------- near-duplicates ---
def line_set(lines: Iterable[dict]) -> list:
    """Sorted (book_id, qty) of the lines that move stock — the carton's
    fingerprint. Two photos of one invoice have different files and, when no
    number was read, nothing else in common."""
    out: dict = {}
    for ln in lines or []:
        if ln.get("include", True) and ln.get("book_id") and int(ln.get("qty") or 0) > 0:
            out[ln["book_id"]] = out.get(ln["book_id"], 0) + int(ln["qty"])
    return sorted(out.items())


def same_document(a: dict, b: dict) -> bool:
    """Same direction, same party (GSTIN when both have one, else the name)
    and exactly the same books and quantities."""
    if a.get("direction") != b.get("direction"):
        return False
    na, nb = (a.get("doc_number") or "").strip(), (b.get("doc_number") or "").strip()
    if na and nb and na != nb:
        return False                  # two different invoices, however alike
    ga, gb = a.get("party_gstin") or "", b.get("party_gstin") or ""
    if ga and gb:
        if ga != gb:
            return False
    elif party_key(a.get("party_name", "")) != party_key(b.get("party_name", "")):
        return False
    la, lb = line_set(a.get("lines") or []), line_set(b.get("lines") or [])
    return bool(la) and la == lb


def masked_text(text: str, limit: int = 4000) -> str:
    """The top of what was read, kept on the document so a misread can be
    diagnosed later without opening the file. Long digit runs (bank account
    numbers on Tally invoices) are masked; ISBNs are kept."""
    def mask(m):
        d = m.group(0)
        return d if (len(d) == 13 and d.startswith(("978", "979"))) else "#" * len(d)
    return re.sub(r"\d{9,18}", mask, (text or "")[:limit])


# ------------------------------------------------- impossible counts ---
def below_zero_note(wh_stock: int, owed: int, website: int, mode: str) -> str:
    """Why a warehouse count is below 0, in words the office can act on.

    The warehouse count is "on the shelf minus what is promised": a paid
    pre-order or backorder takes its copies off when it is paid, before they
    exist. So below zero is fine while orders are waiting — up to what they
    owe. Anything beyond that cannot be true and needs a shelf count.
    """
    if wh_stock >= 0:
        return ""
    unexplained = -wh_stock - max(0, owed)
    if unexplained <= 0:
        if mode == "trial" and website > 0:
            return (f"{owed} cop{'y' if owed == 1 else 'ies'} owed to waiting orders, but the website (sheet) "
                    "has copies — the printer bill was probably not entered on the warehouse screen.")
        return f"{owed} cop{'y' if owed == 1 else 'ies'} owed to waiting orders — fine until the copies arrive."
    return (f"{unexplained} more cop{'y' if unexplained == 1 else 'ies'} out than ever came in"
            f"{f' (plus {owed} owed to waiting orders)' if owed > 0 else ''}. "
            "Count this book on the shelf and save the count as a correction.")


# ---------------------------------------------- admin line corrections ---
def line_corrections(moves: list, lines: list, sign: int) -> dict:
    """Correction movements needed so a synced document's stock matches the
    corrected lines.

    moves  the document's movements still standing ({book_id, qty} signed)
    lines  corrected (book_id, qty) — qty as on the document, unsigned
    sign   +1 printer bill (copies in), -1 carton (copies out)
    Returns {book_id: signed qty to apply}. Books dropped from the lines are
    brought back to zero; earlier corrections are already in moves, so
    correcting twice to the same lines changes nothing.
    """
    want: dict = {}
    for bid, q in lines:
        want[bid] = want.get(bid, 0) + sign * int(q)
    have: dict = {}
    for mv in moves:
        have[mv["book_id"]] = have.get(mv["book_id"], 0) + int(mv["qty"])
    out = {}
    for bid in set(want) | set(have):
        d = want.get(bid, 0) - have.get(bid, 0)
        if d:
            out[bid] = d
    return out
