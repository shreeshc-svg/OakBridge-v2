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
check(/flt\["suppressed"\]\s*=\s*\{"\$in": \[None, ""\]\}/.test(mk) && /flt\["email_status"\] = \{"\$in": sorted\(core\.selected_statuses\(aud\)\) \+ \["unknown"\]\}/.test(mk), "suppressed / unsendable addresses are filtered");
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
check(/if suggest and status == "valid":\s*\n\s*status = "risky"/.test(mk) && /score_address\(sig/.test(mk), "an unfixed typo is never scored up to valid");
check(/EmailValidationSuppressed/.test(mk) && /"blocked"/.test(mk) && /k not in \("queued", "failed", "skipped", "blocked"\)/.test(mk),
    "SES auto-validation blocks are not counted as sent or bounced (no false auto-pause)");
check(/hasattr\(_ses\(\), "get_email_address_insights"\)/.test(mk), "old AWS SDK detected instead of crashing");
check(/results = await verify_emails\(\[r\.get\(ecol, ""\) for r in unique_rows\], autofix=autofix, ses="cache",/.test(mk), "import (incl. dry-run) uses cached SES verdicts only — never spends money");

check(/allowed=allowed\)/.test(mk) && /core\.selected_statuses\(aud\)/.test(mk), "campaign status tick-boxes filter both the count and the send");
check(/core\.ses_status\(d\.get\("overall", ""\), d\.get\("mailbox", ""\)\)/.test(mk), "saved SES verdicts are re-derived (rule fixes apply to paid checks)");
check(/v\["status"\] not in wanted/.test(mk) && /statuses: Object\.keys\(pick\)/.test(page), "import only the ticked statuses");
check(/data-testid=\{`mk-status-\$\{k\}`\}/.test(page), "campaign has Verified / Valid / Risky tick-boxes");

console.log("-- delete / bulk --");
check(/"\/campaigns\/bulk-delete"[\s\S]{0,120}Depends\(require_superadmin\)/.test(mk) && /"\/lists\/bulk-delete"[\s\S]{0,120}Depends\(require_superadmin\)/.test(mk),
    "bulk deletes are superadmin-only (POST does not auto-promote)");
check(/if reached:[\s\S]{0,200}"deleted": True/.test(mk) && /mk_sends\.delete_many\(\{"campaign_id": cid\}\)/.test(mk),
    "sent campaigns are archived (unsubscribe links keep working); only never-sent ones are hard-deleted");
check(/still sending — cancel it first/.test(mk), "a campaign that is sending can't be deleted");
check(/"deleted": \{"\$ne": True\}/.test(mk), "archived campaigns are hidden from lists and the dashboard");
check(/body\.action == "erase" and not is_superadmin/.test(mk), "bulk erase is superadmin-only");
check(/if n != body\.expected:/.test(mk) && /_contact_filter\(m\.get\("q"\)/.test(mk), "bulk on 'all matching' re-uses the page filter and must match the confirmed count");
check(/Type ERASE to confirm/.test(page), "bulk erase needs ERASE typed");

check(/role_ok = bool\(st\.get\("include_role_addresses"\)\)/.test(mk) && /role_ok=role_ok\)/.test(mk),
    "'treat role addresses as valid' really makes them valid (it used to do nothing)");
check(/"include_role_addresses": True/.test(mk) && /_bg\(_reapply_role_rule\(\)\)/.test(mk), "on by default; changing it re-rates saved contacts");

console.log("-- scoring + self-learning --");
check(/core\.score_address\(sig, adjust=adjust, thresholds=th, role_ok=role_ok\)/.test(mk), "the confidence score decides valid / risky / invalid");
check(/if v\["status"\] == "invalid":  /.test(mk.replace(/#.*$/gm, "")) || /if v\["status"\] == "invalid":/.test(mk), "SES 'mailbox does not exist' stays a hard fact, not a score");
check(/status = "unknown"[\s\S]{0,80}retried automatically/.test(mk) && /await domains_mx\(slow\)/.test(mk), "slow domain lookups are retried, never flagged risky");
check(/_probe_catch_all\(d\)/.test(mk) && /"catch_all_at": _iso\(\)/.test(mk) && /d in core\.WEBMAIL or/.test(mk), "catch-all tested once per company domain (90 days), never webmail");
check(/\$inc": \{"delivered_n": 1\}/.test(mk) && /dom not in core\.WEBMAIL/.test(mk), "domain delivery history counted per distinct address");
check(/doc\.update\(band=/.test(mk) && /score=100 if x\.get\("email_status"\) == "verified"/.test(mk), "what we believed is recorded on every send");
check(/core\.learn_adjustments\(/.test(mk) && /core\.calibrate_threshold\(/.test(mk) && /_bg\(learn_from_outcomes\(\)\)/.test(mk), "daily self-learning from outcomes");
check(/"\$lte": \(_now\(\) - timedelta\(days=1\)\)/.test(mk), "learning waits a day so late bounces are counted");
check(/data-testid="mk-accuracy"/.test(page) && /data-testid="mk-auto-learn"/.test(page), "accuracy panel + learning switch on screen");

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
