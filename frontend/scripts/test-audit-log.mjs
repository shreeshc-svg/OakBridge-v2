/**
 * The system audit log.
 *
 *     node frontend/scripts/test-audit-log.mjs
 *
 * Three ways an audit trail betrays you, and all three are silent.
 *
 * It records a secret, and becomes a second copy of the thing you were
 * protecting. It leaks who exists — a failed sign-in that says "no such user"
 * turns the log into an account-enumeration oracle for anyone who can read it.
 * Or it is readable by people who should not read it: these rows carry customer
 * email addresses, and an editor who writes book descriptions has no business
 * knowing who signed in this morning.
 *
 * None of those show up as a broken page. They show up in a breach report.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const BE = join(HERE, "..", "..", "backend");
const audit = readFileSync(join(BE, "audit.py"), "utf8");
const feat = readFileSync(join(BE, "features.py"), "utf8");
const ext = readFileSync(join(BE, "extensions.py"), "utf8");
const rbacPy = readFileSync(join(BE, "rbac.py"), "utf8");
const page = readFileSync(join(SRC, "pages", "admin", "AdminAudit.jsx"), "utf8");
const rbacJs = readFileSync(join(SRC, "lib", "rbac.js"), "utf8");
const nav = readFileSync(join(SRC, "lib", "adminNav.js"), "utf8");

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

console.log("-- it cannot become a copy of your secrets --");
check(/_SENSITIVE = \("password", "token", "secret", "otp", "card", "cvv", "authorization"\)/.test(audit),
      "credential-ish keys are stripped from meta, whatever a caller passes");
check(audit.includes("if any(s in key.lower() for s in _SENSITIVE)"),
      "matched as substrings, so new_password and reset_token are caught too");
check(/len\(v\) > 400/.test(audit),
      "and values are truncated, so one pathological payload cannot bloat a row kept forever");

console.log("\n-- a failed sign-in does not reveal whether the account exists --");
check(ext.includes('await audit_log(db, LOGIN_FAILED, email=email, meta={"reason": "invalid credentials"})'),
      "one reason for both branches: no such user and wrong password log identically");
check(!/LOGIN_FAILED[\s\S]{0,200}(no such user|unknown email|user not found)/i.test(ext),
      "nothing in the failure path distinguishes the two cases");

console.log("\n-- writing the log can never break the thing it records --");
check(/async def audit_log[\s\S]*?except Exception:[\s\S]*?logger\.exception/.test(audit),
      "every write is wrapped — a failed insert must not cost someone their login");
check(audit.includes("Never raises"), "and that is stated where the next person will read it");

console.log("\n-- superadmin only, enforced twice --");
check(feat.includes("actor: dict = Depends(require_superadmin),"),
      "the endpoint itself demands superadmin — this is the real gate");
check(/"audit",/.test(rbacPy.slice(rbacPy.indexOf("SUPERADMIN_ONLY_PATHS"), rbacPy.indexOf("SUPERADMIN_ONLY_PATHS") + 1200)),
      "and `audit` is in SUPERADMIN_ONLY_PATHS, so a staff sidebar never offers the link");
check(rbacJs.includes('audit: "Audit Logs"') && /"audit"/.test(rbacJs),
      "the section exists front-side too, or the front/back parity check fails the build");
check(nav.includes('{ to: "/admin/audit", label: "Audit Logs"'), "and the sidebar entry resolves to a real route");

console.log("\n-- payment history is merged, not migrated --");
check(audit.includes("def payment_event_to_row"),
      "payment_events is normalised at read time into the same shape");
check(feat.includes('db["payment_events"].find(pay_q'),
      "the endpoint reads both collections");
check(!/payment_events[\s\S]{0,120}(update_many|delete_many|insert_one)/.test(feat.slice(feat.indexOf("async def admin_audit"), feat.indexOf("async def admin_search_logs"))),
      "and never writes to payment_events — that is the record of money, not this screen's to touch");
check(feat.includes('res = await db[AUDIT_EVENTS].delete_many({"at": {"$lt": before}})'),
      "the purge targets the audit collection only");

console.log("\n-- retention is a decision you can revisit --");
check(feat.includes('detail="Pass ?before=YYYY-MM-DD. Refusing to purge without a cut-off date.",'),
      "purging without a cut-off date is refused, so 'delete everything' cannot happen by accident");
check(feat.includes('await audit_log(\n        db, "AUDIT_PURGED"'),
      "and the purge itself is logged — the one action that edits the log leaves a mark");

console.log("\n-- the reader can find things --");
check(/period: str = "all"/.test(feat), "period filter: all / today / week / month");
check(feat.includes('"capped": len(rows) >= CAP or len(pay) >= CAP'),
      "the response says when the count is a floor rather than the whole history");
check(page.includes('data.capped ? "showing the most recent " : ""'),
      "and the screen says so rather than presenting a truncated total as complete");
check(page.includes('setFilter(() => setPeriod(p.key))'),
      "changing a filter resets to page 1, so a stale page number cannot render an empty table");
check(page.includes("(data?.actions || []).map"),
      "the action filter is built from what is actually present, so it cannot offer an empty result");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
