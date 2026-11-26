/**
 * Admin → Books → "Covers by ISBN" (src/components/admin/BulkCovers.jsx).
 *     node frontend/scripts/test-bulk-covers.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };
const src = readFileSync(join(SRC, "components/admin/BulkCovers.jsx"), "utf8");
// isbnFromName, evaluated from the source (the component itself needs React).
const fnSrc = src.slice(src.indexOf("const ISBN_RE"), src.indexOf("export default function"))
    .replace("export const isbnFromName", "const isbnFromName");
const isbnFromName = new Function(`${fnSrc}; return isbnFromName;`)();
check(isbnFromName("9789391032272.jpg") === "9789391032272", "plain ISBN file name");
check(isbnFromName("978-93-91032-27-2 front.PNG") === "9789391032272", "hyphens / spaces / suffix in the name");
check(isbnFromName("817525766X.jpg") === "817525766X", "ISBN-10 with X");
check(isbnFromName("Amit Sinha Indian Economy 2e Front.jpg") === "", "a name with no ISBN is not guessed");
check(/no book with this ISBN/.test(src) && /two files for this book/.test(src), "unmatched and duplicate files are skipped, not guessed");
check(/adminUploadCover\(r\.f\)/.test(src) && /adminUpdateBook\(r\.book\.id, \{ cover_image: up\.url \}\)/.test(src), "same upload as the Books form, then sets that book's cover");
const admin = readFileSync(join(SRC, "pages/admin/AdminBooks.jsx"), "utf8");
check(/<BulkCovers books=\{books\}/.test(admin) && /admin-bulk-covers-button/.test(admin), "button + dialog in Admin → Books");
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
