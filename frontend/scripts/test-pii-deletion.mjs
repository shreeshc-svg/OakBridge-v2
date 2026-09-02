/**
 * Deleting a job application, and deleting a waitlist signup.
 *
 *     node frontend/scripts/test-pii-deletion.mjs
 *
 * The failure mode here is a delete that looks like it worked. A CV lives in
 * the object store, not in Mongo, at a /api/files/ URL that keeps resolving
 * after the row is gone — so removing only the record leaves a stranger's name,
 * phone number and work history downloadable by anyone holding the link. The
 * admin sees the row vanish and believes the data is gone. Under DPDP that is
 * not a deletion, it is a broken index.
 *
 * Everything below exists to keep the file and the row dying together.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BE = join(HERE, "..", "..", "backend");
const SRC = join(HERE, "..", "src");
const feat = readFileSync(join(BE, "features.py"), "utf8");
const api = readFileSync(join(SRC, "lib", "api.js"), "utf8");
const careers = readFileSync(join(SRC, "pages", "admin", "AdminCareers.jsx"), "utf8");
const wait = readFileSync(join(SRC, "pages", "admin", "AdminWaitlists.jsx"), "utf8");

let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

const fn = (name) => {
    const i = feat.indexOf(`async def ${name}`);
    if (i < 0) return "";
    const j = feat.indexOf("\n@admin_router", i + 1);
    return feat.slice(i, j > 0 ? j : i + 3000);
};
const delApp = fn("admin_delete_job_application");
const delWait = fn("admin_delete_waitlist_entry");

console.log("-- the CV file dies with the row --");
check(feat.includes("def delete_object(path: str) -> bool:"), "the storage layer can delete, not only write and read");
check(/_s3\(\)\.delete_object\(Bucket=S3_BUCKET/.test(feat) && /os\.remove\(full\)/.test(feat),
      "both branches — the S3 bucket and the local-disk fallback");
check(feat.includes("def storage_path_from_url"),
      "and the URL stored on the row is converted back to an object key in one place, not per call site");
check(delApp.includes("delete_object(storage_path_from_url(doc.get(\"cv_url\", \"\")))"),
      "the delete endpoint actually calls it");
check(delApp.indexOf("delete_object") < delApp.indexOf("db.job_applications.delete_one"),
      "file first, row second — if the row went first a failure would orphan the PDF with nothing pointing at it");
check(/Never raises/.test(feat.slice(feat.indexOf("def delete_object"), feat.indexOf("def delete_object") + 1200)),
      "a missing file or a flaky bucket cannot block the row from being deleted");
check(delApp.includes('"cv_file_removed": file_removed'),
      "and the audit row records whether the file really went, since the two can diverge");

console.log("\n-- no tombstone, deliberately --");
check(!/deleted_job_applications|deleted_waitlist/.test(feat),
      "neither delete copies the record sideways first");
check(delApp.includes("NO TOMBSTONE, DELIBERATELY"),
      "and the reason is written down — this differs from how users and submissions are removed");
check(/audit_log\(\s*db, "JOB_APPLICATION_DELETED"/.test(delApp),
      "accountability comes from the audit trail instead: who deleted what, when");
check(/audit_log\(\s*db, "WAITLIST_ENTRY_DELETED"/.test(delWait), "same for a signup removal");

console.log("\n-- superadmin only, on both --");
for (const [name, body] of [["job application", delApp], ["waitlist entry", delWait]]) {
    check(body.includes("actor: dict = Depends(require_superadmin)"), `${name}: endpoint demands superadmin`);
}
check(careers.includes("const mayDelete = canDelete(me);") && wait.includes("const mayDelete = canDelete(me);"),
      "and both screens hide the control from anyone who cannot use it");

console.log("\n-- a misclick is hard, and its consequence is stated --");
check(/window\.confirm\([\s\S]{0,220}permanently deletes their CV file/.test(careers),
      "the CV confirmation says the file goes too, not just 'are you sure?'");
check(/window\.confirm\(`Remove \$\{e\.email\}/.test(wait),
      "and the signup confirmation names the address, since the rows look alike");
check(careers.includes("disabled={busyId === a.id}") && wait.includes("disabled={busyId === e.id}"),
      "the button disables while in flight, so a double-click cannot fire twice");

console.log("\n-- the list stays honest afterwards --");
check(wait.includes("summary: (cur.summary || []).map("),
      "removing a signup decrements the source count above the table, or it reads 42 beside 41 rows");
check(/colSpan=\{mayDelete \? 4 : 3\}/.test(wait),
      "the empty-state colSpan follows the column count, which changes with the delete column");
check(api.includes("adminDeleteJobApplication") && api.includes("adminDeleteWaitlistEntry"),
      "both client functions exist");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
