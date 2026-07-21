# Oakbridge — Pre-Launch QA Checklist

Ship target: **25 July 2026**. Run this end-to-end on the deployed build (and once locally). Tick each box; note anything that fails in the "Issues" table at the bottom.

Legend: 🛒 storefront · 🔐 auth · 💳 payments · 📧 email · 🛠️ admin

---

## 0. Environment sanity
- [ ] Backend healthy: `GET /api` responds; `GET /api/books` returns titles (Atlas connected + real 200-book catalogue imported).
- [ ] Frontend loads, talks to backend (no CORS errors in browser console).
- [ ] `reportlab` + `boto3` installed in the backend environment (invoices + S3 depend on them).
- [ ] **S3** vars set on Render: `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; covers load from S3.
- [ ] Correct **Resend key** live (the account where `oakbridge.in` is verified) and backend restarted.
- [ ] `SENDER_EMAIL=noreply@oakbridge.in`, `CORS_ORIGINS` = real domain, `SITE_URL` = real domain.
- [ ] **OTP channel**: `MSG91_AUTHKEY` + `MSG91_OTP_TEMPLATE_ID` set → SMS OTP; if unset → email OTP fallback (verify which is active).
- [ ] `run check.ps1` → ALL CHECKS PASSED; `yarn build` → Compiled successfully.

## 1. 🛒 Storefront browsing
- [ ] Home page renders (hero, sections, real logo in header + footer).
- [ ] **What We Do** page loads (no crash — regression fixed).
- [ ] Events, Academy, Digital Solutions, Authors, About pages all load.
- [ ] Bookstore (PLP) lists books; **real covers** load from S3 (not placeholders); category counts correct.
- [ ] **Infinite scroll**: scrolling loads more books (24 at a time) up to all 200; "You've reached the end" shows at the bottom.
- [ ] **Lazy loading**: covers load as they enter the viewport (Network tab shows images fetched on scroll, not all upfront).
- [ ] **Sort** dropdown reflects Admin → Page: Bookstore config; each option reorders correctly (and resets scroll).
- [ ] **Filters** (Bestsellers / New Releases + categories) filter correctly; "Clear all" works.
- [ ] Search by title / author / ISBN returns expected results.
- [ ] Breadcrumbs present and correct on PLP, PDP, and content pages.

## 2. 🛒 Product detail (PDP)
- [ ] PDP loads with cover (from S3, not cut off), price, description, specs, author tabs.
- [ ] **Binding / Size selectors** show (from Admin → Page: Book options or a book's variant matrix).
- [ ] Selecting a variant with a price matrix updates the displayed price.
- [ ] Delivery / returns / free-ship tiles reflect Admin settings.
- [ ] Out-of-stock title: greyed CTA, "notify me" form works → confirmation toast.
- [ ] Low-stock title shows the "Only N left" note.
- [ ] Related titles render.

## 3. 🛒 Cart
- [ ] Add to cart (with and without a chosen variant); cart drawer opens.
- [ ] Hardcover vs Softcover of same title are **separate line items**.
- [ ] Quantity +/- and remove work; totals recompute.
- [ ] Tax %, shipping, free-ship threshold match Admin → Settings.
- [ ] **Coupon**: valid code applies discount with inline success; invalid shows inline error.
- [ ] Cart persists across refresh (and across login for signed-in users).

## 4. 🔐 Auth
- [ ] Sign up requires **name, email, phone (mandatory), password**.
- [ ] Sign up → **verification code** arrives (SMS if MSG91 configured, else email) → entering code verifies the account.
- [ ] Resend code works.
- [ ] **Welcome email** arrives on signup.
- [ ] Log in / log out work; token persists across refresh.
- [ ] **Forgot password**: `/forgot-password` → enter email → reset email arrives → link opens `/reset-password` → set new password → can log in with it.
- [ ] Reset link is single-use and expires (30 min); reused/expired link shows a clear error.
- [ ] Guest clicking checkout is prompted to **sign in OR sign up**, then returns to checkout.
- [ ] Wrong password / duplicate email show clear errors.

## 5. 💳 Checkout & payment (Razorpay TEST mode first)
- [ ] Checkout form validates required fields (name, phone, address, pincode).
- [ ] Order total on checkout matches cart (server-recomputed from DB prices — anti-tampering).
- [ ] Razorpay popup opens; **test card 4111 1111 1111 1111** → Success → redirect to confirmation.
- [ ] Confirmation page shows order number, totals, ship-to; success checkmark is green.
- [ ] **Stock decrements** by the ordered quantity after payment (and only once).
- [ ] Closing the popup ("cancel") holds the order and lets you retry.
- [ ] Repeat with a **UPI success** (`success@razorpay`) test.
- [ ] **Consent checkbox** (terms/privacy) required before payment.

## 6. 📧 Emails (check inbox AND spam)
- [ ] **Order receipt** to customer with **invoice PDF attached**; PDF shows logo, GSTIN, items, totals, amount-in-words.
- [ ] Invoice number is FY-format (`OAK/2026-27/NNNN`) and stable on re-send.
- [ ] **Admin "new paid order"** alert to `ADMIN_NOTIFY_EMAIL`.
- [ ] **Payment failed** → customer gets "Payment unsuccessful" email with causes + retry link.
- [ ] **Payment failed** → admin gets the red "follow up" alert with name/phone/amount/reason.
- [ ] **Account welcome** email fires on signup.
- [ ] **Order status update** email fires when admin changes status (processing / shipped / delivered / cancelled).
- [ ] **Password reset** email delivers a working link.
- [ ] Back-in-stock email fires when admin restocks a 0-stock title.
- [ ] Waitlist welcome fires on Digital Solutions / Academy signup.
- [ ] Contact form → admin alert + customer auto-acknowledgment.
- [ ] (Note: payment-failure emails require the Razorpay **webhook** registered in prod.)

## 7. 🛠️ Admin — catalog
- [ ] Admin login (non-default strong password); non-admins are blocked from `/admin/*`.
- [ ] Books: create / edit / delete; cover shows.
- [ ] **Variant price matrix** editor: add rows (binding/size/price/stock), save, reflected on PDP.
- [ ] Inventory tab shows stock + low-stock list.
- [ ] Media library: upload persists to **S3**, assign to Home/PLP/PDP/Events slots, reorder.
- [ ] **Bestsellers carousel**: curate/reorder in Page: Bookstore; enable/disable + scroll speed apply on Home.

## 8. 🛠️ Admin — orders & config
- [ ] Orders list shows all orders with customer, total, status.
- [ ] **Resend** receipt works (email arrives with invoice).
- [ ] **Invoice** button downloads the PDF (no "Network Error").
- [ ] Order status dropdown updates → customer gets a **status-update email**.
- [ ] Page: Bookstore — add/remove/reorder/rename sort & filters → reflected on storefront.
- [ ] Page: Book — edit delivery/returns text + binding/size options → reflected on PDP.
- [ ] Settings — tax %, free-ship threshold, flat shipping → reflected in cart/checkout.
- [ ] Coupons — create/edit; usage limit enforced.
- [ ] **Legal** editor — Terms / Privacy / Refund / Shipping edit + save; live on `/terms` etc.
- [ ] **Messages** (contact inquiries) inbox loads.
- [ ] Desk copies, submissions, waitlists, users tabs load; users show phone.

## 9. SEO / meta
- [ ] Page titles + meta descriptions per page; canonical URLs correct.
- [ ] `/robots.txt` and `/sitemap.xml` reachable; favicon + OG image load.
- [ ] Book pages emit Book + Breadcrumb JSON-LD (view source / Rich Results test).
- [ ] Images have alt text.

## 10. Cross-cutting
- [ ] Mobile responsive: header nav, PLP grid, PDP, cart, checkout.
- [ ] No console errors on any main page.
- [ ] **Deep-link reload works**: reloading `/books`, `/books/:id`, `/account` etc. serves the page (no Vercel 404).
- [ ] 404 / not-found routes handled gracefully.
- [ ] Floating **chatbot** answers basic questions and can navigate to sections.
- [ ] Abandoned-cart reminder cron endpoint responds (token-protected) — test via Admin "Run cart reminders".

### 10a. Menus, popovers and overlays — **click slowly**

> Why this section exists: the account menu closed itself 150 ms after the trigger lost
> focus, so any click slower than that unmounted the link mid-click. "Admin Dashboard"
> and "My Orders" silently did nothing — **no console error, no failed request**. Fast
> clicking and synthetic test clicks both passed. Deliberate, unhurried clicks are the
> only way to catch this class of bug.

For **every** menu, dropdown and overlay below: open it, pause for a second, then click an
item slowly (press, hold briefly, release). It must navigate or act every time.

- [ ] Header **account menu** → My Orders (arrives at `/account`)
- [ ] Header **account menu** → Admin Dashboard (arrives at `/admin`)
- [ ] Header **account menu** → Sign out (signs out and returns home)
- [ ] Header **account menu** closes on outside click and on `Esc`
- [ ] **Search autocomplete**: type 3+ letters, pause, click a suggestion slowly → opens that book
- [ ] Search autocomplete → "See all results for…" row
- [ ] Search **recent searches** row (focus the empty box after a prior search)
- [ ] **Mobile drawer** (hamburger): every nav link, at 375px and at 1024–1279px
- [ ] **Cart drawer**: quantity +/−, remove, "Checkout" button
- [ ] **PLP Filters** panel on mobile: toggle, apply, "Clear all"
- [ ] **Sort** dropdown on mobile (select opens, choice applies)
- [ ] **Authors carousel**: prev/next arrows, and a tile click after scrolling
- [ ] **Admin drawer nav** below `lg`: every section link
- [ ] **Book preview** modal (if re-enabled): page arrows, thumbnails, close

### 10b. Session expiry
- [ ] With a stale/invalid token (clear `oakbridge_token` in Local Storage, or wait out the
      7-day TTL), visiting `/account`, `/admin` or `/orders` redirects to `/login` showing
      "Your session expired" — **not** a blank or silently empty page.
- [ ] After signing in from that prompt, you land back on the page you originally wanted.
- [ ] A wrong password still shows an inline error on the login form (no redirect loop).

---

## Known pre-launch dependencies (not bugs)
- **DLT template approval** pending → SMS OTP goes live once `MSG91_OTP_TEMPLATE_ID` is set; until then email OTP fallback is active.
- Razorpay **live keys + webhook** after KYC (test keys used until then).
- **Admin password** in DEPLOYMENT.md must be rotated + scrubbed before launch.
- Real **domain** (oakbridge.in) DNS → Vercel + update `CORS_ORIGINS` / `SITE_URL`.
- **64 book covers** still placeholders (map real images or accept).
- Variant **price matrix** has placeholder values pending real data.
- Legal pages: `[bracketed]` items + jurisdiction to confirm (counsel review; needed for Razorpay KYC).

## Done since last revision
- ✅ S3 media storage (private bucket via `/api/files/*`); real covers live.
- ✅ Real 200-book catalogue imported to Atlas.
- ✅ Bookstore infinite scroll + lazy-loaded covers.
- ✅ Deep-link reload-404 fixed (Vercel SPA rewrite).
- ✅ Phone mandatory at signup; OTP via MSG91 SMS with email fallback.
- ✅ Welcome, order-status-update, and password-reset emails + reset flow.

## Issues found
| # | Area | What happened | Severity | Status |
|---|------|---------------|----------|--------|
|   |      |               |          |        |
