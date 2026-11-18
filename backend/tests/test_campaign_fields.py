"""Personal fields in campaigns — a sheet column per person ({{offer_link}},
{{pass_no}}) for event-pass payment emails (Nov 2026).

Runs the real renderer (marketing_core) and the pure helpers of marketing.py
(extracted by name: that module needs the whole server to import), plus
wiring checks on the send path.
Run: python backend/tests/test_campaign_fields.py
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import marketing_core as core  # noqa: E402

failed = 0


def check(cond, label):
    global failed
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        failed += 1


SRC = open(os.path.join(os.path.dirname(HERE), "marketing.py"), encoding="utf-8").read()
tree = ast.parse(SRC)
ns = {"core": core, "re": re, "Optional": None}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in ("_field_report", "missing_fields"):
        exec(compile(ast.Module([node], []), "marketing.py", "exec"), ns)

ASHA = {"name": "Asha Verma", "email": "asha@x.in", "_fields": {"offer_link": "https://rzp.io/l/LS42?a=1&b=2", "pass_no": "LS-0042"}}
BLOCKS = [{"type": "heading", "text": "Your pass {{pass_no}}"},
          {"type": "text", "text": "Hi {{first_name}}, pass **{{pass_no}}** is held for you. [Pay now]({{offer_link}}) · [Programme](https://www.oakbridge.in/events)"},
          {"type": "button", "label": "Pay for pass {{pass_no}}", "url": "{{offer_link}}"}]
CAMP = {"subject": "Pass {{pass_no}} — pay to confirm", "blocks": BLOCKS}

print("-- keys from sheet headers --")
check(core.field_key("Offer Link") == "offer_link" and core.field_key("Pass No.") == "pass_no", "headers become {{offer_link}}, {{pass_no}}")
check(core.field_key("First Name") == "" and core.field_key("email") == "" and core.field_key("2nd") == "",
      "a column can't replace a built-in variable; must start with a letter")
check(core.should_be_unique("pass_no") and core.should_be_unique("serial") and core.should_be_unique("offer_link")
      and core.should_be_unique("anything", ["https://a.in/1", "https://a.in/2"]) and not core.should_be_unique("city", ["Delhi"]),
      "serials, pass numbers and links must be unique; a city needn't be")

print("-- rendering for one person --")
links = core.collect_links(BLOCKS)
check(links == ["{{offer_link}}", "https://www.oakbridge.in/events"], "the personal link is a tracked link like any other")
html, text = core.render_email(BLOCKS, brand={}, contact=ASHA, link_for=lambda u: f"https://api/c/{links.index(u)}" if u in links else u)
hrefs = re.findall(r'href="([^"]+)"', html)
check(hrefs == ["https://api/c/0", "https://api/c/1", "https://api/c/0"], "button and text link both go through click tracking")
check("LS-0042" in html and "Pay for pass LS-0042" in html and "{{" not in html, "serial number printed, no raw braces")
check("https://rzp.io/l/LS42?a=1&b=2" in text, "plain-text part carries her own payment link")
html, _ = core.render_email(BLOCKS, brand={}, contact=ASHA, link_for=lambda u: u)
check('href="https://rzp.io/l/LS42?a=1&amp;b=2"' in html, "preview / test: the link is filled in (and escaped)")
evil = {"name": "X", "_fields": {"offer_link": "javascript:alert(1)", "pass_no": "<b>1</b>"}}
html, _ = core.render_email(BLOCKS, brand={}, contact=evil, link_for=lambda u: u)
check("javascript:" not in html and "<b>1</b>" not in html, "a sheet cell can't become a javascript: link or HTML")
check(core.personalise("{{first_name}}", {"name": "Asha", "_fields": {"first_name": "Mallory"}}) == "Asha",
      "a custom field never overrides a built-in")

print("-- a shared offer link that knows who clicked --")
OFFER = "https://www.oakbridge.events/offer/o/AE78xn9Y5H?email={{email}}&name={{name}}"
check(core.resolve_url(OFFER, {"name": "Asha Verma", "email": "asha+law@x.in"})
      == "https://www.oakbridge.events/offer/o/AE78xn9Y5H?email=asha%2Blaw%40x.in&name=Asha%20Verma",
      "email and name filled in, percent-encoded (spaces, + and @ can't break the link)")
check(core.resolve_url(OFFER, {"name": "", "email": "b@x.in"}).endswith("email=b%40x.in&name="),
      "no name: left empty, not the greeting default 'there'")
check(core.resolve_url(OFFER, {"name": "R&D Team", "email": "c@x.in"}).endswith("name=R%26D%20Team"),
      "an & in a name can't add a parameter of its own")
ob = [{"type": "button", "label": "Claim your offer", "url": OFFER}, {"type": "text", "text": "Or [open the offer]({u})".format(u=OFFER)}]
ol = core.collect_links(ob)
check(ol == [OFFER], "button and text link are one tracked link (as written)")
h, t = core.render_email(ob, brand={}, contact={"name": "Asha Verma", "email": "asha@x.in"}, link_for=lambda u: u)
check(h.count("email=asha%40x.in&amp;name=Asha%20Verma") == 2 and "{{" not in h and "name=Asha%20Verma" in t,
      "preview / test: both links filled for the person")
send_links = [core.resolve_url(u, {"name": "Asha Verma", "email": "asha@x.in"}) or u for u in ol]
check(send_links == ["https://www.oakbridge.events/offer/o/AE78xn9Y5H?email=asha%40x.in&name=Asha%20Verma"],
      "the send stores her resolved link — the click redirect goes there")
check(core.add_utm(send_links[0], "c1") == send_links[0], "no utm tags added to the events site's link")

print("-- who gets it --")
used = core.used_fields(core.campaign_texts(CAMP), ["offer_link", "pass_no", "seat"])
check(used == {"pass_no": True, "offer_link": True}, "fields used are found in subject, text, label AND the button link")
check(core.used_fields(["{{seat|Free seating}}"], ["seat"]) == {"seat": False}, "with a fallback it isn't required")
check(ns["missing_fields"](CAMP, ASHA, used) == [], "Asha has everything")
check(ns["missing_fields"](CAMP, {"name": "B", "_fields": {"pass_no": "LS-7"}}, used) == ["offer_link"], "no payment link -> skipped")
check(ns["missing_fields"](CAMP, {"name": "C", "_fields": {"pass_no": "LS-8", "offer_link": "rzp.io/x"}}, used) == ["offer_link"],
      "a 'link' that isn't a web link -> skipped, not sent broken")

print("-- import report --")
rows = [{"email": "a@x.in", "offer link": "https://rzp.io/l/1", "pass no": "LS-1"},
        {"email": "b@x.in", "offer link": "https://rzp.io/l/1", "pass no": "LS-2"},
        {"email": "c@x.in", "offer link": "", "pass no": "LS-2"}]
rep = {f["key"]: f for f in ns["_field_report"]([("offer link", "offer_link"), ("pass no", "pass_no")], rows)}
check(rep["offer_link"]["link"] and rep["offer_link"]["empty"] == 1 and rep["offer_link"]["duplicates"] == ["https://rzp.io/l/1"],
      "report: links, 1 empty, a shared payment link flagged")
check(rep["pass_no"]["duplicates"] == ["LS-2"], "report: a shared serial number flagged")

print("-- wiring (marketing.py) --")
code = re.sub(r'"""[\s\S]*?"""', "", SRC)
code = "\n".join(x for x in code.splitlines() if not x.strip().startswith("#"))
send = code[code.index("tail_batch = any("):code.index("if tail_batch and camp")]
check("missing_fields(camp, contact, used)" in send and '"status": "skipped"' in send, "sender skips anyone without a value")
check("send_links = [core.resolve_url(u, contact) or u for u in camp.get(\"links\") or []]" in send
      and '{"$set": {"links": send_links}}' in send, "each send stores its own resolved links (click redirects there)")
adm = code[code.index("async def adm_send"):code.index("async def queue_send")]
check("await field_check(c)" in adm and "must be different for everyone" in adm, "Send refuses a shared serial / link")
check(code.count("db.mk_list_fields.delete_many") >= 6, "values removed with the contact (erase/delete) and with the list")
check('"fields": {k: str(r.get(col) or "").strip()[:core.FIELD_VALUE_MAX]' in code and "db.mk_list_fields.update_one({\"list_id\": lid" in code,
      "import keeps the columns; approval stores them per list")

print()
if failed:
    print(f"{failed} check(s) failed")
    sys.exit(1)
print("all checks passed")
