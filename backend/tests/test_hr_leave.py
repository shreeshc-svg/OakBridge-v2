"""HRM release 2 — every leave-policy rule (hr_leave_core.py) and the
apply / approve flow (hrm_leave.py) on the fake DB.

Run: python backend/tests/test_hr_leave.py
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


import hr_leave_core as L  # noqa: E402

FY = "2026-27"
HOL = ["2026-08-15", "2026-10-02", "2026-10-20", "2026-11-08", "2026-11-09", "2026-11-24", "2026-12-25"]
OPT = ["2026-04-03", "2026-05-27", "2026-08-28", "2026-09-04", "2026-11-11"]
E = {"id": "e1", "joined_on": "2024-01-10", "confirmed_on": "2024-07-10", "gender": "male", "status": "active"}
NEW = {"id": "n1", "joined_on": "2026-09-01", "confirmed_on": None, "status": "active"}
TODAY = date(2026, 11, 2)
_seq = iter(range(1, 999))


def req(emp, t, s, e=None, status="approved", **kw):
    r = {"id": f"r{next(_seq)}", "emp_id": emp["id"], "type": t, "start": s, "end": e or s, "status": status, **kw}
    r["days"] = L.count_days(t, L.d(s), L.d(r["end"]), HOL, None) if t != "COMP_EARN" else 0
    return r


def chk(emp, t, s, e=None, reqs=(), adj=(), today=TODAY, **kw):
    return L.check_request(emp, {"type": t, "start": s, "end": e or s, **kw}, today, list(reqs), list(adj),
                           holidays=HOL, optional_days=OPT, weekly_off=None)


def refused(fn, *a, **k):
    try:
        fn(*a, **k)
        return ""
    except L.Refused as x:
        return str(x)


print("-- counting days --")
check(L.count_days("CL", date(2026, 11, 9), date(2026, 11, 14), HOL, None) == 4,
      "Mon 9 (Deepavali) – Sat 14 Nov (2nd Saturday): 4 working days")
check(L.count_days("LOP", date(2026, 11, 7), date(2026, 11, 10), HOL, None) == 4, "loss of pay counts every day (sandwich)")
check(L.count_days("MAT", date(2026, 11, 1), date(2027, 1, 30), HOL, None) == 91, "maternity counts calendar days")
check(L.days_in_month({"start": "2026-10-30", "end": "2026-11-03"}, "2026-11") == 3, "LOP split by month for payroll")

print("-- probation --")
check("probation" in refused(chk, NEW, "CL", "2026-11-20"), "on probation: CL refused, told to use LOP")
check("probation" in refused(chk, NEW, "EL", "2026-11-20"), "on probation: EL refused")
check(chk(NEW, "LOP", "2026-11-20")["days"] == 1, "on probation: LOP allowed")
check(L.balances(NEW, FY, TODAY, [], [])["CL"]["entitled"] == 0, "no CL until confirmed")

print("-- work from home --")
w = chk(NEW, "WFH", "2026-11-09", "2026-11-13")
check(w["days"] == 4 and not w["needs_hr"], "WFH: open on probation, counts working days only (Deepavali skipped), manager approves")
check(L.balances(E, FY, TODAY, [req(E, "WFH", "2026-11-20")], [])["CL"]["available"] == 6, "WFH uses no leave balance")
check("work from home" in refused(chk, E, "CL", "2026-11-20", reqs=[req(E, "WFH", "2026-11-20")]), "leave on a WFH day is refused (cancel the WFH first)")
check("leave" in refused(chk, E, "WFH", "2026-11-20", reqs=[req(E, "CL", "2026-11-20")]), "WFH on a leave day is refused")
check("no request needed" in refused(chk, E, "WFH", "2026-11-08"), "WFH on a Sunday: nothing to ask")

print("-- casual leave --")
check(chk(E, "CL", "2026-11-05")["flags"] == ["short_notice"], "CL at short notice is allowed, flagged for the manager (5 days recommended)")
check(chk(E, "CL", "2026-11-07")["days"] == 1, "CL with 5 days' notice")
six = [req(E, "CL", d_) for d_ in ("2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-13")]
check("Not enough casual" in refused(chk, E, "CL", "2026-11-20", reqs=six), "only 6 CL a year; told to use LOP")
check(L.yearly_quota({**E, "confirmed_on": "2026-10-05"}, "CL", FY) == 3.0, "confirmed in October: 6 months left -> 3 CL (rounded down)")
check(L.balances(E, "2027-28", date(2027, 4, 2), six, [])["CL"]["available"] == 6, "CL doesn't carry into next year")

print("-- sick leave --")
r = chk(E, "SL", "2026-11-02", "2026-11-06", today=date(2026, 11, 3))
check(r["days"] == 5 and "medical_certificate_needed" in r["flags"] and "reported_after_first_day" in r["flags"],
      "SL: no notice needed; >3 days flags the certificate; reporting late is flagged for HR")
check("medical_certificate_needed" not in chk(E, "SL", "2026-11-02", "2026-11-04")["flags"], "3 days: no certificate")

print("-- earned leave --")
check(L.el_accrued(E, FY, date(2026, 11, 2)) == 3.5, "EL: 0.5 per completed month (Apr–Oct = 7 months = 3.5)")
check(L.el_accrued(NEW, FY, date(2026, 11, 2)) == 0, "no EL before confirmation")
bal = L.el_balance(E, FY, TODAY, [], [])
check(bal["carried"] == 10 and bal["earned"] == 3.5, "carried in: 4 (Jul 2024–Mar 2025, 8 full months) + 6 (2025-26) = 10")
OLD = {**E, "confirmed_on": "2021-04-01"}
check(L.el_balance(OLD, FY, TODAY, [], [])["carried"] == 12, "carry-forward capped at 12")
used_ = [req(E, "EL", "2025-06-02", "2025-06-06")]
check(L.el_balance(E, FY, TODAY, used_, [])["carried"] == 5, "leave taken last year reduces what's carried")
check("Not enough earned" in refused(chk, E, "EL", "2026-12-01", "2026-12-31"), "EL over the balance refused")
adj = [{"emp_id": "e1", "fy": "2026-27", "type": "EL", "days": -10, "note": "opening"}]
check(L.el_balance(E, FY, TODAY, [], adj)["available"] == 3.5, "HR opening adjustment counted")

print("-- optional holiday --")
check(chk(E, "OPT", "2026-11-11")["days"] == 1, "Bhai Dooj from the optional list")
check("optional holiday list" in refused(chk, E, "OPT", "2026-11-12"), "not on the list refused")
check("Not enough optional" in refused(chk, E, "OPT", "2026-11-11", reqs=[req(E, "OPT", "2026-08-28")]), "only 1 a year")

print("-- paternity / maternity --")
check(chk(E, "PAT", "2026-11-03", "2026-11-04", child_birth="2026-11-01")["days"] == 2, "paternity within 15 days, split OK")
check("15 days" in refused(chk, E, "PAT", "2026-11-20", child_birth="2026-11-01"), "outside 15 days refused")
p1 = [req(E, "PAT", "2026-11-03", "2026-11-05", child_birth="2026-11-01")]
check("5 days per child" in refused(chk, E, "PAT", "2026-11-06", "2026-11-12", reqs=p1, child_birth="2026-11-01"), "5 days per child")
check("matching details" in refused(chk, E, "MAT", "2026-12-01", expected_delivery="2026-12-20"), "maternity needs a female profile")
F = {**E, "id": "f1", "gender": "female", "joined_on": "2026-11-01", "confirmed_on": None}
r = chk(F, "MAT", "2026-12-01", "2027-03-31", expected_delivery="2026-12-20")
check(r["needs_hr"] and "eligibility_days_short" in r["flags"], "maternity: HR decides; short eligibility flagged (not auto-refused)")
check("26 weeks" in refused(chk, F, "MAT", "2026-12-01", "2027-06-30", expected_delivery="2026-12-20")
      or "31 March" in refused(chk, F, "MAT", "2026-12-01", "2027-06-30", expected_delivery="2026-12-20"), "over 26 weeks / across years refused")

print("-- bereavement / LOP --")
check(chk(NEW, "BER", "2026-11-03", "2026-11-04")["needs_hr"] is False, "bereavement allowed on probation; 2 days: manager only")
check(chk(E, "BER", "2026-11-03", "2026-11-07")["needs_hr"], "bereavement over 3 days: HR confirms")
check("up to 10" in refused(chk, E, "BER", "2026-11-02", "2026-11-17"), "bereavement capped at 10 (HR can grant more)")
lop9 = [req(NEW, "LOP", "2026-10-01", "2026-10-09")]
r = chk(NEW, "LOP", "2026-11-20", "2026-11-21", reqs=lop9)
check(r["needs_hr"] and "over_lop_cap" in r["flags"], "LOP past 10 days a year: HR must approve too (not blocked)")

print("-- comp-off --")
check("weekly off" in refused(chk, E, "COMP_EARN", "2026-11-03", worked_on="2026-11-03"), "comp-off only for a day off worked")
check(chk(E, "COMP_EARN", "2026-11-15", worked_on="2026-11-15")["flags"] == [], "Sunday, asked in advance: no flag")
check(chk(E, "COMP_EARN", "2026-11-01", worked_on="2026-11-01")["flags"] == ["asked_after_working"], "asked afterwards: flagged")
earn = req(E, "COMP_EARN", "2026-10-25", worked_on="2026-10-25")
r = chk(E, "COMP", "2026-11-03", reqs=[earn])
check(r["credits"] == [earn["id"]], "comp-off uses the earned credit")
check("Not enough comp-off" in refused(chk, E, "COMP", "2027-01-05", reqs=[earn]), "credit expires after 2 months")
check("Not enough comp-off" in refused(chk, E, "COMP", "2026-11-04", reqs=[earn, req(E, "COMP", "2026-11-03", credits=[earn["id"]])]),
      "a credit is used only once")

print("-- general --")
check("already have leave" in refused(chk, E, "SL", "2026-11-07", reqs=[req(E, "CL", "2026-11-07", status="pending")]), "no overlapping leave")
check("31 March" in refused(chk, E, "EL", "2027-03-30", "2027-04-02"), "can't cross the leave year")
check("weekly offs" in refused(chk, E, "CL", "2026-11-14"), "a day that is already off needs no leave")


# --------------------------------------------------------------- API flow ---
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
        for k, v in getattr(type(self), "__annotations__", {}).items():
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


async def _send(**k):
    mails.append(k)
    return True

db = DB()
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None,
     File=lambda *a, **k: None, UploadFile=object)
_mod("fastapi.responses", Response=lambda **k: k)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, get_current_user=lambda: None, hash_password=lambda p: "h")
_mod("audit", audit_log=_anoop)
_mod("rbac", is_superadmin=lambda r: r in ("superadmin", "admin"), SUPERADMIN_ROLES=frozenset({"superadmin", "admin"}))
_mod("emailer", send_email=_send, send_hrm_invite=_anoop)
_mod("csv_export", csv_response=lambda name, head, rows: {"name": name, "head": head, "rows": list(rows)})
import hrm_leave as HL  # noqa: E402

HL._today = lambda: TODAY


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")


async def flow():
    for p in ({"id": "f", "name": "Founder", "work_email": "f@o.in", "status": "active", "hr_access": True, "user_id": "uf",
               "joined_on": "2020-01-01", "confirmed_on": "2020-07-01"},
              {"id": "m", "name": "Meera", "work_email": "m@o.in", "status": "active", "manager_id": "f", "user_id": "um",
               "joined_on": "2022-01-01", "confirmed_on": "2022-07-01"},
              {"id": "a", "name": "Asha", "work_email": "a@o.in", "status": "active", "manager_id": "m", "user_id": "ua",
               "joined_on": "2024-01-10", "confirmed_on": "2024-07-10", "gender": "female"},
              {"id": "z", "name": "Zed", "work_email": "z@o.in", "status": "active", "manager_id": "f", "user_id": "uz",
               "joined_on": "2026-09-01"}):
        await db.hr_employees.insert_one(p)
    await db.hr_holidays.insert_one({"fy": FY, "rows": [{"date": h, "name": "x", "kind": "national"} for h in HOL]
                                     + [{"date": o, "name": "y", "kind": "optional"} for o in OPT]})
    U = lambda i: {"id": f"u{i}", "email": f"{i}@o.in", "role": "customer"}  # noqa: E731
    A, M, F, Z = U("a"), U("m"), U("f"), U("z")
    LB = lambda **k: HL.LeaveBody(**k)  # noqa: E731

    pv = await HL.leave_apply(LB(type="CL", start="2026-11-09", end="2026-11-10", preview=True), A)
    check(pv["days"] == 1 and pv["left_after"] == 5 and pv["approver"] == "Meera" and not await db.hr_leave.find_one({"emp_id": "a"}),
          "preview: 'uses 1 day, 5 left after, goes to Meera' — nothing saved")
    await expect(HL.leave_apply(LB(type="OPT", start="2026-11-03", preview=True), A), 400, "preview shows the same refusal as applying")
    r = await HL.leave_apply(LB(type="CL", start="2026-11-09", end="2026-11-10", reason="family"), A)
    check(r["status"] == "pending" and r["stage"] == "manager" and r["approver_id"] == "m" and r["days"] == 1,
          "Asha applies: 1 working day (9 Nov is Deepavali), waits for her manager")
    check(any(m["to"] == "m@o.in" for m in mails), "manager emailed")
    await expect(HL.leave_apply(LB(type="CL", start="2026-11-20", emp_id="z"), A), 403, "employee can't apply for someone else")
    await expect(HL.leave_apply(LB(type="CL", start="2026-11-20"), Z), 400, "probation: CL refused with a message")
    check((await HL.leave_approvals(M))["rows"][0]["id"] == r["id"], "manager sees it in Approvals")
    check((await HL.leave_approvals(A))["rows"] == [], "nobody approves their own leave")
    await expect(HL.leave_decide(r["id"], HL.DecideBody(approve=True), Z), 404, "someone else can't decide it")
    d1 = await HL.leave_decide(r["id"], HL.DecideBody(approve=True, note="ok"), M)
    check(d1["status"] == "approved" and mails[-1]["to"] == "a@o.in", "manager approves; employee emailed")
    await expect(HL.leave_decide(r["id"], HL.DecideBody(approve=True), M), 404, "can't decide twice")

    s = await HL.leave_summary(None, FY, A)
    check(s["balances"]["CL"]["used"] == 1 and s["balances"]["CL"]["available"] == 5, "balance updated")
    await expect(HL.leave_summary("z", FY, A), 404, "employee can't see a colleague's leave")
    check((await HL.leave_summary("a", FY, M))["emp"]["name"] == "Asha", "manager sees their report's leave")

    sl = await HL.leave_apply(LB(type="SL", start="2026-11-02", end="2026-11-06"), A)
    await expect(HL.leave_decide(sl["id"], HL.DecideBody(approve=True), M), 400, "SL > 3 days: certificate tick required")
    check((await HL.leave_decide(sl["id"], HL.DecideBody(approve=True, cert_seen=True), M))["status"] == "approved", "approved with certificate seen")

    ber = await HL.leave_apply(LB(type="BER", start="2026-12-01", end="2026-12-07"), A)
    check((await HL.leave_decide(ber["id"], HL.DecideBody(approve=True), M)).get("stage") == "hr", "long bereavement: manager yes -> HR")
    await expect(HL.leave_decide(ber["id"], HL.DecideBody(approve=True, days=8), M), 404, "manager can't act at HR stage")
    check((await HL.leave_decide(ber["id"], HL.DecideBody(approve=True, days=8), F))["days"] == 8, "HR approves and adjusts the days")

    lz = await HL.leave_apply(LB(type="LOP", start="2026-11-16", end="2026-11-18"), Z)
    check(lz["stage"] == "manager" and lz["approver_id"] == "f", "probation LOP goes to the manager (founder)")
    await HL.leave_decide(lz["id"], HL.DecideBody(approve=True), F)
    out = await HL.leave_export("2026-11", F)
    zed = next(x for x in out["rows"] if x[1] == "Zed")
    check(zed[3] == 3, "RazorpayX export: Zed 3 loss-of-pay days in November")

    print("-- emails --")
    mails.clear()
    q = await HL.leave_apply(LB(type="BER", start="2026-12-14", end="2026-12-18"), A)
    check({m["to"] for m in mails} == {"m@o.in", "a@o.in"}, "apply: manager asked, employee gets a receipt")
    mails.clear()
    await HL.leave_decide(q["id"], HL.DecideBody(approve=True), M)
    check({m["to"] for m in mails} == {"f@o.in", "a@o.in"}, "manager OK on an HR-step leave: HR asked, employee told it's with HR")
    mails.clear()
    await HL.leave_decide(q["id"], HL.DecideBody(approve=True), F)
    check("a@o.in" in {m["to"] for m in mails}, "final decision: employee emailed")
    mails.clear()
    await db.users.insert_one({"id": "boss", "email": "boss@o.in", "role": "superadmin"})
    await HL.leave_apply(LB(type="LOP", start="2026-12-22"), F)
    asks = [m["to"] for m in mails if "Leave request:" in m["subject"]]
    check("f@o.in" not in asks, "HR is never asked to approve their own leave")
    check(asks == ["boss@o.in"], "…the only HR person's leave goes to the site super admin instead of nobody")
    mails.clear()
    await HL.leave_cancel(q["id"], F)
    check({m["to"] for m in mails} >= {"m@o.in", "a@o.in"}, "HR cancels approved leave: manager and employee emailed")
    c = await HL.leave_apply(LB(type="CL", start="2026-12-21"), A)
    check((await HL.leave_cancel(c["id"], A))["ok"], "employee withdraws a pending request")
    await expect(HL.leave_cancel(c["id"], A), 400, "can't withdraw twice")
    team = await HL.leave_team("2026-11-01", "2026-11-30", M)
    check({x["name"] for x in team["rows"]} == {"Asha"}, "manager's who-is-off shows only their team")
    await expect(HL.leave_team(None, None, A), 403, "employees don't get the team view")



async def offs():
    print("-- super admin: every kind of off --")
    import hr_core as C
    rows = C.clean_holidays([{"date": "2026-12-04", "name": "Book fair", "kind": "special", "applies_to": {"departments": ["Warehouse"]}},
                             {"date": "2026-12-07", "name": "Office shift", "kind": "special"}])
    check(rows[0]["applies_to"] == {"departments": ["Warehouse"], "people": []} and rows[1]["applies_to"] == {"all": True},
          "special day off: for a team, or everyone")
    check(C.days_off_for(rows, {"id": "x", "department": "Warehouse"}) == ["2026-12-04", "2026-12-07"]
          and C.days_off_for(rows, {"id": "y", "department": "Editorial"}) == ["2026-12-07"], "applies only to that team")
    mon = {"weekdays": [0], "saturdays": []}
    check(C.weekly_off_for({"weekly_off": mon}, C.DEFAULT_WEEKLY_OFF) == mon and C.weekly_off_for({}, C.DEFAULT_WEEKLY_OFF) == C.DEFAULT_WEEKLY_OFF,
          "a person's own weekly off, else the company's")
    SUPER = {"id": "us", "email": "boss@o.in", "role": "superadmin"}
    F = {"id": "uf", "email": "f@o.in", "role": "customer"}
    import hrm as H
    await expect(H.hrm_edit("a", H.PersonBody(weekly_off=mon), F), 403, "HR (not super admin) can't set someone's weekly off")
    await H.hrm_edit("a", H.PersonBody(weekly_off=mon), SUPER)
    await db.hr_holidays.update_one({"fy": FY}, {"$push": {"rows": {"date": "2026-12-14", "name": "Team day", "kind": "special",
                                                                     "applies_to": {"people": ["a"]}}}})
    A = {"id": "ua", "email": "a@o.in", "role": "customer"}
    r = await HL.leave_apply(HL.LeaveBody(type="EL", start="2026-12-12", end="2026-12-19"), A)
    # Sat 12 (2nd Sat — a working day for her now), Sun 13 works, Mon 14 own off + her special day, Tue–Sat 15–19
    check(r["days"] == 7, "her leave counts her own weekly off (Monday) and her special day off — 7 days, not 6")
    await HL.leave_cancel(r["id"], A)
    await H.hrm_edit("a", H.PersonBody(weekly_off={}), SUPER)
    check((await db.hr_employees.find_one({"id": "a"})).get("weekly_off") is None, "{} = back to the company weekly off")
    res = await HL.leave_set_balance(HL.SetBalanceBody(emp_id="a", type="EL", to=4, note="paper register"), SUPER)
    check(res["balances"]["EL"]["available"] == 4, "EL set to exactly 4 (adjustment of the difference)")
    res = await HL.leave_set_balance(HL.SetBalanceBody(emp_id="a", type="CL", to=0, note="used on paper"), SUPER)
    check(res["balances"]["CL"]["available"] == 0, "CL zeroed")
    res = await HL.leave_set_balance(HL.SetBalanceBody(emp_id="a", type="COMP", to=2, note="weekend shifts"), SUPER)
    check(res["balances"]["COMP"]["available"] == 2, "comp-off granted: 2")
    res = await HL.leave_set_balance(HL.SetBalanceBody(emp_id="a", type="COMP", to=1, note="one was wrong"), SUPER)
    check(res["balances"]["COMP"]["available"] == 1, "comp-off voided back to 1")
    adj = [x async for x in db.hr_leave_adjust.find({"emp_id": "a"})]
    check(all(x["note"].startswith("Set to") for x in adj), "every reset is recorded with its reason")
    src = open(os.path.join(os.path.dirname(HERE), "hrm_leave.py"), encoding="utf-8").read()
    check("async def leave_set_balance(body: SetBalanceBody, user: dict = Depends(require_superadmin_hrm))" in src,
          "set-balance is super admin only")

    print("-- bulk --")
    B = HL.BulkBody
    pv = await HL.leave_bulk(B(type="CL", mode="add", days=1, note="Diwali bonus day"), F)
    check(not pv["applied"] and pv["rows"] and all(r["after"] == r["before"] + 1 for r in pv["rows"]), "preview: +1 CL for everyone, before -> after")
    check(not [x async for x in db.hr_leave_adjust.find({"note": {"$regex": "^Bulk"}})], "preview writes nothing")
    a0 = next(r for r in pv["rows"] if r["id"] == "a")["before"]
    res = await HL.leave_bulk(B(type="CL", mode="add", days=1, note="Diwali bonus day", preview=False), F)
    check(res["applied"] and res["changed"] == len(res["rows"]) == len(pv["rows"]), "applied to everyone in the preview")
    check(HL._left(await db.hr_employees.find_one({"id": "a"}), "CL", FY, await HL._all_requests("a"), await HL._adjustments("a")) == a0 + 1,
          "her card shows one more CL")
    res = await HL.leave_bulk(B(type="COMP", mode="set", days=0, note="year-end reset", who="people", ids=["a"], preview=False), F)
    check(len(res["rows"]) == 1 and res["rows"][0]["after"] == 0, "comp-off set to 0 for one picked person")
    res = await HL.leave_bulk(B(type="SL", mode="add", days=-60, note="floor check", who="people", ids=["a"]), F)
    check(res["rows"][0]["after"] == 0 and res["rows"][0]["floored"], "never below 0 (flagged in the preview)")
    await expect(HL.leave_bulk(B(type="CL", mode="add", days=1, note="x"), F), 400, "a reason is required")
    await expect(HL.leave_bulk(B(type="CL", mode="add", days=1, note="team outing", who="department", departments=["Nowhere"]), F), 400, "nobody matches -> refused")
    await expect(HL.leave_bulk(B(type="COMP", mode="add", days=0.5, note="half comp"), F), 400, "comp-off is whole days")
    check("async def leave_bulk(body: BulkBody, user: dict = Depends(require_hr))" in src, "bulk: HR and super admin")

asyncio.run(flow())
asyncio.run(offs())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
