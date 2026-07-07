"""
Resend diagnostic — sends ONE test email and prints the real result/error.

Usage (from backend/, with your venv active):
    python test_email.py you@example.com

It uses the same .env, key and sender as the app, so whatever it prints is
exactly what signup/OTP sees. Read the output:
  - "OK id=..."                -> Resend accepted it. If it's not in the inbox,
                                  check SPAM, then Resend dashboard -> Emails/Logs.
  - "ERROR ... not verified"   -> the sender domain isn't fully verified yet.
  - "ERROR ... testing / can only send to your own address"
                               -> account still in test mode; verify domain /
                                  add billing, or send to the account owner email.
  - "RESEND_API_KEY missing"   -> .env not loaded or key blank.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import resend  # noqa: E402

key = os.environ.get("RESEND_API_KEY")
sender_email = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
sender_name = os.environ.get("SENDER_NAME", "Oakbridge Publishing")

if not key:
    print("RESEND_API_KEY missing — .env not loaded or key is blank.")
    sys.exit(1)

to = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ADMIN_NOTIFY_EMAIL", "")
if not to:
    print("Usage: python test_email.py you@example.com")
    sys.exit(1)

resend.api_key = key
print(f"From: {sender_name} <{sender_email}>")
print(f"To:   {to}")
print(f"Key:  {key[:3]}...{key[-3:]}  (len {len(key)})")

try:
    result = resend.Emails.send(
        {
            "from": f"{sender_name} <{sender_email}>",
            "to": [to],
            "subject": "Oakbridge — Resend test",
            "html": "<p>If you can read this, Resend delivery works. 🎉</p>",
        }
    )
    print("OK id=", result.get("id"))
except Exception as e:  # noqa: BLE001
    print("ERROR:", repr(e))
    # Resend puts the useful detail in the exception body/message
    for attr in ("message", "args"):
        val = getattr(e, attr, None)
        if val:
            print(f"  {attr}: {val}")
