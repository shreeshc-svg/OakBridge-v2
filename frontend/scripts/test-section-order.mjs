/**
 * Where a NEW section lands on a page that already has a saved order.
 *
 *     node frontend/scripts/test-section-order.mjs
 *
 * Written after the gifting banner was added second in the homepage defaults
 * and rendered dead last on the live site. The saved home_section_order was
 * written before the banner existed, so the banner was not in it, and the
 * resolver appended everything it did not recognise to the end — the least
 * prominent slot on the page, and never the one intended.
 *
 * This is not banner-specific: it applies to every page with a saved order, so
 * it is worth a test of its own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTIONS = join(HERE, "..", "src", "lib", "sections.js");
const { resolveSectionOrder, SECTION_REGISTRY } = await import(pathToFileURL(SECTIONS).href);

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL "), label);
    if (!cond) failed++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The real homepage defaults and the order that was actually saved in settings
// before the banner existed.
const DEFAULTS = ["businesses", "gifting_banner", "imprints", "hot_off_press",
                  "solutions", "bestsellers", "testimonials", "manifesto"];
const SAVED_BEFORE = ["businesses", "imprints", "hot_off_press", "solutions",
                      "bestsellers", "testimonials", "manifesto"];

console.log("-- a section added after the order was saved --");
const out = resolveSectionOrder(DEFAULTS, SAVED_BEFORE);
check(out.indexOf("gifting_banner") === 1,
      `lands where the defaults say — after businesses, not at the end (got index ${out.indexOf("gifting_banner")})`);
check(out.length === DEFAULTS.length, "every section appears exactly once");
check(new Set(out).size === out.length, "and none is duplicated");
check(eq(out.filter((k) => k !== "gifting_banner"), SAVED_BEFORE),
      "the admin's own arrangement of the sections they knew about is untouched");

console.log("\n-- the admin's order still wins --");
const REORDERED = ["manifesto", "businesses", "imprints", "hot_off_press",
                   "solutions", "bestsellers", "testimonials"];
const out2 = resolveSectionOrder(DEFAULTS, REORDERED);
check(out2[0] === "manifesto", "a section they moved to the top stays at the top");
check(out2.indexOf("gifting_banner") === out2.indexOf("businesses") + 1,
      "the new one follows the neighbour it follows in the defaults, wherever that neighbour now is");

console.log("\n-- once they place it themselves --");
const PLACED = ["gifting_banner", "businesses", "imprints", "hot_off_press",
                "solutions", "bestsellers", "testimonials", "manifesto"];
check(eq(resolveSectionOrder(DEFAULTS, PLACED), PLACED),
      "a saved order containing every section is returned exactly as saved");

console.log("\n-- the ordinary cases --");
check(eq(resolveSectionOrder(DEFAULTS, null), DEFAULTS), "no saved order at all -> the defaults");
check(eq(resolveSectionOrder(DEFAULTS, []), DEFAULTS), "an empty saved order -> the defaults");
check(eq(resolveSectionOrder(DEFAULTS, "nonsense"), DEFAULTS), "a corrupt value -> the defaults");
check(!resolveSectionOrder(DEFAULTS, [...SAVED_BEFORE, "deleted_section"]).includes("deleted_section"),
      "a section removed from the code drops out of a stale saved order");

console.log("\n-- two new sections at once --");
const D3 = ["a", "b", "c", "d"];
check(eq(resolveSectionOrder(D3, ["a", "d"]), ["a", "b", "c", "d"]),
      "both are placed relative to the neighbours that survived");
check(eq(resolveSectionOrder(D3, ["d", "a"]), ["d", "a", "b", "c"]),
      "and follow their predecessor even when the saved order is reversed");
check(eq(resolveSectionOrder(["x", "y"], []), ["x", "y"]), "a page with no saved order is unaffected");

console.log("\n-- flagship keys still expand --");
check(resolveSectionOrder(["p", "q"], ["flagship", "p"], ["p"]).length > 0,
      "the flagship expansion path does not throw");

console.log("\n-- the banner is visible in Admin → Pages --");
const home = SECTION_REGISTRY.find((s) => s.slug === "home");
check(Boolean(home), "the homepage is registered");
check(home.items.some((i) => i.key === "home.gifting_banner"),
      "and the banner is one of its sections — without this it cannot be dragged or hidden at all");
const registered = new Set(home.items.map((i) => i.key.replace("home.", "")));
const unregistered = DEFAULTS.filter((k) => !registered.has(k));
check(unregistered.length === 0,
      `every ordered homepage section is registered ${unregistered.length ? unregistered.join(", ") : ""}`);

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
