"""Courier runs: the office makes the label sheet here, the warehouse just packs.

WHY (Oct 2026)

The order-management team typed each day's DTDC label sheet in Word, printed
it, and the warehouse PHOTOGRAPHED the printout so the phone could read it
back (warehouse.py → Textract). Every step of that loop could lose something:
a shadow hid a label's books, "6th" came back as "Gth", "2ⁿᵈ" as "2", and the
warehouse had to find books by hand. Reading back what we ourselves wrote is
the wrong design.

Now the office builds the run in Admin → Warehouse → Courier labels:

  * a parcel per paid website order, filled from the order (address + books);
  * dealer / university orders, author copies and free copies typed in a
    simple form (or pasted from an old Word sheet — the text is exact, so the
    existing parser reads it without OCR);
  * the label sheet is printed from the system as a PDF or a Word file — the
    same layout as before (books, recipient, our "From" block), one label per
    dashed box, never split across pages;
  * "Send to warehouse" creates the courier job on the phone with every
    parcel already filled in and matched. He packs, ticks each parcel, taps
    Done. Nothing is read, nothing is matched, nothing can be misread.

Stock rules are the warehouse's own (warehouse.wh_confirm): website orders
were deducted at payment and are only marked packed; dealer orders, author
copies and free copies are deducted once, when he confirms.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import warehouse_core as core
from audit import audit_log
from courier_labels import (DEFAULT_FROM, MAX_PARCELS, RUN_KINDS, _txt, clean_parcel, labels_docx, labels_pdf,
                            problems, warehouse_parcels)
from extensions import db, require_admin
from warehouse import COURIER_DEDUCT, _catalogue, _open_web_orders, _order_items, get_state, require_warehouse

assert RUN_KINDS == set(COURIER_DEDUCT) | {"website_order"}  # the phone must know every kind the office can pick
SETTINGS_KEY = "courier_from"
ACTIVE = ("draft", "sent")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def order_parcel(o: dict, books: dict) -> dict:
    """A paid website order -> a parcel, address from the order (gift address
    when there is one — emailer.shipping_address decides, as everywhere)."""
    from emailer import shipping_address

    a = shipping_address(o)
    city = " - ".join(x for x in (a.get("city"), a.get("pincode")) if x)
    return {
        "kind": "website_order", "order_id": o["id"], "order_number": o.get("order_number", ""),
        "name": a.get("name", ""), "org": "",
        "address": "\n".join(x for x in (a.get("line1"), a.get("line2"), city, a.get("state")) if x),
        "pincode": a.get("pincode", ""), "phone": a.get("phone", ""),
        "lines": [{"book_id": it["book_id"], "label": (books.get(it["book_id"]) or {}).get("title") or it.get("title", ""),
                   "qty": it["qty"]} for it in _order_items(o) if it.get("book_id")],
        "note": "",
    }


# --------------------------------------------------------------- storage ---
async def _from_lines() -> list:
    d = await db.integrations.find_one({"key": SETTINGS_KEY}, {"_id": 0, "lines": 1}) or {}
    return d.get("lines") or DEFAULT_FROM


async def _books() -> dict:
    return {b["id"]: b for b in await _catalogue()}


async def _orders_in_other_runs(run_id: str) -> set:
    taken = set()
    async for r in db.courier_runs.find({"id": {"$ne": run_id}, "status": {"$in": list(ACTIVE)}},
                                        {"_id": 0, "parcels.order_id": 1}):
        taken |= {p.get("order_id") for p in r.get("parcels") or [] if p.get("order_id")}
    return taken


async def _get(run_id: str) -> dict:
    run = await db.courier_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Courier run not found")
    if run.get("doc_id") and run["status"] == "sent":
        d = await db.warehouse_docs.find_one({"id": run["doc_id"]}, {"_id": 0, "status": 1, "confirmed_at": 1,
                                                                    "confirmed_by": 1, "archived": 1})
        if d and d.get("status") in ("confirmed", "awaiting_approval") and not d.get("archived"):
            run.update(status="packed", packed_at=d.get("confirmed_at"), packed_by=d.get("confirmed_by"))
        elif not d or d.get("archived") or d.get("status") == "undone":
            # The job was deleted or undone in Admin → Warehouse: the run is
            # free to be recalled, fixed and sent again.
            run["job_gone"] = True
    return run


# ----------------------------------------------------------------- admin ---
admin_router = APIRouter(prefix="/api/admin/warehouse/courier-runs", tags=["courier-runs"],
                         dependencies=[Depends(require_admin)])


class RunBody(BaseModel):
    title: Optional[str] = None
    parcels: Optional[list[dict]] = None


class FromBody(BaseModel):
    lines: list[str]


class PasteBody(BaseModel):
    text: str


@admin_router.get("/settings")
async def get_settings():
    return {"from_lines": await _from_lines(), "default": DEFAULT_FROM}


@admin_router.put("/settings")
async def put_settings(body: FromBody, user: dict = Depends(require_admin)):
    lines = [x for x in (_txt(s, 120) for s in body.lines[:6]) if x] or DEFAULT_FROM
    await db.integrations.update_one({"key": SETTINGS_KEY}, {"$set": {"key": SETTINGS_KEY, "lines": lines,
                                                                     "by": user.get("email", ""), "at": _now()}},
                                     upsert=True)
    return {"from_lines": lines}


@admin_router.get("")
async def list_runs():
    out = []
    async for r in db.courier_runs.find({"status": {"$ne": "discarded"}}, {"_id": 0, "id": 1}).sort("created_at", -1).limit(60):
        run = await _get(r["id"])
        out.append({k: run.get(k) for k in ("id", "title", "status", "created_at", "created_by", "sent_at", "packed_at")}
                   | {"parcels": len(run.get("parcels") or []),
                      "copies": sum(int(ln.get("qty") or 0) for p in run.get("parcels") or [] for ln in p.get("lines") or [])})
    return {"runs": out}


@admin_router.post("")
async def create_run(body: RunBody, user: dict = Depends(require_admin)):
    run = {"id": str(uuid.uuid4()), "title": _txt(body.title, 80) or f"Courier {datetime.now():%d.%m.%Y}",
           "status": "draft", "parcels": [], "created_at": _now(), "created_by": user.get("email", ""), "doc_id": ""}
    await db.courier_runs.insert_one(dict(run))
    return run


@admin_router.get("/orders")
async def open_orders(run_id: str = ""):
    """Paid website orders not yet packed and not already on another run —
    each ready to drop into the run as a filled-in parcel."""
    books, taken = await _books(), await _orders_in_other_runs(run_id)
    full = {o["id"]: o async for o in db.orders.find(
        {"id": {"$in": [o["id"] for o in await _open_web_orders()]}}, {"_id": 0})}
    out = [order_parcel(o, books) | {"created_at": o.get("created_at", "")}
           for o in full.values() if o["id"] not in taken]
    out.sort(key=lambda x: x["created_at"])
    return {"orders": out}


@admin_router.get("/{run_id}")
async def get_run(run_id: str):
    run = await _get(run_id)
    run["problems"] = problems(run.get("parcels") or [], await _books())
    return run


@admin_router.put("/{run_id}")
async def save_run(run_id: str, body: RunBody, user: dict = Depends(require_admin)):
    run = await _get(run_id)
    if run["status"] != "draft":
        raise HTTPException(status_code=409, detail="This run is with the warehouse. Recall it first to change it.")
    upd = {"updated_at": _now(), "updated_by": user.get("email", "")}
    if body.title is not None:
        upd["title"] = _txt(body.title, 80) or run["title"]
    if body.parcels is not None:
        if len(body.parcels) > MAX_PARCELS:
            raise HTTPException(status_code=400, detail=f"At most {MAX_PARCELS} parcels in one run.")
        upd["parcels"] = [clean_parcel(p, i) for i, p in enumerate(body.parcels, start=1)]
    await db.courier_runs.update_one({"id": run_id}, {"$set": upd})
    return await get_run(run_id)


@admin_router.post("/{run_id}/paste")
async def paste_text(run_id: str, body: PasteBody):
    """Text copied from an old Word label sheet -> parcels to add (not saved).
    Typed text, not a photo, so it is read exactly; books are matched to the
    catalogue and anything unsure is left for the office to pick."""
    await _get(run_id)
    books = await _catalogue()
    orders = await _open_web_orders()
    out = []
    for p in core.parse_courier_text(body.text[:60000], core.title_matcher(books))[:MAX_PARCELS]:
        o = core.match_order(p, orders)
        lines = []
        for ln in p["lines"]:
            m = core.match_line(ln, books)
            lines.append({"book_id": m["book_id"], "label": ln["title"], "qty": ln.get("qty") or 1,
                          "candidates": m["candidates"]})
        out.append({"kind": "website_order" if o else "", "order_id": (o or {}).get("id", ""),
                    "order_number": (o or {}).get("order_number", ""), "name": p.get("name", ""),
                    "org": p.get("org", ""),
                    "address": "\n".join(a for a in p.get("address", []) if a not in (p.get("name"), p.get("org"))
                                         and not core.PHONE_LINE_RE.search(a)),
                    "pincode": p.get("pincode", ""), "phone": p.get("phone", ""), "lines": lines, "note": ""})
    return {"parcels": out}


@admin_router.post("/{run_id}/send")
async def send_run(run_id: str, user: dict = Depends(require_admin)):
    """Hand the run to the warehouse phone as a filled-in courier job."""
    run = await _get(run_id)
    if run["status"] != "draft":
        raise HTTPException(status_code=409, detail="Already with the warehouse.")
    books = await _books()
    issues = problems(run.get("parcels") or [], books)
    open_by_id = {o["id"]: o for o in await _open_web_orders()}
    taken = await _orders_in_other_runs(run_id)
    for p in run.get("parcels") or []:
        if p.get("kind") == "website_order" and p.get("order_id"):
            if p["order_id"] not in open_by_id:
                issues.append(f"Parcel {p['no']}: order {p.get('order_number') or ''} is no longer paid-and-waiting "
                              "(already packed, shipped or cancelled).")
            elif p["order_id"] in taken:
                issues.append(f"Parcel {p['no']}: order {p.get('order_number') or ''} is already on another courier run.")
    if issues:
        raise HTTPException(status_code=400, detail={"code": "run_problems", "problems": issues})
    if (await get_state())["mode"] == "off":
        raise HTTPException(status_code=409, detail="The warehouse trial has not been started — start it in the Trial tab first.")
    parcels, read = warehouse_parcels(run["parcels"], books,
                                      {oid: _order_items(o) for oid, o in open_by_id.items()})
    doc = {
        "id": str(uuid.uuid4()), "direction": "courier", "practice": False, "from_office": True, "archived": False,
        "status": "draft", "created_at": _now(), "created_by": user.get("email", ""),
        "source": "office_run", "run_id": run_id, "file_path": "", "file_type": "", "sha256": "",
        "doc_number": run["title"], "party_name": "", "party_gstin": "", "party_kind": "", "total_qty": None,
        "read_lines": read, "parcels": parcels, "labels_seen": len(parcels), "error": "", "test_case": False,
        "reports": [],
    }
    await db.warehouse_docs.insert_one(dict(doc))
    await db.courier_runs.update_one({"id": run_id}, {"$set": {"status": "sent", "doc_id": doc["id"], "sent_at": _now(),
                                                              "sent_by": user.get("email", "")}})
    await audit_log(db, "COURIER_RUN_SENT", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"run": run_id, "doc": doc["id"], "parcels": len(parcels)})
    return await get_run(run_id)


@admin_router.post("/{run_id}/recall")
async def recall_run(run_id: str, user: dict = Depends(require_admin)):
    """Take a run back from the phone to change it — only while he has not
    confirmed it (then stock has moved and it is a warehouse correction)."""
    run = await _get(run_id)
    if run["status"] != "sent":
        raise HTTPException(status_code=409, detail="Only a run that is with the warehouse and not yet packed can be recalled.")
    res = await db.warehouse_docs.update_one({"id": run["doc_id"], "status": "draft"},
                                             {"$set": {"archived": True, "recalled_at": _now(),
                                                       "recalled_by": user.get("email", "")}})
    if res.modified_count != 1 and not run.get("job_gone"):
        raise HTTPException(status_code=409, detail="The warehouse has already packed it.")
    await db.courier_runs.update_one({"id": run_id}, {"$set": {"status": "draft", "doc_id": ""}})
    return await get_run(run_id)


@admin_router.post("/{run_id}/discard")
async def discard_run(run_id: str):
    run = await _get(run_id)
    if run["status"] != "draft":
        raise HTTPException(status_code=409, detail="Recall it from the warehouse first.")
    await db.courier_runs.update_one({"id": run_id}, {"$set": {"status": "discarded", "discarded_at": _now()}})
    return {"ok": True}


def _file(data: bytes, fmt: str, title: str) -> Response:
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", title or "courier-labels").strip("-") or "courier-labels"
    ctype = "application/pdf" if fmt == "pdf" else \
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return Response(content=data, media_type=ctype, headers={
        "Content-Disposition": f'attachment; filename="{name}.{fmt}"', "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"})


async def _labels(parcels: list, fmt: str, title: str) -> Response:
    if fmt not in ("pdf", "docx"):
        raise HTTPException(status_code=404, detail="Use .pdf or .docx")
    if not parcels:
        raise HTTPException(status_code=400, detail="No parcels to print.")
    from_lines = await _from_lines()
    import asyncio
    data = await asyncio.to_thread(labels_pdf if fmt == "pdf" else labels_docx, parcels, from_lines,
                                   *([title] if fmt == "pdf" else []))
    return _file(data, fmt, title)


@admin_router.get("/{run_id}/labels.{fmt}")
async def run_labels(run_id: str, fmt: str):
    run = await _get(run_id)
    return await _labels(run.get("parcels") or [], fmt, run["title"])


# ----------------------------------------------------------------- phone ---
phone_router = APIRouter(prefix="/api/warehouse", tags=["courier-runs"])


@phone_router.get("/docs/{doc_id}/labels.{fmt}")
async def phone_labels(doc_id: str, fmt: str, _: dict = Depends(require_warehouse)):
    """The warehouse prints the labels for a run the office sent."""
    doc = await db.warehouse_docs.find_one({"id": doc_id, "source": "office_run"}, {"_id": 0, "run_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="No labels for this job.")
    run = await db.courier_runs.find_one({"id": doc["run_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="No labels for this job.")
    return await _labels(run.get("parcels") or [], fmt, run["title"])
