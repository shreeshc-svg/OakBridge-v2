# Oakbridge Publishing — Product Requirements

## Problem Statement
Website for Oakbridge Publishing (similar to mheducation.co.in) + integrated bookstore.

## User Choices
- Scope: Marketing + Bookstore
- Payment: Razorpay (DEFERRED — still mock checkout)
- Auth: JWT email/password for both admin + customers
- Seeded sample content

## Architecture
- Backend: FastAPI + MongoDB (motor). All routes prefixed `/api`.
- Frontend: React 19 + React Router v7 + Tailwind + shadcn/ui + sonner.
- Auth: JWT Bearer tokens in localStorage, 7-day TTL.
- Typography: Cormorant Garamond + Manrope + IBM Plex Mono.
- Palette: paper #FDFBF7, ink #0B1F2A, gold #D9A05B, crimson #732D2D.

## Implemented — Iteration 1 (2026-02)
- Seeded 5 categories + 30 books
- Public API: /api/categories, /api/books (filters/sort/search), /api/books/featured, /api/books/new-releases, /api/books/{id}, /api/newsletter, /api/contact, /api/orders, /api/orders/{id}
- Pages: Home, Catalog, Book Detail, Cart + CartSheet, Checkout, Order Confirmation, About, Solutions (index + 3 sub-pages), Contact
- Cart persists via localStorage
- 19/19 backend tests passing

## Implemented — Iteration 2 (2026-02)
- JWT auth (bcrypt + PyJWT bearer). Routes: /api/auth/{register,login,me,logout}
- Admin role + seeded admin (admin@oakbridge.in / Oakbridge@2026)
- 6 seeded authors with bios + affiliations
- Admin API: /api/admin/{stats,books,orders,users,audit} with full CRUD where applicable
- Customer API: /api/my/orders, /api/books/{id}/reviews (POST requires auth)
- Public API: /api/authors, /api/authors/{id}, /api/authors/{id}/books
- Orders optionally linked to user via user_id
- Frontend pages: /login, /register, /account (my orders), /authors, /authors/:id, /admin (dashboard), /admin/books, /admin/orders, /admin/users, /admin/audit
- Book Detail: Reviews section  (the Request-a-Desk-Copy dialog was retired in Aug 2026)
- Header: auth-aware account dropdown with admin link for admins
- 28/28 backend tests passing; all critical frontend flows verified

## Implemented — Iteration 3 (2026-02)
- McGraw-Hill style redesign: navy/red palette, sans-serif, equal tile grid
- Home: 4 Business Verticals (Publishing / Events / Digital Solutions / Training & Certification)
- Home: 5 Publishing Imprints (Academic / Professional / General / Coffee Table / Curated)
- Coupons, Submissions, Inventory low-stock alerts (extensions.py, features.py)
- eBook PDF Object Storage integration (upload + download)
- Admin Books: CSV bulk-import + drag-and-drop cover uploader (CODE DONE, E2E TEST PENDING)
- Backend routes: POST /api/admin/books/import-csv, POST /api/admin/books/{id}/cover, GET /api/files/{filename}

## Current State (Saved 2026-02)
- Last working item: CSV bulk-import + cover uploader — code compiles, E2E verification NOT done
- Services healthy, no broken flows, mock checkout still in place

## Code Review Cleanup (2026-02)
- Refactored `features.admin_bulk_import` → extracted `_parse_csv_reader`, `_csv_row_to_book_doc`, `_csv_bool/_csv_int/_csv_float` helpers (complexity 24 → <10)
- Hardened `features.public_file` to re-raise HTTPException cleanly
- AdminBooks CSV error list now keyed by `row`+`error` instead of array index
- `craco.config.js` visual-edits warning gated behind `NODE_ENV !== "production"`
- Skipped (false positives): `is None`/`is not None` checks (PEP 8 compliant), React hook-deps flags (ESLint passes — all hooks already wrapped in `useCallback`)
- Skipped (architectural, previously deferred by user): localStorage → httpOnly cookies migration, large-component splits (Header/Home/BookDetail/AdminBooks), `list_books` arg grouping

## Excel Template Feature (2026-02)
- New endpoint `GET /api/admin/books/import-template` returns styled `oakbridge-books-template.xlsx` (header tooltips, sample row, frozen panes, separate Instructions sheet)
- `POST /api/admin/books/bulk-import` now accepts `.xlsx` (via openpyxl) in addition to `.csv`
- Frontend Import dialog: button now downloads Excel template; file picker accepts `.xlsx,.csv`
- Added `openpyxl==3.1.5` to requirements.txt
- Verified: download → edit → upload round-trip works; CSV path still works

## Bulk Delete (2026-02)
- New endpoint `POST /api/admin/books/bulk-delete` accepts `{ids:[...]}` or `{delete_all:true, confirm:"DELETE ALL"}`
- AdminBooks UI: row checkboxes + select-all header, blue action bar showing selected count, "Delete selected" red button, plus a top-right "Delete all" button guarded by typed confirmation dialog
- Verified bulk delete (2 books), empty-ids 400, missing-confirm 400

## Home page copy (2026-02)
- Solutions paragraph replaced with "We collaborate with professionals and scholars..."
- 3-card grid → 4-card 2×2 grid: For Firms / For Institutions / For Professionals / For Educators

## Site Polish & New Pages (2026-04 → 05)
- Hero content + contemporary card treatments across Home / What-We-Do / Bookstore
- BookCard refactor: `aspect-2/3` + `object-contain` + new `compact` prop; bestseller row → 6 thumbs, new releases row → 7 thumbs (graceful top-up from featured/fallback)
- Footer + About + Home founders year update → 2017 ("by two veteran publishing professionals…")
- Header nav: removed Academic/Professional/Coffee-Table category shortcuts; added Events / Academy / Digital Solutions
- **Bookstore hero banner** — context-aware (imprint/search/default), full-bleed image + navy gradient + dynamic stats strip
- **Events page** (`/events`) — purpose-built page populated from `vidhiutsav.com` + `oakbridge.events` crawl. Hero with rotating Vidhi Utsav ⇄ ILATS banners (6s auto-rotate + click dots). "A festival and a summit. One mission." section with both flagship cards. Vidhi Utsav 2027 (4th edition, Feb–Mar 2027). Real speaker photos (Vidhi 6, Summit 6). Experience grid (Keynotes, Panels, Books, Awards, AI/Tech, Music, Comedy, Bazaar). Who-attends list. Dual CTAs to the external event sites.
- **Digital Solutions Coming Soon page** (`/digital-solutions`) + **Academy Coming Soon page** (`/academy`) — sharing a parameterized `ComingSoon` template. Each routes from its header tab and Home card, has its own copy + features + waitlist source tag (`digital-solutions-waitlist` / `academy-waitlist`) posting to `/api/newsletter`.

## Razorpay Payment Gateway (2026-05)
- Real Razorpay integration replacing the mock checkout. `razorpay==2.0.1` Python SDK + Razorpay Checkout.js on the frontend.
- New routes: `POST /api/payments/create-order`, `POST /api/payments/verify`, `POST /api/webhooks/razorpay`.
- Order model extended with `payment_status`, `payment_provider`, `rzp_order_id`, `rzp_payment_id`, `paid_at`.
- Checkout.jsx now opens a navy-themed Razorpay popup (pre-fills name/email/phone), verifies signature server-side, clears cart and redirects on success. Cancellation / failure paths surface toasts and reset the submit state.
- Keys live in `/app/backend/.env` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`). Test mode keys configured; go-live plan documented (set live keys as deployment secrets, add webhook URL).
- Verified end-to-end via curl: real test order created, DB flipped to `payment_status: pending + payment_provider: razorpay`, signature verification rejects forged callbacks with 400.

## Resend Email Notifications (2026-05)
- `resend==2.30.1` SDK installed. New `/app/backend/emailer.py` with non-blocking `send_email` (asyncio.to_thread) + branded HTML templates (`render_order_receipt_html`, `render_waitlist_welcome_html`, `render_admin_paid_order_html`).
- Order-paid receipt fires from BOTH `/api/payments/verify` AND `/api/webhooks/razorpay`. Same path also fires `send_admin_paid_order` to `ADMIN_NOTIFY_EMAIL`. Email failures never block payment.
- `/api/newsletter` now sends a contextual waitlist welcome email after each signup (source-aware copy for `digital-solutions-waitlist` / `academy-waitlist`).
- Env: `RESEND_API_KEY`, `SENDER_EMAIL=onboarding@resend.dev` (sandbox), `SENDER_NAME="Oakbridge Publishing"`, `ADMIN_NOTIFY_EMAIL=shreeshc@gmail.com`. Production: verify domain at resend.com/domains → swap SENDER_EMAIL.
- Verified end-to-end: receipts, welcome emails, and admin paid-order alerts all delivered to verified Resend address.

## Admin Enhancements (2026-05)
- **Admin → Waitlists** (`/admin/waitlists`) — segment chips (Digital Solutions / Academy / Newsletter / All) with live counts via Mongo aggregate, sortable email table, one-click **Export CSV** download per segment. New endpoints: `GET /api/admin/waitlists`, `GET /api/admin/waitlists/export.csv`.
- **Resend receipt** action in Admin → Orders — one-click button on every row calls `POST /api/admin/orders/{id}/resend-receipt` to fire the branded HTML receipt again. Toast confirms delivery address.
- Order status dropdown now includes `pending` for paid-but-not-yet-confirmed orders.

## Dashboard Activity + Self-host Photos + AI Bios (2026-05)
- **Last 7 days dashboard widget** — `/api/admin/stats` now returns a `last_7_days` block (new_orders / paid_orders / revenue / waitlist_signups / submissions / low_stock / out_of_stock). Frontend renders 4 KPI tiles + amber inventory alert strip with quick link to `/admin/inventory`.
- **Self-hosted Events speaker photos** — downloaded 2 banners + 11 headshots from vidhiutsav.com / oakbridge.events into our Object Storage under `/api/files/oakbridge/events/...` and patched Events.jsx with the new URLs. Page no longer depends on the external sites.
- **AI-drafted author bios** — new `POST /api/admin/books/{id}/draft-author-bio` endpoint uses Emergent LLM key (`gemini-3-flash-preview`) to produce 60-90-word polished bios. Admin Books form gets a "✨ Draft with AI" button next to the Author Bio textarea. Verified: returned a 590-char on-brief bio for a real book in ~2-3 seconds.

## Prioritized Backlog (resume here)
- P0: Verify CSV bulk-import + cover drag-drop E2E via testing_agent_v3_fork
- P0: Razorpay payment gateway integration (deferred by user; test keys in pod env)
- P1: Email notifications (order confirmation) — provider TBD (Resend/SendGrid/Gmail)
- P2: Dedicated /events page wired to Events vertical on Home
- P2: Refactor AdminBooks.jsx (>400 lines) into BookTable/BookForm/EbookManager/CoverUploader/CsvImportDialog
- P3: Migrate auth token from localStorage → HTTP-only cookies
- P3: Forgot-password flow
- P3: Multi-language (Hindi) edition toggle

## Test credentials
See /app/memory/test_credentials.md
- Admin: admin@oakbridge.in / Oakbridge@2026
