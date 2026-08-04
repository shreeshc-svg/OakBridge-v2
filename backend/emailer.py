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
import html as _html  # module-level: several renderers escape author-supplied text
import logging
import os
import re
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


def _recipients(to) -> list:
    """Normalise a recipient into a clean list.

    Accepts a single address, a comma/semicolon-separated string, or a list — so
    env vars like ADMIN_NOTIFY_EMAIL can name several inboxes
    ("info@oakbridge.in,orders@oakbridge.in") with no code change.
    """
    if not to:
        return []
    items = to if isinstance(to, (list, tuple, set)) else re.split(r"[,;]", str(to))
    seen, out = set(), []
    for raw in items:
        addr = str(raw).strip()
        key = addr.lower()
        if addr and key not in seen:
            seen.add(key)
            out.append(addr)
    return out


async def send_email(
    to,
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
    attachments: Optional[list] = None,
) -> bool:
    """Send a transactional email. Returns True on success, False on failure. Never raises.

    `to` may be one address, a comma-separated string, or a list — every
    recipient receives the same message.

    `attachments` is a list of (filename, bytes) tuples; each is base64-encoded
    for Resend.
    """
    if not RESEND_API_KEY:
        logger.warning("Skipping email — RESEND_API_KEY not set (to=%s, subject=%r)", to, subject)
        return False

    rcpts = _recipients(to)
    if not rcpts:
        logger.warning("Skipping email — no recipient (subject=%r)", subject)
        return False

    params: dict = {
        "from": _from_field(),
        "to": rcpts,
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
          Questions? Reply to this email or write to us at <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a>.<br>
          Oakbridge Publishing Pvt. Ltd. · B3 Tower, Spaze iTech Park, Sector 49, Gurugram, Haryana 122018
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
          Questions? Reply to this email or write to <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a>.<br>
          Oakbridge Publishing Pvt. Ltd. · B3 Tower, Spaze iTech Park, Sector 49, Gurugram, Haryana 122018
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

# Internal inbox(es) notified about orders, failed payments, desk copies and
# applications. Accepts SEVERAL addresses, comma-separated, e.g.
#   ADMIN_NOTIFY_EMAIL=info@oakbridge.in,orders@oakbridge.in
# Every listed inbox receives the same notification.
ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL")


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
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Phone</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;font-family:monospace;">{order.get('phone','—')}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;vertical-align:top;">Titles</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{_order_titles(order)}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Total paid</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;font-family:Georgia,serif;font-size:18px;">{_money(order.get('total',0))}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Razorpay payment</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;font-family:monospace;">{rzp_id}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;vertical-align:top;">Ship to</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{_ship_to(order)}</td></tr>
    </table>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;font-size:12px;color:{BRAND_GREY};">
      Manage this order in the admin dashboard.
    </div>
  </td></tr>
</table>
</body></html>
"""


def _order_titles(order: dict) -> str:
    """Titles + quantities for the internal order alert, so whoever packs the
    order can do it straight from the email without opening the admin."""
    import html as _html

    rows = []
    for it in order.get("items", []) or []:
        qty = it.get("quantity", 1)
        title = _html.escape(str(it.get("title", "")))
        ed = str(it.get("edition") or "").strip()
        if ed and ed not in ("1", "1.0"):
            title += f" ({_html.escape(ed)}/e)"
        meta = " · ".join(
            _html.escape(str(x))
            for x in [
                it.get("author"),
                f"ISBN {it['isbn']}" if it.get("isbn") else None,
                it.get("binding"),
                it.get("size"),
            ]
            if x
        )
        rows.append(
            f"{qty} × {title}"
            + (f'<br><span style="color:{BRAND_GREY};font-size:12px;">{meta}</span>' if meta else "")
        )
    return "<br>".join(rows) or "—"


def _ship_to(order: dict) -> str:
    """Full delivery address (was city/state/pincode only, which is not postable)."""
    import html as _html

    parts = [
        order.get("address_line1", ""),
        order.get("address_line2", ""),
        ", ".join(x for x in [order.get("city", ""), order.get("state", "")] if x),
        order.get("pincode", ""),
    ]
    return "<br>".join(_html.escape(str(p)) for p in parts if str(p).strip()) or "—"


async def send_admin_paid_order(order: dict) -> bool:
    """Notify the internal Oakbridge inbox the moment an order is paid."""
    if not ADMIN_NOTIFY_EMAIL:
        return False
    subject = f"💸 New paid order — {order.get('order_number','')} · {_money(order.get('total',0))}"
    html = render_admin_paid_order_html(order)
    return await send_email(to=ADMIN_NOTIFY_EMAIL, subject=subject, html=html)


async def send_admin_webhook_alert(reason: str, detail: str = "") -> bool:
    """Tell the internal inbox when a Razorpay webhook is being rejected.

    A rejected webhook is silent by nature: Razorpay sees a non-2xx, the customer
    sees nothing, and the order simply never confirms. That is exactly how this
    went unnoticed before — the code wrote a warning to a log nobody reads and
    carried on processing unsigned events for months.

    Two things bring us here, and both need a person the same day. Either
    RAZORPAY_WEBHOOK_SECRET is missing, in which case confirmations have stopped;
    or a signature did not match, which is a mismatched secret if it is every
    event, and someone forging payments if it is not.
    """
    if not ADMIN_NOTIFY_EMAIL:
        return False
    site = SITE_URL or "https://www.oakbridge.in"
    html = f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_NAVY};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{BRAND_AMBER};">Payments need attention</div>
    <div style="font-family:Georgia,serif;font-size:20px;margin-top:6px;">Razorpay webhook rejected</div>
  </td></tr>
  <tr><td style="padding:24px;font-size:14px;line-height:1.6;">
    <p style="margin:0 0 12px;color:{BRAND_RED};font-weight:600;">{_html.escape(reason)}</p>
    {f'<p style="margin:0 0 12px;">{_html.escape(detail)}</p>' if detail else ''}
    <p style="margin:0 0 12px;">While this is happening, payments confirmed by Razorpay after the
    customer closes the checkout window will not be recorded. Orders may sit unpaid on the site
    even though the money was taken.</p>
    <p style="margin:0;">Check that the Secret on the webhook in the Razorpay dashboard matches
    <code>RAZORPAY_WEBHOOK_SECRET</code> on the API service exactly, then look at
    Razorpay &rarr; Developers &rarr; Webhook Logs for deliveries returning 200.</p>
    <div style="margin-top:18px;font-size:12px;color:{BRAND_GREY};">{_html.escape(site)}</div>
  </td></tr>
</table>
</body></html>
"""
    return await send_email(to=ADMIN_NOTIFY_EMAIL, subject="⚠️ Oakbridge: Razorpay webhook rejected", html=html)


async def send_admin_inventory_alert(summary: dict, error: str = "") -> bool:
    """Tell the internal inbox when a scheduled stock sync needs a human.

    ONLY ON PROBLEMS. A cron that reports success twice a day trains everyone to
    filter it, and then the one that matters goes unread too. A clean run stays
    silent; the "Last sync" panel in Admin -> Inventory is there for anyone who
    wants to look.

    Unmatched ISBNs are deliberately NOT a problem. The stock sheet tracks the
    full 251-title master while the site sells 194 on purpose, so a large
    unmatched count is the expected steady state — alerting on it would mean
    alerting on every single run.
    """
    if not ADMIN_NOTIFY_EMAIL:
        return False

    import html as _html

    if error:
        kicker = "Sync failed"
        subject = "⚠️ Oakbridge stock sync FAILED"
        body = (
            f'<p style="margin:0 0 12px;color:{BRAND_RED};font-weight:600;">'
            "The scheduled stock sync did not run.</p>"
            f'<p style="margin:0 0 12px;">{_html.escape(str(error))}</p>'
            '<p style="margin:0;">Stock levels on the site are unchanged since the last '
            "successful sync. Usual causes: the sheet is no longer published to the web, it "
            "was renamed or moved, or the API could not reach Google.</p>"
        )
    else:
        invalid = int(summary.get("invalid_rows") or 0)
        kicker = "Needs a look"
        subject = f"⚠️ Oakbridge stock sync — {invalid} unreadable row{'' if invalid == 1 else 's'}"
        body = (
            f'<p style="margin:0 0 12px;">The sync ran, but <strong>{invalid}</strong> row'
            f"{'' if invalid == 1 else 's'} in the sheet had a stock value it could not read "
            "— blank, a dash, or text where a number was expected.</p>"
            f'<p style="margin:0 0 12px;"><strong>Those titles kept their previous stock '
            "level</strong>, so the site may still be selling something the sheet considers "
            "finished.</p>"
            f'<p style="margin:0;color:{BRAND_GREY};font-size:12px;">'
            f"Updated {summary.get('updated', 0)} · restocked {summary.get('restocked', 0)} · "
            f"unmatched {summary.get('unmatched_count', 0)}. Unmatched is expected — the sheet "
            "tracks more titles than the site sells.</p>"
        )

    html = f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_NAVY};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{BRAND_AMBER};">{kicker}</div>
    <div style="font-family:Georgia,serif;font-size:20px;margin-top:4px;">Inventory sync</div>
  </td></tr>
  <tr><td style="padding:24px;font-size:14px;line-height:1.6;">{body}</td></tr>
</table>
</body></html>
"""
    return await send_email(to=ADMIN_NOTIFY_EMAIL, subject=subject, html=html)


def render_admin_failed_order_html(order: dict, reason: str = "") -> str:
    reason_row = (
        f'<tr><td style="color:{BRAND_GREY};padding:6px 0;">Reason</td>'
        f'<td style="color:{BRAND_RED};padding:6px 0;">{reason}</td></tr>'
        if reason else ""
    )
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_RED};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Payment failed — follow up</div>
    <div style="font-family:Georgia,serif;font-size:22px;margin-top:4px;">{order.get('order_number','')}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
      <tr><td style="color:{BRAND_GREY};padding:6px 0;width:140px;">Customer</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{order.get('full_name','')} &lt;{order.get('email','')}&gt;</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Phone</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{order.get('phone','—')}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Order value</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;font-family:Georgia,serif;font-size:18px;">{_money(order.get('total',0))}</td></tr>
      {reason_row}
    </table>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;font-size:12px;color:{BRAND_GREY};">
      A customer tried to pay but the transaction didn't complete. Consider reaching out to help them finish.
    </div>
  </td></tr>
</table>
</body></html>
"""


async def send_admin_failed_order(order: dict, reason: str = "") -> bool:
    """Alert the internal inbox when a customer's payment fails, so the team can follow up."""
    if not ADMIN_NOTIFY_EMAIL:
        return False
    subject = f"⚠️ Payment failed — {order.get('order_number','')} · {_money(order.get('total',0))}"
    html = render_admin_failed_order_html(order, reason or "")
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


def render_stock_signup_html(book: dict) -> str:
    title = book.get("title", "this title")
    author = book.get("author", "")
    book_url = f"{SITE_URL}/books/{book.get('id','')}" if SITE_URL else "#"
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">You're on the list</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;line-height:1.3;color:{BRAND_NAVY};">We'll let you know the moment it's back.</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          Thanks — we've added you to the waiting list for <strong>{title}</strong>{f' by {author}' if author else ''}.
          As soon as it's restocked, you'll be the first to hear, at this email address.
        </p>
      </td></tr>
      <tr><td style="padding:22px 36px 40px;">
        <a href="{book_url}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;">View the title</a>
      </td></tr>
    </table>
    <div style="max-width:560px;margin-top:16px;font-family:monospace;font-size:11px;color:{BRAND_GREY};">
      You're receiving this because you asked to be notified when this title returns to stock.
    </div>
  </td></tr>
</table>
</body></html>
"""


async def send_stock_signup(to: str, book: dict) -> bool:
    """Confirm that a customer has been added to a title's back-in-stock waitlist."""
    subject = f"You're on the list — {book.get('title','your title')}"
    html = render_stock_signup_html(book)
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
          Need a hand? Reply to this email or write to <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a> and we'll help you complete your order.
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
    "12h": ("Your next chapter awaits", "The book below is still waiting in your cart. Popular titles move fast and prices can change without notice \u2014 claim it before someone else does."),
    "1w": ("Don\u2019t let this one slip away", "It\u2019s been a week, and sought-after titles like this don\u2019t stay on the shelf for long. Complete your order now \u2014 before it sells out and you miss the chapter."),
    "eom": ("Last call \u2014 before it\u2019s gone", "Final reminder: your book is still in your cart, but stock is limited and the month is closing out. Secure it now, or risk missing out for good."),
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
        "12h": "Your cart is waiting \u2014 don\u2019t miss out",
        "1w": "Going fast \u2014 still in your cart",
        "eom": "Last call \u2014 before it\u2019s gone for good",
    }
    return await send_email(to=to, subject=subjects.get(stage, subjects["12h"]), html=render_cart_reminder_html(name, items, stage))


# ====== Contact / enquiry form ======

def render_contact_admin_html(msg: dict) -> str:
    body = (msg.get("message") or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_NAVY};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{BRAND_AMBER};">New enquiry</div>
    <div style="font-family:Georgia,serif;font-size:20px;margin-top:4px;">{msg.get('subject','General Inquiry')}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
      <tr><td style="color:{BRAND_GREY};padding:6px 0;width:90px;">From</td>
          <td style="color:{BRAND_NAVY};padding:6px 0;">{msg.get('name','')}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Email</td>
          <td style="padding:6px 0;"><a href="mailto:{msg.get('email','')}" style="color:{BRAND_NAVY};">{msg.get('email','')}</a></td></tr>
    </table>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:{BRAND_NAVY};">{body}</div>
    <div style="margin-top:18px;font-size:12px;color:{BRAND_GREY};">Reply directly to this email to respond to {msg.get('name','the sender')}.</div>
  </td></tr>
</table>
</body></html>
"""


async def send_job_application_admin(app: dict) -> bool:
    """Notify the hiring inbox of a new job application, with a link to the CV."""
    to = ADMIN_NOTIFY_EMAIL or "info@oakbridge.in"
    cv_link = f"{SITE_URL}{app.get('cv_url','')}" if SITE_URL else app.get("cv_url", "")
    role = app.get("role", "General application")
    html = f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_NAVY};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{BRAND_AMBER};">New job application</div>
    <div style="font-family:Georgia,serif;font-size:20px;margin-top:4px;">{role}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
      <tr><td style="color:{BRAND_GREY};padding:6px 0;width:90px;">Name</td><td style="padding:6px 0;">{app.get('name','')}</td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Email</td><td style="padding:6px 0;"><a href="mailto:{app.get('email','')}" style="color:{BRAND_NAVY};">{app.get('email','')}</a></td></tr>
      <tr><td style="color:{BRAND_GREY};padding:6px 0;">Phone</td><td style="padding:6px 0;">{app.get('phone','')}</td></tr>
    </table>
    <div style="margin-top:20px;">
      <a href="{cv_link}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;">Download CV (PDF)</a>
    </div>
  </td></tr>
</table>
</body></html>
"""
    return await send_email(
        to=to,
        subject=f"New job application — {role} (from {app.get('name','')})",
        html=html,
        reply_to=app.get("email"),
    )


async def send_contact_admin_alert(msg: dict) -> bool:
    """Notify the internal inbox of a new contact-form enquiry; reply-to is the sender."""
    if not ADMIN_NOTIFY_EMAIL:
        return False
    subject = f"New enquiry — {msg.get('subject','General Inquiry')} (from {msg.get('name','')})"
    return await send_email(
        to=ADMIN_NOTIFY_EMAIL,
        subject=subject,
        html=render_contact_admin_html(msg),
        reply_to=msg.get("email"),
    )


def render_contact_ack_html(msg: dict) -> str:
    who = (msg.get("name") or "there").split(" ")[0]
    body = (msg.get("message") or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">We've received your message</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Hi {who},</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          Thanks for reaching out to Oakbridge Publishing. We've received your message and a
          member of our team will get back to you shortly.
        </p>
      </td></tr>
      <tr><td style="padding:16px 36px 8px;">
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Your message</div>
        <div style="margin-top:8px;padding:14px 16px;background:#F5F7FA;border:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:{BRAND_NAVY};">{body}</div>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:20px;font-size:12px;line-height:1.6;color:{BRAND_GREY};">
          This is an automated confirmation — no need to reply. For anything urgent, write to
          <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a>.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_contact_ack(msg: dict) -> bool:
    """Send a short 'we got your message' acknowledgment to the person who wrote in."""
    to = msg.get("email")
    if not to:
        return False
    return await send_email(
        to=to,
        subject="We've received your message — Oakbridge Publishing",
        html=render_contact_ack_html(msg),
    )


# ====== Unpaid order: the link that reopens it ======

async def send_payment_link(order: dict, url: str) -> bool:
    """Ask a customer to finish an order they started but did not pay for.

    Written to be ignorable. No countdown, no invented scarcity, no "last
    chance" — the order was abandoned, which is a thing people are allowed to
    do, and a publisher chasing a book sale like a debt collector reads badly.
    It says what happened, what it costs, how to finish, and that ignoring it
    is fine. That last line is what keeps it out of the spam folder and out of
    a complaint.

    It is also honest about stock: nothing is reserved by an unpaid order, and
    promising otherwise would be a promise the warehouse never agreed to.
    """
    to = order.get("email")
    if not to:
        return False
    esc = lambda v: _html.escape(str(v or ""))
    who = esc((order.get("full_name") or "there").split(" ")[0])
    rows = "".join(
        f'<tr><td style="padding:7px 0;font-size:14px;color:{BRAND_NAVY};">'
        f'<span style="font-family:monospace;color:{BRAND_GREY};">{int(it.get("quantity") or 1)}&times;</span> '
        f'{esc(it.get("title"))}'
        + (f'<div style="font-size:12px;color:{BRAND_GREY};">{esc(it.get("author"))}</div>' if it.get("author") else "")
        + "</td></tr>"
        for it in (order.get("items") or [])
    )
    total = f"{float(order.get('total') or 0):,.0f}"
    return await send_email(
        to=to,
        subject=f"Your Oakbridge order is waiting \u2014 {order.get('order_number','')}",
        html=f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Order {esc(order.get('order_number'))}</div>
      </td></tr>
      <tr><td style="padding:34px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:23px;">Hi {who}, your order is waiting.</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          You started this order with us but the payment was not completed, so we have not
          processed it.
        </p>
      </td></tr>
      <tr><td style="padding:18px 36px 0;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #E5E7EB;">{rows}</table>
        <div style="border-top:1px solid #E5E7EB;margin-top:10px;padding-top:12px;font-family:Georgia,serif;font-size:20px;">Total &#8377;{total}</div>
      </td></tr>
      <tr><td style="padding:26px 36px 0;">
        <a href="{url}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:14px 30px;">Complete payment</a>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:20px;font-size:12px;line-height:1.7;color:{BRAND_GREY};">
          If you would rather not go ahead, ignore this &mdash; nothing has been charged and the
          order will simply lapse.<br>
          We have not reserved stock, so if a title sells out before you pay we will let you know.<br>
          This link works for 7 days. Any questions, just reply to this email.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
""",
    )


# ====== Dispatch: the courier has it ======
#
# Couriers change their URL schemes without warning, so a wrong link is worse
# than none — it sends a customer to a 404 while holding a number that works
# perfectly well pasted into the courier's own site. Only patterns worth
# trusting are listed; everything else shows the number and names the courier.
_TRACK_URLS = {
    "bluedart": "https://www.bluedart.com/tracking?trackFor=0&trackNo={id}",
    "delhivery": "https://www.delhivery.com/track/package/{id}",
    "dtdc": "https://www.dtdc.in/tracking/tracking_results.asp?strCnno={id}",
    "india post": "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx",
    "xpressbees": "https://www.xpressbees.com/track?awb={id}",
}


def tracking_url(courier: str, tracking_id: str) -> str:
    key = str(courier or "").strip().lower()
    tid = str(tracking_id or "").strip()
    tpl = _TRACK_URLS.get(key)
    return tpl.format(id=tid) if tpl and tid else ""


async def send_order_dispatched(order: dict, note: str = "") -> bool:
    """Tell the customer the courier has collected their order.

    Separate from the generic status email because this one carries the single
    fact the customer actually wants — the consignment number — and burying that
    in a paragraph is how support tickets get created. It leads with the number,
    at a size you can read on a phone and select with a long press.
    """
    to = order.get("email")
    if not to:
        return False
    esc = lambda v: _html.escape(str(v or ""))
    who = esc((order.get("full_name") or "there").split(" ")[0])
    courier = str(order.get("courier") or "").strip()
    tid = str(order.get("tracking_id") or "").strip()
    url = tracking_url(courier, tid)
    num = esc(order.get("order_number"))

    link_row = (
        f'<tr><td style="padding:18px 36px 0;">'
        f'<a href="{url}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;'
        f'text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;">Track this shipment</a>'
        f"</td></tr>"
        if url else ""
    )
    note_row = (
        f'<tr><td style="padding:18px 36px 0;font-size:14px;line-height:1.6;color:{BRAND_GREY};">'
        f'{esc(note).replace(chr(10), "<br>")}</td></tr>'
        if str(note or "").strip() else ""
    )

    return await send_email(
        to=to,
        subject=f"Your Oakbridge order has been dispatched \u2014 {order.get('order_number','')}",
        html=f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Order {num} &middot; Dispatched</div>
      </td></tr>
      <tr><td style="padding:34px 36px 0;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:23px;">Hi {who}, your order is on its way.</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          {esc(courier) or "The courier"} has collected your order from us.
        </p>
      </td></tr>
      <tr><td style="padding:20px 36px 0;">
        <div style="border:1px solid #E5E7EB;background:#F5F7FA;padding:16px 18px;">
          <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.6px;font-size:10px;color:{BRAND_GREY};">Tracking number</div>
          <div style="font-family:monospace;font-size:22px;letter-spacing:1px;color:{BRAND_NAVY};margin-top:6px;word-break:break-all;">{esc(tid)}</div>
          {f'<div style="font-size:12px;color:{BRAND_GREY};margin-top:8px;">Courier: {esc(courier)}</div>' if courier else ""}
        </div>
      </td></tr>
      {link_row}
      {note_row}
      <tr><td style="padding:26px 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:20px;font-size:12px;line-height:1.7;color:{BRAND_GREY};">
          Tracking can take a few hours to show movement after collection.<br>
          Anything unexpected, reply to this email with your order number and we will chase it.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
""",
    )


# ====== Manuscript submissions ======
#
# Until now a submission was written to the database and nothing else happened:
# no internal alert, and no acknowledgement to the author. A prospective author
# is the most valuable lead this site receives, and one could sit unread for as
# long as it took someone to remember to open Admin → Submissions.

# Stored as slugs; spelled out for humans reading the email.
_SUBMISSION_CATEGORIES = {
    "school": "School",
    "higher-ed": "Higher Education",
    "professional": "Professional",
    "test-prep": "Test Preparation",
    "children": "Children's",
    "other": "Other",
}


def _category_label(slug: str) -> str:
    key = str(slug or "").strip().lower()
    return _SUBMISSION_CATEGORIES.get(key, (slug or "—").replace("-", " ").title())


def render_submission_admin_html(sub: dict) -> str:
    esc = lambda v: _html.escape(str(v or ""))
    para = lambda v: esc(v).replace("\n", "<br>") or "—"
    words = int(sub.get("word_count") or 0)
    rows = [
        ("Author", esc(sub.get("name"))),
        ("Email", f'<a href="mailto:{esc(sub.get("email"))}" style="color:{BRAND_NAVY};">{esc(sub.get("email"))}</a>'),
        ("Phone", esc(sub.get("phone")) or "—"),
        ("Affiliation", esc(sub.get("affiliation")) or "—"),
        ("Category", esc(_category_label(sub.get("category")))),
        ("Length", f"{words:,} words" if words else "—"),
    ]
    rows_html = "".join(
        f'<tr><td style="color:{BRAND_GREY};padding:6px 0;width:100px;vertical-align:top;">{k}</td>'
        f'<td style="padding:6px 0;">{v}</td></tr>'
        for k, v in rows
    )
    bio = para(sub.get("bio"))
    bio_block = (
        f'<div style="margin-top:18px;"><div style="font-family:monospace;text-transform:uppercase;'
        f'letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">About the author</div>'
        f'<div style="margin-top:8px;font-size:13px;line-height:1.6;color:{BRAND_NAVY};">{bio}</div></div>'
        if bio != "—" else ""
    )
    # SITE_URL is dashboard-set (sync: false) and absent from backend/.env, so it
    # can legitimately be empty. A root-relative href in an email is dead — clients
    # resolve it against the webmail origin — so the button is omitted rather than
    # shipped broken. Every other renderer here guards the same way.
    cta = (
        f'<div style="margin-top:22px;"><a href="{SITE_URL}/admin/submissions" '
        f'style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;'
        f'font-size:14px;font-weight:600;padding:12px 24px;">Open in admin</a></div>'
        if SITE_URL else ""
    )
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;border:1px solid #E5E7EB;">
  <tr><td style="background-color:{BRAND_NAVY};color:#FFFFFF;padding:18px 24px;">
    <div style="font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{BRAND_AMBER};">New manuscript submission</div>
    <div style="font-family:Georgia,serif;font-size:20px;margin-top:6px;">{esc(sub.get('working_title'))}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">{rows_html}</table>
    <div style="margin-top:20px;">
      <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Synopsis</div>
      <div style="margin-top:8px;padding:14px 16px;background:#F5F7FA;border:1px solid #E5E7EB;font-size:13px;line-height:1.6;color:{BRAND_NAVY};">{para(sub.get('synopsis'))}</div>
    </div>
    {bio_block}
    {cta}
    <div style="margin-top:18px;font-size:12px;color:{BRAND_GREY};">Reply directly to this email to respond to {esc(sub.get('name')) or 'the author'}.</div>
  </td></tr>
</table>
</body></html>
"""


async def send_submission_admin(sub: dict) -> bool:
    """Notify the internal inbox(es) of a new manuscript; reply-to is the author."""
    if not ADMIN_NOTIFY_EMAIL:
        return False
    return await send_email(
        to=ADMIN_NOTIFY_EMAIL,
        subject=f"New manuscript — {sub.get('working_title','Untitled')} (from {sub.get('name','')})",
        html=render_submission_admin_html(sub),
        reply_to=sub.get("email"),
    )


def render_submission_ack_html(sub: dict) -> str:
    esc = lambda v: _html.escape(str(v or ""))
    who = esc((sub.get("name") or "there").split(" ")[0])
    return f"""\
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Your manuscript has reached us</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Thank you, {who}.</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">
          Your proposal has been received and passed to our editorial team. Every manuscript is
          read properly rather than screened, so a considered reply takes a little time — but you
          will hear from us either way.
        </p>
      </td></tr>
      <tr><td style="padding:16px 36px 8px;">
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:1.5px;font-size:10px;color:{BRAND_GREY};">Submitted</div>
        <div style="margin-top:8px;padding:14px 16px;background:#F5F7FA;border:1px solid #E5E7EB;">
          <div style="font-family:Georgia,serif;font-size:17px;color:{BRAND_NAVY};">{esc(sub.get('working_title'))}</div>
          <div style="font-size:13px;color:{BRAND_GREY};margin-top:4px;">{esc(_category_label(sub.get('category')))}</div>
        </div>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <div style="border-top:1px solid #E5E7EB;padding-top:20px;font-size:12px;line-height:1.6;color:{BRAND_GREY};">
          This is an automated confirmation — no need to reply. If you need to add to your
          submission, write to <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a>.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_submission_ack(sub: dict) -> bool:
    """Confirm to the author that their manuscript arrived."""
    to = sub.get("email")
    if not to:
        return False
    return await send_email(
        to=to,
        subject="We've received your manuscript — Oakbridge Publishing",
        html=render_submission_ack_html(sub),
    )


# ====== Account welcome (on signup) ======

def render_account_welcome_html(name: str) -> str:
    who = (name or "there").split(" ")[0]
    site = os.environ.get("SITE_URL", "https://oakbridge.in").rstrip("/")
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Welcome</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:26px;color:{BRAND_NAVY};">Welcome, {who}.</h1>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">Your Oakbridge account is ready — welcome to a library built for the intellectually curious. Here's what you can do from here:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 4px;">
          <tr><td style="color:{BRAND_AMBER};font-size:16px;vertical-align:top;padding:0 10px 8px 0;line-height:1.5;">&#10003;</td><td style="font-size:15px;line-height:1.5;color:{BRAND_GREY};padding-bottom:8px;"><strong style="color:{BRAND_NAVY};">Order</strong> your favourite law, tax, academic &amp; reference titles</td></tr>
          <tr><td style="color:{BRAND_AMBER};font-size:16px;vertical-align:top;padding:0 10px 8px 0;line-height:1.5;">&#10003;</td><td style="font-size:15px;line-height:1.5;color:{BRAND_GREY};padding-bottom:8px;"><strong style="color:{BRAND_NAVY};">Rate &amp; review</strong> the books you read — and guide fellow readers</td></tr>
          <tr><td style="color:{BRAND_AMBER};font-size:16px;vertical-align:top;padding:0 10px 0 0;line-height:1.5;">&#10003;</td><td style="font-size:15px;line-height:1.5;color:{BRAND_GREY};"><strong style="color:{BRAND_NAVY};">Track &amp; reorder</strong> — follow every order and restock your shelf in one click</td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">Your next great read is a click away.</p>
      </td></tr>
      <tr><td style="padding:20px 36px 8px;">
        <a href="{site}/books" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;">Browse the bookstore</a>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <p style="margin:0;font-size:12px;color:{BRAND_GREY};">Questions? Reach us at <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a>. Oakbridge Publishing, B3 Tower, Spaze i-Tech Park, Sector 49, Gurugram, Haryana 122018.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_account_welcome(to: str, name: str) -> bool:
    """Welcome email sent right after signup. Best-effort."""
    if not to:
        return False
    return await send_email(to=to, subject="Welcome to Oakbridge Publishing", html=render_account_welcome_html(name))


# ====== Order status update (admin changes order status) ======

_STATUS_COPY = {
    "confirmed": ("Order confirmed", "Your order is confirmed and will be prepared for dispatch shortly."),
    "processing": ("Your order is being prepared", "We're packing your books — they'll be on their way soon."),
    "shipped": ("Your order has shipped", "Your books are on their way. You'll receive them shortly."),
    "delivered": ("Delivered", "Your order has been delivered. We hope you enjoy your reading."),
    "cancelled": ("Order cancelled", "Your order has been cancelled. If this wasn't expected, please contact us and we'll help."),
}


def render_order_status_update_html(order: dict, note: str = "") -> str:
    """Per-status copy, plus whatever the person changing the status wanted to add.

    The note is the point of this email for a dispatch team. "Your books are on
    their way" without a tracking number is a sentence, not information.
    """
    who = (order.get("full_name") or "reader").split(" ")[0]
    status = (order.get("status") or "").lower()
    headline, message = _STATUS_COPY.get(status, ("Order update", f"Your order status is now: {status or 'updated'}."))
    num = order.get("order_number", "")
    note_block = (
        f'<tr><td style="padding:4px 36px 0;"><div style="padding:14px 16px;background:#F5F7FA;'
        f'border:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:{BRAND_NAVY};">'
        f'{_html.escape(str(note)).replace(chr(10), "<br>")}</div></td></tr>'
        if str(note or "").strip() else ""
    )
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Order {num}</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">{headline}</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">Hi {who}, {message}</p>
      </td></tr>
      {note_block}
      <tr><td style="padding:20px 36px 36px;">
        <p style="margin:0;font-size:12px;color:{BRAND_GREY};">Order reference: <strong style="color:{BRAND_NAVY};">{num}</strong>. Questions? <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_order_status_update(order: dict, note: str = "") -> bool:
    """Email the customer when their order status changes. Best-effort."""
    to = order.get("email")
    if not to:
        return False
    num = order.get("order_number", "")
    status = (order.get("status") or "updated").lower()
    subject = f"Your Oakbridge order {num} — {status}"
    return await send_email(to=to, subject=subject, html=render_order_status_update_html(order, note))


# ====== Password reset ======

def render_password_reset_html(name: str, reset_url: str) -> str:
    who = (name or "there").split(" ")[0]
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Password reset</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Hi {who},</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">We received a request to reset your Oakbridge password. Click below to choose a new one. This link expires in 30 minutes.</p>
      </td></tr>
      <tr><td style="padding:20px 36px 8px;">
        <a href="{reset_url}" style="display:inline-block;background-color:{BRAND_NAVY};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:14px 28px;">Reset password</a>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <p style="margin:0;font-size:12px;color:{BRAND_GREY};">If you didn't request this, you can safely ignore this email — your password won't change. If the button doesn't work, paste this link into your browser:<br><span style="color:{BRAND_NAVY};word-break:break-all;">{reset_url}</span></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_password_reset(to: str, name: str, reset_url: str) -> bool:
    """Email a password-reset link. Best-effort."""
    if not to:
        return False
    return await send_email(to=to, subject="Reset your Oakbridge password", html=render_password_reset_html(name, reset_url))


# ====== Review submitted (thank-you to reviewer) ======

def render_review_submitted_html(name: str, book_title: str, rating: int) -> str:
    who = (name or "there").split(" ")[0]
    stars = "★" * int(rating or 0) + "☆" * (5 - int(rating or 0))
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Review received</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Thank you, {who}.</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">We've received your review of <strong style="color:{BRAND_NAVY};">{book_title}</strong>. Your rating:</p>
        <div style="font-size:22px;color:{BRAND_AMBER};letter-spacing:3px;margin-top:10px;">{stars}</div>
        <p style="margin:16px 0 0;font-size:13px;color:{BRAND_GREY};">Reviews help other readers choose with confidence — we appreciate you taking the time.</p>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <p style="margin:0;font-size:12px;color:{BRAND_GREY};">Questions? Reach us at <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a>.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_review_submitted(to: str, name: str, book_title: str, rating: int) -> bool:
    """Thank-you email when a customer submits a review. Best-effort."""
    if not to:
        return False
    return await send_email(to=to, subject="Thanks for your review", html=render_review_submitted_html(name, book_title, rating))


# ====== Order cancelled (with reason) ======

def render_order_cancelled_html(order: dict, reason: str = "") -> str:
    who = (order.get("full_name") or "reader").split(" ")[0]
    num = order.get("order_number", "")
    reason_line = (
        f"<p style=\"margin:14px 0 0;font-size:14px;line-height:1.6;color:{BRAND_GREY};\">Reason: <strong style=\"color:{BRAND_NAVY};\">{_html.escape(str(reason)).replace(chr(10), '<br>')}</strong></p>"
        if reason else ""
    )
    return f"""\
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:{BRAND_NAVY};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F7FA;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E5E7EB;">
      <tr><td style="background-color:{BRAND_NAVY};padding:28px 36px;color:#FFFFFF;">
        <div style="font-family:Georgia,serif;font-size:22px;">Oakbridge <span style="color:{BRAND_AMBER};">Publishing</span></div>
        <div style="font-family:monospace;text-transform:uppercase;letter-spacing:2px;font-size:11px;margin-top:6px;color:rgba(255,255,255,0.6);">Order {num} · Cancelled</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px;">
        <h1 style="margin:0;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:{BRAND_NAVY};">Your order has been cancelled</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:{BRAND_GREY};">Hi {who}, your order <strong style="color:{BRAND_NAVY};">{num}</strong> has been cancelled.</p>
        {reason_line}
        <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:{BRAND_GREY};">If you were charged, any eligible refund is processed to your original payment method, typically within 5–7 business days. If this was unexpected, please contact us and we'll help.</p>
      </td></tr>
      <tr><td style="padding:24px 36px 36px;">
        <p style="margin:0;font-size:12px;color:{BRAND_GREY};">Questions? Email <a href="mailto:info@oakbridge.in" style="color:{BRAND_NAVY};">info@oakbridge.in</a> with your order number.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>
"""


async def send_order_cancelled(order: dict, reason: str = "") -> bool:
    """Email the customer when their order is cancelled, with an optional reason."""
    to = order.get("email")
    if not to:
        return False
    num = order.get("order_number", "")
    return await send_email(to=to, subject=f"Your Oakbridge order {num} was cancelled", html=render_order_cancelled_html(order, reason))
