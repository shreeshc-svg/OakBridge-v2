"""Campaign activity & audit log (marketing.py) — wiring checks.

Run: python backend/tests/test_campaign_activity.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(ROOT, "backend", "marketing.py"), encoding="utf-8").read()
code = re.sub(r'"""[\s\S]*?"""', "", src)
code = "\n".join(x for x in code.splitlines() if not x.strip().startswith("#"))

print("-- every action leaves a line with WHO did it --")
check('audit_log(db, "MARKETING_CAMPAIGN_SEND", email=by_email' in code, "Send (who pressed it, how many, schedule)")
check('audit_log(db, f"MARKETING_CAMPAIGN_{action.upper()}", email=user.get("email", "")' in code, "Pause / Resume / Cancel")
check(code.count('audit_log(db, "MARKETING_CAMPAIGN_TEST"') == 2, "test sends, email and WhatsApp")
patch = code[code.index("async def adm_patch_campaign"):code.index("class RenameBody")]
check("user: dict = Depends(require_admin)" in patch and 'upd["updated_by"] = user.get("email", "")' in patch
      and '"MARKETING_CAMPAIGN_EDITED"' in patch and "timedelta(minutes=10)" in patch,
      "edits record who, and log once per person per 10 min (not per keystroke)")
wa = code[code.index('meta={"campaign": cid, "channel": "whatsapp"'):][:120]
check("[-4:]" in wa, "a WhatsApp test number is logged as its last 4 digits only")

print("-- the activity endpoint --")
act = code[code.index("async def adm_campaign_activity"):code.index('@admin_router.get("/campaigns/{cid}/report")')]
check('db.audit_events.find({"meta.campaign": cid}' in act, "reads the audit log for this campaign")
check('"approved_by": 1' in act and 'db.mk_imports.find_one({"list_id": lid}' in act, "each list: who created it, who approved its import, the file")
check(all(k in act for k in ("checks_minutes", "sending_minutes", "per_minute", "minutes_to_first_open", "revenue_per_100_sent")),
      "metrics: check time, send time and rate, time to first open/click, revenue per 100 sent")
check('"who": "system", "what": "Paused automatically"' in act, "automatic pauses shown as the system, with the reason")

app = open(os.path.join(ROOT, "frontend", "src", "pages", "admin", "AdminMarketing.jsx"), encoding="utf-8").read()
check("<CampaignActivity id={id} status={c.status} />" in app and "approved by <b>{l.import.approved_by" in app,
      "shown on every campaign (draft and sent), with the approver")
print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
