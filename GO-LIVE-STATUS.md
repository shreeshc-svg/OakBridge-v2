# Oakbridge.in — Go-Live Status

**Prepared:** Tuesday 21 July 2026
**DNS cutover:** Thursday 23 July, 9:30 PM
**Public launch:** Friday 24 July

---

## Summary

The site is **built and deployed**. It is running right now on a staging URL with the real
catalogue, real covers, working checkout and a full admin panel. What remains is not
development — it is **three commercial/legal approvals and one night of DNS work.**

Confidence in hitting Friday: **high on the technology, dependent on Razorpay and counsel.**

---

## Where we stand

### ✅ Complete

**Catalogue** — all 200 titles live with real pricing, categories and publication dates.
New Arrivals now orders by actual publication date. Out-of-stock titles sort to the bottom.

**Covers** — 200/200 titles have artwork. The final 16 were uploaded today, including a
correction: two product pages had been showing the same cover image. One title
(*Supreme Court of India*) remains on a plain typeset cover pending artwork — accepted.

**Storefront** — browse, search, filter, sort, infinite scroll, product pages, cart, checkout,
account, order history. Responsive from 375 px phones through to 27-inch monitors.

**Search** — upgraded this week: autocomplete as you type, recent searches, and recovery when
a search returns nothing. We now log what customers search for, which gives us a report of
**demand we aren't meeting** — searches that returned zero results.

**Admin panel** — the marketing team can edit page copy, navigation, footer, events, banners,
the team page and all five legal policies without a developer. Media uploads are drag-and-drop.

**Infrastructure** — frontend on Vercel, API on Render, database on MongoDB Atlas, images on
private S3. `api.oakbridge.in` is already live with a valid certificate.

**Email** — order receipts with PDF tax invoices (GSTIN, FY numbering), payment-failure
notices, welcome, password reset, back-in-stock, abandoned-cart reminders.

**Compliance groundwork** — Terms, Privacy, Refund, Shipping and Cookie policies are live and
editable, drafted against the DPDP Act 2023 and the Consumer Protection (E-Commerce) Rules 2020.

---

## 🔴 Blockers — these decide Friday

| # | Item | Owner | Risk if it slips |
|---|---|---|---|
| 1 | **Razorpay live keys + webhook** (post-KYC) | Business | **We cannot take money.** Site would launch in browse-only mode. |
| 2 | **Grievance Officer — a named person** | Business | Legally required, and Razorpay's KYC checks for it. Blocks #1. |
| 3 | **Counsel sign-off on the five policies** | Legal | Review pack prepared; a lawyer is reviewing. |

Items 1 and 2 are linked: the Grievance Officer name is part of what Razorpay wants.
**This is the critical path.** Everything else can be finished in an afternoon.

---

## 🟠 Must happen before Friday

| Item | Owner | Note |
|---|---|---|
| **Rotate AWS + admin credentials** | Rohan | Keys were exposed during setup. Must also update Render at the same time. |
| **DNS cutover** | Rohan | Thu 23 Jul, 9:30 PM. Two DNS records, three environment variables. Runbook written, rollback tested on paper. |
| **Full QA pass on production** | Team | 120-point checklist exists; **not yet executed end-to-end.** Needs one real payment through the live gateway. |

---

## 🟡 Accepted for launch — not blockers

- **SMS OTP** is on hold pending TRAI/DLT template approval. Email verification covers signup in
  the meantime; no customer impact.
- **Digital Solutions and Academy** launch as "coming soon" with waitlist capture, as agreed.
- **"Look inside" book preview** is built and working but held back from launch; ships as a
  post-launch update.
- **Variant pricing matrix** (hardcover/softcover by size) still carries placeholder values
  pending real data from the publishing team.
- **11 titles marked "not to be uploaded"** remain visible and purchasable — decision taken to
  leave as-is for launch.

---

## Honest risks

**The QA checklist has not been run end-to-end.** Individual features have been tested as built,
but there is no completed full-journey pass on production hardware. The highest-value single
action between now and Friday is one real customer journey — signup through payment through
receipt — on the live domain.

**Razorpay is the only true single point of failure.** If live keys don't arrive, we can still
launch the site publicly with checkout disabled, but that is a materially different launch and
the decision should be taken deliberately rather than discovered on Friday morning.

**Email lives on Hostinger and is untouched by this move.** Worth stating plainly because the
cutover looks alarming from the outside: company mailboxes are not affected. Staff who use
`webmail.oakbridge.in` will need Hostinger's direct URL afterwards.

**Date inconsistency in our own documents** — the QA checklist says 25 July, the cutover runbook
says the 23rd, and we have been working to a Friday 24th launch. Worth confirming one date
publicly so nobody is working to the wrong deadline.

---

## What I'd ask the founder to decide

1. **Who is the named Grievance Officer**, and at what contact address. One line, unblocks legal
   and Razorpay together.
2. **If Razorpay live keys are not in hand by Thursday evening** — do we launch browse-only, or
   hold the domain switch?
3. **Confirm the launch date** so the QA window is unambiguous.
