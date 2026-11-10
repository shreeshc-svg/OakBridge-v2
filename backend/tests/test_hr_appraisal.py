"""HRM annual appraisal: the rules (hr_appraisal_core.py), CTC encryption
(hr_crypto.py) and the whole flow (hrm_appraisal.py) on the fake DB:
start -> self-review -> manager review -> HR approval -> released -> ack,
plus who may see what (CTC never to the manager, nothing early to the owner).

Run: python backend/tests/test_hr_appraisal.py
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


import hr_appraisal_core as C  # noqa: E402


def refused(fn, *a, **k):
    try:
        fn(*a, **k)
        return ""
    except C.Refused as e:
        return str(e)


print("-- money --")
check(C.revised_ctc(600000, 8.5) == 651000, "₹6,00,000 at 8.5% = ₹6,51,000 exactly")
check(C.revised_ctc(333333, 7.5) == 358333, "rounded to the nearest rupee (358332.975 -> 358333)")
check(C.revised_ctc(500000, 0) == 500000, "0% keeps the CTC")
check(C.clean_ctc("6,00,000") == 600000 and C.clean_ctc("₹ 6,00,000") == 600000 and C.clean_ctc("Rs. 600000") == 600000,
      "CTC accepts commas, ₹ and Rs")
check("zeros" in refused(C.clean_ctc, "6000000000"), "a CTC over ₹10 crore is refused as a typo")
check("rupees" in refused(C.clean_ctc, "six lakh"), "words refused")
check("zeros" in refused(C.clean_ctc, "0"), "zero refused")
check(C.clean_pct("8.5") == 8.5 and C.clean_pct("10%") == 10.0, "increment 8.5 / 10%")
check("half" in refused(C.clean_pct, "8.25"), "only whole or half percent")
check("between" in refused(C.clean_pct, "-2") and "between" in refused(C.clean_pct, "120"), "0–100% only")
check(C.default_effective("2026-27") == "2027-04-01", "takes effect 1 April after the year")

print("-- forms --")
full_self = {"skills": {k: 4 for k in C.SKILL_KEYS}, "achievements": "Launched the B2B channel."}
check(C.clean_self({"skills": {"quality": 3}}, submit=False)["skills"] == {"quality": 3}, "a self draft may be incomplete")
check("Rate yourself" in refused(C.clean_self, {"skills": {"quality": 3}}, submit=True), "submitting needs every skill")
check("proud" in refused(C.clean_self, {**full_self, "achievements": "ok"}, submit=True), "…and an achievement")
check("Choose a rating" in refused(C.clean_self, {**full_self, "skills": {**full_self["skills"], "quality": 7}}, submit=True), "ratings 1–5 only")
mgr = {"skills": {k: {"rating": 4, "comment": "Good"} for k in C.SKILL_KEYS}, "overall": 4, "increment_pct": 8.5,
       "summary": "A strong, dependable year with real growth."}
check(C.clean_manager(mgr, submit=True)["increment_pct"] == 8.5, "manager review complete")
check("increment" in refused(C.clean_manager, {**mgr, "increment_pct": None}, submit=True), "increment needed (0 if none)")
check(C.clean_manager({**mgr, "increment_pct": 0}, submit=True)["increment_pct"] == 0, "0% is a valid proposal")
check("summary" in refused(C.clean_manager, {**mgr, "summary": "fine"}, submit=True), "summary needed")

print("-- outcome --")
app = {"fy": "2026-27", "stage": "hr", "manager": {"overall": 4, "increment_pct": 8.5, "designation": "Senior Editor"}, "hr": {}}
check(C.final_outcome(app)["increment_pct"] == 8.5 and C.final_outcome(app)["designation"] == "Senior Editor", "manager's proposal by default")
app["hr"] = {"increment_pct": 10.0}
check(C.final_outcome(app)["increment_pct"] == 10.0 and C.changed_fields(app["manager"], app["hr"]) == ["increment_pct"], "HR's change wins and is flagged")
app["hr"] = {"designation": ""}
check(C.final_outcome(app)["designation"] == "" and C.changed_fields(app["manager"], app["hr"]) == ["designation"],
      "HR can say 'no promotion' (empty designation wins)")
app["hr"] = {"increment_pct": 0.0}
check(C.final_outcome(app)["increment_pct"] == 0.0, "HR can set 0%")

print("-- encryption --")
import hr_crypto  # noqa: E402
os.environ.pop("HRM_DATA_KEY", None)
check(not hr_crypto.configured(), "no key -> not configured")
os.environ["HRM_DATA_KEY"] = "short"
check(not hr_crypto.configured(), "a short key is refused")
os.environ["HRM_DATA_KEY"] = "t" * 40
tok = hr_crypto.encrypt_amount(651000)
check("651000" not in tok and hr_crypto.decrypt_amount(tok) == 651000, "CTC stored scrambled; reads back exactly")
os.environ["HRM_DATA_KEY"] = "u" * 40
try:
    hr_crypto.decrypt_amount(tok)
    check(False, "a wrong key never returns a number")
except Exception:  # noqa: BLE001
    check(True, "a wrong key never returns a number")
os.environ["HRM_DATA_KEY"] = "t" * 40


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


audits = []


async def _audit(db, action, **k):
    audits.append((action, k.get("meta")))

mails = []


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
import hrm_appraisal as HA  # noqa: E402

TODAY = [date(2027, 4, 5)]
HA._today = lambda: TODAY[0]


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code}: {e.detail})")


def has_ctc(obj) -> bool:
    import json
    return any(x in json.dumps(obj) for x in ("600000", "651000", "660000", "_enc"))


async def flow():
    for p in ({"id": "f", "name": "Founder", "work_email": "f@o.in", "status": "active", "hr_access": True, "user_id": "uf",
               "joined_on": "2020-01-01", "confirmed_on": "2020-07-01", "designation": "Director"},
              {"id": "m", "name": "Meera", "work_email": "m@o.in", "status": "active", "manager_id": "f", "user_id": "um",
               "joined_on": "2022-01-01", "confirmed_on": "2022-07-01", "designation": "Editor-in-chief"},
              {"id": "a", "name": "Asha", "work_email": "a@o.in", "status": "active", "manager_id": "m", "user_id": "ua",
               "joined_on": "2024-01-10", "confirmed_on": "2024-07-10", "designation": "Editor", "emp_code": "OB-007"},
              {"id": "z", "name": "Zed", "work_email": "z@o.in", "status": "active", "manager_id": "f", "user_id": "uz",
               "joined_on": "2025-01-10", "confirmed_on": "2025-07-10"},
              {"id": "n", "name": "New Joiner", "work_email": "n@o.in", "status": "active", "manager_id": "m", "user_id": "un",
               "joined_on": "2027-03-01"}):
        await db.hr_employees.insert_one(p)
    U = lambda i: {"id": f"u{i}", "email": f"{i}@o.in", "role": "customer"}  # noqa: E731
    A, M, F, Z = U("a"), U("m"), U("f"), U("z")
    FY = "2026-27"

    print("-- start --")
    await expect(HA.cycle_start(HA.CycleBody(fy=FY, self_due="2027-04-20", manager_due="2027-04-10"), F), 400, "manager deadline after self deadline")
    r = await HA.cycle_start(HA.CycleBody(fy=FY, self_due="2027-04-20", manager_due="2027-04-30"), F)
    check(r["people"] == 4, "started for the 4 confirmed people (not the one on probation)")
    check(any(m["to"] == "a@o.in" and "appraisal has started" in m["subject"] for m in mails), "everyone emailed")
    await expect(HA.cycle_start(HA.CycleBody(fy=FY, self_due="2027-04-20", manager_due="2027-04-30"), F), 409, "can't start twice")
    await HA.cycle_add(HA.AddBody(fy=FY, emp_id="n"), F)
    await expect(HA.cycle_add(HA.AddBody(fy=FY, emp_id="n"), F), 409, "HR adds someone once")
    check((await HA.cycle_get(None, A))["fy"] == FY, "everyone lands on the started year")

    print("-- self-review --")
    mine = (await HA.appraisal_mine(None, A))["appraisal"]
    aid = mine["id"]
    check(mine["can"]["self"] and mine["manager_name"] == "Meera" and "manager" not in mine, "Asha can fill hers; sees who reviews it")
    await expect(HA.appraisal_get(aid, Z), 404, "a colleague can't open it")
    await HA.appraisal_self(aid, HA.SelfBody(skills={"quality": 4}, achievements="Draft"), A)
    m_view = await HA.appraisal_get(aid, M)
    check("self" not in m_view, "manager can't see a self-review that isn't submitted")
    await expect(HA.appraisal_self(aid, HA.SelfBody(skills={"quality": 4}, achievements="Draft", submit=True), A), 400, "submit needs all skills")
    await expect(HA.appraisal_manager(aid, HA.ManagerBody(**mgr), M), 409, "manager waits for the self-review")
    mails.clear()
    await HA.appraisal_self(aid, HA.SelfBody(**full_self, submit=True), A)
    check(any(m["to"] == "m@o.in" for m in mails), "manager emailed")
    await expect(HA.appraisal_self(aid, HA.SelfBody(**full_self), A), 409, "self-review locked once submitted")

    print("-- manager --")
    await expect(HA.appraisal_manager(aid, HA.ManagerBody(**mgr), F), 403, "HR doesn't fill the manager part when there is a manager")
    await expect(HA.appraisal_manager(aid, HA.ManagerBody(**mgr), Z), 404, "a colleague can't")
    m_view = await HA.appraisal_get(aid, M)
    check(m_view["self"]["skills"]["quality"] == 4 and m_view["can"]["manager"], "manager sees the self-review and can review")
    mails.clear()
    await HA.appraisal_manager(aid, HA.ManagerBody(**{**mgr, "designation": "Senior Editor"}, submit=True), M)
    check(any(m["to"] == "f@o.in" and "to approve" in m["subject"] for m in mails), "HR emailed")
    mine = (await HA.appraisal_mine(None, A))["appraisal"]
    check("manager" not in mine and "outcome" not in mine and mine["stage"] == "hr", "Asha sees only where it is — nothing early")

    print("-- HR --")
    await expect(HA.appraisal_hr(aid, HA.HrBody(increment_pct=10), F), 400, "changing the % needs a reason")
    os.environ.pop("HRM_DATA_KEY")
    await expect(HA.appraisal_hr(aid, HA.HrBody(current_ctc="6,00,000"), F), 400, "no HRM_DATA_KEY -> CTC refused")
    os.environ["HRM_DATA_KEY"] = "t" * 40
    v = await HA.appraisal_hr(aid, HA.HrBody(current_ctc="6,00,000", effective_from="2027-04-01"), F)
    check(v["ctc"] == {"current": 600000, "revised": 651000}, "HR: 6,00,000 at 8.5% -> 6,51,000")
    raw = await db.hr_appraisals.find_one({"id": aid})
    check(raw["hr"]["current_ctc_enc"] and "600000" not in str(raw), "CTC encrypted in the database")
    check(any(a == "HRM_CTC_SET" for a, _ in audits) and any(a == "HRM_CTC_VIEWED" for a, _ in audits), "CTC set / viewed are audited")
    v = await HA.appraisal_hr(aid, HA.HrBody(increment_pct=10, reason="Exceptional B2B results this year"), F)
    check(v["ctc"]["revised"] == 660000 and v["hr"]["changes"][0]["field"] == "increment_pct", "HR raises to 10%: revised follows, change recorded")
    m_view = await HA.appraisal_get(aid, M)
    check(not has_ctc(m_view) and m_view.get("ctc") is None, "manager never sees CTC")
    team = await HA.appraisal_team(FY, M)
    check(sorted(r["name"] for r in team["rows"]) == ["Asha", "New Joiner"] and not has_ctc(team), "manager's team list: no CTC")
    await expect(HA.appraisal_team(FY, A), 403, "employees don't get the team list")
    await expect(HA.appraisal_release(aid, M), 403, "manager can't release")

    print("-- send back --")
    await HA.appraisal_reopen(aid, HA.ReopenBody(part="manager", note="Add comments for each skill"), F)
    check((await HA.appraisal_get(aid, M))["can"]["manager"], "sent back to the manager")
    await HA.appraisal_manager(aid, HA.ManagerBody(**{**mgr, "increment_pct": 12, "designation": "Senior Editor"}, submit=True), M)
    v = await HA.appraisal_get(aid, F)
    check(v["ctc"]["revised"] == 660000, "HR's 10% still wins over the manager's new 12%")
    v = await HA.appraisal_hr(aid, HA.HrBody(increment_pct=12, designation=""), F)
    check(v["ctc"]["revised"] == 672000 and v["outcome"]["designation"] == "", "HR: 12% and no promotion")
    await HA.appraisal_hr(aid, HA.HrBody(designation="Senior Editor", reason="Promotion agreed by founders"), F)

    print("-- release --")
    mails.clear()
    v = await HA.appraisal_release(aid, F)
    check(v["stage"] == "released", "released")
    check(any(m["to"] == "a@o.in" for m in mails), "Asha emailed")
    check((await db.hr_employees.find_one({"id": "a"}))["designation"] == "Senior Editor", "effective date reached: new designation applied")
    check(await HA.apply_due() == 0, "applied once only")
    mine = (await HA.appraisal_mine(None, A))["appraisal"]
    check(mine["outcome"]["increment_pct"] == 12 and mine["ctc"]["revised"] == 672000 and mine["can"]["letter"], "Asha sees result, own CTC, letter")
    check("hr" not in mine, "Asha doesn't see HR's internal notes")
    m_view = await HA.appraisal_get(aid, M)
    check(m_view["outcome"]["increment_pct"] == 12 and not has_ctc(m_view), "manager sees the % after release, still no CTC")
    await expect(HA.appraisal_hr(aid, HA.HrBody(increment_pct=1, reason="too late to change this"), F), 403, "locked after release")
    pay = await HA.payroll_rows("2027-04")
    check(pay == {"a": (12.0, 672000)}, "on April's RazorpayX export")

    print("-- letter + ack --")
    pdf = HA.letter_pdf(await db.hr_appraisals.find_one({"id": aid}, {"_id": 0}), await db.hr_employees.find_one({"id": "a"}), {"revised": 672000})
    check(pdf[:4] == b"%PDF", "letter PDF builds")
    check(HA._inr(672000) == "6,72,000" and HA._inr(12345678) == "1,23,45,678", "Indian grouping on the letter")
    await expect(HA.appraisal_ack(aid, HA.AckBody(disagree=True, comment="no"), A), 400, "disagreeing needs a reason")
    mails.clear()
    await HA.appraisal_ack(aid, HA.AckBody(disagree=True, comment="I expected the promotion earlier."), A)
    check(any(m["to"] == "f@o.in" and "Disagreement" in m["subject"] for m in mails), "HR told about the disagreement")
    await expect(HA.appraisal_ack(aid, HA.AckBody(), A), 409, "acknowledged once")

    print("-- HR's own appraisal --")
    fown = (await HA.appraisal_mine(None, F))["appraisal"]
    check(fown["role"] == "owner" and not fown["can"]["release"], "HR is just the owner of their own appraisal")
    team = await HA.appraisal_team(FY, F)
    check("Founder" not in [r["name"] for r in team["rows"]], "…and it isn't in their HR list")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
