/**
 * The Gifting mega-menu.
 *
 *     node frontend/scripts/test-gifting-flyout.mjs
 *
 * Every assertion here corresponds to something that was actually wrong at some
 * point in building this, either in a mock-up or in the first integration. None
 * of them are hypothetical:
 *
 *   the panel anchored to the 55px word instead of the header
 *   a scrim participating in the nav's flex layout and adding a phantom gap
 *   no /gifting row in DEFAULT_NAV, so the whole feature rendered nowhere
 *   the admin save path stripping the `flyout` field on every save
 *   a third card orphaned on its own row at the two-column breakpoint
 *   focus opening the panel with a pending close timer still armed
 *   Tab away leaving a full-width panel open over the page
 *   the drawer dropping the Gifting link entirely when no hampers exist
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const fly = readFileSync(join(SRC, "components", "GiftingFlyout.jsx"), "utf8");
const header = readFileSync(join(SRC, "components", "Header.jsx"), "utf8");
const adminNav = readFileSync(join(SRC, "pages", "admin", "AdminNavigation.jsx"), "utf8");

let failed = 0;
const check = (cond, label) => {
    console.log((cond ? "ok   " : "FAIL "), label);
    if (!cond) failed++;
};

console.log("-- the panel is anchored to the header, not the link --");
// The fault: `relative` on the nav item made the 55px word the containing
// block, so left-0/right-0 resolved to 55px and every card spilled out.
const panelBlock = fly.split("export function GiftingPanel").pop();
check(/absolute left-0 right-0 top-full/.test(panelBlock),
      "the panel spans its containing block edge to edge");
check(/<GiftingPanel fly=\{fly\} \/>/.test(header),
      "and is rendered by the Header");
// Position by line, not by regex acrobatics: the panel must sit AFTER the
// desktop nav closes and BEFORE the mobile drawer opens, and inside </header>.
const lines = header.split("\n");
const at = (needle) => lines.findIndex((l) => l.includes(needle));
const iPanel = at("<GiftingPanel fly={fly} />");
const iNavClose = lines.findIndex((l, k) => l.includes("</nav>") && k < iPanel);
const iDrawer = at('<div className="lg:hidden border-t');
const iHeaderClose = at("</header>");
check(iPanel > iNavClose && iPanel < iDrawer && iPanel < iHeaderClose,
      `outside both navs but inside the header (nav closes ${iNavClose}, panel ${iPanel}, drawer ${iDrawer}, header ends ${iHeaderClose})`);
check(/className="sticky top-0 z-40/.test(header),
      "and the header is positioned, so it IS the containing block");

console.log("\n-- nothing invisible joins the nav's flex layout --");
// A scrim span placed inside the flex nav took part in `gap`, adding a phantom
// 28px between two links.
const navBlock = header.split('<nav className="hidden lg:flex').pop().split("</nav>")[0];
check(!/aria-hidden="true"[^>]*>\s*<\/span>/.test(navBlock),
      "no empty spacer element sits between the nav links");
check(!fly.includes("scrimhook"), "and the scrim experiment is gone entirely");

console.log("\n-- it renders at all --");
// It rendered nowhere: hasGiftFlyout matched only /gifting or an explicit flag,
// and DEFAULT_NAV had neither.
check(/\{ to: "\/gifting", label: "Gifting", flyout: "hampers" \}/.test(header),
      "DEFAULT_NAV carries a Gifting row, so a site with no saved menu still shows it");
check(/n\?\.flyout === "hampers" \|\| n\?\.to === "\/gifting"/.test(header),
      "and the match accepts either the explicit flag or the conventional path");

console.log("\n-- the admin choice survives a save --");
check(/flyout: it\.flyout \|\| ""/.test(adminNav),
      "the save path carries `flyout` through — omitting it strips the field from every row");
check(/data-testid=\{`nav-flyout-\$\{i\}`\}/.test(adminNav), "and there is a control to set it");
check(/<option value="hampers">Gift hampers<\/option>/.test(adminNav), "offering the hamper panel");

console.log("\n-- responsive --");
check(/grid-cols-2 xl:grid-cols-3/.test(panelBlock),
      "two cards below xl, three at xl and up");
check(/\[&>\*:nth-child\(3\)\]:hidden xl:\[&>\*:nth-child\(3\)\]:block/.test(panelBlock),
      "and the third card is hidden in the two-column layout, not orphaned on a second row");
check(/xl:grid-cols-\[minmax\(0,1fr\)_1px_250px\]/.test(panelBlock),
      "the rail sits beside the cards at xl");
check(/hidden xl:block bg-\[#E5E7EB\]/.test(panelBlock),
      "with a divider that only exists when there is something to divide");
check(/hidden lg:block absolute/.test(panelBlock),
      "and the whole panel does not exist below lg, where the burger takes over");
check(/px-6 md:px-12 lg:px-16 2xl:px-24 3xl:px-40/.test(panelBlock),
      "panel padding matches the header's, so the first card lines up with the nav above it");

console.log("\n-- open and close behaviour --");
check(fly.includes("OPEN_MS = 120") && fly.includes("CLOSE_MS = 180"),
      "opening is delayed so a pointer sweeping past does not flash it open");
check(/onFocus=\{fly\.hasPanel \? fly\.wantOpen : undefined\}/.test(fly),
      "focus opens through wantOpen, which CLEARS a pending close — setOpen alone let an armed timer snap it shut");
check(/onBlur=\{\(e\) => \{\s*if \(!e\.currentTarget\.contains\(e\.relatedTarget\)\) fly\.wantClose\(\);/.test(fly),
      "and tabbing away closes it, rather than leaving a full-width panel over the page");
check(/e\.key === "Escape" && close\(\)/.test(fly), "Escape closes it");
check(/useEffect\(\(\) => \(\) => clear\(\), \[\]\)/.test(fly), "timers are cleared on unmount");
check(/transition-\[opacity,transform,visibility\]/.test(panelBlock),
      "visibility is transitioned, or the close animation never plays");

console.log("\n-- images --");
check(/src=\{mediaUrl\(img\)\}/.test(fly),
      "hamper photographs go through mediaUrl — a raw /api/files path resolves to the SPA shell on www");
check(/alt=\{h\.title\}/.test(fly), "and are labelled");
const cardBlock = fly.split("function HamperCard").pop().split("export function GiftingTrigger")[0];
check(cardBlock.includes("aspect-[4/3]") && cardBlock.includes("object-cover"),
      "cropped to a uniform 4:3, so mixed photograph shapes do not make every card a different height");
check(/loading="lazy"/.test(fly), "and lazily loaded — the menu is not visible on arrival");
check(/Photograph to come/.test(fly), "a hamper without one gets a placeholder, not a broken image");

console.log("\n-- the empty and degraded cases --");
check(/hasPanel: shown\.length > 0/.test(fly),
      "no hampers means no panel — an empty dropdown is worse than none");
check(/if \(!fly\.hasPanel\) return null;/.test(panelBlock), "the panel itself renders nothing");
check(/data-testid="gifting-drawer-plain"/.test(fly),
      "but the MOBILE drawer still renders the plain link, so a phone does not lose the page");
check(/inflight = null; \/\/ a failed load can be retried/.test(fly),
      "a failed fetch can be retried rather than caching the failure forever");
check(/if \(cache\) return Promise\.resolve\(cache\)/.test(fly),
      "and a successful one is cached, so hovering does not hit the API each time");

console.log("\n-- mobile --");
check(/data-testid="gifting-drawer-toggle"/.test(fly), "the drawer row has its own expand control");
const drawerBlock = fly.split("export function GiftingDrawerSection").pop();
check(drawerBlock.includes("onClick={onNavigate}") && drawerBlock.includes("{label}") &&
      drawerBlock.includes("gifting-drawer-toggle"),
      "tapping the word navigates, separately from the caret — one tap doing both is a coin toss");
check(/aria-expanded=\{expanded\}/.test(fly), "and the toggle reports its state");

console.log("\n-- accessibility --");
check(/aria-haspopup=\{fly\.hasPanel \? "true" : undefined\}/.test(fly), "the trigger declares a popup");
check(/aria-controls=\{fly\.hasPanel \? "gifting-flyout-panel" : undefined\}/.test(fly),
      "and names the panel it controls");
check(/id="gifting-flyout-panel"/.test(panelBlock), "which the panel answers to");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
