/**
 * "Coming soon" pages (src/lib/comingSoon.js): the footer tag, the page's
 * noindex, the prerender list and the sitemap must all agree.
 *     node frontend/scripts/test-coming-soon.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const FE = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(FE, p), "utf8");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
const { COMING_SOON_PATHS, isComingSoon } = await import(pathToFileURL(join(FE, "src/lib/comingSoon.js")).href);
const soon = [...COMING_SOON_PATHS];
check(isComingSoon("https://www.oakbridge.in/solutions/educators/") && !isComingSoon("/solutions/schools"), "matches absolute URLs and trailing slashes; launched pages untouched");
const pre = read("scripts/prerender.js");
const noindex = [...pre.match(/const NOINDEX_ROUTES = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
const statics = [...pre.match(/const STATIC_ROUTES = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
check(soon.every((p) => noindex.includes(p)) && !soon.some((p) => statics.includes(p)), "prerendered as noindex pages, not as indexable ones");
const srv = readFileSync(join(FE, "..", "backend", "server.py"), "utf8");
const sm = srv.slice(srv.indexOf("_SITEMAP_STATIC_PATHS = ["), srv.indexOf("]", srv.indexOf("_SITEMAP_STATIC_PATHS = [")));
check(!soon.some((p) => sm.includes(`"${p}"`)), "left out of the sitemap");
const app = read("src/App.js");
check(soon.every((p) => app.includes(`path="${p}"`)), "each has its own route (so it can be prerendered)");
const sol = read("src/pages/Solutions.jsx");
check(/isComingSoon\(`\/solutions\/\$\{slug\}`\) \? \(\s*<NoIndex/.test(sol), "page swaps the canonical + social card for noindex");
check(/from "\.\.\/lib\/comingSoon"/.test(read("src/components/Footer.jsx")), "footer's 'Coming soon' tag uses the same list");
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
