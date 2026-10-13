/**
 * Sign-up consent (DPDP Act 2023) — wiring between the form and the server.
 *
 *     node frontend/scripts/test-signup-consent.mjs
 *
 * The failure modes: a pre-ticked box (not consent under s.6), marketing
 * bundled into the account consent, a server that creates the account when
 * the box was not ticked (an old cached bundle or a script never sends it),
 * or an account with no record of what was agreed and when.
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

const reg = code("frontend/src/pages/auth/Register.jsx");
const ext = code("backend/extensions.py");
const regFn = (ext.match(/async def register\([\s\S]*?\n(?=\n\S)/) || [""])[0];

console.log("-- the form --");
check(/useState\(false\);[\s\S]*?setAgreed/.test(reg) && /const \[agreed, setAgreed\] = useState\(false\)/.test(reg),
      "account consent box starts unticked");
check(/const \[marketing, setMarketing\] = useState\(false\)/.test(reg), "marketing box starts unticked");
check(/data-testid="register-consent"/.test(reg) && /data-testid="register-marketing"/.test(reg), "two separate boxes");
check(/to="\/terms"/.test(reg) && /to="\/privacy"/.test(reg), "both policies linked from the box");
check(/disabled=\{loading \|\| !agreed\}/.test(reg) && /if \(!agreed\) \{/.test(reg), "cannot submit without ticking");
check(/consent_account: true/.test(reg) && /email_marketing_optin: marketing/.test(reg), "both answers sent to the server");

console.log("-- the server --");
check(/consent_account: bool = False/.test(ext) && /email_marketing_optin: bool = False/.test(ext), "server defaults: no consent unless sent");
check(/if not payload\.consent_account:\s*raise HTTPException\(\s*status_code=400/.test(regFn), "no tick -> 400, no account");
const refuse = regFn.indexOf("if not payload.consent_account");
const insert = regFn.indexOf("db.users.insert_one");
check(refuse > 0 && insert > refuse, "the refusal comes before the account is created");
check(/"consents": _signup_consents\(payload, now\)/.test(regFn), "what was agreed is stored on the account");
check(/"policy_version": POLICY_VERSION/.test(ext) && /"at": now/.test(ext), "with the time and the policy version");
check(/if payload\.email_marketing_optin:\s*rec\["email_marketing"\]/.test(ext), "marketing consent recorded only when ticked");
check(/if doc\["email_marketing_optin"\]:[\s\S]*?on_newsletter\(email, "account sign-up"\)/.test(regFn),
      "marketing opt-in goes through the double opt-in newsletter path");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
