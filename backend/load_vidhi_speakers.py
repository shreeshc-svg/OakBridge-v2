"""
Load the 211 scraped Vidhi Utsav speakers into the events_vidhi_speakers
content collection (replaces whatever's there now).

    cd backend
    python load_vidhi_speakers.py --dry-run
    python load_vidhi_speakers.py

Connection string: reads mongo.txt (same file used by load_authors.py) or the
Render MONGO_URL, or prompts. Must point at Atlas (production), not local Mongo.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = "events_vidhi_speakers"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--file", default=os.path.join(HERE, "vidhi_speakers_seed.json"))
    ap.add_argument("--mongo-url", default=None)
    ap.add_argument("--db-name", default=None)
    args = ap.parse_args()

    env = os.path.join(HERE, ".env")
    if os.path.exists(env):
        load_dotenv(env, override=True)

    mongo = args.mongo_url or os.environ.get("MONGO_URL")
    mongo_txt = os.path.join(HERE, "mongo.txt")
    if not mongo and os.path.exists(mongo_txt):
        mongo = open(mongo_txt, encoding="utf-8").read().strip().strip('"').strip("'")
        print(f"read connection string from {mongo_txt}")
    if not mongo:
        mongo = input("Atlas URL (mongodb+srv://...): ").strip().strip('"').strip("'")
    if not mongo:
        print("ERROR: no connection string.", file=sys.stderr)
        return 2

    import re
    dbname = args.db_name or os.environ.get("DB_NAME")
    if not dbname:
        m = re.search(r"\.net/([^?]+)", mongo)
        guess = (m.group(1) if m else "").strip("/") or "oakbridge"
        dbname = input(f"Database name [{guess}]: ").strip() or guess

    items = json.load(open(args.file, encoding="utf-8"))
    # store only the fields the storefront uses (name, role, photo, year)
    docs = [
        {
            "name": r["name"],
            "role": r["role"],
            "photo": r["photo"],
            "year": str(r.get("year") or ""),
        }
        for r in items
    ]

    client = MongoClient(mongo, serverSelectionTimeoutMS=15000)
    client.admin.command("ping")
    db = client[dbname]
    existing = await_count(db)
    print(f"connected OK. current {KEY} items: {existing} | incoming: {len(docs)}")
    if args.dry_run:
        print("[dry-run] no changes made. Re-run without --dry-run to write.")
        return 0
    db.content_collections.update_one(
        {"key": KEY}, {"$set": {"key": KEY, "items": docs}}, upsert=True
    )
    print(f"loaded {len(docs)} speakers into {KEY}.")
    return 0


def await_count(db):
    doc = db.content_collections.find_one({"key": KEY}, {"_id": 0, "items": 1})
    return len((doc or {}).get("items", []) or [])


if __name__ == "__main__":
    raise SystemExit(main())
