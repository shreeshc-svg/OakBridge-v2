# CloudFront for site media + private bucket for CVs

Do the steps **in order**. Nothing changes on the live site until step 5 sets the two
media environment variables, and removing them is the rollback.

Placeholders — replace everywhere:

| Placeholder | Where to find it |
|---|---|
| `MAIN_BUCKET` | Render → Environment → `S3_BUCKET` |
| `REGION` | Render → `S3_REGION` (e.g. `ap-south-1`) |
| `PREFIX` | Render → `S3_PREFIX`. **If empty, delete `PREFIX/` from every path below.** |
| `PRIVATE_BUCKET` | the new bucket you create in step 2, e.g. `oakbridge-private-docs` |
| `ACCOUNT_ID` | AWS console, top-right account menu (12 digits) |
| `DISTRIBUTION_ID` | CloudFront, after step 3 (e.g. `E1ABCDEF23`) |
| `IAM_USER` | the IAM user whose access key Render uses (`AWS_ACCESS_KEY_ID`) |

Never paste access keys, secrets or the full bucket policy with real IDs into chat.

---

## 1. Audit the public folders (5 min)

From `backend/` on your machine, with the app's AWS credentials in the shell:

```powershell
python s3_housekeeping.py audit
```

Anything listed as `UNSAFE` (SVG/HTML/XML/JS in covers, media, authors, previews, docs,
events) — delete it or re-upload it through Admin before going further.

---

## 2. Private bucket for CVs (15 min)

**2a. Create the bucket** — S3 → Create bucket
- Name: `PRIVATE_BUCKET` · Region: `REGION`
- **Block all public access: ON** (all four boxes)
- Default encryption: **SSE-S3**
- Bucket versioning: off

**2b. Auto-delete rule (DPDP retention)** — the bucket → Management → Create lifecycle rule
- Name: `expire-cvs` · Scope: prefix `PREFIX/oakbridge/cv/`
- Action: **Expire current versions of objects** after **365** days (pick your period)
- Note: when a CV expires, its application row stays in Admin → Careers and the CV
  download for it will say "File not found". Delete old applications to match.

**2c. Let the app use it** — IAM → Users → `IAM_USER` → Add permissions → Create inline policy (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppPrivateDocs",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::PRIVATE_BUCKET/*"
    },
    {
      "Sid": "AppPrivateDocsList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::PRIVATE_BUCKET"
    }
  ]
}
```

**2d. Turn it on** — Render → Environment → add `S3_PRIVATE_BUCKET = PRIVATE_BUCKET` → deploy.
Render logs should then show `…private bucket for CVs: PRIVATE_BUCKET`. New CVs now go there;
old ones still download from the main bucket until moved.

**2e. Move existing CVs**

```powershell
$env:S3_PRIVATE_BUCKET="PRIVATE_BUCKET"
python s3_housekeeping.py move-cvs                    # dry run — lists them
python s3_housekeeping.py move-cvs --apply            # copy + verify
python s3_housekeeping.py move-cvs --apply --delete   # remove originals (only after the line above is clean)
```

Check: Admin → Careers → download one old CV and one new one. Both must work.

---

## 3. CloudFront distribution (20 min)

CloudFront → Create distribution
- **Origin domain:** `MAIN_BUCKET.s3.REGION.amazonaws.com` (the S3 REST endpoint — *not* the "website" endpoint)
- **Origin path:** `/PREFIX` (leave empty if `S3_PREFIX` is empty)
- **Origin access:** *Origin access control settings (recommended)* → Create new OAC → Sign requests: yes
- **Viewer protocol policy:** Redirect HTTP to HTTPS · **Allowed methods:** GET, HEAD
- **Cache policy:** `CachingOptimized`
- **Response headers policy:** create `oakbridge-media` (below) and select it
- **WAF:** off (optional) · **Price class:** North America, Europe, Asia, Middle East, and Africa (covers India)
- **Default root object:** leave empty

**Response headers policy `oakbridge-media`** — CloudFront → Policies → Response headers → Create
- Security headers: **X-Content-Type-Options: nosniff** (override on)
- Custom header: `Content-Security-Policy` = `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox` (override on)
- CORS: Access-Control-Allow-Origin = `https://www.oakbridge.in`, `https://oakbridge.in` · methods GET, HEAD · origin override on

**Second behavior for PDFs** — the distribution → Behaviors → Create behavior
- Path pattern: `/oakbridge/docs/*` · same origin, cache policy and HTTPS settings
- Response headers policy: create `oakbridge-docs` with **only** `X-Content-Type-Options: nosniff`
  (the `sandbox` CSP stops Chrome's built-in PDF viewer, so downloads on the Media page would break)

After it deploys (a few minutes), copy the distribution domain, e.g. `https://d1abcd2efgh3.cloudfront.net`.

---

## 4. Bucket policy on MAIN_BUCKET (10 min)

S3 → `MAIN_BUCKET` → Permissions:
- **Block public access: stays ON.** CloudFront with OAC does not need it off.
- Bucket policy → Edit. **If a policy already exists, ADD the statement below to its
  `Statement` list — do not replace the file** (other apps, e.g. the eReader, may rely on it).

```json
{
  "Sid": "CloudFrontReadsPublicMediaOnly",
  "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": [
    "arn:aws:s3:::MAIN_BUCKET/PREFIX/oakbridge/covers/*",
    "arn:aws:s3:::MAIN_BUCKET/PREFIX/oakbridge/media/*",
    "arn:aws:s3:::MAIN_BUCKET/PREFIX/oakbridge/authors/*",
    "arn:aws:s3:::MAIN_BUCKET/PREFIX/oakbridge/previews/*",
    "arn:aws:s3:::MAIN_BUCKET/PREFIX/oakbridge/docs/*",
    "arn:aws:s3:::MAIN_BUCKET/PREFIX/oakbridge/events/*"
  ],
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
    }
  }
}
```

No `s3:ListBucket`, and no `cv/` or `ebooks/` — CloudFront can read those six folders and nothing else.

**Test before step 5** (browser or `curl -I`):

| URL | Expected |
|---|---|
| `https://<cf-domain>/oakbridge/covers/<any cover file>` | 200, image |
| `https://<cf-domain>/oakbridge/cv/anything.pdf` | 403 |
| `https://<cf-domain>/oakbridge/ebooks/anything.pdf` | 403 |
| `https://<cf-domain>/` | 403 (no listing) |

(A cover filename: open any book page, right-click the cover → copy image address, take the part after `/api/files/`.)

---

## 5. Point the site at CloudFront

- **Vercel** → Project → Settings → Environment Variables → `REACT_APP_MEDIA_BASE = https://<cf-domain>` (Production) → **Redeploy** (it is baked in at build time).
- **Render** → Environment → `PUBLIC_MEDIA_URL = https://<cf-domain>` → deploy (email images).

**Check:** open the homepage → right-click any cover → the address now starts with the CloudFront domain.
Admin → Careers CV download still works (it never goes through CloudFront).

**Rollback:** delete both variables and redeploy. Every image falls back to `api.oakbridge.in/api/files/…` as before.

---

## Later: removing an image immediately

CloudFront caches files. New uploads get new names, so replacing an image is instant. To make a
*deleted* image disappear before the cache expires: CloudFront → the distribution → Invalidations →
Create → path `/oakbridge/media/<file>` (or `/*`).
