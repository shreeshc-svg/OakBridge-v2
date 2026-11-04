"""HRM — the pure rules (Nov 2026). No I/O, no app imports; tested by
tests/test_hr_core.py. hrm.py moves data between these rules and MongoDB.

Release 1: people, who-can-see-whom, the leave year and the working calendar.
Leave balances, goals and hiring build on these in later releases.

THE COMPANY RULES ENCODED HERE (Oakbridge leave policy, Nov 2026)
* The leave year is the financial year: 1 April – 31 March ("2026-27").
* Working days are Monday–Saturday EXCEPT every Sunday and the 2nd Saturday
  of the month, and company holidays. (Weekly offs are settings, so a change
  of policy is a setting, not a code change.)
* Access is decided by data, never by what the browser says:
    HR / founders  (hr_access on their employee record, or a site superadmin)
                   -> everyone
    a manager      -> themselves and everyone who reports to them, directly
                      or through someone else
    anyone else    -> themselves only
  Someone who has left (status "exited") sees nothing.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Iterable, Optional

FY_START_MONTH = 4                     # April
DEFAULT_WEEKLY_OFF = {"weekdays": [6], "saturdays": [2]}   # Sunday (Mon=0) + 2nd Saturday
STATUSES = ("active", "exited")
HOLIDAY_KINDS = ("national", "optional")
MAX_TEXT = 120
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ------------------------------------------------------------ leave year ---
def fiscal_year(d: date) -> str:
    """date -> "2026-27" (1 Apr 2026 – 31 Mar 2027)."""
    start = d.year if d.month >= FY_START_MONTH else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def fy_bounds(fy: str) -> tuple[date, date]:
    """"2026-27" -> (2026-04-01, 2027-03-31). Raises ValueError on bad input."""
    m = re.fullmatch(r"(\d{4})-(\d{2})", str(fy or ""))
    if not m or (int(m.group(1)) + 1) % 100 != int(m.group(2)):
        raise ValueError("Financial year must look like 2026-27")
    y = int(m.group(1))
    return date(y, FY_START_MONTH, 1), date(y + 1, FY_START_MONTH, 1) - timedelta(days=1)


# --------------------------------------------------------- working days ---
def nth_weekday_of_month(d: date) -> int:
    """1 for the first Saturday of the month, 2 for the second…"""
    return (d.day - 1) // 7 + 1


def clean_weekly_off(raw: Optional[dict]) -> dict:
    raw = raw or {}
    days = sorted({int(x) for x in (raw.get("weekdays") or []) if str(x).isdigit() and 0 <= int(x) <= 6})
    sats = sorted({int(x) for x in (raw.get("saturdays") or []) if str(x).isdigit() and 1 <= int(x) <= 5})
    if not days and not sats and not raw:
        return dict(DEFAULT_WEEKLY_OFF)
    return {"weekdays": days, "saturdays": sats}


def is_weekly_off(d: date, weekly_off: Optional[dict] = None) -> bool:
    w = clean_weekly_off(weekly_off)
    if d.weekday() in w["weekdays"]:
        return True
    return d.weekday() == 5 and nth_weekday_of_month(d) in w["saturdays"]


def is_working_day(d: date, holidays: Iterable[str] = (), weekly_off: Optional[dict] = None) -> bool:
    """holidays: ISO dates of COMPANY holidays (national ones — an optional
    holiday is a working day unless that person chose it)."""
    return not is_weekly_off(d, weekly_off) and d.isoformat() not in set(holidays)


def working_days(start: date, end: date, holidays: Iterable[str] = (), weekly_off: Optional[dict] = None) -> int:
    hs = set(holidays)
    n, d = 0, start
    while d <= end:
        n += is_working_day(d, hs, weekly_off)
        d += timedelta(days=1)
    return n


# -------------------------------------------------------------- holidays ---
def clean_holidays(rows: list) -> list:
    """[{date, name, kind}] — valid ISO dates, a name, national|optional,
    one row per date, sorted. Bad rows are dropped, not guessed."""
    out = {}
    for r in rows or []:
        try:
            d = date.fromisoformat(str((r or {}).get("date", ""))[:10])
        except ValueError:
            continue
        name = str((r or {}).get("name") or "").strip()[:MAX_TEXT]
        if not name:
            continue
        kind = (r or {}).get("kind") if (r or {}).get("kind") in HOLIDAY_KINDS else "national"
        out[d.isoformat()] = {"date": d.isoformat(), "name": name, "kind": kind}
    return [out[k] for k in sorted(out)]


# ----------------------------------------------------------------- people ---
def clean_person(raw: dict, *, partial: bool = False) -> dict:
    """Validate an employee record from HR. Only work details — by company
    decision NO personal documents, ID numbers or bank details are stored.
    Raises ValueError with a message for the screen."""
    out: dict = {}
    txt = lambda k: re.sub(r"\s+", " ", str(raw.get(k) or "")).strip()[:MAX_TEXT]  # noqa: E731
    if not partial or "name" in raw:
        if not txt("name"):
            raise ValueError("Name is required.")
        out["name"] = txt("name")
    if not partial or "work_email" in raw:
        e = txt("work_email").lower()
        if not EMAIL_RE.match(e):
            raise ValueError("A valid work email is required (it is their login).")
        out["work_email"] = e
    for k in ("designation", "department", "emp_code", "phone", "location"):
        if k in raw:
            out[k] = txt(k)
    for k in ("joined_on", "confirmed_on"):
        if k in raw:
            v = txt(k)
            if v:
                try:
                    v = date.fromisoformat(v[:10]).isoformat()
                except ValueError:
                    raise ValueError(f"{k.replace('_', ' ').capitalize()} must be a date.") from None
            out[k] = v or None
    if not partial and not out.get("joined_on"):
        raise ValueError("Joining date is required.")
    if out.get("joined_on") and out.get("confirmed_on") and out["confirmed_on"] < out["joined_on"]:
        raise ValueError("Confirmation can't be before joining.")
    if "manager_id" in raw:
        out["manager_id"] = str(raw.get("manager_id") or "").strip()[:80] or None
    if "hr_access" in raw:
        out["hr_access"] = bool(raw.get("hr_access"))
    if "gender" in raw:   # only to offer maternity / paternity leave (release 2)
        g = txt("gender").lower()
        out["gender"] = g if g in ("female", "male", "other") else ""
    return out


def manager_cycle(people: dict, emp_id: str, new_manager: Optional[str]) -> bool:
    """Would making `new_manager` the manager of `emp_id` create a loop
    (A reports to B reports to A)? people: {id: {manager_id}}."""
    seen, cur = set(), new_manager
    while cur:
        if cur == emp_id or cur in seen:
            return True
        seen.add(cur)
        cur = (people.get(cur) or {}).get("manager_id")
    return False


def reports_of(people: dict, manager_id: str) -> set:
    """Everyone below `manager_id`, directly or indirectly."""
    kids: dict = {}
    for pid, p in people.items():
        if p.get("manager_id"):
            kids.setdefault(p["manager_id"], []).append(pid)
    out, stack = set(), list(kids.get(manager_id, []))
    while stack:
        x = stack.pop()
        if x in out:
            continue
        out.add(x)
        stack.extend(kids.get(x, []))
    return out


def access_of(viewer: Optional[dict], people: dict, *, superadmin: bool = False) -> dict:
    """What this viewer may see. viewer: their employee record (or None).
    Returns {hr, manager, ids} — ids None means everyone."""
    if superadmin:
        return {"hr": True, "manager": True, "ids": None}
    if not viewer or viewer.get("status") != "active":
        return {"hr": False, "manager": False, "ids": set()}
    if viewer.get("hr_access"):
        return {"hr": True, "manager": True, "ids": None}
    team = reports_of(people, viewer["id"])
    return {"hr": False, "manager": bool(team), "ids": team | {viewer["id"]}}


def can_see(access: dict, emp_id: str) -> bool:
    return access["ids"] is None or emp_id in access["ids"]
