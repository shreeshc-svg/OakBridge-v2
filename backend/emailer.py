"""
Transactional email helpers for Oakbridge Publishing (powered by Resend).

Use cases:
- Order-paid receipt (after Razorpay verification)
- Waitlist welcome emails (Digital Solutions / Academy)
- Admin notifications (low stock, new submissions)

Design notes:
- All sends are non-blocking — wrapped in `asyncio.to_thread`
- Failures are logged but never raise — email is best-effort, never blocks a paid order
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
SENDER_NAME = os.environ.get("SENDER_NAME", "Oakbridge Publishing")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY
else:
    logger.warning("RESEND_API_KEY not configured — emails will be skipped")


def _from_field() -> str:
    return f"{SENDER_NAME} <{SENDER_EMAIL}>" if SENDER_NAME else SENDER_EMAIL


async def send_email(
    to: str,
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
) -> bool:
    """Send a transactional email. Returns True on success, False on failure. Never raises."""
    if not RESEND_API_KEY:
        logger.warning("Skipping email — RESEND_API_KEY not set (to=%s, subject=%r)", to, subject)
        return False

    params: dict = {
        "from": _from_field(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        params["reply_to"] = reply_to

    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Email sent to=%s id=%s subject=%r", to, result.get("id"), subject)
        return True
    except Exception as e:  # noqa: BLE001
        logger.exception("Failed to send email to=%s subject=%r: %s", to, subject, e)
        return False


# ====== Templates ======

BRAND_NAVY = "#002B5C"
BRAND_RED = "#CC0033"
BRAND_AMBER = "#F59E0B"
BRAND_GREY = "#4B5563"


def _money(value) -> str:
    try:
        return "₹" + f"{float(value):,.0f}"
    except (TypeError, ValueError):
        return str(value)


def _order_items_rows(items: list) -> str:
    rows = []
    for it in items or []:
        title = (it.get("title") or "Untitled").replace("<", "&lt;").replace(">", "&gt;")
        qty = it.get("quantity", 1)
        line_total = float(it.get("price", 0)) * float(qty)
        rows.append(
            f"""
            <tr>
                <td style="padding:14px 0;border-bottom:1px solid #E5E7EB;color:{BRAND_NAVY};font-size:14px;">
                    {title}
                    <div style="color:{BRAND_GREY};font-size:12px;margin-top:2px;">Qty {qty}</div>
                </td>
                <td style="padding:14px 0;border-bottom:1px solid #E5E7EB;color:{BRAND_NAVY};font-size:14px;text-align:right;white-space:nowrap;">
                    {_money(line_total)}
                </td>
            </tr>
            """
        )
    return "".join(rows)


def render_order_receipt_html(order: dict) -> str:
    """Branded HTML receipt for a paid order. `order` is the dict from db.orders."""
    addr_parts = [
        order.get("address_line1"),
        order.get("address_line2"),
        order.get("city"),
        order.get("state"),
        order.get("pincode"),
    ]
    address = "<br>".join(p for p in addr_parts if p)
    rzp_id = order.get("rzp_payment_id", "—")

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Your Oakbridge order — {order.get('order_number', '')}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <!-- Header -->
      <tr><td style="background-color:{BRAND_NAVY};padding:32px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:24px;letter-spacing:0.5px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Order Receipt</div>
      </td></tr>

      <!-- Greeting -->
      <tr><td style="padding:40px 36px 24px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:28px;line-height:1.2;color:{BRAND_NAVY};">
          Thank you, {order.get('full_name', 'reader')}.
        </h1>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          Your payment has been received and your order is confirmed. We'll send another note the moment it ships.
        </p>
      </td></tr>

      <!-- Order meta -->
      <tr><td style="padding:0 36px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;margin-top:8px;">
          <tr>
            <td style="padding:18px 0;width:50%;">
              <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Order number</div>
              <div style="margin-top:4px;font-family:monospace;font-size:14px;color:{BRAND_NAVY};">{order.get('order_number', '')}</div>
            </td>
            <td style="padding:18px 0;width:50%;text-align:right;">
              <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Payment ID</div>
              <div style="margin-top:4px;font-family:monospace;font-size:14px;color:{BRAND_NAVY};">{rzp_id}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Items -->
      <tr><td style="padding:24px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          {_order_items_rows(order.get('items', []))}
        </table>
      </td></tr>

      <!-- Totals -->
      <tr><td style="padding:8px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding:6px 0;color:{BRAND_GREY};font-size:13px;">Subtotal</td>
              <td style="padding:6px 0;text-align:right;color:{BRAND_NAVY};font-size:13px;">{_money(order.get('subtotal', 0))}</td></tr>
          { f'<tr><td style="padding:6px 0;color:{BRAND_GREY};font-size:13px;">Discount ({order.get("coupon_code","")})</td><td style="padding:6px 0;text-align:right;color:{BRAND_RED};font-size:13px;">- {_money(order.get("discount",0))}</td></tr>' if order.get('discount') else '' }
          <tr><td style="padding:6px 0;color:{BRAND_GREY};font-size:13px;">Shipping</td>
              <td style="padding:6px 0;text-align:right;color:{BRAND_NAVY};font-size:13px;">{_money(order.get('shipping', 0))}</td></tr>
          <tr><td style="padding:6px 0;color:{BRAND_GREY};font-size:13px;">Tax</td>
              <td style="padding:6px 0;text-align:right;color:{BRAND_NAVY};font-size:13px;">{_money(order.get('tax', 0))}</td></tr>
          <tr><td style="padding:16px 0 4px;border-top:2px solid {BRAND_NAVY};font-family:Georgia,serif;font-size:18px;color:{BRAND_NAVY};">Total paid</td>
              <td style="padding:16px 0 4px;border-top:2px solid {BRAND_NAVY};text-align:right;font-family:Georgia,serif;font-size:22px;color:{BRAND_NAVY};">{_money(order.get('total', 0))}</td></tr>
        </table>
      </td></tr>

      <!-- Shipping address -->
      <tr><td style="padding:32px 36px 0;">
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Shipping to</div>
        <div style="margin-top:8px;font-size:14px;line-height:1.6;color:{BRAND_NAVY};">
          <strong>{order.get('full_name','')}</strong><br>
          {address}
        </div>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:40px 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:24px;font-size:12px;line-height:1.6;color:{BRAND_GREY};">
          Questions? Reply to this email or write to us at <a href="mailto:hello@oakbridge.in" style="color:{BRAND_NAVY};">hello@oakbridge.in</a>.<br>
          Oakbridge Publishing Pvt. Ltd. · 14 Hauz Khas Village, New Delhi 110016
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
"""


async def send_order_receipt(order: dict) -> bool:
    """Send the branded receipt email for a paid order."""
    to = order.get("email")
    if not to:
        return False
    html = render_order_receipt_html(order)
    subject = f"Your Oakbridge order — {order.get('order_number','')}"
    return await send_email(to=to, subject=subject, html=html)


# ====== Waitlist welcome ======

WAITLIST_PROGRAMS = {
    "digital-solutions-waitlist": {
        "label": "Oakbridge Digital Solutions",
        "lede": "AI-powered research products built on our scholarly catalogue — semantic search, research copilots and licensed APIs.",
    },
    "academy-waitlist": {
        "label": "The Oakbridge Academy",
        "lede": "CPD-accredited certification programmes and in-house workshops, taught by the same practitioner-authors who write our reference titles.",
    },
}


def render_waitlist_welcome_html(program: dict, email: str) -> str:
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:32px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:24px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Waitlist Confirmation</div>
      </td></tr>
      <tr><td style="padding:40px 36px 24px;">
        <span style="display:inline-block;background:{BRAND_AMBER};color:{BRAND_NAVY};padding:6px 12px;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:2px;">● Coming Soon</span>
        <h1 style="margin:20px 0 0;font-family:Georgia,serif;font-weight:normal;font-size:28px;line-height:1.2;color:{BRAND_NAVY};">You're on the list.</h1>
        <p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          Thank you for your interest in <strong style="color:{BRAND_NAVY};">{program['label']}</strong>. {program['lede']}
        </p>
        <p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          We'll write to you the moment early access opens up — typically with launch details, pricing and your invitation code.
        </p>
      </td></tr>
      <tr><td style="padding:8px 36px 0;">
        <div style="border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;padding:18px 0;">
          <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Confirmed email</div>
          <div style="margin-top:4px;font-family:monospace;font-size:14px;color:{BRAND_NAVY};">{email}</div>
        </div>
      </td></tr>
      <tr><td style="padding:32px 36px;">
        <a href="https://oakbridge.in/books" style="display:inline-block;background:{BRAND_NAVY};color:#FFFFFF;padding:14px 24px;text-decoration:none;font-size:14px;">Explore the bookstore →</a>
      </td></tr>
      <tr><td style="padding:0 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:24px;font-size:12px;line-height:1.6;color:{BRAND_GREY};">
          Questions? Reply to this email or write to <a href="mailto:hello@oakbridge.in" style="color:{BRAND_NAVY};">hello@oakbridge.in</a>.<br>
          Oakbridge Publishing Pvt. Ltd. · 14 Hauz Khas Village, New Delhi 110016
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_waitlist_welcome(email: str, source: str) -> bool:
    """Welcome email after a successful newsletter / waitlist signup."""
    program = WAITLIST_PROGRAMS.get(source)
    if not program:
        # Generic newsletter signup — send a simpler note
        program = {"label": "the Oakbridge mailing list", "lede": "You'll hear from us when there's news worth your time."}
    html = render_waitlist_welcome_html(program, email)
    subject = f"Welcome to {program['label']} — you're on the list"
    return await send_email(to=email, subject=subject, html=html)


# ====== Admin internal alerts ======

ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL")  # e.g., orders@oakbridge.in


def render_admin_paid_order_html(order: dict) -> str:
    items_count = sum(int(i.get("quantity", 0)) for i in order.get("items", []))
    rzp_id = order.get("rzp_payment_id", "—")
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_NAVY};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{BRAND_AMBER};">New paid order</div>
    <div style="font-family:Georgia,serif;font-size:22px;margin-top:4px;">{order.get('order_number','')}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
      <tr><td style="color:{BRAND_GREY};padding:6px 0;width:140px;">Customer</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{order.get('full_name','')} &lt;{order.get('email','')}&gt;</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Items</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{items_count} unit(s) · {len(order.get('items', []))} title(s)</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Total paid</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;font-family:Georgia,serif;font-size:18px;">{_money(order.get('total',0))}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Razorpay payment</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;font-family:monospace;">{rzp_id}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Ship to</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{order.get('city','')}, {order.get('state','')} {order.get('pincode','')}</td></tr>
    </table>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;font-size:12px;color:{BRAND_GREY};">
      Manage this order in the admin dashboard.
    </div>
  </td></tr>
</table>
</body></html>
"""


async def send_admin_paid_order(order: dict) -> bool:
    """Notify the internal Oakbridge inbox the moment an order is paid."""
    if not ADMIN_NOTIFY_EMAIL:
        return False
    subject = f"💸 New paid order — {order.get('order_number','')} · {_money(order.get('total',0))}"
    html = render_admin_paid_order_html(order)
    return await send_email(to=ADMIN_NOTIFY_EMAIL, subject=subject, html=html)
