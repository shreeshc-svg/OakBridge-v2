"""Amazon (Seller Central, FBA) — read-only stock sync (Oct 2026).

WHAT IT DOES
Reads our OWN Fulfilment-by-Amazon stock (available, inbound, reserved,
unfulfillable) for every SKU, a few times a day, and links each Amazon SKU to
the book in our catalogue (by ISBN). Admin → Warehouse → Inventory then shows
"Our shelf · At Amazon · Total", and warns when a title runs low at Amazon so
a replenishment shipment can be sent.

WHAT IT NEVER DOES
* Writes nothing to Amazon (no listings, prices or quantities change).
* Reads no buyer data — the app was registered with no restricted (PII) roles.
* Changes neither our warehouse count nor website stock. Amazon sells from
  Amazon's warehouse; our shelf changes only when we SEND books to Amazon,
  recorded on our side as the "Sent to Amazon FBA" movement.

CREDENTIALS (Render environment, never in code or chat)
  SPAPI_LWA_CLIENT_ID / SPAPI_LWA_CLIENT_SECRET / SPAPI_REFRESH_TOKEN
  SPAPI_REGION (eu — Amazon serves India from its EU endpoint)
  SPAPI_MARKETPLACE_ID (A21TJRUUN4KGV — Amazon.in)
The short-lived access token is kept in memory only and never logged; error
messages are trimmed and carry no credentials.

LINKING SKUs TO BOOKS (no guessing)
1. A link saved by staff (amazon_sku_map) always wins.
2. The SKU itself is the ISBN-13 or ISBN-10 of a book.
3. The ASIN is the book's ISBN-10 (Amazon's ASIN for a printed book is
   usually its ISBN-10).
Anything else stays "unmatched" and is listed for staff to link by hand.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import jobs as _jobs
from audit import audit_log
from extensions import db, require_admin

log = logging.getLogger("oakbridge.amazon")

ENDPOINTS = {"eu": "https://sellingpartnerapi-eu.amazon.com", "na": "https://sellingpartnerapi-na.amazon.com",
             "fe": "https://sellingpartnerapi-fe.amazon.com"}
LWA_URL = "https://api.amazon.com/auth/o2/token"
SYNC_EVERY_HOURS = 6
PAGE_PAUSE = 0.6            # getInventorySummaries allows 2 requests/second
SETTINGS_KEY = "amazon_settings"


def _cfg() -> dict:
    return {"client_id": os.environ.get("SPAPI_LWA_CLIENT_ID", "").strip(),
            "client_secret": os.environ.get("SPAPI_LWA_CLIENT_SECRET", "").strip(),
            "refresh_token": os.environ.get("SPAPI_REFRESH_TOKEN", "").strip(),
            "region": (os.environ.get("SPAPI_REGION") or "eu").strip().lower(),
            "marketplace": (os.environ.get("SPAPI_MARKETPLACE_ID") or "A21TJRUUN4KGV").strip()}


def configured() -> bool:
    c = _cfg()
    return bool(c["client_id"] and c["client_secret"] and c["refresh_token"] and c["region"] in ENDPOINTS)


class AmazonError(Exception):
    pass


def _clean_err(text: str) -> str:
    """Amazon's error text, trimmed and with anything token-like masked."""
    t = re.sub(r"(Atz[a-z]?\|[A-Za-z0-9\-_.|]+|amzn1\.[A-Za-z0-9.\-]+)", "…", str(text or ""))
    return t[:300]


_token = {"value": "", "exp": 0.0}


def _access_token() -> str:
    import requests
    if _token["value"] and time.time() < _token["exp"] - 60:
        return _token["value"]
    c = _cfg()
    r = requests.post(LWA_URL, data={"grant_type": "refresh_token", "refresh_token": c["refresh_token"],
                                     "client_id": c["client_id"], "client_secret": c["client_secret"]}, timeout=20)
    if r.status_code != 200:
        raise AmazonError(f"Amazon login refused ({r.status_code}): {_clean_err(r.text)}")
    j = r.json()
    _token.update(value=j.get("access_token", ""), exp=time.time() + int(j.get("expires_in") or 3600))
    if not _token["value"]:
        raise AmazonError("Amazon login returned no access token.")
    return _token["value"]


def _get(path: str, params: dict) -> dict:
    import requests
    c = _cfg()
    for attempt in range(4):
        r = requests.get(ENDPOINTS[c["region"]] + path, params=params,
                         headers={"x-amz-access-token": _access_token(), "accept": "application/json",
                                  "user-agent": "OakbridgeInventorySync/1.0 (Language=Python)"}, timeout=30)
        if r.status_code == 429 and attempt < 3:     # throttled: back off and retry
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 403 and attempt == 0:    # stale token
            _token.update(value="", exp=0)
            continue
        if r.status_code >= 400:
            raise AmazonError(f"Amazon returned {r.status_code}: {_clean_err(r.text)}")
        return r.json()
    raise AmazonError("Amazon kept throttling the request — try again in a few minutes.")


def fetch_fba_inventory(max_pages: int = 200) -> list:
    """Every FBA inventory summary for our marketplace, with details."""
    c = _cfg()
    out, token = [], None
    for page in range(max_pages):
        params = {"details": "true", "granularityType": "Marketplace", "granularityId": c["marketplace"],
                  "marketplaceIds": c["marketplace"]}
        if token:
            params["nextToken"] = token
        j = _get("/fba/inventory/v1/summaries", params)
        out.extend((j.get("payload") or {}).get("inventorySummaries") or [])
        token = (j.get("pagination") or {}).get("nextToken")
        if not token:
            break
        time.sleep(PAGE_PAUSE)
    return out


# ------------------------------------------------------------ pure parts ---
def isbn_digits(s) -> str:
    return re.sub(r"[^0-9Xx]", "", str(s or "")).upper()


def isbn13_to_10(isbn13: str) -> Optional[str]:
    d = isbn_digits(isbn13)
    if len(d) != 13 or not d.startswith("978"):
        return None
    core9 = d[3:12]
    s = sum((10 - i) * int(ch) for i, ch in enumerate(core9))
    check = (11 - s % 11) % 11
    return core9 + ("X" if check == 10 else str(check))


def summary_row(s: dict) -> dict:
    """One Amazon inventory summary -> the numbers we keep."""
    d = s.get("inventoryDetails") or {}
    reserved = (d.get("reservedQuantity") or {}).get("totalReservedQuantity") or 0
    unful = (d.get("unfulfillableQuantity") or {}).get("totalUnfulfillableQuantity") or 0
    inbound = int(d.get("inboundWorkingQuantity") or 0) + int(d.get("inboundShippedQuantity") or 0) \
        + int(d.get("inboundReceivingQuantity") or 0)
    return {"sku": str(s.get("sellerSku") or "")[:80], "asin": str(s.get("asin") or "")[:20],
            "fnsku": str(s.get("fnSku") or "")[:20], "title": str(s.get("productName") or "")[:200],
            "condition": str(s.get("condition") or "")[:30],
            "available": int(d.get("fulfillableQuantity") or 0), "inbound": inbound, "reserved": int(reserved),
            "unfulfillable": int(unful), "total": int(s.get("totalQuantity") or 0),
            "amazon_updated": s.get("lastUpdatedTime") or ""}


def match_book(row: dict, by13: dict, by10: dict, manual: dict) -> tuple[Optional[str], str]:
    """(book_id, how) — manual link, SKU = ISBN, or ASIN = ISBN-10; else (None, '')."""
    if row["sku"] in manual:
        return manual[row["sku"]], "manual"
    k = isbn_digits(row["sku"])
    if k in by13:
        return by13[k], "sku_isbn13"
    if k in by10:
        return by10[k], "sku_isbn10"
    a = isbn_digits(row["asin"])
    if a in by10:
        return by10[a], "asin_isbn10"
    return None, ""


# ------------------------------------------------------------------ sync ---
async def sync_fba(by: str = "schedule") -> dict:
    if not configured():
        raise AmazonError("Amazon keys are not set on the server (SPAPI_* in Render).")
    summaries = await asyncio.to_thread(fetch_fba_inventory)
    books = await db.books.find({"product_type": {"$nin": ["hamper"]}}, {"_id": 0, "id": 1, "isbn": 1}).to_list(5000)
    by13, by10 = {}, {}
    for b in books:
        d = isbn_digits(b.get("isbn"))
        if len(d) == 13:
            by13[d] = b["id"]
            i10 = isbn13_to_10(d)
            if i10:
                by10[i10] = b["id"]
        elif len(d) == 10:
            by10[d] = b["id"]
    maps = await db.amazon_sku_map.find({}, {"_id": 0, "sku": 1, "book_id": 1, "ignored": 1}).to_list(5000)
    manual = {m["sku"]: m["book_id"] for m in maps if m.get("book_id")}
    # SKUs staff marked "not on our site" (old editions, non-book listings):
    # kept and synced, but never counted as "to link" again.
    ignored = {m["sku"] for m in maps if m.get("ignored")}
    now = datetime.now(timezone.utc).isoformat()
    seen, matched, n_ignored = set(), 0, 0
    for s in summaries:
        row = summary_row(s)
        if not row["sku"]:
            continue
        bid, how = match_book(row, by13, by10, manual)
        matched += bool(bid)
        n_ignored += (not bid) and row["sku"] in ignored
        seen.add(row["sku"])
        await db.amazon_fba.update_one({"sku": row["sku"]}, {"$set": {**row, "book_id": bid, "matched_by": how,
                                                                      "ignored": (not bid) and row["sku"] in ignored,
                                                                      "synced_at": now, "gone": False}}, upsert=True)
    # SKUs Amazon no longer reports: keep the row but show zero (not stale numbers).
    await db.amazon_fba.update_many({"sku": {"$nin": list(seen)}},
                                    {"$set": {"available": 0, "inbound": 0, "reserved": 0, "total": 0, "gone": True,
                                              "synced_at": now}})
    res = {"skus": len(seen), "matched": matched, "ignored": n_ignored, "unmatched": len(seen) - matched - n_ignored,
           "at": now}
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "last_sync": res,
                                                                     "last_error": ""}}, upsert=True)
    log.info("amazon: FBA sync %s by %s", res, by)
    return res


async def by_book() -> dict:
    """{book_id: {available, inbound, reserved, total, skus}} for the Inventory page."""
    out: dict = {}
    async for r in db.amazon_fba.find({"book_id": {"$ne": None}}, {"_id": 0}):
        a = out.setdefault(r["book_id"], {"available": 0, "inbound": 0, "reserved": 0, "unfulfillable": 0, "total": 0, "skus": []})
        for k in ("available", "inbound", "reserved", "unfulfillable", "total"):
            a[k] += int(r.get(k) or 0)
        a["skus"].append(r["sku"])
    return out


async def settings() -> dict:
    d = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
    return {"low_at": int(d.get("low_at", 5) if d.get("low_at") is not None else 5), "last_sync": d.get("last_sync"), "last_error": d.get("last_error", "")}


@_jobs.handler("amz_fba_sync")
async def _job_fba_sync(p: dict) -> None:
    if not configured():
        return
    try:
        await sync_fba(by="schedule")
    except AmazonError as e:
        await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "last_error": str(e)[:300],
                                                                         "last_error_at": datetime.now(timezone.utc).isoformat()}},
                                         upsert=True)


def schedule_tick() -> None:
    """Called from the minute tick (marketing.periodic): one sync per 6 hours."""
    if configured():
        from marketing import dispatch
        n = datetime.now(timezone.utc)
        dispatch("amz_fba_sync", dedupe=f"{n:%Y%m%d}-{n.hour // SYNC_EVERY_HOURS}")


# ---------------------------------------------------------------- admin ---
admin_router = APIRouter(prefix="/api/admin/warehouse/amazon", tags=["amazon"], dependencies=[Depends(require_admin)])


@admin_router.get("/status")
async def amz_status():
    st = await settings()
    return {"configured": configured(), "marketplace": _cfg()["marketplace"], **st,
            "skus": await db.amazon_fba.count_documents({"gone": {"$ne": True}}),
            "unmatched": await db.amazon_fba.count_documents({"book_id": None, "ignored": {"$ne": True}, "gone": {"$ne": True}})}


@admin_router.post("/sync")
async def amz_sync(user: dict = Depends(require_admin)):
    if not configured():
        raise HTTPException(status_code=409, detail="Amazon keys are not set on the server yet (SPAPI_* in Render).")
    try:
        res = await sync_fba(by=user.get("email", ""))
    except AmazonError as e:
        await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "last_error": str(e)[:300]}},
                                         upsert=True)
        raise HTTPException(status_code=502, detail=str(e))
    await audit_log(db, "AMAZON_FBA_SYNC", email=user.get("email", ""), role=user.get("role", ""), meta=res)
    return res


@admin_router.get("/skus")
async def amz_skus(unmatched: bool = False):
    flt = {"gone": {"$ne": True}}
    if unmatched:
        flt["book_id"] = None
        flt["ignored"] = {"$ne": True}
    rows = await db.amazon_fba.find(flt, {"_id": 0}).sort("title", 1).to_list(5000)
    return {"rows": rows}


class LinkBody(BaseModel):
    sku: str
    book_id: Optional[str] = None     # None = unlink
    ignore: bool = False              # "not on our site" — stop asking to link this SKU


@admin_router.post("/link")
async def amz_link(body: LinkBody, user: dict = Depends(require_admin)):
    sku = (body.sku or "").strip()[:80]
    if not await db.amazon_fba.find_one({"sku": sku}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Unknown Amazon SKU — sync first.")
    if body.book_id:
        if not await db.books.find_one({"id": body.book_id}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Book not found")
        await db.amazon_sku_map.update_one({"sku": sku}, {"$set": {"sku": sku, "book_id": body.book_id,
                                                                  "by": user.get("email", ""),
                                                                  "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        await db.amazon_fba.update_one({"sku": sku}, {"$set": {"book_id": body.book_id, "matched_by": "manual"}})
    elif body.ignore:
        await db.amazon_sku_map.update_one({"sku": sku}, {"$set": {"sku": sku, "book_id": None, "ignored": True,
                                                                  "by": user.get("email", ""),
                                                                  "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        await db.amazon_fba.update_one({"sku": sku}, {"$set": {"book_id": None, "matched_by": "", "ignored": True}})
    else:
        await db.amazon_sku_map.delete_one({"sku": sku})
        await db.amazon_fba.update_one({"sku": sku}, {"$set": {"book_id": None, "matched_by": "", "ignored": False}})
    await audit_log(db, "AMAZON_SKU_LINK", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"sku": sku, "book": body.book_id or "", "ignored": bool(body.ignore and not body.book_id)})
    return {"ok": True}


class AmzSettingsBody(BaseModel):
    low_at: int


@admin_router.put("/settings")
async def amz_put_settings(body: AmzSettingsBody, user: dict = Depends(require_admin)):
    low = max(0, min(int(body.low_at), 1000))
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "low_at": low}}, upsert=True)
    return {"low_at": low}
