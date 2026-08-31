/**
 * The bookstore's "a filter is already on" notice.
 *
 *     node frontend/scripts/test-filter-notice.mjs
 *
 * Three ways this feature fails without anyone noticing. It fires for visitors
 * who picked the category themselves, and becomes wallpaper. It prints a count
 * that disagrees with the sidebar, or a zero during the moment before the
 * counts land. Or it stops being reachable at all — the button that clears the
 * filter is the entire point, and a notice you cannot act on is worse than no
 * notice, because it names a problem and then leaves the visitor with it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    shouldShowFilterNotice,
    remainingOutsideFilter,
    catalogueTotalFrom,
} from "../src/lib/filterNotice.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const catalog = readFileSync(join(SRC, "pages", "Catalog.jsx"), "utf8");
const notice = readFileSync(join(SRC, "components", "DefaultFilterNotice.jsx"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const CAT = { id: "professional", name: "Professional", book_count: 108 };
const show = (o) =>
    shouldShowFilterNotice({
        autoFiltered: true,
        activeCat: CAT,
        search: "",
        dismissed: false,
        ...o,
    });

console.log("-- it speaks only when we chose for them --");
check(show({}) === true, "fresh arrival, default applied by the page: shown");
check(show({ autoFiltered: false }) === false,
      "visitor clicked the category themselves: silent");
check(show({ autoFiltered: false, activeCat: { name: "Academic", book_count: 57 } }) === false,
      "campaign link arrived pre-filtered: silent, they were sent there on purpose");
check(show({ activeCat: null }) === false, "no filter on: nothing to announce");
check(show({ search: "arbitration" }) === false,
      "a search outranks the default, and the search path drops the category anyway");
check(show({ dismissed: true }) === false, "closed once, closed for good");

console.log("\n-- the number never lies, and never guesses --");
check(remainingOutsideFilter(195, 108) === 87, "195 total minus 108 shown is 87 outside");
check(remainingOutsideFilter(0, 0) === null,
      "counts not loaded yet: null, so the copy falls back to 'more titles'");
check(remainingOutsideFilter(108, 108) === null,
      "one category holds everything: no boast about titles that do not exist");
check(remainingOutsideFilter(100, 108) === null, "a negative can never reach the sentence");
check(remainingOutsideFilter(undefined, 108) === null, "missing total is not NaN on screen");
check(remainingOutsideFilter(195, undefined) === null, "missing shown count, likewise");
check(notice.includes('more === null ? "more titles"'),
      "and the component honours the null instead of interpolating it");

console.log("\n-- the total is the sidebar's own arithmetic --");
const cats = [
    { id: "academic", book_count: 57 },
    { id: "professional", book_count: 108 },
    { id: "business", book_count: 30 },
];
check(catalogueTotalFrom(cats) === 195, "sums the counts already printed beside each category");
check(catalogueTotalFrom([]) === 0, "empty list totals zero rather than throwing");
check(catalogueTotalFrom(undefined) === 0, "so does a fetch that never resolved");
check(catalogueTotalFrom([{ id: "x" }, { id: "y", book_count: null }]) === 0,
      "categories with no count contribute nothing instead of NaN");
check(catalog.includes("catalogueTotalFrom(cats)"),
      "the page derives the total, never hardcodes one that would go stale");

console.log("\n-- the way out stays reachable --");
check(catalog.includes('onClearFilter={() => update("category", "")}'),
      "the button clears the category through the same path as the sidebar's All Categories");
check(/if \(key === "category" \|\| key === "search"\) setAutoFiltered\(false\)/.test(catalog),
      "choosing any category retires the notice, so it cannot re-announce a deliberate choice");
check(catalog.includes("setAutoFiltered(true)"), "and it is armed only inside the default effect");
check(notice.includes('data-testid="clear-default-filter"'), "the action is addressable in tests");
check(notice.includes('role="status"'), "screen readers are told, without stealing focus");
check(notice.includes('aria-label="Dismiss this notice"'), "the ✕ is not an unlabelled icon");

console.log("\n-- it survives a phone and a private window --");
check(notice.includes("h-11 sm:h-9"), "44px tap target on touch, tighter once there is a mouse");
check(notice.includes("w-11 h-11 sm:w-8 sm:h-8"), "the dismiss is a real target too, not a 16px ✕");
check(notice.includes("basis-full sm:basis-auto"),
      "on a narrow screen the message and the action each take their own row");
check((notice.match(/catch/g) || []).length >= 2,
      "localStorage throws in private mode; both reads and writes are guarded");
check(/return false;\s*\/\/ private mode/.test(notice),
      "and the safe failure is to show it once, not to suppress it forever");

console.log("\n-- alignment: it is part of the shelf, not a banner over it --");
// The mockup indented the text past an emoji and a fat left border, so it sat
// ~40px right of the "108 titles" count directly beneath it. Same container
// edges, small padding, no icon gutter.
check(!notice.includes("💡"), "no emoji gutter pushing the sentence off the column's left edge");
check(notice.includes("px-3 py-2.5 sm:px-4 sm:py-3"),
      "modest padding, so the text lines up with the count row below");
check(catalog.indexOf("DefaultFilterNotice\n") < catalog.indexOf('data-testid="catalog-count"'),
      "and it renders above that count row, inside the same results column");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
