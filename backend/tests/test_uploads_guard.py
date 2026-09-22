"""
The upload guard: what a file IS, not what it claims to be.

    python backend/tests/test_uploads_guard.py
    (or: pytest backend/tests/test_uploads_guard.py)

Real unit tests. uploads_guard imports nothing from the app — no Mongo, no
settings, only fastapi for HTTPException — so the checks that decide whether a
stranger's file is accepted can be exercised directly.

THE ONE THAT MATTERS

test_the_original_bug reproduces what was actually accepted before: an
executable named resume.pdf, sent with content_type application/pdf, to the
public careers endpoint. Both of those values are written by the uploader, and
the old check accepted EITHER of them, so the file was stored, force-labelled
application/pdf, and mailed to the hiring inbox as a download button.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import uploads_guard as ug  # noqa: E402
from fastapi import HTTPException  # noqa: E402


# Real leading bytes for each format.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 28
GIF = b"GIF89a" + b"\x00" * 26
WEBP = b"RIFF" + b"\x24\x00\x00\x00" + b"WEBP" + b"\x00" * 20
BMP = b"BM" + b"\x00" * 30
AVIF = b"\x00\x00\x00\x20" + b"ftyp" + b"avif" + b"\x00" * 20
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n" + b"\x00" * 16
ZIP = b"PK\x03\x04" + b"\x00" * 28
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 24

# A Windows executable. This is the thing that used to get through.
EXE = b"MZ\x90\x00\x03" + b"\x00" * 27

# An SVG with a script in it — a valid image as far as a browser is concerned,
# which is exactly the problem.
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def _raises(fn, *args):
    try:
        fn(*args)
    except HTTPException as exc:
        return exc
    return None


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

def test_a_real_pdf_passes():
    assert ug.is_pdf(PDF)
    assert ug.require_pdf(PDF, "CV") is None


def test_the_original_bug():
    """An executable named resume.pdf, declared application/pdf.

    Both of those are attacker-chosen strings, and the old check was an `or`
    between them. Neither is consulted here.
    """
    assert not ug.is_pdf(EXE)
    exc = _raises(ug.require_pdf, EXE, "CV")
    assert exc is not None and exc.status_code == 400


def test_a_pdf_with_a_short_preamble_still_passes():
    """Some generators emit a BOM or a few junk bytes before %PDF-, and every
    real reader tolerates it. Refusing those would reject genuine CVs from
    people applying for a job."""
    assert ug.is_pdf(b"\xef\xbb\xbf" + PDF)


def test_the_preamble_window_is_not_unlimited():
    """Far too tight to hide a working executable in front of."""
    assert not ug.is_pdf(b"\x00" * (ug.PDF_HEADER_WINDOW + 10) + PDF)


def test_empty_is_refused_before_anything_else():
    exc = _raises(ug.require_pdf, b"", "CV")
    assert exc is not None and "empty" in exc.detail.lower()


def test_an_html_file_named_pdf_is_refused():
    assert not ug.is_pdf(b"<!DOCTYPE html><html><body>hello</body></html>")


# --------------------------------------------------------------------------
# Images — whitelist by signature
# --------------------------------------------------------------------------

def test_every_format_we_serve_is_recognised():
    assert ug.sniff_image(PNG) == "png"
    assert ug.sniff_image(JPEG) == "jpg"
    assert ug.sniff_image(GIF) == "gif"
    assert ug.sniff_image(WEBP) == "webp"
    assert ug.sniff_image(BMP) == "bmp"
    assert ug.sniff_image(AVIF) == "avif"


def test_svg_is_not_an_image():
    """THE STORED-XSS ONE.

    An SVG is an XML document that may contain <script>, and it used to be
    accepted (content_type image/svg+xml passes startswith("image/")), stored
    under the extension from its own filename, and served back as
    image/svg+xml.
    """
    assert ug.sniff_image(SVG) is None
    exc = _raises(ug.require_image, SVG, "Cover image")
    assert exc is not None and "SVG" in exc.detail


def test_an_unknown_blob_is_refused_rather_than_defaulted():
    """Not "jpg". Storing an unrecognised blob under an image extension is how
    something that is not an image ends up being served as one."""
    assert ug.sniff_image(EXE) is None
    assert _raises(ug.require_image, EXE, "Image") is not None


def test_the_extension_comes_from_the_signature():
    """A PNG uploaded as `portrait.jpg.svg` is stored as .png, because nothing
    in the filename is consulted at all — require_image never sees it."""
    assert ug.require_image(PNG, "Photo") == "png"


def test_a_truncated_header_does_not_crash():
    assert ug.sniff_image(b"") is None
    assert ug.sniff_image(b"\x89PN") is None
    assert not ug.is_pdf(b"%PD")


def test_riff_that_is_not_webp_is_refused():
    """A WAV file is also a RIFF container."""
    assert ug.sniff_image(b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE" + b"\x00" * 20) is None


# --------------------------------------------------------------------------
# Office / archive containers
# --------------------------------------------------------------------------

def test_zip_and_ole_containers():
    assert ug.is_zip_container(ZIP)
    assert not ug.is_zip_container(OLE)
    assert ug.is_ole_document(OLE)
    assert not ug.is_ole_document(ZIP)
    assert not ug.is_zip_container(EXE)
    assert not ug.is_ole_document(EXE)


# --------------------------------------------------------------------------
# read_limited
# --------------------------------------------------------------------------

class _FakeUpload:
    """Minimal stand-in for UploadFile: hands back the body in chunks."""

    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0
        self.reads = 0

    async def read(self, size: int = -1) -> bytes:
        self.reads += 1
        if size is None or size < 0:
            chunk, self._pos = self._data[self._pos:], len(self._data)
            return chunk
        chunk = self._data[self._pos:self._pos + size]
        self._pos += len(chunk)
        return chunk


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_file_under_the_limit_comes_back_whole():
    up = _FakeUpload(PDF)
    assert _run(ug.read_limited(up, 1024, "CV")) == PDF


def test_a_file_over_the_limit_is_refused():
    up = _FakeUpload(b"x" * 5000)
    exc = None
    try:
        _run(ug.read_limited(up, 1000, "CV"))
    except HTTPException as e:
        exc = e
    assert exc is not None and "too large" in exc.detail


def test_it_stops_reading_instead_of_buffering_the_whole_body():
    """THE OUT-OF-MEMORY ONE.

    Every endpoint used to do `await file.read()` and check len() afterwards —
    so a 500 MB body was fully materialised on a 512 MB instance before the
    8 MB limit rejected it. The process dies first.

    Asserted by counting reads: a 10 MB body with a 1 MB cap must be abandoned
    after ~17 chunks of 64 KB, not read to the end (160 chunks).
    """
    up = _FakeUpload(b"x" * (10 * 1024 * 1024))
    try:
        _run(ug.read_limited(up, 1024 * 1024, "CV"))
    except HTTPException:
        pass
    assert up.reads < 20, f"read {up.reads} chunks — it is draining the whole body"


def test_the_limit_is_reported_in_megabytes():
    up = _FakeUpload(b"x" * (9 * 1024 * 1024))
    try:
        _run(ug.read_limited(up, 8 * 1024 * 1024, "CV"))
    except HTTPException as e:
        assert "8 MB" in e.detail


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {name}: {exc or 'assertion failed'}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"ERROR {name}: {type(exc).__name__}: {exc}")
        else:
            print(f"ok    {name}")
    print()
    if failures:
        print(f"{failures} test(s) failed")
        raise SystemExit(1)
    print("all tests passed")
