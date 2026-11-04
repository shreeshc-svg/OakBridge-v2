/**
 * Warehouse book search (src/lib/bookSearch.js) + "To our office" cartons.
 *
 *     node frontend/scripts/test-book-search.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "frontend", "src");
const { searchBooks, isbn13to10 } = await import(pathToFileURL(join(SRC, "lib", "bookSearch.js")).href);
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };

const BOOKS = [
    { id: "sp", title: "Software Protection", author: "Asheeta Regidi", isbn: "978-81-937468-7-5", category: "law" },
    { id: "cl", title: "Corporate Law Referencer", author: "Taxmann Editorial", isbn: "9788198431189", edition: "12", category: "law" },
    { id: "cm", title: "Constitutional Miscellany", author: "V. Sudhish Pai", isbn: "9788199888173", category: "law" },
    { id: "ir", title: "International Relations – Essential Handbook", author: "Achal Priyadarshy", isbn: "9788199888166", category: "upsc" },
    { id: "el", title: "Ethical Leadership", author: "Smarak Swain & Satyajeet Sahoo", isbn: "9788194991199", category: "upsc" },
    { id: "ni", title: "Notes without ISBN", author: "Office", isbn: "" },
];
const ids = (q) => searchBooks(BOOKS, q).map((b) => b.id);

check(ids("9788193746875")[0] === "sp", "full ISBN-13");
check(ids("978-81-937468-7-5")[0] === "sp", "ISBN with hyphens");
check(ids(isbn13to10("9788193746875"))[0] === "sp" && isbn13to10("9788193746875") === "8193746872", "ISBN-10 (old sticker / Amazon code)");
check(JSON.stringify(ids("46875")) === '["sp"]', "last digits of the ISBN");
check(ids("software")[0] === "sp" && ids("SOFTWARE protection")[0] === "sp", "title, any case");
check(ids("protection software")[0] === "sp", "words in any order");
check(ids("regidi")[0] === "sp", "author surname");
check(ids("swain")[0] === "el" && ids("sahoo ethical")[0] === "el", "second author, author + title word");
check(ids("referencer 12")[0] === "cl" && ids("12 edition corporate")[0] === "cl", "edition");
check(ids("upsc").length === 2, "category");
check(ids("constituton")[0] === "cm", "one-letter typo forgiven");
check(ids("internatinal relatons")[0] === "ir", "typos in two words");
check(ids("notes")[0] === "ni", "a book without an ISBN is still found");
check(ids("zzzz qqqq").length === 0 && ids("").length === 0, "nothing for nonsense / empty");
check(ids("law")[0] !== undefined && ids("law").length === 3, "a common word lists all its books");
check(ids("software")[0] === "sp" && ids("soft")[0] === "sp", "title prefix ranks first");

console.log("-- wiring --");
const app = readFileSync(join(SRC, "pages", "warehouse", "WarehouseApp.jsx"), "utf8");
check(app.includes("searchBooks(books, q, 12)") && !app.includes("foldText"), "phone picker uses the shared search");
check((app.match(/<FindBook /g) || []).length === 2, "'One book in or out' and 'Check stock' have a search box, not only the scanner");
check(app.includes('book_id: found.book.id'), "a searched book is moved by id (works without an ISBN)");
check(app.includes('["office", "To our office"]') && app.includes('["office", "Sent to office"]'), "carton 'To our office' + single-move reason");
const wh = readFileSync(join(ROOT, "backend", "warehouse.py"), "utf8");
check(/CARTON_KINDS = \([^)]*"office"\)/.test(wh) && /OUT_REASONS = \{[^}]*"office"\}/.test(wh), "server accepts office cartons / moves");
check(wh.includes('async def wh_lookup(code: str = "", id: str = ""'), "lookup by picked book id");
const adm = readFileSync(join(SRC, "pages", "admin", "AdminWarehouse.jsx"), "utf8");
check(adm.includes('<option value="office">To our office</option>'), "admin carton type list has office");

console.log(failed ? `\n${failed} assertion(s) failed` : "\nall assertions passed");
process.exit(failed ? 1 : 0);
