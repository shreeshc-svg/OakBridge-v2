"""No API route is unreachable because an EARLIER-registered route with a
path parameter already matches it (FastAPI matches in registration order).

The bug this guards (Nov 2026): marketing's POST /campaigns/{cid}/{action}
(pause/resume/cancel) was registered before POST /campaigns/{cid}/attachments,
so every attachment upload answered "Unknown action" / 404 in production
while every unit test passed.

Static: reads server.py's include order and every router's decorators.
Run: python backend/tests/test_route_shadowing.py
"""
import re, ast, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
srv = open("server.py", encoding="utf-8").read()
# alias -> (module, var)
alias = {}
for m in re.finditer(r"from (\w+) import (\([^)]*\)|[^\n#]+)", srv):
    mod = m.group(1)
    for part in re.sub(r"#[^\n]*", "", m.group(2)).replace("\n", " ").split(","):
        part = part.strip().strip("()")
        if not part: continue
        if " as " in part:
            v, a = [x.strip() for x in part.split(" as ")]
        else:
            v = a = part
        alias[a] = (mod, v)
order = re.findall(r"app\.include_router\((\w+)(?:,\s*prefix=\"([^\"]*)\")?", srv)
def routers(mod):
    p = f"{mod}.py"
    if not os.path.exists(p): return {}, []
    src = open(p, encoding="utf-8").read()
    pref = {}
    for m in re.finditer(r"^(\w+)\s*=\s*APIRouter\(([^)]*)\)", src, re.M):
        pm = re.search(r'prefix=["\']([^"\']*)', m.group(2)); pref[m.group(1)] = pm.group(1) if pm else ""
    routes = re.findall(r'^@(\w+)\.(get|post|put|patch|delete)\(\s*["\']([^"\']*)', src, re.M)
    return pref, routes
table = []
seen_vars = set()
for var, extra in order:
    mod, rv = alias.get(var, ('server', var))
    pref, routes = routers(mod)
    for r, meth, path in routes:
        if r == rv:
            table.append((meth.upper(), (extra or "") + pref.get(rv, "") + path, f"{mod}.{rv}"))
# also app-level routes in server.py
def rx(p):
    p = re.sub(r"\{[^}:]+:path\}", "§P§", p)
    p = re.sub(r"\{[^}]+\}", "§S§", p)
    p = re.escape(p).replace("§P§", ".+").replace("§S§", "[^/]+")
    return re.compile("^" + p + "$")
def sample(p):
    return re.sub(r"\{[^}]+\}", "X1", p)
bad = 0
for i, (m2, p2, o2) in enumerate(table):
    for m1, p1, o1 in table[:i]:
        if m1 == m2 and p1 != p2 and "{" in p1 and rx(p1).match(sample(p2)) and not rx(p2).match(sample(p1)):
            print(f"FAIL SHADOWED: {m2} {p2} ({o2})  <- earlier {p1} ({o1})"); bad += 1
print(f"routes: {len(table)}")
if len(table) < 300:
    print("FAIL route table looks incomplete — the parser missed routers"); bad += 1
print("\nall passed" if not bad else f"\n{bad} FAILED")
sys.exit(1 if bad else 0)
