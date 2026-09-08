/**
 * Where a NEW section lands on a page that already has a saved order, and
 * whether the admin panel agrees with the live page about it.
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
 *
 * Extended in September 2026 for the hero banner carousel, which exposed the
 * other half of the same bug: the resolver placed a new section correctly on
 * the storefront, but the ADMIN panel had its own sort that pushed unknown keys
 * to the bottom. The panel therefore showed an order the site did not use, and
 * the first Save wrote that wrong order back over the right one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const SECTIONS = join(SRC, "lib", "sections.js");
const { resolveSectionOrder, SECTION_REGISTRY, HOME_DEFAULT_ORDER } = await import(
    pathToFileURL(SECTIONS).href
);

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL "), label);
    if (!cond) failed++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/*
 * Scan CODE, never prose.
 *
 * Four separate assertions in this suite's history passed because they matched
 * an explanatory comment that happened to quote the very string being looked
 * for. The files below are heavily commented, and those comments name
 * `hero_carousel`, `-3` and `resolveSectionOrder` repeatedly. Strip them first
 * or the test proves only that the comment is still there.
 */
const code = (file) =>
    readFileSync(join(SRC, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("*");
        })
        .join("\n");

const home = code(join("pages", "Home.jsx"));
const adminPages = code(join("pages", "admin", "AdminPages.jsx"));
const carousel = code(join("components", "HeroCarousel.jsx"));

// A frozen snapshot of the homepage defaults as they stood when the gifting
// banner shipped. Deliberately NOT the live HOME_DEFAULT_ORDER: these cases
// describe that specific historical episode, and pinning them means adding a
// section to the real list never silently changes what they assert.
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

console.log("\n-- registry and page order agree, in both directions --");
const homeGroup = SECTION_REGISTRY.find((s) => s.slug === "home");
check(Boolean(homeGroup), "the homepage is registered");
check(homeGroup.items.some((i) => i.key === "home.gifting_banner"),
      "the gift hamper banner is one of its sections — without this it cannot be dragged or hidden at all");
check(homeGroup.items.some((i) => i.key === "home.hero_carousel"),
      "and so is the hero banner carousel");

// The real list, not a hand-copied one. HOME_DEFAULT_ORDER used to live in
// Home.jsx with a duplicate pasted into this file, so this parity check was
// comparing the registry against a copy of itself and would not have noticed
// the two drifting apart. They HAD drifted: the registry led with the gifting
// banner while the page led with Our Businesses.
const registered = homeGroup.items.map((i) => i.key.replace("home.", ""));
const unregistered = HOME_DEFAULT_ORDER.filter((k) => !registered.includes(k));
const unordered = registered.filter((k) => !HOME_DEFAULT_ORDER.includes(k));
check(unregistered.length === 0,
      `every ordered homepage section is registered ${unregistered.join(", ")}`);
check(unordered.length === 0,
      `and every registered homepage section is ordered ${unordered.join(", ")}`);
check(eq(registered, [...HOME_DEFAULT_ORDER]),
      "in the SAME order — the panel shows the registry, the site uses the defaults, so a mismatch is the panel lying about the live page");
check(HOME_DEFAULT_ORDER[0] === "hero_carousel",
      "the carousel is first by default, which is what puts it above the hero");

console.log("\n-- the carousel is the one section that can outrank the hero --");
check(/homeOrder\[0\]\s*===\s*"hero_carousel"\s*\?\s*-3\s*:/.test(home),
      "first in the order renders at -3, ahead of the hamper banner's -2 and the hero's -1");
check(home.includes('homeOrd("hero_carousel")'),
      "dragged anywhere else it uses its ordinary index and sits below the hero like every other section");
check(home.includes('hidden.has("home.hero_carousel")'),
      "and the eye toggle in the visibility panel actually hides it");
check(/order:\s*-1/.test(home) && /order:\s*heroCarouselOrd/.test(home),
      "the hero is still pinned at -1 — the carousel clears it rather than replacing it");

console.log("\n-- it renders nothing until there is something to show --");
check(home.includes('fetchCollection("home_hero_slides")'),
      "slides come from the home_hero_slides collection");
check(/enabled\s*!==\s*false\s*&&\s*s\.image/.test(home),
      "a disabled slide, or one whose image was never uploaded, is dropped rather than shown as an empty frame");
check(/heroSlides\.length\s*>\s*0/.test(home),
      "and with no slides at all the section does not render, so the page is unchanged until the team uploads one");
check(home.includes("!showHeroCarousel"),
      "the hero image drops to normal fetch priority when the carousel is above it, so two images do not both claim to be the LCP");

console.log("\n-- the admin panel orders rows the same way the page does --");
check(adminPages.includes("resolveSectionOrder("),
      "SectionVisibility uses the storefront resolver rather than a second sort of its own");
check(!/if\s*\(ia\s*===\s*-1\)\s*return\s*1;/.test(adminPages),
      "the old 'unknown keys sort to the bottom' branch is gone — it is what demoted a new section on first Save");
check(adminPages.includes('collectionKey="home_hero_slides"'),
      "and the homepage group has the banner editor wired to the same collection the page reads");
check(adminPages.includes('key: "image_mobile"') && adminPages.includes('key: "link"'),
      "with a phone image and a link target per banner");

console.log("\n-- the carousel cannot desync from prerendered HTML --");
check(/useState\(0\)/.test(carousel),
      "the first slide index is a constant, so the first client render matches the prerendered markup");
check(!/Date\.now\(\)|Math\.random\(\)/.test(carousel),
      "nothing time- or random-derived decides what is rendered, which is how React #418 starts");
check(/setInterval/.test(carousel) && /clearInterval/.test(carousel),
      "autoplay is started and cleaned up inside an effect, never during render");
check(/prefers-reduced-motion/.test(carousel),
      "and it holds still for anyone who asked their device to reduce motion");
check(/alt=\{slide\.alt \|\| ""\}/.test(carousel), "every slide image carries an alt attribute");
check(/media="\(max-width: 767px\)"/.test(carousel),
      "the optional phone image wins below 768px");
check(/h-\[300px\] sm:h-\[420px\] lg:h-\[520px\]/.test(carousel),
      "the frame has a fixed height at every breakpoint — uploaded banners have no intrinsic size, so this is the only thing standing between a late image and a CLS report");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
