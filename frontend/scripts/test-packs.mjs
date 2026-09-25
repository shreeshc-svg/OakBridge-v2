/**
 * Packs wiring. Pricing and item rules are unit-tested in backend/tests/test_packs.py.
 *     node frontend/scripts/test-packs.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = (...p) => readFileSync(join(HERE, "..", "..", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"""[\s\S]*?"""/g, '""')
    .split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
const packs = strip(R("backend", "packs.py")), server = strip(R("backend", "server.py"));
const rbac = strip(R("backend", "rbac.py")), ext = strip(R("backend", "extensions.py"));
const app = strip(R("frontend", "src", "App.js")), nav = strip(R("frontend", "src", "lib", "adminNav.js"));
const frbac = strip(R("frontend", "src", "lib", "rbac.js")), books = strip(R("frontend", "src", "pages", "admin", "AdminBooks.jsx"));
const pdp = strip(R("frontend", "src", "pages", "BookDetail.jsx")), card = strip(R("frontend", "src", "components", "BookCard.jsx"));
const admin = strip(R("frontend", "src", "pages", "admin", "AdminPacks.jsx"));
let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

console.log("-- backend --");
check(/app\.include_router\(packs_public_router\)/.test(server) && /app\.include_router\(packs_admin_router\)/.test(server), "routers registered");
check(/pack_items: list = Field\(default_factory=list\)/.test(server), "pack_items declared on Book (else response_model drops it)");
check(/query\["enabled"\] = \{"\$ne": False\}/.test(server), "a hidden pack leaves the bookstore and search");
check(/book\.get\("product_type"\) == "pack" and book\.get\("enabled"\) is False/.test(server), "and its page 404s");
check(/await _check_isbn_unique\(payload\.isbn, None\)/.test(packs), "ISBN must be unique — it is the inventory/eBook join key");
check(/if by_id\[i\]\.get\("product_type"\) in _NOT_PACKABLE/.test(packs), "a pack cannot contain a pack or a hamper");
check(/updates\["price"\] = _price_or_400\(mrp, mode, value\)/.test(packs), "PATCH re-prices against the merged state");
check(/"isbn": "",\s*\n\s*"enabled": False/.test(packs), "a duplicate starts hidden with no ISBN");
check(/Add an ISBN before enabling this pack/.test(packs), "and cannot go live without one");
check(/"packs": \{"packs", "uploads"\}/.test(rbac), "RBAC section grants its endpoints");
check(/\$nin": \["hamper", "pack"\]/.test(ext), "packs are not in the books CSV");

console.log("\n-- admin --");
check(/<Route path="packs" element=\{<AdminPacks \/>\} \/>/.test(app), "route");
check(/to: "\/admin\/packs"/.test(nav) && /"packs"/.test(frbac), "sidebar + permission section");
check(/b\.product_type !== "pack"/.test(books), "Books tab does not list packs");
check(/!\["pack", "hamper"\]\.includes\(b\.product_type\)/.test(admin), "picker offers books only");
check(/packs-search/.test(admin) && /packs-sort/.test(admin) && /packs-filter/.test(admin), "search, sort, filter");
check(/adminReorderPacks/.test(admin) && /adminDuplicatePack/.test(admin) && /adminDeletePack/.test(admin), "reorder, duplicate, delete");
check(/mayDelete &&/.test(admin), "delete only offered to superadmins");

console.log("\n-- storefront --");
check(/fetchPackItems\(id\)/.test(pdp) && /data-testid="pack-items"/.test(pdp), "PDP lists the books inside");
check(/data-testid=\{`pack-badge-\$\{book\.id\}`\}/.test(card), "listing card badge");

console.log();
if (failed) { console.log(`${failed} assertion(s) failed`); process.exit(1); }
console.log("all assertions passed");
