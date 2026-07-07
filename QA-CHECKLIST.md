# Oakbridge — Pre-Launch QA Checklist

Ship target: **13 July 2026**. Run this end-to-end on the deployed build (and once locally). Tick each box; note anything that fails in the "Issues" column at the bottom.

Legend: 🛒 storefront · 🔐 auth · 💳 payments · 📧 email · 🛠️ admin

---

## 0. Environment sanity
- [ ] Backend healthy: `GET /api` responds; `GET /api/books` returns titles (Atlas connected + seeded).
- [ ] Frontend loads, talks to backend (no CORS errors in browser console).
- [ ] `reportlab` installed in the backend environment (invoices depend on it).
- [ ] Correct **Resend key** live (the account where `oakbridge.in` is verified) and backend restarted.
- [ ] `SENDER_EMAIL=noreply@oakbridge.in`, `CORS_ORIGINS` = real domain, `SITE_URL` = real domain.
- [ ] `run check.ps1` → ALL CHECKS PASSED; `yarn build` → Compiled successfully.

## 1. 🛒 Storefront browsing
- [ ] Home page renders (hero, sections, real logo in header + footer).
- [ ] **What We Do** page loads (no crash — regression fixed).
- [ ] Events, Academy, Digital Solutions, Authors, About pages all load.
- [ ] Bookstore (PLP) lists books; category counts correct.
- [ ] **Sort** dropdown reflects Admin → Page: Bookstore config; each option reorders correctly.
- [ ] **Filters** (Bestsellers / New Releases + categories) filter correctly; "Clear all" works.
- [ ] Search by title / author / ISBN returns expected results.
- [ ] Breadcrumbs present and correct on PLP, PDP, and content pages.

## 2. 🛒 Product detail (PDP)
- [ ] PDP loads with cover, price, description, specs, author tabs.
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
- [ ] Sign up → **OTP email** arrives → entering code verifies the account.
- [ ] Resend OTP works.
- [ ] Log in / log out work; token persists across refresh.
- [ ] Guest clicking checkout is prompted to **sign in OR sign up**, then returns to checkout.
- [ ] Wrong password / duplicate email show clear errors.

## 5. 💳 Checkout & payment (Razorpay TEST mode first)
- [ ] Checkout form validates required fields (name, phone, address, pincode).
- [ ] Order total on checkout matches cart (server-recomputed).
- [ ] Razorpay popup opens; **test card 4111 1111 1111 1111** → Success → redirect to confirmation.
- [ ] Confirmation page shows order number, totals, ship-to.
- [ ] **Stock decrements** by the ordered quantity after payment.
- [ ] Closing the popup ("cancel") holds the order and lets you retry.
- [ ] Repeat with a **UPI success** (`success@razorpay`) test.

## 6. 📧 Emails (check inbox AND spam)
- [ ] **Order receipt** to customer with **invoice PDF attached**; PDF shows logo, GSTIN, items, totals, amount-in-words.
- [ ] Invoice number is FY-format (`OAK/2026-27/NNNN`) and stable on re-send.
- [ ] **Admin "new paid order"** alert to `ADMIN_NOTIFY_EMAIL`.
- [ ] **Payment failed** → customer gets "Payment unsuccessful" email with causes + retry link.
- [ ] **Payment failed** → admin gets the red "follow up" alert with name/phone/amount/reason.
- [ ] Back-in-stock email fires when admin restocks a 0-stock title.
- [ ] Waitlist welcome fires on Digital Solutions / Academy signup.
- [ ] (Note: failure emails require the Razorpay **webhook** registered in prod.)

## 7. 🛠️ Admin — catalog
- [ ] Admin login (non-default strong password); non-admins are blocked.
- [ ] Books: create / edit / delete; cover shows.
- [ ] **Variant price matrix** editor: add rows (binding/size/price/stock), save, reflected on PDP.
- [ ] Inventory tab shows stock + low-stock list.
- [ ] Media library: upload (⚠️ needs S3 in prod), assign to Home/PLP/PDP/Events slots, reorder.

## 8. 🛠️ Admin — orders & config
- [ ] Orders list shows all orders with customer, total, status.
- [ ] **Resend** receipt works (email arrives with invoice).
- [ ] **Invoice** button downloads the PDF (no "Network Error").
- [ ] Order status dropdown updates.
- [ ] Page: Bookstore — add/remove/reorder/rename sort & filters → reflected on storefront.
- [ ] Page: Book — edit delivery/returns text + binding/size options → reflected on PDP.
- [ ] Settings — tax %, free-ship threshold, flat shipping → reflected in cart/checkout.
- [ ] Coupons — create/edit; usage limit enforced.
- [ ] Desk copies, submissions, waitlists, users tabs load.

## 9. SEO / meta
- [ ] Page titles + meta descriptions per page; canonical URLs correct.
- [ ] `/robots.txt` and `/sitemap.xml` reachable; favicon + OG image load.
- [ ] Book pages emit Book + Breadcrumb JSON-LD (view source / Rich Results test).

## 10. Cross-cutting
- [ ] Mobile responsive: header nav, PLP grid, PDP, cart, checkout.
- [ ] No console errors on any main page.
- [ ] 404 / not-found routes handled gracefully.
- [ ] Abandoned-cart reminder cron endpoint responds (token-protected) — test via Admin "Run cart reminders".

---

## Known pre-launch dependencies (not bugs)
- **S3 storage** not yet wired — media/cover uploads won't persist until done (needs bucket + region).
- Razorpay **live keys + webhook** after KYC (test keys used until then).
- Order **status-update / welcome / password-reset** emails not built (optional).
- OTP verification in **soft mode** (not enforced).

## Issues found
| # | Area | What happened | Severity | Status |
|---|------|---------------|----------|--------|
|   |      |               |          |        |
