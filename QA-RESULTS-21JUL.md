# QA run — 21 July 2026

Automated pass against the deployed backend (`oakbridge-v2.onrender.com`) and frontend
(`oak-bridge-v2.vercel.app`). **This is a partial run.** Roughly sections 0, 1 (data), 9 and
parts of 7–8 of the checklist. Auth, payment, email, admin and all click-through testing
could not be executed from here — see the bottom.

---

## 🔴 Findings that should be fixed before launch

### 1. Both PLP filters return zero results

```
GET /api/books?bestseller=true   -> []
GET /api/books?new_release=true  -> []
```

Not a single one of the 200 books has `bestseller` or `new_release` set to true, yet both
filter chips are **enabled** on the storefront. A customer clicking either gets an empty
bookstore.

**Fix:** either flag some titles (Admin → Books, or bulk) or disable the two filters in
Admin → Page: Bookstore. Note the Home page bestseller carousel is separate — it uses a
curated `home_bestsellers` ID list and does work.

### 2. Shipping settings contradict the shipping copy

| Setting | Live value |
|---|---|
| `free_ship_threshold` | **0** |
| `ship_flat` | **0** |
| `pdp_shipping` | "Free shipping on orders over ₹1,500" |

With the threshold at 0 everything ships free, so the PDP promise is wrong — it implies a
minimum that doesn't exist. Either set the threshold to 1500 and a real flat rate, or change
the copy to "Free shipping on all orders". Both live in Admin → Settings.

### 3. `tax_percent` is 0 — confirm this is deliberate

Printed books are nil-rated under GST in India, so 0 may well be correct. But the invoice
carries a GSTIN and is formatted as a tax invoice, so this is worth an explicit confirmation
from finance rather than an assumption. If any non-book product is ever sold, this becomes wrong.

### 4. Marketing claim: "500+ titles" vs 200 in the catalogue

Appears on **What We Do** (publishing bullet, and again under Digital Solutions as "semantic
search across 500+ legal and tax titles") and as a **Digital Solutions** stat, "500+ titles
indexed". The live catalogue is 200. Also unverified: "Distribution across India and 18
international markets".

Already flagged for counsel in LEGAL-REVIEW.md under substantiation. Both are admin-editable.

### 5. `[Grievance Officer name]` still live in Terms §11 and Privacy §12

Expected — waiting on the name. Confirmed still present on the deployed API.

---

## ✅ Verified working

| Check | Result |
|---|---|
| Backend healthy, Atlas connected | ✅ `/api/books` returns real data |
| Catalogue size | ✅ **200** titles |
| Category counts | ✅ Academic 61 + Professional 110 + BGR 29 = **200** |
| Autocomplete endpoint | ✅ `/api/search/suggest-index` returns 200 books — **route fix is live** |
| New authors-layout settings deployed | ✅ `authors_per_row: 4`, `authors_grid_rows: 2`, carousel title present |
| Policy effective dates | ✅ "Last updated: 24 July 2026" — `[DATE]` placeholder gone |
| Legal DB overrides | ✅ `updated_at: null` — no saved override, so code defaults are authoritative |
| About team overrides | ✅ `page_about_team` is empty — the **Founder, Director** change will take effect on deploy |
| Cover paths | ✅ every book points at `/api/files/oakbridge/covers/<isbn>.jpg` |
| Pricing consistency | ✅ uniform 20% off MRP (e.g. 600 / 750) — matches the "-20%" badge |
| `robots.txt` | ✅ allows all, disallows `/admin` `/account` `/checkout` `/order-confirmation`; sitemap points at the **final** domain |
| `sitemap.xml` | ✅ reachable and serving XML |
| Sort options | ✅ 5 options live incl. New Arrivals |
| Home bestsellers carousel | ✅ enabled, 7 curated titles |

---

## ⛔ Could not be executed from here — needs a person

These are the highest-risk items and **none have been run**:

**Auth (§4)** — signup, verification code, welcome email, login/logout, forgot/reset password,
guest-to-checkout gate. Requires real credentials and an inbox.

**Payment (§5)** — the single most important test. Razorpay popup, real card, success →
confirmation, **stock decrement**, cancel-and-retry, consent checkbox. I can't and won't
execute a payment.

**Email (§6)** — 12 separate emails including the invoice PDF. Requires inbox access.

**Admin (§7, §8)** — every admin test needs a login.

**Click-through (§10a — the new slow-click section)** — account menu, autocomplete, mobile
drawer, cart drawer, filters, carousel arrows, admin drawer. This is exactly the class of bug
that hit the account menu today, and it can only be found by a human clicking deliberately.

**Responsive (§10)** — needs real devices or devtools.

**Chatbot (§10)** — needs a live conversation.

---

## Suggested order for the manual pass

1. **One real payment end-to-end** — signup → add to cart → pay → confirmation → receipt email
   → check stock decremented → check order in Admin. Clears the most risk per minute.
2. **The slow-click list (§10a)** — 15 minutes, catches invisible navigation bugs.
3. **Admin edit → storefront** — change one setting, confirm it shows.
4. Everything else.
