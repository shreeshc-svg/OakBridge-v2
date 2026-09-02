/**
 * Exporting the book catalogue.
 *
 *     node frontend/scripts/test-books-export.mjs
 *
 * A CSV export is only worth more than a database dump if it goes back IN. So
 * the columns are the bulk-import template's, in its order, and the values are
 * written in the dialect the importer parses.
 *
 * The failure that would not look like a failure: `str(None)` writing the word
 * "None" into every empty cell. Excel shows it, the importer accepts it, and
 * 194 books end up with a subtitle of "None". Nothing errors.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BE = join(HERE, "..", "..", "backend");
const ext = readFileSync(join(BE, "extensions.py"), "utf8");
const feat = readFileSync(join(BE, "features.py"), "utf8");
const page = readFileSync(join(HERE, "..", "src", "pages", "admin", "AdminBooks.jsx"), "utf8");

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

const list = (name) => {
    const i = ext.indexOf(name + " = [");
    return [...ext.slice(i, ext.indexOf("]", i)).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};
const importable = list("_BOOK_EXPORT_IMPORTABLE");
const template = [...feat.slice(feat.indexOf("TEMPLATE_COLUMNS = ["),
                                feat.indexOf("]", feat.indexOf("TEMPLATE_COLUMNS = [")))
                    .matchAll(/\("([a-z_]+)",/g)].map((m) => m[1]);

console.log("-- the export IS the import template --");
check(importable.length > 0 && template.length > 0, "both column lists were found");
check(JSON.stringify(importable) === JSON.stringify(template),
      `same columns in the same order (${importable.length}) — a row can be pasted straight into an import file`);

console.log("\n-- empty means empty --");
check(/if v is None:\s*\n\s*return ""/.test(ext),
      "None becomes a blank cell, never the string 'None'");
check(/return "TRUE" if v else "FALSE"/.test(ext), "booleans are written TRUE/FALSE");
check(/\("1", "true", "yes", "y"\)/.test(feat),
      "and the importer's _csv_bool accepts 'true', so TRUE round-trips");

console.log("\n-- it exports the catalogue, not the current view --");
check(ext.includes('{"product_type": {"$ne": "hamper"}}, {"_id": 0}\n    ).sort([("title", 1)])'),
      "hampers excluded and sorted by title, matching what the Books tab lists");
check(ext.includes('csv_response(\n        "oakbridge-books"'),
      "uses the shared csv_response, so the escaping and BOM rules stay in one place");
check(/safe_cell/.test(readFileSync(join(BE, "csv_export.py"), "utf8")),
      "which guards cells against formula injection");
check(!/limit=|skip=/.test(ext.slice(ext.indexOf("async def admin_export_books"),
                                     ext.indexOf("async def admin_export_inventory"))),
      "no pagination — an export of page 1 is not an export");

console.log("\n-- reference columns ride along without breaking re-import --");
const ref = list("_BOOK_EXPORT_REFERENCE");
check(ref.includes("id") && ref.includes("edition") && ref.includes("binding"),
      `${ref.length} extra columns the importer does not read, kept for a usable backup`);
check(ref.every((c) => !template.includes(c)),
      "and none of them collides with an import column");

console.log("\n-- reachable from the Books tab --");
check(page.includes('path="/admin/books/export.csv"'), "the button points at the endpoint");
check(page.indexOf("ExportButton") < page.indexOf("admin-import-csv-button"),
      "and sits beside Import, since they are two halves of one job");
check(/"books": \{"books"/.test(readFileSync(join(BE, "rbac.py"), "utf8")),
      "the `books` section already unlocks this path segment — no new permission needed");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
