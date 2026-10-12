"""
Request timing for the health panel — how fast each endpoint really is.

Pure ASGI, outermost, so it measures what a visitor experiences (cache hits
included): from the request arriving to the last byte of the response.

Paths are grouped by shape, so /api/books/abc-123 and /api/books/xyz-9 are one
row ("/api/books/:id"), and the store is bounded: the last 500 timings per row,
at most 300 rows. No request content, user or IP is recorded — only method,
path shape, status class and milliseconds.
"""
from __future__ import annotations

import re
import time
from collections import deque
from typing import Optional

_ID = re.compile(r"^(?=.*\d)[A-Za-z0-9_-]{6,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^\d+$")
PER_ROUTE = 500
MAX_ROUTES = 300
STARTED = time.time()


def route_shape(path: str) -> str:
    parts = (path or "/").split("/")
    out = []
    for i, p in enumerate(parts):
        if i >= 8:
            out.append("…")
            break
        out.append(":id" if p and _ID.match(p) else p)
    return "/".join(out) or "/"


class Timings:
    def __init__(self):
        self.rows: dict[str, deque] = {}
        self.errors: dict[str, int] = {}

    def add(self, key: str, ms: float, status: int) -> None:
        q = self.rows.get(key)
        if q is None:
            if len(self.rows) >= MAX_ROUTES:
                return
            q = self.rows[key] = deque(maxlen=PER_ROUTE)
        q.append(ms)
        if status >= 500:
            self.errors[key] = self.errors.get(key, 0) + 1

    @staticmethod
    def _pct(sorted_vals: list, p: float) -> float:
        if not sorted_vals:
            return 0.0
        k = max(0, min(len(sorted_vals) - 1, int(round(p * (len(sorted_vals) - 1)))))
        return round(sorted_vals[k], 1)

    def snapshot(self, top: int = 20, prefix: Optional[str] = None) -> list:
        out = []
        for key, q in self.rows.items():
            if prefix and prefix not in key:
                continue
            vals = sorted(q)
            out.append({"route": key, "n": len(vals), "p50": self._pct(vals, 0.5), "p95": self._pct(vals, 0.95),
                        "max": round(vals[-1], 1) if vals else 0, "errors_5xx": self.errors.get(key, 0)})
        out.sort(key=lambda r: -r["p95"])
        return out[:top]


TIMINGS = Timings()


class TimingMiddleware:
    def __init__(self, app, timings: Timings = TIMINGS, clock=time.perf_counter):
        self.app, self.t, self.clock = app, timings, clock

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        start = self.clock()
        box = {"status": 0}

        async def send_wrapped(message):
            if message["type"] == "http.response.start":
                box["status"] = message.get("status", 0)
            elif message["type"] == "http.response.body" and not message.get("more_body"):
                self.t.add(f"{scope.get('method', 'GET')} {route_shape(scope.get('path', ''))}",
                           (self.clock() - start) * 1000, box["status"])
            await send(message)

        await self.app(scope, receive, send_wrapped)


def memory_mb() -> Optional[float]:
    """Resident memory of this process (Linux /proc), or None elsewhere."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        return None
    return None
