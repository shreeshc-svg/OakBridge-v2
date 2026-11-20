"""Who got which email, and when — search people across campaigns (Nov 2026).

    GET /api/admin/marketing/people?q=                       people + every campaign / automation they got
    GET /api/admin/marketing/campaigns/{cid}/recipients      one campaign's recipients: ?q= &outcome= &page=
    GET /api/admin/marketing/sends/{send_id}/email           the email as THAT person received it

Search (marketing_core.people_filter): any part of the email, every word of
the name in any order, or 4+ digits of the phone with any separators. An
address we mailed whose contact has since been deleted is still found, by
the address on the send itself (`to`), so "did we email this person?" never
answers no just because the record was cleaned up.

The email view re-renders the campaign for that one person — their name,
their personal fields (offer link, pass number) from the campaign's own
lists — with links shown as they were, untracked. "Picked for you" books
are chosen at send time and not stored, so for those emails the view shows
today's picks and says so. Automated emails (abandoned checkout, review
request) are built per order and not stored: the view says what and when.

Admin only (Marketing section). Read-only.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import marketing_core as core
from extensions import db, require_admin

router = APIRouter(prefix="/api/admin/marketing", tags=["marketing-admin"], dependencies=[Depends(require_admin)])

PEOPLE_MAX = 30           # people per search
SENDS_PER_PERSON = 100    # newest first
PAGE = 50

SEND_FIELDS = {"_id": 0, "id": 1, "campaign_id": 1, "contact_id": 1, "to": 1, "status": 1, "queued_at": 1, "sent_at": 1,
               "delivered_at": 1, "opened_at": 1, "clicked_at": 1, "click_count": 1, "unsubscribed_at": 1,
               "bounce_type": 1, "error": 1, "automation": 1, "order_id": 1}
OUTCOMES = ("clicked", "opened", "delivered", "sent", "bounced", "complained", "unsubscribed", "skipped", "failed", "queued", "blocked")


def _send_view(s: dict, camps: dict) -> dict:
    c = camps.get(s.get("campaign_id")) or {}
    return {"send_id": s["id"], "campaign_id": s.get("campaign_id"), "campaign": c.get("name") or s.get("campaign_id"),
            "subject": c.get("subject") or "", "channel": c.get("channel") or "email",
            "automation": bool(s.get("automation")) or str(s.get("campaign_id") or "").startswith("auto-"),
            "to": s.get("to") or "", "outcome": core.send_outcome(s), "status": s.get("status"),
            "at": s.get("sent_at") or s.get("queued_at"), "delivered_at": s.get("delivered_at"),
            "opened_at": s.get("opened_at"), "clicked_at": s.get("clicked_at"), "clicks": int(s.get("click_count") or 0),
            "error": (s.get("error") or s.get("bounce_type") or "")[:160]}


async def _campaigns(ids) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return {c["id"]: c async for c in db.mk_campaigns.find({"id": {"$in": ids}},
                                                           {"_id": 0, "id": 1, "name": 1, "subject": 1, "channel": 1, "kind": 1})}


@router.get("/people")
async def people(q: str = ""):
    flt = core.people_filter(q)
    if flt is None:
        return {"q": q, "people": [], "note": "Type at least 2 letters, or 4 digits of a phone number."}
    contacts = await db.mk_contacts.find(flt, {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "email_status": 1,
                                               "email_consent": 1, "lists": 1, "source": 1}).limit(PEOPLE_MAX * 4).to_list(PEOPLE_MAX * 4)
    contacts.sort(key=lambda c: core.people_rank(c, q))
    more = len(contacts) > PEOPLE_MAX
    contacts = contacts[:PEOPLE_MAX]
    ids = [c["id"] for c in contacts]
    sends = await db.mk_sends.find({"contact_id": {"$in": ids}}, SEND_FIELDS).to_list(PEOPLE_MAX * SENDS_PER_PERSON) if ids else []
    # Addresses mailed whose contact was deleted since: found by the send's own `to`.
    t = core.people_terms(q)
    orphans = []
    if "@" in t["text"] or (len(t["text"]) >= 4 and not t["digits"]):
        known = {(c.get("email") or "").lower() for c in contacts}
        async for s in db.mk_sends.find({"to": {"$regex": re.escape(t["text"]), "$options": "i"},
                                         "contact_id": {"$nin": ids}}, SEND_FIELDS).limit(300):
            if (s.get("to") or "").lower() not in known:
                orphans.append(s)
    camps = await _campaigns([s.get("campaign_id") for s in sends + orphans])
    lists = {x["id"]: x.get("name", "") async for x in db.mk_lists.find(
        {"id": {"$in": list({lid for c in contacts for lid in c.get("lists") or []})}}, {"_id": 0, "id": 1, "name": 1})}
    by_contact: dict = {}
    for s in sends:
        by_contact.setdefault(s.get("contact_id"), []).append(s)
    out = []
    for c in contacts:
        rows = sorted(by_contact.get(c["id"], []), key=lambda s: s.get("sent_at") or s.get("queued_at") or "", reverse=True)
        out.append({"id": c["id"], "name": c.get("name") or "", "email": c.get("email") or "", "phone": c.get("phone") or "",
                    "email_status": c.get("email_status"), "consent": (c.get("email_consent") or {}).get("status"),
                    "lists": [lists.get(x, "") for x in c.get("lists") or [] if lists.get(x)], "source": c.get("source") or "",
                    "sends": [_send_view(s, camps) for s in rows[:SENDS_PER_PERSON]], "send_count": len(rows)})
    by_addr: dict = {}
    for s in orphans:
        by_addr.setdefault((s.get("to") or "").lower(), []).append(s)
    for addr, rows in list(by_addr.items())[:10]:
        rows.sort(key=lambda s: s.get("sent_at") or s.get("queued_at") or "", reverse=True)
        out.append({"id": None, "name": "", "email": addr, "phone": "", "removed": True, "lists": [], "source": "",
                    "sends": [_send_view(s, camps) for s in rows[:SENDS_PER_PERSON]], "send_count": len(rows)})
    return {"q": q, "people": out, "more": more}


@router.get("/campaigns/{cid}/recipients")
async def recipients(cid: str, q: str = "", outcome: str = "", page: int = 1):
    camp = await db.mk_campaigns.find_one({"id": cid}, {"_id": 0, "id": 1, "name": 1, "subject": 1, "channel": 1})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    flt: dict = {"campaign_id": cid}
    if q.strip():
        pf = core.people_filter(q)
        if pf is None:
            return {"total": 0, "rows": [], "page": 1, "pages": 0, "counts": {}, "note": "Type at least 2 letters, or 4 digits of a phone number."}
        ids = [c["id"] async for c in db.mk_contacts.find(pf, {"_id": 0, "id": 1}).limit(5000)]
        flt["$or"] = [{"contact_id": {"$in": ids}}, {"to": {"$regex": re.escape(core.people_terms(q)["text"]), "$options": "i"}}]
    # A campaign is at most a few thousand small rows: the outcome (furthest
    # step reached) is worked out the same way as the report and export.
    sends = await db.mk_sends.find(flt, SEND_FIELDS).to_list(100_000)
    counts: dict = {}
    for s in sends:
        o = core.send_outcome(s)
        s["_o"] = o
        counts[o] = counts.get(o, 0) + 1
    if outcome in OUTCOMES:
        sends = [s for s in sends if s["_o"] == outcome]
    sends.sort(key=lambda s: (s.get("sent_at") or s.get("queued_at") or ""), reverse=True)
    total, page = len(sends), max(1, int(page or 1))
    chunk = sends[(page - 1) * PAGE: page * PAGE]
    names = {c["id"]: c async for c in db.mk_contacts.find({"id": {"$in": [s.get("contact_id") for s in chunk if s.get("contact_id")]}},
                                                           {"_id": 0, "id": 1, "name": 1, "phone": 1})}
    camps = {cid: camp}
    rows = [{**_send_view(s, camps), "name": (names.get(s.get("contact_id")) or {}).get("name", ""),
             "phone": (names.get(s.get("contact_id")) or {}).get("phone", ""), "contact_id": s.get("contact_id")} for s in chunk]
    return {"total": total, "rows": rows, "page": page, "pages": (total + PAGE - 1) // PAGE, "counts": counts}


@router.get("/sends/{send_id}/email")
async def send_email(send_id: str):
    s = await db.mk_sends.find_one({"id": send_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Not found")
    camp = await db.mk_campaigns.find_one({"id": s.get("campaign_id")}, {"_id": 0}) or {}
    head = {"to": s.get("to"), "at": s.get("sent_at") or s.get("queued_at"), "outcome": core.send_outcome(s),
            "campaign": camp.get("name") or s.get("campaign_id"), "campaign_id": s.get("campaign_id"), "channel": camp.get("channel") or "email"}
    if s.get("automation") or str(s.get("campaign_id") or "").startswith("auto-"):
        return {**head, "html": "", "subject": camp.get("subject") or "",
                "note": "Automated email — built from the order at the time it was sent, so it isn't stored."
                        + (f" Order: {s.get('order_id')}." if s.get("order_id") else "")}
    if camp.get("channel") == "whatsapp":
        return {**head, "html": "", "subject": "", "note": f"WhatsApp template “{camp.get('wa_template') or '?'}”."}
    import marketing as mk
    contact = await db.mk_contacts.find_one({"id": s.get("contact_id")}, {"_id": 0}) or {"name": "", "email": s.get("to") or ""}
    contact["_fields"] = await mk.contact_fields(contact.get("id") or "", mk._camp_lists(camp))
    note = ""
    if mk._for_you_count(camp):
        await mk.attach_picks(contact, camp)
        note = "“Picked for you” books are chosen when the email is sent; this shows today's picks for this person."
    st = await mk.get_settings()
    html_doc, _ = core.render_email(camp.get("blocks") or [], brand={"name": "Oakbridge Publishing", "logo": st.get("logo"), "footer": st.get("footer"),
                                                                    "navy": "#002B5C", "red": "#CC0033"},
                                    contact=contact, link_for=lambda u: u, unsubscribe_url="#",
                                    preheader=core.personalise(camp.get("preheader") or "", contact))
    return {**head, "html": html_doc, "subject": core.personalise(camp.get("subject") or "", contact), "note": note}
