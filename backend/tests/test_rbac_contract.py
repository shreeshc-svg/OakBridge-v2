"""
The two ends of RBAC have to agree.

    python backend/tests/test_rbac_contract.py

Runs on the source, not on a running server, so it needs no database and no
pydantic — which is the point: this is the check that would have caught the bug
before anyone noticed it in production.

THE BUG IT GUARDS

Granting a fulfilment user an extra section wrote `sections` to their Mongo
document, and the API honoured it immediately — can_path reads the database. But
UserPublic, the model /auth/me returns, is configured extra="ignore", so it
silently dropped every field it did not declare. `sections` was not one of them.

The result was a permission that existed on the server and was invisible to the
browser: the person could reach the section by typing its URL, and could not see
it in the sidebar. Nothing errored anywhere.

The frontend reads `user.sections` and falls back to the role preset when it is
absent, so the two sides only work if the field survives serialisation. That is
what this asserts, from both directions.
"""
import ast
import os
import re
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
FRONTEND_RBAC = os.path.join(REPO, "frontend", "src", "lib", "rbac.js")

fail = 0


def check(name, ok, detail=""):
    global fail
    if not ok:
        fail += 1
    print(("ok   " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))


# ---- what the browser is actually sent -------------------------------------
tree = ast.parse(open(os.path.join(BACKEND, "extensions.py"), encoding="utf-8").read())
user_public = next(
    (n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "UserPublic"), None
)
check("UserPublic exists", user_public is not None)

declared = {
    n.target.id for n in (user_public.body if user_public else []) if isinstance(n, ast.AnnAssign)
}
ignores_extra = "extra=\"ignore\"" in ast.unparse(user_public) or "extra='ignore'" in ast.unparse(
    user_public
)

print("\n-- the field survives the response model --")
check("UserPublic declares `sections`", "sections" in declared)
check(
    "it matters: the model drops undeclared fields",
    ignores_extra,
    "extra=ignore not found — if this changed, re-read why this test exists",
)
check("`role` is declared too", "role" in declared)

# ---- what the browser does with it -----------------------------------------
js = open(FRONTEND_RBAC, encoding="utf-8").read()

print("\n-- the frontend reads exactly that field --")
check("effectiveSections reads user.sections", "user.sections" in js)
check(
    "an array is treated as an override",
    bool(re.search(r"Array\.isArray\(user\.sections\)", js)),
)
check(
    "anything else falls back to the role preset",
    "ROLE_PRESETS[user.role]" in js,
)

# ---- the vocabularies still match ------------------------------------------
py_src = open(os.path.join(BACKEND, "rbac.py"), encoding="utf-8").read()
py_block = re.search(r"^SECTIONS[^=]*=\s*\((.*?)\)", py_src, re.S | re.M)
js_block = re.search(r"^export const SECTIONS\s*=\s*\[(.*?)\]", js, re.S | re.M)
check("both files declare a SECTIONS list", bool(py_block and js_block))
py_sections = set(re.findall(r'"([a-z_]+)"', py_block.group(1) if py_block else ""))
js_sections = set(re.findall(r'"([a-z_]+)"', js_block.group(1) if js_block else ""))

print("\n-- both ends know the same sections --")
check(
    "no section exists on one side only",
    py_sections == js_sections,
    f"backend-only={sorted(py_sections - js_sections)} frontend-only={sorted(js_sections - py_sections)}",
)
print(f"      {len(py_sections)} sections, identical on both sides")

# ---- deletion is admin-only -------------------------------------------------
# Enforced on the METHOD in require_admin, not per endpoint, so an endpoint
# added tomorrow is covered without anybody remembering to cover it.
ext = open(os.path.join(BACKEND, "extensions.py"), encoding="utf-8").read()
req = re.search(r"async def require_admin\(.*?\n    return user", ext, re.S)

print("\n-- only admin and superadmin may delete --")
check("require_admin exists", req is not None)
body = req.group(0) if req else ""
check(
    'it refuses DELETE for anyone who is not a superadmin',
    'request.method == "DELETE"' in body and "is_superadmin" in body,
)
check(
    "the check is inside require_admin, which both admin routers depend on",
    ext.count("dependencies=[Depends(require_admin)]") >= 1
    and "dependencies=[Depends(require_admin)]"
    in open(os.path.join(BACKEND, "features.py"), encoding="utf-8").read(),
)

rbac_src = open(os.path.join(BACKEND, "rbac.py"), encoding="utf-8").read()
su = re.search(r"SUPERADMIN_ROLES\s*=\s*frozenset\(\{([^}]*)\}\)", rbac_src)
roles = set(re.findall(r'"([a-z]+)"', su.group(1) if su else ""))
check("that tier is exactly superadmin + the legacy admin", roles == {"superadmin", "admin"},
      f"got {sorted(roles)}")

check("the frontend hides the buttons for the same tier",
      "export const canDelete" in js and "isSuperadmin(user?.role)" in js)

print("\n" + (f"{fail} FAILED" if fail else "all assertions passed"))
sys.exit(1 if fail else 0)
