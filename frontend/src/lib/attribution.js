/**
 * Which link brought this visitor, remembered until they buy.
 *
 * WHY IT IS STORED RATHER THAN READ AT CHECKOUT
 *
 * The UTM tags are on the landing URL — the email link, the ad, the post. By
 * the time somebody reaches /checkout they have clicked through four pages and
 * the query string is long gone, so reading it there returns nothing and every
 * order looks like it came from nowhere.
 *
 * WHY sessionStorage AND NOT A COOKIE
 *
 * This is not consent-gated, so it has to be defensible without consent: it is
 * first-party, it holds no identifier and nothing about the person, it dies
 * when the tab closes, and it exists only to attach a campaign name to an order
 * the visitor is placing anyway. A persistent cookie doing cross-visit
 * attribution would be a different thing and would need asking about.
 *
 * FIRST TOUCH WINS
 *
 * Once a source is recorded it is not overwritten. Somebody who arrives from
 * the nudge email, wanders off, and comes back through a Google search is still
 * a sale the email produced; letting the last click claim it would quietly
 * credit organic for work the campaign did.
 */

const KEY = "oakbridge_attribution";

// "ref" = a partner's code from a share link (?ref=KANNAN10). Kept with the
// order, credits the partner, and pre-fills their discount at checkout.
const FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"];

/** Read the tags off the current URL, once, and keep them for the session. */
export function captureAttribution() {
    try {
        const params = new URLSearchParams(window.location.search);
        const found = {};
        for (const f of FIELDS) {
            let v = (params.get(f) || "").trim().slice(0, 120);
            if (f === "ref") v = v.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
            if (v) found[f] = v;
        }
        // A referrer is worth keeping even with no tags on the URL — it is how
        // an untagged link from a blog or a forum still gets credited.
        const ref = (document.referrer || "").trim();
        if (ref && !ref.startsWith(window.location.origin)) {
            found.referrer = ref.slice(0, 200);
        }
        if (!Object.keys(found).length) return null;
        if (sessionStorage.getItem(KEY)) return readAttribution(); // first touch wins
        const value = { ...found, landed_at: new Date().toISOString() };
        sessionStorage.setItem(KEY, JSON.stringify(value));
        return value;
    } catch {
        return null; // private mode, or a URL we cannot parse
    }
}

export function readAttribution() {
    try {
        const raw = sessionStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * One cookie-free visit count per browser session, for Marketing → Growth
 * (visits → checkouts → paid, by channel). Sends only the tags, partner code,
 * referring SITE (host) and landing path — nothing that identifies a person —
 * so, like the attribution above, it needs no consent. text/plain + sendBeacon
 * means no CORS preflight and it never delays the page. Skipped for automated
 * browsers (our own prerenderer runs this code too).
 */
export function sendVisitBeacon(apiBase) {
    try {
        if (!apiBase || navigator.webdriver || sessionStorage.getItem("oakbridge_visit_sent")) return;
        sessionStorage.setItem("oakbridge_visit_sent", "1");
        const params = new URLSearchParams(window.location.search);
        const a = readAttribution() || {};
        const body = {
            utm_source: a.utm_source || params.get("utm_source") || "",
            utm_medium: a.utm_medium || params.get("utm_medium") || "",
            utm_campaign: a.utm_campaign || params.get("utm_campaign") || "",
            ref: a.ref || (params.get("ref") || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24),
            referrer: (() => {
                try { return document.referrer ? new URL(document.referrer).origin : ""; } catch { return ""; }
            })(),
            path: window.location.pathname.slice(0, 120),
        };
        const blob = new Blob([JSON.stringify(body)], { type: "text/plain" });
        if (!(navigator.sendBeacon && navigator.sendBeacon(`${apiBase}/t/visit`, blob))) {
            fetch(`${apiBase}/t/visit`, { method: "POST", body: JSON.stringify(body), keepalive: true,
                headers: { "Content-Type": "text/plain" } }).catch(() => {});
        }
    } catch {
        /* private mode / old browser: no count, nothing breaks */
    }
}

