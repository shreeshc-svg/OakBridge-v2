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

const FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

/** Read the tags off the current URL, once, and keep them for the session. */
export function captureAttribution() {
    try {
        const params = new URLSearchParams(window.location.search);
        const found = {};
        for (const f of FIELDS) {
            const v = (params.get(f) || "").trim().slice(0, 120);
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
