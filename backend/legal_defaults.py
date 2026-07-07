"""
Default legal / policy content for Oakbridge Publishing (Markdown).

These are STANDARD TEMPLATES pre-filled with Oakbridge's details for an Indian
e-commerce bookstore. They are NOT legal advice — have them reviewed by counsel
before go-live, and confirm the [bracketed] items. All four are editable from
Admin -> Legal, which overrides these defaults.
"""

_ENTITY = "Oakbridge Publishing Pvt. Ltd."
_ADDR = "934, 9th Floor, Tower B3, Spaze iTech Park, Sector 49, Gurgaon 122018, Haryana, India"
_GSTIN = "06AACCO5406D1ZW"
_EMAIL = "info@oakbridge.in"
_SITE = "https://oakbridge.in"

TERMS = f"""\
_Last updated: [DATE]_

These Terms & Conditions ("Terms") govern your use of {_SITE} (the "Site") and
any purchase you make from **{_ENTITY}** ("Oakbridge", "we", "us"). By using the
Site or placing an order, you agree to these Terms.

## 1. Who we are
{_ENTITY}, a company registered in India.
Registered office: {_ADDR}. GSTIN: {_GSTIN}. Contact: {_EMAIL}.

## 2. Eligibility & accounts
You must be able to form a legally binding contract to purchase from us. You are
responsible for keeping your account credentials secure and for all activity
under your account. Information you provide must be accurate and current.

## 3. Products & pricing
- We publish and sell books and related products. Descriptions, covers and
  availability are provided in good faith but may change without notice.
- All prices are listed in Indian Rupees (INR) and are inclusive of applicable
  taxes unless stated otherwise. Applicable GST is shown at checkout and on your
  tax invoice.
- We may correct pricing or availability errors and cancel affected orders, even
  after an order is placed; if payment was taken, we refund it in full.

## 4. Orders & payment
- An order is an offer to buy. We confirm acceptance by email once payment is
  successfully received.
- Payments are processed by our payment partner, **Razorpay**. We do not store
  your full card details. Your use of the payment gateway is subject to its own
  terms.
- We may refuse or cancel any order for reasons including suspected fraud, stock
  unavailability or pricing errors.

## 5. Shipping, refunds & cancellations
Delivery, cancellation and refund terms are set out in our
[Shipping & Delivery Policy](/shipping-policy) and
[Refund & Cancellation Policy](/refund-policy), which form part of these Terms.

## 6. Intellectual property
All content on the Site — text, book content, logos, images and design — is
owned by or licensed to Oakbridge and protected by law. You may not reproduce,
distribute or create derivative works without our written permission. Digital
products (eBooks) are licensed to you for personal, non-commercial use only and
may not be shared, resold or redistributed.

## 7. Acceptable use
You agree not to misuse the Site, attempt to gain unauthorised access, disrupt
its operation, or use it for any unlawful purpose.

## 8. Limitation of liability
To the maximum extent permitted by law, Oakbridge is not liable for indirect or
consequential losses. Our total liability for any order will not exceed the
amount you paid for that order. Nothing in these Terms limits liability that
cannot be limited under applicable law.

## 9. Governing law & jurisdiction
These Terms are governed by the laws of India. Any disputes are subject to the
exclusive jurisdiction of the courts of [Gurgaon, Haryana].

## 10. Changes & contact
We may update these Terms from time to time; the current version is always on
this page. Questions? Email us at {_EMAIL}.
"""

PRIVACY = f"""\
_Last updated: [DATE]_

This Privacy Policy explains how **{_ENTITY}** ("we", "us") collects, uses and
protects your personal information when you use {_SITE}.

## 1. Information we collect
- **You give us:** name, email, phone, billing/shipping address, and account
  details when you register, place an order, request a desk copy, or contact us.
- **Automatically:** basic usage and device data (e.g. pages viewed) to operate
  and improve the Site.
- **Payments:** card/UPI details are collected and processed directly by our
  payment partner, **Razorpay**. We do not receive or store your full card
  numbers.

## 2. How we use your information
- To process and deliver your orders and send order/invoice confirmations.
- To provide customer support and respond to your enquiries.
- To send transactional emails (order updates, verification codes) and, where
  you've opted in, updates about new titles and events.
- To detect and prevent fraud, and to meet legal and tax obligations.

## 3. Sharing with third parties
We share data only with service providers who help us run the business, under
appropriate safeguards:
- **Razorpay** — payment processing.
- **Resend** — transactional email delivery.
- **Shipping/logistics partners** — to deliver your orders.
- Authorities, where required by law.
We do not sell your personal information.

## 4. Cookies
We use essential cookies to keep you signed in and remember your cart, and may
use analytics cookies to understand usage. You can control cookies in your
browser settings.

## 5. Data retention & security
We keep personal data only as long as needed for the purposes above or as
required by law (e.g. tax records). We use reasonable technical and
organisational measures to protect your data; no method is 100% secure.

## 6. Your rights
You may request access to, correction of, or deletion of your personal data, and
you may unsubscribe from marketing emails at any time. To exercise these rights,
email {_EMAIL}.

## 7. Children
The Site is not directed at children under 18, and we do not knowingly collect
their data.

## 8. Contact
For any privacy questions or requests, contact us at {_EMAIL}, {_ENTITY}, {_ADDR}.
"""

REFUND = f"""\
_Last updated: [DATE]_

This Refund & Cancellation Policy applies to purchases from {_SITE}, operated by
**{_ENTITY}**.

## 1. Order cancellation
- You may request cancellation **before your order is dispatched** by emailing
  {_EMAIL} with your order number. If it hasn't shipped, we cancel it and refund
  you in full.
- Once an order has been dispatched, it can't be cancelled but may be eligible
  for return (below).

## 2. Returns & replacements
We want you to be happy with your purchase. You may request a return within
**[7] days** of delivery if:
- the item arrived **damaged or defective**, or
- you received the **wrong item**.
To be eligible, the item must be unused and in its original condition and
packaging. Email {_EMAIL} with your order number and a photo of the issue.

Because of the nature of the products, we generally **cannot accept returns** of:
- digital products / eBooks once access has been delivered, and
- items damaged by misuse after delivery.

## 3. Refunds
- Once we receive and inspect a returned item (or approve a pre-dispatch
  cancellation), we notify you of approval.
- Approved refunds are issued to your **original payment method** via Razorpay,
  typically within **5–7 business days**, though your bank may take longer to
  reflect it.
- Shipping charges are non-refundable unless the return is due to our error.

## 4. Failed or duplicate payments
If your payment failed but an amount was debited, it is normally auto-reversed by
your bank within **5–7 working days**. For duplicate charges, email {_EMAIL} and
we'll investigate and refund any extra amount.

## 5. Contact
For any cancellation or refund request, email {_EMAIL} with your order number.
"""

SHIPPING = f"""\
_Last updated: [DATE]_

This Shipping & Delivery Policy applies to orders placed on {_SITE}, operated by
**{_ENTITY}**.

## 1. Where we ship
We deliver across India. [For international orders, please contact {_EMAIL}.]

## 2. Processing & dispatch
Orders are typically processed and dispatched within **[1–2] business days** of
successful payment. You'll receive an email confirmation when your order is
placed, and tracking details where available once it ships.

## 3. Delivery timelines
Estimated delivery is **[3–7] business days** after dispatch, depending on your
location and the courier. These are estimates, not guarantees; delays can occur
due to weather, courier or other factors beyond our control.

## 4. Shipping charges
- Shipping is calculated at checkout based on your order.
- Orders above **₹[1,500]** qualify for **free shipping**; below that a flat fee
  of **₹[60]** applies. (Current thresholds are shown at checkout.)

## 5. Delays, damage & non-delivery
- If your order hasn't arrived within the estimated window, email {_EMAIL} with
  your order number and we'll follow up with the courier.
- If a package arrives damaged, see our
  [Refund & Cancellation Policy](/refund-policy).

## 6. Contact
For any delivery questions, contact us at {_EMAIL}.
"""

LEGAL_DEFAULTS = {
    "terms": TERMS,
    "privacy": PRIVACY,
    "refund": REFUND,
    "shipping": SHIPPING,
}

LEGAL_META = {
    "terms": "Terms & Conditions",
    "privacy": "Privacy Policy",
    "refund": "Refund & Cancellation Policy",
    "shipping": "Shipping & Delivery Policy",
}
