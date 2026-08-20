"""
Image URLs in outgoing email.

    python backend/tests/test_email_media.py

The bug this guards: covers are stored as "/api/files/…", a path the browser
resolves against whatever page it is on. An email has no such context, so a
relative src is not a URL at all to a mail client and every cover arrived as a
broken-image icon — in the cart reminders, which exist specifically to make
somebody want the book again.

The second trap is subtler. The obvious fix is to prefix SITE_URL, and it
looks like it works: the URL is absolute, it loads, no error anywhere. But
Vercel rewrites every path except /sitemap.xml to the SPA shell, so
https://www.oakbridge.in/api/files/x.jpg returns HTML with a 200. Same broken
image, and now with a plausible-looking URL behind it.
"""
import ast
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMAILER = os.path.join(BACKEND, "emailer.py")

# Pull just the function and the constant it reads, so this runs without the
# email provider, the database or any of emailer.py's imports.
ns = {"os": os}
tree = ast.parse(open(EMAILER, encoding="utf-8").read())
for node in tree.body:
    if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "PUBLIC_API_URL":
        exec(compile(ast.Module([node], []), EMAILER, "exec"), ns)
    if isinstance(node, ast.FunctionDef) and node.name == "media_url":
        exec(compile(ast.Module([node], []), EMAILER, "exec"), ns)

media_url = ns["media_url"]
API = ns["PUBLIC_API_URL"]

fail = 0


def eq(name, got, want):
    global fail
    ok = got == want
    if not ok:
        fail += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r} want {want!r}"))


print("-- the actual bug --")
eq("an uploaded cover becomes absolute",
   media_url("/api/files/oakbridge/covers/9788199624542.jpg"),
   f"{API}/api/files/oakbridge/covers/9788199624542.jpg")
eq("and points at the API host, not the website", media_url("/api/files/x.jpg").startswith(API), True)
eq("the website would have served HTML for that path",
   "oakbridge.in" in API and "api." in API, True)

print("\n-- everything else is left alone --")
eq("an Unsplash cover is untouched",
   media_url("https://images.unsplash.com/photo-1?w=800"),
   "https://images.unsplash.com/photo-1?w=800")
eq("http is untouched too", media_url("http://example.com/a.jpg"), "http://example.com/a.jpg")

print("\n-- nothing is invented --")
eq("empty stays empty", media_url(""), "")
eq("None stays empty", media_url(None), "")
eq("whitespace stays empty", media_url("   "), "")
eq("a bare filename is refused rather than guessed at", media_url("cover.jpg"), "")
eq("a relative path with no leading slash is refused", media_url("files/cover.jpg"), "")

print("\n-- no double slashes, whatever the env --")
eq("the base never ends in a slash", API.endswith("/"), False)
eq("joined URL has exactly one slash", media_url("/api/files/x.jpg").count("//"), 1)

print("\n" + (f"{fail} FAILED" if fail else "all assertions passed"))
sys.exit(1 if fail else 0)
