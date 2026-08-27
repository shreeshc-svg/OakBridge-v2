/**
 * What the visitor agreed to, one category at a time.
 *
 * WHY THIS IS NOT A BOOLEAN ANY MORE
 *
 * The banner used to store "accepted" or "declined". One switch for everything
 * means agreeing to analytics also agrees to whatever is added later, which is
 * not consent to that thing — it is consent to a question nobody asked. India's
 * DPDP Rules 2025 name granular choice and dark patterns explicitly, and
 * "accept everything or nothing" is the pattern they mean.
 *
 * WHY THERE IS A VERSION
 *
 * A new purpose needs new consent. Session replay is a materially different
 * ask from counting pageviews, so when it was added the version went up and
 * everyone is asked once more. Without this, adding a purpose would silently
 * inherit an old yes — the exact failure the granularity is meant to prevent.
 * Raise POLICY_VERSION whenever a new category or purpose appears; do not raise
 * it for wording changes, or people learn to click through the banner.
 */

export const CONSENT_KEY = "oakbridge_cookie_consent";

/** Bumped when a new PURPOSE is added. See the note above. */
export const POLICY_VERSION = 2;

/**
 * essential  — always on, and not a choice: without it you cannot stay signed
 *              in or keep a cart, so there is nothing to consent to.
 * analytics  — PostHog: which pages, which products, where checkout leaks.
 * replay     — session recording. Separate from analytics on purpose: watching
 *              a recording of somebody's screen is a different thing from
 *              counting their clicks, and bundling the two would be the same
 *              trick as one big Accept button.
 * marketing  — advertising and remarketing pixels. Nothing uses this today; the
 *              category exists so adding a pixel is a switch rather than a
 *              re-consent of every visitor.
 */
export const CATEGORIES = ["essential", "analytics", "replay", "marketing"];

export const NONE = {
    essential: true,
    analytics: false,
    replay: false,
    marketing: false,
};

export const ALL = {
    essential: true,
    analytics: true,
    replay: true,
    marketing: true,
};

/**
 * Read the stored choice, or null when there is none to read.
 *
 * Returns null — meaning "ask" — for a choice recorded against an older policy
 * version, and for anything unparseable. Failing towards asking is the only
 * safe direction: the alternative is assuming a yes that was never given.
 */
export function readConsent() {
    let raw = null;
    try {
        raw = localStorage.getItem(CONSENT_KEY);
    } catch {
        return null; // private mode throws; treat as undecided
    }
    if (!raw) return null;

    // The old format, from when this was one switch. An "accepted" from then
    // covered analytics and nothing else, because nothing else existed —
    // so it is honoured for analytics and asked again for the rest.
    if (raw === "accepted") return { ...NONE, analytics: true, version: 1 };
    if (raw === "declined") return { ...NONE, version: 1 };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    if (Number(parsed.version) !== POLICY_VERSION) return null;

    return {
        ...NONE,
        analytics: Boolean(parsed.analytics),
        replay: Boolean(parsed.replay),
        marketing: Boolean(parsed.marketing),
        version: POLICY_VERSION,
        at: parsed.at || null,
    };
}

/** Persist a choice. Returns the object actually stored. */
export function writeConsent(choice) {
    const value = {
        ...NONE,
        analytics: Boolean(choice?.analytics),
        // Replay cannot be on without analytics: it is delivered by the same
        // library, and a recording with no events attached is a video of
        // nothing. Enforced here rather than in the UI so the rule holds
        // wherever the choice is written from.
        replay: Boolean(choice?.replay) && Boolean(choice?.analytics),
        marketing: Boolean(choice?.marketing),
        version: POLICY_VERSION,
        at: new Date().toISOString(),
    };
    try {
        localStorage.setItem(CONSENT_KEY, JSON.stringify(value));
    } catch {
        /* the choice still governs this page view */
    }
    return value;
}

/** True when this visitor has agreed to `category`. */
export function allows(category) {
    if (category === "essential") return true;
    const c = readConsent();
    return Boolean(c && c[category]);
}
