/**
 * Zoho Inventory link — wiring checks (backend/zoho_inventory.py + admin panel).
 *
 * The decisions themselves are tested in backend/tests/test_zoho_core.py.
 * This pins the safety properties: off by default, superadmin-only switch,
 * never in the payment path's way, sheet sync stands down only when live.
 *
 * Run: node frontend/scripts/test-zoho-inventory.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Comments stripped (JS and Python) so a check cannot pass by matching prose.
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

const zi = code("backend/zoho_inventory.py");
const pay = code("backend/payments.py");
const ext = code("backend/extensions.py");
const srv = code("backend/server.py");
const sheet = code("backend/inventory_sync.py");
const panel = code("frontend/src/components/admin/ZohoInventoryPanel.jsx");
const inv = code("frontend/src/pages/admin/AdminInventory.jsx");

console.log("-- off until switched on --");
check(/"enabled": bool\(doc\.get\("enabled", False\)\)/.test(zi), "state defaults to disabled");
check(/else "test"/.test(zi), "mode defaults to test, never live");
check(/if not state\["enabled"\]:\s*return/.test(zi), "orders are not even queued while off");
check(/if st\["enabled"\] and configured\(\):/.test(zi), "scheduler idles while off or without credentials");
check(/if state\["mode"\] != "live":[\s\S]{0,200}"status": "test"/.test(zi), "test mode records orders, sends nothing");
check(/write = state\["enabled"\] and state\["mode"\] == "live"/.test(zi), "stock is written only in live mode");

console.log("-- who can switch it --");
check(/async def zoho_settings\(payload: ZohoSettings, user: dict = Depends\(require_superadmin\)\)/.test(zi),
      "the switch is superadmin-only on the server");
check(/if payload\.enabled and not configured\(\):/.test(zi), "cannot switch on without credentials");
check(/"ZOHO_SETTINGS_CHANGED"/.test(zi), "every switch change is audited");
check(/isSuperadmin\(user\?\.role\)/.test(panel), "panel hides the switch from non-superadmins");
check(/window\.confirm\(/.test(panel) && /mode: "live"/.test(panel), "going live needs an explicit confirmation");

console.log("-- never in the payment path's way --");
check(/from zoho_inventory import enqueue_order/.test(pay) && /await enqueue_order\(full, lines\)/.test(pay),
      "paid orders are queued with the exact decremented lines");
check(pay.indexOf("await enqueue_order") > pay.indexOf('{"$inc": {"stock": -qty}}'),
      "queued only after the website's own stock decrement");
check(/async def enqueue_order[\s\S]*?except Exception:[\s\S]*?log\.exception/.test(zi), "enqueue_order never raises");
check(/from zoho_inventory import enqueue_void/.test(ext) && /if payload\.status == "cancelled":\s*from zoho_inventory import enqueue_void/.test(ext),
      "a cancelled order voids its Zoho sales order");
check(/status\/confirmed/.test(zi), "sales orders are confirmed, so Zoho commits the copies");
check(/"reference_number": job\["order_number"\]/.test(zi), "retries look up the order number before creating again");

console.log("-- checkout --");
check(/live = await checkout_live_counts\(list\(requested\)\)/.test(srv), "checkout asks Zoho about the cart");
check(/if not await zoho_owns_stock\(\):\s*return \{\}/.test(zi), "checkout check only in live mode");
check(/asyncio\.wait_for\([\s\S]*?timeout=CHECKOUT_TIMEOUT_S \+ 1/.test(zi) && /return \{\}\s*$/m.test(zi),
      "checkout check is time-boxed and fails open");

console.log("-- one stock master at a time --");
check(/if await _zoho_is_master\(\):\s*return \{"ok": True, "skipped"/.test(sheet), "sheet cron stands down (no alert email) while Zoho is live");
check(/if await _zoho_is_master\(\):\s*raise HTTPException\(\s*status_code=409/.test(sheet), "manual sheet sync refused while Zoho is live");
check(/return st\["enabled"\] and st\["mode"\] == "live" and configured\(\)/.test(zi), "Zoho is master only when live");

console.log("-- wired in --");
check(/app\.include_router\(zoho_admin_router\)/.test(srv), "admin router included");
check(/start_scheduler\(\)/.test(srv), "scheduler started at startup");
check(/prefix="\/api\/admin\/inventory\/zoho"/.test(zi), "routes live under the inventory admin section (RBAC)");
check(/<ZohoInventoryPanel/.test(inv), "panel shown on Admin → Inventory");
check(!/os\.environ\.get\("ZOHO_CLIENT_SECRET"[^)]*\)[^\n]*return/.test(zi) && /return \{k: bool\(/.test(zi),
      "status reports whether credentials are set, never their values");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
