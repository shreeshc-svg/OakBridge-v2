/**
 * Asterisk launcher + smart nudge (Oct 2026) — the promises made to the
 * business, checked on the code (comments stripped, so a comment describing a
 * rule can't pass for the rule).
 *
 *     node frontend/scripts/test-asterisk.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const w = strip(readFileSync(join(SRC, "components", "ChatWidget.jsx"), "utf8"));
const css = readFileSync(join(SRC, "index.css"), "utf8");

console.log("-- once per visit, never after it's closed --");
check(/sessionStorage\.setItem\(NUDGE_SESSION, "1"\)/.test(w) && /if \(v\.done \|\| v\.session\) return;/.test(w), "at most once per visit; stops for good once closed");
check(/const closeNudge = \(\) => \{\s*setNudge\(null\);\s*writeNudges\(\{ \.\.\.readNudges\(\), done: true \}\)/.test(w), "closing it is remembered on the device");
check(/if \(isPrerender\(\)\) return;\s*const v = readNudges\(\);/.test(w), "never baked into the prerendered page");
check(/NUDGE_DELAY = \{ book: 12000, cart: 6000, default: 8000 \}/.test(w), "waits for the page to settle before speaking up");

console.log("-- never covers a buy button --");
for (const id of ["add-to-cart-main-button", "buy-now-button", "preorder-button", "cart-checkout-button", "cart-page-checkout-button", "place-order-button"]) {
    check(w.includes(`[data-testid="${id}"]`), `guards ${id}`);
}
check(w.includes("[data-testid^=\"add-to-cart-\"]"), "guards every tile's Add +");
check(/if \(nudgeZoneCoversBuy\(launcherRef\.current\)\)/.test(w) && /setYieldBtn\(!open && coversBuyButton\(launcherRef\.current\)\)/.test(w)
      && /coversBuyButton\(nudgeRef\.current\)\) setNudge\(null\)/.test(w), "card waits / hides, launcher steps aside");
check(/\.asterisk-launcher\.is-yielding \{ opacity: \.18; pointer-events: none; \}/.test(css), "a stepped-aside launcher lets taps through to the button");

console.log("-- phones (iPhone / Safari / Chrome) --");
check(/bottom-above-tray right-\[4\.75rem\]/.test(w) && /w-\[min\(16rem,calc\(100vw-6rem\)\)\]/.test(w), "card sits beside the launcher above the bottom bar, fits a 320 px screen");
check(/--tray-h: calc\(4rem \+ env\(safe-area-inset-bottom/.test(css), "bottom bar height includes the iPhone home-indicator area");
check(/<span className="md:hidden">\{nudge\.short\}<\/span>/.test(w) && /i === 2 \? "hidden md:inline-flex"/.test(w), "shorter text and 2 chips on phones");
check(/w-9 h-9 flex items-center justify-center/.test(w), "close button is a 36 px tap target");
check((css.match(/transform-box: fill-box/g) || []).length >= 2, "SVG transforms pinned for Safari (transform-box: fill-box)");

console.log("-- calm and fast --");
check(/@media \(prefers-reduced-motion: reduce\) \{\s*\.asterisk-launcher::before, \.asterisk-launcher::after,\s*\.aster-char \.aster-arms, \.aster-char \.aster-eyes \{ animation: none !important; \}/.test(css), "no motion for reduce-motion users");
check(/animation: asterisk-ring 3\.6s ease-out 3s infinite/.test(css), "rings start after load, not during first paint");
check(/\{ passive: true \}/.test(w) && /requestAnimationFrame\(check\)/.test(w), "scroll check is passive and once per frame");

console.log();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log("all checks passed");
