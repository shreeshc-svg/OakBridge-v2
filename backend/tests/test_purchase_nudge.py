"""
The first-order nudge: covers, opt-out tokens, and content types.

    python backend/tests/test_purchase_nudge.py

No DB and no server. The pieces under test are pure functions, pulled out with
ast so importing emailer (and with it resend, motor and a Mongo connection) is
not required — same trick as test_author_match.py.

The bias of this file is toward the two things that are invisible until a real
person opens a real email: whether the cover renders, and whether the
unsubscribe link works. Both fail silently in production.
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-production")

failures = []


def check(cond, label):
    print(("ok   " if cond else "FAIL "), label)
    if not cond:
        failures.append(label)


def extract(filename, wanted, ns=None):
    tree = ast.parse(open(os.path.join(BACKEND, filename), encoding="utf-8").read())
    body = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted:
            body.append(node)
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in wanted for t in node.targets
        ):
            body.append(node)
    scope = dict(ns or {})
    scope.setdefault("os", os)
    scope.setdefault("re", re)
    exec(compile(ast.Module(body=body, type_ignores=[]), f"<{filename}>", "exec"), scope)
    missing = wanted - set(scope)
    assert not missing, f"could not extract {missing} from {filename}"
    return scope


# --------------------------------------------------------------------------
print("-- covers: the content type S3 hands back --")
# A cover uploaded without an explicit ContentType is stored as octet-stream.
# A browser sniffs past that and shows the image, so the site looks fine; Gmail's
# image proxy refuses it and shows a grey box. This is the failure that only
# appears in the inbox.
ft = extract("features.py", {"_resolved_type", "_GENERIC_TYPES", "_IMAGE_TYPES"})
rt = ft["_resolved_type"]

for declared in ("application/octet-stream", "binary/octet-stream", "",
                 "APPLICATION/OCTET-STREAM", "application/octet-stream; charset=binary"):
    check(rt(declared, "oakbridge/covers/9788199888159.jpg") == "image/jpeg",
          f"a .jpg declared {declared!r} is served as image/jpeg")
check(rt("application/octet-stream", "c/x.webp") == "image/webp",
      "a .webp too — this runtime's mimetypes does not know webp, hence the explicit map")
check(rt("application/octet-stream", "c/x.PNG") == "image/png", "extension match is case-insensitive")
check(rt("image/png", "c/mislabelled.jpg") == "image/png",
      "a real declared type is trusted over the extension")
check(rt("application/pdf", "i/invoice.pdf") == "application/pdf",
      "invoices are left alone")
check(rt("application/octet-stream", "m/noextension") == "application/octet-stream",
      "with nothing to go on, the generic type stands rather than a guess")
check(all(v.startswith("image/") for v in ft["_IMAGE_TYPES"].values()),
      "every entry in the image map is an image type")
# Testing _resolved_type alone proves nothing if get_object never calls it —
# reverting the call site left every assertion above still passing.
_feat_src = open(os.path.join(BACKEND, "features.py"), encoding="utf-8").read()
_get_obj = re.search(r"def get_object.*?(?=\n\n# =|\nclass |\ndef )", _feat_src, re.S).group(0)
check("_resolved_type" in _get_obj,
      "get_object actually routes S3's ContentType through _resolved_type")
check('"application/octet-stream"' not in _get_obj.split("_s3_enabled")[1].split("full =")[0],
      "and does not hand the raw generic type straight back")

# --------------------------------------------------------------------------
print("\n-- covers: the URL that goes in the <img> --")
em = extract("emailer.py", {"media_url", "PUBLIC_API_URL"})
media_url = em["media_url"]
check(media_url("/api/files/oakbridge/covers/x.jpg")
      == "https://api.oakbridge.in/api/files/oakbridge/covers/x.jpg",
      "a stored path becomes absolute on the API host")
check(not media_url("/api/files/x.jpg").startswith("https://www.oakbridge.in"),
      "NOT the www host — Vercel rewrites /api/* to the SPA shell, so that returns HTML")
check(media_url("https://images.unsplash.com/photo-1.jpg") == "https://images.unsplash.com/photo-1.jpg",
      "an already-absolute cover is left alone")
check(media_url("") == "" and media_url(None) == "", "nothing in, nothing out")
check(media_url("cover.jpg") == "", "a bare filename resolves to nothing, not to a wrong guess")

# --------------------------------------------------------------------------
print("\n-- covers: the rendered markup --")
render = extract(
    "emailer.py",
    {"_nudge_book_row", "render_purchase_nudge_html", "_money", "media_url",
     "PUBLIC_API_URL", "SITE_URL", "BRAND_NAVY", "BRAND_RED", "BRAND_AMBER",
     "BRAND_GREY", "_NUDGE_PREHEADER"},
    # emailer.py has `from __future__ import annotations`, so these are strings
    # in the real module; the extracted AST has no such import, so the
    # annotations get evaluated here and Optional has to actually exist.
    ns={"_html": __import__("html"), "Optional": __import__("typing").Optional},
)
row = render["_nudge_book_row"]
BOOK = {"id": "abc-123", "title": "Climate Justice", "author": "Sudhir Mishra",
        "price": 476.0, "original_price": 595.0,
        "cover_image": "/api/files/oakbridge/covers/9788199624559.jpg"}
html_row = row(BOOK)
check("https://api.oakbridge.in/api/files/oakbridge/covers/9788199624559.jpg" in html_row,
      "the cover src is the absolute API URL")
check('width="72"' in html_row,
      "width is an ATTRIBUTE — Outlook ignores the CSS one and blows the layout out")
check('border="0"' in html_row,
      "border=0 — Outlook draws a blue frame around a linked image without it")
check("display:block" in html_row, "display:block kills the gap under the image")
check('alt="Climate Justice"' in html_row,
      "alt carries the title, because images are off by default in Outlook and for unknown senders")
check("20% off" in html_row and "595" in html_row, "the discount is computed, not hardcoded")

noc = row({**BOOK, "cover_image": ""})
check("<img" not in noc,
      "no cover means NO <img> — an empty src renders as a torn-page icon in every client")
check("Climate Justice" in noc, "the placeholder still names the book")

check("<img" not in row({**BOOK, "cover_image": "cover.jpg"}),
      "an unresolvable cover also falls back rather than emitting a broken src")

xss = row({**BOOK, "title": '<script>alert(1)</script>', "author": '" onerror="x'})
check("<script>" not in xss and 'onerror="x' not in xss,
      "a title from the catalogue cannot inject markup into the email")

# --------------------------------------------------------------------------
print("\n-- the whole email --")
doc = render["render_purchase_nudge_html"](
    "Rahul Kumar", [BOOK, {**BOOK, "id": "b2", "title": "In-House Matters"}],
    {"code": "FIRSTREAD10", "description": "10% off"},
    "https://api.oakbridge.in/api/email/unsubscribe?token=t.s",
)
check("Rahul" in doc and "Kumar" not in doc.split("shelf is still empty")[0][-40:],
      "greets by first name only")
check(doc.count("<img") == 2, "one image per title, and no tracking pixel we did not ask for")
check("unsubscribe?token=t.s" in doc, "the unsubscribe link is in the body")
check("FIRSTREAD10" in doc, "the coupon block renders when a coupon is passed")
check("FIRSTREAD10" not in render["render_purchase_nudge_html"]("A", [BOOK], None, "u"),
      "and disappears entirely when it is not")
check(render["_NUDGE_PREHEADER"] in doc, "the preheader is present for the inbox preview line")
check(len(doc.encode()) < 102_000,
      f"under Gmail's 102KB clip threshold ({len(doc.encode())} bytes)")
check(doc.count("<table") == doc.count("</table>") and doc.count("<tr") == doc.count("</tr>"),
      "tables are balanced — an unclosed one collapses the layout in Outlook")
check("’" not in doc or 'charset="utf-8"' in doc, "utf-8 declared if smart punctuation is used")

nolink = render["render_purchase_nudge_html"]("A", [BOOK], None, "")
check("Unsubscribe" not in nolink,
      "with no signable token the footer shows no dead unsubscribe link")

# --------------------------------------------------------------------------
print("\n-- opt-out tokens --")
tok_ns = extract(
    "emailer.py",
    {"unsubscribe_token", "email_from_unsubscribe_token", "_unsub_secret",
     "unsubscribe_url", "_unsub_headers", "_UNSUB_MAILTO", "PUBLIC_API_URL"},
)
mk, read = tok_ns["unsubscribe_token"], tok_ns["email_from_unsubscribe_token"]
addr = "Rahul.Kumar+news@Gmail.com"
tok = mk(addr)
check(read(tok) == "rahul.kumar+news@gmail.com", "a token round trips to its address")
check(mk(addr) == mk(addr.upper()), "case does not change the token")
flip = tok[:-1] + ("0" if tok[-1] != "0" else "1")
check(read(flip) == "", "a tampered signature is rejected")
other = mk("victim@example.com")
check(read(other.split(".")[0] + "." + tok.split(".")[1]) == "",
      "another address cannot be smuggled in under a valid signature")
for bad in ("", "abc", "a.b", "....", "%%%.%%%", None, "." * 200):
    check(read(bad) == "", f"malformed token {str(bad)[:12]!r} rejected")
check("compare_digest" in open(os.path.join(BACKEND, "emailer.py"), encoding="utf-8").read(),
      "signatures compared in constant time, not with ==")

h = tok_ns["_unsub_headers"](addr)
check("List-Unsubscribe" in h, "List-Unsubscribe header set")
check(h.get("List-Unsubscribe-Post") == "List-Unsubscribe=One-Click",
      "one-click POST advertised — Gmail and Yahoo require it of bulk senders")
check(h["List-Unsubscribe"].startswith("<https://"), "the header URL is bracketed and absolute")

os.environ["JWT_SECRET"] = ""
check(mk(addr) == "" and tok_ns["unsubscribe_url"](addr) == "" and tok_ns["_unsub_headers"](addr) == {},
      "no secret means no token, no link and no headers")
os.environ["JWT_SECRET"] = "test-secret-do-not-use-in-production"

# --------------------------------------------------------------------------
print("\n-- the rules that keep this from becoming spam --")
src = open(os.path.join(BACKEND, "emailer.py"), encoding="utf-8").read()
feat = open(os.path.join(BACKEND, "features.py"), encoding="utf-8").read()
rbac = open(os.path.join(BACKEND, "rbac.py"), encoding="utf-8").read()

send = re.search(r"async def send_purchase_nudge.*?(?=\n\n\S|\Z)", src, re.S).group(0)
check("if not unsub" in send and "return False" in send,
      "send_purchase_nudge REFUSES to send when no unsubscribe link can be signed")
check("headers=_unsub_headers" in send, "and always attaches the List-Unsubscribe headers")

check('"send-purchase-nudge"' in rbac, "the endpoint is superadmin-only")

sel = re.search(r"async def _nudge_recipients.*?(?=\nclass |\n@|\Z)", feat, re.S).group(0)
for needle, why in [
    ("opted", "unsubscribed people are excluded"),
    ("buyers", "people who already ordered are excluded"),
    ("carted", "people with a live cart are excluded — the cart reminder owns them"),
    ("last_nudged_at", "people nudged recently are excluded"),
]:
    check(needle in sel, why)
check("db.carts.find" in feat and '"user_id": 1' in feat,
      "the cart exclusion reads user_id — carts are keyed by user, not email, and "
      "an email query here would match nothing and double-mail everyone")
# The set is built from user_id, so it must be COMPARED against a user id too.
# Comparing the normalised email against it is the silent version of this bug:
# the set is populated, the check just never matches.
check(re.search(r'elif u\.get\("id"\) in carted:', sel),
      "and compares a user id against it, not an email key")

books = re.search(r"async def _nudge_books.*?(?=\nasync def |\nclass |\Z)", feat, re.S).group(0)
check('"coming_soon": {"$ne": True}' in books,
      "coming-soon titles are excluded — they cannot be bought yet")
check('"stock": {"$gt": 0}' in books, "out-of-stock titles are excluded")
check("cover_image" in books, "titles with a cover are preferred, since the cover is the point")

ep = re.search(r"async def admin_send_purchase_nudge.*?(?=\nasync def |\Z)", feat, re.S).group(0)
check("if not payload.confirm" in ep and "dry_run" in ep,
      "nothing sends without confirm=true")
check("last_nudged_at" in ep and ep.index("update_one") > ep.index("send_purchase_nudge"),
      "each recipient is stamped as sent, so a crash cannot re-mail them")

check('@public_router.get("/email/unsubscribe")' in feat,
      "the unsubscribe endpoint exists on the PUBLIC router — a mail client has no session")
check('@public_router.post("/email/unsubscribe")' in feat,
      "and accepts POST, which one-click unsubscribe requires")
check("/api/email/unsubscribe" in src,
      "and emailer builds its link against that same path")
check("email_key" in feat and "normalise_email" in feat,
      "opt-out is keyed on the normalised inbox, so a +tag alias cannot be mailed anyway")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
