"""Search that learns — data, job and endpoints (rules: search_learning_core.py).

    nightly job "search_learn"          AI proposals for searches that found nothing
    GET  /api/admin/search-learning      proposals, live fixes (hits / clicks), titles people ask for
    POST /api/admin/search-learning/run  run it now (super admin)
    POST /api/admin/search-learning/{id}/approve | reject | disable
    POST /api/search/rewrite-click       anonymous: a visitor clicked a book after a fix
    lookup(search)                       used by server.list_books when a search finds nothing

Anonymous like search_logs: no user, session or IP is stored anywhere here.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import search_learning_core as core
from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger("oakbridge.search_learning")
admin_router = APIRouter(prefix="/api/admin/search-learning", tags=["admin"], dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/search", tags=["search"])

LIVE = ("approved", "auto")
BATCH = 40
LLM_WAIT = 150
_cache: dict = {"at": 0.0, "rows": {}}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------- storefront ---
async def _live_rewrites() -> dict:
    """Approved / auto fixes keyed by normalised search, cached for a minute
    (approving one shows on the site within 60 s; the page cache is bumped
    by the admin write anyway)."""
    if time.monotonic() - _cache["at"] < 60:
        return _cache["rows"]
    rows = {r["key"]: r async for r in db.search_rewrites.find({"status": {"$in": list(LIVE)}},
                                                               {"_id": 0, "id": 1, "key": 1, "kind": 1, "book_ids": 1})
            if r.get("book_ids")}
    _cache.update(at=time.monotonic(), rows=rows)
    return rows


async def lookup(search: str) -> Optional[dict]:
    r = (await _live_rewrites()).get(core.norm(search))
    if not r:
        return None
    return {**r, "note": core.note_for(r["kind"], search, len(r["book_ids"]))}


async def count_hit(rid: str) -> None:
    try:
        await db.search_rewrites.update_one({"id": rid}, {"$inc": {"hits": 1}, "$set": {"last_hit": _now().isoformat()}})
    except Exception:  # noqa: BLE001
        pass


class ClickBody(BaseModel):
    rewrite_id: str
    book_id: str


@public_router.post("/rewrite-click")
async def rewrite_click(body: ClickBody):
    """A visitor clicked a book on a fixed search — the fix worked. Counted
    only for a book that fix actually showed, so it can't be inflated."""
    rid, bid = (body.rewrite_id or "")[:40], (body.book_id or "")[:80]
    await db.search_rewrites.update_one({"id": rid, "book_ids": bid}, {"$inc": {"clicks": 1}})
    return {"ok": True}


# -------------------------------------------------------------- the nightly job ---
async def _catalogue() -> list:
    return await db.books.find({"enabled": {"$ne": False}, "product_type": {"$ne": "hamper"}},
                               {"_id": 0, "id": 1, "title": 1, "author": 1, "subject": 1, "category": 1}).sort("title", 1).to_list(1000)


async def _dead_searches(days: int = 30) -> list:
    """Searches that found nothing on EVERY attempt in the window (not
    rescued by a spelling fix, never matched anywhere), most searched first,
    not yet proposed, not an ISBN (those are 'asked for by ISBN')."""
    from features import _CRAWLER_QUERIES, _is_isbn
    since = _now() - timedelta(days=days)
    # Grouped here rather than in an aggregation: a month of searches is a few
    # thousand small rows, and this reads the same in tests and in production.
    groups: dict = {}
    async for l in db.search_logs.find({"at": {"$gte": since}}, {"_id": 0, "q": 1, "q_lower": 1, "results": 1, "corrected_to": 1}):
        k = l.get("q_lower") or ""
        if not k or k in _CRAWLER_QUERIES:
            continue
        g = groups.setdefault(k, {"q": l.get("q") or k, "n": 0, "best": 0, "rescued": False})
        g["n"] += 1
        g["best"] = max(g["best"], int(l.get("results") or 0))
        g["rescued"] = g["rescued"] or bool(l.get("corrected_to"))
    rows = [{"q": g["q"], "key": core.norm(k), "n": g["n"]} for k, g in groups.items()
            if g["best"] == 0 and not g["rescued"] and not _is_isbn(k) and len(core.norm(k)) >= 3]
    rows.sort(key=lambda x: -x["n"])
    known = {d["key"] async for d in db.search_rewrites.find({"key": {"$in": [x["key"] for x in rows]}}, {"_id": 0, "key": 1})}
    seen, out = set(), []
    for x in rows:
        if x["key"] not in known and x["key"] not in seen:
            seen.add(x["key"])
            out.append(x)
    return out[:BATCH]


async def learn(by: str = "system") -> dict:
    """One pass: ask the AI about new dead-end searches, keep what validates."""
    import llm
    try:
        from ai_insights import _enabled as ai_on   # the site-wide "AI on/off" switch in Admin
        if not await ai_on():
            return {"asked": 0, "proposed": 0, "auto": 0, "error": "AI is switched off in Admin"}
    except Exception:  # noqa: BLE001
        pass
    dead = await _dead_searches()
    if not dead:
        return {"asked": 0, "proposed": 0, "auto": 0}
    books = await _catalogue()
    asked = {d["key"]: d["q"] for d in dead}
    counts = {d["key"]: d["n"] for d in dead}
    try:
        reply = await asyncio.wait_for(llm.generate(core.SYSTEM, core.prompt(list(asked.values()), core.catalogue_lines(books)), 0.1), LLM_WAIT)
    except Exception as e:  # noqa: BLE001 — AI down / slow: nothing changes, try tomorrow
        log.warning("search learning: AI unavailable (%s)", e)
        return {"asked": len(asked), "proposed": 0, "auto": 0, "error": "AI unavailable — nothing changed"}
    title_of = {b["id"]: b.get("title", "") for b in books}
    proposed = auto = 0
    for item in core.parse(reply):
        p = core.validate(item, asked, books)
        if not p:
            continue
        status = "auto" if core.auto_ok(p, title_of) else "suggested"
        doc = {"id": str(uuid.uuid4()), **p, "searches": counts.get(p["key"], 0), "status": status, "source": "ai",
               "hits": 0, "clicks": 0, "created_at": _now().isoformat(), "created_by": by}
        try:
            await db.search_rewrites.insert_one(dict(doc))
        except Exception:  # noqa: BLE001 — unique key: proposed meanwhile
            continue
        proposed += 1
        auto += status == "auto"
    _cache["at"] = 0
    await audit_log(db, "SEARCH_LEARNING_RUN", email=by, role="system" if by == "system" else "admin",
                    meta={"asked": len(asked), "proposed": proposed, "auto": auto})
    return {"asked": len(asked), "proposed": proposed, "auto": auto}


try:
    import jobs as _jobs

    @_jobs.handler("search_learn")
    async def _job(p: dict) -> None:
        await learn()
except Exception:  # noqa: BLE001
    pass


# --------------------------------------------------------------------- admin ---
@admin_router.get("")
async def sl_list():
    books = {b["id"]: b for b in await db.books.find({}, {"_id": 0, "id": 1, "title": 1, "cover_image": 1}).to_list(2000)}
    rows = []
    async for r in db.search_rewrites.find({}, {"_id": 0}).sort("created_at", -1).limit(500):
        r["books"] = [{"id": i, "title": (books.get(i) or {}).get("title", "(removed)"), "cover_image": (books.get(i) or {}).get("cover_image", "")}
                      for i in r.get("book_ids") or []]
        r["needs_review"] = r.get("status") in LIVE and core.needs_review(r)
        rows.append(r)
    import llm
    return {"suggested": [r for r in rows if r["status"] == "suggested"],
            "live": [r for r in rows if r["status"] in LIVE],
            "asked_for": sorted([r for r in rows if r["kind"] == "not_ours" and r["status"] != "rejected"], key=lambda r: -int(r.get("searches") or 0)),
            "rejected": [r for r in rows if r["status"] == "rejected"][:50],
            "ai": llm.describe() if hasattr(llm, "describe") else ""}


@admin_router.post("/run")
async def sl_run(user: dict = Depends(require_superadmin)):
    return await learn(by=user.get("email", "admin"))


async def _set(rid: str, status: str, user: dict, allowed: tuple) -> dict:
    res = await db.search_rewrites.update_one({"id": rid, "status": {"$in": list(allowed)}},
                                              {"$set": {"status": status, "decided_by": user.get("email", ""), "decided_at": _now().isoformat()}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="This changed a moment ago — refresh.")
    _cache["at"] = 0
    await audit_log(db, f"SEARCH_REWRITE_{status.upper()}", email=user.get("email", ""), role=user.get("role", ""), meta={"rewrite": rid})
    return {"ok": True}


@admin_router.post("/{rid}/approve")
async def sl_approve(rid: str, user: dict = Depends(require_admin)):
    r = await db.search_rewrites.find_one({"id": rid}, {"_id": 0, "book_ids": 1})
    if r is not None and not r.get("book_ids"):
        raise HTTPException(status_code=400, detail="Nothing to show for this search — it's a 'titles people ask for' signal, not a fix.")
    return await _set(rid, "approved", user, ("suggested", "rejected", "disabled"))


@admin_router.post("/{rid}/reject")
async def sl_reject(rid: str, user: dict = Depends(require_admin)):
    return await _set(rid, "rejected", user, ("suggested",))


@admin_router.post("/{rid}/disable")
async def sl_disable(rid: str, user: dict = Depends(require_admin)):
    """Take a live fix (approved or auto) off the site; it can be re-approved."""
    return await _set(rid, "disabled", user, LIVE)


async def ensure_indexes() -> None:
    try:
        await db.search_rewrites.create_index("id", unique=True)
        await db.search_rewrites.create_index("key", unique=True)
        await db.search_rewrites.create_index("status")
    except Exception:  # noqa: BLE001
        log.warning("search learning: index creation failed", exc_info=True)
