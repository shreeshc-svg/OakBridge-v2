"""
Attach a preview PDF to a book from the command line (local dev helper).

Renders the PDF to page images via the same code path the admin upload uses,
so what you see locally is what production will serve.

Usage
-----
    python backend/attach_preview.py --isbn 9789389176483 --pdf "../import/preview.pdf"
    python backend/attach_preview.py --book-id <id> --pdf preview.pdf --max-pages 20

Requires MONGO_URL and DB_NAME in the environment.
"""

import argparse
import asyncio
import os
import re
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", help="path to the preview PDF (omit when using --remove)")
    ap.add_argument("--isbn", help="ISBN of the book to attach to")
    ap.add_argument("--book-id", help="book id (alternative to --isbn)")
    ap.add_argument("--max-pages", type=int, default=40)
    ap.add_argument("--remove", action="store_true", help="detach the preview from this book")
    ap.add_argument("--mongo-url", help="override MONGO_URL (e.g. to target Atlas from a local .env)")
    ap.add_argument("--db-name", help="override DB_NAME")
    args = ap.parse_args()

    if not args.isbn and not args.book_id:
        print("ERROR: pass --isbn or --book-id")
        return 1

    if not args.remove:
        if not args.pdf:
            print("ERROR: --pdf is required (or use --remove)")
            return 1
        pdf = Path(args.pdf)
        if not pdf.exists():
            print(f"ERROR: {pdf} not found")
            return 1

    # Load backend/.env so this always targets the SAME database the API uses.
    # (Explicit environment variables still win, for one-off overrides.)
    try:
        from dotenv import load_dotenv

        # override=True: backend/.env is the source of truth. Without this, a stale
        # or malformed MONGO_URL left in the shell would silently win.
        load_dotenv(Path(__file__).resolve().parent / ".env", override=True)
    except ImportError:
        pass

    mongo_url = args.mongo_url or re.sub(r"\s+#.*$", "", os.environ.get("MONGO_URL", "")).strip()
    db_name = args.db_name or re.sub(r"\s+#.*$", "", os.environ.get("DB_NAME", "")).strip()
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME must be set (in backend/.env or the environment).")
        return 1
    host = mongo_url.split("@")[-1].split("/")[0]
    print(f"Database: {db_name} @ {host}")

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    # Import ONLY the storage helper — not features.py, which would drag in FastAPI.
    from storage_util import render_pdf_pages  # noqa: E402

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    if args.book_id:
        book = await db.books.find_one({"id": args.book_id}, {"_id": 0})
    else:
        digits = re.sub(r"[^0-9Xx]", "", args.isbn)
        book = await db.books.find_one({"isbn": {"$regex": digits}}, {"_id": 0})
    if not book:
        print("ERROR: book not found")
        return 1

    if args.remove:
        res = await db.books.update_one(
            {"id": book["id"]},
            {"$unset": {"preview_paths": "", "preview_filename": "", "preview_source_pages": "", "preview_uploaded_at": ""}},
        )
        print(f"Removed preview from: {book['title']}  ({res.modified_count} updated)")
        return 0

    print(f"Attaching preview to: {book['title']}  [{book.get('isbn')}]")
    data = pdf.read_bytes()

    import pypdfium2 as pdfium

    source_pages = len(pdfium.PdfDocument(data))
    paths = render_pdf_pages(data, book["id"], args.max_pages)

    await db.books.update_one(
        {"id": book["id"]},
        {
            "$set": {
                "preview_paths": paths,
                "preview_filename": pdf.name,
                "preview_source_pages": source_pages,
            }
        },
    )
    print(f"Done — {len(paths)} of {source_pages} pages rendered and attached.")
    print(f"View: /books/{book['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
