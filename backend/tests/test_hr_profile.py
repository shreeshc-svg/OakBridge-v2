"""HRM → My profile (hrm_profile.py): validation, who sees what, audit of
field NAMES only. Run: python backend/tests/test_hr_profile.py"""
import asyncio
import json
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
        for k in getattr(type(self), "__annotations__", {}):
            setattr(self, k, getattr(type(self), k, None))
        self.__dict__.update(kw)

    def model_dump(self):
        return dict(self.__dict__)


def _mod(name, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


audits, mails = [], []


async def _audit(db, action, **k):
    audits.append((action, k.get("meta")))


async def _send(**k):
    mails.append(k)
    return True

db = DB()
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None, File=lambda *a, **k: None, UploadFile=object)
_mod("fastapi.responses", Response=lambda **k: k)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, get_current_user=lambda: None, hash_password=lambda p: "h")
_mod("audit", audit_log=_audit)
_mod("rbac", is_superadmin=lambda r: r in ("superadmin", "admin"), SUPERADMIN_ROLES=frozenset({"superadmin", "admin"}))
_mod("emailer", send_email=_send, send_hrm_invite=lambda *a, **k: None)
import hrm_profile as P  # noqa: E402

P._today = lambda: date(2026, 11, 12)
T = date(2026, 11, 12)


def refused(fn, *a):
    try:
        fn(*a)
        return ""
    except P.Refused as e:
        return str(e)


print("-- rules --")
check(P.clean_phone("+91 98765-43210") == "9876543210" and P.clean_phone("09876543210") == "9876543210" and P.clean_phone("") == "",
      "mobile: +91 / 0 / spaces accepted, stored as 10 digits; empty clears")
check("10-digit" in refused(P.clean_phone, "12345"), "bad mobile refused")
check("16–100" in refused(P.clean_profile, {"dob": "2015-01-01"}, T), "date of birth sanity (16–100)")
check("blood group" in refused(P.clean_profile, {"blood_group": "C+"}, T), "blood group from the list")
check("both a name and a phone" in refused(P.clean_profile, {"emergency": [{"name": "Ma"}]}, T), "emergency contact needs name + phone")
check(P.clean_profile({"emergency": [{"name": "", "phone": ""}, {"name": "Ravi", "relation": "Sibling", "phone": "9811111111"}]}, T)["emergency"]
      == [{"name": "Ravi", "relation": "Sibling", "phone": "9811111111"}], "empty row = removed")


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")


async def flow():
    for p in ({"id": "f", "name": "Founder", "work_email": "f@o.in", "status": "active", "hr_access": True, "user_id": "uf", "joined_on": "2020-01-01"},
              {"id": "m", "name": "Meera", "work_email": "m@o.in", "status": "active", "manager_id": "f", "user_id": "um", "joined_on": "2022-01-01"},
              {"id": "a", "name": "Asha", "work_email": "a@o.in", "status": "active", "manager_id": "m", "user_id": "ua", "joined_on": "2024-01-10", "phone": "9000000000"},
              {"id": "z", "name": "Zed", "work_email": "z@o.in", "status": "active", "manager_id": "m", "user_id": "uz", "joined_on": "2025-01-10"}):
        await db.hr_employees.insert_one(p)
    U = lambda i: {"id": f"u{i}", "email": f"{i}@o.in", "role": "customer"}  # noqa: E731
    A, M, F, Z = U("a"), U("m"), U("f"), U("z")
    v = await P.profile_me(A)
    check(v["phone"] == "9000000000" and v["complete"] == 12, "starts with the mobile HR entered (1 of 8 filled)")
    v = await P.profile_save(P.ProfileBody(phone="98765 43210", personal_email="asha@gmail.com", dob="1995-06-01", blood_group="o+",
                                           current_address="12 MG Road, Delhi", emergency=[{"name": "Ravi", "relation": "Sibling", "phone": "9811111111"}]), A)
    check(v["phone"] == "9876543210" and v["blood_group"] == "O+" and v["complete"] == 75, "saved at once; completeness 75%")
    act = [a for a in audits if a[0] == "HRM_PROFILE_UPDATED"][-1][1]
    check("phone" in act["fields"] and "9876543210" not in json.dumps(act), "audit lists field NAMES, never values")
    check(any(m["to"] == "f@o.in" and "Profile updated: Asha" in m["subject"] for m in mails), "HR gets a short summary")
    v = await P.profile_save(P.ProfileBody(personal_email="", emergency=[]), A)
    check(v["personal_email"] == "" and v["emergency"] == [], "employee can clear (delete) details")
    await P.profile_save(P.ProfileBody(emergency=[{"name": "Ravi", "relation": "Sibling", "phone": "9811111111"}]), A)
    m = await P.profile_of("a", M)
    check(m["scope"] == "emergency" and m["emergency"][0]["name"] == "Ravi" and "dob" not in m and "phone" not in m,
          "manager sees ONLY the emergency contact")
    f = await P.profile_of("a", F)
    check(f["scope"] == "full" and f["dob"] == "1995-06-01", "HR sees the full profile")
    check(any(a[0] == "HRM_PROFILE_VIEWED" for a in audits), "HR's view is audited")
    await expect(P.profile_of("a", Z), 404, "a colleague sees nothing")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
