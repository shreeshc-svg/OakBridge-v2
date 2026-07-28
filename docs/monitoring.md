# Uptime monitoring — runbook

## What is monitored, and why that endpoint

`GET https://api.oakbridge.in/api/health`

```json
200  {"status":"ok","db":"up"}
503  {"status":"degraded","db":"down"}
```

The handler pings MongoDB before answering. That matters: a FastAPI process can
stay up and keep answering requests long after Atlas has become unreachable, and
a monitor pointed at any ordinary route would report "all fine" through an outage
in which no customer can complete an order. UptimeRobot treats any non-2xx as
DOWN by default, so the 503 raises the alert with no extra configuration.

## Division of labour — deliberate, do not "fix"

There are two health checks in this system and they are pointed at **different**
endpoints on purpose.

| Check | Path | Question it answers |
|---|---|---|
| Render (`render.yaml` → `healthCheckPath`) | `/api` | Is the process alive? |
| UptimeRobot | `/api/health` | Is the process alive **and** can it reach the database? |

Render restarts a service whose health check fails. If Render were pointed at
`/api/health`, a transient Atlas outage would fail the check, Render would
restart the API, the fresh instance still could not reach Atlas, and we would sit
in a restart loop that fixes nothing and destroys the logs we would want to read.
Worse, it would mark an otherwise-good deploy as failed.

So: Render checks **liveness** (restarting genuinely helps a hung process),
UptimeRobot checks **dependencies** (a human needs to know, restarting will not
help). Leave them pointed where they are.

## Creating the monitor

Signup: <https://dashboard.uptimerobot.com/sign-up> — then verify the address.

New monitor:

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) |
| Friendly Name | `Oakbridge API — health` |
| URL | `https://api.oakbridge.in/api/health` |
| Monitoring Interval | 5 minutes (the free-plan fixed value) |
| Alert Contacts To Notify | `info@oakbridge.in` — tick it, or the monitor runs silently |

The last row is the step people miss. A monitor with no alert contact attached
records the outage perfectly and tells nobody.

Optionally set the notification threshold so an alert fires only after two
consecutive failed checks. That trades ~5 minutes of detection time for immunity
to single-check network blips. For a shop this size, worth it.

## Plan notes (verified 2026-07-28)

- Free tier: 50 monitors, fixed 5-minute interval, email alerts, 1 status page,
  3-month log retention.
- **Commercial use is permitted on every plan, including free.** UptimeRobot's
  Terms (Services Provided, as amended 26 May 2026) state this explicitly, and
  the Fair Use Policy repeats it. Blog posts describing a December 2024
  "personal, non-commercial only" restriction are describing a policy that is not
  in the current Terms — do not act on them without re-reading the source.
- Detection lag is up to 5 minutes on free. Paid Solo ($9/mo) drops it to 60s.
  Worth revisiting only if we ever quantify the cost of five minutes of downtime.
- SSL-expiry alerting reads as a paid-plan feature in their comparison table.
  Both certificates auto-renew, so this is a nice-to-have, not a gap — but it is
  the kind of silent failure that takes a site down at 2am, so revisit it.
- The API runs on Render's `starter` plan, which does **not** spin down when
  idle. No cold-start false positives, and no need to treat the monitor as a
  keep-alive ping.

## Worth adding later

1. A second HTTP monitor on `https://www.oakbridge.in/` — catches a Vercel or DNS
   failure while the API is perfectly healthy. Different failure domain entirely.
2. A keyword monitor on a live book page, alerting if expected text disappears.
   That is the one that catches "site loads, catalogue renders empty" — the
   failure mode that looks fine to every check above.
