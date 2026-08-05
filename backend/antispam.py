"""
Bot screening for the public forms.

WHY THIS EXISTS

Every public endpoint — register, newsletter, contact, submissions, careers —
accepted anything posted to it. No captcha, no rate limit, no honeypot.
The result was dozens of accounts named like `QwcPGkLGeFwKGaJQumOvA`
and mailboxes spelled `so.ha.i.b.n.e.h.a.l@gmail.com`, which Gmail delivers to
`sohaibnehal@gmail.com` — one real inbox manufacturing unlimited addresses.

(An earlier version of this note claimed email verification did not exist. It
does: registration issues an OTP, /auth/verify-otp resolves it, and both the
checkout button and the order endpoint refuse an unverified account. What was
missing was everything above, not that.)

HOW IT ANSWERS

Four cheap signals, no third party, nothing a real visitor ever sees:

  honeypot   a field hidden from humans. Anything that fills it is a script.
  dwell      humans take seconds to fill a form; a bot posts immediately.
  rate       one address or one IP may only do a thing so often.
  identity   Gmail dots and +tags are stripped before uniqueness is judged.

Turnstile comes next and catches what these do not; this layer is what can ship
without you creating an account anywhere.

WHY A REJECTION LOOKS LIKE SUCCESS

screen() returns a verdict rather than raising, so a caller can store nothing,
email nobody, and still answer 200. A bot told precisely how it was caught is a
bot that gets fixed; one that believes it succeeded keeps posting into a void.
Rate limits are the exception — 429 is a truthful answer to a real client that
is simply going too fast, and a human who trips it deserves to know.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request

from extensions import db

logger = logging.getLogger(__name__)

# Anything faster than this was not typed by a person.
MIN_DWELL_SECONDS = 2.5
# A form left open for hours is a real person who wandered off, not a replay.
MAX_DWELL_SECONDS = 12 * 3600

ATTEMPTS = "form_attempts"
SPAM_LOG = "spam_log"

_DOT_DOMAINS = {"gmail.com", "googlemail.com"}


def client_ip(request: Optional[Request]) -> str:
    """Best-effort caller address. Render sits behind a proxy, so the socket
    address is the proxy's — the left-most X-Forwarded-For hop is the client."""
    if request is None:
        return ""
    fwd = request.headers.get("x-forwarded-for") or ""
    if fwd:
        return fwd.split(",")[0].strip()
    return getattr(getattr(request, "client", None), "host", "") or ""


def normalise_email(email: str) -> str:
    """Reduce an address to the mailbox that actually receives it.

    Gmail ignores dots in the local part and everything after a '+', so
    `te.x.as.f.l.or.i.d.a@gmail.com` and `texasflorida+3@googlemail.com` are one
    inbox. Uniqueness has to be judged on this, not on the string as typed,
    otherwise a single mailbox can hold as many accounts as it likes.

    The stored address is always the one the user gave — this is only for
    comparison, so mail still reaches them exactly as they wrote it.
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


def looks_machine_generated(name: str) -> bool:
    """Does this read like `QwcPGkLGeFwKGaJQumOvA` rather than a person's name?

    ADVISORY ONLY — never a reason to refuse a form. See screen().

    The first version tested the vowel ratio and was useless: these strings run
    about 24% vowels and so does "Krishnamurthy". What actually separates them
    is CASE. A written name changes case once ("Krishnamurthy") or not at all
    ("MOHAMMED", "srinivasan"); a random string flips every couple of letters.

    Case alone is not enough either: "DeAngeloRodriguez" flips five times and
    "nVNOWJUFXmfgBXVrupl" only four. What settles it is that a name is made of
    syllables and a random string is not — DeAngelo runs 47% vowels, the bot
    runs 16%. Both signals together separate every case cleanly.

    Guarded against false positives: one unbroken run of Latin letters, so
    anything with a space, hyphen, apostrophe or non-Latin script never reaches
    the test. A contrived concatenation like "McDonaldMacArthur" could still
    trip it, which is precisely why nothing is refused on this basis and a
    person reviews the flagged rows.
    """
    n = str(name or "").strip()
    if len(n) < 14 or not re.fullmatch(r"[A-Za-z]+", n):
        return False
    flips = sum(1 for a, b in zip(n, n[1:]) if a.isupper() != b.isupper())
    vowels = sum(n.lower().count(v) for v in "aeiou") / len(n)
    return flips >= 4 and vowels < 0.30


async def _too_many(key: str, kind: str, limit: int, window_seconds: int) -> bool:
    """Count recent attempts for one key, and record this one.

    Mongo rather than memory because Render restarts freely and an in-process
    counter would forget everything on each deploy — which is exactly when a
    flood is least welcome.
    """
    if not key:
        return False
    now = datetime.now(timezone.utc)
    since = (now - timedelta(seconds=window_seconds)).isoformat()
    try:
        recent = await db[ATTEMPTS].count_documents(
            {"key": key, "kind": kind, "at": {"$gte": since}}
        )
        await db[ATTEMPTS].insert_one(
            {"key": key, "kind": kind, "at": now.isoformat(), "expires_at": now + timedelta(days=2)}
        )
        return recent >= limit
    except Exception:  # noqa: BLE001
        # A screening failure must never take a real form down with it.
        logger.exception("Rate check failed for %s/%s", kind, key)
        return False


async def screen(
    request: Optional[Request],
    *,
    kind: str,
    email: str = "",
    name: str = "",
    honeypot: str = "",
    form_ms: Optional[int] = None,
    require_shield: bool = True,
    ip_limit: int = 5,
    email_limit: int = 3,
    window_seconds: int = 3600,
) -> Optional[str]:
    """Return None if this looks human, else a short reason.

    The caller decides what to do. For anything that would be stored or emailed,
    the right response is to drop it and answer 200.
    """
    if honeypot and str(honeypot).strip():
        return "honeypot"

    # A MISSING SHIELD IS THE VERDICT.
    #
    # The first version treated an absent form_ms as "no timing information, skip
    # that check", which quietly made the whole layer optional: a script posting
    # straight at /api/newsletter sends no honeypot and no timer, so the honeypot
    # was empty (pass) and the timing was skipped (pass), leaving only rate
    # limits. Two junk signups walked through it within the hour.
    #
    # Our own forms always send this field. Its absence does not mean "unknown",
    # it means the request did not come from our form.
    if form_ms is None:
        if require_shield:
            return "no_shield"
    else:
        try:
            d = float(form_ms) / 1000.0
        except (TypeError, ValueError):
            return "no_shield"
        if d < MIN_DWELL_SECONDS:
            return "too_fast"
        if d > MAX_DWELL_SECONDS:
            return "stale_form"

    # NOTE: looks_machine_generated is deliberately NOT consulted here.
    #
    # It is a guess about a person's name, and the cost of being wrong is
    # turning away a real customer called something the rule has never seen.
    # Honeypot, dwell and rate are facts about the request, not opinions about
    # the human — they can be acted on. The name heuristic earns its keep in the
    # admin spam view, where somebody looks before anything is deleted.
    ip = client_ip(request)
    if ip and await _too_many(f"ip:{ip}", kind, ip_limit, window_seconds):
        return "rate_ip"

    norm = normalise_email(email)
    if norm and await _too_many(f"em:{norm}", kind, email_limit, window_seconds):
        return "rate_email"

    return None


async def record_rejection(kind: str, reason: str, request: Optional[Request], payload: dict) -> None:
    """Keep what was refused, so a false positive is recoverable.

    Silently dropping a genuine enquiry would be worse than the spam. This is
    the only copy of it, and the admin spam view reads from here.
    """
    try:
        await db[SPAM_LOG].insert_one(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "kind": kind,
                "reason": reason,
                "ip": client_ip(request),
                "user_agent": (request.headers.get("user-agent") if request else "") or "",
                "payload": payload,
            }
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not record rejected %s submission", kind)


async def ensure_indexes() -> None:
    """TTL on the attempt counters so the collection cannot grow without bound."""
    try:
        await db[ATTEMPTS].create_index("expires_at", expireAfterSeconds=0)
        await db[ATTEMPTS].create_index([("key", 1), ("kind", 1), ("at", -1)])
    except Exception:  # noqa: BLE001
        logger.exception("Could not create antispam indexes")
