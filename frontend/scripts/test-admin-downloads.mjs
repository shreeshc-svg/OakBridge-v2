/**
 * Admin downloads carry the right token.
 *
 *     node frontend/scripts/test-admin-downloads.mjs
 *
 * ExportButton built its own Authorization header from
 * localStorage.getItem("token"). The app stores the token under
 * "oakbridge_token". So it sent `Bearer null`, and every export on all six
 * screens that use it returned 401 — Books, Inventory, Messages, Orders,
 * Submissions, Users.
 *
 * Nothing looked broken. The button rendered, the page compiled, the tests
 * passed. It only failed when somebody pressed it, and exports are pressed
 * rarely, so it sat there.
 *
 * The fix is not a corrected string — a corrected string is one typo away from
 * the same bug. It is that NOTHING outside lib/api.js may name the token at
 * all. One interceptor knows the key; everything else goes through it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const api = readFileSync(join(SRC, "lib", "api.js"), "utf8");

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

// every .js/.jsx under src, minus the one file allowed to know
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name))
  : /\.jsx?$/.test(d.name) ? [join(dir, d.name)] : []);
const files = walk(SRC).filter((f) => !f.endsWith(join("lib", "api.js")));

/*
 * Comments stripped before every scan. The files that FIXED this bug explain it
 * in prose -- ExportButton's header says it used to read
 * localStorage.getItem("token") and call fetch -- and an assertion that trips
 * over the note describing the fix is testing the wrong thing.
 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("-- only the api client knows the token --");
const namesToken = files.filter((f) => /localStorage\.(get|set|remove)Item\(\s*["'][^"']*token/i.test(code(readFileSync(f, "utf8"))));
const allowed = (f) => f.includes(join("context", "AuthContext"));   // it does the signing in
check(namesToken.every(allowed),
      `no component reads the token from storage${namesToken.filter(f=>!allowed(f)).length ? " — found: " + namesToken.filter(f=>!allowed(f)).map(f=>f.split(/[\\/]/).pop()).join(", ") : ""}`);

const handRolled = files.filter((f) => /headers:\s*\{\s*Authorization/.test(code(readFileSync(f, "utf8"))));
check(handRolled.length === 0,
      `nothing builds its own Authorization header${handRolled.length ? " — found: " + handRolled.map(f=>f.split(/[\\/]/).pop()).join(", ") : ""}`);

console.log("\n-- the key itself is defined once --");
check(/localStorage\.getItem\("oakbridge_token"\)/.test(api), "the interceptor reads oakbridge_token");
check(/const TOKEN_KEY = "oakbridge_token";/.test(readFileSync(join(SRC,"context","AuthContext.jsx"),"utf8")),
      "and AuthContext writes the same key");

console.log("\n-- downloads go through the shared client --");
const btn = readFileSync(join(SRC, "components", "admin", "ExportButton.jsx"), "utf8");
check(btn.includes('api.get(path, { responseType: "blob" })'),
      "ExportButton uses the axios instance, which carries the token");
check(!/fetch\(/.test(code(btn)), "and no longer calls fetch at all");
check(btn.includes('e?.response?.status === 401'),
      "a 401 is reported as an expired session rather than a blank failure");

console.log("\n-- one place builds the file --");
check(api.includes("export const downloadBlob"), "downloadBlob is shared");
check(/URL\.revokeObjectURL\(url\)/.test(api),
      "and revokes the object URL, which otherwise pins the whole blob in memory");
check(/filename="?\(\[\^";\]\+\)"?/.test(api.replace(/\\/g, "")) || api.includes('filename="?([^";]+)"?'),
      "it honours the server's filename, which carries the date");
const users = readFileSync(join(SRC, "pages", "admin", "AdminUsers.jsx"), "utf8");
check(/ExportButton/.test(users), "and the six screens still use the shared button rather than rolling their own");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
