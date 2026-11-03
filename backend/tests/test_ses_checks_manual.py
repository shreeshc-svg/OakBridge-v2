"""Paid Amazon SES mailbox checks never run on their own (Nov 2026: the
every-minute tick and each sign-up/import were spending the monthly budget).

Paid checks may run only from: the admin's "Check unverified addresses now"
(after an estimate + confirm), an import where the admin ticked SES, or a
campaign Send (cost shown in the confirmation). Static checks on marketing.py.

Run: python backend/tests/test_ses_checks_manual.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = "\n".join(l for l in open(os.path.join(ROOT, "marketing.py"), encoding="utf-8").read().splitlines()
                if not l.strip().startswith("#"))
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


vp = SRC.split("async def validate_pending")[1].split("\nasync def ")[0]
check("paid: bool = False" in vp, "validate_pending is free unless paid=True")
check('live = paid and bool(st.get("ses_validation"))' in vp, "paid checks need paid=True AND the Settings switch")
check('ses="live" if live else "cache"' in vp, "the free pass asks SES nothing new")
kv = SRC.split("def kick_validation")[1].split("\ndef ")[0].split("\nasync def ")[0]
check("paid: bool = False" in kv and '{"paid": paid}' in kv, "kick_validation() is free by default")
# Every automatic kick (tick, imports, sign-ups, re-verify) is the free one.
kicks = re.findall(r"kick_validation\(([^)]*)\)", SRC)
check(kicks.count("paid=True") == 1, "exactly one paid kick")
paid_site = SRC.split("kick_validation(paid=True)")[0].rsplit("@admin_router", 1)[1]
check('post("/validate-pending")' in paid_site, "...and it is the admin's 'Check now' endpoint")
check('ses="live", ignore_erased=True' not in SRC, "website sign-up uses free checks only")
check('validate_pending(paid=bool((p or {}).get("paid")))' in SRC, "background job passes paid through (default free)")
ui = open(os.path.join(ROOT, "..", "frontend", "src", "pages", "admin", "AdminMarketing.jsx"), encoding="utf-8").read()
check("window.confirm(`Check ${e.will_check}" in ui and "mkValidateEstimate" in ui, "admin sees count + cost and confirms first")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
