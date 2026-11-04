"""Admin speed fixes (Nov 2026) — each keeps behaviour, removes repeated work.

1. Campaign → Activity no longer creates a database index on every view.
2. "Do this next" is cached briefly per process, its "last result" lookups are
   one query, and creating a campaign from a card still recomputes fresh.
3. Marketing saves no longer empty the storefront cache (see test_cache.py).

Run: python backend/tests/test_admin_speed.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


def code(f):
    return "\n".join(l for l in open(os.path.join(ROOT, f), encoding="utf-8").read().splitlines() if not l.strip().startswith("#"))


mk = code("marketing.py")
act = mk.split('"/campaigns/{cid}/activity"')[1].split("\n@admin_router")[0]
check("create_index" not in act, "activity view creates no index")
check('_index(db.audit_events, "meta.campaign")' in mk.split("async def _ensure_indexes")[1].split("\nasync def ")[0],
      "meta.campaign index made once with the other marketing indexes")
ai = code("ai_insights.py")
nx = ai.split('@admin_router.get("/next-actions")')[1].split("\n@admin_router")[0]
check("NEXT_TTL" in nx and "fresh or" in nx, "next-actions cached for NEXT_TTL, ?fresh=true recomputes")
check("_results_many(" in nx and "async def _results(" not in ai, "one query for every card's last result")
cr = ai.split('@admin_router.post("/next-actions/{key}/create")')[1].split("\n@admin_router")[0]
check("await _opportunities()" in cr, "creating a campaign always recomputes the audience fresh (never from cache)")
check('_next_cache["acts"] = None' in cr, "cache dropped after creating, so the new result shows")

print("\nall passed" if not failed else f"\n{failed} FAILED")
sys.exit(1 if failed else 0)
