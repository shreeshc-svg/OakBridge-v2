"""Amazon Easy Ship — our shelf, sold on Amazon.in too (Oct 2026).

Oakbridge packs, Amazon delivers. Every 15 minutes, while the admin switch is
ON (Admin → Warehouse → Inventory → Amazon → Easy Ship):

  1. Listings  every 6 h: the Seller Central listings report
               (GET_MERCHANT_LISTINGS_ALL_DATA) -> amazon_listings, each SKU
               linked to a book exactly like the FBA rows (amazon_spapi.link_index).
  2. Orders    Easy Ship (MFN) orders updated since the last run. A new order
               takes its copies off website stock ONCE (amazon_core.order_step:
               stage new -> taken), and the warehouse ledger records an
               "amazon_order" movement. A cancellation puts back exactly what
               was taken (taken -> restored). No buyer data is requested or
               stored: the app has no restricted (PII) roles.
  3. Quantity  each linked Easy Ship SKU is set on Amazon to
               website stock − buffer (amazon_core.target_qty), only when it
               changed. FBA listings are never touched.

Orders placed BEFORE the switch was first turned on are recorded as
"before_start" and change nothing: the stock sheet already counted them.

Why website stock (books.stock) is the number: it is what oakbridge.in sells
from, and it already has every paid website order and every Amazon order
taken off. During the warehouse TRIAL the daily stock-sheet sync still resets
it to the sheet, so the team keeps entering Amazon sales in the sheet, as
today; this module only protects the gap between syncs. Once the warehouse is
LIVE the sheet stands down and these deductions are the record.

Credentials: the SPAPI_* keys of amazon_spapi.py plus SPAPI_SELLER_ID (the
merchant token). The app needs the "Product Listing" and "Inventory and Order
Tracking" roles.
"""
from __future__ import annotations

import asyncio
import gzip
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import amazon_core as core
import amazon_spapi as sp
import jobs as _jobs
from audit import audit_log
from extensions import db, require_admin, require_superadmin

log = logging.getLogger("oakbridge.amazon.easyship")

KEY = "amazon_easyship"
RUN_EVERY_MIN = 15
LISTINGS_EVERY_H = 6
REPORT_WAIT_S = 240
ORDER_OVERLAP_MIN = 10      # re-read a little of the last window: orders are idempotent by stage


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ready() -> bool:
    return sp.configured() and bool(sp._cfg()["seller_id"])


async def get_settings() -> dict:
    d = await db.integrations.find_one({"key": KEY}, {"_id": 0}) or {}
    return {"on": bool(d.get("on")), "buffer": core.clean_buffer(d.get("buffer")),
            "orders_from": d.get("orders_from"), "orders_cursor": d.get("orders_cursor"),
            "last_listings": d.get("last_listings"), "last_pull": d.get("last_pull"), "last_push": d.get("last_push"),
            "last_error": d.get("last_error", ""), "last_error_at": d.get("last_error_at")}


async def _set(**kv) -> None:
    await db.integrations.update_one({"key": KEY}, {"$set": {"key": KEY, **kv}}, upsert=True)


async def _error(step: str, e: Exception) -> None:
    await _set(last_error=f"{step}: {str(e)[:280]}", last_error_at=_now().isoformat())
    log.warning("amazon easyship %s failed: %s", step, e)


# ------------------------------------------------------------- listings ---
def _download_report() -> str:
    """Request the listings report, wait for Amazon to build it, download it."""
    import requests
    mp = sp._cfg()["marketplace"]
    rid = sp._call("POST", "/reports/2021-06-30/reports",
                   body={"reportType": "GET_MERCHANT_LISTINGS_ALL_DATA", "marketplaceIds": [mp]}).get("reportId")
    if not rid:
        raise sp.AmazonError("Amazon did not accept the listings report request.")
    t0 = time.time()
    while True:
        rep = sp._get(f"/reports/2021-06-30/reports/{rid}", {})
        st = rep.get("processingStatus")
        if st == "DONE":
            break
        if st in ("CANCELLED", "FATAL"):
            raise sp.AmazonError(f"Amazon could not build the listings report ({st}).")
        if time.time() - t0 > REPORT_WAIT_S:
            raise sp.AmazonError("Amazon is still preparing the listings report — it will be picked up on the next run.")
        time.sleep(10)
    doc = sp._get(f"/reports/2021-06-30/documents/{rep['reportDocumentId']}", {})
    r = requests.get(doc["url"], timeout=60)     # pre-signed link: no Amazon token is sent
    r.raise_for_status()
    raw = gzip.decompress(r.content) if (doc.get("compressionAlgorithm") or "").upper() == "GZIP" else r.content
    for enc in ("utf-8", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


async def refresh_listings() -> dict:
    await ensure_indexes()
    text = await asyncio.to_thread(_download_report)
    rows = core.parse_listings_report(text)
    by13, by10, manual, ignored = await sp.link_index()
    now = _now().isoformat()
    seen, mfn, linked = set(), 0, 0
    for r in rows:
        bid, how = sp.match_book(r, by13, by10, manual)
        seen.add(r["sku"])
        mfn += r["channel"] == "mfn"
        linked += bool(bid) and r["channel"] == "mfn"
        await db.amazon_listings.update_one(
            {"sku": r["sku"]}, {"$set": {**r, "book_id": bid, "matched_by": how, "gone": False, "synced_at": now,
                                         "ignored": (not bid) and r["sku"] in ignored}}, upsert=True)
    await db.amazon_listings.update_many({"sku": {"$nin": list(seen)}}, {"$set": {"gone": True, "synced_at": now}})
    res = {"at": now, "rows": len(rows), "easy_ship": mfn, "linked": linked}
    await _set(last_listings=res)
    return res


# ---------------------------------------------------------------- orders ---
async def _take(book_id: str, qty: int) -> int:
    """Copies off website stock for one line; same guarded pattern as a paid
    website order (payments.py): never below zero, take what is there if short."""
    res = await db.books.update_one({"id": book_id, "stock": {"$gte": qty}}, {"$inc": {"stock": -qty}})
    if res.modified_count:
        return qty
    for _ in range(3):
        cur = await db.books.find_one({"id": book_id}, {"_id": 0, "stock": 1})
        have = int((cur or {}).get("stock") or 0)
        if have <= 0:
            return 0
        if (await db.books.update_one({"id": book_id, "stock": have}, {"$inc": {"stock": -have}})).modified_count:
            return have
    return 0


async def _alert(msg: str, key: str) -> None:
    try:
        from marketing import raise_alert
        await raise_alert("amazon", msg, key=key)
    except Exception:  # noqa: BLE001
        log.warning("amazon: alert failed: %s", msg)


async def _apply_order(oid: str) -> str:
    """Move one stored order forward one stage (amazon_core.order_step).
    Each move is claimed with a compare-and-set on `stage`, so two runs can
    never both take (or both restore) the same order."""
    import warehouse
    o = await db.amazon_orders.find_one({"amazon_order_id": oid}, {"_id": 0})
    step = core.order_step(o.get("stage", "new"), o.get("status", ""))
    if step == "skip":
        await db.amazon_orders.update_one({"amazon_order_id": oid, "stage": "new"}, {"$set": {"stage": "skipped"}})
        return "skipped"
    if step == "take":
        if not (await db.amazon_orders.update_one({"amazon_order_id": oid, "stage": "new"},
                                                  {"$set": {"stage": "taking"}})).modified_count:
            return "none"
        lines, short = [], []
        for ln in o.get("lines", []):
            taken = await _take(ln["book_id"], ln["qty"]) if ln.get("book_id") else 0
            if ln.get("book_id") and taken < ln["qty"]:
                short.append(f"{ln.get('title') or ln['sku']} (needs {ln['qty']}, had {taken})")
            lines.append({**ln, "taken": taken})
        unlinked = [ln["sku"] for ln in lines if not ln.get("book_id")]
        await db.amazon_orders.update_one({"amazon_order_id": oid}, {"$set": {
            "stage": "taken", "lines": lines, "taken_at": _now().isoformat(),
            "needs_attention": bool(short or unlinked), "short": short, "unlinked": unlinked}})
        await warehouse.record_amazon_order(oid, [(ln["book_id"], ln["qty"]) for ln in lines if ln.get("book_id")])
        if short:
            await _alert(f"Amazon order {oid} is short: " + "; ".join(short), key=f"amz-short:{oid}")
        if unlinked:
            await _alert(f"Amazon order {oid} has SKU(s) not linked to a book: {', '.join(unlinked)} — "
                         "stock was not taken off. Link them in Warehouse → Inventory → Amazon.", key=f"amz-unlinked:{oid}")
        return "taken"
    if step == "restore":
        if not (await db.amazon_orders.update_one({"amazon_order_id": oid, "stage": "taken"},
                                                  {"$set": {"stage": "restoring"}})).modified_count:
            return "none"
        import order_stock
        for ln in o.get("lines", []):
            if ln.get("book_id") and ln.get("taken"):
                await db.books.update_one({"id": ln["book_id"]}, {"$inc": {"stock": int(ln["taken"])}})
                # Waiting website orders (backorders, POD) get returned copies first.
                await order_stock.fill_waiting_orders(db, ln["book_id"], by="amazon-cancel")
        await db.amazon_orders.update_one({"amazon_order_id": oid}, {"$set": {"stage": "restored",
                                                                             "restored_at": _now().isoformat()}})
        await warehouse.record_amazon_order(oid, [(ln["book_id"], ln["qty"]) for ln in o.get("lines", []) if ln.get("book_id")],
                                            cancelled=True)
        return "restored"
    return "none"


def _fetch_orders(after_iso: str) -> list:
    mp = sp._cfg()["marketplace"]
    params = {"MarketplaceIds": mp, "LastUpdatedAfter": after_iso, "FulfillmentChannels": "MFN", "MaxResultsPerPage": 100}
    out = []
    for _ in range(20):
        j = sp._get("/orders/v0/orders", params)
        p = j.get("payload") or {}
        out.extend(p.get("Orders") or [])
        if not p.get("NextToken"):
            break
        params = {"MarketplaceIds": mp, "NextToken": p["NextToken"]}
        time.sleep(1)
    return out


def _fetch_items(oid: str) -> list:
    items, params = [], {}
    for _ in range(10):
        j = sp._get(f"/orders/v0/orders/{quote(oid, safe='')}/orderItems", params)
        p = j.get("payload") or {}
        items.extend(p.get("OrderItems") or [])
        if not p.get("NextToken"):
            break
        params = {"NextToken": p["NextToken"]}
        time.sleep(2)
    return items


async def pull_orders() -> dict:
    st = await get_settings()
    start = st["orders_from"] or _now().isoformat()
    cursor = st["orders_cursor"] or start
    after = (datetime.fromisoformat(cursor) - timedelta(minutes=ORDER_OVERLAP_MIN)).isoformat().replace("+00:00", "Z")
    run_at = _now()
    orders = await asyncio.to_thread(_fetch_orders, after)
    sku_to_book = {r["sku"]: r["book_id"] async for r in db.amazon_listings.find(
        {"book_id": {"$ne": None}}, {"_id": 0, "sku": 1, "book_id": 1})}
    sku_to_book.update({r["sku"]: r["book_id"] async for r in db.amazon_fba.find(
        {"book_id": {"$ne": None}}, {"_id": 0, "sku": 1, "book_id": 1})})
    counts = {"orders": len(orders), "new": 0, "taken": 0, "restored": 0, "before_start": 0}
    for o in orders:
        oid = str(o.get("AmazonOrderId") or "")
        if not oid:
            continue
        status = str(o.get("OrderStatus") or "")
        base = {"status": status, "purchase_date": o.get("PurchaseDate"), "last_update": o.get("LastUpdateDate"),
                "latest_ship_date": o.get("LatestShipDate"), "easyship_status": o.get("EasyShipShipmentStatus") or "",
                "items_unshipped": o.get("NumberOfItemsUnshipped"), "seen_at": run_at.isoformat()}
        known = await db.amazon_orders.find_one({"amazon_order_id": oid}, {"_id": 0, "stage": 1})
        if not known:
            items = await asyncio.to_thread(_fetch_items, oid)
            before = str(o.get("PurchaseDate") or "")[:19] < start[:19]     # both UTC ISO strings
            await db.amazon_orders.update_one(
                {"amazon_order_id": oid},
                {"$setOnInsert": {"amazon_order_id": oid, "lines": core.order_lines(items, sku_to_book),
                                  "stage": "before_start" if before else "new", "created_at": run_at.isoformat()},
                 "$set": base}, upsert=True)
            counts["before_start" if before else "new"] += 1
            await asyncio.sleep(1)      # getOrderItems: 0.5 requests/second
        else:
            await db.amazon_orders.update_one({"amazon_order_id": oid}, {"$set": base})
        r = await _apply_order(oid)
        if r in ("taken", "restored"):
            counts[r] += 1
    # Amazon only accepts LastUpdatedAfter at least 2 minutes in the past.
    await _set(orders_cursor=(run_at - timedelta(minutes=2)).isoformat(), last_pull={"at": run_at.isoformat(), **counts})
    return counts


# ----------------------------------------------------------------- push ---
async def current_plan() -> list:
    st = await get_settings()
    listings = await db.amazon_listings.find({"channel": "mfn", "gone": {"$ne": True}}, {"_id": 0}).to_list(5000)
    ids = list({l["book_id"] for l in listings if l.get("book_id")})
    books = {b["id"]: b async for b in db.books.find(
        {"id": {"$in": ids}}, {"_id": 0, "id": 1, "title": 1, "stock": 1, "coming_soon": 1, "pod": 1,
                               "enabled": 1, "product_type": 1})}
    no_push = {m["sku"] async for m in db.amazon_sku_map.find({"no_push": True}, {"_id": 0, "sku": 1})}
    plan = core.push_plan(listings, books, st["buffer"], no_push)
    for p in plan:
        if p.get("book_id") in books:
            p["book_title"] = books[p["book_id"]].get("title", "")
            p["stock"] = int(books[p["book_id"]].get("stock") or 0)
    return plan


def _patch_qty(sku: str, qty: int, product_type: Optional[str]) -> tuple[str, list, str]:
    c = sp._cfg()
    path = f"/listings/2021-08-01/items/{quote(c['seller_id'], safe='')}/{quote(sku, safe='')}"
    pt = product_type
    if not pt:
        j = sp._get(path, {"marketplaceIds": c["marketplace"], "includedData": "summaries"})
        pt = next((s.get("productType") for s in j.get("summaries") or [] if s.get("productType")), None) or "PRODUCT"
    j = sp._call("PATCH", path, params={"marketplaceIds": c["marketplace"], "issueLocale": "en_US"}, body={
        "productType": pt,
        "patches": [{"op": "replace", "path": "/attributes/fulfillment_availability",
                     "value": [{"fulfillment_channel_code": "DEFAULT", "quantity": int(qty)}]}]})
    issues = [f"{i.get('severity', '')}: {i.get('message', '')}"[:200] for i in j.get("issues") or []]
    return str(j.get("status") or ""), issues, pt


async def push_quantities() -> dict:
    plan = [p for p in await current_plan() if p["push"]]
    pushed, failed = 0, []
    for p in plan:
        doc = await db.amazon_listings.find_one({"sku": p["sku"]}, {"_id": 0, "product_type": 1})
        try:
            status, issues, pt = await asyncio.to_thread(_patch_qty, p["sku"], p["target"], (doc or {}).get("product_type"))
        except sp.AmazonError as e:
            failed.append(f"{p['sku']}: {e}"[:200])
            continue
        ok = status == "ACCEPTED"
        await db.amazon_listings.update_one({"sku": p["sku"]}, {"$set": {
            "product_type": pt, "push_status": status, "push_issues": issues, "push_at": _now().isoformat(),
            **({"pushed_qty": p["target"], "qty": p["target"]} if ok else {})}})
        if ok:
            pushed += 1
        else:
            failed.append(f"{p['sku']}: {status} {'; '.join(issues)}"[:200])
        await asyncio.sleep(0.25)   # patchListingsItem: 5 requests/second
    res = {"at": _now().isoformat(), "pushed": pushed, "failed": failed[:20]}
    await _set(last_push=res)
    return res


# ------------------------------------------------------------------ run ---
async def run_once(force_listings: bool = False) -> dict:
    """Listings (when due) -> orders -> quantities. Orders first, so the
    quantities pushed already have the newest Amazon orders taken off."""
    await ensure_indexes()
    st = await get_settings()
    out: dict = {}
    due = force_listings or not st["last_listings"] or \
        _now() - datetime.fromisoformat(st["last_listings"]["at"]) > timedelta(hours=LISTINGS_EVERY_H)
    if due:
        try:
            out["listings"] = await refresh_listings()
        except sp.AmazonError as e:
            await _error("listings", e)
            out["listings_error"] = str(e)
    if st["on"]:
        for step, fn in (("orders", pull_orders), ("push", push_quantities)):
            try:
                out[step] = await fn()
            except sp.AmazonError as e:
                await _error(step, e)
                out[f"{step}_error"] = str(e)
                if step == "orders":
                    break       # never push numbers that may be missing new Amazon orders
    if not any(k.endswith("_error") for k in out):
        await _set(last_error="")
    return out


@_jobs.handler("amz_easyship")
async def _job(p: dict) -> None:
    if ready() and (await get_settings())["on"]:
        await run_once()


def schedule_tick() -> None:
    """From the minute tick (marketing.periodic): one run per 15 minutes. The
    job itself does nothing while the switch is off."""
    if ready():
        from marketing import dispatch
        n = _now()
        dispatch("amz_easyship", dedupe=f"{n:%Y%m%d%H}-{n.minute // RUN_EVERY_MIN}")


# ---------------------------------------------------------------- admin ---
router = APIRouter(prefix="/api/admin/warehouse/amazon/easyship", tags=["amazon"], dependencies=[Depends(require_admin)])


@router.get("/status")
async def es_status():
    st = await get_settings()
    st.pop("orders_cursor", None)
    return {**st, "ready": ready(), "keys": sp.configured(), "seller_id": bool(sp._cfg()["seller_id"]),
            "listings": await db.amazon_listings.count_documents({"channel": "mfn", "gone": {"$ne": True}}),
            "attention": await db.amazon_orders.count_documents({"needs_attention": True})}


@router.get("/preview")
async def es_preview():
    return {"rows": await current_plan(), "buffer": (await get_settings())["buffer"]}


@router.get("/orders")
async def es_orders(limit: int = 100):
    rows = await db.amazon_orders.find({}, {"_id": 0}).sort("purchase_date", -1).to_list(max(1, min(500, limit)))
    return {"rows": rows}


@router.post("/listings/refresh")
async def es_refresh(user: dict = Depends(require_admin)):
    """Read-only: reads Amazon's listings report, changes nothing on Amazon."""
    if not ready():
        raise HTTPException(status_code=409, detail="Add SPAPI_SELLER_ID (your merchant token) in Render first.")
    try:
        return await refresh_listings()
    except sp.AmazonError as e:
        await _error("listings", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/run")
async def es_run(user: dict = Depends(require_superadmin)):
    """Pull orders and push quantities now (writes to Amazon: super admin)."""
    if not ready():
        raise HTTPException(status_code=409, detail="Amazon keys / merchant token are not set yet.")
    if not (await get_settings())["on"]:
        raise HTTPException(status_code=409, detail="Easy Ship sync is switched off.")
    res = await run_once()
    await audit_log(db, "AMAZON_EASYSHIP_RUN", email=user.get("email", ""), role=user.get("role", ""),
                    meta={k: (v if isinstance(v, (int, str)) else str(v)[:200]) for k, v in res.items()})
    return res


class EsSettings(BaseModel):
    on: Optional[bool] = None
    buffer: Optional[int] = None


@router.put("/settings")
async def es_settings(body: EsSettings, user: dict = Depends(require_superadmin)):
    st = await get_settings()
    upd: dict = {}
    if body.buffer is not None:
        upd["buffer"] = core.clean_buffer(body.buffer)
    if body.on is not None:
        if body.on and not ready():
            raise HTTPException(status_code=409, detail="Amazon keys / merchant token are not set yet.")
        if body.on and not st["last_listings"]:
            raise HTTPException(status_code=409, detail="Read the listings from Amazon first (Refresh listings) and check the preview.")
        upd["on"] = body.on
        if body.on and not st["orders_from"]:
            # Orders before this moment were counted by the stock sheet already.
            now = _now().isoformat()
            upd.update(orders_from=now, orders_cursor=now)
    if upd:
        await _set(**upd)
        await audit_log(db, "AMAZON_EASYSHIP_SETTINGS", email=user.get("email", ""), role=user.get("role", ""), meta=upd)
    return await get_settings()


class NoPush(BaseModel):
    push: bool


@router.put("/sku/{sku}")
async def es_sku(sku: str, body: NoPush, user: dict = Depends(require_admin)):
    sku = sku.strip()[:80]
    if not await db.amazon_listings.find_one({"sku": sku}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Unknown Amazon SKU")
    await db.amazon_sku_map.update_one({"sku": sku}, {"$set": {"sku": sku, "no_push": not body.push}}, upsert=True)
    await audit_log(db, "AMAZON_EASYSHIP_SKU", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"sku": sku, "push": body.push})
    return {"ok": True}


_indexed = {"done": False}


async def ensure_indexes() -> None:
    """Once per process (not per run: create_index is a round-trip each time)."""
    if _indexed["done"]:
        return
    _indexed["done"] = True
    try:
        await db.amazon_orders.create_index("amazon_order_id", unique=True)
        await db.amazon_listings.create_index("sku", unique=True)
    except Exception:  # noqa: BLE001
        log.warning("amazon easyship: index creation failed", exc_info=True)
