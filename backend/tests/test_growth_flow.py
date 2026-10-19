"""growth.py end to end on the in-memory fake DB, with FastAPI / pydantic /
extensions / marketing stubbed (marketing_core and jobs are real).

* abandoned-checkout email: only with marketing consent, once per order,
  not after a later paid order, at most once a week per person;
* review request: after delivery + N days, books not yet reviewed, never to
  someone who unsubscribed;
* partner: creates a coupon, credits orders by code or link;
* visit beacon: bots ignored, channel recorded, no personal data.

Run: python backend/tests/test_growth_flow.py
"""
import asyncio
import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone

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


class Response:
    def __init__(self, content=b"", status_code=200, media_type="", headers=None):
        self.body, self.status_code, self.media_type = content, status_code, media_type


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def __getattr__(self, k):
        return None


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


async def _anoop(*a, **k):
    return None

_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None, Request=object)
_mod("fastapi.responses", Response=Response)
_mod("pydantic", BaseModel=BaseModel)
db = DB()
_mod("extensions", db=db, require_admin=None, require_superadmin=None, get_current_user=None)
_mod("audit", audit_log=_anoop)
_mod("emailer", media_url=lambda u: ("https://cdn" + u) if u and u.startswith("/") else u)

import marketing_core as core  # noqa: E402

sent = []


async def get_settings():
    return {"from_name": "Oakbridge", "from_email": "info@oakbridge.in", "footer": "Oakbridge", "logo": ""}


async def upsert_contact(email, *, name="", phone="", source="", email_consent=None, **k):
    norm = core.normalise_email(email)
    c = await db.mk_contacts.find_one({"email_norm": norm})
    if not c:
        c = {"id": f"c-{norm}", "email": email, "email_norm": norm, "name": name, "email_status": "valid", "suppressed": "",
             "email_consent": {"status": "none"}}
        await db.mk_contacts.insert_one(c)
    if email_consent == "subscribed" and c["email_consent"]["status"] not in ("unsubscribed", "complained"):
        await db.mk_contacts.update_one({"id": c["id"]}, {"$set": {"email_consent": {"status": "subscribed"}}})
    return await db.mk_contacts.find_one({"id": c["id"]})


def _links(sid):
    return {"open": f"o/{sid}", "unsub_page": f"u/{sid}", "unsub_post": f"up/{sid}", "click": lambda i: f"c/{sid}/{i}"}


def build_mime(*, st, to, subject, html_doc, text_doc, unsub_post):
    return json.dumps({"to": to, "subject": subject, "html": html_doc, "unsub": unsub_post}).encode()


def _send_raw(raw):
    sent.append(json.loads(raw))
    return f"mid-{len(sent)}"

_mod("marketing", SITE="https://www.oakbridge.in", get_settings=get_settings, upsert_contact=upsert_contact,
     _links=_links, build_mime=build_mime, _send_raw=_send_raw)

import growth  # noqa: E402

NOW = datetime.now(timezone.utc)
ago = lambda **kw: (NOW - timedelta(**kw)).isoformat()  # noqa: E731


async def main():
    await db.books.insert_one({"id": "b1", "title": "Compulsory English", "author": "A P Bhardwaj", "price": 500, "cover_image": "/api/files/x.jpg"})
    await db.books.insert_one({"id": "b2", "title": "Contracts", "author": "B Verma", "price": 716, "cover_image": ""})

    print("-- abandoned checkout --")
    await db.integrations.insert_one({"key": growth.AUTO_KEY, "abandoned": {"enabled": True, "delay_hours": 2},
                                      "review": {"enabled": True, "days_after_delivery": 10}})
    base = {"payment_status": "pending", "status": "pending", "created_at": ago(hours=3), "items": [{"book_id": "b1", "quantity": 1}]}
    await db.orders.insert_one({**base, "id": "o1", "order_number": "OAK-1", "email": "optin@x.com", "full_name": "Asha Verma", "email_marketing_optin": True})
    await db.orders.insert_one({**base, "id": "o2", "order_number": "OAK-2", "email": "nocons@x.com", "full_name": "No Consent"})
    await db.orders.insert_one({**base, "id": "o3", "order_number": "OAK-3", "email": "later@x.com", "email_marketing_optin": True})
    await db.orders.insert_one({**base, "id": "o3b", "order_number": "OAK-3B", "email": "later@x.com", "payment_status": "paid", "created_at": ago(hours=2)})
    await db.orders.insert_one({**base, "id": "o4", "order_number": "OAK-4", "email": "fresh@x.com", "email_marketing_optin": True, "created_at": ago(minutes=30)})
    prev = await growth.run_automations(dry_run=True, force=True)
    check(prev["abandoned"]["sent"] == 1 and len(sent) == 0, f"preview counts 1 and sends nothing ({prev['abandoned']})")
    r = await growth.run_automations()
    check(r["abandoned"]["sent"] == 1 and len(sent) == 1 and sent[0]["to"] == "optin@x.com", "one reminder: only the person who ticked 'email me'")
    check("Hi Asha" in sent[0]["html"] and "Asha" in sent[0]["subject"] and sent[0]["unsub"], "personalised, with one-click unsubscribe")
    check("c/" in sent[0]["html"] and "https://www.oakbridge.in/cart" not in sent[0]["html"], "links are tracked (no raw links)")
    o = {d["id"]: d for d in db.orders.docs}
    check(o["o2"]["abandoned_email_at"].startswith("skipped: no marketing consent"), "no consent -> skipped (and recorded)")
    check(o["o3"]["abandoned_email_at"].startswith("skipped: paid later"), "paid a later attempt -> no reminder")
    check("abandoned_email_at" not in o["o4"], "too fresh -> left for a later run")
    s = next(x for x in db.mk_sends.docs if x["automation"] == "abandoned")
    check(s["status"] == "sent" and s["links"] and s["campaign_id"] == "auto-abandoned", "send recorded with its own links under the automation campaign")
    check(any(c["id"] == "auto-abandoned" and c["kind"] == "automation" for c in db.mk_campaigns.docs), "automation campaign exists for reports")
    r = await growth.run_automations()
    check(r["abandoned"]["sent"] == 0 and len(sent) == 1, "running again sends nothing twice")
    await db.orders.insert_one({**base, "id": "o5", "order_number": "OAK-5", "email": "optin@x.com", "email_marketing_optin": True})
    r = await growth.run_automations()
    check(r["abandoned"]["sent"] == 0 and o.get("o5") is None and len(sent) == 1, "same person again within a week -> not reminded twice")

    print("-- review request --")
    dl = {"payment_status": "paid", "status": "delivered", "items": [{"book_id": "b1", "quantity": 1}, {"book_id": "b2", "quantity": 1}],
          "created_at": ago(days=20), "status_history": [{"status": "delivered", "at": ago(days=11)}]}
    await db.orders.insert_one({**dl, "id": "r1", "order_number": "OAK-R1", "email": "reader@x.com", "full_name": "Ravi", "user_id": "u1"})
    await db.reviews.insert_one({"book_id": "b2", "user_id": "u1", "rating": 5})
    await db.orders.insert_one({**dl, "id": "r2", "order_number": "OAK-R2", "email": "gone@x.com"})
    await db.mk_contacts.insert_one({"id": "c-gone", "email": "gone@x.com", "email_norm": core.normalise_email("gone@x.com"),
                                     "email_status": "valid", "suppressed": "", "email_consent": {"status": "unsubscribed"}})
    await db.orders.insert_one({**dl, "id": "r3", "order_number": "OAK-R3", "email": "early@x.com", "status_history": [{"status": "delivered", "at": ago(days=3)}]})
    before = len(sent)
    r = await growth.run_automations()
    check(r["review"]["sent"] == 1 and len(sent) == before + 1 and sent[-1]["to"] == "reader@x.com", "review request to the delivered buyer only")
    check("Compulsory English" in sent[-1]["html"] and "Contracts" not in sent[-1]["html"], "only books not yet reviewed")
    o = {d["id"]: d for d in db.orders.docs}
    check(o["r2"]["review_email_at"].startswith("skipped: unsubscribed"), "unsubscribed buyer -> never")
    check("review_email_at" not in o["r3"], "delivered 3 days ago -> wait")

    print("-- switched off --")
    await db.integrations.update_one({"key": growth.AUTO_KEY}, {"$set": {"abandoned": {"enabled": False, "delay_hours": 2}, "review": {"enabled": False, "days_after_delivery": 10}}})
    await db.orders.insert_one({**base, "id": "o6", "order_number": "OAK-6", "email": "new@x.com", "email_marketing_optin": True})
    n = len(sent)
    await growth.run_automations()
    check(len(sent) == n, "off means off")

    print("-- partners --")
    p = await growth.adm_new_partner(growth.PartnerBody(name="Justice K Kannan", kind="author", code="kannan10", discount_percent=10, author_id="k-kannan"), {"email": "admin@x"})
    check(p["code"] == "KANNAN10" and p["link"] == "https://www.oakbridge.in/authors/k-kannan?ref=KANNAN10", "code normalised, link to the author page")
    cpn = next(c for c in db.coupons.docs if c["code"] == "KANNAN10")
    check(cpn["kind"] == "percent" and cpn["value"] == 10 and cpn["active"], "a normal 10% coupon is created")
    try:
        await growth.adm_new_partner(growth.PartnerBody(name="X", code="KANNAN10"), {"email": "a"})
        check(False, "duplicate code should be refused")
    except HTTPException as e:
        check(e.status_code == 409, "duplicate code refused")
    await db.orders.insert_one({"id": "p1", "payment_status": "paid", "created_at": ago(days=1), "coupon_code": "KANNAN10", "total": 450,
                                "items": [{"book_id": "b1", "quantity": 2}]})
    await db.orders.insert_one({"id": "p2", "payment_status": "paid", "created_at": ago(days=1), "attribution": {"ref": "KANNAN10"}, "total": 500,
                                "items": [{"book_id": "b1", "quantity": 1}]})
    lst = (await growth.adm_partners())["partners"][0]
    check(lst["orders"] == 2 and lst["copies"] == 3 and lst["revenue"] == 950, "sales credited by code OR link")
    await growth.adm_save_partner(p["id"], growth.PartnerBody(active=False), {"email": "a"})
    check(not next(c for c in db.coupons.docs if c["code"] == "KANNAN10")["active"], "switching the partner off stops the code")

    print("-- visit beacon --")
    class Req:
        def __init__(self, ua, body):
            self.headers, self._b = {"user-agent": ua}, body

        async def body(self):
            return self._b
    await growth.track_visit(Req("Mozilla/5.0 (iPhone) Safari", json.dumps({"ref": "KANNAN10", "referrer": "https://lnkd.in/x"}).encode()))
    await growth.track_visit(Req("Mozilla/5.0 HeadlessChrome", b'{"utm_source":"email"}'))
    await growth.track_visit(Req("Mozilla/5.0 (Windows) Chrome", b"not json"))
    v = db.visit_stats.docs
    check(len(v) == 1 and v[0]["channel"] == "Partner" and v[0]["ref"] == "KANNAN10" and v[0]["n"] == 1, "one partner visit counted; bot and junk ignored")
    check(set(v[0]) <= {"day", "channel", "ref", "n", "v", "_id"}, "nothing about the person is stored")
    # Counting started today: the window must start today too, or older
    # orders get divided by today's visits (the live 9.7% "Search" rate).
    f = await growth.adm_funnel(30)
    IST = timezone(timedelta(hours=5, minutes=30))
    check(f["clamped"] and f["since"] == datetime.now(IST).strftime("%Y-%m-%d"), "window starts when visit counting began (IST day)")
    # As if counting had run for longer than the window: no clamp.
    # An OLD-rules tally (no v) must not move the window or be counted…
    await db.visit_stats.insert_one({"day": (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y-%m-%d"), "channel": "Social", "ref": "", "n": 50})
    f = await growth.adm_funnel(30)
    check(f["clamped"] and next(r for r in f["rows"] if r["channel"] == "Social")["visits"] == 0, "pre-fix tallies ignored (no deletion needed)")
    # …a v=2 tally from 60 days ago means counting has run longer than the window.
    await db.visit_stats.insert_one({"day": (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d"), "channel": "Direct", "ref": "", "n": 0, "v": 2})
    f = await growth.adm_funnel(30)
    prow = next(r for r in f["rows"] if r["channel"] == "Partner")
    check(not f["clamped"] and prow["visits"] == 1 and prow["paid"] == 2, "funnel: partner visits and paid orders line up")
    check(set(prow["steps"]) == {"view_item", "add_to_cart", "checkout", "payment"}, "funnel rows carry the shopping steps")

    print("-- calendar periods --")
    today = datetime.now(IST)
    first_this = today.replace(day=1).strftime("%Y-%m-%d")
    lm_end = (today.replace(day=1) - timedelta(days=1))
    lm_start = lm_end.replace(day=1).strftime("%Y-%m-%d")
    fm = await growth.adm_funnel(start=first_this, end=today.strftime("%Y-%m-%d"))
    check(fm["until"] == today.strftime("%Y-%m-%d") and fm["since"] >= first_this, "This month: 1st → today")
    lm = await growth.adm_funnel(start=lm_start, end=lm_end.strftime("%Y-%m-%d"))
    check(lm["until"] == lm_end.strftime("%Y-%m-%d") and not lm["empty"], "Last month: whole previous month (counting ran that long)")
    fut = await growth.adm_funnel(start="2099-01-01", end="2099-01-31")
    check(fut["until"] <= today.strftime("%Y-%m-%d"), "a future period is capped at today")
    sw = await growth.adm_funnel(start=today.strftime("%Y-%m-%d"), end=lm_start)
    check(sw["since"] <= sw["until"], "a backwards range is swapped, not empty")
    ins = await growth.adm_insights(start=lm_start, end=lm_end.strftime("%Y-%m-%d"))
    check(ins["dates"][0] == lm_start and ins["dates"][-1] == lm_end.strftime("%Y-%m-%d"), "chart axis = the chosen period's days")

    print("-- steps, dims, office network, staff orders --")
    await growth.track_step(Req("Mozilla/5.0 (iPhone) Instagram 300.0", b'{"step":"add_to_cart"}'))
    await growth.track_step(Req("Mozilla/5.0 (iPhone) Safari", b'{"step":"delete_db"}'))
    st = db.step_stats.docs
    check(len(st) == 1 and st[0]["step"] == "add_to_cart" and st[0]["channel"] == "Social", "step counted; Instagram in-app browser = Social; unknown step ignored")
    dims = {(d["dim"], d["key"]) for d in db.visit_dims.docs}
    check(("device", "Mobile") in dims and ("referrer", "lnkd.in") in dims and ("landing", "/") in dims, "device, referrer host and landing page tallied")
    await db.integrations.insert_one({"key": growth.SETTINGS_KEY, "office_ips": ["10.1.2.0/24"]})
    growth._SETTINGS_CACHE.update(at=0.0, v=None)
    class OfficeReq(Req):
        def __init__(self, ua, body):
            super().__init__(ua, body)
            self.headers["x-forwarded-for"] = "10.1.2.33, 1.1.1.1"
    n0 = sum(v["n"] for v in db.visit_stats.docs)
    await growth.track_visit(OfficeReq("Mozilla/5.0 (Windows) Chrome", b'{"utm_source":"email"}'))
    check(sum(v["n"] for v in db.visit_stats.docs) == n0, "office network not counted")
    await db.users.insert_one({"id": "staff1", "email": "ops@oakbridge.in", "role": "superadmin"})
    await db.orders.insert_one({"id": "t1", "user_id": "staff1", "email": "ops@oakbridge.in", "payment_status": "paid", "total": 999,
                                "created_at": datetime.now(timezone.utc).isoformat(), "attribution": {"utm_source": "email"}})
    f2 = await growth.adm_funnel(30)
    check(f2["total"]["paid"] == f["total"]["paid"], "staff test order left out of the funnel")
    ins = await growth.adm_insights(30)
    check(ins["device"].get("Mobile", 0) >= 1 and any(r["key"] == "lnkd.in" for r in ins["referrer"]), "insights: devices and referrers")
    # Staff signs in mid-session: their counted visit is taken back.
    before = sum(v["n"] for v in db.visit_stats.docs if v.get("v") == 2)
    class SReq(Req):
        pass
    r = await growth.untrack_visit(growth.UnvisitBody(at=datetime.now(timezone.utc).isoformat(), ref="KANNAN10", referrer="https://lnkd.in"),
                                   SReq("Mozilla/5.0 (iPhone) Safari", b""), {"role": "superadmin"})
    check(r["undone"] == 1 and sum(v["n"] for v in db.visit_stats.docs if v.get("v") == 2) == before - 1, "staff sign-in takes the session's visit back")
    try:
        await growth.untrack_visit(growth.UnvisitBody(at=datetime.now(timezone.utc).isoformat()), SReq("x", b""), {"role": "customer"})
        check(False, "customers can't subtract visits")
    except HTTPException as e:
        check(e.status_code == 403, "customers can't subtract visits")
    for _ in range(3):
        await growth.untrack_visit(growth.UnvisitBody(at=datetime.now(timezone.utc).isoformat(), ref="KANNAN10", referrer="https://lnkd.in"),
                                   SReq("Mozilla/5.0 (iPhone) Safari", b""), {"role": "superadmin"})
    check(all(v["n"] >= 0 for v in db.visit_stats.docs), "never below zero")


asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
