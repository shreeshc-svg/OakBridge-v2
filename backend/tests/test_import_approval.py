"""Marketing import approval (backend/marketing.py), the pure parts pulled out
with ast — marketing.py itself needs the whole app.

* who may approve a staged import (not the uploader, unless superadmin; only a
  superadmin when it re-adds erased people);
* a re-confirm / permission campaign may reach contacts imported as "not known
  to us" (permission_pending) — and nobody who said no; ordinary campaigns
  still reach only subscribed contacts.

Run: python backend/tests/test_import_approval.py
"""
import ast
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _fakedb import DB, _match  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
want = {"_approval_refusal", "audience_filter", "_contact_filter"}
fns = [n for n in ast.parse(src).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want]
assert {f.name for f in fns} == want
dead = [n for n in ast.parse(src).body if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "DEAD_STATUSES" for t in n.targets)]
rbac = types.ModuleType("rbac")
rbac.is_superadmin = lambda r: r == "superadmin"
sys.modules["rbac"] = rbac
core = types.SimpleNamespace(selected_statuses=lambda aud: {"verified", "valid", "risky"})


async def _rule_emails(r):
    return None

ns = {"core": core, "_rule_emails": _rule_emails, "Optional": __import__("typing").Optional}
ns["re"] = __import__("re")
exec(compile(ast.Module(body=dead + fns, type_ignores=[]), "<marketing>", "exec"), ns)
refusal, audience_filter, contact_filter = ns["_approval_refusal"], ns["audience_filter"], ns["_contact_filter"]

print("-- who may approve --")
imp = {"status": "pending", "by": "rohan@oakbridge.in"}
check(refusal(imp, {"email": "rohan@oakbridge.in", "role": "admin"}) is not None, "the uploader cannot approve their own import")
check(refusal(imp, {"email": "ROHAN@oakbridge.in", "role": "admin"}) is not None, "…whatever the capitalisation")
check(refusal(imp, {"email": "ops@oakbridge.in", "role": "admin"}) is None, "someone else with Marketing access can")
check(refusal(imp, {"email": "rohan@oakbridge.in", "role": "superadmin"}) is None, "a superadmin may approve their own")
check(refusal({**imp, "readd_erased": True}, {"email": "ops@oakbridge.in", "role": "admin"}) is not None,
      "re-adding erased people needs a superadmin approver")
check(refusal({**imp, "status": "approved"}, {"email": "ops@oakbridge.in", "role": "superadmin"}) == "Already decided.",
      "a decided import cannot be approved again")


async def audience():
    db = DB()
    people = [
        {"id": "sub", "email_consent": {"status": "subscribed"}, "email_status": "valid", "lists": ["L"]},
        {"id": "new", "email_consent": {"status": "none"}, "permission_pending": True, "email_status": "valid", "lists": ["L"]},
        {"id": "unsub", "email_consent": {"status": "unsubscribed"}, "permission_pending": True, "email_status": "valid", "lists": ["L"]},
        {"id": "lapsed", "email_consent": {"status": "lapsed"}, "permission_pending": True, "email_status": "valid", "lists": ["L"]},
        {"id": "plain", "email_consent": {"status": "none"}, "email_status": "valid", "lists": ["L"]},
        {"id": "bounced", "email_consent": {"status": "none"}, "permission_pending": True, "email_status": "valid", "suppressed": "hard bounce", "lists": ["L"]},
    ]
    for p in people:
        await db.c.insert_one(p)
    aud = {"list_ids": ["L"], "statuses": ["verified", "valid", "risky"]}
    std = await audience_filter({"channel": "email", "kind": "standard", "audience": aud})
    rec = await audience_filter({"channel": "email", "kind": "reconfirm", "audience": aud})
    who = lambda f: sorted(p["id"] for p in people if _match(p, f))  # noqa: E731
    check(who(std) == ["sub"], f"an ordinary campaign reaches only subscribed people ({who(std)})")
    check(who(rec) == ["new", "sub"], f"a permission email also reaches 'not known to us' imports, nobody who said no ({who(rec)})")

asyncio.run(audience())

print("-- Contacts list: bounced & invalid hidden, not deleted --")
cs = [{"id": "ok", "email_status": "valid"}, {"id": "b", "email_status": "suppressed"}, {"id": "i", "email_status": "invalid"},
      {"id": "v", "email_status": "verified"}]
pick = lambda f: sorted(c["id"] for c in cs if _match(c, f))  # noqa: E731
check(pick(contact_filter()) == ["ok", "v"], "default view hides bounced and invalid")
check(pick(contact_filter(removed="only")) == ["b", "i"], "'only' shows just them")
check(pick(contact_filter(removed="show")) == ["b", "i", "ok", "v"], "'show all' shows everyone")
check(pick(contact_filter(status="suppressed")) == ["b"], "an explicit status filter wins")
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
