/**
 * Hydration snapshot wiring (src/lib/boot.js + scripts/prerender.js).
 *
 * Live symptom this guards: React error #418 on every prerendered route, the
 * page blanking and rebuilding on load, CLS 0.36–0.5 and NO_LCP in PageSpeed.
 * The runtime proof is the browser console on www.oakbridge.in after a deploy;
 * this test pins the wiring so a later edit cannot quietly undo it.
 *
 * Run: node scripts/test-boot-hydration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
// Strip comments so a check can never pass by matching the prose that
// explains the code (see CLAUDE.md G10 — self-referential tests).
const code = (p) =>
    read(p)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let failed = 0;
const ok = (cond, msg) => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
    if (!cond) failed++;
};

// ── 1. prerender embeds the snapshot in the same evaluate() as outerHTML ─────
const pre = code("scripts/prerender.js");
const evalBlock = pre.match(/page\.evaluate\(\(\) => \{[\s\S]*?return document\.documentElement\.outerHTML;\s*\}\)/);
ok(!!evalBlock, "prerender: snapshot + outerHTML read in one evaluate()");
if (evalBlock) {
    const b = evalBlock[0];
    ok(/window\.__BOOT_DATA__/.test(b), "prerender: reads window.__BOOT_DATA__");
    ok(/s\.id = "__BOOT__"/.test(b) && /application\/json/.test(b), 'prerender: writes <script id="__BOOT__" type="application/json">');
    ok(/\.replace\(\/<\/g, "\\\\u003c"\)/.test(b), "prerender: escapes < in the JSON");
}
ok(!/page\.evaluate\(\(\) => document\.documentElement\.outerHTML\)/.test(pre), "prerender: old snapshot-less capture is gone");

// ── 2. The escape round-trips and cannot close the script tag ────────────────
const sample = { t: "a </script><script>alert(1)</script> b", n: 3, arr: ["<b>", "₹1,295"] };
const enc = JSON.stringify(sample).replace(/</g, "\\u003c");
ok(!enc.includes("<"), "escape: no raw < survives");
ok(JSON.stringify(JSON.parse(enc)) === JSON.stringify(sample), "escape: JSON.parse restores the exact value");

// ── 3. boot.js: reads the element, writes only while prerendering ────────────
const boot = code("src/lib/boot.js");
ok(/getElementById\("__BOOT__"\)/.test(boot), "boot: reads #__BOOT__");
ok(/if \(typeof window === "undefined" \|\| !isPrerender\(\)\) return;/.test(boot), "boot: bootWrite is a no-op outside prerender");
ok(/useLayoutEffect\(\(\) => \{\s*bootWrite\(key, value\);/.test(boot), "boot: useBootState records in a layout effect");
ok(/catch \{\s*snapshot = \{\};/.test(boot), "boot: a corrupt snapshot falls back to empty");

// ── 4. Every consumer, with a unique key per consumer ────────────────────────
const consumers = {
    "src/context/CartContext.jsx": ["cart:settings", "cart:site"],
    "src/components/Header.jsx": ["header:nav"],
    "src/components/Footer.jsx": ["footer:site", "footer:columns", "footer:legal", "footer:socials"],
    "src/components/CategoryFlyout.jsx": ["nav:cats", "nav:best"],
    "src/components/GiftingFlyout.jsx": ["nav:hampers"],
    "src/pages/Home.jsx": ["home:site", "home:settings", "home:testimonials", "home:heroSlides"],
};
const owner = new Map();
for (const [file, keys] of Object.entries(consumers)) {
    const src = code(file);
    for (const k of keys) {
        ok(src.includes(`useBootState("${k}"`), `${path.basename(file)}: useBootState("${k}")`);
        ok(!owner.has(k) || owner.get(k) === file, `key "${k}" owned by one file only`);
        owner.set(k, file);
    }
}
// Nothing else may reuse a key under a different owner.
const allSrc = [];
const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|mjs)$/.test(e.name)) allSrc.push(p);
    }
};
walk("src");
for (const f of allSrc) {
    for (const m of code(f).matchAll(/useBootState\("([^"]+)"/g)) {
        const want = owner.get(m[1]);
        ok(want === undefined || want === f.replace(/\\/g, "/"), `${f}: key "${m[1]}" not shared across consumers`);
    }
}

// ── 5. Home records exactly what it reads for the derived book rows ──────────
const home = code("src/pages/Home.jsx");
for (const k of ["home:newRow", "home:carousel"]) {
    ok(home.includes(`bootRead("${k}")`) && home.includes(`bootWrite("${k}"`), `Home: reads and writes "${k}"`);
}
ok(/bootWrite\("home:newRow", newReleasesRow\)/.test(home), "Home: newRow snapshot is the rendered row");
ok(/bootWrite\("home:carousel", carouselBooks\)/.test(home), "Home: carousel snapshot is the rendered carousel");
ok(/\[\.\.\.bootPool, \.\.\.bestsellers/.test(home), "Home: bootPool first so live copies override it");
ok(/setFallback\(d\);\s*setBootPool\(\[\]\);/.test(home), "Home: bootPool dropped once the live pool arrives");
ok(!/fetchBooks\([^)]*\)\.then\(setFallback\)/.test(home), "Home: no path sets fallback without clearing bootPool");
ok(!/bootWrite\("home:fallback"/.test(home), "Home: the 220 KB fallback list is not snapshotted");

// ── 6. Per-visitor cart count is gated until after hydration ─────────────────
const header = code("src/components/Header.jsx");
ok(/const badgeCount = hydrated \? count : 0;/.test(header), "Header: badge uses the hydration-gated count");
ok(/\{badgeCount > 0 && \(/.test(header) && /\{badgeCount\}/.test(header), "Header: badge renders badgeCount");
ok(!/\{count > 0 &&/.test(header), "Header: no ungated count left in markup");
const tray = code("src/components/BottomTray.jsx");
ok(/const count = useHydrated\(\) \? liveCount : 0;/.test(tray), "BottomTray: badge count gated");

console.log(failed ? `\n${failed} FAILED` : "\nAll boot-hydration checks passed.");
process.exit(failed ? 1 : 0);
