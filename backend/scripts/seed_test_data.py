"""
Fill a TEST database with fake marketing data for load testing.

    LOADTEST_MONGO_URL=... LOADTEST_DB_NAME=oakbridge_loadtest \\
        python backend/scripts/seed_test_data.py --contacts 50000 --sends 100000

Refuses to run against production:
  * LOADTEST_DB_NAME must be set and must not be "oakbridge" (the live DB name),
  * LOADTEST_MONGO_URL must be set explicitly and must differ from MONGO_URL
    unless the database names differ (same cluster, separate test DB is fine).
Never paste a connection string into chat — put it in your shell or mongo.txt.

Every address is on the reserved .test domain (RFC 2606), so nothing seeded
here can ever be delivered to a real person, even by mistake.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

LIVE_DB_NAMES = {"oakbridge"}


def refuse(msg: str) -> None:
    print(f"REFUSED: {msg}")
    sys.exit(2)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contacts", type=int, default=50000)
    ap.add_argument("--sends", type=int, default=100000)
    ap.add_argument("--wipe", action="store_true", help="delete previously seeded test data first")
    a = ap.parse_args()
    url, name = os.environ.get("LOADTEST_MONGO_URL"), os.environ.get("LOADTEST_DB_NAME")
    if not url or not name:
        refuse("set LOADTEST_MONGO_URL and LOADTEST_DB_NAME (a separate test database)")
    if name.strip().lower() in LIVE_DB_NAMES:
        refuse(f"'{name}' is the live database name")
    if url == os.environ.get("MONGO_URL") and name == os.environ.get("DB_NAME"):
        refuse("that is the live database")
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(url)[name]
    if a.wipe:
        await db.mk_contacts.delete_many({"seeded": True})
        await db.mk_sends.delete_many({"seeded": True})
        await db.mk_campaigns.delete_many({"seeded": True})
    now = datetime.now(timezone.utc)
    statuses = ["verified"] * 3 + ["valid"] * 5 + ["risky", "invalid"]
    print(f"seeding {a.contacts} contacts…")
    ids = []
    for start in range(0, a.contacts, 2000):
        docs = []
        for i in range(start, min(start + 2000, a.contacts)):
            cid = str(uuid.uuid4())
            ids.append(cid)
            st = random.choice(statuses)
            docs.append({"id": cid, "email": f"user{i}@load{i % 50}.test", "email_norm": f"user{i}@load{i % 50}.test",
                         "name": f"Test User {i}", "email_status": st, "score": random.randint(20, 95),
                         "email_consent": {"status": "subscribed", "source": "loadtest", "at": now.isoformat()},
                         "wa_consent": {"status": "none"}, "lists": ["loadtest"], "suppressed": "", "seeded": True,
                         "created_at": (now - timedelta(days=random.randint(0, 120))).isoformat(),
                         "stats": {"sent": 0, "opened": 0, "clicked": 0}})
        await db.mk_contacts.insert_many(docs, ordered=False)
    camp = {"id": str(uuid.uuid4()), "name": "Load test", "channel": "email", "status": "sent", "seeded": True,
            "started_at": (now - timedelta(days=5)).isoformat(), "blocks": [], "stats": {}}
    await db.mk_campaigns.insert_one(camp)
    print(f"seeding {a.sends} sends…")
    for start in range(0, a.sends, 5000):
        docs = []
        for i in range(start, min(start + 5000, a.sends)):
            sent = now - timedelta(days=random.randint(0, 60), minutes=random.randint(0, 1440))
            st = random.choices(["sent", "bounced", "complained"], [97, 2.5, 0.5])[0]
            d = {"id": str(uuid.uuid4()), "campaign_id": f"{camp['id']}-{i // 50000}", "contact_id": ids[i % len(ids)] + f"-{i}",
                 "status": st, "sent_at": sent.isoformat(), "band": random.choice(["verified", "valid", "risky"]),
                 "score": random.randint(30, 95), "flags": random.sample(["ses_high", "ses_medium", "name_match", "made_up"], 2),
                 "seeded": True}
            if random.random() < 0.3:
                d["opened_at"] = (sent + timedelta(hours=random.randint(0, 48))).isoformat()
            if random.random() < 0.05:
                d["clicked_at"] = (sent + timedelta(hours=random.randint(0, 48))).isoformat()
            docs.append(d)
        await db.mk_sends.insert_many(docs, ordered=False)
    print("done. Point a local backend at this DB (MONGO_URL/DB_NAME) and run scripts/loadtest.py against it.")


if __name__ == "__main__":
    asyncio.run(main())
