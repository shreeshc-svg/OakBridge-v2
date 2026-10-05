"""
Zoho Inventory link — OFF until a superadmin switches it on in Admin → Inventory.

WHY IT EXISTS
The warehouse is trialling Zoho Inventory as the place stock is managed. The
website keeps selling from its own `books.stock`; this module keeps the two in
step, in both directions:

  website → Zoho   every paid order becomes a CONFIRMED Zoho sales order, so
                   Zoho's "available for sale" drops the moment the sale is
                   made (stock on hand drops later, when the warehouse ships it
                   in Zoho). A cancelled order voids its sales order.
  Zoho → website   every 15 minutes the website copies Zoho's available count
                   onto each book it can match by ISBN (the item SKU).
  at checkout      the order endpoint asks Zoho, live, about the books in the
                   cart, so a copy Zoho knows is gone cannot be sold in the gap
                   between two pulls.

THREE STATES, chosen in the admin panel and stored in db.integrations:
  off   (default) nothing runs; nothing is queued.
  test  everything runs and is RECORDED, nothing is CHANGED: pulls report what
        they would change, orders are queued and marked "test" instead of being
        sent, checkout logs what it would have refused. This is the trial mode.
  live  pulls write stock, orders are sent, checkout refuses what Zoho says is
        gone. The Google-sheet stock sync stands down (inventory_sync.py), so
        two masters never overwrite each other.

FAIL-SAFE BY DESIGN
A Zoho outage must never stop the website selling. Order sending happens in a
queue (db.zoho_outbox) with retries, outside the payment path; the checkout
check gives up after a few seconds and lets the sale through on the website's
own count; the scheduler swallows its own errors.

CREDENTIALS come from the environment only (Render), never the admin panel or
the database: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
ZOHO_ORG_ID. Optional: ZOHO_ACCOUNTS_URL / ZOHO_API_BASE (default to Zoho's
India data centre, where this organisation lives).

API BUDGET (Zoho Free plan: 1,000 calls/day, 100/minute): a pull is one call
per 200 items (2 today), so 96 pulls/day ≈ 200 calls, plus ~2 per order and one
per cart line at checkout.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import zoho_core as core
from audit import audit_log
from extensions import _notify_back_in_stock, db, require_admin, require_superadmin

log = logging.getLogger(__name__)

ACCOUNTS_URL = (os.environ.get("ZOHO_ACCOUNTS_URL") or "https://accounts.zoho.in").rstrip("/")
API_BASE = (os.environ.get("ZOHO_API_BASE") or "https://www.zohoapis.in/inventory/v1").rstrip("/")
ENV_KEYS = ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORG_ID")
STATE_KEY = "zoho"
MAX_ATTEMPTS = 8
CHECKOUT_TIMEOUT_S = 4.0
DEFAULT_CUSTOMER = "Website – oakbridge.in"


class ZohoError(Exception):
    pass


# ---------------------------------------------------------------- state ----
def env_status() -> dict:
    """Which credentials are set — booleans only, never the values."""
    return {k: bool((os.environ.get(k) or "").strip()) for k in ENV_KEYS}


def configured() -> bool:
    return all(env_status().values())


async def get_state() -> dict:
    doc = await db.integrations.find_one({"key": STATE_KEY}, {"_id": 0}) or {}
    return {
        "enabled": bool(doc.get("enabled", False)),
        "mode": doc.get("mode") if doc.get("mode") in core.MODES else "test",
        "customer_name": doc.get("customer_name") or DEFAULT_CUSTOMER,
        "customer_id": doc.get("customer_id") or "",
        "pull_minutes": int(doc.get("pull_minutes") or core.DEFAULT_PULL_MINUTES),
        "last_pull": doc.get("last_pull"),
        "last_pull_at": doc.get("last_pull_at"),
        "updated_by": doc.get("updated_by"),
        "updated_at": doc.get("updated_at"),
    }


async def _save_state(fields: dict) -> None:
    await db.integrations.update_one({"key": STATE_KEY}, {"$set": fields}, upsert=True)


async def zoho_owns_stock() -> bool:
    """True when Zoho is the stock master (enabled + live + credentials set)."""
    st = await get_state()
    return st["enabled"] and st["mode"] == "live" and configured()


# ----------------------------------------------------------------- HTTP ----
_token = {"value": "", "exp": 0.0}
_token_lock = asyncio.Lock()


def _refresh_access_token() -> tuple[str, float]:
    r = requests.post(
        f"{ACCOUNTS_URL}/oauth/v2/token",
        data={
            "refresh_token": os.environ.get("ZOHO_REFRESH_TOKEN", ""),
            "client_id": os.environ.get("ZOHO_CLIENT_ID", ""),
            "client_secret": os.environ.get("ZOHO_CLIENT_SECRET", ""),
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    data = r.json() if r.content else {}
    tok = data.get("access_token")
    if not tok:
        # Zoho returns 200 with {"error": "invalid_code"} for a bad refresh token.
        raise ZohoError(f"Zoho sign-in failed: {data.get('error') or r.status_code}")
    return tok, time.time() + float(data.get("expires_in", 3600)) - 120


async def _access_token(force: bool = False) -> str:
    async with _token_lock:
        if force or not _token["value"] or time.time() >= _token["exp"]:
            _token["value"], _token["exp"] = await asyncio.to_thread(_refresh_access_token)
        return _token["value"]


async def _call(method: str, path: str, *, params: Optional[dict] = None,
                json: Optional[dict] = None, timeout: float = 20) -> dict:
    if not configured():
        raise ZohoError("Zoho credentials are not set on the server.")
    q = {"organization_id": os.environ.get("ZOHO_ORG_ID", ""), **(params or {})}
    for attempt in (1, 2):
        tok = await _access_token(force=attempt == 2)

        def go():
            return requests.request(
                method, f"{API_BASE}{path}", params=q, json=json, timeout=timeout,
                headers={"Authorization": f"Zoho-oauthtoken {tok}"},
            )

        r = await asyncio.to_thread(go)
        if r.status_code == 401 and attempt == 1:
            continue  # access token revoked early — refresh once and retry
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400 or data.get("code") not in (0, None):
            raise ZohoError(f"Zoho {r.status_code}: {data.get('message') or r.text[:200]}")
        return data
    raise ZohoError("Zoho rejected the access token twice.")


async def fetch_items() -> list:
    items, page = [], 1
    while page <= 25:  # 5,000 items; a runaway loop costs API budget
        data = await _call("GET", "/items", params={"page": page, "per_page": 200})
        items.extend(data.get("items") or [])
        if not (data.get("page_context") or {}).get("has_more_page"):
            break
        page += 1
    return items


async def _customer_id(state: dict) -> str:
    if state.get("customer_id"):
        return state["customer_id"]
    name = state["customer_name"]
    data = await _call("GET", "/contacts", params={"contact_name": name})
    for c in data.get("contacts") or []:
        if (c.get("contact_name") or "").strip().lower() == name.strip().lower():
            await _save_state({"customer_id": c["contact_id"]})
            return c["contact_id"]
    raise ZohoError(f'No Zoho customer named "{name}". Create it in Zoho → Sales → Customers.')


# ----------------------------------------------------------------- pull ----
async def _pending_book_ids() -> set:
    ids: set = set()
    async for d in db.zoho_outbox.find(
        {"kind": "create", "status": {"$in": ["pending", "sending", "failed"]}},
        {"_id": 0, "lines": 1},
    ):
        ids.update(ln.get("book_id") for ln in d.get("lines") or [])
    return ids


async def pull_stock(trigger: str, actor: Optional[dict] = None) -> dict:
    """Copy Zoho's available counts onto the website (live) or report it (test/off)."""
    state = await get_state()
    write = state["enabled"] and state["mode"] == "live"
    items = await fetch_items()
    books = await db.books.find(
        {}, {"_id": 0, "id": 1, "isbn": 1, "stock": 1, "zoho_item_id": 1, "title": 1}
    ).to_list(5000)
    plan = core.plan_stock_changes(books, items, await _pending_book_ids())

    # Item links are bookkeeping, not stock, so they are saved in every mode —
    # the checkout check and the order queue need them from the first test run.
    for m in plan["mappings"]:
        await db.books.update_one({"id": m["book_id"]}, {"$set": {"zoho_item_id": m["zoho_item_id"]}})

    restocked = 0
    if write:
        for c in plan["changes"]:
            await db.books.update_one({"id": c["book_id"]}, {"$set": {"stock": c["to"]}})
            if c["from"] <= 0 < c["to"]:
                full = await db.books.find_one({"id": c["book_id"]}, {"_id": 0})
                if full:
                    await _notify_back_in_stock(full)
                restocked += 1

    now = datetime.now(timezone.utc).isoformat()
    summary = {
        "at": now,
        "trigger": trigger,
        "applied": write,
        "zoho_items": len(items),
        "changed": len(plan["changes"]),
        "restocked": restocked,
        "linked": len(plan["mappings"]),
        "skipped_pending": plan["skipped_pending"],
        "unmapped_books": plan["unmapped_books"][:100],
        "unmapped_books_count": len(plan["unmapped_books"]),
        "unmatched_zoho": plan["unmatched_zoho"][:100],
        "unmatched_zoho_count": len(plan["unmatched_zoho"]),
        "duplicate_skus": plan["duplicate_skus"],
        "no_stock_field": plan["no_stock_field"],
        "fields_used": plan["fields_used"],
        "changes": plan["changes"][:300],
    }
    await _save_state({"last_pull": summary, "last_pull_at": now})
    await audit_log(
        db, "ZOHO_STOCK_PULL",
        email=(actor or {}).get("email", ""), role=(actor or {}).get("role", ""),
        meta={"trigger": trigger, "applied": write, "changed": summary["changed"],
              "first_changes": [f'{c["isbn"]}:{c["from"]}->{c["to"]}' for c in plan["changes"][:20]]},
    )
    log.info("zoho pull (%s, applied=%s): %s changed, %s unmapped, fields=%s",
             trigger, write, summary["changed"], summary["unmapped_books_count"], plan["fields_used"])
    return summary


# --------------------------------------------------------------- orders ----
async def enqueue_order(order: dict, lines: list) -> None:
    """Queue a paid order for Zoho. Never raises — called from the payment path.

    `lines` are the (book_id, qty) pairs the website just took off its own
    stock, hamper contents already expanded, so Zoho commits exactly the copies
    the website did.
    """
    try:
        state = await get_state()
        if not state["enabled"]:
            return
        rates = {it.get("book_id"): float(it.get("price") or 0) for it in order.get("items") or []}
        now = datetime.now(timezone.utc).isoformat()
        await db.zoho_outbox.update_one(
            {"order_id": order["id"], "kind": "create"},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()), "order_id": order["id"], "kind": "create",
                "order_number": order.get("order_number", ""),
                "lines": [{"book_id": b, "qty": q, "rate": rates.get(b, 0)} for b, q in lines],
                "status": "pending", "attempts": 0, "created_at": now, "next_at": now,
            }},
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        log.exception("could not queue order %s for Zoho", order.get("order_number"))


async def enqueue_void(order_id: str) -> None:
    """A cancelled website order releases its copies in Zoho. Never raises."""
    try:
        if not (await get_state())["enabled"]:
            return
        # Not sent yet: simply never send it.
        res = await db.zoho_outbox.update_one(
            {"order_id": order_id, "kind": "create", "status": {"$in": ["pending", "failed"]}},
            {"$set": {"status": "cancelled"}},
        )
        if res.modified_count:
            return
        order = await db.orders.find_one({"id": order_id}, {"_id": 0, "zoho_salesorder_id": 1, "order_number": 1})
        if not (order or {}).get("zoho_salesorder_id"):
            return
        now = datetime.now(timezone.utc).isoformat()
        await db.zoho_outbox.update_one(
            {"order_id": order_id, "kind": "void"},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()), "order_id": order_id, "kind": "void",
                "order_number": order.get("order_number", ""),
                "salesorder_id": order["zoho_salesorder_id"], "lines": [],
                "status": "pending", "attempts": 0, "created_at": now, "next_at": now,
            }},
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        log.exception("could not queue Zoho void for order %s", order_id)


async def _send_create(job: dict, state: dict) -> dict:
    # A retry may follow a send that reached Zoho but whose reply was lost.
    # Look for our own reference before creating a second sales order.
    if job.get("attempts", 0) > 0 or job.get("claimed_at"):
        found = await _call("GET", "/salesorders", params={"reference_number": job["order_number"]})
        for so in found.get("salesorders") or []:
            if so.get("reference_number") == job["order_number"]:
                return {"salesorder_id": so["salesorder_id"], "salesorder_number": so.get("salesorder_number")}

    ids = {}
    async for b in db.books.find(
        {"id": {"$in": [ln["book_id"] for ln in job["lines"]]}}, {"_id": 0, "id": 1, "zoho_item_id": 1}
    ):
        if b.get("zoho_item_id"):
            ids[b["id"]] = b["zoho_item_id"]
    body, missing = core.build_salesorder(
        job["order_number"], (job.get("created_at") or "")[:10],
        await _customer_id(state), job["lines"], ids,
    )
    if not body:
        return {"skipped": "none of these books are linked to a Zoho item", "missing": missing}
    data = await _call("POST", "/salesorders", json=body)
    so = data.get("salesorder") or {}
    sid = so.get("salesorder_id")
    if not sid:
        raise ZohoError("Zoho created no sales order id.")
    # Confirmed, not draft: only a confirmed sales order commits the copies,
    # which is what lowers Zoho's "available for sale".
    await _call("POST", f"/salesorders/{sid}/status/confirmed")
    return {"salesorder_id": sid, "salesorder_number": so.get("salesorder_number"), "missing": missing}


async def process_outbox(limit: int = 10) -> dict:
    state = await get_state()
    counts: dict = {}
    if not state["enabled"]:
        return counts
    now = datetime.now(timezone.utc)
    for _ in range(limit):
        stale = (now - timedelta(minutes=10)).isoformat()
        job = await db.zoho_outbox.find_one_and_update(
            {"$or": [
                {"status": {"$in": ["pending", "failed"]}, "next_at": {"$lte": now.isoformat()}},
                # Claimed by a worker that died mid-send (a deploy restart).
                # The reference-number lookup in _send_create stops a duplicate.
                {"status": "sending", "claimed_at": {"$lt": stale}},
            ]},
            {"$set": {"status": "sending", "claimed_at": now.isoformat()}},
            sort=[("created_at", 1)], projection={"_id": 0},
        )
        if not job:
            break
        if state["mode"] != "live":
            await db.zoho_outbox.update_one({"id": job["id"]}, {"$set": {"status": "test"}})
            counts["test"] = counts.get("test", 0) + 1
            continue
        try:
            if job["kind"] == "void":
                await _call("POST", f"/salesorders/{job['salesorder_id']}/status/void")
                result = {"voided": job["salesorder_id"]}
            else:
                result = await _send_create(job, state)
                if result.get("salesorder_id"):
                    await db.orders.update_one(
                        {"id": job["order_id"]},
                        {"$set": {"zoho_salesorder_id": result["salesorder_id"],
                                  "zoho_salesorder_number": result.get("salesorder_number")}},
                    )
            status = "skipped" if result.get("skipped") else "done"
            await db.zoho_outbox.update_one(
                {"id": job["id"]},
                {"$set": {"status": status, "result": result, "done_at": datetime.now(timezone.utc).isoformat()}},
            )
            counts[status] = counts.get(status, 0) + 1
        except Exception as e:  # noqa: BLE001
            attempts = int(job.get("attempts", 0)) + 1
            dead = attempts >= MAX_ATTEMPTS
            nxt = datetime.now(timezone.utc) + timedelta(minutes=core.backoff_minutes(attempts))
            await db.zoho_outbox.update_one(
                {"id": job["id"]},
                {"$set": {"status": "dead" if dead else "failed", "attempts": attempts,
                          "last_error": str(e)[:300], "next_at": nxt.isoformat()}},
            )
            counts["dead" if dead else "failed"] = counts.get("dead" if dead else "failed", 0) + 1
            (log.error if dead else log.warning)(
                "zoho %s for %s failed (attempt %s): %s", job["kind"], job.get("order_number"), attempts, e)
    return counts


# ------------------------------------------------------------- checkout ----
async def checkout_live_counts(book_ids: list) -> dict:
    """book_id -> Zoho's available count, for the books in a cart.

    Live mode only; {} otherwise. Books Zoho does not answer for in time are
    simply absent — the caller then judges them on the website's own number.
    """
    try:
        if not await zoho_owns_stock():
            return {}
        linked = await db.books.find(
            {"id": {"$in": book_ids}, "zoho_item_id": {"$nin": [None, ""]}},
            {"_id": 0, "id": 1, "zoho_item_id": 1},
        ).to_list(len(book_ids))

        async def one(b):
            data = await _call("GET", f"/items/{b['zoho_item_id']}", timeout=CHECKOUT_TIMEOUT_S)
            qty, _ = core.zoho_available(data.get("item") or {})
            return b["id"], qty

        results = await asyncio.wait_for(
            asyncio.gather(*(one(b) for b in linked), return_exceptions=True),
            timeout=CHECKOUT_TIMEOUT_S + 1,
        )
        return {bid: q for r in results if not isinstance(r, Exception) for bid, q in [r] if q is not None}
    except Exception:  # noqa: BLE001
        log.warning("zoho checkout check skipped — Zoho did not answer in time", exc_info=True)
        return {}


# ------------------------------------------------------------ scheduler ----
async def _take_pull_lease(minutes: int) -> bool:
    now = datetime.now(timezone.utc)
    got = await db.integrations.find_one_and_update(
        {"key": STATE_KEY, "$or": [{"pull_lease": {"$exists": False}}, {"pull_lease": {"$lt": now.isoformat()}}]},
        {"$set": {"pull_lease": (now + timedelta(minutes=minutes)).isoformat()}},
    )
    return got is not None


async def _scheduler_loop() -> None:
    await asyncio.sleep(30)  # let startup finish first
    while True:
        try:
            st = await get_state()
            if st["enabled"] and configured():
                await process_outbox()
                if await _take_pull_lease(st["pull_minutes"]):
                    await pull_stock("schedule")
        except Exception:  # noqa: BLE001
            log.exception("zoho scheduler tick failed")
        await asyncio.sleep(60)


_loop_task: Optional[asyncio.Task] = None


def start_scheduler() -> None:
    """Started once at app startup; idles (one DB read a minute) while off."""
    global _loop_task
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.create_task(_scheduler_loop())


# --------------------------------------------------------------- admin -----
zoho_admin_router = APIRouter(
    prefix="/api/admin/inventory/zoho", tags=["zoho"], dependencies=[Depends(require_admin)]
)


class ZohoSettings(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    customer_name: Optional[str] = None


@zoho_admin_router.get("")
async def zoho_status():
    state = await get_state()
    counts: dict = {}
    async for d in db.zoho_outbox.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        counts[d["_id"]] = d["n"]
    problems = await db.zoho_outbox.find(
        {"status": {"$in": ["failed", "dead"]}},
        {"_id": 0, "order_number": 1, "kind": 1, "status": 1, "attempts": 1, "last_error": 1},
    ).sort("created_at", -1).to_list(10)
    linked = await db.books.count_documents({"zoho_item_id": {"$nin": [None, ""]}})
    return {**state, "configured": configured(), "env": env_status(),
            "outbox": counts, "problems": problems, "linked_books": linked}


@zoho_admin_router.put("/settings")
async def zoho_settings(payload: ZohoSettings, user: dict = Depends(require_superadmin)):
    """Superadmin only: switching this on hands stock control to Zoho."""
    fields: dict = {}
    if payload.mode is not None:
        if payload.mode not in core.MODES:
            raise HTTPException(status_code=400, detail=f"mode must be one of {list(core.MODES)}")
        fields["mode"] = payload.mode
    if payload.customer_name is not None:
        name = payload.customer_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Customer name cannot be empty.")
        fields["customer_name"] = name
        fields["customer_id"] = ""  # looked up again on the next order
    if payload.enabled is not None:
        if payload.enabled and not configured():
            raise HTTPException(
                status_code=400,
                detail="Zoho credentials are not set on the server yet (Render → Environment).",
            )
        fields["enabled"] = payload.enabled
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    fields.update({"updated_by": user.get("email", ""), "updated_at": datetime.now(timezone.utc).isoformat()})
    await _save_state(fields)
    await audit_log(db, "ZOHO_SETTINGS_CHANGED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={k: v for k, v in fields.items() if k not in ("updated_by", "updated_at")})
    return await get_state()


@zoho_admin_router.post("/test-connection")
async def zoho_test_connection():
    try:
        data = await _call("GET", "/items", params={"page": 1, "per_page": 1})
        state = await get_state()
        try:
            customer = await _customer_id({**state, "customer_id": ""})
            customer_msg = f'Customer "{state["customer_name"]}" found.'
        except ZohoError as e:
            customer, customer_msg = "", str(e)
        return {"ok": True, "items_reachable": bool(data.get("items") is not None),
                "customer_found": bool(customer), "customer_message": customer_msg}
    except ZohoError as e:
        raise HTTPException(status_code=502, detail=str(e))


@zoho_admin_router.post("/sync-now")
async def zoho_sync_now(user: dict = Depends(require_admin)):
    """Pull now. Writes stock only in live mode; otherwise a preview."""
    try:
        return await pull_stock("manual", user)
    except ZohoError as e:
        raise HTTPException(status_code=502, detail=str(e))


@zoho_admin_router.post("/retry-failed")
async def zoho_retry_failed():
    res = await db.zoho_outbox.update_many(
        {"status": {"$in": ["failed", "dead"]}},
        {"$set": {"status": "pending", "attempts": 0, "next_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"requeued": res.modified_count}
