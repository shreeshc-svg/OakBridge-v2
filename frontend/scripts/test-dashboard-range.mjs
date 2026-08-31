/**
 * The dashboard's date ranges and tile ordering.
 *
 *     node frontend/scripts/test-dashboard-range.mjs
 *
 * Both of these fail silently when they fail. A month boundary that is off by a
 * day still returns a number, and it is a plausible number — you would only
 * catch it by reconciling against the orders list by hand. A tile order that
 * drops an unknown key can hide a tile you have never seen, so the bug looks
 * like a missing feature rather than a bug.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveRange, rangeLabel, RANGE_PRESETS } from "../src/lib/dateRange.js";
import { reconcileOrder, moveTile } from "../src/lib/tileOrder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const dash = readFileSync(join(SRC, "pages", "admin", "AdminDashboard.jsx"), "utf8");
const api = readFileSync(join(SRC, "lib", "api.js"), "utf8");
const ext = readFileSync(join(HERE, "..", "..", "backend", "extensions.py"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

// Local-time helpers so the assertions read as dates, not as instants. The
// range functions work in local time deliberately, so the tests must too.
const local = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

console.log("-- all time is the absence of a range, not a very wide one --");
check(resolveRange("all") === null, "'all' resolves to null, so no params are sent at all");
check(resolveRange("nonsense") === null, "an unknown preset falls back to all time rather than throwing");

console.log("\n-- last 7 days includes today --");
{
    const r = resolveRange("7d", { now: "2026-08-31T15:30:00" });
    check(local(r.from) === "2026-08-25 00:00", "starts six days back at midnight, so the window is 7 days");
    check(local(r.to) === "2026-08-31 23:59", "ends at the end of today, not at last midnight");
}

console.log("\n-- this month runs from the 1st to today, never into the future --");
{
    const r = resolveRange("this_month", { now: "2026-08-31T15:30:00" });
    check(local(r.from) === "2026-08-01 00:00", "starts on the 1st");
    check(local(r.to) === "2026-08-31 23:59", "ends today");
}
{
    const r = resolveRange("this_month", { now: "2026-08-01T02:00:00" });
    check(local(r.from) === "2026-08-01 00:00",
          "at 2am on the 1st it is already the new month — this is the case UTC would get wrong in India");
    check(local(r.to) === "2026-08-01 23:59", "and the window is that one day, not zero-length");
}

console.log("\n-- last month is the whole of the month before, and knows about January --");
{
    const r = resolveRange("last_month", { now: "2026-08-15T09:00:00" });
    check(local(r.from) === "2026-07-01 00:00", "starts on the 1st of July");
    check(local(r.to) === "2026-07-31 23:59", "ends on the 31st, not the 30th and not 1 August");
}
{
    const r = resolveRange("last_month", { now: "2026-03-10T09:00:00" });
    check(local(r.to) === "2026-02-28 23:59", "February 2026 ends on the 28th — month length is not assumed");
}
{
    const r = resolveRange("last_month", { now: "2026-01-15T09:00:00" });
    check(local(r.from) === "2025-12-01 00:00" && local(r.to) === "2025-12-31 23:59",
          "January's last month is December of the previous YEAR");
}
{
    const r = resolveRange("last_month", { now: "2024-03-05T09:00:00" });
    check(local(r.to) === "2024-02-29 23:59", "and a leap February ends on the 29th");
}

console.log("\n-- custom ranges are whole days, and forgiving --");
{
    const r = resolveRange("custom", { from: "2026-08-01", to: "2026-08-15" });
    check(local(r.from) === "2026-08-01 00:00", "starts at local midnight, not the UTC midnight a bare date parses to");
    check(local(r.to) === "2026-08-15 23:59", "the end date is included in full");
}
check(resolveRange("custom", { from: "2026-08-01" }) === null,
      "half a range is not a range — no filtering until both ends are set");
check(resolveRange("custom", {}) === null, "nor is an empty one");
check(resolveRange("custom", { from: "oops", to: "2026-08-15" }) === null, "garbage in one bound is not applied");
{
    const r = resolveRange("custom", { from: "2026-08-15", to: "2026-08-01" });
    check(local(r.from) === "2026-08-01 00:00" && local(r.to) === "2026-08-15 23:59",
          "picked backwards, the dates swap instead of returning an empty shelf of numbers");
}

console.log("\n-- the label states what was applied, not what was clicked --");
check(rangeLabel("all", null).startsWith("All time"), "no range reads as all time");
check(rangeLabel("custom", null).startsWith("All time"),
      "a half-filled custom range says ALL TIME, because that is what the numbers are");
check(rangeLabel("7d", resolveRange("7d", { now: "2026-08-31T12:00:00" })) === "25 Aug 2026 – 31 Aug 2026",
      "a real range is spelled out in full");
check(RANGE_PRESETS.map((p) => p.key).join(",") === "all,7d,this_month,last_month,custom",
      "the five presets, in the order they are shown");

console.log("\n-- tile order survives tiles being added and removed --");
const DEF = ["revenue", "not_collected", "orders", "customers", "books"];
check(reconcileOrder(null, DEF).join() === DEF.join(), "nothing saved yet gives the default order");
check(reconcileOrder(["books", "revenue"], DEF).join() === "books,revenue,not_collected,orders,customers",
      "a partial saved order is honoured, and the rest append in default order");
check(reconcileOrder(["desk_pending", "books"], DEF).join() === "books,revenue,not_collected,orders,customers",
      "a tile that no longer exists is dropped — Desk Pending cannot come back from localStorage");
check(reconcileOrder(["books", "books", "revenue"], DEF).length === DEF.length,
      "a duplicated key cannot render the same tile twice");
check(reconcileOrder("not-an-array", DEF).join() === DEF.join(), "a corrupted value falls back to the default");
check(reconcileOrder(["revenue"], []).length === 0, "no tiles defined, no tiles shown");

console.log("\n-- dragging lands where you dropped it --");
check(moveTile(DEF, "revenue", "orders").join() === "not_collected,orders,revenue,customers,books",
      "dragging left-to-right lands AFTER the target, not one place past it");
check(moveTile(DEF, "books", "revenue").join() === "books,revenue,not_collected,orders,customers",
      "dragging right-to-left lands before the target");
check(moveTile(DEF, "revenue", "books").join() === "not_collected,orders,customers,books,revenue",
      "the first tile can reach the last position");
check(moveTile(DEF, "revenue", "revenue").join() === DEF.join(), "dropping a tile on itself changes nothing");
check(moveTile(DEF, "ghost", "books").join() === DEF.join(), "an unknown key is a no-op rather than a splice at -1");

console.log("\n-- the wiring holds --");
check(/adminStats = \(range\) =>/.test(api), "the client takes a range");
check(api.includes("params: range ? { from: range.from, to: range.to } : {}"),
      "and sends nothing at all when there is no range, so all-time is the old request byte for byte");
check(dash.includes("}, [range]);"), "the dashboard refetches when the range changes");
check(ext.includes('frm: str | None = Query(None, alias="from")'),
      "the endpoint accepts from/to ('from' is a Python keyword, hence the alias)");
check(ext.includes('*([{"$match": {"_when": window}}] if window else [])'),
      "and the revenue aggregation gains a $match only when a range was sent");

console.log("\n-- money is windowed on when it ARRIVED --");
check(ext.includes('{"$addFields": {"_when": {"$ifNull": ["$paid_at", "$created_at"]}}}'),
      "paid_at drives the window, falling back to created_at for anything unpaid");
check((ext.match(/\$ifNull": \["\$paid_at"/g) || []).length === 2,
      "and the Orders count uses the same effective date, so the two tiles can never "
      + "describe different sets of orders");
check(ext.includes('not_hamper = {"product_type": {"$ne": "hamper"}}'),
      "the stock counts exclude hampers too — the inventory strip must not warn about a "
      + "'title' the Books tile refuses to count");
check(dash.includes("stats?.range?.applied ? stats.range : range"),
      "and the label reads the window the SERVER applied, which differs from the buttons "
      + "whenever a bound failed to parse");

console.log("\n-- scope labels: the range must not appear to move a number it cannot --");
check(/books: \{\s*\n\s*scoped: false/.test(dash), "Books is declared unscoped");
check(dash.includes('scope={def.scoped ? (range ? "selected range" : "all time") : "all time"}'),
      "and an unscoped tile says ALL TIME whatever the range is set to");
check(ext.includes('"low_stock_books": low_stock_count'), "stock counts moved to the top level, outside the range");
check(!ext.includes('"last_7_days"'), "the hardcoded 7-day block is gone — the range control replaces it");
check(ext.includes('books = await db.books.count_documents({"product_type": {"$ne": "hamper"}})'),
      "and Books excludes the hamper, so the tile agrees with the bookstore's category counts");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
