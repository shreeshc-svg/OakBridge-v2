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
const { portalFit, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH } =
    await import(pathToFileURL(join(SRC, "lib", "portalFit.js")).href);

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
const orbit = code(join(SRC, "components", "OrbitField.jsx"));
const app = code(join(SRC, "App.js"));
const header = code(join(SRC, "components", "Header.jsx"));
const adminNav = code(join(SRC, "pages", "admin", "AdminNavigation.jsx"));
const adminEbooks = code(join(SRC, "pages", "admin", "AdminEbooks.jsx"));
const pre = code(join(HERE, "prerender.js"));
const server = code(join(ROOT, "backend", "server.py"));
const catalog = code(join(SRC, "pages", "Catalog.jsx"));
/* Read raw, not through code(): the keyframes ARE the thing being measured and
   stripping comments out of CSS would also strip the rules. */
const css = readFileSync(join(SRC, "index.css"), "utf8");

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
/*
 * The on-site "Titles with an eBook" button was removed on request, so every
 * eBook call to action on this page now leaves for the eReader. That is a
 * deliberate choice, not an oversight — asserted here so it stays one, and so
 * that the tracking below stays the only thing standing between us and a
 * visitor we cannot follow.
 */
check(!page.includes("/books?ebook=true"),
      "the on-site filtered-catalogue button is gone, as asked");
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

/*
 * Every soft wash must finish inside the viewBox.
 *
 * SVG clips to the viewBox, and a radial gradient is only transparent at its
 * OWN outer edge — so a wash whose ellipse extends past the canvas gets sliced
 * part way down its falloff and leaves a dead straight line on the page. The
 * blue wash shipped that way: it ran to x=705 against a 660 canvas and cut at
 * about 5% opacity down the right-hand side, which is visible against white.
 * Arithmetic catches it; eyes did not, twice.
 */
/*
 * MEASURED AT THE BEAT'S PEAK, NOT AT REST.
 *
 * The heartbeat scales, and the first version of this check measured resting
 * geometry — so it passed while the portal's outer glow, 348 wide on a 700
 * canvas, reached 712 at the top of every pulse and was sliced flat. A straight
 * edge appeared and disappeared down the right-hand side once per beat, and the
 * arithmetic said everything was fine.
 *
 * The peak is read out of the keyframes rather than hardcoded, so retuning the
 * pulse retightens the margins automatically. Applied to every ellipse, not
 * just the animated ones: a static ellipse simply gets more clearance, which
 * is never the wrong answer.
 */
/* The peak of fgHeartbeat SPECIFICALLY — that is the keyframe `.fg-halo` runs.
   Taking the max scale across all keyframes picked up fgPing's 1.5, which
   belongs to three 4px dots in the cloud and has nothing to do with the washes. */
const beat = css.match(/@keyframes fgHeartbeat\s*\{([\s\S]*?)\n\}/)[1];
const PEAK = Math.max(...[...beat.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1])), 1);

/* Flattened first: one of these ellipses is written across several lines, and a
   single-line regex silently measured two of the three and reported success. */
const flat = (src) => src.replace(/\s+/g, " ");
const ellipses = (src) => {
    const f = flat(src);
    const cx = f.match(/const CX = (\d+);/);
    const cy = f.match(/const CY = (\d+);/);
    return [
        ...[...f.matchAll(/<ellipse cx="(\d+)" cy="(\d+)" rx="(\d+)" ry="(\d+)"/g)]
            .map((m) => m.slice(1).map(Number)),
        ...(cx && cy
            ? [
                  ...[...f.matchAll(/<ellipse cx=\{CX\} cy=\{CY\} rx="(\d+)" ry="(\d+)"/g)]
                      .map((m) => [Number(cx[1]), Number(cy[1]), Number(m[1]), Number(m[2])]),
                  ...[...f.matchAll(/rx: (\d+), ry: (\d+)/g)]
                      .map((m) => [Number(cx[1]), Number(cy[1]), Number(m[1]), Number(m[2])]),
              ]
            : []),
    ];
};
const clipped = (src, label) => {
    const [, w, h] = src.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
    return ellipses(src)
        .filter(([cx, cy, rx, ry]) =>
            cx - rx * PEAK < 0 || cx + rx * PEAK > w || cy - ry * PEAK < 0 || cy + ry * PEAK > h)
        .map(([cx, , rx]) => `${label} rx${rx} reaches ${Math.round(cx + rx * PEAK)} of ${w}`);
};
check(PEAK > 1 && PEAK < 1.2, `the heartbeat's own peak scale was read from its keyframe (${PEAK})`);
check(ellipses(svg).length === 3 && ellipses(orbit).length === 5,
      `every ellipse was measured — artwork ${ellipses(svg).length} of 3, portal ${ellipses(orbit).length} of 5`);
const clip = [...clipped(svg, "artwork"), ...clipped(orbit, "portal")];
check(clip.length === 0, `nothing is clipped at the top of a beat ${clip.join(" | ")}`);

console.log("\n-- the animation is composited, staggered and optional --");
check(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}?\.fg-halo[\s\S]{0,300}?animation: none/.test(css),
      "every animated class is switched off for prefers-reduced-motion — a looping drawing is not optional for someone who gets motion sick from it");
const drawings = `${svg}\n${cloud}\n${orbit}`;
for (const cls of ["fg-halo", "fg-letter", "fg-pixel", "fg-scrap", "fg-leaf", "fg-book",
                   "fg-line", "fg-orbit", "fg-rim", "fg-cloud", "fg-flow", "fg-ping"]) {
    check(css.includes(`.${cls} {`) && drawings.includes(`"${cls}"`),
          `${cls} is defined in CSS and used in one of the drawings`);
    check(new RegExp(`\\.${cls},?[\\s\\S]{0,600}?animation: none`).test(
              css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))),
          `${cls} is switched off under prefers-reduced-motion`);
}
/*
 * Only transform and opacity may be animated. Those two the browser composites
 * on its own; anything else re-runs layout or paint every frame, and there are
 * around fifty animated nodes in this drawing. On a mid-range Android that is
 * the difference between a graphic and a stutter.
 */
/* Scan INSIDE the keyframe bodies only. Scanning the whole block also picks up
   the `animation:` shorthand on the .fg-* rules, which is not an animated
   property and made this fail on its first run. */
const fgBlock = css.slice(css.indexOf("@keyframes fgHeartbeat"), css.indexOf("Buttons with McGraw"));
const animatedProps = [...fgBlock.matchAll(/@keyframes\s+fg\w+\s*\{([\s\S]*?)\n\}/g)]
    .flatMap((m) => [...m[1].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]));
/*
 * transform and opacity are free — the compositor handles them. stroke-dashoffset
 * is not, and is allowed in exactly two keyframes: it is the only way to make
 * light travel ALONG a path rather than move the path itself, and its paint cost
 * is bounded to three 1.5px ellipse rims and three hairline cloud connectors.
 * Six thin strokes, not the seventy-odd nodes the rest of these rules drive.
 */
const bad = [...new Set(animatedProps)].filter(
    (prop) => !["opacity", "transform", "stroke-dashoffset"].includes(prop));
check(bad.length === 0, `only opacity, transform and stroke-dashoffset are animated ${bad.join(", ")}`);
const dashFrames = [...fgBlock.matchAll(/@keyframes\s+(fg\w+)\s*\{([\s\S]*?)\n\}/g)]
    .filter((m) => m[2].includes("stroke-dashoffset")).map((m) => m[1]);
check(dashFrames.length <= 2,
      `stroke-dashoffset stays confined to the two rim/flow keyframes ${dashFrames.join(", ")}`);
/*
 * Nothing that moves may be filtered.
 *
 * A filtered region re-runs its filter on every frame. The glow used to be a
 * feGaussianBlur over six animated letters, which had the browser recomputing a
 * Gaussian across a 170x200 area sixty times a second. Replaced with a second
 * text pass at 1.3x and low opacity, which the compositor draws for free.
 */
const filtered = [...svg.matchAll(/<g[^>]*filter="url\(#[^)]+\)"[^>]*>/g)].map((m) => m[0]);
check(!filtered.some((g) => /className="fg-/.test(g)),
      `no animated group carries a filter ${filtered.filter((g) => /className="fg-/.test(g)).join(" ")}`);
check(!/feGaussianBlur/.test(svg),
      "and the blur is gone entirely — the only filter left is the drop shadow on the device, which does not move");
check(/transform-box: view-box/.test(css),
      "rotations use transform-box: view-box — without it transform-origin is measured from the element's own bounding box, so 'turn about the spine' becomes 'turn about the middle of this leaf'");
check(/delay: `\$\{\(-\(t \* 5\.2\)\)/.test(svg) || /-\(t \* 5\.2\)/.test(svg),
      "letters carry NEGATIVE animation delays, so the stream is already mid-flight on the first frame rather than firing as one burst on load");

console.log("\n-- the portal is decorative and stays out of the way --");
check(/aria-hidden="true"/.test(orbit) && /pointer-events-none/.test(orbit),
      "the portal is announced to nobody and catches no clicks — it is scenery, not content");
check(/left: -insetX, right: -insetX, top: -insetY, bottom: -insetY/.test(orbit),
      "the layer is held outside the artwork by insets passed IN, not by fixed Tailwind classes — the artwork width "
      + "is an admin setting, and a fixed class is right for exactly one width and wrong either side of it");
check(page.includes("portalFit(site?.eb_art_width)"),
      "and the page derives both the artwork width and those insets from one setting");
check(/<OrbitField className="hidden lg:block"/.test(page),
      "and it is desktop only: on a phone the artwork already fills the screen, so there are no margins for a portal to occupy");
check(page.indexOf("<OrbitField") < page.indexOf("<FormatSplitGraphic"),
      "painted before its siblings, so it sits behind them without needing a stacking context");
check(/md:grid-cols-2/.test(page) && page.indexOf("<FormatSplitGraphic") < page.indexOf("ebooks-browse-print"),
      "the two format lists sit BELOW the artwork rather than flanking it — which is what empties the margins the portal needs");
const orbitIds = [...orbit.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
/* Same arithmetic as the artwork's washes, on the portal's own canvas. The
   rims were enlarged to enclose both drawings, and an ellipse that runs past
   the viewBox is sliced flat — the exact defect the artwork already shipped
   once. */
const obH = Number(orbit.match(/viewBox="0 0 \d+ (\d+)"/)[1]);
const obRadii = [...orbit.matchAll(/rx: (\d+), ry: (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
check(obRadii.every(([rx, ry]) => rx === ry),
      `the rims are circles, not ellipses ${obRadii.map((r) => r.join("x")).join(" ")}`);

/*
 * DOES THE RIM ACTUALLY ENCLOSE THE ARTWORK?
 *
 * Twice it did not, and both times it looked plausible. An ellipse has to be
 * about √2 bigger than the rectangle it contains, and the artwork spans the
 * full width at the TOP of the stack, where an ellipse is narrowest — so
 * measured against real ink the e-reader's top corner sat at 1.24 and the book
 * cover's at 1.04, where 1.0 is the rim.
 *
 * This reproduces the layout arithmetic and measures the extreme INK points,
 * not bounding-box corners: nothing is drawn at the artwork's top-left corner,
 * so testing that would fail for no reason. Gaps are the page's own Tailwind
 * spacing; the assertion carries enough margin that a few pixels either way
 * cannot flip it.
 */
const num = (re, src) => Number(src.match(re)[1]);
const R = Math.max(...obRadii.map(([rx]) => rx));
const OB = num(/viewBox="0 0 (\d+) \d+"/, orbit);
const artVb = [num(/viewBox="0 0 (\d+) \d+"/, svg), num(/viewBox="0 0 \d+ (\d+)"/, svg)];
const cloudVb = [num(/viewBox="0 0 (\d+) \d+"/, cloud), num(/viewBox="0 0 \d+ (\d+)"/, cloud)];
const GAP = 48, TAGLINE = 150;                       // mt-12, then the cloud caption
const INK_ART = [[30, 150], [326, 150], [626, 78], [496, 78], [30, 358], [626, 366], [434, 86]];
const INK_CLOUD = [[202, 16], [150, 246], [450, 246]];

const encloses = (contentW) => {
    const { width: W, insetX: IX, insetY: IY } = portalFit(contentW);
    contentW = W;
    const artH = (contentW * artVb[1]) / artVb[0];
    const cloudH = (contentW * cloudVb[1]) / cloudVb[0];
    const stackH = artH + GAP + cloudH + TAGLINE;
    const boxW = contentW + 2 * IX, boxH = stackH + 2 * IY;
    const k = Math.min(boxW / OB, boxH / OB);        // preserveAspectRatio meet, square canvas
    const cx = (boxW - OB * k) / 2 + (OB / 2) * k - IX;
    const cy = (boxH - OB * k) / 2 + (OB / 2) * k - IY;
    const r = R * k;
    const aS = contentW / artVb[0], cS = contentW / cloudVb[0], cTop = artH + GAP;
    const pts = [
        ...INK_ART.map(([x, y]) => [x * aS, y * aS]),
        ...INK_CLOUD.map(([x, y]) => [x * cS, cTop + y * cS]),
    ];
    return Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy) / r));
};
/* Across the WHOLE range an admin can choose, not just the shipped default.
   Insets proportional to the width fail at the small end, because the caption
   under the cloud is a fixed number of lines and does not shrink with the
   drawings — the stack gets relatively taller as it narrows. */
const widths = [MIN_WIDTH, 400, 500, DEFAULT_WIDTH, 800, MAX_WIDTH];
const fits = widths.map((w) => ({ w, v: encloses(w) }));
check(fits.every((f) => f.v <= 0.95),
      `the rim encloses both drawings at every width an admin can set — ${fits.map((f) => `${f.w}:${f.v.toFixed(2)}`).join(" ")}`);
check(portalFit("").width === DEFAULT_WIDTH && portalFit("nonsense").width === DEFAULT_WIDTH,
      "a blank or unparseable width falls back to the design width — a zero here would collapse the artwork, not merely mis-size the ring");
check(portalFit(50).width === MIN_WIDTH && portalFit(99999).width === MAX_WIDTH,
      `and it is clamped to ${MIN_WIDTH}-${MAX_WIDTH}px, so no entry can shrink it to nothing or overflow the page`);

check(orbitIds.every((id) => id.startsWith("fg-")),
      `its gradient ids are prefixed too ${orbitIds.join(", ")} — three SVGs share this page`);

console.log("\n-- motion is admin-controlled --");
for (const key of ["eb_anim_enabled", "eb_portal_enabled", "eb_anim_beat", "eb_anim_flight"]) {
    check(typeof DEFAULTS[key] === "string" && DEFAULTS[key].length > 0, `${key} has a default`);
    check(adminEbooks.includes(`"${key}"`), `${key} is editable in Admin -> E-Books`);
}
check(/const cls = \(name\) => \(animate \? name : undefined\)/.test(svg)
      && /const cls = \(name\) => \(animate \? name : undefined\)/.test(cloud),
      "with motion off the markup carries no animated class at all, rather than the keyframes being blanked — nothing to compute, and nothing a later stylesheet can reanimate by accident");
check(/Number\.isFinite\(n\) && n > 0 \? n : fallback/.test(page),
      "a blank or nonsense duration falls back to the design value, not to 0s, which would freeze every drawing on its first keyframe");
check(/"--fg-beat"/.test(page) && /"--fg-flight"/.test(page) && /var\(--fg-beat, 2\.6s\)/.test(css),
      "the rhythm reaches the CSS through custom properties, with the design values as the fallback");

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
/* Two files, not one: the portal is part of the same illustration and shares
   its blue deliberately. Everything else on the site must still be without it. */
const ART_FILES = ["FormatSplitGraphic.jsx", "OrbitField.jsx"];
const leaked = walk(SRC)
    .filter((f) => !ART_FILES.some((a) => f.endsWith(a)))
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
check(/<CloudSyncGraphic animate=\{animate\} \/>/.test(page), "the page renders it, and hands it the motion switch");
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
