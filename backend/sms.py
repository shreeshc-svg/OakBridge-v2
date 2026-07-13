"""
Transactional SMS helpers for Oakbridge Publishing (powered by MSG91 SendOTP).

Primary use case:
- Phone OTP for signup verification.

Design notes:
- We generate and verify the OTP ourselves (see auth register / verify-otp).
  MSG91's SendOTP API is used purely as the delivery channel: we pass our own
  `otp` value, so the DB-side verification logic is unchanged (we do NOT call
  MSG91's verify endpoint).
- All sends are non-blocking — wrapped in `asyncio.to_thread`.
- Failures are logged but never raise — SMS is best-effort and must not
  block account creation.

Required environment variables (set in Render / local .env):
- MSG91_AUTHKEY            MSG91 account auth key
- MSG91_OTP_TEMPLATE_ID    DLT-approved SendOTP template id (SendOTP -> Templates)
Optional:
- MSG91_OTP_EXPIRY         OTP validity in minutes sent to MSG91 (default "10")
- MSG91_COUNTRY_CODE       default country code for bare numbers (default "91")
"""

from __future__ import annotations

import asyncio
import logging
import os
import re

import requests

logger = logging.getLogger(__name__)

MSG91_AUTHKEY = os.environ.get("MSG91_AUTHKEY")
MSG91_OTP_TEMPLATE_ID = os.environ.get("MSG91_OTP_TEMPLATE_ID")
MSG91_OTP_EXPIRY = os.environ.get("MSG91_OTP_EXPIRY", "10")
MSG91_COUNTRY_CODE = os.environ.get("MSG91_COUNTRY_CODE", "91")

# MSG91 SendOTP endpoint. We pass our own `otp` so MSG91 only delivers it.
_OTP_URL = "https://control.msg91.com/api/v5/otp"

if not MSG91_AUTHKEY:
    logger.warning("MSG91_AUTHKEY not configured — phone OTP SMS will be skipped")


def sms_configured() -> bool:
    """True when MSG91 is set up enough to send an OTP."""
    return bool(MSG91_AUTHKEY and MSG91_OTP_TEMPLATE_ID)


def normalize_msisdn(phone: str) -> str:
    """Normalize a user-entered phone to MSG91's `<countrycode><number>` form.

    Examples (default country code 91):
      "+91 98765 43210" -> "919876543210"
      "98765 43210"     -> "919876543210"
      "9876543210"      -> "919876543210"
      "0091-9876543210" -> "919876543210"
    """
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("00"):
        digits = digits[2:]
    cc = MSG91_COUNTRY_CODE
    # Bare 10-digit local number -> prepend country code.
    if len(digits) == 10:
        digits = cc + digits
    # Handle a leading trunk 0 on a local number (e.g. 09876543210).
    elif len(digits) == 11 and digits.startswith("0"):
        digits = cc + digits[1:]
    return digits


def _send_otp_sync(mobile: str, code: str) -> bool:
    if not sms_configured():
        logger.warning(
            "Skipping SMS — MSG91 not fully configured (authkey/template) (mobile=%s)", mobile
        )
        return False

    params = {
        "template_id": MSG91_OTP_TEMPLATE_ID,
        "mobile": mobile,
        "otp": code,
        "otp_expiry": MSG91_OTP_EXPIRY,
        "realTimeResponse": "1",
    }
    headers = {
        "authkey": MSG91_AUTHKEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        resp = requests.post(_OTP_URL, params=params, headers=headers, timeout=15)
    except requests.RequestException as exc:
        logger.error("MSG91 request failed (mobile=%s): %s", mobile, exc)
        return False

    if resp.status_code != 200:
        logger.error(
            "MSG91 returned %s (mobile=%s): %s", resp.status_code, mobile, resp.text[:300]
        )
        return False

    # MSG91 returns {"type":"success",...} on success, {"type":"error","message":...} on failure.
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if isinstance(body, dict) and str(body.get("type", "")).lower() == "error":
        logger.error("MSG91 send error (mobile=%s): %s", mobile, body.get("message"))
        return False

    return True


async def send_otp_sms(phone: str, code: str, name: str = "") -> bool:
    """Send a verification code via SMS. Returns True on success. Never raises.

    `name` is accepted for call-site compatibility but not used by SendOTP.
    """
    mobile = normalize_msisdn(phone)
    if not mobile:
        logger.warning("Skipping SMS — empty/invalid phone")
        return False
    try:
        return await asyncio.to_thread(_send_otp_sync, mobile, code)
    except Exception:  # noqa: BLE001
        logger.exception("send_otp_sms failed (mobile=%s)", mobile)
        return False
