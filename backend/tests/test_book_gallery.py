"""Front + back (and more) covers for a book — extensions.clean_gallery and
the wiring around it. Run: python backend/tests/test_book_gallery.py"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(ROOT, "backend", "extensions.py"), encoding="utf-8").read()
ns = {}
for node in ast.parse(src).body:
    if (isinstance(node, ast.FunctionDef) and node.name == "clean_gallery") or (
            isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "GALLERY_MAX" for t in node.targets)):
        exec(compile(ast.Module([node], []), "extensions.py", "exec"), ns)
cg = ns["clean_gallery"]
check(cg(["/api/files/covers/back.jpg", "https://cdn.x/spine.png"]) == ["/api/files/covers/back.jpg", "https://cdn.x/spine.png"],
      "uploaded paths and web links kept, in order (back cover first)")
check(cg(["", "  ", None, "/api/files/a.jpg", "/api/files/a.jpg"]) == ["/api/files/a.jpg"], "blanks and repeats dropped")
check(cg(["javascript:alert(1)", "data:image/png;base64,xx", "//evil.example/x.png", "covers/x.jpg"]) == [],
      "nothing but our paths / http(s) links reaches an <img>")
check(len(cg([f"/api/files/{i}.jpg" for i in range(20)])) == 8, "at most 8")

code = "\n".join(x for x in src.splitlines() if not x.strip().startswith("#"))
check('doc["gallery"] = clean_gallery(doc.get("gallery"))' in code and 'updates["gallery"] = clean_gallery(updates["gallery"])' in code,
      "create and update both clean it")
check(re.search(r"class BookAdminUpdate[\s\S]*?gallery: Optional\[list\] = None", code) is not None, "update accepts it ([] clears)")
srv = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
check("gallery: list = Field(default_factory=list)" in srv, "declared on Book (response_model keeps it)")
bf = open(os.path.join(ROOT, "backend", "book_formats.py"), encoding="utf-8").read()
check('"cover_image", "gallery"' in bf, "a new Hardback / Paperback format copies the covers too")

pdp = open(os.path.join(ROOT, "frontend", "src", "pages", "BookDetail.jsx"), encoding="utf-8").read()
check("const covers = [book.cover_image, ...(Array.isArray(book.gallery) ? book.gallery : [])]" in pdp
      and 'data-testid="cover-thumbs"' in pdp and "covers.length > 1" in pdp, "product page: Front / Back thumbnails switch the big cover")
adm = open(os.path.join(ROOT, "frontend", "src", "pages", "admin", "AdminBooks.jsx"), encoding="utf-8").read()
check("<GalleryEditor" in adm and 'label="Front cover"' in adm and '"Back cover"' in adm, "Books form: front cover + back cover / more images")
print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
