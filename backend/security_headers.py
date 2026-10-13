"""
Browser security headers on every API response.

WHY
api.oakbridge.in sent none of these. Most of its responses are JSON, which a
browser never runs — but it also serves files (book covers, brochures, PDFs)
and a few small HTML pages (unsubscribe), and those are what an attacker would
aim at: a file a browser can be talked into treating as HTML, or a page framed
inside someone else's site.

WHAT EACH ONE DOES
* X-Content-Type-Options: nosniff — the browser uses the content type we send
  and never "guesses". Without it, an uploaded file that happens to look like
  HTML can be run as HTML on our domain.
* Content-Security-Policy — JSON, images and files: nothing may load or run at
  all ("default-src 'none'"). HTML pages: their own inline styles only, no
  scripts. Nothing from the API may be framed (frame-ancestors 'none').
* X-Frame-Options: DENY — the same "no framing" for older browsers.
* Referrer-Policy — links leaving the site carry the origin, not full URLs
  (which can hold e-mail addresses or tokens, e.g. unsubscribe links).
* Strict-Transport-Security — browsers only ever use HTTPS for the API.

EXCEPTIONS
PDFs get nosniff/Referrer/HSTS but no CSP and no frame ban: a browser's PDF
viewer runs inside the response's security context, and a strict CSP (or
"sandbox") makes Chrome refuse to show the PDF at all. The interactive API docs
(/docs, /redoc — off in production, see server.py) need their scripts.

Pure ASGI so it also covers cache hits from ResponseCacheMiddleware: it is
added last, i.e. outermost.
"""
from __future__ import annotations

COMMON = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"strict-transport-security", b"max-age=31536000"),
]
CSP_STRICT = b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
CSP_HTML = (b"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; "
            b"frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


def headers_for(path: str, content_type: str, existing: set) -> list:
    """The headers to add for one response (names already set are kept)."""
    out = [h for h in COMMON if h[0] not in existing]
    ct = (content_type or "").lower()
    if path.startswith(DOCS_PATHS) or ct.startswith("application/pdf"):
        return out
    if b"content-security-policy" not in existing:
        out.append((b"content-security-policy", CSP_HTML if ct.startswith("text/html") else CSP_STRICT))
    if b"x-frame-options" not in existing:
        out.append((b"x-frame-options", b"DENY"))
    return out


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path") or ""

        async def wrapped(message):
            if message.get("type") == "http.response.start":
                hdrs = list(message.get("headers") or [])
                names = {k.lower() for k, _ in hdrs}
                ct = next((v.decode("latin-1") for k, v in hdrs if k.lower() == b"content-type"), "")
                hdrs.extend(headers_for(path, ct, names))
                message = {**message, "headers": hdrs}
            await send(message)

        return await self.app(scope, receive, wrapped)
