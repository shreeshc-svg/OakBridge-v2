/**
 * Upload safety: the wiring the Python unit tests cannot see.
 *
 *     node frontend/scripts/test-upload-safety.mjs
 *
 * backend/tests/test_uploads_guard.py proves the sniffers work. This proves
 * every intake actually CALLS them, and that the two serving-side holes are
 * closed. A guard module nothing imports is the most reassuring possible way to
 * have no protection at all.
 *
 * Each assertion corresponds to something that was really wrong:
 *
 *   an `or` between two attacker-chosen strings on the only public upload
 *   the stored file extension taken from the uploaded filename
 *   image/svg+xml passing startswith("image/"), then served back as itself
 *   .svg in the served-types map
 *   CVs on an unauthenticated URL with Cache-Control: public
 *   a direct file link to a CV mailed to the hiring inbox
 *   await file.read() with the size checked afterwards, on a 512MB instance
 *   two importers with no size limit at all
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(HERE, "..", "src");

let failed = 0;
const check = (cond, label) => {
    console.log(cond ? "ok   " : "FAIL ", label);
    if (!cond) failed++;
};

/* Read CODE, not the comments explaining it. Every file here documents this
   work at length and names "svg", "magic", "read_limited" repeatedly. */
const code = (abs) =>
    readFileSync(abs, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .split("\n")
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("*");
        })
        .join("\n");

const feat = code(join(ROOT, "backend", "features.py"));
const guard = code(join(ROOT, "backend", "uploads_guard.py"));
const server = code(join(ROOT, "backend", "server.py"));
const mailer = code(join(ROOT, "backend", "emailer.py"));
const careers = code(join(SRC, "pages", "admin", "AdminCareers.jsx"));
const apiJs = code(join(SRC, "lib", "api.js"));

console.log("-- nothing reads an upload without a cap --");
/* THE OUT-OF-MEMORY ONE. `await file.read()` materialises the whole body before
   any limit is consulted; on 512MB of RAM the process dies first. */
check(!/await (file|cv)\.read\(\)/.test(feat),
      "no bare await file.read() survives anywhere in features.py");
check((feat.match(/uploads_guard\.read_limited\(/g) || []).length >= 8,
      "every intake goes through read_limited — covers, photos, media, docs, eBooks, previews, "
      + "the CV, and BOTH spreadsheet importers, which had no limit at all");
check(/chunk = await file\.read\(CHUNK\)/.test(guard) && /if total > limit_bytes:/.test(guard),
      "and read_limited aborts mid-stream rather than checking afterwards");

console.log("\n-- a PDF has to be a PDF --");
/* The original bug: `if "pdf" not in ctype and not fname.endswith(".pdf")` —
   an `or` between two values the uploader writes. */
check(!/"pdf" not in ctype and not fname\.endswith/.test(feat),
      "the careers endpoint no longer decides from the filename and the declared type");
check(/uploads_guard\.require_pdf\(data, "CV"\)/.test(feat),
      "it checks the bytes instead");
check((feat.match(/uploads_guard\.require_pdf\(/g) || []).length >= 4,
      "and so do the eBook, preview and document intakes");
check(/PDF_MAGIC = b"%PDF-"/.test(guard), "against the real signature");
check(/uploads_guard\.require_pdf\([\s\S]{0,400}?import pypdfium2/.test(feat),
      "the preview check runs BEFORE pypdfium2 parses it — handing a rendering library the wrong "
      + "format is how a parser bug becomes a crash on the request thread");

console.log("\n-- SVG cannot get in --");
check(/uploads_guard\.require_image\(data/.test(feat), "images are sniffed, not trusted");
check((feat.match(/uploads_guard\.require_image\(/g) || []).length === 3,
      "on all three image endpoints: cover, author photo, media");
check(!/rsplit\("\.", 1\)\[-1\]\.lower\(\)\[:8\]/.test(feat),
      "and the stored extension no longer comes from the uploaded filename");
check(!/startswith\("image\/"\)/.test(feat),
      "the startswith('image/') test is gone — image/svg+xml passed it");
check(/_IMAGE_SIGNATURES/.test(guard) && !/svg/.test(guard.split("_IMAGE_SIGNATURES")[1].split(")")[0]),
      "images are a signature whitelist, so SVG fails by construction rather than by blacklist");

console.log("\n-- SVG cannot get out either --");
/* The other half: whatever is already sitting in the bucket. */
const imageTypesBlock = (feat.match(/_IMAGE_TYPES = \{[^}]*\}/) || [""])[0];
check(imageTypesBlock.length > 0 && !imageTypesBlock.includes("svg"),
      "no .svg in the served-types map");
check(/_NEVER_INLINE = \{/.test(feat),
      "and a downgrade list, because mimetypes knows .svg perfectly well on its own — "
      + "removing the entry alone would not have been enough");
check(/if resolved\.split\(";"\)\[0\]\.strip\(\)\.lower\(\) in _NEVER_INLINE:/.test(feat)
      && /return "application\/octet-stream"/.test(feat),
      "anything script-capable is served as a download instead of being rendered");
check(/ctype = _resolved_type\(""/.test(feat),
      "the local-disk branch resolves through the same function, or the defence exists only in "
      + "production and is missing from the one place anybody tests by hand");

console.log("\n-- CVs are not public --");
check(/_PRIVATE_SEGMENTS = \{"cv"\}/.test(feat), "the cv/ prefix is marked private");
check(/_PRIVATE_SEGMENTS & \{s\.lower\(\) for s in \(path or ""\)\.split\("\/"\)\}/.test(feat),
      "matched on the path SEGMENT, so no punctuation trick walks past it");
check(/status_code=404, detail="File not found"/.test(feat),
      "and refused as 404 — a 403 confirms the file exists, which is the fact being protected");
check(/@admin_router\.get\("\/job-applications\/\{app_id\}\/cv"\)/.test(feat),
      "the replacement route is on admin_router");
check(/dependencies=\[Depends\(require_admin\)\]/.test(feat),
      "which carries require_admin for everything under it");
check(/"Cache-Control": "private, no-store"/.test(feat),
      "and says private, no-store — the public proxy said public, max-age=86400 on personal data");
check(/media_type="application\/pdf"/.test(feat) && /Content-Disposition": f'attachment/.test(feat),
      "served as an attachment with a fixed type, so nothing the file claims about itself decides "
      + "how an admin's browser treats it");
check(/def _cv_filename/.test(feat) && /ch\.isalnum\(\) or ch in " -_"/.test(feat),
      "the filename is stripped — an applicant types their own name and it lands in a response header");

console.log("\n-- and the email stopped handing one out --");
check(!/cv_url/.test(mailer),
      "the hiring email does not touch cv_url at all — it used to build a direct link from it");
check(/cv_link = f"\{SITE_URL\}\/admin\/careers"/.test(mailer),
      "it points at the admin screen, which needs a session");

console.log("\n-- the admin screen can still fetch one --");
check(/adminDownloadCv/.test(apiJs) && /responseType: "blob"/.test(apiJs),
      "through the authenticated client, not an href — a browser sends no Authorization on a navigation");
check(/data-testid=\{`download-cv-\$\{a\.id\}`\}/.test(careers), "the row has a download control");
check(!/mediaUrl/.test(careers),
      "and the old public-URL helper is gone from the screen entirely, not merely unused");

console.log("\n-- the header that makes downloads work --");
/* Found while wiring the CV download: downloadBlob() reads the filename out of
   Content-Disposition, the API is a different origin from the site, and the
   header was never exposed — so every admin export has been saving under its
   hardcoded fallback name. */
check(/expose_headers=\["X-Search-Corrected-To", "Content-Disposition"\]/.test(server),
      "Content-Disposition is exposed to JavaScript, so downloadBlob can read the name the server chose");

console.log();
if (failed) {
    console.log(`${failed} assertion(s) failed`);
    process.exit(1);
}
console.log("all assertions passed");
