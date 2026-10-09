"""Marketing — the pure parts, testable without a database or network.

  * email verification rules (syntax, typos, role / disposable addresses) and
    the final verdict that combines them with a domain (MX) lookup
  * the email-safe HTML renderer for campaign blocks
  * signed tokens for open / click / unsubscribe / confirm links
  * funnel and rate maths for the dashboard

Nothing here does I/O. marketing.py does the lookups, the database and SES.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import re
from typing import Iterable, Optional

# ------------------------------------------------------------ addresses ---
_DOT_DOMAINS = {"gmail.com", "googlemail.com"}


def normalise_email(email: str) -> str:
    """Reduce an address to the mailbox that actually receives it.

    Gmail ignores dots in the local part and everything after a '+', so
    `te.x.as@gmail.com` and `texas+3@googlemail.com` are one inbox. Used for
    de-duplication only — mail always goes to the address as given.
    (antispam.normalise_email is this same function.)
    """
    e = str(email or "").strip().lower()
    if "@" not in e:
        return e
    local, _, domain = e.partition("@")
    local = local.split("+", 1)[0]
    if domain in _DOT_DOMAINS:
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


# Practical address syntax: what real mail systems accept and Excel sheets
# contain. Not the full RFC (quoted locals etc. never appear in a list and are
# almost always mistakes when they do).
_LOCAL = r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
_DOMAIN = r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}"
EMAIL_RE = re.compile(rf"^{_LOCAL}@{_DOMAIN}$")

COMMON_DOMAINS = (
    "gmail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "hotmail.com", "outlook.com", "live.com",
    "rediffmail.com", "icloud.com", "ymail.com", "protonmail.com", "aol.com", "msn.com", "me.com",
    "zoho.com", "outlook.in", "hotmail.co.in", "live.in", "proton.me",
)
# Wrong endings on the big providers that a distance check would miss or
# misjudge (gmail.co is 1 edit from gmail.com but also a real TLD pattern).
TYPO_FIXES = {
    "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.con": "gmail.com",
    "gmail.in": "gmail.com", "gmail.co.in": "gmail.com", "gamil.com": "gmail.com", "gmial.com": "gmail.com",
    "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
    "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com",
    "hotmail.co": "hotmail.com", "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com",
    "outlook.co": "outlook.com", "outlok.com": "outlook.com", "rediffmail.co": "rediffmail.com",
    "rediff.com": "rediffmail.com", "redifmail.com": "rediffmail.com", "icloud.co": "icloud.com",
}
ROLE_LOCALS = frozenset({
    "admin", "administrator", "info", "contact", "sales", "support", "help", "office", "accounts",
    "billing", "hr", "jobs", "careers", "marketing", "noreply", "no-reply", "donotreply", "postmaster",
    "webmaster", "hostmaster", "abuse", "enquiry", "enquiries", "team", "hello", "mail", "service",
    "admissions", "library", "principal", "registrar", "editor", "orders",
})
# The most common throwaway providers. Not exhaustive by design: a full list
# is thousands of domains and churns weekly; the MX + bounce layers catch the
# rest, and the admin can add more in Settings (extra_disposable).
DISPOSABLE = frozenset({
    "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com", "10minutemail.com",
    "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "throwawaymail.com",
    "yopmail.com", "yopmail.fr", "getnada.com", "nada.email", "dispostable.com", "trashmail.com", "trashmail.de",
    "maildrop.cc", "mintemail.com", "fakeinbox.com", "mailnesia.com", "moakt.com", "emailondeck.com",
    "spamgourmet.com", "mytemp.email", "tempail.com", "tempr.email", "discard.email", "mohmal.com",
    "burnermail.io", "mailcatch.com", "inboxkitten.com", "emailfake.com", "fakemail.net", "luxusmail.org",
    "tmpmail.org", "tmpmail.net", "mail.tm", "mailpoof.com", "getairmail.com", "anonaddy.me", "33mail.com",
    "spambox.us", "trbvm.com", "wegwerfmail.de", "einrot.com", "armyspy.com", "cuvox.de", "dayrep.com",
    "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
})


def levenshtein(a: str, b: str, cap: int = 3) -> int:
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def suggest_domain(domain: str) -> Optional[str]:
    """'gmial.com' -> 'gmail.com'. None if the domain looks intended."""
    d = domain.lower()
    if d in COMMON_DOMAINS:
        return None
    if d in TYPO_FIXES:
        return TYPO_FIXES[d]
    best, dist = None, 9
    for c in COMMON_DOMAINS:
        k = levenshtein(d, c, cap=2)
        if k < dist:
            best, dist = c, k
    # One edit on a short common domain is almost always a typo; two edits
    # only for the long ones (rediffmail.com), to avoid "fixing" real domains.
    if best and (dist == 1 or (dist == 2 and len(best) >= 10)):
        return best
    return None


def check_syntax(raw: str) -> dict:
    """First-pass verdict on one address, no network.

    Returns {email, ok, reasons[], suggestion, role, disposable}. `email` is
    cleaned (trimmed, lowercased, mailto: and surrounding junk removed).
    """
    e = str(raw or "").strip().strip("<>\"'").strip()
    e = re.sub(r"^mailto:", "", e, flags=re.I).strip().lower()
    # "john @ gmail . com" is common in spreadsheets; any other space is not
    # an address ("a b@c.com", "a@b.com and c@d.com").
    e = re.sub(r"\s*@\s*", "@", e)
    e = re.sub(r"\s*\.\s*", ".", e)
    out = {"email": e, "ok": True, "reasons": [], "suggestion": None, "role": False, "disposable": False}
    if not e:
        out.update(ok=False, reasons=["empty"])
        return out
    if e.count("@") != 1 or not EMAIL_RE.match(e) or len(e) > 254 or len(e.split("@")[0]) > 64:
        out.update(ok=False, reasons=["bad format"])
        return out
    local, domain = e.split("@")
    sug = suggest_domain(domain)
    if sug:
        out["suggestion"] = f"{local}@{sug}"
        out["reasons"].append(f"typo? {domain} -> {sug}")
    if local in ROLE_LOCALS or local.split(".")[0] in ROLE_LOCALS:
        out["role"] = True
        out["reasons"].append("role address")
    if domain in DISPOSABLE:
        out["disposable"] = True
        out["ok"] = False
        out["reasons"].append("throwaway domain")
    return out


def verdict(syntax: dict, mx: Optional[bool], *, proven: bool = False, suppressed: Optional[str] = None) -> str:
    """Combine every layer into one status.

    verified  proven real: OTP-confirmed account, delivered/opened before
    valid     good syntax and the domain receives mail
    risky     deliverable domain but role address, or a suggested typo not
              applied, or the domain lookup could not be completed
    invalid   bad syntax, throwaway, or the domain cannot receive mail
    suppressed  bounced / complained / unsubscribed earlier — never mailed
    """
    if suppressed:
        return "suppressed"
    if not syntax.get("ok"):
        return "invalid"
    if mx is False:
        return "invalid"
    if proven:
        return "verified"
    if mx is None or syntax.get("role") or syntax.get("suggestion"):
        return "risky"
    return "valid"


# Send order inside a campaign: proven first, unproven last, so bounces —
# if any — come at the end where the auto-pause can still stop the run.
SEND_ORDER = {"verified": 0, "valid": 1, "risky": 2}
SENDABLE = frozenset(SEND_ORDER)


def should_pause(sent: int, bounced: int, complained: int, *, min_sent: int = 50,
                 max_bounce: float = 0.02, max_complaint: float = 0.001) -> Optional[str]:
    """Stop a campaign before it can hurt the sender reputation. Amazon starts
    reviewing an account around 5% bounces / 0.1% complaints; we stop at 2%
    bounces (or any complaint rate above 0.1%) once there is enough signal."""
    if sent < min_sent:
        return None
    if bounced / sent > max_bounce:
        return f"bounce rate {bounced / sent:.1%} is above {max_bounce:.0%}"
    if complained / sent > max_complaint:
        return f"spam-complaint rate {complained / sent:.2%} is above {max_complaint:.1%}"
    return None


# --------------------------------------------------------------- tokens ---
def sign(secret: str, *parts: str) -> str:
    msg = "|".join(parts).encode()
    return base64.urlsafe_b64encode(hmac.new(secret.encode(), msg, hashlib.sha256).digest()[:18]).decode().rstrip("=")


def check_sig(secret: str, sig: str, *parts: str) -> bool:
    return hmac.compare_digest(sign(secret, *parts), sig or "")


# ------------------------------------------------------------ rendering ---
def _esc(s) -> str:
    return html.escape(str(s or ""), quote=True)


def inline_md(s: str) -> str:
    """**bold**, *italic* and [text](https://link) in text blocks; everything
    else is escaped. Links are http(s)/mailto only."""
    t = _esc(s)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*(?!\*)", r"<em>\1</em>", t)

    def link(m):
        url = html.unescape(m.group(2))
        if not re.match(r"^(https?://|mailto:)", url, re.I):
            return m.group(1)
        return f'<a href="{_esc(url)}" style="color:#002B5C;text-decoration:underline">{m.group(1)}</a>'

    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, t)
    return t.replace("\n", "<br>")


def personalise(text: str, contact: dict) -> str:
    name = (contact.get("name") or "").strip()
    first = name.split(" ")[0] if name else ""
    return (text or "").replace("{{first_name}}", first or "there").replace("{{name}}", name or "there")


def collect_links(blocks: list) -> list:
    """Every link a campaign contains, in order. Click tracking redirects by
    INDEX into this list, so a tracking URL can only ever lead to a link the
    campaign itself contained — never an open redirect."""
    out = []
    for b in blocks or []:
        if b.get("type") in ("button", "image", "book") and b.get("url"):
            out.append(b["url"])
        if b.get("type") == "text":
            out += [html.unescape(u) for u in re.findall(r"\]\((https?://[^)\s]+)\)", b.get("text") or "")]
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def render_email(blocks: list, *, brand: dict, contact: dict, link_for, open_pixel: str = "",
                 unsubscribe_url: str = "", preheader: str = "") -> tuple[str, str]:
    """(html, text) for one recipient. Table layout and inline styles — what
    every mail client (Outlook included) renders the same way.

    link_for(url) -> the tracked URL for that link."""
    navy, red = brand.get("navy", "#002B5C"), brand.get("red", "#CC0033")
    rows, text = [], []

    def L(u):
        return _esc(link_for(u)) if u else ""

    for b in blocks or []:
        t = b.get("type")
        if t == "heading":
            s = personalise(b.get("text"), contact)
            rows.append(f'<tr><td style="padding:24px 32px 4px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.25;font-weight:700;color:{navy}">{_esc(s)}</td></tr>')
            text.append(s.upper())
        elif t == "text":
            s = personalise(b.get("text"), contact)
            body = inline_md(s)
            # Every [text](url) becomes a tracked link (same URL collect_links saw).
            body = re.sub(r'href="([^"]+)"', lambda m: f'href="{L(html.unescape(m.group(1)))}"', body)
            rows.append(f'<tr><td style="padding:10px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1F2937">{body}</td></tr>')
            text.append(re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", s))
        elif t == "image" and b.get("src"):
            img = f'<img src="{_esc(b["src"])}" alt="{_esc(b.get("alt"))}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0">'
            if b.get("url"):
                img = f'<a href="{L(b["url"])}">{img}</a>'
            rows.append(f'<tr><td style="padding:12px 32px">{img}</td></tr>')
        elif t == "button" and b.get("url"):
            label = personalise(b.get("label") or "Find out more", contact)
            rows.append(f'<tr><td align="center" style="padding:18px 32px"><a href="{L(b["url"])}" style="display:inline-block;background:{red};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px">{_esc(label)}</a></td></tr>')
            text.append(f"{label}: {b['url']}")
        elif t == "book" and b.get("url"):
            cover = f'<img src="{_esc(b.get("cover"))}" alt="" width="120" style="display:block;width:120px;height:auto;border:0">' if b.get("cover") else ""
            price = f'<div style="font-size:16px;font-weight:700;color:{red};padding-top:6px">{_esc(b.get("price"))}</div>' if b.get("price") else ""
            rows.append(
                f'<tr><td style="padding:14px 32px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
                f'<td width="130" valign="top"><a href="{L(b["url"])}">{cover}</a></td>'
                f'<td valign="top" style="font-family:Arial,Helvetica,sans-serif;padding-left:16px">'
                f'<div style="font-size:18px;font-weight:700;color:{navy};line-height:1.3">{_esc(b.get("title"))}</div>'
                f'<div style="font-size:14px;color:#4B5563;padding-top:4px">{_esc(b.get("author"))}</div>{price}'
                f'<div style="padding-top:12px"><a href="{L(b["url"])}" style="color:{navy};font-weight:700;font-size:14px">View the book &rarr;</a></div>'
                f'</td></tr></table></td></tr>')
            text.append(f"{b.get('title')} — {b.get('author') or ''} {b.get('price') or ''}: {b['url']}")
        elif t == "divider":
            rows.append('<tr><td style="padding:12px 32px"><div style="border-top:1px solid #E5E7EB;height:1px;line-height:1px">&nbsp;</div></td></tr>')
            text.append("-" * 20)
        elif t == "spacer":
            rows.append('<tr><td style="height:20px;line-height:20px">&nbsp;</td></tr>')

    logo = brand.get("logo")
    head = (f'<img src="{_esc(logo)}" alt="{_esc(brand.get("name", "Oakbridge"))}" width="120" style="display:block;height:auto;border:0">'
            if logo else f'<span style="font-family:Arial;font-size:20px;font-weight:700;color:#fff">{_esc(brand.get("name", "Oakbridge"))}</span>')
    footer_txt = _esc(brand.get("footer") or "")
    unsub = f'<a href="{_esc(unsubscribe_url)}" style="color:#4B5563">Unsubscribe</a>' if unsubscribe_url else ""
    pixel = f'<img src="{_esc(open_pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">' if open_pixel else ""
    pre = f'<div style="display:none;max-height:0;overflow:hidden;opacity:0">{_esc(preheader)}</div>' if preheader else ""
    html_doc = (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"></head>'
        f'<body style="margin:0;padding:0;background:#F5F7FA">{pre}'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F7FA"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff">'
        f'<tr><td style="background:{navy};padding:18px 32px">{head}</td></tr>'
        + "".join(rows) +
        f'<tr><td style="padding:24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6B7280;border-top:1px solid #E5E7EB">'
        f'{footer_txt}<br>{unsub}</td></tr>'
        f'</table>{pixel}</td></tr></table></body></html>'
    )
    text_doc = "\n\n".join(x for x in text if x) + (f"\n\n--\n{brand.get('footer') or ''}\nUnsubscribe: {unsubscribe_url}" if unsubscribe_url else "")
    return html_doc, text_doc


# ------------------------------------------------------------ analytics ---
def rate(part: int, whole: int) -> Optional[float]:
    return round(part / whole, 4) if whole else None


def funnel(stats: dict) -> list:
    """Sent → Delivered → Opened → Clicked → Ordered → Paid, each with its
    count and the conversion from the step before."""
    steps = [("Sent", stats.get("sent", 0)), ("Delivered", stats.get("delivered", 0)), ("Opened", stats.get("opened", 0)),
             ("Clicked", stats.get("clicked", 0)), ("Ordered", stats.get("orders", 0)), ("Paid", stats.get("paid", 0))]
    out, prev = [], None
    for name, n in steps:
        out.append({"step": name, "count": n, "from_prev": rate(n, prev) if prev is not None else None})
        prev = n
    return out


def campaign_tag(campaign_id: str) -> str:
    """utm_campaign value that ties an order back to a campaign."""
    return f"mk-{campaign_id[:8]}"


def add_utm(url: str, campaign_id: str, channel: str = "email") -> str:
    """Add utm tags to our own site's links only (oakbridge.in)."""
    if not re.match(r"^https?://(www\.)?oakbridge\.in(/|$|\?)", url or "", re.I):
        return url
    if "utm_campaign=" in url:
        return url
    sep = "&" if "?" in url else "?"
    frag = ""
    if "#" in url:
        url, frag = url.split("#", 1)
        frag = "#" + frag
    return f"{url}{sep}utm_source={channel}&utm_medium=campaign&utm_campaign={campaign_tag(campaign_id)}{frag}"


def unique_emails(rows: Iterable[str]) -> list:
    seen, out = set(), []
    for r in rows:
        k = normalise_email(r)
        if k and k not in seen:
            seen.add(k)
            out.append(r)
    return out
