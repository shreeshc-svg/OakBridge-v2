"""AI insights for Marketing — the pure half (no database, no web framework).

THE RULE THIS FILE ENFORCES (Oct 2026)

The language model is an untrusted writer, not an analyst. Every number,
comparison and alert is worked out HERE, by code, from our own data ("facts"
and "findings"). The model is only asked to say it in plain English and
suggest what to do — and what it returns is checked before anyone sees it:

  * it must be the JSON shape asked for, with short strings;
  * every number in it must be one of the numbers in the facts — a model that
    "rounds" 41 visits to 40, invents a 25% uplift or a discount is rejected;
  * if anything fails (bad JSON, an invented number, the model is down or
    slow) the card shows the code's own findings instead. It never shows an
    unchecked sentence and never shows nothing.

Nothing personal is ever sent: facts are totals, rates, page paths, channel
and email-provider names. `assert_no_pii` refuses a facts object holding an
email address or a phone number, so a future change can't leak one by
accident.

Subject-line suggestions have their own guard: a suggestion may not introduce
a number, a price, a discount or an urgency claim that the original did not
contain — the model must not promise customers something nobody decided.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Optional

MAX_HEADLINE = 160
MAX_ITEM = 240
MAX_FINDINGS = 5
MAX_ACTIONS = 4

SYSTEM = (
    "You write short marketing insights for Oakbridge Publishing, an Indian book publisher selling on its own "
    "website. The reader is the marketing team: busy, not technical. Use ONLY the facts given. Every number you "
    "write must appear exactly in the facts — never calculate, estimate, round or invent a number, and never "
    "promise discounts or results. Plain words, no jargon, no hype. Reply with JSON only, no other text: "
    '{"headline": "<one sentence, the single most important point>", '
    '"findings": ["<up to 5 short sentences: what happened and the likely reason>"], '
    '"actions": ["<up to 4 short, concrete next steps the team can do this week>"]}'
)


# ------------------------------------------------------------- helpers ---
def pct(part, whole) -> Optional[float]:
    """Percentage with one decimal, or None when there is nothing to divide by."""
    return round(100.0 * part / whole, 1) if whole else None


def change_pct(now, before) -> Optional[float]:
    if not before:
        return None
    return round(100.0 * (now - before) / before, 1)


def r1(x) -> Optional[float]:
    return None if x is None else round(float(x) * 100, 1)   # a 0–1 rate as a percentage


_EMAIL = re.compile(r"[^\s@\"']+@[^\s@\"']+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")


def assert_no_pii(facts: dict) -> None:
    s = json.dumps(facts, ensure_ascii=False)
    if _EMAIL.search(s) or _PHONE.search(s):
        raise ValueError("facts contain an email address or phone number — not sent to the AI")


def facts_hash(area: str, facts: dict) -> str:
    return hashlib.sha256((area + json.dumps(facts, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()[:24]


# ------------------------------------------------- number check (anti-invention) ---
_NUM = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?")


def _nums_in(text: str) -> list:
    out = []
    for m in _NUM.finditer(text or ""):
        tok = m.group(0).replace(",", "")
        try:
            out.append(float(tok))
        except ValueError:
            pass
    return out


def allowed_numbers(facts) -> set:
    """Every number the facts contain — values AND digits inside strings
    (dates, page paths, edition numbers) — plus the obvious roundings."""
    seen: set = set()

    def walk(v):
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            f = float(v)
            seen.update({f, float(round(f)), round(f, 1), round(f, 2), abs(f), float(round(abs(f)))})
        elif isinstance(v, str):
            for n in _nums_in(v):
                seen.add(n)
        elif isinstance(v, dict):
            for k, x in v.items():
                walk(k)
                walk(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)
    walk(facts)
    return seen


def invented_numbers(text: str, allowed: set) -> list:
    bad = []
    for n in _nums_in(text):
        if not any(abs(n - a) < 0.051 for a in allowed):
            bad.append(n)
    return bad


# ------------------------------------------------------ model output ---
def parse_json(text: str) -> Optional[dict]:
    """The first {...} object in the reply (models sometimes wrap it in prose
    or ``` fences), or None."""
    if not text:
        return None
    s = text.strip()
    s = re.sub(r"^```(?:json)?|```$", "", s, flags=re.M).strip()
    start, depth = s.find("{"), 0
    if start < 0:
        return None
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    v = json.loads(s[start:i + 1])
                    return v if isinstance(v, dict) else None
                except ValueError:
                    return None
    return None


def _clean(s, n) -> str:
    s = re.sub(r"[\x00-\x1f\x7f]", " ", str(s or ""))
    # No markdown in a plain card — but keep the underscore inside {{first_name}}.
    s = re.sub(r"[*#`]+|(?<!\w)_+|_+(?!\w)", "", s)
    return re.sub(r"\s+", " ", s).strip()[:n]


def validate_insight(raw: Optional[dict], facts: dict) -> tuple[Optional[dict], str]:
    """(insight, "") when the model's answer is safe to show, else (None, why)."""
    if not isinstance(raw, dict):
        return None, "not JSON"
    head = _clean(raw.get("headline"), MAX_HEADLINE)
    finds = [_clean(x, MAX_ITEM) for x in (raw.get("findings") or []) if isinstance(x, str)][:MAX_FINDINGS]
    acts = [_clean(x, MAX_ITEM) for x in (raw.get("actions") or []) if isinstance(x, str)][:MAX_ACTIONS]
    finds, acts = [x for x in finds if x], [x for x in acts if x]
    if not head or not finds:
        return None, "missing headline or findings"
    allowed = allowed_numbers(facts)
    for t in [head, *finds, *acts]:
        bad = invented_numbers(t, allowed)
        if bad:
            return None, f"number not in the facts: {bad[0]:g}"
        if _EMAIL.search(t) or re.search(r"https?://", t):
            return None, "contains an address or link"
    return {"headline": head, "findings": finds, "actions": acts}, ""


def fallback(findings: list, actions: list) -> dict:
    """The card without the model: the code's own findings, unchanged."""
    f = [x for x in findings if x][:MAX_FINDINGS] or ["Not enough data in this period yet."]
    return {"headline": f[0], "findings": f[1:] or f, "actions": actions[:MAX_ACTIONS]}


def prompt_for(area: str, facts: dict, findings: list) -> str:
    return (f"Area: {area}\n\nFacts (JSON):\n{json.dumps(facts, ensure_ascii=False)}\n\n"
            f"What our own checks noticed (rephrase, reorder, add the likely reason; do not add numbers):\n"
            + "\n".join(f"- {x}" for x in findings) + "\n\nReturn the JSON now.")


# ============================================================ growth ===
def growth_facts(now: dict, prev: Optional[dict], ins: Optional[dict]) -> dict:
    """/marketing/growth/funnel (this period and the one before) +
    /marketing/growth/insights -> totals, per-channel rows, the shopping steps
    and the top pages. Percentages are pre-computed so the model never does
    arithmetic."""
    t = now.get("total") or {}
    p = (prev or {}).get("total") or {}
    has_prev = bool(prev) and not prev.get("empty") and (p.get("visits") or 0) > 0
    steps = t.get("steps") or {}
    chain = [("visits", t.get("visits", 0))] + [(k, steps.get(k, 0)) for k in ("view_item", "add_to_cart", "checkout", "payment")] \
        + [("paid", t.get("paid", 0))]
    step_rates = []
    for (a, na), (b, nb) in zip(chain, chain[1:]):
        if na:
            step_rates.append({"from": a, "to": b, "from_n": na, "to_n": nb, "kept_pct": pct(nb, na)})
    prev_rows = {r["channel"]: r for r in (prev or {}).get("rows") or []}
    channels = []
    for r in (now.get("rows") or [])[:10]:
        if not (r.get("visits") or r.get("paid")):
            continue
        pr = prev_rows.get(r["channel"], {})
        channels.append({
            "channel": r["channel"], "visits": r.get("visits", 0), "paid_orders": r.get("paid", 0),
            "revenue": round(r.get("revenue") or 0), "visit_to_paid_pct": r1(r.get("visit_to_paid")),
            **({"visits_before": pr.get("visits", 0), "paid_before": pr.get("paid", 0),
                "visits_change_pct": change_pct(r.get("visits", 0), pr.get("visits", 0))} if has_prev else {}),
        })
    facts = {
        "period": {"from": now.get("since"), "to": now.get("until")},
        "total": {"visits": t.get("visits", 0), "paid_orders": t.get("paid", 0), "checkouts": t.get("checkouts", 0),
                  "revenue": round(t.get("revenue") or 0), "visit_to_paid_pct": r1(t.get("visit_to_paid"))},
        "steps": step_rates if steps and any(steps.values()) else [],
        "channels": channels,
    }
    if has_prev:
        facts["previous_period"] = {
            "from": prev.get("since"), "to": prev.get("until"), "visits": p.get("visits", 0),
            "paid_orders": p.get("paid", 0), "revenue": round(p.get("revenue") or 0),
            "visits_change_pct": change_pct(t.get("visits", 0), p.get("visits", 0)),
            "paid_change_pct": change_pct(t.get("paid", 0), p.get("paid", 0)),
        }
    if ins and not ins.get("empty"):
        facts["top_landing_pages"] = [{"page": x["key"], "visits": x["n"]} for x in (ins.get("landing") or [])[:5]]
        facts["top_referring_sites"] = [{"site": x["key"], "visits": x["n"]} for x in (ins.get("referrer") or [])[:5]]
        dev = ins.get("device") or {}
        tot = sum(dev.values())
        facts["devices_pct"] = {k: pct(v, tot) for k, v in sorted(dev.items(), key=lambda kv: -kv[1])} if tot else {}
    return facts


def growth_findings(f: dict) -> tuple[list, list]:
    out, acts = [], []
    t = f["total"]
    if not t["visits"]:
        return ["No visits were counted in this period."], []
    out.append(f"{t['visits']} visits brought {t['paid_orders']} paid orders"
               + (f" ({t['visit_to_paid_pct']}% of visits)" if t["visit_to_paid_pct"] is not None else "") + ".")
    pp = f.get("previous_period")
    if pp and pp.get("visits_change_pct") is not None:
        out.append(f"Visits changed by {pp['visits_change_pct']}% and paid orders by "
                   f"{pp['paid_change_pct'] if pp['paid_change_pct'] is not None else 'n/a'}% against the previous period "
                   f"({pp['visits']} visits, {pp['paid_orders']} paid orders).")
    if f["steps"]:
        worst = min(f["steps"], key=lambda s: s["kept_pct"] if s["kept_pct"] is not None else 101)
        out.append(f"The biggest drop is from '{worst['from']}' to '{worst['to']}': only {worst['kept_pct']}% "
                   f"({worst['to_n']} of {worst['from_n']}) went on.")
        acts.append({"view_item": "Make book pages sell harder: clearer price, delivery date and Add to cart near the top.",
                     "add_to_cart": "Shorten the path from cart to checkout and show delivery time and returns in the cart.",
                     "checkout": "Check the checkout page on a phone: fewer fields, clear shipping cost, trust signals.",
                     "payment": "Check the payment step: UPI first, and remind people who stopped at payment.",
                     "paid": "Look at failed payments and send the abandoned-checkout reminder.",
                     "visits": "Bring visitors to a book page, not the home page, from campaigns and posts."}.get(worst["to"], ""))
    conv = [c for c in f["channels"] if c["visits"] >= 20 and c["visit_to_paid_pct"] is not None]
    if len(conv) >= 2:
        best = max(conv, key=lambda c: c["visit_to_paid_pct"])
        worst_c = min(conv, key=lambda c: c["visit_to_paid_pct"])
        if best["channel"] != worst_c["channel"]:
            out.append(f"{best['channel']} converts best ({best['visit_to_paid_pct']}% of {best['visits']} visits); "
                       f"{worst_c['channel']} converts least ({worst_c['visit_to_paid_pct']}% of {worst_c['visits']} visits).")
            acts.append(f"Put more effort into {best['channel']}, and check where {worst_c['channel']} visitors land.")
    if f.get("top_landing_pages"):
        lp = f["top_landing_pages"][0]
        out.append(f"Most visits start on {lp['page']} ({lp['visits']} visits).")
    return out, [a for a in acts if a]


# ========================================================== campaign ===
def campaign_facts(report: dict, baseline: dict) -> dict:
    """/marketing/campaigns/{id}/report + this account's average over recent
    email campaigns. No recipient addresses: only counts, links, hours and
    email-provider names."""
    s, r = report.get("stats") or {}, report.get("rates") or {}
    c = report.get("campaign") or {}
    hours: dict = {}
    for h, v in (report.get("timeline") or {}).items():
        hh = h[11:13] if len(h) >= 13 else ""
        if hh:
            hours[hh] = hours.get(hh, 0) + int(v.get("opened") or 0)
    links = sorted([x for x in report.get("links") or [] if x.get("clicks")], key=lambda x: -x["clicks"])[:5]
    return {
        "campaign": {"name": c.get("name"), "subject": c.get("subject"), "status": c.get("status"),
                     "started": (c.get("started_at") or "")[:10]},
        "counts": {k: int(s.get(k) or 0) for k in ("sent", "delivered", "opened", "clicked", "orders", "paid",
                                                     "bounced", "unsubscribed", "complained")},
        "revenue": round(float(s.get("revenue") or 0)),
        "rates_pct": {k: r1(r.get(k)) for k in ("delivery", "open", "click", "ctor", "bounce", "unsubscribe")},
        "your_average_pct": baseline,
        "top_links": [{"link": re.sub(r"\?.*$", "", x["url"])[:120], "clicks": x["clicks"]} for x in links],
        "opens_by_hour_utc": dict(sorted(hours.items())),
        "bouncing_providers": [{"provider": p["provider"], "sent": p["sent"], "bounced": p["bounced"]}
                               for p in (report.get("providers") or []) if p.get("bounced")][:5],
        "skipped": [{"reason": x["reason"], "n": x["n"]} for x in (report.get("skipped") or [])][:5],
    }


def campaign_findings(f: dict) -> tuple[list, list]:
    out, acts = [], []
    k, rt, avg = f["counts"], f["rates_pct"], f["your_average_pct"] or {}
    if not k["sent"]:
        return ["This campaign has not sent anything yet."], []
    out.append(f"Sent to {k['sent']}, {k['opened']} opened, {k['clicked']} clicked and {k['paid']} paid orders "
               f"(revenue {f['revenue']}).")
    for key, label in (("open", "Open rate"), ("click", "Click rate")):
        if rt.get(key) is not None and avg.get(key) is not None:
            word = "above" if rt[key] > avg[key] else "below" if rt[key] < avg[key] else "the same as"
            out.append(f"{label} {rt[key]}% is {word} your average of {avg[key]}%.")
    if rt.get("open") is not None and avg.get("open") is not None and rt["open"] < avg["open"]:
        acts.append("Test a shorter, more specific subject line (the book or author name) on the next send.")
    if rt.get("ctor") is not None and rt["ctor"] < 10:
        acts.append("People opened but few clicked: put one clear button for one book near the top.")
    if f["top_links"]:
        out.append(f"Most clicked: {f['top_links'][0]['link']} ({f['top_links'][0]['clicks']} clicks).")
    if f["opens_by_hour_utc"]:
        hh, n = max(f["opens_by_hour_utc"].items(), key=lambda kv: kv[1])
        out.append(f"Most opens came in the hour starting {hh}:00 UTC ({n} opens).")
    if (rt.get("bounce") or 0) >= 2:
        out.append(f"Bounce rate {rt['bounce']}% is high.")
        acts.append("Clean this list in Verify & import before the next send.")
    if k["clicked"] and not k["paid"]:
        acts.append("Clicks but no orders: check the landing book page shows price, stock and delivery clearly.")
    return out, acts


# ===================================================== deliverability ===
CEILING_PCT = 4.0        # marketing.MAX_BOUNCE_CEILING, as a percentage
AWS_REVIEW_PCT = 5.0


def deliverability_facts(kpi: dict, verification: dict, accuracy: dict, providers: dict, health: dict) -> dict:
    vtot = sum(int(v or 0) for v in (verification or {}).values())
    rep = (health or {}).get("aws_reputation") or {}
    learned = (providers or {}).get("summary") or {}
    return {
        "last_30_days_pct": {"delivery": r1(kpi.get("delivery_rate")), "bounce": r1(kpi.get("bounce_rate")),
                             "complaint": r1(kpi.get("complaint_rate")), "unsubscribe": r1(kpi.get("unsubscribe_rate")),
                             "open": r1(kpi.get("open_rate"))},
        "emails_sent_30_days": kpi.get("email_sent", 0),
        "contacts": kpi.get("contacts", 0), "subscribed": kpi.get("subscribed", 0),
        "verification_pct": {k or "unchecked": pct(int(v or 0), vtot) for k, v in sorted((verification or {}).items(), key=lambda kv: -(kv[1] or 0))} if vtot else {},
        "bounce_by_belief_pct": {b: r1(x.get("rate")) for b, x in ((accuracy or {}).get("bands") or {}).items() if x.get("sent")},
        "aws_reputation_pct": {"bounce": r1(rep.get("bounce_rate")), "complaint": round(rep["complaint_rate"] * 100, 3)
                               if rep.get("complaint_rate") is not None else None},
        "limits_pct": {"our_stop": CEILING_PCT, "aws_review": AWS_REVIEW_PCT},
        "providers_blocked": [r.get("domain") for r in (providers or {}).get("rows") or [] if r.get("bad_provider")][:8],
        "sending_enabled": (health or {}).get("sending_enabled"),
        "learned_summary": {k: v for k, v in learned.items() if isinstance(v, (int, float))},
    }


def deliverability_findings(f: dict) -> tuple[list, list]:
    out, acts = [], []
    d = f["last_30_days_pct"]
    if d["bounce"] is not None:
        state = "safely under" if d["bounce"] < CEILING_PCT * 0.5 else "close to" if d["bounce"] < CEILING_PCT else "over"
        out.append(f"Bounce rate {d['bounce']}% over 30 days is {state} our stop limit of {CEILING_PCT}% "
                   f"(AWS reviews at {AWS_REVIEW_PCT}%).")
        if d["bounce"] >= CEILING_PCT * 0.5:
            acts.append("Send only to confirmed contacts for the next campaigns and re-verify older lists.")
    aws = f["aws_reputation_pct"]
    if aws.get("bounce") is not None:
        out.append(f"AWS's own bounce figure is {aws['bounce']}%.")
    if d["complaint"] is not None and d["complaint"] >= 0.1:
        out.append(f"Spam complaints are {d['complaint']}% — at AWS's review level.")
        acts.append("Make the unsubscribe link obvious and mail only people who asked to hear from us.")
    v = f["verification_pct"]
    risky = sum(x for k, x in v.items() if k in ("risky", "unknown", "unchecked") and x)
    if risky:
        out.append(f"{round(risky, 1)}% of contacts are not confirmed yet (risky, unknown or unchecked).")
        acts.append("Run verification on unconfirmed contacts before including them in a campaign.")
    if f["providers_blocked"]:
        out.append(f"Email providers held back for bouncing: {', '.join(f['providers_blocked'][:5])}.")
    if f["subscribed"] and f["contacts"]:
        out.append(f"{f['subscribed']} of {f['contacts']} contacts have agreed to marketing email.")
    return out, acts


# =========================================================== subjects ===
SPAM_WORDS = ("free", "act now", "limited time", "urgent", "guarantee", "winner", "cash", "100%", "click here",
              "buy now", "risk-free", "!!!", "cheap", "offer expires", "congratulations")
URGENCY_OR_PRICE = ("free", "discount", "% off", "off", "sale", "offer", "deal", "limited", "last chance", "today only",
                    "hurry", "₹", "rs.", "rs ", "inr", "%", "cashback", "coupon", "flat")


def subject_checks(subject: str, preheader: str = "") -> list:
    """Plain rules, no model: what a careful editor would flag."""
    s = (subject or "").strip()
    out = []
    if not s:
        return ["The subject is empty."]
    n = len(s)
    if n > 60:
        out.append(f"{n} characters — phones cut it after about 40–50. Put the key words first.")
    elif n < 15:
        out.append("Very short — say what is inside (a book, an author, a reason to open).")
    low = s.lower()
    hits = [w for w in SPAM_WORDS if w in low]
    if hits:
        out.append(f"Words spam filters dislike: {', '.join(hits)}.")
    letters = [c for c in s if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.5 and len(letters) > 8:
        out.append("Mostly capitals — reads as shouting and hurts delivery.")
    if s.count("!") > 1:
        out.append("More than one exclamation mark.")
    if not (preheader or "").strip():
        out.append("No preview text — the inbox will show the first line of the email instead. Add one.")
    elif (preheader or "").strip().lower() == low:
        out.append("Preview text repeats the subject — use it to add something new.")
    return out or ["Looks fine: clear length, no spam words."]


def subject_prompt(subject: str, preheader: str, context: str) -> str:
    return (
        "Write 3 alternative email subject lines and 1 preview text for this Oakbridge Publishing email.\n"
        f"Current subject: {subject}\nCurrent preview text: {preheader or '(none)'}\n"
        f"What the email is about: {context or '(not given)'}\n\n"
        "Rules: under 50 characters each; specific (book, author or topic); warm and honest; no ALL CAPS, at most "
        "one exclamation mark; do NOT add any number, price, discount, offer, deadline or urgency that is not in the "
        "current subject or the description. Keep any {{first_name}} style variables exactly as written.\n"
        'Reply with JSON only: {"subjects": ["...", "...", "..."], "preheader": "..."}'
    )


def validate_subjects(raw: Optional[dict], subject: str, preheader: str, context: str) -> tuple[Optional[dict], str]:
    if not isinstance(raw, dict):
        return None, "not JSON"
    src = f"{subject} {preheader} {context}".lower()
    allowed = allowed_numbers(src)
    vars_ok = set(re.findall(r"\{\{\s*\w+\s*\}\}", src))
    out = []
    for x in (raw.get("subjects") or [])[:5]:
        t = _clean(x, 90)
        if not t or len(t) > 80:
            continue
        low = t.lower()
        if invented_numbers(t, allowed):
            continue
        if any(w in low and w not in src for w in URGENCY_OR_PRICE):
            continue   # the model may not promise an offer nobody decided
        if any(v.lower() not in vars_ok for v in re.findall(r"\{\{\s*\w+\s*\}\}", low)):
            continue
        if t.lower() != subject.strip().lower() and t not in out:
            out.append(t)
    pre = _clean(raw.get("preheader"), 120)
    if pre and (invented_numbers(pre, allowed) or any(w in pre.lower() and w not in src for w in URGENCY_OR_PRICE)):
        pre = ""
    if not out:
        return None, "no suggestion passed the checks"
    return {"subjects": out[:3], "preheader": pre}, ""


# ======================================================= next actions ===
def next_action_findings(actions: list) -> list:
    return [f"{a['title']} — {a['audience']} people." for a in actions]
