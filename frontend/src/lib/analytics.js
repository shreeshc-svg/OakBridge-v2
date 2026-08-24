/**
 * PostHog, loaded only for visitors who have said yes.
 *
 * WHY THE SCRIPT IS INJECTED RATHER THAN BUNDLED
 *
 * `import posthog from "posthog-js"` puts ~60KB gzipped into main.js, downloaded
 * and parsed by every visitor on every first load — including the ones who
 * decline, and including phones on a 4G connection where that is already the
 * weakest part of this site. Injecting PostHog's own script on consent means
 * the bytes are spent only on people who agreed to them, and never block the
 * first paint.
 *
 * WHY IT REFUSES TO RUN DURING THE BUILD
 *
 * Every Vercel deploy renders 354 routes through Puppeteer against
 * localhost:3000. Left unguarded, each build would post 354 pageviews from the
 * build container and quietly ruin a month of numbers before anyone noticed the
 * traffic was fake. Two independent checks below, because one of them failing
 * silently would be indistinguishable from real traffic.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Session recording is off. This site's checkout collects names, addresses and
 * phone numbers, and a replay captures whatever is on screen. It can be turned
 * on later from the PostHog dashboard without touching this file — which is the
 * right place for that decision, because it is a policy choice rather than an
 * engineering one.
 */

import { isPrerender } from "./runtime";

const KEY = process.env.REACT_APP_POSTHOG_KEY || "";
const HOST = process.env.REACT_APP_POSTHOG_HOST || "https://us.i.posthog.com";
export const CONSENT_KEY = "oakbridge_cookie_consent";

/*
 * PostHog serves its library from a different host than its API: us.i.posthog.com
 * ingests events, us-assets.i.posthog.com serves array.js. Deriving one from the
 * other keeps it to a single env var for the common case, and the explicit
 * override exists for self-hosted or EU setups where the pattern differs.
 */
const ASSET_HOST =
    process.env.REACT_APP_POSTHOG_ASSET_HOST ||
    HOST.replace(/^https:\/\/(us|eu)\.i\.posthog\.com$/, "https://$1-assets.i.posthog.com");

let loading = false;
let ready = false;

/**
 * True only in a real browser session that is not the prerenderer.
 *
 * The check itself moved to lib/runtime.js once the marketing popup needed the
 * same answer — two copies of "are we the build?" is precisely the drift that
 * has bitten this codebase before.
 */
const isRealVisitor = () => !isPrerender();

function hasConsent() {
    try {
        return localStorage.getItem(CONSENT_KEY) === "accepted";
    } catch {
        return false; // Safari in private mode throws rather than returning null.
    }
}

/** Load and start PostHog. Safe to call repeatedly; only the first call works. */
export function startAnalytics() {
    if (ready || loading) return;
    if (!KEY || !isRealVisitor() || !hasConsent()) return;
    loading = true;

    const s = document.createElement("script");
    s.src = `${ASSET_HOST}/static/array.js`;
    s.async = true;
    s.onload = () => {
        if (!window.posthog) return;
        window.posthog.init(KEY, {
            api_host: HOST,
            // We fire pageviews ourselves — see trackPageview. React Router
            // changes the URL without a document load, so PostHog's automatic
            // capture would record the first screen and nothing after it.
            capture_pageview: false,
            disable_session_recording: true,
            persistence: "localStorage+cookie",
        });
        ready = true;
        // The visitor consented on some page; that page is the one to record.
        trackPageview(window.location.pathname + window.location.search);
    };
    s.onerror = () => {
        loading = false; // An ad blocker ate it. Never retry, never warn.
    };
    document.head.appendChild(s);
}

/** Stop capturing and forget this visitor. Called when consent is withdrawn. */
export function stopAnalytics() {
    try {
        if (window.posthog?.opt_out_capturing) window.posthog.opt_out_capturing();
        if (window.posthog?.reset) window.posthog.reset();
    } catch {
        /* nothing useful to do */
    }
    ready = false;
}

/**
 * Every capture goes through here.
 *
 * Analytics must never be able to break the shop. If PostHog is absent, blocked,
 * declined or mid-load, this is a no-op — a missing metric is a nuisance, an
 * exception thrown from an "Add to cart" handler is a lost sale.
 */
export function track(event, props = {}) {
    try {
        if (!ready || !window.posthog) return;
        window.posthog.capture(event, props);
    } catch {
        /* swallow */
    }
}

export function trackPageview(path) {
    track("$pageview", { $current_url: window.location.origin + path });
}
