/**
 * The dead-word retry and the rescued-search report — the parts that need a
 * database, asserted as wiring. The pure functions are unit-tested in
 * backend/tests/test_search_recall.py.
 *
 *     node frontend/scripts/test-search-rescue.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const strip = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"""[\s\S]*?"""/g, '""')
        .split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
const server = strip(readFileSync(join(ROOT, "backend", "server.py"), "utf8"));
const feat = strip(readFileSync(join(ROOT, "backend", "features.py"), "utf8"));
const catalog = strip(readFileSync(join(HERE, "..", "src", "pages", "Catalog.jsx"), "utf8"));
const api = strip(readFileSync(join(HERE, "..", "src", "lib", "api.js"), "utf8"));
const dash = strip(readFileSync(join(HERE, "..", "src", "pages", "admin", "AdminDashboard.jsx"), "utf8"));

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };
const drop = server.split("async def _drop_dead_words")[1] || "";

console.log("-- one dead word no longer empties the shelf --");
check(/reduced = await _drop_dead_words\(query, clauses, search, fixed\)/.test(server),
      "list_books tries the reduced query after correction fails");
check(server.indexOf("_correct_search(search)") < server.indexOf("_drop_dead_words(query"),
      "only AFTER spelling correction — dropping a word is the last resort");
check(/base_text = fixed or search/.test(drop),
      "starts from the corrected spelling, so a fixed 'smarak' survives and only 'swin' goes");
check(/count_documents\(q, limit=1\)/.test(drop),
      "a word is dead only if it matches no book on its own");
check(/if not dead or not any\(len\(re\.sub\(r"\[\^0-9A-Za-z\]", "", w\)\) >= 3 for w in live\)/.test(drop),
      "needs at least one dead word AND a live word of 3+ letters — 'ufgc ney' stays an honest zero");
check(/response\.headers\["X-Search-Corrected-To"\] = reduced/.test(server),
      "the storefront is told what was searched instead");

console.log("\n-- the report separates rescued searches from real gaps --");
check(/corrected_to: Optional\[str\] = None/.test(feat), "the log accepts corrected_to");
check(/"corrected_to": \(payload\.corrected_to or ""\)\.strip\(\)\[:120\] or None/.test(feat),
      "and stores it, trimmed and capped");
check(/elif row\["rescued_to"\]:\s*\n\s*rescued\.append\(row\)/.test(feat),
      "a rescued term is not filed under 'found nothing'");
check(/"rescued": rescued/.test(feat), "and is returned as its own list");
check(/corrected_to: correctedTo \|\| null/.test(api), "the client sends it");
check(/correctedTo && data\.length \? correctedTo : null/.test(catalog),
      "only when the rewrite actually returned something");
check(/rows=\{searchInsight\.rescued \|\| \[\]\}/.test(dash), "and the dashboard shows the list");

console.log();
if (failed) { console.log(`${failed} assertion(s) failed`); process.exit(1); }
console.log("all assertions passed");
