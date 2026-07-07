"""
Razorpay payment integration for Oakbridge Publishing.

Endpoints:
- POST /api/payments/create-order           — Create a Razorpay order for the given amount (paise)
- POST /api/payments/verify                 — Verify HMAC signature and mark the local order as paid
- POST /api/webhooks/razorpay               — Razorpay webhook for async confirmation (optional)
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import razorpay
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from extensions import db
from emailer import send_admin_paid_order, send_order_receipt

logger = logging.getLogger(__name__)

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


def _require_client() -> razorpay.Client:
    if _client is None:
        raise HTTPException(
            status_code=503,
            detail="Payment gateway not configured.",
        )
    return _client


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
        # Mark the order so a malicious replay can be detected later
        await db.orders.update_one(
            {"rzp_order_id": payload.razorpay_order_id},
            {"$set": {"payment_status": "failed", "payment_failure_reason": "signature_mismatch"}},
        )
        raise HTTPException(status_code=400, detail="Signature verification failed")

    order = await db.orders.find_one(
        {"rzp_order_id": payload.razorpay_order_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for this Razorpay order id")

    await db.orders.update_one(
        {"id": order["id"]},
        {
            "$set": {
                "payment_status": "paid",
                "rzp_payment_id": payload.razorpay_payment_id,
                "rzp_signature": payload.razorpay_signature,
                "status": "confirmed",
                "paid_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    # Decrement inventory once payment is confirmed (idempotent).
    await _apply_stock_decrement(order["id"])

    # Fire-and-forget order receipt + admin notification (best-effort; never block the response)
    try:
        refreshed = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
        if refreshed:
            from invoice import build_order_invoice

            pdf = await build_order_invoice(db, refreshed)
            await send_order_receipt(refreshed, invoice_pdf=pdf or None)
            await send_admin_paid_order(refreshed)
    except Exception:  # noqa: BLE001
        logger.exception("Order receipt email failed for order %s", order["id"])

    return {"ok": True, "order_id": order["id"]}


@webhooks_router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(None),
):
    """Async confirmation from Razorpay. Configure the webhook URL in Razorpay Dashboard."""
    body = await request.body()

    if not RAZORPAY_WEBHOOK_SECRET:
        # Webhook secret not configured — accept but flag in logs
        logger.warning("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set")
    else:
        if not x_razorpay_signature:
            raise HTTPException(status_code=400, detail="Missing webhook signature")
        expected = hmac.new(
            RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, x_razorpay_signature):
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

    update: dict = {"payment_provider": "razorpay"}
    if event_type == "payment.captured":
        update.update(
            {
                "payment_status": "paid",
                "rzp_payment_id": rzp_payment_id,
                "status": "confirmed",
                "paid_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    elif event_type == "payment.failed":
        update.update(
            {
                "payment_status": "failed",
                "rzp_payment_id": rzp_payment_id,
                "payment_failure_reason": payment.get("error_description"),
            }
        )
    else:
        return {"received": True, "ignored": event_type}

    res = await db.orders.update_one({"rzp_order_id": rzp_order_id}, {"$set": update})

    # Send receipt + admin notification only on a captured payment
    if event_type == "payment.captured" and res.matched_count:
        try:
            order_doc = await db.orders.find_one({"rzp_order_id": rzp_order_id}, {"_id": 0})
            if order_doc:
                await _apply_stock_decrement(order_doc["id"])
                from invoice import build_order_invoice

                pdf = await build_order_invoice(db, order_doc)
                await send_order_receipt(order_doc, invoice_pdf=pdf or None)
                await send_admin_paid_order(order_doc)
        except Exception:  # noqa: BLE001
            logger.exception("Webhook receipt email failed for rzp_order_id=%s", rzp_order_id)

    return {"received": True, "matched": res.matched_count, "event": event_type}
