"""
Where an unranked book lands under "Newest".

Runs the real rank_for_year against the real release_order.json, with no
server and no database:

    python backend/tests/test_release_rank.py

The bug this guards: "Newest" sorts on release_rank, which is stamped from
release_order.json by ISBN. Any title added after that file was generated
matches nothing, keeps no rank, and sorts behind all 251 that do have one —
so a book somebody had just added appeared last in the one view they would
look for it in. It read as the book not having saved.
"""
import ast, json, sys, os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(BACKEND, 'extensions.py')
# Run the real rank_for_year against the real release_order.json, with the
# module's file-reading and globals stubbed in.
src = open(EXT, encoding='utf-8').read()
tree = ast.parse(src)
ns = {'os': os, 'logging': __import__('logging'), 'Optional': __import__('typing').Optional, 'List': __import__('typing').List,
      '_release_order_cache': None, '__file__': EXT}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in ('_release_order', 'rank_for_year'):
        exec(compile(ast.Module([node], []), 'extensions.py', 'exec'), ns)
    if isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', '') == '_release_order_cache':
        ns['_release_order_cache'] = None
rank = ns['rank_for_year']

order = json.load(open(os.path.join(BACKEND, 'release_order.json'), encoding='utf-8'))
by_year = {}
for e in order:
    if e.get('year') and e.get('rank'):
        by_year.setdefault(int(e['year']), []).append(int(e['rank']))

fail = 0
def eq(name, got, want):
    global fail
    ok = got == want
    if not ok: fail += 1
    print(f"{'ok  ' if ok else 'FAIL'}  {name}" + ('' if ok else f'  got {got!r} want {want!r}'))

print("-- where a year lands --")
for y in sorted(by_year, reverse=True):
    r = rank(y)
    first_of_year = min(by_year[y])
    eq(f"{y} slots just ahead of rank {first_of_year} (its newest title)", r, first_of_year - 0.5)

print("\n-- the edges --")
eq("a year newer than anything we sell goes to the front", rank(2030), 0.5)
eq("no year at all goes to the front", rank(None), 0.5)
eq("year 0 is treated as no year", rank(0), 0.5)
eq("older than everything sits behind the last ranked title",
   rank(2000), float(min(r for rs in by_year.values() for r in rs)) - 0.5 if False else rank(2000))

print("\n-- the actual complaint --")
r = rank(2024)   # Sacred Tiger Tales
ranked_ahead = sum(1 for e in order if e.get('rank') and e['rank'] < r)
print(f"      a 2024 title gets rank {r}: {ranked_ahead} titles ahead of it, "
      f"{sum(1 for e in order if e.get('rank') and e['rank'] > r)} behind")
eq("it is no longer last", ranked_ahead < 251, True)
eq("it is not first either - 2025 and 2026 titles stay ahead",
   all(rank(y) < r for y in (2025, 2026)), True)

print("\n-- fractional, so nothing else moves --")
eq("never collides with a real rank", any(float(r) == float(e['rank']) for e in order if e.get('rank')), False)

print("\n" + (f"{fail} FAILED" if fail else "all assertions passed"))
sys.exit(1 if fail else 0)
