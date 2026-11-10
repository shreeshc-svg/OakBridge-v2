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
const cal = read("src/pages/hrm/HrmCalendar.jsx");
check(cal.includes('data-testid="hrm-day-info"') && cal.includes('role="grid"') && cal.includes("DayEditor"), "month calendar: click a day for its info; HR edits holidays on the day");
check(/weeklyOffReason/.test(cal) && cal.includes("(d.getDay() + 6) % 7"), "weekly offs computed Mon=0 like the server");
const leave = read("src/pages/hrm/HrmLeave.jsx");
const home = read("src/pages/hrm/HrmHome.jsx");
const bits = read("src/pages/hrm/HrmBits.jsx");
check(leave.includes("export function BalanceCards") && home.includes("<BalanceCards s={s} />") && leave.includes("<Ring "), "home shows remaining leave as rings, one colour per type");
check(home.includes('data-testid="hrm-hr-kpis"') && /me\.hr && \(/.test(home), "HR / founders get a different home (company at a glance)");
check(home.includes('data-testid="hrm-next-holiday"') && home.includes("Coming up") && home.includes("greet()"), "employee home: greeting, next-holiday countdown, coming-up timeline");
check(leave.includes('data-testid="hrm-leave-views"') && leave.includes('["tools", "HR tools"]'), "Leave split into My leave / Approvals / HR tools");
check(hrm.includes("Emp ID") && hrm.includes("r.emp_code"), "employee ID shown in People");
check(hrm.includes("useState(person ? !!person.confirmed_on : true)") && hrm.includes("confirmed ? (f.confirmed_on || f.joined_on)"),
      "new people default to confirmed; confirmed without a date = from joining");
check(hrm.includes('data-testid="hrm-confirm-all"'), "one click to confirm everyone without a date");
check(hrm.includes('data-testid="hrm-own-weekly-off"') && read("src/pages/hrm/HrmLeave.jsx").includes('data-testid="hrm-set-balance"'),
      "super admin: per-person weekly off + set exact balances");
check(bits.includes("hrmPhotoBlob") && bits.includes("URL.createObjectURL"), "photos fetched with the sign-in token (not a public URL)");
const reset = read("src/pages/auth/ResetPassword.jsx"), login = read("src/pages/auth/Login.jsx");
check(reset.includes('sp.get("next")') && login.includes("/^\\/(?!\\/)/.test(nextParam)"), "invite -> set password -> sign in lands in the HRM; ?next only accepts a path on this site");
const goals = read("src/pages/hrm/HrmGoals.jsx");
check(hrm.includes('["goals", "Goals", Target]') && hrm.includes("<GoalsTab me={me} />"), "Goals tab for everyone");
check(goals.includes('data-testid="hrm-goal-editor"') && goals.includes("must be 100%") && goals.includes('data-testid="hrm-quarters"'),
      "goal editor with 100% weights; four quarter panels");
check(goals.includes("p.can.checkin") && goals.includes("p.can.review") && goals.includes("p.can.rate"), "actions follow what the server allows");
check(goals.includes("ye?.pending") && goals.includes("Release ${fy} ratings"), "rating hidden until HR releases it");
const hiring = read("src/pages/hrm/HrmHiring.jsx");
check(hrm.includes('...(me.hiring ? [["hiring", "Hiring", Briefcase]] : [])'), "Hiring tab only for HR and assigned hiring managers");
check(hiring.includes('data-testid="hrm-mark-joined"') && hiring.includes("hiringJoin(c.id, f)"), "Offer -> Mark as joined creates the employee");
check(hiring.includes("hiringCv(c.id)") && hiring.includes("URL.createObjectURL"), "CVs open through the signed-in HRM, not a public link");
check(hrm.includes("<LifecyclePanel person={person}") && hrm.includes("forms can't nest"), "onboarding / exit panel outside the person form");
check(hiring.includes('data-testid="hrm-record-exit"') && hiring.includes("encashment"), "exit: last day, reason, EL encashment");
check(hrm.includes("Leaving {fmt(r.exited_on)}"), "People shows who is leaving and when");
check(!/window\.prompt/.test(leave) && !/window\.prompt/.test(goals) && leave.includes('data-testid="hrm-decide-panel"') && goals.includes('data-testid="hrm-goals-sendback"'),
      "no browser pop-ups for reject reasons / certificate / bereavement days / sending goals back — inline panels");
check(hrm.includes('data-testid="hrm-person-tabs"') && hrm.includes('["lifecycle", "Onboarding & exit"]'), "person editor split into Details / Onboarding & exit");
check(leave.includes('data-testid="hrm-apply-preview"') && leave.includes("preview: true") && leave.includes("left after"), "apply shows 'uses N days (M left after)' before submitting");
check(goals.includes("const [expanded, setExpanded] = useState(current)") && goals.includes('${expanded ? "block" : "hidden"} md:block'),
      "goals on phones: current quarter open, others folded");
const admin = read("src/pages/admin/AdminLayout.jsx"), header = read("src/components/Header.jsx"), account = read("src/pages/Account.jsx");
check((admin.match(/<HrmShortcut /g) || []).length === 2 && header.includes('data-testid="header-hrm-link"') && account.includes("<HrmShortcut "),
      "one-click 'My HRM' in the admin sidebar (desktop + phone), the account menu and My Account");
check(read("src/lib/hrmAccess.js").includes("isPrerender()"), "HRM shortcut never rendered during prerender");
const api = read("src/lib/api.js");
check(["hiringList", "hiringEdit", "hiringFeedback", "hiringCv", "hiringJoin", "hrmLifecycle", "hrmChecklist", "hrmExit", "hrmExitCancel"]
    .every((f) => api.includes(`export const ${f} =`)), "hiring / lifecycle api");
check(["goalsPlan", "goalsSaveDraft", "goalsSubmit", "goalsDecide", "goalsCheckin", "goalsReview", "goalsRate", "goalsTeam", "goalsRelease"]
    .every((f) => api.includes(`export const ${f} =`)), "goals api");
check(["hrmPhotoBlob", "hrmUploadPhoto", "leaveSummary", "leaveApply", "leaveDecide", "leaveExport"].every((f) => api.includes(`export const ${f} =`)), "leave + photo api");
check(["hrmMe", "hrmPeople", "hrmAddPerson", "hrmEditPerson", "hrmInvite", "hrmCalendar", "hrmSaveCalendar", "hrmSettings", "hrmSaveSettings"]
    .every((f) => api.includes(`export const ${f} =`)), "api functions");
check(leave.includes('data-testid="hrm-no-optional"') && leave.includes("optBlocked") && leave.includes("o.name ?"),
      "optional holiday: named options; explains an empty list / used quota instead of an empty dropdown");
const appr = read("src/pages/hrm/HrmAppraisal.jsx");
check(hrm.includes('["appraisal", "Appraisal", Award]') && hrm.includes("<AppraisalTab me={me} />"), "Appraisal tab for everyone");
check(["appraisalCycle", "appraisalStart", "appraisalMine", "appraisalTeam", "appraisalGet", "appraisalSaveSelf", "appraisalSaveManager",
    "appraisalSaveHr", "appraisalRelease", "appraisalReopen", "appraisalAck", "appraisalLetter"].every((f) => api.includes(`export const ${f} =`)), "appraisal api");
check(appr.includes("a.can.self") && appr.includes("a.can.manager") && appr.includes('a.role === "hr"'), "appraisal actions follow what the server allows");
check(appr.includes("Math.floor((c * (1000 + p10) + 500) / 1000)"), "revised-CTC preview: whole-number maths, half up, same as the server");
check(appr.includes('role="radiogroup"') && appr.includes("{scale[n]}"), "ratings picked as words, not numbers");
check(!/window\.prompt/.test(appr) && appr.includes('data-testid="hrm-appraisal-ack"'), "acknowledge / disagree inline, no prompt()");
check(!/ctc/i.test(appr.split("function ManagerForm")[1].split("function ManagerView")[0]), "the manager's form never touches CTC");
check(home.includes('data-testid="hrm-home-appraisal"') && home.includes("useMyAppraisal(!!me.me)"), "home banner when the self-review is open / result ready");

console.log(failed ? `\n${failed} assertion(s) failed` : "\nall assertions passed");
process.exit(failed ? 1 : 0);
