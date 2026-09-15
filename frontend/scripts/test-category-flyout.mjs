/**
 * The Bookstore category mega-menu.
 *
 *     node frontend/scripts/test-category-flyout.mjs
 *
 * This menu is a near-twin of the Gifting one, which is exactly what makes it
 * worth testing separately: the failure mode of a copied component is that it
 * copies the structure and loses one of the non-obvious fixes the original
 * earned. So the assertions below deliberately re-check the same hazards
 * test-gifting-flyout.mjs covers — header anchoring, the timers, Escape, the
 * tab-away close, the drawer still rendering a plain link — against the new
 * file rather than assuming they came along for the ride.
 *
 * Plus three hazards that belong to this menu alone:
 *
 *   two full-width panels open at once, stacked on the same pixels
 *   an empty category (Bespoke, 0 titles) advertising an empty results page
 *   a saved site_nav with no `flyout` field shipping the feature to nowhere
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const fly = readFileSync(join(SRC, "components", "CategoryFlyout.jsx"), "utf8");
const gift = readFileSync(join(SRC, "components", "GiftingFlyout.jsx"), "utf8");
const header = readFileSync(join(SRC, "components", "Header.jsx"), "utf8");
const adminNav = readFileSync(join(SRC, "pages", "admin", "AdminNavigation.jsx"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const panelBlock = fly.split("export function CategoryPanel").pop();
const drawerBlock = fly.split("export function CategoryDrawerSection").pop();

console.log("-- the panel is anchored to the header, not the nav word --");
check(/absolute left-0 right-0 top-full/.test(panelBlock),
      "the panel spans its containing block edge to edge");
check(/<CategoryPanel fly=\{cfly\} \/>/.test(header), "and is rendered by the Header");
const lines = header.split("\n");
const at = (needle) => lines.findIndex((l) => l.includes(needle));
const iPanel = at("<CategoryPanel fly={cfly} />");
const iNavClose = lines.findIndex((l, k) => l.includes("</nav>") && k < iPanel);
const iDrawer = at('<div className="lg:hidden border-t');
const iHeaderClose = at("</header>");
check(iPanel > iNavClose && iPanel < iDrawer && iPanel < iHeaderClose,
      `outside both navs but inside the header (nav closes ${iNavClose}, panel ${iPanel}, drawer ${iDrawer}, header ends ${iHeaderClose})`);

console.log("\n-- only one mega-panel can be open --");
/* Leaving one trigger arms a 180ms close; arriving at the other arms a 120ms
   open. Both panels are full-width boxes at top-full, so that overlap stacks
   them rather than placing them side by side. */
check(/if \(cfly\.open\) closeGifting\(\);/.test(header) && /if \(fly\.open\) closeCategories\(\);/.test(header),
      "opening either panel closes the other");
check(/const \{ close: closeGifting \} = fly;/.test(header)
      && /const \{ close: closeCategories \} = cfly;/.test(header),
      "through the destructured, stable close() — depending on the hook's return OBJECT would re-run "
      + "every render and cancel the other menu's pending open timer");
check(/\[cfly\.open, closeGifting\]/.test(header) && /\[fly\.open, closeCategories\]/.test(header),
      "and the effects depend on the open flag, not on the object");

console.log("\n-- it renders at all --");
check(/\{ to: "\/books", label: "Bookstore", flyout: "categories" \}/.test(header),
      "DEFAULT_NAV names the flyout, so a site with no saved menu still drops it");
check(/n\?\.flyout === "categories" \|\| n\?\.to === "\/books"/.test(header),
      "and the match accepts the conventional path too — every ALREADY-SAVED site_nav has a Bookstore "
      + "row with no flyout field, and a saved menu replaces the default wholesale");
check(/<CategoryTrigger key=\{n\.to\} label=\{n\.label\} to=\{n\.to\} fly=\{cfly\} \/>/.test(header),
      "the trigger is wired into the desktop nav");
check(/<CategoryDrawerSection/.test(header), "and the drawer section into the mobile one");

console.log("\n-- the admin control does not lie --");
check(/<option value="categories">Book categories<\/option>/.test(adminNav),
      "the category panel can be assigned to a different row");
check(/<option value="off">Force off<\/option>/.test(adminNav),
      "and there is a value that actually turns a panel off");
check(/const flyoutOff = \(n\) => n\?\.flyout === "off";/.test(header)
      && /!flyoutOff\(n\) &&/.test(header),
      "which the matchers honour — blank cannot mean off on /books or /gifting, because blank is what "
      + "every saved row already stores");
check(/flyout: it\.flyout \|\| ""/.test(adminNav),
      "and the save path still carries the field through rather than stripping it");

console.log("\n-- empty categories are not advertised --");
/* Bespoke publishes 0 titles. A row reading "Bespoke — 0" links to a results
   page with nothing on it. */
check(/Number\(c\.book_count\) > 0/.test(fly),
      "a category with no titles is dropped from the menu");
check(/\.sort\(\(a, b\) => \(a\.order \?\? 99\) - \(b\.order \?\? 99\)\)/.test(fly),
      "and the order is the admin's own, so the menu matches the category row on /books");
check(/hasPanel: categories\.length > 0/.test(fly),
      "no browsable categories means no panel — an empty dropdown is worse than none");
check(/if \(!fly\.hasPanel\) return null;/.test(panelBlock), "the panel itself renders nothing");
check(/data-testid="category-drawer-plain"/.test(fly),
      "but the MOBILE drawer still renders a plain link, so a phone never loses the bookstore");

console.log("\n-- links go somewhere real --");
check(/to=\{`\/books\?category=\$\{encodeURIComponent\(c\.id\)\}`\}/.test(fly),
      "categories link to the bookstore's own ?category= filter, encoded");
check((fly.match(/encodeURIComponent\(c\.id\)/g) || []).length === 2,
      "in the panel AND in the drawer — two links, both encoded");
check(/data-testid=\{`flyout-category-\$\{c\.id\}`\}/.test(fly), "each has a stable testid");
check(/data-testid="category-flyout-cta"/.test(fly), "and there is a browse-everything CTA");

console.log("\n-- the bestseller rail is decoration, not a dependency --");
/* Categories are what the menu is for. A combined Promise.all would have held
   the whole menu shut waiting on the part nobody came for. */
check(/let catInflight = null;/.test(fly) && /let bestInflight = null;/.test(fly),
      "the two loads are cached separately");
check(!/Promise\.all/.test(fly),
      "and are never awaited together, so a failing bestsellers call cannot keep the categories shut");
check(/fly\.bestsellers\.length > 0 && \(/.test(panelBlock),
      "the rail is omitted when empty rather than rendering a headed, blank column");
check(/catInflight = null; \/\/ a failed load can be retried/.test(fly),
      "a failed fetch can be retried rather than caching the failure forever");
check(/if \(catCache\) return Promise\.resolve\(catCache\)/.test(fly),
      "and a successful one is cached, so hovering does not hit the API each time");

console.log("\n-- covers --");
check(/src=\{mediaUrl\(img\)\}/.test(fly),
      "covers go through mediaUrl — a raw /api/files path resolves to the SPA shell on www");
check(/alt=\{b\.title\}/.test(fly), "and are labelled");
check(/object-contain/.test(fly) && !/object-cover/.test(fly),
      "contained, not cropped: a book cover cropped to fill loses the title off the top edge, which at "
      + "40px wide is the only part still doing any work");
check(/loading="lazy"/.test(fly), "and lazily loaded — the menu is not visible on arrival");

console.log("\n-- the fixes the Gifting menu earned came along --");
check(fly.includes('import { OPEN_MS, CLOSE_MS } from "./GiftingFlyout"'),
      "the timings are IMPORTED, not copied — two menus in one nav that open at different speeds "
      + "feel broken, and copied constants drift");
check(gift.includes("OPEN_MS = 120") && gift.includes("CLOSE_MS = 180"),
      "and the source of those numbers is still where the other test asserts it");
check(/onFocus=\{fly\.hasPanel \? fly\.wantOpen : undefined\}/.test(fly),
      "focus opens through wantOpen, which CLEARS a pending close — setOpen alone lets an armed timer snap it shut");
check(/onBlur=\{\(e\) => \{\s*if \(!e\.currentTarget\.contains\(e\.relatedTarget\)\) fly\.wantClose\(\);/.test(fly),
      "tabbing away closes it, rather than leaving a full-width panel over the page");
check(/e\.key === "Escape" && close\(\)/.test(fly), "Escape closes it");
check(/useEffect\(\(\) => \(\) => clear\(\), \[\]\)/.test(fly), "timers are cleared on unmount");
check(/transition-\[opacity,transform,visibility\]/.test(panelBlock),
      "visibility is transitioned, or the close animation never plays");
check(/hidden lg:block absolute/.test(panelBlock),
      "and the whole panel does not exist below lg, where the burger takes over");
check(/px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40/.test(panelBlock),
      "panel padding matches the header's, so the first category lines up with the nav above it");

console.log("\n-- mobile --");
check(/data-testid="category-drawer-toggle"/.test(fly), "the drawer row has its own expand control");
check(drawerBlock.includes("onClick={onNavigate}") && drawerBlock.includes("category-drawer-toggle"),
      "tapping the word navigates, separately from the caret — one tap doing both is a coin toss");
check(/aria-expanded=\{expanded\}/.test(fly), "and the toggle reports its state");

console.log("\n-- accessibility --");
check(/aria-haspopup=\{fly\.hasPanel \? "true" : undefined\}/.test(fly), "the trigger declares a popup");
check(/aria-controls=\{fly\.hasPanel \? "category-flyout-panel" : undefined\}/.test(fly),
      "and names the panel it controls");
check(/id="category-flyout-panel"/.test(panelBlock), "which the panel answers to");
check(!/id="gifting-flyout-panel"/.test(fly),
      "the copied ids were renamed — two elements sharing one id makes aria-controls ambiguous");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
