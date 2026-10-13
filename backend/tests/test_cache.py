"""cache.py: the public response cache must speed up anonymous catalogue reads
and must never store or share anything personal, never serve data older than a
write, and never grow without bound.

Run: python backend/tests/test_cache.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cache as C  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class FakeApp:
    """Counts calls; returns a body that names the call number."""

    def __init__(self, status=200, headers=None, chunks=None):
        self.calls = 0
        self.status, self.headers, self.chunks = status, headers or [], chunks

    async def __call__(self, scope, receive, send):
        self.calls += 1
        await send({"type": "http.response.start", "status": self.status,
                    "headers": [(b"content-type", b"application/json")] + list(self.headers)})
        for i, c in enumerate(self.chunks or [f"call{self.calls}".encode()]):
            await send({"type": "http.response.body", "body": c, "more_body": i < len(self.chunks or [1]) - 1})


def scope(path, method="GET", qs=b"", auth=False, gzip=True):
    h = [(b"accept-encoding", b"gzip")] if gzip else []
    if auth:
        h.append((b"authorization", b"Bearer x"))
    return {"type": "http", "method": method, "path": path, "query_string": qs, "headers": h}


async def call(mw, sc):
    out = {"status": None, "headers": [], "body": b""}

    async def send(m):
        if m["type"] == "http.response.start":
            out["status"], out["headers"] = m["status"], m["headers"]
        else:
            out["body"] += m.get("body", b"")

    await mw(sc, None, send)
    out["h"] = {k: v for k, v in out["headers"]}
    return out


def new(app, t=[100.0]):
    db_n = {"n": 0}

    async def load():
        return db_n["n"]

    async def save():
        db_n["n"] += 1
        return db_n["n"]

    clock = {"t": 100.0}
    mw = C.ResponseCacheMiddleware(app, version=C.Version(load, save), clock=lambda: clock["t"])
    return mw, clock, db_n


async def main():
    print("-- policy --")
    check(C.cache_ttl("/api/books") == 30 and C.cache_ttl("/api/categories") == 60, "catalogue paths cached")
    check(C.cache_ttl("/api/books/abc") == 60 and C.cache_ttl("/api/books/abc/preview") is None, "book page yes, preview file no")
    for p in ["/api/my/orders", "/api/orders/1", "/api/admin/books", "/api/files/x.jpg", "/api/m/o/1/s.gif", "/api/cart", "/api/auth/me"]:
        check(C.cache_ttl(p) is None, f"never cached: {p}")
    check(C.should_bump("PUT", "/api/admin/books/1", 200) and C.should_bump("POST", "/api/webhooks/razorpay", 200), "admin/webhook writes bump")
    check(not C.should_bump("GET", "/api/admin/books", 200) and not C.should_bump("POST", "/api/admin/books", 500), "reads / failed writes don't bump")
    check(not C.should_bump("POST", "/api/cart", 200), "cart writes don't thrash the cache")
    check(C.should_bump("POST", "/api/warehouse/scan", 200), "warehouse phone-screen stock moves clear the cache")

    print("-- hit / miss --")
    app = FakeApp()
    mw, clock, _ = new(app)
    a = await call(mw, scope("/api/books", qs=b"category=law"))
    b = await call(mw, scope("/api/books", qs=b"category=law"))
    check(app.calls == 1 and a["body"] == b["body"] == b"call1", "second identical request served from memory")
    check(a["h"].get(b"x-cache") == b"MISS" and b["h"].get(b"x-cache") == b"HIT", "X-Cache MISS then HIT")
    check(b"public" in a["h"].get(b"cache-control", b"") and b"Authorization" in a["h"].get(b"vary", b""), "public cache header + Vary: Authorization")
    await call(mw, scope("/api/books", qs=b"category=tax"))
    check(app.calls == 2, "different query = different entry")
    await call(mw, scope("/api/books", qs=b"category=law", gzip=False))
    check(app.calls == 3, "gzip and plain bodies kept apart")

    print("-- never personal --")
    app = FakeApp()
    mw, clock, _ = new(app)
    await call(mw, scope("/api/books", auth=True))
    r = await call(mw, scope("/api/books", auth=True))
    check(app.calls == 2 and r["h"].get(b"x-cache") is None, "signed-in requests bypass the cache")
    check(r["h"].get(b"cache-control") == b"private, no-store", "signed-in responses marked private, no-store")
    app = FakeApp(headers=[(b"set-cookie", b"a=b")])
    mw, clock, _ = new(app)
    await call(mw, scope("/api/books")); await call(mw, scope("/api/books"))
    check(app.calls == 2, "responses with Set-Cookie are not stored")
    app = FakeApp(headers=[(b"cache-control", b"private, no-store")])
    mw, clock, _ = new(app)
    await call(mw, scope("/api/settings")); await call(mw, scope("/api/settings"))
    check(app.calls == 2, "responses marked private are not stored")
    app = FakeApp(status=404)
    mw, clock, _ = new(app)
    await call(mw, scope("/api/books/missing")); await call(mw, scope("/api/books/missing"))
    check(app.calls == 2, "errors are not stored")

    print("-- freshness --")
    app = FakeApp()
    mw, clock, db_n = new(app)
    await call(mw, scope("/api/categories"))
    clock["t"] += 61
    await call(mw, scope("/api/categories"))
    check(app.calls == 2, "expires after its TTL")
    await call(mw, scope("/api/admin/categories/1", method="PUT"))
    r = await call(mw, scope("/api/categories"))
    check(app.calls == 4 and r["h"].get(b"x-cache") == b"MISS" and db_n["n"] == 1, "an admin write invalidates immediately (and is mirrored to the DB)")
    # another instance bumped: picked up within VERSION_RECHECK
    db_n["n"] = 7
    clock["t"] += C.VERSION_RECHECK + 0.1
    await call(mw, scope("/api/categories"))
    check(app.calls == 5, "a bump from another instance is honoured")

    print("-- a request racing a write cannot store stale data as fresh --")
    app2 = FakeApp()
    mw2, clock2, _ = new(app2)

    async def slow_then_write(scope_, receive, send):
        await mw2.version.bump()  # a write lands while this GET is being built
        await app2(scope_, receive, send)

    mw2.app = slow_then_write
    await call(mw2, scope("/api/books"))
    mw2.app = app2
    await call(mw2, scope("/api/books"))
    check(app2.calls == 2, "result built across a write is not reused")

    print("-- bounded memory --")
    st = C.ResponseStore(entries_max=3, total_max=10_000)
    for i in range(5):
        st.put((i,), {"version": 0, "expires": 999, "headers": [], "body": b"x" * 100})
    check(st.stats()["entries"] == 3 and st.evictions == 2, "entry cap evicts oldest")
    st2 = C.ResponseStore(entries_max=100, total_max=250)
    for i in range(5):
        st2.put((i,), {"version": 0, "expires": 999, "headers": [], "body": b"x" * 100})
    check(st2.total <= 250, "byte cap holds")
    st2.put(("big",), {"version": 0, "expires": 999, "headers": [], "body": b"x" * (C.ENTRY_BYTES_MAX + 1)})
    check(("big",) not in st2._d, "oversized bodies are never stored")
    app = FakeApp(chunks=[b"a" * 10, b"b" * 10])
    mw, clock, _ = new(app)
    r1 = await call(mw, scope("/api/books")); r2 = await call(mw, scope("/api/books"))
    check(app.calls == 1 and r2["body"] == r1["body"] == b"a" * 10 + b"b" * 10, "multi-chunk bodies cached whole")

    print("-- memo --")
    n = {"v": 0}

    async def load():
        return n["v"]

    async def save():
        n["v"] += 1
        return n["v"]

    clk = {"t": 0.0}
    m = C.Memo(C.Version(load, save), clock=lambda: clk["t"])
    calls = {"n": 0}

    async def prod():
        calls["n"] += 1
        return calls["n"]

    a1 = await m.get("s", 10, prod); a2 = await m.get("s", 10, prod)
    await m.version.bump()
    a3 = await m.get("s", 10, prod)
    check(a1 == a2 == 1 and a3 == 2, "memo reuses within TTL and refreshes after a bump")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
