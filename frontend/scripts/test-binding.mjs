/**
 * HB / PB after book titles on the warehouse screens (src/lib/binding.js),
 * and the places that use it.
 *
 *     node frontend/scripts/test-binding.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "frontend", "src");
const B = await import(pathToFileURL(join(SRC, "lib", "binding.js")).href);
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };

// The live catalogue's bindings (Nov 2026): Paperback 146, Hardback 65, Hardback with Dust Jacket 1, none 1.
check(B.bindingTag("Paperback") === "PB" && B.bindingTag("Softcover") === "PB", "Paperback / Softcover -> PB");
check(B.bindingTag("Hardback") === "HB" && B.bindingTag("Hardcover") === "HB", "Hardback / Hardcover -> HB");
check(B.bindingTag("Hardback with Dust Jacket") === "HB-DJ", "dust jacket -> HB-DJ");
check(B.bindingTag("") === "" && B.withBinding("Some Pack", null) === "Some Pack", "no binding (packs, hampers): title unchanged");

const TITLE = "Justice M N Venkatachaliah - The Man & The Judge";
const rows = B.tagBooks([{ id: "pb", title: TITLE, binding: "Paperback" }, { id: "hb", title: TITLE, binding: "Hardback" }]);
check(rows[0].title === `${TITLE} (PB)` && rows[1].title === `${TITLE} (HB)`, "the two Man & The Judge books read differently");
check(rows[0].plain_title === TITLE, "the real title is kept (plain_title)");
check(B.tagBooks(rows)[1].title === `${TITLE} (HB)`, "never tagged twice");
check(B.titleFor("The Man & The Judge", "hb") === "The Man & The Judge (HB)" && B.titleFor("X", "unknown") === "X",
    "a server title next to a book id gets the tag (unknown id: unchanged)");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (p) => strip(readFileSync(join(SRC, p), "utf8"));
const api = read("lib/api.js");
check(/whBooks = [^\n]*then\(\(r\) => tagBooks\(r\.data\)\)/.test(api), "warehouse book list is tagged at the source (pickers, lookups, toasts)");
check(/adminWhInventory = [^\n]*rows: tagBooks\(r\.data\?\.rows\)/.test(api), "admin warehouse inventory is tagged");
const inv = read("pages/admin/AdminInventory.jsx");
check(/rememberBindings\(/.test(inv) && (inv.match(/<BindingBadge binding=\{book\.binding\} bookId=\{book\.id\} \/>/g) || []).length >= 2,
    "Admin → Inventory: HB / PB badge in front of the title");
check(!/truncate[^"]*">\s*<BindingBadge/.test(inv) && /line-clamp-2[^"]*" title=\{book\.title\}>/.test(inv),
    "…and long titles wrap to two lines (full title on hover) instead of being cut");
const winv = read("components/admin/WarehouseInventory.jsx");
check(/<BindingBadge binding=\{b\.binding\} \/>\{b\.plain_title \|\| b\.title\}/.test(winv) && /line-clamp-2/.test(winv),
    "Warehouse → Inventory: same badge in front, title wraps");
// Not comment-stripped: the file has "image/*" in strings, which a /* */ stripper would eat.
const app = readFileSync(join(SRC, "pages/warehouse/WarehouseApp.jsx"), "utf8");
check(/useBindings\(whBooks\)/.test(app) && (app.match(/titleFor\(/g) || []).length >= 8,
    "phone app: inbox lines, candidates, order items, owed, check-stock all tagged");
check(/useBindings\(whBooks\)/.test(read("pages/admin/AdminWarehouse.jsx")), "warehouse admin loads the map");
check(/titleFor\(o\.title, o\.book_id\)/.test(read("components/admin/StillToSend.jsx")), "still-to-send rows tagged");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
