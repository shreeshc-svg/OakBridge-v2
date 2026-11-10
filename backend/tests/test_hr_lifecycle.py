"""HRM release 4 — hiring, onboarding, exit: rules (hr_lifecycle_core.py) and
the flow (hrm_lifecycle.py) on the fake DB.

Run: python backend/tests/test_hr_lifecycle.py
"""
import asyncio
import os
import sys
import types
from datetime import date, timedelta

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


import hr_lifecycle_core as L  # noqa: E402


def refused(fn, *a):
    try:
        fn(*a)
        return ""
    except L.Refused as e:
        return str(e)


print("-- rules --")
check("Mark as joined" in refused(L.check_move, "offer", "joined"), "'joined' only through Mark as joined")
check("already" in refused(L.check_move, "rejected", "interview"), "closed candidates can't move")
check(refused(L.check_move, "new", "interview") == "", "skipping a stage is allowed")
check("Offer first" in refused(L.can_join, "interview"), "join only from Offer")
T = date(2026, 11, 10)
check(L.purge_due({"stage": "rejected", "closed_at": (T - timedelta(days=183)).isoformat()}, T), "deleted ~6 months after rejection")
check(not L.purge_due({"stage": "rejected", "closed_at": (T - timedelta(days=100)).isoformat()}, T), "kept before that")
check(not L.purge_due({"stage": "joined", "closed_at": "2020-01-01"}, T), "people hired are never purged")
check(L.encashment({"confirmed_on": "2025-01-10"}, date(2026, 11, 30), 7.7)["days"] == 7.5, "EL encashed: 1+ yr after confirmation, half days")
check(L.encashment({"confirmed_on": "2026-03-01"}, date(2026, 11, 30), 4)["days"] == 0, "under a year after confirmation: none")
check(L.exit_effective({"exited_on": "2026-11-09"}, T) and not L.exit_effective({"exited_on": "2026-11-10"}, T),
      "access ends the day AFTER the last working day")


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

mails = []
STORE = {"oakbridge/cv/abc.pdf": b"%PDF-1.4 cv"}


async def _send(**k):
    mails.append(k)
    return True

db = DB()
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None, File=lambda *a, **k: None, UploadFile=object)
_mod("fastapi.responses", Response=lambda **k: k)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, get_current_user=lambda: None, hash_password=lambda p: "h")
_mod("audit", audit_log=_anoop)
_mod("rbac", is_superadmin=lambda r: r in ("superadmin", "admin"), ADMIN_ROLES=frozenset({"superadmin", "admin", "manager", "editor", "fulfilment", "warehouse"}),
     SUPERADMIN_ROLES=frozenset({"superadmin", "admin"}))
_mod("emailer", send_email=_send, send_hrm_invite=lambda *a, **k: _anoop())
_mod("features", get_object=lambda p: (STORE[p], "application/pdf"), delete_object=lambda p: STORE.pop(p, None) is not None,
     storage_path_from_url=lambda u: u.split("/api/files/", 1)[1] if "/api/files/" in (u or "") else "")
import hrm  # noqa: E402
import hrm_lifecycle as HL  # noqa: E402

HL._today = lambda: T


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")


async def flow():
    for p in ({"id": "f", "name": "Founder", "work_email": "f@o.in", "status": "active", "hr_access": True, "user_id": "uf", "joined_on": "2020-01-01"},
              {"id": "m", "name": "Meera", "work_email": "m@o.in", "status": "active", "manager_id": "f", "user_id": "um", "joined_on": "2022-01-01"},
              {"id": "w", "name": "Wasim", "work_email": "w@o.in", "status": "active", "manager_id": "m", "user_id": "uw",
               "joined_on": "2023-01-01", "confirmed_on": "2023-07-01"}):
        await db.hr_employees.insert_one(p)
    await db.users.insert_one({"id": "uw", "email": "w@o.in", "role": "warehouse", "sections": ["warehouse"]})
    await db.job_applications.insert_one({"id": "c1", "name": "Priya Nair", "email": "priya@gmail.com", "phone": "9", "role": "Editor",
                                          "cv_url": "/api/files/oakbridge/cv/abc.pdf", "status": "received", "created_at": "2026-11-01"})
    U = lambda i: {"id": f"u{i}", "email": f"{i}@o.in", "role": "customer"}  # noqa: E731
    F, M, W = U("f"), U("m"), U("w")

    print("-- hiring --")
    lst = await HL.hiring_list(F)
    check(lst["rows"][0]["stage"] == "new" and lst["rows"][0]["has_cv"], "old Careers applications show as New, with their CV")
    check((await HL.hiring_list(M))["rows"] == [], "a manager sees no candidates until assigned")
    await expect(HL.hiring_cv("c1", M), 404, "…and can't open the CV")
    await HL.hiring_edit("c1", HL.CandPatch(stage="interview", hiring_manager_id="m"), F)
    check(any(x["to"] == "m@o.in" for x in mails), "hiring manager emailed")
    check([r["name"] for r in (await HL.hiring_list(M))["rows"]] == ["Priya Nair"] and (await hrm.hrm_me(M))["hiring"],
          "hiring manager now sees that candidate (and gets the Hiring tab)")
    check((await HL.hiring_cv("c1", M))["media_type"] == "application/pdf", "hiring manager opens the CV")
    await expect(HL.hiring_cv("c1", W), 404, "other staff can't")
    await expect(HL.hiring_feedback("c1", HL.FeedbackBody(recommend="hire", notes="short"), M), 400, "feedback needs real notes")
    await HL.hiring_feedback("c1", HL.FeedbackBody(recommend="hire", notes="Strong editing test, good fit."), M)
    check(any(x["to"] == "f@o.in" and "feedback" in x["subject"].lower() for x in mails), "HR told about the feedback")
    await expect(HL.hiring_edit("c1", HL.CandPatch(stage="joined"), F), 400, "can't jump to Joined by changing the stage")
    await expect(HL.hiring_join("c1", HL.JoinBody(work_email="priya@oakbridge.in", joined_on="2026-11-15"), F), 400, "join only from Offer")
    await HL.hiring_edit("c1", HL.CandPatch(stage="offer"), F)
    r = await HL.hiring_join("c1", HL.JoinBody(work_email="priya@oakbridge.in", joined_on="2026-11-15", manager_id="m", send_login=False), F)
    emp = await db.hr_employees.find_one({"id": r["employee_id"]})
    check(emp["status"] == "active" and emp["confirmed_on"] is None and emp["manager_id"] == "m" and emp["designation"] == "Editor",
          "Joined: employee created on probation, reporting to the hiring manager, role from the application")
    check(len(emp["onboarding"]) == len(L.DEFAULT_ONBOARDING) and not any(i["done"] for i in emp["onboarding"]), "onboarding checklist created")
    c1 = await db.job_applications.find_one({"id": "c1"})
    check(c1["stage"] == "joined" and c1["employee_id"] == emp["id"], "candidate marked joined, linked to the employee")
    items = (await HL.people_checklist(emp["id"], HL.ChecklistBody(kind="onboarding", item="Laptop / system issued", done=True), F))["items"]
    check(next(i for i in items if i["item"] == "Laptop / system issued")["by"] == "f@o.in", "HR ticks an item (who/when kept)")

    print("-- exit --")
    await db.hr_leave.insert_one({"id": "lv", "emp_id": "w", "type": "CL", "start": "2026-12-01", "end": "2026-12-01", "status": "approved", "days": 1})
    await expect(HL.people_exit("w", HL.ExitBody(last_day="2026-11-20", reason="nope"), F), 400, "reason required")
    r = await HL.people_exit("w", HL.ExitBody(last_day="2026-11-20", reason="resigned", note="Moving cities"), F)
    check(r["exit"]["encashment"]["eligible"] and r["leave_cancelled"] == 1, "exit recorded; EL encashment worked out; leave after the last day cancelled")
    wp = await db.hr_employees.find_one({"id": "w"})
    check(len(wp["exit_checklist"]) == len(L.DEFAULT_EXIT), "exit checklist created")
    check((await hrm.hrm_me(W))["me"]["name"] == "Wasim", "works as normal until the last day")
    HL._today = lambda: date(2026, 11, 21)
    hrm._today_ist = lambda: date(2026, 11, 21)
    await expect(hrm.hrm_me(W), 403, "the day after: HRM closed for him (even before the nightly job)")
    n = await HL.finalize_exits()
    u = await db.users.find_one({"id": "uw"})
    check(n == 1 and (await db.hr_employees.find_one({"id": "w"}))["status"] == "exited", "nightly job: marked left")
    check(u["role"] == "customer" and "sections" not in u and u["staff_role_before_exit"] == "warehouse", "warehouse access removed")
    await expect(HL.people_exit_cancel("w", F), 409, "can't undo an exit once final")

    print("-- privacy --")
    await db.job_applications.insert_one({"id": "c2", "name": "Old reject", "stage": "rejected", "closed_at": "2026-04-01", "cv_url": "/api/files/oakbridge/cv/old.pdf"})
    STORE["oakbridge/cv/old.pdf"] = b"%PDF"
    n = await HL.purge_old_applications(date(2026, 11, 21))
    check(n == 1 and not await db.job_applications.find_one({"id": "c2"}) and "oakbridge/cv/old.pdf" not in STORE,
          "not hired: record AND CV deleted after ~6 months")
    check(await db.job_applications.find_one({"id": "c1"}), "hired candidate's record kept")
    src = open(os.path.join(os.path.dirname(HERE), "hrm_lifecycle.py"), encoding="utf-8").read()
    for fn in ("hiring_add", "hiring_edit", "hiring_join", "people_checklist", "people_lifecycle", "people_exit", "people_exit_cancel", "lifecycle_put_settings"):
        check("Depends(require_hr" in src.split(f"async def {fn}(")[1].split(")")[0], f"{fn} is HR only")

    print("-- last super admin --")
    await db.hr_employees.insert_one({"id": "s", "name": "Solo", "work_email": "s@o.in", "status": "active", "user_id": "us", "joined_on": "2020-01-01",
                                      "exited_on": "2026-11-15"})
    await db.users.insert_one({"id": "us", "email": "s@o.in", "role": "superadmin"})
    await HL.finalize_exits()
    check((await db.users.find_one({"id": "us"}))["role"] == "superadmin", "the only super admin is never locked out (alert instead)")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
