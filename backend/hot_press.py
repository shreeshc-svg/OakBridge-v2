"""Order of the homepage "Hot Off the Press" row (and its "View all" page).

THE RULE (business requirement, Oct 2026)

    1. Live pre-orders first — the most recently ADDED pre-order on top.
    2. Then every other book — the most recently ADDED on top.

"Added" means when the book went into the catalogue, NOT its publication year
and NOT the release-order master. Before this, the row sorted on release_rank
alone: a ticked "New release" with no rank jumped to the front in no fixed
order (MongoDB sorts a missing field before every number), books on the same
rank swapped places between loads, and pre-orders were mixed in wherever their
rank put them.

WHERE "ADDED" COMES FROM

Books carry no created-at field. Every MongoDB `_id` is an ObjectId, and an
ObjectId embeds the second it was made, plus a counter that increases with
each insert — so it IS the add time, for every book ever created, with no
migration and no new field that some insert path could forget to stamp
(there are seven insert paths across server/extensions/features/hampers/packs).

BOOKS ADDED IN ONE GO

The original catalogue (and any spreadsheet import) went in as one burst, a few
hundred books inside a few seconds. "Which of those was added last" is an
accident of file order, not a fact anyone cares about, so a burst is kept in
the publisher's release order (release_rank, newest publication first) instead.
A burst is any run of books each added within BURST_GAP_S of the previous one.
Two books an admin adds a minute apart are therefore still separate, and the
later one wins.

PRE-ORDER means the same thing as everywhere else: the coming-soon flag AND a
launch date still in the future (server._preorder_active, mirroring the
storefront's preorderState). The morning a pre-order launches it simply joins
the normal books at its added position — nobody has to untick anything.
"""
from datetime import datetime, timezone
from typing import Callable, List, Optional

BURST_GAP_S = 60

# Books whose _id is not an ObjectId (none expected) have no add time; they
# sort as the oldest, then by release order, rather than raising.
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def added_at(doc: dict) -> Optional[datetime]:
    """When the book was inserted, from its ObjectId; None if unknowable."""
    t = getattr(doc.get("_id"), "generation_time", None)
    return t if isinstance(t, datetime) else None


def _rank(doc: dict) -> float:
    r = doc.get("release_rank")
    try:
        return float(r) if r is not None else 1e9
    except (TypeError, ValueError):
        return 1e9


def _burst_order(docs: List[dict]) -> List[dict]:
    """Newest-added first; books added in one burst keep release order."""
    timed = sorted(docs, key=lambda d: (added_at(d) or _EPOCH, str(d.get("_id") or "")))
    bursts: List[List[dict]] = []
    prev = None
    for d in timed:
        t = added_at(d) or _EPOCH
        if prev is None or (t - prev).total_seconds() > BURST_GAP_S:
            bursts.append([])
        bursts[-1].append(d)
        prev = t
    out: List[dict] = []
    for b in reversed(bursts):  # newest burst first
        # Within a burst: release order, then the later insert first (the
        # ObjectId hex sorts in insert order), so equal ranks never swap.
        b.sort(key=lambda d: str(d.get("_id") or ""), reverse=True)
        b.sort(key=_rank)
        out.extend(b)
    return out


def hot_order(docs: List[dict], is_preorder: Callable[[dict], bool]) -> List[dict]:
    """Live pre-orders (newest added first), then the rest (newest added first)."""
    pre = [d for d in docs if is_preorder(d)]
    rest = [d for d in docs if not is_preorder(d)]
    return _burst_order(pre) + _burst_order(rest)
