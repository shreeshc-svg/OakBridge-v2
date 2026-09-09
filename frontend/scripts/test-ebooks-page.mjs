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
import { readFileSync, readdirSync } from "node:fs";
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
const cloud = code(join(SRC, "components", "CloudSyncGraphic.jsx"));
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
                   "eb_print_title", "eb_ebook_title", "eb_cta_headline",
                   "eb_cloud_kicker", "eb_cloud_tagline", "eb_cloud_body",
                   "eb_art_title", "eb_art_author", "eb_art_chapter", "eb_art_pages"]) {
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
check(/viewBox="0 0 660 420"/.test(svg),
      "a fixed viewBox gives the browser the aspect ratio before anything loads");
check(!/<image|xlink:href|url\(['"]?https?:/.test(svg),
      "nothing is fetched — no raster, no external reference, so there is no late-arriving asset to reflow around");
check(/role="img"/.test(svg) && /aria-label=/.test(svg),
      "and it is announced to a screen reader as one picture rather than read out as forty rectangles");

console.log("\n-- the rich treatment is scoped to this one drawing --");
/*
 * This is the ONLY illustration on the site allowed gradients, a drop shadow
 * and a glow, because it is the only one asked to sell rather than to explain.
 * The assertion that matters is not that it has them — it is that nothing else
 * grew them by copy-paste, which is how a flat design language dies.
 */
check(/linearGradient/.test(svg) && /feDropShadow/.test(svg),
      "it has the depth it was redrawn to have");
check(!/linearGradient|radialGradient|feDropShadow|feGaussianBlur/.test(cloud),
      "and the cloud panel beside it is still flat, so the exception stayed an exception");
const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
check(ids.length > 0 && ids.every((id) => id.startsWith("fg-")),
      `every gradient and filter id is prefixed ${ids.join(", ")} — SVG ids are global to the document and this `
      + "drawing shares a page with another one, so an unprefixed 'glow' would be a silent cross-wire");
/*
 * Every hex in both drawings has to already exist in the site's palette.
 *
 * Listing the colours that MUST appear was the weaker test and it broke for the
 * right reason the moment the drawing was redrawn without crimson in it. What
 * actually matters is the opposite: that nobody introduces a colour the rest of
 * the site has never used. index.css defines the first six; #001F42 is the navy
 * button-hover shade and #0A7D55 is the eBook green already used on the book
 * page.
 */
const PALETTE = new Set([
    "#002B5C", "#001F42", "#CC0033", "#F59E0B",
    "#E5E7EB", "#F5F7FA", "#FFFFFF", "#0A7D55",
    // Navy shading stops. Same hue, lit and shadowed.
    "#0A3A6E", "#00142E", "#123F6B", "#00152F", "#EAF0F7",
]);

/*
 * Two colour families that exist ONLY in the illustration, and deliberately.
 *
 * Paper cream, because pure white paper read as a UI mockup rather than a book.
 * And a cool blue for the digital side, because the transformation needs a
 * colour the printed side does not have. Both are genuinely new to the site, so
 * the assertion that matters is not that they are allowed — it is that they are
 * CONFINED. A cream that leaks into a card background or a blue that leaks into
 * a button is how a two-colour brand quietly becomes a five-colour one.
 */
const ART_ONLY = new Set([
    "#FBF6EC", "#F6EFE1", "#E6DCC8", "#FFFDF8", "#E7DCC7",
    "#DCD0B8", "#CFC4AC", "#9C8E74", "#8B7C60",
    "#2F6FB5",
]);

const strayHex = (src, extra = null) =>
    [...new Set(src.match(/#[0-9A-Fa-f]{6}/g) || [])]
        .filter((h) => !PALETTE.has(h.toUpperCase()) && !(extra && extra.has(h.toUpperCase())));

check(/#002B5C/.test(svg) && /#F59E0B/.test(svg), "drawn in navy and gold, like the rest of the site");
check(strayHex(svg, ART_ONLY).length === 0,
      `no colour outside the brand palette plus the two illustration-only families ${strayHex(svg, ART_ONLY).join(", ")}`);

/* The containment check. Walk every source file and make sure the cream and the
   blue appear in exactly one of them. */
const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const full = join(dir, d.name);
        return d.isDirectory() ? walk(full) : /\.(jsx?|css)$/.test(d.name) ? [full] : [];
    });
const leaked = walk(SRC)
    .filter((f) => !f.endsWith("FormatSplitGraphic.jsx"))
    .flatMap((f) => {
        const hits = [...new Set(readFileSync(f, "utf8").match(/#[0-9A-Fa-f]{6}/g) || [])]
            .filter((h) => ART_ONLY.has(h.toUpperCase()));
        return hits.length ? [`${f.split(/[\\/]/).pop()}: ${hits.join(",")}`] : [];
    });
check(leaked.length === 0,
      `the cream and the blue stay inside the illustration ${leaked.join(" | ")}`);

console.log("\n-- and neither can the cloud panel --");
check(/viewBox="0 0 560 262"/.test(cloud), "the cloud graphic has a fixed viewBox too");
check(!/<image|xlink:href|linearGradient|feDropShadow/.test(cloud),
      "no fetched asset, no gradient, no shadow — same rules as the drawing above it");
check(/role="img"/.test(cloud) && /aria-label=/.test(cloud), "and one aria-label rather than thirty silent rectangles");
check(page.includes("<CloudSyncGraphic />"), "the page renders it");
check(cloud.includes("DEVICES") && /cx=\{d\.cx\}/.test(cloud),
      "the connector end points and the devices come from one list, so a nudge cannot leave a line pointing at nothing");
check(strayHex(cloud).length === 0, `and no stray colour in it either ${strayHex(cloud).join(", ")}`);

console.log("\n-- the drawing says one book, not two --");
check((svg.match(/lines\.map/g) || []).length === 2 && /Ornament/.test(svg),
      "the title and its ornament are set on the page AND on the screen from the same value — one book arriving, not two books side by side");
check(/const total = Math\.max\(1, parseInt\(pages/.test(svg) && /const pct = Math\.round\(\(at \/ total\)/.test(svg),
      "reading position, extent and percentage all derive from the page count, so the three can never contradict each other on screen");
check(/function titleLines\(title\)/.test(svg),
      "a long title is split into two balanced lines rather than shrunk until it is unreadable");
check(!/Climate Justice/.test(svg.replace(/title = "[^"]*"/, "")),
      "the featured book is not hardcoded anywhere except the prop default — a title baked into an illustration is a product claim");
check(/const pagePath = \(outer, dir\)/.test(svg) && /TOP_GUT/.test(svg) && /BOT_GUT/.test(svg),
      "both pages, the cover board, the block edges and every line of body text derive from the same four numbers, "
      + "so the book opens wider or flatter by changing a constant rather than by redrawing nine paths that must agree");
check(/fg-gut"/.test(svg),
      "and there is a gutter shadow — nothing says 'open book' faster, and nothing else in the drawing needs one");
check(/SCRAPS = /.test(svg),
      "torn page scraps travel with the letters; without them the flight reads as a font specimen rather than a book coming apart");
check(/t < 0\.36 \? GOLD : t > 0\.64 \? BLUE/.test(svg),
      "the colour STEPS from warm to cool rather than blending — interpolating gold to blue passes through a desaturated olive and the middle of the stream turns to mud");
check(/9:41/.test(svg),
      "the device has a status bar, which costs six rectangles and buys most of the realism in it");

console.log("\n-- it is letters that move, not shapes --");
check(/GLYPHS = \[/.test(svg) && /"§"/.test(svg) && /"¶"/.test(svg),
      "real letterforms cross the gap, section and pilcrow among them — the marks a statute page is actually made of");
check(/LETTERS = GLYPHS\.map/.test(svg),
      "the flight is arithmetic, so it retunes by changing a number rather than by nudging sixteen glyphs");
/* Matched on shape, not on the constant. Pinning the exact number meant this
   failed the moment the flight was retuned — a test breaking for a non-reason,
   which teaches you to ignore it. What matters is that the spread still shrinks
   as t grows. */
check(/spread = \d+ \* \(1 - t \* 0\.\d+\)/.test(svg),
      "and they converge as they travel, which is what makes the stream read as going somewhere");
check(/font-?[Ff]amily/.test(svg),
      "the type is set in the site's own face — SVG does not inherit the page's font stack the way a block element does");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
