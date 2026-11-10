"""HRM release 3 — goals: the rules (hr_goals_core.py) and the flow
(hrm_goals.py) on the fake DB: draft -> submit -> approve/return -> quarterly
check-in + review -> year-end rating hidden until HR releases it.

Run: python backend/tests/test_hr_goals.py
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


import hr_goals_core as G  # noqa: E402

print("-- rules --")
check(G.quarter_bounds("2026-27", "Q1") == (date(2026, 4, 1), date(2026, 6, 30))
      and G.quarter_bounds("2026-27", "Q4") == (date(2027, 1, 1), date(2027, 3, 31)), "quarters Apr–Jun … Jan–Mar")
check(G.open_quarters("2026-27", date(2026, 7, 20)) == ["Q1", "Q2"], "Q1 still open 30 days after it ends")
check(G.open_quarters("2026-27", date(2026, 8, 5)) == ["Q2"], "…then closes")
check(not G.rating_open("2026-27", date(2027, 1, 20)) and G.rating_open("2026-27", date(2027, 2, 20))
      and G.rating_open("2026-27", date(2027, 5, 20)) and not G.rating_open("2026-27", date(2027, 6, 5)), "ratings: mid-Feb to end of May")


def refused(fn, *a, **k):
    try:
        fn(*a, **k)
        return ""
    except G.Refused as e:
        return str(e)


ok = [{"title": "Grow B2B sales", "measure": "₹50L orders", "weight": 60}, {"title": "Launch 10 titles", "weight": 40}]
check(len(G.clean_goals(ok, strict=True)) == 2, "two goals, 60 + 40 = 100")
check("100%" in refused(G.clean_goals, [{"title": "A", "weight": 60}, {"title": "B", "weight": 30}], strict=True), "weights must total 100")
check("at least 5%" in refused(G.clean_goals, [{"title": "A", "weight": 98}, {"title": "B", "weight": 2}], strict=True), "minimum weight")
check("between 1 and 8" in refused(G.clean_goals, [{"title": str(i), "weight": 10} for i in range(9)], strict=True), "at most 8 goals")
check(G.clean_goals([{"title": "", "weight": 0}, {"title": "Half done", "weight": 50}], strict=False)[0]["title"] == "Half done",
      "a draft may be incomplete")
gs = G.clean_goals(ok, strict=True)
check(G.overall(gs, {gs[0]["id"]: 50, gs[1]["id"]: 100}) == 70, "overall = weighted progress (60×50% + 40×100% = 70%)")
check("every goal" in refused(G.clean_progress, gs, {gs[0]["id"]: 50}), "progress for every goal")
check("0–100" in refused(G.clean_progress, gs, {gs[0]["id"]: 50, gs[1]["id"]: 140}), "progress 0–100")
v = G.view_for({"goals": gs, "checkins": {}, "year_end": {"rating": 2}}, is_owner=True, released=False)
check(v["year_end"] == {"pending": True}, "rating hidden from the employee until released")
check(G.view_for({"goals": gs, "checkins": {}, "year_end": {"rating": 2}}, is_owner=False, released=False)["year_end"]["rating"] == 2,
      "manager / HR see it")


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
_mod("fastapi", APIRouter=_Router, HTTPException=HTTPException, Depends=lambda *a, **k: None, File=lambda *a, **k: None, UploadFile=object)
_mod("fastapi.responses", Response=lambda **k: k)
_mod("pydantic", BaseModel=BaseModel)
_mod("extensions", db=db, get_current_user=lambda: None, hash_password=lambda p: "h")
_mod("audit", audit_log=_anoop)
_mod("rbac", is_superadmin=lambda r: r in ("superadmin", "admin"), SUPERADMIN_ROLES=frozenset({"superadmin", "admin"}))
_mod("emailer", send_email=_send, send_hrm_invite=_anoop)
import hrm_goals as HG  # noqa: E402

TODAY = [date(2026, 4, 10)]
HG._today = lambda: TODAY[0]


async def expect(coro, status, label):
    try:
        await coro
        check(False, label)
    except HTTPException as e:
        check(e.status_code == status, f"{label} ({e.status_code})")


async def flow():
    for p in ({"id": "f", "name": "Founder", "work_email": "f@o.in", "status": "active", "hr_access": True, "user_id": "uf", "joined_on": "2020-01-01"},
              {"id": "m", "name": "Meera", "work_email": "m@o.in", "status": "active", "manager_id": "f", "user_id": "um", "joined_on": "2022-01-01"},
              {"id": "a", "name": "Asha", "work_email": "a@o.in", "status": "active", "manager_id": "m", "user_id": "ua", "joined_on": "2024-01-10"},
              {"id": "z", "name": "Zed", "work_email": "z@o.in", "status": "active", "manager_id": "f", "user_id": "uz", "joined_on": "2025-01-10"}):
        await db.hr_employees.insert_one(p)
    U = lambda i: {"id": f"u{i}", "email": f"{i}@o.in", "role": "customer"}  # noqa: E731
    A, M, F, Z = U("a"), U("m"), U("f"), U("z")
    FY = "2026-27"
    print("-- set goals --")
    v = await HG.goals_plan(None, FY, A)
    check(v["id"] is None and v["can"]["edit"] and v["status"] == "draft", "no goals yet: Asha can draft")
    v = await HG.goals_save_draft(HG.DraftBody(fy=FY, goals=[{"title": "Grow B2B", "weight": 60}]), A)
    await expect(HG.goals_submit(HG.SubmitBody(fy=FY), A), 400, "can't submit until weights total 100")
    v = await HG.goals_save_draft(HG.DraftBody(fy=FY, goals=ok), A)
    pid = v["id"]
    v = await HG.goals_submit(HG.SubmitBody(fy=FY), A)
    check(v["status"] == "submitted" and any(m["to"] == "m@o.in" for m in mails), "submitted; manager emailed")
    await expect(HG.goals_save_draft(HG.DraftBody(fy=FY, goals=ok), A), 409, "locked once submitted")
    await expect(HG.goals_decide(pid, HG.DecideBody(approve=True), Z), 404, "someone outside the team can't see / approve")
    await expect(HG.goals_decide(pid, HG.DecideBody(approve=False, note="x"), M), 400, "returning needs a real note")
    v = await HG.goals_decide(pid, HG.DecideBody(approve=False, note="Make B2B measurable"), M)
    check(v["status"] == "returned" and v["can"]["decide"] is False, "manager returns it")
    v = await HG.goals_save_draft(HG.DraftBody(fy=FY, goals=[{**ok[0], "measure": "₹50L"}, ok[1]]), A)
    await HG.goals_submit(HG.SubmitBody(fy=FY), A)
    edited = [{**ok[0], "id": "g1", "weight": 70}, {**ok[1], "id": "g2", "weight": 30}]
    v = await HG.goals_decide(pid, HG.DecideBody(approve=True, goals=edited), M)
    check(v["status"] == "approved" and v["goals"][0]["weight"] == 70, "manager approves with edits")
    check((await HG.goals_plan("a", FY, F))["status"] == "approved", "HR sees it")
    await expect(HG.goals_plan("a", FY, Z), 404, "a colleague can't see Asha's goals")

    print("-- quarter --")
    TODAY[0] = date(2026, 7, 5)
    await expect(HG.goals_checkin(pid, HG.CheckinBody(q="Q3", progress={"g1": 1, "g2": 1}), A), 400, "only open quarters")
    await expect(HG.goals_checkin(pid, HG.CheckinBody(q="Q1", progress={"g1": 40, "g2": 50}), M), 403, "manager can't check in for her")
    v = await HG.goals_checkin(pid, HG.CheckinBody(q="Q1", progress={"g1": 40, "g2": 50}, note="Good start"), A)
    check(v["overall"] == 43, "overall 70×40% + 30×50% = 43%")
    await expect(HG.goals_review(pid, HG.ReviewBody(q="Q1", status={"g1": "on_track"}, comment="Nice work"), M), 400, "status for every goal")
    v = await HG.goals_review(pid, HG.ReviewBody(q="Q1", status={"g1": "on_track", "g2": "at_risk"}, comment="Push the launches"), M)
    check(v["checkins"]["Q1"]["review"]["status"]["g2"] == "at_risk" and any(m["to"] == "a@o.in" for m in mails), "manager reviews; Asha emailed")
    await expect(HG.goals_checkin(pid, HG.CheckinBody(q="Q1", progress={"g1": 90, "g2": 90}), A), 409, "can't rewrite a reviewed quarter")
    team = await HG.goals_team(FY, M)
    check([r["name"] for r in team["rows"]] == ["Asha"] and team["rows"][0]["quarters"]["Q1"] == "reviewed", "manager's team view")
    await expect(HG.goals_team(FY, A), 403, "employees don't get the team view")

    print("-- year end --")
    await expect(HG.goals_rating(pid, HG.RatingBody(rating=4, summary="Strong year, B2B well ahead of target."), M), 400, "ratings not open in July")
    TODAY[0] = date(2027, 3, 1)
    await HG.goals_rating(pid, HG.RatingBody(rating=4, summary="Strong year, B2B well ahead of target."), M)
    check((await HG.goals_plan(None, FY, A))["year_end"] == {"pending": True}, "Asha can't see her rating yet")
    check((await HG.goals_plan("a", FY, F))["year_end"]["rating"] == 4, "HR sees it")
    await HG.goals_release(HG.ReleaseBody(fy=FY), F)
    check((await HG.goals_plan(None, FY, A))["year_end"]["label"] == "Above expectations", "after HR releases, Asha sees it")
    src = open(os.path.join(os.path.dirname(HERE), "hrm_goals.py"), encoding="utf-8").read()
    check("async def goals_release(body: ReleaseBody, user: dict = Depends(require_hr))" in src, "only HR releases ratings")

    print("-- reminders --")
    mails.clear()
    n = await HG.quarterly_reminders(date(2027, 4, 2))
    check(n >= 1 and any("goals for 2027-28" in m["subject"] for m in mails), "April: reminded to set next year's goals")
    check(await HG.quarterly_reminders(date(2027, 4, 3)) == 0, "once per quarter only")

asyncio.run(flow())
print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
