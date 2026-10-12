"""
Memory-flat database helpers.

batches(): walk a big result in fixed-size pages keyed on a unique field,
instead of `.to_list(200000)`. Memory stays the size of one page whatever the
list size (the old code could hold 200k contacts at once on a 512 MB box).
Paging by `id > last` rather than skip/limit or a long-lived cursor means
rows updated while we walk (a contact's status changing mid-campaign) are
neither skipped nor seen twice.

bulk_set(): many `{"id": x} -> $set` updates in one round trip instead of one
each — a 100-address check was 100 database calls, now it is one.
"""
from __future__ import annotations

from typing import AsyncIterator, Callable, Iterable, Optional


async def batches(coll, flt: dict, proj: Optional[dict] = None, *, size: int = 500, key: str = "id") -> AsyncIterator[list]:
    last = None
    proj = dict(proj or {})
    if proj and any(v for v in proj.values()):
        proj[key] = 1
    while True:
        q = flt if last is None else {"$and": [flt, {key: {"$gt": last}}]}
        rows = await coll.find(q, proj or None).sort(key, 1).limit(size).to_list(size)
        if not rows:
            return
        yield rows
        if len(rows) < size:
            return
        last = rows[-1][key]


def _update_one(q: dict, u: dict):
    from pymongo import UpdateOne
    return UpdateOne(q, u)


async def bulk_set(coll, pairs: Iterable[tuple], *, make_op: Callable = _update_one, key: str = "id") -> int:
    """pairs: (id, {field: value, ...}). Returns how many were modified."""
    ops = [make_op({key: i}, {"$set": upd}) for i, upd in pairs if upd]
    if not ops:
        return 0
    r = await coll.bulk_write(ops, ordered=False)
    return int(getattr(r, "modified_count", 0) or 0)
