/**
 * Multi-volume sets: the wiring the Python unit tests cannot see.
 *
 *     node frontend/scripts/test-volume-sets.mjs
 *
 * backend/tests/test_volume_sets.py proves the arithmetic. This proves the
 * arithmetic is actually REACHED, and that a set stays a book everywhere a book
 * is counted — which is the entire premise of using a flag instead of a new
 * product type.
 *
 * The failure modes here are all silent:
 *
 *   - a field not declared on the Pydantic model: the admin ticks the box,
 *     Mongo stores it, response_model=Book drops it, and the site never sees
 *     it. This project has shipped that bug at least twice (see the comments on
 *     star_title and ebook_url).
 *   - the derivation not wired into _decorate_book: the total silently becomes
 *     whatever was last written rather than the sum of the volumes.
 *   - PATCH validating half the state: ticking the box without resending the
 *     volumes would save a set of zero volumes.
 *   - a set falling out of NOT_A_HAMPER: it would vanish from the bookstore.
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

/*
 * Read CODE, not the comments explaining it.
 *
 * Every file touched by this feature documents it at length, and those comments
 * say "is_volume_set", "volumes" and "volume_sets" repeatedly. Assertions in
 * this suite's history have passed by matching prose. Strip it first.
 */
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

const server = code(join(ROOT, "backend", "server.py"));
const ext = code(join(ROOT, "backend", "extensions.py"));
const vsets = code(join(ROOT, "backend", "volume_sets.py"));
const adminBooks = code(join(SRC, "pages", "admin", "AdminBooks.jsx"));
const detail = code(join(SRC, "pages", "BookDetail.jsx"));
const card = code(join(SRC, "components", "BookCard.jsx"));

console.log("-- the fields exist as far as the API is concerned --");
check(/^\s{4}is_volume_set: bool = False/m.test(server),
      "is_volume_set is declared on the Book model — undeclared, response_model=Book drops it "
      + "and the box the admin ticked never reaches the page");
check(/^\s{4}volumes: list = Field\(default_factory=list\)/m.test(server),
      "volumes is declared too, and defaults to a list rather than None so no consumer has to guard");
check(/is_volume_set: bool = False/.test(ext) && /is_volume_set: Optional\[bool\] = None/.test(ext),
      "create takes a plain bool, update takes Optional — so an absent field on PATCH means "
      + "'unchanged' rather than 'untick it'");

console.log("\n-- the derivation is actually reached --");
check(/volume_sets\.apply\(doc\)/.test(server),
      "_decorate_book calls volume_sets.apply — the one funnel every book response passes through");
check(/^import volume_sets/m.test(server) && /^import volume_sets/m.test(ext),
      "both modules import it rather than reimplementing the sum");
check(!/def\s+\w*total_pages/.test(ext),
      "extensions.py does not compute the total itself — one derivation, not two that can drift");

console.log("\n-- a malformed set is refused, on create AND on edit --");
check(/def _finalise_volume_set\(doc: dict\)/.test(ext),
      "create and update share one finaliser, so validation cannot be present in one and missing in the other");
check(/_finalise_volume_set\(doc\)/.test(ext) && /_finalise_volume_set\(merged\)/.test(ext),
      "and both call it");
check(/if "is_volume_set" in updates or "volumes" in updates:/.test(ext),
      "PATCH validates whenever either half changes");
check(/updates\.get\("is_volume_set", prev\.get\("is_volume_set"\)\)/.test(ext),
      "against the MERGED state — ticking the box without resending volumes must not save a set of none");
check(/"is_volume_set": 1, "volumes": 1/.test(ext),
      "which requires the previous values to be projected out of Mongo, or the merge reads undefined");
check(/MIN_VOLUMES = 2/.test(vsets),
      "a set needs two volumes; one is a book");

console.log("\n-- unticking is a real edit --");
check(/if merged\.get\("is_volume_set"\) and merged\["volumes"\]:/.test(ext),
      "pages is only derived while it IS a set, so an ex-set can be given an ordinary page count again");

console.log("\n-- a set is still a book everywhere a book is counted --");
check(/NOT_A_HAMPER = \{"product_type": \{"\$ne": "hamper"\}\}/.test(server),
      "the storefront filter still excludes hampers by type rather than including books by type — "
      + "which is why a flag needed no change here and a new product_type would have");
check(!/product_type.*volume_set/.test(server) && !/product_type.*volume_set/.test(ext),
      "no new product_type was introduced, so cart, orders, stock, coupons, sitemap and search need no branch");
check(!/db\.volume_sets|volume_sets_collection/.test(ext),
      "and no second collection");

console.log("\n-- the CSV backup does not lose a set --");
check(/"is_volume_set", "volumes",/.test(ext),
      "both are exported, or a backup cannot tell a 1440-page book from a three-volume set");
check(/if key == "volumes":/.test(ext),
      "volumes is flattened for the cell rather than dumped as a Python repr");
/* Scoped to the array's own brackets. A lazy match from the start of
   IMPORTABLE would run straight past the closing ] and find "volumes" in
   REFERENCE below it — an assertion that fails while the code is correct. */
const importableCols = (ext.match(/_BOOK_EXPORT_IMPORTABLE = \[[^\]]*\]/) || [""])[0];
check(importableCols.length > 0 && !importableCols.includes("volumes"),
      "and it is a REFERENCE column, not an importable one — the importer builds from an explicit "
      + "key list, so a flattened string can never be read back as structure");

console.log("\n-- the admin can enter one --");
check(/data-testid="book-form-is_volume_set"/.test(adminBooks), "the checkbox exists");
check(/data-testid="add-volume"/.test(adminBooks), "volumes can be added");
check(/volume-title-\$\{i\}/.test(adminBooks) && /volume-pages-\$\{i\}/.test(adminBooks),
      "each volume takes a title and a page count");
check(/no: i \+ 1/.test(adminBooks),
      "volumes are numbered by position on submit, matching the server's renumbering");
check(/const derived = name === "pages" && !!form\.is_volume_set/.test(adminBooks)
      && /readOnly=\{derived\}/.test(adminBooks),
      "the Pages field goes read-only for a set rather than letting the admin type a number "
      + "the server immediately overwrites");
check(/data-testid="volume-total"/.test(adminBooks),
      "and the running total is shown, so the derived number is visible before saving rather than after");
check(/data-testid="admin-books-sets-filter"/.test(adminBooks) && /b\.is_volume_set\)/.test(adminBooks),
      "the Books list can be filtered to sets — this list IS the Volume Sets screen, so it has to be "
      + "possible to find four sets among 194 titles");
check(/setCount > 0 &&/.test(adminBooks),
      "and the filter is hidden until a set exists, rather than sitting there dead");

console.log("\n-- the storefront says so --");
check(/data-testid="volume-breakdown"/.test(detail),
      "the specs tab lists the volumes with their own page counts — the requirement, verbatim");
check(/across \$\{volumes\.length\} volumes/.test(detail),
      "and the Pages row is labelled, so 1440 is not read as the length of one book");
check(/data-testid="volume-set-note"/.test(detail),
      "the set is named next to the title too, not only inside a tab the buyer has to open");
check(/data-testid=\{`volume-set-badge-\$\{book\.id\}`\}/.test(card),
      "and listings carry a badge, or a boxed set reads as one overpriced title");
check(/Set of \{book\.volumes\.length\} volumes/.test(card),
      "the badge counts the actual volumes rather than hardcoding a number");

console.log("\n-- volumes are descriptive, not purchasable --");
check(!/volumes/.test(code(join(ROOT, "backend", "payments.py"))),
      "payments.py knows nothing about volumes — no price, no cart line, no stock of their own");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
