"""Email Manager: the personal layer on every customer email.

Run: python backend/tests/test_email_manager.py

* clean_cfg: admin input is capped and checked (bad reply-to / photo / phone
  fall back; security emails cannot be switched off);
* merge: only the fixed fields, HTML-escaped; subjects have no line breaks;
* every customer email renders with the signed note in it (or deliberately
  without), no marker left behind, links utm-tagged except security emails;
* send_email: a switched-off email is skipped and logged, Reply-To defaults to
  the configured inbox, and an Email Manager failure still sends the email.
"""
import asyncio
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
if "resend" not in sys.modules:  # the sandbox has no resend SDK
    stub = types.ModuleType("resend")
    stub.api_key = None
    stub.Emails = types.SimpleNamespace(send=lambda p: {"id": "x"})
    sys.modules["resend"] = stub
os.environ.setdefault("SITE_URL", "https://www.oakbridge.in")

import email_manager as em  # noqa: E402
import emailer  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


print("-- config --")
c = em.clean_cfg({"reply_to": "not-an-email", "signer_photo": "http://x/y.jpg", "whatsapp": "call me",
                  "signer_name": "S" * 200, "kinds": {"otp": {"enabled": False}, "welcome": {"enabled": False, "note": "Hi"},
                                                      "nope": {"enabled": False}}})
check(c["reply_to"] == "info@oakbridge.in" and c["signer_photo"] == "" and c["whatsapp"] == "", "bad reply-to / non-https photo / bad phone fall back")
check(len(c["signer_name"]) == 60, "lengths capped")
check(em.enabled("otp", c) and not em.enabled("welcome", c) and "nope" not in c["kinds"], "security email can't be switched off; unknown kinds dropped")
check(em.enabled("receipt", em.clean_cfg({"kinds": {"receipt": {"enabled": False}}})), "the receipt can't be switched off either")

print("-- merge --")
cfg = em.clean_cfg({"signer_name": "Shreesh"})
out = em.merge("Hi {first_name} <b>{order_number}</b> {unknown}", {"first_name": "<Ana>", "order_number": "OB-1"}, cfg)
check("&lt;Ana&gt;" in out and "&lt;b&gt;" in out and "{unknown}" in out, "values and admin text escaped; unknown fields left as typed")
s = em.subject_for("welcome", "Default", {"first_name": "Ana\r\nBcc: x@y.z"}, em.clean_cfg({"kinds": {"welcome": {"subject": "Hello {first_name}"}}}))
check("\n" not in s and "\r" not in s and s.startswith("Hello Ana"), "subject: merged, no header injection")
check(em.subject_for("welcome", "Default", {}, cfg) == "Default", "blank subject keeps the built-in one")
check(em.note_text("welcome", em.clean_cfg({"kinds": {"welcome": {"note": "-"}}})) == "", "'-' removes the note")
check(em.books_phrase([{"title": "A"}, {"title": "B"}, {"title": "C"}, {"title": "D"}]) == "A, B and 2 more", "books phrase")

print("-- every customer email --")
cfg = em.clean_cfg({"signer_name": "Shreesh", "whatsapp": "+91 98765 43210"})
for k in em.KINDS:
    subj, html, ctx = em.sample(k["key"])
    out = em.personalise(html, k["key"], ctx, cfg)
    want_note = bool(em.note_text(k["key"], cfg))
    has_note = "Just reply to this email" in out
    tagged = "utm_source=email" in out
    ok = (has_note == want_note) and em.MARKER not in out and (not tagged if k["key"] in em.NO_TRACKING else True)
    check(ok, f"{k['key']}: note={has_note} (want {want_note}), utm={'on' if tagged else 'off'}")
r = em.personalise(em.sample("receipt")[1], "receipt", em.sample("receipt")[2], cfg)
check(r.index("Just reply to this email") < r.index("Oakbridge Publishing Pvt. Ltd."), "note sits above the receipt's footer")
check("wa.me/919876543210" in r and "Shreesh" in r, "WhatsApp link and signer shown")
check("Thank you, Ananya." in r, "receipt greets by first name")
check(em.tag_links('<a href="https://www.oakbridge.in/books?utm_source=x">', "k") == '<a href="https://www.oakbridge.in/books?utm_source=x">',
      "existing utm left alone")
check("https://evil.com" in em.tag_links('<a href="https://evil.com/oakbridge.in">', "k") and "utm" not in em.tag_links('<a href="https://evil.com/oakbridge.in">', "k"),
      "only our own links are tagged")

ack = emailer.render_contact_ack_html({"name": "Eve " + "x" * 80, "message": "CLICK https://phish.example now"})
check("phish.example" not in ack and "x" * 41 not in ack, "contact ack never echoes the visitor's message (no relay); name capped")

print("-- send_email --")
sent = []
logged = []


async def fake_cfg(fresh=False):
    return CFG


async def fake_log(kind, to, subject, status):
    logged.append((kind, status))


async def fake_deliver(to, subject, html, reply_to, attachments, headers):
    sent.append({"to": to, "subject": subject, "html": html, "reply_to": reply_to})
    return True

em.get_config = fake_cfg
em.log_send = fake_log
emailer._deliver = fake_deliver
CFG = em.clean_cfg({"reply_to": "care@oakbridge.in", "kinds": {"welcome": {"enabled": False}}})


async def main():
    ok = await emailer.send_account_welcome("a@b.co", "Ananya")
    check(ok is False and not sent and logged[-1] == ("welcome", "skipped"), "switched-off email is not sent, and logged as skipped")
    await emailer.send_cart_reminder("a@b.co", "Ananya Sharma", [{"title": "Book A", "price": 100, "quantity": 1}], "12h")
    m = sent[-1]
    check(m["reply_to"] == "care@oakbridge.in" and "Just reply to this email" in m["html"] and logged[-1] == ("cart_reminder", "sent"),
          "reply-to defaults to the configured inbox; note added; logged")
    check("before someone else does" not in m["html"] and "risk missing out" not in m["html"], "cart reminder: no invented scarcity")

    async def boom(fresh=False):
        raise RuntimeError("db down")
    em.get_config = boom
    n = len(sent)
    ok = await emailer.send_cart_reminder("a@b.co", "Ananya", [{"title": "Book A", "price": 100}], "1w")
    check(ok and len(sent) == n + 1, "Email Manager failure: the plain email still goes")

asyncio.run(main())
print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
