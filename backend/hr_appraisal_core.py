"""HRM annual appraisal — the rules (Nov 2026). Pure: no I/O. Tested by
tests/test_hr_appraisal.py; hrm_appraisal.py moves the data.

THE PROCESS (decided with HR)
  1 self      the employee rates themselves on 5 skills and answers three
              short questions. Their year's goal results come in from Goals.
  2 manager   the reporting manager (HR if none) rates the same 5 skills with
              a comment each, gives an overall rating, and PROPOSES an
              increment % and (optionally) a promotion / new designation.
  3 hr        HR / founders review: may adjust rating, increment % and
              designation (a reason is required for every change), enter the
              current annual CTC, set the effective date, and approve.
  4 released  the employee sees everything, downloads the letter and
              acknowledges (optionally disagreeing — HR is told). On the
              effective date the new designation applies in the HRM, and the
              increment % + revised CTC go on that month's RazorpayX export.

MONEY RULES (no mistakes)
  * CTC is whole rupees, 0 < CTC ≤ 10 crore.
  * Increment is 0–100 %, in steps of 0.5 %.
  * Revised CTC = current × (1 + % / 100), rounded to the nearest rupee —
    worked out HERE only; the browser shows the same formula as a preview.
  * Managers never see CTC (hrm_appraisal.py strips it); they work in %.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

import hr_core

SKILLS = (
    ("quality", "Quality of work", "Accurate, careful work that rarely needs redoing"),
    ("ownership", "Ownership", "Takes responsibility and follows through without reminders"),
    ("communication", "Communication", "Keeps people informed — clear, timely and polite"),
    ("teamwork", "Teamwork", "Helps colleagues and works well with others"),
    ("learning", "Learning", "Picks up new skills and improves from feedback"),
)
SKILL_KEYS = tuple(k for k, _, _ in SKILLS)
SCALE = {1: "Needs improvement", 2: "Sometimes meets expectations", 3: "Meets expectations",
         4: "Often exceeds expectations", 5: "Outstanding"}
QUESTIONS = (
    ("achievements", "What are you most proud of this year?"),
    ("challenges", "What was hard, or didn't go as planned?"),
    ("support", "What help or training would make next year better?"),
)
STAGES = ("self", "manager", "hr", "released")
STAGE_LABEL = {"self": "Self-review", "manager": "Manager review", "hr": "HR approval", "released": "Shared with employee"}
MAX_CTC = 100_000_000          # ₹10 crore — a typo guard, not a policy
MAX_INCREMENT = 100
TEXT = 2000


class Refused(ValueError):
    pass


def _txt(v, n=TEXT) -> str:
    return re.sub(r"[ \t]+", " ", str(v or "")).strip()[:n]


def _rating(v, what: str) -> int:
    try:
        r = int(v)
    except (TypeError, ValueError):
        raise Refused(f"Choose a rating for {what}.") from None
    if r not in SCALE:
        raise Refused(f"Choose a rating for {what}.")
    return r


def clean_self(raw: dict, *, submit: bool) -> dict:
    """The employee's part. A draft may be incomplete; submitting needs every
    skill rated and the first question answered."""
    skills = {}
    for k, label, _ in SKILLS:
        v = (raw.get("skills") or {}).get(k)
        if v in (None, "", 0):
            if submit:
                raise Refused(f"Rate yourself on “{label}”.")
            continue
        skills[k] = _rating(v, label)
    out = {"skills": skills, **{k: _txt(raw.get(k)) for k, _ in QUESTIONS}}
    if submit and len(out["achievements"]) < 10:
        raise Refused("Tell us a little about what you're proud of this year (a sentence or two).")
    return out


def clean_manager(raw: dict, *, submit: bool) -> dict:
    """The manager's part: per-skill rating + comment, overall rating,
    proposed increment %, optional new designation, summary."""
    skills = {}
    for k, label, _ in SKILLS:
        s = (raw.get("skills") or {}).get(k) or {}
        v = s.get("rating")
        if v in (None, "", 0):
            if submit:
                raise Refused(f"Rate “{label}”.")
            skills[k] = {"rating": None, "comment": _txt(s.get("comment"), 600)}
            continue
        skills[k] = {"rating": _rating(v, label), "comment": _txt(s.get("comment"), 600)}
    overall = raw.get("overall")
    overall = None if overall in (None, "", 0) else _rating(overall, "the overall rating")
    pct = raw.get("increment_pct")
    pct = None if pct in (None, "") else clean_pct(pct)
    out = {"skills": skills, "overall": overall, "increment_pct": pct,
           "designation": _txt(raw.get("designation"), 120), "summary": _txt(raw.get("summary"))}
    if submit:
        if overall is None:
            raise Refused("Choose an overall rating.")
        if pct is None:
            raise Refused("Propose an increment % (0 if none).")
        if len(out["summary"]) < 20:
            raise Refused("Write a short summary for the employee (at least 20 characters).")
    return out


def clean_pct(v) -> float:
    try:
        d = Decimal(str(v).strip().rstrip("%"))
    except Exception:  # noqa: BLE001
        raise Refused("Increment must be a number, e.g. 8 or 8.5.") from None
    if d < 0 or d > MAX_INCREMENT:
        raise Refused(f"Increment must be between 0 and {MAX_INCREMENT}%.")
    if (d * 2) != (d * 2).to_integral_value():
        raise Refused("Increment can be whole or half percent (e.g. 8 or 8.5).")
    return float(d)


def clean_ctc(v) -> int:
    s = re.sub(r"[,\s₹]|Rs\.?", "", str(v or ""), flags=re.I)
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        raise Refused("Enter the annual CTC in rupees, e.g. 600000.")
    amt = Decimal(s)
    if amt <= 0 or amt > MAX_CTC:
        raise Refused("That CTC looks wrong — check the number of zeros.")
    return int(amt.to_integral_value(rounding=ROUND_HALF_UP))


def revised_ctc(current: int, pct: float) -> int:
    """current × (1 + pct/100), nearest rupee (half up). Decimal, not float:
    ₹6,00,000 at 8.5 % must be exactly ₹6,51,000."""
    return int((Decimal(current) * (Decimal(1) + Decimal(str(pct)) / Decimal(100))).to_integral_value(rounding=ROUND_HALF_UP))


def default_effective(fy: str) -> str:
    """Appraisal for FY 2026-27 takes effect 1 April 2027."""
    _, end = hr_core.fy_bounds(fy)
    return (end + timedelta(days=1)).isoformat()


def final_outcome(app: dict) -> dict:
    """HR's figures where HR changed them, else the manager's proposal."""
    m, h = app.get("manager") or {}, app.get("hr") or {}
    pick = lambda k: h.get(k) if h.get(k) not in (None, "") else m.get(k)  # noqa: E731
    # Designation: HR's value wins even when EMPTY — that is how HR says
    # "no promotion" to a manager who proposed one.
    desig = h["designation"] if h.get("designation") is not None else m.get("designation")
    return {"overall": pick("overall"), "increment_pct": pick("increment_pct"), "designation": desig or "",
            "effective_from": h.get("effective_from") or default_effective(app["fy"])}


def check_release(app: dict) -> None:
    if app.get("stage") != "hr":
        raise Refused("Only an appraisal waiting for HR approval can be shared.")
    out = final_outcome(app)
    if out["overall"] is None or out["increment_pct"] is None:
        raise Refused("The manager's rating and increment are missing.")
    try:
        date.fromisoformat(out["effective_from"])
    except ValueError:
        raise Refused("Set the effective date.") from None


def changed_fields(manager: dict, hr: dict) -> list:
    """Fields HR changed from the manager's proposal (each needs a reason)."""
    out = []
    for k in ("overall", "increment_pct"):
        if hr.get(k) not in (None, "") and hr.get(k) != manager.get(k):
            out.append(k)
    if hr.get("designation") is not None and hr["designation"] != (manager.get("designation") or ""):
        out.append("designation")
    return out


def view(app: dict, *, role: str, ctc: Optional[dict] = None) -> dict:
    """What each person may see.
      owner   before release: their own self part + where it is; after
              release: everything incl. their own CTC.
      manager their team's self part (once submitted) + their own part; the
              final outcome after release; NEVER any CTC.
      hr      everything (CTC passed in already decrypted by the caller)."""
    v = {k: app.get(k) for k in ("id", "emp_id", "fy", "stage", "self_submitted_at", "manager_submitted_at",
                                  "released_at", "ack", "self_due", "manager_due", "applied_at")}
    released = app.get("stage") == "released"
    if role == "hr" or (role == "owner") or (role == "manager" and app.get("self_submitted_at")):
        v["self"] = app.get("self") or {}
    if role in ("hr", "manager") or (role == "owner" and released):
        v["manager"] = app.get("manager") or {}
    if role == "hr":
        v["hr"] = {k: val for k, val in (app.get("hr") or {}).items() if not k.endswith("_enc")}
        v["outcome"] = final_outcome(app)
        v["ctc"] = ctc
    elif released:
        v["outcome"] = final_outcome(app)
        if role == "owner":
            v["ctc"] = ctc
    return v
