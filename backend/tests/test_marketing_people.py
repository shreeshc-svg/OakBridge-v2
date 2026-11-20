"""Who got which email (marketing_people.py) on the fake DB, with the REAL
renderer (marketing_core). Run: python backend/tests/test_marketing_people.py"""
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from _fakedb import DB  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(str(detail))
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: (lambda fn: fn)


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m


db = DB()
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None)
_mod("extensions", db=db, require_admin=None)


async def _fields(cid, lids):
    r = await db.mk_list_fields.find_one({"contact_id": cid, "list_id": {"$in": lids}})
    return (r or {}).get("fields") or {}


async def _settings():
    return {"logo": "", "footer": "Oakbridge"}


async def _picks(contact, camp, pool=None):
    contact["_picks"] = []
    return []

_mod("marketing", contact_fields=_fields, _camp_lists=lambda c: list((c.get("audience") or {}).get("list_ids") or []),
     _for_you_count=lambda c: 0, attach_picks=_picks, get_settings=_settings)

import marketing_people as P  # noqa: E402


async def main():
    for c in ({"id": "c1", "name": "Shivam Rastogi", "email": "shivam1292@gmail.com", "phone": "+91 98100 12345", "lists": ["L"],
               "email_status": "verified", "email_consent": {"status": "subscribed"}},
              {"id": "c2", "name": "Gaurisha Rastogi", "email": "rastogigaurisha04@gmail.com", "phone": "", "lists": ["L"]},
              {"id": "c3", "name": "Asha Verma", "email": "asha@x.in", "phone": "9876543210", "lists": []}):
        await db.mk_contacts.insert_one(c)
    await db.mk_lists.insert_one({"id": "L", "name": "VIDHI UTSAV Customer Data List"})
    await db.mk_list_fields.insert_one({"list_id": "L", "contact_id": "c1", "fields": {"offer_link": "https://www.oakbridge.events/offer/o/S1", "pass_no": "ILATS-0042"}})
    await db.mk_campaigns.insert_one({"id": "k1", "name": "Vidhi Utsav sheet reg. mail", "subject": "India Law, AI & Tech Summit is back!!",
                                      "channel": "email", "audience": {"list_ids": ["L"]},
                                      "blocks": [{"type": "heading", "text": "Hi {{first_name}}"},
                                                 {"type": "text", "text": "Your pass {{pass_no}}"},
                                                 {"type": "button", "label": "Book", "url": "{{offer_link}}"}]})
    await db.mk_campaigns.insert_one({"id": "auto-review", "name": "Automation: review request", "subject": "How are you finding your book?", "channel": "email"})
    sends = [{"id": "s1", "campaign_id": "k1", "contact_id": "c1", "to": "shivam1292@gmail.com", "status": "sent",
              "sent_at": "2026-11-03T12:18:33", "delivered_at": "2026-11-03T12:18:34", "opened_at": "2026-11-03T13:04:46"},
             {"id": "s2", "campaign_id": "k1", "contact_id": "c2", "to": "rastogigaurisha04@gmail.com", "status": "sent",
              "sent_at": "2026-11-03T09:52:18", "delivered_at": "2026-11-03T09:52:20"},
             {"id": "s3", "campaign_id": "k1", "contact_id": "gone", "to": "old.reader@yahoo.com", "status": "bounced", "sent_at": "2026-11-03T10:00:00"},
             {"id": "s4", "campaign_id": "auto-review", "contact_id": "c1", "to": "shivam1292@gmail.com", "status": "sent",
              "sent_at": "2026-11-10T08:00:00", "automation": "review", "order_id": "OB-123"}]
    for s in sends:
        await db.mk_sends.insert_one(s)

    print("-- find a person --")
    for q, label in (("shivam rastogi", "full name"), ("rastogi shivam", "words in any order"), ("SHIVAM1292", "part of the email, any case"),
                     ("98100 12345", "phone with spaces"), ("+91-9810012345", "phone with country code and dash")):
        r = await P.people(q)
        check(r["people"] and r["people"][0]["email"] == "shivam1292@gmail.com", f"{label}: '{q}'")
    r = await P.people("shivam")
    p = r["people"][0]
    check([s["campaign"] for s in p["sends"]] == ["Automation: review request", "Vidhi Utsav sheet reg. mail"],
          "his emails, newest first — campaigns AND automations")
    k = p["sends"][1]
    check(k["outcome"] == "opened" and k["at"] == "2026-11-03T12:18:33" and k["subject"].startswith("India Law"),
          "what (subject), when (sent), how far it got (opened)")
    check(p["lists"] == ["VIDHI UTSAV Customer Data List"], "which list he came from")
    r = await P.people("rastogi")
    check([x["name"] for x in r["people"]] == ["Gaurisha Rastogi", "Shivam Rastogi"], "every Rastogi, sorted")
    r = await P.people("old.reader")
    check(r["people"] and r["people"][0].get("removed") and r["people"][0]["sends"][0]["outcome"] == "bounced",
          "an address we mailed whose contact was deleted is still found")
    check((await P.people("a"))["people"] == [], "1 letter: no search (too broad)")
    check((await P.people("(+.*"))["people"] == [], "regex characters are just characters")

    print("-- one campaign's recipients --")
    r = await P.recipients("k1")
    check(r["total"] == 3 and r["counts"] == {"opened": 1, "delivered": 1, "bounced": 1}, "everyone, with outcome counts")
    r = await P.recipients("k1", q="rastogi")
    check(r["total"] == 2 and {x["name"] for x in r["rows"]} == {"Shivam Rastogi", "Gaurisha Rastogi"}, "search inside the campaign")
    r = await P.recipients("k1", outcome="bounced")
    check(r["total"] == 1 and r["rows"][0]["to"] == "old.reader@yahoo.com", "filter by outcome")
    r = await P.recipients("k1", q="98100")
    check(r["total"] == 1 and r["rows"][0]["phone"] == "+91 98100 12345", "by phone too")

    print("-- the email as he got it --")
    e = await P.send_email("s1")
    check("Hi Shivam" in e["html"] and "ILATS-0042" in e["html"] and 'href="https://www.oakbridge.events/offer/o/S1"' in e["html"],
          "his name, his pass number, his own link")
    check(e["at"] == "2026-11-03T12:18:33" and e["outcome"] == "opened" and e["to"] == "shivam1292@gmail.com", "with when / to / outcome")
    e = await P.send_email("s4")
    check(e["html"] == "" and "Automated email" in e["note"] and "OB-123" in e["note"], "automation: says what and which order")


asyncio.run(main())
print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
sys.exit(1 if failed else 0)
