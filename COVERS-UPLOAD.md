# Leftover covers — upload manifest

Prepared 21 Jul 2026 from `Desktop/27 leftover covers` + `27 leftover covers.xlsx`.

**All 16 supplied covers staged** in `backend/storage/oakbridge/covers/` (gitignored — never
committed). Every mapping was confirmed by **looking at the cover art**, not by trusting the
filename — which is how the two problems below were found.

## Ready to upload — 16 files

| ISBN | Title | Source file |
|---|---|---|
| 9788197939266 | Treatise on the POSH Act | Dhana Madhri Guruswamy Treatise on POSH Act Front |
| 9788198751225 | A Commentary on the POSH Act, 2013 | Khandelwal POSH Act Front |
| 9788198751249 | The Journey To The Earth of A Star | WhatsApp … 1.01.39 PM (2) |
| 9788198751256 | Insights into the Unified Waqf Management Act | Khandelwal WAQF front |
| 9788198874085 | Balance Sheet of the Soul (2/e) | WhatsApp … 1.01.39 PM (3) |
| 9788199305205 | Guardians of the Boardroom | WhatsApp … 1.01.39 PM (1) |
| 9788199624511 | Sashakt Nari Viksit Bharat | WhatsApp … 1.01.38 PM |
| 9788199624597 | The Union of States | WhatsApp … 1.01.39 PM |
| **9789389176704** | **Constitution and its Making** | **Front cover Vijayaraghavan Musings … — see below** |
| 9789389176650 | GES Periodos Vol II | WhatsApp … 1.01.39 PM (7) |
| 9789391032906 | GES Periodos Vol. I | WhatsApp … 1.01.39 PM (6) |
| 9789395764124 | Constitutional Ideals | Shruti Sandhya & Anindita — Daksh |
| 9789395764162 | Rising Relevance of Quality Control and BIS | Himanshu Tewari Product Quality Control |
| 9789395764247 | Fairytales — A Poetry Anthology | WhatsApp … 1.01.39 PM (5) |
| 9789395764780 | Transforming HARYANA | WhatsApp … 1.01.39 PM (4) |
| 9789395764889 | Practical Guide to DPDP Act, 2023 | Puneet Bhasin Data Protection Front |

All resized to max 1400 px, progressive JPEG q88. The Bhasin scan went 1192 KB → 130 KB.

---

## Finding 1 — the Vijayaraghavan file fixes a live bug, and it isn't the book you'd think

The filename implies ISBN **9789395764971 — _Supreme Court of India: Musings, Anecdotes &
Episodes_**. The artwork actually reads **_Constitution and its Making_**, by N Vijayaraghavan
alone — a different book, ISBN **9789389176704**.

Checking that ISBN turned up a real defect: **9789389176704 is currently displaying the cover of
_Constitutional Czars in the Hall of Fame_** (the stone-cairn photo, correctly used by ISBN
9789395764186). Two live product pages have been showing the same artwork.

So the file has been staged as `9789389176704.jpg`, which **replaces a wrong cover with the
right one**. Nothing is lost — the Czars art remains correct on its own title.

The author publishes several books sharing the subtitle "Musings, Anecdotes & Episodes", which
is how both the filename and the original cover assignment went astray.

## Finding 2 — two live titles still have placeholder covers

Thirteen books in the catalogue carry an auto-generated navy placeholder — a plain
`#002B5C` panel with the title typeset on it — rather than real artwork. Eleven of those are the
"Not to be uploaded" titles, so they don't matter if those come down. **Two do:**

| ISBN | Title | Note |
|---|---|---|
| 9789395764971 | Supreme Court of India: Musings, Anecdotes & Episodes | on your list; **no real artwork was supplied** |
| 9789389176346 | Tax Consolidation — A Global Perspective | **not on your list at all** — missed by the original count |

Both are live, in stock and purchasable with a fake cover. Worth chasing the artwork before Friday.

---

## Upload

Rotate the exposed AWS keys first, then from `backend/`:

```powershell
$env:S3_BUCKET="<bucket>"
$env:S3_REGION="ap-south-1"
$env:AWS_ACCESS_KEY_ID="<new key>"
$env:AWS_SECRET_ACCESS_KEY="<new secret>"
python upload_storage_to_s3.py --dry-run   # verify keys read oakbridge/covers/<isbn>.jpg
python upload_storage_to_s3.py
```

No database change and no redeploy — every book already points at
`/api/files/oakbridge/covers/<isbn>.jpg`. Images appear as soon as the objects land.
The bucket is private and served through the `/api/files` proxy: **do not set a public ACL.**

Note the script uploads the **whole** `storage/` tree, not just these 16. That's harmless
(same keys, same bytes) but it does mean the 201-file directory is the thing being published —
so it's worth being sure nothing stale is sitting in there.

## Two cosmetic notes

1. **9789389176650** — catalogue says "Indian, Human & **Physical** Geography"; the cover says
   "Indian, Human and **Economic** Geography". The cover is likelier to be right.
   Fixable in Admin → Books.
2. **9788198751249** (_Journey to the Earth of a Star_) is a near-square children's picture book,
   1597×1600. Every other cover is roughly 2:3 portrait, so it will letterbox in the grid.

## Still open

- Real artwork for **9789395764971** and **9789389176346**.
- The **11 "Not to be uploaded" titles are still live and purchasable.** That's a separate
  go-live decision — hide or delete — and a bigger risk than any missing image.
