"""Images dropped into an email block (marketing._email_image), pulled out with
ast: resized to 1200 px wide, re-encoded (JPEG; PNG kept when transparent),
animated GIFs untouched, unreadable formats passed through unchanged.

Run: python backend/tests/test_email_images.py
"""
import ast
import io
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
tree = ast.parse(src)
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == "_email_image")
        or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "EMAIL_IMAGE_WIDTH" for t in n.targets))]
ns: dict = {}
exec(compile(ast.Module(body=body, type_ignores=[]), "<marketing>", "exec"), ns)
f = ns["_email_image"]


def img(mode, size, fmt):
    b = io.BytesIO()
    Image.new(mode, size, (200, 30, 30, 128) if mode == "RGBA" else (200, 30, 30)).save(b, fmt)
    return b.getvalue()


big = img("RGB", (4000, 3000), "JPEG")
out, ext = f(big, "jpg")
im = Image.open(io.BytesIO(out))
check(ext == "jpg" and im.size == (1200, 900), f"a 4000 px photo becomes 1200 px wide ({im.size})")
check(len(out) < len(big), "and smaller")
out, ext = f(big + b"<script>alert(1)</script>", "jpg")
check(b"<script>" not in out, "anything appended after the picture is dropped by re-encoding")
png = img("RGBA", (800, 400), "PNG")
out, ext = f(png, "png")
check(ext == "png" and Image.open(io.BytesIO(out)).mode == "RGBA", "transparent PNG stays PNG")
webp = img("RGB", (600, 300), "WEBP")
out, ext = f(webp, "webp")
check(ext == "jpg", "WebP becomes JPEG (Outlook can't show WebP)")
gif = b"GIF89a" + b"\x00" * 50
check(f(gif, "gif") == (gif, "gif"), "GIF untouched (keeps animation)")
check(f(b"not an image", "avif") == (b"not an image", "avif"), "unreadable: original returned, the endpoint refuses it")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
