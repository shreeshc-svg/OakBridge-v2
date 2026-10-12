"""perf.py: endpoint timing for the health panel — grouped by path shape,
bounded in memory, and measuring the whole response.

Run: python backend/tests/test_perf.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import perf  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


check(perf.route_shape("/api/books/abc-123") == "/api/books/:id", "ids collapse to :id")
check(perf.route_shape("/api/books") == "/api/books" and perf.route_shape("/api/books/featured") == "/api/books/featured", "words stay")
check(perf.route_shape("/api/admin/marketing/campaigns/0b9f2c1e-1111-2222-3333-444455556666/report")
      == "/api/admin/marketing/campaigns/:id/report", "uuid in the middle")
check(perf.route_shape("/api/orders/12345") == "/api/orders/:id", "numeric ids")

t = perf.Timings()
for i in range(1000):
    t.add("GET /x", i, 200)
t.add("GET /x", 5, 503)
s = t.snapshot()[0]
check(s["n"] == perf.PER_ROUTE and s["errors_5xx"] == 1 and s["p95"] > s["p50"], "keeps the last 500, counts 5xx, p95 > p50")
for i in range(400):
    t.add(f"GET /r{i}", 1, 200)
check(len(t.rows) == perf.MAX_ROUTES, "route count is capped")

clock = iter([0.0, 0.25])
mw = perf.TimingMiddleware(None, timings=perf.Timings(), clock=lambda: next(clock))


async def app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"x", "more_body": False})


async def nop(m):
    pass


mw.app = app
asyncio.run(mw({"type": "http", "method": "GET", "path": "/api/books/zz99x1"}, None, nop))
s = mw.t.snapshot()[0]
check(s["route"] == "GET /api/books/:id" and s["p50"] == 250.0, "middleware times the whole response")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
