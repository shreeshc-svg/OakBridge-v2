# Email Manager (Admin → Email Manager)

Every email a customer receives, signed by a real person they can reply to.

## Set up once
1. **Who customers hear from** — first name, role, photo, the inbox replies go to (read daily), WhatsApp, hours, dispatch promise. Save.
2. Open any email → **Preview** / **Test to me** (sends only to your own login address).

## Per email
- **On/Off** — receipt, sign-up code and password reset are always on.
- **Subject** — blank keeps the built-in one.
- **Personal note** — blank = default; `-` = no note. Merge fields: `{first_name}` `{order_number}` `{books}` `{signer}` `{dispatch_promise}`.

## What changed in the emails
- Every customer email: signed note + Reply-To to your inbox + links tagged `utm_source=email` (Marketing → Growth counts the orders they bring). Security emails are never tagged.
- **Delivered** — its own email: thank-you, review ask, three in-stock titles from the same subjects.
- **Contact form** — every subject except "Manuscript Submission" now gets a signed "we've received your message" (switchable). The visitor's message is never echoed back (anti-relay).
- **Cart reminder** — calm copy (no invented scarcity); skipped while the customer has an unpaid checkout from the last 3 days.
- **Dispatch** — gift orders say "your gift to {name} is on its way".
- Names in every email are HTML-escaped.

Unpaid-checkout and review-request automations stay in Marketing → Growth (shown read-only here).
Sends are logged 90 days (`email_log`, TTL).
