"""When a pre-order's `launch_at` actually is — one reading for every caller.

THE BUG THIS FIXES (Oct 2026)

Admin → Books → "Publication day" is an <input type="datetime-local">. It
saves what the admin typed with NO timezone: "2026-10-28T17:04", meaning
17:04 in India. Three places then read it three ways:

  * the storefront (lib/preorder.js) — `new Date("2026-10-28T17:04")` is the
    VISITOR's local time: 17:04 IST in India, something else abroad;
  * the server (_preorder_active, used at checkout) — treated it as UTC, i.e.
    22:34 IST;
  * the Google Merchant feed — also UTC.

So for 5½ hours on launch day the page showed an ordinary book while checkout
still treated it as a pre-order: stock locked at 0, yet up to 10 copies
accepted per order. Hot Off the Press kept it in the pre-order group as long.

THE RULE

  * An explicit offset ("Z", "+05:30") is honoured as written.
  * A date AND time with no offset is India time (+05:30) — it was typed by an
    admin in India into a field that cannot carry one.
  * A bare date ("2026-10-28") stays UTC midnight (05:30 IST), unchanged: that
    is how every browser reads a date-only string, so nothing already on the
    site moves.

frontend/src/lib/preorder.js `launchDate` applies the same rule; the tests on
both sides pin the same three cases.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def parse_launch_at(raw) -> Optional[datetime]:
    """An aware datetime, or None for empty / unreadable values."""
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is not None:
        return d
    # fromisoformat also takes a bare date (midnight, naive). Only a value
    # that carried a time of day was typed in Indian time.
    return d.replace(tzinfo=IST if len(s) > 10 else timezone.utc)
