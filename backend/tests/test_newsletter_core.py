"""newsletter_core: schedule maths in IST, settings validation, issue assembly
and the "never send an empty issue" rule.

Run: python backend/tests/test_newsletter_core.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import newsletter_core as N  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def ist(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=N.IST).astimezone(timezone.utc)


print("-- validation --")
cfg = N.validate({})
check(cfg["frequency"] == "monthly" and cfg["mode"] == "approve" and not cfg["enabled"], "safe defaults: monthly, approval, off")
for bad in [{"frequency": "daily"}, {"time": "25:00"}, {"weekday": 7}, {"mode": "yolo"}, {"week_of_month": 5}]:
    try:
        N.validate(bad)
        check(False, f"rejects {bad}")
    except ValueError:
        check(True, f"rejects {bad}")
check(N.validate({"lead_days": 99})["lead_days"] == 7 and N.validate({"max_books": 0})["max_books"] == 1, "limits clamped")

print("-- schedule (IST) --")
m = N.validate({"frequency": "monthly", "weekday": 1, "week_of_month": 1, "time": "10:30"})
# 1st Tuesday of Oct 2026 = 6 Oct; of Nov 2026 = 3 Nov
check(N.next_slot(m, ist(2026, 10, 1)) == ist(2026, 10, 6, 10, 30), "monthly: 1st Tuesday of this month")
check(N.next_slot(m, ist(2026, 10, 6, 10, 30)) == ist(2026, 11, 3, 10, 30), "monthly: strictly after -> next month")
check(N.next_slot(m, ist(2026, 12, 20)) == ist(2027, 1, 5, 10, 30), "monthly: rolls over the year")
check(N.next_slot(m, ist(2026, 10, 1)).hour == 5 and N.next_slot(m, ist(2026, 10, 1)).minute == 0, "10:30 IST is 05:00 UTC")
w = N.validate({"frequency": "weekly", "weekday": 4, "time": "09:00"})
check(N.next_slot(w, ist(2026, 10, 13, 12)) == ist(2026, 10, 16, 9), "weekly: next Friday")
check(N.next_slot(w, ist(2026, 10, 16, 9)) == ist(2026, 10, 23, 9), "weekly: same moment -> following week")
f = N.validate({"frequency": "fortnightly", "weekday": 1, "time": "10:30"})
last = ist(2026, 10, 6, 10, 30)
check(N.next_slot(f, ist(2026, 10, 7), last_slot=last) == ist(2026, 10, 20, 10, 30), "fortnightly: two weeks after the last issue")
check(N.next_slot(f, ist(2026, 10, 7)) == ist(2026, 10, 13, 10, 30), "fortnightly with no history: next slot")
check(N.describe(m) == "Monthly — 1st Tuesday at 10:30 IST" and "Every two weeks" in N.describe(f), "human description")

print("-- issue assembly --")
books = [{"id": f"b{i}", "title": f"Book {i}", "author": "A", "price": 499, "cover_image": f"/api/files/c{i}.jpg"} for i in range(10)]
slot = ist(2026, 11, 3, 10, 30)
iss = N.build_issue(m, new_books=books[:5], best_books=books[3:9], slot=slot, site="https://www.oakbridge.in", cover_base="https://api.oakbridge.in")
check(iss["counts"] == {"new_releases": 4, "bestsellers": 4, "announcement": 0}, f"max 4 per section {iss['counts']}")
check(not set(iss["new_ids"]) & set(iss["book_ids"][4:]), "a new release is not repeated as a bestseller")
bb = [b for b in iss["blocks"] if b["type"] == "book"][0]
check(bb["cover"] == "https://api.oakbridge.in/api/files/c0.jpg" and bb["url"] == "https://www.oakbridge.in/books/b0" and bb["price"] == "₹499",
      "book block: absolute cover, book URL, price")
check(iss["subject"] == "New from Oakbridge — November 2026" and "this month" in iss["blocks"][1]["text"], "subject/intro filled")
check(iss["enough"], "enough content")
empty = N.build_issue(m, new_books=[], best_books=books, slot=slot, site="https://x", cover_base="https://x")
check(not empty["enough"] and "nothing new" in empty["reason"], "bestsellers alone -> skipped (never resend the same list)")
thin = N.build_issue(m, new_books=books[:1], best_books=[], slot=slot, site="https://x", cover_base="https://x")
check(not thin["enough"] and "minimum" in thin["reason"], "too few books -> skipped")
ann_cfg = N.validate({"sections": {"announcement": True, "new_releases": True, "bestsellers": False},
                      "announcement": {"title": "Law Summit 2026", "text": "Join us in Delhi.", "button_label": "Register",
                                       "button_url": "https://www.oakbridge.in/events"}})
a = N.build_issue(ann_cfg, new_books=[], best_books=[], slot=slot, site="https://x", cover_base="https://x")
check(a["enough"] and any(b.get("label") == "Register" for b in a["blocks"]), "an announcement alone is worth sending")
bad_btn = N.validate({"sections": {"announcement": True}, "announcement": {"title": "T", "button_label": "Go", "button_url": "javascript:alert(1)"}})
check(not any(b.get("type") == "button" and b.get("label") == "Go"
              for b in N.build_issue(bad_btn, new_books=[], best_books=[], slot=slot, site="https://x", cover_base="https://x")["blocks"]),
      "announcement button only for https links")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
