"""Marketing email attachments — the rules (Nov 2026). Pure: bytes in, verdicts out.

Files ride on EVERY email of a campaign, to people who did not ask for a file,
from our sending domain. One malicious or broken attachment is a security
incident for our readers and a reputation hit SES remembers for every later
campaign. So the rules are strict and decided here, by content, never by the
name the uploader gave the file:

  * Types: PDF, Excel (.xlsx, legacy .xls), Word (.docx, legacy .doc), CSV,
    images (JPEG/PNG/GIF/WebP). The file's bytes must BE that type; the
    extension only has to agree.
  * No .zip and no video — the admin chose real attachments over download
    links, and mailbox providers block or bounce zip archives and anything
    video-sized in bulk mail. Video goes as a YouTube/Drive link in a Button.
  * No macros, embedded programs, ActiveX, remote templates (Office), no
    JavaScript / launch actions (PDF) — uploads_guard does the inspection.
  * At most MAX_FILES files and MAX_TOTAL bytes per campaign: after base64
    each email is ~1.37x that, well inside SES's 40 MB message limit and the
    ~25 MB most inboxes accept.

Used by marketing_attachments.py (upload/remove endpoints, loading at send
time) and marketing.build_mime (the MIME structure).
"""
from __future__ import annotations

import re
from email import encoders
from email.mime.base import MIMEBase

import uploads_guard as ug

MAX_TOTAL = 10 * 1024 * 1024
MAX_FILES = 10

MIME = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
    "csv": "text/csv",
    "jpg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
}
ALLOWED = set(MIME) | {"jpeg"}
REFUSED_HINT = {
    "zip": "Zip files are blocked by most mailboxes in bulk email. Share it as a Google Drive link in a Button block instead.",
    "mp4": "Videos are too large for email. Put the video on YouTube or Google Drive and link it with a Button block.",
    "mov": "Videos are too large for email. Put the video on YouTube or Google Drive and link it with a Button block.",
}


class Refused(ValueError):
    """The file is not accepted; the message is shown to the admin as-is."""


def safe_name(name: str) -> str:
    """The filename recipients see: no path, no control or quote characters,
    at most 100 characters, extension kept."""
    n = str(name or "").replace("\\", "/").rsplit("/", 1)[-1]
    n = re.sub(r'[\x00-\x1f\x7f"<>|:*?]', "", n).strip(" .") or "attachment"
    if len(n) > 100:
        stem, dot, ext = n.rpartition(".")
        n = (stem[: 100 - len(ext) - 1] + "." + ext) if dot and len(ext) <= 5 else n[:100]
    return n


def classify(name: str, data: bytes) -> tuple[str, str]:
    """(extension to store under, MIME type) — or raise Refused."""
    if not data:
        raise Refused("The file is empty.")
    low = safe_name(name).lower()
    ext = low.rsplit(".", 1)[-1] if "." in low else ""
    if ext in REFUSED_HINT:
        raise Refused(REFUSED_HINT[ext])
    if ext in ("m4v", "avi", "mkv", "webm", "wmv", "3gp", "rar", "7z", "tar", "gz"):
        raise Refused("Archives and videos can't be emailed as attachments. Share a Google Drive / YouTube link in a Button block instead.")
    if ext in ug.EXECUTABLE_EXTS:
        raise Refused("Programs, scripts and macro-enabled Office files (.docm/.xlsm) are never sent to readers.")
    if ext not in ALLOWED:
        raise Refused("Attach PDF, Excel (.xlsx/.xls), Word (.docx/.doc), CSV or an image (JPEG, PNG, GIF, WebP).")

    if ext == "pdf":
        if not ug.is_pdf(data):
            raise Refused("This file is named .pdf but is not a PDF.")
        found = ug.pdf_threats(data)["found"]
        if found:
            raise Refused(f"This PDF contains {found[0]} — save it again as a plain PDF (Print → Save as PDF) and attach that.")
        return "pdf", MIME["pdf"]

    if ext in ("jpg", "jpeg", "png", "gif", "webp"):
        real = ug.sniff_image(data)
        if real not in ("jpg", "png", "gif", "webp"):
            raise Refused("This file is named like an image but is not a JPEG, PNG, GIF or WebP.")
        return real, MIME[real]

    if ext in ("xlsx", "docx"):
        if not ug.is_zip_container(data):
            raise Refused(f"This file is named .{ext} but is not a real {'Excel' if ext == 'xlsx' else 'Word'} file.")
        found = ug.zip_threats(data, office=True)
        if found:
            raise Refused(f"This file was refused: it contains {', '.join(found)}.")
        return ext, MIME[ext]

    if ext in ("xls", "doc"):
        if not ug.is_ole_document(data):
            raise Refused(f"This file is named .{ext} but is not a real {'Excel' if ext == 'xls' else 'Word'} file.")
        if ug.ole_threats(data):
            raise Refused("This file contains macros. Save it as .docx/.xlsx (macro-free) and attach that.")
        return ext, MIME[ext]

    # csv: text, not a disguised binary.
    if b"\x00" in data[:65536] or ug.is_zip_container(data) or ug.is_ole_document(data) or ug.is_pdf(data):
        raise Refused("This file is named .csv but is not a text CSV.")
    try:
        data[:65536].decode("utf-8")
    except UnicodeDecodeError:
        try:
            data[:65536].decode("cp1252")
        except UnicodeDecodeError:
            raise Refused("This CSV is not readable text (save it as CSV UTF-8).") from None
    return "csv", MIME["csv"]


def check_room(existing: list, new_size: int) -> None:
    if len(existing) >= MAX_FILES:
        raise Refused(f"At most {MAX_FILES} attachments per campaign.")
    total = sum(int(a.get("size") or 0) for a in existing) + new_size
    if total > MAX_TOTAL:
        used = sum(int(a.get("size") or 0) for a in existing)
        raise Refused(f"Attachments are limited to 10 MB per email — {used / 1048576:.1f} MB already attached, "
                      f"this file is {new_size / 1048576:.1f} MB. Share large files as a Google Drive link instead.")


def mime_parts(files: list) -> list:
    """[(filename, mime, bytes)] -> MIME parts, base64, Content-Disposition
    attachment with an RFC 2231 filename (Hindi/Unicode names survive)."""
    parts = []
    for name, mime, data in files:
        main, _, sub = (mime or "application/octet-stream").partition("/")
        p = MIMEBase(main, sub or "octet-stream")
        p.set_payload(data)
        encoders.encode_base64(p)
        fn = safe_name(name)
        try:
            fn.encode("ascii")
            p.add_header("Content-Disposition", "attachment", filename=fn)
        except UnicodeEncodeError:
            p.add_header("Content-Disposition", "attachment", filename=("utf-8", "", fn))
        parts.append(p)
    return parts
