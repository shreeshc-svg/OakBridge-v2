"""Warehouse → "Upload Amazon / Flipkart sheet" (Nov 2026).

WHY
  Amazon and Flipkart orders are picked from our own warehouse, but nothing
  recorded them — copies left the shelf and the count drifted. The warehouse
  person already keeps a daily Excel sheet of those orders; he now uploads it
  from his phone and the copies come off as "Carton out – Amazon" /
  "Carton out – Flipkart".

THE SHEET (his format, "13-NOV-2026, FRIDAY.xlsx")
  Row 1   TODAY ONLINE ORDER DATE-13-NOV-2026, FRIDAY     <- the date
  Row 2   S.NO | BOOKS NAME | ISBN CODE | QTY | CHANNEL    <- headers (found by
          name, anywhere in the first 10 rows, in any column order)
  Rows    one book per row; CHANNEL = AMAZON / FLIPKART. Anything else
          (COURIER, KINDLE, blank) is IGNORED — decided with the founders:
          this upload is only for Amazon and Flipkart. The TOTAL row is skipped.
  Books are matched by ISBN (hyphens / spaces / ISBN-10 all fine); the name is
  only for his eyes. A combo used to be one row with two titles — from now on
  every book is its own row, and a name that looks like two titles is flagged.

ONE SHEET PER DATE — RE-UPLOADS ARE SAFE
  The sheet has no marketplace order IDs, so the date is the key. What was
  applied for each (date, channel, book) is kept in `wh_mp_ledger`; uploading
  that date again applies only the DIFFERENCE (Amazon 3 -> 4 takes one more;
  a row deleted from the sheet puts its copies back), and the check screen
  shows every change before he confirms. Uploading the same file twice does
  nothing.

TWO STEPS, SERVER-SIDE
  /preview parses and stores the result (`wh_mp_previews`, kept 1 day) and
  returns the check screen; /confirm applies THAT stored preview — the phone
  never sends quantities back, so nothing can be altered in between. Confirm
  recomputes the differences against the ledger at that moment, so two
  confirms of the same sheet can't double-deduct either.

Each change is an ordinary stock movement (warehouse._apply): reason
"amazon_mp" / "flipkart_mp", doc_id "MP-<date>", the sheet name in the note —
so it shows in Movements, can be searched by "MP-2026-11-13", and a single
line can be undone there like any other movement.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from extensions import db, require_admin
from uploads_guard import read_limited
from warehouse import NOT_COUNTED, _apply, _office_only, _reverse, get_state, require_warehouse

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/warehouse/marketplace", tags=["warehouse"])
# Office side: list the sheets by date and undo a whole one. A single line is
# NOT undone in Movements (warehouse.adm_undo_move refuses these reasons): the
# per-date ledger would then disagree with the stock and the next re-upload of
# that date would compute the wrong difference.
admin_router = APIRouter(prefix="/api/admin/warehouse/marketplace", tags=["warehouse-admin"], dependencies=[Depends(require_admin)])

MAX_FILE = 5 * 1024 * 1024
CHANNELS = {"AMAZON": ("amazon_mp", "Amazon"), "FLIPKART": ("flipkart_mp", "Flipkart")}
REASON_LABEL = {"amazon_mp": "Carton out – Amazon", "flipkart_mp": "Carton out – Flipkart"}
MONTHS = {m: i for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return (_now() + timedelta(hours=5, minutes=30)).date()


# ------------------------------------------------------------------ parsing ---
def isbn_key(v) -> str:
    """Digits (and X) only; an ISBN-10 becomes its ISBN-13 so both match."""
    s = re.sub(r"[^0-9Xx]", "", str(v or "")).upper()
    if len(s) == 10:
        core = "978" + s[:9]
        tot = sum((1 if i % 2 == 0 else 3) * int(c) for i, c in enumerate(core))
        s = core + str((10 - tot % 10) % 10)
    return s


def find_date(cells: list, filename: str) -> Optional[str]:
    """'…DATE-13-NOV-2026, FRIDAY' in the top rows, else the file name."""
    for text in [*cells, filename]:
        m = re.search(r"(\d{1,2})[-\s./]+([A-Za-z]{3})[A-Za-z]*[-\s./,]+(\d{4})", str(text or ""))
        if m and m.group(2).upper() in MONTHS:
            try:
                return date(int(m.group(3)), MONTHS[m.group(2).upper()], int(m.group(1))).isoformat()
            except ValueError:
                continue
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(text or ""))
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
            except ValueError:
                continue
    return None


def read_rows(data: bytes, filename: str) -> list:
    """All rows as lists of cell values (xlsx: first sheet; csv)."""
    if filename.lower().endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        return [list(r) for r in csv.reader(io.StringIO(text))]
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Couldn't open that file — upload the Excel sheet (.xlsx) or a .csv.")
    ws = wb.worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def parse_sheet(rows: list, filename: str) -> dict:
    """-> {date, lines: [{line, title, isbn, qty, channel}], ignored: [...], errors: [...]}"""
    head_i, cols = None, {}
    for i, r in enumerate(rows[:10]):
        names = [str(c or "").strip().upper() for c in r]
        idx = lambda *keys: next((j for j, n in enumerate(names) if any(k in n for k in keys)), None)  # noqa: E731
        isbn, qty, ch = idx("ISBN"), idx("QTY", "QUANTITY"), idx("CHANNEL", "PLATFORM", "PORTAL")
        if isbn is not None and qty is not None and ch is not None:
            head_i, cols = i, {"isbn": isbn, "qty": qty, "channel": ch, "title": idx("BOOK", "TITLE", "NAME")}
            break
    if head_i is None:
        raise HTTPException(status_code=400, detail="Couldn't find the header row — it needs columns ISBN, QTY and CHANNEL.")
    top = [c for r in rows[:head_i] for c in r if c]
    out = {"date": find_date(top, filename), "lines": [], "ignored": [], "errors": []}
    for n, r in enumerate(rows[head_i + 1:], start=head_i + 2):
        cell = lambda k: r[cols[k]] if cols.get(k) is not None and cols[k] < len(r) else None  # noqa: E731
        title = str(cell("title") or "").strip()
        raw_isbn, raw_qty, raw_ch = cell("isbn"), cell("qty"), str(cell("channel") or "").strip().upper()
        if not (title or raw_isbn or raw_ch) or title.upper() == "TOTAL" or str(r[0] or "").strip().upper() == "TOTAL":
            continue
        row = {"line": n, "title": title[:200], "isbn_raw": str(raw_isbn or "").strip(), "channel": raw_ch}
        if raw_ch not in CHANNELS:
            out["ignored"].append({**row, "why": f"{raw_ch.title() or 'No channel'} — only Amazon and Flipkart are counted here"})
            continue
        key = isbn_key(raw_isbn)
        try:
            qty = float(raw_qty)
        except (TypeError, ValueError):
            qty = 0
        if len(key) != 13:
            out["errors"].append({**row, "why": "ISBN missing or not 10/13 digits"})
            continue
        if qty <= 0 or qty != int(qty):
            out["errors"].append({**row, "why": "Quantity must be a whole number above 0"})
            continue
        warn = "Two titles in one row? Put each book on its own row." if re.search(r",\s*\w", title) and len(title) > 60 else ""
        out["lines"].append({**row, "isbn": key, "qty": int(qty), "warn": warn})
    return out


# -------------------------------------------------------------- the plan ---
async def _plan(parsed: dict, sheet_date: str) -> dict:
    """Match ISBNs to books and work out the difference against what this
    date already applied. -> rows for the check screen + the changes."""
    books = {}
    async for b in db.books.find({}, {"_id": 0, "id": 1, "isbn": 1, "title": 1, "wh_stock": 1, "stock": 1, "product_type": 1}):
        k = isbn_key(b.get("isbn"))
        if len(k) == 13:
            books.setdefault(k, b)
    rows, errors = [], list(parsed["errors"])
    want: dict = {}                                     # (channel, book_id) -> qty in this sheet
    for ln in parsed["lines"]:
        b = books.get(ln["isbn"])
        if not b:
            errors.append({**ln, "why": "No book with this ISBN in the catalogue — check the ISBN"})
            continue
        if b.get("product_type") in NOT_COUNTED:
            errors.append({**ln, "why": "This ISBN is a pack/hamper — list the books inside it instead"})
            continue
        k = (ln["channel"], b["id"])
        want[k] = want.get(k, 0) + ln["qty"]
        cnt = b["wh_stock"] if b.get("wh_stock") is not None else b.get("stock")
        rows.append({**ln, "book_id": b["id"], "book_title": b.get("title", ""), "stock": int(cnt or 0)})
    had = {(x["channel"], x["book_id"]): x for x in [l async for l in db.wh_mp_ledger.find({"date": sheet_date}, {"_id": 0})]}
    changes = []
    for k in set(want) | set(had):
        new, old = want.get(k, 0), int((had.get(k) or {}).get("qty") or 0)
        if new != old:
            changes.append({"channel": k[0], "book_id": k[1], "old": old, "new": new, "delta": new - old,
                            "title": next((r["book_title"] for r in rows if r["book_id"] == k[1]), (had.get(k) or {}).get("title", ""))})
    stock_by_id = {r["book_id"]: r["stock"] for r in rows}
    for r in rows:
        k = (r["channel"], r["book_id"])
        old = int((had.get(k) or {}).get("qty") or 0)
        r["status"] = "new" if not old else ("unchanged" if want[k] == old else "changed")
        r["was"] = old
        if r["status"] != "unchanged" and want[k] - old > stock_by_id.get(r["book_id"], 0):
            r["warn"] = (r.get("warn") + " " if r.get("warn") else "") + f"Only {stock_by_id[r['book_id']]} in stock by the count — check the shelf."
    totals = {CHANNELS[c][1]: sum(q for (cc, _), q in want.items() if cc == c) for c in CHANNELS}
    return {"rows": rows, "errors": errors, "changes": sorted(changes, key=lambda c: (c["channel"], c["title"])),
            "totals": totals, "already": bool(had)}


@router.post("/preview")
async def mp_preview(file: UploadFile = File(...), sheet_date: Optional[str] = Form(None), user: dict = Depends(require_warehouse)):
    name = (file.filename or "sheet.xlsx")[:120]
    if not name.lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=400, detail="Upload the Excel sheet (.xlsx) or a .csv.")
    data = await read_limited(file, MAX_FILE, "Sheet")
    parsed = parse_sheet(read_rows(data, name), name)
    d = sheet_date or parsed["date"]
    try:
        d = date.fromisoformat(str(d)[:10]).isoformat() if d else None
    except ValueError:
        d = None
    if not d:
        raise HTTPException(status_code=400, detail="Couldn't read the date from the sheet — pick the date and upload again.")
    if d > _today().isoformat():
        raise HTTPException(status_code=400, detail="That date is in the future — check the date in the sheet.")
    plan = await _plan(parsed, d)
    pid = str(uuid.uuid4())
    await db.wh_mp_previews.delete_many({"at": {"$lt": (_now() - timedelta(days=2)).isoformat()}})   # old checks
    await db.wh_mp_previews.insert_one({"id": pid, "date": d, "file": name, "parsed": parsed, "by": user.get("email", ""),
                                        "at": _now().isoformat()})
    return {"id": pid, "date": d, "file": name, "ignored": parsed["ignored"], **plan}


@router.post("/{pid}/confirm")
async def mp_confirm(pid: str, user: dict = Depends(require_warehouse)):
    pv = await db.wh_mp_previews.find_one({"id": pid}, {"_id": 0})
    if not pv or pv.get("used"):
        raise HTTPException(status_code=404, detail="This check has expired — upload the sheet again.")
    if pv["at"] < (_now() - timedelta(days=1)).isoformat():
        raise HTTPException(status_code=410, detail="This check is over a day old — upload the sheet again.")
    if (await get_state())["mode"] == "off":
        raise HTTPException(status_code=409, detail="The warehouse hasn't been started yet (Admin → Warehouse).")
    claim = await db.wh_mp_previews.update_one({"id": pid, "used": {"$in": [None, False]}}, {"$set": {"used": True, "used_at": _now().isoformat()}})
    if not claim.modified_count:
        raise HTTPException(status_code=409, detail="Already applied.")
    # Recomputed NOW against the ledger — not the numbers shown a minute ago —
    # so a second confirm (or a re-upload confirmed in between) can't double up.
    plan = await _plan(pv["parsed"], pv["date"])
    doc_id = f"MP-{pv['date']}"
    applied = []
    for c in plan["changes"]:
        reason, label = CHANNELS[c["channel"]]
        note = f"{pv['file']} · {pv['date']}" + ("" if c["old"] == 0 else f" · re-upload {c['old']}→{c['new']}")
        await _apply(c["book_id"], -c["delta"], reason, actor=user, doc_id=doc_id, party=label, note=note)
        await db.wh_mp_ledger.update_one({"date": pv["date"], "channel": c["channel"], "book_id": c["book_id"]},
                                         {"$set": {"date": pv["date"], "channel": c["channel"], "book_id": c["book_id"], "qty": c["new"],
                                                   "title": c["title"], "file": pv["file"], "at": _now().isoformat(), "by": user.get("email", "")}},
                                         upsert=True)
        applied.append(c)
    from audit import audit_log
    await audit_log(db, "WAREHOUSE_MARKETPLACE_SHEET", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"date": pv["date"], "file": pv["file"], "changes": len(applied),
                          "copies_out": sum(c["delta"] for c in applied if c["delta"] > 0),
                          "copies_back": -sum(c["delta"] for c in applied if c["delta"] < 0)})
    return {"ok": True, "date": pv["date"], "doc_id": doc_id, "changes": applied, "totals": plan["totals"]}


@admin_router.get("/sheets")
async def mp_sheets():
    days: dict = {}
    async for l in db.wh_mp_ledger.find({}, {"_id": 0}):
        d = days.setdefault(l["date"], {"date": l["date"], "Amazon": 0, "Flipkart": 0, "titles": 0, "files": set(), "by": l.get("by", ""), "at": l.get("at", "")})
        d[CHANNELS[l["channel"]][1]] += int(l.get("qty") or 0)
        d["titles"] += 1 if l.get("qty") else 0
        d["files"].add(l.get("file", ""))
        d["at"] = max(d["at"], l.get("at", ""))
    rows = [{**d, "files": sorted(x for x in d["files"] if x)} for d in days.values()]
    rows.sort(key=lambda d: d["date"], reverse=True)
    return {"rows": rows[:120]}


@admin_router.post("/sheets/{sheet_date}/undo")
async def mp_undo(sheet_date: str, user: dict = Depends(require_admin)):
    """Put back every copy that date's sheet(s) took out, and forget the date —
    uploading the sheet again then starts from zero."""
    _office_only(user)
    moves = await db.stock_movements.find({"doc_id": f"MP-{sheet_date}", "undone": False}, {"_id": 0}).to_list(2000)
    if not moves and not await db.wh_mp_ledger.find_one({"date": sheet_date}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="No sheet for that date.")
    for mv in moves:
        await _reverse(mv, user)
    await db.wh_mp_ledger.delete_many({"date": sheet_date})
    from audit import audit_log
    await audit_log(db, "WAREHOUSE_MARKETPLACE_UNDONE", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"date": sheet_date, "movements": len(moves)})
    return {"ok": True, "reversed": len(moves)}


async def ensure_indexes() -> None:
    try:
        await db.wh_mp_ledger.create_index([("date", 1), ("channel", 1), ("book_id", 1)], unique=True)
        await db.wh_mp_previews.create_index("id", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("warehouse marketplace: index creation failed", exc_info=True)
