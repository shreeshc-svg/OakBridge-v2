"""HRM release 4 — hiring, onboarding and exit: the rules (Nov 2026). Pure;
tested by tests/test_hr_lifecycle.py; hrm_lifecycle.py moves the data.

HIRING (decided with HR)
  Careers applications (job_applications) move through
      new -> shortlisted -> interview -> offer -> joined
  and can be rejected / withdrawn from any open stage. HR moves them and
  assigns a HIRING MANAGER (an employee), who sees only their candidates and
  adds interview feedback. "Joined" happens only from "offer", by HR, and
  creates the employee (on probation) with an onboarding checklist.
  People not hired are deleted RETENTION_DAYS after rejection (DPDP: the
  careers form promises we keep them only while considering them).

EXIT
  HR records the last working day and reason. Until that day the person works
  as normal; the day after, the HRM closes for them and any staff role
  (admin / warehouse) on their account becomes an ordinary customer account
  (the daily job, hrm_lifecycle.finalize_exits). Leave can't be taken past the
  last day; pending leave after it is cancelled. Unused earned leave is
  encashed (policy: if 1+ year after confirmation) and goes on that month's
  RazorpayX export.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

STAGES = ("new", "shortlisted", "interview", "offer", "joined", "rejected", "withdrawn")
OPEN = ("new", "shortlisted", "interview", "offer")
CLOSED = ("joined", "rejected", "withdrawn")
STAGE_LABEL = {"new": "New", "shortlisted": "Shortlisted", "interview": "Interview", "offer": "Offer",
               "joined": "Joined", "rejected": "Not selected", "withdrawn": "Withdrew"}
RETENTION_DAYS = 182          # ~6 months after rejection / withdrawal
EXIT_REASONS = {"resigned": "Resigned", "terminated": "Terminated", "absconded": "Left without notice",
                "contract_end": "Contract ended", "retired": "Retired", "other": "Other"}
RECOMMEND = ("hire", "maybe", "no")

DEFAULT_ONBOARDING = ["Offer / appointment letter signed", "Work email created", "Laptop / system issued",
                      "HRM login sent", "Added to RazorpayX Payroll", "Warehouse / admin access set up (if needed)",
                      "ID card issued", "Leave and conduct policies explained"]
DEFAULT_EXIT = ["Handover done", "Laptop / system returned", "ID card and keys returned", "Work email closed or forwarded",
                "Removed from RazorpayX Payroll", "Final settlement processed (incl. earned-leave encashment)",
                "Relieving / experience letter issued"]


class Refused(ValueError):
    pass


def legacy_stage(app: dict) -> str:
    """Applications from before the pipeline have status "received"."""
    s = app.get("stage")
    return s if s in STAGES else "new"


def check_move(current: str, new: str) -> None:
    if new not in STAGES:
        raise Refused("Unknown stage.")
    if current in CLOSED:
        raise Refused(f"This candidate is already {STAGE_LABEL[current].lower()}.")
    if new == "joined":
        raise Refused("Use “Mark as joined” (from Offer) — it creates their HRM record.")
    if new == current:
        raise Refused("Already at that stage.")


def can_join(stage: str) -> None:
    if stage != "offer":
        raise Refused("Move the candidate to Offer first.")


def purge_due(app: dict, today: date) -> bool:
    """Delete this application now? Only people not hired, RETENTION_DAYS after
    they were rejected / withdrew. Joined candidates' applications are kept
    (they become the employee's hiring record)."""
    if legacy_stage(app) not in ("rejected", "withdrawn"):
        return False
    at = str(app.get("closed_at") or "")[:10]
    try:
        return date.fromisoformat(at) + timedelta(days=RETENTION_DAYS) <= today
    except ValueError:
        return False


def clean_checklist(items: list, defaults: list) -> list:
    out, seen = [], set()
    for t in items or defaults:
        t = re.sub(r"\s+", " ", str(t or "")).strip()[:120]
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:25] or list(defaults)


def new_checklist(titles: list) -> list:
    return [{"item": t, "done": False, "by": "", "at": ""} for t in titles]


def exit_effective(emp: dict, today: date) -> bool:
    """Has this person's last working day passed?"""
    last = emp.get("exited_on")
    if not last:
        return False
    try:
        return date.fromisoformat(str(last)[:10]) < today
    except ValueError:
        return False


def encashment(emp: dict, last_day: date, el_available: float) -> dict:
    """Earned leave to pay out at exit. Policy: encashed at basic salary
    "provided the minimum service length is 1 year post confirmation". Days
    are rounded down to half days; the money is worked out in RazorpayX."""
    c = emp.get("confirmed_on")
    eligible = False
    if c:
        try:
            cd = date.fromisoformat(str(c)[:10])
            eligible = last_day >= date(cd.year + 1, cd.month, min(cd.day, 28))
        except ValueError:
            eligible = False
    days = max(0.0, int(el_available * 2) / 2) if eligible else 0.0
    return {"eligible": eligible, "days": days, "el_available": el_available,
            "why": "" if eligible else ("not confirmed" if not c else "less than 1 year after confirmation")}
