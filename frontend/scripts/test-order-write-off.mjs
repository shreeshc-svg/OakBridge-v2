/**
 * Writing a bounced order's amount off the Not collected tile.
 *
 *     node frontend/scripts/test-order-write-off.mjs
 *
 * This is the only action in the admin panel that moves a revenue figure, and
 * every failure mode here is silent. A write-off that also reduced Revenue, a
 * POST endpoint the fulfilment role could reach because the automatic
 * superadmin gate only covers DELETE, a flag that survived the customer
 * actually paying — none of those raise anything. They just make the dashboard
 * quietly wrong, on the numbers the business is run from.
 *
 * The aggregation is asserted as source text because it cannot be imported: it
 * is a Mongo pipeline inside an async FastAPI handler.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(HERE, "..", "src");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

/*
 * Read CODE, not the comments explaining it.
 *
 * Every file below documents this feature at length, and those comments name
 * "written_off", "require_superadmin" and "bounced" repeatedly. Four assertions
 * in this suite's history have passed by matching prose. Strip it first.
 */
const code = (abs) =>
    readFileSync(abs, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .split("\n")
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("*");
        })
        .join("\n");

const ext = code(join(ROOT, "backend", "extensions.py"));
const pay = code(join(ROOT, "backend", "payments.py"));
const orders = code(join(SRC, "pages", "admin", "AdminOrders.jsx"));
const dash = code(join(SRC, "pages", "admin", "AdminDashboard.jsx"));
const dialog = code(join(SRC, "components", "admin", "WriteOffDialog.jsx"));
const api = code(join(SRC, "lib", "api.js"));

console.log("-- only a superadmin can move money off the dashboard --");
check(/async def admin_write_off_order\([\s\S]{0,400}?Depends\(require_superadmin\)/.test(ext),
      "the endpoint takes require_superadmin explicitly");
check(/@admin_router\.post\("\/orders\/\{order_id\}\/write-off"\)/.test(ext),
      "it is a POST — which is exactly why the dependency above is not optional: "
      + "require_admin only promotes to superadmin for DELETE");
check(api.includes("/write-off"), "the client calls that path");
check(orders.includes("canDelete(me)"),
      "and the UI hides the button behind the same superadmin check, rather than inventing a second rule");

console.log("\n-- it refuses everything except a dead, unpaid order --");
check(/payment_status"\) == "paid"[\s\S]{0,240}?status_code=400/.test(ext),
      "a paid order cannot be written off — there is nothing uncollected on it");
check(/status"\) != "bounced"[\s\S]{0,240}?status_code=400/.test(ext),
      "an order that has not been marked bounced cannot be written off, so it always takes two deliberate steps");
check(/if not order:[\s\S]{0,120}?status_code=404/.test(ext), "an unknown order is a 404, not a silent no-op");
check(orders.includes('o.status === "bounced"') && orders.includes('o.payment_status !== "paid"'),
      "the button appears only where the endpoint would accept it, so it is never a button that only ever errors");

console.log("\n-- writing off twice is not writing off twice --");
check(/if order\.get\("written_off"\):[\s\S]{0,200}?return \{"ok": True/.test(ext),
      "a repeat call returns ok instead of raising, so a double-click or a retry after a timeout cannot double-log it");
check(/if not order\.get\("written_off"\):[\s\S]{0,200}?return \{"ok": True/.test(ext),
      "and the same on the way back, so restoring an order that was never written off is harmless");

console.log("\n-- the money leaves Not collected and nothing else --");
check(ext.includes('"written_off": {"$eq": [{"$ifNull": ["$written_off", False]}, True]}'),
      "the state aggregation groups by written_off as well as payment status");
check((ext.match(/\$ifNull": \["\$paid_at"/g) || []).length === 2,
      "still exactly two $ifNull on paid_at — the split reuses the existing pipeline rather than adding a "
      + "second one that could drift from the Orders tile");
check(/if key\.get\("written_off"\) and state != "paid":/.test(ext),
      "a written-off order that somehow reads as paid still counts as revenue — the flag can never understate money Razorpay says it captured");
check(ext.includes('"written_off_revenue": written_off_total') && ext.includes('"written_off_orders": written_off_count'),
      "the written-off totals are returned separately");
check(dash.includes("s.written_off_revenue") && dash.includes("written off"),
      "and the Not collected tile names them, so the figure never drops without saying why");
check(/s\.written_off_orders \?/.test(dash),
      "the clause only appears once there is something to report");

console.log("\n-- paying later undoes it --");
check(/money = \{[\s\S]{0,400}?"written_off": False/.test(pay),
      "a capture clears the write-off, in the same $set that records the payment");
check(!/written_off[\s\S]{0,80}\$ne/.test(pay),
      "and the reconcile sweep still polls written-off orders, so a late payment is still found rather than written off forever");

console.log("\n-- nothing is deleted --");
check(!/delete_one\(\{"id": order_id\}/.test(ext),
      "the write-off path deletes no order document");
check(/"written_off": True,[\s\S]{0,200}"written_off_by": actor\.get\("email"/.test(ext),
      "it sets a flag and records who set it");
check(ext.includes('"invoice_no": order.get("invoice_no")'),
      "the audit line carries the GST invoice number, which is the record that makes deleting these orders unsafe in the first place");
check(dialog.includes("Nothing is deleted"),
      "and the dialog says so, because 'write off' reads like 'delete' to anyone who has not read the code");

console.log("\n-- it is on the record --");
check(ext.includes('"ORDER_WRITTEN_OFF"') && ext.includes('"ORDER_WRITE_OFF_REVERSED"'),
      "both directions are audit-logged under distinct actions");
check(/audit_log\([\s\S]{0,400}?email=actor\.get\("email", ""\),[\s\S]{0,80}?role=actor\.get\("role", ""\)/.test(ext),
      "with the actor taken from the dependency rather than from the request body");
check(/"amount": order\.get\("total"\)/.test(ext), "and the amount, so the log answers how much without a join");
check(/"status": "written_off" if payload\.written_off else "write_off_reversed"/.test(ext),
      "the order's own status_history records it too — that is what someone opening the order will read");

console.log("\n-- the admin can see and undo it --");
check(orders.includes("order-write-off-"), "the row action has a stable testid");
check(orders.includes('"Put back"'), "a written-off order offers the way back");
check(orders.includes("order-written-off-"), "and is marked as written off in the list");
check(dialog.includes("formatINR(order.total)"), "the dialog states the amount before it moves it");
check(dialog.includes("write-off-note"), "and takes a reason for the audit log");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
