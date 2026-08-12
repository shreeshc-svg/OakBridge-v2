import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CONSENT_KEY, startAnalytics, stopAnalytics } from "../lib/analytics";

/**
 * The cookie banner, now with an actual choice behind it.
 *
 * IT USED TO BE A NOTICE, NOT A CHOICE
 *
 * One "Accept" button, no way to say no, and copy promising "We don't use
 * tracking or advertising cookies." That was true while nothing tracked
 * anything. The moment analytics arrived it became a claim the site did not
 * honour, which is worse than having no banner at all — under GDPR and India's
 * DPDP Act, consent has to be freely given, and a dialog with one button is not
 * a decision.
 *
 * So: two buttons, honest copy, and the choice actually drives whether PostHog
 * loads. Decline means the script is never fetched, not fetched-and-ignored.
 */
export default function CookieConsent() {
    const [show, setShow] = useState(false);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(CONSENT_KEY);
            if (!saved) setShow(true);
            // A returning visitor who already agreed: start without asking again.
            else if (saved === "accepted") startAnalytics();
        } catch {
            /* private mode — behave as though no choice was made */
        }
    }, []);

    const choose = (value) => {
        try {
            localStorage.setItem(CONSENT_KEY, value);
        } catch {
            /* the choice still applies to this page view */
        }
        setShow(false);
        if (value === "accepted") startAnalytics();
        else stopAnalytics();
    };

    if (!show) return null;

    return (
        <div
            data-testid="cookie-consent"
            className="fixed z-[45] left-4 right-4 bottom-above-tray md:bottom-4 md:right-auto md:max-w-md bg-white border border-[#E5E7EB] shadow-2xl p-4"
        >
            <div className="text-sm text-[#4B5563] leading-relaxed">
                We use essential cookies to keep you signed in and remember your cart.
                With your permission we also use analytics cookies to understand how the
                site is used, so we can improve it. See our{" "}
                <Link to="/cookie-policy" className="text-[#002B5C] underline">
                    Cookie Policy
                </Link>
                .
            </div>
            <div className="mt-3 flex items-center gap-3">
                <button
                    type="button"
                    onClick={() => choose("accepted")}
                    data-testid="cookie-accept"
                    className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] transition-colors"
                >
                    Accept
                </button>
                {/* Same size and prominence as Accept. A decline styled as a
                    whisper is the dark pattern regulators actually name. */}
                <button
                    type="button"
                    onClick={() => choose("declined")}
                    data-testid="cookie-decline"
                    className="border border-[#002B5C] text-[#002B5C] px-5 py-2 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                >
                    Decline
                </button>
                <Link to="/cookie-policy" className="ml-auto text-xs text-[#4B5563] underline">
                    Learn more
                </Link>
            </div>
        </div>
    );
}
