"""Import repairs: company-domain typos fixed only when certain (marketing._repair_domains).

Run: python backend/tests/test_import_repairs.py
"""
import ast
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from _fakedb import DB  # noqa: E402
import marketing_core as core  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


src = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
fn = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "_repair_domains")
db = DB()
LIVE = {"mmtclimited.com", "abcd.com", "abce.com"}
asked = []


async def domains_mx(ds):
    asked.extend(ds)
    return {d: d in LIVE for d in ds}

ns = {"db": db, "core": core, "domains_mx": domains_mx}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "marketing.py", "exec"), ns)


def row(e):
    return {"syntax": core.check_syntax(e), "fixed_from": None}


async def main():
    rows = [row("snarang@mmtckimited.com"), row("x@abcf.com"), row("ok@gmail.com")]
    mx = {"mmtckimited.com": False, "abcf.com": False, "gmail.com": True}
    await ns["_repair_domains"](rows, mx)
    r0, r1, r2 = rows
    check(r0["syntax"]["email"] == "snarang@mmtclimited.com" and r0["fixed_from"] == "snarang@mmtckimited.com" and r0["syntax"].get("domain_guess"),
          "mmtckimited.com -> mmtclimited.com (one key off, receives email), marked as a guess")
    check(r1["syntax"]["email"] == "x@abcf.com", "two possible fixes (abcd / abce): left alone, no guess")
    check(r2["syntax"]["email"] == "ok@gmail.com" and r2["fixed_from"] is None, "working addresses untouched")
    # A domain we've delivered to before wins without any DNS lookups.
    await db.mk_domains.insert_one({"domain": "smcindiaonline.com", "delivered_n": 3})
    asked.clear()
    rows = [row("a@smcindiaonlin.com")]
    await ns["_repair_domains"](rows, {"smcindiaonlin.com": False})
    check(rows[0]["syntax"]["email"] == "a@smcindiaonline.com" and not asked, "closest domain we've delivered to: fixed with no extra lookups")

asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
