"""
Standalone PDF -> page-image rendering, with no FastAPI dependency.

Kept separate from features.py so CLI helpers (attach_preview.py) can render
previews without importing the whole web application.
"""

import io
import os
import uuid

APP_NAME = os.environ.get("APP_NAME", "oakbridge")


def _put(path: str, data: bytes, content_type: str) -> None:
    """Write to S3 when configured, otherwise to the local storage dir."""
    bucket = os.environ.get("S3_BUCKET")
    if bucket:
        import boto3

        boto3.client("s3", region_name=os.environ.get("S3_REGION", "us-east-1")).put_object(
            Bucket=bucket, Key=path, Body=data, ContentType=content_type
        )
        return
    base = os.environ.get("STORAGE_DIR", os.path.join(os.path.dirname(__file__), "storage"))
    dest = os.path.join(base, *path.split("/"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)


def render_pdf_pages(data: bytes, book_id: str, max_pages: int = 40) -> list[str]:
    """Render a PDF to web-sized JPEGs in storage. Returns the stored paths."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(data)
    total = min(len(doc), max_pages)
    batch = uuid.uuid4().hex[:8]
    paths: list[str] = []
    for i in range(total):
        pil = doc[i].render(scale=150 / 72).to_pil().convert("RGB")
        buf = io.BytesIO()
        pil.save(buf, "JPEG", quality=82, optimize=True, progressive=True)
        path = f"{APP_NAME}/previews/{book_id}/{batch}/p{i + 1:03d}.jpg"
        _put(path, buf.getvalue(), "image/jpeg")
        paths.append(path)
        print(f"  rendered page {i + 1}/{total}", end="\r")
    doc.close()
    print()
    return paths
