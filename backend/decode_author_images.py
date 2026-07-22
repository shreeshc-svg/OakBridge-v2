"""
Decode the base64 author-photo bundle (scraped from the old site in-browser)
into optimised JPEGs under storage, named by the same id the author records use.

    python decode_author_images.py \
        --bundle ../oakbridge-authors-images.json \
        --authors authors_seed_real.json

Writes storage/oakbridge/authors/<id>.png. After this, run the existing
upload_storage_to_s3.py to push them to S3 — they serve at
/api/files/oakbridge/authors/<id>.png, which is what the author records point at.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "storage", "oakbridge", "authors")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", default=os.path.join(HERE, "..", "oakbridge-authors-images.json"))
    ap.add_argument("--authors", default=os.path.join(HERE, "authors_seed_real.json"))
    ap.add_argument("--max", type=int, default=800, help="max edge px")
    args = ap.parse_args()

    imgs = json.load(open(args.bundle, encoding="utf-8"))          # { slug: {ext, data} }
    authors = json.load(open(args.authors, encoding="utf-8"))       # records with _slug + id
    slug2id = {a["_slug"]: a["id"] for a in authors if a.get("_slug")}

    os.makedirs(OUT, exist_ok=True)
    written = skipped = 0
    for slug, blob in imgs.items():
        data = (blob or {}).get("data") or ""
        if not data.startswith("data:image"):
            skipped += 1
            continue
        cid = slug2id.get(slug, re.sub(r"-\d+$", "", slug))
        raw = base64.b64decode(data.split(",", 1)[1])
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((args.max, args.max), Image.LANCZOS)
        # saved as .png key to match the author photo path, but JPEG-encoded for size
        out = os.path.join(OUT, f"{cid}.jpg")
        im.save(out, "JPEG", quality=86, optimize=True)
        written += 1

    print(f"wrote {written} author photos to {OUT}  (skipped {skipped})")
    print("next: python upload_storage_to_s3.py   (pushes storage/ to S3)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
