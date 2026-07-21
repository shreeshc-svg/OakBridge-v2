# Legal Review — Oakbridge Publishing storefront

For review before go-live (Fri 24 Jul 2026). Written by the build team, **not** by a lawyer —
these are the points we'd like counsel to confirm, not legal advice.

**Live pages:** `/terms` · `/privacy` · `/refund-policy` · `/shipping-policy` · `/cookie-policy`

**All five are editable without a code change:** Admin → Legal. Markdown, saves instantly to the
live site. So anything flagged today can be corrected in minutes.

---

## 1. The one blank we must fill

| Field | Current value | Needed |
|---|---|---|
| **Grievance Officer name** | `[Grievance Officer name]` | A named individual |

It appears in **both** Terms and Privacy. Required under the Consumer Protection
(E-Commerce) Rules 2020 and the DPDP Act 2023, and Razorpay's KYC check looks for it.

**Decide:** who is named, and is the contact `info@oakbridge.in` / `+91 88003 37299`, or a
dedicated address (e.g. `grievance@oakbridge.in`)?

Already populated and worth a sanity check:

- Entity: Oakbridge Publishing Pvt. Ltd.
- Address: 934, 9th Floor, Tower B3, Spaze iTech Park, Sector 49, Gurugram 122018, Haryana
- GSTIN: 06AACCO5406D1ZW
- Email / phone: info@oakbridge.in · +91 88003 37299

---

## 2. Questions for counsel, by policy

### Terms of Service
- [ ] Governing law and jurisdiction — currently drafted for India. Confirm the **named court/city**.
- [ ] Is the **grievance redressal timeline** stated correctly (acknowledge / resolve windows)?
- [ ] Limitation of liability — enforceable as drafted under Indian law?
- [ ] Do we need explicit **"no resale"** or bulk/institutional purchase terms?
- [ ] eBook/digital delivery — licence terms adequate, given non-returnable digital goods?

### Privacy Policy (DPDP Act 2023)
- [ ] Are the **purposes of processing** stated specifically enough?
- [ ] **Consent mechanism** — is the cookie banner + signup flow sufficient for DPDP?
- [ ] **Data principal rights** (access, correction, erasure, grievance) — all present and correct?
- [ ] **Retention periods** — do we state how long order and account data is kept?
- [ ] **Third parties named**: Razorpay (payments), Resend (email), AWS S3 (file storage),
      MongoDB Atlas (database), Groq (chatbot). Are all disclosed, and is any of this a
      **cross-border transfer** needing specific treatment?
- [ ] **Children's data** — any position needed, given school/academic customers?

### Refund & Cancellation
- [ ] Refund window and conditions — compliant with the E-Commerce Rules?
- [ ] Damaged/incorrect delivery process clear?
- [ ] **Digital goods (eBooks)** — is the non-refundable position stated and lawful?
- [ ] Who bears **return shipping** in each scenario?

### Shipping
- [ ] Delivery timelines — stated as estimates, not guarantees?
- [ ] Coverage/exclusions correct (domestic only? international?)

### Cookie Policy
- [ ] Does the banner's consent model match what the policy claims?
- [ ] Are the cookies actually set (session, cart, auth) accurately described?

---

## 3. Cross-site claims worth a look

- [ ] **Pricing display** — every book shows MRP struck through with a 20% discount.
      Confirm the MRP presentation is compliant (Legal Metrology / no misleading discount).
- [ ] **Tax on invoice** — GST is computed at checkout and shown on a PDF invoice with
      GSTIN and FY-based numbering. Correct format for a tax invoice?
- [ ] **"500+ titles"** and similar marketing claims across the site — substantiated?
- [ ] **Author/book descriptions** — any third-party IP or endorsement risk?
- [ ] **Chatbot** — it answers customer questions and can see a signed-in user's orders.
      Any disclaimer needed that it isn't legal/professional advice?

---

## 4. Sign-off

| | |
|---|---|
| Reviewed by | |
| Date | |
| Grievance Officer named | |
| Changes required | ☐ none ☐ listed below |

**Changes required:**

---

## 5. How to apply changes

**Admin → Legal** → pick the policy → edit Markdown → Save. Live immediately, no deploy.

If the Grievance Officer name is the only change, it appears in two policies (Terms and
Privacy) and must be updated in both.
