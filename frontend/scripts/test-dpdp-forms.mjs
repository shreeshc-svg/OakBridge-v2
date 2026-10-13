/**
 * DPDP consent and notices on every public form, and the upload defences —
 * wiring between the screens and the server.
 *
 *     node frontend/scripts/test-dpdp-forms.mjs
 *
 * Behaviour of the file checks is tested on real hostile files in
 * backend/tests/test_upload_safety.py; headers in test_security_headers.py.
 * This pins that each form asks, sends, and that the server refuses/records.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Comments and docstrings stripped so no check can pass by matching prose.
const code = (p) =>
    readFileSync(join(ROOT, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(/^\s*#.*$/gm, "");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

const feat = code("backend/features.py");
const srv = code("backend/server.py");
const ext = code("backend/extensions.py");
const api = code("frontend/src/lib/api.js");
const fn = (src, name) => (src.match(new RegExp(`async def ${name}\\([\\s\\S]*?\\n(?=\\n\\S)`)) || [""])[0];

console.log("-- checkout --");
const co = code("frontend/src/pages/Checkout.jsx");
check(/consent_terms: agreed/.test(co), "checkout sends the tick with the order");
check(/consent_terms: Optional\[bool\] = None/.test(srv) && /if payload\.consent_terms is False:\s*raise HTTPException\(status_code=400/.test(srv),
      "server refuses an order sent with the box unticked");
check(/doc\["consents"\] = _checkout_consents\(payload, doc\["created_at"\]\)/.test(fn(srv, "create_order")), "the consent is stored on the order");

console.log("-- careers --");
const car = code("frontend/src/pages/Careers.jsx");
const apply = fn(feat, "apply_for_job");
check(/const \[agreed, setAgreed\] = useState\(false\)/.test(car) && /data-testid="careers-consent"/.test(car) && /disabled=\{submitting \|\| !agreed\}/.test(car),
      "careers: unticked box, cannot submit without it");
check(/consent: agreed, \.\.\.shield\(\)/.test(car) && /<HoneypotField/.test(car) && /form\.append\("consent"/.test(api) && /form\.append\("form_ms"/.test(api),
      "careers sends the tick and the bot-screen fields");
check(/await screen\(request, kind="careers"/.test(apply) && apply.indexOf("screen(") < apply.indexOf("read_limited("),
      "careers: bots screened (honeypot, timing, rate limit) before the upload is read");
check(/if not consent:\s*raise HTTPException\(status_code=400/.test(apply) && apply.indexOf("if not consent") < apply.indexOf("put_object("),
      "careers: no tick, nothing stored");
check(/uploads_guard\.require_safe_pdf\(data, "CV"\)/.test(apply), "CV: real PDF with nothing that can run, not encrypted");
check(/doc\["consent"\] = \{"given": True/.test(apply), "careers: consent stored with the application");

console.log("-- submissions --");
const sub = code("frontend/src/pages/Submissions.jsx");
check(/data-testid="sub-consent"/.test(sub) && /consent: agreed/.test(sub) && /disabled=\{submitting \|\| !agreed\}/.test(sub), "submissions: box, sent, required");
check(/consent: bool = False/.test(feat) && /if not payload\.consent:\s*raise HTTPException\(status_code=400/.test(fn(feat, "create_submission")),
      "submissions: server refuses without the tick");

console.log("-- notices where a tick is not needed --");
check(/data-testid="contact-privacy-notice"/.test(code("frontend/src/pages/Contact.jsx")), "contact form says what the details are for");
check(/data-testid="waitlist-privacy-notice"/.test(code("frontend/src/pages/ComingSoon.jsx")), "waitlists say it is not the newsletter");
check(/data-testid="notify-privacy-notice"/.test(code("frontend/src/pages/BookDetail.jsx")) && /to="\/privacy"/.test(code("frontend/src/components/BookCard.jsx")),
      "notify-me (book page and cards)");
check(/data-testid="review-privacy-notice"/.test(code("frontend/src/components/ReviewsSection.jsx")), "reviews say the name is public");

console.log("-- existing accounts --");
const notice = code("frontend/src/components/PolicyUpdateNotice.jsx");
check(/policy_update_due: bool = False/.test(ext) && /def _policy_update_due/.test(ext), "server flags customers whose agreement predates the policy");
check(/return public_user\(user\)/.test(fn(ext, "me")) && /AuthResponse\(user=public_user\(user\)/.test(ext), "/auth/me and login share one shape");
check(/@auth_router\.post\("\/policy-consent"/.test(ext) && /if not payload\.agree:/.test(ext), "agreeing is recorded server-side and needs the tick");
check(/user\.policy_update_due/.test(notice) && /authPolicyConsent\(\)/.test(notice) && /disabled=\{!agreed \|\| busy\}/.test(notice),
      "the notice shows only when due and can't be saved unticked");
check(/<PolicyUpdateNotice \/>/.test(code("frontend/src/components/Layout.jsx")), "mounted on every public page");

console.log("-- uploads and headers --");
check(/require_safe_pdf\(data, "eBook", allow_encrypted=True\)/.test(feat) && /require_safe_archive\(data, "File", office=ext != "zip"\)/.test(feat)
      && /require_safe_ole\(data, "File"\)/.test(feat), "eBooks and public downloads: nothing that can run");
check((feat.match(/require_not_zip_bomb\(/g) || []).length === 2 && /require_not_zip_bomb\(data, "File"\)/.test(code("backend/marketing.py")),
      "every spreadsheet import is checked for zip bombs");
check(/refuse_if_infected, path, "CV"/.test(feat) && /refuse_if_infected, book\["ebook_path"\]/.test(feat), "virus-scan tag honoured on CV and eBook downloads");
check(/app\.add_middleware\(SecurityHeadersMiddleware\)/.test(srv) && /docs_url="\/docs" if _API_DOCS else None/.test(srv),
      "API: security headers on, docs off unless API_DOCS=on");
const vercel = JSON.parse(readFileSync(join(ROOT, "frontend/vercel.json"), "utf8"));
const vh = Object.fromEntries((vercel.headers?.[0]?.headers || []).map((h) => [h.key, h.value]));
check(vh["X-Content-Type-Options"] === "nosniff" && vh["X-Frame-Options"] === "SAMEORIGIN" && /frame-ancestors 'self'/.test(vh["Content-Security-Policy"] || ""),
      "website: nosniff and no framing by other sites");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
