"""Marketing — the pure parts, testable without a database or network.

  * email verification rules (syntax, typos, role / disposable addresses) and
    the final verdict that combines them with a domain (MX) lookup
  * the email-safe HTML renderer for campaign blocks
  * signed tokens for open / click / unsubscribe / confirm links
  * funnel and rate maths for the dashboard

Nothing here does I/O. marketing.py does the lookups, the database and SES.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import re
from typing import Iterable, Optional

# ------------------------------------------------------------ addresses ---
_DOT_DOMAINS = {"gmail.com", "googlemail.com"}


def normalise_email(email: str) -> str:
    """Reduce an address to the mailbox that actually receives it.

    Gmail ignores dots in the local part and everything after a '+', so
    `te.x.as@gmail.com` and `texas+3@googlemail.com` are one inbox. Used for
    de-duplication only — mail always goes to the address as given.
    (antispam.normalise_email is this same function.)
    """
    e = str(email or "").strip().lower()
    if "@" not in e:
        return e
    local, _, domain = e.partition("@")
    local = local.split("+", 1)[0]
    if domain in _DOT_DOMAINS:
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


# Practical address syntax: what real mail systems accept and Excel sheets
# contain. Not the full RFC (quoted locals etc. never appear in a list and are
# almost always mistakes when they do).
_LOCAL = r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
_DOMAIN = r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}"
EMAIL_RE = re.compile(rf"^{_LOCAL}@{_DOMAIN}$")

COMMON_DOMAINS = (
    "gmail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "hotmail.com", "outlook.com", "live.com",
    "rediffmail.com", "icloud.com", "ymail.com", "protonmail.com", "aol.com", "msn.com", "me.com",
    "zoho.com", "outlook.in", "hotmail.co.in", "live.in", "proton.me",
)
# Wrong endings on the big providers that a distance check would miss or
# misjudge (gmail.co is 1 edit from gmail.com but also a real TLD pattern).
TYPO_FIXES = {
    "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.con": "gmail.com",
    "gmail.in": "gmail.com", "gmail.co.in": "gmail.com", "gamil.com": "gmail.com", "gmial.com": "gmail.com",
    "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
    "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com",
    "hotmail.co": "hotmail.com", "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com",
    "outlook.co": "outlook.com", "outlok.com": "outlook.com", "rediffmail.co": "rediffmail.com",
    "rediff.com": "rediffmail.com", "redifmail.com": "rediffmail.com", "icloud.co": "icloud.com",
}
ROLE_LOCALS = frozenset({
    "admin", "administrator", "info", "contact", "sales", "support", "help", "office", "accounts",
    "billing", "hr", "jobs", "careers", "marketing", "noreply", "no-reply", "donotreply", "postmaster",
    "webmaster", "hostmaster", "abuse", "enquiry", "enquiries", "team", "hello", "mail", "service",
    "admissions", "library", "principal", "registrar", "editor", "orders",
})
# The most common throwaway providers. Not exhaustive by design: a full list
# is thousands of domains and churns weekly; the MX + bounce layers catch the
# rest, and the admin can add more in Settings (extra_disposable).
DISPOSABLE = frozenset({
    "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com", "10minutemail.com",
    "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "throwawaymail.com",
    "yopmail.com", "yopmail.fr", "getnada.com", "nada.email", "dispostable.com", "trashmail.com", "trashmail.de",
    "maildrop.cc", "mintemail.com", "fakeinbox.com", "mailnesia.com", "moakt.com", "emailondeck.com",
    "spamgourmet.com", "mytemp.email", "tempail.com", "tempr.email", "discard.email", "mohmal.com",
    "burnermail.io", "mailcatch.com", "inboxkitten.com", "emailfake.com", "fakemail.net", "luxusmail.org",
    "tmpmail.org", "tmpmail.net", "mail.tm", "mailpoof.com", "getairmail.com", "anonaddy.me", "33mail.com",
    "spambox.us", "trbvm.com", "wegwerfmail.de", "einrot.com", "armyspy.com", "cuvox.de", "dayrep.com",
    "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
})


def levenshtein(a: str, b: str, cap: int = 3) -> int:
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


# QWERTY neighbours, for "one key off" company-domain typos (mmtckimited.com
# -> mmtclimited.com). Used only to propose candidates; a candidate must really
# receive email before it is used (marketing._repair_domains).
_KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
_NEAR: dict = {}
for _r, _row in enumerate(_KEYS):
    for _c, _ch in enumerate(_row):
        n = set()
        for dr in (-1, 0, 1):
            rr = _r + dr
            if 0 <= rr < len(_KEYS):
                for dc in (-1, 0, 1):
                    cc = _c + dc
                    if 0 <= cc < len(_KEYS[rr]) and (dr or dc):
                        n.add(_KEYS[rr][cc])
        _NEAR[_ch] = n


def domain_typo_candidates(domain: str, limit: int = 120) -> list:
    """Plausible intended domains for one that doesn't receive mail: one key
    swapped for a neighbour, one letter dropped, two letters swapped — in the
    name only (the ending .com / .co.in is left alone)."""
    d = (domain or "").lower()
    if "." not in d:
        return []
    label, _, tld = d.partition(".")
    out, seen = [], set()

    def add(lbl):
        if lbl and lbl != label and re.match(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", lbl):
            c = f"{lbl}.{tld}"
            if c not in seen:
                seen.add(c)
                out.append(c)
    for i, ch in enumerate(label):
        for nb in sorted(_NEAR.get(ch, ())):
            add(label[:i] + nb + label[i + 1:])
    for i in range(len(label)):
        add(label[:i] + label[i + 1:])
    for i in range(len(label) - 1):
        add(label[:i] + label[i + 1] + label[i] + label[i + 2:])
    return out[:limit]


def closest_known(domain: str, known: Iterable) -> Optional[str]:
    """A domain from `known` (ones that receive mail / we delivered to) that is
    almost certainly what was meant: same ending, 1 edit (2 for long names),
    and the only such match."""
    d = (domain or "").lower()
    tld = d.partition(".")[2]
    hits = []
    for k in known:
        k = (k or "").lower()
        if not k or k == d or k.partition(".")[2] != tld:
            continue
        dist = levenshtein(d, k, cap=2)
        if dist == 1 or (dist == 2 and len(d) >= 12):
            hits.append((dist, k))
    hits.sort()
    if not hits or (len(hits) > 1 and hits[0][0] == hits[1][0]):
        return None
    return hits[0][1]


def suggest_domain(domain: str) -> Optional[str]:
    """'gmial.com' -> 'gmail.com'. None if the domain looks intended."""
    d = domain.lower()
    if d in COMMON_DOMAINS:
        return None
    if d in TYPO_FIXES:
        return TYPO_FIXES[d]
    best, dist = None, 9
    for c in COMMON_DOMAINS:
        k = levenshtein(d, c, cap=2)
        if k < dist:
            best, dist = c, k
    # One edit on a short common domain is almost always a typo; two edits
    # only for the long ones (rediffmail.com), to avoid "fixing" real domains.
    if best and (dist == 1 or (dist == 2 and len(best) >= 10)):
        return best
    return None


_INVISIBLE = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff\u00ad]")
_LOOKALIKES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u00a0": " ",
                             "\uff20": "@", "\uff0e": ".", "\u3002": "."})


def clean_raw(raw) -> tuple:
    """Repair what spreadsheets do to addresses (Oct 2026: a live import had 11
    addresses split by a space, e.g. "gmail.co m", "jindalgroup. com").
    Returns (cleaned, [what was fixed]). Deterministic and safe:

    - invisible characters, non-breaking spaces, curly quotes, full-width @ / .;
    - "Name <a@b.com>" -> the address; mailto:; [at] / (at) / [dot];
    - two addresses in one cell -> the first (the rest are named in the note);
    - spaces inside the DOMAIN (a line-wrap: "gmail.co m") and around @ / dots;
      a space inside the name part ("john smith@…") is NOT guessed at — it
      stays invalid for a person to check;
    - stray punctuation at either end, "gmail,com", doubled dots."""
    s0 = str(raw or "")
    t = _INVISIBLE.sub("", s0).translate(_LOOKALIKES)
    notes = []
    m = re.search(r"<\s*([^<>\s]+@[^<>\s]+)\s*>", t)
    if m and t.strip() != m.group(0):
        t = m.group(1)
        notes.append("took the address out of “Name <address>”")
    t = t.strip().strip("<>\"'`()[]{}").strip()
    t2 = re.sub(r"^mailto:\s*", "", t, flags=re.I)
    if t2 != t:
        t = t2
        notes.append("removed “mailto:”")
    t2 = re.sub(r"\s*[\[(]\s*at\s*[\])]\s*", "@", t, flags=re.I)
    t2 = re.sub(r"\s*[\[(]\s*dot\s*[\])]\s*", ".", t2, flags=re.I)
    if t2 != t:
        t = t2
        notes.append("[at] / [dot] written out")
    if t.count("@") > 1:
        parts = [p.strip(".,;:") for p in re.split(r"[\s,;/|]+", t) if "@" in p]
        if len(parts) > 1 and all(p.count("@") == 1 for p in parts):
            notes.append(f"{len(parts)} addresses in one cell — kept the first; also there: {', '.join(parts[1:])[:80]}")
            t = parts[0]
    t2 = re.sub(r"\s*@\s*", "@", t)
    t2 = re.sub(r"\s*\.\s*", ".", t2)
    if "@" in t2 and t2.count("@") == 1 and re.search(r"\s", t2.split("@")[0]):
        return t.strip().lower(), notes  # "john smith@…": not guessed at — a person checks it
    if "@" in t2 and t2.count("@") == 1:
        local, dom = t2.split("@")
        if re.search(r"\s", dom):
            dom = re.sub(r"\s+", "", dom)
        dom2 = dom.replace(",", ".")
        if dom2 != dom:
            notes.append("comma in the domain changed to a dot")
        t2 = f"{local}@{dom2}"
    if t2 != t and re.sub(r"\s+", "", t2) == re.sub(r"\s+", "", t):
        notes.append("removed spaces inside the address")
    t = t2
    t2 = t.strip(".,;: ")
    if t2 != t:
        t = t2
        notes.append("removed stray punctuation at the end")
    t2 = re.sub(r"\.{2,}", ".", t)
    if t2 != t:
        t = t2
        notes.append("removed a doubled dot")
    return t.lower(), notes


def check_syntax(raw: str) -> dict:
    """First-pass verdict on one address, no network.

    Returns {email, ok, reasons[], suggestion, role, disposable, cleaned[]}.
    `email` is repaired by clean_raw (what was changed is in `cleaned`).
    """
    e, cleaned = clean_raw(raw)
    out = {"email": e, "ok": True, "reasons": [], "suggestion": None, "role": False, "disposable": False, "cleaned": cleaned}
    if not e:
        out.update(ok=False, reasons=["no email address in this row"])
        return out
    if e.count("@") != 1 or not EMAIL_RE.match(e) or len(e) > 254 or len(e.split("@")[0]) > 64:
        why = "bad format"
        if e.count("@") == 1 and re.search(r"\s", e.split("@")[0]):
            why = "bad format — a space inside the name part (check by hand)"
        elif "@" not in e:
            why = "bad format — no @"
        out.update(ok=False, reasons=[why])
        return out
    local, domain = e.split("@")
    sug = suggest_domain(domain)
    if sug:
        out["suggestion"] = f"{local}@{sug}"
        out["reasons"].append(f"typo? {domain} -> {sug}")
    if local in ROLE_LOCALS or local.split(".")[0] in ROLE_LOCALS:
        out["role"] = True
        out["reasons"].append("role address")
    if domain in DISPOSABLE:
        out["disposable"] = True
        out["ok"] = False
        out["reasons"].append("throwaway domain")
    return out


def verdict(syntax: dict, mx: Optional[bool], *, proven: bool = False, suppressed: Optional[str] = None) -> str:
    """Combine every layer into one status.

    verified  proven real: OTP-confirmed account, delivered/opened before
    valid     good syntax and the domain receives mail
    risky     deliverable domain but role address, or a suggested typo not
              applied, or the domain lookup could not be completed
    invalid   bad syntax, throwaway, or the domain cannot receive mail
    suppressed  bounced / complained / unsubscribed earlier — never mailed
    """
    if suppressed:
        return "suppressed"
    if not syntax.get("ok"):
        return "invalid"
    if mx is False:
        return "invalid"
    if proven:
        return "verified"
    if mx is None or syntax.get("role") or syntax.get("suggestion"):
        return "risky"
    return "valid"


# Send order inside a campaign: proven first, unproven last, so bounces —
# if any — come at the end where the auto-pause can still stop the run.
SEND_ORDER = {"verified": 0, "valid": 1, "risky": 2}
SENDABLE = frozenset(SEND_ORDER)

_SEVERITY = {"verified": 0, "valid": 1, "unknown": 1, "risky": 2, "invalid": 3, "suppressed": 4}


def worse(a: str, b: Optional[str]) -> str:
    """The more cautious of two statuses. Combining our free checks with SES
    can only ever downgrade an address, never vouch for one our own checks
    already doubted (a role address stays risky even if SES says HIGH)."""
    if not b:
        return a
    return a if _SEVERITY.get(a, 1) >= _SEVERITY.get(b, 1) else b


def ses_verdict(resp: dict) -> tuple:
    """Amazon SES Email Validation (sesv2 GetEmailAddressInsights) -> (status, reasons).

    IsValid is SES's overall confidence that the address is deliverable:
    HIGH -> valid, MEDIUM -> risky (sent only if a campaign asks for risky),
    LOW -> invalid (never sent). For IsDisposable / IsRandomInput /
    IsRoleAddress the confidence is that the address IS that thing, so HIGH
    there is bad news. Returns (None, []) for a response without a verdict,
    which callers treat as "not checked" rather than guessing."""
    mv = (resp or {}).get("MailboxValidation") or {}
    overall = str((mv.get("IsValid") or {}).get("ConfidenceVerdict") or "").upper()
    ev = mv.get("Evaluations") or {}

    def lvl(k: str) -> str:
        return str((ev.get(k) or {}).get("ConfidenceVerdict") or "").upper()

    reasons = []
    if lvl("HasValidSyntax") == "LOW":
        reasons.append("SES: address format not accepted")
    if lvl("HasValidDnsRecords") == "LOW":
        reasons.append("SES: domain can't receive email")
    if lvl("MailboxExists") == "LOW":
        reasons.append("SES: mailbox does not exist")
    elif lvl("MailboxExists") == "MEDIUM":
        reasons.append("SES: mailbox not confirmed")
    if lvl("IsDisposable") == "HIGH":
        reasons.append("SES: throwaway address")
    if lvl("IsRandomInput") == "HIGH":
        reasons.append("SES: looks randomly typed")
    if lvl("IsRoleAddress") == "HIGH":
        reasons.append("SES: shared / role mailbox")
    status = ses_status(overall, lvl("MailboxExists"))
    if not status:
        return None, []
    default = {"valid": "SES: mailbox likely exists", "risky": "SES: deliverability uncertain",
               "invalid": "SES: unlikely to be deliverable"}[status]
    return status, reasons or [default]


def ses_status(overall: str, mailbox: str = "") -> Optional[str]:
    """Status from SES's levels. "Mailbox does not exist" (MailboxExists LOW)
    is decisive on its own: SES can still give such an address a MEDIUM
    overall score, but mailing it is a guaranteed bounce."""
    overall, mailbox = (overall or "").upper(), (mailbox or "").upper()
    if mailbox == "LOW":
        return "invalid" if overall else None
    return {"HIGH": "valid", "MEDIUM": "risky", "LOW": "invalid"}.get(overall)


def ses_details(resp: dict) -> dict:
    """The raw SES levels we keep beside the verdict: overall confidence,
    mailbox-exists confidence, and whether SES thinks it's a role mailbox."""
    mv = (resp or {}).get("MailboxValidation") or {}
    ev = mv.get("Evaluations") or {}

    def lvl(k: str) -> str:
        return str((ev.get(k) or {}).get("ConfidenceVerdict") or "").upper()

    return {"overall": str((mv.get("IsValid") or {}).get("ConfidenceVerdict") or "").upper(),
            "mailbox": lvl("MailboxExists"), "role": lvl("IsRoleAddress") == "HIGH",
            "random": lvl("IsRandomInput") == "HIGH"}


# Big free-mail providers answer mailbox checks definitively, so "uncertain"
# there means uncertain. Company / college servers often accept ANY address
# (catch-all), which is why SES can't confirm the mailbox — a different risk.
# They are also never "learned" as bad domains: three typo'd Gmail addresses
# say nothing about Gmail.
WEBMAIL = frozenset(COMMON_DOMAINS) | {"googlemail.com", "rediff.com"}
RISK_KINDS = ("role", "catch_all", "unconfirmed")
DEFAULT_RISK_POLICY = {"role": "send", "catch_all": "tail", "unconfirmed": "skip"}
# Unconfirmed and catch-all addresses can no longer be mixed into the main send
# ("send"): the most they get is the tail — small batches after everyone
# confirmed, stopping itself on bounces. A live campaign in Oct 2026 sent 475
# unconfirmed Yahoo/Rediff/old-company addresses with "send" and bounced ~10%,
# AWS's pause line. Role addresses may still be sent.
TAIL_ONLY_KINDS = frozenset({"catch_all", "unconfirmed"})
# A provider (gmail.com, yahoo.co.in, a company domain…) whose UNPROVEN
# addresses bounce this much, over at least this many sends, is learned as a
# bad provider: its unproven addresses are skipped until proven another way.
PROVIDER_MIN_SENDS = 20
PROVIDER_MAX_BOUNCE = 0.08
# SES can't confirm mailboxes at some providers (Yahoo, Rediff…): after this
# many paid checks with almost no confirmed answer, stop paying for that provider.
UNVERIFIABLE_MIN_CHECKS = 20
UNVERIFIABLE_MAX_CONFIRMED = 0.05


def clean_policy(pol: Optional[dict]) -> dict:
    """The risky-address rules as they are APPLIED: defaults filled in, and
    'send' lowered to 'tail' for the tail-only kinds (older saved settings)."""
    out = dict(DEFAULT_RISK_POLICY)
    for k, v in (pol or {}).items():
        if k in RISK_KINDS and v in ("send", "tail", "skip"):
            out[k] = v
    for k in TAIL_ONLY_KINDS:
        if out.get(k) == "send":
            out[k] = "tail"
    return out


def bad_provider(sent: int, bounced: int) -> bool:
    """Learned from our own sends to unproven addresses at one provider."""
    return sent >= PROVIDER_MIN_SENDS and bounced / max(sent, 1) > PROVIDER_MAX_BOUNCE


def ses_unverifiable(checks: int, confirmed: int) -> bool:
    """SES keeps answering "can't confirm" for this provider: checks there buy nothing."""
    return checks >= UNVERIFIABLE_MIN_CHECKS and confirmed / max(checks, 1) < UNVERIFIABLE_MAX_CONFIRMED


# Bounces some providers label "Transient" but which mean the mailbox is dead:
# Gmail's "inactive / out of storage" (OverQuotaPerm, 5.2.1 DisabledUser) and
# Yahoo's "mailbox is disabled" (554.30). Retrying them three times is three
# more bounces on our record.
_DEAD_MAILBOX_RE = re.compile(r"OverQuotaPerm|DisabledUser|\binactive\b|mailbox is disabled|554\.30|"
                              r"5\.2\.1|mailbox not found|does not exist|NoSuchUser|RecipientNotFound|user unknown", re.I)


def dead_mailbox(diagnostic: str) -> bool:
    return bool(_DEAD_MAILBOX_RE.search(diagnostic or ""))


def risk_kind(*, role: bool, domain: str, ses_overall: str = "", mailbox: str = "") -> str:
    """Why a 'risky' address is risky, so each kind can get its own rule."""
    if role:
        return "role"
    if ses_overall == "MEDIUM" and mailbox in ("MEDIUM", "") and (domain or "").lower() not in WEBMAIL:
        return "catch_all"
    return "unconfirmed"


SELECTABLE = ("verified", "valid", "risky")


def selected_statuses(audience: Optional[dict]) -> frozenset:
    """Which address statuses a campaign goes to (the admin's tick-boxes).
    Missing / empty / junk -> all three, so older campaigns behave as before."""
    got = frozenset(x for x in ((audience or {}).get("statuses") or []) if x in SELECTABLE)
    return got or frozenset(SELECTABLE)


def send_decision(status: str, kind: str, policy: Optional[dict], *, needs_ses: bool, has_ses: bool,
                  allowed: Optional[frozenset] = None) -> tuple:
    """-> (action, priority, reason) for one recipient when a campaign is
    prepared. action: 'send' | 'tail' (sent last, stops itself if it bounces)
    | 'skip' (recorded with the reason, never sent). Lower priority goes first.
    `allowed` = the statuses ticked for this campaign; the status used is the
    one AFTER the pre-send check."""
    if status in ("invalid", "suppressed"):
        return "skip", 9, f"address {status}"
    if allowed is not None and status in SELECTABLE and status not in allowed:
        return "skip", 9, f"{status} — not ticked for this campaign"
    if status == "verified":
        return "send", 0, ""
    if needs_ses and not has_ses:
        return "skip", 9, "mailbox not checked (monthly budget used up or AWS unavailable)"
    if status == "valid":
        return "send", 1, ""
    if status == "risky":
        if kind == "bad_provider":
            return "skip", 9, "risky (provider bounces too often for unconfirmed addresses) — skipped"
        act = clean_policy(policy).get(kind) or DEFAULT_RISK_POLICY.get(kind, "skip")
        if act == "send":
            return "send", 2, ""
        if act == "tail":
            return "tail", 3, ""
        return "skip", 9, f"risky ({(kind or 'unconfirmed').replace('_', ' ')}) — skipped by rule"
    return "skip", 9, "address not checked"


# ----------------------------------------------------------- scoring ---
# Every not-yet-proven address gets a 0-100 confidence score from the
# evidence we have; the score — not one signal — decides valid / risky /
# invalid. Base deltas are a starting point; learn_adjustments() nudges each
# signal from real bounce outcomes (bounded, minimum sample sizes).
BASE_DELTAS = {
    "ses_high": 20, "ses_medium": -15, "mailbox_high": 5, "mailbox_doubt": -10, "catch_all": -5,
    "random": -25, "domain_good": 15, "domain_bad": -30, "name_match": 10, "no_ses": 0,
    "made_up": -20, "inactive": -15,
}
SIGNAL_LABELS = {
    "ses_high": "SES: deliverable", "ses_medium": "SES: uncertain", "mailbox_high": "SES: mailbox exists",
    "mailbox_doubt": "SES: mailbox not confirmed", "catch_all": "domain accepts any address",
    "random": "looks randomly typed", "domain_good": "this domain receives our email",
    "domain_bad": "this domain bounced 3+ addresses", "name_match": "name matches the address",
    "no_ses": "no mailbox check", "made_up": "looks made-up", "inactive": "no opens or clicks lately",
}
DEFAULT_THRESHOLDS = {"valid": 65, "invalid": 35}
START_SCORE = 65  # format + mail server + not throwaway: passes the free checks


def name_matches(local: str, name: str) -> bool:
    """'renu.rawat', 'rrawat', 'renu_r', 'rawat.renu' for 'Renu Rawat'.
    A real person's address usually contains their name; a typo'd or made-up
    one usually doesn't."""
    parts = [p for p in re.split(r"[^a-z]+", (name or "").lower()) if len(p) >= 3]
    loc = re.sub(r"[^a-z]", "", (local or "").lower().split("+")[0])
    if not parts or len(loc) < 3:
        return False
    if any(p in loc for p in parts):
        return True
    first, last = parts[0], parts[-1]
    return len(parts) >= 2 and (loc.startswith(first[0] + last) or loc.startswith(last + first[0]))


def score_address(signals: dict, *, adjust: Optional[dict] = None, thresholds: Optional[dict] = None,
                  role_ok: bool = True) -> dict:
    """signals: {ses: 'HIGH'|'MEDIUM'|'', mailbox: 'HIGH'|'MEDIUM'|'', catch_all: True|False|None,
    random: bool, role: bool, domain_good: bool, domain_bad: bool, name_match: bool}
    -> {score, status ('valid'|'risky'|'invalid'), flags[], reasons[]}.
    Hard facts (mailbox missing, throwaway, bounced before) are decided before
    this and never reach it. Role addresses and bad domains are capped at
    risky whatever the score: those are rules, not evidence."""
    adjust = adjust or {}
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    flags = []
    ses, mailbox = (signals.get("ses") or "").upper(), (signals.get("mailbox") or "").upper()
    if ses == "HIGH":
        flags.append("ses_high")
    elif ses == "MEDIUM":
        flags.append("ses_medium")
    else:
        flags.append("no_ses")
    if mailbox == "HIGH":
        flags.append("mailbox_high")
    elif mailbox == "MEDIUM" and signals.get("catch_all") is not True:
        # At a catch-all domain "can't confirm the mailbox" says nothing; at a
        # domain that does confirm mailboxes it is a real doubt.
        flags.append("mailbox_doubt")
    if signals.get("catch_all") is True:
        flags.append("catch_all")
    for f in ("random", "domain_good", "domain_bad", "name_match", "made_up", "inactive"):
        if signals.get(f):
            flags.append(f)
    score, reasons = START_SCORE, []
    for f in flags:
        d = BASE_DELTAS.get(f, 0) + int(adjust.get(f, 0))
        score += d
        if d:
            reasons.append((d, f"{'+' if d > 0 else '−'}{abs(d)} {SIGNAL_LABELS.get(f, f)}"))
    score = max(0, min(100, score))
    status = "valid" if score >= th["valid"] else "risky" if score >= th["invalid"] else "invalid"
    if status == "valid" and (signals.get("domain_bad") or (signals.get("role") and not role_ok)):
        status = "risky"
    reasons.sort(key=lambda x: -abs(x[0]))
    return {"score": score, "status": status, "flags": flags, "reasons": [r for _, r in reasons[:3]]}


def learn_adjustments(flag_stats: dict, *, baseline: float, min_sent: int = 30, cap: int = 20, k: float = 8.0) -> dict:
    """Self-learning, kept simple and bounded. For each signal: how often did
    addresses carrying it hard-bounce, compared with all sends? Twice the
    usual bounce rate -> about -8 points; half -> about +8; capped at ±cap,
    and nothing changes below min_sent sends (no learning from noise).
    flag_stats = {flag: {"sent": n, "bounced": b}}."""
    import math
    out = {}
    base = max(float(baseline), 0.002)
    for flag, st in (flag_stats or {}).items():
        n, b = int(st.get("sent", 0)), int(st.get("bounced", 0))
        if n < min_sent:
            continue
        rate = (b + base * 10) / (n + 10)          # smoothed towards the baseline
        adj = -k * math.log2(max(rate, 0.0005) / base)
        out[flag] = int(max(-cap, min(cap, round(adj))))
    return out


def calibrate_threshold(current: int, valid_band: dict, risky_band: dict, *, target: float = 0.02,
                        lo: int = 55, hi: int = 85, step: int = 5, min_sent: int = 50) -> int:
    """Move the 'valid' line from what actually bounced: if addresses we
    called valid bounce above target, be stricter; if the risky band turns out
    clean (under half the target), be looser. One step at a time, bounded."""
    vn, vb = int(valid_band.get("sent", 0)), int(valid_band.get("bounced", 0))
    rn, rb = int(risky_band.get("sent", 0)), int(risky_band.get("bounced", 0))
    if vn >= min_sent and vb / vn > target:
        current += step
    elif rn >= min_sent and rb / rn < target / 2:
        current -= step
    return max(lo, min(hi, current))


_KEYBOARD_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890")
_NUMBER_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


def looks_made_up(local: str) -> Optional[str]:
    """Free 'is this a made-up address?' check on the part before the @.
    Returns the reason, or None. Lowers the score; never decides on its own
    (some real people do use rahul1234@…)."""
    loc = (local or "").lower().split("+")[0]
    letters = re.sub(r"[^a-z]", "", loc)
    if re.search(r"(.)\1{4,}", loc):
        return "one character repeated"
    for row in _KEYBOARD_ROWS:
        for i in range(len(row) - 4):
            w = row[i:i + 5]
            if w in loc or w[::-1] in loc:
                return "keyboard run"
    for i in range(len(loc) - 3):
        seg = loc[i:i + 4]
        if seg.isdigit():
            d = [int(c) for c in seg]
            if all(d[k + 1] - d[k] == 1 for k in range(3)) or all(d[k] - d[k + 1] == 1 for k in range(3)) or len(set(seg)) == 1:
                return "number run"
    if sum(1 for w in _NUMBER_WORDS if w in letters) >= 3:
        return "spelled-out numbers"
    if len(letters) >= 8 and sum(c in "aeiou" for c in letters) / len(letters) < 0.15:
        return "no vowels — random letters"
    return None


def svix_verify(secret: str, msg_id: str, timestamp: str, body: bytes, signature_header: str, *,
                now: Optional[float] = None, tolerance: int = 300) -> bool:
    """Svix / Standard Webhooks signature check (Resend signs webhooks this
    way): HMAC-SHA256 over "id.timestamp.body" with the base64 secret after
    'whsec_', compared in constant time against any 'v1,<sig>' in the header,
    and the timestamp must be within `tolerance` seconds (replay guard)."""
    import time as _t
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs((now if now is not None else _t.time()) - ts) > tolerance:
        return False
    try:
        key = base64.b64decode((secret or "").split("_", 1)[-1])
    except (ValueError, TypeError):
        return False
    if not key or not msg_id:
        return False
    signed = f"{msg_id}.{timestamp}.".encode() + (body or b"")
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    for part in (signature_header or "").split():
        ver, _, sig = part.partition(",")
        if ver == "v1" and hmac.compare_digest(sig, expected):
            return True
    return False


def parse_domain_list(text: str) -> set:
    """One domain per line, '#' comments, blanks ignored, lowercased."""
    out = set()
    for line in (text or "").splitlines():
        d = line.split("#", 1)[0].strip().lower()
        if d and "." in d and " " not in d:
            out.add(d)
    return out


def sunset_state(sent_since_engaged: int, *, inactive_after: int = 6, sunset_after: int = 12) -> str:
    """'active' | 'inactive' (warn) | 'sunset' (stop mailing). Counted in
    campaign emails sent since the last open or click; 0 = rule off."""
    n = int(sent_since_engaged or 0)
    if sunset_after and n >= sunset_after:
        return "sunset"
    if inactive_after and n >= inactive_after:
        return "inactive"
    return "active"


def is_bad_domain(domain: str, hard_bounced: int, threshold: int = 3) -> bool:
    """A company domain where several different addresses hard-bounced is
    probably dead or rejecting us; new addresses there become risky."""
    return (domain or "").lower() not in WEBMAIL and hard_bounced >= threshold


def checks_for_budget(budget_inr: float, usd_inr: float, usd_per_check: float = 0.01) -> int:
    """₹ monthly budget -> how many SES checks it buys."""
    try:
        if usd_inr <= 0 or budget_inr <= 0:
            return 0
        return int(float(budget_inr) / (usd_per_check * float(usd_inr)))
    except (TypeError, ValueError):
        return 0


def tail_should_stop(sent: int, bounced: int, *, max_rate: float = 0.03, min_sent: int = 20) -> bool:
    """The catch-all tail stops itself (without pausing the campaign) once
    enough of it has gone out to judge and its bounces pass the limit."""
    return sent >= min_sent and bounced / max(sent, 1) > max_rate


def should_pause(sent: int, bounced: int, complained: int, *, min_sent: int = 50,
                 max_bounce: float = 0.02, max_complaint: float = 0.001) -> Optional[str]:
    """Stop a campaign before it can hurt the sender reputation. Amazon starts
    reviewing an account around 5% bounces / 0.1% complaints; we stop at 2%
    bounces (or any complaint rate above 0.1%) once there is enough signal."""
    if sent < min_sent:
        return None
    if bounced / sent > max_bounce:
        return f"bounce rate {bounced / sent:.1%} is above {max_bounce:.0%}"
    if complained / sent > max_complaint:
        return f"spam-complaint rate {complained / sent:.2%} is above {max_complaint:.1%}"
    return None


# --------------------------------------------------------------- tokens ---
def sign(secret: str, *parts: str) -> str:
    msg = "|".join(parts).encode()
    return base64.urlsafe_b64encode(hmac.new(secret.encode(), msg, hashlib.sha256).digest()[:18]).decode().rstrip("=")


def check_sig(secret: str, sig: str, *parts: str) -> bool:
    return hmac.compare_digest(sign(secret, *parts), sig or "")


# ------------------------------------------------------------ rendering ---
def _esc(s) -> str:
    return html.escape(str(s or ""), quote=True)


def inline_md(s: str) -> str:
    """**bold**, *italic* and [text](https://link) in text blocks; everything
    else is escaped. Links are http(s)/mailto only."""
    t = _esc(s)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*(?!\*)", r"<em>\1</em>", t)

    def link(m):
        url = html.unescape(m.group(2))
        if not re.match(r"^(https?://|mailto:)", url, re.I):
            return m.group(1)
        return f'<a href="{_esc(url)}" style="color:#002B5C;text-decoration:underline">{m.group(1)}</a>'

    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, t)
    return t.replace("\n", "<br>")


# Merge variables for campaigns and templates. Shown to the admin (Templates
# tab, campaign editor) from this one list, so the help text can never offer a
# variable the renderer does not fill.
#   key: what goes between {{ }}; default: used when the contact has no value.
# A fallback can be given per use: {{first_name|Reader}}.
VARIABLES = [
    {"key": "first_name", "label": "First name", "default": "there", "example": "Asha"},
    {"key": "last_name", "label": "Last name", "default": "", "example": "Verma"},
    {"key": "name", "label": "Full name", "default": "there", "example": "Asha Verma"},
    {"key": "email", "label": "Email address", "default": "", "example": "asha@example.com"},
    {"key": "month", "label": "Current month", "default": "", "example": "October"},
    {"key": "year", "label": "Current year", "default": "", "example": "2026"},
]
_VAR_RE = re.compile(r"\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}", re.I)
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"]


def variable_values(contact: dict, now=None) -> dict:
    """{key: value} for one recipient; "" when unknown (the default applies)."""
    from datetime import datetime, timedelta, timezone
    now = now or (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30))   # India time
    name = re.sub(r"\s+", " ", (contact.get("name") or "")).strip()
    parts = name.split(" ") if name else []
    return {"first_name": parts[0] if parts else "", "last_name": " ".join(parts[1:]) if len(parts) > 1 else "",
            "name": name, "email": (contact.get("email") or "").strip(),
            "month": _MONTHS[now.month - 1], "year": str(now.year)}


def personalise(text: str, contact: dict, now=None) -> str:
    """Fill {{variables}}. {{first_name|Reader}} uses "Reader" when there is no
    first name; otherwise the variable's own default. An unknown {{thing}} is
    removed rather than mailed to thousands of people as raw braces."""
    if not text or "{{" not in text:
        return text or ""
    vals = variable_values(contact, now)
    defaults = {v["key"]: v["default"] for v in VARIABLES}

    def sub(m):
        key, fallback = m.group(1).lower(), m.group(2)
        if key not in vals:
            return fallback or ""
        return vals[key] or (fallback if fallback is not None else defaults.get(key, ""))

    return _VAR_RE.sub(sub, text)


def unknown_variables(*texts: str) -> list:
    """{{names}} used that the renderer does not know — shown as a warning."""
    known = {v["key"] for v in VARIABLES}
    out = []
    for t in texts:
        for m in _VAR_RE.finditer(t or ""):
            k = m.group(1).lower()
            if k not in known and k not in out:
                out.append(k)
    return out


# Starter templates: read-only, always available. "Use" makes a campaign from
# one; "Duplicate" makes an editable copy in the team's own templates. Links
# point at real site pages; book blocks are left for the admin to pick.
STARTER_TEMPLATES = [
    {"key": "for-you", "name": "Latest releases — picked for each reader",
     "description": "Each person gets the new releases closest to what they bought, carted or asked about.",
     "subject": "{{first_name|Reader}}, new books we think you'll like", "preheader": "Fresh from our press — chosen for you",
     "blocks": [{"type": "heading", "text": "New for you, {{first_name|reader}}"},
                {"type": "text", "text": "We've just published a few titles we think fit what you read. Here they are:"},
                {"type": "for_you", "text": "Picked for you", "count": 3},
                {"type": "button", "label": "See all new releases", "url": "https://www.oakbridge.in/books?new_release=true"}]},
    {"key": "new-release", "name": "New release", "description": "Announce one new book.",
     "subject": "New from Oakbridge: [book title]", "preheader": "Out now — {{first_name|you}} heard it here first",
     "blocks": [{"type": "heading", "text": "Just published"},
                {"type": "text", "text": "Hi {{first_name}}, our newest title is out today. Here is why we think you'll want it:"},
                {"type": "book"},
                {"type": "text", "text": "**Who it's for:** …\n**What's inside:** …"},
                {"type": "button", "label": "Get your copy", "url": "https://www.oakbridge.in/books"}]},
    {"key": "monthly-roundup", "name": "Monthly round-up", "description": "Several books and news for the month.",
     "subject": "Oakbridge in {{month}}: new books and what's coming", "preheader": "Our {{month}} {{year}} picks",
     "blocks": [{"type": "heading", "text": "{{month}} at Oakbridge"},
                {"type": "text", "text": "Hi {{first_name}}, here's what we published this month and what's coming next."},
                {"type": "book"}, {"type": "book"}, {"type": "book"},
                {"type": "divider"},
                {"type": "text", "text": "**Coming soon:** …"},
                {"type": "button", "label": "See all new books", "url": "https://www.oakbridge.in/books"}]},
    {"key": "event-invite", "name": "Event invitation", "description": "Invite readers to a launch, talk or summit.",
     "subject": "You're invited: [event name]", "preheader": "[date] · [city / online]",
     "blocks": [{"type": "heading", "text": "You're invited, {{first_name}}"},
                {"type": "text", "text": "**What:** …\n**When:** …\n**Where:** …"},
                {"type": "image"},
                {"type": "button", "label": "Reserve your place", "url": "https://www.oakbridge.in/events"}]},
    {"key": "offer", "name": "Offer / discount", "description": "A time-limited price or coupon.",
     "subject": "{{first_name|Readers}}, [offer] until [date]", "preheader": "Use code [CODE] at checkout",
     "blocks": [{"type": "heading", "text": "[Offer headline]"},
                {"type": "text", "text": "Hi {{first_name}}, until **[date]** use code **[CODE]** at checkout. [Terms in one line.]"},
                {"type": "book"},
                {"type": "button", "label": "Shop the offer", "url": "https://www.oakbridge.in/books"}]},
    {"key": "author-spotlight", "name": "Author spotlight", "description": "Introduce an author and their books.",
     "subject": "Meet [author name]", "preheader": "The person behind [book title]",
     "blocks": [{"type": "heading", "text": "Meet [author name]"},
                {"type": "image"},
                {"type": "text", "text": "Hi {{first_name}}, [two or three lines about the author and why their work matters]."},
                {"type": "book"},
                {"type": "button", "label": "All books by [author]", "url": "https://www.oakbridge.in/authors"}]},
    {"key": "welcome", "name": "Welcome", "description": "First email to a new subscriber.",
     "subject": "Welcome to Oakbridge, {{first_name|there}}", "preheader": "What to expect from us",
     "blocks": [{"type": "heading", "text": "Welcome, {{first_name}}"},
                {"type": "text", "text": "Thanks for joining. We'll write when there's a new book, an event or an offer worth your time — no more than a few times a month."},
                {"type": "button", "label": "Browse the bookstore", "url": "https://www.oakbridge.in/books"}]},
]


# ------------------------------------------------- "Picked for you" ---
def pick_for_you(profile: dict, pool: list, n: int = 3) -> list:
    """Latest releases chosen for ONE reader from what they bought and showed
    interest in. Pure, so it is tested directly.

    profile: {"bought": set(book ids), "interest": set(book ids from cart /
              notify-me), "authors": {name: weight}, "subjects": {...},
              "categories": {...}}  — weights = how often it appeared.
    pool:    latest releases, NEWEST FIRST (each {id, author, subject, category, …}).

    Never a book they already bought. Scored: a book they put in a cart or
    asked to be told about (+6), same author (+3 x weight), same subject (+2 x),
    same category (+1 x); ties keep newest first. Fewer than `n` matches are
    topped up with the newest releases, so everyone gets a full email."""
    bought = set(profile.get("bought") or ())
    interest = set(profile.get("interest") or ())
    A, S, C = profile.get("authors") or {}, profile.get("subjects") or {}, profile.get("categories") or {}
    scored = []
    for i, b in enumerate(pool or []):
        if not b or b.get("id") in bought:
            continue
        sc = (6 if b.get("id") in interest else 0) + 3 * A.get((b.get("author") or "").strip().lower(), 0) \
            + 2 * S.get((b.get("subject") or "").strip().lower(), 0) + C.get((b.get("category") or "").strip().lower(), 0)
        scored.append((-sc, i, b))
    scored.sort(key=lambda t: (t[0], t[1]))
    matched = [b for sc, _, b in scored if sc < 0][:n]
    if len(matched) < n:
        seen = {b.get("id") for b in matched}
        matched += [b for _, _, b in sorted(scored, key=lambda t: t[1]) if b.get("id") not in seen][:n - len(matched)]
    return matched


def collect_links(blocks: list) -> list:
    """Every link a campaign contains, in order. Click tracking redirects by
    INDEX into this list, so a tracking URL can only ever lead to a link the
    campaign itself contained — never an open redirect."""
    out = []
    for b in blocks or []:
        if b.get("type") in ("button", "image", "book") and b.get("url"):
            out.append(b["url"])
        if b.get("type") == "text":
            out += [html.unescape(u) for u in re.findall(r"\]\((https?://[^)\s]+)\)", b.get("text") or "")]
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def render_email(blocks: list, *, brand: dict, contact: dict, link_for, open_pixel: str = "",
                 unsubscribe_url: str = "", preheader: str = "") -> tuple[str, str]:
    """(html, text) for one recipient. Table layout and inline styles — what
    every mail client (Outlook included) renders the same way.

    link_for(url) -> the tracked URL for that link."""
    navy, red = brand.get("navy", "#002B5C"), brand.get("red", "#CC0033")
    rows, text = [], []

    def L(u):
        return _esc(link_for(u)) if u else ""

    for b in blocks or []:
        t = b.get("type")
        if t == "heading":
            s = personalise(b.get("text"), contact)
            rows.append(f'<tr><td style="padding:24px 32px 4px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.25;font-weight:700;color:{navy}">{_esc(s)}</td></tr>')
            text.append(s.upper())
        elif t == "text":
            s = personalise(b.get("text"), contact)
            body = inline_md(s)
            # Every [text](url) becomes a tracked link (same URL collect_links saw).
            body = re.sub(r'href="([^"]+)"', lambda m: f'href="{L(html.unescape(m.group(1)))}"', body)
            rows.append(f'<tr><td style="padding:10px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1F2937">{body}</td></tr>')
            text.append(re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", s))
        elif t == "image" and b.get("src"):
            img = f'<img src="{_esc(b["src"])}" alt="{_esc(b.get("alt"))}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0">'
            if b.get("url"):
                img = f'<a href="{L(b["url"])}">{img}</a>'
            rows.append(f'<tr><td style="padding:12px 32px">{img}</td></tr>')
        elif t == "button" and b.get("url"):
            label = personalise(b.get("label") or "Find out more", contact)
            rows.append(f'<tr><td align="center" style="padding:18px 32px"><a href="{L(b["url"])}" style="display:inline-block;background:{red};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px">{_esc(label)}</a></td></tr>')
            text.append(f"{label}: {b['url']}")
        elif t == "book" and b.get("url"):
            cover = f'<img src="{_esc(b.get("cover"))}" alt="" width="120" style="display:block;width:120px;height:auto;border:0">' if b.get("cover") else ""
            price = f'<div style="font-size:16px;font-weight:700;color:{red};padding-top:6px">{_esc(b.get("price"))}</div>' if b.get("price") else ""
            rows.append(
                f'<tr><td style="padding:14px 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
                f'<td width="130" valign="top"><a href="{L(b["url"])}">{cover}</a></td>'
                f'<td valign="top" style="font-family:Arial,Helvetica,sans-serif;padding-left:16px">'
                f'<div style="font-size:18px;font-weight:700;color:{navy};line-height:1.3">{_esc(b.get("title"))}</div>'
                f'<div style="font-size:14px;color:#4B5563;padding-top:4px">{_esc(b.get("author"))}</div>{price}'
                f'<div style="padding-top:12px"><a href="{L(b["url"])}" style="color:{navy};font-weight:700;font-size:14px">View the book &rarr;</a></div>'
                f'</td></tr></table></td></tr>')
            text.append(f"{b.get('title')} — {b.get('author') or ''} {b.get('price') or ''}: {b['url']}")
        elif t == "for_you":
            # One reader's own picks (pick_for_you), attached to the contact
            # as `_picks` by the sender; their links are stored on the send so
            # click tracking still only ever redirects to known URLs.
            picks = contact.get("_picks") or []
            if picks and b.get("text"):
                s = personalise(b.get("text"), contact)
                rows.append(f'<tr><td style="padding:18px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{red}">{_esc(s)}</td></tr>')
                text.append(s.upper())
            for p in picks:
                cover = f'<img src="{_esc(p.get("cover"))}" alt="" width="110" style="display:block;width:110px;height:auto;border:0">' if p.get("cover") else ""
                price = f'<div style="font-size:16px;font-weight:700;color:{red};padding-top:6px">{_esc(p.get("price"))}</div>' if p.get("price") else ""
                why = f'<div style="font-size:12px;color:#6B7280;padding-top:4px">{_esc(p.get("why"))}</div>' if p.get("why") else ""
                rows.append(
                    f'<tr><td style="padding:14px 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
                    f'<td width="120" valign="top"><a href="{L(p["url"])}">{cover}</a></td>'
                    f'<td valign="top" style="font-family:Arial,Helvetica,sans-serif;padding-left:16px">'
                    f'<div style="font-size:17px;font-weight:700;color:{navy};line-height:1.3">{_esc(p.get("title"))}</div>'
                    f'<div style="font-size:14px;color:#4B5563;padding-top:4px">{_esc(p.get("author"))}</div>{price}{why}'
                    f'<div style="padding-top:10px"><a href="{L(p["url"])}" style="color:{navy};font-weight:700;font-size:14px">View the book &rarr;</a></div>'
                    f'</td></tr></table></td></tr>')
                text.append(f"{p.get('title')} — {p.get('author') or ''} {p.get('price') or ''}: {p['url']}")
        elif t == "divider":
            rows.append('<tr><td style="padding:12px 32px"><div style="border-top:1px solid #E5E7EB;height:1px;line-height:1px">&nbsp;</div></td></tr>')
            text.append("-" * 20)
        elif t == "spacer":
            rows.append('<tr><td style="height:20px;line-height:20px">&nbsp;</td></tr>')

    logo = brand.get("logo")
    head = (f'<img src="{_esc(logo)}" alt="{_esc(brand.get("name", "Oakbridge"))}" width="120" style="display:block;height:auto;border:0">'
            if logo else f'<span style="font-family:Arial;font-size:20px;font-weight:700;color:#fff">{_esc(brand.get("name", "Oakbridge"))}</span>')
    footer_txt = _esc(brand.get("footer") or "")
    unsub = f'<a href="{_esc(unsubscribe_url)}" style="color:#4B5563">Unsubscribe</a>' if unsubscribe_url else ""
    pixel = f'<img src="{_esc(open_pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">' if open_pixel else ""
    pre = f'<div style="display:none;max-height:0;overflow:hidden;opacity:0">{_esc(preheader)}</div>' if preheader else ""
    html_doc = (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"></head>'
        f'<body style="margin:0;padding:0;background:#F5F7FA">{pre}'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F7FA"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff">'
        f'<tr><td style="background:{navy};padding:18px 32px">{head}</td></tr>'
        + "".join(rows) +
        f'<tr><td style="padding:24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6B7280;border-top:1px solid #E5E7EB">'
        f'{footer_txt}<br>{unsub}</td></tr>'
        f'</table>{pixel}</td></tr></table></body></html>'
    )
    text_doc = "\n\n".join(x for x in text if x) + (f"\n\n--\n{brand.get('footer') or ''}\nUnsubscribe: {unsubscribe_url}" if unsubscribe_url else "")
    return html_doc, text_doc


# ------------------------------------------------------------ analytics ---
def rate(part: int, whole: int) -> Optional[float]:
    return round(part / whole, 4) if whole else None


def funnel(stats: dict) -> list:
    """Sent → Delivered → Opened → Clicked → Ordered → Paid, each with its
    count and the conversion from the step before."""
    steps = [("Sent", stats.get("sent", 0)), ("Delivered", stats.get("delivered", 0)), ("Opened", stats.get("opened", 0)),
             ("Clicked", stats.get("clicked", 0)), ("Ordered", stats.get("orders", 0)), ("Paid", stats.get("paid", 0))]
    out, prev = [], None
    for name, n in steps:
        out.append({"step": name, "count": n, "from_prev": rate(n, prev) if prev is not None else None})
        prev = n
    return out


def campaign_tag(campaign_id: str) -> str:
    """utm_campaign value that ties an order back to a campaign."""
    return f"mk-{campaign_id[:8]}"


def add_utm(url: str, campaign_id: str, channel: str = "email") -> str:
    """Add utm tags to our own site's links only (oakbridge.in)."""
    if not re.match(r"^https?://(www\.)?oakbridge\.in(/|$|\?)", url or "", re.I):
        return url
    if "utm_campaign=" in url:
        return url
    sep = "&" if "?" in url else "?"
    frag = ""
    if "#" in url:
        url, frag = url.split("#", 1)
        frag = "#" + frag
    return f"{url}{sep}utm_source={channel}&utm_medium=campaign&utm_campaign={campaign_tag(campaign_id)}{frag}"


def unique_emails(rows: Iterable[str]) -> list:
    seen, out = set(), []
    for r in rows:
        k = normalise_email(r)
        if k and k not in seen:
            seen.add(k)
            out.append(r)
    return out


# ------------------------------------------------------------- exports ---
def safe_cell(v):
    """A value for a CSV/Excel cell that a spreadsheet will not run.

    Anything starting with = + - @ (or a tab / carriage return) is a formula
    to Excel and Google Sheets — and contact names, sources and bounce
    messages come from outside ("=HYPERLINK(...)" typed into a sign-up form).
    Such text gets a leading apostrophe, which spreadsheets show as plain text.
    """
    if v is None:
        return ""
    if isinstance(v, bool):
        return "yes" if v else ""
    if isinstance(v, (int, float)):
        return v
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def send_outcome(s: dict) -> str:
    """One word per recipient for the report: the furthest it got."""
    st = s.get("status") or ""
    if st in ("bounced", "complained", "blocked", "skipped", "failed", "queued"):
        return st
    if s.get("unsubscribed_at"):
        return "unsubscribed"
    if s.get("clicked_at"):
        return "clicked"
    if s.get("opened_at"):
        return "opened"
    if s.get("delivered_at"):
        return "delivered"
    return st or "unknown"


# Clean-up kinds -> how a contact qualifies. Bounced / blocked / invalid are
# removed by default; complaints and unsubscribes only when chosen (they are
# the person's own "no", and the hash kept afterwards still honours it).
CLEANUP_KINDS = {
    "bounced": "bounced (hard bounce, or 3 soft bounces)",
    "blocked": "blocked by AWS (address unlikely to exist)",
    "invalid": "invalid address (failed our checks)",
    "complained": "marked our email as spam",
    "unsubscribed": "unsubscribed",
}


def cleanup_kind(c: dict) -> str:
    """Which clean-up kind this contact falls under, or "" if none."""
    sup = (c.get("suppressed") or "").lower()
    if sup.startswith("bounced"):
        return "bounced"
    if "ses validation" in sup or sup.startswith("invalid"):
        return "blocked"
    if sup.startswith("complained") or (c.get("email_consent") or {}).get("status") == "complained":
        return "complained"
    if (c.get("email_consent") or {}).get("status") == "unsubscribed" or sup.startswith("unsubscribed"):
        return "unsubscribed"
    if c.get("email_status") == "invalid":
        return "invalid"
    return ""

