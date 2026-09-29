/**
 * CloudFront media: public folders rewritten, private folders never.
 *     node frontend/scripts/test-media-base.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(HERE, "..", "src", "lib", "api.js"), "utf8");
const mail = readFileSync(join(HERE, "..", "..", "backend", "emailer.py"), "utf8");
let failed = 0;
const check = (c, l) => { console.log(c ? "ok   " : "FAIL ", l); if (!c) failed++; };

// Rebuild mediaUrl from the real source with the two env values injected.
const src = api.slice(api.indexOf("const MEDIA_BASE"), api.indexOf("return `${BACKEND_URL}${u}`;\n};") + 32);
const make = (base) => new Function("process", "BACKEND_URL", src.replace(/export /g, "") + "\nreturn mediaUrl;")(
    { env: { REACT_APP_MEDIA_BASE: base } }, "https://api.oakbridge.in");
const on = make("https://d111.cloudfront.net/"), off = make("");

check(on("/api/files/oakbridge/covers/a.jpg") === "https://d111.cloudfront.net/oakbridge/covers/a.jpg", "cover -> CloudFront");
for (const f of ["media", "authors", "previews", "docs", "events"])
    check(on(`/api/files/oakbridge/${f}/x.webp`).startsWith("https://d111.cloudfront.net/"), `${f}/ -> CloudFront`);
check(on("/api/files/oakbridge/cv/x.pdf") === "https://api.oakbridge.in/api/files/oakbridge/cv/x.pdf", "cv/ NEVER goes to CloudFront");
check(on("/api/files/oakbridge/ebooks/b/x.pdf").startsWith("https://api.oakbridge.in/"), "ebooks/ NEVER goes to CloudFront");
check(on("/api/files/oakbridge/coversX/a.jpg").startsWith("https://api.oakbridge.in/"), "folder match is exact, not a prefix trick");
check(off("/api/files/oakbridge/covers/a.jpg") === "https://api.oakbridge.in/api/files/oakbridge/covers/a.jpg", "unset = unchanged (rollback)");
check(on("https://images.unsplash.com/x") === "https://images.unsplash.com/x" && on("") === "", "absolute and empty untouched");
check(/_PUBLIC_MEDIA_RE = re\.compile\(r"\^\/api\/files\/oakbridge\/\(covers\|media\|authors\|previews\|docs\|events\)\/"\)/.test(mail),
      "emails use the same allowlist");
// Private bucket for CVs (backend/features.py).
const feat = readFileSync(join(HERE, "..", "..", "backend", "features.py"), "utf8");
check(/S3_PRIVATE_BUCKET = \(os\.environ\.get\("S3_PRIVATE_BUCKET"\)/.test(feat), "private bucket is configurable");
check(/Bucket=_bucket_for\(path\),/.test(feat), "uploads choose the bucket by path");
check(/extra\["ServerSideEncryption"\] = "AES256"/.test(feat), "CVs are written encrypted");
check(/if bucket != S3_BUCKET and code in \("NoSuchKey", "NotFound", "404"\):/.test(feat), "old CVs still download before migration");
check(/if _bucket_for\(path\) != S3_BUCKET:\s*\n\s*_s3\(\)\.delete_object\(Bucket=S3_BUCKET/.test(feat), "deleting a CV clears both buckets");
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all assertions passed");
