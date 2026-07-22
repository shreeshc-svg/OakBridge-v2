"""
Replace the seeded placeholder authors with the real roster scraped from the
old oakbridge.in/writers site.

    python load_authors.py            # replace db.authors with authors_seed_real.json
    python load_authors.py --dry-run  # show what would change, touch nothing
    python load_authors.py --keep     # upsert by id, don't delete existing

Reads MONGO_URL / DB_NAME from backend/.env (override=True, so a stale shell var
can't win — the bug that bit the preview loader).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

HERE = os.path.dirname(os.path.abspath(__file__))


def _clean_env(path: str) -> None:
    # load_dotenv won't override an existing (possibly poisoned) shell var
    if os.path.exists(path):
        load_dotenv(path, override=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keep", action="store_true", help="upsert by id instead of replacing all")
    ap.add_argument("--mongo-url", default=None)
    ap.add_argument("--db-name", default=None)
    ap.add_argument("--file", default=os.path.join(HERE, "authors_seed_real.json"))
    args = ap.parse_args()

    _clean_env(os.path.join(HERE, ".env"))
    mongo = args.mongo_url or os.environ.get("MONGO_URL")
    dbname = args.db_name or os.environ.get("DB_NAME")

    # Preferred input: a plain text file `mongo.txt` next to this script containing
    # ONLY the connection string. Reading from a file removes every terminal
    # paste / quoting / $variable problem in one go.
    mongo_txt = os.path.join(HERE, "mongo.txt")
    if not mongo and os.path.exists(mongo_txt):
        mongo = open(mongo_txt, encoding="utf-8").read().strip().strip('"').strip("'")
        print(f"read connection string from {mongo_txt}")

    if not mongo:
        print("\nNo connection string found.")
        print(f"Easiest fix: paste your Render MONGO_URL into a file named 'mongo.txt' in")
        print(f"this folder ({HERE}), save, and run this again.")
        print("Or paste it at the prompt below (Enter to abort):")
        mongo = input("Atlas URL: ").strip().strip('"').strip("'")
    if not mongo:
        return 2

    if not dbname:
        # infer db name from the URL path if present, else ask
        m = re.search(r"\.net/([^?]+)", mongo)
        guess = (m.group(1) if m else "").strip("/") or "oakbridge"
        entered = input(f"Database name [{guess}]: ").strip()
        dbname = entered or guess

    records = json.load(open(args.file, encoding="utf-8"))
    docs = [{k: v for k, v in r.items() if not k.startswith("_")} for r in records]

    def _try(url: str):
        c = MongoClient(url, serverSelectionTimeoutMS=15000)
        c.admin.command("ping")   # forces auth now, with a clear error
        return c

    # Attempt as given; if auth fails, retry with the password percent-encoded
    # (covers the very common "special char in password" case).
    from urllib.parse import quote_plus
    from pymongo.errors import OperationFailure
    client = None
    try:
        client = _try(mongo)
    except OperationFailure:
        m = re.match(r"^(mongodb(?:\+srv)?://)([^:]+):([^@]+)@(.+)$", mongo)
        if m:
            fixed = f"{m.group(1)}{quote_plus(m.group(2))}:{quote_plus(m.group(3))}@{m.group(4)}"
            if fixed != mongo:
                print("auth failed as-is — retrying with the password URL-encoded…")
                client = _try(fixed)
    if client is None:
        print("\nERROR: Atlas rejected the credentials (bad auth).")
        print("The username or password in the string is wrong. Copy MONGO_URL")
        print("verbatim from Render → your service → Environment, and make sure the")
        print("password matches your latest rotation. Then update mongo.txt and retry.")
        return 3

    db = client[dbname]
    before = db.authors.count_documents({})
    print(f"connected OK. authors in DB now: {before}  |  incoming: {len(docs)}")

    if args.dry_run:
        matched = sum(1 for d in docs if d.get("title_count", 0) > 0)
        print(f"[dry-run] would {'upsert' if args.keep else 'REPLACE ALL with'} {len(docs)} authors "
              f"({matched} linked to catalogue books). No changes made.")
        return 0

    if args.keep:
        for d in docs:
            db.authors.update_one({"id": d["id"]}, {"$set": d}, upsert=True)
        print(f"upserted {len(docs)} authors (existing rows kept)")
    else:
        db.authors.delete_many({})
        db.authors.insert_many(docs)
        print(f"replaced: deleted {before}, inserted {len(docs)}")

    print("done — the /authors page now serves the real roster.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
