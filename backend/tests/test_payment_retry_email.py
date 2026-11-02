"""Admin → Orders → "Ask to pay another way": the payment-link email changes
its wording when Razorpay DECLINED the payment (payment_status "failed").

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


o = {"full_name": "Asha <b>Rao</b>", "order_number": "OB-1", "total": 485, "payment_status": "failed",
     "items": [{"title": "Software Protection", "quantity": 1}]}
h = emailer.render_payment_link_html(o, "https://www.oakbridge.in/pay/x?t=y")
check("didn&#8217;t go through" in h and "Try a different way to pay" in h, "declined: says so and names other ways to pay")
check("UPI" in h and "net banking" in h, "declined: lists UPI / card / net banking / wallet")
check("Pay another way" in h and "Complete payment" not in h, "declined: button text")
check("reverses it automatically" in h, "declined: debit-reversal reassurance")
check("<b>Rao</b>" not in h, "customer name is escaped")
check(emailer.payment_failed(o), "payment_failed(): failed")

o["payment_status"] = "pending"
h = emailer.render_payment_link_html(o, "https://www.oakbridge.in/pay/x?t=y")
check("your order is waiting" in h and "Complete payment" in h, "walked away: original wording kept")
check("Try a different way" not in h and "reverses it automatically" not in h, "walked away: no decline wording")
check(not emailer.payment_failed(o) and not emailer.payment_failed({}), "payment_failed(): pending / missing")

ui = open(os.path.join(HERE, "..", "..", "frontend", "src", "pages", "admin", "AdminOrders.jsx"), encoding="utf-8").read()
check('"Ask to pay another way"' in ui, "Admin → Orders button reads 'Ask to pay another way' for failed payments")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
