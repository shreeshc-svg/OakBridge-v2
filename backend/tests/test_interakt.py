"""Interakt (WhatsApp) — the rules that matter, without fastapi or a database.

Functions are pulled out of interakt.py with ast and run against small stubs:
phone parsing, template variables (never empty — WhatsApp rejects those),
send-once deduping, Off/Test/Live, consent, delivery-status progression, and
STOP handling on an incoming reply.

Run: python backend/tests/test_interakt.py
"""
import ast
import asyncio
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "interakt.py")
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


tree = ast.parse(open(SRC, encoding="utf-8").read())
WANT = {"split_phone", "phone_rx", "_val", "first_name", "money", "template_values", "items_summary", "status_from_type",
        "send_template", "_finish", "handle_event", "on_order_paid", "on_order_status", "on_cart_reminder", "KINDS", "_RANK"}
body = [n for n in tree.body if (isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in WANT)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in WANT for t in n.targets))]


class R:
    def __init__(self, upserted_id=None, modified_count=1):
        self.upserted_id, self.modified_count = upserted_id, modified_count


def match(doc, flt):
    for k, v in flt.items():
        if isinstance(v, dict) and "$regex" in v:
            if not re.search(v["$regex"], str(doc.get(k, "")), re.I if "i" in v.get("$options", "") else 0):
                return False
        elif doc.get(k) != v:
            return False
    return True


class Coll:
    def __init__(self):
        self.docs = []

    async def find_one(self, flt, proj=None, sort=None):
        return next((dict(d) for d in self.docs if match(d, flt)), None)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, flt, patch, upsert=False):
        d = next((d for d in self.docs if match(d, flt)), None)
        if d is None:
            if not upsert:
                return R(None, 0)
            d = dict(patch.get("$setOnInsert", {}))
            d.update({k: v for k, v in flt.items() if not isinstance(v, dict)})
            d.update(patch.get("$set", {}))
            self.docs.append(d)
            return R(upserted_id="new")
        for k, v in patch.get("$set", {}).items():
            d[k] = v
        for k, v in patch.get("$push", {}).items():
            d.setdefault(k, []).append(v)
        for k, v in patch.get("$inc", {}).items():
            d[k] = d.get(k, 0) + v
        return R(None, 1)

    def find(self, flt, proj=None):
        docs = [dict(d) for d in self.docs if match(d, flt)]

        class Cur:
            def __aiter__(self):
                self.i = iter(docs)
                return self

            async def __anext__(self):
                try:
                    return next(self.i)
                except StopIteration:
                    raise StopAsyncIteration

        return Cur()


class DB:
    def __init__(self):
        for n in ("wa_messages", "wa_replies", "wa_optouts", "users", "orders"):
            setattr(self, n, Coll())


CFG = {"mode": "live", "test_phone": "+91 90000 00001", "language": "en", "sync_customers": True,
       "templates": {"order_confirmed": "order_confirmed", "order_shipped": "order_shipped",
                     "order_cancelled": "order_cancelled", "cart_reminder": "cart_reminder"}}
SENT = []


def make_ns():
    db = DB()

    async def get_cfg():
        return dict(CFG)

    async def _ensure_index():
        return None

    async def _track(order):
        return None

    async def to_thread(fn, *a):
        return fn(*a)

    def _post(path, body):
        SENT.append((path, body))
        return True, {"result": True, "id": f"iid-{len(SENT)}"}

    ns = {"db": db, "re": re, "json": json, "uuid": __import__("uuid"), "asyncio": type("A", (), {"to_thread": staticmethod(to_thread)}),
          "log": type("L", (), {"exception": staticmethod(lambda *a, **k: None), "warning": staticmethod(lambda *a, **k: None)}),
          "get_cfg": get_cfg, "_ensure_index": _ensure_index, "_track": _track, "_post": _post,
          "_api_key": lambda: "k", "_now": lambda: "2026-10-08T10:00:00+00:00", "SITE": "https://www.oakbridge.in",
          "Optional": __import__("typing").Optional}
    exec(compile(ast.Module(body=body, type_ignores=[]), "<interakt>", "exec"), ns)
    return ns


ns = make_ns()
run = asyncio.run

print("-- phone numbers --")
sp = ns["split_phone"]
check(sp("+91 98765 43210") == ("+91", "9876543210"), "+91 with spaces")
check(sp("09876543210") == ("+91", "9876543210") and sp("919876543210") == ("+91", "9876543210"), "trunk 0 and 91-prefixed")
check(sp("12345") is None and sp("+91 5123456789") is None, "too short, or not an Indian mobile -> not used")
check(sp("+1 415 555 0100") == ("+1", "4155550100"), "other countries keep their code")

print("-- template values --")
tv = ns["template_values"]
v = tv("order_shipped", {"name": "", "order_number": "OAK-1", "courier": "", "tracking_id": None})
check(v == ["there", "OAK-1", "our courier partner", "shared by email"], f"no empty variables (WhatsApp rejects them) {v}")
check(tv("order_confirmed", {"name": "Rohan Kapoor", "order_number": "OAK-2", "total": 1716, "items": "A\nB"})[0:4]
      == ["Rohan", "OAK-2", "₹1,716", "A B"], "first name, rupees, no newlines")
check(tv("cart_reminder", {"name": "X", "first_item": "IR", "more": "and 2 more"})[3] == "https://www.oakbridge.in/cart", "cart link")
check(ns["items_summary"]([{"title": "GENDERING CLIMATE FUTURES - Power"}, {"title": "B"}]) == "GENDERING CLIMATE FUTURES + 1 more", "items summary")

print("-- status from webhook type --")
st = ns["status_from_type"]
check(st("message_api_delivered") == "delivered" and st("message_campaign_read") == "read" and st("message_received") is None, "status names")

print("-- sending: once, consent, modes --")
order = {"id": "o1", "order_number": "OAK-1", "full_name": "Asha V", "phone": "+91 98765 43210", "total": 396,
         "items": [{"title": "Book"}], "wa_optin": True}
SENT.clear()
run(ns["on_order_paid"](order))
run(ns["on_order_paid"](order))       # webhook + browser confirming the same order
check(len([s for s in SENT if s[0] == "/message/"]) == 1, "order confirmed is sent once, however often payment is confirmed")
check(SENT[0][1]["phoneNumber"] == "9876543210" and SENT[0][1]["template"]["bodyValues"][1] == "OAK-1", "to the buyer, with the order number")
rec = ns["db"].wa_messages.docs[0]
check(rec["status"] == "accepted" and rec["interakt_id"] == "iid-1", "logged with Interakt's message id")

SENT.clear()
run(ns["on_order_paid"]({**order, "id": "o2", "wa_optin": False}))
check(not SENT, "no WhatsApp when the buyer unticked order updates")

SENT.clear()
CFG["mode"] = "test"
run(ns["on_order_paid"]({**order, "id": "o3"}))
check(SENT and SENT[0][1]["phoneNumber"] == "9000000001", "Test mode sends to the test number, not the customer")
CFG["mode"] = "off"
SENT.clear()
run(ns["on_order_paid"]({**order, "id": "o4"}))
check(not SENT, "Off sends nothing")
CFG["mode"] = "live"

SENT.clear()
o5 = {**order, "id": "o5", "courier": "Delhivery", "tracking_id": "AWB1"}
run(ns["on_order_status"](o5, "shipped"))
run(ns["on_order_status"](o5, "shipped"))
run(ns["on_order_status"]({**o5, "tracking_id": "AWB2"}, "shipped"))
check(len(SENT) == 2, "shipped: a double click sends once; a corrected tracking number sends again")
check(run(ns["on_order_status"](o5, "processing")) is None, "statuses without a template send nothing")

print("-- webhooks --")
he = ns["handle_event"]
run(he("message_api_read", {"message": {"id": "iid-1"}}))
run(he("message_api_delivered", {"message": {"id": "iid-1"}}))   # late, out of order
rec = ns["db"].wa_messages.docs[0]
check(rec["status"] == "read", "status only moves forward (a late 'delivered' does not undo 'read')")
run(he("message_api_failed", {"message": {"id": "iid-1", "channel_failure_reason": "number not on WhatsApp"}}))
check(ns["db"].wa_messages.docs[0]["status"] == "failed" and "not on WhatsApp" in ns["db"].wa_messages.docs[0]["error"], "failure recorded with its reason")

ns["db"].orders.docs.append({"id": "o1", "order_number": "OAK-1", "phone": "+91 98765 43210"})
ns["db"].users.docs.append({"id": "u1", "phone": "9876543210", "wa_marketing_optin": True})
run(he("message_received", {"customer": {"country_code": "+91", "phone_number": "9876543210", "traits": {"name": "Asha"}},
                             "message": {"message": "Where is my parcel?", "media_url": "javascript:alert(1)"}}))
r0 = ns["db"].wa_replies.docs[0]
check(r0["order_number"] == "OAK-1" and r0["text"] == "Where is my parcel?", "reply linked to the customer's order by phone")
check(r0["media_url"] == "", "a non-https attachment link is dropped (it is shown as a link in Admin)")
check(ns["db"].orders.docs[0].get("wa_replies") == 1, "order shows its reply count")
run(he("message_received", {"customer": {"country_code": "+91", "phone_number": "9876543210"}, "message": {"message": " STOP "}}))
check(ns["db"].users.docs[0]["wa_marketing_optin"] is False and ns["db"].wa_optouts.docs, "STOP turns reminders off for that number")
SENT.clear()
run(ns["on_cart_reminder"]("u1", [{"title": "IR"}], "t1"))
check(not SENT, "no cart reminder after STOP")

print("-- real Interakt delivery report (2026-10-08) --")
db2 = ns["db"]
db2.wa_messages.docs.append({"id": "41fe98a2", "kind": "order_cancelled", "status": "accepted", "interakt_id": "something-else"})
real = {"customer": {"channel_phone_number": "918796811392", "phone_number": "8796811392", "country_code": "+91"},
        "message": {"id": "c78ba698-not-ours", "message_status": "Delivered", "channel_failure_reason": None,
                    "raw_template": json.dumps({"name": "order_cancelled", "category": "MARKETING"}),
                    "meta_data": {"source_data": {"callback_data": json.dumps({"m": "41fe98a2", "k": "order_cancelled", "o": ""})},
                                  "message_cost": {"whatsapp_cost": "0.86", "interakt_markup": "0.1", "actual_message_cost": "0.958041"}}}}
run(he("message_api_delivered", real))
m = next(d for d in db2.wa_messages.docs if d["id"] == "41fe98a2")
check(m["status"] == "delivered", "matched through meta_data.source_data.callback_data when the id differs")
check(m.get("cost") == 0.958 and m.get("template_category") == "MARKETING", "cost and Meta's template category stored")

print("-- webhook URL --")
src_txt = open(SRC, encoding="utf-8").read()
check("quote(secret, safe='')" in src_txt and '"webhook_secret_weak": weak' in src_txt,
      "a secret with # or @ is percent-encoded in the URL, and a short/symbol secret is flagged in Admin")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
