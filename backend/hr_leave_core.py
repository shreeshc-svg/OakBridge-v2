"""HRM leave — the rules of the Oakbridge leave policy (Nov 2026). Pure: no
I/O. hrm_leave.py moves data; tests/test_hr_leave.py checks every rule.

POLICY → CODE (each rule names the line it comes from)
  Leave year 1 Apr – 31 Mar ................................ hr_core.fiscal_year
  "All confirmed employees will be eligible"; decided: no
   leave until confirmed (probation = loss of pay only) ..... check_request
  CL 6/yr, 5 days' notice recommended (short notice flagged), not carried forward ........ TYPES["CL"]
  SL 6/yr, no notice, >3 days at a stretch needs a medical
   certificate (the manager ticks "seen" — no file is kept),
   must be reported by the end of the first day ............. TYPES["SL"], flags
  EL 0.5 per completed month after confirmation, carried
   forward up to 12 days .................................... el_accrued / el_carry
  Maternity: per the Maternity Benefit Act — 26 weeks for the
   first two children, eligibility days worked (setting,
   default 80 — the policy's 180 is stricter than the Act;
   confirm with your CA); apply a month ahead; calendar days . TYPES["MAT"]
  Paternity 5 days, split allowed, within 15 days of the
   birth, 2 children ......................................... TYPES["PAT"]
  Bereavement up to 10 days, case by case; HR may adjust ..... TYPES["BER"]
  Optional holiday: 1 per year from the optional list ....... TYPES["OPT"]
  Comp-off: earned for working a weekly off / holiday with
   prior approval, use within 2 months ...................... TYPES["COMP"], comp_*
  Loss of pay: unapproved / no balance; intervening holidays
   counted; decided cap 10 days a year — beyond it HR must
   approve as well ........................................... TYPES["LOP"]
  "Only when they have sufficient leave balance" ............ check_request
Full days only (decided). Working days: hr_core.is_working_day.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Optional

import hr_core

TYPES: dict = {
    "CL":  {"label": "Casual leave", "per_year": 6, "notice_days": 5, "count": "working", "needs_confirmed": True},
    "SL":  {"label": "Sick leave", "per_year": 6, "notice_days": 0, "count": "working", "needs_confirmed": True,
            "cert_after": 3},
    "EL":  {"label": "Earned leave", "count": "working", "needs_confirmed": True},
    "MAT": {"label": "Maternity leave", "count": "calendar", "needs_confirmed": False, "gender": "female",
            "notice_days": 30, "max_days": 182, "max_children": 2},
    "PAT": {"label": "Paternity leave", "count": "working", "needs_confirmed": True, "gender": "male",
            "per_child": 5, "window_days": 15, "max_children": 2},
    "BER": {"label": "Bereavement leave", "count": "working", "needs_confirmed": False, "max_days": 10},
    "OPT": {"label": "Optional holiday", "count": "single", "needs_confirmed": True, "per_year": 1},
    "COMP": {"label": "Comp-off", "count": "working", "needs_confirmed": True},
    "LOP": {"label": "Loss of pay", "count": "calendar", "needs_confirmed": False},
    # Not leave (Nov 2026): a working day spent at home. No balance, no limit,
    # open to everyone incl. probation; approved by the reporting manager (HR
    # if none) exactly like leave. It still blocks leave on the same day (and
    # vice versa) via overlaps(). Never counted as "off" anywhere.
    "WFH": {"label": "Work from home", "count": "working", "needs_confirmed": False, "not_leave": True},
}
LOP_CAP = 10
EL_PER_MONTH = 0.5
EL_CARRY_MAX = 12
COMP_VALID_DAYS = 60          # "within two months"
DEFAULT_MAT_MIN_DAYS = 80     # Maternity Benefit Act s.5(2); the written policy says 180 — CA to confirm
ACTIVE = ("pending", "approved")


def d(s) -> date:
    return s if isinstance(s, date) else date.fromisoformat(str(s)[:10])


def is_confirmed(emp: dict, on: date) -> bool:
    c = emp.get("confirmed_on")
    return bool(c) and d(c) <= on


# ------------------------------------------------------------- counting ---
def count_days(ltype: str, start: date, end: date, holidays: Iterable[str], weekly_off: Optional[dict]) -> int:
    """How many days this leave costs: working days for most types; every
    calendar day for LOP (the policy: intervening holidays are counted) and
    maternity (weekends and holidays included)."""
    if end < start:
        return 0
    if TYPES[ltype]["count"] == "calendar":
        return (end - start).days + 1
    if TYPES[ltype]["count"] == "single":
        return 1
    return hr_core.working_days(start, end, holidays, weekly_off)


def days_in_month(req: dict, month: str) -> int:
    """LOP days of a request that fall in month "2026-11" (calendar days)."""
    y, m = (int(x) for x in month.split("-"))
    first = date(y, m, 1)
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))
    s, e = max(d(req["start"]), first), min(d(req["end"]), last)
    return max(0, (e - s).days + 1)


# ------------------------------------------------------------ entitlement ---
def completed_months(start: date, upto: date) -> int:
    """Whole months from `start` to `upto` ("for every completed month")."""
    if upto < start:
        return 0
    n = (upto.year - start.year) * 12 + (upto.month - start.month)
    if upto.day < start.day:
        n -= 1
    return max(0, n)


def el_accrued(emp: dict, fy: str, upto: date) -> float:
    """EL earned in `fy` up to `upto`: 0.5 per completed month since the later
    of the year start and confirmation. Nothing before confirmation."""
    if not emp.get("confirmed_on"):
        return 0.0
    fs, fe = hr_core.fy_bounds(fy)
    start = max(fs, d(emp["confirmed_on"]))
    end = min(fe + timedelta(days=1), upto)
    return min(12, completed_months(start, end)) * EL_PER_MONTH


def yearly_quota(emp: dict, ltype: str, fy: str) -> float:
    """CL / SL / OPT for the year. Confirmed mid-year: pro-rata for the months
    left, rounded DOWN to whole days (full days only). Not confirmed: 0."""
    t = TYPES[ltype]
    if not t.get("per_year") or not emp.get("confirmed_on"):
        return 0.0
    fs, fe = hr_core.fy_bounds(fy)
    c = d(emp["confirmed_on"])
    if c > fe:
        return 0.0
    if c <= fs:
        return float(t["per_year"])
    months_left = (fe.year - c.year) * 12 + (fe.month - c.month) + 1
    return float(int(t["per_year"] * months_left / 12))


def used(requests: list, emp_id: str, ltype: str, fy: str, statuses=ACTIVE) -> float:
    return float(sum(r.get("days", 0) for r in requests if r["emp_id"] == emp_id and r["type"] == ltype
                     and r["status"] in statuses and hr_core.fiscal_year(d(r["start"])) == fy))


def adjust(adjustments: list, emp_id: str, ltype: str, fy: str) -> float:
    return float(sum(a.get("days", 0) for a in adjustments if a["emp_id"] == emp_id and a["type"] == ltype and a["fy"] == fy))


def el_balance(emp: dict, fy: str, upto: date, requests: list, adjustments: list) -> dict:
    """EL for `fy`: opening (carried from last year, max 12) + earned so far +
    HR adjustments − used. Previous years are walked back to the first year
    with any EL activity, so carry-forward needs no year-end job."""
    first_fy = fy
    starts = [d(emp["confirmed_on"])] if emp.get("confirmed_on") else []
    starts += [d(a["fy"][:4] + "-04-01") for a in adjustments if a["emp_id"] == emp["id"] and a["type"] == "EL"]
    if starts:
        first_fy = min(hr_core.fiscal_year(min(starts)), fy)
    carry = 0.0
    cur = first_fy
    while True:
        fs, fe = hr_core.fy_bounds(cur)
        end = upto if cur == fy else fe + timedelta(days=1)
        earned = el_accrued(emp, cur, end)
        adj = adjust(adjustments, emp["id"], "EL", cur)
        spent = used(requests, emp["id"], "EL", cur, ("approved",))
        pend = used(requests, emp["id"], "EL", cur, ("pending",))
        if cur == fy:
            total = carry + earned + adj
            return {"carried": carry, "earned": earned, "adjusted": adj, "used": spent, "pending": pend,
                    "available": total - spent - pend}
        carry = max(0.0, min(EL_CARRY_MAX, carry + earned + adj - spent))
        cur = f"{fs.year + 1}-{str(fs.year + 2)[-2:]}"


def comp_credits(requests: list, emp_id: str) -> list:
    """Approved comp-off credits: [{id, worked_on, expires}] oldest first."""
    out = []
    for r in requests:
        if r["emp_id"] == emp_id and r["type"] == "COMP_EARN" and r["status"] == "approved":
            w = d(r["worked_on"])
            out.append({"id": r["id"], "worked_on": w, "expires": w + timedelta(days=COMP_VALID_DAYS)})
    return sorted(out, key=lambda c: c["expires"])


def comp_available(requests: list, emp_id: str, on: date) -> list:
    """Credits still unused and valid on `on` (each credit = one day)."""
    taken = {cid for r in requests if r["emp_id"] == emp_id and r["type"] == "COMP" and r["status"] in ACTIVE
             for cid in r.get("credits") or []}
    return [c for c in comp_credits(requests, emp_id) if c["id"] not in taken and c["worked_on"] <= on <= c["expires"]]


def balances(emp: dict, fy: str, today: date, requests: list, adjustments: list) -> dict:
    """Everything the Leave screen shows, per type: entitled, used, pending, available."""
    out = {}
    for t in ("CL", "SL", "OPT"):
        q = yearly_quota(emp, t, fy) + adjust(adjustments, emp["id"], t, fy)
        u, p = used(requests, emp["id"], t, fy, ("approved",)), used(requests, emp["id"], t, fy, ("pending",))
        out[t] = {"entitled": q, "used": u, "pending": p, "available": max(0.0, q - u - p)}
    out["EL"] = el_balance(emp, fy, today, requests, adjustments)
    out["COMP"] = {"available": float(len(comp_available(requests, emp["id"], today)))}
    lop = used(requests, emp["id"], "LOP", fy)
    out["LOP"] = {"used": used(requests, emp["id"], "LOP", fy, ("approved",)), "pending": used(requests, emp["id"], "LOP", fy, ("pending",)),
                  "cap": LOP_CAP, "left_before_hr": max(0.0, LOP_CAP - lop)}
    return out


# --------------------------------------------------------------- checking ---
class Refused(ValueError):
    pass


def LABEL_OF(r: dict) -> str:
    return "work from home" if r.get("type") == "WFH" else "leave"


def overlaps(requests: list, emp_id: str, start: date, end: date, ignore_id: str = "") -> Optional[dict]:
    for r in requests:
        if r["emp_id"] == emp_id and r["status"] in ACTIVE and r["id"] != ignore_id and r["type"] != "COMP_EARN":
            if d(r["start"]) <= end and start <= d(r["end"]):
                return r
    return None


def check_request(emp: dict, req: dict, today: date, requests: list, adjustments: list, *,
                  holidays: Iterable[str], optional_days: Iterable[str], weekly_off: Optional[dict],
                  mat_min_days: int = DEFAULT_MAT_MIN_DAYS) -> dict:
    """Validate a leave request against the policy. Returns
    {days, flags, needs_hr, credits} or raises Refused with a message the
    employee can act on. `req`: {type, start, end, reason, child_birth?,
    expected_delivery?, worked_on?}."""
    lt = req.get("type")
    if lt == "COMP_EARN":
        return _check_comp_earn(emp, req, today, requests, holidays, weekly_off)
    if lt not in TYPES:
        raise Refused("Choose a leave type.")
    t = TYPES[lt]
    start, end = d(req["start"]), d(req.get("end") or req["start"])
    if end < start:
        raise Refused("The end date is before the start date.")
    if hr_core.fiscal_year(start) != hr_core.fiscal_year(end):
        raise Refused("A request can't cross 31 March — split it into two requests (one per leave year).")
    if emp.get("joined_on") and start < d(emp["joined_on"]):
        raise Refused("That's before your joining date.")
    fy = hr_core.fiscal_year(start)
    hol = set(holidays)
    flags: list = []
    needs_hr = False

    if t.get("needs_confirmed") and not is_confirmed(emp, start):
        raise Refused("You're on probation, so this leave isn't available yet — apply as Loss of pay instead.")
    if t.get("gender") and emp.get("gender") != t["gender"]:
        raise Refused(f"{t['label']} needs HR to record the matching details on your profile first.")
    other = overlaps(requests, emp["id"], start, end, req.get("id", ""))
    if other:
        raise Refused(f"You already have {LABEL_OF(other)} on some of these days — cancel that first if it's changed.")

    days = count_days(lt, start, end, hol, weekly_off)
    if days <= 0:
        raise Refused("Those dates are all weekly offs / holidays — no request needed.")
    notice = (start - today).days

    if lt == "CL" and notice < t["notice_days"]:
        # Policy (confirmed Nov 2026): 5 days' notice is RECOMMENDED, not
        # mandatory. Short notice is allowed and flagged so the manager sees
        # it — the manager can still reject.
        flags.append("short_notice")
    if lt == "SL":
        if days > t["cert_after"]:
            flags.append("medical_certificate_needed")
        if today > start:
            flags.append("reported_after_first_day")   # policy: may be treated as absence — HR decides
    if lt == "OPT":
        if start != end:
            raise Refused("An optional holiday is one day.")
        if start.isoformat() not in set(optional_days):
            raise Refused("Pick a date from this year's optional holiday list.")
    if lt in ("CL", "SL", "OPT"):
        q = yearly_quota(emp, lt, fy) + adjust(adjustments, emp["id"], lt, fy)
        if used(requests, emp["id"], lt, fy) + days > q:
            raise Refused(f"Not enough {t['label'].lower()} left this year — apply the rest as Loss of pay.")
    if lt == "EL":
        if el_balance(emp, fy, start, requests, adjustments)["available"] < days:
            raise Refused("Not enough earned leave — apply the rest as Loss of pay.")
    if lt == "COMP":
        avail = comp_available(requests, emp["id"], start)
        if len(avail) < days:
            raise Refused("Not enough comp-off days valid on those dates (each lasts 2 months from the day worked).")
        if any(c["expires"] < end for c in avail[:days]):
            raise Refused("A comp-off would expire before these dates end — take it earlier.")
        return {"days": days, "flags": flags, "needs_hr": False, "credits": [c["id"] for c in avail[:days]]}
    if lt == "MAT":
        due = req.get("expected_delivery")
        if not due:
            raise Refused("Enter the expected delivery date.")
        due = d(due)
        if notice < t["notice_days"]:
            flags.append("applied_less_than_a_month_ahead")
        if days > t["max_days"]:
            raise Refused("Maternity leave is up to 26 weeks (182 days).")
        prior = {r.get("expected_delivery") for r in requests if r["emp_id"] == emp["id"] and r["type"] == "MAT"
                 and r["status"] == "approved" and r.get("expected_delivery") != due.isoformat()}
        if len(prior) >= t["max_children"]:
            raise Refused("Maternity leave under the policy covers two children.")
        worked = (due - d(emp.get("joined_on") or due)).days
        if worked < mat_min_days:
            flags.append("eligibility_days_short")   # HR decides with the CA; not refused automatically
        needs_hr = True
    if lt == "PAT":
        born = req.get("child_birth")
        if not born:
            raise Refused("Enter the child's date of birth.")
        born = d(born)
        if not (born <= start and end <= born + timedelta(days=t["window_days"])):
            raise Refused("Paternity leave is taken within 15 days of the birth.")
        same = used([r for r in requests if r.get("child_birth") == born.isoformat()], emp["id"], "PAT",
                    hr_core.fiscal_year(start))
        if same + days > t["per_child"]:
            raise Refused("Paternity leave is 5 days per child.")
        kids = {r.get("child_birth") for r in requests if r["emp_id"] == emp["id"] and r["type"] == "PAT"
                and r["status"] in ACTIVE and r.get("child_birth") != born.isoformat()}
        if len(kids) >= t["max_children"]:
            raise Refused("Paternity leave under the policy covers two children.")
    if lt == "BER":
        if days > t["max_days"]:
            raise Refused("Bereavement leave is up to 10 days — HR can grant more as a special case.")
        needs_hr = days > 3 or needs_hr      # longer cases are confirmed by HR (policy: "case by case")
    if lt == "LOP":
        if used(requests, emp["id"], "LOP", fy) + days > LOP_CAP:
            flags.append("over_lop_cap")
            needs_hr = True
    return {"days": days, "flags": flags, "needs_hr": needs_hr, "credits": []}


def _check_comp_earn(emp, req, today, requests, holidays, weekly_off) -> dict:
    w = d(req.get("worked_on") or req.get("start"))
    if not is_confirmed(emp, w):
        raise Refused("Comp-off is for confirmed employees.")
    if hr_core.is_working_day(w, holidays, weekly_off):
        raise Refused("Comp-off is earned only for working on a weekly off or a company holiday.")
    flags = [] if today <= w else ["asked_after_working"]   # policy: prior approval — manager sees this
    if any(r["emp_id"] == emp["id"] and r["type"] == "COMP_EARN" and r["status"] in ACTIVE and d(r["worked_on"]) == w
           for r in requests):
        raise Refused("You've already asked for a comp-off for that day.")
    return {"days": 0, "flags": flags, "needs_hr": False, "credits": []}


def approver_for(emp: dict, people: dict) -> Optional[str]:
    """The reporting manager, if they're active; None = HR approves."""
    m = emp.get("manager_id")
    return m if m and (people.get(m) or {}).get("status") == "active" else None
