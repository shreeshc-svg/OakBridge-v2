"""Abandoned-cart reminders (Nov 2026 rules).

WHAT THE STORE ASKED FOR
  * Sent AUTOMATICALLY — the worker runs this every hour (marketing.periodic
    dispatches job "cart_reminders"). Before this, the only trigger was an
    outside cron calling /api/tasks/cart-reminders, so whether reminders went
    at all depended on something outside this repo. That endpoint still works
    and is safe to keep: every send is claimed atomically below, so the two
    can never double-send.
  * At most 3 reminders per cart, each 1–2 days apart:
        #1  24 h after a book was added to the cart
        #2  at least 24 h after #1
        #3  at least 24 h after #2 (the copy says it's the last one)
    Reminders only go out 10:00–19:59 IST, so a reminder that falls due at
    night waits for the morning — that is what keeps the gap between 1 and 2
    days instead of exactly 24 h at 3 a.m.
  * Customers only. Anyone with an office role (rbac.ADMIN_ROLES: superadmin,
    manager, editor, fulfilment, warehouse …) or listed in the HRM as an
    employee (by account or work email) is never reminded.

WHAT RESETS THE COUNT
  Adding a NEW book to the cart (features.save_my_cart). Re-saving the same
  cart, changing a quantity or removing a book does not — otherwise a cart
  that the site re-syncs on every visit would restart the 3 reminders forever.

Unchanged: someone with an unpaid order in the last 3 days is skipped (the
abandoned-checkout / payment-link emails cover them), the email itself
(emailer.send_cart_reminder — switchable in Admin → Email Manager), and one
WhatsApp per cart for opted-in customers (interakt.on_cart_reminder).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger("oakbridge.cart_reminders")

MAX_REMINDERS = 3
FIRST_AFTER = timedelta(hours=24)
GAP = timedelta(hours=24)
SEND_HOURS_IST = range(10, 20)          # 10:00–19:59 IST
IST = timedelta(hours=5, minutes=30)
# Email copy per reminder (emailer._CART_COPY keys; "eom" = "this is the last
# reminder we'll send"). Key names are historical.
COPY = ("12h", "1w", "eom")


def _dt(v) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(v))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def sent_count(cart: dict) -> int:
    """Reminders already sent for this cart. Older carts only have the
    reminders_sent list (the old 12h/1w/eom scheme could mark several at
    once), so take the larger of the two."""
    return max(int(cart.get("reminder_count") or 0), len(cart.get("reminders_sent") or []))


def due(cart: dict, now: datetime, *, force: bool = False) -> Optional[int]:
    """Index (0, 1, 2) of the reminder due now, or None."""
    if not cart.get("items"):
        return None
    n = sent_count(cart)
    if n >= MAX_REMINDERS:
        return None
    if force:
        return n
    if (now + IST).hour not in SEND_HOURS_IST:
        return None
    ref = _dt(cart.get("last_reminder_at")) if n else None
    ref = ref or _dt(cart.get("updated_at"))
    if not ref:
        return None
    return n if now - ref >= (GAP if n else FIRST_AFTER) else None


def is_staff(user: dict, staff_ids: set, staff_emails: set) -> bool:
    import rbac
    return (user.get("role") or "") in rbac.ADMIN_ROLES or user.get("id") in staff_ids \
        or (user.get("email") or "").strip().lower() in staff_emails


async def process(db, *, force: bool = False, now: Optional[datetime] = None) -> dict:
    from emailer import send_cart_reminder        # late import avoids a cycle
    now = now or datetime.now(timezone.utc)
    result = {"scanned": 0, "sent": 0, "skipped_staff": 0, "by_reminder": {1: 0, 2: 0, 3: 0}}
    staff_ids, staff_emails = set(), set()
    async for p in db.hr_employees.find({}, {"_id": 0, "user_id": 1, "work_email": 1}):
        if p.get("user_id"):
            staff_ids.add(p["user_id"])
        if p.get("work_email"):
            staff_emails.add(p["work_email"].strip().lower())
    recent = (now - timedelta(days=3)).isoformat()
    async for c in db.carts.find({"items.book_id": {"$exists": True}}, {"_id": 0}):   # non-empty carts
        result["scanned"] += 1
        k = due(c, now, force=force)
        if k is None:
            continue
        u = await db.users.find_one({"id": c["user_id"]}, {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1})
        if not u or not u.get("email"):
            continue
        if is_staff(u, staff_ids, staff_emails):
            result["skipped_staff"] += 1
            continue
        # Reached checkout and didn't pay in the last 3 days: the abandoned-
        # checkout / payment-link emails are on it; a cart reminder as well
        # reads as being chased. Not counted, so it still goes later.
        if not force and await db.orders.find_one(
                {"user_id": c["user_id"], "payment_status": {"$ne": "paid"}, "created_at": {"$gte": recent}}, {"_id": 1}):
            continue
        # Claim it BEFORE sending: only one runner (worker, cron, admin button)
        # can move this cart from n to n+1 sent.
        before = {"reminders_sent": list(c.get("reminders_sent") or []), "reminder_count": c.get("reminder_count"),
                  "last_reminder_at": c.get("last_reminder_at")}
        q = {"user_id": c["user_id"], "updated_at": c.get("updated_at"),
             "reminder_count": {"$in": [c.get("reminder_count")] if c.get("reminder_count") is not None else [None]}}
        claim = await db.carts.update_one(q, {"$set": {"reminder_count": k + 1, "last_reminder_at": now.isoformat(),
                                                       "reminders_sent": before["reminders_sent"] + [COPY[k]]}})
        if not claim.modified_count:
            continue
        try:
            ok = await send_cart_reminder(u["email"], u.get("name", ""), c.get("items", []), COPY[k])
        except Exception:  # noqa: BLE001
            log.exception("cart reminder email failed for %s", u.get("email"))
            ok = False
        if ok is False:
            # Not sent (mail error, or switched off in Email Manager): undo the
            # claim so it isn't counted as one of the three.
            await db.carts.update_one({"user_id": c["user_id"]}, {"$set": before})
            continue
        if k == 0:
            try:      # one WhatsApp per cart, opted-in customers only; never raises
                from interakt import on_cart_reminder
                await on_cart_reminder(c["user_id"], c.get("items", []), c.get("updated_at", ""))
            except Exception:  # noqa: BLE001
                log.warning("cart reminder whatsapp failed", exc_info=True)
        result["sent"] += 1
        result["by_reminder"][k + 1] += 1
    log.info("cart reminders: %s", result)
    return result


try:
    import jobs as _jobs

    @_jobs.handler("cart_reminders")
    async def _job(p: dict) -> None:
        from extensions import db
        await process(db)
except Exception:  # noqa: BLE001
    pass
