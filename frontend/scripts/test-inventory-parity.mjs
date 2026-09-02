/**
 * The dashboard's inventory strip and the Inventory screen must agree.
 *
 *     node frontend/scripts/test-inventory-parity.mjs
 *
 * They did not. The strip said "13 low-stock and 11 out-of-stock", the page it
 * links to said 17 and 11, and both were correctly computing different
 * questions:
 *
 *   the threshold — a literal 5 in the stats query, against 10 on Inventory
 *   the population — the strip excluded hampers, Inventory never did
 *
 * Neither could fail a build or throw an error. Two numbers describing the same
 * shelf simply disagreed, on adjacent screens, and the only way to notice was
 * to read both and do the subtraction. So the invariant is asserted here
 * instead: one threshold, one population, both read from the same place.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BE = join(HERE, "..", "..", "backend");
const SRC = join(HERE, "..", "src");
const ext = readFileSync(join(BE, "extensions.py"), "utf8");
const feat = readFileSync(join(BE, "features.py"), "utf8");
const inv = readFileSync(join(SRC, "pages", "admin", "AdminInventory.jsx"), "utf8");
const dash = readFileSync(join(SRC, "pages", "admin", "AdminDashboard.jsx"), "utf8");

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

console.log("-- one threshold, stored once --");
check(/"low_stock_threshold": 10,/.test(feat), "it is a setting with a default, not a literal in two files");
check(feat.includes("async def _low_stock_threshold("),
      "and one helper resolves it, so two signatures cannot drift to two defaults");
check(!/\$lte": 5, "\$gt": 0/.test(ext), "the hardcoded 5 is gone from the stats query");
check(ext.includes("threshold = await _low_stock_threshold()"),
      "the dashboard reads the shared value");
check(/async def admin_inventory\(threshold: Optional\[int\] = None\)/.test(feat) &&
      /async def admin_low_stock\(threshold: Optional\[int\] = None\)/.test(feat),
      "and both inventory endpoints default to it rather than to their own 10");

console.log("\n-- one population --");
check(!/not_hamper.*stock|stock.*not_hamper/s.test(
        ext.slice(ext.indexOf("low_stock_count"), ext.indexOf("low_stock_count") + 400)),
      "the stock counts no longer exclude hampers");
check(ext.includes('db.books.count_documents({"stock": {"$lte": threshold, "$gt": 0}})'),
      "low stock counts everything with stock, as Inventory always has");
check(ext.includes('db.books.count_documents({"stock": {"$lte": 0}})'),
      "and so does out of stock");
check(ext.includes('books = await db.books.count_documents({"product_type": {"$ne": "hamper"}})'),
      "while the Books TILE still excludes hampers — that one means titles on sale, a different question");

console.log("\n-- the number says what it means --");
check(ext.includes('"low_stock_threshold": threshold,'),
      "the threshold is returned, so the strip can name it instead of printing a bare count");
check(dash.includes("(≤ ${stats.low_stock_threshold})"), "and the strip prints it");
check(/out-of-stock\s*\n?\s*\{" "\}items\./.test(dash) || dash.includes('{" "}items.'),
      "wording is 'items', not 'titles', now that a hamper can be counted");

console.log("\n-- changing it on Inventory moves both --");
check(inv.includes('adminSetSetting("low_stock_threshold", n)'),
      "the Inventory input persists the value rather than keeping it in component state");
check(inv.includes("const [threshold, setThreshold] = useState(null);"),
      "and starts null, so the first fetch waits for the saved value instead of guessing 10");
check(inv.includes("if (threshold == null) return;"), "the loader holds off until it arrives");
check(inv.includes('fetchSettings()'), "it reads the same settings key the dashboard does");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
