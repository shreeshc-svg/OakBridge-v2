"""HRM release 1: the rules (hr_core.py) and the API (hrm.py) on the fake DB.

Most important: who can see whom. An employee sees only themselves, a manager
their team (direct and indirect), HR/founders and site superadmins everyone,
and someone who has left nothing.

Run: python backend/tests/test_hrm.py
"""
import asyncio
import os
import sys
import types
from datetime import date

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


import hr_core as c  # noqa: E402

print("-- leave year & calendar --")
check(c.fiscal_year(date(2026, 4, 1)) == "2026-27" and c.fiscal_year(date(2027, 3, 31)) == "2026-27"
      and c.fiscal_year(date(2026, 3, 31)) == "2025-26", "financial year April–March")
check(c.fy_bounds("2026-27") == (date(2026, 4, 1), date(2027, 3, 31)), "year bounds")
for bad in ("2026-28", "26-27", "", "2026/27"):
    try:
        c.fy_bounds(bad)
        check(False, f"bad year {bad!r} refused")
    except ValueError:
        check(True, f"bad year {bad!r} refused")
check(c.is_weekly_off(date(2026, 11, 8)), "Sunday off")
check(c.is_weekly_off(date(2026, 11, 14)) and not c.is_weekly_off(date(2026, 11, 7)) and not c.is_weekly_off(date(2026, 11, 21)),
      "2nd Saturday off; 1st and 3rd Saturdays working")
check(c.working_days(date(2026, 11, 9), date(2026, 11, 15)) == 5, "a week with the 2nd Saturday = 5 working days")
check(c.working_days(date(2026, 11, 9), date(2026, 11, 15), ["2026-11-10"]) == 4, "a national holiday is not a working day")
check(c.is_weekly_off(date(2026, 11, 7), {"weekdays": [5, 6], "saturdays": []}), "weekly offs are a setting (Sat+Sun)")
h = c.clean_holidays([{"date": "2026-08-15", "name": "Independence Day"}, {"date": "2026-08-15", "name": "dup"},
                      {"date": "bad", "name": "x"}, {"date": "2026-10-20", "name": ""}, {"date": "2026-11-08", "name": "Diwali", "kind": "optional"}])
check([r["date"] for r in h] == ["2026-08-15", "2026-11-08"] and h[1]["kind"] == "optional", "holiday list cleaned")

print("-- people rules --")
try:
    c.clean_person({"name": "A", "work_email": "nope", "joined_on": "2026-04-01"})
    check(False, "bad email refused")
except ValueError:
    check(True, "bad email refused")
try:
    c.clean_person({"name": "A", "work_email": "a@oakbridge.in", "joined_on": "2026-05-01", "confirmed_on": "2026-04-01"})
    check(False, "confirmation before joining refused")
except ValueError:
    check(True, "confirmation before joining refused")
p = c.clean_person({"name": " Asha  Rao ", "work_email": "ASHA@Oakbridge.in", "joined_on": "2026-04-01", "pan": "X", "bank": "Y"})
check(p["name"] == "Asha Rao" and p["work_email"] == "asha@oakbridge.in" and "pan" not in p and "bank" not in p,
      "names tidied, email lower-case, no personal/bank fields kept")
P = {"f": {"id": "f", "manager_id": None, "status": "active", "hr_access": True},
     "m": {"id": "m", "manager_id": "f", "status": "active"},
     "a": {"id": "a", "manager_id": "m", "status": "active"},
     "b": {"id": "b", "manager_id": "a", "status": "active"},
     "x": {"id": "x", "manager_id": "f", "status": "exited"}}
check(c.reports_of(P, "m") == {"a", "b"}, "manager's team includes indirect reports")
check(c.manager_cycle(P, "m", "b") and not c.manager_cycle(P, "b", "m"), "reporting loops detected")
check(c.access_of(P["a"], P)["ids"] == {"a", "b"} and c.access_of(P["b"], P)["ids"] == {"b"}, "manager sees team; employee sees self")
check(c.access_of(P["f"], P)["ids"] is None and c.access_of(None, P, superadmin=True)["hr"], "HR / superadmin see everyone")
check(c.access_of(P["x"], P)["ids"] == set() and c.access_of(None, P)["ids"] == set(), "someone who left / not set up sees nothing")


# ------------------------------------------------------------------ API ---
class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        super().__init__(str(detail))
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: (lambda fn: fn)


class BaseModel:
    def __init__(self, **kw):
        self.__dict__.update(kw)
        self.model_fields_set = set(kw)

    def model_dump(self):
        return {k: v for k, v in self.__dict__.items() if k != "model_fields_set"}


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


async def _anoop(*a, **k):
    return None

sent = []


async def _invite(*a):
    sent.append(a)
    return True

db = DB()
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, get_current_user=lambda: None, hash_password=lambda p: "hash")
_mod("audit", audit_log=_anoop)
_mod("rbac", is_superadmin=lambda r: r in ("superadmin", "admin"))
_mod("emailer", send_hrm_invite=_invite)
import hrm  # noqa: E402

B = lambda **k: hrm.PersonBody(**k)  # noqa: E731
SUPER = {"id": "u0", "email": "boss@oakbridge.in", "role": "superadmin"}


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")


async def flow():
    print("-- API: HR adds people --")
    await db.users.insert_one({"id": "u-old", "email": "meera@oakbridge.in", "role": "editor", "password_hash": "keep"})
    f = await hrm.hrm_add(B(name="Founder", work_email="founder@oakbridge.in", joined_on="2020-01-01", hr_access=True), SUPER)
    m = await hrm.hrm_add(B(name="Meera Manager", work_email="meera@oakbridge.in", joined_on="2022-01-01", manager_id=f["id"]), SUPER)
    a = await hrm.hrm_add(B(name="Asha", work_email="asha@oakbridge.in", joined_on="2026-04-01", manager_id=m["id"]), SUPER)
    z = await hrm.hrm_add(B(name="Zed", work_email="zed@oakbridge.in", joined_on="2026-04-01", manager_id=f["id"]), SUPER)
    check(m["user_id"] == "u-old", "existing site account linked by work email")
    await expect(hrm.hrm_add(B(name="Dup", work_email="ASHA@oakbridge.in", joined_on="2026-04-01"), SUPER), 409, "duplicate work email refused")
    await expect(hrm.hrm_edit(m["id"], B(manager_id=a["id"]), SUPER), 400, "reporting loop refused")

    print("-- API: who sees what --")
    await db.users.insert_one({"id": "u-asha", "email": "asha@oakbridge.in", "role": "customer"})
    ASHA = {"id": "u-asha", "email": "asha@oakbridge.in", "role": "customer"}
    MEERA = {"id": "u-old", "email": "meera@oakbridge.in", "role": "editor"}
    FOUNDER = {"id": "u-f", "email": "founder@oakbridge.in", "role": "customer"}
    STRANGER = {"id": "u-s", "email": "someone@gmail.com", "role": "customer"}
    me = await hrm.hrm_me(ASHA)
    check(me["me"]["name"] == "Asha" and not me["hr"] and not me["manager"] and me["manager_name"] == "Meera Manager",
          "employee: own record, manager's name, no HR / manager powers")
    rows = (await hrm.hrm_people(False, ASHA))["rows"]
    check([r["name"] for r in rows] == ["Asha"], "employee sees only themselves")
    await expect(hrm.hrm_person(z["id"], ASHA), 404, "employee can't open a colleague (404, doesn't confirm they exist)")
    rows = (await hrm.hrm_people(False, MEERA))["rows"]
    check(sorted(r["name"] for r in rows) == ["Asha", "Meera Manager"], "manager sees self + team only")
    check((await hrm.hrm_me(MEERA))["manager"], "manager flag")
    rows = (await hrm.hrm_people(False, FOUNDER))["rows"]
    check(len(rows) == 4 and (await hrm.hrm_me(FOUNDER))["hr"], "HR / founder sees everyone")
    await expect(hrm.hrm_me(STRANGER), 403, "a customer who isn't an employee is turned away")
    await expect(hrm.require_hr(ASHA), 403, "employee can't act as HR")
    await expect(hrm.require_hr(MEERA), 403, "a manager (even admin 'editor' staff) can't act as HR")
    check(await hrm.require_hr(FOUNDER) == FOUNDER and await hrm.require_hr(SUPER) == SUPER, "HR access / superadmin pass")
    linked = await db.hr_employees.find_one({"id": a["id"]})
    check(linked["user_id"] == "u-asha", "first sign-in links the account to the employee record")

    print("-- API: logins --")
    r = await hrm.hrm_invite(z["id"], SUPER)
    zu = await db.users.find_one({"email": "zed@oakbridge.in"})
    check(r["account_created"] and zu["role"] == "customer" and zu.get("reset_token_hash") and sent[-1][2].startswith("https://"),
          "new login = ordinary (non-admin) account + set-password link emailed")
    r = await hrm.hrm_invite(m["id"], SUPER)
    mu = await db.users.find_one({"id": "u-old"})
    check(not r["account_created"] and not mu.get("reset_token_hash") and mu["password_hash"] == "keep" and sent[-1][2] == "",
          "existing (admin) account: NO password reset triggered, just told where the HRM is")

    print("-- API: exited --")
    await db.hr_employees.update_one({"id": a["id"]}, {"$set": {"status": "exited"}})
    await expect(hrm.hrm_people(False, ASHA), 403, "someone who left sees nothing")
    await expect(hrm.hrm_me(ASHA), 403, "...and can't open the HRM at all")
    rows = (await hrm.hrm_people(False, MEERA))["rows"]
    check([r["name"] for r in rows] == ["Meera Manager"], "people who left drop off the team list")

    print("-- API: calendar --")
    await expect(hrm.hrm_put_calendar("2026-27", hrm.CalendarBody(rows=[{"date": "2027-04-14", "name": "x"}]), SUPER), 400,
                 "holiday outside the year refused")
    await hrm.hrm_put_calendar("2026-27", hrm.CalendarBody(rows=[{"date": "2026-08-15", "name": "Independence Day"},
                                                                 {"date": "2026-11-08", "name": "Diwali", "kind": "optional"}]), SUPER)
    cal = await hrm.hrm_calendar("2026-27", MEERA)
    check(len(cal["rows"]) == 2 and cal["start"] == "2026-04-01" and cal["weekly_off"] == c.DEFAULT_WEEKLY_OFF,
          "anyone in the HRM reads the calendar")
    check(cal["working_days"] == c.working_days(date(2026, 4, 1), date(2027, 3, 31), ["2026-08-15"]),
          "working days exclude national holidays, not optional ones")
    # Writes take Depends(require_hr) — enforced by FastAPI, checked above via require_hr directly.
    src = open(os.path.join(os.path.dirname(HERE), "hrm.py"), encoding="utf-8").read()
    for fn in ("hrm_add", "hrm_edit", "hrm_invite", "hrm_put_settings", "hrm_put_calendar"):
        sig = src.split(f"async def {fn}(")[1].split(")")[0] if f"async def {fn}(" in src else ""
        check("Depends(require_hr" in sig, f"{fn} is HR-only")


asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
