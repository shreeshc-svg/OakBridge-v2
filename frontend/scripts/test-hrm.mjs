/**
 * HRM release 1 wiring: the /hrm screen, private and server-gated.
 *
 *     node frontend/scripts/test-hrm.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };

const app = read("src/App.js");
check(/path="\/hrm"[\s\S]{0,200}<ProtectedRoute>[\s\S]{0,60}HrmApp/.test(app), "/hrm needs a signed-in account (any role; server decides access)");
check(read("public/robots.txt").includes("Disallow: /hrm"), "robots: /hrm not crawled");
const hrm = read("src/pages/hrm/HrmApp.jsx");
check(hrm.includes('<NoIndex title="HRM" />'), "noindex on every branch that renders a page");
check(/me\.hr \|\| me\.manager \? \[\["people"/.test(hrm) && /me\.hr \? \[\["settings"/.test(hrm), "People tab for HR/managers, Settings for HR only");
check(!/\b(pan|aadhaar|bank|ifsc)\b/i.test(hrm.replace(/no ID numbers, documents or bank details/g, "")), "no ID / bank fields in the HRM screens");
check(hrm.includes('data-testid="hrm-date-words"') && hrm.includes('data-testid="hrm-form-error"') && hrm.includes("if (dateError) { setError(dateError); return; }"),
      "dates shown in words; date and server errors shown inside the form, not only as a pop-up");
const api = read("src/lib/api.js");
check(["hrmMe", "hrmPeople", "hrmAddPerson", "hrmEditPerson", "hrmInvite", "hrmCalendar", "hrmSaveCalendar", "hrmSettings", "hrmSaveSettings"]
    .every((f) => api.includes(`export const ${f} =`)), "api functions");

console.log(failed ? `\n${failed} assertion(s) failed` : "\nall assertions passed");
process.exit(failed ? 1 : 0);
