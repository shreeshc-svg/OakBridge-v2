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

import { allows } from "./consent";

const KEY = "oakbridge_attribution";
// 30-day memory of the first source — ONLY for visitors who accepted analytics
// cookies (Oct 2026). Without it, someone who came from an email, left, and
// bought the next day was credited to "Direct". Everyone else keeps the
// session-only behaviour described above.
const PERSIST_KEY = "oakbridge_attribution_30d";
const PERSIST_MS = 30 * 86400000;
// Set on any browser where a staff account has signed in: their own browsing
// is not a customer visit. Not personal data — just "this is a staff device".
const STAFF_KEY = "oakbridge_staff";

function persisted() {
    try {
        if (!allows("analytics")) {
            localStorage.removeItem(PERSIST_KEY); // consent withdrawn: forget it
            return null;
        }
        const p = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
        if (!p || !p.value || !(Number(p.expires) > Date.now())) {
            localStorage.removeItem(PERSIST_KEY);
            return null;
        }
        return p.value;
    } catch {
        return null;
    }
}

function persist(value) {
    try {
        if (allows("analytics") && !persisted()) {
            localStorage.setItem(PERSIST_KEY, JSON.stringify({ value, expires: Date.now() + PERSIST_MS }));
        }
    } catch {
        /* storage full / private mode: session-only, as before */
    }
}

const COUNTED_KEY = "oakbridge_counted"; // what THIS session sent: { at, ...fields, path, steps: [] }

/**
 * Called by AuthContext when a staff account is signed in on this browser.
 * Marks the browser so it is never counted again, and returns this session's
 * already-sent visit (and steps) so the caller can take them back with the
 * signed-in POST /t/unvisit — the "first visit from a staff browser" gap.
 * Returns null when there is nothing to undo (or it was already undone).
 */
export function markStaffBrowser() {
    try {
        localStorage.setItem(STAFF_KEY, "1");
        const c = JSON.parse(sessionStorage.getItem(COUNTED_KEY) || "null");
        if (!c || c.undone) return null;
        sessionStorage.setItem(COUNTED_KEY, JSON.stringify({ ...c, undone: true }));
        return c;
    } catch {
        return null;
    }
}

const isStaffBrowser = () => {
    try {
        return localStorage.getItem(STAFF_KEY) === "1";
    } catch {
        return false;
    }
};

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
        if (sessionStorage.getItem(KEY)) return readAttribution(); // first touch wins
        if (!Object.keys(found).length) {
            // A plain return visit (typed URL, bookmark): with consent, carry
            // the source remembered from the first visit, as analytics tools do
            // for "direct" sessions.
            const back = persisted();
            if (!back) return null;
            const value = { ...back, returning: true };
            sessionStorage.setItem(KEY, JSON.stringify(value));
            return value;
        }
        const value = persisted() ? { ...persisted(), returning: true } : { ...found, landed_at: new Date().toISOString() };
        sessionStorage.setItem(KEY, JSON.stringify(value));
        persist(value);
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
        if (!apiBase || navigator.webdriver || isStaffBrowser() || sessionStorage.getItem("oakbridge_visit_sent")) return;
        sessionStorage.setItem("oakbridge_visit_sent", "1");
        const body = { ...beaconFields(), path: window.location.pathname.slice(0, 120) };
        send(`${apiBase}/t/visit`, body);
        sessionStorage.setItem(COUNTED_KEY, JSON.stringify({ ...body, at: new Date().toISOString(), steps: [] }));
    } catch {
        /* private mode / old browser: no count, nothing breaks */
    }
}

/** Source fields every counter sends (the server works out the channel). */
function beaconFields() {
    const params = new URLSearchParams(window.location.search);
    const a = readAttribution() || {};
    // The remembered referrer first (a returning visitor's original source),
    // then this page load's. Origin only — never the full URL.
    const origin = (u) => {
        try { return u ? new URL(u).origin : ""; } catch { return ""; }
    };
    return {
        utm_source: a.utm_source || params.get("utm_source") || "",
        utm_medium: a.utm_medium || params.get("utm_medium") || "",
        utm_campaign: a.utm_campaign || params.get("utm_campaign") || "",
        ref: a.ref || (params.get("ref") || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24),
        referrer: origin(a.referrer) || origin(document.referrer),
    };
}

function send(url, body) {
    const blob = new Blob([JSON.stringify(body)], { type: "text/plain" });
    if (!(navigator.sendBeacon && navigator.sendBeacon(url, blob))) {
        fetch(url, { method: "POST", body: JSON.stringify(body), keepalive: true,
            headers: { "Content-Type": "text/plain" } }).catch(() => {});
    }
}

/**
 * One count per session per shopping step — "view_item" (a book page),
 * "add_to_cart", "checkout" (checkout page), "payment" (Razorpay opened) — so
 * Marketing → Growth shows where buyers drop out. Same rules as the visit
 * count: no cookies, nothing personal, never for staff or automated browsers.
 */
export function trackStep(apiBase, step) {
    try {
        if (!apiBase || navigator.webdriver || isStaffBrowser()) return;
        const flag = `oakbridge_step_${step}`;
        if (sessionStorage.getItem(flag)) return;
        sessionStorage.setItem(flag, "1");
        send(`${apiBase}/t/step`, { ...beaconFields(), step });
        const c = JSON.parse(sessionStorage.getItem(COUNTED_KEY) || "null");
        if (c && !c.undone) sessionStorage.setItem(COUNTED_KEY, JSON.stringify({ ...c, steps: [...(c.steps || []), step] }));
    } catch {
        /* nothing breaks */
    }
}

