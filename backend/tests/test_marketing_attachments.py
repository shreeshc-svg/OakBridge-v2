"""Marketing email attachments: what is accepted (by content), the 10 MB / 10
file limits, the MIME structure, and the upload/remove/lock endpoints on the
fake DB.

Run: python backend/tests/test_marketing_attachments.py
"""
import asyncio
import ast
import email
import io
import os
import sys
import types
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(str(detail))
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: (lambda fn: fn)


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


def _noop(*a, **k):
    return None


async def _anoop(*a, **k):
    return None


if "fastapi" not in sys.modules:
    _mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=_noop, File=_noop, Form=_noop,
         UploadFile=object, Header=_noop)
db = DB()
STORE = {}
_mod("extensions", db=db, require_admin=_noop, require_superadmin=_noop)
_mod("audit", audit_log=_anoop)
_mod("features", APP_NAME="oakbridge", put_object=lambda p, d, t: STORE.__setitem__(p, d),
     get_object=lambda p: (STORE[p], "x") if p in STORE else (_ for _ in ()).throw(HTTPException(404, "File not found")))

import marketing_attach_core as c  # noqa: E402
import marketing_attachments as ma  # noqa: E402


def ooxml(ct="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", extra=None):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("[Content_Types].xml", f'<Types><Override ContentType="{ct}"/></Types>')
        z.writestr("word/document.xml", "<w:document/>")
        for n, d in (extra or {}).items():
            z.writestr(n, d)
    return b.getvalue()


def refused(name, data):
    try:
        c.classify(name, data)
        return ""
    except c.Refused as e:
        return str(e)


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40

# --- accepted, by content
check(c.classify("Catalogue 2026.pdf", PDF) == ("pdf", "application/pdf"), "PDF")
check(c.classify("price list.xlsx", ooxml("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"))[0] == "xlsx", "xlsx")
check(c.classify("letter.docx", ooxml())[0] == "docx", "docx")
check(c.classify("list.csv", "Title,Price\nपुस्तक,485\n".encode("utf-8"))[0] == "csv", "CSV (UTF-8, Hindi)")
check(c.classify("cover.JPG", PNG) == ("png", "image/png"), "image stored as what it really is")

# --- refused
check("not a PDF" in refused("invoice.pdf", b"MZ\x90\x00 this is a program"), "renamed program as .pdf")
check("Programs" in refused("setup.exe", b"MZ"), ".exe")
check("Programs" in refused("report.docm", ooxml()), ".docm by name")
check("macros" in refused("report.docx", ooxml(extra={"word/vbaProject.bin": b"x"})), "macros inside a .docx")
check("macros" in refused("report.docx", ooxml(ct="application/vnd.ms-word.document.macroEnabled.main+xml")), "macro-enabled content type")
check("Drive" in refused("books.zip", ooxml()), "zip -> use a Drive link")
check("YouTube" in refused("launch.mp4", b"\x00\x00\x00\x18ftypmp42"), "video -> use a YouTube/Drive link")
check("not a text CSV" in refused("data.csv", PDF), "PDF renamed .csv")
check("not a real" in refused("sheet.xlsx", PDF), "PDF renamed .xlsx")
check("empty" in refused("x.pdf", b""), "empty file")
check("Attach PDF" in refused("notes.txt", b"hello"), "other types")

# --- names and limits
check(c.safe_name('..\\..\\evil"<x>.pdf') == "evil.pdf" or c.safe_name('..\\..\\evil"<x>.pdf') == "evilx.pdf", "path and quote characters stripped")
check(len(c.safe_name("a" * 300 + ".pdf")) == 100 and c.safe_name("a" * 300 + ".pdf").endswith(".pdf"), "long name cut, extension kept")
try:
    c.check_room([{"size": 9 * 1048576}], 2 * 1048576)
    check(False, "10 MB total enforced")
except c.Refused:
    check(True, "10 MB total enforced")
try:
    c.check_room([{"size": 1}] * 10, 1)
    check(False, "10 files enforced")
except c.Refused:
    check(True, "10 files enforced")

# --- MIME structure (marketing.build_mime lifted out with ast)
SRC = open(os.path.join(ROOT, "marketing.py"), encoding="utf-8").read()
fn = next(n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name == "build_mime")
from email.mime.multipart import MIMEMultipart  # noqa: E402
from email.mime.text import MIMEText  # noqa: E402
from email.utils import formataddr, make_msgid  # noqa: E402
from typing import Optional  # noqa: E402
ns = {"MIMEMultipart": MIMEMultipart, "MIMEText": MIMEText, "formataddr": formataddr, "make_msgid": make_msgid, "Optional": Optional}
exec(compile(ast.Module([fn], []), "build_mime", "exec"), ns)
ST = {"from_name": "Oakbridge", "from_email": "news@oakbridge.in"}
plain = email.message_from_bytes(ns["build_mime"](st=ST, to="a@b.in", subject="S", html_doc="<p>h</p>", text_doc="t", unsub_post="https://u"))
check(plain.get_content_type() == "multipart/alternative" and plain["List-Unsubscribe"], "no attachments: unchanged message")
m = email.message_from_bytes(ns["build_mime"](st=ST, to="a@b.in", subject="S", html_doc="<p>h</p>", text_doc="t", unsub_post="https://u",
                                              attachments=[("Catalogue.pdf", "application/pdf", PDF), ("सूची.csv", "text/csv", b"a,b\n")]))
parts = m.get_payload()
check(m.get_content_type() == "multipart/mixed" and parts[0].get_content_type() == "multipart/alternative", "with attachments: mixed[alternative, files]")
check(parts[1].get_filename() == "Catalogue.pdf" and parts[1].get_payload(decode=True) == PDF, "PDF attached byte-for-byte")
check(parts[2].get_filename() == "सूची.csv", "Unicode filename survives (RFC 2231)")
check(m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click", "one-click unsubscribe kept with attachments")


# --- endpoints on the fake DB
class Up:
    def __init__(self, name, data):
        self.filename, self._b = name, io.BytesIO(data)

    async def read(self, n=-1):
        return self._b.read(n)


async def flow():
    await db.mk_campaigns.insert_one({"id": "c1", "status": "draft", "channel": "email"})
    await db.mk_campaigns.insert_one({"id": "w1", "status": "draft", "channel": "whatsapp"})
    U = {"email": "mk@oakbridge.in", "role": "admin"}
    r = await ma.add_attachment("c1", Up("Catalogue.pdf", PDF), U)
    check(len(r["attachments"]) == 1 and "path" not in r["attachments"][0], "upload: listed, storage path not exposed")
    path = (await db.mk_campaigns.find_one({"id": "c1"}))["attachments"][0]["path"]
    check(path.startswith("oakbridge/mk-attach/") and path in STORE, "stored privately under mk-attach/")
    try:
        await ma.add_attachment("c1", Up("x.exe", b"MZ"), U)
        check(False, "bad file -> 400")
    except HTTPException as e:
        check(e.status_code == 400, "bad file -> 400")
    try:
        await ma.add_attachment("w1", Up("a.pdf", PDF), U)
        check(False, "WhatsApp campaign refused")
    except HTTPException as e:
        check(e.status_code == 400, "WhatsApp campaign refused")
    files = await ma.load(await db.mk_campaigns.find_one({"id": "c1"}))
    check(files == [("Catalogue.pdf", "application/pdf", PDF)], "load() returns the file for sending")
    aid = r["attachments"][0]["id"]
    db.mk_campaigns.docs[0]["status"] = "sending"
    try:
        await ma.remove_attachment("c1", aid, U)
        check(False, "locked while sending")
    except HTTPException as e:
        check(e.status_code == 409, "locked while sending")
    db.mk_campaigns.docs[0]["status"] = "draft"
    r = await ma.remove_attachment("c1", aid, U)
    check(r["attachments"] == [] and path in STORE, "remove unlinks; stored file kept (duplicates may share it)")
    STORE.clear()
    await db.mk_campaigns.update_one({"id": "c1"}, {"$set": {"attachments": [{"name": "a.pdf", "mime": "application/pdf", "path": "gone"}]}})
    try:
        await ma.load(await db.mk_campaigns.find_one({"id": "c1"}))
        check(False, "missing stored file raises (campaign pauses rather than sending without it)")
    except HTTPException:
        check(True, "missing stored file raises (campaign pauses rather than sending without it)")

asyncio.run(flow())

mk = "\n".join(l for l in SRC.splitlines() if not l.strip().startswith("#"))
check("attachments=files)" in mk and '"status": "paused"' in mk.split("marketing_attachments.load(camp)")[1][:600],
      "send run: files loaded once, missing file pauses the campaign")
check('"wa_variables", "attachments")' in mk, "duplicate keeps the attachments")
feat = open(os.path.join(ROOT, "features.py"), encoding="utf-8").read()
check('"mk-attach"' in feat.split("_PRIVATE_SEGMENTS = ")[1].split("\n")[0], "/api/files never serves mk-attach/")
check("marketing_attachments_router" in open(os.path.join(ROOT, "server.py"), encoding="utf-8").read(), "router included")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
