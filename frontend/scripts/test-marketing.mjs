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
check(/flt\["suppressed"\]\s*=\s*\{"\$in": \[None, ""\]\}/.test(mk) && /flt\["email_status"\] = \{"\$in": \["verified", "valid", "risky", "unknown"\]\}/.test(mk), "suppressed / unsendable addresses are filtered");
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

check(/SES_EVENTS_TOKEN/.test(mk) && /len\(override\) >= 24/.test(mk), "SNS endpoint token can be rotated without JWT_SECRET (min 24 chars)");

console.log("-- SES email validation --");
check(/if not await _reserve_check\(cap\)/.test(mk) && mk.indexOf("_reserve_check(cap)") < mk.indexOf("get_email_address_insights(EmailAddress"),
    "each paid SES check is counted against the monthly cap BEFORE the call");
check(/"n": \{"\$lt": cap\}/.test(mk), "cap reservation is atomic (conditional \$inc)");
check(/_ses_cached\(/.test(mk) && /SES_CHECK_TTL_DAYS/.test(mk), "an address is never paid for twice within the cache window");
check(/core\.send_decision\([\s\S]{0,200}needs_ses=ses_on and x\.get\("email_status"\) != "verified"[\s\S]{0,80}has_ses=bool\(x\.get\("_ses"\)\)/.test(mk),
    "send decides per recipient: unproven + unchecked is skipped, never mailed blind");
check(/"status": "preparing"/.test(mk) && /start_prepare\(cid\)/.test(mk) && /ses="live" if ses_on else "cache"/.test(mk),
    "Send checks the recipients first (preparing), then sends");
check(/doc\.update\(status="skipped", error=why\)/.test(mk), "every skipped recipient is recorded with its reason");
check(/\{"id": cid, "status": \{"\$in": \["draft", "scheduled"\]\}\}/.test(mk), "double-click can't prepare a campaign twice");
check(/if why and not since:\s*\n\s*await _recover\(cid, why\)/.test(mk) && /Auto-paused again after recovering/.test(mk),
    "first bounce spike recovers by itself; a second one pauses + alerts");
check(/_window_stats\(cid, since\)/.test(mk), "after recovery the bounce guard judges only what was sent since");
check(/\.get\("overall"\) != "HIGH"/.test(mk), "recovery keeps only proven / SES-HIGH addresses");
check(/tail_should_stop\(/.test(mk) && /catch-all tail stopped/.test(mk), "the catch-all tail stops itself");
check(/dom not in core\.WEBMAIL/.test(mk) && /is_bad_domain\(/.test(mk), "domain learning never marks webmail domains bad");
check(/list_suppressed_destinations/.test(mk) && /sync_aws_suppression\(\)/.test(mk), "AWS suppression list synced into contacts by the cron");
check(/if v\["status"\] in \("invalid", "suppressed"\):\s*\n\s*return/.test(mk), "no confirmation email to a dead sign-up address");
check(/checks_for_budget\(/.test(mk) && !/ses_validation_monthly_cap/.test(mk + page), "budget is in ₹, the old check-count cap is gone");
check(/core\.worse\(/.test(mk), "SES can only downgrade an address, never vouch over our own doubts");
check(/EmailValidationSuppressed/.test(mk) && /"blocked"/.test(mk) && /k not in \("queued", "failed", "skipped", "blocked"\)/.test(mk),
    "SES auto-validation blocks are not counted as sent or bounced (no false auto-pause)");
check(/hasattr\(_ses\(\), "get_email_address_insights"\)/.test(mk), "old AWS SDK detected instead of crashing");
check(/results = await verify_emails\(\[r\.get\(ecol, ""\) for r in unique_rows\], autofix=autofix, ses="cache"\)/.test(mk), "import (incl. dry-run) uses cached SES verdicts only — never spends money");

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
