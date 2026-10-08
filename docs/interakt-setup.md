# Interakt (WhatsApp) — setup

Code: `backend/interakt.py` · Admin: **Admin → WhatsApp** · Tests: `backend/tests/test_interakt.py`

## 1. Render environment

| Variable | Value |
|---|---|
| `INTERAKT_API_KEY` | Interakt → Settings → Developer Settings → API key (sent as `Authorization: Basic <key>`) |
| `INTERAKT_WEBHOOK_SECRET` | Any long random string (40+ characters). `INTERAKT_SECRET` is also accepted. |

Never paste either value into chat or commit it.

## 2. Templates to create in Interakt

Interakt → Templates → **New**. Category **Utility** for the three order messages, **Marketing** for the cart reminder. Language **English**. The **name** must match Admin → WhatsApp → Settings (defaults below). The variables must be in this order.

**order_confirmed** (Utility)
> Hi {{1}}, thank you for your order {{2}} with Oakbridge Publishing. We have received your payment of {{3}} for {{4}}. We will WhatsApp you again when it is dispatched.

**order_shipped** (Utility)
> Hi {{1}}, your Oakbridge order {{2}} is on its way with {{3}}. Tracking number: {{4}}.

**order_cancelled** (Utility)
> Hi {{1}}, your Oakbridge order {{2}} has been cancelled ({{3}}). If you paid online, the refund goes back to your original payment method. Reply here if you have any questions.

**cart_reminder** (Marketing)
> Hi {{1}}, you left {{2}} — {{3}} — in your Oakbridge cart. It is still waiting for you: {{4}}
> Reply STOP to stop these messages.

Sample values for Meta's review: `Rohan`, `OAK-1234`, `₹716`, `International Relations + 1 more` / `Delhivery`, `AWB123456` / `at your request` / `International Relations`, `and 2 more`, `https://www.oakbridge.in/cart`.

Nothing is sent until a template is **approved** (usually within a day).

## 3. Webhook

Admin → WhatsApp → Settings shows the **Webhook URL** (superadmin only). In Interakt → Developer Settings → Webhooks:
- **URL**: paste it (it ends with your secret).
- **Secret Key**: the same value as `INTERAKT_WEBHOOK_SECRET`.
- Tick the message status events and **incoming messages**.

After the first webhook arrives, Settings shows "Last webhook … signature matched / did not match". Send that result to the developer: the signature check is recorded but not yet enforced, because Interakt's documentation does not state how it is computed.

## 4. Turning it on

1. Settings → enter **your** number as the test number → **Test** → Save.
2. Press **Send test** next to each template. Check your phone and the Messages tab (sent → delivered → read).
3. Place a real test order and mark it shipped with "notify" ticked: both messages arrive on the test number.
4. Switch to **Live**.

## What customers see / consent

- Checkout: **"WhatsApp me order updates"** (ticked by default, can be unticked) and, for signed-in customers, **"Also WhatsApp me cart reminders and new-release news"** (unticked by default).
- Order updates go only to orders with the first box ticked; cart reminders only to customers who ticked the second. Orders placed before this release get no WhatsApp.
- A customer who replies **STOP** gets no more cart reminders.
- Shipped / cancelled messages follow the same "notify" tick as the email in Admin → Orders.
