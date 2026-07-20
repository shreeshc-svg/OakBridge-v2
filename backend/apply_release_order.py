"""
Apply the publisher's release order to the catalogue.

Source of truth: `release_order.json`, generated from TITLE MASTER 2026.xlsx.
Ordered newest -> oldest by real publication date (rank 1 = most recent).

Writes onto each matching book:
    release_rank      int    drives the "New Arrivals" / "Newest" sorts (ascending)
    publication_date  str    ISO date, e.g. "2026-03-01"
    publication_year  int

Books are matched on **ISBN** (digits only), which is exact — no fuzzy title
matching. Books with no rank sort to the END of New Arrivals, never the front.

NOTE: prices are deliberately NOT touched. The master's "Price (INR)" is the MRP,
which the catalogue already stores as `original_price`; the selling `price` is a
20% discount off that. Overwriting `price` with the MRP would raise every book 25%.

Usage
-----
    python backend/apply_release_order.py --dry-run   # preview, writes nothing
    python backend/apply_release_order.py             # write

Requires MONGO_URL and DB_NAME in the environment (same as the API).
"""

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

HERE = Path(__file__).resolve().parent
ORDER_FILE = HERE / "release_order.json"


def clean_isbn(value) -> str:
    """Digits-only ISBN so formatting differences (dashes, spaces) don't matter."""
    return re.sub(r"[^0-9Xx]", "", str(value or ""))


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME must be set in the environment.")
        return 1
    if not ORDER_FILE.exists():
        print(f"ERROR: {ORDER_FILE} not found.")
        return 1

    order = json.loads(ORDER_FILE.read_text(encoding="utf-8"))
    by_isbn = {clean_isbn(e["isbn"]): e for e in order if e.get("isbn")}

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    books = await db.books.find({}, {"_id": 0, "id": 1, "title": 1, "isbn": 1}).to_list(None)

    print(f"catalogue: {len(books)} books | release order: {len(order)} titles")

    matched, unmatched = [], []
    for b in books:
        entry = by_isbn.get(clean_isbn(b.get("isbn")))
        (matched if entry else unmatched).append((b, entry))

    print(f"matched by ISBN: {len(matched)}   unmatched: {len(unmatched)}")
    if unmatched:
        print("\nNo release-order entry (these will sort last in New Arrivals):")
        for b, _ in unmatched:
            print(f"  - [{b.get('isbn')}] {b.get('title')}")

    if args.dry_run:
        print("\nTop 10 New Arrivals after this change:")
        for b, e in sorted(matched, key=lambda x: x[1]["rank"])[:10]:
            print(f"  {e['publication_date']}  {b['title'][:66]}")
        print("\nDry run — nothing written.")
        return 0

    updated = 0
    for b, e in matched:
        res = await db.books.update_one(
            {"id": b["id"]},
            {
                "$set": {
                    "release_rank": e["rank"],
                    "publication_date": e["publication_date"],
                    "publication_year": e["year"],
                }
            },
        )
        updated += res.modified_count

    print(f"\nDone. {len(matched)} books ranked ({updated} modified).")
    print("Verify: /api/books?sort=new_arrivals&limit=5")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
