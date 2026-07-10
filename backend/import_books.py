"""
One-time catalogue import for Oakbridge.

Loads the 200 real books from `books_seed.json` (generated from your XLSX +
covers) into MongoDB, replacing the demo books, and reconciles the 3 real
categories. Covers are already optimised into `backend/storage/oakbridge/covers/`
and served at /api/files/...

Run once (backend venv active), from the backend/ folder:
    python import_books.py
Then restart the backend and hard-refresh the storefront.
"""
import json
import os
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

CATEGORIES = [
    {"id": "academic", "name": "Academic",
     "description": "Scholarly textbooks and reference works for Civil Services, UPSC and university programmes.",
     "image": "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=85"},
    {"id": "professional", "name": "Professional",
     "description": "Authoritative law and tax titles — commentaries, treatises and practitioner guides.",
     "image": "https://images.unsplash.com/photo-1589994965851-a8f479c573a9?auto=format&fit=crop&w=1200&q=85"},
    {"id": "bgr", "name": "Business & General",
     "description": "Business, governance, leadership and general-interest titles.",
     "image": "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1200&q=85"},
]


def main():
    seed_path = ROOT / "books_seed.json"
    if not seed_path.exists():
        raise SystemExit(f"books_seed.json not found at {seed_path}")
    books = json.loads(seed_path.read_text(encoding="utf-8"))
    print(f"Loaded {len(books)} books from books_seed.json")

    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # --- categories: upsert the 3 real ones, drop the rest ---
    ids = [c["id"] for c in CATEGORIES]
    for c in CATEGORIES:
        db.categories.update_one({"id": c["id"]}, {"$set": c}, upsert=True)
    removed = db.categories.delete_many({"id": {"$nin": ids}}).deleted_count
    print(f"Categories reconciled to {ids} (removed {removed} stale)")

    # --- books: replace demo catalogue with the real one ---
    cleared = db.books.delete_many({}).deleted_count
    print(f"Cleared {cleared} existing books")
    db.books.insert_many(books)
    print(f"Inserted {len(books)} books")

    cats = Counter(b["category"] for b in books)
    placeholders = sum(1 for b in books if str(b.get("cover_image", "")).endswith("_placeholder.jpg"))
    print("By category:", dict(cats))
    print(f"Real covers: {len(books) - placeholders} | placeholder (need upload): {placeholders}")
    print("\nDone. Restart the backend and hard-refresh the storefront.")


if __name__ == "__main__":
    main()
