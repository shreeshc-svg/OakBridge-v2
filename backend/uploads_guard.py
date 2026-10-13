"""
What an uploaded file actually IS, as opposed to what it says it is.

THE PROBLEM THIS EXISTS FOR

Every upload endpoint on this site used to decide a file's type from two things,
both of which are chosen by whoever is uploading:

  * `file.content_type` — a header the client writes. curl will put anything
    there.
  * `file.filename` — likewise, and the image endpoints went further and used
    it to pick the extension the file was STORED under.

So "is this a PDF?" was answered by asking the uploader. The public CV endpoint
asked with an `or` between the two, which meant satisfying either one was
enough: an executable named `resume.pdf` was accepted, stored, force-labelled
application/pdf and mailed to the hiring inbox as a download link.

The fix is to read the first few bytes and decide from those. A file's magic
number is the one thing about it the uploader cannot lie about while keeping the
file usable for its intended purpose.

WHAT THIS IS NOT

This is not virus scanning. A genuine, well-formed PDF carrying a malicious
payload passes every check in this file, because it IS a PDF. What this stops is
the much larger and cheaper class: the wrong KIND of file getting in, getting
stored under an extension of the attacker's choosing, and getting served back
under a content type that makes a browser execute it.

WHY IMAGES ARE A WHITELIST AND NOT AN SVG BLACKLIST

`.svg` was in the served-types map, and the image endpoints took the stored
extension straight from the uploaded filename. An SVG is an XML document, it may
contain <script>, and it was served back as image/svg+xml — stored XSS on the
API origin. Blacklisting "svg" would have left the same hole open to any other
executable text format that a browser is willing to render.

So `sniff_image` answers a different question: which of the raster formats we
actually serve is this, by signature? Anything it cannot name is refused, and
the extension a file is stored under is the one the SIGNATURE implies, never the
one the filename claimed. SVG fails that test by construction, and so does the
next format nobody has thought of yet.
"""
from __future__ import annotations

from fastapi import HTTPException, UploadFile

# 64 KB. Large enough that the loop is not the bottleneck on an 8 MB CV, small
# enough that the overshoot past the limit is negligible.
CHUNK = 64 * 1024

# A PDF's header should be at byte 0. In practice it is not always: some
# generators emit a BOM or a short preamble, and every real reader tolerates it,
# so refusing those would reject genuine CVs from people applying for a job.
# Adobe's own limit is 1024 bytes, which is what this matches — permissive
# enough for real files, far too tight to hide a working executable in front of.
PDF_HEADER_WINDOW = 1024
PDF_MAGIC = b"%PDF-"

# Signature → the extension we store it under. The extension is derived HERE and
# never from the filename, so a stored object's type is always something we
# recognised rather than something we were told.
_IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "jpg"),          # JPEG
    (b"\x89PNG\r\n\x1a\n", "png"),     # PNG
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
)

# ZIP-container and legacy-OLE office formats. Both are real signatures, but
# neither distinguishes a .docx from a .xlsx — that is what the declared MIME
# is for, once we know the container is genuine.
ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def is_pdf(data: bytes) -> bool:
    """True when this really is a PDF, not merely named like one."""
    return PDF_MAGIC in (data or b"")[:PDF_HEADER_WINDOW]


def sniff_image(data: bytes) -> str | None:
    """Return the extension for a recognised raster image, or None.

    None means refuse. It is deliberately not a fallback to "jpg": storing an
    unrecognised blob under an image extension is exactly how something that is
    not an image ends up being served as one.
    """
    head = (data or b"")[:32]
    for magic, ext in _IMAGE_SIGNATURES:
        if head.startswith(magic):
            return ext
    # RIFF containers carry the real format in bytes 8..12.
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    # ISO-BMFF (AVIF / HEIF): a `ftyp` box at offset 4, brand at 8.
    if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
        return "avif"
    return None


def is_zip_container(data: bytes) -> bool:
    """docx and xlsx are ZIP archives; so is a plain .zip."""
    return (data or b"").startswith(ZIP_MAGIC)


def is_ole_document(data: bytes) -> bool:
    """Legacy .doc / .xls — the pre-2007 OLE compound file."""
    return (data or b"").startswith(OLE_MAGIC)


async def read_limited(file: UploadFile, limit_bytes: int, label: str) -> bytes:
    """Read an upload, refusing it the moment it exceeds `limit_bytes`.

    WHY NOT `await file.read()` AND THEN CHECK len()

    That is what every one of these endpoints used to do, and it checks the size
    only once the whole thing is already a bytes object in memory. On a 512 MB
    Render instance a single 500 MB upload to an unauthenticated endpoint is an
    out-of-memory kill — the 8 MB limit rejects it a moment after the process
    has died.

    Reading in chunks bounds what is ever held to the limit plus one chunk.
    Starlette still spools the incoming body, but to a temporary file rather
    than to the heap, and we stop consuming it as soon as the count is exceeded.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"{label} too large (max {limit_bytes // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def require_pdf(data: bytes, label: str = "File") -> None:
    """Refuse anything that is not a real PDF."""
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} is empty")
    if not is_pdf(data):
        raise HTTPException(
            status_code=400,
            detail=f"{label} must be a real PDF — this file is named like one but is not one.",
        )


def require_image(data: bytes, label: str = "Image") -> str:
    """Refuse anything that is not a recognised raster image; return its extension.

    The returned extension is what the caller must store the object under.
    """
    if not data:
        raise HTTPException(status_code=400, detail=f"{label} is empty")
    ext = sniff_image(data)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{label} must be a JPEG, PNG, GIF, WebP, BMP or AVIF. "
                "SVG is not accepted — it is a script-capable document, not a picture."
            ),
        )
    return ext


# ===========================================================================
# ACTIVE CONTENT — what a genuine file can still carry
# ===========================================================================
#
# Everything above answers "is this really a PDF / an image / an Office file?".
# A genuine PDF can still run JavaScript or launch a program when opened, a
# genuine .docx can carry a macro or fetch a remote template, and a genuine ZIP
# can hold an .exe. These checks refuse those features. They are NOT an
# antivirus (they know no signatures); they remove the ways a document can DO
# something, which is how almost all document malware works. Signature scanning
# is a separate, optional layer: Amazon GuardDuty Malware Protection for S3
# tags each stored object, and the download paths honour that tag
# (features.scan_verdict).

import re as _re
import zipfile as _zipfile
import zlib as _zlib
from io import BytesIO as _BytesIO

# PDF names that make a document act rather than display. /OpenAction and /AA
# alone are common and harmless (open at page 1, zoom); they matter only when
# they point at one of these, so they are not listed.
PDF_ACTIVE = {
    "/JavaScript": "JavaScript",
    "/JS": "JavaScript",
    "/Launch": "a 'launch program' action",
    "/RichMedia": "embedded Flash/media",
    "/XFA": "an XFA form (can run scripts)",
    "/SubmitForm": "a form that sends data to a server",
    "/ImportData": "an import-data action",
}
_PDF_NAME_RE = _re.compile(rb"/[A-Za-z0-9#]+")
_PDF_STREAM_RE = _re.compile(rb"stream\r?\n(.*?)endstream", _re.S)
# Pictures and fonts are the bulk of a book's bytes and cannot hold PDF
# objects; their dictionaries say so just before "stream". Skipping them keeps
# a 60 MB eBook check to about a second on the 0.5-CPU server.
_PDF_SKIP_DICT = _re.compile(rb"/Subtype\s*/Image|/FontFile|/Length1|/Subtype\s*/(?:Type1C|CIDFontType0C|OpenType)")
_PDF_HEX_RE = _re.compile(rb"#([0-9A-Fa-f]{2})")
PDF_MAX_STREAMS = 20000                      # a CV has a few hundred
PDF_MAX_INFLATED = 400 * 1024 * 1024          # stop inflating past this (zip-bomb guard)


def _skippable(data: bytes, stream_at: int) -> bool:
    """True for a picture/font stream. The WHOLE dictionary of this object is
    read (back to its "obj" keyword), not a fixed window, and an object that is
    also marked as an object stream is never skipped — otherwise a padded
    dictionary claiming to be an image could hide objects from the check."""
    start = data.rfind(b" obj", max(0, stream_at - 4096), stream_at)
    if start < 0:
        return False
    head = data[start:stream_at]
    return bool(_PDF_SKIP_DICT.search(head)) and b"ObjStm" not in head and b"XRef" not in head


def _pdf_names(blob: bytes) -> set:
    # "/J#61vaScript" is "/JavaScript" with one letter hex-escaped — a classic
    # way past naive scanners. Names are decoded before they are compared.
    return {_PDF_HEX_RE.sub(lambda m: bytes([int(m.group(1), 16)]), n).decode("latin-1")
            for n in _PDF_NAME_RE.findall(blob)}


def pdf_threats(data: bytes, _depth: int = 0) -> dict:
    """What active content this PDF carries.

    Returns {"found": [human-readable reasons], "encrypted": bool}. Looks at
    the raw objects AND inside compressed streams, because PDF 1.5+ packs
    dictionaries into compressed object streams where a byte search of the
    file never sees them. pdfium (already used for previews) is asked as well:
    it decrypts a no-password file and counts document JavaScript and
    attachments the way a reader would see them.
    """
    found: set = set()
    names = _pdf_names(data)
    inflated = 0
    for i, m in enumerate(_PDF_STREAM_RE.finditer(data)):
        if i >= PDF_MAX_STREAMS:
            found.add("too many internal parts to check")
            break
        if _skippable(data, m.start()):
            continue
        raw = m.group(1)
        try:
            d = _zlib.decompressobj()
            out = d.decompress(raw, PDF_MAX_INFLATED - inflated)
        except _zlib.error:
            continue                          # not Flate (images etc.)
        inflated += len(out)
        names |= _pdf_names(out)
        if inflated >= PDF_MAX_INFLATED:
            found.add("an unusually large compressed section")
            break
    for key, why in PDF_ACTIVE.items():
        if key in names:
            found.add(why)
    encrypted = "/Encrypt" in names
    has_attachments = bool({"/EmbeddedFile", "/EmbeddedFiles", "/FileAttachment"} & names)
    attachments_checked = False
    try:
        import pypdfium2 as pdfium
        import pypdfium2.raw as pdfium_c
        doc = pdfium.PdfDocument(data)
        try:
            if pdfium_c.FPDFDoc_GetJavaScriptActionCount(doc.raw) > 0:
                found.add("JavaScript")
            # 2 = XFA full, 3 = XFA foreground
            if pdfium_c.FPDF_GetFormType(doc.raw) in (2, 3):
                found.add("an XFA form (can run scripts)")
            for i in range(doc.count_attachments()):
                a = doc.get_attachment(i)
                # get_data() is a ctypes buffer, not bytes.
                why = attachment_threat(a.get_name() or "", bytes(a.get_data()), _depth)
                if why:
                    found.add(why)
            attachments_checked = True
        finally:
            doc.close()
    except Exception:  # noqa: BLE001 — pdfium missing, or a PDF only it refuses
        pass
    if has_attachments and not attachments_checked:
        found.add("attached files that could not be checked")
    return {"found": sorted(found), "encrypted": encrypted}


# Attachments are normal in print PDFs: InDesign/Distiller embed their
# "Press Quality.joboptions" settings in every export (our own book previews
# carry six). What is refused is an attachment that can RUN — by name or by
# its first bytes, whatever it is called.
_ATTACH_EXEC_MAGIC = (b"MZ", b"\x7fELF", b"\xca\xfe\xba\xbe", b"\xcf\xfa\xed\xfe", b"#!", OLE_MAGIC)


def attachment_threat(name: str, blob: bytes, depth: int = 0) -> str:
    low = (name or "").lower().strip()
    ext = low.rsplit(".", 1)[-1] if "." in low else ""
    if ext in EXECUTABLE_EXTS or (blob or b"").startswith(_ATTACH_EXEC_MAGIC):
        return f"an attached program or macro document ({name[:60]})"
    if (blob or b"").startswith(ZIP_MAGIC):
        inner = zip_threats(blob, office=ext in ("docx", "xlsx", "pptx"))
        if inner:
            return f"an attached archive with {inner[0]} ({name[:60]})"
    if is_pdf(blob or b"") and depth < 2:
        inner = pdf_threats(blob, _depth=depth + 1)["found"]
        if inner:
            return f"an attached PDF with {inner[0]} ({name[:60]})"
    return ""


def require_safe_pdf(data: bytes, label: str = "File", *, allow_encrypted: bool = False) -> None:
    """A real PDF with nothing in it that can run. Raises 400 with a reason a
    person can act on (re-export / print to PDF)."""
    require_pdf(data, label)
    t = pdf_threats(data)
    if t["found"]:
        raise HTTPException(
            status_code=400,
            detail=(f"{label} contains {', '.join(t['found'])}, which we don't accept for safety. "
                    "Please save it again as a plain PDF (File → Print → Save as PDF) and upload that."),
        )
    if t["encrypted"] and not allow_encrypted:
        raise HTTPException(
            status_code=400,
            detail=f"{label} is password-protected or encrypted, so it can't be checked. Please upload it without protection.",
        )


# ---- ZIP / Office ----------------------------------------------------------
# Anything that runs when double-clicked on Windows/macOS/Android, or is a
# script a mail client or OS will execute.
EXECUTABLE_EXTS = {
    "exe", "dll", "scr", "com", "bat", "cmd", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "hta", "jar", "lnk", "pif", "cpl", "reg", "apk", "app", "dmg", "pkg", "sh", "iso",
    "img", "vhd", "vhdx", "msix", "appx", "scf", "url", "inf", "gadget", "docm", "xlsm", "pptm", "dotm",
    "xltm", "xlam", "ppam", "sys", "drv", "ocx",
}
ZIP_MAX_ENTRIES = 5000
ZIP_MAX_TOTAL = 500 * 1024 * 1024            # uncompressed
ZIP_MAX_RATIO = 200                          # a 1 MB file claiming 200 MB is a bomb
_VBA_MARK = "_VBA_PROJECT".encode("utf-16-le")
_MACROS_MARK = "Macros".encode("utf-16-le")


def zip_threats(data: bytes, *, office: bool = False) -> list:
    """Reasons to refuse this ZIP (or .docx/.xlsx, which are ZIPs)."""
    try:
        zf = _zipfile.ZipFile(_BytesIO(data))
        infos = zf.infolist()
    except (_zipfile.BadZipFile, ValueError, OSError):
        return ["it is not a readable ZIP/Office file"]
    found: list = []
    if len(infos) > ZIP_MAX_ENTRIES:
        found.append("too many files inside")
    total = sum(i.file_size for i in infos)
    if total > ZIP_MAX_TOTAL or (len(data) and total / len(data) > ZIP_MAX_RATIO and total > 50 * 1024 * 1024):
        found.append("it expands to an unreasonable size (possible zip bomb)")
    for i in infos:
        name = i.filename.replace("\\", "/")
        low = name.lower()
        if i.flag_bits & 0x1:
            found.append(f"a password-protected file ({name[:60]})")
        if ".." in name.split("/") or name.startswith("/"):
            found.append(f"an unsafe path ({name[:60]})")
        ext = low.rsplit(".", 1)[-1] if "." in low.rsplit("/", 1)[-1] else ""
        if ext in EXECUTABLE_EXTS:
            found.append(f"a program or script ({name[:60]})")
        if low.endswith("vbaproject.bin") or low.endswith("vbaprojectsignature.bin"):
            found.append("macros")
        if office and (low.startswith(("word/embeddings/", "xl/embeddings/", "ppt/embeddings/"))
                       and low.endswith(".bin")):
            found.append("an embedded object (can hide a program)")
        if office and "/activex/" in low:
            found.append("ActiveX controls")
    if office:
        try:
            ct = zf.read("[Content_Types].xml").decode("utf-8", "replace")
            if "macroEnabled" in ct or "vbaProject" in ct:
                found.append("macros")
        except KeyError:
            found.append("it is not a real Word/Excel file")
        # Remote template / external links: the document fetches something
        # from the internet when opened ("template injection").
        for i in infos:
            if i.filename.lower().endswith(".rels") and i.file_size < 2 * 1024 * 1024:
                rel = zf.read(i).decode("utf-8", "replace")
                if 'TargetMode="External"' in rel and re_external_bad(rel):
                    found.append("a link that loads content from the internet when opened")
                    break
    return sorted(set(found))


def re_external_bad(rels_xml: str) -> bool:
    """External relationships that LOAD something (templates, OLE objects,
    frames) rather than ordinary clickable hyperlinks, which are fine."""
    for m in _re.finditer(r"<Relationship\b[^>]*>", rels_xml):
        tag = m.group(0)
        if 'TargetMode="External"' in tag and not _re.search(r'Type="[^"]*/hyperlink"', tag):
            return True
    return False


def ole_threats(data: bytes) -> list:
    """Legacy .doc/.xls: a macro project is stored as a stream whose name
    (UTF-16 in the directory) is _VBA_PROJECT or a 'Macros' storage."""
    if _VBA_MARK in data or _MACROS_MARK in data:
        return ["macros"]
    return []


def require_safe_archive(data: bytes, label: str = "File", *, office: bool = False) -> None:
    found = zip_threats(data, office=office)
    if found:
        raise HTTPException(status_code=400, detail=f"{label} was refused: it contains {', '.join(found)}.")


def require_safe_ole(data: bytes, label: str = "File") -> None:
    found = ole_threats(data)
    if found:
        raise HTTPException(
            status_code=400,
            detail=f"{label} contains macros, which we don't accept. Save it as .docx/.xlsx (macro-free) and upload that.")


def require_not_zip_bomb(data: bytes, label: str = "File") -> None:
    """For spreadsheets we only READ (imports): macros never run on the server,
    so only the size checks apply — a tiny .xlsx that inflates to gigabytes
    would take the 512 MB API down inside openpyxl."""
    if not is_zip_container(data):
        return
    bad = [r for r in zip_threats(data) if "zip bomb" in r or "too many files" in r or "unsafe path" in r]
    if bad:
        raise HTTPException(status_code=400, detail=f"{label} was refused: {', '.join(bad)}.")
