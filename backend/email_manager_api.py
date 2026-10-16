"""Admin → Email Manager API. The logic lives in email_manager.py (no FastAPI
there, so the emailer and its tests can import it without the web stack).

Under /api/admin/marketing/… on purpose: rbac grants it with the Marketing
section, so whoever runs campaigns runs these emails too, and no new
permission has to be invented and kept in sync in two places.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import email_manager as em
from extensions import db, require_admin

log = logging.getLogger(__name__)
admin_router = APIRouter(prefix="/api/admin/marketing/emails", tags=["email-manager"], dependencies=[Depends(require_admin)])


class ConfigBody(BaseModel):
    config: dict


class KindBody(BaseModel):
    kind: str
    # Unsaved settings from the editor, so the preview shows what you are
    # typing before you press Save. Cleaned exactly like a save.
    config: Optional[dict] = None


@admin_router.get("")
async def get_manager():
    cfg = await em.get_config(fresh=True)
    try:
        counts = await em.counts_30d()
    except Exception:  # noqa: BLE001
        log.exception("email counts failed")
        counts = {}
    # The two Growth automations are edited in Marketing → Growth (their own
    # consent rules); shown here read-only so the list of customer emails is complete.
    try:
        from growth import get_automations
        growth = await get_automations()
    except Exception:  # noqa: BLE001
        growth = {}
    kinds = [{**k, "counts": counts.get(k["key"], {"sent": 0, "failed": 0, "skipped": 0}),
              "enabled": em.enabled(k["key"], cfg)} for k in em.KINDS]
    return {"config": cfg, "defaults": em.DEFAULT_CFG, "kinds": kinds, "merge_fields": list(em.MERGE_FIELDS), "growth": growth}


@admin_router.put("")
async def put_manager(body: ConfigBody, user: dict = Depends(require_admin)):
    cfg = await em.save_config(body.config)
    try:
        from audit import audit_log
        await audit_log(db, "EMAIL_MANAGER_SAVED", email=user.get("email", ""), role=user.get("role", ""), meta={})
    except Exception:  # noqa: BLE001
        log.exception("audit failed")
    return {"ok": True, "config": cfg}


def _render(kind: str, raw_cfg: Any) -> tuple[str, str]:
    if kind not in em.KIND_KEYS:
        raise HTTPException(status_code=404, detail="Unknown email")
    cfg = em.clean_cfg(raw_cfg)
    subject, html, ctx = em.sample(kind)
    if kind == "delivered":
        ctx = {**ctx, "extra_html": ""}
    return em.subject_for(kind, subject, ctx, cfg), em.personalise(html, kind, ctx, cfg)


@admin_router.post("/preview")
async def preview(body: KindBody):
    raw = body.config if body.config is not None else await em.get_config(fresh=True)
    subject, html = _render(body.kind, raw)
    return {"subject": subject, "html": html}


@admin_router.post("/test")
async def send_test(body: KindBody, user: dict = Depends(require_admin)):
    """Send the sample to the signed-in admin ONLY — never to an address typed
    in the request, so this can't be used to mail anyone else."""
    to = (user.get("email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Your account has no email address")
    raw = body.config if body.config is not None else await em.get_config(fresh=True)
    subject, html = _render(body.kind, raw)
    from emailer import send_email
    cfg = em.clean_cfg(raw)
    ok = await send_email(to=to, subject=f"[Test] {subject}", html=html, reply_to=cfg.get("reply_to") or None)
    if not ok:
        raise HTTPException(status_code=502, detail="The email service did not accept the test — check RESEND_API_KEY")
    return {"ok": True, "to": to}


@admin_router.get("/log")
async def get_log(kind: Optional[str] = None, limit: int = 100):
    q: dict = {}
    if kind:
        if kind not in em.KIND_KEYS:
            raise HTTPException(status_code=404, detail="Unknown email")
        q["kind"] = kind
    rows = await db.email_log.find(q, {"_id": 0, "at_dt": 0}).sort("at_dt", -1).limit(max(1, min(int(limit), 300))).to_list(300)
    return {"items": rows}
