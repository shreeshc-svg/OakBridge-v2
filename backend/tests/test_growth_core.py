"""growth_core: channels, funnel, automation timing, Merchant feed.

Run: python backend/tests/test_growth_core.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import growth_core as g  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


print("-- channels --")
codes = {"KANNAN10"}
cases = [
    ({"ref": "kannan10", "utm_source": "email"}, "", "Partner"),
    ({}, "KANNAN10", "Partner"),
    ({"ref": "NOTAPARTNER"}, "", "Direct"),
    ({"utm_source": "email", "utm_medium": "campaign", "utm_campaign": "mk-abc12345"}, "", "Email"),
    ({"utm_campaign": "mk-auto-aba"}, "", "Email"),
    ({"utm_source": "whatsapp"}, "", "WhatsApp"),
    ({"utm_source": "google", "utm_medium": "shopping"}, "", "Google Shopping"),
    ({"utm_source": "google", "utm_medium": "cpc"}, "", "Paid ads"),
    ({"utm_source": "linkedin"}, "", "Social"),
    ({"utm_source": "partnersite"}, "", "Referral sites"),
    ({"referrer": "https://www.google.com/"}, "", "Search (organic)"),
    ({"referrer": "https://lnkd.in/xyz"}, "", "Social"),
    ({"referrer": "https://www.oakbridge.in/books"}, "", "Direct"),
    ({"referrer": "https://somelawblog.in/post"}, "", "Referral sites"),
    (None, "", "Direct"),
]
for attr, coupon, want in cases:
    got = g.channel_of(attr, coupon, codes)
    check(got == want, f"{attr} {coupon or ''} -> {want} (got {got})")

print("-- bots --")
check(g.is_bot("Mozilla/5.0 ... HeadlessChrome/120") and g.is_bot("Googlebot/2.1") and g.is_bot(""), "crawlers, headless and empty UA are bots")
check(not g.is_bot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1"), "a phone browser is not")

print("-- funnel --")
rows = g.funnel_rows({"Email": 100, "Direct": 50}, [{"channel": "Email", "paid": True, "total": 500}, {"channel": "Email", "paid": False, "total": 300},
                                                   {"channel": "Partner", "paid": True, "total": 400}])
e = next(r for r in rows if r["channel"] == "Email")
check(e["visits"] == 100 and e["checkouts"] == 2 and e["paid"] == 1 and e["revenue"] == 500.0 and e["visit_to_paid"] == 0.01 and e["checkout_to_paid"] == 0.5,
      "email row: visits, checkouts, paid, revenue, rates")
check(next(r for r in rows if r["channel"] == "Partner")["visit_to_paid"] is None, "no visits recorded -> no rate (not divide by zero)")

print("-- automation timing --")
now = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
o = {"email": "a@b.co", "payment_status": "pending", "created_at": (now - timedelta(hours=3)).isoformat()}
check(g.abandoned_due(o, now, 2), "3 h old unpaid checkout -> remind")
check(not g.abandoned_due({**o, "created_at": (now - timedelta(hours=1)).isoformat()}, now, 2), "too fresh -> wait")
check(not g.abandoned_due({**o, "created_at": (now - timedelta(hours=60)).isoformat()}, now, 2), "older than 48 h -> leave it")
check(not g.abandoned_due({**o, "payment_status": "paid"}, now, 2) and not g.abandoned_due({**o, "abandoned_email_at": "x"}, now, 2)
      and not g.abandoned_due({**o, "email": ""}, now, 2), "paid / already reminded / no email -> never")
d = {"email": "a@b.co", "payment_status": "paid", "status": "delivered",
     "status_history": [{"status": "shipped", "at": (now - timedelta(days=15)).isoformat()},
                        {"status": "delivered", "at": (now - timedelta(days=11)).isoformat()}]}
check(g.review_due(d, now, 10), "delivered 11 days ago, setting 10 -> ask for a review")
check(not g.review_due(d, now, 12), "setting 12 -> not yet")
check(not g.review_due({**d, "status": "shipped"}, now, 10) and not g.review_due({**d, "review_email_at": "x"}, now, 10), "not delivered / already asked -> never")
check(not g.review_due({**d, "status_history": [{"status": "delivered", "at": (now - timedelta(days=90)).isoformat()}]}, now, 10),
      "delivered long ago (before this existed) -> not asked out of the blue")

print("-- merchant feed --")
b = {"id": "x1", "title": "Compulsory English 6/e", "author": "A P Bhardwaj", "isbn": "9788199305229", "price": 500, "original_price": 625,
     "stock": 131, "description": "**Bestseller** <b>revised</b>", "publisher": "Oakbridge Publishing", "category": "academic"}
it = g.merchant_item(b, site="https://www.oakbridge.in", image_url="https://cdn/x.jpg")
check(it["price"] == "625.00 INR" and it["sale_price"] == "500.00 INR", "MRP as price, selling price as sale_price")
check(it["gtin"] == "9788199305229" and "identifier_exists" not in it, "valid ISBN-13 -> gtin")
check(it["availability"] == "in_stock" and it["title"] == "Compulsory English 6/e by A P Bhardwaj" and it["description"] == "Bestseller revised",
      "availability, title with author, plain description")
check("utm_medium=shopping" in it["link"], "link tagged so sales show as Google Shopping")
check(g.merchant_item({**b, "stock": 0}, site="s", image_url="i")["availability"] == "out_of_stock", "out of stock")
check(g.merchant_item({**b, "coming_soon": True, "launch_at": "2026-11-01T10:00"}, site="s", image_url="i")["availability"] == "preorder", "pre-order")
check(g.merchant_item({**b, "isbn": "123"}, site="s", image_url="i").get("identifier_exists") == "no", "no valid ISBN -> identifier_exists no")
check(g.merchant_item({**b, "enabled": False}, site="s", image_url="i") is None and g.merchant_item(b, site="s", image_url="") is None
      and g.merchant_item({**b, "price": 0}, site="s", image_url="i") is None, "hidden / no image / no price -> not listed")
xml = g.feed_xml([it, g.merchant_item({**b, "title": "A & B <c>"}, site="s", image_url="i")], site="https://www.oakbridge.in")
check(xml.startswith('<?xml') and 'xmlns:g="http://base.google.com/ns/1.0"' in xml and xml.count("<item>") == 2
      and "A &amp; B" in xml and "<c>" not in xml and "&amp;utm_medium=shopping" in xml and "<g:gtin>9788199305229</g:gtin>" in xml,
      "valid RSS with the g: namespace; & escaped, stray tags removed")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
