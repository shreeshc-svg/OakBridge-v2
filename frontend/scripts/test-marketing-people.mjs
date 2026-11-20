/**
 * "Who got which email" — the Campaigns page wiring (backend: marketing_people.py,
 * behaviour tested in backend/tests/test_marketing_people.py).
 *
 *     node frontend/scripts/test-marketing-people.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const mk = readFileSync(join(SRC, "pages/admin/AdminMarketing.jsx"), "utf8");
const api = readFileSync(join(SRC, "lib/api.js"), "utf8");
let failed = 0;
const check = (c, l) => { console.log((c ? "ok   " : "FAIL ") + l); if (!c) failed += 1; };

check(/api\.get\("\/admin\/marketing\/people", \{ params: \{ q \} \}\)/.test(api)
    && /campaigns\/\$\{id\}\/recipients`, \{ params \}/.test(api) && /sends\/\$\{sendId\}\/email`/.test(api), "api: people / recipients / email-as-sent");
const list = mk.slice(mk.indexOf("function CampaignList("), mk.indexOf("function CampaignView("));
check(/<PeopleSearch onOpen=\{onOpen\} \/>/.test(list), "global people search at the top of the Campaigns page");
check(/\{!editable && <CampaignRecipients id=\{id\} \/>\}/.test(mk), "every sent campaign has a searchable Recipients panel");
const ps = mk.slice(mk.indexOf("function PeopleSearch("), mk.indexOf("function CampaignRecipients("));
check(/useDebounced\(q, 300\)/.test(ps) && /t\.length < 2/.test(ps) && /n === seq\.current/.test(ps),
    "search waits for typing to pause, needs 2+ characters, and only the latest answer is shown");
check(/sandbox=""/.test(mk.slice(mk.indexOf("function EmailModal("), mk.indexOf("function SendRow("))), "the email is shown in a sandboxed frame (no scripts, no clicks out)");
const rec = mk.slice(mk.indexOf("function CampaignRecipients("), mk.indexOf("function CampaignView("));
check(/setPage\(1\)/.test(rec) && /outcome/.test(rec) && /pages > 1/.test(rec), "recipients: search + outcome filter + pages");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
