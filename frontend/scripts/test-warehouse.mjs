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
check(/metrics = core\.score_corrections\(read, scored\) if automated else None/.test(wh), "every automated document is scored");
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

// Courier sheet: website-order parcels were already deducted at payment, so
// only free copies may move stock — double-deducting would undersell.
const courierBranch = (wh.match(/if not doc\["practice"\] and courier:([\s\S]*?)\n    elif not doc\["practice"\]:/) || [])[1] || "";
check(/p\.kind == "free_copy"[\s\S]*?_apply\(ln\.book_id, -ln\.qty, "sample"/.test(courierBranch), "courier: free copy -> 'sample' movement out");
const webBranch = (courierBranch.match(/elif p\.kind == "website_order"([\s\S]*)/) || [])[1] || "";
check(webBranch.includes("warehouse_doc_id") && !webBranch.includes("_apply("), "courier: website order is linked, never deducted again");
check(/"payment_status": "paid"/.test(webBranch), "courier: only a paid order can be linked");
check(/"payment_status": "paid"[\s\S]{0,200}"warehouse_doc_id": \{"\$in": \[None, ""\]\}/.test(wh), "courier: an order already packed is not offered again");
check(/data-testid="wh-go-courier"/.test(screen) && /screen === "courier" && \(\s*<CourierFlow/.test(screen), "courier button on the phone home screen");
check(/disabled=\{v === "website_order" && !p\.order_id\}/.test(screen), "courier: website-order choice needs a matched order");

// Carton approval (order-management team -> warehouse).
const reviewFn = (wh.match(/async def adm_review\([\s\S]*?\n(?=\n\S)/) || [""])[0];
check(/why = _approval_refusal\(user, doc\)\s*\n\s*if why:\s*\n\s*raise HTTPException\(status_code=403/.test(reviewFn), "approval: server re-checks who may approve");
check(/update_one\(\{"id": doc_id, "status": "awaiting_approval"\}/.test(reviewFn) && /modified_count != 1/.test(reviewFn), "approval: two reviewers cannot both act");
check(/if body\.action != "approve":[\s\S]*?_reverse\(mv, user\)/.test(reviewFn), "approval: send back / cancel put the copies back");
check(/needs_approval = doc\["direction"\] == "out" and not doc\["practice"\]/.test(wh) && /"awaiting_approval" if needs_approval else "confirmed"/.test(wh), "approval: a packed carton waits instead of being final");
check(/LIVE_STATUSES = \["confirmed", "awaiting_approval"\]/.test(wh) && (wh.match(/\$in": TAKEN_STATUSES/g) || []).length === 3, "approval: a carton awaiting approval still counts for duplicate checks (upload x2, confirm)");
check(/if doc\.get\("shipped_at"\):\s*\n\s*raise HTTPException/.test(wh), "approval: a shipped carton cannot be undone");
check(/<Inbox onRepack=/.test(screen) && /setInterval\(load, INBOX_POLL_MS\)/.test(screen), "warehouse phone checks for approvals");
check(/data-testid="wh-shipped"/.test(screen) && /data-testid="wh-repack"/.test(screen) && /data-testid="wh-unpacked"/.test(screen), "…and can mark shipped / repack / unpacked");
check(/data-testid="wh-approve"/.test(admin) && /\["approve", "To approve"\]/.test(admin), "admin: To approve tab with Approve button");

// Same invoice twice: re-checked when he confirms, not only at upload.
const confirmFn = (wh.match(/async def wh_confirm\([\s\S]*?\n(?=\n\S)/) || [""])[0];
check(/twin = await _taken_twin\(doc, doc_number\)\s*\n\s*if twin:\s*\n\s*raise HTTPException\(status_code=409/.test(confirmFn), "duplicate: second copy of an invoice refused at confirm");
check(confirmFn.indexOf("_taken_twin") > -1 && confirmFn.indexOf("_taken_twin") < confirmFn.indexOf("await _apply("), "duplicate: …before any stock moves");
check(/TAKEN_STATUSES = LIVE_STATUSES \+ \["sent_back"\]/.test(wh) && /"status": \{"\$in": TAKEN_STATUSES\}, "\$or": ors/.test(wh), "duplicate: a carton sent back still owns its invoice");

// Cancelled website orders.
const ext2 = code("backend/extensions.py");
const updFn = (ext2.match(/async def admin_update_order\([\s\S]*?\n(?=\n\S)/) || [""])[0];
check(updFn.indexOf('before = await db.orders.find_one') > -1 && updFn.indexOf('before = await') < updFn.indexOf('result = await db.orders.update_one'), "cancel: previous status read before it is overwritten");
check(/cancel_restock_decision\(prev_status, order\)/.test(updFn) && /restore_order_stock\(db, order_id/.test(updFn), "cancel: stock put back by the rules in order_stock.py");
check(/prev_status == "cancelled" and payload\.status != "cancelled"[\s\S]*?retake_order_stock/.test(updFn), "un-cancel takes the copies off again");
check(/"stock_taken": taken/.test(pay) && /if res\.modified_count == 1:\s*\n\s*taken\.append/.test(pay), "payment records exactly what came off");
check(/data-testid=\{`order-restock-\$\{o\.id\}`\}/.test(code("frontend/src/pages/admin/AdminOrders.jsx")), "admin: Returned — put back in stock");
check(/data-testid="wh-parcel-here"/.test(screen) && /data-testid="wh-parcel-gone"/.test(screen), "warehouse asked whether a cancelled parcel is still there");
check(/"website_return", "opening"\)/.test(wh), "website order/return movements cannot be undone one by one");

// Admin SCRUD on documents.
const fnOf = (name) => (wh.match(new RegExp(`async def ${name}\\([\\s\\S]*?\\n(?=\\n\\S)`)) || [""])[0];
check(/"\$regex": re\.escape\(text\)/.test(fnOf("adm_docs")), "search: the search box is escaped, never a raw regex");
check(/\{"archived": True\} if archived else \{"archived": \{"\$ne": True\}\}/.test(fnOf("adm_docs")), "search: archived documents hidden unless asked for");
const del = fnOf("adm_delete_doc");
check(/if \(doc\.get\("practice"\) or doc\["status"\] == "draft"\) and not live:/.test(del) && /delete_one/.test(del), "delete: only practice / drafts that never moved stock are erased");
check(/"archived": True/.test(del) && /await _reverse\(mv, user\)/.test(del) && del.indexOf("claim = await") < del.indexOf("_reverse(mv"), "delete: anything that moved stock is reversed and archived, claim first");
check(/if doc\.get\("shipped_at"\):\s*\n\s*raise HTTPException\(status_code=409/.test(del), "delete: a shipped carton cannot be deleted");
check(/@wh_admin_router\.delete\("\/docs\/\{doc_id\}"\)/.test(wh), "delete is an HTTP DELETE (superadmin via require_admin)");
check(/async def adm_restore_doc\(doc_id: str, user: dict = Depends\(require_superadmin\)\)/.test(wh), "restore: superadmin only");
const lines = fnOf("adm_edit_lines");
check(/if not note:\s*\n\s*raise HTTPException\(status_code=400/.test(lines) && /core\.line_corrections\(/.test(lines), "correct lines: reason required, difference posted as corrections");
check(/"original_confirmed_lines"/.test(lines), "correct lines: the original lines are kept");
for (const n of ["adm_create_doc", "adm_edit_details", "adm_edit_lines", "adm_delete_doc", "adm_undo_doc", "adm_undo_move", "adm_test_case"]) {
    check(/^\s*_office_only\(user\)/m.test(fnOf(n)), `${n}: the warehouse login cannot use it`);
}
check(/"from_office": True, "status": "draft"/.test(wh) && /data-testid="wh-open-job"/.test(screen), "office upload waits on the phone as a job");
check(/scored = \[\{\*\*c, "qty": c\["invoiced"\]\}/.test(wh), "carton accuracy scored against the invoice, not what was packed");

// Movements search (Admin → Warehouse → Movements).
const mvFn = fnOf("adm_movements");
check(/"\$regex": re\.escape\(text\)/.test(mvFn), "movements search: input is escaped, never a raw regex");
check(/db\.categories\.find\(\{"\$or": \[\{"id": rx\}, \{"name": rx\}\]\}/.test(mvFn) && /\{"author": rx\}/.test(mvFn) && /\{"by": rx\}, \{"party": rx\}/.test(mvFn) && /\{"doc_number": rx\}/.test(mvFn),
      "movements search covers book, ISBN, author, category (id or name), person, party, reason, note and invoice number");
check(/m\["category"\] = cats\.get\(c, c\)/.test(mvFn) && /<th>Category<\/th>/.test(admin), "each movement shows its book's category");
check(/data-testid="wh-moves-search"/.test(admin) && /tab === "moves" && \(/.test(admin), "search box sits in the tab row on the Movements tab");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
