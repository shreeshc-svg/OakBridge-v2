"""
Load test: hammer the storefront endpoints with concurrent visitors and report
real response times against the pass marks.

    python backend/scripts/loadtest.py --base http://localhost:8001 --users 40 --seconds 60

Run it against a LOCAL or staging backend pointed at a TEST database (see
seed_test_data.py) — ideally while a test campaign is sending, to prove
marketing work does not slow shoppers down. It refuses the live site.

Pass marks (phase 0 plan):
  * storefront + checkout-path GETs: 95% under 300 ms
  * no 5xx errors
Standard library only — nothing to install.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

LIVE_HOSTS = {"api.oakbridge.in", "oakbridge.in", "www.oakbridge.in"}
PATHS = [
    "/api/categories",
    "/api/books?limit=24",
    "/api/books?category=law&limit=24",
    "/api/books?sort=newest&limit=24",
    "/api/books/featured",
    "/api/books/new-releases",
    "/api/books/bestsellers",
    "/api/site-content",
    "/api/settings",
    "/api/legal/privacy",
]
P95_TARGET_MS = 300


def pct(vals, p):
    if not vals:
        return 0.0
    vals = sorted(vals)
    return vals[max(0, min(len(vals) - 1, int(round(p * (len(vals) - 1)))))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--users", type=int, default=30)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--book-ids", default="", help="comma-separated ids to include /api/books/{id}")
    a = ap.parse_args()
    host = (urlparse(a.base).hostname or "").lower()
    if host in LIVE_HOSTS:
        print(f"REFUSED: {host} is the live site. Load-test a local/staging backend on a test database.")
        return 2
    paths = PATHS + [f"/api/books/{b.strip()}" for b in a.book_ids.split(",") if b.strip()]
    results: dict = {p: [] for p in paths}
    errors: dict = {p: 0 for p in paths}
    cache_hits = {"HIT": 0, "MISS": 0}
    lock = threading.Lock()
    stop_at = time.time() + a.seconds

    def visitor():
        while time.time() < stop_at:
            p = random.choice(paths)
            req = urllib.request.Request(a.base.rstrip("/") + p, headers={"Accept-Encoding": "gzip", "Origin": "https://www.oakbridge.in"})
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    r.read()
                    xc = r.headers.get("X-Cache")
                    ok = r.status < 500
            except urllib.error.HTTPError as e:
                ok, xc = e.code < 500, None
            except Exception:  # noqa: BLE001
                ok, xc = False, None
            ms = (time.perf_counter() - t0) * 1000
            with lock:
                results[p].append(ms)
                if not ok:
                    errors[p] += 1
                if xc in cache_hits:
                    cache_hits[xc] += 1
            time.sleep(random.uniform(0.05, 0.4))  # think time between clicks

    threads = [threading.Thread(target=visitor, daemon=True) for _ in range(a.users)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    allv = [v for vs in results.values() for v in vs]
    total_err = sum(errors.values())
    print(f"\n{a.users} visitors x {a.seconds}s against {a.base}: {len(allv)} requests, {total_err} errors")
    print(f"{'endpoint':42} {'n':>6} {'p50':>8} {'p95':>8} {'max':>8}")
    for p in paths:
        v = results[p]
        print(f"{p[:42]:42} {len(v):>6} {pct(v, .5):>7.0f}ms {pct(v, .95):>7.0f}ms {max(v) if v else 0:>7.0f}ms")
    p95 = pct(allv, .95)
    n_cache = cache_hits["HIT"] + cache_hits["MISS"]
    print(f"\noverall p50 {pct(allv, .5):.0f} ms · p95 {p95:.0f} ms · mean {statistics.mean(allv) if allv else 0:.0f} ms"
          f" · cache hit rate {cache_hits['HIT'] / n_cache:.0%}" if n_cache else "")
    passed = p95 < P95_TARGET_MS and total_err == 0
    print(json.dumps({"p95_ms": round(p95), "errors": total_err, "target_p95_ms": P95_TARGET_MS, "pass": passed}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
