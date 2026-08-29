/**
 * The "Available as eBook" shelf filter.
 *
 *     node frontend/scripts/test-ebook-filter.mjs
 *
 * Two things can go quietly wrong here. The filter can outlive the master
 * switch, so a shelf offers eBooks on a site where eBooks are off. And a card
 * in that shelf can point off-site when it should not, or on-site when the
 * whole point was to go off — which is a lost sale either way, and invisible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const catalog = readFileSync(join(SRC, "pages", "Catalog.jsx"), "utf8");
const card = readFileSync(join(SRC, "components", "BookCard.jsx"), "utf8");
const server = readFileSync(join(HERE, "..", "..", "backend", "server.py"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL "), label);
    if (!cond) failed++;
};

console.log("-- the master switch governs it --");
const ebooksOn = (site) => String(site?.ebook_enabled ?? "on").toLowerCase() !== "off";
check(ebooksOn({}) === true, "unset behaves as on, like every other eBook surface");
check(ebooksOn({ ebook_enabled: "off" }) === false, "'off' switches it off");
check(ebooksOn({ ebook_enabled: "OFF" }) === false, "case does not matter");
check(ebooksOn({ ebook_enabled: "on" }) === true, "'on' switches it on");
check(catalog.includes('String(site?.ebook_enabled ?? "on").toLowerCase() !== "off"'),
      "and the page reads it exactly that way — one switch for the CTA, the product page and this");

console.log("\n-- switched off, it leaves no trace --");
check(catalog.includes('.filter((f) => f.key !== EBOOK_FILTER_KEY || ebooksOn(site))'),
      "the filter is removed from the list, not merely hidden in the markup");
// Removing it from the list is what also strips it from the request params and
// the active-filter chips, both of which are built by iterating that same list.
check(catalog.includes("enabledFilters.forEach"),
      "request params are built from that list, so a removed filter cannot be sent");

console.log("\n-- it is a filter, not a category --");
check(catalog.includes('{ key: "ebook", label: "Available as eBook"'),
      "it sits with Bestsellers and New Releases");
check(!/categories.*ebook/i.test(catalog.split("DEFAULT_FILTERS")[0]),
      "and not in the category list, where it would double-count titles that are also Law or Academic");

console.log("\n-- what the server matches on --");
check(server.includes('has_link = {"ebook_url": {"$nin": [None, ""]}}'),
      "the presence of an eReader LINK");
check(!/if ebook is not None:[\s\S]{0,400}"has_ebook"/.test(server),
      "not has_ebook, which means an attached PDF and is a different question entirely");
check(/clauses\.append\(has_link if ebook else \{"\$nor": \[has_link\]\}\)/.test(server),
      "and ebook=false is the inverse rather than being ignored");

console.log("\n-- where a card in that shelf goes --");
check(card.includes('const ebookExit = toEbook ? (book?.ebook_url || "").trim() : ""'),
      "off-site only when the shelf is filtered to eBooks AND the title has a link");
const exits = (toEbook, url) => (toEbook ? (url || "").trim() : "");
check(exits(true, "https://ebooks.oakbridge.in/x") !== "", "filtered + linked leaves the site");
check(exits(true, "") === "", "filtered but unlinked stays here — no anchor to nowhere");
check(exits(true, "   ") === "", "and whitespace is not a link");
check(exits(false, "https://ebooks.oakbridge.in/x") === "",
      "unfiltered stays here even when the title has an eBook — the customer did not ask for one");
check(card.includes('rel="noopener noreferrer"') && card.includes('target="_blank"'),
      "the exit opens in a new tab and carries noopener");
check(card.includes('track("ebook_cta_clicked"') && card.includes('variant: "card"'),
      "and is counted, because a sale that leaves this site will not show up in these orders");
check(catalog.includes('toEbook={sp.get(EBOOK_FILTER_KEY) === "true" && ebooksOn(site)}'),
      "the catalogue only sets the flag while the filter is actually on");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
