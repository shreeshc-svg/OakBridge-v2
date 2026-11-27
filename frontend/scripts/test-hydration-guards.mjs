/*
 * Things the build must NOT bake into prerendered pages, because the
 * browser's first render won't have them (React #418, found live 27 Nov 2026).
 * The prerender is a real browser: effects run there too, so each guard is an
 * explicit isPrerender() / hydrated check. Run: node scripts/test-hydration-guards.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const code = (f) => readFileSync(join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed++; };
check(/if \(!warm \|\| !src \|\| isPrerender\(\)\) return undefined;/.test(code("components/HeroFullscreen.jsx")), "hero 3D cover: prepared in the browser only (no data: PNG in the homepage HTML)");
check(/if \(!isPrerender\(\)\) setNow\(Date\.now\(\)\)/.test(code("components/DeliveryEstimate.jsx")), "delivery dates: reader's day, never the build day");
check(/hydrated && !isPrerender\(\) && !failed/.test(code("components/PaymentMethods.jsx")), "footer logos: tried after hydration only");
const pr = readFileSync(join(SRC, "..", "scripts", "prerender.js"), "utf8");
check(/\/api\/sitemap\.xml/.test(pr) && /dynamic\.push\(m\[1\]\)/.test(pr), "every /books/ URL in the sitemap is prerendered (hampers, second formats)");
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
