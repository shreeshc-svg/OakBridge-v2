"""Write-off of an unpaid order -> the customer gets one last "don't miss out"
email with a fresh payment link. Every pressure line in it must be TRUE.

Run: python backend/tests/test_last_chance_email.py
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)


class _Any(types.ModuleType):
    def __getattr__(self, n):
        return lambda *a, **k: None


for m in ("resend", "boto3", "botocore", "botocore.exceptions"):
    sys.modules.setdefault(m, _Any(m))
import emailer  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


o = {"full_name": "Asha <b>Rao</b>", "order_number": "OB-1", "total": 968, "status": "bounced",
     "items": [{"title": "International Relations", "quantity": 1, "author": "Achal Priyadarshy"},
               {"title": "Ethical Leadership", "quantity": 1}]}
h = emailer.render_last_chance_html(o, "https://www.oakbridge.in/pay/x?t=y", 7)
check("slip away" in h and "Last chance" in h, "missing-out headline")
check("go back on sale" in h and "Straight from the publisher" in h, "true reasons to act: stock not held, publisher-direct")
check("closes in 7 days" in h, "link expiry stated from the real TTL")
check("Complete my order" in h and "https://www.oakbridge.in/pay/x?t=y" in h, "button carries the payment link")
check("International Relations" in h and "&#8377;968" in h, "books and total shown")
check("<b>Rao</b>" not in h, "name escaped")
low = h.lower()
check(not any(p in low for p in ("only 1 left", "only 2 left", "hours left", "minutes left", "selling fast", "last few copies")),
      "no invented scarcity or countdowns")
check("nothing has been charged" in h and "reverses it automatically" in h, "reassurance kept")
check("closes in 3 days" in emailer.render_last_chance_html(o, "u", 3), "days come from the caller (payments.PAYMENT_LINK_TTL_DAYS)")

ext = open(os.path.join(ROOT, "extensions.py"), encoding="utf-8").read()
fn = ext.split("async def admin_write_off_order")[1].split("\n@admin_router")[0]
check("send_last_chance(" in fn and "if payload.written_off and payload.notify and order.get(\"email\")" in fn,
      "write-off sends it only when the admin leaves 'email the customer' ticked (never on reversal)")
check("notify: bool = False" in ext, "API default is no email (an old client never emails by surprise)")
dlg = open(os.path.join(ROOT, "..", "frontend", "src", "components", "admin", "WriteOffDialog.jsx"), encoding="utf-8").read()
check('data-testid="write-off-notify"' in dlg and "notify: !undoing && notify" in dlg, "dialog: tick box, on by default, sent with the write-off")
check("The customer is not emailed.\n" not in dlg, "dialog no longer always claims the customer is not emailed")
check(fn.index('raise HTTPException(\n                status_code=400,\n                detail="This order is paid') < fn.index("send_last_chance("),
      "never sent for a paid order (refused before)")
check('"already": True}' in fn.split("send_last_chance(")[0], "double-click write-off returns early: no second email")
em = open(os.path.join(ROOT, "email_manager.py"), encoding="utf-8").read()
check('"key": "order_last_chance"' in em and '"order_last_chance": (' in em, "listed in Email manager with a preview")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
