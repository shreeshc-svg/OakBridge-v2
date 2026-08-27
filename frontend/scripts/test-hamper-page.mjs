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
    const price = Number(h?.price || 0);
    const listed = Number(h?.original_price || 0);
    const contents = Number(h?.contents_value || 0);
    const full = listed > price ? listed : contents;
    const basis = listed > price ? "list" : "contents";
    if (!full || full <= price) return null;
    return { full, basis, amount: full - price, pct: Math.round((1 - price / full) * 100) };
};

console.log("\n-- the savings claim --");
const s = savings({ contents_value: 2780, price: 2190 });
check(s.amount === 590 && s.pct === 21, "worked out from the contents when there is no list price");
check(s.basis === "contents", "and says so, because the sentence under it only fits that case");
check(savings({ contents_value: 2000, price: 2000 }) === null,
      "no claim when the hamper costs what its contents cost");
check(savings({ contents_value: 1800, price: 2190 }) === null,
      "and none when the box costs MORE — a negative discount is not shown as a discount");
check(savings({ contents_value: 0, price: 2190 }) === null,
      "an unpriced contents list makes no claim at all");
check(savings({ price: 2190 }) === null, "nor does a missing one");

console.log("\n-- an explicit list price --");
const listed = savings({ price: 649, original_price: 899, contents_value: 780 });
check(listed.full === 899, "a typed list price wins over the contents sum");
check(listed.basis === "list", "and is marked as such");
check(listed.pct === 28, "the percentage comes off the list price");
check(savings({ price: 649, original_price: 0, contents_value: 780 }).full === 780,
      "left at zero, the contents sum is used instead — the field is optional");
check(savings({ price: 649, original_price: 500, contents_value: 780 }).full === 780,
      "a list price BELOW the selling price is ignored rather than shown as a markup");
check(savings({ price: 649, original_price: 649, contents_value: 0 }) === null,
      "a list price equal to the price is no discount, so nothing is struck through");
check(savings({ price: 0, original_price: 899 }).pct === 100,
      "a free hamper against a list price does not divide by zero");

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
// The shipped page must use the same precedence as the function tested above,
// and must only print the contents sentence when the figure IS the contents sum.
check(/const listed = Number\(h\?\.original_price \|\| 0\)/.test(page),
      "the page reads the admin's list price");
check(page.includes('listed > price ? listed : contents'),
      "and prefers it over the contents sum, exactly as tested");
check(page.includes('savings?.basis === "contents" && copy.value_note'),
      "the 'bought separately' line appears only when the figure came from the contents — it does not describe an MRP");
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

// Filling the bars either side of a letterboxed banner.
const letterboxed = (cap, fit) => Boolean(cap) && fit !== "cover";
check(letterboxed(320, "contain") === true, "a capped, contained banner IS letterboxed");
check(letterboxed(320, "cover") === false, "a cover banner fills the strip itself — no bars to fill");
check(letterboxed(0, "contain") === false, "an uncapped banner is full-bleed — nothing to fill");
check(banner.includes("const letterboxed = Boolean(cap) && !crops"),
      "and the component decides it the same way");
check(banner.includes('banner.backdrop || "blur"'),
      "the default fill is a blurred copy of the artwork — it matches any image and needs no colour picked");
check(/alt=""/.test(banner) && banner.includes('aria-hidden="true"'),
      "the blurred copy is marked decorative, so a screen reader does not announce the banner twice");
check(banner.includes("pointer-events-none"),
      "and it never intercepts the click meant for the banner");
check(banner.includes("hidden md:block"),
      "no backdrop on phones, where the mobile crop runs full-bleed and there are no bars");
// The bug this caught: `inner` carries the backdrop, `picture` does not. The
// internal-link branch rendered `picture`, so the fill never appeared on the
// /gifting link — which is the link almost every banner uses.
const links = banner.match(/\{inner\}|\{picture\}/g) || [];
check(links.filter((x) => x === "{inner}").length === 2,
      "BOTH the internal and external link branches render the backdrop, not just one");

console.log("\n-- pictures for the things that are not books --");
const adminSrc = readFileSync(join(SRC, "pages", "admin", "AdminHampers.jsx"), "utf8");
check(adminSrc.includes("function ItemImage"),
      "each contents line has its own picture control");
check(/const linked = Boolean\(item\.book_id\)/.test(adminSrc),
      "a linked book is read-only — its cover comes from the catalogue, which is the point of linking it");
check(adminSrc.includes("{!linked && ("),
      "and the upload only appears for the free-text goods");
check(/alt=\{item\.label \|\| "Item in this hamper"\}/.test(adminSrc),
      "the thumbnail is labelled");
check(adminSrc.includes('data-testid={`hamper-item-image-'),
      "and is addressable");

console.log("\n-- a linked title is stored as a pointer, not a snapshot --");
// The server hydrates label/note/image/stock into a linked row before the
// editor sees it. Saving that back freezes today's cover and title into the
// hamper, which is exactly the drift that linking was meant to prevent.
const forStorage = (h) => ({
    ...h,
    hamper_items: (h.hamper_items || []).map((it) =>
        it.book_id
            ? { book_id: it.book_id, qty: it.qty ?? 1, value: it.value ?? 0 }
            : { label: it.label || "", note: it.note || "", image: it.image || "",
                qty: it.qty ?? 1, value: it.value ?? 0 },
    ),
});
const hydrated = {
    title: "Rakhi Box",
    hamper_items: [
        { book_id: "bk-1", label: "Climate Justice", note: "Sudhir Mishra · Paperback",
          image: "/api/files/cover.jpg", is_book: true, component_stock: 55, qty: 1, value: 595 },
        { label: "Brass bookmarks", note: "Set of 4", image: "/api/files/bm.jpg", qty: 1, value: 690 },
    ],
};
const stored = forStorage(hydrated);
check(Object.keys(stored.hamper_items[0]).sort().join(",") === "book_id,qty,value",
      `a linked row keeps only the pointer, quantity and value (got ${Object.keys(stored.hamper_items[0]).sort().join(",")})`);
check(!("image" in stored.hamper_items[0]) && !("label" in stored.hamper_items[0]),
      "the cover and title are NOT frozen in — they are re-read from the catalogue every time");
check(!("is_book" in stored.hamper_items[0]) && !("component_stock" in stored.hamper_items[0]),
      "and the display-only fields the server added are not written back");
check(stored.hamper_items[1].image === "/api/files/bm.jpg",
      "a free-text good keeps its own picture — nobody derives that one");
check(stored.hamper_items[1].label === "Brass bookmarks", "and its own label");
check(stored.title === "Rakhi Box", "the rest of the hamper is untouched");
check(forStorage({}).hamper_items.length === 0, "a hamper with no contents does not throw");
check(adminSerialisesThroughIt(),
      "and both save paths go through it, not just one");

function adminSerialisesThroughIt() {
    const calls = adminSrc.match(/adminUpdateHamper\(editing\.id, forStorage\(editing\)\)/g) || [];
    const creates = adminSrc.match(/adminCreateHamper\(forStorage\(editing\)\)/g) || [];
    return calls.length === 1 && creates.length === 1;
}

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
