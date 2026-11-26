"""Website stock out of step with the warehouse count — put it back in step
(Nov 2026).

    POST /api/admin/warehouse/inventory/{book_id}/match-website   superadmin: {note}
    POST /api/admin/warehouse/inventory/{book_id}/set-both        superadmin: {count, note}

WHY THIS EXISTS. In live mode every stock tool moves BOTH numbers by the same
amount, on purpose:
  * Admin → Inventory / Books (typing website stock) moves the warehouse count
    by the change (warehouse.record_admin_stock_edit);
  * Warehouse → Inventory "Save count" moves the website by the change
    (warehouse._apply, touch_stock in live).
That keeps two numbers that AGREE agreeing. But once they disagree, no tool
can close the gap — each one carries it along. Seen on 19 Nov 2026 with
"Justice M N Venkatachaliah - The Man & The Judge" (HB): website 96,
warehouse 0. Typing 0 in Inventory made the warehouse −96; counting 0 in the
warehouse then added 96 to both, putting the website back at 96. Round and
round, both done correctly, never landing on 0 / 0.

This sets ONLY the website number, to what the warehouse count says it
should be — the same rule the difference column uses (warehouse_core.
owed_diff: website = warehouse + copies owed to waiting paid orders), never
below 0, and 0 for a pre-order (its stock is locked at 0). The warehouse
count is not touched: count the shelf with "Save count" first if THAT is
wrong. No ledger movement is written (nothing physical moved); the audit log
keeps who, when, before / after and why.

Its own module so warehouse.py's held changes stay separate. Live mode only:
during the trial the website follows the sheet, not the warehouse.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import order_stock
from audit import audit_log
from extensions import _notify_back_in_stock, db, require_admin, require_superadmin
from warehouse import NOT_COUNTED, _office_only, get_state

router = APIRouter(prefix="/api/admin/warehouse", tags=["warehouse-admin"], dependencies=[Depends(require_admin)])


class MatchBody(BaseModel):
    note: str


def target_stock(wh, owed: int, preorder: bool) -> int:
    """What the website should show for this warehouse count."""
    if preorder or wh is None:
        return 0
    return max(0, int(wh) + int(owed or 0))


@router.post("/inventory/{book_id}/match-website")
async def match_website(book_id: str, body: MatchBody, user: dict = Depends(require_superadmin)):
    _office_only(user)
    note = " ".join((body.note or "").split())[:300]
    if len(note) < 3:
        raise HTTPException(status_code=400, detail="Say why (e.g. 'website showed 96, shelf has none').")
    state = await get_state()
    if state.get("mode") != "live":
        raise HTTPException(status_code=409, detail="Only once the warehouse is live — during the trial the website follows the sheet.")
    b = await db.books.find_one({"id": book_id, "product_type": {"$nin": list(NOT_COUNTED)}},
                                {"_id": 0, "id": 1, "title": 1, "isbn": 1, "stock": 1, "wh_stock": 1, "coming_soon": 1})
    if not b:
        raise HTTPException(status_code=404, detail="Book not found (packs and hampers are counted per book).")
    if b.get("wh_stock") is None:
        raise HTTPException(status_code=409, detail="This book has never been counted in the warehouse — save a count first.")
    owed = (await order_stock.owed_by_book(db, since=state.get("started_at")) if state.get("started_at") else {}).get(book_id, 0)
    before = int(b.get("stock") or 0)
    after = target_stock(b["wh_stock"], owed, bool(b.get("coming_soon")))
    if before == after:
        return {"ok": True, "unchanged": True, "stock": after, "wh_stock": int(b["wh_stock"])}
    # Only if nobody sold / changed it in between (else: refresh and look again).
    res = await db.books.update_one({"id": book_id, "stock": b.get("stock")}, {"$set": {"stock": after}})
    if res.modified_count != 1:
        raise HTTPException(status_code=409, detail="The stock changed a moment ago — refresh and check again.")
    if before <= 0 < after:
        await _notify_back_in_stock({**b, "stock": after})
    await audit_log(db, "WAREHOUSE_WEBSITE_MATCHED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"book": book_id, "isbn": b.get("isbn"), "title": (b.get("title") or "")[:120], "website_before": before,
                          "website_after": after, "warehouse": int(b["wh_stock"]), "owed": int(owed or 0), "note": note})
    return {"ok": True, "stock": after, "before": before, "wh_stock": int(b["wh_stock"])}


class BothBody(BaseModel):
    count: int
    note: str


@router.post("/inventory/{book_id}/set-both")
async def set_both(book_id: str, body: BothBody, user: dict = Depends(require_superadmin)):
    """'There are N on the shelf, and the website must say so too' — in one go.

    The match above only fixes the WEBSITE side. When it's the warehouse side
    that is off (19 Nov 2026: Man & The Judge HB showed warehouse -96,
    website 0 after the admin typed 0), the admin needs the count saved AND
    the website brought along, without the count's correction pushing the
    website back up. So: the normal shelf count (warehouse.adm_set_count —
    ledger correction, set-aside copies respected), then the website matched
    to the new count. Both steps are logged as they always are."""
    _office_only(user)
    if not (0 <= int(body.count) <= 100000):
        raise HTTPException(status_code=400, detail="Enter a count between 0 and 1,00,000.")
    note = " ".join((body.note or "").split())[:200]
    if len(note) < 3:
        raise HTTPException(status_code=400, detail="Say why (e.g. 'none on the shelf — website and warehouse both 0').")
    if (await get_state()).get("mode") != "live":
        raise HTTPException(status_code=409, detail="Only once the warehouse is live — during the trial the website follows the sheet.")
    from warehouse import CountBody, adm_set_count
    # A book never counted has NO wh_stock field. adm_set_count reads it with
    # a projection of just {wh_stock}, which comes back as an empty dict —
    # falsy — and it answers "Book not found". Seen 26 Nov 2026 on the 58
    # titles added from the Title Master: none could get a first count.
    # Starting the count at 0 (only where it is missing) lets the normal
    # count run; the correction then records the full shelf number.
    await db.books.update_one({"id": book_id, "wh_stock": None, "product_type": {"$nin": list(NOT_COUNTED)}},
                              {"$set": {"wh_stock": 0}})
    counted = await adm_set_count(book_id, CountBody(count=int(body.count), note=note), user)
    matched = await match_website(book_id, MatchBody(note=f"set both to {int(body.count)}: {note}"), user)
    return {"ok": True, "count": counted, "website": matched,
            "wh_stock": matched.get("wh_stock"), "stock": matched.get("stock")}
