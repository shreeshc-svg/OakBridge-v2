"""Admin → Orders → "Ask to pay another way": the payment-link email asks the
customer to pay with a different method — for EVERY unpaid order (declined,
bounced or abandoned), no condition on the payment status.

Run: python backend/tests/test_payment_retry_email.py
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


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


for status in ("failed", "pending", "bounced", None):
    o = {"full_name": "Asha <b>Rao</b>", "order_number": "OB-1", "total": 485, "payment_status": status,
         "items": [{"title": "Software Protection", "quantity": 1}]}
    h = emailer.render_payment_link_html(o, "https://www.oakbridge.in/pay/x?t=y")
    check("Try a different way to pay" in h and "UPI" in h and "net banking" in h and "Pay another way" in h
          and "reverses it automatically" in h, f"status {status}: try-another-way email")
    check("<b>Rao</b>" not in h, f"status {status}: name escaped")

ui = open(os.path.join(HERE, "..", "..", "frontend", "src", "pages", "admin", "AdminOrders.jsx"), encoding="utf-8").read()
check('"Ask to pay another way"' in ui and 'o.payment_status === "failed" ?' not in ui,
      "Admin → Orders: same button for every unpaid order")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
