/**
 * Publishing-enquiry auto-reply with the Book Proposal Form attached.
 *     node frontend/scripts/test-publishing-enquiry.mjs
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const BE = join(HERE, "..", "..", "backend");
const strip = (s) => s.replace(/"""[\s\S]*?"""/g, '""').split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
/* Raw for the wording: the email body lives in a triple-quoted f-string, which
   strip() would remove along with the docstrings. */
const mailRaw = readFileSync(join(BE, "emailer.py"), "utf8");
const mail = strip(mailRaw);
const feat = strip(readFileSync(join(BE, "features.py"), "utf8"));
const server = strip(readFileSync(join(BE, "server.py"), "utf8"));
let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

check(/PUBLISHING_ENQUIRY_SUBJECT = "Thank You for Your Publishing Enquiry"/.test(mail), "subject exactly as specified");
check(mailRaw.includes('p("Dear Author,")') && mail.includes('("Duly filled Book Proposal Form", " – attached with this email.")')
      && mail.includes('("Sample Chapter", " of the proposed book for our editorial review.")')
      && mailRaw.includes('Editorial Team</strong><br>OakBridge Publishing Pvt. Ltd.'), "body carries the specified wording");
check(/attachments = \[\(PROPOSAL_FORM_NAME, fh\.read\(\)\)\]/.test(mail), "the form is attached");
let size = 0; try { size = statSync(join(BE, "assets", "Book_Proposal_Form.docx")).size; } catch {}
check(size > 10000, `the form ships with the backend (${size} bytes)`);
check(/await send_publishing_enquiry_reply\(doc\["email"\]\)/.test(feat), "every manuscript submission gets it");
check(!/await send_submission_ack\(doc\)/.test(feat), "instead of, not as well as, the old ack");
check(/== "manuscript submission":\s*\n\s*if await send_publishing_enquiry_reply/.test(server), "contact form: only the Manuscript Submission subject gets it");
check(/else:\s*\n\s*await send_contact_ack\(doc\)/.test(server), "every other contact subject keeps the ordinary ack");
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all assertions passed");
