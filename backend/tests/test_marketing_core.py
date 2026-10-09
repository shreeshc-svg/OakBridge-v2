"""marketing_core: verification verdicts, typo fixes, tracked rendering, tokens,
auto-pause and funnel maths.

Run: python backend/tests/test_marketing_core.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import marketing_core as m  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


print("-- syntax and cleaning --")
c = m.check_syntax("  <Rohan.K@Gmail.com> ")
check(c["email"] == "rohan.k@gmail.com" and c["ok"] and not c["reasons"], "trimmed, lowercased, brackets removed")
check(m.check_syntax("mailto:a@b.co")["email"] == "a@b.co", "mailto: prefix removed")
for bad in ["", "abc", "a@", "@b.com", "a@b", "a b@c.com x", "a@@b.com", "a@b..com", ".a@b.com"]:
    check(not m.check_syntax(bad)["ok"], f"rejects {bad!r}")
check(m.check_syntax("first.last+tag@company.co.in")["ok"], "accepts dots, plus and co.in")

print("-- typos, role, throwaway --")
check(m.check_syntax("x@gmial.com")["suggestion"] == "x@gmail.com", "gmial.com -> gmail.com")
check(m.check_syntax("x@gmail.co")["suggestion"] == "x@gmail.com", "gmail.co -> gmail.com")
check(m.check_syntax("x@yahooo.com")["suggestion"] == "x@yahoo.com", "yahooo.com -> yahoo.com")
check(m.check_syntax("x@oakbridge.in")["suggestion"] is None, "a real company domain is never 'fixed'")
check(m.check_syntax("x@gmx.com")["suggestion"] is None, "short real domains near gmail are not 'fixed'")
check(m.check_syntax("info@school.edu.in")["role"], "info@ is a role address")
check(m.check_syntax("me@mailinator.com")["disposable"] and not m.check_syntax("me@mailinator.com")["ok"], "throwaway domain is invalid")

print("-- verdicts --")
ok = m.check_syntax("a@company.com")
check(m.verdict(ok, True) == "valid", "good syntax + mail server -> valid")
check(m.verdict(ok, False) == "invalid", "domain without a mail server -> invalid")
check(m.verdict(ok, None) == "risky", "lookup could not finish -> risky, not invalid")
check(m.verdict(ok, True, proven=True) == "verified", "OTP-confirmed / delivered before -> verified")
check(m.verdict(m.check_syntax("info@company.com"), True) == "risky", "role address -> risky")
check(m.verdict(ok, True, suppressed="bounced") == "suppressed", "bounced before -> suppressed, whatever else")
check(m.SEND_ORDER["verified"] < m.SEND_ORDER["valid"] < m.SEND_ORDER["risky"], "proven addresses are sent first")

print("-- auto-pause --")
check(m.should_pause(40, 5, 0) is None, "no decision on too little data")
check(m.should_pause(100, 2, 0) is None, "2% bounces is allowed")
check("bounce" in (m.should_pause(100, 3, 0) or ""), "3% bounces pauses")
check("complaint" in (m.should_pause(1000, 0, 2) or ""), "0.2% spam complaints pauses")

print("-- duplicates --")
check(m.unique_emails(["A.B@gmail.com", "ab@gmail.com", "ab+x@googlemail.com", "c@d.com"]) == ["A.B@gmail.com", "c@d.com"],
      "one Gmail inbox counted once (dots, +tags, googlemail)")

print("-- tokens --")
sig = m.sign("s3cret", "open", "send1")
check(m.check_sig("s3cret", sig, "open", "send1") and not m.check_sig("s3cret", sig, "open", "send2"), "signed links can't be swapped")
check(not m.check_sig("other", sig, "open", "send1"), "and need the server secret")

print("-- rendering --")
blocks = [
    {"type": "heading", "text": "Hi {{first_name}}"},
    {"type": "text", "text": "Read **this** [now](https://www.oakbridge.in/a?b=1&c=2) <script>x</script>"},
    {"type": "button", "label": "Shop", "url": "https://www.oakbridge.in/books"},
    {"type": "text", "text": "[bad](javascript:alert(1))"},
]
links = m.collect_links(blocks)
check(links == ["https://www.oakbridge.in/a?b=1&c=2", "https://www.oakbridge.in/books"], f"links collected in order {links}")
html_doc, text_doc = m.render_email(blocks, brand={"footer": "Oakbridge, Gurgaon"}, contact={"name": "Asha Verma"},
                                    link_for=lambda u: f"T{links.index(u)}", open_pixel="PIX", unsubscribe_url="UNSUB")
check("Hi Asha" in html_doc and "<script>" not in html_doc and "&lt;script&gt;" in html_doc, "personalised, and HTML in text is escaped")
check(re.findall(r'href="(T\d)"', html_doc) == ["T0", "T1"], "every content link is the tracked one")
check("javascript:" not in html_doc, "javascript: links are dropped")
check('src="PIX"' in html_doc and 'href="UNSUB"' in html_doc and "Unsubscribe: UNSUB" in text_doc, "open pixel + unsubscribe in HTML and text")

print("-- utm and funnel --")
check(m.add_utm("https://www.oakbridge.in/books?x=1", "abcdef123") == "https://www.oakbridge.in/books?x=1&utm_source=email&utm_medium=campaign&utm_campaign=mk-abcdef12",
      "own-site links get utm tags tying orders to the campaign")
check(m.add_utm("https://amazon.in/x", "abcdef123") == "https://amazon.in/x", "other sites are left alone")
f = m.funnel({"sent": 1000, "delivered": 980, "opened": 300, "clicked": 60, "orders": 6, "paid": 5})
check([s["count"] for s in f] == [1000, 980, 300, 60, 6, 5] and f[2]["from_prev"] == round(300 / 980, 4), "funnel steps and step conversion")

print()
if failed:
    print(f"{failed} assertion(s) failed")
    sys.exit(1)
print("all assertions passed")
