"""Marketing AI insights: code decides the numbers, the model only words them.

Run: python backend/tests/test_ai_core.py

* facts are totals only — an email address or phone number is refused;
* a model reply with ANY number not in the facts is rejected (and the card
  falls back to the code's own findings);
* subject-line suggestions may not add prices, discounts, deadlines or
  numbers the team didn't write;
* the code's findings are right on their own (they are what shows when the
  model is down).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ai_core as ai  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


print("-- privacy --")
for bad in ({"x": "asha@example.com"}, {"rows": [{"phone": "98765 43210"}]}, {"p": "+91 9876543210"}):
    try:
        ai.assert_no_pii(bad)
        check(False, f"refused {bad}")
    except ValueError:
        check(True, f"refused {bad}")
ai.assert_no_pii({"providers": ["gmail.com"], "period": {"from": "2026-10-01"}, "visits": 1234567890 // 10})
check(True, "provider names, dates and plain counts are fine")

print("-- growth facts and findings --")
now = {"since": "2026-10-01", "until": "2026-10-21", "total": {"visits": 400, "checkouts": 30, "paid": 12, "revenue": 5400.5,
       "visit_to_paid": 0.03, "steps": {"view_item": 300, "add_to_cart": 60, "checkout": 30, "payment": 20}},
       "rows": [{"channel": "Google", "visits": 200, "paid": 9, "revenue": 4000, "visit_to_paid": 0.045},
                {"channel": "Instagram", "visits": 150, "paid": 1, "revenue": 400, "visit_to_paid": 0.0067},
                {"channel": "Email", "visits": 0, "paid": 0, "revenue": 0, "visit_to_paid": None}]}
prev = {"since": "2026-09-10", "until": "2026-09-30", "total": {"visits": 320, "paid": 10, "revenue": 4100},
        "rows": [{"channel": "Google", "visits": 160, "paid": 8}]}
ins = {"landing": [{"key": "/books/sacred-tiger-tales", "n": 90}], "referrer": [{"key": "google.com", "n": 150}],
       "device": {"mobile": 300, "desktop": 100}}
f = ai.growth_facts(now, prev, ins)
check(f["total"]["visit_to_paid_pct"] == 3.0 and f["previous_period"]["visits_change_pct"] == 25.0, "rates and changes pre-computed")
check([c["channel"] for c in f["channels"]] == ["Google", "Instagram"], "channels with no visits/orders left out")
check(f["steps"][1] == {"from": "view_item", "to": "add_to_cart", "from_n": 300, "to_n": 60, "kept_pct": 20.0}, "shopping steps kept %")
fi, ac = ai.growth_findings(f)
check(any("view_item" in x and "20.0%" in x for x in fi), "biggest drop found (book page -> cart)")
check(any("Google converts best (4.5%" in x for x in fi) and ac, "best / worst channel and actions")
check(ai.growth_facts(now, {**prev, "empty": True}, None).get("previous_period") is None, "no like-for-like period -> no comparison")

print("-- the model may not invent numbers --")
good = {"headline": "Visits rose 25.0% to 400, with 12 paid orders.",
        "findings": ["Only 20.0% of book-page visitors added to cart (60 of 300)."], "actions": ["Fix the book page."]}
v, why = ai.validate_insight(good, f)
check(v is not None and why == "", "a reply using only the facts' numbers passes")
v, why = ai.validate_insight({**good, "findings": ["Conversions could grow 40% with a sale."]}, f)
check(v is None and "40" in why, "an invented 40% is rejected")
v, why = ai.validate_insight({**good, "headline": "Visits rose to about 410."}, f)
check(v is None, "a 'rounded' 410 that isn't in the facts is rejected")
v, why = ai.validate_insight({**good, "actions": ["Email asha@example.com"]}, f)
check(v is None, "an email address in the reply is rejected")
check(ai.validate_insight({"findings": ["x"]}, f)[0] is None and ai.validate_insight(None, f)[0] is None, "wrong shape rejected")
check(ai.parse_json('Sure! ```json\n{"headline": "a", "findings": ["b"]}\n```') == {"headline": "a", "findings": ["b"]},
      "JSON found inside prose / code fences")
fb = ai.fallback(fi, ac)
check(fb["headline"] == fi[0] and fb["actions"] == ac[:4], "fallback = the code's own findings")
check(ai.validate_insight({**good, "headline": "**Visits** rose to 400"}, f)[0]["headline"] == "Visits rose to 400", "markdown stripped")

print("-- campaign --")
report = {"campaign": {"name": "Diwali picks", "subject": "Books for Diwali", "status": "sent", "started_at": "2026-10-20T04:00:00"},
          "stats": {"sent": 500, "delivered": 490, "opened": 98, "clicked": 9, "paid": 2, "revenue": 1200, "bounced": 15},
          "rates": {"delivery": 0.98, "open": 0.2, "click": 0.0184, "ctor": 0.0918, "bounce": 0.03, "unsubscribe": 0.002},
          "links": [{"url": "https://www.oakbridge.in/books/x?utm_source=email&e=abc", "clicks": 7}],
          "timeline": {"2026-10-20T05": {"opened": 40}, "2026-10-20T06": {"opened": 20}},
          "providers": [{"provider": "yahoo.com", "sent": 50, "bounced": 9}], "problems": [{"to": "a@b.com"}]}
cf = ai.campaign_facts(report, {"open": 25.0, "click": 3.0, "ctor": 12.0, "bounce": 1.0, "unsubscribe": 0.2})
ai.assert_no_pii(cf)
check("?" not in cf["top_links"][0]["link"], "tracking parameters stripped from links")
check("problems" not in cf, "recipient addresses (problems list) never reach the facts")
cfi, cac = ai.campaign_findings(cf)
check(any("Open rate 20.0% is below your average of 25.0%" in x for x in cfi) and any("subject" in a for a in cac),
      "compared with your own average, with a next step")
check(any("hour starting 05:00" in x for x in cfi), "best hour found")

print("-- deliverability --")
df = ai.deliverability_facts({"delivery_rate": 0.97, "bounce_rate": 0.031, "complaint_rate": 0.0005, "unsubscribe_rate": 0.003,
                              "open_rate": 0.22, "email_sent": 900, "contacts": 2000, "subscribed": 800},
                             {"verified": 1200, "risky": 500, "invalid": 100, "unknown": 200},
                             {"bands": {"high": {"sent": 400, "rate": 0.005}}}, {"rows": [{"domain": "rediffmail.com", "bad_provider": True}]},
                             {"aws_reputation": {"bounce_rate": 0.028, "complaint_rate": 0.0004}, "sending_enabled": True})
dfi, dac = ai.deliverability_findings(df)
check(any("3.1%" in x and "close to our stop limit of 4.0%" in x for x in dfi) and dac, "bounce vs our 4% stop and AWS 5%")
check(any("35.0% of contacts are not confirmed" in x for x in dfi), "unconfirmed share")
check(any("rediffmail.com" in x for x in dfi), "held-back providers named")

print("-- subject lines --")
check(any("spam" in x.lower() for x in ai.subject_checks("FREE BOOKS!!! ACT NOW", "x")), "spam words / caps / !!! flagged")
check(any("preview text" in x.lower() for x in ai.subject_checks("New from Oakbridge: Sacred Tiger Tales", "")), "missing preview text flagged")
raw = {"subjects": ["Sacred Tiger Tales is here", "20% off Sacred Tiger Tales", "Last chance: tiger stories",
                    "{{first_name}}, a new book on tigers", "{{coupon}} inside", "Sacred Tiger Tales is here"],
       "preheader": "Free shipping today"}
v, _ = ai.validate_subjects(raw, "New book: Sacred Tiger Tales", "", "Sacred Tiger Tales, Vedic hymns to tigers {{first_name}}")
check(v and v["subjects"] == ["Sacred Tiger Tales is here", "{{first_name}}, a new book on tigers"],
      "no invented discount, deadline or unknown variable; duplicates removed")
check(v["preheader"] == "", "a preview text promising free shipping is dropped")
v, _ = ai.validate_subjects(raw, "20% off Sacred Tiger Tales", "", "")
check(v and "20% off Sacred Tiger Tales" not in v["subjects"] and "Sacred Tiger Tales is here" in v["subjects"],
      "an offer the team wrote may be kept; the original itself isn't echoed back")

print("-- wiring --")
ROOT = os.path.dirname(os.path.dirname(HERE))
srv = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
api = open(os.path.join(ROOT, "backend", "ai_insights.py"), encoding="utf-8").read()
check("app.include_router(marketing_ai_admin_router)" in srv, "AI router mounted")
check('prefix="/api/admin/marketing/ai"' in api and "dependencies=[Depends(require_admin)]" in api,
      "under Admin → Marketing permission")
check("ai.assert_no_pii(facts)" in api and "ai.validate_insight(" in api and "asyncio.wait_for(" in api,
      "every model call: privacy check first, reply validated, time-limited")
check('"contact_ids"' in api and 'if k != "contact_ids"' in api and "await _opportunities()" in api.split("ai_create_from_action")[1],
      "audiences are recomputed on the server and never sent to the browser")
check('"status": "draft"' in api.split("ai_create_from_action")[1], "'Do this next' only ever creates a DRAFT")
mk = open(os.path.join(ROOT, "frontend", "src", "pages", "admin", "AdminMarketing.jsx"), encoding="utf-8").read()
check(all(x in mk for x in ("<NextActions", "mkAiDeliverability(", "mkAiGrowth(period", "mkAiCampaign(id", "<SubjectCoach", "<AISwitch")),
      "cards on Dashboard, Growth, campaign report, subject line, Settings")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
