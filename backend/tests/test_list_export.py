"""Lists & segments: View and Export (marketing.py) — wiring checks.

Run: python backend/tests/test_list_export.py
"""
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


src = open(os.path.join(ROOT, "backend", "marketing.py"), encoding="utf-8").read()
code = re.sub(r'"""[\s\S]*?"""', "", src)
mf = code[code.index("async def _list_member_filter"):code.index("@admin_router.get(\"/lists/{lid}/members\")")]
check("await audience_filter({\"channel\": \"email\", \"audience\": {\"rules\": lst.get(\"rules\") or []}})" in mf
      and 'flt = {"lists": lid}' in mf, "segment = the same rules filter as its count; static = its members")
check("re.escape(q.strip()[:80])" in mf, "search text is escaped (no regex injection)")
ex = code[code.index("async def adm_list_export"):code.index("@admin_router.post(\"/lists\")")]
check("audit_log(db, \"MARKETING_EXPORT\"" in ex and "user: dict = Depends(require_admin)" in ex, "every list export is logged with who did it")
check("await _contact_export_rows(flt)" in ex and "await _contact_export_rows(flt)" in code.split("async def adm_contacts_export")[1][:800],
      "list export and contacts export share one column layout")
check("core.safe_cell(v)" in code, "cells are made safe for Excel (no formula injection)")
mem = code[code.index("async def adm_list_members"):code.index("@admin_router.get(\"/lists/{lid}/export\")")]
check("per = min(max(per, 10), 200)" in mem, "page size bounded")
app = open(os.path.join(ROOT, "frontend", "src", "pages", "admin", "AdminMarketing.jsx"), encoding="utf-8").read()
check("<ListMembers list={viewing}" in app and "mkExportList(l.id, fmt)" in app and "mkExportList(list.id, fmt, dq)" in app,
      "Lists tab: click a name / View opens the members; Export on each row and inside")
print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
