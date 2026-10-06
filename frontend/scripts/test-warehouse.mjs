/**
 * Warehouse system — wiring and safety checks (backend/warehouse.py + screens).
 *
 * Parsing, matching and scoring are tested on real documents in
 * backend/tests/test_warehouse_core.py. This pins the properties that keep a
 * live store safe while the warehouse system is on trial.
 *
 * Run: node frontend/scripts/test-warehouse.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Comments and docstrings stripped so no check can pass by matching prose.
const code = (p) =>
    readFileSync(join(ROOT, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(/^\s*#.*$/gm, "");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const wh = code("backend/warehouse.py");
const pay = code("backend/payments.py");
const ext = code("backend/extensions.py");
const feat = code("backend/features.py");
const sheet = code("backend/inventory_sync.py");
const rbac = code("backend/rbac.py");
const srv = code("backend/server.py");
const rbacFe = code("frontend/src/lib/rbac.js");
const app = code("frontend/src/App.js");
// Raw, not code(): accept="image/*" would read as the start of a /* comment.
const screen = readFileSync(join(ROOT, "frontend/src/pages/warehouse/WarehouseApp.jsx"), "utf8");
const admin = code("frontend/src/pages/admin/AdminWarehouse.jsx");
const login = code("frontend/src/pages/auth/Login.jsx");
const robots = readFileSync(join(ROOT, "frontend/public/robots.txt"), "utf8");

console.log("-- trial never touches website stock --");
check(/live = state\["mode"\] == "live"/.test(wh) && /if touch:\s*inc\["stock"\] = qty/.test(wh),
      "movements change website stock only in live mode");
check(/"mode": doc\.get\("mode"\) if doc\.get\("mode"\) in \("trial", "live"\) else "off"/.test(wh), "default mode is off");
check(/raise HTTPException\(status_code=409, detail="The warehouse trial has not been started yet/.test(wh),
      "no real movement before the trial is started");
check(/if not doc\["practice"\]:\s*sign =/.test(wh) && /if body\.practice:\s*return/.test(wh),
      "practice mode never writes movements");

console.log("-- one stock master --");
check(/return \(await get_state\(\)\)\["mode"\] == "live"/.test(wh), "warehouse is master only when live");
check(/if await _warehouse_is_master\(\):\s*return \{"ok": True, "skipped"/.test(sheet), "sheet cron stands down when live (no alert mail)");
check(/if await _warehouse_is_master\(\):\s*raise HTTPException\(\s*status_code=409/.test(sheet), "manual sheet sync refused when live");
check(/from warehouse import record_admin_stock_edit/.test(ext), "typed stock edits become ledger corrections when live");
check(/if prev == new or \(await get_state\(\)\)\["mode"\] != "live":\s*return/.test(wh), "…and only when live");

console.log("-- website orders --");
check(/from warehouse import record_website_sale/.test(pay) && /await record_website_sale\(full, lines\)/.test(pay),
      "paid orders write movements with the exact decremented lines");
check(pay.indexOf("await record_website_sale") > pay.indexOf('{"$inc": {"stock": -qty}}'), "after the website's own decrement");
check(/"website_order", actor=\{"email": "website"\},\s*doc_id=order\.get\("order_number", ""\), touch_stock=False/.test(wh),
      "website movements never decrement website stock a second time");
check(/async def record_website_sale[\s\S]*?except Exception:[\s\S]*?log\.exception/.test(wh), "never raises in the payment path");

console.log("-- documents are private --");
check(/\{"cv", "warehouse"\}/.test(feat) && /_PRIVATE_SEGMENTS = \{"cv", "warehouse"\}/.test(feat),
      "warehouse files go to the private bucket and are blocked from the public file proxy");
check(/path = f"\{APP_NAME\}\/warehouse\//.test(wh), "stored under oakbridge/warehouse/");
check(/"Cache-Control": "private, no-store"/.test(wh), "served without caching, only through authenticated routes");

console.log("-- nothing synced twice, nothing synced unchecked --");
check(/doc\.get\("duplicate_of"\) and not doc\["practice"\] and not body\.allow_duplicate/.test(wh), "a bill/invoice already synced is refused");
check(/"include": bool\(m\["book_id"\]\)/.test(wh), "unmatched lines (Box Charge) start unticked");
check(/if any\(ln\.qty > 100000 for ln in kept\)/.test(wh), "absurd quantities refused");
check(/UNDO_HOURS = 24/.test(wh) && /def adm_undo_doc/.test(wh), "manager undo within 24 hours");

console.log("-- measured --");
check(/metrics = core\.score_corrections\(read, confirmed\) if automated else None/.test(wh), "every automated document is scored");
check(/@wh_admin_router\.get\("\/accuracy"\)/.test(wh) && /@wh_admin_router\.post\("\/replay"\)/.test(wh), "accuracy report and test-case replay");

console.log("-- access --");
check(/"warehouse": \("warehouse",\),/.test(rbac) && /warehouse: \["warehouse"\]/.test(rbacFe), "warehouse role sees only the warehouse");
check(/"warehouse" not in rbac\.effective_sections\(user\)/.test(wh), "phone API checks the warehouse section");
check(/async def adm_mode\(body: ModeBody, user: dict = Depends\(require_superadmin\)\)/.test(wh), "start / go live / stop is superadmin-only");
check(/path="\/warehouse"/.test(app) && /<WarehouseApp \/>/.test(app), "phone screen route");
check(/user\.role === "warehouse" \? "\/warehouse" : "\/admin"/.test(login), "warehouse login lands on the phone screen");
check(/if \(user\?\.role === "warehouse"\) return <Navigate to="\/warehouse"/.test(admin), "…and is sent there from the admin page");
check(/Disallow: \/warehouse/.test(robots), "kept out of search engines");
check(/app\.include_router\(wh_router\)/.test(srv) && /app\.include_router\(wh_admin_router\)/.test(srv), "routers included");
check(/Enter by hand instead/.test(screen) && /Add a book/.test(screen), "manual entry always available on the phone");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
