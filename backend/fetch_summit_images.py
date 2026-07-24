"""
Download the Summit speaker photos into local storage, ready for the S3 uploader.
Run locally (your machine can reach oakbridge.events).

    cd backend
    python fetch_summit_images.py
    python upload_storage_to_s3.py        # pushes storage/ (incl. these) to S3

Reads summit_images_manifest.csv (source_url -> s3_filename) and writes each image
to storage/oakbridge/events/summit/<s3_filename>. Re-runnable; skips files already
downloaded. Images are resized/optimised to keep the page light.
"""
from __future__ import annotations

import csv
import io
import os
import sys

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "summit_images_manifest.csv")
OUT = os.path.join(HERE, "storage", "oakbridge", "events", "summit")


def main() -> int:
    if not os.path.exists(MANIFEST):
        print(f"ERROR: manifest not found at {MANIFEST}", file=sys.stderr)
        return 2
    os.makedirs(OUT, exist_ok=True)
    rows = list(csv.DictReader(open(MANIFEST, encoding="utf-8")))
    print(f"{len(rows)} images to fetch -> {OUT}")

    ok = skip = fail = 0
    for i, r in enumerate(rows, 1):
        src, name = r["source_url"], r["s3_filename"]
        dest = os.path.join(OUT, name)
        if os.path.exists(dest):
            skip += 1
            continue
        try:
            resp = requests.get(src, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            im = Image.open(io.BytesIO(resp.content)).convert("RGB")
            im.thumbnail((800, 800), Image.LANCZOS)
            # Keep the manifest's extension in the filename; encode as JPEG bytes
            # (browsers sniff content, and the /api/files proxy serves by path).
            im.save(dest, "JPEG", quality=85, optimize=True)
            ok += 1
            if i % 10 == 0:
                print(f"  ... {i}/{len(rows)}")
        except Exception as exc:  # noqa: BLE001
            fail += 1
            print(f"  FAILED {name}: {exc}")

    print(f"\ndone - downloaded {ok}, skipped {skip} (already present), failed {fail}")
    print("next: python upload_storage_to_s3.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
