"""
Where the parcel goes when that is not where the invoice goes.

    python backend/tests/test_gift_delivery.py

shipping_address() is one function on purpose: every consumer that prints an
address -- the receipt, the packing email, the invoice's Consignee box, the
orders CSV -- asks it rather than deciding for itself. The failure this guards
against is not an exception. It is a Rakhi gift delivered, politely and on time,
to the person who bought it.
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

failures = []


def check(cond, label):
    print(("ok   " if cond else "FAIL "), label)
    if not cond:
        failures.append(label)


tree = ast.parse(open(os.path.join(BACKEND, "emailer.py"), encoding="utf-8").read())
fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "shipping_address"]
assert fn, "shipping_address not found in emailer.py"
ns: dict = {}
exec(compile(ast.Module(body=fn, type_ignores=[]), "<emailer>", "exec"), ns)
ship = ns["shipping_address"]

BILL = {
    "full_name": "Meera Sharma", "phone": "9820011111",
    "address_line1": "14 Carmichael Road", "address_line2": "Flat 3",
    "city": "Mumbai", "state": "Maharashtra", "pincode": "400026",
}
GIFT = {
    "deliver_elsewhere": True,
    "delivery_name": "Arjun Sharma", "delivery_phone": "9811122222",
    "delivery_address_line1": "22 Curzon Road", "delivery_address_line2": "",
    "delivery_city": "New Delhi", "delivery_state": "Delhi", "delivery_pincode": "110001",
}

print("-- an ordinary order --")
a = ship(dict(BILL))
check(a["line1"] == "14 Carmichael Road", "ships to the billing address")
check(a["name"] == "Meera Sharma", "in the buyer's name")
check(a["is_gift"] is False, "and is not marked a gift")

print("\n-- a gift order --")
a = ship({**BILL, **GIFT})
check(a["line1"] == "22 Curzon Road", "ships to the recipient")
check(a["city"] == "New Delhi" and a["pincode"] == "110001", "recipient's city and pincode, not the buyer's")
check(a["name"] == "Arjun Sharma", "in the recipient's name")
check(a["phone"] == "9811122222", "with the recipient's phone — the courier calls the door, not the buyer")
check(a["is_gift"] is True, "and is marked a gift")

print("\n-- the ways a gift address can be half-filled --")
check(ship({**BILL, **GIFT, "delivery_address_line1": ""})["line1"] == "14 Carmichael Road",
      "ticked but no street: falls back to billing rather than shipping to nowhere")
check(ship({**BILL, **GIFT, "delivery_address_line1": "   "})["is_gift"] is False,
      "whitespace is not an address")
check(ship({**BILL, **GIFT, "deliver_elsewhere": False})["line1"] == "14 Carmichael Road",
      "unticked wins even when the fields were filled in and then abandoned")
check(ship({**BILL, **GIFT, "delivery_name": ""})["name"] == "Meera Sharma",
      "no recipient name falls back to a name, never to blank")
check(ship({**BILL, **GIFT, "delivery_name": "", "gift_recipient": "Arjun"})["name"] == "Arjun",
      "the name from the product page is used before the buyer's")
check(ship({**BILL, **GIFT, "delivery_phone": ""})["phone"] == "9820011111",
      "no recipient phone falls back to the buyer's, so the courier has someone to call")

print("\n-- an order placed before any of this existed --")
old = {k: v for k, v in BILL.items()}
a = ship(old)
check(a["is_gift"] is False and a["line1"] == "14 Carmichael Road",
      "no gift keys at all behaves exactly as before")
check(ship({})["line1"] == "" and ship({})["is_gift"] is False,
      "an empty order does not raise")

print("\n-- every consumer asks the one function --")
emailer = open(os.path.join(BACKEND, "emailer.py"), encoding="utf-8").read()
invoice = open(os.path.join(BACKEND, "invoice.py"), encoding="utf-8").read()
check("shipping_address" in invoice, "the invoice's Consignee box uses it")
check(invoice.count("_party(\"Consignee (Ship to)\", _ship") == 1,
      "and passes the shipping name and lines, not the buyer's")
ship_to = re.search(r"def _ship_to.*?(?=\ndef |\Z)", emailer, re.S).group(0)
check("shipping_address(order)" in ship_to, "the packing email uses it")
check("do not enclose the invoice" in ship_to.lower() or "GIFT" in ship_to,
      "and warns the packer not to put the invoice in a gift box")
receipt = re.search(r"def render_order_receipt_html.*?(?=\ndef |\Z)", emailer, re.S).group(0)
check("shipping_address(order)" in receipt,
      "the customer's receipt shows where it is going, not where it is billed")

print("\n-- the orders CSV stays aligned --")
ext = open(os.path.join(BACKEND, "extensions.py"), encoding="utf-8").read()
etree = ast.parse(ext)
efn = next(n for n in ast.walk(etree)
           if isinstance(n, ast.AsyncFunctionDef) and n.name == "admin_export_orders")
call = next(n for n in ast.walk(efn)
            if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "csv_response")
header = call.args[1]
row = next(n for n in ast.walk(call.args[2]) if isinstance(n, ast.List) and n is not header)
check(len(header.elts) == len(row.elts),
      f"header {len(header.elts)} == row {len(row.elts)} — a short header slides every "
      "later column left and the courier is the first to notice")
check(any(getattr(e, "value", "") == "deliver_address_1" for e in header.elts),
      "the delivery address is exported for the courier upload")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
