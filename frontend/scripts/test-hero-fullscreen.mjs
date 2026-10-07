/**
 * Full-screen homepage hero (src/components/HeroFullscreen.jsx).
 *
 * The component is compiled with the project's own Babel and rendered with
 * react-dom/server, twice, to prove what matters most on the prerendered `/`:
 * the first render is identical every time (no time, randomness or window in
 * render — React #418), slide 0 is the one shown, and the countdown starts as a
 * placeholder. Also: artwork vs live-text slides, IST date handling, own-site
 * links staying in-site, and the CSS that makes it fill every screen.
 *
 * Run: node frontend/scripts/test-hero-fullscreen.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const FE = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(FE, "package.json"));
const babel = require("@babel/core");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

// ---- compile into node_modules/.cache so imports resolve to the project's packages
const OUT = join(FE, "node_modules", ".cache", "hx-test");
mkdirSync(join(OUT, "components"), { recursive: true });
mkdirSync(join(OUT, "lib"), { recursive: true });
const compile = (src, dest, rewrite = (s) => s) => {
    const code = babel.transformSync(rewrite(readFileSync(join(FE, "src", src), "utf8")), {
        babelrc: false, configFile: false, filename: src,
        presets: [[require.resolve("@babel/preset-react"), { runtime: "automatic" }]],
    }).code;
    writeFileSync(join(OUT, dest), code);
};
compile("components/HeroFullscreen.jsx", "components/HeroFullscreen.mjs", (s) =>
    s.replace('"./SmartLink"', '"./SmartLink.mjs"').replace('"../lib/runtime"', '"../lib/runtime.mjs"').replace('"../lib/api"', '"../lib/api.mjs"'));
compile("components/SmartLink.jsx", "components/SmartLink.mjs");
writeFileSync(join(OUT, "lib", "runtime.mjs"), readFileSync(join(FE, "src", "lib", "runtime.js"), "utf8"));
// mediaUrl stand-in: the real one reads env/CloudFront config, irrelevant here.
writeFileSync(join(OUT, "lib", "api.mjs"), "export const mediaUrl = (u) => (u && u.startsWith('/api/') ? 'https://cdn.test' + u.slice(4) : u);\n");

const mod = await import(pathToFileURL(join(OUT, "components", "HeroFullscreen.mjs")).href);
const React = require("react");
const { renderToString } = require("react-dom/server");
const { MemoryRouter } = require("react-router-dom");
const Hero = mod.default;

const SLIDES = [
    { id: "a", image: "/api/files/oakbridge/media/a.png", title: "Practical Guide to the DPDP *Act, 2023*", eyebrow: "New release",
      subtitle: "Law and compliance.", chips: "Puneet Bhasin | 2nd edition", cover: "/api/files/oakbridge/covers/x.jpg",
      cta_label: "Order now", link: "https://www.oakbridge.in/books/542f", accent: "#38bdf8", focus: "50% 20%" },
    { id: "b", image: "/api/files/oakbridge/media/b.png", alt: "Spring catalogue banner", link: "https://example.com/x" },
    { id: "c", image: "/api/files/oakbridge/media/c.png", title: "Law, AI & Tech *Summit*", event_date: "2026-11-28 09:30",
      accent: "javascript:alert(1)", focus: "url(evil)" },
];
const render = () => renderToString(React.createElement(MemoryRouter, null, React.createElement(Hero, { slides: SLIDES, priority: true })));

print("-- first render is deterministic (prerender = hydration) --");
function print(s) { console.log(s); }
const a = render();
await new Promise((r) => setTimeout(r, 30));
const b = render();
check(a === b, "two renders produce identical markup");
check((a.match(/hx-slide is-on/g) || []).length === 1 && a.indexOf("hx-slide is-on") < a.indexOf("Spring catalogue banner"),
      "exactly one slide shown, and it is the first");
check(a.includes("––") && !/<b>\d\d<\/b><span>days/.test(a), "countdown starts as a placeholder (filled in by an effect)");
check((a.match(/<img[^>]*fetchpriority="high"/gi) || []).length === 1, "only the first background is high priority");

print("-- live text vs finished artwork --");
check(/<h2 class="hx-h1">/.test(a) && a.includes("<em>2023</em>"), "headline is real text; *starred* words light up");
check(a.includes('href="/books/542f"'), "own-site links (https://www.oakbridge.in/...) stay in-site");
check(a.includes('href="https://example.com/x"') && a.includes('target="_blank"'), "other sites open in a new tab");
check(a.includes('alt="Spring catalogue banner"') && a.includes("hx-bg-art") && a.includes("hx-bg-blur"),
      "a banner with no headline is shown whole over a blurred copy, with its alt text");
check(!/class="hx-h1">[^<]*Spring/.test(a), "artwork slides get no headline");
check(a.includes("object-position:50% 20%"), "focal point applied");
check(!a.includes("javascript:alert") && !a.includes("url(evil)"), "accent and focal point are validated, not injected");
check(a.includes(">28<") && a.includes("NOV 2026"), "event date tile in Indian time, formatted by hand");
check(a.includes('data-testid="hero-scroll-book"') && a.includes('aria-label="Scroll to the next section"'), "the book button is there and labelled");

print("-- dates --");
const { parseIst, localise } = mod;
check(parseIst("2026-11-28 09:30") === Date.parse("2026-11-28T04:00:00Z"), "'2026-11-28 09:30' is IST (Safari-safe, no space form)");
check(parseIst("2026-11-28", true) === Date.parse("2026-11-28T18:29:59Z"), "a date-only 'until' covers the whole Indian day");
check(Number.isNaN(parseIst("next friday-ish")) && Number.isNaN(parseIst("")), "unreadable or empty -> NaN (ignored, never hides a slide)");
check(localise("https://oakbridge.in") === "/" && localise("/events") === "/events", "localise: bare domain and paths");

print("-- wiring --");
const home = readFileSync(join(FE, "src", "pages", "Home.jsx"), "utf8");
const css = readFileSync(join(FE, "src", "index.css"), "utf8");
const src = readFileSync(join(FE, "src", "components", "HeroFullscreen.jsx"), "utf8");
check(/<HeroFullscreen slides=\{heroSlides\}/.test(home), "homepage uses the full-screen hero");
check(/s\.image && slideLive\(s\)/.test(home) && /function slideLive/.test(home), "show-from/until applied where slides are fetched, not in render");
check(/height:calc\(100svh - 80px\)/.test(css) && /height:calc\(100svh - 80px - var\(--tray-h\)\)/.test(css),
      "fills the screen under the header; on phones also clears the bottom tray");
check(/min-height:560px/.test(css) && /min-height:520px/.test(css), "never collapses on a tiny or zoomed window");
check(/@media \(prefers-reduced-motion: reduce\)\{\s*\.hx-hero \*/.test(css), "reduced motion: everything still");
check((src.match(/isPrerender\(\)/g) || []).length >= 3, "autoplay, countdown and particles stay off during the prerender");
check(/filter\(\(el\) => !el\.contains\(hero\)/.test(src) && /t >= bottom - 2/.test(src), "book button scrolls to the next section on screen (CSS order aware)");

console.log();
if (failed) { console.log(`${failed} assertion(s) failed`); process.exit(1); }
console.log("all assertions passed");
