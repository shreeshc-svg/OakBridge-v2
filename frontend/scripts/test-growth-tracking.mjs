/**
 * lib/attribution.js behaviour (Oct 2026 accuracy work), run in a fake browser.
 *
 *     node frontend/scripts/test-growth-tracking.mjs
 *
 * - staff browsers send no visit or step counts;
 * - the first source is remembered 30 days ONLY with analytics consent, and
 *   forgotten when consent is withdrawn;
 * - steps are sent once per session, with the same source fields as a visit.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };

class Store { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } clear() { this.m.clear(); } }
const sent = [];
globalThis.window = { location: { search: "", origin: "https://www.oakbridge.in", pathname: "/" } };
globalThis.sessionStorage = new Store();
globalThis.localStorage = new Store();
globalThis.document = { referrer: "" };
globalThis.Blob = class { constructor(parts) { this.text = parts.join(""); } };
Object.defineProperty(globalThis, "navigator", { value: { webdriver: false, sendBeacon: (url, b) => { sent.push({ url, body: JSON.parse(b.text) }); return true; } }, configurable: true });

// CRA resolves "./consent" without an extension; Node's ESM loader doesn't,
// so a copy with the import pointed at the real file is loaded instead.
const LIB = join(HERE, "..", "src", "lib");
const consentUrl = pathToFileURL(join(LIB, "consent.js")).href;
const src = readFileSync(join(LIB, "attribution.js"), "utf8").replace('from "./consent"', `from "${consentUrl}"`);
const tmp = join(mkdtempSync(join(tmpdir(), "attr-")), "attribution.mjs");
writeFileSync(tmp, src);
const A = await import(pathToFileURL(tmp).href);
const C = await import(consentUrl);
const API = "https://api.oakbridge.in/api";
const newSession = (search = "", referrer = "") => { sessionStorage.clear(); window.location.search = search; document.referrer = referrer; };

console.log("-- consent off: session only --");
newSession("?utm_source=email&utm_medium=lifecycle&utm_campaign=receipt");
A.captureAttribution();
check(!localStorage.getItem("oakbridge_attribution_30d"), "no 30-day memory without consent");
newSession();
check(A.captureAttribution() === null, "next session (no consent): source not carried over");

console.log("-- consent on: remembered 30 days --");
C.writeConsent({ analytics: true });
newSession("?utm_source=email&utm_medium=lifecycle&utm_campaign=receipt");
A.captureAttribution();
check(!!localStorage.getItem("oakbridge_attribution_30d"), "first source remembered with analytics consent");
newSession(); // came back by typing the URL
const back = A.captureAttribution();
check(back && back.utm_source === "email" && back.returning === true, "return visit inherits the remembered source");
A.sendVisitBeacon(API);
check(sent.at(-1)?.url.endsWith("/t/visit") && sent.at(-1).body.utm_source === "email", "visit beacon carries it");
newSession("", "https://www.google.com/");
const g = A.captureAttribution();
check(g.utm_source === "email", "first touch still wins over a later Google visit");

console.log("-- steps --");
const n = sent.length;
A.trackStep(API, "add_to_cart");
A.trackStep(API, "add_to_cart");
check(sent.length === n + 1 && sent.at(-1).url.endsWith("/t/step") && sent.at(-1).body.step === "add_to_cart", "a step is sent once per session");

console.log("-- consent withdrawn --");
C.writeConsent({ analytics: false });
newSession();
check(A.captureAttribution() === null && !localStorage.getItem("oakbridge_attribution_30d"), "memory erased once consent is withdrawn");

console.log("-- staff browser --");
// A customer-looking session is counted, then a staff account signs in.
newSession("?utm_source=email");
A.captureAttribution();
A.sendVisitBeacon(API);
A.trackStep(API, "view_item");
const undo = A.markStaffBrowser();
check(undo && undo.utm_source === "email" && undo.at && undo.steps.includes("view_item"), "staff sign-in hands back the counted visit + steps to undo");
check(A.markStaffBrowser() === null, "…only once");
const m = sent.length;
newSession("?utm_source=email");
A.captureAttribution();
A.sendVisitBeacon(API);
A.trackStep(API, "checkout");
check(sent.length === m, "staff browser: no visit, no step");

console.log();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log("all checks passed");
