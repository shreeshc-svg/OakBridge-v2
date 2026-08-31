/**
 * Law and Tax as categories, and the bookstore row that shows them.
 *
 *     node frontend/scripts/test-category-taxonomy.mjs
 *
 * A taxonomy change is the kind that fails silently and expensively. A book left
 * on a category that no longer exists does not error — it disappears from every
 * filter and every count at once. A published link to the old category does not
 * 404 — it returns 200 with an empty shelf. And an empty category shown as a tab
 * looks exactly like a working tab until someone taps it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const BE = join(HERE, "..", "..", "backend");
const server = readFileSync(join(BE, "server.py"), "utf8");
const catalog = readFileSync(join(SRC, "pages", "Catalog.jsx"), "utf8");
const row = readFileSync(join(SRC, "components", "CategoryRow.jsx"), "utf8");
const footer = readFileSync(join(SRC, "components", "Footer.jsx"), "utf8");
const home = readFileSync(join(SRC, "pages", "Home.jsx"), "utf8");
const seed = JSON.parse(readFileSync(join(BE, "books_go_live_seed.json"), "utf8"));

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

console.log("-- the six categories, in the order they are shown --");
const ids = [...server.matchAll(/^\s{8}"id": "([a-z-]+)",\n\s{8}"order": (\d+),/gm)]
    .map((m) => [m[1], Number(m[2])]);
check(ids.length === 6, `six categories in the seed (found ${ids.length})`);
check(ids.map((x) => x[0]).join(",") === "law,tax,academic,bgr,coffee-table,bespoke",
      "law, tax, academic, bgr, coffee-table, bespoke");
check(ids.every(([, o], i) => o === i + 1), "orders are 1..6 with no gaps or repeats");
check(!/"id": "professional"/.test(server), "and `professional` is no longer one of them");
check(server.includes('.sort([("order", 1), ("id", 1)])'),
      "the endpoint sorts by that order, so the row is not at the mercy of insertion order");
check(/order: int = 99/.test(server),
      "`order` is declared on the Category model — response_model drops undeclared fields");

console.log("\n-- no book is left pointing at a category that is about to be deleted --");
check(server.indexOf("await migrate_professional_split()") < server.indexOf("canonical_ids = ["),
      "the split runs BEFORE the reconcile that deletes stale categories");
check(server.includes('PROFESSIONAL_SPLIT = {"Law": "law", "Tax": "tax"}'), "Law -> law, Tax -> tax");
check(server.includes('PROFESSIONAL_FALLBACK = "law"'),
      "anything with another subject still lands somewhere real");
check(/if not remaining:\s*\n\s*return/.test(server),
      "idempotent: nothing left on `professional` means nothing to do, so restarts are free");
check(server.includes("logger.warning("),
      "and a fallback is logged loudly rather than absorbed");
check(!/"subject": target/.test(server) && !server.includes('{"$set": {"subject"'),
      "`subject` is left alone — it is the evidence this split was derived from");

console.log("\n-- every already-published link still resolves --");
check(server.includes("if category == RETIRED_CATEGORY:"),
      "?category=professional is aliased rather than left to 200 with an empty shelf");
check(server.includes('query["category"] = {"$in": list(PROFESSIONAL_SPLIT.values())}'),
      "and it resolves to both halves, which is what it always meant");
check(home.includes('link: "/books?category=professional"'),
      "so the homepage imprint tile can keep its existing link");
check(footer.includes('{ to: "/books?category=law", label: "Law" }') &&
      footer.includes('{ to: "/books?category=tax", label: "Taxation" }'),
      "the footer moves to the plain category links it always wanted");
check(catalog.includes('if (key === "category") next.delete("subject");'),
      "picking a category still clears a leftover subject from an old-style link");

console.log("\n-- the seed data moved with the taxonomy --");
const counts = seed.reduce((m, b) => ({ ...m, [b.category]: (m[b.category] || 0) + 1 }), {});
check(!counts.professional, "no seed book is still filed under professional");
check(counts.law === 92 && counts.tax === 31, `92 law and 31 tax (got ${counts.law}/${counts.tax})`);
check(counts.academic === 99 && counts.bgr === 29, "academic and bgr are untouched");
check(seed.filter((b) => b.subject === "Law").length === 92,
      "and their subjects are unchanged, so the migration stays re-checkable");

console.log("\n-- an empty category is not a tab --");
check(row.includes("filter((c) => (Number(c.book_count) || 0) > 0)"),
      "categories with no titles are filtered out of the row");
check(row.includes('<Tab id="" label="All"'), "All is exempt, because it is not a category");
// Comments stripped first. The component's docstring names Coffee Table and
// Bespoke as the motivating example, and an assertion that trips over prose
// explaining the rule is testing the wrong thing.
const rowCode = row.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check(!/coffee|bespoke/i.test(rowCode),
      "the rule is the count, not a hardcoded list of the two that happen to be empty today");
check(row.includes("min-h-[44px]"), "44px tap targets on touch");
check(row.includes("overflow-x-auto"), "the row scrolls sideways rather than wrapping to two ragged lines");
check(row.includes("scrollTo({ left:"),
      "and an active tab off-screen is scrolled into view, so it never looks missing");

console.log("\n-- /books opens on everything --");
check(!/next\.set\("category", "professional"\)/.test(catalog), "the default filter is gone");
check(!catalog.includes("autoFiltered"), "and so is the flag that tracked it");
check(!catalog.includes("DefaultFilterNotice"),
      "the notice explaining the default retires with the default it explained");
check(catalog.includes("const isDefaultView = !activeCat;"),
      "bare /books is the unfiltered page, with no category special-cased into it");
check(catalog.includes('path={category ? `/books?category=${category}` : "/books"}'),
      "canonical follows: /books when unfiltered, ?category= when not");
check(catalog.includes("const heroCat = activeCat;"),
      "and every category gets its own hero, with no exception for the old default");
check(!/category !== "professional"/.test(catalog),
      "no ternary anywhere still treats one category as if it were the landing page");

console.log("\n-- the row is above the grid, not inside the sidebar --");
check(catalog.indexOf("<CategoryRow") < catalog.indexOf('data-testid="catalog-filters"'),
      "it renders before the filters sidebar");
check(catalog.indexOf("<CategoryRow") < catalog.indexOf('data-testid="catalog-count"'),
      "and before the results column");
check(!catalog.includes("SUBCATEGORIES"),
      "the Law/Tax sub-list is gone — both are top-level now, so there is nothing to nest");
check(catalog.includes('data-testid="filter-search-input"') && catalog.includes("Collections"),
      "search and collections stay in the sidebar");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
