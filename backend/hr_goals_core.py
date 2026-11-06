"""HRM goals — the rules (release 3, Nov 2026). Pure: no I/O; tested by
tests/test_hr_goals.py; hrm_goals.py moves the data.

THE PROCESS (decided with HR)
  April      the employee drafts 1–8 annual goals: what, how it's measured,
             and a weight; weights add up to exactly 100 %.
             -> submitted -> the reporting manager approves (may edit) or
             returns it with a note. Approved goals are locked; either side
             can reopen them, and the manager approves again.
  Quarterly  the year has four quarters (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar).
             For each one the employee checks in (progress 0–100 % per goal
             + a note), then the manager reviews (on track / at risk / off
             track per goal + a comment). A quarter is open from its first
             day until CHECKIN_GRACE days after it ends.
  Year end   the manager rates 1–5 with a summary, from mid-February until
             two months after the year ends. Ratings stay hidden from the
             employee until HR releases them for the year.
  Overall    weighted progress = Σ weight × progress / 100 (latest check-in).
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

import hr_core

MIN_GOALS, MAX_GOALS = 1, 8
MIN_WEIGHT = 5
CHECKIN_GRACE = 30
RATING_OPENS_BEFORE_END = 45      # days before 31 March
RATING_CLOSES_AFTER_END = 60
QUARTERS = ("Q1", "Q2", "Q3", "Q4")
STATUSES = ("on_track", "at_risk", "off_track", "done")
RATINGS = {5: "Exceeds expectations", 4: "Above expectations", 3: "Meets expectations",
           2: "Partly meets expectations", 1: "Below expectations"}
TEXT = 300


class Refused(ValueError):
    pass


def quarter_bounds(fy: str, q: str) -> tuple[date, date]:
    start, _ = hr_core.fy_bounds(fy)
    i = QUARTERS.index(q)
    m = start.month + 3 * i
    y = start.year + (m - 1) // 12
    m = (m - 1) % 12 + 1
    s = date(y, m, 1)
    m2, y2 = m + 3, y
    if m2 > 12:
        m2, y2 = m2 - 12, y + 1
    return s, date(y2, m2, 1) - timedelta(days=1)


def open_quarters(fy: str, today: date) -> list:
    """Quarters that can be checked in / reviewed today."""
    out = []
    for q in QUARTERS:
        s, e = quarter_bounds(fy, q)
        if s <= today <= e + timedelta(days=CHECKIN_GRACE):
            out.append(q)
    return out


def rating_open(fy: str, today: date) -> bool:
    _, end = hr_core.fy_bounds(fy)
    return end - timedelta(days=RATING_OPENS_BEFORE_END) <= today <= end + timedelta(days=RATING_CLOSES_AFTER_END)


def _txt(v, n=TEXT) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def clean_goals(raw: list, *, strict: bool) -> list:
    """[{id?, title, measure, weight}] -> cleaned. strict=True (submitting /
    approving): 1–8 goals, each titled, weights ≥ 5 and adding to 100."""
    out = []
    for i, g in enumerate(raw or []):
        g = g or {}
        title = _txt(g.get("title"), 200)
        if not title and not strict:
            continue
        try:
            w = int(round(float(g.get("weight") or 0)))
        except (TypeError, ValueError):
            w = 0
        gid = re.sub(r"[^a-zA-Z0-9_-]", "", str(g.get("id") or ""))[:40] or f"g{i + 1}"
        out.append({"id": gid, "title": title, "measure": _txt(g.get("measure")), "weight": max(0, min(100, w))})
    ids = [g["id"] for g in out]
    if len(set(ids)) != len(ids):                      # duplicate ids from the browser: renumber
        for i, g in enumerate(out):
            g["id"] = f"g{i + 1}"
    if strict:
        if not MIN_GOALS <= len(out) <= MAX_GOALS:
            raise Refused(f"Set between {MIN_GOALS} and {MAX_GOALS} goals.")
        if any(not g["title"] for g in out):
            raise Refused("Every goal needs a title.")
        if any(g["weight"] < MIN_WEIGHT for g in out):
            raise Refused(f"Each goal needs a weight of at least {MIN_WEIGHT}%.")
        total = sum(g["weight"] for g in out)
        if total != 100:
            raise Refused(f"Weights must add up to 100% (now {total}%).")
    elif len(out) > MAX_GOALS:
        raise Refused(f"At most {MAX_GOALS} goals.")
    return out


def clean_progress(goals: list, raw: dict) -> dict:
    ids = {g["id"] for g in goals}
    out = {}
    for gid in ids:
        try:
            v = int(round(float((raw or {}).get(gid))))
        except (TypeError, ValueError):
            raise Refused("Give a progress % for every goal.") from None
        if not 0 <= v <= 100:
            raise Refused("Progress is 0–100%.")
        out[gid] = v
    return out


def clean_status(goals: list, raw: dict) -> dict:
    out = {}
    for g in goals:
        s = (raw or {}).get(g["id"])
        if s not in STATUSES:
            raise Refused("Mark every goal: on track, at risk, off track or done.")
        out[g["id"]] = s
    return out


def overall(goals: list, progress: Optional[dict]) -> Optional[int]:
    if not goals or not progress:
        return None
    return int(round(sum(g["weight"] * progress.get(g["id"], 0) for g in goals) / 100))


def latest_progress(plan: dict) -> Optional[dict]:
    for q in reversed(QUARTERS):
        c = (plan.get("checkins") or {}).get(q) or {}
        if c.get("self"):
            return c["self"]["progress"]
    return None


def view_for(plan: dict, *, is_owner: bool, released: bool) -> dict:
    """What the browser gets. The year-end rating is removed for the owner
    until HR releases ratings for that year."""
    p = dict(plan)
    if is_owner and not released and p.get("year_end"):
        p["year_end"] = {"pending": True}
    p["overall"] = overall(p.get("goals") or [], latest_progress(plan))
    return p
