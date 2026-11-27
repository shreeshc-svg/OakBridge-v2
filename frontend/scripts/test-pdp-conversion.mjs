/**
 * Book page conversion pieces (Nov 2026): delivery dates, sticky buy bar,
 * "Save ₹X", out-of-stock -> other format in stock.
 *     node frontend/scripts/test-pdp-conversion.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const D = await import(pathToFileURL(join(SRC, "lib", "delivery.js")).href);
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
check(JSON.stringify(D.parseDays("3–7 business days")) === "[3,7]" && JSON.stringify(D.parseDays("3 to 5 days")) === "[3,5]"
    && JSON.stringify(D.parseDays("Ships in 2 days")) === "[2,2]" && D.parseDays("Fast delivery") === null, "reads the admin's delivery text; no numbers -> no promise");
const iso = (d) => d.toISOString().slice(0, 10);
// Fri 27 Nov 2026, 10:00 IST: before the cut-off -> counted from today; Sundays skipped.
let w = D.deliveryWindow("3–7 business days", Date.UTC(2026, 10, 27, 4, 30));
check(iso(w[0]) === "2026-12-01" && iso(w[1]) === "2026-12-05", "Fri morning: 3 days -> Tue 1 Dec (Sun 29 skipped), 7 days -> Sat 5 Dec");
// Same day 15:00 IST: after the 2 pm cut-off -> counted from Sat.
w = D.deliveryWindow("3–7 business days", Date.UTC(2026, 10, 27, 9, 30));
check(iso(w[0]) === "2026-12-02" && iso(w[1]) === "2026-12-07", "after 2 pm IST counts from the next day");
// Sunday order counts from Monday.
w = D.deliveryWindow("1-2 days", Date.UTC(2026, 10, 29, 4, 0));
check(iso(w[0]) === "2026-12-01", "a Sunday order starts Monday");
const pdp = readFileSync(join(SRC, "pages/BookDetail.jsx"), "utf8");
check(/!oos && !preorder\.active && !pod && \(\s*<DeliveryEstimate text=\{settings\?\.pdp_delivery/.test(pdp), "dates shown only for an in-stock book, from the admin's own text");
check(/<StickyBuyBar targetId="pdp-add-to-cart"/.test(pdp) && /id="pdp-add-to-cart"/.test(pdp), "sticky bar tracks the real Add to Cart button");
check(/pdp-you-save/.test(pdp) && /pdp-other-format-in-stock/.test(pdp), "'Save ₹X (N%)' and 'The Hardback is in stock' link");
const bar = readFileSync(join(SRC, "components/StickyBuyBar.jsx"), "utf8");
check(/md:hidden/.test(bar) && /right-\[84px\]/.test(bar) && /--tray-h/.test(bar), "phones only, above the bottom tray, clear of the chat button");
const code = bar.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check(/document\.getElementById\(targetId\)/.test(code.slice(code.indexOf("const check"))) && !/new IntersectionObserver/.test(code),
    "re-finds the button on each scroll (a mount-time observer watched a detached copy live)");
const de = readFileSync(join(SRC, "components/DeliveryEstimate.jsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
check(/useState\(null\)/.test(de) && /useEffect\(\(\) => \{ setNow\(Date\.now\(\)\); \}, \[\]\)/.test(de) && /now \? deliveryWindow\(text, now\) : null/.test(de),
    "dates only after mount (a number — Date + offset would be a string): the prerender (build day) and first render match — no stale dates, no hydration mismatch");
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
