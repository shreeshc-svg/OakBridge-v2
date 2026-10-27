/**
 * Print on Demand dates in the browser (lib/pod.js) = the server's
 * (backend/pod_core.py, same cases as backend/tests/test_pod.py).
 *
 *     node frontend/scripts/test-pod.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const { dispatchWindow, podActive } = await import(pathToFileURL(join(SRC, "lib", "pod.js")).href);
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
const HOL = [{ date: "2026-11-03" }];
for (const [at, a, b, label] of [
    ["2026-10-26T04:00:00Z", "2026-11-02", "2026-11-05", "Mon before 2 pm"],
    ["2026-10-26T09:00:00Z", "2026-11-04", "2026-11-06", "Mon after 2 pm"],
    ["2026-10-30T08:29:00Z", "2026-11-09", "2026-11-11", "Fri 13:59 IST"],
    ["2026-10-30T08:31:00Z", "2026-11-10", "2026-11-12", "Fri 14:01 IST"],
    ["2026-10-31T04:00:00Z", "2026-11-10", "2026-11-12", "Saturday"],
]) {
    const w = dispatchWindow(Date.parse(at), HOL);
    check(w[0] === a && w[1] === b, `${label} -> ${w.join(" … ")}`);
}
check(podActive({ pod: true, stock: 0 }) && !podActive({ pod: true, stock: 2 }) && !podActive({ pod: true, stock: 0 }, true)
      && !podActive({ pod: true, stock: 0, product_type: "hamper" }), "which books are POD");

console.log("-- storefront wiring --");
const read = (p) => readFileSync(join(SRC, p), "utf8");
check(/const oos = stock <= 0 && !preorder\.active && !pod;/.test(read("components/BookCard.jsx")), "tile: POD is never 'out of stock'");
const pdp = read("pages/BookDetail.jsx");
check(pdp.includes('"pod-button"') && pdp.includes("Print on Demand") && pdp.includes("{!preorder.active && !pod && ("), "book page: one Print on Demand button");
const co = read("pages/Checkout.jsx");
check(co.includes("pod_ack: Boolean(hasPod && podAck)") && co.includes("(hasPod && !podAck)"), "checkout: confirmation required and sent");
check(/c && !c\.virtual/.test(read("lib/catalogue.js")), "'All' count doesn't double-count the POD tab");
check(/if \(isPrerender\(\)\) return;\s*fetchPodSchedule\(\)/.test(read("context/CartContext.jsx")), "dates never in the prerendered page");
console.log();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log("all checks passed");
