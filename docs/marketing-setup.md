# Marketing — email (Amazon SES) + WhatsApp (Interakt) setup

Admin → **Marketing**. Code: `backend/marketing.py`, `backend/marketing_core.py`, `frontend/src/pages/admin/AdminMarketing.jsx`.

## 1. AWS SES (one-time)

1. **Region**: use the region where `oakbridge.in` is verified in SES. If it isn't the S3 region, set `SES_REGION` on Render (for example `ap-south-1`).
2. **Identity**: SES → Identities → `oakbridge.in` (the domain, not just the address) must show **Verified** with **DKIM: Successful**.
   - Add **custom MAIL FROM** (for example `mail.oakbridge.in`) so SPF aligns.
   - Add a DMARC record if there isn't one: `_dmarc.oakbridge.in TXT "v=DMARC1; p=none; rua=mailto:info@oakbridge.in"`.
3. **Production access**: SES → Account dashboard. If it says *sandbox*, request production access (use case: transactional + opt-in marketing to customers; ~5,000/month; bounces/complaints handled automatically via SNS). In the sandbox only verified recipients receive mail. Admin → Marketing → Settings shows which mode you are in.
4. **IAM**: the backend uses the same `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` as S3. Add to that IAM user:
   ```json
   {"Effect": "Allow", "Action": ["ses:SendRawEmail", "ses:SendEmail", "ses:GetAccount", "ses:GetEmailIdentity"], "Resource": "*"}
   ```
5. **Configuration set** (for bounces/complaints):
   - SES → Configuration sets → create `oakbridge-marketing`.
   - Event destination → **Amazon SNS** → new topic `oakbridge-ses-events`.
   - Events: **Deliveries, Bounces, Complaints, Rejects**. Leave Opens/Clicks **off** — the site tracks those itself.
   - Render env: `SES_CONFIGURATION_SET=oakbridge-marketing`, `SNS_TOPIC_ARN=<the topic ARN>`.
6. **SNS subscription**: SNS → topic → Create subscription → Protocol **HTTPS** → Endpoint = the URL shown in Admin → Marketing → Settings (superadmin sees the full URL; it contains a secret — don't screenshot it). The site confirms the subscription automatically; "Last event" in Settings updates on the first delivery.

## 2. Render env (summary)

| Variable | Required | Notes |
|---|---|---|
| `SES_REGION` | if SES region ≠ S3 region | falls back to `S3_REGION` / `AWS_REGION` / `ap-south-1` |
| `SES_CONFIGURATION_SET` | yes, for bounce handling | without it, bounces are not recorded and auto-pause can't trigger |
| `SNS_TOPIC_ARN` | recommended | rejects events from any other topic |
| `TASK_TOKEN` | already set | reused by the marketing cron |

## 3. Cron (scheduled sends + resuming)

Campaigns sent with **Send now** start immediately and resume after a deploy. **Scheduled** campaigns need a tick every 5 minutes. Use the same cron service as the payment reconcile:

```
POST https://api.oakbridge.in/api/tasks/marketing-tick
Header: X-Task-Token: <TASK_TOKEN>
Every 5 minutes
```

## 4. Daily use

1. **Contacts → Sync website contacts**: pulls newsletter sign-ups, paying customers and confirmed accounts.
2. **Verify & import**: upload an Excel/CSV → *Check the file* (nothing saved) → review → name the list, tick consent only if those people agreed, say where → *Import*.
3. **Campaigns → New email campaign**: subject, blocks, audience → **Send test** to yourself → **Send now** / **Schedule**. The count you confirm must still match at send time.
4. **Dashboard / report**: opens, clicks, bounces, orders and revenue (orders are tied to a campaign by the `utm_campaign=mk-…` tag on our links).

## 4a. Amazon SES Email Validation (mailbox checks)

- On by default (Admin → Marketing → Settings → Rules) with a **monthly ₹ budget** (default ₹850 ≈ 1,000 checks). A dashboard banner appears at 80%.
- Who gets checked: every contact not already proven (confirmed account / delivered before) and not already invalid. Each mailbox is checked once and the verdict reused for 180 days.
- When: the moment people arrive (newsletter sign-up — before the confirmation email —, checkout opt-in, import), in the background on every cron tick, and **automatically when a campaign is sent**.
- **Send = check, then send.** Send puts the campaign in *Preparing*: unchecked recipients are checked, then each is sent, sent last, or skipped **with the reason** (report → "Not sent"). Nothing is mailed unchecked; nothing waits for an admin.
- Risky addresses follow standing rules (Settings): role address → send; catch-all company domain → send last, stops itself above 3% bounces; mailbox unconfirmed → skip.
- Bounce spike: the first time, unproven / non-HIGH addresses are dropped (old HIGH verdicts re-checked) and sending carries on. A second spike pauses the campaign and raises a dashboard alert.
- Domain learning: 3 different hard bounces at one company domain → new addresses there become risky. Never applied to Gmail / Yahoo / Outlook etc.
- AWS suppression list is copied into Contacts daily (Settings → SNS box → Sync now).
- IAM needs `ses:GetEmailAddressInsights` **and** `ses:ListSuppressedDestinations`. If Settings says the AWS library is too old: Render → Manual Deploy → **Clear build cache & deploy**.
- SES **Auto Validation** (console switch) is optional. Blocks it causes are recorded as "blocked", not bounces, so they don't trigger auto-pause.

## 4b. Confidence score and self-learning

- Every unproven address gets a 0–100 score: starts at 65 (passed the free checks), then ± for SES result, mailbox confirmed / not, catch-all domain, looks random, name matches the address, domain delivery history (3+ delivered, no bounces = good; 3+ bounced = bad). Valid ≥ 65, invalid < 35, risky between (Settings).
- Hard facts never become a score: bad format, no mail server, throwaway, bounced/unsubscribed before, SES "mailbox does not exist" → invalid; confirmed account / delivered before → verified.
- Catch-all test: once per company domain per 90 days SES is asked about a made-up address there (≈ ₹0.85). Never for Gmail/Yahoo/Outlook etc.
- Slow domain lookups are retried, not flagged.
- Each campaign email records what we believed (band, score, signals). Daily, the learning pass compares that with real hard bounces: each signal's weight moves (±20 max, needs 30+ sends), and "Valid from" moves one step (55–85) if valid addresses bounced >2% or risky ones turned out clean. Dashboard → *Address accuracy & self-learning* shows the bounce rate per flag and every change; Settings can switch learning off.
- Order emails (Resend) don't count as proof yet: no Resend delivery webhook is connected.

## 5. Safety rails (automatic)

- Only `subscribed` people get campaigns; unsubscribed, bounced and complained addresses are excluded whatever list they are in.
- Hard bounce or complaint → suppressed forever. Three soft bounces → suppressed.
- Campaign auto-pauses when bounces pass the limit in Settings (default 2%) or complaints pass 0.1%.
- Every email has a one-click unsubscribe (Gmail/Yahoo requirement) and the footer from Settings — put the company's postal address there.
- Website sign-ups use double opt-in (a confirm email) unless turned off in Settings.
- Erasing a contact (privacy request) keeps only a hash, so a later import can't bring them back.

## 6. Notes

- Sender is `info@oakbridge.in`, on the root domain, so marketing mail shares reputation with order emails. Keep bounces low (verify before importing). If volume grows, move marketing to a subdomain such as `news.oakbridge.in`.
- WhatsApp campaigns use approved **Marketing** templates through Interakt, go only to people who ticked the WhatsApp marketing box, and respect the Off/Test/Live switch in Admin → WhatsApp.
- DPDP Act 2023: consent must be specific and provable. The import asks *where* consent was given and stores it with the contact; don't tick consent for bought or scraped lists.
