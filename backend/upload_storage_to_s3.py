"""
One-time uploader: push everything under the local storage dir to the S3 bucket,
preserving the exact key layout the app serves at /api/files/<key>.

Run locally (from the backend folder) with your AWS creds + bucket set, e.g. (PowerShell):

    $env:S3_BUCKET="your-bucket-name"
    $env:S3_REGION="ap-south-1"
    $env:AWS_ACCESS_KEY_ID="AKIA..."
    $env:AWS_SECRET_ACCESS_KEY="..."
    python upload_storage_to_s3.py

Options:
    python upload_storage_to_s3.py --dir ./storage --prefix ""   # defaults shown
    python upload_storage_to_s3.py --dry-run                     # list only, no upload

Idempotent — re-running re-uploads (overwrites) the same keys, which is harmless.
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import sys

import boto3


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.environ.get("STORAGE_DIR", "storage"),
                    help="local storage directory to upload (default: ./storage)")
    ap.add_argument("--prefix", default=os.environ.get("S3_PREFIX", "").strip("/"),
                    help="optional key prefix in the bucket")
    ap.add_argument("--dry-run", action="store_true", help="list files without uploading")
    args = ap.parse_args()

    bucket = os.environ.get("S3_BUCKET") or os.environ.get("AWS_S3_BUCKET")
    region = (os.environ.get("S3_REGION") or os.environ.get("AWS_S3_REGION")
              or os.environ.get("AWS_REGION"))
    if not bucket:
        print("ERROR: set S3_BUCKET (and AWS creds) in the environment first.", file=sys.stderr)
        return 2

    root = os.path.abspath(args.dir)
    if not os.path.isdir(root):
        print(f"ERROR: storage dir not found: {root}", file=sys.stderr)
        return 2

    client = boto3.client("s3", region_name=region) if region else boto3.client("s3")

    uploaded = 0
    total_bytes = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            fpath = os.path.join(dirpath, name)
            rel = os.path.relpath(fpath, root).replace(os.sep, "/")
            key = f"{args.prefix}/{rel}" if args.prefix else rel
            ctype = mimetypes.guess_type(fpath)[0] or "application/octet-stream"
            size = os.path.getsize(fpath)
            if args.dry_run:
                print(f"[dry-run] {key}  ({ctype}, {size} bytes)")
                uploaded += 1
                total_bytes += size
                continue
            with open(fpath, "rb") as f:
                client.put_object(Bucket=bucket, Key=key, Body=f.read(), ContentType=ctype)
            uploaded += 1
            total_bytes += size
            print(f"uploaded {key}")

    verb = "would upload" if args.dry_run else "uploaded"
    print(f"\nDone — {verb} {uploaded} files ({total_bytes/1_000_000:.1f} MB) to "
          f"s3://{bucket}/{args.prefix or ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
