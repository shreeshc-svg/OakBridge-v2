"""Marketing email attachments — upload, remove, and load at send time (Nov 2026).

Admin → Marketing → a draft email campaign → Attachments. The rules (types,
macro/script inspection, 10 MB per email) live in marketing_attach_core.py.

Storage: <APP_NAME>/mk-attach/<uuid>.<ext>. "mk-attach" is a private segment
of /api/files (features._PRIVATE_SEGMENTS), so a draft's files are never
downloadable by URL; they leave only inside the emails.

Removing an attachment only unlinks it from the campaign. The stored object
is kept: "Duplicate campaign" copies the list, so two campaigns can share one
object, and deleting it from one would silently strip it from the other.

Locking: attachments change only while the campaign is a draft (or
scheduled), exactly like its text (marketing.adm_patch_campaign). Remove is a
POST, not DELETE, on purpose: rbac promotes every DELETE under /api/admin to
super admin, and marketing staff must be able to fix their own draft.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

import marketing_attach_core as core
from audit import audit_log
from extensions import db, require_admin

router = APIRouter(prefix="/api/admin/marketing/campaigns", tags=["marketing"], dependencies=[Depends(require_admin)])

EDITABLE = ("draft", "scheduled")


async def _draft(cid: str) -> dict:
    c = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "id": 1, "status": 1, "channel": 1, "attachments": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if c.get("channel") != "email":
        raise HTTPException(status_code=400, detail="Attachments are for email campaigns only.")
    if c.get("status") not in EDITABLE:
        raise HTTPException(status_code=409, detail="Attachments are locked once a campaign starts sending — duplicate it to change them.")
    return c


def public_view(atts: list) -> list:
    return [{k: a.get(k) for k in ("id", "name", "ext", "mime", "size", "by", "at")} for a in atts or []]


@router.post("/{cid}/attachments")
async def add_attachment(cid: str, file: UploadFile = File(...), user: dict = Depends(require_admin)):
    import uploads_guard
    from features import APP_NAME, put_object
    c = await _draft(cid)
    data = await uploads_guard.read_limited(file, core.MAX_TOTAL, "Attachment")
    atts = list(c.get("attachments") or [])
    try:
        core.check_room(atts, len(data))
        ext, mime = core.classify(file.filename or "", data)
    except core.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    path = f"{APP_NAME}/mk-attach/{uuid.uuid4()}.{ext}"
    await asyncio.to_thread(put_object, path, data, mime)
    name = core.safe_name(file.filename or f"attachment.{ext}")
    if not name.lower().endswith("." + ext) and not (ext == "jpg" and name.lower().endswith(".jpeg")):
        name = f"{name.rsplit('.', 1)[0]}.{ext}"
    att = {"id": str(uuid.uuid4()), "name": name, "ext": ext, "mime": mime, "size": len(data), "path": path,
           "by": user.get("email", ""), "at": datetime.now(timezone.utc).isoformat()}
    res = await db.mk_campaigns.update_one({"id": cid, "status": {"$in": list(EDITABLE)}}, {"$push": {"attachments": att}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="The campaign started sending while uploading — duplicate it to add files.")
    # Re-checked AFTER the push: two uploads at once each passed check_room on
    # their own, and together must still not exceed the limits.
    fresh = (await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "attachments": 1}) or {}).get("attachments") or []
    if len(fresh) > core.MAX_FILES or sum(int(a.get("size") or 0) for a in fresh) > core.MAX_TOTAL:
        await db.mk_campaigns.update_one({"id": cid}, {"$pull": {"attachments": {"id": att["id"]}}})
        raise HTTPException(status_code=400, detail=f"Attachments are limited to {core.MAX_FILES} files and 10 MB per email.")
    await audit_log(db, "MARKETING_ATTACHMENT_ADDED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"campaign": cid, "name": name, "bytes": len(data), "type": ext})
    return {"attachments": public_view(fresh)}


@router.post("/{cid}/attachments/{aid}/remove")
async def remove_attachment(cid: str, aid: str, user: dict = Depends(require_admin)):
    c = await _draft(cid)
    gone = next((a for a in c.get("attachments") or [] if a.get("id") == aid), None)
    if not gone:
        raise HTTPException(status_code=404, detail="Attachment not found")
    await db.mk_campaigns.update_one({"id": cid, "status": {"$in": list(EDITABLE)}}, {"$pull": {"attachments": {"id": aid}}})
    await audit_log(db, "MARKETING_ATTACHMENT_REMOVED", email=user.get("email", ""), role=user.get("role", ""),
                    meta={"campaign": cid, "name": gone.get("name", "")})
    fresh = (await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "attachments": 1}) or {}).get("attachments") or []
    return {"attachments": public_view(fresh)}


async def load(camp: dict) -> list:
    """[(name, mime, bytes)] for a campaign's attachments — read from storage
    ONCE per send run, not once per recipient. Raises if any file is missing:
    sending the email without a file it promises is worse than not sending."""
    from features import get_object
    out = []
    for a in camp.get("attachments") or []:
        data, _ = await asyncio.to_thread(get_object, a["path"])
        out.append((a["name"], a["mime"], data))
    return out
