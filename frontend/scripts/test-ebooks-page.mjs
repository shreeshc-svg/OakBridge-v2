/**
 * The /ebooks page and its header nav entry.
 *
 *     node frontend/scripts/test-ebooks-page.mjs
 *
 * A new customer-facing route has to be registered in five separate places, and
 * four of the five fail silently. Miss the prerenderer and crawlers get the
 * empty shell. Miss the backend sitemap list and the page is never volunteered
 * to Google — which is exactly how /solutions, /careers, /media and
 * /cookie-policy all shipped live and invisible. Miss the header and nobody
 * finds it at all.
 *
 * sanity-check's route-parity check catches the prerender/sitemap pair. Nothing
 * catches the rest, so it is caught here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(HERE, "..", "src");

const DEFAULTS = (await import(pathToFileURL(join(SRC, "lib", "contentDefaults.js")).href)).default;

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

/* Comments stripped: every file below explains this feature in prose that
   quotes the very strings being matched. Four assertions in this suite's
   history have passed against a comment. */
const code = (abs) =>
    readFileSync(abs, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .split("\n")
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("*");
        })
        .join("\n");

const page = code(join(SRC, "pages", "Ebooks.jsx"));
const svg = code(join(SRC, "components", "FormatSplitGraphic.jsx"));
const app = code(join(SRC, "App.js"));
const header = code(join(SRC, "components", "Header.jsx"));
const adminNav = code(join(SRC, "pages", "admin", "AdminNavigation.jsx"));
const adminEbooks = code(join(SRC, "pages", "admin", "AdminEbooks.jsx"));
const pre = code(join(HERE, "prerender.js"));
const server = code(join(ROOT, "backend", "server.py"));
const catalog = code(join(SRC, "pages", "Catalog.jsx"));

console.log("-- the route is registered everywhere it has to be --");
check(/path="\/ebooks" element=\{<Ebooks \/>\}/.test(app), "App.js declares the route");
check(/import Ebooks from "@\/pages\/Ebooks"/.test(app), "and imports the page");
check(/"\/ebooks"/.test(pre), "prerender.js will render it, so crawlers get HTML and not the empty shell");
check(/"\/ebooks"/.test(server), "backend sitemap lists it, so Google is told it exists rather than having to stumble on it");
check(page.includes('path="/ebooks"'),
      "the canonical matches the route — sanity-check fails the build if a <Seo path> has no matching route");
check(page.includes("<Seo"), "and the page has a Seo block at all, which every route needs to pass checkRouteTitles");

console.log("\n-- it is reachable from the header --");
check(/\{ to: "\/ebooks", label: "eBooks" \}/.test(header),
      "DEFAULT_NAV carries an eBooks row, so an install with no saved menu shows it");
check(/\{ to: "\/ebooks", label: "eBooks", hidden: false \}/.test(adminNav),
      "and Admin -> Navigation offers the same row — a site WITH a saved menu replaces DEFAULT_NAV wholesale, "
      + "so the link has to exist on both sides or it never appears");
check(header.indexOf('"/ebooks"') > header.indexOf('"/books"'),
      "it sits after the Bookstore, since it is the same shelf in another format");

console.log("\n-- it honours the one eBook switch --");
check(page.includes('String(site?.ebook_enabled ?? "on").toLowerCase() !== "off"'),
      "read exactly the way every other eBook surface reads it, character for character");
check(catalog.includes('String(site?.ebook_enabled ?? "on").toLowerCase() !== "off"'),
      "the same literal the bookstore uses — one switch, not two implementations of one switch");
check(/canGoToReader \?/.test(page) && page.includes("ebooks-reader-off"),
      "with the switch off it says so instead of rendering a button that goes nowhere");
check(page.includes('site?.ebook_url ?? EREADER_FALLBACK'),
      "and the destination comes from ebook_url, so it moves without a deploy");

console.log("\n-- it claims no discount it cannot back --");
/* CSS carries percentages that are not claims — gradient stops, widths,
   opacities. Strip the style values first, then look at what is left, which is
   prose. Without this the hero's radial-gradient stop positions read as a "20%
   off" claim, which is how this assertion failed on its first run. */
const prose = page
    .replace(/radial-gradient\([^)]*\)/g, "")
    .replace(/\b\d+(\.\d+)?%\s*[,)]/g, "");
const nums = prose.match(/\b\d{1,2}%/g) || [];
check(nums.length === 0,
      `no discount percentage in the copy ${nums.join(", ")} — there is no discount arithmetic anywhere in this `
      + "codebase, the print badge is derived per title from original_price and ebook_price is uploaded absolutely, "
      + "so a number written here would be a promise the code cannot keep");
check(page.includes("/books?ebook=true"),
      "the soft CTA goes to the real filtered catalogue, which reads ebook=true straight off the query string");
check(catalog.includes('sp.get(EBOOK_FILTER_KEY) === "true"'),
      "and the bookstore genuinely honours that parameter, so the link is not aspirational");
check(page.includes("ebook_cta_clicked"),
      "leaving for the eReader is tracked, because that click is the last thing we can see before the visitor is on another site");

console.log("\n-- the copy is admin-editable --");
for (const key of ["eb_eyebrow", "eb_headline", "eb_accent", "eb_body",
                   "eb_print_title", "eb_ebook_title", "eb_cta_headline"]) {
    check(typeof DEFAULTS[key] === "string" && DEFAULTS[key].length > 0,
          `${key} has a default, so an unset key never renders blank`);
    check(adminEbooks.includes(`"${key}"`), `${key} is editable in Admin -> E-Books`);
}
check(adminEbooks.includes('collectionKey="page_eb_print"') && adminEbooks.includes('collectionKey="page_eb_ebook"'),
      "both bullet lists are editable collections");
check(page.includes('fetchCollection("page_eb_print")') && page.includes('fetchCollection("page_eb_ebook")'),
      "and the page reads those same two keys");
check(page.includes("resolveCollection("),
      "through resolveCollection, so a list an admin deliberately emptied stays empty instead of springing back to the defaults");

console.log("\n-- the graphic cannot shift the layout --");
check(/viewBox="0 0 560 400"/.test(svg),
      "a fixed viewBox gives the browser the aspect ratio before anything loads");
check(!/<image|xlink:href|url\(/.test(svg),
      "nothing is fetched — no raster, no external reference, so there is no late-arriving asset to reflow around");
check(/role="img"/.test(svg) && /aria-label=/.test(svg),
      "and it is announced to a screen reader as one picture rather than read out as forty rectangles");
check(!/linearGradient|filter=|feDropShadow/.test(svg),
      "flat fills only, matching TimelineRoad — the only other real illustration here");
check(/#002B5C/.test(svg) && /#CC0033/.test(svg) && /#F59E0B/.test(svg),
      "drawn in the brand palette rather than a new one");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
