"""
System audit trail — who did what, and when.

WHY THIS IS A SEPARATE COLLECTION AND NOT A LOG FILE. Render's logs roll and
disappear; an audit trail whose retention you do not control is not an audit
trail. This is a normal Mongo collection so it survives restarts, can be
filtered by period, and can be purged deliberately rather than by accident.

WHAT IT DELIBERATELY IS NOT. It never records a password, a token, an OTP or a
card detail — see `_SENSITIVE` below, which strips them even if a caller passes
one by mistake. A log that captures secrets is a second copy of the thing you
were protecting.

WRITES MUST NEVER BREAK THE THING THEY DESCRIBE. Every call is wrapped: if the
insert fails, the login still succeeds and the failure goes to the process log.
An audit line is worth less than the action it records.

Note the trail is APPEND-ONLY by convention, not by database permission: the
same credentials that write it could rewrite it. Real tamper-evidence would need
a separate store or signed rows, which is a bigger question than this screen.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

AUDIT_EVENTS = "audit_events"

# Keys that must never reach the collection, whatever a caller passes. Matched
# as substrings so "new_password" and "reset_token" are caught too.
_SENSITIVE = ("password", "token", "secret", "otp", "card", "cvv", "authorization")

# The vocabulary. Kept as constants so a typo is an ImportError rather than a
# row that silently never matches a filter.
LOGIN = "LOGIN"
LOGIN_FAILED = "LOGIN_FAILED"
LOGOUT = "LOGOUT"
REGISTER = "REGISTER"
USER_DELETED = "USER_DELETED"
SUBMISSION_DELETED = "SUBMISSION_DELETED"
SPAM_PURGED = "SPAM_PURGED"


def _clean_meta(meta: Optional[dict]) -> dict:
    """Drop anything that looks like a credential, and keep the row small.

    Values are truncated rather than dropped: 400 characters is plenty to
    identify a record, and it stops one pathological payload turning a log row
    into a document that costs real money to store forever.
    """
    if not isinstance(meta, dict):
        return {}
    out: dict = {}
    for k, v in meta.items():
        key = str(k)
        if any(s in key.lower() for s in _SENSITIVE):
            continue
        if isinstance(v, (dict, list)):
            v = str(v)
        if isinstance(v, str) and len(v) > 400:
            v = v[:400] + "…"
        out[key] = v
    return out


async def audit_log(
    db,
    action: str,
    *,
    email: str = "",
    role: str = "",
    meta: Optional[dict] = None,
) -> None:
    """Append one line. Never raises.

    `db` is passed in rather than imported so this module has no import-time
    dependency on server.py, which imports the routers that call this.
    """
    try:
        await db[AUDIT_EVENTS].insert_one(
            {
                "id": str(uuid.uuid4()),
                "at": datetime.now(timezone.utc).isoformat(),
                "action": action,
                "email": (email or "").lower(),
                "role": role or "",
                "meta": _clean_meta(meta),
            }
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not write audit event %s", action)


def period_start(period: str) -> Optional[str]:
    """The ISO instant a named period begins, or None for 'all'.

    Computed in UTC to match how `at` is written. The dashboard's date ranges
    resolve in the admin's own timezone because they answer "how did we trade
    this month"; this answers "what happened recently", where an hour either way
    changes nothing and a timezone round-trip is one more thing to get wrong.
    """
    now = datetime.now(timezone.utc)
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        start = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        return None
    return start.isoformat()


def payment_event_to_row(doc: dict) -> dict:
    """Present a payment_events row in the same shape as an audit row.

    Payments have been logged since long before this screen existed, in their
    own collection with their own field names. Rather than migrate that history
    -- and risk mangling the one record of what was actually collected -- the
    two are read separately and merged at display time. The payment rows are the
    only reason this screen is not empty on the day it ships.
    """
    meta = {
        k: v
        for k, v in doc.items()
        if k not in ("_id", "id", "at", "event") and v not in (None, "")
    }
    return {
        "id": doc.get("id") or str(uuid.uuid4()),
        "at": doc.get("at") or "",
        "action": str(doc.get("event") or "PAYMENT").upper().replace(".", "_"),
        "email": (doc.get("email") or "").lower(),
        "role": "",
        "meta": _clean_meta(meta),
        "source": "payment",
    }
