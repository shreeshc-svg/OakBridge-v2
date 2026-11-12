"""HRM separation — resignation and termination: the rules (Nov 2026). Pure,
no I/O; hrm_separation.py moves the data. Tested by tests/test_hr_separation.py.

RESIGNATION (decided with the founders)
  employee submits (reason + the last day they propose; default = notice)
    -> their reporting manager ("next manager") reviews: comment, may suggest
       a different last day, accepts and forwards — skipped when there is no
       active manager
    -> HR finalises: the final last working day, and whether notice is
       waived / they're released early (any shortfall is recorded for F&F)
    -> the normal exit runs (hrm_lifecycle.record_exit): exit checklist, EL
       encashment, access closes after the last day.
  The employee can withdraw until HR finalises. Notice: 30 days (setting).
  Full & final settlement: due 14 days after the last working day.

TERMINATION (HR access / Director accounts)
  A documented case, never a one-click action. Each ground needs its record
  BEFORE "terminate" is allowed (check_terminate):
    performance  a PIP (expectations, start, end) that has ended and was
                 marked "not met"
    misconduct   a show-cause notice issued to the employee, and their reply
                 OR the reply deadline passed (min 2 days to reply)
    absconding   absent without intimation for 7+ days (leave policy) AND a
                 "return to work" notice recorded as sent
    probation    the person is not confirmed
    redundancy   a written business reason (20+ characters)
  Notice: served / pay in lieu; "none" only for misconduct or absconding.
  The employee sees the show-cause notice (to reply) and the PIP (to know
  what's expected) — never the case notes — and the outcome once decided.

Not legal advice: grounds and letter wording should be reviewed by the
company's CA / lawyer against its appointment letters and the applicable
Shops & Establishments Act.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

NOTICE_DAYS = 30
FNF_DAYS = 14
ABSCOND_DAYS = 7
SHOW_CAUSE_MIN_DAYS = 2

RES_STATUS = {"manager": "With your manager", "hr": "With HR", "accepted": "Accepted", "withdrawn": "Withdrawn"}
TERM_STATUS = {"open": "Case open", "terminated": "Terminated", "closed": "Closed — no action"}
GROUNDS = {
    "performance": "Performance (after a PIP)",
    "misconduct": "Misconduct (after a show-cause notice)",
    "absconding": "Absconding (absent 7+ days without intimation)",
    "probation": "Probation not confirmed",
    "redundancy": "Redundancy / role closed",
}
NOTICE_MODES = {"served": "Notice to be served", "pay_in_lieu": "Pay in lieu of notice", "none": "No notice (misconduct / absconding)"}


class Refused(ValueError):
    pass


def d(v) -> date:
    try:
        return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
    except ValueError:
        raise Refused("Check the date.") from None


def txt(v, n=2000) -> str:
    return re.sub(r"[ \t]+", " ", str(v or "")).strip()[:n]


# ------------------------------------------------------------- resignation ---
def default_last_day(submitted: date, notice_days: int = NOTICE_DAYS) -> date:
    return submitted + timedelta(days=notice_days)


def check_resignation(reason: str, last_day, today: date, joined_on: Optional[str]) -> date:
    if len(txt(reason)) < 10:
        raise Refused("Please give a short reason (a sentence is fine).")
    ld = d(last_day)
    if ld < today:
        raise Refused("Your last day can't be in the past.")
    if ld > today + timedelta(days=180):
        raise Refused("That's more than 6 months away — check the date.")
    if joined_on and ld < d(joined_on):
        raise Refused("That's before your joining date.")
    return ld


def shortfall(submitted: date, last_day: date, notice_days: int = NOTICE_DAYS) -> int:
    """Notice days NOT served (0 if the full notice is served). Recorded for
    the F&F; whether it's recovered or waived is HR's call (`waived`)."""
    return max(0, notice_days - (last_day - submitted).days)


def fnf_due(last_day) -> str:
    return (d(last_day) + timedelta(days=FNF_DAYS)).isoformat()


# -------------------------------------------------------------- termination ---
def clean_pip(raw: dict, today: date) -> dict:
    exp = txt(raw.get("expectations"))
    if len(exp) < 20:
        raise Refused("Write what's expected during the PIP (20+ characters) — the employee sees this.")
    s, e = d(raw.get("start")), d(raw.get("end"))
    if e <= s:
        raise Refused("The PIP must end after it starts.")
    if (e - s).days < 14:
        raise Refused("A PIP should run at least 2 weeks to be fair.")
    return {"expectations": exp, "start": s.isoformat(), "end": e.isoformat(), "outcome": None}


def clean_show_cause(raw: dict, today: date) -> dict:
    t = txt(raw.get("text"), 4000)
    if len(t) < 30:
        raise Refused("Describe the allegation clearly (30+ characters) — the employee sees this and replies to it.")
    dl = d(raw.get("deadline"))
    if dl < today + timedelta(days=SHOW_CAUSE_MIN_DAYS):
        raise Refused(f"Give at least {SHOW_CAUSE_MIN_DAYS} days to reply.")
    return {"text": t, "issued_on": today.isoformat(), "deadline": dl.isoformat(), "reply": None, "reply_at": None}


def clean_absence(raw: dict, today: date) -> dict:
    since = d(raw.get("since"))
    sent = d(raw.get("notice_sent_on"))
    if since > today or sent > today:
        raise Refused("Dates can't be in the future.")
    if sent < since:
        raise Refused("The return-to-work notice is sent after the absence starts.")
    return {"since": since.isoformat(), "notice_sent_on": sent.isoformat(), "note": txt(raw.get("note"), 600)}


def check_terminate(case: dict, emp: dict, today: date, *, notice: str, last_day, note: str) -> date:
    """Raise Refused unless the ground's documented steps are complete."""
    g = case.get("ground")
    steps = case.get("steps") or {}
    if case.get("status") != "open":
        raise Refused("This case is closed.")
    if notice not in NOTICE_MODES:
        raise Refused("Choose how notice is handled.")
    if notice == "none" and g not in ("misconduct", "absconding"):
        raise Refused("Termination without notice is only for proven misconduct or absconding — choose notice served or pay in lieu.")
    if len(txt(note)) < 20:
        raise Refused("Record the decision and why (20+ characters).")
    if g == "performance":
        pip = steps.get("pip")
        if not pip:
            raise Refused("Performance: put the employee on a PIP first.")
        if d(pip["end"]) > today:
            raise Refused(f"The PIP runs until {pip['end']} — wait for it to end.")
        if pip.get("outcome") != "not_met":
            raise Refused("Mark the PIP outcome as not met first.")
    elif g == "misconduct":
        sc = steps.get("show_cause")
        if not sc:
            raise Refused("Misconduct: issue a show-cause notice first.")
        if not sc.get("reply") and d(sc["deadline"]) >= today:
            raise Refused(f"Wait for the reply or the deadline ({sc['deadline']}).")
    elif g == "absconding":
        ab = steps.get("absence")
        if not ab:
            raise Refused("Absconding: record the absence and the return-to-work notice first.")
        if (today - d(ab["since"])).days < ABSCOND_DAYS:
            raise Refused(f"Absconding needs {ABSCOND_DAYS}+ days of absence without intimation (leave policy).")
    elif g == "probation":
        if emp.get("confirmed_on"):
            raise Refused("They're confirmed — probation isn't a ground any more.")
    elif g == "redundancy":
        if len(txt(case.get("note"))) < 20:
            raise Refused("Redundancy: write the business reason on the case (20+ characters).")
    else:
        raise Refused("Choose a ground.")
    ld = d(last_day)
    if ld < today - timedelta(days=30):
        raise Refused("Last day more than 30 days ago — check the date.")
    return ld


def employee_view(case: dict) -> Optional[dict]:
    """What the employee sees of a termination case: the PIP and show-cause
    notice addressed to them, and the outcome. Never the notes / other steps."""
    steps = case.get("steps") or {}
    v = {"id": case["id"], "kind": "termination", "status": case["status"]}
    shown = False
    if steps.get("pip"):
        v["pip"] = steps["pip"]
        shown = True
    if steps.get("show_cause"):
        v["show_cause"] = steps["show_cause"]
        shown = True
    if case["status"] == "terminated":
        v.update(last_day=case.get("last_day"), ground_label=GROUNDS.get(case.get("ground"), ""),
                 notice_label=NOTICE_MODES.get(case.get("notice"), ""), fnf=case.get("fnf"))
        shown = True
    return v if shown else None
