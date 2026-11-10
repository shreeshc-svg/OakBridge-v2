"""Encryption for the few HRM figures that are truly sensitive (annual CTC).

WHY: salaries are the most sensitive numbers the HRM holds. They are stored
encrypted, so a database export, backup or leaked connection string shows
scrambled text — only this app, holding the key, can read them.

KEY: the Render environment variable HRM_DATA_KEY — any long random text (at
least 32 characters; a password manager's generator is ideal). The actual
encryption key is derived from it (PBKDF2-SHA256, 200,000 rounds) once per
process. Without HRM_DATA_KEY nothing is encrypted or decrypted and the HRM
refuses to store a CTC at all (configured() == False).

!! Changing or losing HRM_DATA_KEY makes stored CTCs unreadable. Keep a copy
   in the founders' password manager. Never paste it in chat or code.
"""
from __future__ import annotations

import base64
import hashlib
import os
from typing import Optional

_SALT = b"oakbridge-hrm-ctc-v1"
_cache: dict = {}
MIN_KEY = 32


def configured() -> bool:
    return len((os.environ.get("HRM_DATA_KEY") or "").strip()) >= MIN_KEY


def _fernet():
    from cryptography.fernet import Fernet
    secret = (os.environ.get("HRM_DATA_KEY") or "").strip()
    if len(secret) < MIN_KEY:
        raise RuntimeError("HRM_DATA_KEY is not set (or shorter than 32 characters).")
    if _cache.get("secret") != secret:
        raw = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), _SALT, 200_000, dklen=32)
        _cache.update(secret=secret, f=Fernet(base64.urlsafe_b64encode(raw)))
    return _cache["f"]


def encrypt_amount(rupees: int) -> str:
    return _fernet().encrypt(str(int(rupees)).encode("ascii")).decode("ascii")


def decrypt_amount(token: Optional[str]) -> Optional[int]:
    """None for no value; raises if the key is wrong (never returns a guess)."""
    if not token:
        return None
    return int(_fernet().decrypt(token.encode("ascii")).decode("ascii"))
