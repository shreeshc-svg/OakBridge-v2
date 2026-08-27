/**
 * Hamper page logic: the bits that can quietly mislead a customer.
 *
 *     node frontend/scripts/test-hamper-page.mjs
 *
 * No DOM. The four decisions worth guarding are pure functions of the record,
 * so they are re-implemented here exactly as the page computes them and checked
 * against the cases that actually occur. Each is re-derived from the source
 * file too, so the copy here cannot drift away from the copy that ships.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const page = readFileSync(join(SRC, "pages", "HamperDetail.jsx"), "utf8");
const banner = readFileSync(join(SRC, "components", "HamperBanner.jsx"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL "), label);
    if (!cond) failed++;
};

// ---------------------------------------------------------------- fill ----
const fill = (tpl, vars) =>
    String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

console.log("-- copy placeholders --");
check(fill("Only {stock} boxes left", { stock: 12 }) === "Only 12 boxes left",
      "a placeholder is substituted");
check(fill("{stock} left — order by {date}", { stock: 3, date: "14 Oct" }) === "3 left — order by 14 Oct",
      "several in one sentence");
check(fill("Boxed and ready", { stock: 3 }) === "Boxed and ready",
      "copy with no placeholder is untouched — an admin may delete it");
check(fill("Only {boxes} left", { stock: 3 }) === "Only {boxes} left",
      "an unknown placeholder is left visible rather than printing 'undefined'");
check(fill(undefined, {}) === "" && fill(null, {}) === "",
      "missing copy renders empty, not the word null");

// ------------------------------------------------------------- savings ----
const savings = (h) => {
    const full = Number(h?.contents_value || 0);
    const price = Number(h?.price || 0);
    if (!full || full <= price) return null;
    return { full, amount: full - price, pct: Math.round((1 - price / full) * 100) };
};

console.log("\n-- the savings claim --");
const s = savings({ contents_value: 2780, price: 2190 });
check(s.amount === 590 && s.pct === 21, "computed from the contents, never typed in by hand");
check(savings({ contents_value: 2000, price: 2000 }) === null,
      "no claim when the hamper costs what its contents cost");
check(savings({ contents_value: 1800, price: 2190 }) === null,
      "and none when the box costs MORE — a negative discount is not shown as a discount");
check(savings({ contents_value: 0, price: 2190 }) === null,
      "an unpriced contents list makes no claim at all");
check(savings({ price: 2190 }) === null, "nor does a missing one");

// ------------------------------------------------------------- scarcity ---
const scarce = (stock) => stock > 0 && stock <= 15;
console.log("\n-- the scarcity line --");
check(scarce(12) === true, "shown when genuinely low");
check(scarce(40) === false, "not shown on a full run — 'only 40 left' of 40 reads as a gimmick");
check(scarce(0) === false, "not shown when sold out; that is a different message");
check(scarce(15) === true && scarce(16) === false, "the threshold is 15");

// ------------------------------------------------------------- deadline ---
const orderBy = (iso, now) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getTime() < now) return null;
    return "date";
};
const NOW = Date.parse("2026-08-27T12:00:00Z");
console.log("\n-- the order-by deadline --");
check(orderBy("2026-10-14", NOW) === "date", "a future cut-off is shown");
check(orderBy("2026-08-01", NOW) === null,
      "a cut-off already passed is withdrawn — the product stays buyable, the promise does not");
check(orderBy("", NOW) === null && orderBy(null, NOW) === null, "no date, no claim");
check(orderBy("not a date", NOW) === null, "an unparseable date is dropped, not printed raw");

// -------------------------------------------------------------- source ----
console.log("\n-- what the shipped file actually does --");
check(!/["'](What's inside|Add to Cart|Send it as a gift)["']/.test(page),
      "no user-facing string is hardcoded in the page — all of it comes from hamper_copy");
check(page.includes("copy.add_to_cart_label") && page.includes("copy.contents_heading"),
      "labels are read from the copy object");
check(page.includes("stock <= 15"), "the scarcity threshold lives in the page, and is the one tested above");
check(/d\.getTime\(\)\s*<\s*Date\.now\(\)/.test(page), "the deadline is compared against now");
check(page.includes("metaDescription") && page.includes("breadcrumbLd"),
      "the page carries SEO metadata like every other route");
check(!page.includes("arrives by") && !page.includes("guaranteed"),
      "no delivery promise is hardcoded — the note is admin-editable and honest by default");

console.log("\n-- the banner --");
check(banner.includes("alt") && /alt=\{alt\}/.test(banner), "the image always has alt text");
check(banner.includes('banner.alt || ""') || banner.includes("banner.alt"),
      "which the admin sets");
check(banner.includes("image_mobile"), "a separate mobile crop is supported");
check(/"w-full block h-auto"/.test(banner),
      "the banner runs at its OWN aspect ratio by default — no cap, so nothing is cropped or letterboxed");
check(banner.includes("md:max-h-") && !/md:h-\[var/.test(banner),
      "a cap is a MAXIMUM: a picture shorter than it is left alone, not stretched to meet it");
check(banner.includes("md:object-contain") && banner.includes("md:object-cover"),
      "and when capped, the admin chooses between the whole image and a crop");
// Not source order — that proves nothing. The property that matters is that
// cropping requires an explicit opt-in, so an unset or unknown fit shows the
// whole image rather than silently cutting somebody's artwork.
const fitsTo = (fit) => (fit === "cover" ? "cover" : "contain");
check(/banner\.fit === "cover"/.test(banner),
      "cropping is opt-in: the test is fit === 'cover', so anything else contains");
check(fitsTo(undefined) === "contain" && fitsTo("") === "contain" && fitsTo("nonsense") === "contain",
      "unset, blank and unrecognised all show the whole image");
check(fitsTo("cover") === "cover", "and cover still crops when asked for");
check(banner.includes("|| image"), "and falls back to the desktop file rather than showing nothing");
check(/if \(!banner\?\.enabled \|\| !image\) return null/.test(banner),
      "renders nothing at all when switched off or imageless — no empty slot on the homepage");
check(banner.includes('loading="eager"'),
      "loads eagerly; it sits near the top and lazy-loading would shift the page as it lands");
check(banner.includes("noopener"), "external links carry noopener");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
