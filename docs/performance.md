# Performance foundation (phase 0)

What keeps the storefront fast while marketing work grows. All switches are
environment variables on Render — no code change to turn anything off.

## What changed

| Area | Before | Now | Switch |
|---|---|---|---|
| Admin code | in the shoppers' main bundle | each admin page loads only when opened | — |
| Response size | JSON sent uncompressed | gzip (level 5) for bodies > 1 KB; images/PDF/e-books/xlsx skipped | — |
| Public catalogue reads | every visit hit MongoDB (categories did one count per category) | finished responses cached 30–300 s in memory; cleared by any admin/payment/webhook/order/review write | `PUBLIC_CACHE=off` |
| Signed-in responses | no cache header | `private, no-store` — never stored or shared | — |
| Background marketing work | asyncio tasks inside the web process | job queue (`backend/jobs.py`) + separate worker (`backend/worker.py`), with automatic fallback | `WORKER_MODE=inline/external` |
| Big audiences | up to 200,000 contacts loaded at once | pages of 500; bulk writes of 100 | — |
| Hot-path lookups | updates by `id` scanned whole collections | `id` / `sent_at` / consent indexes | — |
| Marketing dashboard | streamed every send & contact on each open; recomputed campaign stats inline | counted inside MongoDB, memoised 60 s; stats refreshed by the background tick | — |
| Visibility | none | Admin → Marketing → Settings → **System health** | — |

## Turning on the worker (recommended)

1. **Create the worker** — either by syncing `render.yaml` (Blueprint) or by hand:
   Render → New → *Background Worker* → same repo and branch (`Oak-v2-UAT`),
   root directory `backend`, build `pip install -r requirements-local.txt`,
   start `python worker.py`.
2. **Environment** — the worker needs the same values as the web service:
   `MONGO_URL`, `DB_NAME`, **`JWT_SECRET` (must be identical — it signs the
   unsubscribe/tracking links in emails)**, `PUBLIC_API_URL`, `SITE_URL`, the AWS
   keys and `S3_REGION`/`SES_REGION`, `SES_CONFIGURATION_SET`, `SNS_TOPIC_ARN`,
   `INTERAKT_API_KEY`, `RESEND_API_KEY`, `SENDER_EMAIL`. Easiest: one Render
   *Environment Group* attached to both services. Never paste values into chat.
3. Leave `WORKER_MODE=inline` on both at first. Deploy. Admin → Marketing →
   Settings → System health should show the worker heartbeat within a minute.
4. Set `WORKER_MODE=external` on **both** services. From then on the website
   only queues work. If the worker stops, the website notices within 3 minutes,
   does the work itself and shows a dashboard alert.

Cost: one extra small Render service. Without it everything keeps working in
`inline` mode (as before), just without the CPU/memory isolation.

## Load test (never against the live site)

1. Create a separate test database (e.g. `oakbridge_loadtest`) on Atlas.
2. Seed it (contacts and sends on the reserved `.test` domain — undeliverable):
   `LOADTEST_MONGO_URL=… LOADTEST_DB_NAME=oakbridge_loadtest python backend/scripts/seed_test_data.py --contacts 50000 --sends 100000`
3. Run a backend locally against that database (`MONGO_URL`/`DB_NAME` pointing at it).
4. `python backend/scripts/loadtest.py --base http://localhost:8001 --users 40 --seconds 60`
   — optionally while a test campaign sends from the worker.
5. Pass marks: storefront GETs p95 < 300 ms, zero 5xx. The script exits non-zero
   if they are missed; both scripts refuse the live database and the live site.

## Not done here (by decision)

* **Edge/CDN caching** — `api.oakbridge.in` is served by Render directly, so
  shared caching at the edge needs Vercel rewrites or Cloudflare in front; to be
  confirmed separately. Browsers already get short `public` cache headers.
* **Redis** — the cache and queue are behind small interfaces; switch only if
  there is more than one web instance or the MongoDB queue becomes the
  bottleneck in the load test.
* **Nginx** — Vercel and Render already provide what it would; it only makes
  sense on a self-managed server.
