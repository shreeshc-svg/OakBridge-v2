"""
Process-local caching for the public storefront API.

WHY THIS EXISTS
Every shopper page load used to hit MongoDB for the same public data: the
category row (one count query per category, every time), the book grids, the
home content, legal pages. None of it was cached anywhere — no CDN in front of
api.oakbridge.in, no cache headers, no in-memory copies. This module keeps the
finished, already-compressed responses in memory for a short time, so a busy
minute costs one database round per page instead of one per visitor.

THE RULES THAT KEEP IT SAFE
* Only GET requests, only paths on an explicit allowlist (PUBLIC_TTLS), and
  only requests WITHOUT an Authorization header: anything a signed-in person
  sees is never stored or shared. Every allowlisted handler was checked to be
  read-only (no writes, no user lookups).
* Only clean 200 responses are stored: no Set-Cookie, nothing marked
  private/no-store, bodies up to 1 MB, total memory capped (TOTAL_BYTES_MAX).
* Invalidation is by a single version number. Any successful write that can
  change public data (admin edits, payments/webhooks that move stock, cron
  tasks, orders, reviews) bumps it, and every older entry is dead at once. A
  request that started before the bump stores its result under the OLD version,
  so it can never resurrect stale data. The version is mirrored in MongoDB and
  re-read every few seconds, so a second instance (or the worker) stays in step.
* TTLs are short (30-300 s), so even a missed invalidation heals itself.
* Responses for signed-in users that set no Cache-Control get
  "private, no-store", so no browser or proxy keeps personal data around.

It is pure ASGI (no Starlette import), so it is unit-tested without a server.
"""
from __future__ import annotations

import re
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Optional

# path regex -> seconds. Anchored: /api/books/{id}/preview (a file) is NOT here.
PUBLIC_TTLS = [
    (re.compile(r"^/api/categories$"), 60),
    (re.compile(r"^/api/books$"), 30),
    (re.compile(r"^/api/books/(featured|new-releases|bestsellers)$"), 60),
    (re.compile(r"^/api/books/[^/]+$"), 60),
    (re.compile(r"^/api/books/[^/]+/(authors|reviews)$"), 60),
    (re.compile(r"^/api/authors(/[^/]+(/books)?)?$"), 120),
    (re.compile(r"^/api/(site-content|settings|media/album)$"), 60),
    (re.compile(r"^/api/collections/[^/]+$"), 60),
    (re.compile(r"^/api/legal(/[^/]+)?$"), 300),
    (re.compile(r"^/api/hampers(/[^/]+)?$"), 60),
    (re.compile(r"^/api/packs/[^/]+/items$"), 60),
    (re.compile(r"^/api/search/suggest-index$"), 300),
    (re.compile(r"^/api/sitemap\.xml$"), 600),
]
# Writes after which public data may have changed. Deliberately broad: admin
# writes are rare, and refilling the cache is cheap; a missed bump is not.
BUMP_PATHS = re.compile(r"^/api/(admin/|payments/|webhooks/|tasks/|orders(/|$)|books/[^/]+/reviews$|legal|settings)")

ENTRY_BYTES_MAX = 1_000_000
TOTAL_BYTES_MAX = 40_000_000
ENTRIES_MAX = 600
VERSION_RECHECK = 5.0  # seconds between reads of the shared version


def cache_ttl(path: str) -> Optional[int]:
    for rx, ttl in PUBLIC_TTLS:
        if rx.match(path or ""):
            return ttl
    return None


def should_bump(method: str, path: str, status: int) -> bool:
    return method not in ("GET", "HEAD", "OPTIONS") and 200 <= int(status) < 400 and bool(BUMP_PATHS.match(path or ""))


class ResponseStore:
    """LRU of finished responses, capped by count and by total bytes."""

    def __init__(self, entries_max: int = ENTRIES_MAX, total_max: int = TOTAL_BYTES_MAX):
        self._d: "OrderedDict[tuple, dict]" = OrderedDict()
        self.entries_max, self.total_max = entries_max, total_max
        self.total = 0
        self.hits = self.misses = self.stores = self.evictions = 0

    def get(self, key: tuple, version: int, now: float) -> Optional[dict]:
        e = self._d.get(key)
        if not e or e["version"] != version or e["expires"] <= now:
            if e:
                self._drop(key)
            self.misses += 1
            return None
        self._d.move_to_end(key)
        self.hits += 1
        return e

    def put(self, key: tuple, entry: dict) -> None:
        size = len(entry["body"])
        if size > ENTRY_BYTES_MAX:
            return
        if key in self._d:
            self._drop(key)
        self._d[key] = entry
        self.total += size
        self.stores += 1
        while len(self._d) > self.entries_max or self.total > self.total_max:
            self._drop(next(iter(self._d)))
            self.evictions += 1

    def clear(self) -> None:
        self._d.clear()
        self.total = 0

    def _drop(self, key: tuple) -> None:
        e = self._d.pop(key, None)
        if e:
            self.total -= len(e["body"])

    def stats(self) -> dict:
        n = self.hits + self.misses
        return {"entries": len(self._d), "bytes": self.total, "hits": self.hits, "misses": self.misses,
                "hit_rate": round(self.hits / n, 3) if n else None, "stores": self.stores, "evictions": self.evictions}


class Version:
    """The shared invalidation counter: local copy + MongoDB mirror."""

    def __init__(self, load: Callable[[], Awaitable[int]], save: Callable[[], Awaitable[int]]):
        self._load, self._save = load, save
        self.n = 0
        self._checked = 0.0

    async def current(self, now: float) -> int:
        if now - self._checked >= VERSION_RECHECK:
            self._checked = now
            try:
                self.n = max(self.n, int(await self._load()))
            except Exception:  # noqa: BLE001 — DB hiccup: keep serving on the local version
                pass
        return self.n

    async def bump(self) -> None:
        self.n += 1  # local first: this instance stops serving old entries immediately
        try:
            self.n = max(self.n, int(await self._save()))
        except Exception:  # noqa: BLE001
            pass


def _h(headers: list, name: bytes) -> Optional[bytes]:
    for k, v in headers:
        if k.lower() == name:
            return v
    return None


class ResponseCacheMiddleware:
    """Outermost ASGI middleware: serves cached public responses (already
    gzipped by the inner middleware), stores fresh ones, bumps the version
    after writes, and marks signed-in responses private."""

    def __init__(self, app, *, version: Version, store: Optional[ResponseStore] = None,
                 clock: Callable[[], float] = time.monotonic):
        self.app, self.version, self.clock = app, version, clock
        self.store = store or ResponseStore()

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        method, path = scope.get("method", "GET"), scope.get("path", "")
        req_h = scope.get("headers") or []
        authed = _h(req_h, b"authorization") is not None
        ttl = cache_ttl(path) if method == "GET" and not authed else None

        if ttl:
            now = self.clock()
            ver = await self.version.current(now)
            ae = (_h(req_h, b"accept-encoding") or b"").lower()
            key = (path, scope.get("query_string", b""), b"gzip" in ae, _h(req_h, b"origin") or b"")
            hit = self.store.get(key, ver, now)
            if hit:
                headers = [h for h in hit["headers"]] + [(b"x-cache", b"HIT")]
                await send({"type": "http.response.start", "status": 200, "headers": headers})
                await send({"type": "http.response.body", "body": hit["body"], "more_body": False})
                return
            return await self._fill(scope, receive, send, key, ver, ttl, now)

        status_box = {}

        async def send_wrapped(message):
            if message["type"] == "http.response.start":
                status_box["s"] = message.get("status", 0)
                if authed and path.startswith("/api/"):
                    hs = list(message.get("headers") or [])
                    if _h(hs, b"cache-control") is None:
                        hs.append((b"cache-control", b"private, no-store"))
                        message = {**message, "headers": hs}
            await send(message)

        await self.app(scope, receive, send_wrapped)
        if should_bump(method, path, status_box.get("s", 0)):
            await self.version.bump()

    async def _fill(self, scope, receive, send, key, ver, ttl, now):
        state: dict[str, Any] = {"ok": False, "chunks": [], "size": 0, "headers": []}

        async def send_wrapped(message):
            if message["type"] == "http.response.start":
                hs = list(message.get("headers") or [])
                cc = (_h(hs, b"cache-control") or b"").lower()
                state["ok"] = (message.get("status") == 200 and _h(hs, b"set-cookie") is None
                               and b"private" not in cc and b"no-store" not in cc)
                if state["ok"] and not cc:
                    # Browsers may reuse it briefly; signed-in requests differ (Vary).
                    hs.append((b"cache-control", f"public, max-age={min(ttl, 60)}, stale-while-revalidate={ttl * 2}".encode()))
                    vary = _h(hs, b"vary")
                    hs = [h for h in hs if h[0].lower() != b"vary"]
                    hs.append((b"vary", (vary + b", Authorization") if vary else b"Accept-Encoding, Origin, Authorization"))
                state["headers"] = hs
                message = {**message, "headers": hs + [(b"x-cache", b"MISS")]}
            elif message["type"] == "http.response.body" and state["ok"]:
                body = message.get("body", b"")
                state["size"] += len(body)
                if state["size"] > ENTRY_BYTES_MAX:
                    state["ok"] = False
                    state["chunks"] = []
                else:
                    state["chunks"].append(body)
                if not message.get("more_body") and state["ok"]:
                    self.store.put(key, {"version": ver, "expires": now + ttl, "headers": state["headers"],
                                         "body": b"".join(state["chunks"])})
            await send(message)

        await self.app(scope, receive, send_wrapped)


_SHARED: dict = {}


def shared_version(db) -> Version:
    """One version object per process, shared by the response cache and Memo."""
    if "v" not in _SHARED:
        _SHARED["v"] = mongo_version(db)
    return _SHARED["v"]


PUBLIC_STORE = ResponseStore()  # module-level so the health panel can read its stats


def mongo_version(db) -> Version:
    """Version mirrored in db.cache_state {key: "public"} so every instance agrees."""
    async def load() -> int:
        d = await db.cache_state.find_one({"key": "public"}, {"_id": 0, "n": 1})
        return int((d or {}).get("n", 0))

    async def save() -> int:
        d = await db.cache_state.find_one_and_update({"key": "public"}, {"$inc": {"n": 1}}, upsert=True,
                                                     return_document=True, projection={"_id": 0, "n": 1})
        return int((d or {}).get("n", 0))

    return Version(load, save)


class Memo:
    """Tiny TTL memo for hot internal reads (e.g. settings), tied to the same
    version so an admin save is seen immediately."""

    def __init__(self, version: Version, clock: Callable[[], float] = time.monotonic):
        self.version, self.clock = version, clock
        self._d: dict = {}

    async def get(self, key: str, ttl: float, producer: Callable[[], Awaitable[Any]]) -> Any:
        now = self.clock()
        ver = await self.version.current(now)
        e = self._d.get(key)
        if e and e[0] == ver and e[1] > now:
            return e[2]
        val = await producer()
        self._d[key] = (ver, now + ttl, val)
        return val
