"""
One-off S3 housekeeping for the CloudFront rollout. Dry-run by default.

Two jobs:

  audit      List objects in the PUBLIC folders (the ones CloudFront will serve)
             whose stored Content-Type a browser would execute — SVG, HTML,
             XML, JavaScript. The API proxy used to downgrade those on the way
             out; CloudFront serves exactly what is stored. Uploads have been
             sniffed since the upload-hardening change, but anything older is
             not. Run this BEFORE pointing the site at CloudFront.

  move-cvs   Copy every CV (…/oakbridge/cv/…) from the main bucket to the
             private bucket (encrypted), verify each copy by size, and — only
             with --delete — remove the original from the main bucket.

Run locally from backend/ with the same credentials the app uses (PowerShell):

    $env:S3_BUCKET="<main bucket>"; $env:S3_REGION="ap-south-1"
    $env:S3_PRIVATE_BUCKET="<private bucket>"
    $env:AWS_ACCESS_KEY_ID="…"; $env:AWS_SECRET_ACCESS_KEY="…"
    python s3_housekeeping.py audit
    python s3_housekeeping.py move-cvs              # dry run: lists what would move
    python s3_housekeeping.py move-cvs --apply      # copy + verify, keep originals
    python s3_housekeeping.py move-cvs --apply --delete   # …then remove originals

Never paste these credentials anywhere else; they belong in your shell only.
"""
from __future__ import annotations

import argparse
import os
import sys

import boto3

PUBLIC_FOLDERS = ("covers", "media", "authors", "previews", "docs", "events")
DANGEROUS = ("image/svg+xml", "text/html", "application/xhtml+xml", "text/xml",
             "application/xml", "text/javascript", "application/javascript")


def _cfg():
    bucket = os.environ.get("S3_BUCKET") or os.environ.get("AWS_S3_BUCKET")
    region = os.environ.get("S3_REGION") or os.environ.get("AWS_S3_REGION") or os.environ.get("AWS_REGION")
    prefix = (os.environ.get("S3_PREFIX", "") or "").strip("/")
    if not bucket:
        sys.exit("S3_BUCKET is not set.")
    s3 = boto3.client("s3", region_name=region) if region else boto3.client("s3")
    return s3, bucket, prefix


def _keys(s3, bucket, prefix):
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for o in page.get("Contents", []):
            yield o


def audit() -> int:
    s3, bucket, prefix = _cfg()
    base = f"{prefix}/oakbridge/" if prefix else "oakbridge/"
    bad = 0
    scanned = 0
    for folder in PUBLIC_FOLDERS:
        print(f"… scanning {folder}/", flush=True)
        for o in _keys(s3, bucket, base + folder + "/"):
            scanned += 1
            if scanned % 50 == 0:
                print(f"  {scanned} checked", flush=True)
            key = o["Key"]
            ctype = (s3.head_object(Bucket=bucket, Key=key).get("ContentType") or "").split(";")[0].lower()
            if ctype in DANGEROUS or key.lower().endswith((".svg", ".html", ".htm", ".xml", ".js")):
                bad += 1
                print(f"UNSAFE  {ctype or '-':28} {key}")
    print(f"\nScanned {scanned} objects in {', '.join(PUBLIC_FOLDERS)}; {bad} unsafe.")
    if bad:
        print("Delete or re-upload these before switching the site to CloudFront. "
              "The CloudFront CSP 'sandbox' header also neutralises them, but do not rely on one layer.")
    return 1 if bad else 0


def move_cvs(apply: bool, delete: bool) -> int:
    s3, bucket, prefix = _cfg()
    private = (os.environ.get("S3_PRIVATE_BUCKET") or "").strip()
    if not private:
        sys.exit("S3_PRIVATE_BUCKET is not set.")
    src_prefix = f"{prefix}/oakbridge/cv/" if prefix else "oakbridge/cv/"
    moved = failed = 0
    for o in _keys(s3, bucket, src_prefix):
        key, size = o["Key"], o["Size"]
        if not apply:
            print(f"would move  {key}  ({size} bytes)")
            moved += 1
            continue
        s3.copy_object(Bucket=private, Key=key, CopySource={"Bucket": bucket, "Key": key},
                       ServerSideEncryption="AES256", MetadataDirective="COPY")
        # Verify before any delete: a CV removed from the main bucket without a
        # confirmed copy is a lost document.
        got = s3.head_object(Bucket=private, Key=key)
        if got.get("ContentLength") != size:
            print(f"MISMATCH  {key}  src={size} dst={got.get('ContentLength')} — original kept")
            failed += 1
            continue
        if delete:
            s3.delete_object(Bucket=bucket, Key=key)
        print(f"{'moved' if delete else 'copied'}  {key}")
        moved += 1
    print(f"\n{moved} {'to move (dry run)' if not apply else 'done'}, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("audit")
    m = sub.add_parser("move-cvs")
    m.add_argument("--apply", action="store_true", help="actually copy (default: dry run)")
    m.add_argument("--delete", action="store_true", help="remove originals after a verified copy")
    a = ap.parse_args()
    sys.exit(audit() if a.cmd == "audit" else move_cvs(a.apply, a.delete))
