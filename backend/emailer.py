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
    attachments: Optional[list] = None,
) -> bool:
    """Send a transactional email. Returns True on success, False on failure. Never raises.

    `attachments` is a list of (filename, bytes) tuples; each is base64-encoded
    for Resend.
    """
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
    if attachments:
        import base64

        params["attachments"] = [
            {"filename": fn, "content": base64.b64encode(data).decode("ascii")}
            for fn, data in attachments
            if data
        ]

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


async def send_order_receipt(order: dict, invoice_pdf: Optional[bytes] = None) -> bool:
    """Send the branded receipt email for a paid order, with the tax invoice
    attached as a PDF when provided."""
    to = order.get("email")
    if not to:
        return False
    html = render_order_receipt_html(order)
    subject = f"Your Oakbridge order — {order.get('order_number','')}"
    attachments = None
    if invoice_pdf:
        inv = order.get("invoice_no") or order.get("order_number", "invoice")
        fname = f"Invoice-{str(inv).replace('/', '-')}.pdf"
        attachments = [(fname, invoice_pdf)]
    return await send_email(to=to, subject=subject, html=html, attachments=attachments)


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


# ====== Back-in-stock notifications ======

SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")


def render_back_in_stock_html(book: dict) -> str:
    title = (book.get("title") or "A title you wanted").replace("<", "&lt;").replace(">", "&gt;")
    author = (book.get("author") or "").replace("<", "&lt;").replace(">", "&gt;")
    price = _money(book.get("price", 0))
    cover = book.get("cover_image") or ""
    book_url = f"{SITE_URL}/books/{book.get('id','')}" if SITE_URL else "#"
    cover_cell = (
        f'<img src="{cover}" alt="" width="96" style="width:96px;border:1px solid #E5E7EB;display:block;">'
        if cover else ""
    )
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Back in stock</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.25;color:{BRAND_NAVY};">
          It's back — grab it before it's gone.
        </h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          A title you asked us to watch has just been restocked. Stock can move quickly, so we'd order soon.
        </p>
      </td></tr>
      <tr><td style="padding:20px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="top" style="width:112px;padding-right:16px;">{cover_cell}</td>
            <td valign="top">
              <div style="font-family:Georgia,serif;font-size:18px;color:{BRAND_NAVY};line-height:1.3;">{title}</div>
              <div style="font-size:13px;color:{BRAND_GREY};margin-top:4px;">{author}</div>
              <div style="font-family:Georgia,serif;font-size:20px;color:{BRAND_NAVY};margin-top:10px;">{price}</div>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 36px 40px;">
        <a href="{book_url}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;">View & buy now</a>
      </td></tr>
    </table>
    <div style="max-width:600px;margin-top:16px;font-family:monospace;font-size:11px;color:{BRAND_GREY};">
      You're receiving this because you asked to be notified when this title returned to stock.
    </div>
  </td></tr>
</table>
</body></html>
"""


async def send_back_in_stock(to: str, book: dict) -> bool:
    """Notify a waiting customer that an out-of-stock title is available again."""
    subject = f"Back in stock — {book.get('title','your title')}"
    html = render_back_in_stock_html(book)
    return await send_email(to=to, subject=subject, html=html)


# ====== Signup email verification (OTP) ======

def render_verification_otp_html(name: str, code: str) -> str:
    who = (name or "there").split(" ")[0]
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Verify your email</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Hi {who},</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">Use the code below to verify your Oakbridge account. It expires in 10 minutes.</p>
      </td></tr>
      <tr><td style="padding:8px 36px 36px;">
        <div style="font-family:monospace;font-size:40px;letter-spacing:12px;font-weight:700;color:{BRAND_NAVY};background:#F5F7FA;border:1px solid #E5E7EB;text-align:center;padding:20px 0;">{code}</div>
        <p style="margin:16px 0 0;font-size:12px;color:{BRAND_GREY};">If you didn't create an account, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_verification_otp(to: str, name: str, code: str) -> bool:
    """Email a 6-digit signup verification code."""
    return await send_email(to=to, subject="Your Oakbridge verification code", html=render_verification_otp_html(name, code))


# ====== Order payment failed ======

_FAILURE_REASONS = [
    "The card was declined by your bank, or there were insufficient funds.",
    "Card details (number, expiry or CVV) were entered incorrectly.",
    "The bank OTP / 3-D Secure verification wasn't completed or timed out.",
    "Online, international or high-value transactions are disabled on the card, or a daily limit was reached.",
    "A UPI request expired or was declined in your payments app.",
    "The payment window was closed, or the internet connection dropped before it finished.",
]


def render_order_failed_html(order: dict, reason: str = "") -> str:
    who = (order.get("full_name") or "there").split(" ")[0]
    order_no = order.get("order_number", "")
    retry_url = f"{SITE_URL}/cart" if SITE_URL else "#"
    reason_block = (
        f'<tr><td style="padding:0 36px 8px;"><div style="background:#FFF5F5;border:1px solid #F3C6CE;'
        f'padding:12px 14px;font-size:13px;color:{BRAND_NAVY};"><strong>Reason reported by the bank:</strong> '
        f'{reason}</div></td></tr>'
        if reason else ""
    )
    reasons_li = "".join(
        f'<li style="margin:6px 0;">{r}</li>' for r in _FAILURE_REASONS
    )
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:{BRAND_AMBER};">Payment unsuccessful</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Hi {who},</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          Your recent order <strong style="color:{BRAND_NAVY};">{order_no}</strong> couldn't be completed because the payment didn't go through.
          <strong>You haven't been charged.</strong> If any amount was debited, your bank will reverse it automatically within 5-7 working days.
        </p>
      </td></tr>
      {reason_block}
      <tr><td style="padding:12px 36px 0;">
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">What could have gone wrong</div>
        <ul style="margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.6;color:{BRAND_GREY};">
          {reasons_li}
        </ul>
      </td></tr>
      <tr><td style="padding:24px 36px 8px;">
        <p style="margin:0 0 16px;font-size:14px;color:{BRAND_GREY};">Your items are still saved - you can pick up right where you left off:</p>
        <a href="{retry_url}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;">Complete your order</a>
      </td></tr>
      <tr><td style="padding:32px 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:20px;font-size:12px;line-height:1.6;color:{BRAND_GREY};">
          Need a hand? Reply to this email or write to <a href="mailto:hello@oakbridge.in" style="color:{BRAND_NAVY};">hello@oakbridge.in</a> and we'll help you complete your order.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_order_failed(order: dict, reason: str = "") -> bool:
    """Tell the customer their payment didn't go through, with likely causes and a retry link."""
    to = order.get("email")
    if not to:
        return False
    subject = f"Your Oakbridge order couldn't be completed - {order.get('order_number','')}"
    return await send_email(to=to, subject=subject, html=render_order_failed_html(order, reason or ""))


# ====== Abandoned-cart reminders ======

_CART_COPY = {
    "12h": ("Still on your mind?", "The title below is waiting in your cart. Prices and stock can change \u2014 secure it before it slips away."),
    "1w": ("Don\u2019t let it get away", "It\u2019s been a week and your pick is still in your cart. Popular titles sell out \u2014 now\u2019s a good time to complete your order."),
    "eom": ("Last call this month", "Final reminder \u2014 the book below is still in your cart. Complete your order before the month closes out."),
}


def render_cart_reminder_html(name: str, items: list, stage: str) -> str:
    who = (name or "there").split(" ")[0]
    heading, sub = _CART_COPY.get(stage, _CART_COPY["12h"])
    rows = []
    for it in (items or [])[:6]:
        title = (it.get("title") or "A title").replace("<", "&lt;").replace(">", "&gt;")
        qty = it.get("quantity", 1)
        cover = it.get("cover_image") or ""
        cell = f'<img src="{cover}" width="60" style="width:60px;border:1px solid #E5E7EB;display:block;">' if cover else ""
        rows.append(
            f'<tr>'
            f'<td style="padding:12px 0;width:76px;">{cell}</td>'
            f'<td style="padding:12px 0;color:{BRAND_NAVY};font-size:14px;">{title}'
            f'<div style="color:{BRAND_GREY};font-size:12px;margin-top:2px;">Qty {qty}</div></td>'
            f'<td style="padding:12px 0;text-align:right;color:{BRAND_NAVY};font-size:14px;white-space:nowrap;">{_money(it.get("price", 0))}</td>'
            f'</tr>'
        )
    cta = f"{SITE_URL}/cart" if SITE_URL else "#"
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Your cart</div>
      </td></tr>
      <tr><td style="padding:36px 36px 6px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:26px;color:{BRAND_NAVY};">{heading}, {who}.</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">{sub}</p>
      </td></tr>
      <tr><td style="padding:16px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">{''.join(rows)}</table>
      </td></tr>
      <tr><td style="padding:28px 36px 40px;">
        <a href="{cta}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 30px;">Complete your order</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_cart_reminder(to: str, name: str, items: list, stage: str) -> bool:
    subjects = {
        "12h": "You left something in your cart",
        "1w": "Still in your cart \u2014 don\u2019t miss out",
        "eom": "Last call \u2014 your cart is waiting",
    }
    return await send_email(to=to, subject=subjects.get(stage, subjects["12h"]), html=render_cart_reminder_html(name, items, stage))
