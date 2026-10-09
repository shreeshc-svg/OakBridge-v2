/**
 * Marketing (email via Amazon SES, WhatsApp via Interakt) — wiring and safety
 * checks for backend/marketing.py and its screens.
 *
 * Verification verdicts, rendering, tokens and funnel maths are tested in
 * backend/tests/test_marketing_core.py. This pins the properties that keep a
 * bulk sender on a live store from mailing people who never agreed, from
 * being turned into an open redirect, and from burning the domain's reputation.
 *
 * Run: node frontend/scripts/test-marketing.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Comments and docstrings stripped so no check can pass by matching prose.
const code = (p) =>
    readFileSync(join(ROOT, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(/^\s*#.*$/gm, "");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const mk = code("backend/marketing.py");
const core = code("backend/marketing_core.py");
const srv = code("backend/server.py");
const pay = code("backend/payments.py");
const rbacPy = code("backend/rbac.py");
const rbacJs = code("frontend/src/lib/rbac.js");
const nav = code("frontend/src/lib/adminNav.js");
const app = code("frontend/src/App.js");
const page = code("frontend/src/pages/admin/AdminMarketing.jsx");
const checkout = code("frontend/src/pages/Checkout.jsx");
const unsub = code("frontend/src/pages/Unsubscribe.jsx");

console.log("-- wiring --");
check(["public", "admin", "tasks"].every((r) => new RegExp(`include_router\\(marketing_${r}_router\\)`).test(srv)), "server mounts the marketing public, admin and task routers");
check(/resume_on_startup\(\)/.test(srv), "campaigns interrupted by a deploy resume on startup");
check(/from marketing import on_order_paid as (\w+)[\s\S]*?await \1\(/.test(pay), "paid orders become contacts (consent only if ticked)");
check(/from marketing import on_newsletter[\s\S]{0,80}await on_newsletter\(/.test(srv), "newsletter sign-ups go through double opt-in");
check(/"marketing"\s*:/.test(rbacPy) && /marketing:/.test(rbacJs) || /"marketing"/.test(rbacJs), "rbac knows the marketing section on both sides");
check(/\/admin\/marketing/.test(nav) && /path="marketing"/.test(app), "admin nav + route");
check(/path="\/unsubscribe"/.test(app) && /path="\/subscribe\/confirm"/.test(app), "public unsubscribe + confirm routes");

console.log("-- consent --");
check(/email_marketing_optin/.test(checkout) && /email_marketing_optin:\s*bool\s*=\s*False/.test(srv), "checkout email opt-in exists and defaults to off");
check(/email_consent\.status"\s*:\s*"subscribed"/.test(mk), "audiences require subscribed consent");
check(/wa_consent\.status"\s*:\s*"subscribed"/.test(mk), "WhatsApp audiences require WhatsApp opt-in");
check(/flt\["suppressed"\]\s*=\s*\{"\$in": \[None, ""\]\}/.test(mk) && /allowed = \["verified", "valid"\]/.test(mk), "suppressed / unsendable addresses are filtered");
check(/mk_erased/.test(mk), "erased people can't be re-imported");
check(/List-Unsubscribe-Post/.test(mk) || /List-Unsubscribe-Post/.test(core), "one-click unsubscribe header");
check(/NoIndex|noindex/.test(unsub), "unsubscribe page is not indexed");

console.log("-- safety --");
check(/check_sig\(/.test(mk) && /\/c\/\{send_id\}\/\{idx\}\/\{sig\}/.test(mk), "click redirects are signed and by link index (no open redirect)");
check(/sns\\\.\[a-z0-9-\]\+\\\.amazonaws\\\.com/.test(mk), "SNS SubscribeURL host is checked before it is fetched");
check(/should_pause\(/.test(mk), "auto-pause on bounces / complaints");
check(/confirm_count:\s*int/.test(mk) && /mkSend\(c\.id, a\.total/.test(page), "send needs the audience count confirmed");
check(/require_superadmin/.test(mk), "settings changes are superadmin-only");
check(!/AKIA[0-9A-Z]{16}/.test(mk + core), "no AWS key in source");
check(/javascript:/.test(core) || /startswith\(\("https:\/\/", "http:\/\/"\)\)/.test(core) || /https\?:/.test(core), "only http(s) links are rendered");

console.log("-- screen --");
for (const t of ["mk-dashboard", "mk-editor", "mk-contacts", "mk-lists", "mk-verify", "mk-settings", "mk-report", "mk-dry-run"]) {
    check(page.includes(`"${t}"`), `screen has ${t}`);
}
check(/sandbox=""/.test(page), "email preview iframe is sandboxed (no scripts)");
check(!/localStorage|sessionStorage/.test(page), "no browser storage on the admin page");

console.log();
if (failed) {
    console.log(`${failed} check(s) failed`);
    process.exit(1);
}
console.log("all checks passed");
