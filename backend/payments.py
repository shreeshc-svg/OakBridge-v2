"""
Razorpay payment integration for Oakbridge Publishing.

Endpoints:
- POST /api/payments/create-order           — Create a Razorpay order for the given amount (paise)
- POST /api/payments/verify                 — Verify HMAC signature and mark the local order as paid
- POST /api/webhooks/razorpay               — Razorpay webhook for async confirmation (optional)
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import razorpay
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from extensions import db
from emailer import send_admin_failed_order, send_admin_paid_order, send_order_failed, send_order_receipt


logger = logging.getLogger(__name__)


async def _with_item_specs(order: dict) -> dict:
    """Attach ISBN + edition to each line item before an internal alert goes out.

    Order items are a checkout-time snapshot (title/author/price/qty only), so the
    packing email would otherwise omit the two fields needed to pick the right
    stock. Never raises — an email is worth more than perfect metadata.
    """
    try:
        ids = [it.get("book_id") for it in (order.get("items") or []) if it.get("book_id")]
        if not ids:
            return order
        books = await db.books.find(
            {"id": {"$in": ids}}, {"_id": 0, "id": 1, "isbn": 1, "edition": 1, "author": 1}
        ).to_list(None)
        by_id = {b["id"]: b for b in books}
        for it in order.get("items") or []:
            b = by_id.get(it.get("book_id"))
            if not b:
                continue
            it.setdefault("isbn", b.get("isbn"))
            it.setdefault("edition", b.get("edition"))
            if not it.get("author"):
                it["author"] = b.get("author")
    except Exception:  # noqa: BLE001
        logger.exception("Could not enrich order items for %s", order.get("id"))
    return order


RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET")  # optional

if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
    logger.warning("Razorpay keys not configured — payment endpoints will return 503")
    _client: Optional[razorpay.Client] = None
else:
    _client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    _client.set_app_details({"title": "Oakbridge Publishing", "version": "1.0.0"})

payments_router = APIRouter(prefix="/payments", tags=["payments"])
webhooks_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ====== Payment record ======
#
# WHY AN EVENT LOG
#
# payment_status was a single field that every code path overwrote. A capture
# followed by a late failure event left an order marked failed with the money
# collected, and nothing anywhere said it had ever been paid. Webhooks are not
# ordered and not delivered exactly once, so that was a matter of timing rather
# than bad luck.
#
# Every message Razorpay sends is now appended here and never modified. The
# order keeps a current status for the site to read; this collection keeps the
# history that says how it got there, which is the only thing that can answer
# "was this really paid?" after the fact.
PAYMENT_EVENTS = "payment_events"


async def _log_payment_event(**fields) -> None:
    """Append one immutable line to the payment history. Never raises."""
    try:
        await db[PAYMENT_EVENTS].insert_one(
            {"id": str(uuid.uuid4()), "at": datetime.now(timezone.utc).isoformat(), **fields}
        )
    except Exception:  # noqa: BLE001
        # A lost audit line must never cost a customer their confirmation.
        logger.exception("Could not record payment event %s", fields.get("event"))


# Razorpay retries a refused webhook, and a misconfiguration refuses every event
# from every customer. Without a throttle the first bad hour would send hundreds
# of identical emails, which is its own kind of silence.
#
# Keyed BY REASON, because otherwise anyone posting one bad-signature request an
# hour would permanently hold the only alert slot and a genuine missing-secret
# outage would stay quiet.
#
# time.monotonic(), and None rather than 0.0 for "never sent": the monotonic
# clock counts from boot on every platform we run on, so 0.0 is a real timestamp
# an hour after the host started. Any machine that came up in the last hour
# WITHOUT the secret set — precisely when this alert earns its keep — would have
# had its first and only alert swallowed.
#
# The read and the write have no await between them, and render.yaml runs a
# single uvicorn worker, so this needs no lock. Adding --workers would make it
# one email per worker per hour.
# Razorpay's own payloads are a couple of KB.
MAX_WEBHOOK_BODY = 64 * 1024

_WEBHOOK_ALERT_INTERVAL = 3600.0
_last_webhook_alert: dict = {}


async def _alert_webhook_problem(reason_key: str, reason: str, detail: str = "") -> bool:
    """Email that webhooks are being refused, at most once an hour per cause.

    Returns whether it actually sent, so the caller can throttle its audit row
    on the same gate — the refusal log is an unauthenticated insert, and an
    unthrottled one is a way to grow the collection without bound.
    """
    global _last_webhook_alert
    now = time.monotonic()
    last = _last_webhook_alert.get(reason_key)
    if last is not None and now - last < _WEBHOOK_ALERT_INTERVAL:
        return False
    _last_webhook_alert[reason_key] = now
    try:
        from emailer import send_admin_webhook_alert  # late import avoids a cycle

        await send_admin_webhook_alert(reason, detail)
    except Exception:  # noqa: BLE001
        logger.exception("Could not send webhook alert email")
    return True


def _expected_paise(order: dict) -> int:
    """What this order should cost, in the units Razorpay speaks."""
    return int(round(float(order.get("total") or 0) * 100))


async def _fetch_payment(payment_id: str) -> Optional[dict]:
    """Ask Razorpay what it actually captured.

    The browser hands us a signature, not an amount, so without this the site
    would still be recording revenue from what the cart said rather than from
    what was collected. Runs off the event loop because the SDK is synchronous.
    Never raises: a confirmation is worth more than a verified figure, and the
    reconciliation job backfills anything missed here.
    """
    if not _client or not payment_id:
        return None
    try:
        # The SDK sets no default timeout and does not retry, so without this a
        # stalled connection holds the customer on 'verifying payment' after the
        # money has left, and the except below never fires — a hang is not an
        # exception. Ten seconds, then fall back to confirming without a figure.
        return await asyncio.to_thread(_client.payment.fetch, payment_id, timeout=10)
    except Exception:  # noqa: BLE001
        logger.exception("Could not fetch Razorpay payment %s", payment_id)
        return None


async def _settle_capture(
    order: dict,
    payment_id: Optional[str],
    amount_paise: Optional[int],
    source: str,
) -> bool:
    """Record a confirmed capture against an order. Returns True if it mismatched.

    Money arriving always wins, so this writes unconditionally — a capture
    reaching us twice (browser and webhook both fire) is not a conflict, and the
    second one carries the same facts. What it must never do is lose the amount:
    that is what revenue is summed from.
    """
    expected = _expected_paise(order)
    mismatch = amount_paise is not None and amount_paise != expected

    # Money: always written. A capture reaching us twice (browser and webhook
    # both fire) is not a conflict — the second carries the same facts, and
    # losing the amount would lose what revenue is summed from.
    money = {
        "payment_status": "paid",
        "payment_provider": "razorpay",
        "payment_source": source,
    }
    if payment_id:
        money["rzp_payment_id"] = payment_id
    if amount_paise is not None:
        money["amount_captured_paise"] = int(amount_paise)
        money["amount_expected_paise"] = expected
        # Flagged, not hidden, and NOT silently counted as the cart's figure.
        money["amount_mismatch"] = mismatch
    await db.orders.update_one({"id": order["id"]}, {"$set": money})

    # Fulfilment and the moment of payment: FIRST capture only.
    #
    # `status` is the dispatch field the team drives by hand — confirmed,
    # processing, shipped, delivered. Writing it unconditionally meant a
    # redelivered webhook, which Razorpay sends freely, could reset an order the
    # warehouse had already marked shipped back to confirmed, and move paid_at to
    # the redelivery. Guarded on the order not already being paid.
    await db.orders.update_one(
        {"id": order["id"], "status": {"$in": [None, "pending", "confirmed"]}},
        {"$set": {"status": "confirmed"}},
    )
    await db.orders.update_one(
        {"id": order["id"], "paid_at": {"$in": [None, ""]}},
        {"$set": {"paid_at": datetime.now(timezone.utc).isoformat()}},
    )

    if mismatch:
        logger.error(
            "Captured amount %s != expected %s for order %s",
            amount_paise,
            expected,
            order.get("order_number") or order["id"],
        )
    return mismatch


def _require_client() -> razorpay.Client:
    if _client is None:
        raise HTTPException(
            status_code=503,
            detail="Payment gateway not configured.",
        )
    return _client


async def _claim_once(order_id: str, flag: str) -> bool:
    """Atomically claim a one-time side effect for an order. True only for the winner.

    A paid order is confirmed twice — synchronously by /payments/verify when the
    browser returns from Checkout, and asynchronously by the payment.captured
    webhook. Stock already had this protection; the emails did not, so every order
    sent two customer receipts (two invoice PDFs) and two admin alerts.

    The claim is the Mongo update itself, so whichever path arrives first wins even
    if both run at the same instant.
    """
    res = await db.orders.update_one(
        {"id": order_id, flag: {"$ne": True}},
        {"$set": {flag: True}},
    )
    return res.modified_count == 1


async def _apply_stock_decrement(order_id: str) -> None:
    """Idempotently decrement stock for each item, once, on first paid confirmation."""
    claim = await db.orders.update_one(
        {"id": order_id, "stock_decremented": {"$ne": True}},
        {"$set": {"stock_decremented": True}},
    )
    if claim.modified_count != 1:
        return  # already decremented, or order missing
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "items": 1, "coupon_code": 1})
    if not order:
        return
    # Count coupon usage once (idempotent via the stock_decremented claim above).
    code = order.get("coupon_code")
    if code:
        await db.coupons.update_one({"code": code}, {"$inc": {"used_count": 1}})
    for it in order.get("items", []):
        bid = it.get("book_id")
        qty = int(it.get("quantity", 0) or 0)
        if not bid or qty <= 0:
            continue
        res = await db.books.update_one(
            {"id": bid, "stock": {"$gte": qty}},
            {"$inc": {"stock": -qty}},
        )
        if res.modified_count == 0:
            logger.warning("Insufficient stock at capture for book=%s order=%s — flagged backorder", bid, order_id)
            await db.orders.update_one(
                {"id": order_id},
                {"$addToSet": {"backorder_items": bid}, "$set": {"needs_attention": True}},
            )


class CreateOrderRequest(BaseModel):
    order_id: str = Field(..., description="Local Oakbridge order id (from db.orders)")


class CreateOrderResponse(BaseModel):
    rzp_order_id: str
    amount: int  # paise
    currency: str
    key_id: str
    order_number: str


@payments_router.post("/create-order", response_model=CreateOrderResponse)
async def create_payment_order(payload: CreateOrderRequest):
    """Create a Razorpay order tied to an existing local Oakbridge order."""
    client = _require_client()

    order = await db.orders.find_one({"id": payload.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Order is already paid")

    # Razorpay expects amounts in the smallest currency unit (paise for INR)
    amount_paise = int(round(float(order["total"]) * 100))
    if amount_paise <= 0:
        raise HTTPException(status_code=400, detail="Order total must be positive")

    try:
        rzp_order = client.order.create(
            {
                "amount": amount_paise,
                "currency": "INR",
                "receipt": order["order_number"],
                "notes": {
                    "oakbridge_order_id": order["id"],
                    "email": order.get("email", ""),
                },
            }
        )
    except razorpay.errors.BadRequestError as e:
        raise HTTPException(status_code=400, detail=f"Razorpay error: {e}")
    except Exception as e:  # noqa: BLE001
        logger.exception("Razorpay order creation failed")
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {e}")

    await db.orders.update_one(
        {"id": order["id"]},
        {
            "$set": {
                "rzp_order_id": rzp_order["id"],
                "payment_status": "pending",
                "payment_provider": "razorpay",
                "payment_initiated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    return CreateOrderResponse(
        rzp_order_id=rzp_order["id"],
        amount=amount_paise,
        currency="INR",
        key_id=RAZORPAY_KEY_ID,
        order_number=order["order_number"],
    )


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@payments_router.post("/verify")
async def verify_payment(payload: VerifyPaymentRequest):
    """Verify the HMAC signature returned by Razorpay Checkout and mark the order as paid."""
    client = _require_client()
    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": payload.razorpay_order_id,
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            }
        )
    except razorpay.errors.SignatureVerificationError:
        # Record it, do NOT act on it.
        #
        # This endpoint is unauthenticated, so the previous behaviour — marking
        # the order failed — let anyone who knew a Razorpay order id flip a
        # genuinely paid order to failed and delete it from revenue. A bad
        # signature is evidence about the CALLER, not about the payment.
        await _log_payment_event(
            event="verify.signature_mismatch",
            source="browser",
            rzp_order_id=payload.razorpay_order_id,
            rzp_payment_id=payload.razorpay_payment_id,
            signature_ok=False,
            note="rejected; order left untouched",
        )
        raise HTTPException(status_code=400, detail="Signature verification failed")

    order = await db.orders.find_one(
        {"rzp_order_id": payload.razorpay_order_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for this Razorpay order id")

    # Ask Razorpay what it actually took, rather than assuming the cart total.
    #
    # A valid signature proves the order/payment pair is genuine. It says nothing
    # about capture: an authorised payment is money committed but not collected,
    # and a refused or refunded one is no money at all. Recording either as a
    # captured figure would put revenue back to guessing.
    detail = await _fetch_payment(payload.razorpay_payment_id)
    rzp_state = detail.get("status") if isinstance(detail, dict) else None
    amount_paise = detail.get("amount") if isinstance(detail, dict) else None

    if rzp_state in ("failed", "refunded"):
        await _log_payment_event(
            event="verify.not_paid",
            source="browser",
            order_id=order["id"],
            order_number=order.get("order_number"),
            rzp_order_id=payload.razorpay_order_id,
            rzp_payment_id=payload.razorpay_payment_id,
            rzp_status=rzp_state,
            signature_ok=True,
            note="signature valid but Razorpay does not hold this as paid",
        )
        raise HTTPException(status_code=400, detail="Payment was not completed")

    if rzp_state is not None and rzp_state != "captured":
        # Authorised, or a slower method still settling. The customer HAS paid,
        # so the order is confirmed and the receipt goes out — but no captured
        # amount is recorded, and the flag stays until the webhook or the
        # reconciliation job sees the capture. Refusing to confirm here instead
        # would mean a webhook outage silently costs paying customers their
        # receipt, which is the worse of the two failures.
        amount_paise = None
        await db.orders.update_one(
            {"id": order["id"]}, {"$set": {"capture_unconfirmed": True, "rzp_status": rzp_state}}
        )
    elif rzp_state == "captured":
        await db.orders.update_one(
            {"id": order["id"]}, {"$set": {"capture_unconfirmed": False, "rzp_status": rzp_state}}
        )

    await db.orders.update_one(
        {"id": order["id"]}, {"$set": {"rzp_signature": payload.razorpay_signature}}
    )
    mismatch = await _settle_capture(order, payload.razorpay_payment_id, amount_paise, "browser")

    await _log_payment_event(
        event="verify.captured",
        source="browser",
        order_id=order["id"],
        order_number=order.get("order_number"),
        rzp_order_id=payload.razorpay_order_id,
        rzp_payment_id=payload.razorpay_payment_id,
        amount_paise=amount_paise,
        expected_paise=_expected_paise(order),
        amount_mismatch=mismatch,
        signature_ok=True,
        rzp_status=(detail or {}).get("status"),
    )

    # Decrement inventory once payment is confirmed (idempotent).
    await _apply_stock_decrement(order["id"])

    # Fire-and-forget order receipt + admin notification (best-effort; never block the response)
    try:
        refreshed = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
        if refreshed and await _claim_once(order["id"], "paid_emails_sent"):
            pdf = None
            try:  # invoice is best-effort — never let it block the receipt email
                from invoice import build_order_invoice

                pdf = await build_order_invoice(db, refreshed)
            except Exception:  # noqa: BLE001
                logger.exception("Invoice build failed for order %s (sending receipt without it)", order["id"])
            await send_order_receipt(refreshed, invoice_pdf=pdf or None)
            await send_admin_paid_order(await _with_item_specs(refreshed))
    except Exception:  # noqa: BLE001
        logger.exception("Order receipt email failed for order %s", order["id"])

    return {"ok": True, "order_id": order["id"]}


@webhooks_router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(None),
):
    """Async confirmation from Razorpay. Configure the webhook URL in Razorpay Dashboard."""
    # This URL is public and unauthenticated by nature — the signature IS the
    # authentication, and it cannot be checked before the body is read, because
    # the body is what is signed. Bound the read so an anonymous caller cannot
    # make us buffer an arbitrary payload first.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_WEBHOOK_BODY:
        raise HTTPException(status_code=413, detail="Payload too large")
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BODY:
        raise HTTPException(status_code=413, detail="Payload too large")

    # FAIL CLOSED.
    #
    # This endpoint used to process events with no signature check whenever the
    # secret was unset — it logged a warning and carried on. Since the URL is
    # public and a customer is handed their own Razorpay order id at checkout,
    # that let anyone mark their own order paid: stock decremented, receipt sent,
    # book packed, nothing collected. It ran that way for months because a log
    # line is not a person telling you something is wrong.
    #
    # An unverifiable event is now refused, and someone is emailed about it.
    if not RAZORPAY_WEBHOOK_SECRET:
        logger.error("Razorpay webhook refused: RAZORPAY_WEBHOOK_SECRET is not set")
        # Audit row rides the same hourly gate as the email. Writing one per
        # refusal would let an anonymous caller grow the collection at will.
        if await _alert_webhook_problem(
            "no_secret",
            "RAZORPAY_WEBHOOK_SECRET is not set on the API service.",
            "Every webhook is being refused until it is. Nothing can be forged, but nothing "
            "can be confirmed asynchronously either.",
        ):
            await _log_payment_event(
                event="webhook.refused", source="webhook", reason="no_secret", signature_ok=False
            )
        # 503, not 400: this is our misconfiguration, and Razorpay retries on 5xx,
        # so the events can still land once the secret is in place.
        raise HTTPException(status_code=503, detail="Webhook not configured")

    if not x_razorpay_signature:
        if await _alert_webhook_problem(
            "missing_signature", "A webhook arrived with no signature header at all."
        ):
            await _log_payment_event(
                event="webhook.refused", source="webhook", reason="missing_signature", signature_ok=False
            )
        raise HTTPException(status_code=400, detail="Missing webhook signature")

    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_razorpay_signature):
        logger.error("Razorpay webhook refused: signature mismatch")
        if await _alert_webhook_problem(
            "bad_signature",
            "A Razorpay webhook arrived with a signature we could not verify.",
            "If every delivery is failing, the Secret on the Razorpay webhook and "
            "RAZORPAY_WEBHOOK_SECRET do not match. If deliveries are otherwise fine, "
            "something else is posting to this URL.",
        ):
            await _log_payment_event(
                event="webhook.refused", source="webhook", reason="bad_signature", signature_ok=False
            )
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        event = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("event", "")
    payment = (event.get("payload", {}) or {}).get("payment", {}).get("entity") or {}
    rzp_order_id = payment.get("order_id")
    rzp_payment_id = payment.get("id")

    if not rzp_order_id:
        return {"received": True, "ignored": "no_order_id"}

    order_doc = await db.orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0})

    await _log_payment_event(
        event=event_type,
        source="webhook",
        order_id=(order_doc or {}).get("id"),
        order_number=(order_doc or {}).get("order_number"),
        rzp_order_id=rzp_order_id,
        rzp_payment_id=rzp_payment_id,
        amount_paise=payment.get("amount"),
        rzp_status=payment.get("status"),
        error_description=payment.get("error_description"),
        signature_ok=bool(RAZORPAY_WEBHOOK_SECRET),
    )

    if event_type == "payment.captured":
        if not order_doc:
            return {"received": True, "ignored": "unknown_order"}
        await _settle_capture(order_doc, rzp_payment_id, payment.get("amount"), "webhook")
        res_matched = 1

    elif event_type == "payment.failed":
        # A failure must NEVER unseat a capture.
        #
        # Webhooks arrive unordered and more than once. A customer whose first
        # attempt fails and second succeeds generates both events, and the old
        # code wrote whichever landed last — so a paid order could end up marked
        # failed with the money collected, quietly removing it from revenue.
        res = await db.orders.update_one(
            {"rzp_order_id": rzp_order_id, "payment_status": {"$ne": "paid"}},
            {
                "$set": {
                    "payment_provider": "razorpay",
                    "payment_status": "failed",
                    "rzp_payment_id": rzp_payment_id,
                    "payment_failure_reason": payment.get("error_description"),
                }
            },
        )
        res_matched = res.matched_count
        if not res_matched and order_doc:
            logger.info(
                "Ignored payment.failed for already-paid order %s",
                order_doc.get("order_number") or order_doc.get("id"),
            )

    else:
        return {"received": True, "ignored": event_type}

    # Send receipt + admin notification only on a captured payment
    if event_type == "payment.captured" and res_matched:
        try:
            fresh = await db.orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0})
            if fresh:
                await _apply_stock_decrement(fresh["id"])
            if fresh and await _claim_once(fresh["id"], "paid_emails_sent"):
                pdf = None
                try:  # invoice is best-effort — never let it block the receipt email
                    from invoice import build_order_invoice

                    pdf = await build_order_invoice(db, fresh)
                except Exception:  # noqa: BLE001
                    logger.exception("Invoice build failed for %s (sending receipt without it)", rzp_order_id)
                await send_order_receipt(fresh, invoice_pdf=pdf or None)
                await send_admin_paid_order(await _with_item_specs(fresh))
        except Exception:  # noqa: BLE001
            logger.exception("Webhook receipt email failed for rzp_order_id=%s", rzp_order_id)

    # Email the customer a "payment failed" note.
    #
    # res_matched is already the answer to "was this order unpaid?" — the update
    # above carried that condition. The previous version re-read the order and
    # tested payment_status != "paid", which could never be false: it read the
    # document it had just written to "failed".
    if event_type == "payment.failed" and res_matched and order_doc:
        try:
            if await _claim_once(order_doc["id"], "failed_emails_sent"):
                reason = payment.get("error_description") or ""
                await send_order_failed(order_doc, reason)
                await send_admin_failed_order(await _with_item_specs(order_doc), reason)
        except Exception:  # noqa: BLE001
            logger.exception("Webhook failure email failed for rzp_order_id=%s", rzp_order_id)

    return {"received": True, "matched": res_matched, "event": event_type}
