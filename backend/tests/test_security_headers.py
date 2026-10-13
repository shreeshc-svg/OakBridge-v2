"""Browser security headers on API responses (backend/security_headers.py).

Runs the real ASGI middleware around tiny fake apps — no FastAPI needed.

Run: python backend/tests/test_security_headers.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from security_headers import SecurityHeadersMiddleware  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def app_with(content_type, extra=()):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", content_type.encode())] + list(extra)})
        await send({"type": "http.response.body", "body": b"x"})
    return app


def run(path, content_type, extra=()):
    sent = []

    async def send(m):
        sent.append(m)

    async def receive():
        return {"type": "http.request"}

    asyncio.run(SecurityHeadersMiddleware(app_with(content_type, extra))({"type": "http", "path": path}, receive, send))
    return {k.decode(): v.decode() for k, v in sent[0]["headers"]}


h = run("/api/books", "application/json")
check(h["x-content-type-options"] == "nosniff", "JSON: nosniff")
check(h["content-security-policy"].startswith("default-src 'none'") and "frame-ancestors 'none'" in h["content-security-policy"],
      "JSON: nothing may load or run, no framing")
check(h["x-frame-options"] == "DENY" and "strict-transport-security" in h and "referrer-policy" in h, "JSON: frame/HSTS/referrer")

h = run("/api/files/oakbridge/covers/x.png", "image/png")
check("default-src 'none'" in h["content-security-policy"] and h["x-content-type-options"] == "nosniff",
      "an uploaded image can never be run as a page")

h = run("/api/files/oakbridge/docs/brochure.pdf", "application/pdf")
check("content-security-policy" not in h and "x-frame-options" not in h and h["x-content-type-options"] == "nosniff",
      "PDFs: no CSP/frame ban (browsers refuse to show a sandboxed PDF), but still nosniff")

h = run("/api/unsubscribe", "text/html; charset=utf-8")
check("style-src 'unsafe-inline'" in h["content-security-policy"] and "script-src" not in h["content-security-policy"],
      "HTML pages: their inline styles work, scripts never")

h = run("/api/x", "application/json", extra=[(b"x-frame-options", b"SAMEORIGIN")])
check(h["x-frame-options"] == "SAMEORIGIN", "a header a route set itself is not overwritten")

h = run("/docs", "text/html")
check("content-security-policy" not in h, "API docs (only when API_DOCS=on) keep working")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
