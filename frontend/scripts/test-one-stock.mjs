/**
 * One stock (Nov 2026): Warehouse → Stock is the only place book stock changes,
 * with one Adjust form; Admin → Warehouse has five groups.
 *     node frontend/scripts/test-one-stock.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (p) => readFileSync(join(SRC, p), "utf8");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
const inv = read("components/admin/WarehouseInventory.jsx");
check(!/function EditPanel|function MatchWebsite/.test(inv) && /function AdjustPanel/.test(inv), "one Adjust form replaces the four separate ones");
check(/live \? await adminWhSetBoth\(b\.id, num, note\) : await adminWhSetCount\(b\.id, num, note\)/.test(inv),
    "'Counted the shelf' saves the count AND brings the website in line (works on a never-counted title)");
check(/await adminWhInvMove\(b\.id, num, action, note\)/.test(inv), "copies in / out keep their own reason in the ledger");
check(inv.includes("{live && b.diff ? (canFix ? <FixMismatch"), "Fix mismatch appears only when website and shelf disagree (super admins)");
check(/>On shelf</.test(inv) && />Reserved</.test(inv) && />Available online</.test(inv) && /<StockStatus /.test(inv), "columns: On shelf · Reserved · Available online · Status");
const wh = read("pages/admin/AdminWarehouse.jsx");
const groups = [...wh.matchAll(/\["(today|stock|docs|shipping|history)", "[A-Z][A-Za-z]+", \[/g)].map((m) => m[1]);
check(groups.join() === "today,stock,docs,shipping,history", "five groups: Today, Stock, Documents, Shipping, History");
check(/get\("tab"\)/.test(wh), "?tab= opens a screen directly");
check(/inventory-one-stock/.test(read("pages/admin/AdminInventory.jsx")), "Admin → Inventory says where book stock is changed");
const today = read("components/admin/WarehouseToday.jsx");
check(/adminWhCountToday\(10\)/.test(today) && /<AdjustPanel b=\{b\}/.test(today), "Count today: ~10 books, each counted with the same Adjust form");
check(/adminWhReprint\(within\)/.test(today) && /Days left/.test(today), "Reprint soon: days of stock left at the 60-day pace");
check(/\["count", "Count today"\], \["reprint", "Reprint soon"\]/.test(wh), "both under Warehouse → Today");
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
