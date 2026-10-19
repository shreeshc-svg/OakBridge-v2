/**
 * Marketing → Growth period picker (lib/dateRange.js growthPeriod).
 *
 *     node frontend/scripts/test-growth-periods.mjs
 *
 * Month and year edges are where a date range goes wrong silently, so they
 * are pinned: January's "last month", leap February, year boundaries.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { growthPeriod, growthPeriodLabel, GROWTH_PERIODS } = await import(pathToFileURL(join(HERE, "..", "src", "lib", "dateRange.js")).href);
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const now = new Date(2026, 9, 19, 15, 0); // 19 Oct 2026, local
check(eq(growthPeriod("today", { now }), { start: "2026-10-19", end: "2026-10-19" }), "today");
check(eq(growthPeriod("yesterday", { now }), { start: "2026-10-18", end: "2026-10-18" }), "yesterday");
check(eq(growthPeriod("7d", { now }), { start: "2026-10-13", end: "2026-10-19" }), "last 7 days includes today");
check(eq(growthPeriod("this_month", { now }), { start: "2026-10-01", end: "2026-10-19" }), "this month: 1st → today");
check(eq(growthPeriod("last_month", { now }), { start: "2026-09-01", end: "2026-09-30" }), "last month: whole September");
check(eq(growthPeriod("last_month", { now: new Date(2026, 0, 5) }), { start: "2025-12-01", end: "2025-12-31" }), "January → last month is December of last year");
check(eq(growthPeriod("last_month", { now: new Date(2028, 2, 3) }), { start: "2028-02-01", end: "2028-02-29" }), "leap February");
check(eq(growthPeriod("this_year", { now }), { start: "2026-01-01", end: "2026-10-19" }), "this year");
check(eq(growthPeriod("last_year", { now }), { start: "2025-01-01", end: "2025-12-31" }), "last year");
check(growthPeriod("custom", { from: "2026-10-01" }) === null, "half-filled custom range: nothing yet");
check(eq(growthPeriod("custom", { from: "2026-10-10", to: "2026-10-01" }), { start: "2026-10-01", end: "2026-10-10" }), "backwards custom range swapped");
check(growthPeriodLabel({ start: "2026-10-01", end: "2026-10-19" }) === "1 Oct – 19 Oct 2026" && growthPeriodLabel({ start: "2026-10-19", end: "2026-10-19" }) === "19 Oct 2026", "labels");
check(GROWTH_PERIODS.some((p) => p.key === "this_month") && GROWTH_PERIODS.some((p) => p.key === "last_month") && GROWTH_PERIODS.some((p) => p.key === "custom"), "picker offers this month / last month / custom");
console.log();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log("all checks passed");
