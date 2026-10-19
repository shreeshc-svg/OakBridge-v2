/**
 * "Available on" store strip + per-book store links.
 *
 *     node frontend/scripts/test-store-strip.mjs
 *
 * Behaviour (sections.js, imported) plus wiring checks on the files that can't
 * run outside the browser. The wiring checks read code, not comments, so they
 * strip comments first — otherwise a comment describing the rule would pass
 * the test on its own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const { resolveSectionOrder, SECTION_REGISTRY, HOME_DEFAULT_ORDER } = await import(
    pathToFileURL(join(SRC, "lib", "sections.js")).href
);

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL ") + label);
    if (!cond) failed += 1;
};
const code = (p) =>
    readFileSync(join(SRC, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

console.log("-- homepage section --");
const allKeys = JSON.stringify(SECTION_REGISTRY);
check(allKeys.includes('"home.stores"'), "registered as a homepage section (orderable + hideable)");
check(HOME_DEFAULT_ORDER.indexOf("stores") === HOME_DEFAULT_ORDER.indexOf("hero_carousel") + 1, "defaults to right under the hero");
// A site whose order was saved before the strip existed: it must land under
// the hero, not at the bottom of the page.
const saved = HOME_DEFAULT_ORDER.filter((k) => k !== "stores");
const resolved = resolveSectionOrder(HOME_DEFAULT_ORDER, saved);
check(resolved.indexOf("stores") === resolved.indexOf("hero_carousel") + 1, "existing saved order -> inserted under the hero");

console.log("-- storefront --");
const strip = code("components/StoreStrip.jsx");
check(!/<a\b|href=/.test(strip), "strip is logos only (no links)");
check(/s\.logo/.test(strip) && /alt=/.test(strip) && /aria-hidden/.test(strip), "only stores with a logo; alt text; duplicate copy hidden from screen readers");
check(/prefers-reduced-motion/.test(strip), "still row under reduced motion");
// Live bug 2026-10-19: the marquee's duplicate logos were baked into the
// prerender (8 items) while the browser's first render had 4 -> #418.
check((strip.match(/if \(isPrerender\(\)\) return undefined/g) || []).length >= 2,
      "no markup-changing effect runs during the prerender (marquee + reveal)");
const homeJsx = code("pages/Home.jsx");
check(/hidden\.has\("home\.stores"\)/.test(homeJsx) && /homeOrd\("stores"\)/.test(homeJsx), "Home hides/orders it like other sections");
const pdp = code("pages/BookDetail.jsx");
check(/store_links/.test(pdp) && /target="_blank"/.test(pdp) && /rel="noopener noreferrer"/.test(pdp), "book page: links open in a new tab with noopener");
check(/links\[st\.id\]/.test(pdp), "book page: only stores this book has a link for");

console.log("-- admin --");
const ed = code("components/admin/StoresEditor.jsx");
check(/adminSaveCollection\("home_stores"/.test(ed), "editor saves the home_stores collection");
check(/adminImportStoreLinks\(file, dryRun\)/.test(ed) && /runImport\(e\.target\.files\?\.\[0\], true\)/.test(ed), "bulk import previews (dry run) before saving");
check(/dup/.test(ed) && /id\.length < 2/.test(ed), "blank and duplicate store ids refused");
// The slug rule itself is checked against the backend in
// backend/tests/test_store_links.py; here only that the editor applies it.
check(/id: slugStoreId\(it\.id \|\| it\.name\)/.test(ed), "editor slugs ids on save (same [a-z0-9-] rule as the backend)");
const books = code("pages/admin/AdminBooks.jsx");
check(/store_links: Object\.fromEntries/.test(books), "book form sends store_links (filled boxes only)");
check(code("pages/admin/AdminPages.jsx").includes("<StoresEditor />"), "editor mounted in Admin → Pages");
check(/adminImportStoreLinks/.test(code("lib/api.js")) && /store-links\/import\?dry_run=/.test(code("lib/api.js")), "api.js import helper");

console.log();
if (failed) {
    console.log(`${failed} check(s) failed`);
    process.exit(1);
}
console.log("all checks passed");
