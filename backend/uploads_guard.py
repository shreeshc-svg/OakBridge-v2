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
