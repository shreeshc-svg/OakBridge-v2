/**
 * The desk-copy leftovers, and the migration that clears them.
 *
 *     node frontend/scripts/test-desk-copy-cleanup.mjs
 *
 * Retiring a feature leaves two kinds of residue. Code is easy: it either
 * compiles or it does not. Stored settings are not — three rows in `settings`
 * still named a feature that no longer existed, and nothing complained, because
 * the code that read them was gone. They were unreachable from Admin too: the
 * section registry no longer lists the Book Page group, so there was no
 * checkbox left to untick.
 *
 * That is what makes stale config worth a test. It cannot fail loudly, so the
 * only way it gets noticed is if something asserts it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BE = join(HERE, "..", "..", "backend");
const SRC = join(HERE, "..", "src");
const server = readFileSync(join(BE, "server.py"), "utf8");
const sections = readFileSync(join(SRC, "lib", "sections.js"), "utf8");
const rbacJs = readFileSync(join(SRC, "lib", "rbac.js"), "utf8");
const rbacPy = readFileSync(join(BE, "rbac.py"), "utf8");
const nav = readFileSync(join(SRC, "lib", "adminNav.js"), "utf8");

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

// Comments explaining why the feature is absent are not leftovers — they are
// the record of a decision. Strip them before looking for live references.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|#).*$/gm, "");

console.log("-- no live code references the retired feature --");
for (const [name, text] of [["sections.js", sections], ["rbac.js", rbacJs],
                            ["adminNav.js", nav], ["rbac.py", rbacPy]]) {
    check(!/desk[_ -]?cop/i.test(code(text)), `${name}: clean once comments are stripped`);
}

console.log("\n-- the migration clears the three orphaned settings rows --");
const fn = server.slice(
    server.indexOf("async def migrate_drop_desk_copy_settings"),
    server.indexOf("async def seed_data"),
);
check(fn.length > 0, "migrate_drop_desk_copy_settings exists");
check(fn.includes('"book.desk_copy" in hidden'),
      "hidden_sections: the entry is removed, the rest of the list is preserved");
check(fn.includes('delete_one({"key": "book_section_order"})'),
      "book_section_order: the whole key goes, its only member was desk_copy");
check(fn.includes('"/admin/desk-copies" in nav'),
      "admin_nav_order: the entry is filtered out, the admin's own ordering survives");
check(server.includes("await migrate_drop_desk_copy_settings()"), "and it is actually called on startup");

console.log("\n-- it is idempotent, and it is surgical --");
check((fn.match(/if isinstance\(/g) || []).length >= 2,
      "each list branch checks the value is a list before touching it");
check(fn.includes('if isinstance(hidden, list) and "book.desk_copy" in hidden') &&
      fn.includes('if isinstance(nav, list) and "/admin/desk-copies" in nav'),
      "and only writes when the stale value is present, so a second boot is a no-op");
check(!/delete_many|drop\(/.test(fn),
      "it deletes one named key, never a collection — the desk_copies records are not its business");
check(!/db\.(books|orders|users|desk_copies)\b/.test(fn),
      "and it touches the settings collection only");

console.log("\n-- the customer enquiry data is deliberately still there --");
const ext = readFileSync(join(BE, "extensions.py"), "utf8");
check(/desk_copies` COLLECTION is left in/.test(ext),
      "the decision to keep the submitted enquiries is written down where it will be found");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
