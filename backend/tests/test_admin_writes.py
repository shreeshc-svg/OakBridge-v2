"""
Can the admin screens actually save what they send?

    python backend/tests/test_admin_writes.py

Written after the gifting banner shipped unsaveable. The screen rendered, the
upload worked, the payload was correct — and PUT /admin/site-content answered
"Input should be a valid string", because its model typed `value` as str and the
banner is an object. Nothing in the suite covered the round trip from what a
form sends to what a model accepts, so nothing caught it.

These are structural checks against the request models, not live calls. The
Windows venv cannot run in the Linux sandbox, so pydantic itself is unavailable
here; what can be verified is the annotation, which is exactly where the bug was.
"""
import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

failures = []


def check(cond, label):
    print(("ok   " if cond else "FAIL "), label)
    if not cond:
        failures.append(label)


def model_fields(src: str, name: str) -> dict:
    """field -> annotation source, for a pydantic model in `src`."""
    tree = ast.parse(src)
    cls = next((n for n in ast.walk(tree)
                if isinstance(n, ast.ClassDef) and n.name == name), None)
    assert cls is not None, f"model {name} not found"
    out = {}
    for node in cls.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out[node.target.id] = ast.unparse(node.annotation)
    return out


features = open(os.path.join(BACKEND, "features.py"), encoding="utf-8").read()
hampers = open(os.path.join(BACKEND, "hampers.py"), encoding="utf-8").read()

print("-- site content takes structured values --")
scs = model_fields(features, "SiteContentSet")
check(scs.get("value") == "Any",
      f"SiteContentSet.value is Any, not {scs.get('value')!r} — the banner is an "
      "object and a str annotation rejects the whole save")
check(scs.get("key") == "str", "the key stays a plain string")

print("\n-- the banner default has exactly one home --")
check("BANNER_DEFAULTS" in hampers, "defined in hampers.py")
check("from hampers import BANNER_DEFAULTS" in features,
      "and imported by features.py rather than restated — two copies drift the "
      "first time one gains a field, and the symptom is a setting that does nothing")
check(features.count('"enabled": False, "image": ""') == 0,
      "no second literal copy of the banner shape survives")

print("\n-- a stored value saved before a field existed --")
# {**defaults, **stored} replaces a whole dict. The banner was saved when it had
# five keys; position, fit and max_height were added later, and a shallow merge
# knocked those defaults straight back out -- the setting reads blank and the
# page behaves as though the feature never shipped.
import ast as _ast
tree = _ast.parse(features)
fn = next(n for n in _ast.walk(tree)
          if isinstance(n, _ast.AsyncFunctionDef) and n.name == "get_site_content")
body = _ast.unparse(fn)
check("isinstance(default, dict)" in body and "isinstance(values.get(key), dict)" in body,
      "get_site_content merges one level into structured keys")
check("{**default, **values[key]}" in body,
      "and the stored value still wins field by field")

# Deliberately NOT a hand-rolled {**a, **b} demonstration here: two dict
# literals merged in the test prove something about Python, not about
# get_site_content. The assertions above read the shipped function instead.
check("out[key] = {**default, **values[key]}" in body.replace("\n", "\n"),
      "the merged value is written back to the response, not computed and dropped")

print("\n-- what the hamper form sends, the hamper model accepts --")
create = model_fields(hampers, "HamperCreate")
update = model_fields(hampers, "HamperUpdate")
# Mirrors BLANK in AdminHampers.jsx: every key the editor puts in its payload.
FORM_KEYS = [
    "title", "subtitle", "description", "price", "cover_image", "gallery",
    "sku", "stock", "occasion", "order_by", "hamper_items", "hamper_copy",
    "gift_message_enabled", "bulk_enquiry", "enabled", "order",
]
missing_c = [k for k in FORM_KEYS if k not in create]
missing_u = [k for k in FORM_KEYS if k not in update]
check(not missing_c, f"HamperCreate accepts every field the form sends {missing_c or ''}")
check(not missing_u, f"HamperUpdate accepts every field the form sends {missing_u or ''}")
check(create.get("hamper_items", "").startswith("list"),
      "contents arrive as a list, not a string")
check("dict" in create.get("hamper_copy", ""), "the wording block arrives as an object")
check(all(v.startswith("Optional") for k, v in update.items()),
      "every update field is Optional — a PATCH sending one key must not be "
      "rejected for omitting the rest")

print("\n-- the editor sends nothing the models silently drop --")
admin = open(os.path.join(BACKEND, "..", "frontend", "src", "pages", "admin",
                          "AdminHampers.jsx"), encoding="utf-8").read()
blank = admin.split("const BLANK = {", 1)[1].split("};", 1)[0]
sent = {w.strip().strip('"') for w in
        __import__("re").findall(r"(\w+):", blank)}
unknown = sorted(sent - set(create))
check(not unknown,
      f"nothing in the form's BLANK is unknown to HamperCreate {unknown or ''}")

print()
if failures:
    print(f"{len(failures)} assertion(s) failed:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all assertions passed")
