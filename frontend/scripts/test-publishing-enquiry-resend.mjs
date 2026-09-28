/**
 * Manual "Send proposal form" for messages and submissions already received.
 *     node frontend/scripts/test-publishing-enquiry-resend.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = (...p) => readFileSync(join(HERE, "..", "..", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"""[\s\S]*?"""/g, '""')
    .split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
const feat = strip(R("backend", "features.py")), server = strip(R("backend", "server.py")), audit = strip(R("backend", "audit.py"));
const msgs = strip(R("frontend", "src", "pages", "admin", "AdminMessages.jsx"));
const subs = strip(R("frontend", "src", "pages", "admin", "AdminSubmissions.jsx"));
const lib = strip(R("frontend", "src", "lib", "proposalForm.js"));
let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

check(/@admin_router\.post\("\/messages\/\{msg_id\}\/send-proposal-form"\)/.test(feat), "message endpoint (admin-gated router; 'messages' RBAC section)");
check(/@admin_router\.post\("\/submissions\/\{sub_id\}\/send-proposal-form"\)/.test(feat), "submission endpoint");
check(/if doc\.get\("proposal_sent_at"\) and not force:\s*\n\s*by = /.test(feat) && /status_code=409/.test(feat), "already sent -> 409 unless force");
check(/if not await send_publishing_enquiry_reply\(doc\["email"\]\):\s*\n\s*raise HTTPException\(status_code=502/.test(feat), "a failed send is reported, not recorded as sent");
check(/await audit_log\(\s*\n\s*db, PROPOSAL_FORM_SENT/.test(feat) && /PROPOSAL_FORM_SENT = "PROPOSAL_FORM_SENT"/.test(audit), "every manual send is audit-logged");
check(/proposal_sent_at: Optional\[str\] = None/.test(feat), "Submission model carries the sent fields (else response_model drops them)");
check(/"proposal_sent_by": "auto"/.test(feat) && /"proposal_sent_by": "auto"/.test(server), "the automatic intake send is recorded too, so a manual send cannot silently duplicate it");
check(/status === 409/.test(lib) && /window\.confirm\(formatApiError\(e\)\)/.test(lib) && /adminSendProposalForm\(kind, id, true\)/.test(lib), "UI asks before re-sending");
check(/data-testid=\{`message-send-form-\$\{m\.id\}`\}/.test(msgs) && !/manuscript submission/i.test(msgs), "button on EVERY message, not only the Manuscript Submission subject");
check(/data-testid=\{`submission-send-form-\$\{s\.id\}`\}/.test(subs), "button on every submission");
check(/proposalSentLabel\(m\)/.test(msgs) && /proposalSentLabel\(s\)/.test(subs), "rows show when and by whom it was sent");
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all assertions passed");
