"""HRM separation + recognition: rules (hr_separation_core.py) and flows
(hrm_separation.py, hrm_recognition.py) on the fake DB.

Run: python backend/tests/test_hr_separation.py
"""
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


import hr_separation_core as C  # noqa: E402


def refused(fn, *a, **k):
    try:
        fn(*a, **k)
        return ""
    except C.Refused as e:
        return str(e)


T = date(2026, 11, 12)
print("-- rules --")
check(C.default_last_day(T) == date(2026, 12, 12), "30 days' notice by default")
check(C.shortfall(T, date(2026, 12, 2)) == 10 and C.shortfall(T, date(2026, 12, 20)) == 0, "notice shortfall recorded for F&F")
check(C.fnf_due("2026-12-12") == "2026-12-26", "F&F due 14 days after the last day")
check("reason" in refused(C.check_resignation, "bye", "2026-12-12", T, None), "resignation needs a reason")
check("past" in refused(C.check_resignation, "Moving to another city", "2026-11-01", T, None), "last day not in the past")
check("2 weeks" in refused(C.clean_pip, {"expectations": "Hit 90% accuracy on proofs every week", "start": "2026-11-12", "end": "2026-11-20"}, T),
      "a PIP runs at least 2 weeks")
check("2 days" in refused(C.clean_show_cause, {"text": "You were absent without leave on 3 and 4 Nov and did not reply.", "deadline": "2026-11-13"}, T),
      "show-cause gives at least 2 days to reply")
case = {"status": "open", "ground": "performance", "steps": {}}
check("PIP first" in refused(C.check_terminate, case, {}, T, notice="served", last_day="2026-12-12", note="PIP not met, decision recorded."),
      "performance: no PIP -> refused")
case["steps"]["pip"] = {"start": "2026-10-01", "end": "2026-11-01", "outcome": None}
check("not met" in refused(C.check_terminate, case, {}, T, notice="served", last_day="2026-12-12", note="PIP not met, decision recorded."),
      "performance: PIP outcome must be 'not met'")
case["steps"]["pip"]["outcome"] = "not_met"
check("only for proven" in refused(C.check_terminate, case, {}, T, notice="none", last_day="2026-12-12", note="PIP not met, decision recorded."),
      "no-notice termination only for misconduct / absconding")
check(C.check_terminate(case, {}, T, notice="pay_in_lieu", last_day="2026-11-12", note="PIP not met, decision recorded.") == T,
      "performance after a failed PIP: allowed")
mis = {"status": "open", "ground": "misconduct", "steps": {"show_cause": {"deadline": "2026-11-15", "reply": None}}}
check("Wait for the reply" in refused(C.check_terminate, mis, {}, T, notice="none", last_day="2026-11-12", note="Findings recorded after enquiry."),
      "misconduct: wait for the reply or the deadline")
check("7+" in refused(C.check_terminate, {"status": "open", "ground": "absconding", "steps": {"absence": {"since": "2026-11-09"}}}, {}, T,
                      notice="none", last_day="2026-11-12", note="Absent, no contact, notice sent."), "absconding needs 7+ days")
check("confirmed" in refused(C.check_terminate, {"status": "open", "ground": "probation", "steps": {}}, {"confirmed_on": "2026-01-01"}, T,
                             notice="served", last_day="2026-12-12", note="Probation review not passed."), "probation ground only before confirmation")
ev = C.employee_view({"id": "c", "status": "open", "note": "SECRET", "steps": {"absence": {"since": "x"}}})
check(ev is None, "employee sees nothing of a case with no notice addressed to them")
ev = C.employee_view({"id": "c", "status": "open", "note": "SECRET", "steps": {"show_cause": {"text": "t", "deadline": "d"}}})
check(ev and "show_cause" in ev and "SECRET" not in json.dumps(ev), "employee sees the show-cause notice, never the case notes")


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


mails = []


async def _send(**k):
    mails.append(k)
    return True


async def _anoop(*a, **k):
    return None

db = DB()
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None, File=lambda *a, **k: None, UploadFile=object)
_mod("fastapi.responses", Response=lambda **k: k)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, get_current_user=lambda: None, hash_password=lambda p: "h")
_mod("audit", audit_log=_anoop)
_mod("rbac", is_superadmin=lambda r: r in ("superadmin", "admin"), SUPERADMIN_ROLES=frozenset({"superadmin", "admin"}),
     ADMIN_ROLES=frozenset({"superadmin", "admin", "manager", "warehouse"}))
_mod("emailer", send_email=_send, send_hrm_invite=_anoop)
import hrm_separation as HS  # noqa: E402
import hrm_recognition as HR  # noqa: E402
import hrm_lifecycle as HL  # noqa: E402

for m in (HS, HR, HL):
    m._today = lambda: T


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code}: {e.detail})")


async def flow():
    for p in ({"id": "f", "name": "Founder", "work_email": "f@o.in", "status": "active", "hr_access": True, "user_id": "uf",
               "joined_on": "2020-01-01", "confirmed_on": "2020-07-01"},
              {"id": "m", "name": "Meera", "work_email": "m@o.in", "status": "active", "manager_id": "f", "user_id": "um",
               "joined_on": "2022-01-01", "confirmed_on": "2022-07-01"},
              {"id": "a", "name": "Asha", "work_email": "a@o.in", "status": "active", "manager_id": "m", "user_id": "ua",
               "joined_on": "2024-01-10", "confirmed_on": "2024-07-10", "designation": "Editor"},
              {"id": "z", "name": "Zed", "work_email": "z@o.in", "status": "active", "manager_id": "m", "user_id": "uz",
               "joined_on": "2025-01-10", "confirmed_on": "2025-07-10"}):
        await db.hr_employees.insert_one(p)
        await db.users.insert_one({"id": p["user_id"], "email": p["work_email"], "role": "customer"})
    U = lambda i: {"id": f"u{i}", "email": f"{i}@o.in", "role": "customer"}  # noqa: E731
    A, M, F, Z = U("a"), U("m"), U("f"), U("z")

    print("-- resignation --")
    r = await HS.sep_resign(HS.ResignBody(reason="Moving to Bengaluru for family reasons."), A)
    sid = r["id"]
    check(r["status"] == "manager" and r["requested_last_day"] == "2026-12-12", "submitted -> with her manager; last day = 30 days' notice")
    check({m["to"] for m in mails} >= {"m@o.in", "f@o.in", "a@o.in"}, "manager, HR and Asha emailed")
    await expect(HS.sep_resign(HS.ResignBody(reason="Moving to Bengaluru for family reasons."), A), 409, "one at a time")
    await expect(HS.sep_accept(sid, HS.AcceptBody(last_day="2026-12-12"), F), 409, "HR waits for the manager")
    await expect(HS.sep_manager(sid, HS.ManagerBody(comment="Tried to retain her; handover to Zed planned."), Z), 404, "a colleague can't act")
    board = await HS.sep_board(M)
    check([x["name"] for x in board["resignations"]] == ["Asha"] and board["cases"] == [] and board["fnf"] == [], "manager's board: team resignation only")
    await HS.sep_manager(sid, HS.ManagerBody(comment="Tried to retain her; handover to Zed planned.", suggested_last_day="2026-12-05"), M)
    mails.clear()
    r = await HS.sep_accept(sid, HS.AcceptBody(last_day="2026-12-05", waive_shortfall=True), F)
    check(r["status"] == "accepted" and r["shortfall_days"] == 7 and r["fnf"] == {"due": "2026-12-19", "status": "pending"},
          "HR accepts: 7 days short (waived), F&F due 19 Dec")
    emp = await db.hr_employees.find_one({"id": "a"})
    check(emp["exited_on"] == "2026-12-05" and emp["exit"]["reason"] == "resigned" and emp.get("exit_checklist"), "the normal exit is recorded")
    check(any(m["to"] == "a@o.in" and "accepted" in m["subject"] for m in mails), "Asha told, with her last day")
    await expect(HS.sep_withdraw(sid, A), 409, "can't withdraw after acceptance")
    HS._today = lambda: date(2026, 12, 21)
    check(await HS.fnf_reminders() == 1 and await HS.fnf_reminders() == 0, "F&F overdue -> HR reminded once")
    HS._today = lambda: T
    r = await HS.sep_fnf(sid, HS.FnfBody(note="Paid via RazorpayX"), F)
    check(r["fnf"]["status"] == "paid", "HR marks F&F paid")
    pdf = await HS.sep_letter(sid, A)
    check(pdf["media_type"] == "application/pdf" and pdf["content"][:4] == b"%PDF", "acceptance letter PDF for the employee")

    r2 = await HS.sep_resign(HS.ResignBody(reason="Going back to studies full time."), Z)
    await HS.sep_withdraw(r2["id"], Z)
    check((await db.hr_separations.find_one({"id": r2["id"]}))["status"] == "withdrawn", "withdrawn before acceptance")

    print("-- termination --")
    await expect(HS.case_open(HS.CaseBody(emp_id="f", ground="performance"), F), 400, "no case about yourself")
    c = await HS.case_open(HS.CaseBody(emp_id="z", ground="misconduct", note="Repeated rude emails to an author."), F)
    cid = c["id"]
    await expect(HS.case_step(cid, "terminate", HS.StepBody(notice="none", last_day="2026-11-12", note="Decision after the enquiry."), F), 400,
                 "can't terminate before a show-cause notice")
    await expect(HS.case_step(cid, "show-cause", HS.StepBody(text="x", deadline="2026-11-20"), M), 403, "a manager can't issue one")
    await HS.case_step(cid, "show-cause", HS.StepBody(text="Emails on 2 and 4 Nov to an author were abusive. Explain why action shouldn't be taken.",
                                                       deadline="2026-11-16"), F)
    mine = await HS.sep_mine(Z)
    check(mine["notices"] and "show_cause" in mine["notices"][0] and "Repeated rude" not in json.dumps(mine), "Zed sees the notice, not HR's notes")
    await HS.case_step(cid, "reply", HS.StepBody(text="I apologise — I was under stress; it won't happen again."), Z)
    await expect(HS.case_step(cid, "reply", HS.StepBody(text="Second reply attempt here."), Z), 409, "one reply")
    r = await HS.case_step(cid, "terminate", HS.StepBody(notice="pay_in_lieu", last_day="2026-11-12", note="Reply considered; second incident after warning."), F)
    check(r["status"] == "terminated" and r["fnf"]["due"] == "2026-11-26", "terminated after the reply; F&F due in 14 days")
    check((await db.hr_employees.find_one({"id": "z"}))["exit"]["reason"] == "terminated", "exit recorded as terminated")

    print("-- recognition --")
    await expect(HR.rec_give(HR.GiveBody(emp_id="f", kind="award", title="Top", message="Great leadership all year long."), F), 400, "not to yourself")
    await expect(HR.rec_give(HR.GiveBody(emp_id="m", kind="award", title="Star", message="Thanks", amount=5000), F), 400, "a real message")
    await expect(HR.rec_give(HR.GiveBody(emp_id="m", kind="award", title="Star", message="Brilliant launch of the law catalogue.", amount=5000), F), 400,
                 "only a reward carries money")
    g = await HR.rec_give(HR.GiveBody(emp_id="m", kind="reward", title="Launch hero", message="Brilliant launch of the law catalogue.",
                                      amount=5000, shout_out=True, badge="rocket"), F)
    mine = (await HR.rec_mine(M))["rows"]
    check(mine[0]["amount"] == 5000 and mine[0]["message"], "Meera sees hers, with the amount")
    shout = (await HR.rec_shoutouts(A))["rows"]
    check(shout and shout[0]["title"] == "Launch hero" and "amount" not in shout[0] and "message" not in shout[0], "shout-out: name + title only, no money")
    await HR.rec_give(HR.GiveBody(emp_id="a", kind="appreciation", title="Thank you", message="Your proofreading saved the Tax Manual launch."), F)
    team = (await HR.rec_team(M))["rows"]
    check([t["name"] for t in team] == ["Asha"] and "amount" not in team[0], "manager sees the team's, never amounts")
    pdf = await HR.rec_letter(g["id"], M)
    check(pdf["content"][:4] == b"%PDF", "appreciation letter PDF")
    await expect(HR.rec_letter(g["id"], A), 404, "a colleague can't open someone else's letter")
    print("-- congratulations --")
    await expect(HR.rec_congrats(g["id"], HR.CongratsBody(reaction="clap"), M), 400, "can't congratulate yourself")
    s1 = await HR.rec_congrats(g["id"], HR.CongratsBody(reaction="clap", note="Well deserved, Meera!"), A)
    check(s1["count"] == 1 and s1["mine"]["reaction"] == "clap", "Asha claps with a note")
    s1 = await HR.rec_congrats(g["id"], HR.CongratsBody(reaction="party", note="Well deserved, Meera! 🎉"), A)
    check(s1["count"] == 1 and s1["by_reaction"]["party"] == 1 and s1["by_reaction"]["clap"] == 0, "again = change it (still one per person)")
    await HR.rec_congrats(g["id"], HR.CongratsBody(reaction="heart"), Z)
    sh = (await HR.rec_shoutouts(Z))["rows"][0]
    check(sh["congrats"]["count"] == 2 and sh["congrats"]["mine"]["reaction"] == "heart" and not sh["congrats"].get("amount"), "shout-out shows counts + my reaction")
    mine = (await HR.rec_mine(M))["rows"][0]
    check(mine["congrats"]["count"] == 2 and set(mine["congrats"]["recent"]) == {"Asha", "Zed"}, "Meera sees who congratulated her")
    lst = await HR.rec_congrats_list(g["id"], Z)
    check(any(x["note"].startswith("Well deserved") for x in lst["rows"]), "everyone can read the notes on a shared one")
    await HR.rec_congrats_undo(g["id"], Z)
    log = (await HR.rec_congrats_log(F))["rows"]
    zl = next(x for x in log if x["by_name"] == "Zed")
    al = next(x for x in log if x["by_name"] == "Asha")
    check(zl["status"] == "removed" and al["edits"][0]["reaction"] == "clap" and al["to_name"] == "Meera",
          "HR log: who wrote what, to whom — including edits and taken-back reactions")
    await HR.rec_congrats_hide(al["id"], HR.HideBody(reason="Contains a private joke"), F)
    check((await HR.rec_congrats_list(g["id"], Z))["rows"] == [] and (await HR.rec_congrats_log(F))["rows"][0]["status"] in ("hidden", "removed"),
          "HR hides a note: gone for everyone, still in HR's log")
    await expect(HR.rec_congrats(g["id"], HR.CongratsBody(reaction="clap", note="again"), A), 409, "a hidden note can't be re-posted")
    mails.clear()
    n = await HR.congrats_digest()
    check(n == 0, "hidden / removed ones aren't emailed")
    await HR.rec_congrats(g["id"], HR.CongratsBody(reaction="fire"), Z)
    check(await HR.congrats_digest() == 1 and await HR.congrats_digest() == 0 and any("congratulated you" in m["subject"] for m in mails),
          "one daily email to Meera, then nothing until new ones")
    priv = await HR.rec_give(HR.GiveBody(emp_id="a", kind="appreciation", title="Private thanks", message="Thanks for staying late on the catalogue."), F)
    await expect(HR.rec_congrats(priv["id"], HR.CongratsBody(), Z), 404, "private recognitions can't be congratulated")
    src = open(os.path.join(os.path.dirname(HERE), "hrm_recognition.py"), encoding="utf-8").read()
    check("async def rec_congrats_log(user: dict = Depends(require_hr))" in src and "async def rec_congrats_hide(cid: str, body: HideBody, user: dict = Depends(require_hr))" in src,
          "log + hide: HR only")
    await HR.rec_withdraw(g["id"], F)
    check((await HR.rec_shoutouts(A))["rows"] == [] and (await HR.rec_mine(M))["rows"] == [], "withdrawn: gone everywhere")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
