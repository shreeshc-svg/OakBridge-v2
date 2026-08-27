import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { startAnalytics, stopAnalytics } from "../lib/analytics";
import { ALL, NONE, readConsent, writeConsent } from "../lib/consent";

/**
 * The cookie banner: a choice per purpose, not one switch for everything.
 *
 * WHAT CHANGED AND WHY
 *
 * It began as a notice with a single Accept. Then it became Accept or Decline,
 * which was honest but still all-or-nothing — agreeing to be counted also
 * agreed to whatever got added later, which is consent to a question nobody
 * asked. India's DPDP Rules 2025 name granular choice, and name dark patterns
 * as an enforcement risk; "everything or nothing" is the pattern they mean.
 *
 * THE RULES THIS FOLLOWS
 *
 *   Reject is exactly as easy as Accept — same size, same weight, same row.
 *     A decline styled as a whisper, or hidden one click deeper, is the
 *     specific thing regulators call out.
 *   Nothing is pre-ticked except the essentials, which are not a choice.
 *   Closing the banner is not consent. There is no X: dismissing without
 *     deciding would otherwise be read as a yes by whoever wrote the code.
 *   Withdrawing is as easy as giving — the footer link reopens this, and
 *     turning a category off stops it immediately, not on next load.
 */

const ROWS = [
    {
        key: "essential",
        label: "Essential",
        locked: true,
        text: "Keeps you signed in, remembers your cart, and keeps checkout secure. The site cannot work without these, so there is nothing to agree to.",
    },
    {
        key: "analytics",
        label: "Analytics",
        text: "Counts which pages and books are viewed, and where people give up during checkout. It tells us what to fix.",
    },
    {
        key: "replay",
        label: "Session recording",
        text: "Records how the page was used — clicks and scrolling — so we can see where checkout goes wrong. Everything you type and everything shown about you is hidden from the recording. Needs Analytics on.",
    },
    {
        key: "marketing",
        label: "Marketing",
        text: "Advertising and remarketing. We do not run any today; this switch exists so we would have to ask before we did.",
    },
];

export default function CookieConsent() {
    const [show, setShow] = useState(false);
    const [custom, setCustom] = useState(false);
    const [draft, setDraft] = useState(NONE);

    const open = useCallback(() => {
        setDraft(readConsent() || NONE);
        setCustom(false);
        setShow(true);
    }, []);

    useEffect(() => {
        const saved = readConsent();
        // No decision, or one recorded against an older policy version — which
        // means a purpose has been added since, and the old yes does not cover it.
        if (!saved) setShow(true);
        else if (saved.analytics) startAnalytics();
    }, []);

    // The footer's "Cookie preferences" link reopens this. Withdrawal has to be
    // as easy as consent was, and burying it in a policy page is not that.
    useEffect(() => {
        const reopen = () => open();
        window.addEventListener("oakbridge:cookie-preferences", reopen);
        return () => window.removeEventListener("oakbridge:cookie-preferences", reopen);
    }, [open]);

    const commit = (choice) => {
        const saved = writeConsent(choice);
        setShow(false);
        setCustom(false);
        if (saved.analytics) startAnalytics();
        // Turning it off has to bite now, not on the next page load — the
        // visitor has just told us to stop.
        else stopAnalytics();
    };

    if (!show) return null;

    return (
        <div
            data-testid="cookie-consent"
            role="dialog"
            aria-modal="false"
            aria-label="Cookie choices"
            className="fixed z-[45] left-4 right-4 bottom-above-tray md:bottom-4 md:right-auto md:max-w-lg bg-white border border-[#E5E7EB] shadow-2xl p-5"
        >
            <div className="text-sm text-[#4B5563] leading-relaxed">
                We use essential cookies to keep you signed in and remember your cart. With
                your permission we also measure how the site is used, so we can improve it.
                You can change any of this later.{" "}
                <Link to="/cookie-policy" className="text-[#002B5C] underline">
                    Cookie Policy
                </Link>
                .
            </div>

            {custom && (
                <div data-testid="cookie-options" className="mt-4 divide-y divide-[#E5E7EB] border-y border-[#E5E7EB]">
                    {ROWS.map((r) => {
                        // Replay is delivered by the analytics library and is
                        // meaningless without it, so it follows analytics down.
                        const blocked = r.key === "replay" && !draft.analytics;
                        return (
                            <label
                                key={r.key}
                                className={`flex items-start gap-3 py-3 ${r.locked ? "" : "cursor-pointer"}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={r.locked ? true : Boolean(draft[r.key]) && !blocked}
                                    disabled={r.locked || blocked}
                                    onChange={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            [r.key]: e.target.checked,
                                            // Switching analytics off takes recording with it.
                                            ...(r.key === "analytics" && !e.target.checked
                                                ? { replay: false }
                                                : {}),
                                        }))
                                    }
                                    data-testid={`cookie-toggle-${r.key}`}
                                    className="accent-[#002B5C] w-4 h-4 mt-0.5 shrink-0 disabled:opacity-50"
                                />
                                <span>
                                    <span className="text-sm font-medium text-[#002B5C]">
                                        {r.label}
                                        {r.locked && (
                                            <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-[#4B5563]">
                                                Always on
                                            </span>
                                        )}
                                    </span>
                                    <span className="block text-xs text-[#4B5563] leading-relaxed mt-0.5">
                                        {r.text}
                                    </span>
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
                {custom ? (
                    <>
                        <button
                            type="button"
                            onClick={() => commit(draft)}
                            data-testid="cookie-save"
                            className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Save my choices
                        </button>
                        <button
                            type="button"
                            onClick={() => commit(ALL)}
                            data-testid="cookie-accept"
                            className="border border-[#002B5C] text-[#002B5C] px-5 py-2 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                        >
                            Accept all
                        </button>
                    </>
                ) : (
                    <>
                        {/* Accept and Reject are deliberately identical in weight.
                            The moment one is louder than the other, the choice
                            stops being free and the banner stops being consent. */}
                        <button
                            type="button"
                            onClick={() => commit(ALL)}
                            data-testid="cookie-accept"
                            className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Accept all
                        </button>
                        <button
                            type="button"
                            onClick={() => commit(NONE)}
                            data-testid="cookie-decline"
                            className="bg-[#002B5C] text-white px-5 py-2 text-sm font-medium hover:bg-[#001F42] transition-colors"
                        >
                            Reject all
                        </button>
                        <button
                            type="button"
                            onClick={() => setCustom(true)}
                            data-testid="cookie-customise"
                            className="border border-[#002B5C] text-[#002B5C] px-5 py-2 text-sm font-medium hover:bg-[#F5F7FA] transition-colors"
                        >
                            Choose
                        </button>
                    </>
                )}
                <Link to="/cookie-policy" className="ml-auto text-xs text-[#4B5563] underline">
                    Learn more
                </Link>
            </div>
        </div>
    );
}
