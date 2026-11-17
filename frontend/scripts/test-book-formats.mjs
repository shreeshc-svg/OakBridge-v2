// Book formats (backend/book_formats.py) — the storefront and admin wiring.
// Static: reads the source, so it runs without a browser or a backend.
// Run: node frontend/scripts/test-book-formats.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (p) => readFileSync(join(SRC, p), "utf8");
// Comments stripped first, so an assertion can't pass by matching the
// comment that explains the code (CLAUDE.md G10).
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

let failed = 0;
const check = (ok, label) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
    if (!ok) failed += 1;
};

const admin = code("pages/admin/AdminBooks.jsx");
check(/<BookFormats\s/.test(admin) && /isEdit \?\s*\(\s*<BookFormats/.test(admin), "Books form shows the Formats panel for a saved book");
check(!/Price matrix/.test(admin) && !/add-variant/.test(admin), "old binding × size price matrix UI is gone");
check(/onAnchorPrice=\{\(price, mrp\) => setForm/.test(admin), "a price set in Formats is pushed back into the form (Save changes can't undo it)");

for (const p of ["pages/admin/AdminBooks.jsx", "pages/admin/AdminInventory.jsx", "pages/admin/AdminPacks.jsx", "pages/admin/AdminHampers.jsx", "pages/admin/AdminMarketing.jsx"]) {
    check(/fetchBooks\(\{[^}]*all_formats: true/.test(code(p)), `${p.split("/").pop()} lists every format, not just the listed one`);
}

const api = code("lib/api.js");
check(/api\.get\(`\/admin\/book-formats\/\$\{id\}`\)/.test(api) && /api\.put\(`\/admin\/book-formats\/\$\{id\}`/.test(api), "api: get / save formats");

const panel = code("components/admin/BookFormats.jsx");
check(/adminSaveBookFormats\(book\.id, \{ formats: \[\], primary_index: 0 \}\)/.test(panel), "switching off sends an empty list (server unlinks, deletes nothing)");
check(!/stock:\s*Number|set\(i, "stock"/.test(panel), "panel never edits stock (warehouse owns it)");

const pdp = code("pages/BookDetail.jsx");
check(/<FormatSwitcher book=\{book\} \/>/.test(pdp), "product page renders the format switcher");
check(/x\.format_group !== b\.format_group/.test(pdp), "related books skip the same title in another format");
const sw = code("components/FormatSwitcher.jsx");
check(/to=\{`\/books\/\$\{f\.id\}`\}/.test(sw) && /\breplace\b/.test(sw), "each format is a link to its own page (Back leaves the title)");
check(/formats\.length < 2\) return null/.test(sw), "no switcher for an ordinary book");

const card = code("components/BookCard.jsx");
check(/otherFormats\.length > 0 &&/.test(card) && /Also in \$\{otherFormats/.test(card), "card says 'Also in Hardback'");
check(/oos && otherInStock/.test(card), "card points to an in-stock format when this one is out");

const cart = code("context/CartContext.jsx");
check(/format: Array\.isArray\(book\.formats\)/.test(cart), "cart line remembers the format for display");
check(/i\.format \?/.test(code("pages/Cart.jsx")) && /i\.format \?/.test(code("components/CartSheet.jsx")), "cart and drawer show the format");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
