# Domain Cutover Runbook — oakbridge.in

Moving the live site onto your own domain: frontend on Vercel, API on Render.

> **Corrected for this project.** Generic guides reference `VITE_API_URL`, `NEXT_PUBLIC_API_URL`
> and `CLIENT_URL`. **None of those exist here.** This stack is Create React App (CRACO) + FastAPI.

---

## Setup

| | |
|---|---|
| **Frontend** | Vercel — project `oak-bridge-v2`, production branch `Oak-v2-UAT`, root dir `frontend` |
| **Backend** | Render — service `oakbridge-api` / `oakbridge-v2.onrender.com` |
| **DNS** | GoDaddy (`ns17`/`ns18.domaincontrol.com`) |
| **Email** | **Hostinger** (MX + SPF + DKIM). Independent of this move — do not cancel Hostinger. |

**Final URL layout** — `www` is canonical (matches the old site, preserves SEO)

| Purpose | URL |
|---|---|
| Site (canonical) | `https://www.oakbridge.in` |
| Site (apex) | `https://oakbridge.in` → 308 redirect to www |
| API | `https://api.oakbridge.in` |

---

## ✅ Already completed (20 Jul)

| Done | Detail |
|---|---|
| Zone file backed up | `oakbridge.in.txt` in this folder — **rollback apex IP = `64.227.141.14`** |
| `api.oakbridge.in` | Added in Render + CNAME in GoDaddy → **verified, SSL issued, serving JSON** |
| Vercel domains added | `www.oakbridge.in` → **Production**; `oakbridge.in` → 308 redirect to www |
| `www` TTL lowered to 600s | Apex `@` was already 600s |

Both Vercel domains show **"Invalid Configuration"** — correct until the DNS switch below.

---

## 🔴 THURSDAY 23 JUL, 9:30 PM — the switch

### 1. GoDaddy — edit exactly two records

> **Copy verbatim.** These are project-specific and differ from Vercel's generic docs.

| Type | Name | New value | Was |
|---|---|---|---|
| `A` | `@` | `216.198.79.1` | `64.227.141.14` |
| `CNAME` | `www` | `7b5fd36cbb4cde70.vercel-dns-017.com` | `@` |

- Enter the CNAME **without** a trailing dot — GoDaddy adds it.
- **Edit** these records; don't delete and recreate.
- **Touch nothing else.** All MX, TXT (SPF/DKIM/DMARC), `hostingermail-*`, `resend._domainkey`, `send` and amazonses records must stay exactly as they are, or company email breaks.

### 2. Render — environment variables

```
CORS_ORIGINS=https://oakbridge.in,https://www.oakbridge.in
SITE_URL=https://www.oakbridge.in
```

> `SITE_URL` uses **www** (the canonical domain) — every transactional email link is built from it.
> `CORS_ORIGINS` is comma-separated with no spaces; a wrong value blocks every API call.

### 3. Vercel — environment variable + redeploy

```
REACT_APP_BACKEND_URL=https://api.oakbridge.in
```

> ⚠️ Create React App bakes this in at build time — **you must trigger a redeploy**, or the site keeps calling the old Render URL. No trailing slash.

### 4. Razorpay

Repoint the webhook to `https://api.oakbridge.in/api/webhooks/razorpay` in **Live** mode, and keep `RAZORPAY_WEBHOOK_SECRET` in sync. Miss this and orders never confirm and stock never decrements.

### 5. Expected side-effect

These subdomains CNAME to `@`, so they follow the apex to Vercel and stop working:
`webmail` · `cpanel` · `whm` · `webdisk` · `ftp` · `autoconfig` · `autodiscover`

**Mail delivery is unaffected** (that's MX). But if staff log in via `webmail.oakbridge.in`, tell them to use Hostinger's direct webmail URL instead.

---

## 6. Test before decommissioning anything

Book covers are served **through the API** (`/api/files/...`), so if images break it's almost always `REACT_APP_BACKEND_URL` or CORS — not storage.

- [ ] `https://www.oakbridge.in` loads, SSL padlock valid
- [ ] `https://oakbridge.in` redirects to www
- [ ] Book covers and page images render (proves API domain + CORS)
- [ ] Bookstore: search, filters, category, infinite scroll
- [ ] Sign up → verification email arrives, link works and points at the new domain
- [ ] Log in / log out
- [ ] Add to cart → cart persists
- [ ] Checkout → **one real payment end-to-end**
- [ ] Order confirmation email arrives, invoice PDF attaches
- [ ] Razorpay webhook fires → order status updates, stock decrements
- [ ] Admin panel loads at `/admin`, login works, an edit saves
- [ ] eBook download (titles with `has_ebook`)
- [ ] Chatbot responds
- [ ] Deep link works on refresh (open `/books/<id>` directly — catches SPA rewrite issues)
- [ ] Regenerate sitemap so URLs use the new domain

---

## 7. Rollback

Set `A @` back to **`64.227.141.14`**. With a 600s TTL it reverts within ~10 minutes.

Only decommission the old host once every box above is ticked — and remember **email lives on Hostinger**, so cancelling it would kill every company mailbox. That's a separate migration, not part of this cutover.
