/**
 * Author pages: reachable from Google, and reachable from the search box.
 *
 *     node frontend/scripts/test-author-discovery.mjs
 *
 * Three findings from one week's Semrush report and one month's zero-result
 * search log, which turned out to be the same problem seen from two sides:
 * author pages exist and nothing can find them.
 *
 *   /writer/somesh-upadhyay ranked 8th for a 260-a-month keyword, was the
 *   site's highest-traffic landing page, and served the 404 page.
 *
 *   /authors/somesh-upadhyay — the page that should hold that ranking — is
 *   absent from the sitemap because his bio is blank, and nothing in Admin
 *   said so.
 *
 *   "vaibhav kumar" was searched four times and returned nothing, while
 *   /authors/vaibhav-kumar existed. He has no titles, so no book could ever
 *   carry his name, and site search only queries books.
 *
 * THE ASSERTION THAT IS ABOUT SECURITY, NOT SEO
 *
 * The old oakbridge.in was COMPROMISED and had spam injected under its own URL
 * space. A pattern redirect — /writer/:slug* -> /authors/:slug* — would accept
 * any path an attacker already has links to and forward its signals here. The
 * redirect must therefore be an allowlist drawn from the live author roster,
 * and must fall through to 404 when the roster cannot be read.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(HERE, "..", "src");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const code = (abs) =>
    readFileSync(abs, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .split("\n")
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("*");
        })
        .join("\n");

const redirect = code(join(SRC, "pages", "WriterRedirect.jsx"));
const app = code(join(SRC, "App.js"));
const catalog = code(join(SRC, "pages", "Catalog.jsx"));
const adminAuthors = code(join(SRC, "pages", "admin", "AdminAuthors.jsx"));
const ext = code(join(ROOT, "backend", "extensions.py"));
const vercel = readFileSync(join(HERE, "..", "vercel.json"), "utf8");

console.log("-- the old author URL is no longer a dead end --");
check(/<Route path="\/writer\/:id" element=\{<WriterRedirect \/>\} \/>/.test(app),
      "/writer/:id is routed");
check(/import WriterRedirect from "@\/pages\/WriterRedirect"/.test(app),
      "and the component is imported");
check(/<Navigate to=\{`\/authors\/\$\{id\}`\} replace \/>/.test(redirect),
      "a known slug goes to the author page, with replace — without it Back lands "
      + "the visitor straight back on the dead URL");

console.log("\n-- and it cannot be used to launder the compromised domain --");
check(/fetchAuthors\(\)/.test(redirect),
      "the allowlist is the LIVE author roster, so it maintains itself");
check(/\.some\(\s*\(a\) =>/.test(redirect) || /\.some\(\(a\) =>/.test(redirect),
      "the slug is checked against that roster before anything redirects");
check(/return <NotFound \/>;/.test(redirect),
      "an unknown slug gets the ordinary 404, not a redirect");
check(/catch\(\(\) => live && setKnown\(false\)\)/.test(redirect),
      "a FAILED roster fetch also 404s — falling open would hand an attacker the "
      + "pattern redirect this whole design exists to avoid");
check(!/"\/writer\/:slug\*"/.test(vercel) && !/writer/.test(vercel),
      "and there is no blanket /writer rule in vercel.json");

console.log("\n-- a person is a thing you can search for --");
check(/fetchAuthors/.test(catalog), "the results page can load the roster");
check(/data-testid=\{`search-author-\$\{a\.id\}`\}/.test(catalog),
      "a matching author is offered when no book matched");
check(/words\.every\(\(w\) => n\.includes\(w\)\)/.test(catalog),
      "EVERY word has to appear in the name — 'vaibhav kumar' must not return every "
      + "Kumar on the roster, which is exactly how the author-alias search went wrong");
check(/term\.length < 3/.test(catalog),
      "and two characters is not a name, so it does not fire on every keystroke");
check(catalog.indexOf("authorHits.length > 0") < catalog.indexOf("didYouMean.length > 0"),
      "authors are offered ABOVE 'did you mean' — an exact match on a person beats a "
      + "fuzzy match on a title");

console.log("\n-- an author cannot silently fall out of the sitemap --");
check(/a\["in_sitemap"\] = has_bio and has_books/.test(ext),
      "the admin roster carries whether each author is submitted");
check(/a\["sitemap_reason"\] = "No bio"/.test(ext), "and why, when they are not");
check(/with_books = await books_for_authors\(\)/.test(ext),
      "asked of the LIVE matcher, the same question the sitemap and the author page ask");
/* Scoped to a READ of the stored field, not to the substring.
   `a["live_title_count"]` — the count this change adds, taken from the live
   matcher — contains "title_count" inside it, so a bare substring test failed
   against the very fix it was meant to protect. */
const authorsFn = ext.split("async def admin_list_authors")[1].split("async def")[0];
check(!/\.get\("title_count"\)/.test(authorsFn) && !/\["title_count"\]/.test(authorsFn),
      "and NOT of the stored title_count, which is stale — it reads 1 for authors "
      + "whose only book is no longer on sale");
check(/a\["live_title_count"\] = len\(with_books/.test(authorsFn),
      "the count shown comes from the matcher, so a stale stored value is visible "
      + "beside it rather than quietly believed");
check(/data-testid=\{`author-sitemap-\$\{a\.id\}`\}/.test(adminAuthors),
      "and the admin screen shows it on the row");
check(/a\.in_sitemap === false &&/.test(adminAuthors),
      "only as a warning when it is actually missing");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
